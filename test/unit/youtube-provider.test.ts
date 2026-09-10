import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YouTubeProvider } from '../../src/providers/youtube/youtube-provider.js';
import type { CommandResult, CommandRunner, RunOptions } from '../../src/util/subprocess.js';
import { CommandFailedError } from '../../src/util/subprocess.js';

function fakeRunner(handler: (command: string, args: string[]) => Promise<CommandResult>): CommandRunner {
  return { run: (command, args, _opts: RunOptions) => handler(command, args) };
}

const SHORT_URL = new URL('https://www.youtube.com/shorts/aqzKEbpKQtest');

const baseFetchOptions = {
  signal: new AbortController().signal,
  workDir: '/tmp/does-not-matter',
  maxSizeBytes: 100 * 1024 * 1024,
  maxDurationSeconds: 600,
  timeoutMs: 30_000,
};

describe('YouTubeProvider', () => {
  let workDir: string;

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('canHandle recognizes YouTube video/Shorts URLs and rejects everything else', () => {
    const provider = new YouTubeProvider({
      runner: fakeRunner(async () => ({ stdout: '{}', stderr: '', exitCode: 0 })),
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    });

    expect(provider.canHandle(SHORT_URL)).toBe(true);
    expect(provider.canHandle(new URL('https://www.tiktok.com/@user/video/123'))).toBe(false);
  });

  it('probes metadata (including creator info), then lets yt-dlp download the file directly', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-test-'));

    const probeInfo = JSON.stringify({
      duration: 45,
      filesize: 3_000_000,
      description: 'a description',
      uploader: 'Blender',
      uploader_url: 'https://www.youtube.com/@BlenderOfficial',
      like_count: 109_823,
      comment_count: 5100,
      timestamp: 1415628355,
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

    const provider = new YouTubeProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });
    const asset = await provider.fetch(SHORT_URL, { ...baseFetchOptions, workDir });

    expect(asset).toMatchObject({
      source: 'youtube',
      sourceUrl: 'https://www.youtube.com/shorts/aqzKEbpKQtest',
      caption: 'a description',
      creatorName: 'Blender',
      creatorUrl: 'https://www.youtube.com/@BlenderOfficial',
      likeCount: 109_823,
      commentCount: 5100,
      contentType: 'video/mp4',
    });
    expect(asset.filePath.startsWith(workDir)).toBe(true);
  });

  it('falls back to channel_url when uploader_url is absent', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-test-'));

    const probeInfo = JSON.stringify({
      duration: 20,
      uploader: 'Blender',
      channel_url: 'https://www.youtube.com/channel/UCabc123',
    });
    const runner = fakeRunner(async (_cmd, args) => {
      if (args.includes('-j')) return { stdout: probeInfo, stderr: '', exitCode: 0 };
      const outputIndex = args.indexOf('-o');
      const outputPath = args[outputIndex + 1]!;
      await writeFile(outputPath, Buffer.from('fake mp4 bytes'));
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const provider = new YouTubeProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

    const asset = await provider.fetch(SHORT_URL, { ...baseFetchOptions, workDir });
    expect(asset.creatorUrl).toBe('https://www.youtube.com/channel/UCabc123');
  });

  it('throws MEDIA_TOO_LONG before downloading when probed duration exceeds the limit', async () => {
    const probeInfo = JSON.stringify({ duration: 9999 });
    const runner = fakeRunner(async (_cmd, args) => {
      if (args.includes('-j')) return { stdout: probeInfo, stderr: '', exitCode: 0 };
      throw new Error('should not be reached');
    });
    const provider = new YouTubeProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

    await expect(provider.fetch(SHORT_URL, baseFetchOptions)).rejects.toMatchObject({ code: 'MEDIA_TOO_LONG' });
  });

  it('maps a yt-dlp "sign in" failure to AUTHENTICATION_REQUIRED', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError('yt-dlp', 1, 'ERROR: Sign in to confirm your age');
    });
    const provider = new YouTubeProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

    await expect(provider.fetch(SHORT_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('maps a yt-dlp download-phase failure to DOWNLOAD_FAILED', async () => {
    const probeInfo = JSON.stringify({ duration: 10 });
    const runner = fakeRunner(async (_cmd, args) => {
      if (args.includes('-j')) return { stdout: probeInfo, stderr: '', exitCode: 0 };
      throw new CommandFailedError('yt-dlp', 1, 'ERROR: network is unreachable');
    });
    const provider = new YouTubeProvider({ runner, ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

    await expect(provider.fetch(SHORT_URL, baseFetchOptions)).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  it('throws UNSUPPORTED_SOURCE if fetch is called with a non-YouTube URL', async () => {
    const provider = new YouTubeProvider({
      runner: fakeRunner(async () => ({ stdout: '{}', stderr: '', exitCode: 0 })),
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    });

    await expect(
      provider.fetch(new URL('https://www.instagram.com/reel/abc/'), baseFetchOptions),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
  });
});
