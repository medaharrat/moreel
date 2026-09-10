<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/moreel-logo-dark.svg">
    <img src="public/brand/moreel-logo.svg" alt="Moreel" width="360">
  </picture>

  <p><strong>Get More from Reels.</strong></p>

  <p>
    An MCP server that turns a public Instagram Reel URL into an accurate,
    timestamped transcript — one tool, one job, built for AI agents.
  </p>

  [![CI](https://github.com/medaharrat/moreel/actions/workflows/ci.yml/badge.svg)](https://github.com/medaharrat/moreel/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
  [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![MCP compatible](https://img.shields.io/badge/MCP-compatible-6A00DE)](https://modelcontextprotocol.io)
</div>

---

Moreel is an MCP (Model Context Protocol) server that gives AI agents one
reliable primitive: **given a public Instagram Reel URL, return an
accurate, timestamped transcript of its spoken audio.**

That's it. v0.1 is deliberately narrow — no video summarization, no visual
analysis/OCR, no embeddings/RAG, no browser UI, no analytics. Just a
production-quality `video → transcript` tool, exposed through MCP, built so
more providers (TikTok, YouTube, X, ...) can be added later without
changing the tool's contract.

## 1. What Moreel currently supports

- **Input:** public Instagram Reel URLs only (`instagram.com/reel/...`,
  `/reels/...`, or `/<user>/reel/...`). Photo posts, carousels, Stories,
  IGTV, and every other platform are out of scope for v0.1 and return a
  typed `UNSUPPORTED_SOURCE` error.
- **Access:** only content that is publicly viewable without logging in.
  Moreel never attempts to bypass login, CAPTCHAs, or any other access
  control — private/login-gated content returns `AUTHENTICATION_REQUIRED`.
- **Output:** a single MCP tool, `transcribe_video`, returning structured,
  timestamped segments plus a combined plain-text transcript, detected
  language, and duration. It transcribes **spoken audio only** — it does
  not look at, describe, or interpret anything visual in the video.

## 2. Installation

Requirements:

- Node.js >= 22
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH` (or set `YTDLP_PATH`)
- [`ffmpeg`](https://ffmpeg.org/) on `PATH` (or set `FFMPEG_PATH`)
- An OpenAI API key (for the default `TRANSCRIPTION_PROVIDER=openai`)

```bash
git clone https://github.com/medaharrat/moreel.git
cd moreel
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY
npm run build
```

## 3. Configuration

All configuration is via environment variables (see `.env.example` for the
full, documented list). The important ones:

| Variable                        | Default      | Purpose                                  |
| ------------------------------- | ------------ | ---------------------------------------- |
| `TRANSCRIPTION_PROVIDER`        | `openai`     | Transcription backend (only one in v0.1) |
| `TRANSCRIPTION_MODEL`           | `whisper-1`  | Model name passed to the provider        |
| `OPENAI_API_KEY`                | _(required)_ | API key for the OpenAI Whisper endpoint  |
| `MAX_VIDEO_SIZE_MB`             | `100`        | Reject media larger than this            |
| `MAX_VIDEO_DURATION_SECONDS`    | `600`        | Reject media longer than this            |
| `REQUEST_TIMEOUT_SECONDS`       | `60`         | Hard cap on the whole request            |
| `DOWNLOAD_TIMEOUT_SECONDS`      | `30`         | Hard cap on fetching media               |
| `TRANSCRIPTION_TIMEOUT_SECONDS` | `45`         | Hard cap on the transcription API call   |
| `MAX_CONCURRENT_REQUESTS`       | `4`          | Bounded concurrency; excess fails fast   |
| `CACHE_ENABLED`                 | `true`       | In-memory transcript cache               |
| `CACHE_TTL_SECONDS`             | `3600`       | Cache entry lifetime                     |
| `LOG_LEVEL`                     | `info`       | Structured log verbosity (to stderr)     |

Never hardcode secrets — always via environment/`.env`.

## 4. Running the MCP server

```bash
npm run build
npm start          # runs dist/mcp/server.js over stdio

# or, for local development without a build step:
npm run dev
```

The server speaks MCP over **stdio**. All logs go to `stderr`; `stdout` is
reserved for the MCP protocol, so nothing else is safe to `console.log`
there (this is enforced in the logger, not just a convention).

## 5. Connecting it to an MCP client

Example config for Claude Desktop / Claude Code (`claude_desktop_config.json`
or `.mcp.json`):

```json
{
  "mcpServers": {
    "moreel": {
      "command": "node",
      "args": ["/absolute/path/to/moreel/dist/mcp/server.js"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "MAX_VIDEO_DURATION_SECONDS": "600"
      }
    }
  }
}
```

Any MCP client that speaks the stdio transport works the same way — point
its server command at `node dist/mcp/server.js` with the environment
variables above set.

## 6. Example tool invocation

Request:

```json
{
  "name": "transcribe_video",
  "arguments": { "url": "https://www.instagram.com/reel/ABC123xyz/" }
}
```

Successful response (`structuredContent`):

```json
{
  "source": "instagram",
  "url": "https://www.instagram.com/reel/ABC123xyz/",
  "duration_seconds": 53.28,
  "language": "en",
  "low_confidence": false,
  "segments": [
    { "start": 0.0, "end": 2.44, "text": "10 out of 10 unusual hobbies" },
    { "start": 2.44, "end": 4.9, "text": "you should try this year." }
  ],
  "text": "10 out of 10 unusual hobbies you should try this year."
}
```

Error response (`isError: true`, structured and typed — see section 8):

```json
{
  "isError": true,
  "structuredContent": {
    "code": "UNSUPPORTED_SOURCE",
    "message": "The URL does not point to a supported provider. Only public Instagram Reel URLs are supported in this version.",
    "retryable": false
  }
}
```

## 7. Response schema

`transcribe_video` declares both an input and an **output JSON Schema** to
the MCP client (visible via `tools/list`), so `structuredContent` on
success is always exactly:

```ts
{
  source: "instagram";
  url: string;
  duration_seconds: number;
  language?: string;        // omitted if it couldn't be detected
  low_confidence: boolean;  // true if parts of the audio were unclear/non-speech
  segments: Array<{ start: number; end: number; text: string }>;
  text: string;
}
```

### Errors

Every failure is one of these typed codes, never a raw stack trace or
internal path:

| Code                      | Meaning                                            | Retryable |
| ------------------------- | -------------------------------------------------- | :-------: |
| `INVALID_URL`             | Not a well-formed URL                              |    no     |
| `UNSUPPORTED_SOURCE`      | Not a supported provider/URL shape                 |    no     |
| `CONTENT_UNAVAILABLE`     | Not found / deleted / region-restricted            |    no     |
| `AUTHENTICATION_REQUIRED` | Private or login-gated content                     |    no     |
| `DOWNLOAD_FAILED`         | Media could not be downloaded                      |    yes    |
| `MEDIA_TOO_LARGE`         | Exceeds `MAX_VIDEO_SIZE_MB`                        |    no     |
| `MEDIA_TOO_LONG`          | Exceeds `MAX_VIDEO_DURATION_SECONDS`               |    no     |
| `AUDIO_EXTRACTION_FAILED` | ffmpeg could not extract audio                     |    no     |
| `TRANSCRIPTION_FAILED`    | Transcription provider failed                      |    yes    |
| `TRANSCRIPTION_TIMEOUT`   | Transcription exceeded its timeout                 |    yes    |
| `RATE_LIMITED`            | Server concurrency limit reached; retry shortly    |    yes    |
| `REQUEST_TIMEOUT`         | Overall request exceeded `REQUEST_TIMEOUT_SECONDS` |    yes    |
| `INTERNAL_ERROR`          | Unexpected internal failure                        |    yes    |

## 8. Architecture

```
MCP layer            src/mcp/            transcribe_video tool, schema, server bootstrap
      ↓
Application service  src/app/            orchestration: timeouts, cancellation, cache,
                                          concurrency, metrics, usage — the only layer
                                          that knows the full pipeline shape
      ↓
Provider abstraction src/providers/      VideoProvider interface; InstagramProvider
                                          (yt-dlp metadata + media URL resolution)
      ↓
Media extraction     src/media/          SSRF-guarded streaming HttpDownloader,
                                          per-request temp workspace + guaranteed cleanup
      ↓
Audio extraction     src/media/audio/    ffmpeg subprocess, audio-only (-vn), no
                                          video frame decoding
      ↓
Transcription        src/transcription/  Transcriber interface; OpenAiWhisperTranscriber;
                                          normalization (timestamps, hallucination
                                          collapsing, confidence)
      ↓
Domain               src/domain/         Transcript/TranscriptSegment types, typed
                                          MoreelError taxonomy
```

Cross-cutting concerns live alongside, not inside, the pipeline:
`src/cache/` (TTL cache), `src/observability/` (structured logging +
metrics), `src/usage/` (usage metering hook), `src/config/` (env config),
`src/util/` (subprocess runner, retry, semaphore).

**Why this shape:** the MCP layer never contains Instagram-specific code —
it only calls `TranscriptionService`. Adding TikTok/YouTube later means
adding one more `VideoProvider` implementation and registering it in
`src/mcp/server-factory.ts`; nothing above the provider layer changes.
Swapping the transcription vendor means adding one more `Transcriber`
implementation; nothing below it changes.

### Security posture

- **URL validation & SSRF:** every input URL is parsed and rejected if
  malformed, non-http(s), carrying embedded credentials, or pointing at an
  IP literal/`localhost` (`src/providers/url-validation.ts`). The
  Instagram provider only recognizes an explicit host allowlist
  (`instagram.com`/`www`/`m`), not arbitrary subdomains. The downloader
  additionally re-validates every redirect hop against a per-provider CDN
  host allowlist and resolves + rejects private/loopback/link-local IPs
  (including the cloud-metadata address) before connecting
  (`src/media/downloader/ssrf.ts`).
- **No shell interpolation:** `yt-dlp` and `ffmpeg` are invoked via
  `execFile` with argument arrays (`src/util/subprocess.ts`) — never through
  a shell, so no untrusted input can break out into shell syntax.
- **No path traversal:** downloaded files are always written under a
  server-generated per-request temp directory with a randomly generated
  (UUID) filename — never derived from the remote URL or any user input.
- **Bounded everything:** hard size caps enforced _while streaming_ (not
  after buffering), hard duration caps, hard timeouts on every network/
  subprocess call, and a bounded concurrency gate (`src/util/semaphore.ts`)
  that fails fast with `RATE_LIMITED` instead of queuing unboundedly.
- **Guaranteed cleanup:** every request's temp workspace is removed in a
  `finally` block (`src/media/workspace.ts`), regardless of success,
  typed failure, or cancellation. Moreel does not persist user media.
- **No secret leakage:** typed errors carry a client-safe message/details;
  internal causes (stack traces, file paths, subprocess stderr) are logged
  server-side only, never serialized to the MCP client.

## 9. Development

```bash
npm run dev          # run the server from source (tsx), no build step
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
```

## 10. Testing

```bash
npm test                 # everything
npm run test:unit        # URL validation, provider selection, media limits,
                          # error mapping, normalization, config, cleanup, ...
npm run test:integration # full pipeline via TranscriptionService, mocked
                          # provider/transcriber, exact MCP output shape
npm run test:protocol    # real MCP Client <-> Server over an in-memory
                          # transport: init, tool discovery/schema,
                          # invocation, malformed args, typed errors
npm run test:regression  # transcription quality regression corpus (below)
```

All network access (HTTP downloads, the OpenAI API) and subprocess
execution (`yt-dlp`, `ffmpeg`) are mocked at their interface boundaries in
tests — no test depends on real binaries, real network access, or a
developer's local machine configuration.

### Regression corpus

`test/fixtures/regression/*.json` pins simulated transcription-provider
output for representative scenarios — clear speech, accents, fast speech,
background music, multiple speakers, silence, noisy audio, very short and
longer clips, non-English and mixed-language speech — each with an
expected transcript and a maximum acceptable WER. `test/regression/`
verifies timestamp validity, that silence never fabricates text, correct
low-confidence flagging, and that WER stays within threshold; a change
that regresses quality fails this suite. See
`test/fixtures/regression/README.md` for why these are fixtures rather
than real audio + a live paid API call in CI.

## 11. Benchmarking

```bash
npm run benchmark                # end-to-end pipeline latency, per stage
npm run benchmark:transcription  # WER/CER, latency, success rate over the
                                  # regression corpus; fails if any fixture
                                  # regresses past its WER threshold
```

Both write a timestamped JSON report to `benchmark-results/` (git-ignored)
so results can be tracked over time. Neither depends on real network/API
access by default — `npm run benchmark` runs the real
`TranscriptionService` (real caching, concurrency gate, metrics) against a
synthetic provider/transcriber with documented, realistic delays standing
in for network-bound work; `npm run benchmark:transcription` runs a
synthetic latency model over the regression corpus. Pass `--live` to
`benchmark:transcription` (with `OPENAI_API_KEY` and
`MOREEL_BENCHMARK_AUDIO_DIR` set to real `<fixture-id>.wav` files) to
benchmark the real configured provider instead.

Measured baseline in this environment (synthetic backend — see script
header comments for the exact model): stage latencies were dominated by
the simulated transcription-API call (~600-1500ms) and download
(~400-1100ms); `url_validation_ms` and `provider_resolution_ms` were both
sub-millisecond, comfortably inside the <10ms / <50ms targets below. Real
end-to-end numbers depend entirely on Instagram's CDN and the configured
transcription provider's latency and should be re-measured with `--live`
before relying on them.

Target latency for a typical 30-60s Reel (see spec section 18):

```
URL validation:              < 10 ms
Provider resolution:         < 50 ms
Media retrieval:             network-bound
Audio extraction:            < 500 ms
Transcription:                as fast as practical
End-to-end:                   ~2-5s after media is available
```

## 12. Limitations

- Instagram Reels only — no other platforms, no other Instagram content
  types.
- No visual understanding whatsoever: purely an audio transcript.
- Public content only; Moreel never bypasses authentication or anti-bot
  controls, so private/gated Reels fail with a typed error by design.
- Automatic transcription is best-effort, not human-verified; heavy
  accents, overlapping speakers, and noisy/musical audio reduce accuracy,
  surfaced via `low_confidence` rather than silently guessed.
- No diarization (who said what) in v0.1 — multi-speaker audio is
  transcribed in order without speaker labels.
- Single-process, in-memory cache/usage tracking — fine for one server
  instance, not yet horizontally scaled.
- SSRF protection resolves and checks DNS answers before connecting but
  cannot fully close a DNS-rebinding race by itself; see
  `src/media/downloader/ssrf.ts` for the documented residual risk and
  mitigations (host allowlisting, narrow set of dialed CDNs).

## 13. Roadmap

Explicitly out of scope for v0.1, in rough priority order for later:

1. Additional providers (TikTok, YouTube, X) behind the same
   `VideoProvider` interface.
2. Speaker diarization.
3. A local/self-hosted transcription tier (e.g. faster-whisper) for a
   lower-latency or lower-cost default, benchmarked against the hosted
   provider via the existing `Transcriber` abstraction.
4. Horizontal scaling (shared cache, distributed rate limiting) if a
   single-process deployment stops being sufficient — not before it's
   demonstrated to be a real bottleneck.

Explicitly **not** planned: video summarization, visual analysis/OCR,
embeddings/RAG, autonomous agents, a browser UI, or social-media
analytics — this project is a `video → transcript` primitive, not a
platform.

## 14. Contributing

Issues and PRs are welcome. `npm run typecheck && npm run lint && npm test`
should pass before opening one — CI runs the same checks (plus integration/
protocol/regression suites against real Postgres+Redis service containers)
on every PR.

## 15. License

MIT — see [LICENSE](./LICENSE).
