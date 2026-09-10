#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, ConfigError } from '../config/index.js';
import { createLogger } from '../observability/logger.js';
import { buildServer } from './server-factory.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`moreel: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config);

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    process.exit(1);
  });

  const server = buildServer({ config, logger });
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info(
    { transcriptionProvider: config.transcriptionProvider },
    'moreel MCP server started on stdio',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  process.stderr.write(`moreel: fatal error during startup: ${(error as Error).message}\n`);
  process.exit(1);
});
