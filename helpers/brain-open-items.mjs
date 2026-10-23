#!/usr/bin/env node
// --- brain-open-items.mjs ---------------------------------------------------
// SessionStart hook: surfaces the open reminders and tracked items that other
// AIs (or earlier sessions) left in a shared brain, so a reminder captured on
// the phone is still in front of Claude at the desk until someone closes it.
//
// Reads every Shared/<track>/*.md (Health excluded: medical data is read on
// demand, never pushed into every session) and prints the lines under each
// "## Open items" heading. Read-only. Prints nothing when no shared brain is
// configured, so it is safe on machines that do not use one.
//
// Brain location: ALFRED_SHARED_BRAIN, else "Shared brain path" in
// ~/.claude/alfred-profile.md.
//
//   node brain-open-items.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Configuration ---
const PROFILE_PATH = path.join(os.homedir(), '.claude', 'alfred-profile.md');
const SKIP_TRACKS = new Set(['health']);
const MAX_ITEMS = 40;

function sharedBrainPath() {
  if (process.env.ALFRED_SHARED_BRAIN) return process.env.ALFRED_SHARED_BRAIN;
  try {
    const m = fs.readFileSync(PROFILE_PATH, 'utf8').match(/^\s*-\s*\*\*Shared brain path[^*]*\*\*:\s*(.+)$/m);
    const v = m && m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    return v && !/^\(?not specified\)?$/i.test(v) ? v : null;
  } catch { return null; }
}

// Lines under "## Open items" up to the next level-2 heading.
function openItems(markdown) {
  const out = [];
  let inside = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) { inside = /^##\s+open items\b/i.test(line); continue; }
    if (inside && /^\s*[-*]\s+\S/.test(line)) out.push(line.trim());
  }
  return out;
}

// --- Main ---
function main() {
  const brain = sharedBrainPath();
  const shared = brain && path.join(brain, 'Shared');
  if (!shared || !fs.existsSync(shared)) return;

  const sections = [];
  for (const track of fs.readdirSync(shared, { withFileTypes: true })) {
    if (!track.isDirectory() || SKIP_TRACKS.has(track.name.toLowerCase())) continue;
    const dir = path.join(shared, track.name);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md') || /superseded/i.test(file)) continue;
      const items = openItems(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (items.length) sections.push({ rel: `Shared/${track.name}/${file}`, items });
    }
  }
  if (!sections.length) return;

  const lines = ['[SecondBrain] Open items in the shared brain (any AI may have added these):'];
  let shown = 0;
  for (const s of sections) {
    lines.push(`${s.rel}:`);
    for (const item of s.items) {
      if (shown++ >= MAX_ITEMS) break;
      lines.push(`  ${item}`);
    }
  }
  if (shown > MAX_ITEMS) lines.push(`  ...and ${shown - MAX_ITEMS} more`);
  lines.push('Mention reminders that are due or relevant. Closing an item edits Shared/: ask the user first,',
    'then move the line to that file\'s Closed section and log it in Shared/CHANGELOG.md (MANIFESTO §6).');
  console.log(lines.join('\n'));
}

try { main(); } catch (err) {
  // A SessionStart hook must never break a session.
  console.log(`[SecondBrain] open items unavailable: ${err.message}`);
}
