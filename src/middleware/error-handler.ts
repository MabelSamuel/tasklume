import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Operational error: we created this intentionally, safe to show the client
  if (err instanceof AppError) {
    logger.warn(scrubSensitiveData(err.message), {
      correlationId: req.correlationId,
      userId: req.user?.id,
      code: err.code,
      statusCode: err.statusCode,
      details: err.details ? scrubSensitiveData(err.details) : undefined,
    });

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: scrubSensitiveData(err.message),
        ...(err.details !== undefined && { details: scrubSensitiveData(err.details) }),
      },
    });
  }

  // Programming error: this is a bug. Log everything, reveal nothing.
  logger.error('Unhandled error', {
    correlationId: req.correlationId,
    userId: req.user?.id,
    method: req.method,
    path: req.path,
    error: scrubSensitiveData(err.message),
    stack: scrubSensitiveData(err.stack),
  });

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

function scrubSensitiveData(data: any): any {
  if (Array.isArray(data)) return data.map(scrubSensitiveData);
  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, scrubSensitiveData(value)])
    );
  }
  if (typeof data !== 'string') return data;

  const patterns = [
    /Bearer [A-Za-z0-9\-._~+\/]+=*/g,            // JWT tokens
    /sk-[A-Za-z0-9]{20,}/g,                        // API keys
    /password["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,    // password in any format
  ];

  let scrubbed = data;
  for (const pattern of patterns) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed;
}
