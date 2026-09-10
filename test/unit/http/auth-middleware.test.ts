import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerAuthMiddleware } from '../../../src/http/middleware/auth.js';
import type { AuthRepository } from '../../../src/auth/repository.js';

function fakeRepository(
  authenticate: AuthRepository['authenticate'],
): AuthRepository {
  return { authenticate } as unknown as AuthRepository;
}

describe('auth middleware', () => {
  it('rejects with 401 when no Authorization header is present', async () => {
    const app = Fastify();
    app.get('/thing', async () => ({ ok: true }));
    registerAuthMiddleware(app, { repository: fakeRepository(vi.fn()) });

    const response = await app.inject({ method: 'GET', url: '/thing' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
  });

  it('rejects with 401 for an invalid secret', async () => {
    const app = Fastify();
    app.get('/thing', async () => ({ ok: true }));
    registerAuthMiddleware(app, {
      repository: fakeRepository(async () => undefined),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/thing',
      headers: { authorization: 'Bearer moreel_live_bad' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('attaches request.account and proceeds for a valid secret', async () => {
    const app = Fastify();
    app.get('/thing', async (request) => ({ accountId: request.account?.id }));
    registerAuthMiddleware(app, {
      repository: fakeRepository(async () => ({
        keyId: 1,
        account: { id: 42, email: 'a@b.com' },
        scopes: [],
      })),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/thing',
      headers: { authorization: 'Bearer moreel_live_good' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accountId: 42 });
  });

  it('exempts /health from auth', async () => {
    const app = Fastify();
    app.get('/health', async () => ({ status: 'ok' }));
    registerAuthMiddleware(app, { repository: fakeRepository(vi.fn()) });

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});
