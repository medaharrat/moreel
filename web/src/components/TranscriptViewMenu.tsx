import { Clock } from 'lucide-react';
import { Tooltip } from './Tooltip';

export type TranscriptViewMode = 'clean' | 'timed';

interface TranscriptViewMenuProps {
  mode: TranscriptViewMode;
  onChange: (mode: TranscriptViewMode) => void;
}

/**
 * A document-preference toggle — "Clean" (default) reads as prose with
 * peekable timestamps; "Timed" keeps every paragraph's timestamp
 * persistently visible. The icon itself stays lit while active rather than
 * relabeling, matching the other icon-only actions in this row.
 */
export function TranscriptViewMenu({ mode, onChange }: TranscriptViewMenuProps) {
  const isTimed = mode === 'timed';

  return (
    <Tooltip label={isTimed ? 'Hide timestamps' : 'Show timestamps'}>
      <button
        type="button"
        onClick={() => onChange(isTimed ? 'clean' : 'timed')}
        aria-pressed={isTimed}
        aria-label="Toggle timestamps"
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-ink/5 ${
          isTimed ? 'text-brand-from' : 'text-ink-faint hover:text-ink-soft'
        }`}
      >
        <Clock className="h-4 w-4" strokeWidth={2} />
      </button>
    </Tooltip>
  );
}
