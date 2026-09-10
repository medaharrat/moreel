import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import type { TranscriptionService } from '../app/transcription-service.js';
import type { VideoStore } from '../app/video-store.js';
import type { AuthRepository } from '../auth/repository.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import type { Redis } from 'ioredis';
import type { MoreelConfig } from '../config/index.js';
import { MediaStore } from '../media/media-store.js';
import { captureException } from '../observability/error-tracking.js';
import { requestsActive, requestsTotal } from '../observability/prom-metrics.js';
import { InMemoryRateLimiter } from '../ratelimit/in-memory-rate-limiter.js';
import type { RateLimiter } from '../ratelimit/rate-limiter.js';
import { resolveTierLimit } from '../ratelimit/tiers.js';
import { AppLifecycle } from './lifecycle.js';
import { registerAuthMiddleware } from './middleware/auth.js';
import {
  registerRateLimitMiddleware,
  resolveAccountOrIpCaller,
  resolveAnonymousCaller,
} from './middleware/rate-limit.js';
import type { RedisHealthCheck } from './routes/health.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMediaRoute } from './routes/media.js';
import { registerMetricsRoute } from './routes/metrics.js';
import { registerPrivacyRoutes } from './routes/privacy.js';
import { registerTranscribeRoute } from './routes/transcribe.js';
import { registerTranscriptRoutes } from './routes/transcripts.js';
import { registerVideosRoutes } from './routes/videos.js';

/** Routes reachable from the browser frontend without an API key — still rate-limited by IP. Prefix-matched, so `/media/:id` etc. are covered too. */
const PUBLIC_PATHS = ['/transcribe', '/media', '/transcripts', '/videos'];

export interface BuildHttpServerOptions {
  logger: Logger;
  config?: Pick<
    MoreelConfig,
    | 'rateLimitAnonymousRpm'
    | 'rateLimitFreeRpm'
    | 'corsOrigin'
    | 'requestTimeoutMs'
    | 'mediaTtlMs'
    | 'searchEmbeddingTimeoutMs'
  >;
  /** Defaults to an in-memory limiter (correct at one replica) when omitted. */
  rateLimiter?: RateLimiter;
  redisHealthCheck?: RedisHealthCheck;
  dbHealthCheck?: () => Promise<boolean>;
  /** Enables API-key auth (and account-based rate limiting) when provided; omit to run without auth. */
  authRepository?: AuthRepository;
  /** Enables `POST /transcribe` when provided — the browser frontend's entry point into the pipeline. */
  transcriptionService?: TranscriptionService;
  /** Optional Redis client used for persisted artifacts like transcript re-access URLs */
  redisClient?: Redis;
  /** Enables `GET /videos/:id/{timeline,search,missed}` when provided — must be the same store instance the transcription pipeline writes to. */
  videoStore?: VideoStore;
  /** Powers semantic matching in `GET /videos/:id/search` on top of lexical matching — absent when SEARCH_EMBEDDINGS_ENABLED=false, in which case that route falls back to lexical-only. */
  embeddingProvider?: EmbeddingProvider;
}

const DEFAULT_RATE_LIMIT_CONFIG = {
  rateLimitAnonymousRpm: 5,
  rateLimitFreeRpm: 5,
  corsOrigin: '*',
  requestTimeoutMs: 60_000,
  mediaTtlMs: 600_000,
  searchEmbeddingTimeoutMs: 20_000,
} as const;

export interface HttpServer {
  app: FastifyInstance;
  lifecycle: AppLifecycle;
}

/**
 * Fastify instance factory. This is the HTTP transport into Moreel,
 * separate from and additional to the MCP-over-stdio transport
 * (`src/mcp/server.ts`) — both call into the same application services,
 * but neither depends on the other's process model.
 */
export function buildHttpServer(options: BuildHttpServerOptions): HttpServer {
  const lifecycle = new AppLifecycle();

  const app = Fastify({
    loggerInstance: options.logger as unknown as FastifyInstance['log'],
    genReqId: () => randomUUID(),
  });

  // Route-agnostic request counters (health/media/transcribe/...), fed to
  // Prometheus via GET /metrics below. `routeOptions.url` is the pattern
  // (`/media/:id`), not the resolved path, so this stays bounded-cardinality
  // even under many distinct video IDs.
  app.addHook('onRequest', async () => {
    requestsActive.inc();
  });
  app.addHook('onResponse', async (request, reply) => {
    requestsActive.dec();
    requestsTotal.inc({
      method: request.method,
      route: request.routeOptions?.url ?? 'unknown',
      status: String(reply.statusCode),
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'unhandled request error');
    captureException(error, { requestId: String(request.id) });
    reply.code(error.statusCode ?? 500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', retryable: true },
    });
  });

  const rateLimitConfig = options.config ?? DEFAULT_RATE_LIMIT_CONFIG;

  const corsOrigin = rateLimitConfig.corsOrigin;
  void app.register(cors, {
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((origin) => origin.trim()),
  });

  registerHealthRoutes(app, lifecycle, {
    ...(options.redisHealthCheck ? { redis: options.redisHealthCheck } : {}),
    ...(options.dbHealthCheck ? { db: options.dbHealthCheck } : {}),
  });
  registerMetricsRoute(app);

  if (options.authRepository) {
    registerAuthMiddleware(app, {
      repository: options.authRepository,
      exemptPaths: ['/health', '/ready', '/metrics', ...PUBLIC_PATHS],
    });
  }

  // Holds each request's downloaded video just long enough to stream it
  // back for in-browser playback — see MediaStore's own docs for why this
  // isn't a cache. Only constructed when transcription itself is enabled.
  const mediaStore = options.transcriptionService ? new MediaStore(rateLimitConfig.mediaTtlMs) : undefined;

  if (options.transcriptionService) {
    registerTranscribeRoute(app, options.transcriptionService, rateLimitConfig.requestTimeoutMs, {
      ...(mediaStore ? { mediaStore } : {}),
      ...(options.redisClient ? { redis: options.redisClient } : {}),
    });
  }

  if (mediaStore) {
    registerMediaRoute(app, mediaStore);
  }

  // Transcripts retrieval
  registerTranscriptRoutes(app, options.redisClient);

  if (options.videoStore) {
    registerVideosRoutes(app, options.videoStore, {
      ...(mediaStore ? { mediaStore } : {}),
      ...(options.embeddingProvider ? { embeddingProvider: options.embeddingProvider } : {}),
      embeddingTimeoutMs: rateLimitConfig.searchEmbeddingTimeoutMs,
    });
  }

  // Privacy/DSAR endpoints (require authRepository to operate)
  if (options.authRepository) {
    registerPrivacyRoutes(app, options.authRepository);
  }

  const rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter();
  registerRateLimitMiddleware(app, {
    limiter: rateLimiter,
    resolveCaller: options.authRepository ? resolveAccountOrIpCaller : resolveAnonymousCaller,
    limitForTier: (tier) => resolveTierLimit(rateLimitConfig, tier),
    // /media is exempt: a single video playback session issues many Range
    // requests as the browser buffers/scrubs — nothing like one request
    // per user action, so the normal per-minute budget starves it almost
    // immediately. /transcribe and /transcripts stay limited; they're the
    // expensive, one-request-per-action routes this exists to protect.
    exemptPaths: ['/health', '/ready', '/metrics', '/media'],
  });

  return { app, lifecycle };
}
