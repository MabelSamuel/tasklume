import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { writeLimiter } from '../middleware/rateLimiter';
import {
  createProjectSchema,
  listProjectsSchema,
  projectParamsSchema,
  updateProjectSchema,
} from '../validators/project.validator';
import * as projectController from '../controllers/project.controller';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /projects:
 *   get:
 *     summary: List the caller's projects with open-task counts
 *     tags: [Projects]
 *     parameters:
 *       - { in: query, name: includeArchived, schema: { type: boolean, default: false } }
 *     responses:
 *       200:
 *         description: Projects
 */
router.get('/',
  validate(listProjectsSchema),
  requirePermission('projects:read'),
  projectController.listProjects
);

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Create a project (category) that capture and auto-categorization can file tasks into
 *     tags: [Projects]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: 'Client: Acme' }
 *               description: { type: string, example: 'Deliverables, invoices and calls for Acme' }
 *               color: { type: string, example: '#3b82f6' }
 *     responses:
 *       201:
 *         description: Project created
 *       409:
 *         description: Name already used
 */
router.post('/',
  writeLimiter,
  validate(createProjectSchema),
  requirePermission('projects:create'),
  projectController.createProject
);

/**
 * @swagger
 * /projects/{id}:
 *   patch:
 *     summary: Rename, describe, recolour or archive a project
 *     tags: [Projects]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated project
 */
router.patch('/:id',
  writeLimiter,
  validate(updateProjectSchema),
  requirePermission('projects:update'),
  projectController.updateProject
);

/**
 * @swagger
 * /projects/{id}:
 *   delete:
 *     summary: Soft-delete a project (its tasks are kept, unassigned)
 *     tags: [Projects]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/:id',
  validate(projectParamsSchema),
  requirePermission('projects:delete'),
  projectController.deleteProject
);

export { router as projectRoutes };
