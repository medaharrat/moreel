import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../../src/providers/protection/circuit-breaker.js';

function makeClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('CircuitBreaker', () => {
  it('stays CLOSED under a failure count below the threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    await breaker.recordFailure();
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe('CLOSED');
  });

  it('opens once the failure threshold is reached', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    await breaker.recordFailure();
    await breaker.recordFailure();
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe('OPEN');
  });

  it('a success resets the failure count back to zero', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    await breaker.recordFailure();
    await breaker.recordFailure();
    await breaker.recordSuccess();
    await breaker.recordFailure();
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe('CLOSED');
  });

  it('rejects calls while OPEN, before the cooldown elapses', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now });
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe('OPEN');
    await expect(breaker.assertCanExecute('instagram')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('transitions OPEN -> HALF_OPEN once the cooldown elapses', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now });
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe('OPEN');
    clock.advance(1000);
    expect(await breaker.getState()).toBe('HALF_OPEN');
  });

  it('HALF_OPEN probe succeeding closes the breaker', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now });
    await breaker.recordFailure();
    clock.advance(1000);
    expect(await breaker.getState()).toBe('HALF_OPEN');
    await breaker.assertCanExecute('instagram');
    await breaker.recordSuccess();
    expect(await breaker.getState()).toBe('CLOSED');
  });

  it('HALF_OPEN probe failing reopens the breaker and restarts the cooldown', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now });
    await breaker.recordFailure();
    clock.advance(1000);
    expect(await breaker.getState()).toBe('HALF_OPEN');
    await breaker.assertCanExecute('instagram');
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe('OPEN');

    // cooldown restarted from the failed probe, not the original open time
    clock.advance(999);
    expect(await breaker.getState()).toBe('OPEN');
    clock.advance(1);
    expect(await breaker.getState()).toBe('HALF_OPEN');
  });

  it('only allows one HALF_OPEN probe at a time', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now });
    await breaker.recordFailure();
    clock.advance(1000);
    expect(await breaker.getState()).toBe('HALF_OPEN');

    await breaker.assertCanExecute('instagram'); // first probe admitted
    await expect(breaker.assertCanExecute('instagram')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    }); // second probe rejected
  });

  it('never retries harder while OPEN — repeated assertCanExecute calls all reject', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: clock.now });
    await breaker.recordFailure();
    for (let i = 0; i < 10; i++) {
      await expect(breaker.assertCanExecute('instagram')).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
    }
  });
});
