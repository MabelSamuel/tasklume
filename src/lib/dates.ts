// Timezone-aware date helpers built on Intl, so "today", "overdue" and
// digest hours follow the user's clock rather than the server's.

const DAY_MS = 86_400_000;

export interface ZonedParts {
  year: number;
  month: number;   // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday ... 6 = Saturday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? 'Sun'),
  };
}

// How far the zone's wall clock is ahead of UTC at this instant
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds(), date.getUTCMilliseconds());
  return asUtc - date.getTime();
}

// Wall-clock time in a zone → the UTC instant. Re-checks the offset at the
// result so times next to a DST change land on the right side of it.
export function zonedToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, timeZone: string,
  second = 0, ms = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const first = offsetMs(new Date(guess), timeZone);
  const result = guess - first;
  const second_ = offsetMs(new Date(result), timeZone);
  return new Date(second_ === first ? result : guess - second_);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DD' for the date in the user's zone
export function localDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// ISO-8601 week key ('2026-W45') for the date in the user's zone
export function isoWeekKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday decides the year
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(
    ((d.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${isoYear}-W${pad(week)}`;
}

export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

export function endOfLocalDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedToUtc(p.year, p.month, p.day, 23, 59, timeZone, 59, 999);
}

// Calendar arithmetic on a 'YYYY-MM-DD' key (no time zone involved)
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const LOCAL_DUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

export function isLocalDueString(value: string): boolean {
  return LOCAL_DUE.test(value);
}

// AI and the rules parser emit local 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'.
// A date with no time means "by the end of that day".
export function parseLocalDue(value: string, timeZone: string): Date | null {
  const m = LOCAL_DUE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (h === undefined || mi === undefined) {
    return zonedToUtc(Number(y), Number(mo), Number(d), 23, 59, timeZone, 59, 999);
  }
  return zonedToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), timeZone);
}

// "Monday, 2026-11-02 14:05" — the CURRENT DATE line in AI prompts
export function describeNow(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date);
  return `${weekday}, ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (${timeZone})`;
}

// Snapshot format for tasks shown to the AI and in digests
export function formatLocal(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
