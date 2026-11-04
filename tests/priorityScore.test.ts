import { heuristicPriority, rankTasks, scoreTask, ScorableTask } from '../src/lib/priorityScore';

const NOW = new Date('2026-11-02T10:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function task(overrides: Partial<ScorableTask> & { id: string }): ScorableTask {
  return {
    priority: 'medium',
    status: 'todo',
    dueDate: null,
    createdAt: new Date(NOW.getTime() - DAY),
    projectId: null,
    ...overrides,
  };
}

describe('priority score', () => {
  it('ranks overdue above due-soon above undated', () => {
    const ranked = rankTasks([
      task({ id: 'undated', priority: 'high' }),
      task({ id: 'soon', dueDate: new Date(NOW.getTime() + 5 * HOUR) }),
      task({ id: 'overdue', dueDate: new Date(NOW.getTime() - 3 * DAY) }),
    ], NOW);

    expect(ranked.map(r => r.task.id)).toEqual(['overdue', 'soon', 'undated']);
    expect(ranked[0]!.factors).toContain('Overdue by 3 days');
    expect(ranked[1]!.factors).toContain('Due within 24 hours');
  });

  it('explains every point it adds', () => {
    const { factors } = scoreTask(
      task({ id: 'a', priority: 'urgent', status: 'in_progress', createdAt: new Date(NOW.getTime() - 20 * DAY) }),
      NOW,
    );
    expect(factors).toEqual(['Marked urgent', 'Already in progress', 'Waiting 20 days']);
  });

  it('applies user project weights, clamped to 0.5–2', () => {
    const base = scoreTask(task({ id: 'a', projectId: 'p' }), NOW).score;
    expect(scoreTask(task({ id: 'a', projectId: 'p' }), NOW, { p: 1.5 }).score).toBeCloseTo(base * 1.5);
    expect(scoreTask(task({ id: 'a', projectId: 'p' }), NOW, { p: 99 }).score).toBeCloseTo(base * 2);
    expect(scoreTask(task({ id: 'a', projectId: 'p' }), NOW, { p: 0 }).score).toBeCloseTo(base * 0.5);
  });

  it('breaks ties by earlier due date', () => {
    const ranked = rankTasks([
      task({ id: 'later', dueDate: new Date(NOW.getTime() + 20 * DAY) }),
      task({ id: 'earlier', dueDate: new Date(NOW.getTime() + 10 * DAY) }),
    ], NOW);
    expect(ranked.map(r => r.task.id)).toEqual(['earlier', 'later']);
  });

  it('fallback only bumps low/medium tasks that are about to be missed', () => {
    const [soonLow] = rankTasks([task({ id: 'a', priority: 'low', dueDate: new Date(NOW.getTime() + 2 * HOUR) })], NOW);
    const [farLow] = rankTasks([task({ id: 'b', priority: 'low', dueDate: new Date(NOW.getTime() + 9 * DAY) })], NOW);
    const [soonUrgent] = rankTasks([task({ id: 'c', priority: 'urgent', dueDate: new Date(NOW.getTime() + HOUR) })], NOW);

    expect(heuristicPriority(soonLow!, NOW)).toBe('high');
    expect(heuristicPriority(farLow!, NOW)).toBe('low');
    expect(heuristicPriority(soonUrgent!, NOW)).toBe('urgent');
  });
});
