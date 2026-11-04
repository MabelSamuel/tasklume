import { Worker } from 'bullmq';
import { QUEUE_PREFIX, redisConnection } from './connection';
import { deadLetterQueue } from './dead-letter.queue';
import { DIGEST_QUEUE_NAME, DigestJobData } from './digest.queue';
import { fanOutDigests } from '../jobs/digest-fan-out.job';
import { logger, serializeError } from '../lib/logger';
import { activeQueueJobs } from '../lib/metrics';
import { generateDigest } from '../services/digest.service';

export const digestWorker = new Worker<DigestJobData>(
  DIGEST_QUEUE_NAME,
  async (job) => {
    if (job.data.kind === 'fan-out') {
      await fanOutDigests();
      return;
    }

    const digest = await generateDigest({
      userId: job.data.userId,
      period: job.data.period,
      trigger: 'scheduled',
      correlationId: `job-${job.id}`,
    });
    return { digestId: digest?.id ?? null };
  },
  // Digests are AI calls; keep concurrency modest so the hour's batch doesn't trip the breaker
  { connection: redisConnection, prefix: QUEUE_PREFIX, concurrency: 2 },
);

digestWorker.on('active', () => activeQueueJobs.inc({ queue: DIGEST_QUEUE_NAME }));
digestWorker.on('completed', () => activeQueueJobs.dec({ queue: DIGEST_QUEUE_NAME }));

digestWorker.on('failed', async (job, error) => {
  activeQueueJobs.dec({ queue: DIGEST_QUEUE_NAME });
  logger.error('Digest job failed', { jobId: job?.id, kind: job?.data.kind, error: serializeError(error) });

  if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await deadLetterQueue.add('failed-digest', {
      originalJobId: job.id,
      originalQueue: DIGEST_QUEUE_NAME,
      data: job.data,
      error: error.message,
      failedAt: new Date().toISOString(),
      attempts: job.attemptsMade,
    });
  }
});

digestWorker.on('error', (error) => {
  logger.error('Worker error', { queue: DIGEST_QUEUE_NAME, error: serializeError(error) });
});
