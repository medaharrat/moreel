import { Eye } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchMissedMoments } from '../lib/apiTranscriptionService';
import { formatTimestamp } from '../lib/mockService';
import type { MissedMoment } from '../types';
import { Tooltip } from './Tooltip';

interface WhatDidIMissProps {
  videoId: string;
  onSeek?: (seconds: number) => void;
}

const ICON_BUTTON =
  'flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink-soft';

/**
 * The product's signature claim, made concrete: every visual observation
 * that stands on its own — recoverable only by watching, absent from what
 * was said nearby — anchored to its own timestamp and evidence frame. This
 * is deliberately not a generated summary; every row is a real,
 * independently-produced `VisualObservation` (see app/what-did-i-miss.ts),
 * never prose synthesized for the occasion.
 */
export function WhatDidIMiss({ videoId, onSeek }: WhatDidIMissProps) {
  const [open, setOpen] = useState(false);
  const [moments, setMoments] = useState<MissedMoment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });

    if (moments === null) {
      setLoading(true);
      fetchMissedMoments(videoId)
        .then(setMoments)
        .catch(() => setMoments([]))
        .finally(() => setLoading(false));
    }
  }, [open, videoId, moments]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <Tooltip label="What did I miss?">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="What did I miss?"
          aria-pressed={open}
          className={`${ICON_BUTTON} ${open ? 'bg-ink/5 text-ink-soft' : ''}`}
        >
          <Eye className="h-4 w-4" strokeWidth={2} />
        </button>
      </Tooltip>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 flex w-[360px] flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/85 shadow-[0_16px_40px_rgba(120,90,170,0.2)] backdrop-blur-xl"
          >
            <div className="border-b border-line px-3.5 py-2.5">
              <p className="text-[13px] font-medium text-ink">What did I miss?</p>
              <p className="text-[11.5px] text-ink-faint">Shown on screen but not mentioned out loud.</p>
            </div>

            <div className="max-h-[380px] overflow-y-auto p-1.5">
              {loading && <p className="px-2.5 py-3 text-[12px] text-ink-faint">Looking…</p>}
              {!loading && moments?.length === 0 && (
                <p className="px-2.5 py-3 text-[12px] text-ink-faint">
                  Nothing visual stood apart from what was said — the transcript already covers it.
                </p>
              )}
              {!loading &&
                moments?.map((moment, index) => (
                  <button
                    key={`${moment.type}-${moment.timestamp}-${index}`}
                    type="button"
                    onClick={() => {
                      onSeek?.(moment.timestamp);
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-ink/5"
                  >
                    {moment.frameUrl && (
                      <img
                        src={moment.frameUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                          {formatTimestamp(moment.timestamp)}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-[13px] text-ink-soft">{moment.text}</p>
                    </div>
                  </button>
                ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default WhatDidIMiss;
