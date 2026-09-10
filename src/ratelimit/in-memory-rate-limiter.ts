import type { RateLimitDecision, RateLimiter } from './rate-limiter.js';

interface Bucket {
  tokens: number;
  capacity: number;
  lastRefillMs: number;
}

/**
 * Per-process token bucket, one per key. Only correct at one replica —
 * `RedisRateLimiter` (backed by `REDIS_URL`) is what makes limits hold
 * across a horizontally-scaled deployment; this exists so local dev and
 * tests don't require Redis.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  async checkLimit(key: string, limitPerMinute: number): Promise<RateLimitDecision> {
    const now = this.clock();
    const refillPerMs = limitPerMinute / 60_000;
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.capacity !== limitPerMinute) {
      bucket = { tokens: limitPerMinute, capacity: limitPerMinute, lastRefillMs: now };
    } else {
      const elapsed = now - bucket.lastRefillMs;
      bucket.tokens = Math.min(limitPerMinute, bucket.tokens + elapsed * refillPerMs);
      bucket.lastRefillMs = now;
    }

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);

    const missing = Math.max(0, 1 - bucket.tokens);
    const resetAt = now + missing / refillPerMs;

    return { allowed, remaining: Math.max(0, Math.floor(bucket.tokens)), resetAt };
  }
}
