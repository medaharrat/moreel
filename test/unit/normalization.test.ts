import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from '../../src/transcription/normalization.js';
import type { RawSegment } from '../../src/transcription/normalization.js';

describe('normalizeTranscript', () => {
  it('joins clean segments into full text and keeps timestamps', () => {
    const raw: RawSegment[] = [
      { start: 0, end: 1.5, text: '10 out of 10' },
      { start: 1.5, end: 3.2, text: 'unusual hobbies.' },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 3.2 });

    expect(transcript.segments).toEqual([
      { start: 0, end: 1.5, text: '10 out of 10' },
      { start: 1.5, end: 3.2, text: 'unusual hobbies.' },
    ]);
    expect(transcript.text).toBe('10 out of 10 unusual hobbies.');
    expect(transcript.language).toBe('en');
    expect(transcript.lowConfidence).toBe(false);
  });

  it('drops known hallucinated subtitle-credit boilerplate even with confident-looking scores', () => {
    // The real failure mode this guards against: a silent video where
    // Whisper still reports low noSpeechProb / normal avgLogProb (i.e. it
    // slips past those filters) because the hallucination itself is fluent.
    const raw: RawSegment[] = [
      { start: 0, end: 3, text: 'Subtitles provided by DimaTorzok', noSpeechProb: 0.1, avgLogProb: -0.2 },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 3 });

    expect(transcript.segments).toHaveLength(0);
    expect(transcript.text).toBe('');
    expect(transcript.lowConfidence).toBe(true);
  });

  it('drops other known hallucinated-caption phrasings (case-insensitive)', () => {
    const raw: RawSegment[] = [
      { start: 0, end: 2, text: 'Subtitles by the Amara.org community' },
      { start: 2, end: 4, text: 'subtitled by the community' },
      { start: 4, end: 6, text: 'Transcribed by XYZ' },
      { start: 6, end: 8, text: 'Real spoken content here.' },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 8 });

    expect(transcript.segments).toEqual([{ start: 6, end: 8, text: 'Real spoken content here.' }]);
    expect(transcript.lowConfidence).toBe(true);
  });

  it('keeps real speech even with an elevated noSpeechProb, when avgLogProb shows it was confidently recognized', () => {
    // Reproduces a real failure: Whisper computes noSpeechProb once per
    // ~30s decode window, not per segment, so a window that opens with a
    // pause/background music can tag every segment in it with the same
    // high noSpeechProb — including perfectly coherent later speech. A
    // good avgLogProb (close to 0) is the signal that it wasn't actually
    // silence misheard as words.
    const raw: RawSegment[] = [
      { start: 0, end: 7, text: 'Figma just announced Motion.', noSpeechProb: 0.772, avgLogProb: -0.247 },
      { start: 7, end: 15, text: 'Motion usually gets added way too late.', noSpeechProb: 0.772, avgLogProb: -0.247 },
      { start: 24, end: 34, text: "Here's a simple onboarding flow I made.", noSpeechProb: 0.233, avgLogProb: -0.165 },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 34 });

    expect(transcript.segments).toHaveLength(3);
    expect(transcript.text).toBe(
      "Figma just announced Motion. Motion usually gets added way too late. Here's a simple onboarding flow I made.",
    );
  });

  it('still drops an elevated noSpeechProb segment when avgLogProb also shows low confidence', () => {
    const raw: RawSegment[] = [
      { start: 0, end: 5, text: 'mumbled unclear words', noSpeechProb: 0.7, avgLogProb: -1.4 },
      { start: 5, end: 10, text: 'Real clear sentence.', noSpeechProb: 0.1, avgLogProb: -0.2 },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 10 });

    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0]?.text).toBe('Real clear sentence.');
    expect(transcript.lowConfidence).toBe(true);
  });

  it('drops segments the model flags as likely non-speech instead of fabricating text', () => {
    const raw: RawSegment[] = [
      { start: 0, end: 2, text: 'Hello there.', noSpeechProb: 0.05 },
      { start: 2, end: 5, text: '(music playing)', noSpeechProb: 0.92 },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 5 });

    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0]?.text).toBe('Hello there.');
    expect(transcript.text).toBe('Hello there.');
    expect(transcript.lowConfidence).toBe(true);
  });

  it('flags low confidence when average log-probability is poor without dropping the text', () => {
    const raw: RawSegment[] = [{ start: 0, end: 2, text: 'garbled speech', avgLogProb: -1.5 }];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 2 });

    expect(transcript.lowConfidence).toBe(true);
    expect(transcript.segments[0]?.text).toBe('garbled speech');
  });

  it('drops zero-length and inverted-timestamp segments', () => {
    const raw: RawSegment[] = [
      { start: 1, end: 1, text: 'zero length' },
      { start: 5, end: 2, text: 'inverted' },
      { start: 0, end: 1, text: 'valid' },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 10 });
    expect(transcript.segments).toEqual([{ start: 0, end: 1, text: 'valid' }]);
  });

  it('clamps timestamps to the reported audio duration', () => {
    const raw: RawSegment[] = [{ start: -1, end: 999, text: 'clamped' }];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 10 });
    expect(transcript.segments[0]).toEqual({ start: 0, end: 10, text: 'clamped' });
  });

  it('drops empty-text segments after whitespace trimming', () => {
    const raw: RawSegment[] = [{ start: 0, end: 1, text: '   ' }];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 1 });
    expect(transcript.segments).toHaveLength(0);
    expect(transcript.text).toBe('');
  });

  it('normalizes internal whitespace without altering wording', () => {
    const raw: RawSegment[] = [{ start: 0, end: 1, text: '  hello    world  \n' }];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 1 });
    expect(transcript.segments[0]?.text).toBe('hello world');
  });

  it('collapses a decoder loop of more than 2 identical consecutive segments and flags low confidence', () => {
    const raw: RawSegment[] = [
      { start: 0, end: 1, text: 'thanks for watching' },
      { start: 1, end: 2, text: 'thanks for watching' },
      { start: 2, end: 3, text: 'thanks for watching' },
      { start: 3, end: 4, text: 'thanks for watching' },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 4 });
    expect(transcript.segments).toHaveLength(1);
    expect(transcript.lowConfidence).toBe(true);
  });

  it('keeps up to 2 legitimately repeated consecutive segments untouched', () => {
    const raw: RawSegment[] = [
      { start: 0, end: 1, text: 'no no no' },
      { start: 1, end: 2, text: 'no no no' },
    ];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 2 });
    expect(transcript.segments).toHaveLength(2);
    expect(transcript.lowConfidence).toBe(false);
  });

  it('handles an entirely empty segment list (e.g. silent video)', () => {
    const transcript = normalizeTranscript([], { language: undefined, durationSeconds: 3 });
    expect(transcript.segments).toEqual([]);
    expect(transcript.text).toBe('');
    expect(transcript.durationSeconds).toBe(3);
  });

  it('converts avgLogProb into a bounded [0,1] confidence score', () => {
    const raw: RawSegment[] = [{ start: 0, end: 1, text: 'clear speech', avgLogProb: -0.1 }];
    const transcript = normalizeTranscript(raw, { language: 'en', durationSeconds: 1 });
    const confidence = transcript.segments[0]?.confidence;
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});
