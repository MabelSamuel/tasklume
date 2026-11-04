import { Queue } from 'bullmq';
import { QUEUE_PREFIX, redisConnection } from './connection';

// Jobs that exhausted all retries land here for inspection / replay
export const deadLetterQueue = new Queue('dead-letter', {
  connection: redisConnection,
  prefix: QUEUE_PREFIX,
});
