import { Router } from 'express';
import { validate } from '../middleware/validate';
import { attachFingerprint } from '../middleware/fingerprint';
import { loginSchema, refreshSchema, registerSchema } from '../validators/auth.validator';
import * as authController from '../controllers/auth.controller';

const router = Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Ada Lovelace
 *               email:
 *                 type: string
 *                 format: email
 *                 example: ada@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: MyPassword123
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already registered
 */
router.post('/register', validate(registerSchema), authController.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in and receive an access/refresh token pair
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Tokens issued
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', attachFingerprint, validate(loginSchema), authController.login);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Rotate a refresh token
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200:
 *         description: New token pair
 */
router.post('/refresh', validate(refreshSchema), authController.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Revoke a refresh token
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       204:
 *         description: Logged out
 */
router.post('/logout', validate(refreshSchema), authController.logout);

export { router as authRoutes };
