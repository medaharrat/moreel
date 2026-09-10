import { describe, expect, it } from 'vitest';
import { ErrorCode, MoreelError } from '../../../src/domain/errors.js';
import { Metrics } from '../../../src/observability/metrics.js';
import { ProtectedProvider } from '../../../src/providers/protection/protected-provider.js';
import type { FetchOptions, VideoProvider } from '../../../src/providers/provider.js';
import type { VideoAsset } from '../../../src/domain/transcript.js';

const fetchOptions: FetchOptions = {
  signal: new AbortController().signal,
  workDir: '/tmp',
  maxSizeBytes: 1_000_000,
  maxDurationSeconds: 600,
  timeoutMs: 5_000,
};

const fakeAsset: VideoAsset = {
  filePath: '/tmp/video.mp4',
  contentType: 'video/mp4',
  sizeBytes: 100,
  durationSeconds: 10,
  source: 'instagram',
  sourceUrl: 'https://www.instagram.com/reel/abc/',
};

function makeInner(fetchImpl: (url: URL) => Promise<VideoAsset>): VideoProvider {
  return {
    id: 'instagram',
    canHandle: () => true,
    fetch: (url) => fetchImpl(url),
  };
}

describe('ProtectedProvider', () => {
  it('passes through a successful fetch and reports healthy', async () => {
    const inner = makeInner(async () => fakeAsset);
    const protectedProvider = new ProtectedProvider({
      provider: inner,
      metrics: new Metrics(),
      maxConcurrency: 4,
      requestsPerSecond: 100,
      cooldownMs: 1000,
      maxRetries: 0,
      circuitFailureThreshold: 3,
      isDisabled: () => false,
    });

    const result = await protectedProvider.fetch(new URL('https://www.instagram.com/reel/abc/'), fetchOptions);
    expect(result).toBe(fakeAsset);
    expect(await protectedProvider.getHealth()).toEqual({ status: 'healthy' });
  });

  it('opens the circuit after repeated provider-caused failures and reports blocked', async () => {
    const inner = makeInner(async () => {
      throw new MoreelError(ErrorCode.DOWNLOAD_FAILED);
    });
    const protectedProvider = new ProtectedProvider({
      provider: inner,
      metrics: new Metrics(),
      maxConcurrency: 4,
      requestsPerSecond: 100,
      cooldownMs: 60_000,
      maxRetries: 0,
      circuitFailureThreshold: 2,
      isDisabled: () => false,
    });

    const url = new URL('https://www.instagram.com/reel/one/');
    await expect(protectedProvider.fetch(url, fetchOptions)).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/two/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });

    expect(await protectedProvider.getHealth()).toEqual({ status: 'blocked' });

    // once OPEN, further calls fail fast with PROVIDER_UNAVAILABLE without
    // calling the wrapped provider again — traffic goes down, not up.
    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/three/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('does not open the circuit for a permanent/user-caused failure (bad URL content)', async () => {
    const inner = makeInner(async () => {
      throw new MoreelError(ErrorCode.CONTENT_UNAVAILABLE);
    });
    const protectedProvider = new ProtectedProvider({
      provider: inner,
      metrics: new Metrics(),
      maxConcurrency: 4,
      requestsPerSecond: 100,
      cooldownMs: 60_000,
      maxRetries: 0,
      circuitFailureThreshold: 1,
      isDisabled: () => false,
    });

    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/abc/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
    expect(await protectedProvider.getHealth()).toEqual({ status: 'healthy' });
  });

  it('collapses concurrent identical requests into a single call to the wrapped provider', async () => {
    let calls = 0;
    let resolveFirst!: (asset: VideoAsset) => void;
    const inner = makeInner(async () => {
      calls++;
      return new Promise<VideoAsset>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const protectedProvider = new ProtectedProvider({
      provider: inner,
      metrics: new Metrics(),
      maxConcurrency: 4,
      requestsPerSecond: 100,
      cooldownMs: 1000,
      maxRetries: 0,
      circuitFailureThreshold: 3,
      isDisabled: () => false,
    });

    const url = new URL('https://www.instagram.com/reel/same/');
    const first = protectedProvider.fetch(url, fetchOptions);
    const second = protectedProvider.fetch(url, fetchOptions);

    // let both fetch() calls run past their (async) semaphore/circuit-breaker
    // gating and reach the wrapped provider before resolving it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirst(fakeAsset);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(fakeAsset);
    expect(b).toBe(fakeAsset);
    expect(calls).toBe(1);
  });

  it('immediately rejects with PROVIDER_UNAVAILABLE when disabled via the kill switch, without calling the wrapped provider', async () => {
    let calls = 0;
    const inner = makeInner(async () => {
      calls++;
      return fakeAsset;
    });
    const protectedProvider = new ProtectedProvider({
      provider: inner,
      metrics: new Metrics(),
      maxConcurrency: 4,
      requestsPerSecond: 100,
      cooldownMs: 1000,
      maxRetries: 0,
      circuitFailureThreshold: 3,
      isDisabled: () => true,
    });

    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/abc/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(calls).toBe(0);
    expect(await protectedProvider.getHealth()).toEqual({ status: 'disabled' });
  });

  it('never exceeds INSTAGRAM_REQUESTS_PER_SECOND even under a burst', async () => {
    const inner = makeInner(async () => fakeAsset);
    const protectedProvider = new ProtectedProvider({
      provider: inner,
      metrics: new Metrics(),
      maxConcurrency: 100,
      requestsPerSecond: 2,
      cooldownMs: 1000,
      maxRetries: 0, // disable retry so the bucket rejection surfaces directly
      circuitFailureThreshold: 100,
      isDisabled: () => false,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        protectedProvider.fetch(new URL(`https://www.instagram.com/reel/burst-${i}/`), fetchOptions),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBeLessThanOrEqual(2);
  });
});
