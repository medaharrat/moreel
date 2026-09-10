# Operations

Day-to-day running of Moreel. See `docs/deployment.md` for first-time setup
and `docs/incident-response.md` for what to do when something's actually
on fire.

## Environments

| Environment | Purpose | Config |
|---|---|---|
| `development` | Local machine | `.env` (never committed), local Postgres/Redis or none (both are optional — see below) |
| `staging` | `moreel-staging` Fly app | Deployed automatically on every merge to `main`; smoke-tested before production promotion |
| `production` | `moreel` Fly app | Deployed only after a human approves the `production` GitHub Environment gate |

Never use production credentials locally. `DATABASE_URL`/`REDIS_URL` etc.
are all optional in development — omitting them degrades gracefully
(in-memory rate limiting, no auth) rather than failing to start; see
`docs/architecture.md` for exactly what each one gates.

## Running locally

```bash
npm install
cp .env.example .env         # fill in OPENAI_API_KEY at minimum
npm run build
npm run dev:http             # HTTP transport, or:
npm run dev                  # MCP-over-stdio transport
```

`docker-compose.prod.yml` runs the full stack (app + Postgres + Redis)
locally if you want to exercise the containerized build with real
dependencies before pushing.

## Health checks

- `GET /health` — process alive. Never depends on Instagram/OpenAI/Redis/
  Postgres. A third-party outage must never make the platform kill an
  otherwise-healthy replica.
- `GET /ready` — startup complete, not draining, and (only if configured)
  Redis/Postgres reachable. Deliberately does not reflect transient
  concurrency saturation (that's what 429s are for).
- `GET /metrics` — Prometheus-format metrics, unauthenticated (same
  exemption as health checks, for scrapers).

## Graceful shutdown

SIGTERM/SIGINT → `/ready` starts failing (load balancer stops routing new
traffic) → in-flight requests drain, bounded by `SHUTDOWN_TIMEOUT_SECONDS`
(default 30s) → force-exit if that elapses. See
`src/http/shutdown.ts`. This is required for zero/minimal-downtime rolling
deploys — verify it after any change there with:
```bash
npm run start:http &
sleep 1 && kill -TERM %1   # should exit cleanly within the timeout
```

## Provider kill switch

`INSTAGRAM_DISABLED=true` disables Instagram retrieval immediately,
independent of the circuit breaker's own state, without touching MCP,
auth, or any future second provider. Use this for a suspected block worse
than the breaker has detected, or a legal/compliance request to stop
retrieval temporarily.

## Common operational tasks

**Rotate an API key**: revoke the old one
(`AuthRepository.revokeApiKey`), issue a new one
(`AuthRepository.createApiKey`) — there's no in-place rotation; a key is
either valid or revoked.

**Run a migration**:
```bash
DATABASE_URL=<target> npm run migrate:up
```
Never run `migrate:down` against production without a fresh backup — see
`docs/disaster-recovery.md`.

## Logs

Structured JSON to stderr (`src/observability/logger.ts`), one line per
request with `request_id`. Never contains API keys, cookies, passwords, or
authorization headers (redacted at the logger level as defense in depth).
Never log raw transcripts or full URLs at anything above debug level —
they're user content, not operational metadata.
