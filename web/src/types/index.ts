export type VideoPlatform = 'instagram' | 'tiktok' | 'youtube';

export type VideoType = 'reel' | 'short' | 'video' | 'post';

export interface VideoUrl {
  url: string;
  platform: VideoPlatform;
  type: VideoType;
}

export interface TranscriptSegment {
  id: string;
  startSeconds: number;
  /** Used for gap-based paragraph grouping (a real pause is a stronger break signal than character count alone) — see groupIntoParagraphs. */
  endSeconds: number;
  text: string;
}

export type VisualObservationType =
  | 'on_screen_text'
  | 'visual_context'
  | 'scene'
  | 'object'
  | 'ui'
  | 'chart'
  | 'document'
  | 'product'
  | 'logo';

/** Every modality a timeline event, search result, or missed moment can come from — "speech" is spoken content, anything else is visual. */
export type TimelineSource = 'speech' | VisualObservationType | 'interaction' | 'reference';

/** Something the speaker visibly did (pointing, showing, holding, ...) resolved to a specific visual entity — see MapLayer.tsx. */
export interface MapInteraction {
  timestamp: number;
  type: string;
  targetLabel: string;
  confidence: number;
}

/** A "this"/"that"/"this one" resolved to a specific visual entity — see MapLayer.tsx. */
export interface MapReference {
  timestamp: number;
  phrase: string;
  targetLabel: string;
  confidence: number;
}

/** One hit from searching across speech and every visual observation type — see VideoSearch.tsx. */
export interface SearchResultItem {
  timestamp: number;
  endTimestamp?: number;
  source: TimelineSource;
  text: string;
  confidence?: number;
  frameUrl?: string;
}

/** A visual observation identified as something a listener (not a watcher) would have missed — see WhatDidIMiss.tsx. */
export interface MissedMoment {
  timestamp: number;
  endTimestamp?: number;
  type: VisualObservationType;
  text: string;
  confidence?: number;
  frameUrl?: string;
}

/**
 * A separate layer from the spoken transcript, never merged into it —
 * "what was visibly shown", associated with the transcript only by
 * timestamp. Matched to whichever paragraph's time range it falls within at
 * render time (see TranscriptView's groupIntoParagraphs); paragraphs have
 * no stable identity of their own to attach this to directly.
 */
export interface VisualObservation {
  startSeconds: number;
  /** When this observation spans a range rather than a single instant (e.g. on-screen text visible for several seconds). */
  endSeconds?: number;
  type: VisualObservationType;
  /** Detected/described content, preserved verbatim — never "corrected". */
  text: string;
  /** Confidence in [0, 1], when the vision provider reported one. */
  confidence?: number;
  /** A still frame captured at this moment, when available. */
  frameUrl?: string;
}

export interface Transcript {
  id: string;
  /** Stable id for search_video/get_video_timeline lookups — see VideoSearch.tsx, WhatDidIMiss.tsx. Absent if the backend couldn't persist a video record. */
  videoId?: string;
  video: VideoUrl;
  title?: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
  /**
   * Streams the video Moreel already downloaded to produce this transcript,
   * for a short window (see MediaStore on the backend) — not a persisted
   * copy. Falls back to a third-party embed when absent.
   */
  mediaUrl?: string;
  /** The post's caption/description, when the provider surfaced one. */
  caption?: string;
  /** The creator's display name, when known. */
  creatorName?: string;
  /** The creator's public profile URL, when known. */
  creatorUrl?: string;
  /** Like count at fetch time, when the provider surfaced one. */
  likeCount?: number;
  /** Comment count at fetch time, when the provider surfaced one. */
  commentCount?: number;
  /** When the post was published, as an ISO 8601 string. */
  postedAt?: string;
  /** Meaningful visual information Moreel detected — present only when visual analysis ran and found something worth surfacing. */
  visualObservations?: VisualObservation[];
  /** Resolved "this"/"that"/pointing references — present only when the Video Map ran and resolved at least one to a specific visual target. */
  map?: {
    interactions: MapInteraction[];
    references: MapReference[];
  };
}

export type ProcessingState =
  | { status: 'empty' }
  | { status: 'focused' }
  | { status: 'detected'; video: VideoUrl }
  | { status: 'processing'; video: VideoUrl }
  | { status: 'success'; transcript: Transcript }
  | { status: 'error'; message: string; video?: VideoUrl };

export type DownloadFormat = 'txt' | 'srt' | 'json';
