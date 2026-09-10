import { describe, expect, it } from 'vitest';
import { isInstagramReelUrl, parseInstagramReelUrl } from '../../src/providers/instagram/url.js';

describe('parseInstagramReelUrl', () => {
  it.each([
    'https://www.instagram.com/reel/CzX1abcD9Ef/',
    'https://www.instagram.com/reel/CzX1abcD9Ef',
    'https://instagram.com/reel/CzX1abcD9Ef/',
    'https://www.instagram.com/reels/CzX1abcD9Ef/',
    'https://www.instagram.com/someuser/reel/CzX1abcD9Ef/',
    'https://www.instagram.com/reel/CzX1abcD9Ef/?igsh=abc123',
    'https://m.instagram.com/reel/CzX1abcD9Ef/',
  ])('recognizes %s as a Reel URL', (raw) => {
    const url = new URL(raw);
    expect(isInstagramReelUrl(url)).toBe(true);
    expect(parseInstagramReelUrl(url)?.shortcode).toBe('CzX1abcD9Ef');
  });

  it('normalizes to a canonical URL regardless of query string or trailing slash', () => {
    const url = new URL('https://www.instagram.com/reel/CzX1abcD9Ef?igsh=xyz');
    expect(parseInstagramReelUrl(url)?.normalizedUrl).toBe(
      'https://www.instagram.com/reel/CzX1abcD9Ef/',
    );
  });

  it.each([
    'https://www.instagram.com/p/CzX1abcD9Ef/', // photo post, not a reel
    'https://www.instagram.com/stories/someuser/12345/', // story
    'https://www.instagram.com/someuser/', // profile
    'https://www.tiktok.com/@user/video/12345',
    'https://evil.com/instagram.com/reel/CzX1abcD9Ef/',
    'https://instagram.com.evil.com/reel/CzX1abcD9Ef/',
    'https://www.instagram.com/reel/', // missing shortcode
  ])('does not recognize %s as a Reel URL', (raw) => {
    const url = new URL(raw);
    expect(isInstagramReelUrl(url)).toBe(false);
    expect(parseInstagramReelUrl(url)).toBeUndefined();
  });
});
