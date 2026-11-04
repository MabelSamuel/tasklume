import { z } from 'zod';
import dotenv from 'dotenv';
import { logger } from './logger';

// Load .env file into process.env
dotenv.config();

// Define the schema: every env var your app needs
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  FRONTEND_URL: z.string().default('http://localhost:3001'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Authentication
  JWT_ACCESS_SECRET: z.string().min(32,
    'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32,
    'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Redis (cache, rate limiting, queues)
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Webhooks
  WEBHOOK_SECRET: z.string().optional(),

  // External HTTP API (optional)
  EXTERNAL_API_BASE_URL: z.url().optional(),
  EXTERNAL_API_KEY: z.string().optional(),

  // AI provider (both are called through their OpenAI-compatible APIs).
  // With no key for the active provider, every AI feature uses its non-AI fallback.
  AI_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Privacy: store prompt/response excerpts in AIAuditLog (off = '[redacted]')
  AI_AUDIT_LOG_CONTENT: z.stringbool().default(false),

  // Capture (read through config.capture in src/config)
  CAPTURE_AUTO_CONFIRM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  CATEGORIZE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),

  // Scheduled digests (set false to stop the hourly scheduler)
  DIGESTS_ENABLED: z.stringbool().default(true),
}).refine(
  (env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET,
  // If they were equal, a refresh token could be used as an access token
  { message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ' },
);

// Empty strings in .env (e.g. `WEBHOOK_SECRET=`) mean "not set"
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);

// Validate process.env against the schema
const parsed = envSchema.safeParse(env);

if (!parsed.success) {
  logger.error('Invalid environment variables', {
    errors: z.treeifyError(parsed.error),
  });
  process.exit(1); // Crash immediately, do not start
}

export const config = parsed.data;
