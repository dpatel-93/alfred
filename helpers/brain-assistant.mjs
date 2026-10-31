#!/usr/bin/env node
// The executive-assistant view of the shared brain: today's brief, reminders, errands and the
// user's routines, shaped for the HUD's Brain tab. Read-only; the brain's files stay the truth,
// so anything closed by Grok, Claude or the Librarian drops off on the next refresh.
//   node brain-assistant.mjs        print the feed as JSON
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addDays, collectOpenItems, easternNow, readFields, runLibrarian, setField, sharedBrainPath } from './brain-librarian.mjs';
import {
  DAYS, createEvent, createReminder, createRoutine, oneLine, routineDueToday, slugify, updateReminder, updateRoutine, weekdayOf,
} from './brain-items.mjs';
import { pendingChanges } from './brain-notes.mjs';
import { CLAUDE_FILE, parseItems } from './brain-handoffs.mjs';

export { sharedBrainPath, routineDueToday };
export const easternDate = () => easternNow().date;

const TOP_ITEMS = 5;

const firstWord = (v) => (v || '').trim().split(/[\s;,(]/)[0].toLowerCase();
const titleOf = (text, fallback) => (text.match(/^#\s+(.+)$/m) || [, fallback])[1].trim();
const plain = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();

// The user's own routines (Runs: the user): today's, the other active ones, and paused ones,
// so the dashboard can list, edit, pause and resume them.
function userRoutines(brain, date) {
  const dir = path.join(brain, 'Routines');
  if (!fs.existsSync(dir)) return { today: [], other: [], paused: [] };
  // A change Grok asked for by note but not yet written is shown as already made (brain-notes.mjs).
  const waiting = pendingChanges(brain).routines;
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const h = readFields(text);
    const p = waiting.get(f);
    const schedule = p?.fields.schedule || h.schedule || '';
    const status = p?.paused ? 'paused' : p?.resumed ? 'active' : firstWord(h.status) || 'active';
    return { file: `Routines/${f}`, title: p?.fields.title || titleOf(text, f).replace(/^the user:\s*/i, ''), schedule,
      time: p?.fields.time || (schedule.match(/\b\d{2}:\d{2}\b/) || [])[0] || null, runs: h.runs || '',
      status, today: routineDueToday(schedule, date), ...(p ? { pendingNote: p.note } : {}) };
  }).filter((r) => /\bthe user\b/i.test(r.runs) && ['active', 'paused'].includes(r.status));
  const active = all.filter((r) => r.status === 'active');
  return { today: active.filter((r) => r.today === true), other: active.filter((r) => r.today !== true), paused: all.filter((r) => r.status === 'paused') };
}

// --- Grok's morning brief: newest one on or before today, top items only ---
export function latestBrief(brain, date, { withMarkdown = false } = {}) {
  const dir = path.join(brain, 'Outputs', 'briefs');
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n) && n.slice(0, 10) <= date).sort().pop();
  if (!f) return null;
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const top = [];
  let inTop = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { if (inTop) break; inTop = /^##\s+top\b/i.test(line); continue; }
    const m = inTop && line.match(/^\d+\.\s+(.*)$/);
    if (!m) continue;
    const bold = m[1].match(/^\*\*(.+?)\*\*\s*(.*)$/);
    top.push(bold ? { title: plain(bold[1]), text: plain(bold[2]) } : { title: plain(m[1]), text: '' });
    if (top.length === TOP_ITEMS) break;
  }
  return { file: `Outputs/briefs/${f}`, date: f.slice(0, 10), isToday: f.slice(0, 10) === date,
    title: titleOf(text, f), updated: (text.match(/Last updated:\s*([^|\n]+)/i) || [])[1]?.trim() || null, top,
    ...(withMarkdown ? { markdown: text } : {}) };
}

// --- One brain file for the panel's reader; never anything outside the brain ---
export function brainNote(brain, rel) {
  if (!brain || !fs.existsSync(brain)) return { status: 404, error: 'shared brain not found' };
  if (!/\.md$/i.test(rel || '')) return { status: 400, error: 'only .md files are servable' };
  const root = fs.realpathSync(brain);
  const inside = (p) => { const r = path.relative(root, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };
  const full = path.resolve(root, rel);
  if (!inside(full)) return { status: 403, error: 'outside the shared brain' };
  if (!fs.existsSync(full)) return { status: 404, error: 'not found: it may have just been closed or archived' };
  if (!inside(fs.realpathSync(full))) return { status: 403, error: 'outside the shared brain' };
  return { status: 200, markdown: fs.readFileSync(full, 'utf8') };
}

// --- Whose file is it? Informational since MANIFESTO rule 2 (2026-10-23) let any AI edit any
// file; the dashboard still records "file by <author>" when it touches someone else's, and the
// hand-off strip colours rows by author.
const OURS = /^(claude( code)?|alfred|librarian)$/i;
export function authorIsOurs(author) {
  return OURS.test(String(author || '').split('(')[0].trim());
}

// --- Signals: one small file in Inbox/, named and headed per MANIFESTO §6 ---
const hhmm = (now) => (now.stamp.match(/ (\d{2}):(\d{2}) ET$/) || ['', '00', '00']).slice(1, 3).join('');
export function writeSignal(brain, { type, from = 'user', to, re, subject, body = '' }, now = easternNow()) {
  const inbox = path.join(brain, 'Inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const base = `${now.date}-${hhmm(now)}--${from}--${to}--${type}--${slugify(subject)}`;
  let name = `${base}.md`;
  for (let n = 2; fs.existsSync(path.join(inbox, name)); n++) name = `${base}-${n}.md`;
  const text = [`# ${type[0].toUpperCase()}${type.slice(1)}: ${subject}`, '',
    '- **Kind:** signal', `- **Type:** ${type}`, `- **From:** ${from}`, `- **To:** ${to}`, `- **Re:** ${re}`,
    '- **Status:** open', `- **Created:** ${now.stamp}`, '', body.trim(), ''].join('\n');
  fs.writeFileSync(path.join(inbox, name), text, 'utf8');
  return `Inbox/${name}`;
}

// --- The desk box: "Tell Alfred" ---------------------------------------------------------
// The user types a sentence on the desk dashboard. Claude (the user's own Claude Code, run by
// the server with no tools) answers with a plan of items; brain-items.mjs checks every field
// and writes the files, so a confused answer can never write anywhere else. Anything that is
// not a reminder, routine, event, edit or close goes to Claude Code's inbox for the next desk
// session, in the user's own words. To edit or close an existing item Claude refers to it by a
// number from a list built here; the numbers map back to files only on this side.
const MAX_ITEMS = 6;

export function tellItemList(brain, now = easternNow()) {
  const open = collectOpenItems(brain, now);
  const refs = [];
  const lines = [];
  const add = (ref, text) => { refs.push(ref); lines.push(`#${refs.length} ${text}`); };
  for (const i of [...open.overdue, ...open.today, ...open.upcoming, ...open.later, ...open.undated]) {
    add({ type: 'reminder', file: i.file }, `${i.kind} · ${i.title} · ${i.due ? `due ${i.due}` : 'no date'}`);
  }
  const r = userRoutines(brain, now.date);
  for (const x of [...r.today, ...r.other, ...r.paused]) add({ type: 'routine', file: x.file }, `routine · ${x.title} · ${x.schedule} · ${x.status}`);
  return { refs, lines };
}

export function tellPrompt(text, now = easternNow(), list = { lines: [] }) {
  const day = DAYS[weekdayOf(now.date)];
  return [
    "You are Alfred, the user's personal assistant. The user typed this into the Tell Alfred box on their desk dashboard:",
    `"${oneLine(text, 500)}"`, '',
    `Now: ${day[0].toUpperCase()}${day.slice(1)} ${now.date}, ${now.stamp.split(' ')[1]} Eastern.`,
    ...(list.lines.length ? ['', "The user's open reminders and routines, by number (refer to them by id to change or close one):", ...list.lines, ''] : []),
    'Turn it into items for the shared brain. Reply with ONLY one JSON object, no prose and no code fence:',
    '{"reply": "<one short sentence to say back>", "items": [ ... ]}',
    'Each item is one of:',
    '{"type":"reminder","kind":"errand|reminder|todo|watch","title":"<a few words>","due":"YYYY-MM-DD or none","time":"HH:MM or null","scope":"personal|work","note":"<optional detail>"}',
    '{"type":"routine","title":"<a few words>","schedule":"daily | weekdays | weekends | Mondays and Thursdays | monthly on the 15th","time":"HH:MM or null","note":"<optional detail>"}',
    '{"type":"event","title":"<a few words>","date":"YYYY-MM-DD","end":"YYYY-MM-DD or null","time":"HH:MM or null","endTime":"HH:MM or null","location":"<place or null>"}',
    '{"type":"edit","id":<number from the list>,"set":{"title":"...","due":"YYYY-MM-DD or none","time":"HH:MM","kind":"...","schedule":"...","status":"active|paused","note":"..."}} (only the fields that change)',
    '{"type":"close","id":<number of a reminder the user says is done>}',
    '{"type":"other","summary":"<anything else the user wants: remember a fact, look something up, change how something works>"}',
    'Kinds: errand = do it today. todo = no date. reminder = do or remember something on a date. watch = a follow-up being waited on.',
    'Anything that repeats ("every Monday", "daily", "each month on the 1st") is a routine, not a reminder. To stop a routine, edit its status to paused.',
    'Something that happens on a date (appointment, plan, birthday, trip) is an event. Add a reminder as well only if the user asked to be reminded.',
    'Resolve relative dates ("Saturday", "tomorrow", "next week") from the date above. Times are 24-hour. Never write full names of people: use a relationship or an initial.',
  ].join('\n');
}

// Pulls the JSON object out of Claude's answer (it may wrap it in a fence or a sentence).
// Returns null when there is no usable plan.
export function parsePlan(out) {
  const s = String(out || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const plan = JSON.parse(s.slice(a, b + 1));
    return plan && Array.isArray(plan.items) ? plan : null;
  } catch { return null; }
}

export function toClaudeInbox(brain, summary, words, now = easternNow(), why = '') {
  const file = writeSignal(brain, {
    type: 'capture', from: 'user', to: 'claude-code', re: 'the Tell Alfred box', subject: oneLine(summary || words, 60),
    body: [`The user typed this into the Tell Alfred box: "${oneLine(words, 500)}"`, '',
      ...(summary && summary !== words ? [`Read as: ${oneLine(summary, 300)}`, ''] : []),
      ...(why ? [`Why it came by signal: ${oneLine(why, 200)}`, ''] : []),
      'Handle it at the next desk session (MANIFESTO §8): file what the user wants kept where it belongs, ask the user if it is unclear, and file this signal.'].join('\n'),
  }, now);
  return { type: 'inbox', title: oneLine(summary || words, 80), file };
}

export function applyPlan(brain, plan, words, now = easternNow(), refs = []) {
  const saved = [];
  const skipped = [];
  const items = (plan.items || []).slice(0, MAX_ITEMS);
  const BY = 'user (Tell Alfred box)';
  const refFor = (it) => {
    const ref = refs[Number(it.id) - 1];
    if (!ref) throw new Error(`no item #${oneLine(it.id, 6)} in the list`);
    return ref;
  };
  for (const it of items) {
    try {
      if (it && it.type === 'reminder') saved.push(createReminder(brain, it, { words, author: BY, now }));
      else if (it && it.type === 'routine') saved.push(createRoutine(brain, it, { words, author: BY, now }));
      else if (it && it.type === 'edit') {
        const ref = refFor(it);
        const set = it.set && typeof it.set === 'object' ? it.set : {};
        const pick = (keys) => Object.fromEntries(keys.filter((k) => set[k] !== undefined).map((k) => [k, set[k]]));
        saved.push({ ...(ref.type === 'routine'
          ? updateRoutine(brain, ref.file, pick(['title', 'schedule', 'time', 'status', 'note']), { by: BY, now })
          : updateReminder(brain, ref.file, pick(['title', 'due', 'time', 'kind', 'scope', 'note']), { by: BY, now })), edit: true });
      } else if (it && it.type === 'close') {
        const ref = refFor(it);
        if (ref.type !== 'reminder') throw new Error('only a reminder can be closed; pause a routine instead');
        const r = applyAction(brain, { file: ref.file, action: 'close', by: 'user' }, now);
        if (r.status !== 200) throw new Error(r.error || 'could not close it');
        saved.push({ type: 'close', file: r.file || ref.file, title: r.title || ref.file });
      } else if (it && it.type === 'event') saved.push(createEvent(brain, it, { by: 'user', now }));
      else if (it && it.type === 'other') saved.push(toClaudeInbox(brain, oneLine(it.summary, 300), words, now));
      else throw new Error('unknown item type');
    } catch (err) { skipped.push({ item: it, error: err.message }); }
  }
  // Nothing usable came back: the user's words still reach Claude Code rather than vanishing.
  if (!saved.length) saved.push(toClaudeInbox(brain, null, words, now, skipped.length ? 'none of the items could be saved' : 'Claude returned no items'));
  return { reply: oneLine(plan.reply, 240) || null, saved, skipped };
}

// --- Actions on a reminder: close, tomorrow, snooze (to a date), carryover (an expired errand) ---
// Returns {status, ...} like brainNote so the server can pass it straight through.
const ACTIONS = ['close', 'tomorrow', 'snooze', 'carryover'];
const BY_RE = /^[a-z][a-z-]{1,19}$/;
export function applyAction(brain, { file, action, due, by = 'user' } = {}, now = easternNow()) {
  if (!brain || !fs.existsSync(brain)) return { status: 404, error: 'shared brain not found' };
  if (!ACTIONS.includes(action)) return { status: 400, error: `unknown action: ${action}` };
  if (!BY_RE.test(by)) return { status: 400, error: 'bad actor name' };
  const rel = String(file || '').replace(/\\/g, '/');
  if (/^Routines\/[^/]+\.md$/.test(rel) && !/readme\.md$/i.test(rel)) {
    return action === 'close' ? closeChore(brain, rel, by, now) : { status: 400, error: 'a chore can only be marked done' };
  }
  const inDone = /^Reminders\/Done\/[^/]+\.md$/.test(rel);
  if (!/^Reminders\/[^/]+\.md$/.test(rel) && !inDone) return { status: 400, error: 'only Reminders/ files take actions' };
  if (/readme\.md$/i.test(rel)) return { status: 400, error: 'not a reminder' };
  const full = path.join(brain, rel);
  if (!fs.existsSync(full)) return { status: 404, error: 'not found: it may have just been closed or archived' };
  let text = fs.readFileSync(full, 'utf8');
  const h = readFields(text);
  const title = titleOf(text, path.basename(rel));
  const ours = authorIsOurs(h.author);
  const moveTo = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(full));
    if (!fs.existsSync(dest)) fs.renameSync(full, dest);
  };

  // MANIFESTO rule 2 (2026-10-23): any AI edits any file in place, so the dashboard writes
  // directly whoever created the file, notes who did it and why, then runs the Librarian
  // pass so index.md's open-items view is current for the next AI that reads it.
  const who = `${by} (Alfred dashboard${ours ? '' : `; file by ${String(h.author || 'another AI').split('(')[0].trim()}`})`;
  const stamp = (text) => text.replace(/^- \*\*Last updated:\*\*.*$/m, `- **Last updated:** ${now.stamp}`);
  let result;
  if (action === 'close') {
    if (inDone) return { status: 400, error: 'already closed' };
    text = `${stamp(setField(text, 'Status', 'done')).trimEnd()}\n- Closed: ${now.stamp} by ${who}\n`;
    fs.writeFileSync(full, text, 'utf8');
    moveTo(path.join(brain, 'Reminders', 'Done'));
    result = { status: 200, applied: true, via: 'direct', title };
  } else {
    const newDue = action === 'snooze' ? (String(due || '').match(/^\d{4}-\d{2}-\d{2}$/) || [])[0]
      : action === 'carryover' ? now.date : addDays(now.date, 1);  // carry-over means "today"
    if (!newDue) return { status: 400, error: 'snooze needs due: YYYY-MM-DD' };
    if (action === 'carryover' && !inDone) return { status: 400, error: 'carryover is for expired items in Reminders/Done/' };
    text = setField(text, 'Due', newDue);
    if (inDone) text = setField(text, 'Status', 'open');
    text = `${stamp(text).trimEnd()}\n- Moved: ${now.stamp} to ${newDue} by ${who}${inDone ? ' (carried over)' : ''}\n`;
    fs.writeFileSync(full, text, 'utf8');
    if (inDone) moveTo(path.join(brain, 'Reminders'));
    result = { status: 200, applied: true, via: 'direct', title, due: newDue };
  }
  runLibrarian(brain, { now });  // regenerates index.md and files anything finished
  return result;
}

// --- Projects: one line each from status.md, for the day view ---
function projectLines(brain) {
  const dir = path.join(brain, 'Projects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => {
      const s = path.join(dir, e.name, 'status.md');
      if (!fs.existsSync(s)) return null;
      const text = fs.readFileSync(s, 'utf8');
      const h = readFields(text);
      const section = (name) => (text.split(/^## /m).find((c) => c.toLowerCase().startsWith(name)) || '').split('\n').slice(1).join('\n');
      const first = (block) => { const m = block.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/m); return m ? plain(m[1]) : ''; };
      return { file: `Projects/${e.name}/status.md`, name: e.name, title: titleOf(text, e.name),
        status: firstWord(h.status) || '', track: h.track || '', updated: h['last updated'] || h.date || '',
        stands: first(section('where it stands')), next: first(section('next')) };
    })
    .filter((p) => p && !['dormant', 'archived', 'done'].includes(p.status));
}

// --- Closed today: what the end-of-day panel can show as done ---
function doneToday(brain, date) {
  const dir = path.join(brain, 'Reminders', 'Done');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const h = readFields(text);
    const closedOn = (text.match(/^- Closed: (\d{4}-\d{2}-\d{2})/m) || [])[1] || null;
    return { file: `Reminders/Done/${f}`, title: titleOf(text, f), kind: firstWord(h.kind), status: firstWord(h.status), closedOn };
  }).filter((i) => i.status === 'done' && i.closedOn === date);
}

// --- Weekly chores: the user's once-a-week jobs (Cadence or Schedule "weekly") ---
// Status is open or done for the week in `Week of` (its Monday); Grok opens each new week
// in the file and nudges. A file still on an earlier week counts as open for this one.
const mondayOf = (date) => addDays(date, -((weekdayOf(date) + 6) % 7));
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (date) => `${SHORT[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
const weekRange = (monday) => {
  const end = addDays(monday, 6);
  return `${md(monday)}-${end.slice(5, 7) === monday.slice(5, 7) ? Number(end.slice(8, 10)) : md(end)}`;
};
const weekOfField = (h, monday) => (String(h['week of'] || '').match(/\d{4}-\d{2}-\d{2}/) || [monday])[0];
function isChore(h) {
  return /\bthe user\b/i.test(h.runs || '') && /\bweekly\b/i.test(`${h.cadence || ''} ${h.schedule || ''}`)
    && ['open', 'done'].includes(firstWord(h.status));
}

function userChores(brain, now) {
  const dir = path.join(brain, 'Routines');
  if (!fs.existsSync(dir)) return [];
  const monday = mondayOf(now.date);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const h = readFields(text);
    if (!isChore(h)) return null;
    const fresh = weekOfField(h, monday) < monday;
    const day = DAYS.findIndex((d) => new RegExp(`\\b${d}s?\\b`, 'i').test(String(h.schedule || '').replace(/monday to sunday/i, '')));
    const closedOn = [...text.matchAll(/^\s*- Closed: (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]).pop() || null;
    return { file: `Routines/${f}`, title: titleOf(text, f).replace(/^weekly (work |household )?(routine|chore):\s*/i, ''), kind: 'chore',
      schedule: h.schedule || 'weekly', day: day >= 0 ? DAYS[day] : null,
      due: addDays(monday, day >= 0 ? (day + 6) % 7 : 6), done: !fresh && firstWord(h.status) === 'done',
      missedLastWeek: fresh && firstWord(h.status) !== 'done', closedOn };
  }).filter(Boolean).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

// Done for this week: opens the week first if Grok hasn't (last week stays on the log as
// done or not done), then marks this week done with a Closed line under its log entry.
function addLogLine(text, line) {
  const ls = text.split(/\r?\n/);
  const at = ls.findIndex((l) => /^## (weekly )?log\b/i.test(l));
  if (at < 0) return `${text.trimEnd()}\n\n## Weekly log\n${line}\n`;
  let end = ls.findIndex((l, i) => i > at && /^## /.test(l));
  if (end < 0) end = ls.length;
  while (end > at + 1 && !ls[end - 1].trim()) end--;
  ls.splice(end, 0, line);
  return ls.join('\n');
}

function closeChore(brain, rel, by, now) {
  const full = path.join(brain, rel);
  if (!fs.existsSync(full)) return { status: 404, error: 'not found: it may have just been archived' };
  let text = fs.readFileSync(full, 'utf8');
  const h = readFields(text);
  if (!isChore(h)) return { status: 400, error: 'not a weekly chore' };
  const title = titleOf(text, path.basename(rel));
  const monday = mondayOf(now.date);
  const weekOf = weekOfField(h, monday);
  if (weekOf >= monday && firstWord(h.status) === 'done') return { status: 400, error: 'already done this week' };
  const logLine = (week) => new RegExp(`^- ${week} week\\b.*$`, 'm');
  if (weekOf < monday) {
    const last = firstWord(h.status) === 'done' ? 'done' : 'not done';
    text = setField(text.replace(logLine(weekOf), (l) => l.replace(/:\s*open\b/, `: ${last}`)), 'Week of', monday);
  }
  if (logLine(monday).test(text)) text = text.replace(logLine(monday), (l) => l.replace(/:\s*(open|not done)\b/, ': done'));
  else text = addLogLine(text, `- ${monday} week (${weekRange(monday)}): done`);
  text = text.replace(logLine(monday), (l) => `${l}\n  - Closed: ${now.stamp} by ${by} (Alfred dashboard)`);
  text = setField(setField(text, 'Status', 'done'), 'Last updated', now.stamp);
  text = `${text.trimEnd()}\n- Edited: ${now.stamp} by ${by} (Alfred dashboard): done for the week of ${monday}\n`;
  fs.writeFileSync(full, text, 'utf8');
  runLibrarian(brain, { now });
  return { status: 200, applied: true, via: 'direct', title };
}

// --- Needs you: what is waiting on the user's word, not on an AI ---
// Grok's asks the hourly check left for the user, change notes the Librarian refused, and
// signals addressed to the user. The handoff files sit next to the brain folder (MANIFESTO §6).
function needsYou(brain, signals) {
  const out = [];
  let mine = [];
  try {
    const f = path.join(path.dirname(brain), CLAUDE_FILE);
    if (fs.existsSync(f)) mine = parseItems(fs.readFileSync(f, 'utf8'));
  } catch { mine = []; }   // the phone's copy of the brain doesn't hold the handoff files
  for (const r of mine.filter((x) => x.side === 'G' && x.state === 'needs-the-user')) {
    const why = oneLine(r.status.replace(/^needs-the-user\s*/i, '').replace(/^[(:·\s-]+|\)$/g, ''), 120);
    out.push({ kind: 'grok ask', title: r.title, why: why || 'waits for you at the desk', ref: r.id });
  }
  for (const s of signals) {
    if (s.status === 'needs') out.push({ kind: 'refused note', title: s.title, why: 'the Librarian could not apply it', file: s.file });
    else if (String(s.to || '').toLowerCase() === 'user') out.push({ kind: 'signal', title: s.title, why: `from ${s.from || 'an AI'}`, file: s.file });
  }
  return out;
}

// --- The agenda: today's chores, then the next 7 days by day ---
// Calendar events are added by the dashboards from feed.calendar, which both of them attach.
function agenda(upcoming, routines, chores, now) {
  const monday = mondayOf(now.date);
  // A later week starts fresh: the chore is open there whatever this week's state is. Done
  // always closes this week's chore, so the dashboards offer it only on this week's rows.
  const fresh = (c, due) => ({ ...c, due, done: false, missedLastWeek: false, closedOn: null, nextWeek: true });
  const days = [];
  for (let n = 1; n <= 7; n++) {
    const date = addDays(now.date, n);
    const wd = DAYS[weekdayOf(date)];
    const sameWeek = mondayOf(date) === monday;
    days.push({ date, weekday: wd,
      items: upcoming.filter((i) => i.due === date),
      routines: routines.filter((r) => routineDueToday(r.schedule, date) === true),
      chores: chores.filter((c) => c.day === wd && !(sameWeek && c.done)).map((c) => (sameWeek ? c : fresh(c, date))) });
  }
  const nextMonday = mondayOf(addDays(now.date, 1));
  const by = addDays(nextMonday, 6);
  const anytime = chores.filter((c) => !c.day);
  return {
    chores: {
      due: chores.filter((c) => !c.done && c.due === now.date),
      late: chores.filter((c) => !c.done && c.due < now.date),
      done: chores.filter((c) => c.done && c.closedOn === now.date),
    },
    week: { from: addDays(now.date, 1), to: addDays(now.date, 7), days,
      anytime: { by, chores: nextMonday === monday ? anytime.filter((c) => !c.done) : anytime.map((c) => fresh(c, by)) } },
  };
}

// --- The whole panel ---
export function assistantFeed(brain = sharedBrainPath(), now = easternNow()) {
  const base = { generatedAt: now.stamp, date: now.date, weekday: DAYS[weekdayOf(now.date)], calendar: { connected: false } };
  if (!brain || !fs.existsSync(brain)) return { ...base, brain: false };
  const open = collectOpenItems(brain, now);
  // An item with a signal already in flight (a close waiting for the Librarian, an amend waiting
  // for its curator) is marked so the dashboard shows "pending" instead of offering the action again.
  // A refused note ("needs a look") changes nothing, so the item keeps its buttons.
  const pending = new Map();
  for (const s of open.signals) if (s.re && s.status === 'open' && ['close', 'amend'].includes(s.type)) pending.set(path.basename(s.re), s.type);
  const slim = ({ file, title, kind, due, time, scope, author, pendingNote }) => ({
    file, title, kind, due, time: time || null, scope,
    author: String(author || '').split('(')[0].trim(), ours: authorIsOurs(author),
    pending: pending.get(path.basename(file)) || (pendingNote ? 'amend' : null),
  });
  const undated = open.undated.map(slim);
  const routines = userRoutines(brain, now.date);
  const chores = userChores(brain, now);
  const plan = agenda(open.upcoming.map(slim), routines.today.concat(routines.other), chores, now);
  const done = doneToday(brain, now.date);
  const closed = done.length + plan.chores.done.length;
  const left = open.today.length + open.overdue.length + open.carryOver.length + plan.chores.due.length + plan.chores.late.length;
  return {
    ...base,
    brain: true,
    brief: latestBrief(brain, now.date),
    today: open.today.map(slim),
    overdue: open.overdue.map(slim),
    upcoming: open.upcoming.map(slim),
    todos: undated.filter((i) => i.kind !== 'watch'),
    watching: undated.filter((i) => i.kind === 'watch'),
    later: open.later.map(slim),
    carryOver: open.carryOver.map(slim),
    doneToday: done,
    routines,
    chores: { ...plan.chores, all: chores },
    week: plan.week,
    progress: { done: closed, total: closed + left },
    projects: projectLines(brain),
    signals: open.signals.map(({ file, title, from, to, type, ageDays }) => ({ file, title, from, to, type, ageDays })),
    needsYou: needsYou(brain, open.signals),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(assistantFeed(), null, 2)}\n`);
}
