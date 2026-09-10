import type { RawSegment } from './normalization.js';

/** A single word's timing, as returned by a provider's word-level timestamp granularity. */
export interface RawWord {
  word: string;
  start: number;
  end: number;
}

export interface ResegmentOptions {
  /** A gap at or above this between two consecutive words is treated as a real pause worth splitting on. */
  maxPauseSeconds?: number;
  /** A run with no punctuation/pause is force-split once it reaches this duration — catches fast, run-on speech that never pauses. */
  maxSegmentSeconds?: number;
  /** Same idea as `maxSegmentSeconds`, whichever limit is hit first. */
  maxWordsPerSegment?: number;
}

const DEFAULT_MAX_PAUSE_SECONDS = 0.7;
const DEFAULT_MAX_SEGMENT_SECONDS = 10;
const DEFAULT_MAX_WORDS_PER_SEGMENT = 20;

const SENTENCE_END_PATTERN = /[.!?]["')\]]?$/;

/**
 * A transcription provider's own segment boundaries reflect its internal
 * decode chunking, not how the person actually spoke — they don't adapt to
 * speech rate. Two failure modes this fixes:
 *   - A short clip of one slow, deliberate phrase can come back as a single
 *     segment spanning several seconds; the timeline/search granularity is
 *     then "the whole phrase" instead of each natural sub-phrase.
 *   - A long clip of fast, run-on speech can come back as one segment
 *     covering several sentences, with the same problem in the other
 *     direction — one timestamp standing in for a lot of distinct content.
 *
 * Given word-level timestamps (when the provider returns them), this
 * re-chunks each segment into finer sub-segments at natural break points —
 * sentence-ending punctuation or a real pause between words — and, absent
 * either (a genuine fast run-on with no gaps), force-splits on a duration/
 * word-count cap so no single segment can grow unbounded. Falls back to the
 * original segments unchanged when no words are available at all, so this
 * is purely additive: nothing regresses for a provider/model that doesn't
 * support word timestamps.
 */
export function resegmentByWords(
  segments: RawSegment[],
  words: RawWord[],
  options: ResegmentOptions = {},
): RawSegment[] {
  if (words.length === 0) return segments;

  const maxPauseSeconds = options.maxPauseSeconds ?? DEFAULT_MAX_PAUSE_SECONDS;
  const maxSegmentSeconds = options.maxSegmentSeconds ?? DEFAULT_MAX_SEGMENT_SECONDS;
  const maxWordsPerSegment = options.maxWordsPerSegment ?? DEFAULT_MAX_WORDS_PER_SEGMENT;

  const result: RawSegment[] = [];

  for (const segment of segments) {
    // Words are timestamped independently of segment boundaries — a small
    // tolerance absorbs rounding differences between the two.
    const segmentWords = words.filter((w) => w.start >= segment.start - 0.05 && w.end <= segment.end + 0.05);
    if (segmentWords.length === 0) {
      result.push(segment);
      continue;
    }

    let chunkStart = 0;
    for (let i = 0; i < segmentWords.length; i++) {
      const word = segmentWords[i]!;
      const isLast = i === segmentWords.length - 1;
      const next = segmentWords[i + 1];

      const chunkFirst = segmentWords[chunkStart]!;
      const chunkDuration = word.end - chunkFirst.start;
      const chunkWordCount = i - chunkStart + 1;

      const endsSentence = SENTENCE_END_PATTERN.test(word.word.trim());
      const realPause = next ? next.start - word.end >= maxPauseSeconds : false;
      const hitCap = chunkDuration >= maxSegmentSeconds || chunkWordCount >= maxWordsPerSegment;

      if (isLast || endsSentence || realPause || hitCap) {
        const chunkWords = segmentWords.slice(chunkStart, i + 1);
        const text = chunkWords
          .map((w) => w.word)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 0) {
          result.push({
            start: chunkFirst.start,
            end: word.end,
            text,
            ...(segment.avgLogProb !== undefined ? { avgLogProb: segment.avgLogProb } : {}),
            ...(segment.noSpeechProb !== undefined ? { noSpeechProb: segment.noSpeechProb } : {}),
          });
        }
        chunkStart = i + 1;
      }
    }
  }

  return result;
}
