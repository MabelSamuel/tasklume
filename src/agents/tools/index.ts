import { z } from 'zod';

export interface ToolDefinition<P = any> {
  name: string;
  description: string;
  parameters: z.ZodType<P>;
  handler: (params: P, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  userId: string;
  correlationId: string;
  timezone: string;
}

export interface ToolResult {
  success: boolean;
  data: unknown;
}

// What tools return about a task: enough to reason about, nothing internal
export function taskBrief(
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    project?: { name: string } | null;
    projectName?: string | null;
  },
  formatDue: (d: Date) => string,
) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.dueDate ? formatDue(task.dueDate) : null,
    project: task.project?.name ?? task.projectName ?? null,
  };
}
