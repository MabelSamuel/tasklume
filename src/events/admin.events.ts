import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger, serializeError } from '../lib/logger';

export const ADMIN_EVENTS = {
  ROLE_ASSIGNED: 'admin:role-assigned',
  ROLE_REVOKED: 'admin:role-revoked',
} as const;

appEvents.on(ADMIN_EVENTS.ROLE_ASSIGNED, async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.assignedBy,
        action: 'role_assigned',
        metadata: JSON.stringify({
          targetUserId: data.targetUserId,
          roleName: data.roleName,
          assignedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log role assignment', {
      userId: data.assignedBy,
      targetUserId: data.targetUserId,
      roleName: data.roleName,
      error: serializeError(error),
    });
  }
});

appEvents.on(ADMIN_EVENTS.ROLE_REVOKED, async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.revokedBy,
        action: 'role_revoked',
        metadata: JSON.stringify({
          targetUserId: data.targetUserId,
          roleName: data.roleName,
          revokedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log role revocation', {
      userId: data.revokedBy,
      targetUserId: data.targetUserId,
      roleName: data.roleName,
      error: serializeError(error),
    });
  }
});
