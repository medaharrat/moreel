import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramProvider } from '../../src/providers/instagram/instagram-provider.js';
import type { CommandResult, CommandRunner, RunOptions } from '../../src/util/subprocess.js';
import { CommandFailedError } from '../../src/util/subprocess.js';
import type {
  DownloadedFile,
  DownloadRequest,
  HttpDownloader,
} from '../../src/media/downloader/http-downloader.js';
import { MoreelError } from '../../src/domain/errors.js';

function fakeRunner(
  handler: (command: string, args: string[]) => Promise<CommandResult>,
): CommandRunner {
  return { run: (command, args, _opts: RunOptions) => handler(command, args) };
}

function fakeDownloader(
  handler: (req: DownloadRequest) => Promise<DownloadedFile>,
): HttpDownloader {
  return { download: handler } as unknown as HttpDownloader;
}

const REEL_URL = new URL('https://www.instagram.com/reel/CzTest123/');

const baseFetchOptions = {
  signal: new AbortController().signal,
  workDir: '/tmp/does-not-matter',
  maxSizeBytes: 100 * 1024 * 1024,
  maxDurationSeconds: 600,
  timeoutMs: 30_000,
};

describe('InstagramProvider', () => {
  it('canHandle recognizes Reel URLs and rejects everything else', () => {
    const provider = new InstagramProvider({
      runner: fakeRunner(async () => ({ stdout: '{}', stderr: '', exitCode: 0 })),
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(async () => ({
        filePath: '/x',
        sizeBytes: 1,
        contentType: 'video/mp4',
      })),
    });

    expect(provider.canHandle(REEL_URL)).toBe(true);
    expect(provider.canHandle(new URL('https://www.youtube.com/watch?v=1'))).toBe(false);
  });

  it('probes metadata, then downloads the resolved media URL through the shared downloader', async () => {
    const probeInfo = JSON.stringify({
      duration: 12.5,
      filesize: 1024,
      url: 'https://x.cdninstagram.com/v.mp4',
    });
    const runner = fakeRunner(async (_cmd, args) => {
      expect(args).toContain('-j');
      return { stdout: probeInfo, stderr: '', exitCode: 0 };
    });
    const downloadSpy = vi.fn(async (req: DownloadRequest) => {
      expect(req.url).toBe('https://x.cdninstagram.com/v.mp4');
      expect(req.allowedHostSuffixes).toContain('cdninstagram.com');
      return { filePath: '/tmp/video.mp4', sizeBytes: 1024, contentType: 'video/mp4' };
    });

    const provider = new InstagramProvider({
      runner,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(downloadSpy),
    });
    const asset = await provider.fetch(REEL_URL, baseFetchOptions);

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(asset).toMatchObject({
      filePath: '/tmp/video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
      durationSeconds: 12.5,
      source: 'instagram',
      sourceUrl: 'https://www.instagram.com/reel/CzTest123/',
    });
  });

  it('throws MEDIA_TOO_LONG before downloading when probed duration exceeds the limit', async () => {
    const probeInfo = JSON.stringify({ duration: 9999, url: 'https://x.cdninstagram.com/v.mp4' });
    const runner = fakeRunner(async () => ({ stdout: probeInfo, stderr: '', exitCode: 0 }));
    const downloadSpy = vi.fn();

    const provider = new InstagramProvider({
      runner,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(downloadSpy),
    });

    await expect(provider.fetch(REEL_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'MEDIA_TOO_LONG',
    });
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('throws MEDIA_TOO_LARGE before downloading when probed filesize exceeds the limit', async () => {
    const probeInfo = JSON.stringify({
      duration: 30,
      filesize_approx: 500 * 1024 * 1024,
      url: 'https://x.cdninstagram.com/v.mp4',
    });
    const runner = fakeRunner(async () => ({ stdout: probeInfo, stderr: '', exitCode: 0 }));
    const downloadSpy = vi.fn();

    const provider = new InstagramProvider({
      runner,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(downloadSpy),
    });

    await expect(provider.fetch(REEL_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'MEDIA_TOO_LARGE',
    });
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('maps a yt-dlp "login required" failure to AUTHENTICATION_REQUIRED', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError(
        'yt-dlp',
        1,
        'ERROR: [Instagram] Login required to view this content',
      );
    });
    const provider = new InstagramProvider({
      runner,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(async () => {
        throw new Error('should not be reached');
      }),
    });

    await expect(provider.fetch(REEL_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('maps a yt-dlp "not found" failure to CONTENT_UNAVAILABLE', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError(
        'yt-dlp',
        1,
        'ERROR: [Instagram] Unable to extract; content unavailable',
      );
    });
    const provider = new InstagramProvider({
      runner,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(async () => {
        throw new Error('should not be reached');
      }),
    });

    await expect(provider.fetch(REEL_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE',
    });
  });

  it('maps an unrecognized yt-dlp failure to DOWNLOAD_FAILED', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError('yt-dlp', 1, 'ERROR: something unexpected happened');
    });
    const provider = new InstagramProvider({
      runner,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(async () => {
        throw new Error('should not be reached');
      }),
    });

    await expect(provider.fetch(REEL_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
  });

  it('throws UNSUPPORTED_SOURCE if fetch is called with a non-Reel URL', async () => {
    const provider = new InstagramProvider({
      runner: fakeRunner(async () => ({ stdout: '{}', stderr: '', exitCode: 0 })),
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(async () => {
        throw new Error('should not be reached');
      }),
    });

    await expect(
      provider.fetch(new URL('https://www.instagram.com/p/notareel/'), baseFetchOptions),
    ).rejects.toBeInstanceOf(MoreelError);
  });

  it('surfaces CONTENT_UNAVAILABLE when yt-dlp returns unparseable JSON', async () => {
    const runner = fakeRunner(async () => ({ stdout: 'not json', stderr: '', exitCode: 0 }));
    const provider = new InstagramProvider({
      runner,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloader: fakeDownloader(async () => {
        throw new Error('should not be reached');
      }),
    });

    await expect(provider.fetch(REEL_URL, baseFetchOptions)).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE',
    });
  });

  describe('DASH-only Reels (no progressive video+audio format)', () => {
    let workDir: string;

    afterEach(async () => {
      if (workDir) await rm(workDir, { recursive: true, force: true });
    });

    it('downloads the separate video and audio streams and muxes them, instead of silently picking audio-only', async () => {
      workDir = await mkdtemp(path.join(tmpdir(), 'moreel-test-'));

      // Mirrors real Instagram DASH responses: no top-level `url`, and every
      // format is either video-only or audio-only — never both. Regression
      // coverage for the bug where `findBestFormatUrl` picked the first
      // format merely *containing* an audio codec, landing on an
      // audio-only stream and producing a black video with sound.
      const probeInfo = JSON.stringify({
        duration: 12.5,
        formats: [
          { format_id: 'audio', url: 'https://x.cdninstagram.com/audio.m4a', vcodec: 'none', acodec: 'mp4a.40.5' },
          { format_id: 'video-low', url: 'https://x.cdninstagram.com/video-low.webm', vcodec: 'vp09.00.30', acodec: 'none' },
          { format_id: 'video-high', url: 'https://x.cdninstagram.com/video-high.webm', vcodec: 'vp09.00.40', acodec: 'none' },
        ],
      });

      const runner = fakeRunner(async (command, args) => {
        if (command === 'ffmpeg') {
          expect(args).toContain('-c');
          expect(args).toContain('copy');
          const outputPath = args[args.length - 1]!;
          await writeFile(outputPath, Buffer.from('fake muxed mp4 bytes'));
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return { stdout: probeInfo, stderr: '', exitCode: 0 };
      });

      const downloadedUrls: string[] = [];
      const downloadSpy = vi.fn(async (req: DownloadRequest) => {
        downloadedUrls.push(req.url);
        const filePath = path.join(workDir, path.basename(req.url));
        await writeFile(filePath, Buffer.from('fake stream bytes'));
        return { filePath, sizeBytes: 18, contentType: 'application/octet-stream' };
      });

      const provider = new InstagramProvider({
        runner,
        ytDlpPath: 'yt-dlp',
        ffmpegPath: 'ffmpeg',
        downloader: fakeDownloader(downloadSpy),
      });

      const asset = await provider.fetch(REEL_URL, { ...baseFetchOptions, workDir });

      expect(downloadSpy).toHaveBeenCalledTimes(2);
      // The highest-quality video-only format, not the audio-only one.
      expect(downloadedUrls).toContain('https://x.cdninstagram.com/video-high.webm');
      expect(downloadedUrls).toContain('https://x.cdninstagram.com/audio.m4a');
      expect(downloadedUrls).not.toContain('https://x.cdninstagram.com/video-low.webm');

      expect(asset.contentType).toBe('video/mp4');
      expect(asset.sizeBytes).toBeGreaterThan(0);
      expect(asset.filePath.startsWith(workDir)).toBe(true);
    });
  });
});
