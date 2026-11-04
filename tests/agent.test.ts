import { chatResponse, toolCall } from './helpers/mocks';
import { runAgent } from '../src/agents/executor';
import { appEvents } from '../src/lib/events';

const { fire, findAll, count, captureTasks } = vi.hoisted(() => ({
  fire: vi.fn(),
  findAll: vi.fn(),
  count: vi.fn(),
  captureTasks: vi.fn(),
}));
vi.mock('../src/lib/http/ai.breaker', () => ({ aiBreaker: { fire } }));
vi.mock('../src/lib/prisma', () => ({ prisma: { usageLog: { create: vi.fn(async () => ({})) } } }));
vi.mock('../src/lib/cache', async () => ((await vi.importActual('./helpers/mocks')) as typeof import('./helpers/mocks')).cacheModuleMock());
vi.mock('../src/services/mcp.service', () => ({
  AIUnavailableError: class extends Error {},
  enforceBudget: vi.fn(async () => undefined),
  trackCost: vi.fn(async () => undefined),
  resolvePrompt: vi.fn(async () => ({ content: 'AGENT PROMPT', version: 'v1' })),
}));
vi.mock('../src/services/preferences.service', () => ({
  getPreferences: vi.fn(async () => ({ timezone: 'UTC' })),
}));

vi.mock('../src/repositories/task.repository', () => ({ taskRepository: { findAll, count } }));
vi.mock('../src/services/capture.service', () => ({ captureTasks }));
vi.mock('../src/services/search.service', () => ({ searchTasks: vi.fn() }));
vi.mock('../src/services/digest.service', () => ({ computeDigestData: vi.fn() }));
vi.mock('../src/services/project.service', () => ({ listProjects: vi.fn(async () => []) }));

const overdueTask = {
  id: 't1', title: 'Pay invoice', status: 'todo', priority: 'high',
  dueDate: new Date('2026-10-30T12:00:00Z'), project: { name: 'Admin' },
};

describe('task assistant agent', () => {
  beforeEach(() => {
    fire.mockReset();
    captureTasks.mockReset();
  });

  it('calls a tool, feeds the result back, and returns the final answer', async () => {
    findAll.mockResolvedValue([overdueTask]);
    count.mockResolvedValue(1);
    fire
      .mockResolvedValueOnce(chatResponse({ tool_calls: [toolCall('get_overdue_tasks', {}, 'call_1')] }))
      .mockResolvedValueOnce(chatResponse({
        tool_calls: [toolCall('final_answer', {
          answer: 'One task is overdue: "Pay invoice".', taskIds: ['t1'], confidence: 'high',
        })],
      }));

    const completed = vi.fn();
    appEvents.once('agent:completed', completed);

    const result = await runAgent({ message: 'what is overdue?', userId: 'u1', correlationId: 'c1' });

    expect(result).toMatchObject({
      answer: 'One task is overdue: "Pay invoice".',
      taskIds: ['t1'],
      confidence: 'high',
      terminationReason: 'completed',
      iterations: 2,
    });
    // The tool result went back to the model as a tool message
    const secondCall = fire.mock.calls[1]![1];
    const toolMsg = secondCall.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('call_1');
    expect(JSON.parse(toolMsg.content)).toMatchObject({ total: 1, tasks: [{ id: 't1', due: '2026-10-30 12:00', project: 'Admin' }] });
    // The ownership filter comes from the context, never from the model
    expect(findAll.mock.calls[0]![0]).toMatchObject({ userId: 'u1' });
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', toolsUsed: ['get_overdue_tasks', 'final_answer'] }));
  });

  it('creates drafts (never tasks) and reports the drafts it really made', async () => {
    captureTasks.mockResolvedValue({
      results: [{ draft: { id: 'd1', parsed: { title: 'Call Bo', dueDate: '2026-11-03', priority: 'medium' }, ambiguities: [] } }],
    });
    fire
      .mockResolvedValueOnce(chatResponse({ tool_calls: [toolCall('create_task', { text: 'call Bo tomorrow' })] }))
      .mockResolvedValueOnce(chatResponse({
        tool_calls: [toolCall('final_answer', {
          answer: 'Drafted "Call Bo" for tomorrow; confirm it to save.', draftIds: ['d1', 'fake'], confidence: 'high',
        })],
      }));

    const result = await runAgent({ message: 'add call Bo tomorrow', userId: 'u1', correlationId: 'c1' });

    expect(captureTasks).toHaveBeenCalledWith(expect.objectContaining({ autoConfirm: false, source: 'assistant', userId: 'u1' }));
    expect(result.draftIds).toEqual(['d1']);
  });

  it('reports bad tool calls back to the model instead of crashing', async () => {
    fire
      .mockResolvedValueOnce(chatResponse({
        tool_calls: [
          toolCall('delete_everything', {}, 'call_x'),
          toolCall('get_upcoming_tasks', { days: 999 }, 'call_y'),
          toolCall('search_tasks', '{broken', 'call_z'),
        ],
      }))
      .mockResolvedValueOnce(chatResponse({ tool_calls: [toolCall('final_answer', { answer: 'Sorry.', confidence: 'low' })] }));

    const result = await runAgent({ message: 'hi', userId: 'u1', correlationId: 'c1' });

    const toolMsgs = fire.mock.calls[1]![1].messages.filter((m: any) => m.role === 'tool');
    expect(toolMsgs.map((m: any) => m.content.split(':')[0])).toEqual(['Error', 'Validation error', 'Error']);
    expect(result.terminationReason).toBe('completed');
  });

  it('stops at the iteration limit with a low-confidence answer', async () => {
    findAll.mockResolvedValue([]);
    count.mockResolvedValue(0);
    fire.mockResolvedValue(chatResponse({ tool_calls: [toolCall('get_overdue_tasks', {})] }));

    const result = await runAgent({
      message: 'loop forever', userId: 'u1', correlationId: 'c1', config: { maxIterations: 3 },
    });

    expect(fire).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ terminationReason: 'iteration_limit', confidence: 'low', iterations: 3 });
  });

  it('stops at the cost ceiling', async () => {
    findAll.mockResolvedValue([]);
    count.mockResolvedValue(0);
    fire.mockResolvedValue(chatResponse({ tool_calls: [toolCall('get_overdue_tasks', {})] }));

    const result = await runAgent({
      message: 'expensive', userId: 'u1', correlationId: 'c1', config: { costCeilingUsd: 0.000001 },
    });

    expect(fire).toHaveBeenCalledTimes(1);
    expect(result.terminationReason).toBe('cost_limit');
  });
});
