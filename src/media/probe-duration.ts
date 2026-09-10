import { CommandFailedError, type CommandRunner } from '../util/subprocess.js';

export interface ProbeDurationOptions {
  timeoutMs: number;
  signal: AbortSignal;
}

const DURATION_PATTERN = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

/**
 * Reads a media file's actual duration directly from ffmpeg's own stderr
 * output — `ffmpeg -i <file>` with no output specified always exits
 * non-zero, but always prints the input's `Duration: HH:MM:SS.ms` line
 * first. Used as a fallback when a platform's own metadata doesn't report
 * a duration (yt-dlp's `duration` field is absent for some content —
 * confirmed in practice for at least some Instagram Reels), so the
 * pipeline still knows the video's real length for anything that needs it
 * (e.g. adaptive frame-sampling density). Reuses the `ffmpeg` binary this
 * project already requires — no new dependency (e.g. `ffprobe`) needed.
 * Best-effort: returns `undefined` rather than throwing on any failure,
 * since callers treat this purely as an optimization, never a
 * requirement.
 */
export async function probeMediaDurationSeconds(
  filePath: string,
  runner: CommandRunner,
  ffmpegPath: string,
  options: ProbeDurationOptions,
): Promise<number | undefined> {
  let stderr = '';
  try {
    const result = await runner.run(ffmpegPath, ['-i', filePath], {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    stderr = result.stderr;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof CommandFailedError) stderr = error.stderr;
  }

  const match = DURATION_PATTERN.exec(stderr);
  if (!match) return undefined;

  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
