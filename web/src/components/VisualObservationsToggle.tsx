import { Image } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface VisualObservationsToggleProps {
  visible: boolean;
  onChange: (visible: boolean) => void;
}

/**
 * Shows/hides the visual-observation footnotes within the transcript —
 * independent of whether visual analysis ran at all (that's decided once,
 * at transcription time, via the composer's toggle). This one is purely a
 * reading preference, same idea as Clean/Timed. Only rendered by the
 * caller when the transcript actually has observations to show or hide.
 */
export function VisualObservationsToggle({ visible, onChange }: VisualObservationsToggleProps) {
  return (
    <Tooltip label={visible ? 'Hide visual notes' : 'Show visual notes'}>
      <button
        type="button"
        onClick={() => onChange(!visible)}
        aria-pressed={visible}
        aria-label="Toggle visual notes"
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-ink/5 ${
          visible ? 'text-brand-from' : 'text-ink-faint hover:text-ink-soft'
        }`}
      >
        <Image className="h-4 w-4" strokeWidth={2} />
      </button>
    </Tooltip>
  );
}
