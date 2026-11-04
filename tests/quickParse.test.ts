import { quickParse } from '../src/lib/quickParse';

// Monday 2 Nov 2026, 10:00 UTC
const NOW = new Date('2026-11-02T10:00:00Z');
const parse = (input: string, tz = 'UTC') => quickParse(input, NOW, tz);

describe('quickParse (AI-unavailable fallback)', () => {
  it('strips lead-ins and keeps the task as the title', () => {
    expect(parse('remind me to follow up with the vendor').title).toBe('Follow up with the vendor');
  });

  it('resolves relative dates and removes them from the title', () => {
    expect(parse('call mom tomorrow')).toMatchObject({ title: 'Call mom', dueDate: '2026-11-03' });
    expect(parse('submit report today').dueDate).toBe('2026-11-02');
    expect(parse('renew passport in 10 days').dueDate).toBe('2026-11-12');
    expect(parse('pay invoice 2026-12-01').dueDate).toBe('2026-12-01');
  });

  it('reads weekdays: "friday" is this week, "next friday" is next week', () => {
    expect(parse('send deck friday').dueDate).toBe('2026-11-06');
    expect(parse('send deck next friday').dueDate).toBe('2026-11-13');
    // Said on a Monday, "monday" means a week out, not today
    expect(parse('team sync monday').dueDate).toBe('2026-11-09');
  });

  it('reads vague ranges as their last workday and flags the assumption', () => {
    const result = parse('follow up with the vendor sometime next week');
    expect(result.title).toBe('Follow up with the vendor');
    expect(result.dueDate).toBe('2026-11-13');
    expect(result.ambiguities.some(a => a.includes('Next week'))).toBe(true);
  });

  it('uses the user\'s timezone for "today"', () => {
    // 10:00 UTC Monday is already midnight Tuesday in Kiritimati (UTC+14)
    expect(parse('water plants today', 'Pacific/Kiritimati').dueDate).toBe('2026-11-03');
  });

  it('picks up priority words and hashtags', () => {
    expect(parse('fix prod login ASAP')).toMatchObject({ title: 'Fix prod login', priority: 'urgent' });
    expect(parse('learn rust someday').priority).toBe('low');
    expect(parse('book flights #travel #Family')).toMatchObject({ title: 'Book flights', tags: ['travel', 'family'] });
    expect(parse('buy milk').priority).toBe('medium');
  });

  it('always reports low confidence so the draft is reviewed', () => {
    const result = parse('buy milk');
    expect(result.dueDate).toBeNull();
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.ambiguities).toContain('Parsed without AI; please check the details.');
  });
});
