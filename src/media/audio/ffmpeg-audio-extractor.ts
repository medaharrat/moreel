import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { AudioAsset, VideoAsset } from '../../domain/transcript.js';
import type { CommandRunner } from '../../util/subprocess.js';
import { CommandFailedError, CommandTimeoutError } from '../../util/subprocess.js';
import type { AudioExtractionOptions, AudioExtractor } from './audio-extractor.js';

export interface FfmpegAudioExtractorOptions {
  runner: CommandRunner;
  ffmpegPath: string;
}

/** Target format for the transcription provider: mono 16kHz (Whisper's native rate). */
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
/**
 * Compressed mp3 instead of raw WAV: Whisper resamples/decodes internally
 * regardless of input format, so shipping a ~10x smaller file over the
 * network costs nothing in accuracy but meaningfully cuts upload time.
 */
const AUDIO_BITRATE_KBPS = 64;

/**
 * Extracts audio via ffmpeg, invoked as a controlled subprocess (array
 * args, no shell, hard timeout, no stdin, capped output buffers). `-vn`
 * drops the video stream from the output so ffmpeg never decodes video
 * frames it would just discard — audio-first processing per the
 * performance requirements, not full video decode.
 *
 * Duration comes from the same conversion run's stderr (ffmpeg always logs
 * the input's "Duration:" line before transcoding) rather than a separate
 * probe-only invocation, so extraction is a single subprocess spawn instead
 * of two.
 */
export class FfmpegAudioExtractor implements AudioExtractor {
  constructor(private readonly options: FfmpegAudioExtractorOptions) {}

  async extract(video: VideoAsset, options: AudioExtractionOptions): Promise<AudioAsset> {
    const outputPath = path.join(options.workDir, `${randomUUID()}.mp3`);
    let stderr = '';
    try {
      const result = await this.options.runner.run(
        this.options.ffmpegPath,
        [
          '-y',
          '-i',
          video.filePath,
          '-vn',
          '-ac',
          String(CHANNELS),
          '-ar',
          String(SAMPLE_RATE),
          '-codec:a',
          'libmp3lame',
          '-b:a',
          `${AUDIO_BITRATE_KBPS}k`,
          '-f',
          'mp3',
          outputPath,
        ],
        { timeoutMs: options.timeoutMs, signal: options.signal },
      );
      stderr = result.stderr;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof CommandTimeoutError) {
        throw new MoreelError(ErrorCode.AUDIO_EXTRACTION_FAILED, 'Timed out extracting audio.', {
          cause: error,
        });
      }
      if (error instanceof CommandFailedError) {
        throw new MoreelError(ErrorCode.AUDIO_EXTRACTION_FAILED, undefined, { cause: error });
      }
      throw new MoreelError(ErrorCode.AUDIO_EXTRACTION_FAILED, undefined, { cause: error });
    }

    const duration = parseDurationFromFfmpegOutput(stderr) ?? video.durationSeconds;
    if (duration !== undefined && duration > options.maxDurationSeconds) {
      throw new MoreelError(ErrorCode.MEDIA_TOO_LONG, undefined, {
        details: { durationSeconds: duration, maxDurationSeconds: options.maxDurationSeconds },
      });
    }

    const stats = await stat(outputPath).catch(() => undefined);
    if (!stats || stats.size === 0) {
      throw new MoreelError(
        ErrorCode.AUDIO_EXTRACTION_FAILED,
        'Audio extraction produced an empty file.',
      );
    }

    return {
      filePath: outputPath,
      format: 'mp3',
      durationSeconds: duration ?? (stats.size * 8) / (AUDIO_BITRATE_KBPS * 1000),
      sizeBytes: stats.size,
    };
  }
}

/** Parses ffmpeg's human-readable "Duration: HH:MM:SS.ss, ..." line from stderr. */
export function parseDurationFromFfmpegOutput(stderr: string): number | undefined {
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(stderr);
  if (!match) return undefined;
  const [, hours, minutes, seconds, fraction] = match;
  const total =
    Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction ?? '0'}`);
  return Number.isFinite(total) ? total : undefined;
}
