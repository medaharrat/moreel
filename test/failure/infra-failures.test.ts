import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAuthMiddleware } from '../../src/http/middleware/auth.js';
import { registerRateLimitMiddleware, resolveAnonymousCaller } from '../../src/http/middleware/rate-limit.js';
import type { AuthRepository } from '../../src/auth/repository.js';
import type { RateLimiter } from '../../src/ratelimit/rate-limiter.js';

describe('failure: Redis unavailable', () => {
  it('rate limiting fails open (request proceeds) instead of 500ing every request', async () => {
    const app = Fastify();
    app.get('/thing', async () => ({ ok: true }));

    const brokenLimiter: RateLimiter = {
      checkLimit: async () => {
        throw new Error('connect ECONNREFUSED redis:6379');
      },
    };

    registerRateLimitMiddleware(app, {
      limiter: brokenLimiter,
      resolveCaller: resolveAnonymousCaller,
      limitForTier: () => 5,
    });

    const response = await app.inject({ method: 'GET', url: '/thing' });
    expect(response.statusCode).toBe(200);
  });
});

describe('failure: Postgres unavailable', () => {
  it('auth fails closed (rejects) rather than silently letting requests through unauthenticated', async () => {
    const app = Fastify();
    app.get('/thing', async () => ({ ok: true }));
    app.setErrorHandler((_error, _request, reply) => {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } });
    });

    const brokenRepository = {
      authenticate: async () => {
        throw new Error('connect ECONNREFUSED postgres:5432');
      },
    } as unknown as AuthRepository;

    registerAuthMiddleware(app, { repository: brokenRepository });

    const response = await app.inject({
      method: 'GET',
      url: '/thing',
      headers: { authorization: 'Bearer moreel_live_something' },
    });

    // Never 200 — a DB outage during auth must not be treated as "let it through."
    expect(response.statusCode).not.toBe(200);
  });
});
