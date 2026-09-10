import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { VideoAsset } from '../../domain/transcript.js';
import type { CommandRunner } from '../../util/subprocess.js';
import { CommandFailedError, CommandTimeoutError } from '../../util/subprocess.js';
import type { FetchOptions, VideoProvider } from '../provider.js';
import { ffmpegLocationArgs } from '../ytdlp-ffmpeg-location.js';
import { parseYouTubeVideoUrl } from './url.js';

export interface YtDlpProbeResult {
  duration: number | undefined;
  filesizeApprox: number | undefined;
  caption: string | undefined;
  creatorName: string | undefined;
  creatorUrl: string | undefined;
  likeCount: number | undefined;
  commentCount: number | undefined;
  postedAt: string | undefined;
}

export interface YouTubeProviderOptions {
  runner: CommandRunner;
  ytDlpPath: string;
  ffmpegPath: string;
}

/**
 * Retrieves public YouTube videos/Shorts. Like TikTok, yt-dlp downloads the
 * bytes itself rather than us resolving a URL and fetching it through our
 * own SSRF-guarded `HttpDownloader`: YouTube increasingly serves separate
 * video/audio streams as HLS/DASH *manifests* rather than plain single-file
 * URLs (confirmed live — a Short's best video-only format had protocol
 * `m3u8_native`, an `.m3u8` playlist, not a downloadable file), which a
 * plain-GET downloader can't handle. yt-dlp's own download mode resolves
 * and merges these internally. We still gate on the probe's duration/size
 * before ever downloading, cap yt-dlp's own download via `--max-filesize`,
 * and re-verify the resulting file's size afterwards.
 */
export class YouTubeProvider implements VideoProvider {
  readonly id = 'youtube';

  constructor(private readonly options: YouTubeProviderOptions) {}

  canHandle(url: URL): boolean {
    return parseYouTubeVideoUrl(url) !== undefined;
  }

  contentId(url: URL): string | undefined {
    return parseYouTubeVideoUrl(url)?.videoId;
  }

  async fetch(url: URL, options: FetchOptions): Promise<VideoAsset> {
    const ref = parseYouTubeVideoUrl(url);
    if (!ref) {
      throw new MoreelError(ErrorCode.UNSUPPORTED_SOURCE);
    }

    const probe = await this.probe(ref.normalizedUrl, options);

    if (probe.duration !== undefined && probe.duration > options.maxDurationSeconds) {
      throw new MoreelError(ErrorCode.MEDIA_TOO_LONG, undefined, {
        details: { durationSeconds: probe.duration, maxDurationSeconds: options.maxDurationSeconds },
      });
    }
    if (probe.filesizeApprox !== undefined && probe.filesizeApprox > options.maxSizeBytes) {
      throw new MoreelError(ErrorCode.MEDIA_TOO_LARGE, undefined, {
        details: { approxSizeBytes: probe.filesizeApprox, maxSizeBytes: options.maxSizeBytes },
      });
    }

    const outputPath = path.join(options.workDir, `${randomUUID()}.mp4`);
    try {
      await this.options.runner.run(
        this.options.ytDlpPath,
        [
          '-o',
          outputPath,
          '--no-warnings',
          '--no-playlist',
          '--no-part',
          '--merge-output-format',
          'mp4',
          '--max-filesize',
          String(options.maxSizeBytes),
          ...ffmpegLocationArgs(this.options.ffmpegPath),
          ref.normalizedUrl,
        ],
        { timeoutMs: options.timeoutMs, signal: options.signal },
      );
    } catch (error) {
      throw this.mapYtDlpError(error);
    }

    const stats = await stat(outputPath).catch(() => undefined);
    if (!stats || stats.size === 0) {
      throw new MoreelError(ErrorCode.DOWNLOAD_FAILED, 'yt-dlp did not produce a downloadable file.');
    }
    if (stats.size > options.maxSizeBytes) {
      await rm(outputPath, { force: true });
      throw new MoreelError(ErrorCode.MEDIA_TOO_LARGE, undefined, {
        details: { sizeBytes: stats.size, maxSizeBytes: options.maxSizeBytes },
      });
    }

    return {
      filePath: outputPath,
      contentType: 'video/mp4',
      sizeBytes: stats.size,
      durationSeconds: probe.duration,
      source: 'youtube',
      sourceUrl: ref.normalizedUrl,
      caption: probe.caption,
      creatorName: probe.creatorName,
      creatorUrl: probe.creatorUrl,
      likeCount: probe.likeCount,
      commentCount: probe.commentCount,
      postedAt: probe.postedAt,
    };
  }

  private async probe(normalizedUrl: string, options: FetchOptions): Promise<YtDlpProbeResult> {
    let result;
    try {
      result = await this.options.runner.run(
        this.options.ytDlpPath,
        ['-j', '--no-warnings', '--no-playlist', '--skip-download', normalizedUrl],
        { timeoutMs: options.timeoutMs, signal: options.signal },
      );
    } catch (error) {
      throw this.mapYtDlpError(error);
    }

    let info: {
      duration?: number;
      filesize?: number;
      filesize_approx?: number;
      description?: string;
      uploader?: string;
      uploader_url?: string;
      channel_url?: string;
      like_count?: number;
      comment_count?: number;
      timestamp?: number;
    };
    try {
      info = JSON.parse(result.stdout);
    } catch (error) {
      throw new MoreelError(ErrorCode.CONTENT_UNAVAILABLE, undefined, { cause: error });
    }

    return {
      duration: typeof info.duration === 'number' ? info.duration : undefined,
      filesizeApprox:
        typeof info.filesize === 'number'
          ? info.filesize
          : typeof info.filesize_approx === 'number'
            ? info.filesize_approx
            : undefined,
      caption: info.description || undefined,
      creatorName: info.uploader || undefined,
      creatorUrl: info.uploader_url || info.channel_url || undefined,
      likeCount: typeof info.like_count === 'number' ? info.like_count : undefined,
      commentCount: typeof info.comment_count === 'number' ? info.comment_count : undefined,
      postedAt: typeof info.timestamp === 'number' ? new Date(info.timestamp * 1000).toISOString() : undefined,
    };
  }

  private mapYtDlpError(error: unknown): MoreelError | never {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (error instanceof CommandTimeoutError) {
      return new MoreelError(ErrorCode.DOWNLOAD_FAILED, 'Fetching the video timed out.', { cause: error });
    }
    if (error instanceof CommandFailedError) {
      const stderr = error.stderr.toLowerCase();
      if (
        stderr.includes('login required') ||
        stderr.includes('sign in') ||
        stderr.includes('rate-limit reached') ||
        stderr.includes('private video') ||
        stderr.includes('age-restricted')
      ) {
        return new MoreelError(ErrorCode.AUTHENTICATION_REQUIRED, undefined, { cause: error });
      }
      if (
        stderr.includes('not found') ||
        stderr.includes('unavailable') ||
        stderr.includes('unable to extract') ||
        stderr.includes('404') ||
        stderr.includes('video is not available')
      ) {
        return new MoreelError(ErrorCode.CONTENT_UNAVAILABLE, undefined, { cause: error });
      }
      if (stderr.includes('max-filesize') || stderr.includes('exceeds')) {
        return new MoreelError(ErrorCode.MEDIA_TOO_LARGE, undefined, { cause: error });
      }
      return new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: error });
    }
    return new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: error });
  }
}
