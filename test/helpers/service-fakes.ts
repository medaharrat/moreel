import pino from 'pino';
import { TranscriptionService } from '../../src/app/transcription-service.js';
import { TtlCache } from '../../src/cache/cache.js';
import { loadConfig } from '../../src/config/index.js';
import type { TranscribeVideoResult, VideoAsset } from '../../src/domain/transcript.js';
import type { AudioExtractor } from '../../src/media/audio/audio-extractor.js';
import type { FrameSampler } from '../../src/media/frames/frame-sampler.js';
import { Metrics } from '../../src/observability/metrics.js';
import { ProviderRegistry } from '../../src/providers/provider.js';
import type { FetchOptions, VideoProvider } from '../../src/providers/provider.js';
import type { Transcriber } from '../../src/transcription/transcriber.js';
import { InMemoryUsageRecorder } from '../../src/usage/usage-recorder.js';
import type { VisionProvider } from '../../src/vision/vision-provider.js';

export const silentLogger = pino({ level: 'silent' });

export class FakeInstagramProvider implements VideoProvider {
  readonly id = 'instagram';
  fetchCalls = 0;
  fetchImpl: (url: URL, options: FetchOptions) => Promise<VideoAsset>;

  constructor(fetchImpl?: (url: URL, options: FetchOptions) => Promise<VideoAsset>) {
    this.fetchImpl =
      fetchImpl ??
      (async (url) => ({
        filePath: '/tmp/fake-video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 12_345,
        durationSeconds: 53.28,
        source: 'instagram',
        sourceUrl: url.toString(),
      }));
  }

  canHandle(url: URL): boolean {
    return url.hostname.endsWith('instagram.com');
  }

  async fetch(url: URL, options: FetchOptions): Promise<VideoAsset> {
    this.fetchCalls++;
    return this.fetchImpl(url, options);
  }
}

export function fakeAudioExtractor(): AudioExtractor {
  return {
    extract: async () => ({
      filePath: '/tmp/fake-audio.wav',
      format: 'wav',
      durationSeconds: 53.28,
      sizeBytes: 999,
    }),
  };
}

export function fakeTranscriber(): Transcriber {
  return {
    provider: 'fake',
    model: 'fake-model',
    transcribe: async () => ({
      text: '10 out of 10 unusual hobbies.',
      segments: [{ start: 0, end: 2.44, text: '10 out of 10 unusual hobbies.' }],
      language: 'en',
      durationSeconds: 53.28,
      lowConfidence: false,
    }),
  };
}

export interface BuildServiceOverrides {
  provider?: VideoProvider;
  audioExtractor?: AudioExtractor;
  transcriber?: Transcriber;
  cacheEnabled?: boolean;
  maxConcurrentRequests?: number;
  visionEnabled?: boolean;
  frameSampler?: FrameSampler;
  visionProvider?: VisionProvider;
}

export function buildTranscriptionService(overrides: BuildServiceOverrides = {}): {
  service: TranscriptionService;
  provider: VideoProvider;
  usageRecorder: InMemoryUsageRecorder;
} {
  const config = loadConfig({
    MAX_CONCURRENT_REQUESTS: String(overrides.maxConcurrentRequests ?? 4),
    CACHE_ENABLED: String(overrides.cacheEnabled ?? true),
    VISION_ENABLED: String(overrides.visionEnabled ?? false),
  });
  const provider = overrides.provider ?? new FakeInstagramProvider();
  const usageRecorder = new InMemoryUsageRecorder();
  const service = new TranscriptionService({
    providerRegistry: new ProviderRegistry([provider]),
    audioExtractor: overrides.audioExtractor ?? fakeAudioExtractor(),
    transcriber: overrides.transcriber ?? fakeTranscriber(),
    cache: new TtlCache<TranscribeVideoResult>({ ttlMs: 60_000, maxEntries: 50 }),
    usageRecorder,
    metrics: new Metrics(),
    logger: silentLogger,
    config,
    ...(overrides.frameSampler ? { frameSampler: overrides.frameSampler } : {}),
    ...(overrides.visionProvider ? { visionProvider: overrides.visionProvider } : {}),
  });
  return { service, provider, usageRecorder };
}
