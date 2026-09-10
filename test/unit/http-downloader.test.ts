import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadError, HttpDownloader } from '../../src/media/downloader/http-downloader.js';

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, { status: init.status ?? 200, headers: init.headers ?? {} });
}

function bytesResponse(
  bytes: Uint8Array,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(bytes, { status: init.status ?? 200, headers: init.headers ?? {} });
}

describe('HttpDownloader', () => {
  let destDir: string;

  beforeEach(async () => {
    destDir = await mkdtemp(path.join(tmpdir(), 'moreel-downloader-test-'));
  });

  afterEach(async () => {
    await rm(destDir, { recursive: true, force: true });
  });

  it('downloads an allowed host to a UUID-named file, never derived from the URL', async () => {
    const fetchImpl = vi.fn(async () =>
      bytesResponse(new TextEncoder().encode('fake-video-bytes'), {
        headers: { 'content-type': 'video/mp4', 'content-length': '16' },
      }),
    );
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    const result = await downloader.download({
      url: 'https://scontent.cdninstagram.com/../../etc/passwd/video.mp4',
      destDir,
      maxSizeBytes: 1024,
      timeoutMs: 5000,
      allowedHostSuffixes: ['cdninstagram.com'],
    });

    expect(result.filePath.startsWith(destDir)).toBe(true);
    expect(path.basename(result.filePath)).toMatch(/^[0-9a-f-]{36}\.mp4$/);
    expect(result.sizeBytes).toBe(16);
    expect(await readFile(result.filePath, 'utf8')).toBe('fake-video-bytes');

    const entries = await readdir(destDir);
    expect(entries).toHaveLength(1);
  });

  it('rejects a host not in the allowlist without making a network call', async () => {
    const fetchImpl = vi.fn();
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    await expect(
      downloader.download({
        url: 'https://evil.example.com/video.mp4',
        destDir,
        maxSizeBytes: 1024,
        timeoutMs: 5000,
        allowedHostSuffixes: ['cdninstagram.com'],
      }),
    ).rejects.toMatchObject({ kind: 'unsafe_host' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects based on the SSRF host guard even for an allowlisted-looking host', async () => {
    const fetchImpl = vi.fn();
    const hostGuard = vi.fn(async () => {
      throw new Error('resolves to a private IP');
    });
    const downloader = new HttpDownloader({ fetchImpl, hostGuard });

    await expect(
      downloader.download({
        url: 'https://cdninstagram.com/video.mp4',
        destDir,
        maxSizeBytes: 1024,
        timeoutMs: 5000,
        allowedHostSuffixes: ['cdninstagram.com'],
      }),
    ).rejects.toMatchObject({ kind: 'unsafe_host' });
  });

  it('rejects a response exceeding the size cap via Content-Length before streaming', async () => {
    const fetchImpl = vi.fn(async () =>
      textResponse('', { headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    await expect(
      downloader.download({
        url: 'https://cdninstagram.com/video.mp4',
        destDir,
        maxSizeBytes: 1024,
        timeoutMs: 5000,
        allowedHostSuffixes: ['cdninstagram.com'],
      }),
    ).rejects.toMatchObject({ kind: 'too_large' });
  });

  it('rejects a stream that exceeds the size cap even without a Content-Length header, and cleans up the partial file', async () => {
    const bigChunk = new Uint8Array(2048).fill(1);
    const fetchImpl = vi.fn(async () =>
      bytesResponse(bigChunk, { headers: { 'content-type': 'video/mp4' } }),
    );
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    await expect(
      downloader.download({
        url: 'https://cdninstagram.com/video.mp4',
        destDir,
        maxSizeBytes: 1024,
        timeoutMs: 5000,
        allowedHostSuffixes: ['cdninstagram.com'],
      }),
    ).rejects.toMatchObject({ kind: 'too_large' });

    expect(await readdir(destDir)).toHaveLength(0);
  });

  it('follows a redirect and re-validates the new host against the allowlist', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://real-cdn.cdninstagram.com/final.mp4' },
        }),
      )
      .mockResolvedValueOnce(
        bytesResponse(new TextEncoder().encode('redirected-bytes'), {
          headers: { 'content-type': 'video/mp4' },
        }),
      );
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    const result = await downloader.download({
      url: 'https://cdninstagram.com/redirect.mp4',
      destDir,
      maxSizeBytes: 1024,
      timeoutMs: 5000,
      allowedHostSuffixes: ['cdninstagram.com'],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readFile(result.filePath, 'utf8')).toBe('redirected-bytes');
  });

  it('rejects a redirect to a disallowed host', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } }),
      );
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    await expect(
      downloader.download({
        url: 'https://cdninstagram.com/redirect.mp4',
        destDir,
        maxSizeBytes: 1024,
        timeoutMs: 5000,
        allowedHostSuffixes: ['cdninstagram.com'],
      }),
    ).rejects.toMatchObject({ kind: 'unsafe_host' });
  });

  it('maps a non-2xx upstream response to an http_error', async () => {
    const fetchImpl = vi.fn(async () => textResponse('not found', { status: 404 }));
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    await expect(
      downloader.download({
        url: 'https://cdninstagram.com/gone.mp4',
        destDir,
        maxSizeBytes: 1024,
        timeoutMs: 5000,
        allowedHostSuffixes: ['cdninstagram.com'],
      }),
    ).rejects.toMatchObject({ kind: 'http_error', statusCode: 404 });
  });

  it('wraps a thrown network error as a DownloadError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const downloader = new HttpDownloader({ fetchImpl, hostGuard: async () => undefined });

    await expect(
      downloader.download({
        url: 'https://cdninstagram.com/video.mp4',
        destDir,
        maxSizeBytes: 1024,
        timeoutMs: 5000,
        allowedHostSuffixes: ['cdninstagram.com'],
      }),
    ).rejects.toBeInstanceOf(DownloadError);
  });
});
