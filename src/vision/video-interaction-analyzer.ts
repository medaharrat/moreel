import type { EntityType, EvidenceLevel, InteractionType, ReferenceRelation } from '../domain/video-map.js';
import type { FrameAsset } from '../media/frames/frame-sampler.js';

/** One candidate moment to analyze in depth — a trigger window's transcript context plus a short sequence of frames around it, so the model has temporal context rather than one isolated image. */
export interface InteractionWindow {
  timestamp: number;
  transcriptText: string;
  frames: FrameAsset[];
}

/** Provider-shaped output before entity resolution — see app/video-map-builder.ts for how labels become real entity ids. */
export interface RawEntity {
  label: string;
  type: EntityType;
  description?: string | undefined;
  confidence: number;
}

export interface RawInteraction {
  windowTimestamp: number;
  type: InteractionType;
  actorLabel?: string | undefined;
  targetLabel?: string | undefined;
  evidenceLevel: EvidenceLevel;
  confidence: number;
}

export interface RawReference {
  windowTimestamp: number;
  phrase: string;
  targetLabel?: string | undefined;
  relation: ReferenceRelation;
  evidenceLevel: EvidenceLevel;
  confidence: number;
}

export interface InteractionAnalysisResult {
  entities: RawEntity[];
  interactions: RawInteraction[];
  references: RawReference[];
}

export interface InteractionAnalyzeOptions {
  signal: AbortSignal;
  timeoutMs: number;
}

/**
 * Resolves what a person is doing and referring to at specific,
 * pre-selected moments — never asked to describe a whole video, only the
 * bounded set of `InteractionWindow`s the caller already decided were worth
 * the cost (see app/trigger-detection.ts). Mirrors `VisionProvider`: knows
 * nothing about the pipeline, cache, or video platforms.
 */
export interface VideoInteractionAnalyzer {
  readonly provider: string;
  readonly model: string;
  analyze(windows: InteractionWindow[], options: InteractionAnalyzeOptions): Promise<InteractionAnalysisResult>;
}
