# Disaster Recovery

## What actually needs recovering

Only Postgres holds durable state (`accounts`, `api_keys`,
`provider_events`) — see `docs/architecture.md`'s "Data ownership"
section. Redis holds only
reconstructible state (rate-limit counters, circuit-breaker state, cache
entries, dedup locks) — losing it degrades service (falls back to
in-memory/no-cache behavior) but loses no data that can't be
regenerated. There is no object storage and no durable media archive to
back up (media is a per-request temp file, always deleted).

**This means disaster recovery is entirely about Postgres.**

## Targets (initial, unvalidated — revisit once real usage patterns exist)

- **RPO (Recovery Point Objective): 5 minutes.** Acceptable data loss —
  matches Fly Postgres's continuous WAL archiving, if that's the chosen
  provider (see `docs/deployment.md`'s ADR-worthy choice).
- **RTO (Recovery Time Objective): 1 hour.** Acceptable downtime to fully
  restore from backup and redeploy.

These are stated goals, not measured/tested SLOs yet — see "Testing
restoration" below for why that distinction matters.

## Backup strategy

Managed Postgres (Fly Postgres or equivalent) — rely on the provider's
built-in continuous backup/point-in-time-recovery rather than a
custom `pg_dump` cron job, per the "prefer managed infrastructure, boring
technology" principle. **[external action]**: confirm the specific
backup/PITR configuration and retention window with whichever managed
Postgres provider is actually chosen at deploy time — this document should
be updated with the real, confirmed retention period once that's set up
(don't assume a default).

## Restore procedure (documented, not yet executed against a real instance)

1. Identify the target restore point (timestamp or backup ID) from the
   managed provider's console/CLI.
2. Provision a new Postgres instance from that backup/PITR point
   (provider-specific — Fly Postgres: `fly postgres create` from a
   snapshot; adjust for whichever provider is actually in use).
3. Point `DATABASE_URL` at the restored instance via `fly secrets set`.
4. Run `npm run migrate:up` if the restore point predates a since-applied
   migration (should be a no-op if the restore already includes it — the
   migration tracking table, `pgmigrations`, is part of the same database).
5. Redeploy the app so it picks up the new `DATABASE_URL`.
6. Verify via `/ready`'s database health check and a manual spot-check of
   recent `accounts`/`usage_events` rows.

## Testing restoration

**Not yet tested against a real production instance.** Before relying on
this procedure for a real incident: actually perform a restore
into a scratch environment at least once, time it against the RTO target
above, and update this document with what was learned (the plan above is
reasonable but unverified — restoring is the part that's supposed to be
tested, not just backing up).

## Secrets recovery

Secrets (`OPENAI_API_KEY`, etc.) live in Fly's secret manager, not in the
database — losing the database doesn't lose secrets, and vice versa. If
Fly secrets are lost (e.g. app deleted), they must be re-entered from each
provider's own dashboard — there is no separate backup of secrets by
design (a secrets backup is itself a security liability).
