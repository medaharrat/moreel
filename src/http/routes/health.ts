import type { FastifyInstance } from 'fastify';
import type { AppLifecycle } from '../lifecycle.js';

/** A core-infra dependency check for `/ready` (Redis, Postgres — never Instagram/OpenAI). */
export type RedisHealthCheck = () => Promise<boolean>;
export type DbHealthCheck = () => Promise<boolean>;

/**
 * `/health` = process health: is the event loop alive and able to respond
 * at all. It never looks at Instagram, the transcription provider, or any
 * other external dependency — a third-party outage must not make the
 * platform kill/restart otherwise-healthy replicas.
 *
 * `/ready` = application readiness: has startup finished, is this replica
 * still accepting new work (not mid-shutdown), and are the pieces of *core*
 * infrastructure the app cannot function without (Redis and Postgres, once
 * configured) reachable. Deliberately does not reflect
 * transient concurrency saturation (429s handle that) or third-party
 * provider health (Instagram/OpenAI outages are expected and handled by
 * the circuit breaker, not by pulling replicas out of rotation).
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  lifecycle: AppLifecycle,
  dependencyChecks: { redis?: RedisHealthCheck; db?: DbHealthCheck } = {},
): void {
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/ready', async (_request, reply) => {
    const phase = lifecycle.getPhase();
    if (!lifecycle.isAcceptingWork()) {
      reply.code(503);
      return { status: 'not_ready', phase };
    }

    if (dependencyChecks.redis) {
      const redisHealthy = await dependencyChecks.redis();
      if (!redisHealthy) {
        reply.code(503);
        return { status: 'not_ready', phase, dependency: 'redis' };
      }
    }

    if (dependencyChecks.db) {
      const dbHealthy = await dependencyChecks.db();
      if (!dbHealthy) {
        reply.code(503);
        return { status: 'not_ready', phase, dependency: 'database' };
      }
    }

    return { status: 'ready', phase };
  });
}
