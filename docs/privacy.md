# Privacy and Data Retention

> This document describes Moreel's actual data handling. It is not a
> substitute for a legally-reviewed Privacy Policy — see
> `docs/terms-of-service.md` for the placeholder that needs counsel review
> before this is presented to real customers.

**Guiding principle:** process the minimum data necessary, retain it for
the minimum time necessary.

## What is collected, and why

| Data | Why | Where it lives | Retention |
|---|---|---|---|
| Reel URL (from the request) | Needed to fetch and identify content | Never persisted as a standalone record; used transiently and as a cache/dedup key derivative | Not retained beyond cache TTL |
| Downloaded video/audio | Needed to extract audio and transcribe | Local temp file for the single request only | Deleted immediately after the request, success or failure, via `withRequestWorkspace` (`src/media/workspace.ts`) |
| Transcript text | The product's output | In-memory (or Redis, once wired) cache, keyed by content identity | `CACHE_TTL_SECONDS` (default 1 hour) |
| Processed video record (transcript + visual observations + search embeddings) | Backs `search_video`/`find_moment`/`get_video_timeline` across separate calls | Postgres `videos` table when `DATABASE_URL` is set (falls back to Redis, then an in-process cache — see `src/app/video-store.ts`) | `TRANSCRIPT_TTL_SECONDS` (default 24h) — every row carries an explicit `expires_at` and reads filter on it, same bounded-retention model as the transcript cache above, not an unbounded archive |
| Account email | Account identification | Postgres `accounts` table | Until account deletion |
| API key (hashed) | Authentication | Postgres `api_keys` table (argon2id hash only — the plaintext secret is never stored) | Until revoked/rotated |

## What is NOT collected or retained

- **No permanent archive of downloaded media.** Video/audio is a
  per-request temp file, always deleted (even on error/cancellation).
- **No unbounded transcript history table.** The `videos` table (when
  Postgres is configured) is durable across restarts/replicas, but every
  row still expires on the same TTL as the in-memory/Redis cache — it is a
  shared cache, not an archive. Rows past their `expires_at` are excluded
  from reads immediately; a periodic job to reclaim their storage doesn't
  exist yet, a known gap.
- **No training on customer content.** Transcripts and URLs are not used
  to train or fine-tune any model, by default. Changing this would require
  an explicit, separate policy and product decision — not a silent code
  change.
- **No plaintext API keys, anywhere**, including logs (redacted at the
  logger level, `src/observability/logger.ts`).

## Third-party processors

- **Instagram** (via `yt-dlp`) — only public, non-login-gated content is
  retrieved. See `docs/provider-policy.md`.
- **OpenAI** (Whisper API) — the extracted audio is sent to OpenAI's
  `/audio/transcriptions` endpoint for transcription. Subject to OpenAI's
  own data-handling terms for API usage.
- **OpenAI** (Embeddings API, opt-in via `SEARCH_EMBEDDINGS_ENABLED`) — when
  enabled, the text of each transcript segment/visual observation (not raw
  media) is sent to OpenAI's `/embeddings` endpoint to power semantic
  search, plus each search query typed by a user/agent. Off by default;
  the resulting vectors are stored alongside the video record above, under
  the same TTL.
- **OpenAI** (chat completions vision, opt-in via `VIDEO_MAP_ENABLED`,
  requires `VISION_ENABLED`) — when enabled, a small, bounded set of
  frames (only around linguistic "this"/"that"/pointing moments, never the
  whole video — see `VIDEO_MAP_MAX_WINDOWS`) plus nearby transcript text
  are sent to OpenAI to resolve what the speaker was referring to or doing.
  Off by default; the resulting entities/interactions/references are
  stored alongside the video record above, under the same TTL.
- **(Optional) Sentry, an OTLP tracing backend** — only if configured
  (`SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`); error reports use an
  explicit allowlisted context (`requestId`, `provider`, `environment`,
  `version`) — never raw media, transcripts, API keys, or cookies
  (`src/observability/error-tracking.ts`).

## Deletion requests

Not yet automated. Today, a deletion request means manually: revoking all
API keys for the account and deleting the `accounts` row (cascades to
`api_keys` via `ON DELETE CASCADE` in the schema). Automating this as a
self-service flow is a reasonable next step before real users exist at
scale, not something built speculatively here.

## Observability, monitoring and privacy

We run a privacy-first observability stack for operational health.
Monitoring includes metrics (Prometheus), logs (Loki), and traces
(OpenTelemetry / Jaeger). By design we avoid sending raw transcripts,
media, or any other content that could reveal a person's video
preferences, faces, or other sensitive signals to these systems.

Key principles:
- Data minimization: monitoring only receives aggregates, counters, and
  non-identifying markers (e.g., `transcription_duration_ms`, `errors_total`).
- Pseudonymization: where an account or identifier is used in logs or
  traces (for debugging), it is hashed with an application salt and only
  the pseudonymous token is stored (`acct_<hash>`). The raw email or
  account ID is never emitted to monitoring backends.
- No raw content: transcripts and media never flow into monitoring. If an
  event references a transcript, it references its opaque cache key only.
- Retention: raw logs are short-lived (e.g., 7–30 days) per your policy
  configuration.

DSARs and deletion:
- We expose `/privacy/export` and `/privacy/delete` endpoints (authenticated)
  that allow export of account/key metadata and account deletion. Exported
  datasets are privacy-safe (no raw transcripts). Deletion cascades and
  removes account records from Postgres; operators should verify and log
  such actions.

Compliance:
- We recommend a DPIA be performed prior to wide roll-out. The DPIA
  should document data flows from ingestion → processing → monitoring,
  plus mitigations (pseudonymization, retention, access controls).

## Caching and encryption

Cache values (transcripts) are not currently encrypted at rest — the
in-memory cache doesn't need it (never persisted to disk), and the
Redis-backed cache (`src/cache/redis-cache.ts`) is built with the ability
to add field-level `AES-256-GCM` encryption before it's wired into the
live path, per `docs/architecture.md`'s "Cache, persistence, and operations" section.
