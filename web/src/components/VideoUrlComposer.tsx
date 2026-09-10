import { ArrowUp, ChevronDown, Clipboard } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { Button, TextField, Input, Label } from 'react-aria-components';
import { GlassOrbLoader } from './GlassOrbLoader';
import { Tooltip } from './Tooltip';
import { detectVideoUrl } from '../lib/detectVideoUrl';
import type { VideoUrl } from '../types';
import { describeVideo, displayUrl } from '../lib/detectVideoUrl';

export interface SubmitOptions {
  /** Also analyze visual content (on-screen text, slides, meaningful scene context) alongside speech. Only has an effect when the server supports it. */
  includeVisual: boolean;
  /** Also resolve "this"/"that"/pointing references to a specific visual entity. Only has an effect when the server supports it AND includeVisual is true — the map is an enrichment on top of sampled frames, not a standalone stage. */
  includeVideoMap: boolean;
}

interface VideoUrlComposerProps {
  disabled?: boolean;
  processingMessage?: string;
  onSubmit: (video: VideoUrl, options: SubmitOptions) => void;
}

const INCLUDE_VISUAL_STORAGE_KEY = 'moreel:includeVisual';
const INCLUDE_VIDEO_MAP_STORAGE_KEY = 'moreel:includeVideoMap';

function loadIncludeVisual(): boolean {
  try {
    // Defaults ON, not off: visual understanding is the actual product —
    // a transcript alone can be nearly empty for a low-dialogue/silent
    // video, which reads as "the tool just failed" when the one thing
    // that would've described it never ran. Explicit "false" (the user
    // turned it off) is the only thing that stays off.
    const stored = localStorage.getItem(INCLUDE_VISUAL_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function loadIncludeVideoMap(): boolean {
  try {
    return localStorage.getItem(INCLUDE_VIDEO_MAP_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * The single interaction surface of the homepage — a precise URL command
 * bar, not a hero-sized prompt box. Once a transcript exists, this unmounts
 * in favor of `SourceHeader` — a compact read-only label — rather than
 * shrinking into a second composer-shaped surface.
 */
export function VideoUrlComposer({ disabled = false, processingMessage, onSubmit }: VideoUrlComposerProps) {
  const [value, setValue] = useState('');
  const [detected, setDetected] = useState<VideoUrl | null>(null);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [includeVisual, setIncludeVisual] = useState(loadIncludeVisual);
  const [includeVideoMap, setIncludeVideoMap] = useState(loadIncludeVideoMap);
  const inputRef = useRef<HTMLInputElement>(null);

  function toggleIncludeVisual(next: boolean) {
    setIncludeVisual(next);
    try {
      localStorage.setItem(INCLUDE_VISUAL_STORAGE_KEY, String(next));
    } catch {
      // Best-effort only — a failed write just means the choice won't persist.
    }
  }

  function toggleIncludeVideoMap(next: boolean) {
    setIncludeVideoMap(next);
    try {
      localStorage.setItem(INCLUDE_VIDEO_MAP_STORAGE_KEY, String(next));
    } catch {
      // Best-effort only — a failed write just means the choice won't persist.
    }
  }

  const isProcessing = processingMessage !== undefined;

  function handleChange(next: string) {
    setValue(next);
    setInvalid(false);
    setDetected(detectVideoUrl(next));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    const found = detectVideoUrl(pasted);
    if (found) setDetected(found);
  }

  function submit() {
    const video = detected ?? detectVideoUrl(value);
    if (!video) {
      setInvalid(true);
      return;
    }
    onSubmit(video, { includeVisual, includeVideoMap: includeVisual && includeVideoMap });
  }

  function handleBlur() {
    setFocused(false);
    // Proactively flag unsupported text once the user's done typing,
    // rather than only rejecting it on an actual submit attempt.
    if (value.trim().length > 0 && !detectVideoUrl(value)) {
      setInvalid(true);
    }
  }

  const canSubmit = !!(detected ?? (value.trim().length > 0 && detectVideoUrl(value)));

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      handleChange(text);
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  }

  return (
    <div className="mx-auto w-full max-w-[700px]">
      <TextField
        aria-label="Video URL"
        value={value}
        onChange={handleChange}
        isInvalid={invalid}
        className="w-full"
      >
        <Label className="sr-only">Paste a Reel, TikTok, or video URL</Label>
        <motion.div
          layout
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={`w-full rounded-[22px] border bg-white/70 px-6 backdrop-blur-md transition-colors ${
            invalid
              ? 'border-red-300'
              : focused
                ? 'border-ink-soft/25 shadow-[0_8px_26px_rgba(120,90,170,0.12)]'
                : 'border-black/[0.06] shadow-[0_4px_16px_rgba(120,90,170,0.08)] hover:border-black/10'
          }`}
        >
          <div className="flex h-[76px] items-center gap-3">
            {isProcessing ? (
              <div className="flex min-w-0 flex-1 items-center gap-3" role="status" aria-live="polite">
                <GlassOrbLoader size={26} />
                <AnimatePresence mode="wait">
                  <motion.span
                    key={processingMessage}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="text-[17px] text-ink-soft"
                  >
                    {processingMessage}
                  </motion.span>
                </AnimatePresence>
              </div>
            ) : (
              <>
                {value.length === 0 && (
                  <Tooltip label="Paste from clipboard" side="bottom" className="shrink-0">
                    <motion.button
                      type="button"
                      onClick={pasteFromClipboard}
                      aria-label="Paste from clipboard"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink-soft"
                    >
                      <Clipboard className="h-4 w-4" strokeWidth={2} />
                    </motion.button>
                  </Tooltip>
                )}
                <Input
                  ref={inputRef}
                  placeholder="Paste a Reel, TikTok, or video URL..."
                  disabled={disabled}
                  onFocus={() => setFocused(true)}
                  onBlur={handleBlur}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-faint/70"
                />
              </>
            )}
            <Button
              aria-label="Transcribe video"
              isDisabled={disabled || isProcessing || !canSubmit}
              onPress={submit}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                !canSubmit || isProcessing ? 'bg-ink/8 text-ink-faint' : 'bg-ink text-paper hover:bg-ink/85'
              }`}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            </Button>
          </div>

          <AnimatePresence>
            {detected && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 14 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden border-t border-ink/8 pt-3 text-[13px]"
              >
                <span className="text-ink-soft">
                  <span className="font-medium text-ink">{describeVideo(detected)}</span>
                  <span className="mx-1.5 text-ink-faint">·</span>
                  <span className="font-mono text-ink-faint">{displayUrl(detected.url)}</span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </TextField>

      {invalid && (
        <p className="px-1 pt-2.5 text-[13px] text-red-500">
          That doesn't look like a supported video link yet.
        </p>
      )}

      {!isProcessing && (
        <div className="px-1 pt-2.5">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-ink-faint transition-colors hover:text-ink-soft"
          >
            Advanced options
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-150 ${showAdvanced ? 'rotate-180' : ''}`}
              strokeWidth={2}
            />
          </button>

          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2.5 pt-2.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={includeVisual}
                    aria-label="Analyze on-screen visuals"
                    onClick={() => toggleIncludeVisual(!includeVisual)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                      includeVisual ? 'bg-gradient-to-r from-brand-from to-brand-to' : 'bg-ink/15'
                    }`}
                  >
                    <motion.span
                      initial={false}
                      animate={{ x: includeVisual ? 16 : 2 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                      className="absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleIncludeVisual(!includeVisual)}
                    className="text-left text-[13px] text-ink-soft"
                  >
                    Analyze on-screen visuals
                  </button>
                </div>

                {/* Depends on visual analysis (it enriches the same sampled
                    frames) — only offered once that's on, rather than shown
                    disabled, so the dependency reads as "unlocked" instead
                    of "broken". */}
                <AnimatePresence initial={false}>
                  {includeVisual && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-2.5 pt-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={includeVideoMap}
                          aria-label="Identify what's shown or pointed at"
                          onClick={() => toggleIncludeVideoMap(!includeVideoMap)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                            includeVideoMap ? 'bg-gradient-to-r from-brand-from to-brand-to' : 'bg-ink/15'
                          }`}
                        >
                          <motion.span
                            initial={false}
                            animate={{ x: includeVideoMap ? 16 : 2 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                            className="absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleIncludeVideoMap(!includeVideoMap)}
                          className="text-left text-[13px] text-ink-soft"
                        >
                          Identify what's shown or pointed at
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
