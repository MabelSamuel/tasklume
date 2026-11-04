import {
  addDaysToKey,
  endOfLocalDay,
  isoWeekKey,
  localDateKey,
  parseLocalDue,
  startOfLocalDay,
  zonedParts,
  zonedToUtc,
} from '../src/lib/dates';

describe('timezone helpers', () => {
  // 23:30 UTC on Mon 2 Nov is already Tue 3 Nov in Lagos (UTC+1)
  const lateMonday = new Date('2026-11-02T23:30:00Z');

  it('reads the local calendar date, not the server one', () => {
    expect(localDateKey(lateMonday, 'UTC')).toBe('2026-11-02');
    expect(localDateKey(lateMonday, 'Africa/Lagos')).toBe('2026-11-03');
    expect(zonedParts(lateMonday, 'Africa/Lagos')).toMatchObject({ hour: 0, minute: 30, weekday: 2 });
  });

  it('converts wall-clock time to UTC', () => {
    expect(zonedToUtc(2026, 11, 3, 9, 0, 'Africa/Lagos').toISOString()).toBe('2026-11-03T08:00:00.000Z');
    expect(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc(2026, 12, 1, 9, 0, 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z');
  });

  it('handles the day DST ends (25-hour day)', () => {
    // US DST ends Sun 1 Nov 2026
    const start = startOfLocalDay(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    const end = endOfLocalDay(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });

  it('treats a bare due date as end of that local day', () => {
    expect(parseLocalDue('2026-11-09', 'Africa/Lagos')!.toISOString()).toBe('2026-11-09T22:59:59.999Z');
    expect(parseLocalDue('2026-11-09T15:30', 'UTC')!.toISOString()).toBe('2026-11-09T15:30:00.000Z');
    expect(parseLocalDue('next week', 'UTC')).toBeNull();
  });

  it('does calendar arithmetic across month and year ends', () => {
    expect(addDaysToKey('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('computes ISO week keys', () => {
    expect(isoWeekKey(new Date('2026-11-02T12:00:00Z'), 'UTC')).toBe('2026-W45');
    // 1 Jan 2027 is a Friday, so it belongs to the last week of 2026
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'), 'UTC')).toBe('2026-W53');
  });
});
