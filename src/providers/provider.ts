import type { VideoAsset } from '../domain/transcript.js';
import type { ProviderHealth } from './protection/provider-health.js';

export interface FetchOptions {
  /** Aborts the fetch (download) when the MCP request is cancelled. */
  signal: AbortSignal;
  /** Directory to place the downloaded temporary file in. */
  workDir: string;
  maxSizeBytes: number;
  maxDurationSeconds: number;
  timeoutMs: number;
}

/**
 * A `VideoProvider` knows how to recognize URLs for one platform and turn
 * them into a normalized `VideoAsset` on local disk. This is the only
 * platform-specific abstraction in the system — everything above it (MCP
 * layer, application service) and below it (media/audio/transcription) is
 * provider-agnostic. Adding TikTok/YouTube/X later means adding another
 * class here, nothing else.
 */
export interface VideoProvider {
  readonly id: string;
  /** True if this provider recognizes and can handle the given URL. */
  canHandle(url: URL): boolean;
  /** Downloads the video/audio referenced by `url` into `options.workDir`. */
  fetch(url: URL, options: FetchOptions): Promise<VideoAsset>;
  /**
   * Canonical content identity for `url` (e.g. an Instagram shortcode),
   * stable across cosmetic URL differences (tracking params, alternate
   * path shapes) that still point at the same content. Used for cache
   * keys instead of the raw URL where available. Optional — providers
   * without a natural canonical ID fall back to normalized-URL keying.
   */
  contentId?(url: URL): string | undefined;
}

/** Selects the first registered provider that can handle a URL. */
export class ProviderRegistry {
  private readonly providers: VideoProvider[];

  constructor(providers: VideoProvider[]) {
    this.providers = providers;
  }

  resolve(url: URL): VideoProvider | undefined {
    return this.providers.find((provider) => provider.canHandle(url));
  }

  list(): readonly VideoProvider[] {
    return this.providers;
  }

  /** Health of a specific provider, if it reports one (e.g. `ProtectedProvider`). Undefined otherwise. */
  async getHealth(providerId: string): Promise<ProviderHealth | undefined> {
    const provider = this.providers.find((p) => p.id === providerId) as
      | (VideoProvider & { getHealth?: () => Promise<ProviderHealth> })
      | undefined;
    return provider?.getHealth?.();
  }
}
