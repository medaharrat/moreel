import type { Transcript, TranscriptSegment } from '../domain/transcript.js';

/**
 * Raw, provider-shaped segment before normalization. Confidence signals are
 * optional because not every transcription provider exposes them.
 */
export interface RawSegment {
  start: number;
  end: number;
  text: string;
  /** Provider-reported average log-probability; higher (closer to 0) is more confident. */
  avgLogProb?: number;
  /** Provider-reported probability that the segment contains no speech. */
  noSpeechProb?: number;
}

export interface NormalizeOptions {
  language: string | undefined;
  durationSeconds: number;
  /** Segments with noSpeechProb at or above this are treated as non-speech and dropped. */
  noSpeechThreshold?: number;
  /** Segments with avgLogProb at or below this are treated as unreliable. */
  lowConfidenceLogProbThreshold?: number;
}

/**
 * The bar for the *combined* check below, not a standalone drop — see
 * `VERY_HIGH_NO_SPEECH_THRESHOLD` for that. Calibrated against real cases,
 * most recently a fully-silent 16s Reel where Whisper hallucinated a
 * one-word filler ("Oh", noSpeechProb 0.467, avgLogProb -0.86) that the
 * previous bar of 0.6 missed entirely — confirmed via a direct raw API
 * call, not guessed. Lowered to 0.45, just under that real value; the
 * combined AND with a poor avgLogProb (see
 * `ELEVATED_NO_SPEECH_LOGPROB_THRESHOLD`) is still what protects genuine
 * quiet/uncertain speech at this noSpeechProb level, not this bar alone.
 */
const DEFAULT_NO_SPEECH_THRESHOLD = 0.45;
const DEFAULT_LOW_CONFIDENCE_LOGPROB = -1.0;
/**
 * `noSpeechProb` on its own is unreliable above this point: Whisper computes
 * it once per ~30s decode window, not per segment, so every segment sharing
 * a window inherits the same value — including real, coherent speech, if
 * that window happens to open with a pause, background music, or a quiet
 * intro. A value at or above this bar is treated as silence regardless of
 * `avgLogProb`; below it, `noSpeechProb` alone is not trusted to drop a
 * segment — see the combined check below.
 */
const VERY_HIGH_NO_SPEECH_THRESHOLD = 0.9;
/**
 * The avgLogProb bar for the *combined* check only — deliberately less
 * strict than `lowConfidenceLogProbThreshold` (which just flags, never
 * drops). Calibrated against three real cases: a genuine hallucination
 * (noSpeechProb 0.88, avgLogProb -0.9 — dropped), real coherent speech
 * misflagged by a shared window-level noSpeechProb (noSpeechProb 0.77,
 * avgLogProb -0.25 — kept), and a hallucinated filler word on silent audio
 * (noSpeechProb 0.467, avgLogProb -0.86 — dropped, see
 * `DEFAULT_NO_SPEECH_THRESHOLD`'s doc comment). Confident real speech
 * rarely scores worse than this even when noSpeechProb is elevated for
 * unrelated reasons.
 */
const ELEVATED_NO_SPEECH_LOGPROB_THRESHOLD = -0.6;

/**
 * A well-documented Whisper failure mode, distinct from generic
 * low-confidence output: on silent/music-only/no-speech audio, the model
 * doesn't just produce uncertain text — it confidently hallucinates
 * boilerplate subtitle-credit lines it saw repeatedly in its training data
 * (real YouTube auto-captions from community-translated videos). Because
 * the hallucination is fluent and "confident", it often has a low
 * `noSpeechProb` and a perfectly normal `avgLogProb`, slipping straight
 * past both of the filters above. Matched independently of those scores.
 */
const HALLUCINATED_CAPTION_PATTERNS = [
  /subtitle[sd]?\s+(by|provided\s+by|created\s+by)\b/i,
  /subtitled?\s+by\s+the\s+(amara\.org\s+)?community/i,
  /transcrib(ed|ing)\s+by\b/i,
  /\bamara\.org\b/i,
];

function isHallucinatedCaption(text: string): boolean {
  return HALLUCINATED_CAPTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Converts raw provider segments into a normalized `Transcript`:
 *   - drops segments the model itself flagged as very likely non-speech
 *     (silence, music) rather than keeping fabricated text for them
 *   - drops known hallucinated subtitle-credit boilerplate (e.g. "Subtitles
 *     by ...") that Whisper confidently fabricates on silent/no-speech
 *     audio — see HALLUCINATED_CAPTION_PATTERNS
 *   - clamps timestamps to `[0, durationSeconds]` and drops inverted/zero-length ranges
 *   - collapses runs of >2 exact-duplicate consecutive segments, a known
 *     Whisper failure mode on silence/music where it "loops" a phrase
 *   - trims whitespace and collapses internal double-spacing without
 *     touching wording, so meaning is never altered
 *   - surfaces `lowConfidence: true` at the transcript level instead of
 *     silently presenting uncertain text as fact
 */
export function normalizeTranscript(
  rawSegments: RawSegment[],
  options: NormalizeOptions,
): Transcript {
  const noSpeechThreshold = options.noSpeechThreshold ?? DEFAULT_NO_SPEECH_THRESHOLD;
  const lowConfidenceLogProb =
    options.lowConfidenceLogProbThreshold ?? DEFAULT_LOW_CONFIDENCE_LOGPROB;

  let lowConfidence = false;
  const cleaned: TranscriptSegment[] = [];

  for (const raw of rawSegments) {
    const start = clamp(raw.start, 0, options.durationSeconds);
    const end = clamp(raw.end, 0, options.durationSeconds);
    if (end <= start) continue;

    const text = normalizeWhitespace(raw.text);
    if (text.length === 0) continue;

    if (raw.noSpeechProb !== undefined) {
      const veryLikelySilence = raw.noSpeechProb >= VERY_HIGH_NO_SPEECH_THRESHOLD;
      // A merely-elevated noSpeechProb only counts alongside a genuinely
      // poor avgLogProb — on its own it's too often a window-level
      // artifact shared with real speech elsewhere in the same ~30s chunk
      // (see VERY_HIGH_NO_SPEECH_THRESHOLD).
      const elevatedAndUnconfident =
        raw.noSpeechProb >= noSpeechThreshold &&
        raw.avgLogProb !== undefined &&
        raw.avgLogProb <= ELEVATED_NO_SPEECH_LOGPROB_THRESHOLD;
      if (veryLikelySilence || elevatedAndUnconfident) {
        lowConfidence = true;
        continue; // Likely silence/music misheard as speech — do not fabricate text for it.
      }
    }

    if (isHallucinatedCaption(text)) {
      lowConfidence = true;
      continue; // A known hallucinated boilerplate line, not real speech — see HALLUCINATED_CAPTION_PATTERNS.
    }

    if (raw.avgLogProb !== undefined && raw.avgLogProb <= lowConfidenceLogProb) {
      lowConfidence = true;
    }

    const confidence =
      raw.avgLogProb !== undefined ? logProbToConfidence(raw.avgLogProb) : undefined;
    cleaned.push(
      confidence !== undefined ? { start, end, text, confidence } : { start, end, text },
    );
  }

  const unrolled = mergeSlidingRepeats(cleaned);
  if (unrolled.merged) lowConfidence = true;

  const deduped = collapseRepeatedSegments(unrolled.segments);
  if (deduped.collapsed) lowConfidence = true;

  const text = deduped.segments
    .map((s) => s.text)
    .join(' ')
    .trim();

  return {
    text,
    segments: deduped.segments,
    language: options.language,
    durationSeconds: options.durationSeconds,
    lowConfidence,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function logProbToConfidence(avgLogProb: number): number {
  // avg_logprob is typically in roughly [-3, 0]; map monotonically to [0, 1].
  return clamp(1 + avgLogProb / 3, 0, 1);
}

/** Below this many overlapping words, a shared word or two between adjacent segments is just coincidence, not a decoder loop — e.g. "it" or "the" recurring naturally. */
const MIN_SLIDING_OVERLAP_WORDS = 2;

function normalizeWordForCompare(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Finds the longest run where the END of `prevWords` exactly matches the
 * START of `nextWords` (case/punctuation-insensitive) — a "sliding window"
 * continuation, as opposed to `collapseRepeatedSegments`'s exact
 * whole-segment match. Returns 0 when no such overlap reaches
 * `MIN_SLIDING_OVERLAP_WORDS`.
 */
function findSlidingOverlap(prevWords: string[], nextWords: string[]): number {
  const maxPossible = Math.min(prevWords.length, nextWords.length);
  for (let overlap = maxPossible; overlap >= MIN_SLIDING_OVERLAP_WORDS; overlap--) {
    let matches = true;
    for (let i = 0; i < overlap; i++) {
      const prevWord = normalizeWordForCompare(prevWords[prevWords.length - overlap + i]!);
      const nextWord = normalizeWordForCompare(nextWords[i]!);
      if (prevWord !== nextWord || prevWord.length === 0) {
        matches = false;
        break;
      }
    }
    if (matches) return overlap;
  }
  return 0;
}

/**
 * A distinct Whisper decoder-loop artifact from the one
 * `collapseRepeatedSegments` handles: instead of repeating one segment
 * verbatim, it re-decodes near the same point in the audio (typically
 * right at the end of a short/silent clip) and produces several segments
 * that each repeat the TAIL of the previous one before adding a little
 * new content — e.g. "...thank you for watching" / "you for watching
 * this is..." / "...this is TimmyDeclan signing out". Left alone, this
 * renders as visibly overlapping, stuttering transcript lines. Detected
 * by real word-sequence overlap between adjacent segments (never just
 * "the same word appears twice") and merged into one segment that keeps
 * each source's wording exactly once, in order — never rewritten, only
 * de-duplicated.
 */
function mergeSlidingRepeats(segments: TranscriptSegment[]): {
  segments: TranscriptSegment[];
  merged: boolean;
} {
  if (segments.length === 0) return { segments, merged: false };

  const result: TranscriptSegment[] = [{ ...segments[0]! }];
  let mergedAny = false;

  for (let i = 1; i < segments.length; i++) {
    const prev = result[result.length - 1]!;
    const current = segments[i]!;

    const prevWords = prev.text.split(/\s+/).filter(Boolean);
    const currentWords = current.text.split(/\s+/).filter(Boolean);
    const overlap = findSlidingOverlap(prevWords, currentWords);

    // A real decoder loop always overlaps in TIME too (two genuine,
    // sequential utterances can never have segment N+1 start before
    // segment N ends) — requiring that alongside the word-overlap keeps
    // this from ever firing on a phrase someone legitimately repeats
    // later, well-separated in time, elsewhere in the video.
    const timeOverlaps = current.start < prev.end;

    if (overlap > 0 && timeOverlaps) {
      const newWords = currentWords.slice(overlap);
      result[result.length - 1] = {
        ...prev,
        text: newWords.length > 0 ? `${prev.text} ${newWords.join(' ')}` : prev.text,
        end: Math.max(prev.end, current.end),
      };
      mergedAny = true;
    } else {
      result.push({ ...current });
    }
  }

  return { segments: result, merged: mergedAny };
}

function collapseRepeatedSegments(segments: TranscriptSegment[]): {
  segments: TranscriptSegment[];
  collapsed: boolean;
} {
  const result: TranscriptSegment[] = [];
  let collapsedAny = false;
  let runStart = 0;

  while (runStart < segments.length) {
    let runEnd = runStart + 1;
    while (runEnd < segments.length && segments[runEnd]?.text === segments[runStart]?.text) {
      runEnd++;
    }
    const runLength = runEnd - runStart;
    const first = segments[runStart];
    if (!first) break;

    if (runLength > 2) {
      // Keep only the first occurrence of a >2x exact repeat; it's almost
      // certainly a decoder loop, not three-plus identical spoken lines.
      result.push(first);
      collapsedAny = true;
    } else {
      for (let i = runStart; i < runEnd; i++) {
        const segment = segments[i];
        if (segment) result.push(segment);
      }
    }
    runStart = runEnd;
  }

  return { segments: result, collapsed: collapsedAny };
}
