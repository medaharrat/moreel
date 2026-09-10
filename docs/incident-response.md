# Incident Response

## Severity levels

- **P1 — service unavailable.** `/health` failing across replicas, or the
  app is down entirely. Page immediately, all hands.
- **P2 — major degradation.** Elevated error rate or p95 latency, a core
  dependency (Postgres, Redis) down (auth/rate-limiting degraded per their
  fail-closed/fail-open design — see `docs/security.md` — but the app
  itself still serving some traffic). Respond within the hour.
- **P3 — localized/non-critical.** A single feature degraded (e.g.
  Instagram circuit breaker open — expected, self-healing behavior, not
  usually an incident on its own unless prolonged), a non-blocking alert.
  Handle during business hours.

## Alert → response mapping

| Alert | Likely cause | First checks |
|---|---|---|
| High error rate | Bad deploy, dependency outage | Recent deploys (`fly releases`), `/ready` dependency status, Sentry |
| High p95 latency | Provider degradation, DB connection pool exhaustion | `provider_latency_ms` metric, `DB_POOL_MAX × replica count` vs. Postgres connection limit |
| Provider failure spike / circuit breaker OPEN | Instagram-side issue or actual block | `provider_block_events_total`, `provider_auth_failures_total` — do NOT attempt to work around a block; let the breaker do its job, investigate whether retrieval patterns need adjusting (never evasion) |
| Cache failure | Redis down | Rate limiting fails open automatically (see `docs/security.md`) — confirm this is actually happening, not silently 500ing |
| Database failure | Postgres down/unreachable | Auth fails closed (expected) — confirms via `/ready`'s `dependency: "database"` response |
| Memory/CPU/disk exhaustion | Leak, traffic spike, temp-file cleanup failure | Check `withRequestWorkspace` cleanup is actually running (it runs in a `finally`, but verify no process is holding file handles open) |

## First response checklist (any P1/P2)

1. Confirm scope: one replica or all of them? (`fly status`, `/health` per
   machine.)
2. Check the most recent deploy — is this correlated with a release?
   `fly releases`; if so, roll back per `docs/deployment.md`'s rollback
   section before debugging forward.
3. Check `/ready`'s response body — it names which dependency (`redis` /
   `database`) is failing, if any, distinct from the app itself being
   unhealthy.
4. Check Sentry (if configured) for the actual exception, not just the
   symptom.
5. For anything provider-related: confirm the circuit breaker's state
   before assuming Instagram itself is at fault — `getHealth()` per
   provider distinguishes `blocked` (breaker open) from other causes.

## Explicitly out of scope for incident response

Never respond to an Instagram-side block/rate-limit by adding evasion
techniques (IP rotation, fingerprint spoofing, etc.) under pressure — see
`docs/provider-policy.md`. The correct response to sustained Instagram
failures is to let the circuit breaker reduce traffic and communicate
degraded Instagram-sourced functionality to users, not to work around it.

## Postmortems

Not yet templated — add a lightweight postmortem template here once a
real P1/P2 has occurred, based on what was actually useful to capture,
rather than speculating about format in advance.
