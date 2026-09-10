import { describe, expect, it } from 'vitest';
import { findTriggerWindows } from '../../src/app/trigger-detection.js';
import type { Transcript } from '../../src/domain/transcript.js';

function transcript(segments: Array<{ start: number; end: number; text: string }>): Transcript {
  return {
    text: segments.map((s) => s.text).join(' '),
    segments,
    language: 'en',
    durationSeconds: segments[segments.length - 1]?.end ?? 0,
    lowConfidence: false,
  };
}

describe('findTriggerWindows', () => {
  it('finds a deictic reference like "this one"', () => {
    const windows = findTriggerWindows(transcript([{ start: 4, end: 6, text: 'This one is incredible.' }]));
    expect(windows).toEqual([{ timestamp: 4, segmentIndex: 0, phrase: 'this one', text: 'This one is incredible.' }]);
  });

  it('finds a topic word like "product" or "camera"', () => {
    const windows = findTriggerWindows(
      transcript([
        { start: 0, end: 2, text: 'Let me show you the camera.' },
        { start: 10, end: 12, text: 'And now the product itself.' },
      ]),
    );
    expect(windows.map((w) => w.phrase)).toEqual(['camera', 'product']);
  });

  it('ignores segments with no trigger at all', () => {
    const windows = findTriggerWindows(transcript([{ start: 0, end: 2, text: 'Hello everyone, welcome back.' }]));
    expect(windows).toEqual([]);
  });

  it('prefers the more specific multi-word phrase over a shorter substring match within the same segment', () => {
    // Contains both "look at" and the standalone words "that"/"camera" —
    // "look at" is checked first and should win, not the generic ones.
    const windows = findTriggerWindows(transcript([{ start: 0, end: 2, text: 'Look at that camera.' }]));
    expect(windows).toHaveLength(1);
    expect(windows[0]?.phrase).toBe('look at');
  });

  it('merges trigger windows within the merge window instead of double-counting the same moment', () => {
    const windows = findTriggerWindows(
      transcript([
        { start: 4.0, end: 4.5, text: 'this one' },
        { start: 5.0, end: 5.5, text: 'right here' },
      ]),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.timestamp).toBe(4.0);
  });

  it('caps the number of windows at maxWindows, earliest first', () => {
    const segments = Array.from({ length: 20 }, (_, i) => ({
      start: i * 10,
      end: i * 10 + 1,
      text: 'this product is great',
    }));
    const windows = findTriggerWindows(transcript(segments), 5);
    expect(windows).toHaveLength(5);
    expect(windows.map((w) => w.timestamp)).toEqual([0, 10, 20, 30, 40]);
  });

  it('returns nothing for an empty transcript', () => {
    expect(findTriggerWindows(transcript([]))).toEqual([]);
  });
});
