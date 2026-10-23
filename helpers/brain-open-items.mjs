#!/usr/bin/env node
// --- brain-open-items.mjs ---------------------------------------------------
// SessionStart hook: puts the shared brain's open reminders and the notes other
// AIs left for this one in front of the session, so a reminder captured on the
// phone is still visible at the desk until someone closes it.
//
// Reads, from the shared brain (all read-only):
//   - Shared/Reminders/*.md   unchecked "- [ ]" lines under Today / Open /
//                             Recurring (MANIFESTO §6 format)
//   - Shared/<track>/*.md     a count of open tracked items per track (Health
//                             excluded: medical data is read on demand, never
//                             pushed into every session)
//   - Inbox/*.md              notes addressed "-to-<agent>-" or "-to-All-"
// Prints nothing when no shared brain is configured.
//
// Brain location: ALFRED_SHARED_BRAIN, else "Shared brain path" in
// ~/.claude/alfred-profile.md. Agent names: ALFRED_INBOX_NAMES (comma list),
// default Claude,Alfred.
//
//   node brain-open-items.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Configuration ---
const PROFILE_PATH = path.join(os.homedir(), '.claude', 'alfred-profile.md');
const REMINDERS_DIR = 'Reminders';
const SKIP_TRACKS = new Set(['health', 'reminders']);
const REMINDER_SECTIONS = /^##\s+(today|open|recurring)\b/i;
const INBOX_NAMES = (process.env.ALFRED_INBOX_NAMES || 'Claude,Alfred').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_ITEMS = 40;

function sharedBrainPath() {
  if (process.env.ALFRED_SHARED_BRAIN) return process.env.ALFRED_SHARED_BRAIN;
  try {
    const m = fs.readFileSync(PROFILE_PATH, 'utf8').match(/^\s*-\s*\*\*Shared brain path[^*]*\*\*:\s*(.+)$/m);
    const v = m && m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    return v && !/^\(?not specified\)?$/i.test(v) ? v : null;
  } catch { return null; }
}

const mdFiles = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !/superseded/i.test(f)).map((f) => path.join(dir, f))
  : []);

// Unchecked items under the headings that `sectionRe` accepts, grouped by heading.
function openBySection(markdown, sectionRe) {
  const out = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) { current = sectionRe.test(line) ? { heading: line.replace(/^##\s+/, ''), items: [] } : null; if (current) out.push(current); continue; }
    if (current && /^\s*[-*]\s+\[ \]\s+\S/.test(line)) current.items.push(line.trim());
  }
  return out.filter((s) => s.items.length);
}

function reminderLines(shared) {
  const lines = [];
  for (const file of mdFiles(path.join(shared, REMINDERS_DIR))) {
    for (const s of openBySection(fs.readFileSync(file, 'utf8'), REMINDER_SECTIONS)) {
      lines.push(`  ${s.heading}:`, ...s.items.map((i) => `    ${i}`));
    }
  }
  return lines;
}

function trackCounts(shared) {
  const counts = [];
  for (const track of fs.readdirSync(shared, { withFileTypes: true })) {
    if (!track.isDirectory() || SKIP_TRACKS.has(track.name.toLowerCase())) continue;
    let n = 0;
    for (const file of mdFiles(path.join(shared, track.name))) {
      for (const s of openBySection(fs.readFileSync(file, 'utf8'), /^##\s+open items\b/i)) n += s.items.length;
    }
    if (n) counts.push(`${track.name} ${n}`);
  }
  return counts;
}

function inboxNotes(brain) {
  const names = INBOX_NAMES.concat('All').map((n) => n.toLowerCase());
  return fs.existsSync(path.join(brain, 'Inbox'))
    ? fs.readdirSync(path.join(brain, 'Inbox'))
      .filter((f) => f.endsWith('.md') && names.some((n) => f.toLowerCase().includes(`-to-${n}-`)))
    : [];
}

// --- Main ---
function main() {
  const brain = sharedBrainPath();
  const shared = brain && path.join(brain, 'Shared');
  if (!shared || !fs.existsSync(shared)) return;

  const reminders = reminderLines(shared).slice(0, MAX_ITEMS);
  const counts = trackCounts(shared);
  const inbox = inboxNotes(brain);
  if (!reminders.length && !counts.length && !inbox.length) return;

  const out = ['[SecondBrain] From the shared brain (any AI may have added these):'];
  if (reminders.length) out.push('Open reminders (Shared/Reminders/reminders.md):', ...reminders);
  if (counts.length) out.push(`Tracked items still open: ${counts.join(', ')} (Shared/<area>/, "## Open items").`);
  if (inbox.length) out.push(`Inbox notes for you: ${inbox.join(', ')} (handle, then move to Inbox/Done/).`);
  out.push('Mention reminders that are due or relevant. Mark one done only when the user says so: change "[ ]" to',
    '"[x] … · done YYYY-MM-DD by <AI>" and move it under "## Done" (MANIFESTO §6).');
  console.log(out.join('\n'));
}

try { main(); } catch (err) {
  // A SessionStart hook must never break a session.
  console.log(`[SecondBrain] open items unavailable: ${err.message}`);
}
