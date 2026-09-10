import { describe, expect, it } from 'vitest';
import { characterErrorRate, wordErrorRate } from '../../src/transcription/wer.js';

describe('wordErrorRate', () => {
  it('is 0 for an identical transcript', () => {
    expect(wordErrorRate('hello world', 'hello world')).toBe(0);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(wordErrorRate('Hello, World!', 'hello world')).toBe(0);
  });

  it('counts one substitution correctly', () => {
    expect(wordErrorRate('the cat sat', 'the dog sat')).toBeCloseTo(1 / 3, 5);
  });

  it('counts a deletion correctly', () => {
    expect(wordErrorRate('the cat sat down', 'the cat down')).toBeCloseTo(1 / 4, 5);
  });

  it('counts an insertion correctly', () => {
    expect(wordErrorRate('the cat sat', 'the big cat sat')).toBeCloseTo(1 / 3, 5);
  });

  it('is 1 when the hypothesis is empty but reference is not', () => {
    expect(wordErrorRate('hello world', '')).toBe(1);
  });

  it('is 0 when both reference and hypothesis are empty', () => {
    expect(wordErrorRate('', '')).toBe(0);
  });

  it('is 1 when the reference is empty but hypothesis is not', () => {
    expect(wordErrorRate('', 'hello')).toBe(1);
  });
});

describe('characterErrorRate', () => {
  it('is 0 for an identical transcript', () => {
    expect(characterErrorRate('hello', 'hello')).toBe(0);
  });

  it('counts character-level differences', () => {
    expect(characterErrorRate('cat', 'car')).toBeCloseTo(1 / 3, 5);
  });
});
