import { StaticPageLayout } from './StaticPageLayout';
import type { NavRoute } from './TopNav';

interface ApiPageProps {
  onBack: () => void;
  onNavigate: (route: NavRoute) => void;
}

const ENDPOINTS = [
  { method: 'POST', path: '/v1/transcripts', description: 'Submit a video URL and get a transcript back.' },
  { method: 'GET', path: '/v1/transcripts/:id', description: 'Fetch a previously generated transcript by id.' },
  { method: 'POST', path: '/v1/transcripts/:id/summary', description: 'Generate an AI summary for an existing transcript.' },
  { method: 'GET', path: '/v1/accounts/:handle/videos', description: 'List videos discovered for a tracked account.' },
];

const SAMPLE_REQUEST = `curl https://api.moreel.app/v1/transcripts \\
  -H "Authorization: Bearer sk_live_dummy_1234567890" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.tiktok.com/@example/video/123456"
  }'`;

const SAMPLE_RESPONSE = `{
  "id": "trs_9f8c2a",
  "status": "completed",
  "video": { "url": "https://www.tiktok.com/@example/video/123456" },
  "segments": [
    { "startSeconds": 0, "text": "Hey, welcome back to the channel." },
    { "startSeconds": 2.4, "text": "Today we're talking about..." }
  ]
}`;

/** Dummy/placeholder API docs page — links here from TopNav's "API". */
export function ApiPage({ onBack, onNavigate }: ApiPageProps) {
  return (
    <StaticPageLayout
      onBack={onBack}
      onNavigate={onNavigate}
      title="API"
      subtitle="Transcribe and summarize video programmatically. Bring Moreel into your own pipeline."
    >
      <div className="mt-10">
        <h2 className="text-[13px] font-medium tracking-wide text-ink-faint uppercase">Endpoints</h2>
        <div className="mt-3 flex flex-col divide-y divide-line rounded-xl border border-line">
          {ENDPOINTS.map(({ method, path, description }) => (
            <div key={path} className="flex items-start gap-3 px-4 py-3.5">
              <span className="mt-0.5 shrink-0 rounded-md bg-line/60 px-2 py-0.5 font-mono text-[11px] font-medium text-ink-soft">
                {method}
              </span>
              <div>
                <p className="font-mono text-[13px] text-ink">{path}</p>
                <p className="pt-0.5 text-[13px] text-ink-soft">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-[13px] font-medium tracking-wide text-ink-faint uppercase">Example request</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-ink px-4 py-4 font-mono text-[12.5px] leading-relaxed text-paper">
          {SAMPLE_REQUEST}
        </pre>
      </div>

      <div className="mt-10">
        <h2 className="text-[13px] font-medium tracking-wide text-ink-faint uppercase">Example response</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-ink px-4 py-4 font-mono text-[12.5px] leading-relaxed text-paper">
          {SAMPLE_RESPONSE}
        </pre>
      </div>
    </StaticPageLayout>
  );
}
