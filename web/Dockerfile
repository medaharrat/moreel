# syntax=docker/dockerfile:1

# ---- builder ---------------------------------------------------------------
FROM node:22.14.0-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Vite inlines env vars at build time, so the backend URL must be baked in
# here rather than read at container start. Override with --build-arg for
# a non-default deployment (e.g. a different host/port for the API).
ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
