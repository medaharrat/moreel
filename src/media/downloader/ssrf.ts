import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF defense-in-depth: even when a hostname passes the provider's own
 * allowlist, we resolve it and refuse to connect if any resolved address
 * is loopback, link-local, private, or otherwise non-routable (this also
 * covers the classic cloud-metadata SSRF target, 169.254.169.254).
 *
 * This is best-effort, not a substitute for network-level egress control:
 * a DNS answer can change between this check and the actual connection
 * (TOCTOU / "DNS rebinding"). Combined with the hostname allowlist in each
 * provider and the fact that only two well-known platforms' CDNs are ever
 * dialed, the residual risk is small for v0.1. A production deployment
 * should additionally enforce egress rules at the network layer.
 */
export class UnsafeHostError extends Error {
  constructor(host: string, reason: string) {
    super(`Refusing to connect to "${host}": ${reason}`);
    this.name = 'UnsafeHostError';
  }
}

export async function assertHostIsSafe(hostname: string): Promise<void> {
  const literalVersion = isIP(hostname);
  if (literalVersion) {
    if (isDisallowedIp(hostname, literalVersion)) {
      throw new UnsafeHostError(hostname, 'resolves to a private/reserved IP address');
    }
    return;
  }

  if (hostname.toLowerCase() === 'localhost') {
    throw new UnsafeHostError(hostname, 'localhost is not allowed');
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (error) {
    throw new UnsafeHostError(hostname, `DNS resolution failed: ${(error as Error).message}`);
  }

  for (const { address, family } of addresses) {
    if (isDisallowedIp(address, family)) {
      throw new UnsafeHostError(hostname, `resolves to a private/reserved IP address (${address})`);
    }
  }
}

function isDisallowedIp(address: string, family: number): boolean {
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved/broadcast

  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 address; validate the embedded IPv4 too.
    const embedded = normalized.replace('::ffff:', '');
    if (isIP(embedded) === 4) return isPrivateIPv4(embedded);
  }
  return false;
}
