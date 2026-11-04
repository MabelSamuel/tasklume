import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { insightsSchema, updatePreferencesSchema } from '../validators/ai.validator';
import * as meController from '../controllers/me.controller';

// The caller's own settings and stats: no permission beyond being signed in

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /me/preferences:
 *   get:
 *     summary: Timezone, goals, project weights and digest settings the AI uses
 *     tags: [Me]
 *     responses:
 *       200:
 *         description: Preferences
 */
router.get('/preferences', meController.getMyPreferences);

/**
 * @swagger
 * /me/preferences:
 *   patch:
 *     summary: Update preferences
 *     description: >
 *       goals and projectWeights (0.5–2 per project) steer prioritization, so you can
 *       correct it when its idea of "important" doesn't match yours.
 *     tags: [Me]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               timezone: { type: string, example: 'Africa/Lagos' }
 *               goals: { type: string, example: 'Ship the v2 launch by Nov 20; keep Fridays for admin' }
 *               projectWeights: { type: object, additionalProperties: { type: number }, example: { 'cm3...': 1.5 } }
 *               dailyDigest: { type: boolean }
 *               weeklyDigest: { type: boolean }
 *               digestHour: { type: integer, minimum: 0, maximum: 23 }
 *               weeklyDigestDay: { type: integer, minimum: 0, maximum: 6 }
 *               autoConfirmCapture: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated preferences
 */
router.patch('/preferences', validate(updatePreferencesSchema), meController.updateMyPreferences);

/**
 * @swagger
 * /me/insights:
 *   get:
 *     summary: Your success metrics (parse accuracy, on-time completion, suggestion acceptance, AI spend)
 *     tags: [Me]
 *     parameters:
 *       - { in: query, name: days, schema: { type: integer, default: 30 } }
 *     responses:
 *       200:
 *         description: Metrics for the window
 */
router.get('/insights', validate(insightsSchema), meController.getMyInsights);

export { router as meRoutes };
