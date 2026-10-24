// --- brain-notes.mjs ---------------------------------------------------------
// Change notes: how Grok changes things it cannot edit (MANIFESTO rule 2, §6).
//
// Grok's Google Drive connector can create new files but cannot edit or move
// existing ones. So Grok never edits: every change to an existing item is a new
// small file in Inbox/ (a `close`, `amend`, `change` or calendar `capture`
// signal). This module
//   - reads those notes (one reader for everyone),
//   - applies them for the Librarian, "as of" the time Grok wrote them, through
//     the same checked writer the dashboard uses (brain-items.mjs),
//   - reports what is still waiting, so every view (dashboard, index.md, the
//     session-start list) shows a waiting change as already made, and
//   - lists recent changes made anywhere, so Grok can bring its own copies up
//     to date (the other direction).
// A change made after the note (at the desk, say) wins: the note is filed as
// superseded and nothing is overwritten. Nothing is ever deleted; a replaced
// file's old text is kept in Archive/.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { cleanRef, easternNow, firstWord, mdFiles, nowFromStamp, readFields, setField, stampOf } from './brain-core.mjs';
import { CALENDAR_FILE, cancelEvent, findEvent, parseEvents, readCalendar } from './brain-calendar.mjs';
import { createEvent, oneLine, updateReminder, updateRoutine } from './brain-items.mjs';

const NOTE_TYPES = ['close', 'amend', 'change', 'capture'];
const LOCKED = [/^MANIFESTO\.md$/i, /^README\.md$/i, /^index\.md$/i, /^Inbox\//i, /^Archive\//i,
  /^Memory\/agents\/claude-code\//i, /^System\/agents\/claude-code\.md$/i];
const REMINDER_RAW = ['until', 'nudge'];
const REMINDER_SET = ['title', 'due', 'time', 'kind', 'scope', 'note', 'status', ...REMINDER_RAW];
const ROUTINE_SET = ['title', 'schedule', 'time', 'status', 'note'];
const RECENT_HOURS = 48;
const RECENT_MAX = 30;

const fail = (msg) => { throw new Error(msg); };
const cap = (f) => f.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const titleOf = (text, fallback) => (text.match(/^#\s+(.+)$/m) || [, fallback])[1].trim();

// --- Reading one note ----------------------------------------------------------------
export function parseNote(name, text) {
  // The note's own fields come from above any "=====" replacement block, never from inside it
  // (a replacement routine carries its own Kind, Type and Status lines).
  const h = readFields(text.split(/^={5,}\s*$/m)[0]);
  const type = firstWord(h.type);
  const target = [h.target, h.re].map(cleanRef).find((r) => /\.md$/i.test(r)) || '';
  const set = {};
  const add = [];
  const cancel = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // "- **Set:** Due = 2026-10-30", or several on one line: "- **Set:** Due: 2026-10-24; Nudge: wake + brief".
    const s = line.match(/^- \*\*Set:\*\*\s*(.+)$/);
    if (s) {
      for (const part of s[1].split(/\s*;\s*/)) {
        const kv = part.match(/^([A-Za-z ]+?)\s*(?:=|:)\s*(.+)$/);
        if (kv) set[kv[1].trim().toLowerCase()] = kv[2].trim();
      }
    }
    for (const rep of line.matchAll(/replace\s+`- \*\*([A-Za-z ]+):\*\*[^`]*`\s+with\s+`- \*\*([A-Za-z ]+):\*\*\s*([^`]*)`/gi)) {
      if (rep[1].toLowerCase() === rep[2].toLowerCase()) set[rep[1].trim().toLowerCase()] = rep[3].trim();
    }
    const a = line.match(/^- \*\*Add:\*\*\s*(?:-\s+)?(.+)$/);
    if (a) add.push(...parseEvents(`- ${a[1].trim()}`).events);
    const c = line.match(/^- \*\*Cancel:\*\*\s*(\d{4}-\d{2}-\d{2})\s+(.+?)\s*$/);
    if (c) cancel.push({ date: c[1], title: c[2].replace(/^\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\s+/, '').replace(/\s+@\s+.*$/, '') });
  }
  // A calendar capture carries plain event lines in its body (the Travel Bot shape).
  if (type === 'capture' && target === CALENDAR_FILE && !add.length) add.push(...parseEvents(text).events);
  // A whole-file replacement sits between two "=====" lines.
  const fences = lines.map((l, i) => (/^={5,}\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
  const replace = fences.length >= 2 ? `${lines.slice(fences[0] + 1, fences[1]).join('\n').trim()}\n` : null;
  const status = firstWord(h.status) || 'open';
  const from = (h.from || (name.match(/^\d{4}-\d{2}-\d{2}-\d{4}--([a-z0-9-]+)--/i) || [])[1] || '').toLowerCase();
  const close = type === 'close' || ['done', 'cancelled'].includes(firstWord(set.status));
  const actionable = NOTE_TYPES.includes(type) && !!target
    && (close || Object.keys(set).length > 0 || add.length > 0 || cancel.length > 0 || !!replace);
  return { name, file: `Inbox/${name}`, type, from, status, created: stampOf(h.created) || null, target, set, add, cancel, replace, close, actionable };
}

export function openNotes(brain) {
  const inbox = path.join(brain, 'Inbox');
  return mdFiles(inbox)
    .map((f) => parseNote(f, fs.readFileSync(path.join(inbox, f), 'utf8')))
    .filter((n) => n.status === 'open' && NOTE_TYPES.includes(n.type))
    .sort((a, b) => `${a.created || ''}${a.name}`.localeCompare(`${b.created || ''}${b.name}`));
}

// --- Where a note points ---------------------------------------------------------------
function resolveTarget(brain, ref) {
  if (ref === CALENDAR_FILE) return { kind: 'calendar', rel: ref };
  const base = path.basename(ref);
  const tries = /^Reminders\//.test(ref) || !ref.includes('/')
    ? [ref, `Reminders/${base}`, `Reminders/Done/${base}`, ...(!ref.includes('/') ? [`Routines/${base}`] : [])] : [ref];
  const rel = tries.find((r) => fs.existsSync(path.join(brain, r))) || null;
  const pick = rel || ref;
  const kind = /^Reminders\//.test(pick) ? 'reminder' : /^Routines\//.test(pick) ? 'routine' : 'file';
  return { kind, rel: pick, full: path.join(brain, pick), exists: !!rel, inDone: /^Reminders\/Done\//.test(pick) };
}

// A change made to the target after the note was written wins over the note.
function supersededBy(t, note) {
  if (!t.exists || !note.created) return null;
  const lu = stampOf(readFields(fs.readFileSync(t.full, 'utf8'))['last updated']);
  return lu && lu > note.created ? lu : null;
}

// --- Applying ---------------------------------------------------------------------------
function splitDue(v) {
  const s = String(v || '').trim();
  if (/^none\b/i.test(s)) return { due: 'none' };
  const d = (s.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
  const t = (s.match(/\b\d{1,2}:\d{2}\b/) || [])[0];
  if (!d) fail(`"${oneLine(s, 30)}" is not a date`);
  return { due: d, ...(t ? { time: t.padStart(5, '0') } : {}) };
}

function closeReminder(brain, t, { asOf, by, cancelled, run }) {
  let text = fs.readFileSync(t.full, 'utf8');
  if (!['done', 'cancelled'].includes(firstWord(readFields(text).status))) {
    text = setField(setField(text, 'Status', cancelled ? 'cancelled' : 'done'), 'Last updated', asOf.stamp);
    text = `${text.trimEnd()}\n- Closed: ${asOf.stamp} by ${by}\n`;
    run.write(t.full, text, 'closed by change note');
  }
  if (!t.inDone) run.move(t.full, path.join(brain, 'Reminders', 'Done'), 'closed');
  return `${cancelled ? 'cancelled' : 'closed'} ${t.rel}`;
}

function applyToReminder(brain, n, t, ctx) {
  if (n.replace) return replaceFile(brain, t, n, ctx);
  if (n.close) return closeReminder(brain, t, { ...ctx, cancelled: firstWord(n.set.status) === 'cancelled' });
  const bad = Object.keys(n.set).filter((f) => !REMINDER_SET.includes(f));
  if (bad.length) fail(`can't set ${bad.join(', ')} on a reminder by note`);
  let rel = t.rel;
  const reopen = t.inDone && (['open', 'snoozed'].includes(firstWord(n.set.status)) || n.set.due);
  let text = fs.readFileSync(t.full, 'utf8');
  const raw = [];
  if (n.set.status && ['open', 'snoozed'].includes(firstWord(n.set.status))) { text = setField(text, 'Status', firstWord(n.set.status)); raw.push(`status → ${firstWord(n.set.status)}`); }
  else if (reopen) { text = setField(text, 'Status', 'open'); raw.push('status → open'); }
  else if (n.set.status) fail(`status "${oneLine(n.set.status, 20)}" can't be set by note`);
  for (const f of REMINDER_RAW) if (n.set[f]) { text = setField(text, cap(f), oneLine(n.set[f], 80)); raw.push(`${f} → ${oneLine(n.set[f], 40)}`); }
  if (raw.length) {
    text = `${setField(text, 'Last updated', ctx.asOf.stamp).trimEnd()}\n- Edited: ${ctx.asOf.stamp} by ${ctx.by}: ${raw.join('; ')}\n`;
    ctx.run.write(t.full, text, 'changed by change note');
  }
  if (reopen) { const to = ctx.run.move(t.full, path.join(brain, 'Reminders'), 'reopened by change note'); if (to) rel = `Reminders/${path.basename(to)}`; }
  const changes = {};
  for (const f of ['title', 'kind', 'scope', 'note']) if (n.set[f] != null) changes[f] = n.set[f];
  if (n.set.due != null) Object.assign(changes, splitDue(n.set.due));
  if (n.set.time != null) changes.time = /^none$/i.test(n.set.time) ? null : n.set.time;
  if (Object.keys(changes).length) {
    try { updateReminder(brain, rel, changes, { by: ctx.by, now: ctx.asOf }); } catch (err) { if (!(raw.length && /nothing to change/.test(err.message))) throw err; }
  }
  return `changed ${rel}`;
}

function applyToRoutine(brain, n, t, ctx) {
  const h = readFields(fs.readFileSync(t.full, 'utf8'));
  const usersOwn = /\bthe user\b/i.test(h.runs || '');
  if (!usersOwn && firstWord(h.runs) !== n.from) fail(`only ${h.runs || 'the AI that runs it'} changes this routine`);
  if (n.replace) return replaceFile(brain, t, n, ctx);
  const bad = Object.keys(n.set).filter((f) => !ROUTINE_SET.includes(f) && usersOwn);
  if (bad.length) fail(`can't set ${bad.join(', ')} on a routine by note`);
  if (usersOwn) {
    const changes = {};
    for (const f of ROUTINE_SET) if (n.set[f] != null) changes[f] = f === 'status' ? firstWord(n.set[f]) : n.set[f];
    updateRoutine(brain, t.rel, changes, { by: ctx.by, now: ctx.asOf });
    return `changed ${t.rel}`;
  }
  // An AI's own routine, changed by that AI: header fields as written.
  let text = fs.readFileSync(t.full, 'utf8');
  for (const [f, v] of Object.entries(n.set)) text = setField(text, cap(f), oneLine(v, 200));
  text = `${setField(text, 'Last updated', ctx.asOf.stamp).trimEnd()}\n- Edited: ${ctx.asOf.stamp} by ${ctx.by}: ${Object.keys(n.set).join(', ')}\n`;
  ctx.run.write(t.full, text, 'changed by change note');
  return `changed ${t.rel}`;
}

function replaceFile(brain, t, n, { run, now, by }) {
  if (LOCKED.some((re) => re.test(t.rel))) fail(`${t.rel} is not changed by note (MANIFESTO rule 2)`);
  if (!/^#\s+\S/.test(n.replace) || n.replace.trim().length < 40) fail('the replacement text has no "# " title or is too short');
  if (t.exists) {
    const keep = path.join(brain, 'Archive', now.month, 'replaced');
    const stamp = now.stamp.replace(/\D/g, '').slice(0, 12);
    const copy = path.join(keep, `${t.rel.replace(/[\\/]/g, '__').replace(/\.md$/i, '')}--${stamp}.md`);
    run.write(copy, fs.readFileSync(t.full, 'utf8'), `old text kept before a change note replaced ${t.rel}`);
  }
  run.write(t.full, `${n.replace.trimEnd()}\n`, `replaced by change note from ${n.from || '?'}`);
  return `replaced ${t.rel}${t.exists ? ' (old text in Archive/)' : ''}`;
}

function applyToCalendar(brain, n, { asOf, now }) {
  const done = [];
  for (const ev of n.add) {
    if (findEvent(readCalendar(brain).events, ev)) { done.push(`already there: ${ev.date} ${ev.title}`); continue; }
    createEvent(brain, { ...ev }, { by: n.from || 'grok', now: asOf });
    done.push(`added ${ev.date} ${ev.title}`);
  }
  for (const c of n.cancel) { cancelEvent(brain, c, { by: n.from || 'grok', now }); done.push(`cancelled ${c.date} ${c.title}`); }
  if (!done.length) fail('no event line could be read');
  return done.join('; ');
}

// The Librarian's step 1: apply every open change note, oldest first.
export function applyChangeNotes(brain, run, now = easternNow()) {
  for (const n of openNotes(brain)) {
    const note = path.join(brain, n.file);
    if (!n.actionable) {
      if (['amend', 'change', 'close'].includes(n.type)) run.note(`${n.type} signal ${n.name}: no structured change found; left for a person`);
      continue;
    }
    if (run.dryRun) { run.note(`would apply ${n.type} note ${n.name} to ${n.target}`); continue; }
    const asOf = nowFromStamp(n.created) || now;
    const by = `${n.from || 'another AI'} (change note, applied ${now.stamp})`;
    const ctx = { run, now, asOf, by };
    let outcome;
    try {
      const t = resolveTarget(brain, n.target);
      if (t.kind === 'calendar') outcome = applyToCalendar(brain, n, ctx);
      else {
        if (!t.exists && !(n.replace && t.kind === 'file')) fail(`target "${n.target}" not found`);
        const later = supersededBy(t, n);
        if (later) {
          outcome = `superseded: ${t.rel} was changed at ${later}, after this note; nothing applied`;
        } else if (t.kind === 'reminder') outcome = applyToReminder(brain, n, t, ctx);
        else if (t.kind === 'routine') outcome = applyToRoutine(brain, n, t, ctx);
        else if (n.replace) outcome = replaceFile(brain, t, n, ctx);
        else fail(`only a whole-file replacement can change ${t.rel} by note`);
      }
    } catch (err) {
      const why = oneLine(err.message, 160);
      run.write(note, setField(fs.readFileSync(note, 'utf8'), 'Status', `needs a look (${why})`), 'change note could not be applied');
      run.note(`${n.type} note ${n.name}: ${why}; left for a person`);
      continue;
    }
    const text = setField(fs.readFileSync(note, 'utf8'), 'Status', `done (applied by librarian ${now.stamp})`);
    run.write(note, `${text.trimEnd()}\n- Applied: ${now.stamp}: ${outcome}\n`, 'change note applied');
    run.move(note, path.join(brain, 'Inbox', 'Done'), 'change note applied');
  }
}

// --- What is still waiting, for the views ------------------------------------------------
// {reminders: Map(file name -> {note, close, fields}), routines: Map(file name -> {note, fields}),
//  calendar: {add: [event], cancel: [{date, title}]}}. A note a later change has overtaken is left out.
export function pendingChanges(brain) {
  const out = { reminders: new Map(), routines: new Map(), calendar: { add: [], cancel: [] } };
  if (!brain || !fs.existsSync(path.join(brain, 'Inbox'))) return out;
  for (const n of openNotes(brain).filter((x) => x.actionable)) {
    const t = resolveTarget(brain, n.target);
    if (t.kind === 'calendar') {
      out.calendar.add.push(...n.add.map((e) => ({ ...e, by: n.from || 'grok', note: n.file })));
      out.calendar.cancel.push(...n.cancel);
      continue;
    }
    if (!t.exists || supersededBy(t, n)) continue;
    let set = n.set;
    if (n.replace) {
      const f = readFields(n.replace);
      set = { title: titleOf(n.replace, ''), due: f.due, kind: f.kind, scope: f.scope, schedule: f.schedule, status: f.status };
    }
    const fields = {};
    if (set.title) fields.title = oneLine(set.title, 80).replace(/^the user:\s*/i, '');
    if (set.kind) fields.kind = firstWord(set.kind);
    if (set.scope) fields.scope = firstWord(set.scope);
    if (set.schedule) fields.schedule = oneLine(set.schedule, 80);
    if (set.due) { try { const d = splitDue(set.due); fields.due = d.due === 'none' ? null : d.due; if (d.time) fields.time = d.time; } catch { /* unreadable: shown unchanged */ } }
    if (set.time) fields.time = /^none$/i.test(set.time) ? null : set.time;
    const close = n.close || ['done', 'cancelled', 'expired'].includes(firstWord(set.status));
    const entry = { note: n.file, close, paused: firstWord(set.status) === 'paused', resumed: firstWord(set.status) === 'active', fields };
    (t.kind === 'routine' ? out.routines : out.reminders).set(path.basename(t.rel), entry);
  }
  return out;
}

// Open reminders as they will be once the waiting notes are applied.
export function overlayReminders(items, pending) {
  if (!pending || !pending.reminders.size) return items;
  return items.flatMap((i) => {
    const p = pending.reminders.get(path.basename(i.file));
    if (!p) return [i];
    if (p.close) return [];
    return [{ ...i, ...p.fields, pendingNote: p.note }];
  });
}

// --- The other direction: what changed recently, anywhere --------------------------------
// From the dated lines every edit leaves (Edited, Closed, Moved, Amended, Expired) and each
// new item's Created stamp. index.md lists these so Grok can bring its own copies (its
// memory, its scheduled pings) up to date with changes made at the desk.
export function recentChanges(brain, now = easternNow(), hours = RECENT_HOURS) {
  const since = easternNow(new Date(now.ms - hours * 3600 * 1000)).stamp;
  const rows = [];
  for (const folder of ['Reminders', 'Reminders/Done', 'Routines']) {
    for (const f of mdFiles(path.join(brain, folder))) {
      const rel = `${folder}/${f}`;
      const text = fs.readFileSync(path.join(brain, rel), 'utf8');
      const title = titleOf(text, f).replace(/^the user:\s*/i, '');
      const h = readFields(text);
      const created = stampOf(h.created);
      if (created && created >= since && created <= now.stamp) rows.push({ stamp: created, what: `added by ${oneLine((h.author || '?').split('(')[0], 40)}`, title, file: rel });
      for (const m of text.matchAll(/^- (Edited|Closed|Moved|Amended|Expired): (\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET)\s*(.*)$/gm)) {
        if (m[2] < since || m[2] > now.stamp) continue;
        rows.push({ stamp: m[2], what: `${m[1].toLowerCase()} ${oneLine(m[3], 140)}`.trim(), title, file: rel });
      }
    }
  }
  return rows.sort((a, b) => b.stamp.localeCompare(a.stamp)).slice(0, RECENT_MAX);
}

