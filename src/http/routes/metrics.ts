import type { FastifyInstance } from 'fastify';
import { promRegistry } from '../../observability/prom-metrics.js';

export function registerMetricsRoute(app: FastifyInstance): void {
  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', promRegistry.contentType);
    return promRegistry.metrics();
  });
}
