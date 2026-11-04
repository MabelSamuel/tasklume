import { z } from 'zod';
import { isValidTimezone } from '../lib/dates';
import { MAX_PROJECT_WEIGHT, MIN_PROJECT_WEIGHT } from '../lib/priorityScore';
import { dueDateInput, TASK_PRIORITIES } from './task.validator';

const idParams = z.object({
  params: z.object({ id: z.string().min(1, 'Invalid ID') }),
});

// ── Capture ──────────────────────────────────────────

export const captureSchema = z.object({
  body: z.object({
    // Typed text, or the transcript from the client's speech-to-text
    input: z.string().trim().min(2, 'Tell me what the task is').max(2000),
    // Overrides the user's autoConfirmCapture preference for this request
    autoConfirm: z.boolean().optional(),
  }),
});

export const draftParamsSchema = idParams;

export const listDraftsSchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'confirmed', 'discarded']).default('pending'),
  }),
});

// Every field optional: send only what the user corrected
export const confirmDraftSchema = z.object({
  params: idParams.shape.params,
  body: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    dueDate: dueDateInput.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    projectId: z.string().min(1).nullable().optional(),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).optional(),
  }).default({}),
});

// ── Prioritization ───────────────────────────────────

export const prioritizeSchema = z.object({
  body: z.object({
    projectId: z.string().min(1).optional(),
  }).default({}),
});

export const suggestionParamsSchema = idParams;

export const acceptSuggestionSchema = z.object({
  params: idParams.shape.params,
  body: z.object({
    // Omit to accept the whole suggestion
    taskIds: z.array(z.string().min(1)).min(1).max(100).optional(),
  }).default({}),
});

// ── Digests ──────────────────────────────────────────

export const generateDigestSchema = z.object({
  body: z.object({
    period: z.enum(['daily', 'weekly']).default('daily'),
  }).default({ period: 'daily' }),
});

export const listDigestsSchema = z.object({
  query: z.object({
    period: z.enum(['daily', 'weekly']).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
});

// ── Assistant ────────────────────────────────────────

export const assistantSchema = z.object({
  body: z.object({
    message: z.string().trim().min(2).max(2000),
    includeTrace: z.boolean().default(false),
  }),
});

// ── Preferences / insights ───────────────────────────

export const updatePreferencesSchema = z.object({
  body: z.object({
    timezone: z.string().refine(isValidTimezone, 'Unknown IANA timezone').optional(),
    goals: z.string().max(1000).nullable().optional(),
    projectWeights: z.record(
      z.string(),
      z.number().min(MIN_PROJECT_WEIGHT).max(MAX_PROJECT_WEIGHT),
    ).optional(),
    dailyDigest: z.boolean().optional(),
    weeklyDigest: z.boolean().optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
    weeklyDigestDay: z.number().int().min(0).max(6).optional(),
    autoConfirmCapture: z.boolean().optional(),
  }).refine(b => Object.keys(b).length > 0, 'Provide at least one field to update'),
});

export const insightsSchema = z.object({
  query: z.object({
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
});
