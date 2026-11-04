import { Request, Response, NextFunction } from 'express';
import { cacheRedis } from '../lib/cache';
import { logger } from '../lib/logger';

const WINDOW_SECONDS = 300; // 5 minutes

// Flags users who touch an unusual number of distinct resources in a
// short window (scraping / ID enumeration). Mount on `/:id` routes.
export function trackResourceAccess(resource: string, threshold = 50) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    const resourceId = req.params.id as string | undefined;
    if (!userId || !resourceId) return next();

    try {
      const key = `access-pattern:${resource}:${userId}`;
      await cacheRedis.sadd(key, resourceId);
      await cacheRedis.expire(key, WINDOW_SECONDS);

      const uniqueCount = await cacheRedis.scard(key);
      if (uniqueCount > threshold) {
        logger.warn('Suspicious access pattern', {
          correlationId: req.correlationId,
          userId,
          resource,
          uniqueCount,
          windowSeconds: WINDOW_SECONDS,
        });
        // In production: emit event, alert admin, temporarily throttle
      }
    } catch {
      // Never block a request because tracking failed
    }

    next();
  };
}
