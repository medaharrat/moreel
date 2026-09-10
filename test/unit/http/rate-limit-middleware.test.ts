import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerRateLimitMiddleware, resolveAnonymousCaller } from '../../../src/http/middleware/rate-limit.js';
import { InMemoryRateLimiter } from '../../../src/ratelimit/in-memory-rate-limiter.js';

describe('rate-limit middleware', () => {
  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    const app = Fastify();
    app.get('/thing', async () => ({ ok: true }));
    registerRateLimitMiddleware(app, {
      limiter: new InMemoryRateLimiter(),
      resolveCaller: resolveAnonymousCaller,
      limitForTier: () => 1,
    });

    const first = await app.inject({ method: 'GET', url: '/thing' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('1');

    const second = await app.inject({ method: 'GET', url: '/thing' });
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
    expect(second.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('exempts /health and /ready from rate limiting', async () => {
    const app = Fastify();
    app.get('/health', async () => ({ status: 'ok' }));
    registerRateLimitMiddleware(app, {
      limiter: new InMemoryRateLimiter(),
      resolveCaller: resolveAnonymousCaller,
      limitForTier: () => 1,
    });

    for (let i = 0; i < 5; i++) {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    }
  });
});
