import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './GlassOrbLoader.css';

interface GlassOrbLoaderProps {
  /** Phrases to cycle through below the orb. Omit (or pass an empty array) to render the orb alone. */
  labels?: string[];
  /** How long each phrase stays fully visible, in ms, before fading to the next. */
  intervalMs?: number;
  /** Orb diameter in px, overriding the default responsive clamp() — for inline/small placements. */
  size?: number;
}

const FADE_MS = 400;
// A small inline orb needs a much faster cycle than the big centered one —
// at 36px, a 10s cycle moves so few absolute pixels per second it reads as
// static. Speeding it up (not widening the motion) is what makes it read
// as alive at a glance.
const COMPACT_SPEED = 0.35;

/**
 * A translucent glass orb with soft colored liquid morphing inside it — the
 * orb's motion is pure CSS (five blobs, each on its own keyframe loop), so
 * it keeps running smoothly regardless of React render activity. The only
 * state here is the label cycler, and it updates at most twice per
 * interval (once to fade out, once to swap text and fade in).
 */
export function GlassOrbLoader({ labels = [], intervalMs = 2800, size }: GlassOrbLoaderProps) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (labels.length <= 1) return;

    function scheduleNext() {
      timeoutRef.current = setTimeout(() => {
        setVisible(false);
        timeoutRef.current = setTimeout(() => {
          setIndex((i) => (i + 1) % labels.length);
          setVisible(true);
          scheduleNext();
        }, FADE_MS);
      }, intervalMs);
    }

    scheduleNext();
    return () => clearTimeout(timeoutRef.current);
  }, [labels.length, intervalMs]);

  const orbStyle: CSSProperties | undefined = size
    ? ({ width: size, height: size, '--orb-speed': COMPACT_SPEED } as CSSProperties)
    : undefined;

  return (
    <div className="glass-orb-loader">
      <div
        className="glass-orb"
        role="status"
        aria-live="polite"
        aria-label={labels[index] ?? 'Loading'}
        style={orbStyle}
      >
        <div
          className="orb-fluid"
          aria-hidden="true"
          style={size ? { filter: `blur(${Math.max(2, size * 0.05)}px)` } : undefined}
        >
          <span className="blob blob-purple" />
          <span className="blob blob-magenta" />
          <span className="blob blob-coral" />
          <span className="blob blob-orange" />
          <span className="blob blob-violet" />
        </div>
        <div className="orb-glass-layer" aria-hidden="true" />
        <div className="orb-specular" aria-hidden="true" />
      </div>

      {labels.length > 0 && (
        <p className={`loader-text ${visible ? 'is-visible' : ''}`} aria-hidden="true">
          {labels[index]}
        </p>
      )}
    </div>
  );
}

export default GlassOrbLoader;
