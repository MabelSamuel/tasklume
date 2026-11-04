import { app } from './app';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { cacheRedis } from './lib/cache';
import { redisConnection } from './queues/connection';

const server = app.listen(config.PORT, () => {
  logger.info('Server started', {
    event: 'server:started',
    port: config.PORT,
    environment: config.NODE_ENV,
  });
});

// === GRACEFUL SHUTDOWN ===
// Stop accepting connections, let in-flight requests finish, then close pools
async function shutdown(signal: string) {
  logger.info('Server stopping', { event: 'server:stopping', signal });

  server.close(async () => {
    await Promise.allSettled([
      prisma.$disconnect(),
      cacheRedis.quit(),
      redisConnection.quit(),
    ]);
    process.exit(0);
  });

  // Force exit if connections refuse to drain
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
