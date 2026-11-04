import { Worker, Job } from 'bullmq';
import { QUEUE_PREFIX, redisConnection } from './connection';
import { deadLetterQueue } from './dead-letter.queue';
import { TASK_ENRICHMENT_QUEUE_NAME, TaskEnrichmentJobData } from './task-enrichment.queue';
import { AI_ENABLED } from '../config/ai-models';
import { TASK_EVENTS } from '../events/task.events';
import { appEvents } from '../lib/events';
import { logger, serializeError } from '../lib/logger';
import { activeQueueJobs, taskEnrichmentDuration, tasksEnriched } from '../lib/metrics';
import { prisma } from '../lib/prisma';
import { taskRepository } from '../repositories/task.repository';
import { categorizeTask } from '../services/categorize.service';
import { generateEmbedding, taskEmbeddingText } from '../services/embedding.service';

// Enrichment = categorize (if the task has no project) + embed for search.
// Both are best-effort extras: a task is fully usable before and without them.
const worker = new Worker<TaskEnrichmentJobData>(
  TASK_ENRICHMENT_QUEUE_NAME,
  async (job: Job<TaskEnrichmentJobData>) => {
    const { taskId, userId, categorize, correlationId } = job.data;
    const startTime = Date.now();
    const jobCorrelationId = correlationId ?? `job-${job.id}`;

    const task = await taskRepository.findById(taskId);
    if (!task || task.deletedAt) {
      logger.info('Task gone before enrichment, skipping', { correlationId, taskId });
      return { skipped: true };
    }

    // Without an AI key there's nothing to do; say so instead of failing 3 times
    if (!AI_ENABLED) {
      await prisma.task.update({
        where: { id: taskId },
        data: { enrichmentStatus: 'skipped', enrichmentError: 'AI not configured' },
      });
      return { skipped: true };
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { enrichmentStatus: 'processing', enrichmentError: null },
    });

    try {
      // Step 1: Categorize first, so the embedding text includes the project
      let categorized = null;
      if (categorize && !task.projectId) {
        categorized = await categorizeTask({ task, correlationId: jobCorrelationId });
      }
      await job.updateProgress(40);

      // Step 2: Embed (idempotent: re-running overwrites the same vector)
      const fresh = categorized ? await taskRepository.findById(taskId) : task;
      const embedding = await generateEmbedding(taskEmbeddingText(fresh ?? task), { userId, taskId });
      await taskRepository.storeEmbedding(taskId, embedding);
      await job.updateProgress(90);

      await prisma.task.update({
        where: { id: taskId },
        data: { enrichmentStatus: 'ready' },
      });
      await job.updateProgress(100);

      const durationMs = Date.now() - startTime;
      taskEnrichmentDuration.observe(durationMs / 1000);
      tasksEnriched.inc({ status: 'success' });

      appEvents.emit(TASK_EVENTS.ENRICHED, {
        taskId,
        userId,
        correlationId,
        categorizedTo: categorized?.projectId ?? null,
        durationMs,
      });

      logger.info('Task enrichment complete', { correlationId, taskId, durationMs });
      return { success: true, durationMs, categorizedTo: categorized?.projectId ?? null };
    } catch (error) {
      // Only mark as failed on the LAST attempt
      if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
        await prisma.task.update({
          where: { id: taskId },
          data: { enrichmentStatus: 'failed', enrichmentError: (error as Error).message },
        });
        tasksEnriched.inc({ status: 'failed' });
      }
      logger.error('Task enrichment failed', {
        correlationId,
        taskId,
        error: (error as Error).message,
        attempt: job.attemptsMade + 1,
      });
      throw error; // Re-throw so BullMQ retries
    }
  },
  {
    connection: redisConnection,
    prefix: QUEUE_PREFIX,
    concurrency: 3,
  },
);

worker.on('active', () => {
  activeQueueJobs.inc({ queue: TASK_ENRICHMENT_QUEUE_NAME });
});

worker.on('completed', () => {
  activeQueueJobs.dec({ queue: TASK_ENRICHMENT_QUEUE_NAME });
});

worker.on('failed', async (job, error) => {
  if (!job) return;
  activeQueueJobs.dec({ queue: TASK_ENRICHMENT_QUEUE_NAME });

  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    logger.error('Job permanently failed, moving to DLQ', {
      jobId: job.id,
      taskId: job.data.taskId,
      userId: job.data.userId,
      attempts: job.attemptsMade,
      error: serializeError(error),
    });

    await deadLetterQueue.add('failed-task-enrichment', {
      originalJobId: job.id,
      originalQueue: TASK_ENRICHMENT_QUEUE_NAME,
      data: job.data,
      error: error.message,
      failedAt: new Date().toISOString(),
      attempts: job.attemptsMade,
    });
  }
});

worker.on('error', (error) => {
  logger.error('Worker error', {
    queue: TASK_ENRICHMENT_QUEUE_NAME,
    error: serializeError(error),
  });
});

export { worker as taskEnrichmentWorker };
