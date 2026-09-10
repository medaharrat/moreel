import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

/**
 * Prometheus-compatible metrics, exposed at `GET /metrics`. Deliberately
 * separate from `src/observability/metrics.ts` (the flat in-process
 * counter map used internally since v0.1) rather than a wholesale
 * replacement — that module still powers `npm run benchmark`'s ad-hoc
 * snapshots, and migrating every call site was out of scope for adding
 * Prometheus export. This registry is fed by explicit `record*()` calls
 * from the same places that already call into `globalMetrics`.
 *
 * No metric here is labeled by raw customer/account ID — that's an
 * unbounded-cardinality trap for a Prometheus label set. Per-customer
 * detail belongs in a direct Postgres query, not a label.
 */
export const promRegistry = new Registry();
collectDefaultMetrics({ register: promRegistry });

export const requestsTotal = new Counter({
  name: 'requests_total',
  help: 'Total HTTP requests received',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [promRegistry],
});

export const requestsActive = new Gauge({
  name: 'requests_active',
  help: 'Requests currently in flight',
  registers: [promRegistry],
});

export const mcpToolCallsTotal = new Counter({
  name: 'mcp_tool_calls_total',
  help: 'Total MCP tool invocations',
  labelNames: ['tool', 'outcome'] as const,
  registers: [promRegistry],
});

export const mcpToolLatency = new Histogram({
  name: 'mcp_tool_latency_ms',
  help: 'MCP tool call latency in milliseconds',
  labelNames: ['tool'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000],
  registers: [promRegistry],
});

export const providerRequestsTotal = new Counter({
  name: 'provider_requests_total',
  help: 'Total provider fetch attempts',
  labelNames: ['provider', 'classification'] as const,
  registers: [promRegistry],
});

export const providerLatency = new Histogram({
  name: 'provider_latency_ms',
  help: 'Provider fetch latency in milliseconds',
  labelNames: ['provider'] as const,
  buckets: [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000],
  registers: [promRegistry],
});

export const providerCircuitBreakerState = new Counter({
  name: 'provider_circuit_breaker_transitions_total',
  help: 'Circuit breaker state transitions',
  labelNames: ['provider', 'to_state'] as const,
  registers: [promRegistry],
});

export const transcriptionsTotal = new Counter({
  name: 'transcriptions_total',
  help: 'Total transcription attempts',
  labelNames: ['outcome', 'model'] as const,
  registers: [promRegistry],
});

export const transcriptionLatency = new Histogram({
  name: 'transcription_latency_ms',
  help: 'Transcription call latency in milliseconds',
  labelNames: ['model'] as const,
  buckets: [500, 1000, 2500, 5000, 10_000, 20_000, 45_000],
  registers: [promRegistry],
});

export const minutesProcessedTotal = new Counter({
  name: 'minutes_processed_total',
  help: 'Total minutes of media processed',
  registers: [promRegistry],
});

export const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Cache hits',
  labelNames: ['layer'] as const,
  registers: [promRegistry],
});

export const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Cache misses',
  labelNames: ['layer'] as const,
  registers: [promRegistry],
});

/**
 * COGS — estimated provider cost, in cents, from `estimateTranscriptionCostCents()`.
 * Only incremented when a price is actually known for the provider/model
 * pair; unpriced requests are absent rather than counted as zero-cost.
 */
export const transcriptionCostCents = new Counter({
  name: 'transcription_cost_cents_total',
  help: 'Estimated total transcription provider cost, in cents',
  labelNames: ['provider', 'model'] as const,
  registers: [promRegistry],
});

export const visionsTotal = new Counter({
  name: 'visions_total',
  help: 'Total vision analysis attempts',
  labelNames: ['outcome', 'model'] as const,
  registers: [promRegistry],
});

export const visionLatency = new Histogram({
  name: 'vision_latency_ms',
  help: 'Vision analysis call latency in milliseconds',
  labelNames: ['model'] as const,
  buckets: [500, 1000, 2500, 5000, 10_000, 20_000, 45_000],
  registers: [promRegistry],
});

export const visionObservationsTotal = new Counter({
  name: 'vision_observations_total',
  help: 'Total visual observations returned by the vision pipeline',
  labelNames: ['model'] as const,
  registers: [promRegistry],
});

/** COGS — estimated vision provider cost, in cents, from `estimateVisionCostCents()`. */
export const visionCostCents = new Counter({
  name: 'vision_cost_cents_total',
  help: 'Estimated total vision provider cost, in cents',
  labelNames: ['provider', 'model'] as const,
  registers: [promRegistry],
});
