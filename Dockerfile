# syntax=docker/dockerfile:1

# ---- builder ---------------------------------------------------------------
FROM node:22.14.0-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

# Production-only node_modules, separate from the build's devDependencies.
RUN npm ci --omit=dev --ignore-scripts

# ---- runtime -----------------------------------------------------------------
FROM node:22.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Set automatically by `docker build`/buildx for the target platform
# (amd64 or arm64) — used below to pick the matching yt-dlp binary so this
# image is portable across Fly.io's amd64 machines and local Apple Silicon.
ARG TARGETARCH

# ffmpeg + yt-dlp are external runtime dependencies of the transcription
# pipeline (see README). yt-dlp is pinned to a specific release rather than
# "latest" so the image is reproducible — bump deliberately. Uses the
# standalone PyInstaller-built binary (no Python runtime required), not the
# plain `yt-dlp` release asset, which is a zipapp that needs python3 on
# PATH — this image intentionally doesn't carry a Python interpreter.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && YTDLP_ASSET=$([ "$TARGETARCH" = "arm64" ] && echo yt-dlp_linux_aarch64 || echo yt-dlp_linux) \
    && curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/${YTDLP_ASSET}" \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system moreel && useradd --system --gid moreel --home /app moreel

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY package.json ./

RUN chown -R moreel:moreel /app
USER moreel

# HTTP_PORT default from src/config/index.ts; override via env at deploy time.
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Configurable concurrency (MAX_CONCURRENT_REQUESTS, INSTAGRAM_MAX_CONCURRENCY,
# etc.) comes entirely from env — no code change needed to tune it per
# deployment. No secrets are baked into this image; all of them (API keys,
# DATABASE_URL, REDIS_URL, STRIPE_*) are supplied at runtime.
CMD ["node", "--import", "./dist/observability/tracing-bootstrap.js", "dist/http/main.js"]
