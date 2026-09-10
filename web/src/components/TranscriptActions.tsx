import { Check, Copy, Download as DownloadIcon, Link as LinkIcon } from 'lucide-react';
import { useState } from 'react';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import type { DownloadFormat, Transcript } from '../types';
import { formatTimestamp } from '../lib/mockService';
import { Tooltip } from './Tooltip';

interface TranscriptActionsProps {
  transcript: Transcript;
}

function toTxt(transcript: Transcript): string {
  return transcript.segments
    .map((s) => `${formatTimestamp(s.startSeconds)}  ${s.text}`)
    .join('\n\n');
}

function toSrt(transcript: Transcript): string {
  return transcript.segments
    .map((s, i) => {
      const next = transcript.segments[i + 1]?.startSeconds ?? s.startSeconds + 4;
      return `${i + 1}\n${srtTime(s.startSeconds)} --> ${srtTime(next)}\n${s.text}`;
    })
    .join('\n\n');
}

function srtTime(totalSeconds: number): string {
  const ms = Math.floor((totalSeconds % 1) * 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function toJson(transcript: Transcript): string {
  return JSON.stringify(transcript, null, 2);
}

const FORMATTERS: Record<DownloadFormat, (t: Transcript) => string> = {
  txt: toTxt,
  srt: toSrt,
  json: toJson,
};

function download(transcript: Transcript, format: DownloadFormat) {
  const content = FORMATTERS[format](transcript);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transcript.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

const ICON_BUTTON =
  'flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink-soft';

export function TranscriptActions({ transcript }: TranscriptActionsProps) {
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(toTxt(transcript));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function handleCopyLink() {
    try {
      const link = `${window.location.origin}/transcripts/${transcript.id}`;
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1600);
    } catch (e) {
      console.warn('failed to copy permalink', e);
    }
  }

  return (
    <>
      <Tooltip label={copied ? 'Copied' : 'Copy'}>
        <button type="button" onClick={handleCopy} aria-label="Copy transcript" className={ICON_BUTTON}>
          {copied ? <Check className="h-4 w-4" strokeWidth={2} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
        </button>
      </Tooltip>

      <Tooltip label={copiedLink ? 'Link copied' : 'Copy link'}>
        <button type="button" onClick={handleCopyLink} aria-label="Copy link" className={ICON_BUTTON}>
          {copiedLink ? <Check className="h-4 w-4" strokeWidth={2} /> : <LinkIcon className="h-4 w-4" strokeWidth={2} />}
        </button>
      </Tooltip>

      <MenuTrigger>
        <Tooltip label="Download">
          <Button aria-label="Download" className={ICON_BUTTON}>
            <DownloadIcon className="h-4 w-4" strokeWidth={2} />
          </Button>
        </Tooltip>
        <Popover
          placement="bottom start"
          offset={8}
          className="origin-top-left transition-[opacity,transform] duration-150 ease-out data-[entering]:scale-95 data-[entering]:opacity-0 data-[exiting]:scale-95 data-[exiting]:opacity-0"
        >
          <Menu
            className="min-w-[120px] rounded-2xl border border-white/50 bg-white/70 p-1.5 text-[13px] text-ink shadow-[0_12px_32px_rgba(120,90,170,0.18)] backdrop-blur-xl outline-none"
            onAction={(key) => download(transcript, key as DownloadFormat)}
          >
            <MenuItem
              id="txt"
              className="cursor-pointer rounded-lg px-3 py-1.5 outline-none hover:bg-ink/5 data-[focused]:bg-ink/5"
            >
              TXT
            </MenuItem>
            <MenuItem
              id="srt"
              className="cursor-pointer rounded-lg px-3 py-1.5 outline-none hover:bg-ink/5 data-[focused]:bg-ink/5"
            >
              SRT
            </MenuItem>
            <MenuItem
              id="json"
              className="cursor-pointer rounded-lg px-3 py-1.5 outline-none hover:bg-ink/5 data-[focused]:bg-ink/5"
            >
              JSON
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </>
  );
}
