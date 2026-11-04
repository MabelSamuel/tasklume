import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { conditionalGet } from '../middleware/etag';
import { aiLimiter, writeLimiter } from '../middleware/rateLimiter';
import { trackResourceAccess } from '../middleware/abuseDetection';
import {
  createTaskSchema,
  listTasksSchema,
  searchTasksSchema,
  taskParamsSchema,
  updateTaskSchema,
} from '../validators/task.validator';
import * as taskController from '../controllers/task.controller';

// Manual task management. Works fully without the AI: this is the fallback
// path the product brief requires when the AI is down.
//   [rate limit] -> validate -> requirePermission -> [cache/etag] -> controller

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /tasks:
 *   get:
 *     summary: List the caller's tasks
 *     tags: [Tasks]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: status, schema: { type: string, enum: [todo, in_progress, done, cancelled, open] } }
 *       - { in: query, name: priority, schema: { type: string, enum: [low, medium, high, urgent] } }
 *       - { in: query, name: projectId, schema: { type: string } }
 *       - { in: query, name: tag, schema: { type: string } }
 *       - { in: query, name: dueBefore, schema: { type: string }, description: 'ISO timestamp or local YYYY-MM-DD' }
 *       - { in: query, name: dueAfter, schema: { type: string } }
 *       - { in: query, name: overdue, schema: { type: boolean } }
 *       - { in: query, name: search, schema: { type: string }, description: 'Keyword match on title/description' }
 *       - { in: query, name: sortBy, schema: { type: string, enum: [dueDate, priority, createdAt, updatedAt] } }
 *       - { in: query, name: sortOrder, schema: { type: string, enum: [asc, desc] } }
 *     responses:
 *       200:
 *         description: Paginated tasks
 */
router.get('/',
  validate(listTasksSchema),
  requirePermission('tasks:read'),
  conditionalGet(),
  taskController.listTasks
);

/**
 * @swagger
 * /tasks/search:
 *   get:
 *     summary: Semantic search — find tasks by describing them
 *     description: Falls back to keyword search when embeddings are unavailable (meta.mode tells you which ran).
 *     tags: [Tasks]
 *     parameters:
 *       - { in: query, name: q, required: true, schema: { type: string }, example: 'the vendor follow-up' }
 *       - { in: query, name: limit, schema: { type: integer, default: 10 } }
 *       - { in: query, name: includeDone, schema: { type: boolean, default: false } }
 *     responses:
 *       200:
 *         description: Matching tasks with similarity scores
 */
router.get('/search',
  aiLimiter,
  validate(searchTasksSchema),
  requirePermission('tasks:read'),
  taskController.searchTasks
);

/**
 * @swagger
 * /tasks:
 *   post:
 *     summary: Create a task manually (structured fields)
 *     description: Without a projectId, the worker may auto-categorize it (projectSetBy = ai).
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               dueDate: { type: string, example: '2026-11-09' }
 *               priority: { type: string, enum: [low, medium, high, urgent] }
 *               projectId: { type: string }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Task created; enrichment queued
 */
router.post('/',
  writeLimiter,
  validate(createTaskSchema),
  requirePermission('tasks:create'),
  taskController.createTask
);

/**
 * @swagger
 * /tasks/{id}:
 *   get:
 *     summary: Get one task
 *     tags: [Tasks]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: The task
 *       404:
 *         description: Not found
 */
router.get('/:id',
  validate(taskParamsSchema),
  requirePermission('tasks:read'),
  trackResourceAccess('tasks'),
  conditionalGet(),
  taskController.getTask
);

/**
 * @swagger
 * /tasks/{id}:
 *   patch:
 *     summary: Update a task (including status; done sets completedAt)
 *     description: Changing priority or project marks it as set by the user, overriding any AI choice.
 *     tags: [Tasks]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated task
 */
router.patch('/:id',
  writeLimiter,
  validate(updateTaskSchema),
  requirePermission('tasks:update'),
  taskController.updateTask
);

/**
 * @swagger
 * /tasks/{id}:
 *   delete:
 *     summary: Soft-delete a task
 *     tags: [Tasks]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/:id',
  validate(taskParamsSchema),
  requirePermission('tasks:delete'),
  taskController.deleteTask
);

export { router as taskRoutes };
