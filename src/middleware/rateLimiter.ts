import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore, { RedisReply } from 'rate-limit-redis';
import { cacheRedis } from '../lib/cache';
import { Request } from 'express';

type TierLimits = Record<string, number>;

// Pick the limit for the caller's tier (anonymous callers count as free)
function byTier(limits: TierLimits) {
  return (req: Request) => limits[req.user?.tier ?? 'free'] ?? limits.free ?? 0;
}

// Helper to create limiters with Redis backing
function createLimiter(options: {
  windowMs: number;
  max: number | ((req: Request) => number);
  message: string;
  keyGenerator?: (req: Request) => string;
  prefix: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,   // Send RateLimit-* headers
    legacyHeaders: false,    // Don't send X-RateLimit-* (old format)
    store: new RedisStore({
      sendCommand: (command: string, ...args: string[]) =>
        cacheRedis.call(command, ...args) as Promise<RedisReply>,
      prefix: options.prefix,
    }),
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: options.message,
      },
    },
    keyGenerator: options.keyGenerator ||
      ((req: Request) => req.user?.id || ipKeyGenerator(req.ip || 'anonymous')),
  });
}

// Auth endpoints: same for everyone, keyed by IP (user isn't authenticated yet)
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  prefix: 'rl:auth:',
  message: 'Too many auth attempts. Please try again later.',
  keyGenerator: (req) => ipKeyGenerator(req.ip || 'anonymous'),
});

// General API: tier-based. Mount after authenticate to key by user.
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: byTier({ free: 100, pro: 500, enterprise: 2000 }),
  prefix: 'rl:api:',
  message: 'Rate limit exceeded. Please slow down.',
});

// AI endpoints (capture, prioritize, digest, assistant): each call costs money.
// The monthly budget in mcp.service is the hard ceiling; this stops bursts.
export const aiLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: byTier({ free: 60, pro: 600, enterprise: 3000 }),
  prefix: 'rl:ai:',
  message: 'AI request limit reached. Please try again later.',
});

// Writes / expensive operations: tier-based, tight limits
export const writeLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: byTier({ free: 50, pro: 500, enterprise: 5000 }),
  prefix: 'rl:write:',
  message: 'Write limit reached. Please try again later.',
});
