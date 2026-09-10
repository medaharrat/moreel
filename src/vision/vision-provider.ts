import type { VisualObservation } from '../domain/vision.js';
import type { FrameAsset } from '../media/frames/frame-sampler.js';

export interface VisionAnalyzeOptions {
  /** The spoken transcript, given as context so the model can correlate what's shown with what's being said. */
  transcriptText: string;
  signal: AbortSignal;
  timeoutMs: number;
}

/**
 * A `VisionProvider` turns a bounded set of sampled frames (plus the
 * transcript for context) into a short list of meaningful visual
 * observations — never a description of every frame. Mirrors `Transcriber`:
 * knows nothing about video platforms, and the interface is the seam for
 * swapping vendors/models later.
 */
export interface VisionProvider {
  readonly provider: string;
  readonly model: string;
  analyze(frames: FrameAsset[], options: VisionAnalyzeOptions): Promise<VisualObservation[]>;
}
