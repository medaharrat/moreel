import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { searchVideo } from '../lib/apiTranscriptionService';
import { formatTimestamp } from '../lib/mockService';
import type { SearchResultItem, TimelineSource } from '../types';
import { Tooltip } from './Tooltip';

interface VideoSearchProps {
  videoId: string;
  onSeek?: (seconds: number) => void;
}

/** How each modality is labeled in results — deliberately terse, uppercase, mono, never a generic "web search"-style favicon/domain treatment. */
const SOURCE_LABEL: Record<TimelineSource, string> = {
  speech: 'SPEECH',
  on_screen_text: 'ON SCREEN',
  visual_context: 'VISUAL',
  scene: 'VISUAL',
  object: 'VISUAL',
  ui: 'ON SCREEN',
  chart: 'ON SCREEN',
  document: 'ON SCREEN',
  product: 'VISUAL',
  logo: 'VISUAL',
  interaction: 'ACTION',
  reference: 'REFERENCE',
};

const ICON_BUTTON =
  'flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink-soft';

/**
 * Search inside the video — the product's core wedge made directly
 * interactive: type a word or phrase and get back every place it appears,
 * across speech AND on-screen/visual content, each result labeled by
 * modality and one click from seeking the player. Not a generic site
 * search; the panel only ever shows results from this one video.
 */
export function VideoSearch({ videoId, onSeek }: VideoSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, [open]);

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

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const debounce = setTimeout(() => {
      searchVideo(videoId, trimmed)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [query, videoId]);

  return (
    <>
      <Tooltip label="Search this video">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Search this video"
          aria-pressed={open}
          className={`${ICON_BUTTON} ${open ? 'bg-ink/5 text-ink-soft' : ''}`}
        >
          <Search className="h-4 w-4" strokeWidth={2} />
        </button>
      </Tooltip>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 flex w-[340px] flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/85 shadow-[0_16px_40px_rgba(120,90,170,0.2)] backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search speech and on-screen content…"
                className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="shrink-0 text-ink-faint hover:text-ink-soft"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>

            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {loading && <p className="px-2.5 py-3 text-[12px] text-ink-faint">Searching…</p>}
              {!loading && query.trim().length > 0 && results.length === 0 && (
                <p className="px-2.5 py-3 text-[12px] text-ink-faint">No matches for &ldquo;{query.trim()}&rdquo;.</p>
              )}
              {!loading &&
                results.map((result, index) => (
                  <button
                    key={`${result.source}-${result.timestamp}-${index}`}
                    type="button"
                    onClick={() => {
                      onSeek?.(result.timestamp);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col gap-1 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-ink/5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-ink-soft">
                        {SOURCE_LABEL[result.source] ?? 'VISUAL'}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                        {formatTimestamp(result.timestamp)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[13px] text-ink-soft">{result.text}</p>
                  </button>
                ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default VideoSearch;
