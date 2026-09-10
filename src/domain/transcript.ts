import type { VisualObservation } from './vision.js';

/**
 * Normalized, provider-agnostic domain types produced by the pipeline.
 * Nothing downstream of `Transcriber` should know which video platform or
 * which transcription vendor produced this data.
 */

/** A supported source provider. Extend as new `VideoProvider`s are added. */
export type SourceId = 'instagram' | 'tiktok' | 'youtube';

export interface VideoAsset {
  /** Absolute path to a temporary local file holding the downloaded media. */
  filePath: string;
  /** Best-effort content type as reported by the origin, not trusted for parsing. */
  contentType: string;
  /** Size in bytes of the downloaded file. */
  sizeBytes: number;
  /** Duration in seconds, when known before/at download time. */
  durationSeconds: number | undefined;
  /** The provider that produced this asset. */
  source: SourceId;
  /** The canonical/normalized URL the asset was fetched from. */
  sourceUrl: string;
  /** The post's caption/description, when the provider surfaces one. */
  caption?: string | undefined;
  /** The creator's display name, when known. */
  creatorName?: string | undefined;
  /** The creator's public profile URL, when known. */
  creatorUrl?: string | undefined;
  /** Like count at fetch time, when the provider surfaces one. */
  likeCount?: number | undefined;
  /** Comment count at fetch time, when the provider surfaces one. */
  commentCount?: number | undefined;
  /** When the post was published, as an ISO 8601 string. */
  postedAt?: string | undefined;
}

export interface AudioAsset {
  /** Absolute path to a temporary local file holding extracted audio. */
  filePath: string;
  /** Audio format/container, e.g. "wav", "mp3". */
  format: string;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Size in bytes of the audio file. */
  sizeBytes: number;
}

export interface TranscriptSegment {
  /** Start time in seconds, relative to the start of the media. */
  start: number;
  /** End time in seconds. Always >= start. */
  end: number;
  /** Transcribed text for this segment. */
  text: string;
  /**
   * Confidence in [0, 1] when the transcription provider exposes one.
   * Omitted when the provider does not report per-segment confidence.
   */
  confidence?: number;
}

export interface Transcript {
  /** Full plain-text transcript, segments joined in order. */
  text: string;
  /** Timestamped segments in chronological order. */
  segments: TranscriptSegment[];
  /** BCP-47-ish language code detected by the transcriber, e.g. "en". */
  language: string | undefined;
  /** Total audio duration in seconds. */
  durationSeconds: number;
  /**
   * True when the transcriber flagged low confidence / mostly non-speech
   * audio. The tool surfaces this instead of guessing at unclear speech.
   */
  lowConfidence: boolean;
}

/** The exact shape returned by the `transcribe_video` MCP tool on success. */
export interface TranscribeVideoResult {
  /**
   * Stable id for this video (see cache/keys.ts computeVideoId), usable
   * with `search_video`, `find_moment`, and `get_video_timeline` without
   * re-submitting the URL. Present whenever the pipeline could persist a
   * `VideoRecord` — absent only if no video store is configured at all.
   */
  video_id?: string | undefined;
  source: SourceId;
  url: string;
  duration_seconds: number;
  language: string | undefined;
  low_confidence: boolean;
  segments: Array<{ start: number; end: number; text: string }>;
  text: string;
  /** The post's caption/description, when the provider surfaced one. */
  caption?: string | undefined;
  /** The creator's display name, when known. */
  creatorName?: string | undefined;
  /** The creator's public profile URL, when known. */
  creatorUrl?: string | undefined;
  /** Like count at fetch time, when the provider surfaced one. */
  likeCount?: number | undefined;
  /** Comment count at fetch time, when the provider surfaced one. */
  commentCount?: number | undefined;
  /** When the post was published, as an ISO 8601 string. */
  postedAt?: string | undefined;
  /**
   * Present only when the vision pipeline ran (opt-in, see `VISION_ENABLED`)
   * and found something worth surfacing — never a required field, and an
   * empty/absent `visual` means exactly what it says: nothing meaningful was
   * detected, not that vision wasn't attempted.
   */
  visual?: { observations: VisualObservation[] } | undefined;
  /**
   * Present only when the Video Map ran (`VIDEO_MAP_ENABLED`) and resolved
   * at least one interaction/reference to a specific visual target — a
   * flat, transport-facing summary. Uncertain (unresolved) interactions/
   * references are omitted here; the full picture including those is
   * available via `get_video_map`/`GET /videos/:id/map`.
   */
  map?:
    | {
        interactions: Array<{ timestamp: number; type: string; targetLabel: string; confidence: number }>;
        references: Array<{ timestamp: number; phrase: string; targetLabel: string; confidence: number }>;
      }
    | undefined;
}

export function transcriptToToolResult(
  source: SourceId,
  url: string,
  transcript: Transcript,
  meta?: {
    videoId?: string | undefined;
    caption?: string | undefined;
    creatorName?: string | undefined;
    creatorUrl?: string | undefined;
    likeCount?: number | undefined;
    commentCount?: number | undefined;
    postedAt?: string | undefined;
    visual?: { observations: VisualObservation[] } | undefined;
    map?: TranscribeVideoResult['map'];
  },
): TranscribeVideoResult {
  return {
    video_id: meta?.videoId,
    source,
    url,
    duration_seconds: round2(transcript.durationSeconds),
    language: transcript.language,
    low_confidence: transcript.lowConfidence,
    segments: transcript.segments.map((segment) => ({
      start: round2(segment.start),
      end: round2(segment.end),
      text: segment.text,
    })),
    text: transcript.text,
    caption: meta?.caption,
    creatorName: meta?.creatorName,
    creatorUrl: meta?.creatorUrl,
    likeCount: meta?.likeCount,
    commentCount: meta?.commentCount,
    postedAt: meta?.postedAt,
    visual: meta?.visual,
    map: meta?.map,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
