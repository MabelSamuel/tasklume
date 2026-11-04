import { z } from 'zod';
import { taskBrief, ToolDefinition } from './index';
import { endOfLocalDay, formatLocal } from '../../lib/dates';
import { taskRepository } from '../../repositories/task.repository';
import { captureTasks } from '../../services/capture.service';
import { computeDigestData } from '../../services/digest.service';
import { listProjects } from '../../services/project.service';
import { searchTasks } from '../../services/search.service';

// Read tools query only the caller's tasks (userId comes from the context,
// never from the model). The one write tool creates a DRAFT, not a task.

const DAY_MS = 86_400_000;

export const searchTasksTool: ToolDefinition<{ query: string; includeDone: boolean; topK: number }> = {
  name: 'search_tasks',
  description:
    'Find the user\'s tasks by meaning, not exact words. ' +
    'Use for "the thing about...", people, topics or projects.',
  parameters: z.object({
    query: z.string().min(2).max(300).describe('What the task is about'),
    includeDone: z.boolean().default(false).describe('Also search completed and cancelled tasks'),
    topK: z.number().int().min(1).max(15).default(8),
  }),
  handler: async (params, ctx) => {
    const result = await searchTasks({
      userId: ctx.userId,
      query: params.query,
      topK: params.topK,
      includeDone: params.includeDone,
      correlationId: ctx.correlationId,
    });
    return {
      success: true,
      data: {
        mode: result.mode,
        results: result.results.map(r => ({
          ...taskBrief(r, d => formatLocal(d, ctx.timezone)),
          score: r.score === null ? null : Number(r.score.toFixed(3)),
        })),
      },
    };
  },
};

export const getOverdueTasksTool: ToolDefinition<{ limit: number }> = {
  name: 'get_overdue_tasks',
  description: 'List open tasks that are past their due date, most overdue first.',
  parameters: z.object({
    limit: z.number().int().min(1).max(25).default(15),
  }),
  handler: async (params, ctx) => {
    const now = new Date();
    const [tasks, total] = await Promise.all([
      taskRepository.findAll({ userId: ctx.userId, overdueAt: now }, params.limit),
      taskRepository.count({ userId: ctx.userId, overdueAt: now }),
    ]);
    return {
      success: true,
      data: { total, tasks: tasks.map(t => taskBrief(t, d => formatLocal(d, ctx.timezone))) },
    };
  },
};

export const getUpcomingTasksTool: ToolDefinition<{ days: number; limit: number }> = {
  name: 'get_upcoming_tasks',
  description: 'List open tasks due between now and the end of the day N days from today.',
  parameters: z.object({
    days: z.number().int().min(0).max(30).default(7).describe('0 = rest of today'),
    limit: z.number().int().min(1).max(25).default(15),
  }),
  handler: async (params, ctx) => {
    const now = new Date();
    const until = endOfLocalDay(new Date(now.getTime() + params.days * DAY_MS), ctx.timezone);
    const filter = { userId: ctx.userId, status: 'open' as const, dueAfter: now, dueBefore: until };
    const [tasks, total] = await Promise.all([
      taskRepository.findAll(filter, params.limit),
      taskRepository.count(filter),
    ]);
    return {
      success: true,
      data: { total, until: formatLocal(until, ctx.timezone), tasks: tasks.map(t => taskBrief(t, d => formatLocal(d, ctx.timezone))) },
    };
  },
};

export const summarizeTasksTool: ToolDefinition<{ timeframe: 'today' | 'week' }> = {
  name: 'summarize_tasks',
  description:
    'Counts and highlights for a timeframe: overdue, due today, at risk, upcoming, ' +
    'and completed. Use for "how am I doing" or "what does my week look like".',
  parameters: z.object({
    timeframe: z.enum(['today', 'week']),
  }),
  handler: async (params, ctx) => {
    const data = await computeDigestData(
      ctx.userId,
      params.timeframe === 'today' ? 'daily' : 'weekly',
      new Date(),
      ctx.timezone,
    );
    return { success: true, data: { stats: data.stats, highlights: data.highlights } };
  },
};

export const listProjectsTool: ToolDefinition<Record<string, never>> = {
  name: 'list_projects',
  description: 'List the user\'s projects with their open-task counts.',
  parameters: z.object({}),
  handler: async (_params, ctx) => {
    const projects = await listProjects(ctx.userId);
    return {
      success: true,
      data: projects.map(p => ({ id: p.id, name: p.name, openTasks: p.openTaskCount })),
    };
  },
};

export const createTaskTool: ToolDefinition<{ text: string }> = {
  name: 'create_task',
  description:
    'Capture a new task from a natural-language description. Creates a DRAFT ' +
    'the user must confirm; tell them it is waiting for their review.',
  parameters: z.object({
    text: z.string().min(2).max(1000)
      .describe('The task in the user\'s words, including any date or priority they mentioned'),
  }),
  handler: async (params, ctx) => {
    const result = await captureTasks({
      userId: ctx.userId,
      input: params.text,
      autoConfirm: false, // The assistant never skips the user's review
      source: 'assistant',
      correlationId: ctx.correlationId,
    });
    return {
      success: true,
      data: {
        drafts: result.results.map(r => ({
          draftId: r.draft.id,
          title: r.draft.parsed.title,
          dueDate: r.draft.parsed.dueDate,
          priority: r.draft.parsed.priority,
          ambiguities: r.draft.ambiguities,
        })),
        status: 'awaiting_user_confirmation',
      },
    };
  },
};

export const finalAnswerTool: ToolDefinition<{
  answer: string;
  taskIds: string[];
  draftIds: string[];
  confidence: 'high' | 'medium' | 'low';
}> = {
  name: 'final_answer',
  description: 'Give the final answer to the user. Call this when you have gathered enough information.',
  parameters: z.object({
    answer: z.string().min(1).describe('The complete answer to the user'),
    taskIds: z.array(z.string()).default([]).describe('Ids of tasks referenced in the answer'),
    draftIds: z.array(z.string()).default([]).describe('Ids of drafts created for the user to confirm'),
    confidence: z.enum(['high', 'medium', 'low']).describe('How confident you are in the answer'),
  }),
  handler: async (params) => ({ success: true, data: params }),
};
