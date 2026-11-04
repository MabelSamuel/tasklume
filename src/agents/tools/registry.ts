import { z } from 'zod';
import { ToolDefinition } from './index';
import {
  createTaskTool,
  finalAnswerTool,
  getOverdueTasksTool,
  getUpcomingTasksTool,
  listProjectsTool,
  searchTasksTool,
  summarizeTasksTool,
} from './taskTools';

// Add more tools here as you build them
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  search_tasks: searchTasksTool,
  get_overdue_tasks: getOverdueTasksTool,
  get_upcoming_tasks: getUpcomingTasksTool,
  summarize_tasks: summarizeTasksTool,
  list_projects: listProjectsTool,
  create_task: createTaskTool,
  final_answer: finalAnswerTool,
};

// Convert to OpenAI function calling format
export function getToolSchemas() {
  return Object.values(TOOL_REGISTRY)
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.parameters),
      },
    }));
}
