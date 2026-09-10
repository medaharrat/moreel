import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

export function registerTranscriptRoutes(app: FastifyInstance, redis?: Redis) {
  if (!redis) {
    app.get('/transcripts/:id', async (_request, reply) => {
      reply.code(404);
      return { error: 'transcript storage not configured' };
    });
    return;
  }

  app.get<{ Params: { id: string } }>('/transcripts/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const raw = await redis.get(`transcript:${id}`);
      if (!raw) return reply.code(404).send({ error: 'not found' });
      const parsed = JSON.parse(raw);
      return reply.send(parsed);
    } catch (e) {
      request.log.error({ err: e }, 'failed to read transcript from redis');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}

export default registerTranscriptRoutes;
