import type { ReactNode } from 'react';
import { MoreelLogo } from './MoreelLogo';
import { TopNav, type NavRoute } from './TopNav';

interface StaticPageLayoutProps {
  onBack: () => void;
  onNavigate?: (route: NavRoute) => void;
  title: string;
  subtitle: string;
  children: ReactNode;
}

/** Shared chrome for standalone pages (API/MCP/More) — header layout mirrors the transcript result page. */
export function StaticPageLayout({ onBack, onNavigate, title, subtitle, children }: StaticPageLayoutProps) {
  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <div className="absolute top-5 left-6 z-10 hidden md:block">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-[13px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          Home
        </button>
      </div>

      <div className="absolute top-5 right-6 z-10 hidden md:block">
        <TopNav onNavigate={onNavigate} />
      </div>

      {/* The logo sits in its own top-center bar, matching the result/transcript page. */}
      <div className="flex shrink-0 flex-col items-center gap-2 px-5 pt-6 pb-12 text-center">
        <MoreelLogo size="sm" onClick={onBack} />
      </div>

      <div className="w-full flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 pb-20 sm:px-8">
          <div>
            <h1 className="text-[28px] leading-tight font-medium text-ink sm:text-[34px]">{title}</h1>
            <p className="pt-3 text-[15px] text-ink-soft">{subtitle}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
