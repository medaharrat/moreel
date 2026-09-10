import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { AppLifecycle } from '../../../src/http/lifecycle.js';
import { registerHealthRoutes } from '../../../src/http/routes/health.js';

describe('health routes', () => {
  it('/health always reports ok regardless of lifecycle phase', async () => {
    const app = Fastify();
    const lifecycle = new AppLifecycle();
    registerHealthRoutes(app, lifecycle);

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('/ready returns 503 before markReady() is called', async () => {
    const app = Fastify();
    const lifecycle = new AppLifecycle();
    registerHealthRoutes(app, lifecycle);

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', phase: 'starting' });
  });

  it('/ready returns 200 once markReady() is called', async () => {
    const app = Fastify();
    const lifecycle = new AppLifecycle();
    registerHealthRoutes(app, lifecycle);
    lifecycle.markReady();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', phase: 'ready' });
  });

  it('/ready returns 503 again once draining', async () => {
    const app = Fastify();
    const lifecycle = new AppLifecycle();
    registerHealthRoutes(app, lifecycle);
    lifecycle.markReady();
    lifecycle.markDraining();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', phase: 'draining' });
  });
});
