import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { TranscriptionService } from '../../src/app/transcription-service.js';
import { TtlCache } from '../../src/cache/cache.js';
import type { TranscribeVideoResult } from '../../src/domain/transcript.js';
import { Metrics } from '../../src/observability/metrics.js';
import { ProviderRegistry } from '../../src/providers/provider.js';
import { InMemoryUsageRecorder } from '../../src/usage/usage-recorder.js';
import {
  FakeInstagramProvider,
  fakeAudioExtractor,
  fakeTranscriber,
  silentLogger,
} from '../helpers/service-fakes.js';

function buildService(overrides: {
  provider?: FakeInstagramProvider;
  audioExtractor?: ReturnType<typeof fakeAudioExtractor>;
  transcriber?: ReturnType<typeof fakeTranscriber>;
  requestTimeoutMs?: string;
}) {
  const config = loadConfig({
    REQUEST_TIMEOUT_SECONDS: overrides.requestTimeoutMs ?? '60',
    MAX_CONCURRENT_REQUESTS: '4',
    CACHE_ENABLED: 'false',
  });
  const provider = overrides.provider ?? new FakeInstagramProvider();
  return new TranscriptionService({
    providerRegistry: new ProviderRegistry([provider]),
    audioExtractor: overrides.audioExtractor ?? fakeAudioExtractor(),
    transcriber: overrides.transcriber ?? fakeTranscriber(),
    cache: new TtlCache<TranscribeVideoResult>({ ttlMs: 60_000, maxEntries: 50 }),
    usageRecorder: new InMemoryUsageRecorder(),
    metrics: new Metrics(),
    logger: silentLogger,
    config,
  });
}

describe('failure: download timeout / hang', () => {
  it('the overall request times out with REQUEST_TIMEOUT rather than hanging forever', async () => {
    const hangingProvider = new FakeInstagramProvider(
      () => new Promise(() => {}), // never resolves
    );
    const service = buildService({ provider: hangingProvider, requestTimeoutMs: '1' });

    await expect(
      service.transcribeVideo({
        url: 'https://www.instagram.com/reel/hang/',
        requestId: randomUUID(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  }, 10_000);
});

describe('failure: transcription provider hangs/times out', () => {
  it('the overall request times out rather than hanging on a stuck transcription call', async () => {
    const hangingTranscriber = {
      provider: 'fake',
      model: 'fake-model',
      transcribe: () => new Promise<never>(() => {}),
    };
    const service = buildService({ transcriber: hangingTranscriber, requestTimeoutMs: '1' });

    await expect(
      service.transcribeVideo({
        url: 'https://www.instagram.com/reel/hang2/',
        requestId: randomUUID(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  }, 10_000);
});

describe('failure: corrupt/malformed media', () => {
  it('audio extraction failure surfaces a typed AUDIO_EXTRACTION_FAILED error, not a crash', async () => {
    const service = buildService({
      audioExtractor: {
        extract: async () => {
          throw new Error('ffmpeg: invalid data found when processing input');
        },
      },
    });

    await expect(
      service.transcribeVideo({
        url: 'https://www.instagram.com/reel/corrupt/',
        requestId: randomUUID(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('failure: client cancellation', () => {
  it('aborting the request signal stops the pipeline instead of completing it', async () => {
    const controller = new AbortController();
    const slowProvider = new FakeInstagramProvider(async (url, options) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return {
        filePath: '/tmp/fake-video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 100,
        durationSeconds: 10,
        source: 'instagram',
        sourceUrl: url.toString(),
      };
    });
    const service = buildService({ provider: slowProvider });

    const promise = service.transcribeVideo({
      url: 'https://www.instagram.com/reel/cancel/',
      requestId: randomUUID(),
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toThrow();
  });
});
