import { motion } from 'motion/react';
import type { ReactNode, UIEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { TranscriptView } from './TranscriptView';
import type { TranscriptViewMode } from './TranscriptViewMenu';
import type { Transcript } from '../types';

interface ScrollingTranscriptColumnProps {
  transcript: Transcript;
  viewMode: TranscriptViewMode;
  onSeek?: (seconds: number) => void;
  activeStartSeconds: number | null;
  /** Whether to render visual-observation footnotes at all — see VisualObservationsToggle. */
  showVisuals?: boolean;
  /**
   * Copy / Copy link / Download / timestamps toggle. At rest: a horizontal
   * row in a fixed-height header slot above the transcript, right-aligned
   * to the reading column, never overlapping any text. Once the transcript
   * scrolls past that header, it fades out and a vertical rail fades in —
   * positioned at a fixed offset past the reading column's right edge
   * (never computed from available space, so it can't drift left onto the
   * scroller), staying pinned near the top of the viewport as you scroll.
   */
  actions?: ReactNode;
  className?: string;
}

const FADE_PX = 32;
const COLUMN_WIDTH = 640;
const RAIL_GAP = 32;

/**
 * The only region on the result page that scrolls. Both action states live
 * OUTSIDE the scroller — a fixed-height header above it (row state) and an
 * absolutely-positioned rail beside it (column state) — never as children
 * of the scroller itself. That's a real CSS constraint, not just a style
 * choice: an `overflow-y: auto` element also forces `overflow-x` to clip
 * (the two axes can't be set independently once either leaves `visible`),
 * so anything meant to visually extend outside the scroller's own box
 * cannot be a descendant of it. Keeping the header's height constant
 * (opacity-only fade, never collapsing) means the scroller's own height
 * never changes when the row/rail state toggles, so there's no jump.
 *
 * The scroller masks its own top/bottom edges with a fade — via
 * `mask-image`, not an overlay — so text clipped by the container edge
 * dissolves rather than getting a hard cut. Each edge only fades when
 * there's actually more content in that direction (tracked via scroll
 * position + a `ResizeObserver` on the content, since paragraph count
 * changes with Clean/Timed).
 */
export function ScrollingTranscriptColumn({
  transcript,
  viewMode,
  onSeek,
  activeStartSeconds,
  showVisuals = true,
  actions,
  className = '',
}: ScrollingTranscriptColumnProps) {
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [actionsStuck, setActionsStuck] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actionsSentinelRef = useRef<HTMLDivElement>(null);

  function updateFade() {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 4);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    void e;
    updateFade();
  }

  useEffect(() => {
    updateFade();
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(content);
    return () => observer.disconnect();
  }, [viewMode]);

  // A zero-size sentinel at the very top of the scrolling content — purely
  // for detecting scroll position, never rendered as anything visible.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const sentinel = actionsSentinelRef.current;
    if (!scroller || !sentinel || !actions) return;
    const observer = new IntersectionObserver(([entry]) => setActionsStuck(!entry.isIntersecting), {
      root: scroller,
      threshold: 0,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [actions]);

  const maskImage = `linear-gradient(to bottom, transparent, black ${canScrollUp ? FADE_PX : 0}px, black calc(100% - ${canScrollDown ? FADE_PX : 0}px), transparent)`;

  return (
    <div className={`relative flex h-full min-w-0 flex-1 flex-col ${className}`}>
      {actions && (
        <div
          className={`mb-2 flex h-7 shrink-0 items-center justify-end gap-1 transition-opacity duration-150 ${
            actionsStuck ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
          }`}
          style={{ maxWidth: COLUMN_WIDTH }}
        >
          {actions}
        </div>
      )}

      <div
        ref={scrollerRef}
        className="h-full min-h-0 overflow-y-auto"
        onScroll={handleScroll}
        style={{ maskImage, WebkitMaskImage: maskImage, maxWidth: COLUMN_WIDTH + 24 }}
      >
        <motion.div
          ref={contentRef}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
          className="pt-2 pb-16"
        >
          <div className="relative" style={{ maxWidth: COLUMN_WIDTH }}>
            {actions && <div ref={actionsSentinelRef} aria-hidden="true" className="absolute top-0 h-px w-px" />}
            <TranscriptView
              transcript={transcript}
              onSeek={onSeek}
              activeStartSeconds={activeStartSeconds}
              showTimestamps={viewMode === 'timed'}
              showVisuals={showVisuals}
            />
          </div>
        </motion.div>
      </div>

      {actions && (
        <div
          className={`absolute top-0 z-10 flex flex-col items-center gap-1 transition-opacity duration-150 ${
            actionsStuck ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ left: COLUMN_WIDTH + RAIL_GAP }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
