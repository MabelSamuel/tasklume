import { prisma } from "../src/lib/prisma";
import {
  AGENT_SYSTEM_PROMPT,
  CAPTURE_SYSTEM_PROMPT,
  CATEGORIZE_SYSTEM_PROMPT,
  DIGEST_SYSTEM_PROMPT,
  PRIORITIZE_SYSTEM_PROMPT,
} from "../src/config/prompts";

async function seedRBAC() {
  // Define permissions
  const permissionDefs = [
    { name: 'tasks:create', resource: 'tasks', action: 'create',
      description: 'Create tasks (manually or by capture)' },
    { name: 'tasks:read', resource: 'tasks', action: 'read',
      description: 'View tasks, drafts, suggestions and digests' },
    { name: 'tasks:update', resource: 'tasks', action: 'update',
      description: 'Edit tasks and accept priority suggestions' },
    { name: 'tasks:delete', resource: 'tasks', action: 'delete',
      description: 'Delete tasks' },
    { name: 'tasks:manage', resource: 'tasks', action: 'manage',
      description: "Access other users' tasks" },
    { name: 'projects:create', resource: 'projects', action: 'create',
      description: 'Create projects' },
    { name: 'projects:read', resource: 'projects', action: 'read',
      description: 'View projects' },
    { name: 'projects:update', resource: 'projects', action: 'update',
      description: 'Edit and archive projects' },
    { name: 'projects:delete', resource: 'projects', action: 'delete',
      description: 'Delete projects' },
    { name: 'ai:use', resource: 'ai', action: 'use',
      description: 'Use AI features (capture, prioritization, digests, assistant)' },
    { name: 'insights:read', resource: 'insights', action: 'read',
      description: 'View product-wide success metrics' },
    { name: 'users:read', resource: 'users', action: 'read',
      description: 'View user list' },
    { name: 'users:manage', resource: 'users', action: 'manage',
      description: 'Manage user accounts' },
    { name: 'roles:manage', resource: 'roles', action: 'manage',
      description: 'Manage roles and permissions' },
  ];

  // Upsert all permissions
  const permissions: Record<string, { id: string }> = {};
  for (const perm of permissionDefs) {
    permissions[perm.name] = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  // Define roles with their permissions
  const roleDefs = [
    {
      name: 'admin',
      description: 'Full system access',
      permissions: Object.keys(permissions), // All permissions
    },
    {
      name: 'member',
      description: 'Standard user',
      isDefault: true,
      permissions: [
        'tasks:create', 'tasks:read', 'tasks:update', 'tasks:delete',
        'projects:create', 'projects:read', 'projects:update', 'projects:delete',
        'ai:use',
      ],
    },
    {
      name: 'viewer',
      description: 'Read-only access, no AI spend',
      permissions: ['tasks:read', 'projects:read'],
    },
  ];

  for (const roleDef of roleDefs) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: {},
      create: {
        name: roleDef.name,
        description: roleDef.description,
        isDefault: roleDef.isDefault ?? false,
      },
    });

    // Link permissions to role
    for (const permName of roleDef.permissions) {
      const permissionId = permissions[permName]!.id;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }

  console.log(`RBAC seeded: ${roleDefs.length} roles, ${permissionDefs.length} permissions`);
}

// v1 of each prompt. To ship a change, insert v2 with isActive=true and set
// v1 inactive; the gateway picks it up within CACHE_TTL.PROMPT.
async function seedPrompts() {
  const prompts = [
    { taskType: 'capture', name: 'Natural-language task capture', content: CAPTURE_SYSTEM_PROMPT },
    { taskType: 'categorize', name: 'Auto-categorization', content: CATEGORIZE_SYSTEM_PROMPT },
    { taskType: 'prioritize', name: 'Smart prioritization', content: PRIORITIZE_SYSTEM_PROMPT },
    { taskType: 'digest', name: 'Daily/weekly digest', content: DIGEST_SYSTEM_PROMPT },
    { taskType: 'agent', name: 'Task assistant agent', content: AGENT_SYSTEM_PROMPT },
  ];

  for (const p of prompts) {
    await prisma.promptTemplate.upsert({
      where: { taskType_version: { taskType: p.taskType, version: 'v1' } },
      update: {},
      create: { ...p, version: 'v1', isActive: true },
    });
  }

  console.log(`Prompts seeded: ${prompts.length} templates (v1)`);
}

seedRBAC()
  .then(seedPrompts)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
