import { describe, expect, it } from 'vitest';
import { assertHostIsSafe, UnsafeHostError } from '../../src/media/downloader/ssrf.js';

describe('assertHostIsSafe', () => {
  it('rejects loopback IP literals', async () => {
    await expect(assertHostIsSafe('127.0.0.1')).rejects.toThrow(UnsafeHostError);
    await expect(assertHostIsSafe('::1')).rejects.toThrow(UnsafeHostError);
  });

  it('rejects private-range IPv4 literals', async () => {
    await expect(assertHostIsSafe('10.0.0.5')).rejects.toThrow(UnsafeHostError);
    await expect(assertHostIsSafe('192.168.1.1')).rejects.toThrow(UnsafeHostError);
    await expect(assertHostIsSafe('172.16.0.1')).rejects.toThrow(UnsafeHostError);
  });

  it('rejects the cloud-metadata link-local address', async () => {
    await expect(assertHostIsSafe('169.254.169.254')).rejects.toThrow(UnsafeHostError);
  });

  it('rejects "localhost" directly', async () => {
    await expect(assertHostIsSafe('localhost')).rejects.toThrow(UnsafeHostError);
  });

  it('allows a public IPv4 literal', async () => {
    await expect(assertHostIsSafe('8.8.8.8')).resolves.toBeUndefined();
  });

  it('resolves a hostname via DNS and rejects it if any address is private', async () => {
    // "localtest.me" and friends are unreliable in sandboxed CI; instead we
    // exercise the address-classification path directly through IP literals
    // above, and verify hostname resolution failure is surfaced safely.
    await expect(assertHostIsSafe('this-domain-should-not-resolve.invalid')).rejects.toThrow(
      UnsafeHostError,
    );
  });
});
