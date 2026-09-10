# Provider Policy — Instagram (internal compliance doc)

## What Moreel retrieves

Public Instagram Reels only — content reachable without logging in. The
URL patterns Moreel recognizes are enumerated explicitly in
`src/providers/instagram/url.ts`; anything else (photo posts, carousels,
Stories, IGTV, other platforms) is rejected as `UNSUPPORTED_SOURCE` before
any retrieval attempt.

## How it retrieves it

Two steps, both against Instagram's own public-facing surface (the same
data a logged-out browser would see for public content):
1. `yt-dlp` resolves Reel metadata and a direct media URL
   (`src/providers/instagram/instagram-provider.ts`).
2. The media is downloaded over HTTPS through a host-allowlisted,
   SSRF-guarded downloader (`src/media/downloader/http-downloader.ts`).

Neither step logs in, solves a CAPTCHA, or otherwise bypasses any access
control. Content requiring login surfaces as `AUTHENTICATION_REQUIRED`
and is not retried with different credentials or techniques.

## What content is NOT supported

- Private accounts / login-gated content.
- Anything Instagram's own systems block or rate-limit access to — Moreel
  backs off (see below), it does not try harder.
- Non-Reel content types (see above).
- Platforms other than Instagram (until a future provider is added behind
  the same `VideoProvider` abstraction — see `docs/architecture.md`
  section 5).

## Rate limiting and backoff (the actual technical controls)

`src/providers/protection/` — `INSTAGRAM_MAX_CONCURRENCY`,
`INSTAGRAM_REQUESTS_PER_SECOND`, `INSTAGRAM_COOLDOWN_SECONDS`,
`INSTAGRAM_MAX_RETRIES`, and a circuit breaker
(`INSTAGRAM_CIRCUIT_FAILURE_THRESHOLD`) that opens after repeated
provider-caused failures and only allows a single probe request once the
cooldown elapses. All of these only ever reduce request volume in response
to failure signals — none of them retries harder, escalates concurrency,
or attempts to work around a rejection. See `test/failure/provider-failures.test.ts`
for verified behavior under sustained failure.

## Explicitly prohibited techniques — never implemented, by policy

- IP rotation to circumvent rate limits or blocks.
- Account rotation or credential use of any kind.
- Browser-fingerprint spoofing to evade bot detection.
- CAPTCHA solving/bypass.
- Any mechanism whose purpose is to make Moreel's traffic harder for
  Instagram to identify or rate-limit as automated.

If Instagram begins rejecting requests, Moreel's only response is to
**reduce** traffic (backoff, circuit open, cooldown) and surface a typed
error to the caller — never to increase persistence or sophistication of
retrieval attempts.

## Data retention

See `docs/privacy.md`. Downloaded media is a per-request temp file,
deleted immediately after each request. Only the transcript (not the
video/audio) is cached, with a TTL, not retained indefinitely.

## User responsibilities

Users of Moreel (via MCP or the API) are responsible for having the right
to request a transcript of the content they submit a URL for — see
`docs/acceptable-use-policy.md`'s prohibition on using Moreel to scrape
content the user doesn't have authorization to access, and
`docs/terms-of-service.md`'s intellectual-property-responsibility section.

## No claimed affiliation

Moreel is not affiliated with, endorsed by, or sponsored by Instagram or
Meta. Instagram/Meta branding is not used anywhere in Moreel's product,
marketing, or documentation in a way that implies official affiliation.

## Provider abstraction — future-proofing, not evasion

`VideoProvider` (`src/providers/provider.ts`) deliberately keeps
Instagram-specific logic isolated from the rest of the pipeline. If
Instagram publishes an official API appropriate for Moreel's use case in
the future, it can replace the current yt-dlp-based retrieval mechanism
behind this same interface without touching MCP, auth, or any other
provider. This is architectural preparedness for a better retrieval
path, not a hedge for evading current restrictions.

## Before commercial launch

**[external action, required]**: review Instagram's/Meta's current Terms
of Service, Platform Policy, and applicable law (including any relevant
computer-fraud/anti-circumvention statutes in jurisdictions Moreel
operates in) with qualified counsel before commercial launch. This
document describes the current technical implementation; it is not a
legal compliance sign-off.
