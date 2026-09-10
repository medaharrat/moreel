import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FfmpegAudioExtractor,
  parseDurationFromFfmpegOutput,
} from '../../src/media/audio/ffmpeg-audio-extractor.js';
import type { CommandResult, CommandRunner } from '../../src/util/subprocess.js';
import { CommandFailedError } from '../../src/util/subprocess.js';
import type { VideoAsset } from '../../src/domain/transcript.js';

function fakeRunner(handler: (args: string[]) => Promise<CommandResult>): CommandRunner {
  return { run: (_cmd, args) => handler(args) };
}

const video: VideoAsset = {
  filePath: '/tmp/fake-video.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1000,
  durationSeconds: undefined,
  source: 'instagram',
  sourceUrl: 'https://www.instagram.com/reel/abc/',
};

describe('parseDurationFromFfmpegOutput', () => {
  it('parses ffmpeg\'s "Duration: HH:MM:SS.ss" line', () => {
    const stderr =
      'Input #0, mov,mp4,m4a,3gp,3g2,mj2\n  Duration: 00:00:53.28, start: 0.000000, bitrate: 128 kb/s';
    expect(parseDurationFromFfmpegOutput(stderr)).toBeCloseTo(53.28, 2);
  });

  it('returns undefined when no duration line is present', () => {
    expect(parseDurationFromFfmpegOutput('nothing useful here')).toBeUndefined();
  });
});

describe('FfmpegAudioExtractor', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-ffmpeg-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('extracts audio and returns an AudioAsset, in a single ffmpeg invocation', async () => {
    let callCount = 0;
    const runner = fakeRunner(async (args) => {
      callCount += 1;
      const outputPath = args[args.length - 1];
      if (outputPath) await writeFile(outputPath, Buffer.alloc(4096, 1));
      return {
        stdout: '',
        stderr: 'Duration: 00:00:10.00, start: 0.000000, bitrate: 128 kb/s',
        exitCode: 0,
      };
    });

    const extractor = new FfmpegAudioExtractor({ runner, ffmpegPath: 'ffmpeg' });
    const asset = await extractor.extract(video, {
      workDir,
      maxDurationSeconds: 600,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });

    expect(callCount).toBe(1);
    expect(asset.format).toBe('mp3');
    expect(asset.durationSeconds).toBeCloseTo(10, 1);
    expect(asset.sizeBytes).toBe(4096);
    expect(asset.filePath.startsWith(workDir)).toBe(true);
    expect(asset.filePath.endsWith('.mp3')).toBe(true);
  });

  it('rejects with MEDIA_TOO_LONG when the extracted duration exceeds the limit', async () => {
    const runner = fakeRunner(async (args) => {
      const outputPath = args[args.length - 1];
      if (outputPath) await writeFile(outputPath, Buffer.alloc(4096, 1));
      return {
        stdout: '',
        stderr: 'Duration: 01:00:00.00, start: 0.000000, bitrate: 1 kb/s',
        exitCode: 0,
      };
    });

    const extractor = new FfmpegAudioExtractor({ runner, ffmpegPath: 'ffmpeg' });
    await expect(
      extractor.extract(video, {
        workDir,
        maxDurationSeconds: 60,
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_TOO_LONG' });
  });

  it('maps an extraction failure to AUDIO_EXTRACTION_FAILED', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError('ffmpeg', 1, 'Invalid data found when processing input');
    });

    const extractor = new FfmpegAudioExtractor({ runner, ffmpegPath: 'ffmpeg' });
    await expect(
      extractor.extract(video, {
        workDir,
        maxDurationSeconds: 600,
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'AUDIO_EXTRACTION_FAILED' });
  });

  it('rejects with AUDIO_EXTRACTION_FAILED when extraction produces an empty file', async () => {
    const runner = fakeRunner(async (args) => {
      const outputPath = args[args.length - 1];
      if (outputPath) await writeFile(outputPath, Buffer.alloc(0));
      return {
        stdout: '',
        stderr: 'Duration: 00:00:05.00, start: 0.000000, bitrate: 1 kb/s',
        exitCode: 0,
      };
    });

    const extractor = new FfmpegAudioExtractor({ runner, ffmpegPath: 'ffmpeg' });
    await expect(
      extractor.extract(video, {
        workDir,
        maxDurationSeconds: 600,
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'AUDIO_EXTRACTION_FAILED' });
  });
});
