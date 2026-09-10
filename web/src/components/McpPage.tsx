import { StaticPageLayout } from './StaticPageLayout';
import type { NavRoute } from './TopNav';

interface McpPageProps {
  onBack: () => void;
  onNavigate: (route: NavRoute) => void;
}

const TOOLS = [
  { name: 'transcribe_video', description: 'Transcribe a video from a URL and return the full transcript with timestamps.' },
  { name: 'summarize_transcript', description: 'Generate a short AI summary of a given transcript id.' },
  { name: 'list_account_videos', description: 'List videos discovered for a tracked creator or account handle.' },
  { name: 'fetch_transcript', description: 'Retrieve a previously generated transcript by id.' },
];

const CONFIG_SNIPPET = `{
  "mcpServers": {
    "moreel": {
      "command": "npx",
      "args": ["-y", "@moreel/mcp-server"],
      "env": {
        "MOREEL_API_KEY": "sk_live_dummy_1234567890"
      }
    }
  }
}`;

/** Dummy/placeholder MCP docs page — links here from TopNav's "MCP". */
export function McpPage({ onBack, onNavigate }: McpPageProps) {
  return (
    <StaticPageLayout
      onBack={onBack}
      onNavigate={onNavigate}
      title="MCP"
      subtitle="Give Claude, Cursor, or any MCP client direct access to Moreel's transcription and summary tools."
    >
      <div className="mt-10">
        <h2 className="text-[13px] font-medium tracking-wide text-ink-faint uppercase">Available tools</h2>
        <div className="mt-3 flex flex-col divide-y divide-line rounded-xl border border-line">
          {TOOLS.map(({ name, description }) => (
            <div key={name} className="flex flex-col gap-0.5 px-4 py-3.5">
              <p className="font-mono text-[13px] text-ink">{name}</p>
              <p className="text-[13px] text-ink-soft">{description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-[13px] font-medium tracking-wide text-ink-faint uppercase">Setup</h2>
        <p className="mt-3 text-[13.5px] text-ink-soft">
          Add Moreel as an MCP server in your client's config file:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-ink px-4 py-4 font-mono text-[12.5px] leading-relaxed text-paper">
          {CONFIG_SNIPPET}
        </pre>
      </div>

      <div className="mt-10 rounded-xl border border-line bg-surface px-5 py-5 text-center">
        <p className="text-[13.5px] text-ink-soft">MCP server is in early access. Want to try it?</p>
        <a
          href="mailto:hello@moreel.app?subject=MCP%20access%20request"
          className="mt-2 inline-block text-[13.5px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:text-ink-soft"
        >
          Request access
        </a>
      </div>
    </StaticPageLayout>
  );
}
