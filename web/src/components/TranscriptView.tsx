import { motion } from 'motion/react';
import type { Transcript, TranscriptSegment } from '../types';
import { TranscriptParagraph } from './TranscriptParagraph';

interface TranscriptViewProps {
  transcript: Transcript;
  onSeek?: (seconds: number) => void;
  paragraphs?: TranscriptSegment[][];
  activeStartSeconds?: number | null;
  /** "Timed" view: timestamps stay persistently visible instead of only peeking on hover/focus/tap. */
  showTimestamps?: boolean;
  /** Whether to render visual-observation footnotes at all — independent of whether the transcript has any (see VisualObservationsToggle). */
  showVisuals?: boolean;
}

// A normal breath/pause between sentences is well under a second and must
// NOT split a paragraph on its own — only a pause this long, on a paragraph
// that already has some substance, reads as an actual break in thought.
const SOFT_GAP_BREAK_SECONDS = 2.2;
const SOFT_GAP_MIN_CHARS = 40;
// A pause this long breaks the paragraph regardless of length — long enough
// that no real paragraph legitimately continues through it.
const HARD_GAP_BREAK_SECONDS = 4;

const MIN_PARAGRAPH_CHARS = 60;
const MAX_PARAGRAPH_CHARS = 220;
// Neither the gap checks nor the char-count cap bound wall-clock time on
// their own: slow or sparse speech can easily stay under MAX_PARAGRAPH_CHARS
// for well past ten seconds without ever pausing long enough to count as a
// gap, so a single paragraph's *timestamp* stops meaning much even though
// its text still looks like a normal-length paragraph. This is a hard
// backstop against that — independent of character count or punctuation.
const MAX_PARAGRAPH_SECONDS = 10;

/**
 * Presentation-layer grouping only — the underlying `segments` (precise
 * per-sentence timestamps) are never mutated or discarded, just organized
 * into paragraphs a person would actually want to read. Breaks on sentence
 * boundaries once a paragraph has enough substance, on a hard length cap
 * regardless of punctuation, on a hard duration cap regardless of length,
 * and on a real pause in the speech — but a short natural breath between
 * sentences is not a paragraph break, so gap-based breaks require either
 * real silence or an already-substantial paragraph, never both a short
 * pause AND a short paragraph.
 */
function groupIntoParagraphs(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const paragraphs: TranscriptSegment[][] = [];
  let buffer: TranscriptSegment[] = [];

  for (const segment of segments) {
    const prev = buffer[buffer.length - 1];
    const gapFromPrev = prev ? segment.startSeconds - prev.endSeconds : 0;
    const bufferChars = buffer.reduce((sum, s) => sum + s.text.length, 0);

    const isHardGap = gapFromPrev > HARD_GAP_BREAK_SECONDS;
    const isSoftGap = gapFromPrev > SOFT_GAP_BREAK_SECONDS && bufferChars >= SOFT_GAP_MIN_CHARS;

    // Checked BEFORE appending, not after: a single already-long segment
    // (a long uninterrupted phrase) can by itself push the total well past
    // either cap in one step, so a reactive-only check (evaluated after
    // appending) lets that one segment drag the whole paragraph far over —
    // exactly the "13s in one paragraph" case this exists to prevent. The
    // long segment still becomes its own paragraph; it just doesn't also
    // absorb whatever came before it.
    const projectedChars = bufferChars + segment.text.length;
    const projectedDuration = buffer.length > 0 ? segment.endSeconds - buffer[0].startSeconds : 0;
    const exceedsCap =
      buffer.length > 0 && (projectedChars > MAX_PARAGRAPH_CHARS || projectedDuration > MAX_PARAGRAPH_SECONDS);

    if (buffer.length > 0 && (isHardGap || isSoftGap || exceedsCap)) {
      paragraphs.push(buffer);
      buffer = [];
    }

    buffer.push(segment);

    const endsSentence = /[.!?]$/.test(segment.text.trim());
    const charCount = buffer.reduce((sum, s) => sum + s.text.length, 0);

    if (endsSentence && charCount > MIN_PARAGRAPH_CHARS) {
      paragraphs.push(buffer);
      buffer = [];
    }
  }

  if (buffer.length) paragraphs.push(buffer);

  return paragraphs;
}

export function TranscriptView({
  transcript,
  onSeek,
  paragraphs: forcedParagraphs,
  activeStartSeconds,
  showTimestamps = false,
  showVisuals = true,
}: TranscriptViewProps) {
  const paragraphs = forcedParagraphs ?? groupIntoParagraphs(transcript.segments);
  const observations = showVisuals ? transcript.visualObservations : undefined;

  // Interactions and references share one footnote list with visual
  // observations (same subtle "editorial note", not a second UI element) —
  // see TranscriptParagraph's mapAnnotations prop. Flattened once here
  // rather than per-paragraph since it's the same handful of items either
  // way.
  const mapAnnotations = showVisuals
    ? [
        ...(transcript.map?.interactions.map((interaction) => ({
          timestamp: interaction.timestamp,
          label: `${interaction.type.replace(/_/g, ' ')} → ${interaction.targetLabel}`,
        })) ?? []),
        ...(transcript.map?.references.map((reference) => ({
          timestamp: reference.timestamp,
          label: `"${reference.phrase}" → ${reference.targetLabel}`,
        })) ?? []),
      ].sort((a, b) => a.timestamp - b.timestamp)
    : undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: 0.08 }}
      aria-label="Transcript"
    >
      {paragraphs.map((p, idx) => {
        // Pure render-time association by timestamp range — paragraphs have
        // no stable identity of their own (they're recomputed on every
        // render), so this can't be precomputed or cached against a
        // paragraph id. Cheap enough (a handful of observations, a handful
        // of paragraphs) that recomputing it here every render is fine.
        const start = p[0].startSeconds;
        const end = p[p.length - 1].endSeconds;
        const paragraphObservations = observations?.filter(
          (obs) => obs.startSeconds >= start && obs.startSeconds <= end,
        );
        const paragraphMapAnnotations = mapAnnotations?.filter(
          (annotation) => annotation.timestamp >= start && annotation.timestamp <= end,
        );

        return (
          <TranscriptParagraph
            key={`${p[0].id}-${idx}`}
            segments={p}
            onSeek={onSeek}
            activeStartSeconds={activeStartSeconds ?? null}
            showTimestamp={showTimestamps}
            observations={paragraphObservations}
            mapAnnotations={paragraphMapAnnotations}
          />
        );
      })}
    </motion.section>
  );
}
