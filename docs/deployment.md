# Deployment

Moreel deploys as one stateless container on Fly.io. This document is the
runbook — the actual, current setup, not an aspirational one. Steps marked
**[external action]** must be done by a human with real credentials; they
cannot be automated by an agent working in this repo.

## Prerequisites

- A [Fly.io](https://fly.io) account. **[external action]**
- `flyctl` installed locally (`brew install flyctl` or see Fly's docs).
- A managed Postgres instance (Fly Postgres recommended — colocated,
  one bill, no second platform to learn).
- A managed Redis instance ([Upstash](https://upstash.com) recommended —
  simple, has a free tier, works over TLS with `ioredis`).
- (Optional) A Sentry account for error tracking, an OTLP-compatible
  tracing backend.

## First-time setup

All of the following are **[external actions]** — run them yourself with
your own Fly/Upstash credentials:

1. `fly auth login`
2. `fly apps create moreel` and `fly apps create moreel-staging` (matching
   the `app` names in `fly.toml` / `fly.staging.toml`).
3. Provision Postgres: `fly postgres create` (attach to both apps, or run
   two instances — one per environment) and note the connection string.
4. Provision Redis: create an Upstash database, copy its `rediss://` URL.
5. Run migrations against the new database:
   ```bash
   DATABASE_URL=<connection-string> npm run migrate:up
   ```
6. Set secrets for each app (repeat for `moreel-staging`):
   ```bash
   fly secrets set -a moreel \
     OPENAI_API_KEY=sk-... \
     DATABASE_URL=postgres://... \
     REDIS_URL=rediss://... \
     SENTRY_DSN=https://... \
     OTEL_EXPORTER_OTLP_ENDPOINT=https://...
   ```
   Every one of these is optional except `OPENAI_API_KEY` — the app runs
   with reduced functionality (no auth, in-memory rate limiting, no
   tracing/error-tracking) if the rest are omitted — see
   `docs/architecture.md` for what each one gates. Never put secrets in
   `fly.toml`, source control, or CI logs — `fly secrets set` is the only
   path.
7. First deploy: `fly deploy` (production) / `fly deploy --config fly.staging.toml` (staging).
8. (Optional) `fly certs add <your-domain>` for a custom domain.

After this, deploys go through CI (`.github/workflows/main.yml`), not
manual `fly deploy` — see "CI/CD" below.

## CI/CD

- Every PR runs `.github/workflows/pr.yml`: typecheck, lint, `npm audit`,
  migrations + full test suite against real Postgres/Redis service
  containers, and a build.
- Every merge to `main` runs `.github/workflows/main.yml`: rebuilds the
  image, scans it with Trivy (fails the build on any HIGH/CRITICAL CVE),
  pushes an immutable image tagged with the git SHA to GHCR, deploys it to
  **staging** automatically, smoke-tests staging, then waits for a human
  reviewer on the `production` GitHub Environment before promoting the
  *same image* to production. Production never gets a different build
  than what staging validated.

**[external action]** Required GitHub repo configuration:
- Secret `FLY_API_TOKEN` (from `fly tokens create deploy`).
- Repo variables `STAGING_URL` / `PRODUCTION_URL` (the smoke-test targets).
- A `production` Environment with at least one required reviewer, and a
  `staging` Environment (no reviewer needed).

## Connection pooling math

`DB_POOL_MAX` (default 10) is a **per-replica** cap. With `min_machines_running = 2`
in `fly.toml`, that's up to 20 concurrent connections against your Postgres
instance at steady state — check your managed Postgres plan's connection
limit before scaling `min_machines_running` up, and lower `DB_POOL_MAX`
rather than let replica count silently exhaust the database's connection
budget.

## Rollback

Fly keeps prior releases:
```bash
fly releases -a moreel
fly deploy -a moreel --image ghcr.io/<org>/<repo>:<previous-sha>
```
Since every deploy uses an immutable SHA-tagged image, "rollback" is
always "deploy the previous tag" — never a rebuild of old source, which
could pick up different dependency versions than what was actually tested.

## Local development

`docker-compose.prod.yml` runs the full stack (app + Postgres + Redis)
locally for testing the containerized build before pushing — **not** what
production actually runs on (production uses managed Postgres/Redis, not
containers). Run migrations against it separately:
```bash
docker compose -f docker-compose.prod.yml up -d
DATABASE_URL=postgres://moreel:moreel@localhost:5433/moreel npm run migrate:up
curl localhost:8080/health
```
