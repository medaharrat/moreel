import type { Redis } from 'ioredis';
import type { Cache } from './cache.js';

export interface RedisCacheOptions {
  ttlMs: number;
  keyPrefix?: string;
}

/**
 * `Cache<V>` backed by Redis instead of an in-process `Map` — same
 * interface as `TtlCache`, so `TranscriptionService` and the cache-key
 * builders in `src/cache/keys.ts` don't change when this is swapped in.
 * `get`/`set`/`delete` are async under the hood but exposed here as
 * `Promise`-returning methods; callers already `await` cache access via
 * the `Cache<V>` interface having synchronous methods today would need
 * updating — see `RedisCacheAdapter` note below before wiring this into
 * `TranscriptionService`.
 */
export class RedisCache<V> {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: Redis,
    private readonly options: RedisCacheOptions,
  ) {
    this.keyPrefix = options.keyPrefix ?? 'cache';
  }

  private k(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  async get(key: string): Promise<V | undefined> {
    const raw = await this.redis.get(this.k(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as V;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: V): Promise<void> {
    await this.redis.set(this.k(key), JSON.stringify(value), 'PX', this.options.ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }

  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}:*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }
}

/**
 * `TranscriptionService` currently depends on the synchronous `Cache<V>`
 * interface (`src/cache/cache.ts`) — `get`/`set` return values directly,
 * not Promises. Making the whole call path async to support a real
 * network cache is a bigger, deliberate change (touches every call site
 * down to the MCP tool handler) that belongs in its own reviewable step,
 * not bundled into introducing Redis. `RedisCache` above is ready and
 * tested; wiring it in as the live `TranscriptionService` cache is
 * intentionally left for that follow-up rather than done as a
 * type-unsafe shortcut here.
 */
export type { Cache };
