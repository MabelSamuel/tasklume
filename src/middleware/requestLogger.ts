import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger';

export function requestLogger(
  req: Request, res: Response, next: NextFunction
) {
  // Reuse the caller's correlation ID or generate one for this request
  const correlationId = req.headers['x-correlation-id'] as string
    || randomUUID();

  // Attach to the request so other code (services, jobs) can use it
  req.correlationId = correlationId;

  // Add it to the response headers so the client can reference it
  res.setHeader('X-Correlation-Id', correlationId);

  const startTime = Date.now();

  logger.http('Request received', {
    correlationId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Log the response when it finishes
  res.on('finish', () => {
    const logData = {
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startTime,
      userId: req.user?.id,
    };

    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request client error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
}
