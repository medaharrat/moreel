/**
 * Minimal in-process metrics: counters and latency histograms with
 * percentile queries. No external metrics backend for v0.1 — this is
 * enough to power `npm run benchmark` and ad-hoc introspection, and it
 * defines the seam where a real exporter (Prometheus, OTel, ...) would
 * later attach without touching call sites.
 */

export interface MetricsSnapshot {
  counters: Record<string, number>;
  latencies: Record<string, { count: number; p50: number; p95: number; p99: number; avg: number }>;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly latencies = new Map<string, number[]>();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  observeLatency(name: string, milliseconds: number): void {
    const values = this.latencies.get(name);
    if (values) {
      values.push(milliseconds);
    } else {
      this.latencies.set(name, [milliseconds]);
    }
  }

  /** Times an async operation and records it under `name`, regardless of outcome. */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.observeLatency(name, performance.now() - start);
    }
  }

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.counters) {
      counters[key] = value;
    }

    const latencies: MetricsSnapshot['latencies'] = {};
    for (const [key, values] of this.latencies) {
      latencies[key] = summarize(values);
    }

    return { counters, latencies };
  }

  reset(): void {
    this.counters.clear();
    this.latencies.clear();
  }
}

function summarize(values: number[]): {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
} {
  if (values.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    avg,
  };
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(p * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)] ?? 0;
}

/** Process-wide metrics instance for the MCP server. */
export const globalMetrics = new Metrics();
