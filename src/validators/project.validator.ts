import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #3b82f6');

export const projectParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid project ID'),
  }),
});

export const createProjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    // The categorizer reads this, so a sentence on what belongs here helps
    description: z.string().max(500).optional(),
    color: color.optional(),
  }),
});

export const updateProjectSchema = z.object({
  params: projectParamsSchema.shape.params,
  body: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    color: color.nullable().optional(),
    isArchived: z.boolean().optional(),
  }).refine(b => Object.keys(b).length > 0, 'Provide at least one field to update'),
});

export const listProjectsSchema = z.object({
  query: z.object({
    includeArchived: z.stringbool().default(false),
  }),
});
