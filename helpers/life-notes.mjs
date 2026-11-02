// Ported from Brainiac (the alfie repo, engine/src/life/); keep the two in step.
// --- life-notes.mjs ---------------------------------------------------------------------
// Life admin for the AIs that only read and write files (Grok in the car, say): the "Life admin" part of index.md,
// which says what to remind the user about today from each record's own date and reminder window, and how the
// Librarian applies a change note sent to a Life/ record. A note uses the usual words (§17): `close` means "done this
// time", so the date moves on and the record stays; `- **Set:** Next due = <date>` snoozes it.
// ---------------------------------------------------------------------------
import { daysBetween, addDays } from './life-schedule.mjs';
import { actOn, fail, readRecord } from './life-store.mjs';
import { lifeView, safeDue } from './life-view.mjs';

export const LIFE_RECORD = /^Life\/(Recurring|People|Documents|Assets)\/[^/\\]+\.md$/;
const SETTABLE = ['status', 'next due', 'last done', 'last contact', 'expires'];
const RETIRE_REASONS = ['cancelled', 'duplicate', 'mistake', 'superseded'];
const SKIP_REASONS = ['not-needed', 'expired'];
const MAX_LINES = 12;

const firstWord = (v) => String(v || '').trim().split(/[\s(]/)[0].toLowerCase();
const dateIn = (v) => (String(v || '').match(/\d{4}-\d{2}-\d{2}/) || [])[0] || null;

// --- Applying a change note to a Life record ---
// The thing a person or document record has coming up first: its birthday, a keep-in-touch, a warranty end.
function nextDueItem(rec, today) {
  const items = safeDue(rec, today).filter((i) => i.due).sort((a, b) => a.due.localeCompare(b.due));
  if (!items.length) fail(`nothing is coming up for ${rec.title} to mark done`);
  return items[0];
}

function closeRecord(rec, n, act, today) {
  const reason = n.reason || (firstWord(n.set.status) === 'cancelled' ? 'cancelled' : 'done');
  if (rec.register === 'recurring') {
    if (RETIRE_REASONS.includes(reason)) return act('retire');
    if (SKIP_REASONS.includes(reason) && rec.repeats !== 'once') return act('skip');
    return act('done', { on: dateIn(n.set['last done']) || today });
  }
  if (rec.register === 'documents') {
    fail('a renewed document needs its new expiry date: "- **Set:** Expires = YYYY-MM-DD"');
  }
  const it = nextDueItem(rec, today);
  if (it.actions.includes('wished')) return act('wished', { occasion: it.occasion, for: it.due });
  if (it.actions.includes('contacted')) return act('contacted', { on: today });
  return act('noted', { what: it.what });
}

// Returns what it did, for the note's Applied line. Throws (and the note is left for a person) on anything else.
export function applyLifeNote(brain, n, rel, { asOf, by }) {
  if (!LIFE_RECORD.test(rel)) fail(`${rel} is not a life-admin record`);
  const bad = Object.keys(n.set).filter((f) => !SETTABLE.includes(f));
  if (bad.length) fail(`can't set ${bad.join(', ')} on a life record by note; change it in Brainiac`);
  const rec = readRecord(brain, rel);
  const today = asOf.date;
  const said = [];
  const act = (action, opts = {}) => {
    const r = actOn(brain, rel, action, opts, { by, now: asOf });
    said.push(r.said);
    return r;
  };
  const status = firstWord(n.set.status);
  if (n.close) closeRecord(rec, n, act, today);
  else if (status === 'paused') act('pause');
  else if (['active', 'open'].includes(status)) act('resume');
  else if (status === 'retired') act('retire');
  else if (status) fail(`"${status}" is not a status a life record takes (active, paused, retired)`);
  if (n.set['next due']) act('snooze', { to: dateIn(n.set['next due']) || n.set['next due'] });
  if (n.set['last done'] && !n.close) act('done', { on: dateIn(n.set['last done']) });
  if (n.set['last contact']) act('contacted', { on: dateIn(n.set['last contact']) });
  if (n.set.expires) act('renewed', { expires: dateIn(n.set.expires) || n.set.expires });
  if (!said.length) fail('no change for a life record in this note');
  return `${rel}: ${said.join('; ')}`;
}

// --- The Life admin part of index.md ---
const ago = (n) => (n === 1 ? 'yesterday' : `${n} days ago`);
const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

function lineOf(it, today, waiting) {
  const n = daysBetween(today, it.due);
  const when = n < 0 ? `was due ${it.due} (${ago(-n)})` : `due ${it.due} (${inDays(n)})`;
  const money = it.amount ? ` · ${it.amount}${it.autopay ? ' · autopay' : ''}` : '';
  const remindFrom = n > 0 && it.lead ? ` · remind from ${addDays(it.due, -it.lead)}` : '';
  const change = waiting.get(it.file) ? ` · change waiting: ${waiting.get(it.file)}` : '';
  return `- ${it.title} · ${when}${money}${remindFrom}${change} · \`${it.file}\``;
}

// What an AI asked for by note but the Librarian has not written yet, shown beside the record.
function waitingByFile(notes) {
  const out = new Map();
  for (const n of notes || []) {
    if (!LIFE_RECORD.test(n.target)) continue;
    const what = n.close ? 'done' : n.set['next due'] ? `snooze to ${n.set['next due']}` : 'a change';
    out.set(n.target, what);
  }
  return out;
}

const listed = (title, items, show) => {
  if (!items.length) return [];
  const more = items.length > MAX_LINES ? [`- and ${items.length - MAX_LINES} more (in the Life tab)`] : [];
  return [`### ${title} (${items.length})`, ...items.slice(0, MAX_LINES).map(show), ...more, ''];
};

// Empty when the brain keeps no life admin, so index.md stays as it was.
export function lifeIndexSection(brain, now, notes = []) {
  let v;
  try {
    v = lifeView(brain, now, { horizon: 30 });
  } catch {
    return [];
  }
  if (!v.counts.active) return [];
  const today = now.date;
  const waiting = waitingByFile(notes);
  const show = (it) => lineOf(it, today, waiting);
  const dueToday = v.upcoming.week.filter((i) => i.due === today);
  const remindNow = v.attention.filter((i) => i.due > today);
  const later = [...v.upcoming.week, ...v.upcoming.month].filter((i) => i.standing === 'later');
  const byHand = [...v.upcoming.late, ...v.upcoming.week].filter((i) => i.amount && !i.autopay);
  return [
    `## Life admin (as of ${now.stamp})`, '',
    'From `Life/` (RULEBOOK §19): what to remind the user about, from each record\'s date and its own reminder '
      + 'window. Mention late, due-today and remind-now ones at wake and in the brief, once a day each; the file wins '
      + 'if it disagrees. When the user says one is done, send a change note to its file: `close` = done this time '
      + '(the date moves on, the record stays); `- **Set:** Next due = YYYY-MM-DD` = snooze; `close` with '
      + '`- **Reason:** not-needed` = skip this time; `- **Set:** Expires = YYYY-MM-DD` = a document renewed.', '',
    ...listed('Late', v.upcoming.late, show),
    ...listed('Due today', dueToday, show),
    ...listed('Remind now: due soon', remindNow, show),
    ...listed('Coming up in the next 30 days', later, show),
    ...(byHand.length ? [`Bills to pay by hand in the next 7 days: ${byHand.length}.`, ''] : []),
    ...(v.counts.needsDate ? [`${v.counts.needsDate} record(s) need a date (in the Life tab).`, ''] : []),
    ...(v.upcoming.late.length || dueToday.length || remindNow.length || later.length ? [] : ['- nothing due', '']),
  ];
}
