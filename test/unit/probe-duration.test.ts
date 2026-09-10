import { describe, expect, it } from 'vitest';
import { probeMediaDurationSeconds } from '../../src/media/probe-duration.js';
import { CommandFailedError } from '../../src/util/subprocess.js';
import type { CommandRunner } from '../../src/util/subprocess.js';

function fakeRunner(handler: () => Promise<{ stdout: string; stderr: string; exitCode: number | null }>): CommandRunner {
  return { run: () => handler() };
}

const options = { timeoutMs: 5_000, signal: new AbortController().signal };

describe('probeMediaDurationSeconds', () => {
  it('parses the duration from ffmpeg stderr when the command "fails" (no output specified, as expected)', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError(
        'ffmpeg',
        1,
        'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'video.mp4\':\n  Duration: 00:00:16.32, start: 0.000000, bitrate: 1065 kb/s\n',
      );
    });

    const duration = await probeMediaDurationSeconds('video.mp4', runner, 'ffmpeg', options);
    expect(duration).toBeCloseTo(16.32, 2);
  });

  it('parses a duration with hours/minutes correctly', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError('ffmpeg', 1, 'Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s\n');
    });

    const duration = await probeMediaDurationSeconds('video.mp4', runner, 'ffmpeg', options);
    expect(duration).toBeCloseTo(3600 + 2 * 60 + 3.5, 2);
  });

  it('also parses when the runner reports success with the duration in stderr', async () => {
    const runner = fakeRunner(async () => ({
      stdout: '',
      stderr: 'Duration: 00:00:05.00, start: 0.000000, bitrate: 500 kb/s\n',
      exitCode: 0,
    }));

    const duration = await probeMediaDurationSeconds('video.mp4', runner, 'ffmpeg', options);
    expect(duration).toBeCloseTo(5, 2);
  });

  it('returns undefined, never throws, when the output has no Duration line', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError('ffmpeg', 1, 'ffmpeg: no such file or directory\n');
    });

    expect(await probeMediaDurationSeconds('missing.mp4', runner, 'ffmpeg', options)).toBeUndefined();
  });

  it('propagates cancellation instead of swallowing it', async () => {
    const runner = fakeRunner(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(probeMediaDurationSeconds('video.mp4', runner, 'ffmpeg', options)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
