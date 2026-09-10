import path from 'node:path';

/**
 * yt-dlp's `--ffmpeg-location` flag expects an actual path (to the binary
 * or its containing directory) — passed a bare command name like `ffmpeg`
 * (our config default, since Node's own `spawn` resolves that via `PATH`
 * fine), it fails to locate the binary and silently skips merging
 * altogether: no error, no warning, exit code 0, just no merged output
 * file. Omitting the flag entirely lets yt-dlp fall back to its own `PATH`
 * search, which works correctly. So: only pass the flag when it's an
 * actual path, not a bare command yt-dlp would need to resolve itself.
 */
export function ffmpegLocationArgs(ffmpegPath: string): string[] {
  return ffmpegPath.includes(path.sep) ? ['--ffmpeg-location', ffmpegPath] : [];
}
