import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertHostIsSafe } from './ssrf.js';

/**
 * Generic, provider-agnostic streaming HTTP downloader. Providers resolve
 * *which* URL holds the media (platform-specific); this module is solely
 * responsible for safely getting those bytes onto local disk:
 *   - manual redirect handling, so every hop is re-validated (host
 *     allowlist + SSRF check), not just the initial URL
 *   - a hard byte cap enforced *while streaming*, so we never buffer an
 *     oversized response into memory or disk before rejecting it
 *   - a destination filename that is always server-generated (a UUID),
 *     never derived from the remote URL or path — this is what makes path
 *     traversal via a malicious filename structurally impossible
 */

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly kind: 'unsafe_host' | 'http_error' | 'too_large' | 'network' | 'timeout',
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadRequest {
  url: string;
  destDir: string;
  maxSizeBytes: number;
  timeoutMs: number;
  /** Only hosts equal to, or a subdomain of, one of these suffixes may be fetched. */
  allowedHostSuffixes: string[];
  signal?: AbortSignal;
  /**
   * Extra request headers (User-Agent, Referer, ...) — some CDNs (observed:
   * TikTok's) validate these against the resolved URL and 403 a request
   * without them, even though the URL itself is otherwise valid. Providers
   * that get a `http_headers` object back from yt-dlp's probe pass it
   * straight through here rather than us guessing a browser-like default.
   */
  headers?: Record<string, string>;
}

export interface DownloadedFile {
  filePath: string;
  sizeBytes: number;
  contentType: string;
}

export interface HttpDownloaderOptions {
  fetchImpl?: typeof fetch;
  hostGuard?: (hostname: string) => Promise<void>;
  maxRedirects?: number;
}

const DEFAULT_MAX_REDIRECTS = 5;

export class HttpDownloader {
  private readonly fetchImpl: typeof fetch;
  private readonly hostGuard: (hostname: string) => Promise<void>;
  private readonly maxRedirects: number;

  constructor(options: HttpDownloaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.hostGuard = options.hostGuard ?? assertHostIsSafe;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  }

  async download(request: DownloadRequest): Promise<DownloadedFile> {
    await mkdir(request.destDir, { recursive: true });

    const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;

    let currentUrl = request.url;
    let response: Response | undefined;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const parsed = safeParseUrl(currentUrl);
      this.assertHostAllowed(parsed.hostname, request.allowedHostSuffixes);
      await this.guardHost(parsed.hostname);

      let candidate: Response;
      try {
        candidate = await this.fetchImpl(currentUrl, {
          redirect: 'manual',
          signal,
          ...(request.headers ? { headers: request.headers } : {}),
        });
      } catch (error) {
        if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
          throw new DownloadError('Download timed out or was cancelled.', 'timeout');
        }
        throw new DownloadError(`Network error while downloading media.`, 'network');
      }

      if (candidate.status >= 300 && candidate.status < 400) {
        const location = candidate.headers.get('location');
        if (!location) {
          throw new DownloadError(
            'Redirect response missing Location header.',
            'http_error',
            candidate.status,
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      response = candidate;
      break;
    }

    if (!response) {
      throw new DownloadError('Too many redirects.', 'http_error');
    }
    if (!response.ok) {
      throw new DownloadError(
        `Upstream returned HTTP ${response.status}.`,
        'http_error',
        response.status,
      );
    }
    if (!response.body) {
      throw new DownloadError('Upstream response had no body.', 'network');
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > request.maxSizeBytes) {
      throw new DownloadError('Media exceeds the configured maximum size.', 'too_large');
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const destPath = path.join(request.destDir, `${randomUUID()}${extensionFor(contentType)}`);

    await this.streamToFile(response.body, destPath, request.maxSizeBytes);

    const { size } = await stat(destPath);
    return { filePath: destPath, sizeBytes: size, contentType };
  }

  private assertHostAllowed(hostname: string, allowedHostSuffixes: string[]): void {
    const host = hostname.toLowerCase();
    const allowed = allowedHostSuffixes.some(
      (suffix) => host === suffix.toLowerCase() || host.endsWith(`.${suffix.toLowerCase()}`),
    );
    if (!allowed) {
      throw new DownloadError(
        `Host "${hostname}" is not in the allowed list for this provider.`,
        'unsafe_host',
      );
    }
  }

  private async guardHost(hostname: string): Promise<void> {
    try {
      await this.hostGuard(hostname);
    } catch (error) {
      throw new DownloadError((error as Error).message, 'unsafe_host');
    }
  }

  private async streamToFile(
    body: ReadableStream<Uint8Array>,
    destPath: string,
    maxSizeBytes: number,
  ): Promise<void> {
    let bytesWritten = 0;
    const nodeReadable = Readable.fromWeb(body as never);
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > maxSizeBytes) {
          callback(new DownloadError('Media exceeds the configured maximum size.', 'too_large'));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(nodeReadable, limiter, createWriteStream(destPath));
    } catch (error) {
      await rm(destPath, { force: true });
      if (error instanceof DownloadError) throw error;
      throw new DownloadError(
        `Failed while streaming media to disk: ${(error as Error).message}`,
        'network',
      );
    }
  }
}

function safeParseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new DownloadError('Malformed media URL.', 'network');
  }
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'application/octet-stream': '.bin',
};

function extensionFor(contentType: string): string {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return CONTENT_TYPE_EXTENSIONS[normalized] ?? '.bin';
}
