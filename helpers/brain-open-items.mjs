#!/usr/bin/env node
// --- brain-open-items.mjs ---------------------------------------------------
// SessionStart hook: puts the shared brain's open items and the signals left
// for this agent in front of the session, so a reminder captured on the phone
// is still visible at the desk until the user closes it (Second Brain
// MANIFESTO §6-§7). Read-only; run brain-librarian.mjs first so expiries and
// closes are already applied.
//
// Brain: ALFRED_SHARED_BRAIN, else "Shared brain path" in the profile.
// Agent names for Inbox matching: ALFRED_INBOX_NAMES (comma list),
// default claude,claude-code,librarian,all.
//
//   node brain-open-items.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import { sharedBrainPath, collectOpenItems, easternNow } from './brain-librarian.mjs';

// --- Configuration ---
const NAMES = (process.env.ALFRED_INBOX_NAMES || 'claude,claude-code,librarian,all')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const MAX_UNDATED = 12;

const line = (i) => `    - ${i.title}${i.due ? ` (due ${i.due})` : ''} · ${i.kind}${i.scope ? `, ${i.scope}` : ''} · ${i.file}`;

function main() {
  const brain = sharedBrainPath();
  if (!brain || !fs.existsSync(brain)) return;
  const now = easternNow();
  const o = collectOpenItems(brain, now);
  const mine = o.signals.filter((s) => NAMES.includes(s.to));
  const out = [`[SecondBrain] ${now.stamp}: open items from the shared brain (any AI may have added these).`];
  if (o.today.length) out.push('  Due today:', ...o.today.map(line));
  if (o.overdue.length) out.push('  Overdue:', ...o.overdue.map(line));
  if (o.carryOver.length) out.push('  Yesterday\'s errands not done (ask once whether to carry over):', ...o.carryOver.map(line));
  if (o.upcoming.length) out.push('  Next 7 days:', ...o.upcoming.map(line));
  if (o.undated.length) {
    out.push(`  Open, no date (${o.undated.length}):`, ...o.undated.slice(0, MAX_UNDATED).map(line));
    if (o.undated.length > MAX_UNDATED) out.push(`    …and ${o.undated.length - MAX_UNDATED} more in Reminders/`);
  }
  if (mine.length) {
    out.push(`  Signals for you (${mine.length}): handle per MANIFESTO §6, then reply or file them:`,
      ...mine.map((s) => `    - ${s.type} from ${s.from}${s.ageDays > 7 ? ` (${s.ageDays} days old)` : ''} · ${s.file}`));
  }
  if (out.length === 1) return;
  out.push('  Mention what is due. Close a reminder only when the user says it is done (edit it if you',
    '  created it, else a `close` signal). Capture what matters as you work (MANIFESTO §8).');
  console.log(out.join('\n'));
}

try { main(); } catch (err) {
  // A SessionStart hook must never break a session.
  console.log(`[SecondBrain] open items unavailable: ${err.message}`);
}
