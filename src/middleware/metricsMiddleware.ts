import { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDuration } from '../lib/metrics';

export function metricsMiddleware(
  req: Request, res: Response, next: NextFunction
) {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    // Read the path after routing, when req.route is populated
    const path = normalizePath(
      req.route?.path ? req.baseUrl + req.route.path : req.path
    );
    const seconds = Number(process.hrtime.bigint() - startTime) / 1e9;

    httpRequestsTotal.inc({
      method: req.method,
      path,
      status_code: res.statusCode.toString(),
    });
    httpRequestDuration.observe({ method: req.method, path }, seconds);
  });

  next();
}

// Normalize paths so /tasks/abc-123 becomes /tasks/:id.
// Without this, each unique ID creates a separate metric series.
function normalizePath(path: string): string {
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      ':id'
    )
    .replace(/\/c[a-z0-9]{24}(?=\/|$)/g, '/:id') // cuid
    .replace(/\/\d+/g, '/:num');
}
