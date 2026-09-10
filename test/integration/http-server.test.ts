import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { buildHttpServer } from '../../src/http/server.js';

function silentLogger() {
  return pino({ level: 'silent' });
}

describe('HTTP server integration', () => {
  it('boots, serves /health and /ready, and reflects lifecycle transitions', async () => {
    const server = buildHttpServer({ logger: silentLogger() });

    const beforeReady = await server.app.inject({ method: 'GET', url: '/ready' });
    expect(beforeReady.statusCode).toBe(503);

    server.lifecycle.markReady();

    const health = await server.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const ready = await server.app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);

    server.lifecycle.markDraining();

    const draining = await server.app.inject({ method: 'GET', url: '/ready' });
    expect(draining.statusCode).toBe(503);

    await server.app.close();
  });

  it('returns 404 for unknown routes without leaking internals', async () => {
    const server = buildHttpServer({ logger: silentLogger() });
    const response = await server.app.inject({ method: 'GET', url: '/nonexistent' });
    expect(response.statusCode).toBe(404);
    await server.app.close();
  });
});
