import { config } from '../config';
import { isValidTimezone, isoWeekKey, localDateKey, zonedParts } from '../lib/dates';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { queueDigest } from '../queues/digest.queue';

const BATCH_SIZE = 500;

// Defaults for users who never opened their preferences (no row yet)
const DEFAULTS = { timezone: 'UTC', dailyDigest: true, weeklyDigest: true, digestHour: 8, weeklyDigestDay: 1 };

// Runs hourly. Queues a digest for every user whose local clock just reached
// their digest hour. queueDigest dedupes by jobId, so re-runs are harmless.
export async function fanOutDigests(now = new Date()) {
  let cursor: string | undefined;
  let daily = 0;
  let weekly = 0;

  for (;;) {
    const users = await prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, preferences: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
    if (users.length === 0) break;

    for (const user of users) {
      const prefs = user.preferences ?? DEFAULTS;
      const timezone = isValidTimezone(prefs.timezone) ? prefs.timezone : 'UTC';
      const local = zonedParts(now, timezone);
      if (local.hour !== prefs.digestHour) continue;

      if (prefs.dailyDigest) {
        await queueDigest(user.id, 'daily', localDateKey(now, timezone));
        daily++;
      }
      if (prefs.weeklyDigest && local.weekday === prefs.weeklyDigestDay) {
        await queueDigest(user.id, 'weekly', isoWeekKey(now, timezone));
        weekly++;
      }
    }

    cursor = users[users.length - 1]!.id;
    if (users.length < BATCH_SIZE) break;
  }

  // Housekeeping: capture drafts nobody reviewed expire
  const expired = await prisma.taskDraft.updateMany({
    where: {
      status: 'pending',
      createdAt: { lt: new Date(now.getTime() - config.capture.draftTtlDays * 86_400_000) },
    },
    data: { status: 'discarded', resolvedAt: now },
  });

  logger.info('Digest fan-out complete', {
    event: 'digest:fan-out',
    dailyQueued: daily,
    weeklyQueued: weekly,
    draftsExpired: expired.count,
  });
}
