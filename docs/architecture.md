# Moreel — Production Architecture

> Status: living document. Update this file whenever the architecture below
> changes.

## 1. Product framing

Moreel gives AI agents access to video content through MCP. The only capability
today is `transcribe_video(url)` for public Instagram Reels. This document
describes how that capability is being hardened into a reliably operable
service **without** expanding what it does.

## 2. Target architecture

```text
                         ┌───────────────┐
                         │ MCP Clients   │
                         │ API Clients   │
                         └───────┬───────┘
                                 │
                                 ▼
                         ┌───────────────┐
                         │ API Gateway   │
                         │ / Auth        │
                         │ / Rate limits │
                         └───────┬───────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Moreel Application      │
                    │                        │
                    │ MCP                    │
                    │ API                    │
                    │ Usage metering         │
                    │ Provider orchestration │
                    └───────────┬────────────┘
                                │
                    ┌───────────┴────────────┐
                    ▼                        ▼
             ┌─────────────┐          ┌──────────────┐
             │ Cache       │          │ Transcriber  │
             └─────────────┘          └──────────────┘
                    │
                    ▼
             ┌─────────────┐
             │ Instagram   │
             │ provider    │
             └─────────────┘
```

Moreel is **one stateless application** with two transports into the same
core service (`TranscriptionService`):

- **MCP over stdio** — for local/trusted MCP clients (Claude Code, Claude
  Desktop, etc.). No network auth boundary; the trust boundary is "you can
  spawn this process," same as any local MCP server.
- **HTTP API** — for remote API clients and the auth/rate-limit surface
  a hosted service needs.

Both transports call into the same `TranscriptionService`
(`src/app/transcription-service.ts`), which orchestrates:
provider resolution → cache lookup → provider fetch (behind circuit
breaker/rate limiting) → audio extraction → transcription → usage recording.

## 3. Why so few infrastructure components

Explicitly **not** used, and why:

- **Kubernetes** — one stateless container that scales by replica count needs
  a platform-managed autoscaler (Fly.io), not a cluster orchestrator to
  operate ourselves.
- **Kafka / message queues** — every request is synchronous
  (download → transcribe → respond, seconds not hours); there's no
  fan-out/event-sourcing need that would justify a broker.
- **Service mesh / microservices** — one deployable unit. Splitting MCP,
  API, and provider orchestration into separate services would multiply
  operational surface for no scaling benefit — they all scale together
  (the bottleneck is the same: Instagram fetch + Whisper call).
- **Object storage** — media is a temp file for the duration of one request
  and is deleted immediately after (see `src/media/workspace.ts`); nothing
  is retained, so there is nothing to put in S3. Revisit only if a future
  feature needs to persist media (not currently planned).

What **is** introduced, and the justification for each:

| Component | Why |
|---|---|
| Fastify (HTTP) | Needed the moment there's a public API/auth surface; MCP-over-stdio alone can't serve that. |
| Redis | Rate limiting, circuit-breaker state, and request dedup must be shared across replicas — a naive in-memory version only works correctly at 1 replica. |
| PostgreSQL | Accounts and API keys are durable records that must survive replica restarts/redeploys — this is exactly what a relational database is for, and nothing here needs more than that. |

## 4. Data ownership — what lives where

- **In-process only (no cross-replica correctness dependency):** nothing —
  this is the point of statelessness. Anything that needs to be correct
  across more than one replica (circuit breaker, token bucket,
  request-dedup) lives in Redis instead of a local in-memory map.
- **Redis:** rate-limit counters, circuit-breaker state, in-flight-request
  dedup locks, and (optionally) the hot cache layer (content-identity →
  media → transcript).
- **Postgres:** `accounts`, `api_keys`, `provider_events`. Never media,
  never transcripts as a permanent archive (transcripts live in the cache
  layer with a TTL, not as a durable table, per the minimal-retention
  principle — see `docs/privacy.md`).
- **Local temp filesystem:** downloaded video + extracted audio for the
  duration of a single request only, cleaned up via
  `withRequestWorkspace` (`src/media/workspace.ts`) even on failure/cancel.

## 5. Provider abstraction

`VideoProvider` (`src/providers/provider.ts`):

```typescript
interface VideoProvider {
  readonly id: string;
  canHandle(url: URL): boolean;
  fetch(url: URL, options: FetchOptions): Promise<VideoAsset>;
}
```

A **provider protection layer** wraps this interface from the outside — the
Instagram provider itself stays a thin yt-dlp/HTTP client; circuit-breaking,
classification, and rate limiting wrap its `fetch()` call
(see `src/providers/protection/`). This means:

- A future second provider (TikTok, YouTube, ...) gets the same protection
  for free by being wrapped the same way.
- Instagram can be disabled (`INSTAGRAM_DISABLED=true`, or the circuit
  breaker tripping into `OPEN`) without touching MCP, auth, or any other
  provider — `ProviderHealth` is queried per-provider, not globally.

No anti-bot evasion is implemented anywhere in this layer, by design: no IP
rotation, no fingerprint spoofing, no CAPTCHA bypass. If Instagram starts
rejecting requests, the system's only response is to **reduce** traffic
(backoff, circuit open, cooldown) — never to work around the block.

## 6. Cache, persistence, and operations

```text
URL normalization  →  content identity  →  retrieved media  →  transcript
```

`src/cache/cache.ts` implements the generic `TtlCache`/`NoopCache`.
`src/cache/keys.ts` builds namespaced, versioned keys on top of it:
`contentIdentity()` prefers a provider's canonical content ID (e.g. an
Instagram shortcode, via the optional `VideoProvider.contentId()`) over the
raw URL, so share-link variants of the same content share one cache entry.
`transcriptCacheKey()` produces keys shaped
`v1:transcript:<provider>:<contentId>` — the `v1` schema-version prefix
means a future incompatible change to what's cached just makes old entries
unreachable (they still expire via their own TTL) rather than needing a
manual flush.

There is deliberately **no media cache layer**: downloaded video/audio is a
per-request temp file, deleted via `withRequestWorkspace` immediately after
each request regardless of outcome. Caching media would mean persisting it
somewhere across requests, which conflicts with the minimal-retention
principle (see `docs/privacy.md`) for no benefit — only the transcript (the
expensive-to-recompute artifact) is worth keeping.

Redis backs distributed rate limiting (`src/ratelimit/redis-rate-limiter.ts`),
circuit-breaker state (`src/providers/protection/redis-circuit-store.ts`),
and a distributed dedup lock (`src/cache/redis-dedup-lock.ts`), all tested
via `ioredis-mock` so no live Redis is required in CI/local dev. The dedup
lock wraps the *final `TranscribeVideoResult`*, not a provider's
`VideoAsset` — a downloaded video is a local temp file on one replica's
disk and cannot be shared, so cross-replica dedup only makes sense at the
cacheable-result layer; `ProtectedProvider`'s in-memory dedup still
collapses concurrent fetches within a single replica beneath that.

## 6.1 Accounts and usage

Postgres (`migrations/1735900000000_init.js`) holds `accounts`, `api_keys`,
and `provider_events` (run via `npm run migrate:up`, needs
`DATABASE_URL`). `src/auth/` implements API-key generation/hashing
(argon2id via `@node-rs/argon2`, never plaintext) and `AuthRepository`
(create account, create/revoke key, authenticate). `src/http/middleware/auth.ts`
is wired into `buildHttpServer` when an `AuthRepository` is supplied
(i.e. when `DATABASE_URL` is set), and rate limiting switches from
IP-based to account-based once auth is active
(`resolveAccountOrIpCaller`) — every authenticated account gets the same
`free` tier; Moreel has no paid plans or billing. Tested against a real
local Postgres (`test/integration/auth-repository.test.ts`, skipped
automatically if `DATABASE_URL` isn't reachable).

`src/usage/usage-recorder.ts` is a lightweight, in-process metering hook
(request count, video duration, provider/model, success) fed into
Prometheus counters for observability — it doesn't persist per-account
usage or gate anything; there is no usage cap or billing period to run out
of.

## 6.2 Observability

`GET /metrics` (`src/http/routes/metrics.ts`) serves a `@prometheus-io/client`
registry (`src/observability/prom-metrics.ts`) — the officially-endorsed
successor to `prom-client`, same API. Exempt from auth/rate-limiting like
`/health`/`/ready`. Metrics are labeled by provider/classification/model,
deliberately never by raw account/customer ID (unbounded cardinality) —
per-customer detail is a Postgres query against `usage_events`, not a
Prometheus label. `src/observability/metrics.ts` (the original flat
in-process map powering `npm run benchmark`) feeds from the same
`recordProviderOutcome()` call site.

OpenTelemetry tracing (`src/observability/tracing.ts`) is real but inert
by default: it only starts if `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and
must be loaded via `node --import ./dist/observability/tracing-bootstrap.js`
(wired into `start:http`/`dev:http`) — before the real entrypoint's modules
load at all, since Node auto-instrumentation patches modules at
import/require time.

Sentry (`src/observability/error-tracking.ts`) is the same pattern: inert
unless `SENTRY_DSN` is set. `captureException()` only ever attaches an
explicit allowlisted context (`requestId`, `provider`, `environment`,
`version`) — never a generic "attach everything," so API
keys/cookies/raw media/transcripts can't leak in by accident. Wired into
both process-level handlers (`uncaughtException`/`unhandledRejection` in
`http/main.ts`) and Fastify's `setErrorHandler`.

## 6.3 Deployment and reliability

`Dockerfile` is a multi-stage build: the builder stage compiles TypeScript
and installs prod-only deps separately from dev deps; the runtime stage
runs as a non-root user, installs ffmpeg + a standalone (no-Python) yt-dlp
binary picked by `TARGETARCH` (works on both arm64 and amd64 via
`docker buildx --platform`), has a `HEALTHCHECK` against `/health`, and
bakes in no secrets — everything comes from env at runtime.
`docker-compose.prod.yml` runs the app alongside Postgres and Redis.

`.github/workflows/pr.yml` runs typecheck/lint/audit/migrations/tests
against real Postgres+Redis service containers on every PR.
`.github/workflows/main.yml` builds+Trivy-scans+pushes an immutable
SHA-tagged image to GHCR on every merge to `main`, auto-deploys it to
staging, smoke-tests it, then requires a human reviewer on the
`production` GitHub Environment before promoting the *same* image —
production never runs a build staging didn't validate.

`fly.toml`/`fly.staging.toml` target Fly.io. `docs/deployment.md` has the
full runbook, including the connection-pool math for
`DB_POOL_MAX × replica count` against a managed Postgres instance's
connection limit.

`npm run load-test` (`scripts/load-test.ts`, `docs/load-testing.md`) drives
`TranscriptionService` at configurable concurrency against fakes — never
real Instagram/OpenAI. `test/failure/` (wired into CI as
`npm run test:failure`) covers: sustained provider failures opening the
circuit breaker without retrying harder, provider rate-limiting,
concurrent-duplicate-request collapsing, download/transcription hangs,
corrupt media, client cancellation, Redis unavailable (rate limiting fails
open), and Postgres unavailable (auth fails closed, never silently lets a
request through unauthenticated) — a deliberate asymmetry: a Redis outage
degrades a soft feature, so it fails open; a Postgres outage during
authentication fails closed, since silently letting a request through
unauthenticated would be a security hole, not graceful degradation.

Remaining docs (`operations.md`, `security.md`, `privacy.md`,
`incident-response.md`, `disaster-recovery.md`, `slos.md`,
`provider-policy.md`) describe actual implemented behavior, including
honest "not yet wired" notes where something is built but not live.
`terms-of-service.md` and `acceptable-use-policy.md` are explicitly marked
as drafts, not legal advice, with `[COUNSEL REVIEW REQUIRED]` markers on
every section needing a lawyer's judgment before this governs a real
customer relationship.

## 7. Operating principle

> A small team should be able to operate Moreel reliably.

Every component above earns its place by solving a problem that has already
appeared in this document (cross-replica state, durable accounts, real
payments) — not because a "typical production architecture" diagram usually
includes it. New infrastructure is added only when an earlier, simpler
option (in-memory, a config flag, a single Postgres table) has been
outgrown.
