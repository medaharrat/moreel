#!/usr/bin/env node
import type { Kysely } from 'kysely';
import { buildEmbeddingProvider, buildTranscriptionService, buildVideoInteractionAnalyzer, buildVideoStore } from '../app/build-transcription-service.js';
import { AuthRepository } from '../auth/repository.js';
import { loadConfig, ConfigError } from '../config/index.js';
import { createDb, pingDb } from '../infra/db.js';
import type { Database } from '../infra/db-schema.js';
import { createRedisClient, pingRedis } from '../infra/redis.js';
import type { Redis } from 'ioredis';
import { captureException, initErrorTracking } from '../observability/error-tracking.js';
import { createLogger } from '../observability/logger.js';
import { InMemoryRateLimiter } from '../ratelimit/in-memory-rate-limiter.js';
import { RedisRateLimiter } from '../ratelimit/redis-rate-limiter.js';
import type { RateLimiter } from '../ratelimit/rate-limiter.js';
import { buildHttpServer } from './server.js';
import { registerGracefulShutdown } from './shutdown.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`moreel: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config);
  initErrorTracking(config.sentryDsn);

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    captureException(error, { environment: process.env.NODE_ENV ?? 'development' });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    captureException(reason, { environment: process.env.NODE_ENV ?? 'development' });
    process.exit(1);
  });

  let rateLimiter: RateLimiter;
  let redisHealthCheck: (() => Promise<boolean>) | undefined;
  let redisClient: Redis | undefined;

  if (config.redisUrl) {
    const redis = createRedisClient({ url: config.redisUrl });
    rateLimiter = new RedisRateLimiter(redis);
    redisHealthCheck = () => pingRedis(redis);
    redisClient = redis;
  } else {
    logger.warn(
      'REDIS_URL not set — using in-memory rate limiting, only correct at one replica',
    );
    rateLimiter = new InMemoryRateLimiter();
  }

  let authRepository: AuthRepository | undefined;
  let dbHealthCheck: (() => Promise<boolean>) | undefined;
  let db: Kysely<Database> | undefined;

  if (config.databaseUrl) {
    db = createDb({ connectionString: config.databaseUrl, poolMax: config.dbPoolMax });
    authRepository = new AuthRepository(db);
    dbHealthCheck = () => pingDb(db!);
  } else {
    logger.warn('DATABASE_URL not set — running without authentication');
  }

  const videoStore = buildVideoStore(config, db);
  const embeddingProvider = buildEmbeddingProvider(config);
  const videoInteractionAnalyzer = buildVideoInteractionAnalyzer(config);
  const transcriptionService = buildTranscriptionService(config, logger, {
    videoStore,
    ...(embeddingProvider ? { embeddingProvider } : {}),
    ...(videoInteractionAnalyzer ? { videoInteractionAnalyzer } : {}),
  });

  const server = buildHttpServer({
    logger,
    config,
    rateLimiter,
    transcriptionService,
    videoStore,
    ...(embeddingProvider ? { embeddingProvider } : {}),
    ...(redisHealthCheck ? { redisHealthCheck } : {}),
    ...(dbHealthCheck ? { dbHealthCheck } : {}),
    ...(authRepository ? { authRepository } : {}),
    ...(redisClient ? { redisClient } : {}),
  });

  registerGracefulShutdown({
    server,
    logger,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
  });

  await server.app.listen({ port: config.httpPort, host: config.httpHost });
  server.lifecycle.markReady();
  logger.info({ port: config.httpPort, host: config.httpHost }, 'moreel HTTP server started');
}

main().catch((error) => {
  process.stderr.write(`moreel: fatal error during startup: ${(error as Error).message}\n`);
  process.exit(1);
});
