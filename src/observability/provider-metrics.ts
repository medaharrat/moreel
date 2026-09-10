import type { ProviderClassification } from '../providers/protection/response-classifier.js';
import type { Metrics } from './metrics.js';
import { providerLatency, providerRequestsTotal } from './prom-metrics.js';

/**
 * Consistent naming for the provider metrics the spec requires
 * (`provider_requests_total`, `provider_success_total`, etc). Feeds both
 * the flat in-process `Metrics` map (`src/observability/metrics.ts`,
 * powers `npm run benchmark`) and the labeled Prometheus registry
 * (`src/observability/prom-metrics.ts`, powers `GET /metrics`) from one
 * call site so nothing downstream has to remember to update both.
 */
export function recordProviderOutcome(
  metrics: Metrics,
  providerId: string,
  classification: ProviderClassification,
  latencyMs: number,
): void {
  metrics.increment('provider_requests_total');
  metrics.increment(`provider_requests_total:${providerId}`);
  metrics.observeLatency('provider_latency', latencyMs);
  metrics.observeLatency(`provider_latency:${providerId}`, latencyMs);

  providerRequestsTotal.inc({ provider: providerId, classification });
  providerLatency.observe({ provider: providerId }, latencyMs);

  if (classification === 'success') {
    metrics.increment('provider_success_total');
    metrics.increment(`provider_success_total:${providerId}`);
    return;
  }

  metrics.increment('provider_failures_total');
  metrics.increment(`provider_failures_total:${providerId}`);

  if (classification === 'rate_limited') {
    metrics.increment('provider_rate_limits_total');
    metrics.increment(`provider_rate_limits_total:${providerId}`);
  } else if (classification === 'auth_required') {
    metrics.increment('provider_auth_failures_total');
    metrics.increment(`provider_auth_failures_total:${providerId}`);
  } else if (classification === 'blocked') {
    metrics.increment('provider_block_events_total');
    metrics.increment(`provider_block_events_total:${providerId}`);
  }
}
