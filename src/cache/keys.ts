import { createHash } from 'node:crypto';
import { normalizeUrlForCache } from './cache.js';
import type { VideoProvider } from '../providers/provider.js';

/**
 * Bumped whenever the shape of a cached value changes incompatibly — old
 * entries simply become unreachable (and expire via their own TTL) rather
 * than needing an explicit flush.
 */
export const CACHE_SCHEMA_VERSION = 'v1';

/**
 * Prefer a provider's canonical content identity (e.g. an Instagram
 * shortcode) over the raw/normalized URL: two share-link variants of the
 * same content should hit the same cache entry.
 */
export function contentIdentity(provider: VideoProvider, url: URL): string {
  return provider.contentId?.(url) ?? normalizeUrlForCache(url.toString());
}

export function transcriptCacheKey(provider: VideoProvider, url: URL): string {
  return `${CACHE_SCHEMA_VERSION}:transcript:${provider.id}:${contentIdentity(provider, url)}`;
}

/**
 * Stable id for a `VideoRecord` — deterministic from the provider + content
 * identity, so re-processing the same URL (or a cosmetic variant of it)
 * always resolves to the same video id without needing a separate
 * URL-to-id index. Short and hex-only so it's safe to embed in MCP tool
 * inputs/outputs and URL paths without escaping.
 */
export function computeVideoId(provider: VideoProvider, url: URL): string {
  const identity = `${provider.id}:${contentIdentity(provider, url)}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}
