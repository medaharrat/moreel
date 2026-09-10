import type { Logger } from 'pino';
import { TranscriptionService } from './transcription-service.js';
import type { Kysely } from 'kysely';
import { InMemoryVideoStore, PostgresVideoStore, RedisVideoStore, type VideoStore } from './video-store.js';
import { TtlCache, NoopCache } from '../cache/cache.js';
import type { MoreelConfig } from '../config/index.js';
import type { TranscribeVideoResult } from '../domain/transcript.js';
import { createDb } from '../infra/db.js';
import type { Database } from '../infra/db-schema.js';
import { createRedisClient } from '../infra/redis.js';
import { FfmpegAudioExtractor } from '../media/audio/ffmpeg-audio-extractor.js';
import { HttpDownloader } from '../media/downloader/http-downloader.js';
import { FfmpegFrameSampler } from '../media/frames/ffmpeg-frame-sampler.js';
import { globalMetrics } from '../observability/metrics.js';
import { InstagramProvider } from '../providers/instagram/instagram-provider.js';
import { ProtectedProvider } from '../providers/protection/protected-provider.js';
import { ProviderRegistry } from '../providers/provider.js';
import { TikTokProvider } from '../providers/tiktok/tiktok-provider.js';
import { YouTubeProvider } from '../providers/youtube/youtube-provider.js';
import { createTranscriber } from '../transcription/factory.js';
import { ExecFileCommandRunner } from '../util/subprocess.js';
import { InMemoryUsageRecorder } from '../usage/usage-recorder.js';
import { createVideoInteractionAnalyzer, createVisionProvider } from '../vision/factory.js';
import type { VideoInteractionAnalyzer } from '../vision/video-interaction-analyzer.js';
import { createEmbeddingProvider } from '../embeddings/factory.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';

/** Builds the configured `EmbeddingProvider`, or `undefined` when semantic search is disabled — shared between the pipeline (writes embeddings) and MCP/HTTP query surfaces (embed the search query itself). */
export function buildEmbeddingProvider(config: MoreelConfig): EmbeddingProvider | undefined {
  return createEmbeddingProvider(config);
}

/** Builds the configured `VideoInteractionAnalyzer`, or `undefined` when the Video Map feature is disabled. */
export function buildVideoInteractionAnalyzer(config: MoreelConfig): VideoInteractionAnalyzer | undefined {
  return createVideoInteractionAnalyzer(config);
}

/**
 * The store backing `search_video`/`find_moment`/`get_video_timeline`
 * lookups by video id, in priority order:
 *   1. Postgres, when `DATABASE_URL` is configured — durable and shared
 *      across every process/replica, since most production deployments
 *      here already run Postgres for accounts/auth regardless of
 *      whether Redis is also set up.
 *   2. Redis, when `REDIS_URL` is configured but Postgres isn't.
 *   3. An in-process TTL cache otherwise — see `VideoStore`'s own docs for
 *      why this fallback is still useful (single-process dev, MCP stdio
 *      sessions) despite not being shared.
 * All three enforce the same TTL as the existing transcript cache — this
 * is a bounded-retention cache, not a durable archive (see docs/privacy.md).
 * Exported separately from `buildTranscriptionService` so HTTP routes and
 * MCP tools that only need to *read* videos (not run the pipeline) can
 * share the exact same store instance the pipeline writes to. Pass an
 * existing `db` when the caller already opened one (e.g. `http/main.ts`,
 * which needs it for auth too) to avoid a second connection pool.
 */
export function buildVideoStore(config: MoreelConfig, db?: Kysely<Database>): VideoStore {
  const ttlMs = config.transcriptTtlMs;

  if (db) {
    return new PostgresVideoStore(db, { ttlMs });
  }
  if (config.databaseUrl) {
    return new PostgresVideoStore(createDb({ connectionString: config.databaseUrl, poolMax: config.dbPoolMax }), {
      ttlMs,
    });
  }
  if (config.redisUrl) {
    const redis = createRedisClient({ url: config.redisUrl });
    return new RedisVideoStore(redis, { ttlMs });
  }
  return new InMemoryVideoStore({ ttlMs, maxEntries: config.cacheMaxEntries });
}

/**
 * Wires the whole pipeline (config → providers → media → transcription).
 * Shared by both transports (MCP-over-stdio and HTTP) so they run the exact
 * same provider/cache/limits configuration rather than two divergent copies.
 */
export function buildTranscriptionService(
  config: MoreelConfig,
  logger: Logger,
  deps: {
    videoStore?: VideoStore;
    embeddingProvider?: EmbeddingProvider;
    videoInteractionAnalyzer?: VideoInteractionAnalyzer;
  } = {},
): TranscriptionService {
  const runner = new ExecFileCommandRunner();
  const downloader = new HttpDownloader();

  const instagramProvider = new InstagramProvider({
    runner,
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
    downloader,
  });

  const tiktokProvider = new TikTokProvider({
    runner,
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
  });

  const youtubeProvider = new YouTubeProvider({
    runner,
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
  });

  const providerRegistry = new ProviderRegistry([
    new ProtectedProvider({
      provider: instagramProvider,
      metrics: globalMetrics,
      maxConcurrency: config.instagramMaxConcurrency,
      requestsPerSecond: config.instagramRequestsPerSecond,
      cooldownMs: config.instagramCooldownMs,
      maxRetries: config.instagramMaxRetries,
      circuitFailureThreshold: config.instagramCircuitFailureThreshold,
      isDisabled: () => config.instagramDisabled,
    }),
    new ProtectedProvider({
      provider: tiktokProvider,
      metrics: globalMetrics,
      maxConcurrency: config.tiktokMaxConcurrency,
      requestsPerSecond: config.tiktokRequestsPerSecond,
      cooldownMs: config.tiktokCooldownMs,
      maxRetries: config.tiktokMaxRetries,
      circuitFailureThreshold: config.tiktokCircuitFailureThreshold,
      isDisabled: () => config.tiktokDisabled,
    }),
    new ProtectedProvider({
      provider: youtubeProvider,
      metrics: globalMetrics,
      maxConcurrency: config.youtubeMaxConcurrency,
      requestsPerSecond: config.youtubeRequestsPerSecond,
      cooldownMs: config.youtubeCooldownMs,
      maxRetries: config.youtubeMaxRetries,
      circuitFailureThreshold: config.youtubeCircuitFailureThreshold,
      isDisabled: () => config.youtubeDisabled,
    }),
  ]);

  const audioExtractor = new FfmpegAudioExtractor({ runner, ffmpegPath: config.ffmpegPath });
  const transcriber = createTranscriber(config);

  // Both absent (not just inert) when VISION_ENABLED=false, so the pipeline
  // skips the vision step entirely rather than branching on a flag deep
  // inside transcription-service.ts.
  const frameSampler = config.visionEnabled
    ? new FfmpegFrameSampler({ runner, ffmpegPath: config.ffmpegPath })
    : undefined;
  const visionProvider = createVisionProvider(config);
  const videoStore = deps.videoStore ?? buildVideoStore(config);
  const embeddingProvider = deps.embeddingProvider ?? buildEmbeddingProvider(config);
  const videoInteractionAnalyzer = deps.videoInteractionAnalyzer ?? createVideoInteractionAnalyzer(config);

  const cache = config.cacheEnabled
    ? new TtlCache<TranscribeVideoResult>({
        ttlMs: config.cacheTtlMs,
        maxEntries: config.cacheMaxEntries,
      })
    : new NoopCache<TranscribeVideoResult>();

  return new TranscriptionService({
    providerRegistry,
    audioExtractor,
    transcriber,
    cache,
    usageRecorder: new InMemoryUsageRecorder(),
    metrics: globalMetrics,
    logger,
    config,
    ...(frameSampler ? { frameSampler } : {}),
    ...(visionProvider ? { visionProvider } : {}),
    ...(embeddingProvider ? { embeddingProvider } : {}),
    ...(videoInteractionAnalyzer ? { videoInteractionAnalyzer } : {}),
    ...(frameSampler ? { commandRunner: runner } : {}),
    videoStore,
  });
}
