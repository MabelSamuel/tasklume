import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/tokens';
import { UnauthorizedError } from '../lib/errors';

export function authenticate(
  req: Request, res: Response, next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('No token provided'));
  }

  const token = header.split(' ')[1] as string;

  try {
    const payload = verifyAccessToken(token);

    // Make sure it's an access token, not a refresh token
    if (payload.type !== 'access') {
      return next(new UnauthorizedError('Invalid token type'));
    }

    // Attach user context to the request
    req.user = { id: payload.sub, tier: payload.tier };
    next();

  } catch (error) {
    if ((error as Error).name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token expired'));
    }
    return next(new UnauthorizedError('Invalid token'));
  }
}
