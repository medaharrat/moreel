import { describe, expect, it } from 'vitest';
import { resegmentByWords } from '../../src/transcription/resegmentation.js';
import type { RawSegment } from '../../src/transcription/normalization.js';

describe('resegmentByWords', () => {
  it('returns the original segments unchanged when there are no words at all', () => {
    const segments: RawSegment[] = [{ start: 0, end: 5, text: 'hello world' }];
    expect(resegmentByWords(segments, [])).toBe(segments);
  });

  it('splits a slow single phrase with real pauses between words into several sub-segments', () => {
    // One Whisper segment spanning a slow, deliberate phrase with ~1s gaps
    // between words — exactly the "short video, one slow phrase" case.
    const segments: RawSegment[] = [
      { start: 0, end: 6, text: 'This changed my business', avgLogProb: -0.2, noSpeechProb: 0.01 },
    ];
    const words = [
      { word: 'This', start: 0, end: 0.4 },
      { word: 'changed', start: 1.5, end: 2.0 },
      { word: 'my', start: 3.2, end: 3.4 },
      { word: 'business', start: 4.8, end: 5.5 },
    ];

    const result = resegmentByWords(segments, words, { maxPauseSeconds: 0.8 });

    expect(result).toHaveLength(4);
    expect(result.map((s) => s.text)).toEqual(['This', 'changed', 'my', 'business']);
    // Confidence signals are inherited from the parent segment on every sub-segment.
    expect(result.every((s) => s.avgLogProb === -0.2 && s.noSpeechProb === 0.01)).toBe(true);
    expect(result[0]).toMatchObject({ start: 0, end: 0.4 });
    expect(result[3]).toMatchObject({ start: 4.8, end: 5.5 });
  });

  it('splits on sentence-ending punctuation even without a long pause', () => {
    const segments: RawSegment[] = [{ start: 0, end: 3, text: 'Hi there. How are you?' }];
    const words = [
      { word: 'Hi', start: 0, end: 0.2 },
      { word: 'there.', start: 0.25, end: 0.5 },
      { word: 'How', start: 0.55, end: 0.7 },
      { word: 'are', start: 0.75, end: 0.9 },
      { word: 'you?', start: 0.95, end: 1.2 },
    ];

    const result = resegmentByWords(segments, words);

    expect(result.map((s) => s.text)).toEqual(['Hi there.', 'How are you?']);
  });

  it('force-splits a long run-on segment with no punctuation or pauses (fast speech)', () => {
    // 30 words, no punctuation, no gaps ≥ the pause threshold — a fast
    // talker filling one long Whisper segment with a run-on sentence.
    const words = Array.from({ length: 30 }, (_, i) => ({
      word: `word${i}`,
      start: i * 0.25,
      end: i * 0.25 + 0.2,
    }));
    const segments: RawSegment[] = [{ start: 0, end: words[words.length - 1]!.end, text: 'irrelevant, replaced by word timings' }];

    const result = resegmentByWords(segments, words, { maxWordsPerSegment: 10, maxSegmentSeconds: 999 });

    expect(result).toHaveLength(3);
    expect(result[0]?.text.split(' ')).toHaveLength(10);
    expect(result[2]?.text.split(' ')).toHaveLength(10);
  });

  it('force-splits on a duration cap even with a word-count budget to spare', () => {
    const words = [
      { word: 'a', start: 0, end: 0.1 },
      { word: 'b', start: 0.1, end: 0.2 },
      { word: 'c', start: 5, end: 5.1 },
      { word: 'd', start: 5.1, end: 5.2 },
    ];
    const segments: RawSegment[] = [{ start: 0, end: 5.2, text: 'a b c d' }];

    // maxPauseSeconds set high so the 4.8s gap doesn't trigger the pause
    // split — only the duration cap (hit right after "b", then again at
    // the last word "d") should.
    const result = resegmentByWords(segments, words, {
      maxSegmentSeconds: 0.15,
      maxPauseSeconds: 10,
      maxWordsPerSegment: 100,
    });

    expect(result.map((s) => s.text)).toEqual(['a b', 'c d']);
  });

  it('leaves a short, normally-paced segment as a single chunk', () => {
    const segments: RawSegment[] = [{ start: 0, end: 1, text: 'Hello there' }];
    const words = [
      { word: 'Hello', start: 0, end: 0.4 },
      { word: 'there', start: 0.45, end: 0.9 },
    ];

    const result = resegmentByWords(segments, words);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Hello there');
  });

  it('passes through a segment untouched when none of its words match (defensive fallback)', () => {
    const segments: RawSegment[] = [{ start: 0, end: 2, text: 'kept as-is' }];
    const words = [{ word: 'elsewhere', start: 50, end: 51 }];

    expect(resegmentByWords(segments, words)).toEqual(segments);
  });
});
