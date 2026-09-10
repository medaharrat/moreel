import { ErrorCode, MoreelError } from '../domain/errors.js';

/**
 * First line of defense against SSRF and malformed input. This validates
 * general well-formedness and safety of a URL string *before* any provider
 * gets to look at it. Provider-specific host/path validation happens next,
 * in each provider's own URL module.
 */
export function parseAndValidateUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new MoreelError(ErrorCode.INVALID_URL, 'The "url" argument must be a non-empty string.');
  }
  if (raw.length > 2048) {
    throw new MoreelError(ErrorCode.INVALID_URL, 'The URL is too long.');
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new MoreelError(ErrorCode.INVALID_URL, 'The provided value is not a valid URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MoreelError(ErrorCode.INVALID_URL, 'Only http/https URLs are supported.');
  }

  if (url.username || url.password) {
    throw new MoreelError(ErrorCode.INVALID_URL, 'URLs with embedded credentials are not allowed.');
  }

  if (isIpLiteralHost(url.hostname)) {
    throw new MoreelError(
      ErrorCode.INVALID_URL,
      'URLs pointing directly at an IP address are not allowed.',
    );
  }

  return url;
}

function isIpLiteralHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  if (ipv4.test(bare)) return true;
  if (bare.includes(':') && ipv6.test(bare)) return true;
  if (bare === 'localhost') return true;
  return false;
}
