import type { MapInteraction, MapReference, MissedMoment, SearchResultItem, Transcript, TimelineSource, VideoUrl, VisualObservationType } from '../types';
import { describeVideo, detectVideoUrl } from './detectVideoUrl';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

interface ApiSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

interface ApiTranscribeResponse {
  id: string;
  videoId?: string;
  source: string;
  url: string;
  durationSeconds: number;
  language?: string;
  lowConfidence: boolean;
  text: string;
  segments: ApiSegment[];
  /** Relative path (e.g. `/media/{id}`) — resolved against API_BASE_URL below. */
  mediaUrl?: string;
  caption?: string;
  creatorName?: string;
  creatorUrl?: string;
  likeCount?: number;
  commentCount?: number;
  postedAt?: string;
  visual?: {
    observations: Array<{
      timestamp: number;
      endTimestamp?: number;
      type: VisualObservationType;
      text: string;
      confidence?: number;
      /** Relative path (e.g. `/media/{id}`) — resolved against API_BASE_URL below, same as mediaUrl. */
      frameUrl?: string;
    }>;
  };
  map?: {
    interactions: MapInteraction[];
    references: MapReference[];
  };
}

interface ApiErrorResponse {
  error: { code: string; message: string; retryable: boolean };
}

export class TranscriptionApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'TranscriptionApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Maps the backend's flat response shape into the frontend's `Transcript`.
 * `video` is reconstructed from the stored `url` when the caller doesn't
 * already have one (e.g. loading a permalink fresh, with no in-memory
 * `VideoUrl` from the original submission).
 */
function toTranscript(body: ApiTranscribeResponse, video: VideoUrl): Transcript {
  return {
    id: body.id,
    ...(body.videoId ? { videoId: body.videoId } : {}),
    video,
    title: describeVideo(video),
    durationSeconds: body.durationSeconds,
    lowConfidence: body.lowConfidence,
    segments: body.segments.map((segment) => ({
      id: segment.id,
      startSeconds: segment.start,
      endSeconds: segment.end,
      text: segment.text,
    })),
    ...(body.mediaUrl ? { mediaUrl: `${API_BASE_URL}${body.mediaUrl}` } : {}),
    ...(body.caption ? { caption: body.caption } : {}),
    ...(body.creatorName ? { creatorName: body.creatorName } : {}),
    ...(body.creatorUrl ? { creatorUrl: body.creatorUrl } : {}),
    ...(typeof body.likeCount === 'number' ? { likeCount: body.likeCount } : {}),
    ...(typeof body.commentCount === 'number' ? { commentCount: body.commentCount } : {}),
    ...(body.postedAt ? { postedAt: body.postedAt } : {}),
    ...(body.visual?.observations.length
      ? {
          visualObservations: body.visual.observations.map((obs) => ({
            startSeconds: obs.timestamp,
            ...(typeof obs.endTimestamp === 'number' ? { endSeconds: obs.endTimestamp } : {}),
            type: obs.type,
            text: obs.text,
            ...(typeof obs.confidence === 'number' ? { confidence: obs.confidence } : {}),
            ...(obs.frameUrl ? { frameUrl: `${API_BASE_URL}${obs.frameUrl}` } : {}),
          })),
        }
      : {}),
    ...(body.map && (body.map.interactions.length > 0 || body.map.references.length > 0) ? { map: body.map } : {}),
  };
}

export interface TranscribeVideoOptions {
  /** Per-request opt-in for the (server-gated) vision pipeline — the composer's "advanced options" toggle. */
  includeVisual?: boolean;
  /** Per-request opt-in for the (server-gated) Video Map — the composer's "advanced options" toggle. Has no effect when includeVisual is false. */
  includeVideoMap?: boolean;
}

/**
 * Calls the real backend (`POST /transcribe`, see src/http/routes/transcribe.ts)
 * and maps its response into the frontend's `Transcript` shape.
 */
export async function transcribeVideo(video: VideoUrl, options: TranscribeVideoOptions = {}): Promise<Transcript> {
  const response = await fetch(`${API_BASE_URL}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: video.url,
      ...(options.includeVisual !== undefined ? { includeVisual: options.includeVisual } : {}),
      ...(options.includeVideoMap !== undefined ? { includeVideoMap: options.includeVideoMap } : {}),
    }),
  });

  const body = (await response.json()) as ApiTranscribeResponse | ApiErrorResponse;

  if (!response.ok || 'error' in body) {
    const err = 'error' in body ? body.error : { code: 'INTERNAL_ERROR', message: 'Something went wrong.', retryable: true };
    throw new TranscriptionApiError(err.code, err.message, err.retryable);
  }

  return toTranscript(body, video);
}

/**
 * Re-loads a transcript by its permalink id (`GET /transcripts/:id`, see
 * src/http/routes/transcripts.ts) — backs the `/transcripts/:id` route and
 * the "Copy link" action. Only available when the backend has Redis
 * configured; a stale/unknown id resolves to `null` (expired past its TTL,
 * or Redis wasn't configured when it was created), not an error — the
 * caller decides how to present "this link no longer works".
 */
export async function fetchTranscriptById(id: string): Promise<Transcript | null> {
  const response = await fetch(`${API_BASE_URL}/transcripts/${encodeURIComponent(id)}`);
  if (!response.ok) return null;

  const body = (await response.json()) as ApiTranscribeResponse;
  const video = detectVideoUrl(body.url) ?? { url: body.url, platform: 'instagram' as const, type: 'reel' as const };
  return toTranscript(body, video);
}

interface ApiSearchResult {
  timestamp: number;
  endTimestamp?: number;
  source: TimelineSource;
  text: string;
  confidence?: number;
  frameUrl?: string;
}

interface ApiMissedMoment {
  timestamp: number;
  endTimestamp?: number;
  type: VisualObservationType;
  text: string;
  confidence?: number;
  frameUrl?: string;
}

function resolveFrameUrl(frameUrl: string | undefined): string | undefined {
  return frameUrl ? `${API_BASE_URL}${frameUrl}` : undefined;
}

/**
 * Searches across every information channel of a video Moreel has already
 * processed — spoken transcript AND on-screen/visual content — via
 * `GET /videos/:id/search` (see src/http/routes/videos.ts). Powers
 * VideoSearch.tsx; requires the `videoId` `transcribeVideo` returned.
 */
export async function searchVideo(videoId: string, query: string): Promise<SearchResultItem[]> {
  const response = await fetch(`${API_BASE_URL}/videos/${encodeURIComponent(videoId)}/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const body = (await response.json()) as { results: ApiSearchResult[] };
  return body.results.map((result) => ({
    timestamp: result.timestamp,
    ...(result.endTimestamp !== undefined ? { endTimestamp: result.endTimestamp } : {}),
    source: result.source,
    text: result.text,
    ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
    ...(resolveFrameUrl(result.frameUrl) ? { frameUrl: resolveFrameUrl(result.frameUrl) } : {}),
  }));
}

/**
 * Fetches visual observations that stand alone — recoverable only by
 * watching, not by reading the transcript — via `GET /videos/:id/missed`.
 * Powers WhatDidIMiss.tsx.
 */
export async function fetchMissedMoments(videoId: string): Promise<MissedMoment[]> {
  const response = await fetch(`${API_BASE_URL}/videos/${encodeURIComponent(videoId)}/missed`);
  if (!response.ok) return [];
  const body = (await response.json()) as { missed: ApiMissedMoment[] };
  return body.missed.map((moment) => ({
    timestamp: moment.timestamp,
    ...(moment.endTimestamp !== undefined ? { endTimestamp: moment.endTimestamp } : {}),
    type: moment.type,
    text: moment.text,
    ...(moment.confidence !== undefined ? { confidence: moment.confidence } : {}),
    ...(resolveFrameUrl(moment.frameUrl) ? { frameUrl: resolveFrameUrl(moment.frameUrl) } : {}),
  }));
}
