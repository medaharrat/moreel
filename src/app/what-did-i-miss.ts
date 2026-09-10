import type { MissedMoment } from '../domain/search.js';
import type { Transcript } from '../domain/transcript.js';
import type { VisualObservationType, VisualObservation } from '../domain/vision.js';
import type { Interaction, LinguisticReference, MissedMomentCategory, VisualEntity } from '../domain/video-map.js';

const DEFAULT_WINDOW_SECONDS = 6;
/** Below this fraction of shared tokens, a visual observation is considered independent of what was said nearby — tuned loosely, not a hard science; see the doc comment on findMissedMoments. */
const OVERLAP_THRESHOLD = 0.2;

export interface WhatDidIMissMapData {
  interactions?: Interaction[] | undefined;
  references?: LinguisticReference[] | undefined;
  entities?: VisualEntity[] | undefined;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function tokenOverlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared++;
  }
  return shared / a.size;
}

function nearbyTranscriptText(transcript: Transcript, timestamp: number, windowSeconds: number): string {
  return transcript.segments
    .filter((segment) => segment.end >= timestamp - windowSeconds && segment.start <= timestamp + windowSeconds)
    .map((segment) => segment.text)
    .join(' ');
}

/** Per spec section 14: ON_SCREEN_TEXT and VISUAL_CONTEXT map directly from the observation type; everything else visual-but-unclassified falls back to NOT_SPOKEN rather than a made-up specific category. */
function categorizeObservation(type: VisualObservationType): MissedMomentCategory {
  if (type === 'on_screen_text') return 'ON_SCREEN_TEXT';
  if (type === 'visual_context') return 'VISUAL_CONTEXT';
  return 'NOT_SPOKEN';
}

/**
 * Identifies visual information the spoken transcript doesn't cover — the
 * concrete answer to "what did I miss?" Two independent sources feed this:
 *
 *   - `VisualObservation`s (existing behavior): text/scene content shown
 *     but not mentioned nearby in speech.
 *   - Video Map interactions/references (new): when the speaker says "this
 *     one" and the map resolved it to a specific entity, the entity's own
 *     label is very rarely spoken aloud by name — that's exactly the
 *     information "what did I miss?" should recover, classified as
 *     VISUAL_ACTION/VISUAL_REFERENCE rather than a generic "something
 *     appeared" (see spec section 14's own example). Uncertain
 *     interactions/references (no resolved target) contribute nothing —
 *     there's no target label to report as missed.
 *
 * This stays intentionally simple lexical overlap, not semantic similarity
 * — no extra model call, and it favors surfacing too much over silently
 * hiding something a listener would have missed.
 */
export function findMissedMoments(
  transcript: Transcript,
  visualObservations: VisualObservation[],
  windowSeconds: number = DEFAULT_WINDOW_SECONDS,
  mapData?: WhatDidIMissMapData,
): MissedMoment[] {
  const missed: MissedMoment[] = [];

  for (const observation of visualObservations) {
    const nearbyText = nearbyTranscriptText(transcript, observation.timestamp, windowSeconds);
    const overlap = tokenOverlapRatio(tokenize(observation.text), tokenize(nearbyText));

    if (overlap < OVERLAP_THRESHOLD) {
      missed.push({
        timestamp: observation.timestamp,
        ...(observation.endTimestamp !== undefined ? { endTimestamp: observation.endTimestamp } : {}),
        type: observation.type,
        category: categorizeObservation(observation.type),
        text: observation.text,
        ...(observation.confidence !== undefined ? { confidence: observation.confidence } : {}),
        ...(observation.frameId !== undefined ? { frameId: observation.frameId } : {}),
      });
    }
  }

  const labelById = new Map((mapData?.entities ?? []).map((entity) => [entity.id, entity.label]));

  for (const interaction of mapData?.interactions ?? []) {
    if (!interaction.targetEntityId) continue; // Nothing resolved — no target label to compare or report.
    const label = labelById.get(interaction.targetEntityId);
    if (!label) continue;

    const nearbyText = nearbyTranscriptText(transcript, interaction.timestamp, windowSeconds);
    const overlap = tokenOverlapRatio(tokenize(label), tokenize(nearbyText));
    if (overlap < OVERLAP_THRESHOLD) {
      missed.push({
        timestamp: interaction.timestamp,
        ...(interaction.endTimestamp !== undefined ? { endTimestamp: interaction.endTimestamp } : {}),
        type: 'interaction',
        category: 'VISUAL_ACTION',
        text: `${interaction.type} → ${label}`,
        confidence: interaction.confidence,
      });
    }
  }

  for (const reference of mapData?.references ?? []) {
    if (!reference.targetEntityId) continue;
    const label = labelById.get(reference.targetEntityId);
    if (!label) continue;

    const nearbyText = nearbyTranscriptText(transcript, reference.timestamp, windowSeconds);
    const overlap = tokenOverlapRatio(tokenize(label), tokenize(nearbyText));
    if (overlap < OVERLAP_THRESHOLD) {
      missed.push({
        timestamp: reference.timestamp,
        type: 'reference',
        category: 'VISUAL_REFERENCE',
        text: `"${reference.phrase}" → ${label}`,
        confidence: reference.confidence,
      });
    }
  }

  return missed.sort((a, b) => a.timestamp - b.timestamp);
}
