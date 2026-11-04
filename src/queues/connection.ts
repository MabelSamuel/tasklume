import IORedis from 'ioredis';
import { config } from '../lib/config';

// BullMQ needs its own connection (blocking commands, no key prefix)
export const redisConnection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Namespaces queue keys ('tasklume:dead-letter:...') so TaskLume can share a
// Redis with other apps (e.g. DocuChat) whose queues use the same names.
// Every Queue AND Worker must pass this, or they won't see each other's jobs.
export const QUEUE_PREFIX = 'tasklume';
