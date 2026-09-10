import closeWithGrace from 'close-with-grace';
import type { Logger } from 'pino';
import type { HttpServer } from './server.js';

export interface RegisterShutdownOptions {
  server: HttpServer;
  logger: Logger;
  shutdownTimeoutMs: number;
  /** Extra cleanup beyond closing the HTTP listener (e.g. flushing metrics). */
  onShutdown?: () => Promise<void>;
}

/**
 * Wires SIGTERM/SIGINT to a bounded graceful drain:
 *   1. mark the app draining so `/ready` starts failing (load balancers stop
 *      routing new traffic here)
 *   2. stop accepting new HTTP connections and let in-flight ones finish
 *   3. run any extra cleanup (temp files are already cleaned per-request via
 *      `withRequestWorkspace`, so nothing global is required today)
 *   4. force-exit if draining exceeds the configured timeout, so a stuck
 *      request can never block a rolling deploy indefinitely
 */
export function registerGracefulShutdown(
  options: RegisterShutdownOptions,
): ReturnType<typeof closeWithGrace> {
  const { server, logger, shutdownTimeoutMs, onShutdown } = options;

  return closeWithGrace(
    { delay: shutdownTimeoutMs, logger: false },
    async ({ signal, err }: { signal?: string; err?: Error }) => {
      if (err) {
        logger.error({ err }, 'shutdown triggered by error');
      } else {
        logger.info({ signal }, 'graceful shutdown starting');
      }

      server.lifecycle.markDraining();

      try {
        await server.app.close();
        await onShutdown?.();
        logger.info('graceful shutdown complete');
      } catch (closeError) {
        logger.error({ err: closeError }, 'error during graceful shutdown');
      }
    },
  );
}
