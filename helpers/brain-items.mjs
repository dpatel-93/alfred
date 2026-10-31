#!/usr/bin/env node
// --- brain-items.mjs ---------------------------------------------------------
// Adds and edits the user's own items in the shared brain: reminders (errand,
// reminder, todo, watch) in Reminders/, and the user's routines (daily, weekly,
// weekdays, monthly) in Routines/. One writer for every path that changes them:
// the Alfred dashboard's forms and Grok's plans from the desk box both land here,
// so a field is checked the same way whoever asked (MANIFESTO §7, §11).
//
// Every edit is in place (MANIFESTO rule 2), keeps the header fields, stamps
// `Last updated` and adds a dated `- Edited:` line saying who changed what.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { easternNow, readFields, setField } from './brain-core.mjs';
import { addEvent } from './brain-calendar.mjs';

// --- Shared checks ---
export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const KINDS = ['errand', 'reminder', 'todo', 'watch'];
export const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
export const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
export const isClock = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
export function isDay(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;   // rejects 2026-11-31
}
const fail = (msg) => { const e = new Error(msg); e.status = 400; throw e; };

// --- Routines: does a free-text schedule fall on this date? null = no fixed day ---
// Understood: daily / every day, weekdays, weekends, day names ("Mondays and Thursdays"),
// and monthly on a day of the month ("monthly on the 15th"; a 31st falls on the month's last day).
export function routineDueToday(schedule, date) {
  const s = (schedule || '').toLowerCase();
  const day = weekdayOf(date);
  if (/\b(daily|every day|each day)\b/.test(s)) return true;
  if (/\bweekdays\b/.test(s)) return day >= 1 && day <= 5;
  if (/\bweekends?\b/.test(s)) return day === 0 || day === 6;
  const named = DAYS.filter((d) => new RegExp(`\\b${d}s?\\b`).test(s));
  if (named.length) return named.includes(DAYS[day]);
  const monthly = /\bmonth(ly)?\b/.test(s) && /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(s);
  if (monthly) {
    const want = Number(monthly[1]);
    if (want < 1 || want > 31) return null;
    const [y, m, d] = date.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d === Math.min(want, last);
  }
  return null;
}
const SCHEDULE_HELP = 'Use daily, weekdays, weekends, day names (e.g. "Mondays and Thursdays"), or "monthly on the 15th".';

function readItem(brain, rel, folder) {
  const ok = new RegExp(`^${folder}/[^/\\\\]+\\.md$`).test(String(rel || '')) && !/\.\./.test(rel) && !/\/readme\.md$/i.test(rel);
  if (!ok) fail(`expected a file in ${folder}/`);
  const full = path.join(brain, rel);
  if (!fs.existsSync(full)) fail(`${rel} is not there (it may have been closed or moved)`);
  return { full, text: fs.readFileSync(full, 'utf8') };
}
const stamp = (text, now) => setField(text, 'Last updated', now.stamp);
const editedLine = (text, now, by, what) => `${text.trimEnd()}\n- Edited: ${now.stamp} by ${by}: ${what}\n`;
const setTitle = (text, title, prefix = '') => text.replace(/^#\s+.*$/m, `# ${prefix}${title}`);
function uniqueName(dir, base) {
  let name = `${base}.md`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base}-${n}.md`;
  return name;
}

// --- Reminders ---
// `keep` is the item's current date: an overdue item can keep its date while other fields change.
function checkDue(kind, dueIn, now, keep = null) {
  let due = dueIn && dueIn !== 'none' ? String(dueIn) : 'none';
  if (kind === 'errand' && due === 'none') due = now.date;
  if (kind === 'reminder' && due === 'none') fail('a reminder needs a date');
  if (due !== 'none' && !isDay(due)) fail(`"${oneLine(due, 20)}" is not a date`);
  if (due !== 'none' && due < now.date && due !== keep) fail(`${due} is in the past`);
  return due;
}

export function createReminder(brain, it, { words = '', author = 'user (Alfred dashboard)', now = easternNow() } = {}) {
  const kind = KINDS.includes(it.kind) ? it.kind : null;
  if (!kind) fail(`unknown kind "${oneLine(it.kind, 20)}"`);
  const title = oneLine(it.title, 80);
  if (!title) fail('a title is needed');
  const due = checkDue(kind, it.due, now);
  const time = isClock(it.time) && due !== 'none' ? it.time : null;
  const dir = path.join(brain, 'Reminders');
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, `${due !== 'none' ? due : now.date}--${slugify(title)}`);
  const note = oneLine(it.note, 300);
  const text = [`# ${title}`, '',
    `- **Kind:** ${kind}`, '- **Status:** open', `- **Due:** ${due}${time ? ` ${time}` : ''}`,
    `- **Until:** ${kind === 'errand' ? 'end-of-day' : 'done'}`, `- **Scope:** ${it.scope === 'work' ? 'work' : 'personal'}`,
    '- **Nudge:** car + wake', `- **Author:** ${author}`,
    `- **Created:** ${now.stamp}`, `- **Last updated:** ${now.stamp}`, '',
    ...(note ? [note, ''] : []), ...(words ? [`The user's words: "${oneLine(words, 300)}"`, ''] : [])].join('\n');
  fs.writeFileSync(path.join(dir, name), text, 'utf8');
  return { type: 'reminder', kind, title, due, time, file: `Reminders/${name}` };
}

export function updateReminder(brain, file, changes = {}, { by = 'user (Alfred dashboard)', now = easternNow() } = {}) {
  const { full, text: before } = readItem(brain, file, 'Reminders');
  const h = readFields(before);
  let text = before;
  const what = [];
  const curKind = String(h.kind || '').split(/[\s(]/)[0].toLowerCase();
  const kind = changes.kind != null ? changes.kind : curKind;
  if (changes.kind != null && changes.kind !== curKind) {
    if (!KINDS.includes(changes.kind)) fail(`unknown kind "${oneLine(changes.kind, 20)}"`);
    text = setField(text, 'Kind', changes.kind);
    if (changes.kind === 'errand') text = setField(text, 'Until', 'end-of-day');
    else if (/end-of-day/.test(h.until || '')) text = setField(text, 'Until', 'done');
    what.push(`kind ${curKind || '?'} → ${changes.kind}`);
  }
  if (changes.title != null) {
    const title = oneLine(changes.title, 80);
    if (!title) fail('a title is needed');
    text = setTitle(text, title);
    what.push(`title → "${title}"`);
  }
  if (changes.due != null || changes.time !== undefined || changes.kind != null) {
    const curDue = (String(h.due || '').match(/\d{4}-\d{2}-\d{2}/) || [])[0] || 'none';
    const curTime = (String(h.due || '').match(/\b\d{2}:\d{2}\b/) || [])[0] || null;
    const due = checkDue(kind, changes.due != null ? changes.due : curDue, now, curDue);
    const time = changes.time !== undefined ? (isClock(changes.time) ? changes.time : null) : curTime;
    const value = `${due}${time && due !== 'none' ? ` ${time}` : ''}`;
    if (value !== `${curDue}${curTime && curDue !== 'none' ? ` ${curTime}` : ''}`) {
      text = setField(text, 'Due', value);
      what.push(`due ${curDue}${curTime ? ` ${curTime}` : ''} → ${value}`);
      if (/^snoozed/i.test(h.status || '')) text = setField(text, 'Status', 'open');
    }
  }
  if (changes.scope != null && ['personal', 'work'].includes(changes.scope) && changes.scope !== String(h.scope || '').split(/[\s,]/)[0]) {
    text = setField(text, 'Scope', changes.scope);
    what.push(`scope → ${changes.scope}`);
  }
  const note = oneLine(changes.note, 300);
  if (note) { text = `${text.trimEnd()}\n- (${now.date}) ${note}\n`; what.push('note added'); }
  if (!what.length) fail('nothing to change');
  fs.writeFileSync(full, editedLine(stamp(text, now), now, by, what.join('; ')), 'utf8');
  return { type: 'reminder', file, title: (text.match(/^#\s+(.+)$/m) || [, file])[1].trim(), changed: what };
}

// --- The user's routines ---
function checkSchedule(scheduleIn, timeIn, now) {
  const schedule = oneLine(scheduleIn, 80);
  if (!schedule) fail(`a schedule is needed. ${SCHEDULE_HELP}`);
  if (routineDueToday(schedule, now.date) === null) fail(`I can't read the schedule "${schedule}". ${SCHEDULE_HELP}`);
  const time = isClock(timeIn) ? timeIn : null;
  return time && !schedule.includes(time) ? `${schedule} ${time}` : schedule;
}

export function createRoutine(brain, it, { words = '', author = 'user (Alfred dashboard)', now = easternNow() } = {}) {
  const title = oneLine(it.title, 80);
  if (!title) fail('a title is needed');
  const schedule = checkSchedule(it.schedule, it.time, now);
  const dir = path.join(brain, 'Routines');
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, `user-${slugify(title)}`);
  const note = oneLine(it.note, 300);
  const text = [`# The user: ${title}`, '',
    '- **Kind:** routine', '- **Type:** habit', '- **Runs:** the user',
    '- **Nudger:** Grok (car + wake, morning brief) and the Alfred Day page',
    `- **Schedule:** ${schedule}`, '- **Status:** active', `- **Author:** ${author}`,
    `- **Created:** ${now.stamp}`, `- **Last updated:** ${now.stamp}`, '',
    '## What it is', note || title, '',
    ...(words ? [`The user's words: "${oneLine(words, 300)}"`, ''] : [])].join('\n');
  fs.writeFileSync(path.join(dir, name), text, 'utf8');
  return { type: 'routine', title, schedule, file: `Routines/${name}` };
}

export function updateRoutine(brain, file, changes = {}, { by = 'user (Alfred dashboard)', now = easternNow() } = {}) {
  const { full, text: before } = readItem(brain, file, 'Routines');
  const h = readFields(before);
  if (!/\bthe user\b/i.test(h.runs || '')) fail('only your own routines can be changed here; AI routines are kept by the AI that runs them');
  let text = before;
  const what = [];
  if (changes.title != null) {
    const title = oneLine(changes.title, 80);
    if (!title) fail('a title is needed');
    text = setTitle(text, title, 'The user: ');
    what.push(`title → "${title}"`);
  }
  if (changes.schedule != null || changes.time !== undefined) {
    const cur = String(h.schedule || '');
    const baseCur = cur.replace(/\s*\b\d{2}:\d{2}\b/, '').replace(/\s*\(.*\)\s*$/, '').trim();
    const curTime = (cur.match(/\b\d{2}:\d{2}\b/) || [])[0] || null;
    const schedule = checkSchedule(changes.schedule != null ? changes.schedule : baseCur,
      changes.time !== undefined ? changes.time : curTime, now);
    if (schedule !== cur) { text = setField(text, 'Schedule', schedule); what.push(`schedule "${cur}" → "${schedule}"`); }
  }
  if (changes.status != null) {
    if (!['active', 'paused'].includes(changes.status)) fail('status must be active or paused');
    const curStatus = String(h.status || 'active').split(/[\s(]/)[0].toLowerCase();
    if (changes.status !== curStatus) {
      text = setField(text, 'Status', changes.status === 'paused' ? `paused (since ${now.date})` : 'active');
      what.push(changes.status === 'paused' ? 'paused' : 'resumed');
    }
  }
  const note = oneLine(changes.note, 300);
  if (note) { text = `${text.trimEnd()}\n- (${now.date}) ${note}\n`; what.push('note added'); }
  if (!what.length) fail('nothing to change');
  fs.writeFileSync(full, editedLine(stamp(text, now), now, by, what.join('; ')), 'utf8');
  return { type: 'routine', file, title: (text.match(/^#\s+(?:The user:\s*)?(.+)$/m) || [, file])[1].trim(), changed: what };
}

// --- Events: one line in Calendar/events.md (brain-calendar.mjs keeps month order) ---
export function createEvent(brain, it, { by = 'user', now = easternNow() } = {}) {
  if (!isDay(it.date)) fail(`"${oneLine(it.date, 20)}" is not a date`);
  if (it.date < now.date && !(isDay(it.end) && it.end >= now.date)) fail(`${it.date} is in the past`);
  if (it.end && !isDay(it.end)) fail(`"${oneLine(it.end, 20)}" is not an end date`);
  if (isDay(it.end) && it.end < it.date) fail('the end date is before the start date');
  const title = oneLine(it.title, 80).replace(/\s@\s/g, ' at ');
  if (!title) fail('a title is needed');
  const time = isClock(it.time) ? it.time : null;
  const endTime = time && isClock(it.endTime) ? it.endTime : null;
  if (time && endTime && (!it.end || it.end === it.date) && endTime < time) fail('the end time is before the start time');
  const ev = { date: it.date, end: isDay(it.end) && it.end !== it.date ? it.end : null, time, endTime, title,
    location: oneLine(it.location, 80) || null, by: /^[a-z][a-z-]{1,19}$/.test(by) ? by : 'user' };
  const line = addEvent(brain, ev, now);
  return { type: 'event', title, date: ev.date, file: 'Calendar/events.md', line };
}
