import { BarChart3, CalendarClock, Download, Sparkles, Users } from 'lucide-react';
import { StaticPageLayout } from './StaticPageLayout';
import type { NavRoute } from './TopNav';

interface MorePageProps {
  onBack: () => void;
  onNavigate: (route: NavRoute) => void;
}

const FEATURES = [
  {
    icon: Users,
    title: 'Bulk transcribing per account',
    description:
      'Point Moreel at a creator or account and transcribe their entire back catalog in one go, instead of pasting links one at a time.',
  },
  {
    icon: Sparkles,
    title: 'AI summaries',
    description:
      'Get a short, structured summary of every transcript — key points, quotes, and timestamps — generated automatically alongside the full text.',
  },
  {
    icon: CalendarClock,
    title: 'Scheduled transcription',
    description:
      'Track accounts you care about and have new posts transcribed automatically as they go up, with no manual re-submission.',
  },
  {
    icon: Download,
    title: 'Bulk export',
    description:
      'Export transcripts and summaries in CSV, PDF, or SRT — individually or in batch — ready to drop into your own workflow or editing tools.',
  },
  {
    icon: BarChart3,
    title: 'Cross-account insights',
    description:
      'Compare topics, themes, and talking points across everything you have transcribed for an account, instead of reading one video at a time.',
  },
];

/** Aspirational "coming soon" page for advanced/team features — links here from TopNav's "More". */
export function MorePage({ onBack, onNavigate }: MorePageProps) {
  return (
    <StaticPageLayout
      onBack={onBack}
      onNavigate={onNavigate}
      title="More, for whole accounts"
      subtitle="Beyond single-video transcripts — features for tracking creators and teams at scale."
    >
      <div className="mt-10 flex flex-col divide-y divide-line">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex gap-4 py-6 first:pt-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-line/60">
              <Icon className="h-4 w-4 text-ink-soft" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-[15px] font-medium text-ink">{title}</h2>
              <p className="pt-1 text-[13.5px] leading-relaxed text-ink-soft">{description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface px-5 py-5 text-center">
        <p className="text-[13.5px] text-ink-soft">
          These are on the roadmap. Want early access or have a feature request?
        </p>
        <a
          href="mailto:hello@moreel.app?subject=More%20features%20interest"
          className="mt-2 inline-block text-[13.5px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:text-ink-soft"
        >
          Get in touch
        </a>
      </div>
    </StaticPageLayout>
  );
}
