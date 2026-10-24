#!/usr/bin/env node
// --- brain-calendar.mjs ------------------------------------------------------
// The shared brain's calendar: one Markdown file, Calendar/events.md, that Grok
// and Claude both add dated events to and read from (MANIFESTO §5). It replaced
// the Google Calendar bus on 2026-10-23, at the user's direction.
//
// One line per event, under its month heading, in date order:
//   - 2026-10-30 09:30-10:00 Dentist @ Main St clinic (added by grok)
//   - 2026-11-02 School picture day (added by claude-code)
//   - 2026-11-20..2026-11-23 Trip to Chicago (added by grok)
// Times are 24-hour Eastern. A cancelled event is struck through, never deleted:
//   - ~~2026-10-30 09:30 Dentist~~ (cancelled by user via claude-code)
// Things to DO by a date stay in Reminders/; this file holds things that HAPPEN.
//
// A leaf module on purpose (no imports from the Librarian), so the Librarian can
// import it for the index without an import cycle.
//
//   node brain-calendar.mjs view
//   node brain-calendar.mjs add YYYY-MM-DD[..YYYY-MM-DD] "Title" [--time HH:MM[-HH:MM]] [--at "place"] [--by claude-code]
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Configuration ---
export const CALENDAR_FILE = 'Calendar/events.md';
const MAX_SPAN_DAYS = 60;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// --- Dates ---
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthStart = (date, offset) => { const [y, m] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10); };
const isDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;   // rejects 2026-13-01 and 2026-11-31
};
const padTime = (t) => (t ? t.padStart(5, '0') : null);
const isTime = (t) => !t || /^([01]\d|2[0-3]):[0-5]\d$/.test(padTime(t));

// --- Parsing ---
const LOOKS_LIKE_EVENT = /^-\s+\d{4}-\d/;
const EVENT_RE = /^-\s+(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?(?:\s+(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?)?\s+(.+?)\s*$/;
const BY_RE = /\s*\((?:added|moved|changed) by ([^)]+)\)\s*$/i;

// Returns { events, problems }. A line that starts like an event but cannot be read is a
// problem, never silently dropped, so the dashboard can say so. Fenced code is skipped:
// the file's own format notes may show example lines.
export function parseEvents(text) {
  const events = [];
  const problems = [];
  let fenced = false;
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('```')) { fenced = !fenced; return; }
    if (fenced || !LOOKS_LIKE_EVENT.test(line)) return;
    const m = EVENT_RE.exec(line);
    const bad = !m || !isDate(m[1]) || (m[2] && (!isDate(m[2]) || m[2] < m[1] || m[2] > addDays(m[1], MAX_SPAN_DAYS)))
      || !isTime(m[3]) || !isTime(m[4]);
    if (bad) { problems.push({ line: i + 1, text: line }); return; }
    let rest = m[5];
    let by = null;
    const byM = BY_RE.exec(rest);
    if (byM) { by = byM[1].trim().split(/\s+/)[0].toLowerCase(); rest = rest.slice(0, byM.index); }
    let location = null;
    const at = rest.lastIndexOf(' @ ');
    if (at > 0) { location = rest.slice(at + 3).trim() || null; rest = rest.slice(0, at); }
    const title = rest.trim();
    if (!title) { problems.push({ line: i + 1, text: line }); return; }
    events.push({
      id: `${m[1]}:${i + 1}`, date: m[1], end: m[2] || null, time: padTime(m[3]), endTime: padTime(m[4]),
      allDay: !m[3], title, location, by, line: i + 1,
    });
  });
  return { events, problems };
}

export function readCalendar(brain) {
  const file = path.join(brain || '', CALENDAR_FILE);
  if (!brain || !fs.existsSync(file)) return { exists: false, events: [], problems: [] };
  return { exists: true, ...parseEvents(fs.readFileSync(file, 'utf8')) };
}

const byStart = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));

// Events that touch [from, to] (both inclusive), in start order. Used by the index and the
// session-start hook.
export function eventsBetween(brain, from, to) {
  return readCalendar(brain).events.filter((e) => e.date <= to && (e.end || e.date) >= from).sort(byStart);
}

// --- The month view the dashboard draws -----------------------------------------
// Window: the 1st of last month through the last day of next month, so the grid's ‹ ›
// never steps into blank weeks within one month either side of today.
export function calendarView(brain, now, { from: fromOpt, to: toOpt } = {}) {
  const from = fromOpt || monthStart(now.date, -1);
  const to = toOpt || addDays(monthStart(now.date, 2), -1);
  const cal = readCalendar(brain);
  const days = {};
  let count = 0;
  for (const e of cal.events.sort(byStart)) {
    const last = e.end || e.date;
    if (e.date > to || last < from) continue;
    count++;
    for (let d = e.date; d <= last; d = addDays(d, 1)) {
      if (d < from || d > to) continue;
      const row = e.end ? { ...e, spanStart: d === e.date, spanEnd: d === last, time: d === e.date ? e.time : null } : e;
      (days[d] ||= []).push(row);
    }
  }
  for (const d of Object.keys(days)) days[d].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return { source: 'file', file: CALENDAR_FILE, exists: cal.exists, from, to, count, days, problems: cal.problems };
}

// --- Adding an event ---------------------------------------------------------------
export function formatEvent({ date, end, time, endTime, title, location, by }) {
  const when = `${date}${end ? `..${end}` : ''}${time ? ` ${padTime(time)}${endTime ? `-${padTime(endTime)}` : ''}` : ''}`;
  return `- ${when} ${String(title).trim()}${location ? ` @ ${String(location).trim()}` : ''}${by ? ` (added by ${by})` : ''}`;
}

export function newCalendarText(stamp) {
  return [
    '# Calendar', '',
    '- **Kind:** calendar',
    '- **Author:** shared (any AI adds and reads; MANIFESTO rule 2)',
    `- **Created:** ${stamp}`,
    `- **Last updated:** ${stamp}`, '',
    'Dated events: appointments, plans, birthdays, trips, school days. Things to *do* by a date stay in `Reminders/`.', '',
    'One line per event, under its month, in date order. Times are 24-hour Eastern.',
    '`- YYYY-MM-DD [HH:MM[-HH:MM]] Title [@ place] (added by <ai>)`',
    'Several days: `- YYYY-MM-DD..YYYY-MM-DD Title (added by <ai>)`.',
    'Cancelled: strike it through and say who, never delete: `- ~~YYYY-MM-DD Title~~ (cancelled by user via <ai>)`.', '',
  ].join('\n');
}

// Inserts the line under its "## YYYY-MM (Month)" heading, in date order, creating the file
// or the heading when missing, and stamps Last updated. Returns the line written.
export function addEvent(brain, ev, now) {
  if (!isDate(ev.date) || (ev.end && (!isDate(ev.end) || ev.end < ev.date)) || !isTime(ev.time) || !isTime(ev.endTime) || !String(ev.title || '').trim()) {
    throw new Error('expected a date (YYYY-MM-DD), an optional end date and HH:MM times, and a title');
  }
  const file = path.join(brain, CALENDAR_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : newCalendarText(now.stamp);
  const crlf = text.includes('\r\n');
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const key = ev.date.slice(0, 7);
  const heading = `## ${key} (${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)})`;
  const entry = formatEvent(ev);
  const headingAt = (k) => lines.findIndex((l) => l.startsWith(`## ${k}`));
  let h = headingAt(key);
  if (h < 0) {
    // Months stay in order: insert before the first later month, else at the end.
    const later = lines.findIndex((l) => /^## \d{4}-\d{2}/.test(l) && l.slice(3, 10) > key);
    const block = [heading, '', entry, ''];
    if (later < 0) lines.push('', ...block); else lines.splice(later, 0, ...block);
  } else {
    let end = h + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) end++;
    let at = end;
    for (let i = h + 1; i < end; i++) {
      const m = /^-\s+(?:~~)?(\d{4}-\d{2}-\d{2})(?:\.\.\S+)?(?:\s+(\d{1,2}:\d{2}))?/.exec(lines[i].trim());
      if (m && `${m[1]}${padTime(m[2]) || ''}` > `${ev.date}${padTime(ev.time) || ''}`) { at = i; break; }
    }
    while (at === end && at > h + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, entry);
  }
  let out = lines.join('\n').replace(/^- \*\*Last updated:\*\*.*$/m, `- **Last updated:** ${now.stamp}`) + '\n';
  if (crlf) out = out.replace(/\n/g, '\r\n');
  fs.writeFileSync(file, out, 'utf8');
  return entry;
}

// --- CLI ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
// Not a top-level await: brain-librarian.mjs imports this file, and awaiting it here while this
// module is still evaluating deadlocks the cycle (the CLI exited 13 doing nothing).
if (isMain) runCli().catch((err) => { console.error(err.message); process.exitCode = 1; });

async function runCli() {
  const { easternNow, sharedBrainPath } = await import('./brain-librarian.mjs');
  const brain = sharedBrainPath();
  const now = easternNow();
  const [cmd, when, title, ...rest] = process.argv.slice(2);
  try {
    if (!brain) throw new Error('no shared brain path (ALFRED_SHARED_BRAIN or the profile)');
    if (cmd === 'add') {
      const opt = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : null; };
      const [date, end] = String(when || '').split('..');
      const [time, endTime] = String(opt('--time') || '').split('-');
      const line = addEvent(brain, { date, end: end || null, time: time || null, endTime: endTime || null, title, location: opt('--at'), by: opt('--by') || 'claude-code' }, now);
      console.log(`added to ${CALENDAR_FILE}: ${line}`);
    } else if (cmd === 'view' || !cmd) {
      console.log(JSON.stringify(calendarView(brain, now), null, 2));
    } else {
      console.log('usage: brain-calendar.mjs view | add YYYY-MM-DD[..YYYY-MM-DD] "Title" [--time HH:MM[-HH:MM]] [--at "place"] [--by <ai>]');
    }
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
