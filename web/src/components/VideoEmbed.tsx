import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import Player, { type PlayerHandle } from './Player';
import { Tooltip } from './Tooltip';
import { formatTimestamp } from '../lib/mockService';
import type { VideoUrl } from '../types';

interface VideoEmbedProps {
  video: VideoUrl;
  /** When present, plays directly from Moreel's own `/media/:id` stream instead of a third-party embed — real seeking, no embed restrictions. */
  mediaUrl?: string;
  onTime?: (seconds: number) => void;
  /**
   * Sizes the player from the available HEIGHT (aspect ratio then drives
   * width) instead of the default width-driven sizing. Used on the desktop
   * result layout so the player shrinks to whatever room is left after the
   * source info below it, rather than the source info being pushed out of
   * view on a short viewport — the video is the thing allowed to give up
   * space, never the creator/caption text.
   */
  fillHeight?: boolean;
}

/**
 * Prefers Moreel's own streamed copy of the video (see `MediaStore` /
 * `GET /media/:id` on the backend) when available — proper seeking, no
 * dependence on a platform's embed widget allowing this specific post.
 * Falls back to `Player`'s third-party embed when the backend didn't
 * capture media for this request. Either way, `SourceHeader` renders an
 * always-present "watch on {platform}" link below the description as the
 * reliable escape hatch, since embeds (and even our own short-lived
 * stream) aren't guaranteed forever.
 *
 * The native `<video controls>` bar can't be restyled consistently across
 * browsers, so when playing our own stream this renders a small custom
 * control bar instead — matches the rest of the app's restrained, hand-built
 * UI rather than each browser's own (tall, inconsistent) chrome. The bar
 * stays visible while paused (so the play button is reachable) and while
 * hovered/focused, but otherwise fades out during playback so it doesn't
 * sit on top of the video.
 */
export const VideoEmbed = forwardRef<PlayerHandle, VideoEmbedProps>(({ video, mediaUrl, onTime, fillHeight = false }, ref) => {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      if (mediaUrl && videoElRef.current) {
        videoElRef.current.currentTime = seconds;
        return;
      }
      playerRef.current?.seek(seconds);
    },
  }));

  function togglePlay() {
    const el = videoElRef.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  }

  function toggleMute() {
    const el = videoElRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const el = videoElRef.current;
    if (!el) return;
    const next = Number(e.target.value);
    el.volume = next;
    el.muted = next === 0;
    setVolume(next);
    setMuted(el.muted);
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const el = videoElRef.current;
    if (!el) return;
    el.currentTime = Number(e.target.value);
    setCurrentTime(el.currentTime);
  }

  return (
    <div className={fillHeight ? 'flex h-full min-h-0 justify-center' : undefined}>
      <div
        className={`group relative aspect-[9/16] overflow-hidden rounded-2xl bg-black ${
          fillHeight ? 'h-full max-w-full' : 'w-full'
        }`}
      >
        {mediaUrl ? (
          <>
            <video
              ref={videoElRef}
              src={mediaUrl}
              playsInline
              className="h-full w-full"
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration)}
              onTimeUpdate={(e) => {
                const t = (e.target as HTMLVideoElement).currentTime;
                setCurrentTime(t);
                onTime?.(t);
              }}
            />

            <div
              className={`absolute inset-x-2 bottom-2 flex h-8 items-center gap-2 rounded-lg bg-black/55 px-2.5 backdrop-blur-sm transition-opacity duration-200 ${
                isPlaying
                  ? 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
                  : 'opacity-100'
              }`}
            >
              <Tooltip label={isPlaying ? 'Pause' : 'Play'} className="shrink-0">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="text-white/90 transition-colors hover:text-white"
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
                </button>
              </Tooltip>

              <input
                type="range"
                aria-label="Seek"
                min={0}
                max={duration || 0}
                step={0.01}
                value={currentTime}
                onChange={handleScrub}
                className="video-scrubber h-3 flex-1"
              />

              <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/80">
                {formatTimestamp(currentTime)}
              </span>

              <div className="group/volume relative shrink-0">
                <div className="absolute bottom-full left-1/2 mb-2 flex h-20 -translate-x-1/2 items-center justify-center rounded-lg bg-black/55 px-1.5 py-2 opacity-0 backdrop-blur-sm transition-opacity duration-150 pointer-events-none group-hover/volume:pointer-events-auto group-hover/volume:opacity-100 group-focus-within/volume:pointer-events-auto group-focus-within/volume:opacity-100">
                  <input
                    type="range"
                    aria-label="Volume"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="video-volume-slider h-full w-3"
                  />
                </div>

                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  className="text-white/90 transition-colors hover:text-white"
                >
                  {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <Player ref={playerRef} url={video.url} onTime={onTime} />
        )}
      </div>
    </div>
  );
});
