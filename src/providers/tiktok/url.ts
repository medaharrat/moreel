/**
 * TikTok URL recognition and normalization.
 *
 * Supported shapes (host must be exactly one of the allowlisted TikTok
 * hosts — subdomains of arbitrary attacker-controlled domains are rejected):
 *   https://www.tiktok.com/@{username}/video/{id}
 *   https://tiktok.com/@{username}/video/{id}
 *   https://vm.tiktok.com/{shortcode}/   (short link — no id in the URL itself)
 *   https://vt.tiktok.com/{shortcode}/   (short link)
 *   https://www.tiktok.com/t/{shortcode}/ (short link)
 *
 * Short links carry no extractable video id without following a redirect —
 * yt-dlp resolves those itself, so they're passed through unchanged with no
 * `videoId` (cache falls back to normalized-URL keying for those).
 */

const ALLOWED_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

const VIDEO_PATH_PATTERN = /^\/(@[\w.-]{1,64})\/video\/(\d{5,25})\/?$/;

export interface TikTokVideoRef {
  /** Undefined for short links that need yt-dlp's own redirect resolution. */
  videoId: string | undefined;
  normalizedUrl: string;
}

export function isTikTokHost(url: URL): boolean {
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

export function parseTikTokVideoUrl(url: URL): TikTokVideoRef | undefined {
  if (!isTikTokHost(url)) return undefined;
  if (url.pathname === '' || url.pathname === '/') return undefined;

  const match = VIDEO_PATH_PATTERN.exec(url.pathname);
  if (match) {
    const [, username, videoId] = match;
    return { videoId, normalizedUrl: `https://www.tiktok.com/${username}/video/${videoId}` };
  }

  return { videoId: undefined, normalizedUrl: url.toString() };
}

export function isTikTokVideoUrl(url: URL): boolean {
  return parseTikTokVideoUrl(url) !== undefined;
}
