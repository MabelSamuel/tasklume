import { appEvents } from '../lib/events';
import { cacheDel } from '../lib/cache';
import { logger, serializeError } from '../lib/logger';
import { ADMIN_EVENTS } from './admin.events';
import { PROJECT_EVENTS, TASK_EVENTS } from './task.events';

// Cache invalidation lives in one place, driven by domain events

async function bust(key: string) {
  try {
    await cacheDel(key);
    logger.debug('Cache busted', { key });
  } catch (error) {
    logger.error('Failed to bust cache', { key, error: serializeError(error) });
  }
}

// When a role changes, bust the permissions cache for that user
appEvents.on(ADMIN_EVENTS.ROLE_ASSIGNED, (data) => bust(`permissions:${data.targetUserId}`));
appEvents.on(ADMIN_EVENTS.ROLE_REVOKED, (data) => bust(`permissions:${data.targetUserId}`));

// When a task changes, bust it and the owner's insights
for (const event of [TASK_EVENTS.UPDATED, TASK_EVENTS.COMPLETED, TASK_EVENTS.ENRICHED, TASK_EVENTS.DELETED]) {
  appEvents.on(event, (data) => {
    void bust(`task:${data.taskId}`);
    if (data.userId) void bust(`insights:${data.userId}`);
  });
}
appEvents.on(TASK_EVENTS.CREATED, (data) => bust(`insights:${data.userId}`));

// The project list is cached for the capture/categorize prompts
for (const event of Object.values(PROJECT_EVENTS)) {
  appEvents.on(event, (data) => bust(`projects:${data.userId}`));
}
