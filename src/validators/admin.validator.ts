import { z } from 'zod';

export const assignRoleSchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'Invalid user ID'),
  }),
  body: z.object({
    roleName: z.string().min(1, 'Role name is required'),
  }),
});

export const revokeRoleSchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'Invalid user ID'),
    roleName: z.string().min(1, 'Role name is required'),
  }),
});
