import { ExternalLink, Heart, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { SiInstagram, SiTiktok, SiYoutube } from 'react-icons/si';
import type { IconType } from 'react-icons';
import { describeVideo, displayUrl, PLATFORM_LABEL } from '../lib/detectVideoUrl';
import type { VideoPlatform, VideoUrl } from '../types';

interface SourceHeaderProps {
  video: VideoUrl;
  caption?: string;
  creatorName?: string;
  creatorUrl?: string;
  likeCount?: number;
  commentCount?: number;
  postedAt?: string;
}

const PLATFORM_ICONS: Record<VideoPlatform, IconType> = {
  instagram: SiInstagram,
  tiktok: SiTiktok,
  youtube: SiYoutube,
};

const CAPTION_PREVIEW_CHARS = 160;

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatPostDate(iso: string): string {
  const date = new Date(iso);
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(date);
  const year = String(date.getFullYear()).slice(-2);
  return `Published on ${month} ${ordinal(date.getDate())} ${year}`;
}

/**
 * The result state's compact stand-in for the homepage's large composer —
 * a read-only label, not another input surface. When the provider surfaced
 * a caption and creator info, this leads with the post's own words instead
 * of just its URL — the platform-icon-plus-link row is the fallback for
 * when that data isn't available (e.g. platforms without full metadata
 * support yet).
 *
 * The creator's name is the only clickable thing in this block (points at
 * `creatorUrl`) — the byline stats and caption below read as plain
 * information, not more targets.
 */
export function SourceHeader({
  video,
  caption,
  creatorName,
  creatorUrl,
  likeCount,
  commentCount,
  postedAt,
}: SourceHeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const PlatformIcon = PLATFORM_ICONS[video.platform];

  if (!caption && !creatorName) {
    return (
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className="flex items-center text-ink-faint">
          <PlatformIcon className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{describeVideo(video)}</span>
        </span>

        <a
          href={video.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 font-mono text-ink-faint transition-colors hover:text-ink-soft"
        >
          {displayUrl(video.url)}
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        </a>
      </div>
    );
  }

  const flatCaption = caption?.replace(/\s*\n+\s*/g, ' ').trim();
  const isLong = !!flatCaption && flatCaption.length > CAPTION_PREVIEW_CHARS;
  const href = creatorUrl ?? video.url;

  const hasStats = typeof likeCount === 'number' || typeof commentCount === 'number' || !!postedAt;

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {creatorName && (
        <div className="flex min-w-0 flex-col gap-1">
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="w-fit max-w-full truncate font-medium text-ink transition-colors hover:text-ink-soft"
          >
            {creatorName}
          </a>
          {hasStats && (
            <span className="flex items-center gap-2.5 text-[12px] text-ink-faint">
              {typeof likeCount === 'number' && (
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" strokeWidth={2} />
                  {compactNumber.format(likeCount)}
                </span>
              )}
              {typeof commentCount === 'number' && (
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" strokeWidth={2} />
                  {compactNumber.format(commentCount)}
                </span>
              )}
              {postedAt && (
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true">-</span>
                  {formatPostDate(postedAt)}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {flatCaption && (
        <div className="border-l-2 border-line py-0.5 pl-3">
          <p className="text-[12px] leading-relaxed text-ink-faint italic">
            {expanded || !isLong ? flatCaption : `${flatCaption.slice(0, CAPTION_PREVIEW_CHARS).trimEnd()}…`}
            {isLong && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-1.5 text-ink-faint not-italic underline decoration-line underline-offset-2 transition-colors hover:text-ink-soft"
              >
                {expanded ? 'less' : 'more'}
              </button>
            )}
          </p>
        </div>
      )}

      <a
        href={video.url}
        target="_blank"
        rel="noreferrer"
        className="flex w-fit items-center gap-1 text-[12px] text-ink-faint transition-colors hover:text-ink-soft"
      >
        Watch on {PLATFORM_LABEL[video.platform]}
        <ExternalLink className="h-3 w-3" strokeWidth={2} />
      </a>
    </div>
  );
}
