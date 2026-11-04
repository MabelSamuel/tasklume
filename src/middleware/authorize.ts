import { Request, Response, NextFunction } from 'express';
import { getUserPermissions } from '../services/rbac.service';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

// Requires the user to hold ALL listed permissions.
// Must run after authenticate.
export function requirePermission(...requiredPermissions: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError();
      }

      const userPermissions = await getUserPermissions(req.user.id);

      const missing = requiredPermissions.filter(
        p => !userPermissions.has(p)
      );

      if (missing.length > 0) {
        throw new ForbiddenError('You do not have the required permission.');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
