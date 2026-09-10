#!/usr/bin/env tsx
/**
 * npm run benchmark
 *
 * End-to-end pipeline latency benchmark, run through the real
 * TranscriptionService (real caching, concurrency gate, metrics,
 * cancellation wiring) with a synthetic provider/audio/transcription
 * backend standing in for network-bound work. This sandboxed environment
 * has no outbound access to Instagram/yt-dlp/ffmpeg/OpenAI, so realistic
 * per-stage delays are simulated and clearly labeled as such — this
 * measures the *pipeline's own overhead*, not real-world network/API
 * latency. Point MOREEL_BENCHMARK_LIVE_URL at a real public Reel (with
 * yt-dlp/ffmpeg installed and OPENAI_API_KEY set) to benchmark the real
 * thing end-to-end.
 *
 * Reports per-stage p50/p95/p99 against the targets in the spec (README
 * "Performance" section): url validation <10ms, provider resolution
 * <50ms, audio extraction <500ms, end-to-end ~2-5s after media is
 * available.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { TranscriptionService } from '../src/app/transcription-service.js';
import { TtlCache } from '../src/cache/cache.js';
import { loadConfig } from '../src/config/index.js';
import type { TranscribeVideoResult, VideoAsset } from '../src/domain/transcript.js';
import type { AudioExtractor } from '../src/media/audio/audio-extractor.js';
import { Metrics } from '../src/observability/metrics.js';
import { ProviderRegistry } from '../src/providers/provider.js';
import type { FetchOptions, VideoProvider } from '../src/providers/provider.js';
import type { Transcriber } from '../src/transcription/transcriber.js';
import { InMemoryUsageRecorder } from '../src/usage/usage-recorder.js';

const REQUEST_COUNT = Number(process.env.MOREEL_BENCHMARK_REQUESTS ?? 20);
const CONCURRENCY = Number(process.env.MOREEL_BENCHMARK_CONCURRENCY ?? 4);
const STAGGER_MS = Number(process.env.MOREEL_BENCHMARK_STAGGER_MS ?? 300);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Roughly modeled on real-world numbers for a ~5MB, ~30s Reel over a good connection. */
function syntheticInstagramProvider(): VideoProvider {
  return {
    id: 'instagram',
    canHandle: () => true,
    fetch: async (url: URL, _options: FetchOptions): Promise<VideoAsset> => {
      await sleep(400 + Math.random() * 800); // network-bound download
      return {
        filePath: '/tmp/synthetic-video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 5 * 1024 * 1024,
        durationSeconds: 30,
        source: 'instagram',
        sourceUrl: url.toString(),
      };
    },
  };
}

function syntheticAudioExtractor(): AudioExtractor {
  return {
    extract: async () => {
      await sleep(150 + Math.random() * 250); // ffmpeg, audio-only
      return {
        filePath: '/tmp/synthetic-audio.wav',
        format: 'wav',
        durationSeconds: 30,
        sizeBytes: 960_000,
      };
    },
  };
}

function syntheticTranscriber(): Transcriber {
  return {
    provider: 'synthetic',
    model: 'synthetic-benchmark',
    transcribe: async () => {
      await sleep(600 + Math.random() * 900); // hosted ASR API call
      return {
        text: 'synthetic benchmark transcript for latency measurement purposes.',
        segments: [
          {
            start: 0,
            end: 30,
            text: 'synthetic benchmark transcript for latency measurement purposes.',
          },
        ],
        language: 'en',
        durationSeconds: 30,
        lowConfidence: false,
      };
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    MAX_CONCURRENT_REQUESTS: String(CONCURRENCY),
    CACHE_ENABLED: 'false',
  });
  const metrics = new Metrics();
  const logger = pino({ level: 'silent' });

  const provider = syntheticInstagramProvider();

  const service = new TranscriptionService({
    providerRegistry: new ProviderRegistry([provider]),
    audioExtractor: syntheticAudioExtractor(),
    transcriber: syntheticTranscriber(),
    cache: new TtlCache<TranscribeVideoResult>({ ttlMs: 1, maxEntries: 1 }),
    usageRecorder: new InMemoryUsageRecorder(),
    metrics,
    logger,
    config,
  });

  console.log(
    `\nMoreel end-to-end pipeline benchmark (synthetic backend, ${REQUEST_COUNT} requests, concurrency ${CONCURRENCY})`,
  );
  console.log('='.repeat(72));

  let successCount = 0;
  let rateLimited = 0;
  // Stagger request starts to model realistic bursty-but-not-simultaneous
  // traffic (an all-at-once burst mostly just measures the RATE_LIMITED
  // fast-fail path rather than end-to-end latency).
  const results = await Promise.allSettled(
    Array.from({ length: REQUEST_COUNT }, async (_, i) => {
      await sleep(i * STAGGER_MS);
      return service.transcribeVideo({
        url: `https://www.instagram.com/reel/Bench${i}/`,
        requestId: `bench-${i}`,
        signal: new AbortController().signal,
      });
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      successCount++;
    } else if ((result.reason as { code?: string })?.code === 'RATE_LIMITED') {
      rateLimited++;
    }
  }

  const snapshot = metrics.snapshot();
  console.log(`Requests:        ${REQUEST_COUNT}`);
  console.log(`Succeeded:       ${successCount}`);
  console.log(`Rate-limited:    ${rateLimited}`);
  console.log('-'.repeat(72));
  console.log(
    `${'stage'.padEnd(24)}${'avg(ms)'.padEnd(12)}${'p50'.padEnd(10)}${'p95'.padEnd(10)}${'p99'}`,
  );
  for (const [stage, stats] of Object.entries(snapshot.latencies)) {
    console.log(
      `${stage.padEnd(24)}${stats.avg.toFixed(1).padEnd(12)}${stats.p50.toFixed(1).padEnd(10)}${stats.p95
        .toFixed(1)
        .padEnd(10)}${stats.p99.toFixed(1)}`,
    );
  }
  console.log('='.repeat(72));
  console.log(
    'Note: media_download_ms / transcription_ms are synthetic network-bound delays, not real measurements.',
  );

  const outDir = path.join(process.cwd(), 'benchmark-results');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `pipeline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(
    outFile,
    JSON.stringify(
      {
        mode: 'synthetic',
        generatedAt: new Date().toISOString(),
        requestCount: REQUEST_COUNT,
        concurrency: CONCURRENCY,
        successCount,
        rateLimited,
        metrics: snapshot,
      },
      null,
      2,
    ),
  );
  console.log(`Results written to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
