import { describe, expect, it } from 'vitest';
import { parseAndValidateUrl } from '../../src/providers/url-validation.js';
import { MoreelError } from '../../src/domain/errors.js';

describe('parseAndValidateUrl', () => {
  it('accepts a well-formed https URL', () => {
    const url = parseAndValidateUrl('https://www.instagram.com/reel/abc123/');
    expect(url.hostname).toBe('www.instagram.com');
  });

  it('rejects an empty string', () => {
    expect(() => parseAndValidateUrl('')).toThrow(MoreelError);
    expect(() => parseAndValidateUrl('   ')).toThrow(MoreelError);
  });

  it('rejects a non-string input', () => {
    // @ts-expect-error deliberately wrong type to exercise runtime guard
    expect(() => parseAndValidateUrl(42)).toThrow(MoreelError);
  });

  it('rejects malformed URLs', () => {
    expect(() => parseAndValidateUrl('not a url')).toThrow(MoreelError);
    expect(() => parseAndValidateUrl('www.instagram.com/reel/abc')).toThrow(MoreelError);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => parseAndValidateUrl('ftp://instagram.com/reel/abc')).toThrow(MoreelError);
    expect(() => parseAndValidateUrl('file:///etc/passwd')).toThrow(MoreelError);
    expect(() => parseAndValidateUrl('javascript:alert(1)')).toThrow(MoreelError);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(() => parseAndValidateUrl('https://user:pass@instagram.com/reel/abc')).toThrow(
      MoreelError,
    );
  });

  it('rejects IP-literal hosts (SSRF hardening)', () => {
    expect(() => parseAndValidateUrl('https://127.0.0.1/reel/abc')).toThrow(MoreelError);
    expect(() => parseAndValidateUrl('https://169.254.169.254/latest/meta-data')).toThrow(
      MoreelError,
    );
    expect(() => parseAndValidateUrl('https://localhost/reel/abc')).toThrow(MoreelError);
    expect(() => parseAndValidateUrl('https://[::1]/reel/abc')).toThrow(MoreelError);
  });

  it('rejects excessively long URLs', () => {
    const longUrl = `https://www.instagram.com/reel/${'a'.repeat(3000)}/`;
    expect(() => parseAndValidateUrl(longUrl)).toThrow(MoreelError);
  });

  it('carries the INVALID_URL error code', () => {
    try {
      parseAndValidateUrl('not a url');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MoreelError);
      expect((error as MoreelError).code).toBe('INVALID_URL');
    }
  });
});
