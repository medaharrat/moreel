import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FfmpegFrameSampler } from '../../src/media/frames/ffmpeg-frame-sampler.js';
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

/** Mirrors ffmpeg's own `frame-%03d.jpg` output naming for a given workDir. */
function framePath(workDir: string, index: number): string {
  return path.join(workDir, `frame-${String(index).padStart(3, '0')}.jpg`);
}

describe('FfmpegFrameSampler', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-frame-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('samples frames in a single ffmpeg invocation, bounded by maxFrames', async () => {
    let callCount = 0;
    const runner = fakeRunner(async () => {
      callCount += 1;
      // Simulate ffmpeg's fps filter producing exactly maxFrames (16) frames.
      for (let i = 1; i <= 16; i++) {
        await writeFile(framePath(workDir, i), Buffer.alloc(2048, i));
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const sampler = new FfmpegFrameSampler({ runner, ffmpegPath: 'ffmpeg' });
    const frames = await sampler.sample(video, {
      workDir,
      maxFrames: 16,
      intervalSeconds: 5,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });

    expect(callCount).toBe(1);
    expect(frames).toHaveLength(16);
    expect(frames[0]).toMatchObject({ timestamp: 0, contentType: 'image/jpeg', sizeBytes: 2048 });
    expect(frames[1]?.timestamp).toBe(5);
    expect(frames[15]?.timestamp).toBe(75);
    expect(frames.every((f) => f.filePath.startsWith(workDir))).toBe(true);
  });

  it('returns fewer frames than the cap for a short video, without error', async () => {
    const runner = fakeRunner(async () => {
      // A short video only yields 3 frames before ffmpeg runs out of input.
      for (let i = 1; i <= 3; i++) {
        await writeFile(framePath(workDir, i), Buffer.alloc(1024, i));
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const sampler = new FfmpegFrameSampler({ runner, ffmpegPath: 'ffmpeg' });
    const frames = await sampler.sample(video, {
      workDir,
      maxFrames: 16,
      intervalSeconds: 5,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });

    expect(frames).toHaveLength(3);
  });

  it('passes fps and frame-count args derived from the requested interval/cap on the periodic pass', async () => {
    // This fake never writes any frame files, so the periodic pass yields 0
    // frames and the sampler falls through to a second (scene-detection)
    // ffmpeg call with different args — only the first call is the one
    // under test here.
    let call = 0;
    const runner = fakeRunner(async (args) => {
      call += 1;
      if (call === 1) {
        expect(args).toContain('-vf');
        expect(args).toContain('fps=1/5');
        expect(args).toContain('-frames:v');
        expect(args).toContain('16');
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const sampler = new FfmpegFrameSampler({ runner, ffmpegPath: 'ffmpeg' });
    await sampler.sample(video, {
      workDir,
      maxFrames: 16,
      intervalSeconds: 5,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });

    expect(call).toBe(2);
  });

  it('skips scene-change detection entirely once periodic sampling already fills maxFrames', async () => {
    let callCount = 0;
    const runner = fakeRunner(async () => {
      callCount += 1;
      for (let i = 1; i <= 16; i++) {
        await writeFile(framePath(workDir, i), Buffer.alloc(2048, i));
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const sampler = new FfmpegFrameSampler({ runner, ffmpegPath: 'ffmpeg' });
    await sampler.sample(video, {
      workDir,
      maxFrames: 16,
      intervalSeconds: 5,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });

    expect(callCount).toBe(1);
  });

  it('merges scene-change frames into the leftover budget, skipping ones too close to a periodic sample', async () => {
    let call = 0;
    const runner = fakeRunner(async (args) => {
      call += 1;
      if (call === 1) {
        // Periodic pass: 3 frames at t=0,5,10 (interval=5, only 3 requested via maxFrames cap below).
        for (let i = 1; i <= 3; i++) {
          await writeFile(framePath(workDir, i), Buffer.alloc(1024, i));
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      // Scene-change pass: pretend ffmpeg found cuts at 2s (well within
      // interval/2 = 2.5 of the t=0 periodic sample) and 30s (a real gap).
      expect(args).toContain('-vsync');
      const scenePath = (i: number) => path.join(workDir, `scene-${String(i).padStart(3, '0')}.jpg`);
      await writeFile(scenePath(1), Buffer.alloc(512, 1));
      await writeFile(scenePath(2), Buffer.alloc(512, 2));
      return {
        stdout: '',
        stderr: '[Parsed_showinfo_1 @ 0x0] ... pts_time:2.0 ...\n[Parsed_showinfo_1 @ 0x0] ... pts_time:30.0 ...\n',
        exitCode: 0,
      };
    });

    const sampler = new FfmpegFrameSampler({ runner, ffmpegPath: 'ffmpeg' });
    const frames = await sampler.sample(video, {
      workDir,
      maxFrames: 10,
      intervalSeconds: 5,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });

    // 3 periodic (t=0,5,10) + only the 30s scene frame (2s was too close to t=0).
    expect(frames.map((f) => f.timestamp)).toEqual([0, 5, 10, 30]);
  });

  it('maps an extraction failure to FRAME_EXTRACTION_FAILED', async () => {
    const runner = fakeRunner(async () => {
      throw new CommandFailedError('ffmpeg', 1, 'Invalid data found when processing input');
    });

    const sampler = new FfmpegFrameSampler({ runner, ffmpegPath: 'ffmpeg' });
    await expect(
      sampler.sample(video, {
        workDir,
        maxFrames: 16,
        intervalSeconds: 5,
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'FRAME_EXTRACTION_FAILED' });
  });
});
