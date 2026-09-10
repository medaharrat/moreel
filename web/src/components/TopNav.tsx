export type NavRoute = 'api' | 'mcp' | 'more';

interface TopNavProps {
  /** Intercepts nav links so App can swap in the matching page without a full reload. */
  onNavigate?: (route: NavRoute) => void;
}

function navLink(route: NavRoute, label: string, onNavigate?: (route: NavRoute) => void) {
  return (
    <a
      href={`/${route}`}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(route);
      }}
      className="transition-colors hover:text-ink-soft"
    >
      {label}
    </a>
  );
}

/**
 * A minimal utility nav — the developer-facing and account-level
 * destinations. About/Privacy/Terms live in the bottom-right footer
 * instead, so the top-right stays uncluttered.
 */
export function TopNav({ onNavigate }: TopNavProps) {
  return (
    <div className="flex items-center gap-5 text-[13px] text-ink-faint">
      {navLink('api', 'API', onNavigate)}
      {navLink('mcp', 'MCP', onNavigate)}
      {navLink('more', 'More', onNavigate)}
    </div>
  );
}
