import { z } from 'zod';

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

// Absolute ISO timestamp, or local 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm' read in
// the user's timezone (a bare date means end of that day)
export const dueDateInput = z.string().refine(
  v => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v) || !Number.isNaN(Date.parse(v)),
  'Use an ISO timestamp, YYYY-MM-DD or YYYY-MM-DDTHH:mm',
);

const tags = z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10);

export const taskParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid task ID'),
  }),
});

export const createTaskSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z.string().max(5000).optional(),
    dueDate: dueDateInput.optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    projectId: z.string().min(1).optional(),
    tags: tags.optional(),
  }),
});

export const updateTaskSchema = z.object({
  params: taskParamsSchema.shape.params,
  body: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    dueDate: dueDateInput.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    projectId: z.string().min(1).nullable().optional(),
    tags: tags.optional(),
    status: z.enum(TASK_STATUSES).optional(),
  }).refine(b => Object.keys(b).length > 0, 'Provide at least one field to update'),
});

export const listTasksSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum([...TASK_STATUSES, 'open']).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    projectId: z.string().min(1).optional(),
    tag: z.string().max(30).optional(),
    dueBefore: dueDateInput.optional(),
    dueAfter: dueDateInput.optional(),
    overdue: z.stringbool().optional(),
    search: z.string().max(200).optional(),
    sortBy: z.enum(['dueDate', 'priority', 'createdAt', 'updatedAt']).default('dueDate'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  }),
});

export const searchTasksSchema = z.object({
  query: z.object({
    q: z.string().trim().min(2, 'Query must be at least 2 characters').max(300),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    includeDone: z.stringbool().default(false),
  }),
});
