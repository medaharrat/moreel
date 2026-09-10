import { describe, expect, it } from 'vitest';
import { NoopCache, normalizeUrlForCache, TtlCache } from '../../src/cache/cache.js';

describe('TtlCache', () => {
  it('returns undefined for a missing key', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 'hello');
    expect(cache.get('a')).toBe('hello');
    expect(cache.size).toBe(1);
  });

  it('expires entries after the TTL using an injectable clock', () => {
    let now = 0;
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10, now: () => now });
    cache.set('a', 'hello');
    now = 500;
    expect(cache.get('a')).toBe('hello');
    now = 1500;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest entry once maxEntries is exceeded', () => {
    const cache = new TtlCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('deletes and clears entries', () => {
    const cache = new TtlCache<number>({ ttlMs: 10_000, maxEntries: 10 });
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('NoopCache', () => {
  it('never stores anything', () => {
    const cache = new NoopCache<number>();
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe('normalizeUrlForCache', () => {
  it('strips tracking query params', () => {
    expect(normalizeUrlForCache('https://www.instagram.com/reel/abc/?igsh=xyz123')).toBe(
      'www.instagram.com/reel/abc',
    );
    expect(normalizeUrlForCache('https://www.instagram.com/reel/abc/?utm_source=ig_web')).toBe(
      'www.instagram.com/reel/abc',
    );
  });

  it('strips trailing slashes and lowercases the host', () => {
    expect(normalizeUrlForCache('https://WWW.Instagram.com/reel/abc/')).toBe(
      'www.instagram.com/reel/abc',
    );
    expect(normalizeUrlForCache('https://www.instagram.com/reel/abc')).toBe(
      'www.instagram.com/reel/abc',
    );
  });

  it('keeps and sorts non-tracking query params', () => {
    expect(normalizeUrlForCache('https://example.com/x?b=2&a=1')).toBe('example.com/x?a=1&b=2');
  });

  it('ignores the URL fragment', () => {
    expect(normalizeUrlForCache('https://example.com/x#section')).toBe('example.com/x');
  });
});
