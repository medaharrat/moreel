/**
 * YouTube URL recognition and normalization (Shorts and regular videos —
 * anything long-form works the same as a Short through this pipeline,
 * just takes longer to transcribe and is still subject to `maxDurationSeconds`).
 *
 * Supported shapes (host must be exactly one of the allowlisted YouTube
 * hosts — subdomains of arbitrary attacker-controlled domains are rejected):
 *   https://www.youtube.com/watch?v={id}
 *   https://www.youtube.com/shorts/{id}
 *   https://youtu.be/{id}
 */

const ALLOWED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{6,20}$/;

export interface YouTubeVideoRef {
  videoId: string;
  normalizedUrl: string;
}

export function isYouTubeHost(url: URL): boolean {
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

export function parseYouTubeVideoUrl(url: URL): YouTubeVideoRef | undefined {
  if (!isYouTubeHost(url)) return undefined;
  const host = url.hostname.toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    if (id && VIDEO_ID_PATTERN.test(id)) {
      return { videoId: id, normalizedUrl: `https://www.youtube.com/watch?v=${id}` };
    }
    return undefined;
  }

  const shortsMatch = /^\/shorts\/([a-zA-Z0-9_-]{6,20})\/?$/.exec(url.pathname);
  if (shortsMatch?.[1]) {
    return { videoId: shortsMatch[1], normalizedUrl: `https://www.youtube.com/shorts/${shortsMatch[1]}` };
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    if (id && VIDEO_ID_PATTERN.test(id)) {
      return { videoId: id, normalizedUrl: `https://www.youtube.com/watch?v=${id}` };
    }
  }

  return undefined;
}

export function isYouTubeVideoUrl(url: URL): boolean {
  return parseYouTubeVideoUrl(url) !== undefined;
}
