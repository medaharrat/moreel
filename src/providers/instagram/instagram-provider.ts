import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { VideoAsset } from '../../domain/transcript.js';
import { DownloadError, type HttpDownloader } from '../../media/downloader/http-downloader.js';
import type { CommandRunner } from '../../util/subprocess.js';
import { CommandFailedError, CommandTimeoutError } from '../../util/subprocess.js';
import type { FetchOptions, VideoProvider } from '../provider.js';
import { parseInstagramReelUrl } from './url.js';

export interface YtDlpProbeResult {
  duration: number | undefined;
  filesizeApprox: number | undefined;
  /** A single URL already containing both video and audio, when one exists. */
  mediaUrl: string | undefined;
  /** Set together with `audioOnlyUrl` when Instagram only serves this Reel as separate DASH streams (no progressive format) — see `findFormats`. */
  videoOnlyUrl: string | undefined;
  audioOnlyUrl: string | undefined;
  ext: string | undefined;
  /** The post's caption, when yt-dlp's Instagram extractor surfaces one. */
  caption: string | undefined;
  /** The creator's display name (yt-dlp's `uploader` field). */
  creatorName: string | undefined;
  /** The creator's profile URL, built from yt-dlp's `channel` (username handle) — Instagram's extractor doesn't return a ready-made profile URL. */
  creatorUrl: string | undefined;
  /** Like count at probe time, when yt-dlp's Instagram extractor surfaces one. */
  likeCount: number | undefined;
  /** Comment count at probe time. */
  commentCount: number | undefined;
  /** When the post was published, as an ISO 8601 string (yt-dlp's `timestamp` is Unix seconds). */
  postedAt: string | undefined;
}

export interface InstagramProviderOptions {
  runner: CommandRunner;
  ytDlpPath: string;
  ffmpegPath: string;
  downloader: HttpDownloader;
}

/** Hosts Instagram's CDN serves media from. Kept narrow and explicit (no wildcards on arbitrary TLDs). */
export const INSTAGRAM_CDN_HOST_SUFFIXES = ['cdninstagram.com', 'fbcdn.net', 'instagram.com'];

/**
 * Retrieves public Instagram Reels in two steps:
 *   1. Resolve metadata + a direct media URL via yt-dlp — an open-source
 *      extractor that reads the same public page/API data a browser would
 *      for public content. It never logs in, solves CAPTCHAs, or otherwise
 *      bypasses any access control; login-gated content surfaces as
 *      AUTHENTICATION_REQUIRED instead of being worked around.
 *   2. Stream-download that URL through the shared, SSRF-guarded
 *      `HttpDownloader` (kept as a separate module so size/timeout/host
 *      enforcement is identical, and independently testable, across every
 *      future provider).
 *
 * Many Reels aren't served as one progressive file at all — Instagram often
 * serves DASH-style separate video-only and audio-only streams with no
 * combined format in between. In that case both streams are downloaded
 * (still through the same SSRF-guarded downloader — yt-dlp is only ever
 * used to resolve URLs, never to fetch bytes) and muxed locally with
 * ffmpeg. This matters beyond transcription (which only needs audio):
 * the same downloaded file is streamed back for in-browser playback (see
 * `MediaStore`), so picking an audio-only stream would silently produce a
 * black video with sound.
 */
export class InstagramProvider implements VideoProvider {
  readonly id = 'instagram';

  constructor(private readonly options: InstagramProviderOptions) {}

  canHandle(url: URL): boolean {
    return parseInstagramReelUrl(url) !== undefined;
  }

  /** The Reel shortcode is a stable content identity across share-link/query-param variations. */
  contentId(url: URL): string | undefined {
    return parseInstagramReelUrl(url)?.shortcode;
  }

  async fetch(url: URL, options: FetchOptions): Promise<VideoAsset> {
    const ref = parseInstagramReelUrl(url);
    if (!ref) {
      throw new MoreelError(ErrorCode.UNSUPPORTED_SOURCE);
    }

    const probe = await this.probe(ref.normalizedUrl, options);

    if (probe.duration !== undefined && probe.duration > options.maxDurationSeconds) {
      throw new MoreelError(ErrorCode.MEDIA_TOO_LONG, undefined, {
        details: {
          durationSeconds: probe.duration,
          maxDurationSeconds: options.maxDurationSeconds,
        },
      });
    }
    if (probe.filesizeApprox !== undefined && probe.filesizeApprox > options.maxSizeBytes) {
      throw new MoreelError(ErrorCode.MEDIA_TOO_LARGE, undefined, {
        details: { approxSizeBytes: probe.filesizeApprox, maxSizeBytes: options.maxSizeBytes },
      });
    }

    if (probe.mediaUrl) {
      const downloaded = await this.downloadOne(probe.mediaUrl, options);
      return {
        filePath: downloaded.filePath,
        contentType: downloaded.contentType,
        sizeBytes: downloaded.sizeBytes,
        durationSeconds: probe.duration,
        source: 'instagram',
        sourceUrl: ref.normalizedUrl,
        caption: probe.caption,
        creatorName: probe.creatorName,
        creatorUrl: probe.creatorUrl,
        likeCount: probe.likeCount,
        commentCount: probe.commentCount,
        postedAt: probe.postedAt,
      };
    }

    // No progressive format — download the separate video and audio
    // streams and mux them into one file.
    const [video, audio] = await Promise.all([
      this.downloadOne(probe.videoOnlyUrl!, options),
      this.downloadOne(probe.audioOnlyUrl!, options),
    ]);

    const outputPath = path.join(options.workDir, `${randomUUID()}.mp4`);
    try {
      await this.options.runner.run(
        this.options.ffmpegPath,
        [
          '-y',
          '-i',
          video.filePath,
          '-i',
          audio.filePath,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c',
          'copy',
          outputPath,
        ],
        { timeoutMs: options.timeoutMs, signal: options.signal },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new MoreelError(ErrorCode.DOWNLOAD_FAILED, 'Failed to combine the downloaded video and audio streams.', {
        cause: error,
      });
    }

    const stats = await stat(outputPath).catch(() => undefined);
    if (!stats || stats.size === 0) {
      throw new MoreelError(ErrorCode.DOWNLOAD_FAILED, 'Combining video and audio streams produced an empty file.');
    }

    return {
      filePath: outputPath,
      contentType: 'video/mp4',
      sizeBytes: stats.size,
      durationSeconds: probe.duration,
      source: 'instagram',
      sourceUrl: ref.normalizedUrl,
      caption: probe.caption,
      creatorName: probe.creatorName,
      creatorUrl: probe.creatorUrl,
      likeCount: probe.likeCount,
      commentCount: probe.commentCount,
      postedAt: probe.postedAt,
    };
  }

  private async downloadOne(mediaUrl: string, options: FetchOptions) {
    try {
      return await this.options.downloader.download({
        url: mediaUrl,
        destDir: options.workDir,
        maxSizeBytes: options.maxSizeBytes,
        timeoutMs: options.timeoutMs,
        allowedHostSuffixes: INSTAGRAM_CDN_HOST_SUFFIXES,
        signal: options.signal,
      });
    } catch (error) {
      throw this.mapDownloadError(error);
    }
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
      throw this.mapProbeError(error);
    }

    let info: {
      duration?: number;
      filesize?: number;
      filesize_approx?: number;
      url?: string;
      ext?: string;
      formats?: Array<{ url?: string; ext?: string; vcodec?: string; acodec?: string }>;
      description?: string;
      uploader?: string;
      channel?: string;
      like_count?: number;
      comment_count?: number;
      timestamp?: number;
    };
    try {
      info = JSON.parse(result.stdout);
    } catch (error) {
      throw new MoreelError(ErrorCode.CONTENT_UNAVAILABLE, undefined, { cause: error });
    }

    const found = findMediaUrls(info.url, info.formats);
    if (!found.mediaUrl && !(found.videoOnlyUrl && found.audioOnlyUrl)) {
      throw new MoreelError(
        ErrorCode.CONTENT_UNAVAILABLE,
        'No downloadable media URL was found for this Reel.',
      );
    }

    return {
      duration: typeof info.duration === 'number' ? info.duration : undefined,
      filesizeApprox:
        typeof info.filesize === 'number'
          ? info.filesize
          : typeof info.filesize_approx === 'number'
            ? info.filesize_approx
            : undefined,
      ...found,
      ext: info.ext,
      caption: info.description || undefined,
      creatorName: info.uploader || undefined,
      creatorUrl: info.channel ? `https://www.instagram.com/${info.channel}/` : undefined,
      likeCount: typeof info.like_count === 'number' ? info.like_count : undefined,
      commentCount: typeof info.comment_count === 'number' ? info.comment_count : undefined,
      postedAt: typeof info.timestamp === 'number' ? new Date(info.timestamp * 1000).toISOString() : undefined,
    };
  }

  private mapProbeError(error: unknown): MoreelError | never {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (error instanceof CommandTimeoutError) {
      return new MoreelError(ErrorCode.DOWNLOAD_FAILED, 'Fetching Reel metadata timed out.', {
        cause: error,
      });
    }
    if (error instanceof CommandFailedError) {
      const stderr = error.stderr.toLowerCase();
      if (
        stderr.includes('login required') ||
        stderr.includes('rate-limit reached') ||
        stderr.includes('restricted video') ||
        stderr.includes('private account')
      ) {
        return new MoreelError(ErrorCode.AUTHENTICATION_REQUIRED, undefined, { cause: error });
      }
      if (
        stderr.includes('not found') ||
        stderr.includes('unavailable') ||
        stderr.includes('unable to extract') ||
        stderr.includes('404')
      ) {
        return new MoreelError(ErrorCode.CONTENT_UNAVAILABLE, undefined, { cause: error });
      }
      return new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: error });
    }
    return new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: error });
  }

  private mapDownloadError(error: unknown): MoreelError | never {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (error instanceof DownloadError) {
      switch (error.kind) {
        case 'too_large':
          return new MoreelError(ErrorCode.MEDIA_TOO_LARGE, undefined, { cause: error });
        case 'http_error':
          if (error.statusCode === 401 || error.statusCode === 403) {
            return new MoreelError(ErrorCode.AUTHENTICATION_REQUIRED, undefined, { cause: error });
          }
          if (error.statusCode === 404 || error.statusCode === 410) {
            return new MoreelError(ErrorCode.CONTENT_UNAVAILABLE, undefined, { cause: error });
          }
          return new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: error });
        default:
          return new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: error });
      }
    }
    return new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: error });
  }
}

interface FormatInfo {
  url?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
}

/**
 * Resolves either a single progressive (video+audio) URL, or a
 * video-only/audio-only pair to be muxed locally — never an audio-only
 * pick on its own, since the file is also used for video playback.
 */
function findMediaUrls(
  topLevelUrl: string | undefined,
  formats: FormatInfo[] | undefined,
): Pick<YtDlpProbeResult, 'mediaUrl' | 'videoOnlyUrl' | 'audioOnlyUrl'> {
  const hasCodec = (c: string | undefined) => !!c && c !== 'none';

  // yt-dlp's own top-level `url` is only trustworthy here when it already
  // points at a combined stream — for DASH-only content it's typically
  // absent, forcing a fall-through to the formats list below.
  if (topLevelUrl) {
    return { mediaUrl: topLevelUrl, videoOnlyUrl: undefined, audioOnlyUrl: undefined };
  }

  if (!formats || formats.length === 0) {
    return { mediaUrl: undefined, videoOnlyUrl: undefined, audioOnlyUrl: undefined };
  }

  // yt-dlp orders formats roughly worst-to-best, so scanning from the end
  // finds the highest-quality match first.
  for (let i = formats.length - 1; i >= 0; i--) {
    const f = formats[i];
    if (f?.url && hasCodec(f.vcodec) && hasCodec(f.acodec)) {
      return { mediaUrl: f.url, videoOnlyUrl: undefined, audioOnlyUrl: undefined };
    }
  }

  const bestVideoOnly = [...formats].reverse().find((f) => f.url && hasCodec(f.vcodec) && !hasCodec(f.acodec));
  const bestAudioOnly = [...formats].reverse().find((f) => f.url && hasCodec(f.acodec) && !hasCodec(f.vcodec));

  return {
    mediaUrl: undefined,
    videoOnlyUrl: bestVideoOnly?.url,
    audioOnlyUrl: bestAudioOnly?.url,
  };
}
