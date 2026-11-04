import { addDaysToKey, localDateKey, zonedParts } from './dates';

// Rule-based capture parser: the fallback when the AI is unavailable, so
// capture still works (with low confidence, and always as a draft to review).
// Handles the common phrases only; anything it doesn't recognise stays in the title.

export interface QuickParseResult {
  title: string;
  dueDate: string | null;   // Local 'YYYY-MM-DD'
  priority: 'low' | 'medium' | 'high' | 'urgent';
  tags: string[];
  confidence: number;
  ambiguities: string[];
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const LEAD_INS = /^(?:please\s+)?(?:remind me to|remember to|i need to|i have to|i should|need to|todo:?|task:?)\s+/i;

const PRIORITY_RULES: { pattern: RegExp; priority: QuickParseResult['priority'] }[] = [
  { pattern: /\b(?:urgent(?:ly)?|asap|immediately|critical)\b!*/i, priority: 'urgent' },
  { pattern: /\b(?:high priority|important)\b/i, priority: 'high' },
  { pattern: /\b(?:low priority|someday|eventually|if i have time|whenever)\b/i, priority: 'low' },
];

interface DateRule {
  pattern: RegExp;
  resolve: (match: RegExpExecArray, today: string, weekday: number) => string;
  note?: string;
}

// "friday" = the coming Friday (a week out if today is Friday).
// "next friday" = Friday of NEXT week (Mon-Sun), so said on a Monday it's 11 days out.
function nextWeekday(today: string, weekday: number, target: number, nextWeek: boolean): string {
  let delta = ((target - weekday + 7) % 7) || 7;
  const daysLeftThisWeek = 6 - ((weekday + 6) % 7);
  if (nextWeek && delta <= daysLeftThisWeek) delta += 7;
  return addDaysToKey(today, delta);
}

// Order matters: longer phrases first so "next friday" beats "friday"
const DATE_RULES: DateRule[] = [
  {
    pattern: /\b(?:on |by )?(\d{4}-\d{2}-\d{2})\b/i,
    resolve: (m) => m[1]!,
  },
  {
    pattern: /\b(?:sometime |by |by the )?end of (?:the |this )?week\b/i,
    resolve: (_m, today, wd) => addDaysToKey(today, (5 - wd + 7) % 7),
    note: '"End of week" read as this Friday.',
  },
  {
    pattern: /\b(?:sometime |by )?next week\b/i,
    resolve: (_m, today, wd) => addDaysToKey(today, ((5 - wd + 7) % 7) + 7),
    note: '"Next week" read as next Friday, the last workday of that week.',
  },
  {
    pattern: /\b(?:by |on )?next (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    resolve: (m, today, wd) => nextWeekday(today, wd, WEEKDAY_NAMES.indexOf(m[1]!.toLowerCase()), true),
    note: '"Next <day>" read as that day of next week.',
  },
  {
    pattern: /\b(?:by |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    resolve: (m, today, wd) => nextWeekday(today, wd, WEEKDAY_NAMES.indexOf(m[1]!.toLowerCase()), false),
  },
  {
    pattern: /\bin (\d{1,3}) days?\b/i,
    resolve: (m, today) => addDaysToKey(today, Number(m[1])),
  },
  {
    pattern: /\b(?:by |by the )?(?:day after tomorrow)\b/i,
    resolve: (_m, today) => addDaysToKey(today, 2),
  },
  {
    pattern: /\b(?:by )?tomorrow\b/i,
    resolve: (_m, today) => addDaysToKey(today, 1),
  },
  {
    pattern: /\b(?:by )?(?:today|tonight|this evening)\b/i,
    resolve: (_m, today) => today,
  },
];

function cleanTitle(text: string): string {
  const cleaned = text
    .replace(LEAD_INS, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .trim();
  const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return title.length > 120 ? `${title.slice(0, 117).trimEnd()}...` : title;
}

export function quickParse(input: string, now: Date, timeZone: string): QuickParseResult {
  let text = input.trim();
  const ambiguities: string[] = [];

  // #hashtags become tags
  const tags = [...text.matchAll(/(?:^|\s)#([\w-]{1,30})/g)]
    .map(m => m[1]!.toLowerCase())
    .slice(0, 5);
  text = text.replace(/(?:^|\s)#[\w-]{1,30}/g, ' ');

  let priority: QuickParseResult['priority'] = 'medium';
  for (const rule of PRIORITY_RULES) {
    if (rule.pattern.test(text)) {
      priority = rule.priority;
      text = text.replace(rule.pattern, ' ');
      break;
    }
  }

  const today = localDateKey(now, timeZone);
  const weekday = zonedParts(now, timeZone).weekday;
  let dueDate: string | null = null;
  for (const rule of DATE_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      dueDate = rule.resolve(match, today, weekday);
      if (rule.note) ambiguities.push(rule.note);
      text = text.replace(match[0], ' ');
      break;
    }
  }

  const title = cleanTitle(text) || cleanTitle(input);
  ambiguities.push('Parsed without AI; please check the details.');

  return {
    title,
    dueDate,
    priority,
    tags,
    // Rules never know the project and miss most phrasing, so never auto-confirm
    confidence: 0.3,
    ambiguities,
  };
}
