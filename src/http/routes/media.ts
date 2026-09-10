import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { MediaStore } from '../../media/media-store.js';

/**
 * Serves the video Moreel already downloaded to produce a transcript, for
 * the short window `MediaStore` keeps it around. Supports `Range` requests
 * because browsers require them for `<video>` scrubbing/seeking — without
 * it, playback works but seeking silently fails.
 */
export function registerMediaRoute(app: FastifyInstance, mediaStore: MediaStore): void {
  app.get('/media/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = mediaStore.get(id);

    if (!entry) {
      reply.code(404);
      return {
        error: {
          code: 'NOT_FOUND',
          message: 'This video is no longer available for playback.',
          retryable: false,
        },
      };
    }

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', entry.contentType);
    // Never cached by intermediaries — this URL stops working once the
    // entry's short TTL expires, so a shared/proxy cache holding onto it
    // would be actively wrong.
    reply.header('Cache-Control', 'private, no-store');

    const range = request.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match?.[2] ? Number.parseInt(match[2], 10) : entry.sizeBytes - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= entry.sizeBytes) {
        reply.code(416);
        reply.header('Content-Range', `bytes */${entry.sizeBytes}`);
        return reply.send();
      }

      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${entry.sizeBytes}`);
      reply.header('Content-Length', end - start + 1);
      return reply.send(createReadStream(entry.filePath, { start, end }));
    }

    reply.header('Content-Length', entry.sizeBytes);
    return reply.send(createReadStream(entry.filePath));
  });
}
