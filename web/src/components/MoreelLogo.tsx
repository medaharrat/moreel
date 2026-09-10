import { motion } from 'motion/react';

interface MoreelLogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** When provided, the logo becomes a button (e.g. "back to home" from the result page). */
  onClick?: () => void;
  /** Shared across the hero and result instances so Motion animates the FLIP between them as the page transitions. */
  layoutId?: string;
}

const SIZES = {
  sm: 'h-[22px]',
  md: 'h-[32px]',
  lg: 'h-[48px] sm:h-[56px]',
} as const;

/** Canonical Moreel wordmark asset — see /public/brand for the source SVGs. */
export function MoreelLogo({ size = 'md', onClick, layoutId }: MoreelLogoProps) {
  const img = (
    <motion.img
      layoutId={layoutId}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      src="/brand/moreel-logo.svg"
      alt="moreel"
      className={`w-auto select-none ${SIZES[size]}`}
    />
  );

  if (!onClick) return img;

  return (
    <button type="button" onClick={onClick} aria-label="moreel — back to home" className="cursor-pointer">
      {img}
    </button>
  );
}
