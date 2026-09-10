# Security

Describes what's actually implemented, not an aspirational target.

## Authentication models — MCP vs. REST API

Moreel has **two separate transports with two separate trust models**:

- **MCP over stdio** (`src/mcp/server.ts`): no network authentication
  boundary. The trust boundary is "you can spawn this process" — the same
  model every local MCP server (filesystem access, shell tools, etc.)
  uses. Whoever can start the process (a local Claude Code/Desktop
  session) can call `transcribe_video`. This is appropriate for a
  developer running Moreel locally against their own OpenAI key; it is
  **not** appropriate for exposing Moreel to untrusted callers. If MCP is
  ever exposed remotely (not currently planned), it must go through the
  HTTP transport's auth, not stdio's implicit trust.
- **HTTP API** (`src/http/`): API-key authentication
  (`src/http/middleware/auth.ts`, `src/auth/`). Keys are generated as
  `moreel_live_<random>`, hashed with argon2id (`@node-rs/argon2`) before
  storage — the plaintext secret is shown exactly once at creation and
  never stored or logged. A revoked key (`revoked_at` set) fails
  authentication immediately. `last_used_at` is updated fire-and-forget on
  each successful auth, never blocking the request.

## SSRF protection

`src/media/downloader/http-downloader.ts` enforces an allowlist of
Instagram CDN host suffixes (`INSTAGRAM_CDN_HOST_SUFFIXES` in
`src/providers/instagram/instagram-provider.ts`) before ever issuing an
outbound request for a resolved media URL — a probe result pointing
somewhere off that allowlist is rejected rather than fetched. See
`test/unit/ssrf.test.ts`.

## Subprocess execution

Every external binary invocation (`yt-dlp`, `ffmpeg`) goes through
`src/util/subprocess.ts`'s `ExecFileCommandRunner`, which uses
`child_process.execFile` with an argument array — never a shell, never
string interpolation into a command line. This means untrusted input
(a URL) cannot break out into shell syntax regardless of what characters
it contains.

## Input validation

`src/providers/url-validation.ts` and `src/providers/instagram/url.ts`
validate and normalize every URL before it reaches any provider — only
recognized Instagram Reel URL shapes on an explicit host allowlist are
accepted; everything else is `INVALID_URL`/`UNSUPPORTED_SOURCE`, typed and
rejected before any network call.

## Rate limiting and abuse prevention

See `docs/architecture.md`'s "Provider abstraction" and "Cache, persistence,
and operations" sections. Layers, in order:
per-provider concurrency/rate/circuit-breaker limits
(`src/providers/protection/`, never used to evade Instagram — only to
bound Moreel's own outbound traffic), then per-caller HTTP rate limiting
(`src/ratelimit/`, IP-based for anonymous callers, account-based once
authenticated so legitimate users sharing an IP aren't penalized). Every
layer fails toward *reducing* load, never increasing it.

## Fail-open vs. fail-closed

Deliberate, and different per component:
- **Rate limiting fails open** — if Redis is unreachable, requests proceed
  (logged as a warning) rather than every request 500ing. Losing rate
  enforcement briefly is an acceptable degradation.
- **Authentication fails closed** — if Postgres is unreachable during an
  auth check, the request is rejected. Silently treating a DB error as "no
  key required" would be a security hole, not graceful degradation.

See `test/failure/infra-failures.test.ts` for both, verified.

## Cost/resource ceilings

Every request has bounded worst-case cost: `MAX_VIDEO_SIZE_MB`,
`MAX_VIDEO_DURATION_SECONDS`, `REQUEST_TIMEOUT_SECONDS` (now a hard
deadline — see `docs/architecture.md`'s "Deployment and reliability" section),
`DOWNLOAD_TIMEOUT_SECONDS`, `TRANSCRIPTION_TIMEOUT_SECONDS`,
`MAX_CONCURRENT_REQUESTS` (hard-capped at 64 per replica in the config
schema), `INSTAGRAM_MAX_RETRIES` (bounded exponential backoff, never
unbounded). A malicious or buggy caller cannot turn one request into
unbounded compute or unbounded third-party API spend.

## Secrets

Never in source, Docker images, or git history. `.env.example` lists
variable *names* only. Production secrets go through `fly secrets set`
(see `docs/deployment.md`) — never `fly.toml`, never a committed file.
The pino logger (`src/observability/logger.ts`) redacts common secret
field names (`apiKey`, `authorization`, `cookie`, `password`) from
structured logs as a defense-in-depth measure, not a substitute for never
logging them in the first place.

## Dependency and container scanning

`npm audit --audit-level=high` runs on every PR
(`.github/workflows/pr.yml`). Every merge to `main` builds the container
and scans it with Trivy for HIGH/CRITICAL CVEs before it's pushed or
deployed anywhere (`.github/workflows/main.yml`) — a vulnerable image
never reaches staging or production.

## What's explicitly NOT done, by policy

No IP rotation, account rotation, browser-fingerprint spoofing, CAPTCHA
bypass, or any other technique intended to evade Instagram's (or any
platform's) anti-bot systems or access controls. See
`docs/provider-policy.md`.

## Known gaps (tracked, not hidden)

- `RedisCache` (`src/cache/redis-cache.ts`) exists and is tested but is
  not yet wired into `TranscriptionService` — the existing `Cache<V>`
  interface is synchronous. See `docs/architecture.md`'s "Cache, persistence, and operations" section.
- Cross-replica request dedup (`RedisDedupLock`) is built and tested but
  not yet wired into the request path for the same reason (no HTTP
  transcribe endpoint exists yet to wire it into).
- `fly.toml`/`fly.staging.toml` are hand-written against Fly's documented
  schema — validate against a real `flyctl` on first deploy.
