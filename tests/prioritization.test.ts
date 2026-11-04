import { mergeRanking } from '../src/services/prioritization.service';
import { rankTasks } from '../src/lib/priorityScore';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/cache', async () => ((await vi.importActual('./helpers/mocks')) as typeof import('./helpers/mocks')).cacheModuleMock());
vi.mock('../src/services/mcp.service', () => ({ mcpCompleteWithTool: vi.fn() }));

const NOW = new Date('2026-11-02T10:00:00Z');
const DAY = 86_400_000;

function task(id: string, priority: 'low' | 'medium' | 'high' | 'urgent', dueInDays: number | null) {
  return {
    id, title: `Task ${id}`, priority, status: 'todo' as const, projectId: null,
    dueDate: dueInDays === null ? null : new Date(NOW.getTime() + dueInDays * DAY),
    createdAt: new Date(NOW.getTime() - DAY),
  } as any;
}

describe('mergeRanking (AI ranking ∪ heuristic)', () => {
  const scored = rankTasks([task('a', 'low', 1), task('b', 'medium', null), task('c', 'high', 5)], NOW);

  it('keeps the model order and reasons for known ids', () => {
    const items = mergeRanking(scored, [
      { taskId: 'c', rank: 1, suggestedPriority: 'urgent', reason: 'Blocks the launch' },
      { taskId: 'a', rank: 2, suggestedPriority: 'low', reason: 'Quick win' },
      { taskId: 'b', rank: 3, suggestedPriority: 'medium', reason: 'No deadline' },
    ], NOW);

    expect(items.map(i => [i.taskId, i.rank, i.suggestedPriority])).toEqual([
      ['c', 1, 'urgent'], ['a', 2, 'low'], ['b', 3, 'medium'],
    ]);
    expect(items[0]).toMatchObject({ currentPriority: 'high', reason: 'Blocks the launch' });
  });

  it('drops invented and duplicate ids, appends skipped tasks in heuristic order', () => {
    const items = mergeRanking(scored, [
      { taskId: 'ghost', rank: 1, suggestedPriority: 'urgent', reason: 'Made up' },
      { taskId: 'b', rank: 2, suggestedPriority: 'high', reason: 'Goal-aligned' },
      { taskId: 'b', rank: 3, suggestedPriority: 'low', reason: 'Duplicate' },
    ], NOW);

    expect(items.map(i => i.taskId)).toEqual(['b', ...scored.map(s => s.task.id).filter(id => id !== 'b')]);
    expect(items.map(i => i.rank)).toEqual([1, 2, 3]);
    expect(items[0]!.reason).toBe('Goal-aligned');
    // Appended tasks explain themselves from the heuristic factors
    expect(items.find(i => i.taskId === 'a')!.reason).toContain('Due within');
  });
});
