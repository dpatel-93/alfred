#!/usr/bin/env node
// The executive-assistant view of the shared brain: today's brief, reminders, errands and the
// user's routines, shaped for the HUD's Brain tab. Read-only; the brain's files stay the truth,
// so anything closed by Grok, Claude or the Librarian drops off on the next refresh.
//   node brain-assistant.mjs        print the feed as JSON
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectOpenItems, easternNow, readFields, sharedBrainPath } from './brain-librarian.mjs';

export { sharedBrainPath };

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
export function latestBrief(brain, date) {
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
    title: titleOf(text, f), updated: (text.match(/Last updated:\s*([^|\n]+)/i) || [])[1]?.trim() || null, top };
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

// --- The whole panel ---
export function assistantFeed(brain = sharedBrainPath(), now = easternNow()) {
  const base = { generatedAt: now.stamp, date: now.date, weekday: DAYS[weekdayOf(now.date)], calendar: { connected: false } };
  if (!brain || !fs.existsSync(brain)) return { ...base, brain: false };
  const open = collectOpenItems(brain, now);
  const slim = ({ file, title, kind, due, scope }) => ({ file, title, kind, due, scope });
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
    routines: userRoutines(brain, now.date),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(assistantFeed(), null, 2)}\n`);
}
