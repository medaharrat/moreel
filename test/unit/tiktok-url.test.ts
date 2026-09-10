import { describe, expect, it } from 'vitest';
import { isTikTokVideoUrl, parseTikTokVideoUrl } from '../../src/providers/tiktok/url.js';

describe('parseTikTokVideoUrl', () => {
  it.each([
    'https://www.tiktok.com/@scout2015/video/6718335390845095173',
    'https://tiktok.com/@scout2015/video/6718335390845095173',
    'https://www.tiktok.com/@scout2015/video/6718335390845095173/',
  ])('recognizes %s and extracts the video id', (raw) => {
    const url = new URL(raw);
    expect(isTikTokVideoUrl(url)).toBe(true);
    expect(parseTikTokVideoUrl(url)?.videoId).toBe('6718335390845095173');
  });

  it('normalizes to a canonical URL', () => {
    const url = new URL('https://tiktok.com/@scout2015/video/6718335390845095173/');
    expect(parseTikTokVideoUrl(url)?.normalizedUrl).toBe(
      'https://www.tiktok.com/@scout2015/video/6718335390845095173',
    );
  });

  it.each(['https://vm.tiktok.com/ZMabc123/', 'https://vt.tiktok.com/ZMabc123/', 'https://www.tiktok.com/t/ZMabc123/'])(
    'recognizes short link %s but has no extractable video id',
    (raw) => {
      const url = new URL(raw);
      expect(isTikTokVideoUrl(url)).toBe(true);
      expect(parseTikTokVideoUrl(url)?.videoId).toBeUndefined();
    },
  );

  it.each([
    'https://www.instagram.com/reel/CzX1abcD9Ef/', // wrong platform
    'https://evil.com/tiktok.com/@user/video/123',
    'https://tiktok.com.evil.com/@user/video/123',
    'https://www.tiktok.com/', // bare homepage
    'https://www.tiktok.com', // bare homepage, no trailing slash
  ])('does not recognize %s as a TikTok URL', (raw) => {
    const url = new URL(raw);
    expect(isTikTokVideoUrl(url)).toBe(false);
    expect(parseTikTokVideoUrl(url)).toBeUndefined();
  });
});
