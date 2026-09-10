import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { VideoAsset } from '../../domain/transcript.js';
import type { CommandRunner } from '../../util/subprocess.js';
import { CommandFailedError, CommandTimeoutError } from '../../util/subprocess.js';
import type { FrameAsset, FrameSampler, FrameSamplerOptions, SampleAtOptions } from './frame-sampler.js';

export interface FfmpegFrameSamplerOptions {
  runner: CommandRunner;
  ffmpegPath: string;
}

/** ffmpeg's `scene` metric is a 0..1 "how different is this frame from the last" score; this is a conservative cut, tuned for real cuts/slide changes rather than pans or lighting flicker. */
const SCENE_CHANGE_THRESHOLD = 0.4;

/**
 * Two-pass, still-bounded frame sampling: fixed-interval coverage first
 * (guarantees an even baseline regardless of content), then — only if
 * there's budget left under `maxFrames` — a second pass that adds frames at
 * detected scene changes (cuts, slide transitions), which fixed-interval
 * sampling alone can straddle or miss entirely. Both passes are single
 * bounded ffmpeg invocations; this is still never more than two subprocess
 * spawns regardless of video length.
 */
export class FfmpegFrameSampler implements FrameSampler {
  constructor(private readonly options: FfmpegFrameSamplerOptions) {}

  async sample(video: VideoAsset, options: FrameSamplerOptions): Promise<FrameAsset[]> {
    const periodicFrames = await this.samplePeriodic(video, options);

    const leftoverBudget = options.maxFrames - periodicFrames.length;
    if (leftoverBudget <= 0) {
      return periodicFrames;
    }

    // Scene detection is a bonus on top of guaranteed periodic coverage —
    // any failure here (unsupported filter, timeout, malformed output) is
    // swallowed, never allowed to fail the whole sample() call.
    const sceneFrames = await this.sampleSceneChanges(video, options, leftoverBudget, periodicFrames).catch(
      () => [] as FrameAsset[],
    );

    return [...periodicFrames, ...sceneFrames].sort((a, b) => a.timestamp - b.timestamp);
  }

  private async samplePeriodic(video: VideoAsset, options: FrameSamplerOptions): Promise<FrameAsset[]> {
    const pattern = path.join(options.workDir, 'frame-%03d.jpg');

    try {
      await this.options.runner.run(
        this.options.ffmpegPath,
        [
          '-y',
          '-i',
          video.filePath,
          '-vf',
          `fps=1/${options.intervalSeconds}`,
          '-frames:v',
          String(options.maxFrames),
          '-q:v',
          '3',
          pattern,
        ],
        { timeoutMs: options.timeoutMs, signal: options.signal },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof CommandTimeoutError) {
        throw new MoreelError(ErrorCode.FRAME_EXTRACTION_FAILED, 'Timed out extracting video frames.', {
          cause: error,
        });
      }
      if (error instanceof CommandFailedError) {
        throw new MoreelError(ErrorCode.FRAME_EXTRACTION_FAILED, undefined, { cause: error });
      }
      throw new MoreelError(ErrorCode.FRAME_EXTRACTION_FAILED, undefined, { cause: error });
    }

    const frames: FrameAsset[] = [];
    for (let i = 1; i <= options.maxFrames; i++) {
      const filePath = path.join(options.workDir, `frame-${String(i).padStart(3, '0')}.jpg`);
      const stats = await stat(filePath).catch(() => undefined);
      // A video shorter than maxFrames * intervalSeconds produces fewer
      // frames than the cap — the first missing sequence number just means
      // ffmpeg ran out of video, not an error.
      if (!stats) break;
      frames.push({
        timestamp: (i - 1) * options.intervalSeconds,
        filePath,
        contentType: 'image/jpeg',
        sizeBytes: stats.size,
      });
    }

    return frames;
  }

  private async sampleSceneChanges(
    video: VideoAsset,
    options: FrameSamplerOptions,
    budget: number,
    existing: FrameAsset[],
  ): Promise<FrameAsset[]> {
    const pattern = path.join(options.workDir, 'scene-%03d.jpg');

    const result = await this.options.runner.run(
      this.options.ffmpegPath,
      [
        '-y',
        '-i',
        video.filePath,
        '-vf',
        `select='gt(scene,${SCENE_CHANGE_THRESHOLD})',showinfo`,
        '-vsync',
        'vfr',
        '-frames:v',
        String(budget),
        '-q:v',
        '3',
        pattern,
      ],
      { timeoutMs: options.timeoutMs, signal: options.signal },
    );

    // `showinfo` logs one line per selected frame to stderr, each containing
    // `pts_time:<seconds>` — the only place ffmpeg exposes the timestamp of
    // a frame chosen by `select`, since the output filenames are just a
    // sequence counter.
    const timestamps = [...result.stderr.matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));

    const frames: FrameAsset[] = [];
    for (let i = 1; i <= budget; i++) {
      const filePath = path.join(options.workDir, `scene-${String(i).padStart(3, '0')}.jpg`);
      const stats = await stat(filePath).catch(() => undefined);
      if (!stats) break;

      const timestamp = timestamps[i - 1];
      if (timestamp === undefined) continue;

      // A scene change within half an interval of an existing periodic
      // sample adds little — it's essentially the same moment already
      // covered, and every extra frame is another image sent to the vision
      // model.
      const tooCloseToExisting = existing.some(
        (frame) => Math.abs(frame.timestamp - timestamp) < options.intervalSeconds / 2,
      );
      if (tooCloseToExisting) continue;

      frames.push({
        timestamp: Math.round(timestamp * 100) / 100,
        filePath,
        contentType: 'image/jpeg',
        sizeBytes: stats.size,
      });
    }

    return frames;
  }

  /**
   * One `-ss <t> -frames:v 1` extraction per requested timestamp — a
   * separate ffmpeg process each, unlike `sample`'s single bounded call,
   * because these timestamps are scattered and few (bounded by the
   * caller — see MAX_TRIGGER_WINDOWS in video-map-builder.ts), so the
   * subprocess-count tradeoff is worth the precision of an exact seek.
   * A single timestamp's extraction failing is logged by the caller and
   * skipped, not treated as failing the whole batch.
   */
  async sampleAt(video: VideoAsset, timestamps: number[], options: SampleAtOptions): Promise<FrameAsset[]> {
    const frames: FrameAsset[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = Math.max(0, timestamps[i]!);
      const filePath = path.join(options.workDir, `trigger-${String(i).padStart(3, '0')}.jpg`);

      try {
        await this.options.runner.run(
          this.options.ffmpegPath,
          ['-y', '-ss', String(timestamp), '-i', video.filePath, '-frames:v', '1', '-q:v', '3', filePath],
          { timeoutMs: options.timeoutMs, signal: options.signal },
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        continue; // Best-effort per timestamp — see doc comment above.
      }

      const stats = await stat(filePath).catch(() => undefined);
      if (!stats) continue;

      frames.push({ timestamp, filePath, contentType: 'image/jpeg', sizeBytes: stats.size });
    }

    return frames;
  }
}
