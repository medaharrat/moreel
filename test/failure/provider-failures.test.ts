import { describe, expect, it } from 'vitest';
import { ErrorCode, MoreelError } from '../../src/domain/errors.js';
import { Metrics } from '../../src/observability/metrics.js';
import { ProtectedProvider } from '../../src/providers/protection/protected-provider.js';
import type { FetchOptions, VideoProvider } from '../../src/providers/provider.js';
import type { VideoAsset } from '../../src/domain/transcript.js';

const fetchOptions: FetchOptions = {
  signal: new AbortController().signal,
  workDir: '/tmp',
  maxSizeBytes: 1_000_000,
  maxDurationSeconds: 600,
  timeoutMs: 5_000,
};

function alwaysFailingProvider(code: (typeof ErrorCode)[keyof typeof ErrorCode]): VideoProvider {
  return {
    id: 'instagram',
    canHandle: () => true,
    fetch: async () => {
      throw new MoreelError(code);
    },
  };
}

describe('failure: Instagram down (sustained transient failures)', () => {
  it('fails predictably (bounded time, typed error) rather than hanging, and reduces traffic instead of increasing it', async () => {
    // maxRetries: 0 so each top-level fetch() maps to exactly one internal
    // attempt/failure — with retries enabled, a single call's own retries
    // can trip the threshold on their own, which is correct behavior but
    // would make this test's failure-counting non-obvious.
    const protectedProvider = new ProtectedProvider({
      provider: alwaysFailingProvider(ErrorCode.DOWNLOAD_FAILED),
      metrics: new Metrics(),
      maxConcurrency: 4,
      requestsPerSecond: 100,
      cooldownMs: 60_000,
      maxRetries: 0,
      circuitFailureThreshold: 2,
      isDisabled: () => false,
    });

    // First two calls exhaust the failure threshold and open the breaker.
    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/a/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/b/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });

    expect(await protectedProvider.getHealth()).toEqual({ status: 'blocked' });

    // Every subsequent call fails immediately (no retry storm against a
    // provider that's already struggling) until the cooldown elapses.
    const start = performance.now();
    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/c/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(performance.now() - start).toBeLessThan(50); // fast-fail, not a retry loop
  });
});

describe('failure: Instagram rate-limiting', () => {
  it('surfaces RATE_LIMITED without retrying indefinitely', async () => {
    const protectedProvider = new ProtectedProvider({
      provider: alwaysFailingProvider(ErrorCode.RATE_LIMITED),
      metrics: new Metrics(),
      maxConcurrency: 4,
      requestsPerSecond: 100,
      cooldownMs: 60_000,
      maxRetries: 2,
      circuitFailureThreshold: 10,
      isDisabled: () => false,
    });

    await expect(
      protectedProvider.fetch(new URL('https://www.instagram.com/reel/rl/'), fetchOptions),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('failure: duplicate concurrent requests for the same content', () => {
  it('collapses concurrent fetches for the same URL into one provider call (single replica)', async () => {
    let fetchCalls = 0;
    let resolveFetch!: (asset: VideoAsset) => void;
    const provider: VideoProvider = {
      id: 'instagram',
      canHandle: () => true,
      fetch: async () => {
        fetchCalls++;
        return new Promise<VideoAsset>((resolve) => {
          resolveFetch = resolve;
        });
      },
    };
    const protectedProvider = new ProtectedProvider({
      provider,
      metrics: new Metrics(),
      maxConcurrency: 10,
      requestsPerSecond: 100,
      cooldownMs: 1000,
      maxRetries: 0,
      circuitFailureThreshold: 10,
      isDisabled: () => false,
    });

    const url = new URL('https://www.instagram.com/reel/dup/');
    const asset: VideoAsset = {
      filePath: '/tmp/video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 100,
      durationSeconds: 10,
      source: 'instagram',
      sourceUrl: url.toString(),
    };

    const [a, b, c] = await Promise.all([
      protectedProvider.fetch(url, fetchOptions),
      protectedProvider.fetch(url, fetchOptions),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        resolveFetch(asset);
        return null;
      })(),
    ]);

    expect(a).toBe(asset);
    expect(b).toBe(asset);
    expect(c).toBeNull();
    expect(fetchCalls).toBe(1);
  });
});
