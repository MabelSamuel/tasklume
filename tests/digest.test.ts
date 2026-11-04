import { templateSummary } from '../src/services/digest.service';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/cache', async () => ((await vi.importActual('./helpers/mocks')) as typeof import('./helpers/mocks')).cacheModuleMock());
vi.mock('../src/services/mcp.service', () => ({ mcpComplete: vi.fn() }));

const snap = (title: string) => ({ id: title, title, priority: 'high', due: null, project: null });
const empty = { overdue: [], dueToday: [], atRisk: [], upcoming: [], completed: [] };

describe('template digest (AI-unavailable fallback)', () => {
  it('leads with overdue and at-risk work, using real counts and titles', () => {
    const text = templateSummary({
      period: 'daily',
      periodKey: '2026-11-02',
      stats: { overdue: 2, dueToday: 1, atRisk: 1, upcoming: 4, completed: 3, unscheduledHighPriority: 1, open: 9 },
      highlights: { ...empty, overdue: [snap('Pay invoice'), snap('Reply to Ana')], dueToday: [snap('Ship v2')], atRisk: [snap('Book venue')] },
    });

    expect(text).toMatch(/^2 tasks overdue, starting with "Pay invoice", "Reply to Ana"\./);
    expect(text).toContain('1 due today: "Ship v2".');
    expect(text).toContain('not started and due within 48 hours: "Book venue"');
    expect(text).toContain('4 coming up in the next 7 days.');
    expect(text).toContain('1 high-priority task with no due date.');
    expect(text).toContain('Completed yesterday: 3.');
  });

  it('says plainly when nothing is urgent', () => {
    const text = templateSummary({
      period: 'weekly',
      periodKey: '2026-W45',
      stats: { overdue: 0, dueToday: 0, atRisk: 0, upcoming: 0, completed: 0, unscheduledHighPriority: 0, open: 2 },
      highlights: empty,
    });
    expect(text).toBe('Nothing is overdue or at risk. Completed this week: 0.');
  });
});
