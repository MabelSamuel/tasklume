import { appEvents } from '../lib/events';
import { cacheRedis } from '../lib/cache';
import { logger, serializeError } from '../lib/logger';
import { AUTH_EVENTS } from './auth.events';

const FAILURE_WINDOW_SECONDS = 900; // 15 minutes
const FAILURE_THRESHOLD = 5;

// Count failed logins per client fingerprint
appEvents.on(AUTH_EVENTS.LOGIN_FAILED, async (data) => {
  if (!data.fingerprint) return;

  try {
    const key = `login-failures:${data.fingerprint}`;
    const failures = await cacheRedis.incr(key);

    // Set expiry on first failure
    if (failures === 1) {
      await cacheRedis.expire(key, FAILURE_WINDOW_SECONDS);
    }

    if (failures >= FAILURE_THRESHOLD) {
      logger.warn('Repeated failed logins', {
        failures,
        fingerprint: data.fingerprint,
        email: data.email,
      });
      // Could add the fingerprint to a temporary block list here
    }
  } catch (error) {
    logger.error('Failed to track login failure', {
      fingerprint: data.fingerprint,
      error: serializeError(error),
    });
  }
});
