import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export interface TracingOptions {
  otlpEndpoint: string;
  serviceName: string;
  serviceVersion: string;
}

/**
 * Starts the OpenTelemetry SDK. Must run before any other module in the
 * process is imported — Node's auto-instrumentation patches modules
 * (`http`, `pg`, `ioredis`, ...) at `require`/import time, so starting
 * this from inside `main()` would miss anything already loaded by then.
 * That's why this only ever runs from `tracing-bootstrap.ts`, invoked via
 * `node --import` ahead of the real entrypoint — see package.json's
 * `start:http` script and docs/deployment.md.
 *
 * No raw user content (URLs, transcripts) is ever added as a span
 * attribute — spans carry operation names/timings/status only.
 */
export function startTracing(options: TracingOptions): NodeSDK {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
    }),
    // OTLP-over-HTTP's own convention is `<endpoint>/v1/traces` — the SDK
    // only appends that path itself when it reads `OTEL_EXPORTER_OTLP_ENDPOINT`
    // straight from the environment; passing `url` explicitly (as here, to
    // keep `otlpEndpoint` an explicit, testable parameter) is used verbatim,
    // so it has to be appended by hand or every export 404s against the
    // collector's root path.
    traceExporter: new OTLPTraceExporter({ url: `${options.otlpEndpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  return sdk;
}
