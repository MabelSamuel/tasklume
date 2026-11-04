import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger, serializeError } from '../lib/logger';
import { agentCost, agentIterations, agentTerminations } from '../lib/metrics';
import { trackCost } from '../services/mcp.service';
import { logUsage } from './task.events';

export const AI_EVENTS = {
  DRAFT_CREATED: 'ai:draft-created',
  DRAFT_RESOLVED: 'ai:draft-resolved',
  TASK_CATEGORIZED: 'ai:task-categorized',
  SUGGESTION_CREATED: 'ai:suggestion-created',
  SUGGESTION_RESOLVED: 'ai:suggestion-resolved',
  DIGEST_GENERATED: 'ai:digest-generated',
  EMBEDDING_GENERATED: 'ai:embedding-generated',
  AGENT_COMPLETED: 'agent:completed',
} as const;

appEvents.on(AI_EVENTS.DRAFT_RESOLVED, (data) =>
  logUsage(data.userId, `draft_${data.status}`, {
    draftId: data.draftId,
    taskId: data.taskId,
    correctedFields: data.correctedFields,
    fallbackUsed: data.fallbackUsed,
  }));

appEvents.on(AI_EVENTS.TASK_CATEGORIZED, (data) =>
  logUsage(data.userId, 'task_categorized', {
    taskId: data.taskId,
    projectId: data.projectId,
    confidence: data.confidence,
  }));

appEvents.on(AI_EVENTS.SUGGESTION_RESOLVED, (data) =>
  logUsage(data.userId, `suggestion_${data.status}`, {
    suggestionId: data.suggestionId,
    accepted: data.acceptedCount,
    total: data.totalCount,
  }));

appEvents.on(AI_EVENTS.DIGEST_GENERATED, (data) =>
  logUsage(data.userId, 'digest_generated', {
    digestId: data.digestId,
    period: data.period,
    trigger: data.trigger,
    fallbackUsed: data.fallbackUsed,
  }));

// Embeddings bypass mcpComplete, so their spend is recorded here
appEvents.on(AI_EVENTS.EMBEDDING_GENERATED, async (data) => {
  if (!data.userId) return;
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'ai_embedding',
        tokens: data.tokensUsed,
        costUsd: data.costUsd,
        metadata: JSON.stringify({ model: data.model, taskId: data.taskId }),
      },
    });
    await trackCost(data.userId, data.costUsd);
  } catch (error) {
    logger.error('Failed to log embedding usage', { error: serializeError(error) });
  }
});

// The agent calls the provider directly, so its spend is recorded here
appEvents.on(AI_EVENTS.AGENT_COMPLETED, async (data) => {
  agentIterations.observe(data.iterations);
  agentCost.observe(data.totalCostUsd);
  agentTerminations.inc({ reason: data.terminationReason });

  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'agent_run',
        tokens: data.totalTokens,
        costUsd: data.totalCostUsd,
        metadata: JSON.stringify({
          correlationId: data.correlationId,
          iterations: data.iterations,
          terminationReason: data.terminationReason,
          toolsUsed: data.toolsUsed,
          confidence: data.confidence,
          durationMs: data.durationMs,
        }),
      },
    });
    await trackCost(data.userId, data.totalCostUsd);
  } catch (error) {
    logger.error('Failed to log agent run', { error: serializeError(error) });
  }
});
