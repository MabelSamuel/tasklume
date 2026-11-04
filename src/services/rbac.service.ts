import { prisma } from "../lib/prisma";
import { cacheGetOrSet, CACHE_TTL } from "../lib/cache";
import { appEvents } from "../lib/events";
import { NotFoundError } from "../lib/errors";
import { ADMIN_EVENTS } from "../events/admin.events";

export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const permissions = await cacheGetOrSet<string[]>(
    `permissions:${userId}`,
    CACHE_TTL.PERMISSIONS,
    async () => {
      const userRoles = await prisma.userRole.findMany({
        where: { userId },
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      });

      const names = new Set<string>();
      for (const ur of userRoles) {
        for (const rp of ur.role.permissions) {
          names.add(rp.permission.name);
        }
      }

      return [...names]; // Array for JSON serialization
    }
  );

  return new Set(permissions);
}

export async function hasPermission(userId: string, permission: string) {
  return (await getUserPermissions(userId)).has(permission);
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { users: true } },
    },
    orderBy: { name: "asc" },
  });

  return roles.map(role => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isDefault: role.isDefault,
    userCount: role._count.users,
    permissions: role.permissions.map(rp => rp.permission.name),
  }));
}

export async function assignRole(userId: string, roleName: string, assignedBy: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found");

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new NotFoundError(`Role '${roleName}' not found`);

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id, assignedBy },
  });

  // Audit log + permissions cache bust happen in listeners
  appEvents.emit(ADMIN_EVENTS.ROLE_ASSIGNED, {
    targetUserId: userId,
    roleName,
    assignedBy,
  });
}

export async function revokeRole(userId: string, roleName: string, revokedBy: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new NotFoundError("Role not found");

  await prisma.userRole.deleteMany({
    where: { userId, roleId: role.id },
  });

  appEvents.emit(ADMIN_EVENTS.ROLE_REVOKED, {
    targetUserId: userId,
    roleName,
    revokedBy,
  });
}
