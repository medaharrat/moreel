# Service Level Objectives

Initial targets, not yet measured against real production traffic (none
exists yet). Revisit once there's a few weeks of real data — these are
starting hypotheses, not measured commitments.

## Availability

**Target: 99.5%** for Moreel's own availability — `/health` responding,
the app process itself up. Measured independently of third-party provider
uptime (see below).

## Success rate

**Target: ≥99% of requests succeed, excluding third-party provider
failures.** A request that fails because Instagram returned a genuine 404
for deleted content, or because Instagram is rate-limiting/blocking, is
not counted against this target — that's tracked separately (below) as
provider-induced failure, not a Moreel defect.

## Latency

**Target: p95 < 10 seconds for a normal short-form video** (well within
`MAX_VIDEO_DURATION_SECONDS`). This is dominated by the transcription
provider's own inference time (see the transcription-service.ts speed
investigation in the git history — OpenAI's Whisper API latency varies
several seconds run-to-run and is the largest, least controllable
component), not Moreel's own orchestration overhead, which the load test
(`docs/load-testing.md`) shows is a small fraction of total latency.

## Provider-induced failures — tracked, not blamed on Moreel

Moreel does not control Instagram's or OpenAI's availability. Report these
**separately** from Moreel's own SLOs:
- `provider_failures_total`, `provider_rate_limits_total`,
  `provider_block_events_total` (per `docs/architecture.md`'s Prometheus
  metrics) — these measure the *provider's* behavior, not a Moreel defect.
- A circuit breaker OPEN state is Moreel working correctly (reducing
  traffic to a struggling provider), not an SLO violation.

Pretending third-party availability is entirely under Moreel's control
would be dishonest reporting — the whole point of separating these
numbers is to distinguish "Moreel is broken" from "Instagram/OpenAI is
having a bad day and Moreel correctly backed off."

## What's NOT yet instrumented to actually measure these

Prometheus metrics exist (`GET /metrics`) but there is no dashboard/
alerting stack deployed yet to compute rolling SLO compliance against
these targets automatically — direct metric queries are enough for now
rather than standing up new dashboard infrastructure prematurely. Treat
these as documented intent to measure against once real traffic and a
metrics backend exist, not as currently-enforced gates.
