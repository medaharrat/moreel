import type { VideoAsset } from '../../domain/transcript.js';

export interface FrameAsset {
  /** Seconds from the start of the media this frame was captured at. */
  timestamp: number;
  /** Absolute path to a temporary local file holding the captured frame. */
  filePath: string;
  contentType: string;
  sizeBytes: number;
}

export interface FrameSamplerOptions {
  workDir: string;
  /** Hard cap on the number of frames returned — see MAX_FRAMES_PER_VIDEO; this is what keeps video length from producing unbounded vision-model calls. */
  maxFrames: number;
  intervalSeconds: number;
  timeoutMs: number;
  signal: AbortSignal;
}

/**
 * Samples a bounded set of frames from a downloaded video for visual
 * analysis. Deliberately a fixed-interval strategy for now — the interface
 * is what makes scene-change/OCR-triggered/context-aware sampling swappable
 * later without touching callers.
 */
export interface SampleAtOptions {
  workDir: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface FrameSampler {
  sample(video: VideoAsset, options: FrameSamplerOptions): Promise<FrameAsset[]>;
  /**
   * Captures one frame at each requested timestamp — targeted extraction
   * for a specific moment (e.g. a linguistic trigger window), as opposed
   * to `sample`'s even coverage of the whole video. Optional: only
   * implementations backing the video-map feature need it, and callers
   * must treat its absence as "no targeted frames available", not an error.
   */
  sampleAt?(video: VideoAsset, timestamps: number[], options: SampleAtOptions): Promise<FrameAsset[]>;
}
