// Ported from Brainiac (the alfie repo, engine/src/life/); keep the two in step.
// --- life-schedule.mjs -----------------------------------------------------------------
// When life-admin things come round again. Reads the `Repeats:` words people and AIs write ("every 3 months",
// "every year on April 15, June 15", "every year on the 2nd Sunday of May", "once"), says them back the same way,
// and works out the next date after something is done, skipped or set up. Dates are "YYYY-MM-DD" strings; no clock,
// no time zone: the caller passes the brain's own today.
// ---------------------------------------------------------------------------

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december'];
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UNITS = ['day', 'week', 'month', 'year'];
// A 5th weekday is not in every month, so it can't be a yearly date: "last" is the way to say it.
const NTH = { '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4, last: -1 };
const NTH_WORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', '-1': 'last' };
const SHORT = { daily: [1, 'day'], weekly: [1, 'week'], fortnightly: [2, 'week'], biweekly: [2, 'week'],
  monthly: [1, 'month'], quarterly: [3, 'month'], 'twice a year': [6, 'month'], 'twice yearly': [6, 'month'],
  'half-yearly': [6, 'month'], 'semi-annually': [6, 'month'], yearly: [1, 'year'], annually: [1, 'year'],
  'every day': [1, 'day'], 'every week': [1, 'week'], 'every other week': [2, 'week'], 'every month': [1, 'month'],
  'every other month': [2, 'month'], 'every year': [1, 'year'], 'every other year': [2, 'year'] };
export const REPEATS_HELP = 'Try "every 3 months", "every month on the 15th", "every year on April 15", '
  + '"every year on the 2nd Sunday of May", "every year on Easter" or "once".';

// --- Dates ---
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();      // m is 1-12
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
const parts = (date) => date.split('-').map(Number);
const DAY_MS = 86400000;
export const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`))
  / DAY_MS);
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
// A real calendar day. The shape is checked first: a month 13 or a day 00 would make the Date throw.
export const isDate = (d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d || '')
  && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

function addMonths(date, n) {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  return ymd(Math.floor(total / 12), (total % 12) + 1, d);
}
export function addInterval(date, n, unit) {
  if (unit === 'day') return addDays(date, n);
  if (unit === 'week') return addDays(date, 7 * n);
  if (unit === 'month') return addMonths(date, n);
  return addMonths(date, 12 * n);
}

// The nth weekday of a month (nth -1 = the last one).
function nthWeekday(y, m, nth, wd) {
  if (nth === -1) {
    const last = ymd(y, m, 31);
    return addDays(last, -((weekday(last) - wd + 7) % 7));
  }
  const first = ymd(y, m, 1);
  const day = 1 + ((wd - weekday(first) + 7) % 7) + 7 * (nth - 1);
  return day > lastDay(y, m) ? null : ymd(y, m, day);
}

// Western Easter Sunday (the anonymous Gregorian computus).
export function easter(y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return ymd(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}

// A weekend date moved to the Monday after (tax days and the like).
export const nextWeekday = (date) => ({ 6: addDays(date, 2), 0: addDays(date, 1) }[weekday(date)] || date);

// --- Reading and saying the words ---
function monthOf(word) {
  const w = String(word || '').toLowerCase().replace(/\.$/, '');
  const i = MONTHS.findIndex((m) => m === w || (w.length >= 3 && m.startsWith(w)));
  return i < 0 ? 0 : i + 1;
}
function readDate(bit) {
  const s = bit.trim().replace(/(\d)(st|nd|rd|th)\b/, '$1');
  let m = /^([a-z.]+)\s+(\d{1,2})$/.exec(s);
  if (m && monthOf(m[1])) return [monthOf(m[1]), Number(m[2])];
  m = /^(\d{1,2})\s+([a-z.]+)$/.exec(s);
  if (m && monthOf(m[2])) return [monthOf(m[2]), Number(m[1])];
  m = /^(\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}
const validDay = ([m, d]) => m >= 1 && m <= 12 && d >= 1 && d <= lastDay(2024, m);     // 2024: Feb 29 is fine

// The words -> a rule, or null when they can't be read.
// { type: 'once' } | { type: 'interval', n, unit } | { type: 'monthday', day } | { type: 'dates', dates: [[m, d]] }
// | { type: 'nth', nth, weekday, month } | { type: 'easter' }
export function parseRepeats(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^(once|one time|one-off|just once|does not repeat|doesn't repeat)$/.test(s)) return { type: 'once' };
  if (SHORT[s]) return { type: 'interval', n: SHORT[s][0], unit: SHORT[s][1] };
  let m = /^every (\d{1,3}) (day|week|month|year)s?$/.exec(s);
  if (m) return Number(m[1]) >= 1 ? { type: 'interval', n: Number(m[1]), unit: m[2] } : null;
  m = /^(?:every month|monthly) on the (\d{1,2})(?:st|nd|rd|th)?(?: of the month)?$/.exec(s);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 31 ? { type: 'monthday', day: Number(m[1]) } : null;
  m = /^(?:every year|yearly|annually) on (.+)$/.exec(s);
  if (!m) return null;
  const rest = m[1].replace(/^the /, 'the ');
  if (/^easter( sunday)?$/.test(rest)) return { type: 'easter' };
  const nth = /^the (\S+) (\w+) (?:of|in) (\w+)$/.exec(rest);
  if (nth) {
    const n = NTH[nth[1]];
    const wd = WEEKDAYS.indexOf(nth[2].replace(/s$/, ''));
    const month = monthOf(nth[3]);
    return n && wd >= 0 && month ? { type: 'nth', nth: n, weekday: wd, month } : null;
  }
  const dates = rest.split(/\s*(?:,|\band\b)\s*/).filter(Boolean).map(readDate);
  if (!dates.length || dates.some((d) => !d || !validDay(d))) return null;
  const seen = new Set();
  return { type: 'dates', dates: dates.filter(([mm, dd]) => !seen.has(`${mm}-${dd}`) && seen.add(`${mm}-${dd}`)) };
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const ordinal = (d) => `${d}${[11, 12, 13].includes(d % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th')}`;

// A rule -> the words the brain keeps, the same however it was typed.
export function describeRepeats(rule) {
  if (!rule) return '';
  if (rule.type === 'once') return 'once';
  if (rule.type === 'interval') return rule.n === 1 ? `every ${rule.unit}` : `every ${rule.n} ${rule.unit}s`;
  if (rule.type === 'monthday') return `every month on the ${ordinal(rule.day)}`;
  if (rule.type === 'easter') return 'every year on Easter';
  if (rule.type === 'nth') {
    return `every year on the ${NTH_WORD[rule.nth]} ${cap(WEEKDAYS[rule.weekday])} of ${cap(MONTHS[rule.month - 1])}`;
  }
  return `every year on ${rule.dates.map(([m, d]) => `${cap(MONTHS[m - 1])} ${d}`).join(', ')}`;
}

// Fixed rules follow the calendar; an interval can count from the last time it was done instead.
export const isCalendarRule = (rule) => !!rule && !['interval', 'once'].includes(rule.type);

// --- The dates a rule falls on ---
function datesInYear(rule, y) {
  if (rule.type === 'easter') return [easter(y)];
  if (rule.type === 'nth') return [nthWeekday(y, rule.month, rule.nth, rule.weekday)].filter(Boolean);
  if (rule.type === 'dates') return rule.dates.map(([m, d]) => ymd(y, m, d)).sort();
  if (rule.type === 'monthday') return Array.from({ length: 12 }, (_, i) => ymd(y, i + 1, rule.day));
  return [];
}

// The first date on or after `from` that a calendar rule falls on (moved off a weekend when asked).
export function nextOnOrAfter(rule, from, { weekdays = false } = {}) {
  if (!isCalendarRule(rule) || !isDate(from)) return null;
  const y = parts(from)[0];
  for (let year = y - 1; year <= y + 2; year++) {
    for (const raw of datesInYear(rule, year)) {
      const d = weekdays ? nextWeekday(raw) : raw;
      if (d >= from) return d;
    }
  }
  return null;
}

// The first date after `after` on an interval counted from `start`. Every date is worked out from the start
// itself, so a 31st kept short in February is the 31st again in March, and a date moved off a weekend doesn't
// carry the move on. Jumps close to the answer first, so a daily thing years behind is still quick.
export function stepAfter(start, n, unit, after, { weekdays = false } = {}) {
  const at = (k) => { const d = addInterval(start, k * n, unit); return weekdays ? nextWeekday(d) : d; };
  const span = { day: 1, week: 7, month: 30.44, year: 365.25 }[unit] * n;
  let k = Math.max(1, Math.floor(daysBetween(start, after) / span) - 1);
  while (at(k) <= after) k++;
  return at(k);
}

// The next date once this time is done on `done`. null when it doesn't come round again (once).
// After done: counted from the day it was done. Fixed: the next date after the one that was due, so a bill paid
// late still leaves the next one showing (November's rent doesn't vanish because October's was paid in November),
// and one paid early doesn't come back the same month. `start` is where a fixed interval counts from.
export function nextAfterDone({ rule, anchor = 'fixed', due = null, done, start = null, weekdays = false }) {
  if (!rule || rule.type === 'once') return null;
  if (rule.type === 'interval') {
    if (anchor === 'after done' || !due) return addInterval(done, rule.n, rule.unit);
    return stepAfter(isDate(start) && start <= due ? start : due, rule.n, rule.unit, due, { weekdays });
  }
  return nextOnOrAfter(rule, addDays(due || done, 1), { weekdays });
}

// The next date when this time is passed over without doing it.
export function nextAfterSkip({ rule, anchor = 'fixed', due, start = null, weekdays = false }) {
  if (!rule || rule.type === 'once' || !due) return null;
  if (rule.type === 'interval') {
    if (anchor === 'after done') return addInterval(due, rule.n, rule.unit);
    return stepAfter(isDate(start) && start <= due ? start : due, rule.n, rule.unit, due, { weekdays });
  }
  return nextOnOrAfter(rule, addDays(due, 1), { weekdays });
}

// The first date for something new: the next calendar date; for an interval, one interval after it was last done,
// else `today`. null for "once" (it needs a date given).
export function firstDue({ rule, lastDone = null, today, weekdays = false }) {
  if (!rule || rule.type === 'once') return null;
  if (rule.type === 'interval') return lastDone ? addInterval(lastDone, rule.n, rule.unit) : today;
  return nextOnOrAfter(rule, today, { weekdays });
}

// --- How far ahead it shows ---
// "7 days before", "2 weeks", "3 months before", "on the day", "1 day" -> days (months count 30). null if unread.
export function parseLead(text) {
  const s = String(text ?? '').toLowerCase().trim();
  if (!s) return null;
  if (/^(on the day|same day|0|none)$/.test(s)) return 0;
  const m = /^(\d{1,3})\s*(day|week|month)s?(?:\s+(?:before|ahead|early))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * { day: 1, week: 7, month: 30 }[m[2]];
}
export function describeLead(days) {
  if (!days) return 'on the day';
  if (days % 30 === 0) return `${days / 30} month${days === 30 ? '' : 's'} before`;
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? '' : 's'} before`;
  return `${days} day${days === 1 ? '' : 's'} before`;
}

// Where something stands today: needs-date, late (past its date), soon (inside its reminder window) or later.
export function standing(due, lead, today) {
  if (!isDate(due)) return 'needs-date';
  if (due < today) return 'late';
  return addDays(due, -(lead || 0)) <= today ? 'soon' : 'later';
}

export { UNITS };
