<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/moreel-logo-dark.svg">
    <img src="public/brand/moreel-logo.svg" alt="Moreel" width="360">
  </picture>

  <p><strong>There's more in every video.</strong></p>

  <p>
    Paste a public Reel, TikTok, or YouTube Short. Get back a searchable,
    timestamped transcript — plus what was <em>shown</em>, not just said.
  </p>

  [![CI](https://github.com/medaharrat/moreel/actions/workflows/ci.yml/badge.svg)](https://github.com/medaharrat/moreel/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
  [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![MCP compatible](https://img.shields.io/badge/MCP-compatible-6A00DE)](https://modelcontextprotocol.io)
</div>

---

Most video-to-transcript tools stop at the audio. Moreel treats the video
itself as the source of truth: it transcribes what was **said**, reads what
was **shown** (on-screen text, slides, charts, products), and resolves what
a vague "this one" or a pointing gesture actually **meant** — then makes all
of it searchable and jumpable, down to the exact second.

It's built to be used three ways:

- **As a web app** — paste a URL, get video + transcript side by side, with
  in-transcript search and a "what did I miss?" panel for anything shown but
  never said out loud.
- **As an HTTP API** — the same pipeline, for your own backend/integration.
- **As an MCP server** — a set of tools (`understand_video`, `search_video`,
  `find_moment`, `get_video_map`, ...) so an AI agent can query a video
  without ever "watching" it or scrubbing through a transcript by hand.

## 1. What it does

- **Transcription** — accurate, timestamped speech-to-text (OpenAI Whisper),
  adaptively re-chunked from word-level timestamps so a segment reflects how
  the person actually spoke, not an arbitrary decode boundary.
- **Visual understanding** _(opt-in)_ — bounded frame sampling + a vision
  model surfaces on-screen text, slides, charts, products, and scene
  context, kept as a separate layer from the transcript, never merged into
  it.
- **The Video Map** _(opt-in, layered on visual understanding)_ — resolves
  "this"/"that"/"this one" and pointing/showing/holding gestures to a
  specific visual entity, with a confidence level and never a fabricated
  target when the evidence is weak.
- **Unified search** — one query surfaces matches across speech, on-screen
  text, and resolved references, each labeled by source and one click from
  seeking the player. Lexical by default; opt-in embeddings add semantic
  matching (a query for "cost" also finds on-screen text that says
  "pricing").
- **"What did I miss?"** — surfaces exactly what was visible but never said,
  classified (on-screen text, visual context, an unspoken visual reference,
  ...), each anchored to a timestamp — never a generic summary.

Supported sources: public Instagram Reels, TikTok videos, and YouTube
videos/Shorts. Private, login-gated, or otherwise access-controlled content
is never attempted — it fails with a typed error by design.

## 2. Installation

Requirements:

- Node.js >= 22
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH` (or set `YTDLP_PATH`)
- [`ffmpeg`](https://ffmpeg.org/) on `PATH` (or set `FFMPEG_PATH`)
- An OpenAI API key (transcription; also vision/Video Map/embeddings if you
  enable those)

```bash
git clone https://github.com/medaharrat/moreel.git
cd moreel
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY

cd web && npm install && cd ..
```

## 3. Running it

**Quickest path — Docker Compose** (API + web UI + Postgres + Redis):

```bash
export OPENAI_API_KEY=sk-...
# optional: export VISION_ENABLED=true VIDEO_MAP_ENABLED=true
docker compose -f docker-compose.prod.yml up --build
```

Web UI at `http://localhost:3001`, API at `http://localhost:8080`.

**From source, without Docker:**

```bash
npm run build && npm run migrate:up   # Postgres schema (optional — see below)

npm run dev:http     # HTTP API + web-facing endpoints, from source
cd web && npm run dev  # web UI (separate terminal)

npm run dev           # or: the MCP server over stdio, for an agent client
```

Postgres/Redis are optional in development — without `DATABASE_URL`, video
records fall back to an in-process cache; without `REDIS_URL`, rate
limiting/dedup fall back to in-memory, single-replica-only behavior.

## 4. Configuration

All configuration is via environment variables — see `.env.example` for the
full, documented list. The important ones:

| Variable                     | Default   | Purpose                                                             |
| ----------------------------- | --------- | -------------------------------------------------------------------- |
| `OPENAI_API_KEY`              | _required_ | Transcription (and vision/Video Map/embeddings, if enabled)         |
| `VISION_ENABLED`              | `false`   | On-screen text/scene understanding alongside the transcript          |
| `VIDEO_MAP_ENABLED`           | `false`   | Resolve "this"/"that"/pointing references (requires `VISION_ENABLED`) |
| `SEARCH_EMBEDDINGS_ENABLED`   | `false`   | Semantic matching on top of lexical search                           |
| `MAX_VIDEO_SIZE_MB`           | `100`     | Reject media larger than this                                        |
| `MAX_VIDEO_DURATION_SECONDS`  | `600`     | Reject media longer than this                                        |
| `MAX_CONCURRENT_REQUESTS`     | `4`       | Bounded concurrency; excess fails fast with `RATE_LIMITED`           |
| `CACHE_ENABLED`               | `true`    | Cache processed videos (in-memory, or Postgres/Redis if configured)  |
| `DATABASE_URL`                | _(none)_  | Enables durable, cross-replica video storage + accounts/API keys     |
| `REDIS_URL`                   | _(none)_  | Enables distributed rate limiting/dedup                              |
| `LOG_LEVEL`                   | `info`    | Structured log verbosity                                             |

Never hardcode secrets — always via environment/`.env`.

## 5. MCP tools

Point any MCP client at `node dist/mcp/server.js` (stdio transport):

```json
{
  "mcpServers": {
    "moreel": {
      "command": "node",
      "args": ["/absolute/path/to/moreel/dist/mcp/server.js"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

| Tool                 | Does                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `transcribe_video`    | Speech only — timestamped transcript, opt-in visual observations      |
| `understand_video`    | Speech + visual understanding, always on — entry point for most agent use |
| `search_video`        | Query across speech, on-screen text, and resolved references          |
| `find_moment`         | The single best timestamped answer to a specific question             |
| `get_video_timeline`  | The full chronological merge of every modality                        |
| `get_video_map`       | Entities, interactions, and references the Video Map resolved         |
| `get_video_entity`    | Everything tied to one specific entity (every mention, every moment)  |
| `get_video_evidence`  | The underlying evidence behind one specific map fact, by id           |

`search_video`/`find_moment`/`get_video_map` operate on a `video_id`
returned by a prior `transcribe_video`/`understand_video` call — an agent
watches a video once, then queries it repeatedly without re-processing.

Every response is structured JSON — timestamps, confidence, and
observed/inferred/uncertain evidence levels — never prose an agent has to
parse.

## 6. Architecture

```
INGEST          src/providers/     VideoProvider interface; Instagram/TikTok/YouTube
                                     (yt-dlp), each behind a circuit breaker + rate limit
      ↓
MEDIA            src/media/         SSRF-guarded download, audio extraction, bounded
                                     frame sampling (periodic + scene-change)
      ↓
TRANSCRIPTION    src/transcription/ Transcriber interface; OpenAI Whisper; word-timestamp
                                     re-chunking; hallucination/confidence normalization
      ↓
VISION           src/vision/        VisionProvider (on-screen text/scene) +
                                     VideoInteractionAnalyzer (the Video Map), opt-in
      ↓
APPLICATION      src/app/           Timeline merge, lexical+semantic search, "what did I
                                     miss", video-map resolution — orchestration only,
                                     never provider-specific
      ↓
TRANSPORTS       src/mcp/           MCP tools (stdio)
                 src/http/          Web UI's API + REST-ish JSON routes
```

`src/domain/` holds the shared types (`Transcript`, `VisualObservation`,
`VideoRecord`, the Video Map's `Interaction`/`LinguisticReference`) and a
typed `MoreelError` taxonomy — nothing above it knows which platform or
which model vendor produced the data. Adding a platform means one more
`VideoProvider`; adding a model vendor means one more `Transcriber`/
`VisionProvider` — nothing else changes.

Cross-cutting concerns live alongside, not inside, the pipeline:
`src/cache/`, `src/observability/`, `src/usage/`, `src/config/`, `src/util/`.

### Security posture

- **URL validation & SSRF protection** — every input URL is parsed and
  rejected if malformed, non-http(s), or pointing at a private/loopback/
  link-local IP (including the cloud-metadata address); redirects are
  re-validated the same way (`src/media/downloader/ssrf.ts`).
- **No shell interpolation** — `yt-dlp`/`ffmpeg` run via `execFile` with
  argument arrays, never a shell.
- **No path traversal** — downloaded files live under a server-generated,
  randomly named per-request temp directory, always cleaned up in a
  `finally` block, regardless of success or failure.
- **Bounded everything** — size/duration caps enforced while streaming,
  hard timeouts on every network/subprocess call, bounded concurrency that
  fails fast (`RATE_LIMITED`) instead of queuing unboundedly.
- **No secret leakage** — typed errors carry a client-safe message; stack
  traces, file paths, and provider internals are logged server-side only.
- **Bounded-retention storage, not an archive** — processed videos (when
  persisted to Postgres/Redis) carry an explicit TTL and are treated as a
  cache, matching the same minimal-retention principle as the in-process
  cache. See `docs/privacy.md`.

## 7. Development

```bash
npm run dev          # MCP server from source (tsx), no build step
npm run dev:http      # HTTP API from source
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
```

## 8. Testing

```bash
npm test                 # everything
npm run test:unit        # provider selection, media limits, normalization,
                          # timeline/search/video-map resolution, config, ...
npm run test:integration # full pipeline, real Postgres video-store round-trips
npm run test:protocol    # real MCP Client <-> Server over an in-memory transport
npm run test:regression  # transcription quality regression corpus
```

All network access and subprocess execution (`yt-dlp`, `ffmpeg`, the OpenAI
API) are mocked at their interface boundaries in unit/protocol tests — the
integration suite's Postgres-backed tests are the exception, and skip
automatically when `DATABASE_URL` isn't reachable.

## 9. Limitations

- Public content only, by design — Moreel never bypasses login, CAPTCHAs,
  or other access controls.
- Automatic transcription/visual analysis is best-effort, not
  human-verified — surfaced via `low_confidence`/`evidenceLevel` rather
  than silently guessed.
- No speaker diarization — multi-speaker audio transcribes in order without
  speaker labels (Whisper doesn't expose this).
- The Video Map doesn't track entity identity via visual similarity across
  a whole video — it relies on the model reusing a consistent label for a
  recurring entity within one analysis pass.
- Video Map events don't yet carry their own evidence frame thumbnail
  (timestamp + confidence still make them fully traceable via the player).

## 10. Contributing

Issues and PRs are welcome. `npm run typecheck && npm run lint && npm test`
should pass before opening one — CI runs the same checks (plus
integration/protocol/regression suites against real Postgres+Redis service
containers) on every PR.

## 11. License

MIT — see [LICENSE](./LICENSE).
