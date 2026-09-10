import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { RedisDedupLock } from '../../../src/cache/redis-dedup-lock.js';

describe('RedisDedupLock', () => {
  it('only runs the work once across two "replicas" for the same key', async () => {
    const redis = new RedisMock();
    const lockA = new RedisDedupLock(redis as never, { lockTtlMs: 5000, resultTtlMs: 5000 });
    const lockB = new RedisDedupLock(redis as never, { lockTtlMs: 5000, resultTtlMs: 5000 });

    let calls = 0;
    const work = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { text: 'hello' };
    };

    const [a, b] = await Promise.all([lockA.runOnce('key-1', work), lockB.runOnce('key-1', work)]);

    expect(calls).toBe(1);
    expect(a).toEqual({ text: 'hello' });
    expect(b).toEqual({ text: 'hello' });
  });

  it('runs work independently for different keys', async () => {
    const redis = new RedisMock();
    const lock = new RedisDedupLock(redis as never, { lockTtlMs: 5000, resultTtlMs: 5000 });
    let calls = 0;
    const work = async () => {
      calls++;
      return calls;
    };

    const [a, b] = await Promise.all([lock.runOnce('key-a', work), lock.runOnce('key-b', work)]);
    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });
});
