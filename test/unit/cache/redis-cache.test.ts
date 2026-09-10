import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { RedisCache } from '../../../src/cache/redis-cache.js';

describe('RedisCache', () => {
  it('round-trips a JSON-serializable value', async () => {
    const redis = new RedisMock();
    const cache = new RedisCache<{ text: string }>(redis as never, { ttlMs: 60_000 });

    expect(await cache.get('k1')).toBeUndefined();
    await cache.set('k1', { text: 'hello' });
    expect(await cache.get('k1')).toEqual({ text: 'hello' });
  });

  it('delete removes the entry', async () => {
    const redis = new RedisMock();
    const cache = new RedisCache<{ text: string }>(redis as never, { ttlMs: 60_000 });
    await cache.set('k1', { text: 'hello' });
    await cache.delete('k1');
    expect(await cache.get('k1')).toBeUndefined();
  });

  it('is namespaced by keyPrefix so multiple caches can share one Redis', async () => {
    const redis = new RedisMock();
    const cacheA = new RedisCache<string>(redis as never, { ttlMs: 60_000, keyPrefix: 'a' });
    const cacheB = new RedisCache<string>(redis as never, { ttlMs: 60_000, keyPrefix: 'b' });

    await cacheA.set('same-key', 'from-a');
    await cacheB.set('same-key', 'from-b');

    expect(await cacheA.get('same-key')).toBe('from-a');
    expect(await cacheB.get('same-key')).toBe('from-b');
  });
});
