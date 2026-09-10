import type { SourceId } from '../domain/transcript.js';

/**
 * A single meterable unit of work: "who/what did how much work, with
 * which provider, and did it succeed." Feeds observability (metrics/logs),
 * not billing — Moreel is free and has no billing system.
 */
export interface UsageEvent {
  requestId: string;
  source: SourceId;
  /** Wall-clock video duration processed, in seconds. */
  videoDurationSeconds: number;
  /** Time spent in the transcription stage, in milliseconds. */
  transcriptionMs: number;
  /** Total pipeline latency, in milliseconds. */
  totalLatencyMs: number;
  transcriptionProvider: string;
  transcriptionModel: string;
  success: boolean;
  cacheHit: boolean;
  occurredAt: string;
  /** Estimated provider (COGS) cost in cents, when a price is known for `transcriptionProvider`/`transcriptionModel` — see `observability/cost-estimator.ts`. */
  estimatedCostCents?: number;
  /** Time spent in the vision stage, in milliseconds. Present only when the vision pipeline ran. */
  visionMs?: number;
  /** Estimated vision provider cost in cents, when the vision pipeline ran and a price is known. */
  visionCostCents?: number;
  /** Number of visual observations returned, when the vision pipeline ran. */
  visionObservationCount?: number;
}

export interface UsageRecorder {
  record(event: UsageEvent): void;
}

/** Default recorder: keeps a bounded in-memory log. Fine for v0.1 / single-process. */
export class InMemoryUsageRecorder implements UsageRecorder {
  private readonly events: UsageEvent[] = [];

  constructor(private readonly maxEvents = 10_000) {}

  record(event: UsageEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  all(): readonly UsageEvent[] {
    return this.events;
  }

  totalMinutesProcessed(): number {
    return this.events.reduce((sum, e) => sum + e.videoDurationSeconds, 0) / 60;
  }
}

/** No-op recorder for tests that don't care about usage tracking. */
export class NullUsageRecorder implements UsageRecorder {
  record(): void {
    // intentionally does nothing
  }
}
