import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../../src/providers/protection/circuit-breaker.js';
import { RedisCircuitBreakerStore } from '../../../src/providers/protection/redis-circuit-store.js';

function makeClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('RedisCircuitBreakerStore', () => {
  it('defaults to CLOSED when no state has been written yet', async () => {
    const redis = new RedisMock();
    const store = new RedisCircuitBreakerStore(redis as never, 'instagram');
    expect((await store.get()).status).toBe('CLOSED');
  });

  it('two CircuitBreaker instances sharing one Redis store see the same OPEN state', async () => {
    const redis = new RedisMock();
    const clock = makeClock();
    const storeA = new RedisCircuitBreakerStore(redis as never, 'instagram');
    const storeB = new RedisCircuitBreakerStore(redis as never, 'instagram');

    const replicaA = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now, store: storeA });
    const replicaB = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now, store: storeB });

    await replicaA.recordFailure();
    expect(await replicaB.getState()).toBe('OPEN');

    await expect(replicaB.assertCanExecute('instagram')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});
