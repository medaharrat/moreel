import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TikTokProvider } from '../../src/providers/tiktok/tiktok-provider.js';
import type { CommandResult, CommandRunner, RunOptions } from '../../src/util/subprocess.js';
import { CommandFailedError } from '../../src/util/subprocess.js';

function fakeRunner(handler: (command: string, args: string[]) => Promise<CommandResult>): CommandRunner {
  return { run: (command, args, _opts: RunOptions) => handler(command, args) };
}

const VIDEO_URL = new URL('https://www.tiktok.com/@scout2015/video/6718335390845095173');

const baseFetchOptions = {
  signal: new AbortController().signal,
  workDir: '/tmp/does-not-matter',
  maxSizeBytes: 100 * 1024 * 1024,
  maxDurationSeconds: 600,
  timeoutMs: 30_000,
};

describe('TikTokProvider', () => {
  let workDir: string;

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('canHandle recognizes TikTok video URLs and rejects everything else', () => {
    const provider = new TikTokProvider({
      runner: fakeRunner(async () => ({ stdout: '{}', stderr: '', exitCode: 0 })),
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    });

    expect(provider.canHandle(VIDEO_URL)).toBe(true);
    expect(provider.canHandle(new URL('https://www.youtube.com/watch?v=1'))).toBe(false);
  });

  it('probes metadata (including creator info), then lets yt-dlp download the file directly', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-test-'));

    const probeInfo = JSON.stringify({
      duration: 10,
      filesize: 2_000_000,
      description: 'a caption #foryoupage',
      uploader: 'scout2015',
      uploader_url: 'https://www.tiktok.com/@scout2015',
      like_count: 35_100,
      comment_count: 5632,
      timestamp: 1564234358,
    });

    const runner = fakeRunner(async (command, args) => {
      expect(command).toBe('yt-dlp');
      if (args.includes('-j')) {
        return { stdout: probeInfo, stderr: '', exitCode: 0 };
      }
      expect(args).toContain('--max-filesize');
      expect(args).toContain('--merge-output-format');
      const outputIndex = args.indexOf('-o');
      const outputPath = args[outputIndex + 1]!;
      await writeFile(outputPath, Buffer.from('fake downloaded mp4 bytes'));
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const provider = new TikTokProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });
    const asset = await provider.fetch(VIDEO_URL, { ...baseFetchOptions, workDir });

    expect(asset).toMatchObject({
      source: 'tiktok',
      sourceUrl: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
      caption: 'a caption #foryoupage',
      creatorName: 'scout2015',
      creatorUrl: 'https://www.tiktok.com/@scout2015',
      likeCount: 35_100,
      commentCount: 5632,
      contentType: 'video/mp4',
    });
    expect(asset.filePath.startsWith(workDir)).toBe(true);
  });

  it('throws MEDIA_TOO_LONG before downloading when probed duration exceeds the limit', async () => {
    const probeInfo = JSON.stringify({ duration: 9999 });
    const runner = fakeRunner(async (_cmd, args) => {
      if (args.includes('-j')) return { stdout: probeInfo, stderr: '', exitCode: 0 };
      throw new Error('should not be reached');
    });
    const provider = new TikTokProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

    await expect(provider.fetch(VIDEO_URL, baseFetchOptions)).rejects.toMatchObject({ code: 'MEDIA_TOO_LONG' });
  });

  it('maps a yt-dlp "private account" failure to AUTHENTICATION_REQUIRED', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError('yt-dlp', 1, 'ERROR: [TikTok] This account is private');
    });
    const provider = new TikTokProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

    await expect(provider.fetch(VIDEO_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('maps a yt-dlp download-phase failure to DOWNLOAD_FAILED', async () => {
    const probeInfo = JSON.stringify({ duration: 10 });
    const runner = fakeRunner(async (_cmd, args) => {
      if (args.includes('-j')) return { stdout: probeInfo, stderr: '', exitCode: 0 };
      throw new CommandFailedError('yt-dlp', 1, 'ERROR: network is unreachable');
    });
    const provider = new TikTokProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

    await expect(provider.fetch(VIDEO_URL, baseFetchOptions)).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  it('throws UNSUPPORTED_SOURCE if fetch is called with a non-TikTok URL', async () => {
    const provider = new TikTokProvider({
      runner: fakeRunner(async () => ({ stdout: '{}', stderr: '', exitCode: 0 })),
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    });

    await expect(
      provider.fetch(new URL('https://www.instagram.com/reel/abc/'), baseFetchOptions),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
  });
});
