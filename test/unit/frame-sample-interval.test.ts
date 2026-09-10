import { describe, expect, it } from 'vitest';
import { computeFrameSampleInterval } from '../../src/app/transcription-service.js';

describe('computeFrameSampleInterval', () => {
  it('tightens the interval for a short video so it gets dense coverage', () => {
    // 16s video at the configured 5s interval would sample only ~4 frames —
    // most of the video never gets a single sampled frame.
    expect(computeFrameSampleInterval(16.34, 5, 16)).toBe(2);
  });

  it('leaves the configured interval untouched for a normal-length video', () => {
    expect(computeFrameSampleInterval(60, 5, 16)).toBe(5);
  });

  it('never widens the interval beyond what was configured', () => {
    // A very short video with a generous maxFramesPerVideo shouldn't push
    // the interval higher than the configured default.
    expect(computeFrameSampleInterval(3, 5, 16)).toBeLessThanOrEqual(5);
  });

  it('is bounded by maxFramesPerVideo, not just the dense-coverage target', () => {
    // With a cap of only 2 frames total, targeting 2 frames over 16s would
    // actually WIDEN the interval to 8s — the "never widens" rule must win.
    expect(computeFrameSampleInterval(16, 5, 2)).toBe(5);
  });

  it('falls back to the configured interval when duration is unknown', () => {
    expect(computeFrameSampleInterval(undefined, 5, 16)).toBe(5);
  });

  it('falls back to the configured interval when duration is zero or negative', () => {
    expect(computeFrameSampleInterval(0, 5, 16)).toBe(5);
    expect(computeFrameSampleInterval(-3, 5, 16)).toBe(5);
  });

  it('never returns an interval below 1 second', () => {
    expect(computeFrameSampleInterval(1, 5, 16)).toBeGreaterThanOrEqual(1);
  });
});
