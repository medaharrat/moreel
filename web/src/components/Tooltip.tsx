import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: ReactNode;
  /** Which side the tooltip opens toward — pick whichever has room. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Extra classes for the wrapper span — e.g. `shrink-0` to match a sibling's layout in a flex row. */
  className?: string;
}

const GAP = 8;

/**
 * Light, modern replacement for native `title` tooltips (slow to appear,
 * unstyled, inconsistent across browsers). Portals to `document.body` and
 * positions itself from the trigger's real screen coordinates (`fixed`,
 * computed on hover) rather than via CSS `absolute` — a plain absolute
 * tooltip gets silently clipped whenever its trigger sits near the edge of
 * a scrolling ancestor (e.g. the action row near the top of the transcript
 * column), which a portal sidesteps entirely.
 */
export function Tooltip({ label, children, side = 'top', className = '' }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const positions: Record<NonNullable<TooltipProps['side']>, { top: number; left: number }> = {
      top: { top: rect.top - GAP, left: rect.left + rect.width / 2 },
      bottom: { top: rect.bottom + GAP, left: rect.left + rect.width / 2 },
      left: { top: rect.top + rect.height / 2, left: rect.left - GAP },
      right: { top: rect.top + rect.height / 2, left: rect.right + GAP },
    };
    setPos(positions[side]);
  }

  function hide() {
    setPos(null);
  }

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'bottom'
        ? 'translate(-50%, 0)'
        : side === 'left'
          ? 'translate(-100%, -50%)'
          : 'translate(0, -50%)';

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: pos.top, left: pos.left, transform }}
            className="pointer-events-none fixed z-50 rounded-lg border border-white/40 bg-white/60 px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-ink shadow-[0_6px_20px_rgba(120,90,170,0.14)] backdrop-blur-md"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
