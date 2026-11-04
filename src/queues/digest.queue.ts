import { Queue } from 'bullmq';
import { QUEUE_PREFIX, redisConnection } from './connection';

export const DIGEST_QUEUE_NAME = 'digests';

export type DigestJobData =
  | { kind: 'fan-out' }
  | { kind: 'generate'; userId: string; period: 'daily' | 'weekly'; periodKey: string };

export const digestQueue = new Queue<DigestJobData>(DIGEST_QUEUE_NAME, {
  connection: redisConnection,
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

// Idempotent: same scheduler id on every boot never duplicates the repeat job.
// Hourly, because each user's digest hour is in their own timezone.
export async function scheduleDigestFanOut() {
  await digestQueue.upsertJobScheduler(
    'digest-fan-out',
    { pattern: '5 * * * *' }, // Five past every hour
    { name: 'digest-fan-out', data: { kind: 'fan-out' } },
  );
}

// jobId dedupes: a user's digest for one period is queued at most once,
// even if the fan-out runs twice in the same hour
export async function queueDigest(userId: string, period: 'daily' | 'weekly', periodKey: string) {
  await digestQueue.add(
    'generate-digest',
    { kind: 'generate', userId, period, periodKey },
    { jobId: `digest-${userId}-${period}-${periodKey}` },
  );
}
