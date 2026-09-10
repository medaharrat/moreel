import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { RedisRateLimiter } from '../../../src/ratelimit/redis-rate-limiter.js';

function makeClock(startMs = 1_000_000) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('RedisRateLimiter', () => {
  it('allows up to the limit within a minute, then rejects', async () => {
    const redis = new RedisMock();
    const clock = makeClock();
    const limiter = new RedisRateLimiter(redis as never, clock.now);

    for (let i = 0; i < 3; i++) {
      expect((await limiter.checkLimit('user-a', 3)).allowed).toBe(true);
    }
    expect((await limiter.checkLimit('user-a', 3)).allowed).toBe(false);
  });

  it('refills over time', async () => {
    const redis = new RedisMock();
    const clock = makeClock();
    const limiter = new RedisRateLimiter(redis as never, clock.now);

    for (let i = 0; i < 3; i++) await limiter.checkLimit('user-b', 3);
    expect((await limiter.checkLimit('user-b', 3)).allowed).toBe(false);

    clock.advance(20_000);
    expect((await limiter.checkLimit('user-b', 3)).allowed).toBe(true);
  });

  it('two "replicas" sharing one Redis instance see the same bucket', async () => {
    const redis = new RedisMock();
    const clock = makeClock();
    const replicaA = new RedisRateLimiter(redis as never, clock.now);
    const replicaB = new RedisRateLimiter(redis as never, clock.now);

    expect((await replicaA.checkLimit('shared', 2)).allowed).toBe(true);
    expect((await replicaB.checkLimit('shared', 2)).allowed).toBe(true);
    expect((await replicaA.checkLimit('shared', 2)).allowed).toBe(false);
  });
});
