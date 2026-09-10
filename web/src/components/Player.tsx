import { ExternalLink } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type PlayerHandle = {
  seek: (seconds: number) => void;
};

type Props = {
  url: string;
  onTime?: (seconds: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
};

function parseYouTubeId(url: string) {
  const m = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/** Instagram's dedicated embeddable page — the normal reel page refuses to be framed at all. */
function instagramEmbedUrl(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[a-zA-Z0-9_.]{1,64}\/)?reels?\/([a-zA-Z0-9_-]{5,64})/);
  return m ? `https://www.instagram.com/reel/${m[1]}/embed` : null;
}

/** TikTok's embed widget — same story: the normal watch page can't be framed. */
function tiktokEmbedUrl(url: string): string | null {
  const m = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null;
}

const Player = forwardRef<PlayerHandle, Props>(({ url, onTime, onPlay, onPause }, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const htmlVideoRef = useRef<HTMLVideoElement | null>(null);
  const pollRef = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      // YouTube
      if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        ytPlayerRef.current.seekTo(seconds, true);
        return;
      }

      // HTML5 video
      if (htmlVideoRef.current) {
        htmlVideoRef.current.currentTime = seconds;
        return;
      }

      // fallback: no-op (Instagram/TikTok embeds don't expose a postMessage seek API)
      console.info('seek not supported for this player');
    },
  }));

  const ytId = parseYouTubeId(url);

  useEffect(() => {
    if (ytId && containerRef.current) {
      // load YouTube API if needed
      const setup = async () => {
        if (!(window as any).YT) {
          await new Promise<void>((resolve) => {
            const s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            (window as any).onYouTubeIframeAPIReady = () => resolve();
            document.body.appendChild(s);
          });
        }

        const YT = (window as any).YT;
        ytPlayerRef.current = new YT.Player(containerRef.current!, {
          height: '100%',
          width: '100%',
          videoId: ytId,
          playerVars: { rel: 0, modestbranding: 1, controls: 1 },
          events: {
            onReady() {
              // start polling time
              if (pollRef.current == null) {
                pollRef.current = window.setInterval(() => {
                  try {
                    const t = ytPlayerRef.current.getCurrentTime();
                    onTime?.(t);
                  } catch (e) {
                    // ignore
                  }
                }, 250);
              }
            },
            onStateChange(e: any) {
              const YT = (window as any).YT;
              if (e.data === YT.PlayerState.PLAYING) onPlay?.();
              if (e.data === YT.PlayerState.PAUSED) onPause?.();
            },
          },
        });
      };

      setup();
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        try {
          ytPlayerRef.current?.destroy?.();
        } catch (e) {}
        ytPlayerRef.current = null;
      };
    }

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [url, ytId, onTime, onPlay, onPause]);

  const isVideo = /\.mp4$|\.webm$|\.mov$/.test(url);
  const embedUrl = ytId ? null : (instagramEmbedUrl(url) ?? tiktokEmbedUrl(url));

  return (
    <div className="h-full w-full" style={{ minHeight: 360 }}>
      {ytId ? (
        <div ref={containerRef} className="h-full w-full" />
      ) : isVideo ? (
        <video
          ref={htmlVideoRef}
          src={url}
          controls
          className="h-full w-full"
          onTimeUpdate={(e) => onTime?.((e.target as HTMLVideoElement).currentTime)}
          onPlay={() => onPlay?.()}
          onPause={() => onPause?.()}
        />
      ) : embedUrl ? (
        <iframe
          title="source-embed"
          src={embedUrl}
          className="h-full w-full"
          allow="autoplay; encrypted-media; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      ) : (
        // No known embeddable format for this URL — most video sites refuse
        // to be framed at all, so a blank iframe would just show black.
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink/[0.03] text-[13px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={2} />
          Watch on original site
        </a>
      )}
    </div>
  );
});

export type { PlayerHandle };
export default Player;
