import { randomBytes } from 'node:crypto';
import type { Transcript, VideoAsset } from '../domain/transcript.js';
import type { Interaction, LinguisticReference, Scene, VisualEntity } from '../domain/video-map.js';
import type { FrameAsset, FrameSampler } from '../media/frames/frame-sampler.js';
import type {
  InteractionAnalysisResult,
  InteractionWindow,
  RawEntity,
  VideoInteractionAnalyzer,
} from '../vision/video-interaction-analyzer.js';
import { findTriggerWindows } from './trigger-detection.js';

/** A frame already sampled within this many seconds of a trigger is "nearby enough" — no need to spend an extra extraction on it. */
const NEARBY_FRAME_TOLERANCE_SECONDS = 2.5;
/** Caps how many frames (existing or newly extracted) back a single window — approximates the "short sequence around the event" the spec describes, without an unbounded per-window frame count. */
const MAX_FRAMES_PER_WINDOW = 3;

export interface BuildVideoMapOptions {
  transcript: Transcript;
  /** Frames already sampled for the vision pipeline — reused here first, before spending any extra extraction. */
  existingFrames: FrameAsset[];
  analyzer: VideoInteractionAnalyzer;
  maxWindows: number;
  /** Absent when the configured FrameSampler doesn't support targeted extraction — windows with no nearby existing frame are simply skipped rather than erroring. */
  frameSampler?: FrameSampler | undefined;
  video: VideoAsset;
  workDir: string;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface VideoMapResult {
  scenes: Scene[];
  entities: VisualEntity[];
  interactions: Interaction[];
  references: LinguisticReference[];
}

const EMPTY_MAP: Omit<VideoMapResult, 'scenes'> = { entities: [], interactions: [], references: [] };

/**
 * Orchestrates the targeted (Stage 2/3) part of the pipeline: find moments
 * a transcript alone can't resolve (trigger-detection.ts), gather a short
 * frame sequence around each, and hand the bounded result to the analyzer.
 * This never runs on every frame — only on the candidate windows, which is
 * what keeps cost bounded regardless of video length (see spec section 18).
 *
 * Known V1 simplification: entity/interaction/reference records don't carry
 * a servable frame thumbnail the way `VisualObservation` does — targeted
 * frames extracted here are read directly by the analyzer and never
 * registered in `MediaStore`. Timestamp + confidence + evidenceLevel still
 * give full traceability (the player already seeks to the exact moment);
 * adding a thumbnail is a natural follow-up, not a correctness gap.
 */
export async function buildVideoMap(options: BuildVideoMapOptions): Promise<VideoMapResult> {
  const scenes = buildScenes(options.existingFrames, options.transcript.durationSeconds);
  const triggerWindows = findTriggerWindows(options.transcript, options.maxWindows);
  if (triggerWindows.length === 0) {
    return { scenes, ...EMPTY_MAP };
  }

  const framesByTimestamp = new Map<number, FrameAsset[]>();
  const needsExtraction: number[] = [];

  for (const trigger of triggerWindows) {
    const nearby = options.existingFrames
      .filter((frame) => Math.abs(frame.timestamp - trigger.timestamp) <= NEARBY_FRAME_TOLERANCE_SECONDS)
      .sort((a, b) => Math.abs(a.timestamp - trigger.timestamp) - Math.abs(b.timestamp - trigger.timestamp))
      .slice(0, MAX_FRAMES_PER_WINDOW);
    framesByTimestamp.set(trigger.timestamp, nearby);
    if (nearby.length === 0) needsExtraction.push(trigger.timestamp);
  }

  if (needsExtraction.length > 0 && options.frameSampler?.sampleAt) {
    try {
      const extracted = await options.frameSampler.sampleAt(options.video, needsExtraction, {
        workDir: options.workDir,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      for (const frame of extracted) {
        const nearestTrigger = needsExtraction.reduce((closest, candidate) =>
          Math.abs(candidate - frame.timestamp) < Math.abs(closest - frame.timestamp) ? candidate : closest,
        );
        framesByTimestamp.set(nearestTrigger, [frame]);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // Best-effort — windows with no nearby existing frame simply have no
      // targeted frame either, and get skipped below.
    }
  }

  const analysisWindows: InteractionWindow[] = [];
  for (const trigger of triggerWindows) {
    const frames = framesByTimestamp.get(trigger.timestamp) ?? [];
    if (frames.length === 0) continue; // No visual evidence at all for this moment.
    analysisWindows.push({
      timestamp: trigger.timestamp,
      transcriptText: trigger.text,
      frames: [...frames].sort((a, b) => a.timestamp - b.timestamp),
    });
  }

  if (analysisWindows.length === 0) {
    return { scenes, ...EMPTY_MAP };
  }

  const raw = await options.analyzer.analyze(analysisWindows, { signal: options.signal, timeoutMs: options.timeoutMs });
  const segmentIndexByTimestamp = new Map(triggerWindows.map((w) => [w.timestamp, w.segmentIndex]));
  return { scenes, ...resolveVideoMap(raw, segmentIndexByTimestamp, analysisWindows[0]!.timestamp) };
}

/** Cheap, zero-extra-cost scene approximation: spans between consecutive already-sampled frame timestamps. Not a shot-detection model — see Scene's own doc comment. */
function buildScenes(frames: FrameAsset[], durationSeconds: number): Scene[] {
  if (frames.length === 0) return [];
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  return sorted.map((frame, index) => {
    const next = sorted[index + 1];
    return {
      id: generateId('scene'),
      startTimestamp: frame.timestamp,
      endTimestamp: next ? next.timestamp : durationSeconds,
    };
  });
}

/**
 * Turns the analyzer's label-based raw output into real entities with
 * stable ids. Entity identity within one video is resolved purely by exact
 * label match (see the analyzer's own prompt: it's explicitly instructed
 * to reuse the same label for the same recurring thing) — no visual
 * similarity model, no cross-call tracking. This is the "don't require
 * perfect identity tracking" simplification the spec explicitly allows.
 */
function resolveVideoMap(
  raw: InteractionAnalysisResult,
  segmentIndexByTimestamp: Map<number, number>,
  /** Fallback anchor for an entity the model declared but never actually attached to any interaction/reference — "seen around here" rather than a misleading 0. */
  defaultTimestamp: number,
): Omit<VideoMapResult, 'scenes'> {
  const idByLabel = new Map<string, string>();
  const entityById = new Map<string, VisualEntity>();

  function labelKey(label: string): string {
    return label.trim().toLowerCase();
  }

  function ensureEntity(source: RawEntity, timestamp: number): string {
    const key = labelKey(source.label);
    const existingId = idByLabel.get(key);
    if (existingId) {
      const entity = entityById.get(existingId)!;
      entity.firstSeen = Math.min(entity.firstSeen, timestamp);
      entity.lastSeen = Math.max(entity.lastSeen, timestamp);
      return existingId;
    }
    const id = generateId('entity');
    idByLabel.set(key, id);
    entityById.set(id, {
      id,
      type: source.type,
      label: source.label,
      description: source.description,
      firstSeen: timestamp,
      lastSeen: timestamp,
      frameIds: [],
      confidence: source.confidence,
    });
    return id;
  }

  // Register every entity the model declared up front, provisionally
  // anchored at `defaultTimestamp` — refined to the entity's actual
  // referenced timestamps below as interactions/references are processed.
  for (const entity of raw.entities) {
    ensureEntity(entity, defaultTimestamp);
  }

  /** Resolves a bare label the model used inline (as an interaction/reference target) to an entity id, defensively creating a minimal entity if the model referenced a label it never declared up front — never silently dropping evidence the model itself provided. */
  function resolveLabel(label: string, timestamp: number): string {
    const key = labelKey(label);
    const existingId = idByLabel.get(key);
    if (existingId) {
      const entity = entityById.get(existingId)!;
      entity.firstSeen = Math.min(entity.firstSeen, timestamp);
      entity.lastSeen = Math.max(entity.lastSeen, timestamp);
      return existingId;
    }
    return ensureEntity({ label, type: 'object', confidence: 0.5 }, timestamp);
  }

  const interactions: Interaction[] = [];
  for (const source of raw.interactions) {
    interactions.push({
      id: generateId('interaction'),
      type: source.type,
      timestamp: source.windowTimestamp,
      evidenceLevel: source.evidenceLevel,
      confidence: source.confidence,
      ...(source.actorLabel ? { actorEntityId: resolveLabel(source.actorLabel, source.windowTimestamp) } : {}),
      ...(source.targetLabel ? { targetEntityId: resolveLabel(source.targetLabel, source.windowTimestamp) } : {}),
    });
  }

  const references: LinguisticReference[] = [];
  for (const source of raw.references) {
    references.push({
      id: generateId('reference'),
      timestamp: source.windowTimestamp,
      phrase: source.phrase,
      segmentIndex: segmentIndexByTimestamp.get(source.windowTimestamp) ?? -1,
      relation: source.relation,
      evidenceLevel: source.evidenceLevel,
      confidence: source.confidence,
      ...(source.targetLabel ? { targetEntityId: resolveLabel(source.targetLabel, source.windowTimestamp) } : {}),
    });
  }

  return { entities: [...entityById.values()], interactions, references };
}

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}
