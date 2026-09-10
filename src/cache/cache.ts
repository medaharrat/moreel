/**
 * Small in-memory TTL + size-bounded cache.
 *
 * v0.1 explicitly avoids Redis or any external cache — a single-process
 * Map is sufficient until benchmarking shows otherwise (see spec section
 * 18, "Caching"). The interface is narrow enough that swapping in a
 * distributed cache later is a drop-in change.
 *
 * The application must behave correctly with an empty (or disabled) cache;
 * this is purely a latency optimization, never a source of truth.
 */
export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class TtlCache<V> implements Cache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for a simple LRU-ish eviction order.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** A cache that never stores anything. Used when caching is disabled by config. */
export class NoopCache<V> implements Cache<V> {
  get(_key: string): V | undefined {
    return undefined;
  }
  set(_key: string, _value: V): void {
    // intentionally does nothing
  }
  delete(_key: string): void {
    // intentionally does nothing
  }
  clear(): void {
    // intentionally does nothing
  }
  get size(): number {
    return 0;
  }
}

/** Normalizes a video URL into a stable cache key (strips tracking params, trailing slash, query order noise). */
export function normalizeUrlForCache(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  const keptParams = new URLSearchParams();
  const sortedKeys = [...url.searchParams.keys()].sort();
  for (const key of sortedKeys) {
    if (key.startsWith('utm_') || key === 'igshid' || key === 'igsh') continue;
    const value = url.searchParams.get(key);
    if (value !== null) keptParams.set(key, value);
  }
  const query = keptParams.toString();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.hostname.toLowerCase()}${path}${query ? `?${query}` : ''}`;
}
