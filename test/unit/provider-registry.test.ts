import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../../src/providers/provider.js';
import type { VideoProvider } from '../../src/providers/provider.js';

function fakeProvider(id: string, handles: (url: URL) => boolean): VideoProvider {
  return {
    id,
    canHandle: handles,
    fetch: async () => {
      throw new Error('not implemented in fake');
    },
  };
}

describe('ProviderRegistry', () => {
  it('resolves the first provider that can handle the URL', () => {
    const instagram = fakeProvider('instagram', (url) => url.hostname.includes('instagram.com'));
    const tiktok = fakeProvider('tiktok', (url) => url.hostname.includes('tiktok.com'));
    const registry = new ProviderRegistry([instagram, tiktok]);

    expect(registry.resolve(new URL('https://www.instagram.com/reel/abc/'))).toBe(instagram);
    expect(registry.resolve(new URL('https://www.tiktok.com/@x/video/1'))).toBe(tiktok);
  });

  it('returns undefined for an unsupported host', () => {
    const instagram = fakeProvider('instagram', (url) => url.hostname.includes('instagram.com'));
    const registry = new ProviderRegistry([instagram]);

    expect(registry.resolve(new URL('https://www.youtube.com/watch?v=1'))).toBeUndefined();
  });

  it('lists all registered providers', () => {
    const a = fakeProvider('a', () => false);
    const b = fakeProvider('b', () => false);
    const registry = new ProviderRegistry([a, b]);
    expect(registry.list()).toEqual([a, b]);
  });
});
