#!/usr/bin/env node
/**
 * Load test for the transcription pipeline at 10/50/100 concurrency, run
 * against the real `TranscriptionService` wired to fake provider/audio/
 * transcriber implementations (same fakes as the test suite,
 * test/helpers/service-fakes.ts) — this measures Moreel's own
 * orchestration overhead (validation, caching, concurrency gating,
 * normalization) under load, not Instagram's or OpenAI's latency.
 *
 * Deliberately does NOT hit real Instagram or OpenAI at any concurrency:
 * that would cost real money, risk real rate-limiting/blocking on a
 * third-party platform, and measure their latency instead of ours.
 *
 * Usage: npx tsx scripts/load-test.ts [concurrency...]
 * Default: 10 50 100
 */
import { randomUUID } from 'node:crypto';
import {
  FakeInstagramProvider,
  buildTranscriptionService,
} from '../test/helpers/service-fakes.js';

/** Per-replica hard ceiling enforced by src/config/index.ts's MAX_CONCURRENT_REQUESTS schema — a deliberate cost-control cap, not a bug. Testing beyond it is a multi-replica scenario, not a single-instance load test. */
const MAX_CONCURRENT_REQUESTS_CEILING = 64;

interface RunResult {
  concurrency: number;
  totalRequests: number;
  durationMs: number;
  throughputRps: number;
  /** Requests that succeeded through the full fake pipeline. */
  successRate: number;
  /** Fail-fast RATE_LIMITED rejections from the semaphore once offered load exceeds `concurrency` — by design (src/util/semaphore.ts fails fast rather than queuing unboundedly), not a defect. */
  backpressureRejectionRate: number;
  /** Everything else — a real pipeline failure, not expected backpressure. */
  unexpectedErrorRate: number;
  latenciesMs: { p50: number; p95: number; p99: number };
  cpuUserMs: number;
  memoryRssMb: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function runAtConcurrency(concurrency: number): Promise<RunResult> {
  // A slow, sometimes-failing fake — simulates realistic pipeline latency
  // and a nonzero baseline error rate without any network dependency.
  const provider = new FakeInstagramProvider(async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30));
    if (Math.random() < 0.02) throw new Error('simulated transient failure');
    return {
      filePath: '/tmp/fake-video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 12_345,
      durationSeconds: 30,
      source: 'instagram',
      sourceUrl: url.toString(),
    };
  });

  const effectiveConcurrency = Math.min(concurrency, MAX_CONCURRENT_REQUESTS_CEILING);
  if (effectiveConcurrency !== concurrency) {
    console.warn(
      `  [note] requested concurrency ${concurrency} exceeds the per-replica ceiling ` +
        `(MAX_CONCURRENT_REQUESTS max=${MAX_CONCURRENT_REQUESTS_CEILING}); testing at ` +
        `${effectiveConcurrency} instead. Testing higher offered load against one instance is ` +
        `expected to produce backpressure rejections by design — see docs/architecture.md.`,
    );
  }

  const { service } = buildTranscriptionService({
    provider,
    cacheEnabled: false, // load-testing the pipeline, not the cache
    maxConcurrentRequests: effectiveConcurrency,
  });

  // Offered load intentionally exceeds the concurrency gate (5x) so the
  // run also exercises the fail-fast backpressure path, not just the
  // happy path at exactly-capacity.
  const totalRequests = concurrency * 5;
  const latencies: number[] = [];
  let successes = 0;
  let backpressureRejections = 0;
  let unexpectedErrors = 0;

  const cpuBefore = process.cpuUsage();
  const start = performance.now();

  const tasks = Array.from({ length: totalRequests }, async (_, i) => {
    const requestStart = performance.now();
    try {
      await service.transcribeVideo({
        url: `https://www.instagram.com/reel/loadtest-${i}/`,
        requestId: randomUUID(),
        signal: new AbortController().signal,
      });
      successes++;
    } catch (error) {
      if (error instanceof Error && error.name === 'MoreelError' && 'code' in error && error.code === 'RATE_LIMITED') {
        backpressureRejections++;
      } else {
        unexpectedErrors++;
      }
    } finally {
      latencies.push(performance.now() - requestStart);
    }
  });

  await Promise.all(tasks);

  const durationMs = performance.now() - start;
  const cpuAfter = process.cpuUsage(cpuBefore);
  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    concurrency: effectiveConcurrency,
    totalRequests,
    durationMs,
    throughputRps: totalRequests / (durationMs / 1000),
    successRate: successes / totalRequests,
    backpressureRejectionRate: backpressureRejections / totalRequests,
    unexpectedErrorRate: unexpectedErrors / totalRequests,
    latenciesMs: {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    },
    cpuUserMs: cpuAfter.user / 1000,
    memoryRssMb: process.memoryUsage().rss / 1024 / 1024,
  };
}

async function main(): Promise<void> {
  const levels = process.argv.slice(2).map(Number);
  const concurrencyLevels = levels.length > 0 ? levels : [10, 50, 100];

  for (const concurrency of concurrencyLevels) {
    const result = await runAtConcurrency(concurrency);
    console.log(`\nConcurrency ${result.concurrency}:`);
    console.log(`  requests:      ${result.totalRequests}`);
    console.log(`  duration:      ${result.durationMs.toFixed(0)}ms`);
    console.log(`  throughput:    ${result.throughputRps.toFixed(1)} req/s`);
    console.log(`  success rate:  ${(result.successRate * 100).toFixed(1)}%`);
    console.log(
      `  backpressure (by design, offered load > concurrency): ${(result.backpressureRejectionRate * 100).toFixed(1)}%`,
    );
    console.log(`  unexpected errors: ${(result.unexpectedErrorRate * 100).toFixed(1)}%`);
    console.log(
      `  latency p50/p95/p99: ${result.latenciesMs.p50.toFixed(0)}/${result.latenciesMs.p95.toFixed(0)}/${result.latenciesMs.p99.toFixed(0)}ms`,
    );
    console.log(`  cpu (user):    ${result.cpuUserMs.toFixed(0)}ms`);
    console.log(`  memory (rss):  ${result.memoryRssMb.toFixed(1)}MB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
