import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { MoreelConfig } from '../config/index.js';

/**
 * Structured logger. MCP over stdio reserves stdout for protocol frames, so
 * every log line MUST go to stderr — never stdout.
 */
export function createLogger(config: Pick<MoreelConfig, 'logLevel'>): pino.Logger {
  return pino(
    {
      level: config.logLevel,
      base: { service: 'moreel' },
      redact: {
        paths: ['*.apiKey', '*.api_key', '*.authorization', '*.cookie', '*.password'],
        censor: '[REDACTED]',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ fd: 2 }),
  );
}

export function newRequestId(): string {
  return randomUUID();
}
