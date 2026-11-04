import { z } from 'zod';
import { chatResponse, toolCall } from './helpers/mocks';
import { mcpCompleteWithTool } from '../src/services/mcp.service';
import { cacheRedis } from '../src/lib/cache';

const { fire, prismaMock } = vi.hoisted(() => ({
  fire: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn(async () => ({ tier: 'free' })) },
    promptTemplate: { findFirst: vi.fn(async () => null) },
    usageLog: { create: vi.fn(async () => ({})), aggregate: vi.fn(async () => ({ _sum: { costUsd: 0 } })) },
    aIAuditLog: { create: vi.fn(async (_args: unknown) => ({})) },
  },
}));
vi.mock('../src/lib/http/ai.breaker', () => ({ aiBreaker: { fire } }));
vi.mock('../src/lib/cache', async () => ((await vi.importActual('./helpers/mocks')) as typeof import('./helpers/mocks')).cacheModuleMock());
vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }));

const tool = {
  name: 'create_task',
  description: 'test',
  parameters: z.object({ title: z.string().min(1), priority: z.enum(['low', 'high']) }),
};
const request = {
  taskType: 'capture' as const,
  userId: 'user-1',
  correlationId: 'corr-1',
  messages: [{ role: 'user', content: 'secret client note' }],
};

describe('AI gateway structured output', () => {
  beforeEach(() => {
    fire.mockReset();
    vi.mocked(cacheRedis.get).mockResolvedValue('0');
  });

  it('forces the tool call and keeps only schema-valid calls', async () => {
    fire.mockResolvedValue(chatResponse({
      tool_calls: [
        toolCall('create_task', { title: 'Call Ana', priority: 'high' }),
        toolCall('create_task', { title: '', priority: 'high' }),      // fails schema
        toolCall('create_task', '{not json'),                           // not JSON
        toolCall('other_tool', { title: 'x', priority: 'low' }),        // wrong tool
      ],
    }));

    const { calls, response } = await mcpCompleteWithTool(request, tool);

    expect(calls).toEqual([{ title: 'Call Ana', priority: 'high' }]);
    expect(response.promptVersion).toBe('default');
    expect(response.costUsd).toBeGreaterThan(0);

    const [path, body] = fire.mock.calls[0]!;
    expect(path).toBe('/chat/completions');
    expect(body.tool_choice).toBe('required');
    expect(body.tools[0].function.name).toBe('create_task');
    expect(body.messages[0].role).toBe('system');
  });

  it('throws when no call is valid, so callers use their fallback', async () => {
    fire.mockResolvedValue(chatResponse({ content: 'Sure! Here is your task.' }));
    await expect(mcpCompleteWithTool(request, tool)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' });
  });

  it('redacts task text in the audit log by default', async () => {
    fire.mockResolvedValue(chatResponse({ tool_calls: [toolCall('create_task', { title: 'a', priority: 'low' })] }));
    prismaMock.aIAuditLog.create.mockClear();

    await mcpCompleteWithTool(request, tool);

    const audit = (prismaMock.aIAuditLog.create.mock.calls[0] as any)[0].data;
    expect(audit.inputSummary).toBe('[redacted]');
    expect(audit.outputSummary).toBe('[redacted]');
    expect(audit.taskType).toBe('capture');
  });

  it('refuses before calling the model once the monthly budget is spent', async () => {
    vi.mocked(cacheRedis.get).mockResolvedValue('1.5'); // free tier = $1.00
    await expect(mcpCompleteWithTool(request, tool)).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(fire).not.toHaveBeenCalled();
  });
});
