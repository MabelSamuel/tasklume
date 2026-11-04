import { Queue } from 'bullmq';
import { QUEUE_PREFIX, redisConnection } from './connection';

export const TASK_ENRICHMENT_QUEUE_NAME = 'task-enrichment';

export interface TaskEnrichmentJobData {
  taskId: string;
  userId: string;
  // Only auto-categorize tasks the user didn't file themselves
  categorize: boolean;
  correlationId?: string | undefined;
  queuedAt: number;
}

export const taskEnrichmentQueue = new Queue<TaskEnrichmentJobData>(TASK_ENRICHMENT_QUEUE_NAME, {
  connection: redisConnection,
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export async function queueTaskEnrichment(
  taskId: string,
  userId: string,
  options: { categorize: boolean; correlationId?: string | undefined },
) {
  const job = await taskEnrichmentQueue.add(
    'enrich-task',
    { taskId, userId, categorize: options.categorize, correlationId: options.correlationId, queuedAt: Date.now() },
  );
  return job.id;
}
