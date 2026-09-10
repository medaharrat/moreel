/**
 * Loaded via `node --import ./dist/observability/tracing-bootstrap.js`
 * (see package.json's `start:http`), i.e. before the real entrypoint's
 * module graph loads at all. A decision point deliberately left to the
 * operator, not assumed: without `OTEL_EXPORTER_OTLP_ENDPOINT` set, this
 * is a no-op — no tracing backend is assumed to exist.
 */
import { startTracing } from './tracing.js';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  startTracing({
    otlpEndpoint: endpoint,
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'moreel',
    serviceVersion: process.env.npm_package_version ?? '0.0.0',
  });
}
