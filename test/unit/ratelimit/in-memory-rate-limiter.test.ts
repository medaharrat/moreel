import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '../../../src/ratelimit/in-memory-rate-limiter.js';

function makeClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('InMemoryRateLimiter', () => {
  it('allows up to the limit within a minute, then rejects', async () => {
    const clock = makeClock();
    const limiter = new InMemoryRateLimiter(clock.now);

    for (let i = 0; i < 3; i++) {
      const decision = await limiter.checkLimit('user-a', 3);
      expect(decision.allowed).toBe(true);
    }

    const rejected = await limiter.checkLimit('user-a', 3);
    expect(rejected.allowed).toBe(false);
  });

  it('refills over time', async () => {
    const clock = makeClock();
    const limiter = new InMemoryRateLimiter(clock.now);

    for (let i = 0; i < 3; i++) await limiter.checkLimit('user-b', 3);
    expect((await limiter.checkLimit('user-b', 3)).allowed).toBe(false);

    // 3 per minute => one token every 20s
    clock.advance(20_000);
    expect((await limiter.checkLimit('user-b', 3)).allowed).toBe(true);
  });

  it('tracks distinct keys independently', async () => {
    const clock = makeClock();
    const limiter = new InMemoryRateLimiter(clock.now);
    await limiter.checkLimit('user-c', 1);
    expect((await limiter.checkLimit('user-c', 1)).allowed).toBe(false);
    expect((await limiter.checkLimit('user-d', 1)).allowed).toBe(true);
  });
});
