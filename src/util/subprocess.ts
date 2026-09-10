import { execFile } from 'node:child_process';

/**
 * A single seam for running external binaries (yt-dlp, ffmpeg). Everything
 * downstream calls through this interface rather than `child_process`
 * directly, so:
 *   1. Arguments are always passed as an array — never shell-interpolated,
 *      so untrusted URLs/paths cannot break out into shell syntax.
 *   2. Every invocation has a hard timeout and is killable via AbortSignal
 *      (MCP cancellation propagates here).
 *   3. Tests can inject a fake runner instead of requiring real binaries.
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Caps buffered stdout/stderr to prevent unbounded memory growth. */
  maxBufferBytes?: number;
  cwd?: string;
}

export interface CommandRunner {
  run(command: string, args: string[], options: RunOptions): Promise<CommandResult>;
}

export class CommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`Command "${command}" timed out after ${timeoutMs}ms`);
    this.name = 'CommandTimeoutError';
  }
}

export class CommandFailedError extends Error {
  constructor(
    command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`Command "${command}" exited with code ${exitCode}`);
    this.name = 'CommandFailedError';
  }
}

/** Real subprocess runner backed by `execFile` (never a shell). */
export class ExecFileCommandRunner implements CommandRunner {
  run(command: string, args: string[], options: RunOptions): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        command,
        args,
        {
          timeout: options.timeoutMs,
          maxBuffer: options.maxBufferBytes ?? 32 * 1024 * 1024,
          signal: options.signal,
          cwd: options.cwd,
          windowsHide: true,
          shell: false,
        },
        (error, stdout, stderr) => {
          if (error) {
            const anyError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
            if (anyError.killed && anyError.signal === 'SIGTERM' && !options.signal?.aborted) {
              reject(new CommandTimeoutError(command, options.timeoutMs));
              return;
            }
            if (options.signal?.aborted) {
              reject(new DOMException('Command aborted', 'AbortError'));
              return;
            }
            const exitCode = typeof anyError.code === 'number' ? anyError.code : null;
            reject(new CommandFailedError(command, exitCode, stderr.toString()));
            return;
          }
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 });
        },
      );
      void child;
    });
  }
}
