import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatTimestamp } from '../lib/mockService';
import type { VisualObservation } from '../types';

interface FrameLightboxProps {
  observation: VisualObservation | null;
  onClose: () => void;
}

/**
 * No modal/dialog primitive exists elsewhere in this codebase, so this
 * follows Tooltip.tsx's own established pattern instead of adding a new
 * dependency: portal straight to `document.body`, motion fade + scale.
 * Shows the captured frame (when there is one) enlarged, alongside the
 * observation's text and timestamp.
 */
export function FrameLightbox({ observation, onClose }: FrameLightboxProps) {
  useEffect(() => {
    if (!observation) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [observation, onClose]);

  return createPortal(
    <AnimatePresence>
      {observation && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6 backdrop-blur-sm"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="max-w-[420px] overflow-hidden rounded-2xl bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            {observation.frameUrl && (
              <img src={observation.frameUrl} alt="" className="block w-full" />
            )}
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <p className="text-[13px] leading-relaxed text-ink-soft">{observation.text}</p>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-faint">
                {formatTimestamp(observation.startSeconds)}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default FrameLightbox;
