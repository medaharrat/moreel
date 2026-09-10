import type { Transcript } from '../domain/transcript.js';

/**
 * One transcript moment worth targeted visual analysis — a deictic word
 * ("this", "here") or a topic word ("product", "screen") that a transcript
 * alone cannot resolve. This is Stage 2 of the pipeline (see
 * video-map-builder.ts): coarse sampling already ran; this picks *which*
 * moments are worth spending an extra vision call on, instead of analyzing
 * every frame equally.
 */
export interface TriggerWindow {
  timestamp: number;
  segmentIndex: number;
  phrase: string;
  text: string;
}

/**
 * Deliberately small, hand-picked vocabulary (per the spec) rather than an
 * NLP pipeline — the point is cheap, high-precision candidate selection,
 * not exhaustive linguistic analysis. Longer/more specific phrases are
 * listed first so overlapping matches (e.g. "look at" inside a segment
 * that also just says "look") report the more specific phrase.
 */
const TRIGGER_PHRASES = [
  'this one',
  'that one',
  'look at',
  'this is my favorite',
  'this',
  'that',
  'here',
  'look',
  'see',
  'shown',
  'favorite',
  'product',
  'camera',
  'phone',
  'screen',
  'example',
] as const;

const TRIGGER_PATTERNS = TRIGGER_PHRASES.map(
  (phrase) => [phrase, new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'i')] as const,
);

/** Two windows within this many seconds of each other are treated as one — no point analyzing the same moment twice. */
const MERGE_WINDOW_SECONDS = 2;

/**
 * Scans the transcript for linguistic triggers a transcript alone can't
 * resolve, returning at most `maxWindows` candidates (highest-signal
 * phrases first, then earliest first) — this is what bounds the cost of
 * targeted analysis regardless of transcript length.
 */
export function findTriggerWindows(transcript: Transcript, maxWindows = 8): TriggerWindow[] {
  const candidates: TriggerWindow[] = [];

  transcript.segments.forEach((segment, segmentIndex) => {
    const lower = segment.text.toLowerCase();
    for (const [phrase, pattern] of TRIGGER_PATTERNS) {
      if (pattern.test(lower)) {
        candidates.push({
          timestamp: segment.start,
          segmentIndex,
          phrase,
          text: segment.text,
        });
        break; // One trigger per segment is enough signal; avoid double-counting the same moment.
      }
    }
  });

  const merged: TriggerWindow[] = [];
  for (const candidate of candidates.sort((a, b) => a.timestamp - b.timestamp)) {
    const prev = merged[merged.length - 1];
    if (prev && candidate.timestamp - prev.timestamp <= MERGE_WINDOW_SECONDS) continue;
    merged.push(candidate);
  }

  return merged.slice(0, maxWindows);
}
