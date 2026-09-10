# Load testing

`npm run load-test [concurrency...]` (default: `10 50 100`) drives the real
`TranscriptionService` at increasing concurrency, wired to fake provider/
audio/transcriber implementations (the same fakes the test suite uses,
`test/helpers/service-fakes.ts`).

**This deliberately never hits real Instagram or OpenAI**, at any
concurrency level — doing so would cost real money per request, risk
tripping Instagram's actual rate limits/blocking on a shared IP, and would
measure their latency instead of Moreel's own orchestration overhead
(validation, concurrency gating, caching, normalization), which is what
this test is actually for.

## What it measures

At each concurrency level, it fires `concurrency × 5` requests at once and
reports:

- **Success rate** — completed through the full (fake) pipeline.
- **Backpressure rejection rate** — requests rejected fast with
  `RATE_LIMITED` by the concurrency gate (`src/util/semaphore.ts`) because
  offered load exceeded `concurrency`. This is **by design**, not a
  failure: the semaphore fails fast rather than queuing unboundedly, so a
  traffic spike degrades predictably instead of building an unbounded
  queue. Since offered load is intentionally 5x the gate here, a stable
  ~80% backpressure rate at a given concurrency is the *expected*, correct
  result — it confirms the gate holds at exactly its configured limit.
- **Unexpected error rate** — anything else (the fake provider injects a
  ~2% random transient failure to keep this nonzero and observable).
- **Throughput, p50/p95/p99 latency, CPU, memory.**

## The per-replica concurrency ceiling

`MAX_CONCURRENT_REQUESTS` is capped at 64 in the config schema
(`src/config/index.ts`) — a deliberate cost-control ceiling, not an
arbitrary limit. Requesting a concurrency level
above that against a single instance isn't a valid test: 100 concurrent
transcriptions is a multi-replica scaling scenario (add a second instance),
not something one process should attempt. The script caps at 64 and warns
when asked to go higher.

## Provider-degradation scenario

The "Instagram starts failing → circuit breaker opens → traffic reduces →
requests fail gracefully" scenario from the spec is covered by
`test/failure/provider-failures.test.ts`'s `CircuitBreaker`/`ProtectedProvider`
tests, not this script — it's a correctness property (does the breaker
actually stop calling a failing provider) better verified deterministically
in a fast unit test than reproduced under load.

## When to run this

Before a major release or after a change to the concurrency/caching/
semaphore code path — not on every PR (it's not wired into CI; a flaky
timing-based load test gating merges causes more noise than it prevents).
