import { describe, expect, it } from 'vitest';
import { contentIdentity, transcriptCacheKey } from '../../src/cache/keys.js';
import type { VideoProvider } from '../../src/providers/provider.js';

function fakeProvider(contentId?: (url: URL) => string | undefined): VideoProvider {
  return {
    id: 'instagram',
    canHandle: () => true,
    fetch: async () => {
      throw new Error('not used in this test');
    },
    ...(contentId ? { contentId } : {}),
  };
}

describe('contentIdentity', () => {
  it('uses the provider canonical content id when available', () => {
    const provider = fakeProvider(() => 'abc123');
    expect(contentIdentity(provider, new URL('https://www.instagram.com/reel/abc123/?igsh=x'))).toBe(
      'abc123',
    );
  });

  it('falls back to normalized URL when the provider has no contentId', () => {
    const provider = fakeProvider(undefined);
    const key = contentIdentity(provider, new URL('https://www.instagram.com/reel/abc123/?utm_source=x'));
    expect(key).toBe('www.instagram.com/reel/abc123');
  });
});

describe('transcriptCacheKey', () => {
  it('produces the same key for URL variants that share a content id', () => {
    const provider = fakeProvider(() => 'abc123');
    const a = transcriptCacheKey(provider, new URL('https://www.instagram.com/reel/abc123/'));
    const b = transcriptCacheKey(
      provider,
      new URL('https://www.instagram.com/someuser/reel/abc123/?igsh=y'),
    );
    expect(a).toBe(b);
  });

  it('is namespaced with a schema version and layer name', () => {
    const provider = fakeProvider(() => 'abc123');
    const key = transcriptCacheKey(provider, new URL('https://www.instagram.com/reel/abc123/'));
    expect(key).toBe('v1:transcript:instagram:abc123');
  });
});
