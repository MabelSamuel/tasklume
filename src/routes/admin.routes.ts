import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { assignRoleSchema, revokeRoleSchema } from '../validators/admin.validator';
import { insightsSchema } from '../validators/ai.validator';
import * as adminController from '../controllers/admin.controller';

const router = Router();
router.use(authenticate);
router.use(requirePermission('roles:manage'));

/**
 * @swagger
 * /admin/roles:
 *   get:
 *     summary: List all roles with their permissions
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Roles
 */
router.get('/roles', adminController.listRoles);

/**
 * @swagger
 * /admin/users/{userId}/roles:
 *   post:
 *     summary: Assign a role to a user
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleName]
 *             properties:
 *               roleName: { type: string, example: admin }
 *     responses:
 *       200:
 *         description: Role assigned
 */
router.post('/users/:userId/roles', validate(assignRoleSchema), adminController.assignRole);

/**
 * @swagger
 * /admin/users/{userId}/roles/{roleName}:
 *   delete:
 *     summary: Revoke a role from a user
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *       - { in: path, name: roleName, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Role revoked
 */
router.delete('/users/:userId/roles/:roleName', validate(revokeRoleSchema), adminController.revokeRole);

/**
 * @swagger
 * /admin/insights:
 *   get:
 *     summary: Product-wide success metrics (parse accuracy, on-time completion, suggestion acceptance, fallback rates, AI spend)
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: days, schema: { type: integer, default: 30 } }
 *     responses:
 *       200:
 *         description: Metrics across all users
 */
router.get('/insights', requirePermission('insights:read'), validate(insightsSchema), adminController.getInsights);

export { router as adminRoutes };
