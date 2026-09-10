import { z } from 'zod';

/**
 * All runtime configuration lives here, sourced from environment variables.
 * `loadConfig` is a pure function of an env map so it can be unit tested
 * without mutating `process.env`, and so defaults are documented in one
 * place (see also `.env.example`).
 */

const boolFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? defaultValue : value.trim().toLowerCase() === 'true',
    );

const intFromString = (defaultValue: number, opts: { min?: number; max?: number } = {}) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? defaultValue : Number(value)))
    .pipe(
      z
        .number()
        .int()
        .min(opts.min ?? Number.MIN_SAFE_INTEGER)
        .max(opts.max ?? Number.MAX_SAFE_INTEGER),
    );

const ConfigSchema = z.object({
  // Transcription provider selection
  TRANSCRIPTION_PROVIDER: z.enum(['openai']).default('openai'),
  TRANSCRIPTION_MODEL: z.string().default('whisper-1'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  // Vision provider selection — opt-in, off by default. When disabled the
  // pipeline never samples frames or calls a vision model; transcribe_video
  // behaves exactly as it did before this feature existed.
  VISION_ENABLED: boolFromString(false),
  VISION_PROVIDER: z.enum(['openai']).default('openai'),
  VISION_MODEL: z.string().default('gpt-4o-mini'),
  /** Hard cap on frames sampled per video — the one thing that prevents video length from producing unbounded vision-model calls. */
  MAX_FRAMES_PER_VIDEO: intFromString(16, { min: 1, max: 64 }),
  FRAME_SAMPLE_INTERVAL_SECONDS: intFromString(5, { min: 1, max: 60 }),
  VISION_TIMEOUT_SECONDS: intFromString(45, { min: 1, max: 300 }),

  // Semantic search — opt-in, off by default like vision. When disabled,
  // search_video/find_moment fall back to lexical-only matching exactly as
  // before this feature existed.
  SEARCH_EMBEDDINGS_ENABLED: boolFromString(false),
  SEARCH_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  SEARCH_EMBEDDING_TIMEOUT_SECONDS: intFromString(20, { min: 1, max: 120 }),

  // Video Map — opt-in, off by default, requires VISION_ENABLED too. Resolves
  // "this"/"that"/pointing references to specific visual entities; see
  // domain/video-map.ts. Off by default, existing behavior is unaffected.
  VIDEO_MAP_ENABLED: boolFromString(false),
  VIDEO_MAP_MODEL: z.string().default('gpt-4o-mini'),
  VIDEO_MAP_TIMEOUT_SECONDS: intFromString(45, { min: 1, max: 300 }),
  /** Hard cap on trigger windows analyzed per video — the same "bounded regardless of length" guarantee MAX_FRAMES_PER_VIDEO gives the vision pipeline. */
  VIDEO_MAP_MAX_WINDOWS: intFromString(8, { min: 1, max: 32 }),

  // Media limits
  MAX_VIDEO_SIZE_MB: intFromString(100, { min: 1, max: 2000 }),
  MAX_VIDEO_DURATION_SECONDS: intFromString(600, { min: 1, max: 3600 }),

  // Timeouts
  REQUEST_TIMEOUT_SECONDS: intFromString(60, { min: 1, max: 600 }),
  DOWNLOAD_TIMEOUT_SECONDS: intFromString(30, { min: 1, max: 300 }),
  TRANSCRIPTION_TIMEOUT_SECONDS: intFromString(45, { min: 1, max: 600 }),

  // Concurrency / backpressure
  MAX_CONCURRENT_REQUESTS: intFromString(4, { min: 1, max: 64 }),

  // Cache
  CACHE_ENABLED: boolFromString(true),
  CACHE_TTL_SECONDS: intFromString(3600, { min: 1, max: 86_400 }),
  CACHE_MAX_ENTRIES: intFromString(200, { min: 1, max: 100_000 }),

  // External binaries
  YTDLP_PATH: z.string().default('yt-dlp'),
  FFMPEG_PATH: z.string().default('ffmpeg'),

  // Observability
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Working storage
  TEMP_DIR: z.string().optional(),

  // HTTP server
  HTTP_PORT: intFromString(8080, { min: 1, max: 65_535 }),
  HTTP_HOST: z.string().default('0.0.0.0'),
  SHUTDOWN_TIMEOUT_SECONDS: intFromString(30, { min: 1, max: 300 }),
  /** Comma-separated allowed origins for browser callers (the web frontend), or "*" for any. */
  CORS_ORIGIN: z.string().default('*'),

  // Instagram provider protection
  INSTAGRAM_MAX_CONCURRENCY: intFromString(4, { min: 1, max: 64 }),
  INSTAGRAM_REQUESTS_PER_SECOND: intFromString(2, { min: 1, max: 50 }),
  INSTAGRAM_COOLDOWN_SECONDS: intFromString(60, { min: 1, max: 3600 }),
  INSTAGRAM_MAX_RETRIES: intFromString(3, { min: 0, max: 10 }),
  INSTAGRAM_CIRCUIT_FAILURE_THRESHOLD: intFromString(5, { min: 1, max: 100 }),
  INSTAGRAM_DISABLED: boolFromString(false),

  // TikTok provider protection — separate knobs from Instagram's so one
  // platform tightening rate limits or tripping its circuit breaker never
  // throttles the others.
  TIKTOK_MAX_CONCURRENCY: intFromString(4, { min: 1, max: 64 }),
  TIKTOK_REQUESTS_PER_SECOND: intFromString(2, { min: 1, max: 50 }),
  TIKTOK_COOLDOWN_SECONDS: intFromString(60, { min: 1, max: 3600 }),
  TIKTOK_MAX_RETRIES: intFromString(3, { min: 0, max: 10 }),
  TIKTOK_CIRCUIT_FAILURE_THRESHOLD: intFromString(5, { min: 1, max: 100 }),
  TIKTOK_DISABLED: boolFromString(false),

  // YouTube provider protection
  YOUTUBE_MAX_CONCURRENCY: intFromString(4, { min: 1, max: 64 }),
  YOUTUBE_REQUESTS_PER_SECOND: intFromString(2, { min: 1, max: 50 }),
  YOUTUBE_COOLDOWN_SECONDS: intFromString(60, { min: 1, max: 3600 }),
  YOUTUBE_MAX_RETRIES: intFromString(3, { min: 0, max: 10 }),
  YOUTUBE_CIRCUIT_FAILURE_THRESHOLD: intFromString(5, { min: 1, max: 100 }),
  YOUTUBE_DISABLED: boolFromString(false),

  // Redis (distributed rate limiting; optional in dev — falls back to
  // in-memory limiting when unset, which is only correct at one replica)
  REDIS_URL: z.string().optional(),
  RATE_LIMIT_ANONYMOUS_RPM: intFromString(5, { min: 1, max: 10_000 }),
  RATE_LIMIT_FREE_RPM: intFromString(5, { min: 1, max: 10_000 }),

  // Postgres (accounts, API keys — never media)
  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: intFromString(10, { min: 1, max: 100 }),

  // Observability: tracing/error-tracking are both inert (no-op) when unset.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('moreel'),
  SENTRY_DSN: z.string().optional(),
  // Transcript persistence TTL (seconds) for re-accessible transcript URLs
  TRANSCRIPT_TTL_SECONDS: intFromString(86400, { min: 60, max: 60 * 60 * 24 * 30 }),
  /**
   * How long a downloaded video stays available for in-browser playback via
   * GET /media/:id before being deleted — short by design (see
   * docs/privacy.md: media is a transient artifact, never an archive).
   * Long enough to read a transcript and watch the clip once, not a cache.
   */
  MEDIA_TTL_SECONDS: intFromString(600, { min: 30, max: 3600 }),
});

export type Env = Record<string, string | undefined>;

export interface MoreelConfig {
  transcriptionProvider: 'openai';
  transcriptionModel: string;
  openaiApiKey: string | undefined;
  openaiBaseUrl: string;

  visionEnabled: boolean;
  visionProvider: 'openai';
  visionModel: string;
  maxFramesPerVideo: number;
  frameSampleIntervalSeconds: number;
  visionTimeoutMs: number;

  searchEmbeddingsEnabled: boolean;
  searchEmbeddingModel: string;
  searchEmbeddingTimeoutMs: number;

  videoMapEnabled: boolean;
  videoMapModel: string;
  videoMapTimeoutMs: number;
  videoMapMaxWindows: number;

  maxVideoSizeBytes: number;
  maxVideoDurationSeconds: number;

  requestTimeoutMs: number;
  downloadTimeoutMs: number;
  transcriptionTimeoutMs: number;

  maxConcurrentRequests: number;

  cacheEnabled: boolean;
  cacheTtlMs: number;
  cacheMaxEntries: number;

  ytDlpPath: string;
  ffmpegPath: string;

  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

  tempDir: string | undefined;

  httpPort: number;
  httpHost: string;
  shutdownTimeoutMs: number;
  corsOrigin: string;

  instagramMaxConcurrency: number;
  instagramRequestsPerSecond: number;
  instagramCooldownMs: number;
  instagramMaxRetries: number;
  instagramCircuitFailureThreshold: number;
  instagramDisabled: boolean;

  tiktokMaxConcurrency: number;
  tiktokRequestsPerSecond: number;
  tiktokCooldownMs: number;
  tiktokMaxRetries: number;
  tiktokCircuitFailureThreshold: number;
  tiktokDisabled: boolean;

  youtubeMaxConcurrency: number;
  youtubeRequestsPerSecond: number;
  youtubeCooldownMs: number;
  youtubeMaxRetries: number;
  youtubeCircuitFailureThreshold: number;
  youtubeDisabled: boolean;

  redisUrl: string | undefined;
  rateLimitAnonymousRpm: number;
  rateLimitFreeRpm: number;

  databaseUrl: string | undefined;
  dbPoolMax: number;

  otelExporterOtlpEndpoint: string | undefined;
  otelServiceName: string;
  sentryDsn: string | undefined;

  transcriptTtlMs: number;
  mediaTtlMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Env = process.env): MoreelConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  const data = parsed.data;

  return {
    transcriptionProvider: data.TRANSCRIPTION_PROVIDER,
    transcriptionModel: data.TRANSCRIPTION_MODEL,
    openaiApiKey: data.OPENAI_API_KEY,
    openaiBaseUrl: data.OPENAI_BASE_URL,

    visionEnabled: data.VISION_ENABLED,
    visionProvider: data.VISION_PROVIDER,
    visionModel: data.VISION_MODEL,
    maxFramesPerVideo: data.MAX_FRAMES_PER_VIDEO,
    frameSampleIntervalSeconds: data.FRAME_SAMPLE_INTERVAL_SECONDS,
    visionTimeoutMs: data.VISION_TIMEOUT_SECONDS * 1000,

    searchEmbeddingsEnabled: data.SEARCH_EMBEDDINGS_ENABLED,
    searchEmbeddingModel: data.SEARCH_EMBEDDING_MODEL,
    searchEmbeddingTimeoutMs: data.SEARCH_EMBEDDING_TIMEOUT_SECONDS * 1000,

    videoMapEnabled: data.VIDEO_MAP_ENABLED,
    videoMapModel: data.VIDEO_MAP_MODEL,
    videoMapTimeoutMs: data.VIDEO_MAP_TIMEOUT_SECONDS * 1000,
    videoMapMaxWindows: data.VIDEO_MAP_MAX_WINDOWS,

    maxVideoSizeBytes: data.MAX_VIDEO_SIZE_MB * 1024 * 1024,
    maxVideoDurationSeconds: data.MAX_VIDEO_DURATION_SECONDS,

    requestTimeoutMs: data.REQUEST_TIMEOUT_SECONDS * 1000,
    downloadTimeoutMs: data.DOWNLOAD_TIMEOUT_SECONDS * 1000,
    transcriptionTimeoutMs: data.TRANSCRIPTION_TIMEOUT_SECONDS * 1000,

    maxConcurrentRequests: data.MAX_CONCURRENT_REQUESTS,

    cacheEnabled: data.CACHE_ENABLED,
    cacheTtlMs: data.CACHE_TTL_SECONDS * 1000,
    cacheMaxEntries: data.CACHE_MAX_ENTRIES,

    ytDlpPath: data.YTDLP_PATH,
    ffmpegPath: data.FFMPEG_PATH,

    logLevel: data.LOG_LEVEL,

    tempDir: data.TEMP_DIR,

    httpPort: data.HTTP_PORT,
    httpHost: data.HTTP_HOST,
    shutdownTimeoutMs: data.SHUTDOWN_TIMEOUT_SECONDS * 1000,
    corsOrigin: data.CORS_ORIGIN,

    instagramMaxConcurrency: data.INSTAGRAM_MAX_CONCURRENCY,
    instagramRequestsPerSecond: data.INSTAGRAM_REQUESTS_PER_SECOND,
    instagramCooldownMs: data.INSTAGRAM_COOLDOWN_SECONDS * 1000,
    instagramMaxRetries: data.INSTAGRAM_MAX_RETRIES,
    instagramCircuitFailureThreshold: data.INSTAGRAM_CIRCUIT_FAILURE_THRESHOLD,
    instagramDisabled: data.INSTAGRAM_DISABLED,

    tiktokMaxConcurrency: data.TIKTOK_MAX_CONCURRENCY,
    tiktokRequestsPerSecond: data.TIKTOK_REQUESTS_PER_SECOND,
    tiktokCooldownMs: data.TIKTOK_COOLDOWN_SECONDS * 1000,
    tiktokMaxRetries: data.TIKTOK_MAX_RETRIES,
    tiktokCircuitFailureThreshold: data.TIKTOK_CIRCUIT_FAILURE_THRESHOLD,
    tiktokDisabled: data.TIKTOK_DISABLED,

    youtubeMaxConcurrency: data.YOUTUBE_MAX_CONCURRENCY,
    youtubeRequestsPerSecond: data.YOUTUBE_REQUESTS_PER_SECOND,
    youtubeCooldownMs: data.YOUTUBE_COOLDOWN_SECONDS * 1000,
    youtubeMaxRetries: data.YOUTUBE_MAX_RETRIES,
    youtubeCircuitFailureThreshold: data.YOUTUBE_CIRCUIT_FAILURE_THRESHOLD,
    youtubeDisabled: data.YOUTUBE_DISABLED,

    redisUrl: data.REDIS_URL,
    rateLimitAnonymousRpm: data.RATE_LIMIT_ANONYMOUS_RPM,
    rateLimitFreeRpm: data.RATE_LIMIT_FREE_RPM,

    databaseUrl: data.DATABASE_URL,
    dbPoolMax: data.DB_POOL_MAX,

    otelExporterOtlpEndpoint: data.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: data.OTEL_SERVICE_NAME,
    sentryDsn: data.SENTRY_DSN,
    transcriptTtlMs: data.TRANSCRIPT_TTL_SECONDS * 1000,
    mediaTtlMs: data.MEDIA_TTL_SECONDS * 1000,
  };
}
