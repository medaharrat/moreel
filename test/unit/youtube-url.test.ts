import { describe, expect, it } from 'vitest';
import { isYouTubeVideoUrl, parseYouTubeVideoUrl } from '../../src/providers/youtube/url.js';

describe('parseYouTubeVideoUrl', () => {
  it.each([
    ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/shorts/aqz-KE-bpKQ/', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://youtube.com/watch?v=aqz-KE-bpKQ&t=10s', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ?t=5', 'aqz-KE-bpKQ'],
  ])('recognizes %s and extracts the video id', (raw, expectedId) => {
    const url = new URL(raw);
    expect(isYouTubeVideoUrl(url)).toBe(true);
    expect(parseYouTubeVideoUrl(url)?.videoId).toBe(expectedId);
  });

  it('normalizes a Short to a canonical URL', () => {
    const url = new URL('https://www.youtube.com/shorts/aqz-KE-bpKQ/');
    expect(parseYouTubeVideoUrl(url)?.normalizedUrl).toBe('https://www.youtube.com/shorts/aqz-KE-bpKQ');
  });

  it('normalizes a youtu.be link to the canonical watch URL', () => {
    const url = new URL('https://youtu.be/aqz-KE-bpKQ?t=5');
    expect(parseYouTubeVideoUrl(url)?.normalizedUrl).toBe('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  });

  it.each([
    'https://www.instagram.com/reel/CzX1abcD9Ef/', // wrong platform
    'https://evil.com/youtube.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/', // bare homepage
    'https://www.youtube.com/watch', // missing ?v=
    'https://www.youtube.com/channel/UCabc123', // channel page, not a video
  ])('does not recognize %s as a YouTube video URL', (raw) => {
    const url = new URL(raw);
    expect(isYouTubeVideoUrl(url)).toBe(false);
    expect(parseYouTubeVideoUrl(url)).toBeUndefined();
  });
});
