#!/usr/bin/env node
// The executive-assistant view of the shared brain: today's brief, reminders, errands and the
// user's routines, shaped for the HUD's Brain tab. Read-only; the brain's files stay the truth,
// so anything closed by Grok, Claude or the Librarian drops off on the next refresh.
//   node brain-assistant.mjs        print the feed as JSON
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addDays, collectOpenItems, easternNow, readFields, runLibrarian, setField, sharedBrainPath } from './brain-librarian.mjs';

export { sharedBrainPath };
export const easternDate = () => easternNow().date;

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TOP_ITEMS = 5;

const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const firstWord = (v) => (v || '').trim().split(/[\s;,(]/)[0].toLowerCase();
const titleOf = (text, fallback) => (text.match(/^#\s+(.+)$/m) || [, fallback])[1].trim();
const plain = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();

// --- Routines: does a free-text schedule fall on this date? null = no fixed day ---
export function routineDueToday(schedule, date) {
  const s = (schedule || '').toLowerCase();
  const day = weekdayOf(date);
  if (/\b(daily|every day|each day)\b/.test(s)) return true;
  if (/\bweekdays\b/.test(s)) return day >= 1 && day <= 5;
  if (/\bweekends?\b/.test(s)) return day === 0 || day === 6;
  const named = DAYS.filter((d) => new RegExp(`\\b${d}s?\\b`).test(s));
  if (named.length) return named.includes(DAYS[day]);
  return null;
}

function userRoutines(brain, date) {
  const dir = path.join(brain, 'Routines');
  if (!fs.existsSync(dir)) return { today: [], other: [] };
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const h = readFields(text);
    return { file: `Routines/${f}`, title: titleOf(text, f).replace(/^the user:\s*/i, ''), schedule: h.schedule || '',
      runs: h.runs || '', status: firstWord(h.status) || 'active', today: routineDueToday(h.schedule, date) };
  }).filter((r) => r.status === 'active' && /\bthe user\b/i.test(r.runs));
  return { today: all.filter((r) => r.today === true), other: all.filter((r) => r.today !== true) };
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

// --- Who may edit a brain file in place? (MANIFESTO §6: its Author, or the Librarian) ---
// The dashboard acts for Claude Code, whose hooks are also the Librarian's mechanical half.
// A file whose Author is Claude Code, Claude, Alfred or the librarian is edited directly.
// Anyone else's file gets a signal in Inbox/ instead; a `close` is then applied at once by
// the Librarian pass (its sanctioned job), while an `amend` waits for the file's curator.
const OURS = /^(claude( code)?|alfred|librarian)$/i;
export function authorIsOurs(author) {
  return OURS.test(String(author || '').split('(')[0].trim());
}
const KNOWN_AIS = ['grok', 'gemini', 'codex', 'claude', 'claude-code', 'librarian'];
const curatorOf = (author) => {
  const w = String(author || '').toLowerCase().split(/[\s(]/)[0];
  return KNOWN_AIS.includes(w) ? w : 'grok';  // Reminders/ is Grok's shelf (Reminders/README.md)
};

// --- Signals: one small file in Inbox/, named and headed per MANIFESTO §6 ---
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
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

// --- Actions on a reminder: close, tomorrow, snooze (to a date), carryover (an expired errand) ---
// Returns {status, ...} like brainNote so the server can pass it straight through.
const ACTIONS = ['close', 'tomorrow', 'snooze', 'carryover'];
const BY_RE = /^[a-z][a-z-]{1,19}$/;
export function applyAction(brain, { file, action, due, by = 'user' } = {}, now = easternNow()) {
  if (!brain || !fs.existsSync(brain)) return { status: 404, error: 'shared brain not found' };
  if (!ACTIONS.includes(action)) return { status: 400, error: `unknown action: ${action}` };
  if (!BY_RE.test(by)) return { status: 400, error: 'bad actor name' };
  const rel = String(file || '').replace(/\\/g, '/');
  const inDone = /^Reminders\/Done\/[^/]+\.md$/.test(rel);
  if (!/^Reminders\/[^/]+\.md$/.test(rel) && !inDone) return { status: 400, error: 'only Reminders/ files take actions' };
  if (/readme\.md$/i.test(rel)) return { status: 400, error: 'not a reminder' };
  const full = path.join(brain, rel);
  if (!fs.existsSync(full)) return { status: 404, error: 'not found: it may have just been closed or archived' };
  let text = fs.readFileSync(full, 'utf8');
  const h = readFields(text);
  const title = titleOf(text, path.basename(rel));
  const ours = authorIsOurs(h.author);
  const to = curatorOf(h.author);
  const moveTo = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(full));
    if (!fs.existsSync(dest)) fs.renameSync(full, dest);
  };

  if (action === 'close') {
    if (inDone) return { status: 400, error: 'already closed' };
    if (ours) {
      text = `${setField(text, 'Status', 'done').trimEnd()}\n- Closed: ${now.stamp} by ${by} (Alfred dashboard)\n`;
      fs.writeFileSync(full, text, 'utf8');
      moveTo(path.join(brain, 'Reminders', 'Done'));
      return { status: 200, applied: true, via: 'direct', title };
    }
    const signal = writeSignal(brain, { type: 'close', from: by, to, re: rel, subject: title,
      body: `The user marked this done on the Alfred dashboard at ${now.stamp}.` }, now);
    runLibrarian(brain, { now });  // the Librarian applies close signals mechanically (MANIFESTO §9)
    return { status: 200, applied: !fs.existsSync(full), via: 'signal', signal, title };
  }

  const newDue = action === 'snooze' ? (String(due || '').match(/^\d{4}-\d{2}-\d{2}$/) || [])[0] : addDays(now.date, 1);
  if (!newDue) return { status: 400, error: 'snooze needs due: YYYY-MM-DD' };
  if (action === 'carryover' && !inDone) return { status: 400, error: 'carryover is for expired items in Reminders/Done/' };
  const oldDue = h.due || 'none';
  if (ours) {
    text = setField(text, 'Due', newDue);
    if (inDone) text = setField(text, 'Status', 'open');
    text = `${text.trimEnd()}\n- Moved: ${now.stamp} to ${newDue} by ${by} (Alfred dashboard${inDone ? ', carried over' : ''})\n`;
    fs.writeFileSync(full, text, 'utf8');
    if (inDone) moveTo(path.join(brain, 'Reminders'));
    return { status: 200, applied: true, via: 'direct', title, due: newDue };
  }
  const change = inDone
    ? `Reopen it: set \`- **Status:** open\`, replace \`- **Due:** ${oldDue}\` with \`- **Due:** ${newDue}\`, and move it back to Reminders/.`
    : `Replace \`- **Due:** ${oldDue}\` with \`- **Due:** ${newDue}\`.`;
  const signal = writeSignal(brain, { type: 'amend', from: by, to, re: rel, subject: `${title} to ${newDue}`,
    body: `${change}\nThe user moved it on the Alfred dashboard at ${now.stamp}.` }, now);
  return { status: 200, applied: false, via: 'signal', pending: 'amend', signal, title, due: newDue };
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

// --- The whole panel ---
export function assistantFeed(brain = sharedBrainPath(), now = easternNow()) {
  const base = { generatedAt: now.stamp, date: now.date, weekday: DAYS[weekdayOf(now.date)], calendar: { connected: false } };
  if (!brain || !fs.existsSync(brain)) return { ...base, brain: false };
  const open = collectOpenItems(brain, now);
  // An item with a signal already in flight (a close waiting for the Librarian, an amend waiting
  // for its curator) is marked so the dashboard shows "pending" instead of offering the action again.
  const pending = new Map();
  for (const s of open.signals) if (s.re && ['close', 'amend'].includes(s.type)) pending.set(path.basename(s.re), s.type);
  const slim = ({ file, title, kind, due, scope, author }) => ({
    file, title, kind, due, scope,
    author: String(author || '').split('(')[0].trim(), ours: authorIsOurs(author),
    pending: pending.get(path.basename(file)) || null,
  });
  const undated = open.undated.map(slim);
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
    doneToday: doneToday(brain, now.date),
    routines: userRoutines(brain, now.date),
    projects: projectLines(brain),
    signals: open.signals.map(({ file, title, from, to, type, ageDays }) => ({ file, title, from, to, type, ageDays })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(assistantFeed(), null, 2)}\n`);
}
