#!/usr/bin/env node
// --- brain-handoffs.mjs ------------------------------------------------------
// The two handoff files at the Drive root, next to the Second Brain folder
// (MANIFESTO §6, directed by the user 2026-10-24):
//   handoff-grok-to-claude.md  only Grok writes it (Grok's connector can edit
//                              only files Grok created); Claude reads it
//   handoff-claude-to-grok.md  only Claude writes it; Grok reads it
// Every item has an ID: G-YYYY-MM-DD-HHMM is something Grok asks Claude,
// C-YYYY-MM-DD-HHMM something Claude asks Grok. Each side reports on the
// other's item, under the same ID, in its own file. The asker clears its ask
// once the other file reports it; the reporter clears its report once the ask
// is gone. Cleared items are kept in System/logs/handoffs-YYYY-MM.md.
//
// `check` is the cheap first step of every handoff pass (the hourly check and
// every desk session): with --apply it runs the Librarian when a change note
// is waiting and clears our reports whose ask Grok has cleared, then lists
// only what needs judgement. Prints "nothing new" when there is nothing.
//
//   node brain-handoffs.mjs check [--apply] [--json]
//   node brain-handoffs.mjs report <G-id> --status done|needs-the-user|in-progress --text "<what changed>" [--for-you "<for Grok>"]
//   node brain-handoffs.mjs ask "<title>" --words "<the user's words>" --do "<what Grok should do>"
//   node brain-handoffs.mjs clear <id>
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { easternNow, firstWord, mdFiles, nowFromStamp, readFields, stampOf } from './brain-core.mjs';
import { openNotes, parseNote } from './brain-notes.mjs';
import { runLibrarian, sharedBrainPath } from './brain-librarian.mjs';

// --- Configuration ---
export const GROK_FILE = 'handoff-grok-to-claude.md';
export const CLAUDE_FILE = 'handoff-claude-to-grok.md';
const REPORTS = "## Done or answered (Grok's asks)";
const ASKS = '## Asks for Grok';
const ID_RE = /\b([GC]-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?)\b/;
const STATUSES = ['done', 'needs-the-user', 'in-progress'];
const WAIT_HOURS = 48;
const TO_CLAUDE = ['claude', 'claude-code', 'librarian', 'all'];
const deferred = (text) => /^- Deferred: /m.test(text);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

// --- Reading a handoff file ---
// Items are "## " or "### " headings carrying an ID; the item runs to the next heading. Grok also
// writes asks as list items, "- **G-YYYY-MM-DD-HHMM:** text" with indented lines under them; those
// run to the next list item, heading or unindented line. An item's `opened` is its Opened (or older
// Asked) time, else the time in its ID.
const LIST_ITEM_RE = /^[-*]\s+\*\*([GC]-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?)\s*(?::\*\*|\*\*\s*:?)\s*(.*)$/;
const listTitle = (s) => String(s || '').replace(/\*\*/g, '').split(/(?<=[a-z)\]])\.\s|\n/)[0].replace(/[\s:.]+$/, '').trim().slice(0, 100);
export const idStamp = (id) => {
  const m = /^[GC]-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/.exec(id || '');
  return m ? `${m[1]} ${m[2]}:${m[3]} ET` : null;
};

export function parseItems(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  let cur = null;
  const close = (i) => { if (cur) { cur.end = i; items.push(cur); cur = null; } };
  lines.forEach((l, i) => {
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      close(i);
      const m = h[2].match(ID_RE);
      if (m && h[1].length >= 2) cur = { id: m[1], side: m[1][0], title: h[2].replace(ID_RE, '').replace(/^[\s·:—-]+/, '').trim(), start: i };
      return;
    }
    const li = l.match(LIST_ITEM_RE);
    if (li) { close(i); cur = { id: li[1], side: li[1][0], title: listTitle(li[2]), start: i, list: true }; return; }
    if (cur?.list && l.trim() && !/^\s/.test(l)) close(i);  // an unindented line ends a list item
  });
  close(lines.length);
  for (const it of items) {
    const body = lines.slice(it.start + 1, it.end).map((l) => (it.list ? l.trim() : l)).join('\n');
    const f = readFields(body);
    it.status = f.status || '';
    it.state = firstWord(it.status).replace(/[^a-z-]/g, '') || 'pending';
    it.opened = stampOf(f.opened) || stampOf(f.asked) || idStamp(it.id);
  }
  return items;
}
const isOpen = (it) => !['done', 'cancelled'].includes(it.state);

// --- The loop's state: asks with no report from the other side (§17.4) ---
const hoursSince = (stamp, now) => {
  const t = nowFromStamp(stamp);
  const n = nowFromStamp(now.stamp);
  return t && n ? Math.max(0, (n.ms - t.ms) / 3600000) : 0;
};
// Open asks on both sides that the other file has not reported on, oldest first, with their age;
// `overdue` once one has waited 48 hours. Never closes anything.
export function openAsks(grokText, claudeText, now = easternNow()) {
  const grok = parseItems(grokText);
  const mine = parseItems(claudeText);
  const grokIds = new Set(grok.map((x) => x.id));
  const mineIds = new Set(mine.map((x) => x.id));
  const rows = [
    ...grok.filter((x) => x.side === 'G' && isOpen(x) && !mineIds.has(x.id)).map((x) => ({ ...x, asker: 'grok' })),
    ...mine.filter((x) => x.side === 'C' && isOpen(x) && !grokIds.has(x.id)).map((x) => ({ ...x, asker: 'claude' })),
  ].map((x) => {
    const hours = hoursSince(x.opened, now);
    return { id: x.id, title: x.title, asker: x.asker, opened: x.opened, hours, days: Math.floor(hours / 24), overdue: hours >= WAIT_HOURS };
  });
  return rows.sort((a, b) => String(a.opened).localeCompare(String(b.opened)));
}
export function handoffWaiting(brain, now = easternNow()) {
  const driveRoot = path.dirname(brain);
  return openAsks(read(path.join(driveRoot, GROK_FILE)), read(path.join(driveRoot, CLAUDE_FILE)), now).filter((x) => x.overdue);
}

const ageText = (hours) => (hours < 24 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`);
// "- **Loop:** synced … · open asks N · reports pending M · oldest open <ID> (<age>)" for Claude's file:
// N is Claude's own asks still open, M Grok's asks still waiting for Claude's report.
export function loopLine(claudeText, grokText, now = easternNow()) {
  const mineOpen = parseItems(claudeText).filter((x) => x.side === 'C' && isOpen(x));
  const waiting = openAsks(grokText, claudeText, now);
  const owed = waiting.filter((x) => x.asker === 'grok');
  const oldest = [...mineOpen.map((x) => ({ id: x.id, hours: hoursSince(x.opened, now), opened: x.opened })), ...owed]
    .sort((a, b) => String(a.opened).localeCompare(String(b.opened)))[0];
  return `- **Loop:** synced ${now.stamp} · open asks ${mineOpen.length} · reports pending ${owed.length} · oldest open ${oldest ? `${oldest.id} (${ageText(oldest.hours)})` : 'none'}`;
}

// The Loop line sits right under the file's header fields (the first run of "- **Field:**" lines).
function withLoop(text, line) {
  if (/^- \*\*Loop:\*\*.*$/m.test(text)) return text.replace(/^- \*\*Loop:\*\*.*$/m, line);
  const lines = text.split('\n');
  const first = lines.findIndex((l) => /^- \*\*[A-Za-z' ]+:\*\*/.test(l));
  if (first < 0) { const title = lines.findIndex((l) => /^# /.test(l)); lines.splice(title + 1, 0, '', line); return lines.join('\n'); }
  let last = first;
  while (last + 1 < lines.length && /^- \*\*[A-Za-z' ]+:\*\*/.test(lines[last + 1])) last++;
  lines.splice(last + 1, 0, line);
  return lines.join('\n');
}

// --- Writing Claude's file ---
function claudeTemplate(now) {
  return ['# Claude → Grok handoff file', '',
    '- **Kind:** handoff file',
    '- **From:** Claude Code',
    '- **To:** Grok',
    '- **Author:** Claude Code (only Claude writes this file; Grok reads it)',
    `- **Grok's file:** \`${GROK_FILE}\` (only Grok writes it; Claude reads it)`,
    `- **Last updated:** ${now.stamp}`, '',
    'How it works (MANIFESTO §6): every item has an ID. `G-…` is something Grok asked Claude; `C-…` is something Claude asks Grok. Each side reports on the other\'s item, under the same ID, in its own file. Clear your own ask once the other file reports it; clear a report once its ask is gone from the other file. Never edit the other AI\'s file.', '',
    REPORTS, '', ASKS, ''].join('\n');
}

function withoutItem(text, id) {
  const lines = text.split(/\r?\n/);
  const it = parseItems(text).find((x) => x.id === id);
  if (!it) return { text, item: null };
  const block = lines.slice(it.start, it.end).join('\n').trim();
  lines.splice(it.start, it.end - it.start);
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), item: { ...it, block } };
}

function insertUnder(text, heading, block) {
  const lines = text.trimEnd().split(/\r?\n/);
  let at = lines.indexOf(heading);
  if (at < 0) { lines.push('', heading); at = lines.length - 1; }
  let end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  if (end < 0) end = lines.length;
  while (end > at + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, '', ...block.trim().split('\n'), '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// Every write stamps Last updated and rewrites the Loop line (§17.4).
function saveClaudeFile(driveRoot, text, now) {
  const stamped = text.replace(/- \*\*Last updated:\*\* .*/, `- **Last updated:** ${now.stamp}`);
  fs.writeFileSync(path.join(driveRoot, CLAUDE_FILE), withLoop(stamped, loopLine(stamped, read(path.join(driveRoot, GROK_FILE)), now)), 'utf8');
}

function logCleared(brain, item, why, now) {
  const log = path.join(brain, 'System', 'logs', `handoffs-${now.month}.md`);
  const head = read(log) || `# Handoff log: ${now.month}\n\nItems cleared from \`${CLAUDE_FILE}\`, kept whole.\n`;
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, `${head.trimEnd()}\n\n- ${now.stamp} cleared ${item.id} (${why})\n\n${item.block.replace(/^#{2,3} /, '#### ')}\n`, 'utf8');
}

export function clearItem(brain, id, why = 'cleared by Claude', now = easternNow()) {
  const driveRoot = path.dirname(brain);
  const { text, item } = withoutItem(read(path.join(driveRoot, CLAUDE_FILE)), id);
  if (!item) return false;
  logCleared(brain, item, why, now);
  saveClaudeFile(driveRoot, text, now);
  return true;
}

export function report(brain, id, { status, text, forYou = '' }, now = easternNow()) {
  if (!/^G-/.test(id || '')) throw new Error('report takes the ID of one of Grok\'s asks (G-…)');
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const driveRoot = path.dirname(brain);
  const ask = parseItems(read(path.join(driveRoot, GROK_FILE))).find((x) => x.id === id);
  let body = read(path.join(driveRoot, CLAUDE_FILE)) || claudeTemplate(now);
  body = withoutItem(body, id).text;
  const block = [`### ${id} · ${ask?.title || 'Grok\'s ask'}`,
    `- **Status:** ${status.replace(/-/g, ' ')} (${now.stamp})`,
    `- **What changed:** ${text}`,
    ...(forYou ? [`- **For you:** ${forYou}`] : [])].join('\n');
  saveClaudeFile(driveRoot, insertUnder(body, REPORTS, block), now);
  return id;
}

export function ask(brain, title, { words, todo }, now = easternNow()) {
  if (!title || !todo) throw new Error('ask needs a title and --do');
  const driveRoot = path.dirname(brain);
  let body = read(path.join(driveRoot, CLAUDE_FILE)) || claudeTemplate(now);
  const taken = new Set(parseItems(body).map((x) => x.id));
  const base = `C-${now.stamp.slice(0, 10)}-${now.stamp.slice(11, 16).replace(':', '')}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  const block = [`### ${id} · ${title}`, '- **Status:** open', `- **Opened:** ${now.stamp}`,
    ...(words ? [`- **The user's words:** ${words}`] : []), `- **What to do:** ${todo}`].join('\n');
  body = insertUnder(body, ASKS, block);
  saveClaudeFile(driveRoot, body, now);
  return id;
}

// --- What needs judgement ---
function legacyHandoffs(driveRoot) {
  if (!fs.existsSync(driveRoot)) return [];
  return fs.readdirSync(driveRoot)
    .filter((f) => /^handoff.*\.md$/i.test(f) && ![GROK_FILE, CLAUDE_FILE].includes(f.toLowerCase()))
    .flatMap((f) => {
      const text = read(path.join(driveRoot, f));
      if (deferred(text) || ['done', 'cancelled'].includes(firstWord(readFields(text).status))) return [];
      return [{ kind: 'one-off handoff', ref: path.join(driveRoot, f).replace(/\\/g, '/'), status: readFields(text).status || 'pending' }];
    });
}

function grokSignals(brain) {
  const inbox = path.join(brain, 'Inbox');
  return mdFiles(inbox).flatMap((f) => {
    const text = read(path.join(inbox, f));
    const n = parseNote(f, text);
    const to = firstWord(readFields(text).to || (f.match(/^\d{4}-\d{2}-\d{2}-\d{4}--[a-z0-9-]+--([a-z0-9-]+)--/i) || [])[1]);
    if (n.from !== 'grok' || !TO_CLAUDE.includes(to) || deferred(text) || n.status === 'done') return [];
    if (n.status === 'needs') return [{ kind: 'refused note', ref: `Inbox/${f}`, status: readFields(text).status }];
    if (n.status !== 'open' || n.actionable) return [];  // the Librarian applies actionable notes
    return [{ kind: n.type || 'signal', ref: `Inbox/${f}`, status: 'open' }];
  });
}

// Asks open 48 hours with no report in either file are flagged "waiting N days", never closed (§17.4).
// With --apply the Librarian runs first when a change note is waiting (it stands by while the cloud
// one is fresh), and Claude's file is rewritten so its Loop line is current.
export function check(brain, { apply = false, now = easternNow() } = {}) {
  const driveRoot = path.dirname(brain);
  const waitingNote = (n) => n.actionable || ['amend', 'change', 'close'].includes(n.type);
  const ran = apply && openNotes(brain).some(waitingNote) ? runLibrarian(brain, { now }) : [];
  const grokText = read(path.join(driveRoot, GROK_FILE));
  const grok = parseItems(grokText);
  const mine = parseItems(read(path.join(driveRoot, CLAUDE_FILE)));
  const grokIds = new Set(grok.map((x) => x.id));
  const mineIds = new Set(mine.map((x) => x.id));
  const late = new Map(openAsks(read(path.join(driveRoot, GROK_FILE)), read(path.join(driveRoot, CLAUDE_FILE)), now)
    .filter((x) => x.overdue).map((x) => [x.id, x]));
  const flag = (x, text) => (late.has(x.id) ? `waiting ${late.get(x.id).days} days · ${text}` : text);
  const items = [];
  for (const g of grok.filter((x) => x.side === 'G' && isOpen(x) && !mineIds.has(x.id))) {
    items.push({ kind: 'grok ask', ref: g.id, status: flag(g, g.title), ...(late.has(g.id) ? { waitingDays: late.get(g.id).days } : {}) });
  }
  for (const c of mine.filter((x) => x.side === 'C' && late.has(x.id))) {
    items.push({ kind: 'our ask', ref: c.id, status: flag(c, `${c.title} (no report from Grok)`), waitingDays: late.get(c.id).days });
  }
  for (const c of grok.filter((x) => x.side === 'C' && mineIds.has(x.id))) items.push({ kind: 'grok answered', ref: c.id, status: c.status || c.title });
  const cleared = [];
  // An empty read of Grok's file (mid-sync) is not Grok clearing its asks: keep our reports until it reads back.
  for (const r of grokText.trim() ? mine.filter((x) => x.side === 'G' && !grokIds.has(x.id)) : []) {
    if (apply) { clearItem(brain, r.id, 'Grok cleared its ask', now); cleared.push(r.id); } else items.push({ kind: 'clear report', ref: r.id, status: 'Grok cleared its ask' });
  }
  if (apply && !cleared.length) saveClaudeFile(driveRoot, read(path.join(driveRoot, CLAUDE_FILE)) || claudeTemplate(now), now);
  items.push(...legacyHandoffs(driveRoot), ...grokSignals(brain));
  return { ran: ran.length, cleared, items };
}

// --- CLI ---
function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

function cli(args) {
  const brain = sharedBrainPath();
  if (!brain || !fs.existsSync(brain)) { console.log('no shared brain configured'); return; }
  const [cmd = 'check', arg] = args;
  if (cmd === 'check') {
    const out = check(brain, { apply: args.includes('--apply') });
    if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
    else if (!out.items.length) console.log(`nothing new${out.cleared.length ? ` (cleared ${out.cleared.join(', ')})` : ''}`);
    else for (const i of out.items) console.log(`${i.kind}\t${i.ref}\t${i.status}`);
  } else if (cmd === 'report') {
    console.log(`reported ${report(brain, arg, { status: flag(args, '--status'), text: flag(args, '--text') || '', forYou: flag(args, '--for-you') })}`);
  } else if (cmd === 'ask') {
    console.log(`asked ${ask(brain, arg, { words: flag(args, '--words'), todo: flag(args, '--do') })}`);
  } else if (cmd === 'clear') {
    console.log(clearItem(brain, arg) ? `cleared ${arg}` : `no item ${arg} in ${CLAUDE_FILE}`);
  } else throw new Error(`unknown command: ${cmd}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try { cli(process.argv.slice(2)); } catch (err) { console.log(`[handoffs] ${err.message}`); process.exitCode = 1; }
}
