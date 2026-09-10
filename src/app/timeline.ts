import type { Transcript } from '../domain/transcript.js';
import type { VisualObservation } from '../domain/vision.js';
import type { TimelineEvent } from '../domain/video.js';
import type { Interaction, LinguisticReference, VisualEntity } from '../domain/video-map.js';

export interface VideoMapData {
  entities?: VisualEntity[] | undefined;
  interactions?: Interaction[] | undefined;
  references?: LinguisticReference[] | undefined;
}

/**
 * Merges every modality — spoken transcript, visual observations, and (when
 * present) the Video Map's interactions/references — into one chronological
 * view, the primitive every higher-level feature (search, "what did I
 * miss", timeline rendering, MCP `get_video_timeline`) is built on. Never
 * mutates or mixes the underlying text: a speech event's `text` is exactly
 * what was said, a visual event's `text` is exactly what the vision
 * provider reported; interaction/reference text is a short, deliberately
 * templated description ("points_at → pink phone case"), always
 * distinguished by `source` from what was actually said or shown.
 */
export function buildTimeline(
  transcript: Transcript,
  visualObservations: VisualObservation[],
  mapData?: VideoMapData,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const segment of transcript.segments) {
    events.push({
      timestamp: segment.start,
      endTimestamp: segment.end,
      source: 'speech',
      text: segment.text,
      ...(segment.confidence !== undefined ? { confidence: segment.confidence } : {}),
    });
  }

  for (const observation of visualObservations) {
    events.push({
      timestamp: observation.timestamp,
      ...(observation.endTimestamp !== undefined ? { endTimestamp: observation.endTimestamp } : {}),
      source: observation.type,
      text: observation.text,
      ...(observation.confidence !== undefined ? { confidence: observation.confidence } : {}),
      ...(observation.frameId !== undefined ? { frameId: observation.frameId } : {}),
    });
  }

  const labelById = new Map((mapData?.entities ?? []).map((entity) => [entity.id, entity.label]));

  for (const interaction of mapData?.interactions ?? []) {
    const targetLabel = interaction.targetEntityId ? labelById.get(interaction.targetEntityId) : undefined;
    events.push({
      timestamp: interaction.timestamp,
      ...(interaction.endTimestamp !== undefined ? { endTimestamp: interaction.endTimestamp } : {}),
      source: 'interaction',
      text: targetLabel ? `${interaction.type} → ${targetLabel}` : interaction.type,
      confidence: interaction.confidence,
    });
  }

  for (const reference of mapData?.references ?? []) {
    const targetLabel = reference.targetEntityId ? labelById.get(reference.targetEntityId) : undefined;
    events.push({
      timestamp: reference.timestamp,
      source: 'reference',
      text: targetLabel ? `"${reference.phrase}" → ${targetLabel}` : `"${reference.phrase}" (uncertain)`,
      confidence: reference.confidence,
    });
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/** All timeline events whose span overlaps `[start, end]` — the basis of "what happened around timestamp X?". */
export function eventsInRange(events: TimelineEvent[], start: number, end: number): TimelineEvent[] {
  return events.filter((event) => {
    const eventEnd = event.endTimestamp ?? event.timestamp;
    return eventEnd >= start && event.timestamp <= end;
  });
}
