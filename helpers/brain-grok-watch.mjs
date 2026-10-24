#!/usr/bin/env node
// --- brain-grok-watch.mjs ----------------------------------------------------
// The cheap first step of Claude's 15-minute "Grok's locked items" check
// (MANIFESTO §6, the scheduled task `grok-locked-items`).
//
// Grok can only edit files it created. What it can't change reaches the PC as
//   - a change note in Inbox/ (the Librarian applies the structured ones), or
//   - a handoff file at the Drive root, `handoff-*.md`, for locked files.
// With --apply this runs the Librarian first when any note is waiting, then
// lists only what still needs judgement: root handoffs not yet done, Grok's
// notes the Librarian refused ("needs a look") or could not read, and Grok's
// signals to Claude. A line "- Deferred: ..." in a file means it waits for the
// user or a desk session, so it is not listed again. Prints "nothing new" when
// there is nothing, so an empty run ends at once.
//
//   node ~/.claude/helpers/brain-grok-watch.mjs [--apply] [--json]
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstWord, mdFiles, readFields } from './brain-core.mjs';
import { openNotes, parseNote } from './brain-notes.mjs';
import { runLibrarian, sharedBrainPath } from './brain-librarian.mjs';

const TO_CLAUDE = ['claude', 'claude-code', 'librarian', 'all'];
const deferred = (text) => /^- Deferred: /m.test(text);

// Root handoffs: H:/My Drive/handoff-*.md, one file per ask (or several "# Handoff" sections).
function rootHandoffs(driveRoot) {
  if (!fs.existsSync(driveRoot)) return [];
  return fs.readdirSync(driveRoot).filter((f) => /^handoff.*\.md$/i.test(f)).flatMap((f) => {
    const full = path.join(driveRoot, f);
    const text = fs.readFileSync(full, 'utf8');
    if (deferred(text)) return [];
    const sections = text.split(/^(?=# )/m).filter((s) => /^# /.test(s));
    const open = sections.filter((s) => !['done', 'cancelled'].includes(firstWord(readFields(s).status)));
    return open.length ? [{ kind: 'root handoff', file: full.replace(/\\/g, '/'), status: readFields(open[0]).status || 'pending' }] : [];
  });
}

// Grok's signals still in Inbox/ that need a person after the Librarian has run.
function grokSignals(brain) {
  const inbox = path.join(brain, 'Inbox');
  return mdFiles(inbox).flatMap((f) => {
    const text = fs.readFileSync(path.join(inbox, f), 'utf8');
    const n = parseNote(f, text);
    const to = firstWord(readFields(text).to || (f.match(/^\d{4}-\d{2}-\d{2}-\d{4}--[a-z0-9-]+--([a-z0-9-]+)--/i) || [])[1]);
    if (n.from !== 'grok' || !TO_CLAUDE.includes(to) || deferred(text) || n.status === 'done') return [];
    if (n.status === 'needs') return [{ kind: 'refused note', file: `Inbox/${f}`, status: readFields(text).status }];
    if (n.status !== 'open') return [];
    if (n.actionable) return [];  // the Librarian applies it
    return [{ kind: n.type || 'signal', file: `Inbox/${f}`, status: 'open' }];
  });
}

export function watch(brain, { apply = false } = {}) {
  const ran = apply && openNotes(brain).some((n) => n.actionable) ? runLibrarian(brain) : [];
  return { ran: ran.length, items: [...rootHandoffs(path.dirname(brain)), ...grokSignals(brain)] };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const brain = sharedBrainPath();
  if (!brain || !fs.existsSync(brain)) { console.log('no shared brain configured'); process.exit(0); }
  const out = watch(brain, { apply: process.argv.includes('--apply') });
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else if (!out.items.length) console.log('nothing new');
  else for (const i of out.items) console.log(`${i.kind}\t${i.file}\t${i.status}`);
}
