import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger, serializeError } from '../lib/logger';

// ── Define the event names as constants ─────────────
export const AUTH_EVENTS = {
  USER_REGISTERED: 'auth:user-registered',
  USER_LOGGED_IN: 'auth:user-logged-in',
  USER_LOGGED_OUT: 'auth:user-logged-out',
  TOKEN_REFRESHED: 'auth:token-refreshed',
  LOGIN_FAILED: 'auth:login-failed',
} as const;

// ── Register listeners ─────────────────────────────
// Listeners are side effects: they log failures but never throw.

// Log signups for analytics
appEvents.on(AUTH_EVENTS.USER_REGISTERED, async (user) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        action: 'signup',
        metadata: JSON.stringify({
          tier: user.tier,
          registeredAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log signup', {
      userId: user.id,
      error: serializeError(error),
    });
  }
});

// Log login events (useful for security audits)
appEvents.on(AUTH_EVENTS.USER_LOGGED_IN, async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'login',
        metadata: JSON.stringify({
          deviceInfo: data.deviceInfo,
          loginAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log login', {
      userId: data.userId,
      error: serializeError(error),
    });
  }
});

// Log failed login attempts (security.events.ts handles lockout tracking)
appEvents.on(AUTH_EVENTS.LOGIN_FAILED, (data) => {
  logger.warn('Failed login attempt', {
    email: data.email,
    reason: data.reason,
    fingerprint: data.fingerprint,
  });
});
