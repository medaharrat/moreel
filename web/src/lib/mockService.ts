import type { Transcript, VideoUrl } from '../types';
import { describeVideo } from './detectVideoUrl';

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SAMPLE_SENTENCES = [
  "Today we're going to talk about something most people get wrong.",
  "The first thing you need to understand is that context matters more than the tactic itself.",
  'A lot of advice online skips straight to the "what" without ever explaining the "why".',
  "So let's start from first principles, and build up from there.",
  'The interesting thing is how small this change actually is once you see it.',
  "Most people try to fix the symptom, not the underlying cause.",
  "Once you shift your thinking here, everything downstream gets easier.",
  "Here's a quick example so this isn't just theory.",
  "Notice what happens when you remove the extra step entirely.",
  "That's the whole idea. Simple, but easy to miss.",
  "If you take one thing away from this, let it be that.",
  "Try it this week and see what changes for you.",
];

function buildTranscript(video: VideoUrl): Transcript {
  const durationSeconds = 62;
  let t = 0;
  const segments = SAMPLE_SENTENCES.map((text) => {
    const startSeconds = t;
    const duration = 3 + Math.floor(Math.random() * 3);
    t += duration + Math.floor(Math.random() * 2);
    return { id: id(), startSeconds, endSeconds: startSeconds + duration, text };
  });

  return {
    id: id(),
    video,
    title: describeVideo(video),
    durationSeconds,
    segments,
  };
}

export interface TranscriptionService {
  transcribe(video: VideoUrl, onStatus?: (message: string) => void): Promise<Transcript>;
}

const PROCESSING_STEPS = [
  'Fetching video…',
  'Extracting audio…',
  'Understanding your video…',
  'Finishing up…',
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockTranscriptionService: TranscriptionService = {
  async transcribe(video, onStatus) {
    for (const step of PROCESSING_STEPS) {
      onStatus?.(step);
      await wait(650 + Math.random() * 350);
    }
    return buildTranscript(video);
  },
};

export function formatTimestamp(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
