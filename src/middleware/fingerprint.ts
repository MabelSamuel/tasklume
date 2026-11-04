import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Coarse client fingerprint (IP + browser headers), used to track
// abuse across requests where there is no user ID yet, e.g. failed logins
export function attachFingerprint(
  req: Request, res: Response, next: NextFunction
) {
  const signals = [
    req.ip,
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
  ];

  req.fingerprint = crypto
    .createHash('sha256')
    .update(signals.join('|'))
    .digest('hex')
    .substring(0, 16);

  next();
}
