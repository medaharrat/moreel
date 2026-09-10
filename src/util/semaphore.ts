import { ErrorCode, MoreelError } from '../domain/errors.js';

/**
 * Bounded concurrency gate. Every unit of work that spawns a subprocess or
 * makes an outbound request (download, ffmpeg, transcription call) goes
 * through one shared semaphore, so a burst of MCP requests can never spin
 * up unbounded downloads/ffmpeg processes/transcription calls. When the
 * gate is full, callers fail fast with RATE_LIMITED rather than queuing
 * unboundedly.
 */
export class Semaphore {
  private available: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {
    this.available = maxConcurrency;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Fails fast with RATE_LIMITED instead of queuing when the gate is already full. */
  async runOrReject<T>(fn: () => Promise<T>): Promise<T> {
    if (this.available <= 0) {
      throw new MoreelError(ErrorCode.RATE_LIMITED, undefined, {
        details: { maxConcurrentRequests: this.maxConcurrency },
      });
    }
    return this.run(fn);
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waitQueue.push(() => {
        this.available--;
        resolve();
      });
    });
  }

  private release(): void {
    this.available++;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  get inFlight(): number {
    return this.maxConcurrency - this.available;
  }
}
