import type { SourceId, Transcript } from './transcript.js';
import type { VisualObservation, VisualObservationType } from './vision.js';
import type { Interaction, LinguisticReference, Scene, VisualEntity } from './video-map.js';

/**
 * The persisted, queryable representation of a fully-processed video —
 * everything `search_video`/`find_moment`/`get_video_timeline` operate on.
 * `TranscribeVideoResult` (transcript.ts) is the flat, transport-shaped
 * response of a single call; `VideoRecord` is what gets stored so later
 * calls (by a different caller, over MCP or HTTP) can query the same video
 * again without re-processing it.
 */
export interface VideoRecord {
  /** Stable id derived from the provider + canonical content identity of the source URL (see cache/keys.ts computeVideoId). Same URL always yields the same id. */
  id: string;
  source: SourceId;
  sourceUrl: string;
  title: string | undefined;
  creatorName?: string | undefined;
  creatorUrl?: string | undefined;
  durationSeconds: number;
  /** ISO 8601 timestamp of when this video was processed. */
  createdAt: string;
  transcript: Transcript;
  visualObservations: VisualObservation[];
  /** Precomputed embeddings for semantic search, one per timeline event — see app/semantic-search.ts. Absent when SEARCH_EMBEDDINGS_ENABLED is off or embedding generation failed (search still works lexically). */
  embeddings?: EmbeddingEntry[] | undefined;
  /**
   * The Video Map layer (see domain/video-map.ts) — absent entirely when
   * `VIDEO_MAP_ENABLED` is off, analysis found nothing, or it failed
   * (best-effort, like vision/embeddings: never blocks the rest of the
   * record from being usable).
   */
  scenes?: Scene[] | undefined;
  entities?: VisualEntity[] | undefined;
  interactions?: Interaction[] | undefined;
  references?: LinguisticReference[] | undefined;
}

/** One timeline event's vector, keyed by (timestamp, source) so it can be matched back to the event it came from without assuming array order. */
export interface EmbeddingEntry {
  timestamp: number;
  source: TimelineEventSource;
  vector: number[];
}

/** A single point (or span) on the unified timeline, one modality at a time. */
export type TimelineEventSource = 'speech' | VisualObservationType | 'interaction' | 'reference';

export interface TimelineEvent {
  timestamp: number;
  endTimestamp?: number | undefined;
  source: TimelineEventSource;
  text: string;
  confidence?: number | undefined;
  frameId?: string | undefined;
}
