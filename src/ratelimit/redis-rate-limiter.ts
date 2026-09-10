import type { Redis } from 'ioredis';
import type { RateLimitDecision, RateLimiter } from './rate-limiter.js';

/**
 * Atomic token-bucket check-and-consume, run as a single Lua script so
 * concurrent requests from the same caller (across any number of replicas,
 * since they all talk to the same Redis) can never race past the limit.
 * KEYS[1] = bucket key.
 * ARGV: capacity, refillPerMs, nowMs.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refillPerMs)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil(capacity / refillPerMs) + 60000)

return {allowed, tostring(tokens)}
`;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly clock: () => number = () => Date.now(),
    private readonly keyPrefix = 'ratelimit',
  ) {}

  async checkLimit(key: string, limitPerMinute: number): Promise<RateLimitDecision> {
    const now = this.clock();
    const refillPerMs = limitPerMinute / 60_000;

    const [allowed, tokensStr] = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      `${this.keyPrefix}:${key}`,
      String(limitPerMinute),
      String(refillPerMs),
      String(now),
    )) as [number, string];

    const tokens = Number(tokensStr);
    const missing = Math.max(0, 1 - tokens);
    const resetAt = now + missing / refillPerMs;

    return { allowed: allowed === 1, remaining: Math.max(0, Math.floor(tokens)), resetAt };
  }
}
