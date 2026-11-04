import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { TASK_EVENTS } from '../events/task.events';
import { cacheGetOrSet, CACHE_TTL } from '../lib/cache';
import { isLocalDueString, parseLocalDue } from '../lib/dates';
import { NotFoundError, ValidationError } from '../lib/errors';
import { appEvents } from '../lib/events';
import { logger } from '../lib/logger';
import { queueTaskEnrichment } from '../queues/task-enrichment.queue';
import { taskRepository, TaskListFilter } from '../repositories/task.repository';
import { getPreferences } from './preferences.service';
import { findOwnedProject } from './project.service';
import { hasPermission } from './rbac.service';

// Business rules for tasks: ownership, provenance, queueing and events.

export type TaskSortField = 'dueDate' | 'priority' | 'createdAt' | 'updatedAt';

export interface ListTasksOptions {
  page: number;
  limit: number;
  status?: TaskStatus | 'open' | undefined;
  priority?: TaskPriority | undefined;
  projectId?: string | undefined;
  tag?: string | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
  overdue?: boolean | undefined;
  search?: string | undefined;
  sortBy?: TaskSortField;
  sortOrder?: 'asc' | 'desc';
}

function orderFor(sortBy: TaskSortField, sortOrder: 'asc' | 'desc'): Prisma.TaskOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'dueDate':
      // Undated tasks go last whichever way you sort
      return [{ dueDate: { sort: sortOrder, nulls: 'last' } }, { createdAt: 'asc' }];
    case 'priority':
      // Enum order is low < medium < high < urgent; break ties by deadline
      return [{ priority: sortOrder }, { dueDate: { sort: 'asc', nulls: 'last' } }];
    default:
      return [{ [sortBy]: sortOrder }];
  }
}

// Accepts an absolute ISO timestamp, or a local 'YYYY-MM-DD[THH:mm]' that is
// read in the user's timezone (a bare date = end of that day)
export function resolveDueDate(value: string, timeZone: string): Date {
  const date = isLocalDueString(value) ? parseLocalDue(value, timeZone) : new Date(value);
  if (!date || Number.isNaN(date.getTime())) {
    throw new ValidationError('Invalid due date', [{ field: 'dueDate', message: 'Invalid date' }]);
  }
  return date;
}

export async function listTasks(userId: string, options: ListTasksOptions) {
  const { page, limit, sortBy = 'dueDate', sortOrder = 'asc' } = options;
  const { timezone } = await getPreferences(userId);

  const filter: TaskListFilter = {
    userId,
    status: options.status,
    priority: options.priority,
    projectId: options.projectId,
    tag: options.tag,
    search: options.search,
    dueBefore: options.dueBefore ? resolveDueDate(options.dueBefore, timezone) : undefined,
    dueAfter: options.dueAfter ? resolveDueDate(options.dueAfter, timezone) : undefined,
    overdueAt: options.overdue ? new Date() : undefined,
  };

  const { tasks, total } = await taskRepository.list(
    filter,
    { skip: (page - 1) * limit, take: limit },
    orderFor(sortBy, sortOrder),
  );

  return {
    data: tasks,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Load a task the user is allowed to see, or throw 404.
// 404 (not 403) for other users' tasks so IDs can't be probed.
export async function findAccessibleTask(taskId: string, userId: string) {
  const task = await cacheGetOrSet(
    `task:${taskId}`,
    CACHE_TTL.TASK,
    () => taskRepository.findById(taskId),
  );

  if (!task || task.deletedAt) {
    throw new NotFoundError('Task not found');
  }

  if (task.userId !== userId && !(await hasPermission(userId, 'tasks:manage'))) {
    throw new NotFoundError('Task not found');
  }

  return task;
}

export async function getTask(taskId: string, userId: string) {
  return findAccessibleTask(taskId, userId);
}

export interface CreateTaskInput {
  userId: string;
  title: string;
  description?: string | null | undefined;
  dueDate?: Date | null | undefined;
  priority?: TaskPriority | undefined;
  projectId?: string | null | undefined;
  tags?: string[] | undefined;
  source?: 'manual' | 'capture' | 'assistant';
  // Who chose the priority/project: capture marks fields the user didn't touch as 'ai'
  prioritySetBy?: 'user' | 'ai';
  projectSetBy?: 'user' | 'ai';
  correlationId?: string | undefined;
}

// Shared by manual creation and confirmed capture drafts
export async function createTaskRecord(input: CreateTaskInput) {
  if (input.projectId) await findOwnedProject(input.projectId, input.userId);

  const task = await taskRepository.create({
    userId: input.userId,
    title: input.title,
    description: input.description ?? null,
    dueDate: input.dueDate ?? null,
    priority: input.priority ?? 'medium',
    projectId: input.projectId ?? null,
    projectSetBy: input.projectId ? (input.projectSetBy ?? 'user') : null,
    prioritySetBy: input.prioritySetBy ?? 'user',
    tags: input.tags ?? [],
    source: input.source ?? 'manual',
    enrichmentStatus: 'pending',
  });

  // Embedding (search) and auto-categorization (only if no project yet) run
  // in the worker, so a slow or down AI never blocks creating a task
  await queueTaskEnrichment(task.id, input.userId, {
    categorize: !task.projectId,
    correlationId: input.correlationId,
  });

  appEvents.emit(TASK_EVENTS.CREATED, {
    userId: input.userId,
    taskId: task.id,
    source: task.source,
  });

  return task;
}

export async function createTask(data: {
  userId: string;
  title: string;
  description?: string | undefined;
  dueDate?: string | undefined;
  priority?: TaskPriority | undefined;
  projectId?: string | undefined;
  tags?: string[] | undefined;
  correlationId?: string | undefined;
}) {
  logger.info('Creating task', { correlationId: data.correlationId, userId: data.userId });
  const { timezone } = await getPreferences(data.userId);

  return createTaskRecord({
    ...data,
    dueDate: data.dueDate ? resolveDueDate(data.dueDate, timezone) : null,
    source: 'manual',
  });
}

export async function updateTask(
  taskId: string,
  userId: string,
  data: {
    title?: string | undefined;
    description?: string | null | undefined;
    dueDate?: string | null | undefined;
    priority?: TaskPriority | undefined;
    projectId?: string | null | undefined;
    tags?: string[] | undefined;
    status?: TaskStatus | undefined;
  },
) {
  const task = await findAccessibleTask(taskId, userId);
  if (data.projectId) await findOwnedProject(data.projectId, task.userId);

  const { timezone } = await getPreferences(task.userId);
  const statusChange = data.status !== undefined && data.status !== task.status;

  const updated = await taskRepository.updateById(taskId, {
    ...(data.title !== undefined && { title: data.title }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.tags !== undefined && { tags: data.tags }),
    ...(data.dueDate !== undefined && {
      dueDate: data.dueDate === null ? null : resolveDueDate(data.dueDate, timezone),
    }),
    // A user edit always wins over (and replaces) an AI decision
    ...(data.priority !== undefined && { priority: data.priority, prioritySetBy: 'user' }),
    ...(data.projectId !== undefined && {
      projectId: data.projectId,
      projectSetBy: data.projectId ? 'user' : null,
    }),
    ...(statusChange && data.status && {
      status: data.status,
      completedAt: data.status === 'done' ? new Date() : null,
    }),
  });

  // Search text changed: re-embed (no re-categorize; the user is editing it now)
  if (data.title !== undefined || data.description !== undefined || data.projectId !== undefined) {
    await queueTaskEnrichment(taskId, task.userId, { categorize: false });
  }

  appEvents.emit(TASK_EVENTS.UPDATED, { taskId, userId: task.userId });

  if (statusChange && data.status === 'done') {
    appEvents.emit(TASK_EVENTS.COMPLETED, {
      taskId,
      userId: task.userId,
      dueDate: updated.dueDate?.toISOString() ?? null,
      onTime: updated.dueDate ? updated.completedAt! <= updated.dueDate : null,
    });
  }

  return updated;
}

export async function deleteTask(taskId: string, userId: string) {
  const task = await findAccessibleTask(taskId, userId);
  await taskRepository.softDelete(taskId, userId);

  appEvents.emit(TASK_EVENTS.DELETED, {
    deletedBy: userId,
    userId: task.userId,
    taskId: task.id,
  });
}
