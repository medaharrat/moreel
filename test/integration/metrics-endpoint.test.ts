import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { buildHttpServer } from '../../src/http/server.js';
import { requestsTotal } from '../../src/observability/prom-metrics.js';

describe('metrics endpoint', () => {
  it('exposes Prometheus-formatted metrics without auth or rate limiting', async () => {
    requestsTotal.inc({ method: 'GET', route: '/test', status: '200' });

    const server = buildHttpServer({ logger: pino({ level: 'silent' }) });
    const response = await server.app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('requests_total');
    expect(response.body).toContain('# HELP');

    await server.app.close();
  });
});
