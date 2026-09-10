import type { VideoPlatform, VideoType, VideoUrl } from '../types';

interface PlatformMatcher {
  platform: VideoPlatform;
  pattern: RegExp;
  type: (url: string) => VideoType;
}

const MATCHERS: PlatformMatcher[] = [
  {
    platform: 'instagram',
    pattern: /https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[a-zA-Z0-9_-]+/i,
    type: (url) => (/\/(reel|reels)\//i.test(url) ? 'reel' : 'post'),
  },
  {
    platform: 'tiktok',
    pattern: /https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/i,
    type: () => 'video',
  },
  {
    platform: 'youtube',
    pattern: /https?:\/\/(www\.)?youtube\.com\/shorts\/[a-zA-Z0-9_-]+/i,
    type: () => 'short',
  },
  {
    platform: 'youtube',
    pattern:
      /https?:\/\/(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i,
    type: () => 'video',
  },
];

/**
 * Scans free-form text (a bare URL, or a URL surrounded by other text)
 * for the first supported video link and identifies its platform.
 */
export function detectVideoUrl(text: string): VideoUrl | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const matcher of MATCHERS) {
    const match = trimmed.match(matcher.pattern);
    if (match) {
      const url = match[0].replace(/[),.;!?]+$/, '');
      return { url, platform: matcher.platform, type: matcher.type(url) };
    }
  }

  return null;
}

export const PLATFORM_LABEL: Record<VideoPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

export function describeVideo(video: VideoUrl): string {
  if (video.platform === 'instagram') {
    return video.type === 'reel' ? 'Instagram Reel' : 'Instagram Post';
  }
  if (video.platform === 'tiktok') {
    return 'TikTok Video';
  }
  return video.type === 'short' ? 'YouTube Short' : 'YouTube Video';
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '');
}
