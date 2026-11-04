import { Request, Response, NextFunction } from 'express';
import xss from 'xss';

function sanitizeValue(value: any): any {
  if (typeof value === 'string') {
    return xss(value, {
      whiteList: {},          // Strip ALL HTML tags
      stripIgnoreTag: true,   // Remove unrecognized tags entirely
      stripIgnoreTagBody: ['script', 'style'], // Remove script/style contents
    });
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    const clean: any = {};
    for (const key of Object.keys(value)) {
      clean[key] = sanitizeValue(value[key]);
    }
    return clean;
  }
  return value;
}

export function sanitizeInput(
  req: Request, res: Response, next: NextFunction
) {
  if (req.body) req.body = sanitizeValue(req.body);
  // Express 5 exposes req.query as a getter that re-parses on every access,
  // so shadow it with a writable own property holding the sanitized value
  if (req.query) {
    Object.defineProperty(req, 'query', {
      value: sanitizeValue(req.query),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  if (req.params) req.params = sanitizeValue(req.params);
  next();
}
