import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger, serializeError } from '../lib/logger';

export const TASK_EVENTS = {
  CREATED: 'task:created',
  UPDATED: 'task:updated',
  COMPLETED: 'task:completed',
  ENRICHED: 'task:enriched',
  DELETED: 'task:deleted',
} as const;

export const PROJECT_EVENTS = {
  CREATED: 'project:created',
  UPDATED: 'project:updated',
  DELETED: 'project:deleted',
} as const;

export async function logUsage(userId: string, action: string, metadata: object) {
  try {
    await prisma.usageLog.create({
      data: { userId, action, metadata: JSON.stringify(metadata) },
    });
  } catch (error) {
    logger.error('Failed to write usage log', {
      userId,
      action,
      error: serializeError(error),
    });
  }
}

appEvents.on(TASK_EVENTS.CREATED, (data) =>
  logUsage(data.userId, 'task_created', {
    taskId: data.taskId,
    source: data.source,
  }));

// Completion timing feeds the on-time completion KPI (insights.service)
appEvents.on(TASK_EVENTS.COMPLETED, (data) =>
  logUsage(data.userId, 'task_completed', {
    taskId: data.taskId,
    dueDate: data.dueDate,
    onTime: data.onTime,
  }));

appEvents.on(TASK_EVENTS.DELETED, (data) =>
  logUsage(data.deletedBy, 'task_deleted', {
    taskId: data.taskId,
    deletedAt: new Date().toISOString(),
  }));

appEvents.on(PROJECT_EVENTS.CREATED, (data) =>
  logUsage(data.userId, 'project_created', { projectId: data.projectId }));

appEvents.on(PROJECT_EVENTS.DELETED, (data) =>
  logUsage(data.deletedBy, 'project_deleted', { projectId: data.projectId }));
