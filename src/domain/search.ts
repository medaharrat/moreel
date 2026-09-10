import type { TimelineEventSource } from './video.js';
import type { MissedMomentCategory } from './video-map.js';

/** One hit from `search_video`/`find_moment` — always anchored to a timestamp, never a prose summary. */
export interface SearchResult {
  timestamp: number;
  endTimestamp?: number | undefined;
  source: TimelineEventSource;
  text: string;
  /** Confidence in [0, 1], carried through from the originating observation when it has one. */
  confidence?: number | undefined;
  frameId?: string | undefined;
  /** How well this result matched the query — higher is better, not normalized to any fixed range. Used only for ranking, not shown as a percentage. */
  score: number;
}

/** A visual observation identified as recoverable only by watching, not by reading the transcript. See app/what-did-i-miss.ts. */
export interface MissedMoment {
  timestamp: number;
  endTimestamp?: number | undefined;
  type: TimelineEventSource;
  /** How this moment is classified — e.g. distinguishing "shown but never named" (VISUAL_ACTION/VISUAL_REFERENCE, from the Video Map) from plain on-screen text or scene context. See domain/video-map.ts. */
  category: MissedMomentCategory;
  text: string;
  confidence?: number | undefined;
  frameId?: string | undefined;
}
