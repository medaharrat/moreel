import type { Redis } from 'ioredis';

export interface RedisDedupLockOptions {
  /** How long the leader may hold the lock before another replica may take over (crash recovery). */
  lockTtlMs: number;
  /** How long a computed result stays available for followers to read. */
  resultTtlMs: number;
  /** How often followers poll for a result while waiting. */
  pollIntervalMs?: number;
  /** Give up waiting for a result after this long and attempt to become leader instead. */
  maxWaitMs?: number;
}

/**
 * Cross-replica "only one caller actually does the work" lock for
 * JSON-serializable, cacheable results — this is for the final
 * `TranscribeVideoResult`, not a `VideoAsset` (a local temp file that
 * cannot be shared across replicas). `ProtectedProvider`'s in-memory
 * `InFlightDedup` still collapses concurrent fetches *within* one replica;
 * this collapses concurrent *whole-pipeline runs* across all of them, so
 * N replicas handling the same uncached URL at once still only hit
 * Instagram/Whisper once.
 */
export class RedisDedupLock {
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly redis: Redis,
    private readonly options: RedisDedupLockOptions,
    private readonly keyPrefix = 'dedup',
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.maxWaitMs = options.maxWaitMs ?? options.lockTtlMs;
  }

  async runOnce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${this.keyPrefix}:lock:${key}`;
    const resultKey = `${this.keyPrefix}:result:${key}`;
    const token = `${process.pid}:${Date.now()}:${Math.random()}`;

    const acquired = await this.redis.set(lockKey, token, 'PX', this.options.lockTtlMs, 'NX');
    if (acquired === 'OK') {
      try {
        const result = await fn();
        await this.redis.set(resultKey, JSON.stringify(result), 'PX', this.options.resultTtlMs);
        return result;
      } finally {
        await this.releaseIfOwner(lockKey, token);
      }
    }

    return this.waitForResult<T>(lockKey, resultKey, key, fn);
  }

  private async waitForResult<T>(
    lockKey: string,
    resultKey: string,
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const deadline = Date.now() + this.maxWaitMs;
    while (Date.now() < deadline) {
      const raw = await this.redis.get(resultKey);
      if (raw !== null) return JSON.parse(raw) as T;

      const stillLocked = await this.redis.exists(lockKey);
      if (!stillLocked) break; // leader finished without publishing (crashed) or never existed

      await sleep(this.pollIntervalMs);
    }

    // Leader disappeared or we timed out waiting: try to become leader ourselves
    // rather than waiting forever. Bounded by the caller's own timeout upstream.
    return this.runOnce(key, fn);
  }

  private async releaseIfOwner(lockKey: string, token: string): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
    await this.redis.eval(script, 1, lockKey, token);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
