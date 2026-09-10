import { formatTimestamp } from '../lib/mockService';
import type { TranscriptSegment as TranscriptSegmentType } from '../types';

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  onSeek?: (seconds: number) => void;
}

export function TranscriptSegment({ segment, onSeek }: TranscriptSegmentProps) {
  return (
    <p className="group flex gap-4 py-1 leading-relaxed">
      <button
        type="button"
        onClick={() => onSeek?.(segment.startSeconds)}
        className="mt-[3px] h-fit shrink-0 select-none rounded font-mono text-[12px] tabular-nums text-ink-faint transition-colors hover:text-ink-soft focus-visible:text-ink-soft"
        aria-label={`Jump to ${formatTimestamp(segment.startSeconds)}`}
      >
        {formatTimestamp(segment.startSeconds)}
      </button>
      <span className="text-[16px] leading-[1.75] text-ink-soft">{segment.text}</span>
    </p>
  );
}
