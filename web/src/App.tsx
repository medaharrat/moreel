import { motion } from 'motion/react';
import { useCallback, useState, useRef, useEffect } from 'react';
import { ApiPage } from './components/ApiPage';
import { McpPage } from './components/McpPage';
import { MoreelLogo } from './components/MoreelLogo';
import { MorePage } from './components/MorePage';
import { ScrollingTranscriptColumn } from './components/ScrollingTranscriptColumn';
import { SourceHeader } from './components/SourceHeader';
import { TopNav, type NavRoute } from './components/TopNav';
import { TranscriptActions } from './components/TranscriptActions';
import { TranscriptViewMenu, type TranscriptViewMode } from './components/TranscriptViewMenu';
import { type PlayerHandle } from './components/Player';
import { VideoEmbed } from './components/VideoEmbed';
import { VideoSearch } from './components/VideoSearch';
import { VideoUrlComposer, type SubmitOptions } from './components/VideoUrlComposer';
import { VisualObservationsToggle } from './components/VisualObservationsToggle';
import { WhatDidIMiss } from './components/WhatDidIMiss';
import { fetchTranscriptById, transcribeVideo, TranscriptionApiError } from './lib/apiTranscriptionService';
import type { Transcript, VideoUrl } from './types';

type Stage = 'idle' | 'processing' | 'result' | 'error';

function routeFromPathname(pathname: string): NavRoute | null {
  const route = pathname.slice(1);
  return route === 'api' || route === 'mcp' || route === 'more' ? route : null;
}

// Mirrors the backend pipeline's real stages (download → extract audio →
// transcribe) — see src/app/transcription-service.ts — not fabricated ones.
const PROCESSING_STEPS = [
  'Fetching your video',
  'Extracting audio',
  'Transcribing speech',
  'Finishing up',
];

function App() {
  const [stage, setStage] = useState<Stage>('idle');
  const [statusMessage, setStatusMessage] = useState('Understanding your video…');
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [resetToken, setResetToken] = useState(0);
  const [viewMode, setViewMode] = useState<TranscriptViewMode>('clean');
  const [showVisuals, setShowVisuals] = useState(true);
  const [activeRoute, setActiveRoute] = useState<NavRoute | null>(() => routeFromPathname(window.location.pathname));

  const handleSubmit = useCallback(async (video: VideoUrl, options: SubmitOptions) => {
    setStage('processing');
    setErrorMessage('');

    // The backend does the work in one request/response — it doesn't stream
    // progress — so this cycles through the pipeline's real stages on a
    // rough timer just to keep the wait legible rather than a single
    // message sitting still for several seconds.
    let step = 0;
    setStatusMessage(PROCESSING_STEPS[0]);
    const interval = setInterval(() => {
      step = Math.min(step + 1, PROCESSING_STEPS.length - 1);
      setStatusMessage(PROCESSING_STEPS[step]);
    }, 2500);

    try {
      const result = await transcribeVideo(video, options);
      setTranscript(result);
      // Give this transcript its own URL so it can be shared/revisited —
      // see fetchTranscriptById, which reads it back on load.
      window.history.replaceState({}, '', `/transcripts/${result.id}`);
      setViewMode('clean');
      setStage('result');
    } catch (error) {
      const message =
        error instanceof TranscriptionApiError
          ? error.message
          : 'Something went wrong while reading that video. Try another link.';
      setErrorMessage(message);
      setStage('error');
    } finally {
      clearInterval(interval);
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
      // delegate to player when available
      if (playerRef.current) {
        playerRef.current.seek(seconds);
        return;
      }
      console.info(`seek to ${seconds}s`);
  }, []);

    const playerRef = useRef<PlayerHandle | null>(null);
    const [activeStartSeconds, setActiveStartSeconds] = useState<number | null>(null);

    const handleTimeUpdate = useCallback(
      (seconds: number) => {
        if (!transcript) return;
        // find the latest segment start <= seconds
        let match = transcript.segments[0]?.startSeconds ?? 0;
        for (const s of transcript.segments) {
          if (s.startSeconds <= seconds) match = s.startSeconds;
          else break;
        }
        setActiveStartSeconds(match);
      },
      [transcript],
    );

  const startOver = useCallback(() => {
    setStage('idle');
    setTranscript(null);
    setViewMode('clean');
    setErrorMessage('');
    setResetToken((n) => n + 1);
    window.history.replaceState({}, '', '/');
  }, []);

  const navigateTo = useCallback((route: NavRoute) => {
    window.history.pushState({}, '', `/${route}`);
    setActiveRoute(route);
  }, []);

  const closePage = useCallback(() => {
    window.history.pushState({}, '', '/');
    setActiveRoute(null);
  }, []);

  const isResult = stage === 'result' && transcript !== null;

  // On mount, if the path is /transcripts/:id (a shared/revisited permalink),
  // load that transcript instead of showing the empty composer.
  useEffect(() => {
    const match = window.location.pathname.match(/^\/transcripts\/([^/]+)$/);
    const id = match?.[1];
    if (!id) return;

    let cancelled = false;
    setStage('processing');
    setStatusMessage('Loading transcript…');

    fetchTranscriptById(id)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setErrorMessage('This link has expired or no longer exists.');
          setStage('error');
          window.history.replaceState({}, '', '/');
          return;
        }
        setTranscript(result);
        setViewMode('clean');
        setStage('result');
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMessage('Could not load transcript from this link.');
        setStage('error');
        window.history.replaceState({}, '', '/');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (activeRoute === 'api') {
    return <ApiPage onBack={closePage} onNavigate={navigateTo} />;
  }
  if (activeRoute === 'mcp') {
    return <McpPage onBack={closePage} onNavigate={navigateTo} />;
  }
  if (activeRoute === 'more') {
    return <MorePage onBack={closePage} onNavigate={navigateTo} />;
  }

  if (isResult && transcript) {
    const hasVisualObservations = !!transcript.visualObservations?.length;
    const actions = (
      <>
        {transcript.videoId && <VideoSearch videoId={transcript.videoId} onSeek={seekTo} />}
        {transcript.videoId && hasVisualObservations && (
          <WhatDidIMiss videoId={transcript.videoId} onSeek={seekTo} />
        )}
        <TranscriptActions transcript={transcript} />
        <TranscriptViewMenu mode={viewMode} onChange={setViewMode} />
        {hasVisualObservations && <VisualObservationsToggle visible={showVisuals} onChange={setShowVisuals} />}
      </>
    );

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative flex h-dvh w-full flex-col overflow-hidden"
      >
        <div className="absolute top-5 left-6 z-10 hidden md:block">
          <button
            type="button"
            onClick={startOver}
            className="cursor-pointer text-[13px] text-ink-faint transition-colors hover:text-ink-soft"
          >
            Home
          </button>
        </div>

        <div className="absolute top-5 right-6 z-10 hidden md:block">
          <TopNav onNavigate={navigateTo} />
        </div>

        {/* The logo sits in its own top-center bar shared by both layouts;
            video/source live in a column that never moves. */}
        <div className="flex shrink-0 flex-col items-center gap-2 px-5 pt-6 pb-12 text-center">
          <MoreelLogo size="sm" onClick={startOver} />
        </div>

        {/* Desktop: fixed video column + source, transcript scrolls beside it.
            The video is what gives up space on a short viewport, never the
            source info below it — SourceHeader is `shrink-0` (always its
            full natural size) and the video sits in the flexible remainder,
            sized from that available height rather than a fixed width. No
            scrollbar: everything in this column stays visible at once. */}
        <div className="mx-auto hidden h-full min-h-0 w-full max-w-[1200px] gap-14 px-8 pb-8 md:flex">
          <div className="flex h-full w-[340px] min-h-0 shrink-0 flex-col pb-6">
            <div className="min-h-0 flex-1">
              <VideoEmbed
                ref={playerRef}
                video={transcript.video}
                mediaUrl={transcript.mediaUrl}
                onTime={handleTimeUpdate}
                fillHeight
              />
            </div>
            <div className="shrink-0 pt-4">
              <SourceHeader
                video={transcript.video}
                caption={transcript.caption}
                creatorName={transcript.creatorName}
                creatorUrl={transcript.creatorUrl}
                likeCount={transcript.likeCount}
                commentCount={transcript.commentCount}
                postedAt={transcript.postedAt}
              />
            </div>
          </div>

          <ScrollingTranscriptColumn
            transcript={transcript}
            viewMode={viewMode}
            onSeek={seekTo}
            activeStartSeconds={activeStartSeconds}
            showVisuals={showVisuals}
            actions={actions}
          />
        </div>

        {/* Mobile: video/source pinned at top, transcript scrolls below. */}
        <div className="flex h-full min-h-0 w-full flex-col px-5 md:hidden">
          <div className="shrink-0">
            <VideoEmbed ref={playerRef} video={transcript.video} mediaUrl={transcript.mediaUrl} onTime={handleTimeUpdate} />
            <div className="pt-3">
              <SourceHeader
                video={transcript.video}
                caption={transcript.caption}
                creatorName={transcript.creatorName}
                creatorUrl={transcript.creatorUrl}
                likeCount={transcript.likeCount}
                commentCount={transcript.commentCount}
                postedAt={transcript.postedAt}
              />
            </div>
          </div>

          <ScrollingTranscriptColumn
            transcript={transcript}
            viewMode={viewMode}
            onSeek={seekTo}
            activeStartSeconds={activeStartSeconds}
            showVisuals={showVisuals}
            actions={actions}
            className="mt-6"
          />
        </div>

        <div className="pointer-events-none absolute right-3 bottom-2 flex justify-end">
          <p className="pointer-events-auto flex items-center gap-1.5 text-[11px] text-ink-faint/70">
            <a href="/about" className="hover:text-ink-faint">
              About
            </a>
            ·
            <a href="/privacy" className="hover:text-ink-faint">
              Privacy
            </a>
            ·
            <a href="/terms" className="hover:text-ink-faint">
              Terms
            </a>
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <div className="absolute top-5 right-6 z-10 hidden md:block">
        <TopNav onNavigate={navigateTo} />
      </div>

      <div className="mx-auto flex h-full w-full flex-col items-center px-5 sm:px-8">
        <motion.div layout="position" className="shrink-0 pt-[14vh] sm:pt-[16vh]">
          <MoreelLogo size="lg" />
        </motion.div>

        <motion.p layout="position" className="shrink-0 pt-3 text-[16px] text-ink-soft">
          Turn video into something you can use.
        </motion.p>

        <motion.div layout className="w-full shrink-0 pt-14">
          <VideoUrlComposer
            key={resetToken}
            disabled={stage === 'processing'}
            processingMessage={stage === 'processing' ? statusMessage : undefined}
            onSubmit={handleSubmit}
          />

          {stage === 'error' && (
            <p role="alert" className="mx-auto max-w-[700px] px-1 pt-4 text-center text-[13px] text-red-500">
              {errorMessage}
            </p>
          )}
        </motion.div>
      </div>

      <div className="pointer-events-none absolute right-3 bottom-2 flex justify-end">
        <p className="pointer-events-auto flex items-center gap-1.5 text-[11px] text-ink-faint/70">
          <a href="/privacy" className="hover:text-ink-faint">
            Privacy
          </a>
          ·
          <a href="/terms" className="hover:text-ink-faint">
            Terms
          </a>
        </p>
      </div>
    </div>
  );
}

export default App;
