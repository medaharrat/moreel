/**
 * Instagram Reel URL recognition and normalization.
 *
 * Supported shapes (host must be exactly one of the allowlisted Instagram
 * hosts — subdomains of arbitrary attacker-controlled domains are rejected):
 *   https://www.instagram.com/reel/{shortcode}/
 *   https://www.instagram.com/reels/{shortcode}/
 *   https://www.instagram.com/{username}/reel/{shortcode}/
 *   https://instagram.com/reel/{shortcode}/
 *   with or without a trailing tracking query string (?igsh=...).
 */

const ALLOWED_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);

const REEL_PATH_PATTERN = /^\/(?:[a-zA-Z0-9_.]{1,64}\/)?reels?\/([a-zA-Z0-9_-]{5,64})\/?$/;

export function isInstagramHost(url: URL): boolean {
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

export interface InstagramReelRef {
  shortcode: string;
  normalizedUrl: string;
}

/** Returns the parsed reel reference, or undefined if the URL isn't a recognizable Reel URL. */
export function parseInstagramReelUrl(url: URL): InstagramReelRef | undefined {
  if (!isInstagramHost(url)) return undefined;
  const match = REEL_PATH_PATTERN.exec(url.pathname);
  if (!match) return undefined;
  const shortcode = match[1];
  if (!shortcode) return undefined;
  return {
    shortcode,
    normalizedUrl: `https://www.instagram.com/reel/${shortcode}/`,
  };
}

export function isInstagramReelUrl(url: URL): boolean {
  return parseInstagramReelUrl(url) !== undefined;
}
