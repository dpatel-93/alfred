#!/usr/bin/env node
// --- brain-librarian.mjs ----------------------------------------------------
// The mechanical half of the shared brain's Librarian (Second Brain MANIFESTO
// §9): applies signals, expires and files finished items, ages old ones into
// Archive/, retires temporary memory lines, and regenerates index.md with the
// open-items view every AI reads at session start.
//
// Every step is idempotent and nothing is ever deleted: files only move to
// Done/ or Archive/. Judgement work (merging captures into prose, handoffs) is
// left to an AI session.
//
//   node brain-librarian.mjs            run
//   node brain-librarian.mjs --dry-run  print what would change
//   node brain-librarian.mjs --force    run even while the cloud Librarian is in charge
//
// Brain: ALFRED_SHARED_BRAIN, else "Shared brain path" in ~/.claude/alfred-profile.md.
// Clock: ALFRED_NOW (ISO date-time) overrides "now" for tests.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALENDAR_FILE, eventsBetween, formatEvent } from './brain-calendar.mjs';
import {
  DAY_MS, addDays, appendLine, cleanRef, closedLine, easternNow, firstWord, mdFiles, nowFromStamp, readFields, setField, stampOf, withSchema,
} from './brain-core.mjs';
import { applyChangeNotes, overlayReminders, pendingChanges, recentChanges } from './brain-notes.mjs';
import { oneLine, slugify } from './brain-items.mjs';
import { handoffWaiting } from './brain-handoffs.mjs';

export { addDays, easternNow, readFields, setField };

// --- Configuration ---
const PROFILE_PATH = path.join(os.homedir(), '.claude', 'alfred-profile.md');
const DONE_DAYS = 30;
const LOG_DAYS = 90;
const STALE_SIGNAL_DAYS = 7;
const HEARTBEAT = path.join('System', 'librarian-heartbeat.md');
const CLOUD_FRESH_MINUTES = 30;
const WAITING_HOURS = 6;
const PATH_CHANGES = 'System/path-changes.md';

export function sharedBrainPath() {
  if (process.env.ALFRED_SHARED_BRAIN) return process.env.ALFRED_SHARED_BRAIN;
  try {
    const m = fs.readFileSync(PROFILE_PATH, 'utf8').match(/^\s*-\s*\*\*Shared brain path[^*]*\*\*:\s*(.+)$/m);
    const v = m && m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    return v && !/^\(?not specified\)?$/i.test(v) ? v : null;
  } catch { return null; }
}


// --- Actions (collected, then applied unless dry-run) ---
function makeRunner(brain, dryRun) {
  const actions = [];
  const rel = (p) => path.relative(brain, p).replace(/\\/g, '/');
  return {
    actions,
    dryRun,
    stats: { applied: 0, needsLook: 0, pathRefs: 0 },
    write(file, text, why) {
      actions.push(`edit  ${rel(file)}  (${why})`);
      if (!dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); }
    },
    move(from, toDir, why) {
      const to = path.join(toDir, path.basename(from));
      if (fs.existsSync(to)) { actions.push(`skip  ${rel(from)}  (already at ${rel(to)})`); return null; }
      actions.push(`move  ${rel(from)} -> ${rel(to)}  (${why})`);
      if (!dryRun) { fs.mkdirSync(toDir, { recursive: true }); fs.renameSync(from, to); }
      return to;
    },
    note(msg) { actions.push(`note  ${msg}`); },
  };
}

// 1. change notes (close, amend, change, calendar capture): see brain-notes.mjs

// 2. expire errands and lapsed items; file anything already finished
function expireAndFileReminders(brain, run, now) {
  const dir = path.join(brain, 'Reminders');
  for (const f of mdFiles(dir)) {
    const file = path.join(dir, f);
    let text = fs.readFileSync(file, 'utf8');
    const h = readFields(text);
    const status = firstWord(h.status);
    if (['done', 'cancelled', 'expired'].includes(status)) { run.move(file, path.join(dir, 'Done'), status); continue; }
    const due = (h.due || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const until = (h.until || '').toLowerCase();
    const untilDate = until.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const endOfDay = until.startsWith('end-of-day') || firstWord(h.kind) === 'errand';
    const lapsed = (endOfDay && due && due < now.date) || (untilDate && untilDate < now.date);
    if (!lapsed) continue;
    text = appendLine(withSchema(setField(text, 'Status', 'expired')), closedLine(now.stamp, 'librarian', 'expired'));
    run.write(file, text, 'expired');
    run.move(file, path.join(dir, 'Done'), 'expired');
  }
}

// 3. file handled signals: Status done, or answered by a reply
function fileHandledSignals(brain, run, now) {
  const inbox = path.join(brain, 'Inbox');
  const files = mdFiles(inbox);
  const replies = new Map();
  for (const f of files) {
    const h = readFields(fs.readFileSync(path.join(inbox, f), 'utf8'));
    if (firstWord(h.type) === 'reply') replies.set(path.basename(cleanRef(h.re)), f);
  }
  for (const f of files) {
    const file = path.join(inbox, f);
    if (!fs.existsSync(file)) continue;
    const h = readFields(fs.readFileSync(file, 'utf8'));
    const answered = replies.has(f);
    if (firstWord(h.status) === 'done' || answered) {
      run.move(file, path.join(inbox, 'Done'), answered ? `answered by ${replies.get(f)}` : 'marked done');
      if (answered) {
        const r = path.join(inbox, replies.get(f));
        if (fs.existsSync(r)) run.move(r, path.join(inbox, 'Done'), `reply to ${f}`);
      }
    }
  }
  return now;
}

// 4. age out old Done items and logs into Archive/YYYY-MM/
function ageOut(brain, run, now) {
  const archive = path.join(brain, 'Archive', now.month);
  const sweep = (dir, days, sub) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { sweep(p, days, `${sub}/${e.name}`); continue; }
      if (!e.name.endsWith('.md') || e.name.toLowerCase() === 'readme.md') continue;
      if (now.ms - fs.statSync(p).mtimeMs > days * DAY_MS) run.move(p, path.join(archive, sub), `older than ${days} days`);
    }
  };
  sweep(path.join(brain, 'Reminders', 'Done'), DONE_DAYS, 'Reminders-Done');
  sweep(path.join(brain, 'Inbox', 'Done'), DONE_DAYS, 'Inbox-Done');
  sweep(path.join(brain, 'System', 'logs'), LOG_DAYS, 'System-logs');
}

// 5. retire memory lines marked "until YYYY-MM-DD"
function retireTemporaryMemory(brain, run, now) {
  const root = path.join(brain, 'Memory');
  const expiredLines = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'claude-code') walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const text = fs.readFileSync(p, 'utf8');
      const keep = [];
      let changed = false;
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*-\s.*·\s*until\s+(\d{4}-\d{2}-\d{2})/i);
        if (m && m[1] < now.date) { expiredLines.push(`- from ${path.relative(brain, p).replace(/\\/g, '/')}: ${line.trim()}`); changed = true; } else keep.push(line);
      }
      if (changed) run.write(p, keep.join('\n'), 'temporary memory expired');
    }
  };
  walk(root);
  if (!expiredLines.length) return;
  const file = path.join(brain, 'Archive', now.month, 'expired-memory.md');
  const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `# Expired memory lines: ${now.month}\n\n- **Kind:** log\n- **Author:** librarian\n\n`;
  run.write(file, `${prior.trimEnd()}\n${expiredLines.join('\n')}\n`, `${expiredLines.length} expired memory lines`);
}

// 6. Waiting (§17.5.2): signals and change notes still open 6 hours after Created, and hand-off asks
// with no report after 48 hours, each with why: "- <path or ID> · <reason> · since YYYY-MM-DD HH:MM ET".
const CHANGE_NOTE = ['close', 'amend', 'change'];
export function waitingItems(brain, now = easternNow()) {
  const rows = [];
  const cutoff = now.ms - WAITING_HOURS * 3600 * 1000;
  for (const f of mdFiles(path.join(brain, 'Inbox'))) {
    const h = readFields(fs.readFileSync(path.join(brain, 'Inbox', f), 'utf8'));
    const status = firstWord(h.status) || 'open';
    if (status === 'done') continue;
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})--/);
    const since = stampOf(h.created) || (m ? `${m[1]} ${m[2]}:${m[3]} ET` : '');
    const at = nowFromStamp(since);
    if (!at || at.ms > cutoff) continue;
    const type = firstWord(h.type) || (f.match(/^\d{4}-\d{2}-\d{2}-\d{4}--[a-z0-9-]+--[a-z0-9-]+--([a-z]+)--/i) || [])[1] || '';
    const to = firstWord(h.to) || (f.match(/^\d{4}-\d{2}-\d{2}-\d{4}--[a-z0-9-]+--([a-z0-9-]+)--/i) || [])[1] || 'someone';
    const calendar = type === 'capture' && /^Calendar\/events\.md$/i.test(cleanRef(h.target));
    const reason = status === 'needs' ? 'needs a look' : CHANGE_NOTE.includes(type) || calendar ? 'waiting to apply' : `waiting for ${to}`;
    rows.push({ ref: `Inbox/${f}`, reason, since });
  }
  for (const a of handoffWaiting(brain, now)) rows.push({ ref: a.id, reason: 'no report', since: a.opened });
  return rows.sort((a, b) => a.since.localeCompare(b.since) || a.ref.localeCompare(b.ref));
}
const waitingSection = (rows) => ['## Waiting', '',
  ...(rows.length ? rows.map((w) => `- ${w.ref} · ${w.reason} · since ${w.since}`) : ['- none']), ''];

// 7. Path check (§17.5.3): one fyi signal per file, to its Author, naming each line that still has a moved
// path (System/path-changes.md). Never edits the file; signals a file again only for a line it has not named.
export function readPathChanges(brain) {
  const file = path.join(brain, PATH_CHANGES);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^\|/.test(l)).flatMap((l) => {
    const cells = l.split('|').slice(1, -1);
    const old = ((cells[0] || '').match(/`([^`]+)`/) || [])[1];
    return old ? [{ old, new: ((cells[1] || '').match(/`([^`]+)`/) || [])[1] || null, date: (cells[2] || '').trim() }] : [];
  });
}

const SKIP_PATH = (rel) => /^(Archive|Inbox)(\/|$)/i.test(rel) || /(^|\/)Done(\/|$)/.test(rel) || /^System\/logs(\/|$)/i.test(rel)
  || /(^|\/)\./.test(rel) || ['system/changelog.md', PATH_CHANGES.toLowerCase(), 'index.md'].includes(rel.toLowerCase());
function textFiles(brain, sub = '') {
  const dir = path.join(brain, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (SKIP_PATH(rel)) return [];
    if (e.isDirectory()) return textFiles(brain, rel);
    return /\.(md|txt)$/i.test(e.name) ? [rel] : [];
  });
}
// The old path as a whole path: not the tail of a longer one ("Archive/2026-11/MASTER_INSTRUCTIONS.md").
const namesPath = (line, old) => {
  for (let i = line.indexOf(old); i >= 0; i = line.indexOf(old, i + 1)) if (i === 0 || !/[\w./-]/.test(line[i - 1])) return true;
  return false;
};
export function pathReferences(text, changes) {
  const hits = [];
  let heading = '';
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { heading = h[1]; continue; }
    if (/path changes/i.test(heading)) continue;
    for (const c of changes) {
      if (!namesPath(line, c.old) || (c.new && line.includes(c.new))) continue;
      hits.push({ line: oneLine(line, 300), old: c.old, new: c.new });
      break;
    }
  }
  return hits;
}
// Lines already named in earlier path-check signals, by file: Inbox/, Inbox/Done/ and archived ones.
function signalledLines(brain) {
  const seen = new Map();
  const dirs = ['Inbox', 'Inbox/Done', ...(fs.existsSync(path.join(brain, 'Archive'))
    ? fs.readdirSync(path.join(brain, 'Archive')).map((m) => `Archive/${m}/Inbox-Done`) : [])];
  for (const d of dirs) {
    for (const f of mdFiles(path.join(brain, d)).filter((x) => /--fyi--path-check-/.test(x))) {
      const text = fs.readFileSync(path.join(brain, d, f), 'utf8');
      const rel = cleanRef(readFields(text)['path check']);
      if (!seen.has(rel)) seen.set(rel, new Set());
      for (const m of text.matchAll(/^- Line: (.*)$/gm)) seen.get(rel).add(m[1].trim());
    }
  }
  return seen;
}
const AI_NAMES = ['grok', 'claude', 'claude-code', 'gemini', 'codex', 'librarian', 'user'];
function signalTo(author) {
  const a = String(author || '').trim().toLowerCase();
  if (/^claude[\s-]*code\b/.test(a)) return 'claude-code';
  const w = firstWord(a.replace(/^the\s+/, ''));
  return AI_NAMES.includes(w) ? w : 'all';
}
function checkPaths(brain, run, now) {
  const changes = readPathChanges(brain);
  if (!changes.length) return;
  const seen = signalledLines(brain);
  for (const rel of textFiles(brain)) {
    const text = fs.readFileSync(path.join(brain, rel), 'utf8');
    const already = seen.get(rel) || new Set();
    const fresh = pathReferences(text, changes).filter((x) => !already.has(x.line));
    if (!fresh.length) continue;
    const h = readFields(text);
    const to = signalTo(h.author || h.owner);
    const base = `${now.date}-${now.stamp.slice(11, 16).replace(':', '')}--librarian--${to}--fyi--path-check-${slugify(rel)}`;
    let name = `${base}.md`;
    for (let n = 2; fs.existsSync(path.join(brain, 'Inbox', name)); n++) name = `${base}-${n}.md`;
    run.write(path.join(brain, 'Inbox', name), [`# Fyi: ${rel} names a moved path`, '',
      '- **Schema:** 1', '- **Kind:** signal', '- **Type:** fyi', '- **From:** librarian', `- **To:** ${to}`, `- **Re:** ${rel}`,
      '- **Status:** open', `- **Created:** ${now.stamp}`, '- **Author:** librarian', `- **Path check:** ${rel}`, '',
      `\`${rel}\` still names a path that moved (\`${PATH_CHANGES}\`). Please update these lines in your file; the Librarian does not edit it for you (MANIFESTO §17.5).`, '',
      ...fresh.flatMap((x) => [`- Line: ${x.line}`, `  - \`${x.old}\` is now ${x.new ? `\`${x.new}\`` : 'gone'}`]), ''].join('\n'),
    `path check: ${fresh.length} line(s) in ${rel}`);
    run.stats.pathRefs += fresh.length;
  }
}

// --- Open-items view (shared with brain-open-items.mjs) ---
export function collectOpenItems(brain, now = easternNow()) {
  const dir = path.join(brain, 'Reminders');
  const raw = mdFiles(dir).map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const h = readFields(text);
    const title = (text.match(/^#\s+(.+)$/m) || [, f])[1].trim();
    return { file: `Reminders/${f}`, title, kind: firstWord(h.kind) || 'reminder', status: firstWord(h.status) || 'open',
      due: (h.due || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || null, time: (h.due || '').match(/\b\d{2}:\d{2}\b/)?.[0] || null,
      scope: firstWord(h.scope) || '', author: h.author || '' };
  }).filter((i) => ['open', 'snoozed'].includes(i.status));
  // A change Grok asked for by note but not yet written is shown as already made (brain-notes.mjs).
  const items = overlayReminders(raw, pendingChanges(brain));
  const yesterday = addDays(now.date, -1);
  const carryOver = mdFiles(path.join(dir, 'Done')).map((f) => {
    const text = fs.readFileSync(path.join(dir, 'Done', f), 'utf8');
    const h = readFields(text);
    return { file: `Reminders/Done/${f}`, title: (text.match(/^#\s+(.+)$/m) || [, f])[1].trim(), kind: firstWord(h.kind),
      status: firstWord(h.status), due: (h.due || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] };
  }).filter((i) => i.kind === 'errand' && i.status === 'expired' && i.due === yesterday);
  const signals = mdFiles(path.join(brain, 'Inbox')).map((f) => {
    const p = path.join(brain, 'Inbox', f);
    const text = fs.readFileSync(p, 'utf8');
    const h = readFields(text);
    const m = f.match(/^\d{4}-\d{2}-\d{2}-\d{4}--([a-z0-9-]+)--([a-z0-9-]+)--([a-z]+)--/i);
    // `re` and `title` let the dashboard mark an item that already has a signal in flight.
    return { file: `Inbox/${f}`, title: (text.match(/^#\s+(.+)$/m) || [, f])[1].trim(),
      from: (h.from || m?.[1] || '').toLowerCase(), to: (h.to || m?.[2] || '').toLowerCase(),
      type: firstWord(h.type) || m?.[3] || '', status: firstWord(h.status) || 'open',
      re: [h.target, h.re].map(cleanRef).find((r) => /\.md$/i.test(r)) || cleanRef(h.re),
      ageDays: Math.floor((now.ms - fs.statSync(p).mtimeMs) / DAY_MS) };
  }).filter((s) => s.status !== 'done');
  return {
    today: items.filter((i) => i.due === now.date),
    overdue: items.filter((i) => i.due && i.due < now.date),
    upcoming: items.filter((i) => i.due && i.due > now.date && i.due <= addDays(now.date, 7)),
    undated: items.filter((i) => !i.due),
    later: items.filter((i) => i.due && i.due > addDays(now.date, 7)),
    carryOver, signals, all: items,
  };
}

const bullet = (i) => `- [ ] ${i.title}${i.due ? ` · due ${i.due}` : ''} · ${i.kind}${i.scope ? ` · ${i.scope}` : ''} · \`${i.file}\``;

function catalog(brain) {
  const out = [];
  const list = (rel, fmt) => {
    const dir = path.join(brain, rel);
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.toLowerCase() === 'readme.md' || e.name.startsWith('_') || e.name === 'Done') continue;
      const line = fmt(e, path.join(dir, e.name));
      if (line) out.push(line);
    }
  };
  out.push('### Projects (status for read-aloud)');
  list('Projects', (e, p) => {
    if (!e.isDirectory()) return null;
    const s = path.join(p, 'status.md');
    if (!fs.existsSync(s)) return `- \`Projects/${e.name}/\``;
    const h = readFields(fs.readFileSync(s, 'utf8'));
    return `- \`Projects/${e.name}/status.md\` · ${h.status || '?'} · ${h.track || ''}`;
  });
  out.push('', '### Memory topics');
  list('Memory/topics', (e) => (e.isFile() ? `- \`Memory/topics/${e.name}\`` : null));
  out.push('', '### Routines');
  list('Routines', (e, p) => {
    if (!e.isFile()) return null;
    const h = readFields(fs.readFileSync(p, 'utf8'));
    return `- \`Routines/${e.name}\` · ${h.schedule || ''} · ${h.status || ''}`;
  });
  out.push('', '### Knowledge', '- `Knowledge/Runbooks/`, `Knowledge/Docs/`, `Knowledge/Decisions/`, `Knowledge/Patterns/`, `Knowledge/Learning/`, `Knowledge/Investigations/`');
  out.push('', '### Calendar', `- \`${CALENDAR_FILE}\`: dated events (appointments, plans, trips), one line each; any AI adds and reads`);
  out.push('', '### Everything else', '- `Memory/profile.md`, `Memory/timeline/`, `Memory/agents/` · `Research/` · `Health/` · `Outputs/briefs/`, `Outputs/news/`, `Outputs/reports/` · `System/agents/`, `System/ai-stack.md`, `System/CHANGELOG.md`, `System/templates/` · `Archive/`');
  return out;
}

// The shared calendar's next 7 days, so an AI reading only the top of the index still
// hears about tomorrow's appointment (the events themselves live in Calendar/events.md).
export function upcomingEvents(brain, now = easternNow(), days = 7) {
  return eventsBetween(brain, now.date, addDays(now.date, days), pendingChanges(brain).calendar);
}

// The other direction: changes made anywhere in the last 48 hours, so Grok can bring its own
// copies (memory, scheduled pings) up to date with what was done at the desk.
function recentSection(brain, now) {
  const rows = recentChanges(brain, now);
  return ['## Changed in the last 48 hours', '',
    'Newest first. Grok: update or drop your own copies (memory, scheduled pings) of anything below before reading it out.', '',
    ...(rows.length ? rows.map((r) => `- ${r.stamp} · ${r.title} · ${r.what} · \`${r.file}\``) : ['- nothing']), ''];
}
function calendarSection(brain, now) {
  const ev = upcomingEvents(brain, now);
  return [`### On the calendar, next 7 days (${ev.length})`,
    ...(ev.length ? ev.map((e) => `${formatEvent({ ...e, by: null })} · \`${CALENDAR_FILE}\``) : ['- nothing']), ''];
}

export function renderIndex(brain, now = easternNow(), waiting = waitingItems(brain, now)) {
  const o = collectOpenItems(brain, now);
  const stale = o.signals.filter((s) => s.ageDays > STALE_SIGNAL_DAYS);
  const lines = [
    '# Second Brain: Index', '',
    '- **Kind:** index',
    '- **Author:** Grok (file created by Grok; regenerated by the Librarian, do not edit by hand)',
    `- **Last updated:** ${now.stamp}`, '',
    'Regenerated by the Librarian (`Routines/librarian-nightly.md`) every night and at each desk session. New reminders and signals created since then are in `Reminders/` and `Inbox/` directly. Start with `README.md` (quick card).', '',
    `## Open items (as of ${now.stamp})`, '',
    `### Due today (${o.today.length})`, ...(o.today.length ? o.today.map(bullet) : ['- nothing']), '',
    `### Overdue (${o.overdue.length})`, ...(o.overdue.length ? o.overdue.map(bullet) : ['- nothing']), '',
    `### Next 7 days (${o.upcoming.length})`, ...(o.upcoming.length ? o.upcoming.map(bullet) : ['- nothing']), '',
    ...calendarSection(brain, now),
    `### Yesterday's errands not done: offer to carry over (${o.carryOver.length})`,
    ...(o.carryOver.length ? o.carryOver.map((i) => `- ${i.title} · \`${i.file}\``) : ['- none']), '',
    `### Open, no date (${o.undated.length})`, ...(o.undated.length ? o.undated.map(bullet) : ['- nothing']), '',
    ...(o.later.length ? [`### Later (${o.later.length})`, ...o.later.map(bullet), ''] : []),
    `### Signals waiting (${o.signals.length})`,
    ...(o.signals.length ? o.signals.map((s) => `- ${s.type} from ${s.from} to ${s.to} · ${s.ageDays}d · \`${s.file}\``) : ['- none']),
    ...(stale.length ? ['', `**${stale.length} signal(s) older than ${STALE_SIGNAL_DAYS} days: the user should decide.**`] : []), '',
    ...waitingSection(waiting),
    ...recentSection(brain, now),
    '## Catalog', '', ...catalog(brain), '',
  ];
  return lines.join('\n');
}

// --- Who runs (MANIFESTO §9): the cloud Librarian on Azure is in charge, the PC's stands by ---
// When the cloud Librarian last ran, and whether that's recent enough for the PC to stand by.
export function cloudLibrarian(brain, now = easternNow()) {
  const file = path.join(brain, HEARTBEAT);
  const at = fs.existsSync(file) ? stampOf(readFields(fs.readFileSync(file, 'utf8'))['last run']) : '';
  const then = nowFromStamp(at);
  const minutes = then ? (nowFromStamp(now.stamp).ms - then.ms) / 60000 : Infinity;
  return { at: at || null, fresh: minutes > -5 && minutes <= CLOUD_FRESH_MINUTES };
}

function writeHeartbeat(brain, now) {
  const file = path.join(brain, HEARTBEAT);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    '# Librarian heartbeat', '',
    '- **Kind:** status',
    '- **Author:** librarian (cloud)',
    `- **Last run:** ${now.stamp}`, '',
    'The cloud Librarian (mobile Alfred on Azure) runs every 10 minutes and after every change made on the phone.',
    `The PC's Librarian stands by and runs only when the time above is more than ${CLOUD_FRESH_MINUTES} minutes old (MANIFESTO §9).`, '',
  ].join('\n'), 'utf8');
}

// --- Main ---
// runner 'cloud' is the Librarian in charge and leaves the heartbeat; 'pc' (the default) skips while
// that heartbeat is fresh, unless forced.
export function runLibrarian(brain, { dryRun = false, now = easternNow(), runner = 'pc', force = false } = {}) {
  if (runner !== 'cloud' && !force && cloudLibrarian(brain, now).fresh) return [];
  const run = makeRunner(brain, dryRun);
  applyChangeNotes(brain, run, now);
  expireAndFileReminders(brain, run, now);
  fileHandledSignals(brain, run, now);
  ageOut(brain, run, now);
  retireTemporaryMemory(brain, run, now);
  checkPaths(brain, run, now);
  const waiting = waitingItems(brain, now);
  const indexPath = path.join(brain, 'index.md');
  const index = renderIndex(brain, now, waiting);
  const prior = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const strip = (t) => t.replace(/^- \*\*Last updated:\*\*.*$/m, '').replace(/\(as of .*?\)/, '');
  if (strip(prior) !== strip(index)) {
    run.actions.push('edit  index.md  (regenerated)');
    if (!dryRun) fs.writeFileSync(indexPath, index, 'utf8');  // in place: keeps the file's author
  }
  // One line per run, only when it changed something (§17.5.4).
  const changed = run.actions.filter((a) => !a.startsWith('note')).length;
  if (!dryRun && changed) {
    const log = path.join(brain, 'System', 'logs', `librarian-${now.month}.md`);
    const head = fs.existsSync(log) ? fs.readFileSync(log, 'utf8')
      : `# Librarian log: ${now.month}\n\n- **Kind:** log\n- **Author:** librarian\n`;
    const s = run.stats;
    const sep = /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} ET · /.test(head.trimEnd().split('\n').pop()) ? '\n' : '\n\n';
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, `${head.trimEnd()}${sep}- ${now.stamp} · ${runner} · applied ${s.applied}, needs a look ${s.needsLook}, waiting ${waiting.length}, `
      + `path references ${s.pathRefs} (${changed} file change${changed === 1 ? '' : 's'})\n`, 'utf8');
  }
  if (runner === 'cloud' && !dryRun) writeHeartbeat(brain, now);
  return run.actions;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const quiet = process.argv.includes('--quiet');
  const force = process.argv.includes('--force');
  try {
    const brain = sharedBrainPath();
    if (!brain || !fs.existsSync(brain)) process.exit(0);
    const actions = runLibrarian(brain, { dryRun, force });
    const cloud = cloudLibrarian(brain);
    if (!actions.length && !force && cloud.fresh && !quiet) console.log(`[Librarian] standing by: the cloud Librarian ran at ${cloud.at} (--force runs anyway)`);
    if (!quiet || dryRun) for (const a of actions) console.log(`[Librarian]${dryRun ? ' (dry run)' : ''} ${a}`);
  } catch (err) {
    console.log(`[Librarian] error (nothing lost; next run retries): ${err.message}`);
  }
}
