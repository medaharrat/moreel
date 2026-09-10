import { Redis } from 'ioredis';

export interface RedisClientOptions {
  url: string;
}

/**
 * One shared connection per process. `ioredis` handles reconnect/backoff
 * internally; we don't add another retry layer on top. `lazyConnect` off
 * (default) so a bad `REDIS_URL` fails fast at startup rather than on the
 * first request.
 */
export function createRedisClient(options: RedisClientOptions): Redis {
  return new Redis(options.url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
}

export async function pingRedis(client: Redis): Promise<boolean> {
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
