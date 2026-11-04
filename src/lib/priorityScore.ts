// Deterministic urgency score. The AI prioritizer starts from it (and is
// told so), and it IS the ranking when the AI is unavailable. Every point
// comes with a human-readable factor so fallback suggestions still explain
// themselves.

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface ScorableTask {
  id: string;
  priority: Priority;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
  projectId: string | null;
}

export interface ScoredTask<T extends ScorableTask> {
  task: T;
  score: number;
  factors: string[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const PRIORITY_POINTS: Record<Priority, number> = {
  urgent: 40,
  high: 25,
  medium: 12,
  low: 4,
};

// Bounds on user-configured project weights so one setting can't zero out or
// swamp everything else
export const MIN_PROJECT_WEIGHT = 0.5;
export const MAX_PROJECT_WEIGHT = 2;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function scoreTask<T extends ScorableTask>(
  task: T,
  now: Date,
  projectWeights: Record<string, number> = {},
): ScoredTask<T> {
  const factors: string[] = [];
  let score = PRIORITY_POINTS[task.priority];
  if (task.priority === 'urgent' || task.priority === 'high') {
    factors.push(`Marked ${task.priority}`);
  }

  if (task.dueDate) {
    const msLeft = task.dueDate.getTime() - now.getTime();
    if (msLeft < 0) {
      const daysOver = Math.floor(-msLeft / DAY_MS);
      score += 50 + Math.min(daysOver * 2, 20);
      factors.push(daysOver === 0 ? 'Overdue' : `Overdue by ${plural(daysOver, 'day')}`);
    } else if (msLeft <= DAY_MS) {
      score += 40;
      factors.push('Due within 24 hours');
    } else if (msLeft <= 3 * DAY_MS) {
      score += 25;
      factors.push('Due within 3 days');
    } else if (msLeft <= 7 * DAY_MS) {
      score += 12;
      factors.push('Due this week');
    } else {
      score += 4;
    }
  }

  if (task.status === 'in_progress') {
    score += 5;
    factors.push('Already in progress');
  }

  // Old tasks slowly gain weight so low-priority work isn't starved forever
  const ageDays = Math.floor((now.getTime() - task.createdAt.getTime()) / DAY_MS);
  if (ageDays >= 14) {
    score += Math.min(ageDays * 0.5, 10);
    factors.push(`Waiting ${plural(ageDays, 'day')}`);
  }

  const rawWeight = task.projectId ? projectWeights[task.projectId] : undefined;
  if (rawWeight !== undefined && rawWeight !== 1) {
    const weight = Math.min(Math.max(rawWeight, MIN_PROJECT_WEIGHT), MAX_PROJECT_WEIGHT);
    score *= weight;
    factors.push(weight > 1 ? 'Project you weighted higher' : 'Project you weighted lower');
  }

  return { task, score: Math.round(score * 10) / 10, factors };
}

export function rankTasks<T extends ScorableTask>(
  tasks: T[],
  now: Date,
  projectWeights: Record<string, number> = {},
): ScoredTask<T>[] {
  return tasks
    .map(t => scoreTask(t, now, projectWeights))
    // Ties: earlier due date first, then older task first
    .sort((a, b) =>
      b.score - a.score ||
      (a.task.dueDate?.getTime() ?? Infinity) - (b.task.dueDate?.getTime() ?? Infinity) ||
      a.task.createdAt.getTime() - b.task.createdAt.getTime());
}

// Fallback-only rule: nudge low/medium tasks that are about to be missed up
// to high. Everything else keeps the priority the user chose.
export function heuristicPriority(scored: ScoredTask<ScorableTask>, now: Date): Priority {
  const { task } = scored;
  const dueSoon = task.dueDate !== null && task.dueDate.getTime() - now.getTime() <= DAY_MS;
  if (dueSoon && (task.priority === 'low' || task.priority === 'medium')) {
    return 'high';
  }
  return task.priority;
}
