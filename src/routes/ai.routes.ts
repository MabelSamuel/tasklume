import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { aiLimiter, writeLimiter } from '../middleware/rateLimiter';
import {
  acceptSuggestionSchema,
  assistantSchema,
  captureSchema,
  confirmDraftSchema,
  draftParamsSchema,
  generateDigestSchema,
  listDigestsSchema,
  listDraftsSchema,
  prioritizeSchema,
  suggestionParamsSchema,
} from '../validators/ai.validator';
import * as aiController from '../controllers/ai.controller';

// AI features. Each one has a non-AI fallback (rules parser, heuristic
// ranking, template digest), so these endpoints degrade instead of failing
// when the provider is down — except the assistant, which needs the model.

// ── /capture ─────────────────────────────────────────

const captureRouter = Router();
captureRouter.use(authenticate);

/**
 * @swagger
 * /capture:
 *   post:
 *     summary: Capture tasks from natural language
 *     description: >
 *       The AI extracts title, due date, priority, project and tags (one or more tasks)
 *       and returns drafts to confirm. With autoConfirm (or the autoConfirmCapture preference),
 *       confident parses with no ambiguities become tasks immediately.
 *       If the AI is unavailable a rules parser is used and the draft is flagged fallbackUsed.
 *     tags: [Capture]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [input]
 *             properties:
 *               input: { type: string, example: 'remind me to follow up with the vendor sometime next week' }
 *               autoConfirm: { type: boolean }
 *     responses:
 *       200:
 *         description: Drafts awaiting review
 *       201:
 *         description: All tasks created (auto-confirmed)
 */
captureRouter.post('/',
  aiLimiter,
  validate(captureSchema),
  requirePermission('tasks:create', 'ai:use'),
  aiController.capture
);

/**
 * @swagger
 * /capture/drafts:
 *   get:
 *     summary: List capture drafts (pending by default)
 *     tags: [Capture]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, confirmed, discarded] } }
 *     responses:
 *       200:
 *         description: Drafts
 */
captureRouter.get('/drafts',
  validate(listDraftsSchema),
  requirePermission('tasks:read'),
  aiController.listDrafts
);

/**
 * @swagger
 * /capture/drafts/{id}/confirm:
 *   post:
 *     summary: Confirm a draft, optionally correcting any field
 *     description: Send only the fields you changed. Corrections are recorded to measure parse accuracy.
 *     tags: [Capture]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               dueDate: { type: string, nullable: true, example: '2026-11-13' }
 *               priority: { type: string, enum: [low, medium, high, urgent] }
 *               projectId: { type: string, nullable: true }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Task created from the draft
 *       409:
 *         description: Draft already confirmed or discarded
 */
captureRouter.post('/drafts/:id/confirm',
  writeLimiter,
  validate(confirmDraftSchema),
  requirePermission('tasks:create'),
  aiController.confirmDraft
);

/**
 * @swagger
 * /capture/drafts/{id}:
 *   delete:
 *     summary: Discard a draft
 *     tags: [Capture]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Discarded
 */
captureRouter.delete('/drafts/:id',
  validate(draftParamsSchema),
  requirePermission('tasks:create'),
  aiController.discardDraft
);

// ── /priorities ──────────────────────────────────────

const priorityRouter = Router();
priorityRouter.use(authenticate);

/**
 * @swagger
 * /priorities/suggestions:
 *   post:
 *     summary: Generate a suggested order of work for open tasks
 *     description: >
 *       Heuristic urgency score, re-ranked by the AI against your goals and project weights.
 *       Nothing changes until you accept it. Falls back to the heuristic ranking without AI.
 *     tags: [Prioritization]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId: { type: string, description: 'Limit to one project' }
 *     responses:
 *       201:
 *         description: The suggestion (ranked items with reasons)
 */
priorityRouter.post('/suggestions',
  aiLimiter,
  validate(prioritizeSchema),
  requirePermission('tasks:read', 'ai:use'),
  aiController.suggestPriorities
);

/**
 * @swagger
 * /priorities/suggestions:
 *   get:
 *     summary: Recent priority suggestions
 *     tags: [Prioritization]
 *     responses:
 *       200:
 *         description: Suggestions, newest first
 */
priorityRouter.get('/suggestions',
  requirePermission('tasks:read'),
  aiController.listSuggestions
);

/**
 * @swagger
 * /priorities/suggestions/{id}:
 *   get:
 *     summary: One priority suggestion
 *     tags: [Prioritization]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: The suggestion
 */
priorityRouter.get('/suggestions/:id',
  validate(suggestionParamsSchema),
  requirePermission('tasks:read'),
  aiController.getSuggestion
);

/**
 * @swagger
 * /priorities/suggestions/{id}/accept:
 *   post:
 *     summary: Apply the suggested priorities (all, or only the taskIds given)
 *     description: Tasks whose priority you changed after the suggestion are skipped.
 *     tags: [Prioritization]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskIds: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Applied and skipped task ids
 */
priorityRouter.post('/suggestions/:id/accept',
  writeLimiter,
  validate(acceptSuggestionSchema),
  requirePermission('tasks:update'),
  aiController.acceptSuggestion
);

/**
 * @swagger
 * /priorities/suggestions/{id}/dismiss:
 *   post:
 *     summary: Dismiss a suggestion without changing anything
 *     tags: [Prioritization]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Dismissed
 */
priorityRouter.post('/suggestions/:id/dismiss',
  validate(suggestionParamsSchema),
  requirePermission('tasks:read'),
  aiController.dismissSuggestion
);

// ── /digests ─────────────────────────────────────────

const digestRouter = Router();
digestRouter.use(authenticate);

/**
 * @swagger
 * /digests:
 *   post:
 *     summary: Generate (or refresh) today's / this week's digest now
 *     description: Scheduled digests are generated automatically at your digestHour.
 *     tags: [Digests]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               period: { type: string, enum: [daily, weekly], default: daily }
 *     responses:
 *       201:
 *         description: The digest (summary, stats, highlighted tasks)
 */
digestRouter.post('/',
  aiLimiter,
  validate(generateDigestSchema),
  requirePermission('tasks:read', 'ai:use'),
  aiController.generateDigest
);

/**
 * @swagger
 * /digests/latest:
 *   get:
 *     summary: The most recent digest
 *     tags: [Digests]
 *     parameters:
 *       - { in: query, name: period, schema: { type: string, enum: [daily, weekly] } }
 *     responses:
 *       200:
 *         description: The digest
 *       404:
 *         description: No digest yet
 */
digestRouter.get('/latest',
  validate(listDigestsSchema),
  requirePermission('tasks:read'),
  aiController.getLatestDigest
);

/**
 * @swagger
 * /digests:
 *   get:
 *     summary: Digest history
 *     tags: [Digests]
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, default: 10 } }
 *     responses:
 *       200:
 *         description: Digests, newest first
 */
digestRouter.get('/',
  validate(listDigestsSchema),
  requirePermission('tasks:read'),
  aiController.listDigests
);

// ── /assistant ───────────────────────────────────────

const assistantRouter = Router();
assistantRouter.use(authenticate);

/**
 * @swagger
 * /assistant:
 *   post:
 *     summary: Ask the task assistant (tool-calling agent)
 *     description: >
 *       Can search tasks, list overdue/upcoming, summarize a timeframe, list projects,
 *       and capture new tasks as drafts. Returns 503 when no AI provider is configured.
 *     tags: [Assistant]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, example: 'What should I worry about this week?' }
 *               includeTrace: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Answer, referenced task ids, drafts created, confidence
 */
assistantRouter.post('/',
  aiLimiter,
  validate(assistantSchema),
  requirePermission('tasks:read', 'ai:use'),
  aiController.askAssistant
);

export {
  captureRouter as captureRoutes,
  priorityRouter as priorityRoutes,
  digestRouter as digestRoutes,
  assistantRouter as assistantRoutes,
};
