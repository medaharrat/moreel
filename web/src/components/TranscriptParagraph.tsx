import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { FrameLightbox } from './FrameLightbox';
import { formatTimestamp } from '../lib/mockService';
import type { TranscriptSegment, VisualObservation } from '../types';

interface TranscriptParagraphProps {
  segments: TranscriptSegment[];
  onSeek?: (seconds: number) => void;
  /** The currently-playing segment's start time — matched exactly against each segment's own `startSeconds`. */
  activeStartSeconds?: number | null;
  /** "Timed" view: keep the timestamp visible instead of only revealing it on hover/focus/tap. */
  showTimestamp?: boolean;
  /** Meaningful visual information that fell within this paragraph's time range, if any — see TranscriptView's association logic. */
  observations?: VisualObservation[];
  /** Resolved Video Map interactions/references ("this one" → pink phone case) within this paragraph's time range — see TranscriptView's association logic. No frame thumbnail (unlike `observations`): the Video Map doesn't capture evidence frames in this version, so seeking the player is the way to verify one. */
  mapAnnotations?: { timestamp: number; label: string }[];
}

/**
 * Renders one paragraph as flowing prose, with its start timestamp as
 * quiet editorial metadata in the left margin — visible by default only in
 * "Timed" mode. Otherwise it peeks in on hover, on keyboard focus of the
 * timestamp button itself, or on tap (touch has no persistent hover state,
 * so a tap toggles the same reveal). The timestamp is always a real,
 * independently focusable button — never the whole paragraph.
 */
export function TranscriptParagraph({
  segments,
  onSeek,
  activeStartSeconds = null,
  showTimestamp = false,
  observations,
  mapAnnotations,
}: TranscriptParagraphProps) {
  const startSeconds = segments[0].startSeconds;
  const [revealed, setRevealed] = useState(false);
  const [lightboxObservation, setLightboxObservation] = useState<VisualObservation | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const visible = showTimestamp || revealed;

  return (
    <div
      className="group relative mb-6"
      onPointerEnter={() => setRevealed(true)}
      onPointerLeave={() => setRevealed(false)}
      onClick={(e) => {
        // Touch has no hover state — tapping anywhere in the paragraph
        // (other than the timestamp button, which already acts on tap)
        // toggles the peek instead.
        if (!(e.target as HTMLElement).closest('button')) {
          setRevealed((r) => !r);
        }
      }}
    >
      <div className="absolute left-0 top-0 flex h-full select-none items-start">
        <motion.button
          type="button"
          onClick={() => onSeek?.(startSeconds)}
          onFocus={() => setRevealed(true)}
          onBlur={() => setRevealed(false)}
          initial={false}
          animate={{ opacity: visible ? 1 : 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
          className="mt-[3px] select-none rounded font-mono text-[12px] tabular-nums text-ink-faint hover:text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-soft/40"
          aria-label={`Jump to ${formatTimestamp(startSeconds)}`}
        >
          {formatTimestamp(startSeconds)}
        </motion.button>
      </div>

      {/*
        The gutter is a margin on the paragraph itself, not padding on a
        wrapping block — padding is part of a block's own box, which
        browsers paint in full (as a "selection gap") whenever the block is
        fully selected, so a padded wrapper here would highlight the empty
        gutter along with the text. Margin sits outside that box and isn't
        painted the same way.
      */}
      <p className="ml-16 text-[17px] leading-[1.9] text-ink-soft">
        {segments.map((segment, i) => {
          const isActive = activeStartSeconds != null && segment.startSeconds === activeStartSeconds;
          return (
            <span
              key={segment.id}
              className={`rounded-sm transition-colors duration-300 ${
                isActive ? 'bg-[rgba(109,91,255,0.14)] text-ink' : ''
              }`}
            >
              {i > 0 ? ' ' : ''}
              {segment.text}
            </span>
          );
        })}
      </p>

      {/*
        Editorial footnote, not a UI card — same visual language as
        SourceHeader's caption block (border-l-2, small italic faint text).
        Only present when this paragraph actually has visual observations,
        so paragraphs without any look exactly as before.
      */}
      {observations && observations.length > 0 && (
        <div className="ml-16 mt-3 flex flex-col gap-2">
          {observations.map((observation, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek?.(observation.startSeconds);
                setLightboxObservation(observation);
              }}
              className="flex w-fit max-w-full items-center gap-2.5 rounded-r-md border-l-2 border-line py-1 pl-3 text-left transition-colors hover:border-ink-soft/40 hover:bg-ink/[0.02]"
            >
              {observation.frameUrl && (
                <img
                  src={observation.frameUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-sm object-cover"
                  loading="lazy"
                />
              )}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[12px] leading-relaxed text-ink-faint italic">
                  {observation.text}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-ink-faint/70">
                  {formatTimestamp(observation.startSeconds)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {mapAnnotations && mapAnnotations.length > 0 && (
        <div className="ml-16 mt-3 flex flex-col gap-2">
          {mapAnnotations.map((annotation, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek?.(annotation.timestamp);
              }}
              className="flex w-fit max-w-full items-center gap-2.5 rounded-r-md border-l-2 border-line py-1 pl-3 text-left transition-colors hover:border-ink-soft/40 hover:bg-ink/[0.02]"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[12px] leading-relaxed text-ink-faint italic">{annotation.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-ink-faint/70">
                  {formatTimestamp(annotation.timestamp)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <FrameLightbox observation={lightboxObservation} onClose={() => setLightboxObservation(null)} />
    </div>
  );
}

export default TranscriptParagraph;
