import { describe, expect, it } from 'vitest';
import { InMemoryVideoStore } from '../../src/app/video-store.js';
import { computeVideoId } from '../../src/cache/keys.js';
import type { VideoRecord } from '../../src/domain/video.js';
import type { VideoProvider } from '../../src/providers/provider.js';

const fakeProvider: VideoProvider = {
  id: 'instagram',
  canHandle: () => true,
  fetch: async () => {
    throw new Error('not used in this test');
  },
};

function record(id: string): VideoRecord {
  return {
    id,
    source: 'instagram',
    sourceUrl: 'https://www.instagram.com/reel/abc123/',
    title: 'A reel',
    durationSeconds: 12,
    createdAt: new Date().toISOString(),
    transcript: { text: '', segments: [], language: 'en', durationSeconds: 12, lowConfidence: false },
    visualObservations: [],
  };
}

describe('computeVideoId', () => {
  it('is deterministic for the same provider + URL', () => {
    const a = computeVideoId(fakeProvider, new URL('https://www.instagram.com/reel/abc123/'));
    const b = computeVideoId(fakeProvider, new URL('https://www.instagram.com/reel/abc123/'));
    expect(a).toBe(b);
  });

  it('is stable across cosmetic URL variants that normalize to the same identity', () => {
    const a = computeVideoId(fakeProvider, new URL('https://www.instagram.com/reel/abc123/'));
    const b = computeVideoId(fakeProvider, new URL('https://www.instagram.com/reel/abc123/?utm_source=x'));
    expect(a).toBe(b);
  });

  it('differs for different content', () => {
    const a = computeVideoId(fakeProvider, new URL('https://www.instagram.com/reel/abc123/'));
    const b = computeVideoId(fakeProvider, new URL('https://www.instagram.com/reel/xyz789/'));
    expect(a).not.toBe(b);
  });
});

describe('InMemoryVideoStore', () => {
  it('round-trips a saved record by id', async () => {
    const store = new InMemoryVideoStore({ ttlMs: 60_000, maxEntries: 10 });
    await store.save(record('abc'));
    const found = await store.getById('abc');
    expect(found?.id).toBe('abc');
    expect(found?.sourceUrl).toBe('https://www.instagram.com/reel/abc123/');
  });

  it('returns undefined for an id that was never saved', async () => {
    const store = new InMemoryVideoStore({ ttlMs: 60_000, maxEntries: 10 });
    expect(await store.getById('missing')).toBeUndefined();
  });

  it('expires a record after its TTL', async () => {
    const shortLived = new InMemoryVideoStore({ ttlMs: 1, maxEntries: 10 });
    await shortLived.save(record('temp'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await shortLived.getById('temp')).toBeUndefined();
  });
});
