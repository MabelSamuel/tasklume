import { z } from 'zod';
import {
  AGENT_SYSTEM_PROMPT,
  CAPTURE_SYSTEM_PROMPT,
  CATEGORIZE_SYSTEM_PROMPT,
  DIGEST_SYSTEM_PROMPT,
  PRIORITIZE_SYSTEM_PROMPT,
} from '../config/prompts';
import { AI_ENABLED, AI_MODELS, MODELS, ModelConfig } from '../config/ai-models';
import { cacheGet, cacheRedis, cacheSet, CACHE_TTL } from '../lib/cache';
import { config } from '../lib/config';
import { AppError, ServiceUnavailableError } from '../lib/errors';
import { aiBreaker } from '../lib/http/ai.breaker';
import { logger, serializeError } from '../lib/logger';
import { aiCalls } from '../lib/metrics';
import { prisma } from '../lib/prisma';

// AI gateway: every LLM completion goes through mcpComplete, which runs
// budget check → prompt resolution → model routing → call with fallback
// → cost tracking → audit log.
//
// Callers own the non-AI fallback: anything thrown from here (no key,
// breaker open, budget exhausted, bad output) means "use the fallback path".

export type TaskType = 'capture' | 'categorize' | 'prioritize' | 'digest' | 'agent';

export interface MCPRequest {
  taskType: TaskType;
  messages: { role: string; content: string }[];
  userId: string;
  correlationId: string;
  tools?: unknown[] | undefined;
  // 'required' forces a tool call (structured output); supported by both providers
  toolChoice?: 'auto' | 'required' | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

export interface MCPResponse {
  content: string;
  toolCalls?: ToolCall[] | undefined;
  model: string;
  promptVersion: string;
  tokensUsed: { prompt: number; completion: number; total: number };
  costUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export class AIUnavailableError extends ServiceUnavailableError {
  constructor(message = 'AI features are not configured') {
    super(message);
  }
}

export async function mcpComplete(
  request: MCPRequest
): Promise<MCPResponse> {
  const startTime = Date.now();

  // 0. No key for the active provider: don't burn retries on guaranteed 401s
  if (!AI_ENABLED) {
    throw new AIUnavailableError();
  }

  // 1. Check budget
  await enforceBudget(request.userId);

  // 2. Resolve prompt version
  const prompt = await resolvePrompt(request.taskType);

  // 3. Select model
  const model = routeModel(request.taskType);

  // 4. Call with fallback
  let result: Awaited<ReturnType<typeof callWithFallback>>;
  try {
    result = await callWithFallback(model, {
      ...request,
      systemPrompt: prompt.content,
    });
  } catch (error) {
    aiCalls.inc({ task_type: request.taskType, outcome: 'error' });
    throw error;
  }
  aiCalls.inc({
    task_type: request.taskType,
    outcome: result.fallbackUsed ? 'fallback_model' : 'success',
  });

  // 5. Track cost
  const costUsd = calculateCost(result.model, result.usage);
  await trackCost(request.userId, costUsd);
  await logUsage(request, result.model, result.usage, costUsd);

  // 6. Audit log
  await auditLog({
    ...request,
    model: result.model,
    promptVersion: prompt.version,
    usage: result.usage,
    costUsd,
    latencyMs: Date.now() - startTime,
    response: result.content || JSON.stringify(result.toolCalls ?? []),
    fallbackUsed: result.fallbackUsed,
  });

  return {
    content: result.content,
    toolCalls: result.toolCalls,
    model: result.model,
    promptVersion: prompt.version,
    tokensUsed: {
      prompt: result.usage.prompt_tokens,
      completion: result.usage.completion_tokens,
      total: result.usage.total_tokens,
    },
    costUsd,
    latencyMs: Date.now() - startTime,
    fallbackUsed: result.fallbackUsed,
  };
}

// Structured output via a forced tool call. Every call to the tool is
// validated against its zod schema; invalid calls are dropped (and logged)
// rather than trusted, and zero valid calls is an error the caller falls back on.
export async function mcpCompleteWithTool<T>(
  request: Omit<MCPRequest, 'tools' | 'toolChoice'>,
  tool: { name: string; description: string; parameters: z.ZodType<T> },
): Promise<{ calls: T[]; response: MCPResponse }> {
  const response = await mcpComplete({
    ...request,
    tools: [{
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.parameters),
      },
    }],
    toolChoice: 'required',
  });

  const calls: T[] = [];
  for (const call of response.toolCalls ?? []) {
    if (call.function.name !== tool.name) continue;

    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      logger.warn('Tool call arguments were not JSON', {
        correlationId: request.correlationId,
        tool: tool.name,
      });
      continue;
    }

    const parsed = tool.parameters.safeParse(args);
    if (parsed.success) {
      calls.push(parsed.data);
    } else {
      logger.warn('Tool call failed schema validation', {
        correlationId: request.correlationId,
        tool: tool.name,
        issues: parsed.error.issues.slice(0, 5),
      });
    }
  }

  if (calls.length === 0) {
    throw new AppError(`Model returned no valid ${tool.name} call`, 502, 'AI_BAD_OUTPUT');
  }

  return { calls, response };
}

// Used when no PromptTemplate row is active, so a fresh database still works
const DEFAULT_PROMPTS: Record<TaskType, string> = {
  capture: CAPTURE_SYSTEM_PROMPT,
  categorize: CATEGORIZE_SYSTEM_PROMPT,
  prioritize: PRIORITIZE_SYSTEM_PROMPT,
  digest: DIGEST_SYSTEM_PROMPT,
  agent: AGENT_SYSTEM_PROMPT,
};

export async function resolvePrompt(
  taskType: TaskType
): Promise<{ content: string; version: string }> {
  // Check cache first
  const cacheKey = `prompt:${taskType}:active`;
  const cached = await cacheGet<{ content: string; version: string }>(cacheKey);
  if (cached) return cached;

  // Load from database
  const prompt = await prisma.promptTemplate.findFirst({
    where: { taskType, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const result = prompt
    ? { content: prompt.content, version: prompt.version }
    : { content: DEFAULT_PROMPTS[taskType], version: 'default' };

  await cacheSet(cacheKey, result, CACHE_TTL.PROMPT);
  return result;
}

// Task type → default model mapping for the active provider
const MODEL_ROUTING: Record<TaskType, string> = {
  capture: AI_MODELS.capture,
  categorize: AI_MODELS.categorize,
  prioritize: AI_MODELS.prioritize,
  digest: AI_MODELS.digest,
  agent: AI_MODELS.agent,
};

function routeModel(taskType: TaskType): ModelConfig {
  const modelName = MODEL_ROUTING[taskType];
  return MODELS[modelName] ?? MODELS[AI_MODELS.capture]!;
}

async function callWithFallback(
  primaryModel: ModelConfig,
  request: MCPRequest & { systemPrompt: string }
): Promise<{
  content: string;
  toolCalls?: ToolCall[] | undefined;
  model: string;
  usage: Usage;
  fallbackUsed: boolean;
}> {
  const chain = AI_MODELS.fallbackChains[primaryModel.name] || [primaryModel.name];

  for (const [i, modelName] of chain.entries()) {
    const isFallback = i > 0;

    try {
      const response = await aiBreaker.fire('/chat/completions', {
        model: modelName,
        messages: [
          { role: 'system', content: request.systemPrompt },
          ...request.messages,
        ],
        tools: request.tools,
        ...(request.tools && { tool_choice: request.toolChoice ?? 'auto' }),
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 1500,
      });

      if (isFallback) {
        logger.warn('Fallback model used', {
          correlationId: request.correlationId,
          primary: primaryModel.name,
          fallback: modelName,
        });
      }

      return {
        content: response.data.choices[0].message.content ?? '',
        toolCalls: response.data.choices[0].message.tool_calls,
        model: modelName,
        usage: response.data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        fallbackUsed: isFallback,
      };
    } catch (error) {
      logger.error(`Model ${modelName} failed`, {
        correlationId: request.correlationId,
        error: (error as Error).message,
        isLastFallback: i === chain.length - 1,
      });

      if (i === chain.length - 1) {
        throw error; // All models failed
      }
      // Try next model in chain
    }
  }

  throw new Error('All models in fallback chain failed');
}

export function calculateCost(
  modelName: string,
  usage: { prompt_tokens: number; completion_tokens: number }
): number {
  const model = MODELS[modelName];
  if (!model) return 0;

  return (
    (usage.prompt_tokens / 1_000_000) * model.costPerMillionInput +
    (usage.completion_tokens / 1_000_000) * model.costPerMillionOutput
  );
}

const MONTHLY_BUDGETS: Record<string, number> = {
  free: 1.00,
  pro: 20.00,
  enterprise: 200.00,
};

// UsageLog actions that carry AI spend
const AI_COST_ACTIONS = ['ai_completion', 'agent_run', 'ai_embedding'];

// Months are calendar months in UTC, so the Redis key and the DB query agree
function monthKey(userId: string): string {
  return `budget:${userId}:${new Date().toISOString().slice(0, 7)}`;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function secondsUntilMonthEnds(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

// Redis holds the running total; on a miss it's rebuilt from UsageLog
async function getMonthlySpend(userId: string): Promise<number> {
  const key = monthKey(userId);
  const cached = await cacheRedis.get(key);
  if (cached !== null) return parseFloat(cached);

  const result = await prisma.usageLog.aggregate({
    where: {
      userId,
      action: { in: AI_COST_ACTIONS },
      createdAt: { gte: startOfMonth() },
    },
    _sum: { costUsd: true },
  });
  const spent = result._sum.costUsd || 0;

  // NX: don't overwrite increments that landed while we were aggregating
  await cacheRedis.set(key, String(spent), 'EX', secondsUntilMonthEnds() + 86400, 'NX');
  return spent;
}

// Exported so AI work that doesn't go through mcpComplete (the agent loop,
// embeddings) still hits the same cost ceiling
export async function enforceBudget(userId: string): Promise<void> {
  // Get user's tier
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true },
  });

  // Unknown tiers get the free budget rather than no limit
  const budget = MONTHLY_BUDGETS[user?.tier || 'free'] ?? MONTHLY_BUDGETS['free']!;

  const spent = await getMonthlySpend(userId);

  if (spent >= budget) {
    throw new AppError(
      `Monthly AI budget exhausted ($${spent.toFixed(2)}/$${budget.toFixed(2)})`,
      429,
      'BUDGET_EXHAUSTED'
    );
  }

  // Warn at 80%
  if (spent >= budget * 0.8) {
    logger.warn('User approaching budget limit', {
      userId,
      spent: spent.toFixed(4),
      budget: budget.toFixed(2),
      percentUsed: ((spent / budget) * 100).toFixed(1),
    });
  }
}

// Exported so the agent loop can add its spend to the same counter
export async function trackCost(
  userId: string,
  costUsd: number
): Promise<void> {
  if (costUsd <= 0) return;
  try {
    // Atomic increment in Redis for fast budget checks
    const key = monthKey(userId);
    await cacheRedis.incrbyfloat(key, costUsd);

    // Auto-cleanup a day after the month ends
    await cacheRedis.expire(key, secondsUntilMonthEnds() + 86400);
  } catch (error) {
    // UsageLog still has the cost; the counter is rebuilt from it on a miss
    logger.error('Failed to track cost', { userId, error: serializeError(error) });
  }
}

// UsageLog is the source of truth the budget counter is rebuilt from
async function logUsage(
  request: MCPRequest,
  model: string,
  usage: Usage,
  costUsd: number
): Promise<void> {
  try {
    await prisma.usageLog.create({
      data: {
        userId: request.userId,
        action: 'ai_completion',
        tokens: usage.total_tokens,
        costUsd,
        metadata: JSON.stringify({
          correlationId: request.correlationId,
          taskType: request.taskType,
          model,
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log AI usage', { error: serializeError(error) });
  }
}

// Task text can be sensitive, so excerpts are only kept when explicitly enabled
function excerpt(text: string): string {
  return config.AI_AUDIT_LOG_CONTENT ? text.substring(0, 500) : '[redacted]';
}

async function auditLog(data: {
  userId: string;
  correlationId: string;
  taskType: TaskType;
  model: string;
  promptVersion: string;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  messages: { role: string; content: string }[];
  response?: string;
  fallbackUsed?: boolean;
}): Promise<void> {
  try {
    const inputText = data.messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');

    await prisma.aIAuditLog.create({
      data: {
        userId: data.userId,
        correlationId: data.correlationId,
        taskType: data.taskType,
        model: data.model,
        promptVersion: data.promptVersion,
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        costUsd: data.costUsd,
        latencyMs: data.latencyMs,
        fallbackUsed: data.fallbackUsed ?? false,
        inputSummary: excerpt(inputText),
        outputSummary: excerpt(data.response || ''),
      },
    });
  } catch (error) {
    // Audit logging should never crash the request
    logger.error('Audit log failed', { error: serializeError(error) });
  }
}
