import { TOOL_REGISTRY, getToolSchemas } from './tools/registry';
import { AI_ENABLED, AI_MODELS, MODELS } from '../config/ai-models';
import { AI_EVENTS } from '../events/ai.events';
import { describeNow } from '../lib/dates';
import { appEvents } from '../lib/events';
import { aiBreaker } from '../lib/http/ai.breaker';
import { logger } from '../lib/logger';
import { detectPromptInjection } from '../lib/promptSanitizer';
import { AIUnavailableError, enforceBudget, resolvePrompt } from '../services/mcp.service';
import { getPreferences } from '../services/preferences.service';

interface AgentConfig {
  maxIterations: number;
  timeoutMs: number;
  costCeilingUsd: number;
  model: string;
}

export interface AgentResult {
  answer: string;
  taskIds: string[];
  draftIds: string[];
  confidence: string;
  iterations: number;
  totalCostUsd: number;
  terminationReason: 'completed' | 'iteration_limit' | 'timeout' | 'cost_limit' | 'error';
  trace: TraceStep[];
}

interface TraceStep {
  step: number;
  phase: 'think' | 'act' | 'observe';
  tool?: string;
  input?: unknown;
  output?: unknown;
  durationMs: number;
  costUsd: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 6,
  timeoutMs: 60_000,
  costCeilingUsd: 0.25,
  model: AI_MODELS.agent,
};

export async function runAgent(options: {
  message: string;
  userId: string;
  correlationId: string;
  config?: Partial<AgentConfig>;
}): Promise<AgentResult> {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const { userId, correlationId } = options;

  if (!AI_ENABLED) throw new AIUnavailableError('The assistant needs an AI provider to be configured');

  const trace: TraceStep[] = [];
  const draftIds = new Set<string>();
  let totalCostUsd = 0;
  let totalTokens = 0;
  let iteration = 0;
  const startTime = Date.now();

  // Every exit path goes through here so usage is always logged
  const finish = (result: AgentResult): AgentResult => {
    appEvents.emit(AI_EVENTS.AGENT_COMPLETED, {
      userId,
      correlationId,
      iterations: result.iterations,
      totalTokens,
      totalCostUsd: result.totalCostUsd,
      terminationReason: result.terminationReason,
      toolsUsed: result.trace.filter(s => s.tool).map(s => s.tool),
      confidence: result.confidence,
      durationMs: Date.now() - startTime,
    });
    return result;
  };

  // The agent calls the provider directly, so check the monthly cost ceiling up front
  await enforceBudget(userId);

  const [{ timezone }, prompt] = await Promise.all([
    getPreferences(userId),
    resolvePrompt('agent'),
  ]);

  const injection = detectPromptInjection(options.message);
  if (injection.isSuspicious) {
    logger.warn('Possible prompt injection in assistant message', { correlationId, userId });
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.content },
    { role: 'user', content: `CURRENT TIME: ${describeNow(new Date(), timezone)}\n\n${injection.sanitized}` },
  ];

  const tools = getToolSchemas();

  logger.info('Agent started', {
    correlationId,
    maxIterations: config.maxIterations,
    costCeiling: config.costCeilingUsd,
    promptVersion: prompt.version,
  });

  while (iteration < config.maxIterations) {
    // ── CHECK TIMEOUT ──
    const elapsed = Date.now() - startTime;
    if (elapsed > config.timeoutMs) {
      logger.warn('Agent timeout', { correlationId, iteration, elapsed });
      return finish(buildResult('timeout', trace, totalCostUsd, iteration, draftIds));
    }

    // ── CHECK COST ──
    if (totalCostUsd >= config.costCeilingUsd) {
      logger.warn('Agent cost ceiling hit', { correlationId, iteration, totalCostUsd });
      return finish(buildResult('cost_limit', trace, totalCostUsd, iteration, draftIds));
    }

    iteration++;
    const stepStart = Date.now();

    // ── THINK: Ask the model what to do ──
    const response = await aiBreaker.fire('/chat/completions', {
      model: config.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.1,
    });

    const usage = response.data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    const pricing = MODELS[config.model] ?? MODELS[AI_MODELS.agent]!;
    const stepCost =
      (usage.prompt_tokens / 1_000_000) * pricing.costPerMillionInput +
      (usage.completion_tokens / 1_000_000) * pricing.costPerMillionOutput;
    totalCostUsd += stepCost;
    totalTokens += usage.prompt_tokens + usage.completion_tokens;

    const assistantMessage: ChatMessage = response.data.choices[0].message;
    messages.push(assistantMessage);

    // ── NO TOOL CALL: Model wants to respond directly ──
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      trace.push({
        step: iteration, phase: 'think',
        output: assistantMessage.content,
        durationMs: Date.now() - stepStart, costUsd: stepCost,
      });

      return finish({
        answer: assistantMessage.content ?? '',
        taskIds: [],
        draftIds: [...draftIds],
        confidence: 'medium',
        iterations: iteration,
        totalCostUsd,
        terminationReason: 'completed',
        trace,
      });
    }

    // ── ACT: Execute each tool call ──
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const reply = (content: string) =>
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content });

      let toolArgs: unknown;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        reply('Error: tool arguments were not valid JSON');
        continue;
      }

      logger.info('Agent tool call', { correlationId, iteration, tool: toolName });

      // Validate: is this tool in the registry?
      const tool = TOOL_REGISTRY[toolName];
      if (!tool) {
        reply(`Error: unknown tool "${toolName}"`);
        trace.push({
          step: iteration, phase: 'act', tool: toolName,
          input: toolArgs, output: { error: 'Unknown tool' },
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
        continue;
      }

      // Validate inputs
      const validation = tool.parameters.safeParse(toolArgs);
      if (!validation.success) {
        reply(`Validation error: ${validation.error.message}`);
        trace.push({
          step: iteration, phase: 'act', tool: toolName,
          input: toolArgs, output: { error: 'Validation failed' },
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
        continue;
      }

      // Check for final_answer
      if (toolName === 'final_answer') {
        const final = validation.data as {
          answer: string; taskIds: string[]; draftIds: string[]; confidence: string;
        };
        trace.push({
          step: iteration, phase: 'act', tool: 'final_answer',
          input: final,
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
        return finish({
          answer: final.answer,
          taskIds: final.taskIds,
          // Trust the drafts we actually created over the ids the model echoes back
          draftIds: [...draftIds],
          confidence: final.confidence,
          iterations: iteration,
          totalCostUsd,
          terminationReason: 'completed',
          trace,
        });
      }

      // Execute the tool
      try {
        const result = await tool.handler(validation.data, { userId, correlationId, timezone });

        if (toolName === 'create_task') {
          const created = (result.data as { drafts: { draftId: string }[] }).drafts;
          created.forEach(d => draftIds.add(d.draftId));
        }

        // ── OBSERVE: Feed result back to the model ──
        reply(JSON.stringify(result.data));
        trace.push({
          step: iteration, phase: 'observe', tool: toolName,
          input: validation.data, output: result.data,
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
      } catch (error) {
        reply(`Tool error: ${(error as Error).message}`);
        trace.push({
          step: iteration, phase: 'observe', tool: toolName,
          input: validation.data, output: { error: (error as Error).message },
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
      }
    }
  }

  // Iteration limit reached
  logger.warn('Agent iteration limit', { correlationId, iterations: iteration, totalCostUsd });
  return finish(buildResult('iteration_limit', trace, totalCostUsd, iteration, draftIds));
}

function buildResult(
  reason: AgentResult['terminationReason'],
  trace: TraceStep[],
  costUsd: number,
  iterations: number,
  draftIds: Set<string>,
): AgentResult {
  const toolsRun = trace.filter(s => s.phase === 'observe').length;

  return {
    answer: `I couldn't finish answering (${reason.replace('_', ' ')}). ` +
      (toolsRun > 0
        ? `I looked at your tasks ${toolsRun} time(s) but ran out of room to summarise. Try a narrower question.`
        : 'Please try again or rephrase your question.'),
    taskIds: [],
    draftIds: [...draftIds],
    confidence: 'low',
    iterations,
    totalCostUsd: costUsd,
    terminationReason: reason,
    trace,
  };
}
