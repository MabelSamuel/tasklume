import './lib/config'; // Load and validate env vars first
import { config } from './config';
import { logger, serializeError } from './lib/logger';
import { prisma } from './lib/prisma';
import { cacheRedis } from './lib/cache';
import { redisConnection } from './queues/connection';

// Workers emit domain events, so their listeners must live in this process too
import './events/task.events';
import './events/ai.events';
import './events/cache.events';

import { taskEnrichmentWorker } from './queues/task-enrichment.worker';
import { digestWorker } from './queues/digest.worker';
import { digestQueue, scheduleDigestFanOut } from './queues/digest.queue';

// Add new workers here
const workers = [taskEnrichmentWorker, digestWorker];

logger.info('Worker started', {
  event: 'worker:started',
  queues: workers.map(w => w.name),
});

if (config.digests.enabled) {
  scheduleDigestFanOut().catch((error) => {
    logger.error('Failed to schedule digest fan-out', { error: serializeError(error) });
  });
} else {
  digestQueue.removeJobScheduler('digest-fan-out').catch(() => undefined);
}

// === GRACEFUL SHUTDOWN ===
// Let in-flight jobs finish before exiting, so they aren't left half-processed
async function shutdown(signal: string) {
  logger.info('Worker stopping', { event: 'worker:stopping', signal });
  await Promise.all(workers.map(w => w.close()));
  await digestQueue.close();
  await Promise.allSettled([
    redisConnection.quit(),
    cacheRedis.quit(),
    prisma.$disconnect(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
