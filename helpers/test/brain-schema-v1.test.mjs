#!/usr/bin/env node
// --- brain-schema-v1.test.mjs ------------------------------------------------
// Item schema v1 (MANIFESTO §17) on a throwaway brain: the Schema/Created/Author
// header and Closed/Reopened lines with reason codes in every write, change
// notes that always end applied or "needs a look", the Waiting section and the
// path check in index.md, the one-line run log, and the hand-off Loop line and
// 48-hour flags.
//
//   node ~/.claude/helpers/test/brain-schema-v1.test.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { easternNow, readFields } from '../brain-core.mjs';
import { createReminder, createRoutine, updateReminder } from '../brain-items.mjs';
import { applyAction, writeSignal } from '../brain-assistant.mjs';
import { pathReferences, runLibrarian, waitingItems } from '../brain-librarian.mjs';
import { ask, check, clearItem, CLAUDE_FILE, GROK_FILE, parseItems, report } from '../brain-handoffs.mjs';

const OPEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'brain-open-items.mjs');
const ROOT = path.join(os.tmpdir(), `schema-v1-test-${process.pid}`);
const BRAIN = path.join(ROOT, 'Second Brain');
const NOW = easternNow(new Date('2026-11-01T18:00:00Z')); // Sunday 13:00 ET
let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const put = (rel, text, root = BRAIN) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text, 'utf8'); };
const read = (rel, root = BRAIN) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');
const exists = (rel) => fs.existsSync(path.join(BRAIN, rel));
const old = (title, kind, due, extra = '') =>
  `# ${title}\n\n- **Kind:** ${kind}\n- **Status:** open\n- **Due:** ${due}\n- **Until:** ${kind === 'errand' ? 'end-of-day' : 'done'}\n- **Scope:** personal\n- **Author:** grok\n- **Last updated:** 2026-10-20 09:00 ET\n${extra}`;
const note = (type, target, created, extra = '', status = 'open') =>
  `# ${type}\n\n- **Kind:** signal\n- **Type:** ${type}\n- **From:** grok\n- **To:** librarian\n- **Target:** ${target}\n- **Status:** ${status}\n- **Created:** ${created}\n${extra}`;
const fieldsInOrder = (text) => text.split('\n').filter((l) => /^- \*\*[A-Za-z ]+:\*\*/.test(l)).map((l) => l.match(/\*\*(.+?):/)[1]);

fs.rmSync(ROOT, { recursive: true, force: true });
put('index.md', '# Second Brain: Index\n\n- **Author:** Grok\n');

// --- 17.2: the header on every new file ---
console.log('Header (17.2)');
const rem = createReminder(BRAIN, { kind: 'todo', title: 'Renew the passport' }, { now: NOW });
const remText = read(rem.file);
const h = readFields(remText);
chk('a new reminder carries Schema 1 first, then Created, Author and Status', fieldsInOrder(remText)[0] === 'Schema' && h.schema === '1'
  && h.created === NOW.stamp && !!h.author && h.status === 'open', remText);
const rout = createRoutine(BRAIN, { title: 'Stretch', schedule: 'weekdays' }, { now: NOW });
chk('a new routine carries Schema 1', readFields(read(rout.file)).schema === '1');
const sig = writeSignal(BRAIN, { type: 'fyi', from: 'claude-code', to: 'grok', re: 'x', subject: 'Hello' }, NOW);
const sh = readFields(read(sig));
chk('a new signal carries Schema 1, Created and Author', sh.schema === '1' && sh.created === NOW.stamp && sh.author === 'claude-code', read(sig));
put('Reminders/2026-10-20--legacy.md', old('Legacy one', 'todo', 'none'));
chk('a schema-0 file is read as before', readFields(read('Reminders/2026-10-20--legacy.md')).schema === undefined);
updateReminder(BRAIN, 'Reminders/2026-10-20--legacy.md', { title: 'Legacy one, renamed' }, { now: NOW });
chk('changing a header field of a schema-0 file writes Schema 1', readFields(read('Reminders/2026-10-20--legacy.md')).schema === '1'
  && (read('Reminders/2026-10-20--legacy.md').match(/Schema/g) || []).length === 1);

// --- 17.3: lifecycle lines, from the dashboard ---
console.log('\nLifecycle lines (17.3)');
applyAction(BRAIN, { file: rem.file, action: 'close' }, NOW);
const closed = read(rem.file.replace('Reminders/', 'Reminders/Done/'));
chk('a dashboard close ends with "- Closed: <stamp> by alfred for user · reason: done"', closed.trimEnd().endsWith(`- Closed: ${NOW.stamp} by alfred for user · reason: done`), closed);
put('Reminders/Done/2026-10-31--expired-errand.md', old('Expired errand', 'errand', '2026-10-31').replace('**Status:** open', '**Status:** expired'));
applyAction(BRAIN, { file: 'Reminders/Done/2026-10-31--expired-errand.md', action: 'carryover' }, NOW);
const carried = read('Reminders/2026-10-31--expired-errand.md');
chk('carrying an expired errand over reopens it with a Reopened line and an Edited line for the date',
  new RegExp(`- Reopened: ${NOW.stamp} by alfred for user · reason: mistake\\n- Edited: ${NOW.stamp} by alfred for user: due 2026-10-31 → ${NOW.date} \\(carried over\\)\\n$`).test(carried)
  && readFields(carried).status === 'open' && readFields(carried).schema === '1', carried);

// --- 17.3 and 17.5.1: the Librarian ---
put('Reminders/2026-10-30--errand-yesterday.md', old('Yesterday errand', 'errand', '2026-10-31'));
put('Reminders/2026-10-25--cancel-me.md', old('Cancel me', 'reminder', '2026-11-05'));
put('Reminders/Done/2026-10-24--reopen-me.md', old('Reopen me', 'todo', 'none').replace('**Status:** open', '**Status:** done'));
put('Reminders/2026-10-26--desk-wins.md', old('Desk wins', 'reminder', '2026-11-04').replace('2026-10-20 09:00 ET', '2026-11-01 11:00 ET'));
put('Routines/user-walk.md', '# The user: Walk\n\n- **Kind:** routine\n- **Runs:** the user\n- **Schedule:** daily\n- **Status:** active\n- **Last updated:** 2026-10-20 09:00 ET\n');
put('System/agents/grok.md', '# Grok\n\n- **Kind:** agent rules\n- **Author:** Grok\n- **Last updated:** 2026-10-30 09:00 ET\n\n## Every session\nRead the brain.\n');
const GROK_RULES = read('System/agents/grok.md');
put('Inbox/2026-11-01-1000--grok--librarian--amend--cancel-me.md', note('amend', 'Reminders/2026-10-25--cancel-me.md', '2026-11-01 10:00 ET',
  '- **Set:** Status = cancelled\n- **Reason:** not-needed\n'));
put('Inbox/2026-11-01-1005--grok--librarian--amend--reopen-me.md', note('amend', 'Reminders/Done/2026-10-24--reopen-me.md', '2026-11-01 10:05 ET',
  '- **Set:** Status = open\n'));
put('Inbox/2026-11-01-1010--grok--librarian--amend--desk-wins.md', note('amend', 'Reminders/2026-10-26--desk-wins.md', '2026-11-01 10:10 ET',
  '- **Set:** Due = 2026-11-09\n'));
put('Inbox/2026-11-01-1015--grok--librarian--amend--pause-walk.md', note('amend', 'Routines/user-walk.md', '2026-11-01 10:15 ET', '- **Set:** Status = paused\n'));
// The shape that was once filed as done without being applied (2026-11-01): a section to add to Grok's rules.
put('Inbox/2026-11-01-1222--grok--librarian--amend--grok-skills-section.md', note('amend', 'System/agents/grok.md', '2026-11-01 12:22 ET',
  ['', '- **Set:** Last updated = 2026-11-01 12:22 ET', '- **Add:** under the header block: - Edited: 2026-11-01 12:22 ET by Grok: added the Skills section',
    '- **Add:** the section below, as a new `## Skills` section placed right before `## Every session`:', '', '=====',
    '## Skills (moved here from the root MASTER_INSTRUCTIONS.md)', 'Grok\'s skills live in the Grok-skills folder.', '- Load only the Skill Router at startup.', '=====', '',
    '- **Add:** a last row to the `## Path changes` table: | Skills section | this file |', ''].join('\n')));
// Same, but the block has a "# " title: still a section to place, never a whole-file replacement.
put('Inbox/2026-11-01-1223--grok--librarian--amend--grok-titled-section.md', note('amend', 'System/agents/grok.md', '2026-11-01 12:23 ET',
  '\n- **Add:** the section below, before `## Every session`:\n\n=====\n# Skills\n\nGrok\'s skills live in the Grok-skills folder, loaded on demand.\n=====\n'));
put('Inbox/2026-11-01-1225--grok--librarian--amend--free-form.md', note('amend', 'System/agents/grok.md', '2026-11-01 12:25 ET', '\nPlease add a section about skills to System/agents/grok.md.\n'));
put('Inbox/2026-11-01-1230--grok--librarian--amend--manifesto.md', note('amend', 'MANIFESTO.md', '2026-11-01 12:30 ET', '\n=====\n# Manifesto\n\nA whole new manifesto written by a note.\n=====\n'));
put('Inbox/2026-10-31-0900--grok--claude--capture--memory.md', note('capture', 'Memory/topics/home.md', '2026-10-31 09:00 ET', '- (2026-10-31) Boiler serviced.\n').replace('**To:** librarian', '**To:** claude'));
put('Inbox/2026-11-01-1255--grok--claude--fyi--fresh.md', note('fyi', 'x.md', '2026-11-01 12:55 ET').replace('**To:** librarian', '**To:** claude'));

// --- Hand-off files, as each side writes them today ---
put(GROK_FILE, ['# Grok → Claude handoff file', '', '- **Kind:** handoff file', '- **Author:** Grok', '- **Last updated:** 2026-11-01 12:24 ET', '',
  '## Asks for Claude', '',
  '- **G-2026-10-29-1050:** Mark laundry as folded yesterday in the user\'s routines. The brief flagged it as late; the user says it was done.', '',
  '- **G-2026-10-30-1200:** Operation improvements for the loop (user\'s suggestions):', '  1. **Librarian cadence:** apply or say why not.', '  2. **Status line:** at the top.', '',
  '- **G-2026-11-01-1200:** A fresh ask, under two days old.', '',
  '## Done or answered (Claude\'s asks)', '',
  '### C-2026-10-28-0900 · Something Grok already answered', '- **Status:** done (2026-10-28 10:00 ET)', '- **What I did:** it.', ''].join('\n'), ROOT);
put(CLAUDE_FILE, ['# Claude → Grok handoff file', '', '- **Kind:** handoff file', '- **Author:** Claude Code (only Claude writes this file; Grok reads it)',
  '- **Grok\'s file:** `handoff-grok-to-claude.md`', '- **Last updated:** 2026-10-28 09:00 ET', '', 'How it works.', '',
  '## Done or answered (Grok\'s asks)', '', '## Asks for Grok', '',
  '### C-2026-10-28-0900 · Something Grok already answered', '- **Status:** pending', '- **Asked:** 2026-10-28 09:00 ET', '- **What to do:** it', '',
  '### C-2026-10-29-0800 · Turn off a bot notification', '- **Status:** open', '- **Opened:** 2026-10-29 08:00 ET', '- **What to do:** switch it off', ''].join('\n'), ROOT);

// --- Path check fixture ---
put('System/path-changes.md', ['# Path changes', '', '- **Kind:** reference', '- **Author:** Claude Code', '', '| Old | New | Date |', '|---|---|---|',
  '| `My Drive/MASTER_INSTRUCTIONS.md` | `Archive/2026-11/MASTER_INSTRUCTIONS.md` (Grok\'s rules: `System/agents/grok.md`) | 2026-11-01 |',
  '| `MASTER_INSTRUCTIONS.md` | `System/agents/grok.md` | 2026-11-01 |', '| `Briefs/` | `Outputs/briefs/` | 2026-10-23 |', ''].join('\n'));
put('Routines/grok-morning.md', ['# Grok: morning brief', '', '- **Kind:** routine', '- **Runs:** Grok', '- **Author:** Grok', '- **Status:** active', '',
  'Reads MASTER_INSTRUCTIONS.md at startup.', 'Saves the brief in Outputs/briefs/ (was Briefs/ before).', 'MASTER_INSTRUCTIONS.md moved to System/agents/grok.md.',
  'The old copy is at Archive/2026-11/MASTER_INSTRUCTIONS.md.', '', '## Path changes', '| `MASTER_INSTRUCTIONS.md` | here |', ''].join('\n'));
put('Knowledge/Docs/setup.md', '# Setup\n\n- **Kind:** doc\n- **Author:** Claude Code (from a desk session)\n\nThe old rules lived in `My Drive/MASTER_INSTRUCTIONS.md`.\n');
put('Archive/2026-10/old.md', '# Old\n\n- **Author:** grok\n\nRead MASTER_INSTRUCTIONS.md.\n');
put('Reminders/Done/2026-10-01--done.md', '# Done\n\n- **Author:** grok\n- **Status:** done\n\nRead MASTER_INSTRUCTIONS.md.\n');
put('System/CHANGELOG.md', '# Changelog\n\n- **Author:** Claude Code\n\n- moved MASTER_INSTRUCTIONS.md\n');
put('System/logs/grok-2026-11.md', '# Log\n\n- **Author:** grok\n\n- read MASTER_INSTRUCTIONS.md\n');

const refs = pathReferences(read('Routines/grok-morning.md'), [
  { old: 'MASTER_INSTRUCTIONS.md', new: 'System/agents/grok.md' }, { old: 'Briefs/', new: 'Outputs/briefs/' }]);
chk('path references: a bare old path is found; a line also naming the new path, a longer path ending in it, and lines under "Path changes" are not',
  refs.length === 1 && refs[0].line === 'Reads MASTER_INSTRUCTIONS.md at startup.', JSON.stringify(refs));

console.log('\nThe Librarian (17.3, 17.5)');
runLibrarian(BRAIN, { now: NOW, runner: 'cloud' });
const exp = read('Reminders/Done/2026-10-30--errand-yesterday.md');
chk('expiry writes "- Closed: <stamp> by librarian · reason: expired" and Schema 1', exp.trimEnd().endsWith(`- Closed: ${NOW.stamp} by librarian · reason: expired`)
  && readFields(exp).status === 'expired' && readFields(exp).schema === '1', exp);
const cancelled = read('Reminders/Done/2026-10-25--cancel-me.md');
chk('a cancel note with a reason code closes with that code, as of the note, via grok', cancelled.trimEnd().endsWith('- Closed: 2026-11-01 10:00 ET by librarian via grok · reason: not-needed')
  && readFields(cancelled).status === 'cancelled' && readFields(cancelled).schema === '1', cancelled);
const reopened = read('Reminders/2026-10-24--reopen-me.md');
chk('a reopen note writes "- Reopened: … by librarian via grok · reason: mistake" and moves it back', /- Reopened: 2026-11-01 10:05 ET by librarian via grok · reason: mistake\n$/.test(reopened)
  && readFields(reopened).status === 'open' && !exists('Reminders/Done/2026-10-24--reopen-me.md'), reopened);
const walk = read('Routines/user-walk.md');
chk('pausing a routine by note is an Edited line, with Schema 1', /- Edited: 2026-11-01 10:15 ET by librarian via grok: paused\n$/.test(walk) && readFields(walk).schema === '1', walk);
const sup = read('Inbox/Done/2026-11-01-1010--grok--librarian--amend--desk-wins.md');
chk('a note that lost to a newer edit is applied as superseded and filed', /\*\*Status:\*\* done \(applied by librarian/.test(sup) && /- Applied: .*superseded/.test(sup)
  && /\*\*Due:\*\* 2026-11-04/.test(read('Reminders/2026-10-26--desk-wins.md')), sup);
const skills = read('Inbox/2026-11-01-1222--grok--librarian--amend--grok-skills-section.md');
chk('REGRESSION: a free-form "add a section to System/agents/grok.md" note is NOT filed as done', !exists('Inbox/Done/2026-11-01-1222--grok--librarian--amend--grok-skills-section.md')
  && /\*\*Status:\*\* needs a look \(needs judgement\)/.test(skills) && !/\*\*Status:\*\* done/.test(skills), skills);
chk('… and Grok\'s rules file is untouched', read('System/agents/grok.md') === GROK_RULES, read('System/agents/grok.md'));
chk('a "# "-titled section to place is needs judgement too, never a whole-file replacement', /needs a look \(needs judgement\)/.test(read('Inbox/2026-11-01-1223--grok--librarian--amend--grok-titled-section.md')));
chk('a plain free-form amend is needs judgement', /needs a look \(needs judgement\)/.test(read('Inbox/2026-11-01-1225--grok--librarian--amend--free-form.md')));
chk('a note on a locked file is needs judgement', /needs a look \(needs judgement\)/.test(read('Inbox/2026-11-01-1230--grok--librarian--amend--manifesto.md'))
  && !exists('MANIFESTO.md'));
chk('every change note ended applied (in Inbox/Done) or "needs a look" (in Inbox)', fs.readdirSync(path.join(BRAIN, 'Inbox')).filter((f) => /--(amend|close|change)--/.test(f))
  .every((f) => /needs a look/.test(read(`Inbox/${f}`))));
chk('a memory capture is left open for its curator', /\*\*Status:\*\* open/.test(read('Inbox/2026-10-31-0900--grok--claude--capture--memory.md')));
chk('applied notes and needs-a-look notes get Schema 1', readFields(sup).schema === '1' && readFields(skills).schema === '1');

// --- 17.5.2: Waiting ---
const index = read('index.md');
const waiting = (index.match(/## Waiting\n\n([\s\S]*?)\n\n/) || [])[1] || '';
chk('index.md has a "## Waiting" section', /\n## Waiting\n\n- /.test(index), index.slice(0, 200));
chk('a signal open over 6 hours is listed with its reason and since', waiting.includes('- Inbox/2026-10-31-0900--grok--claude--capture--memory.md · waiting for claude · since 2026-10-31 09:00 ET'), waiting);
chk('a change note left "needs a look" over 6 hours is listed as needs a look', waiting.includes('- Inbox/2026-11-01-1000--grok--librarian--amend--cancel-me.md') === false
  && waitingItems(BRAIN, easternNow(new Date('2026-11-01T23:00:00Z'))).some((w) => w.ref === 'Inbox/2026-11-01-1222--grok--librarian--amend--grok-skills-section.md' && w.reason === 'needs a look'));
chk('a signal under 6 hours old is not listed', !waiting.includes('fresh'));
chk('hand-off asks past 48 hours with no report are listed by ID, both sides', waiting.includes('- G-2026-10-29-1050 · no report · since 2026-10-29 10:50 ET')
  && waiting.includes('- G-2026-10-30-1200 · no report · since 2026-10-30 12:00 ET') && waiting.includes('- C-2026-10-29-0800 · no report · since 2026-10-29 08:00 ET'), waiting);
chk('an ask under 48 hours, or one the other side reported, is not', !waiting.includes('G-2026-11-01-1200') && !waiting.includes('C-2026-10-28-0900'));

// --- 17.5.3: path check ---
const pathSignals = () => fs.readdirSync(path.join(BRAIN, 'Inbox')).filter((f) => /--fyi--path-check-/.test(f));
const ps = pathSignals();
const toGrok = ps.find((f) => /--librarian--grok--fyi--path-check-routines-grok-morning-md/.test(f));
chk('one fyi signal per file, to its Author, naming the line', ps.length === 2 && !!toGrok
  && /- Line: Reads MASTER_INSTRUCTIONS\.md at startup\.\n {2}- `MASTER_INSTRUCTIONS\.md` is now `System\/agents\/grok\.md`/.test(read(`Inbox/${toGrok}`))
  && !/Outputs\/briefs/.test(read(`Inbox/${toGrok}`).split('\n\n').slice(2).join('')), ps.join(', '));
chk('a "Claude Code (…)" author gets a claude-code signal for a "My Drive/" path', ps.some((f) => /--librarian--claude-code--fyi--path-check-knowledge-docs-setup-md/.test(f)));
chk('the signal is a schema-1 fyi from the librarian', readFields(read(`Inbox/${toGrok}`)).schema === '1' && readFields(read(`Inbox/${toGrok}`)).type === 'fyi'
  && readFields(read(`Inbox/${toGrok}`)).from === 'librarian');
chk('Archive/, Done/, System/logs/, the CHANGELOG and path-changes.md itself are skipped', !ps.some((f) => /archive|done|logs|changelog|path-changes/.test(f.replace(/--fyi--path-check-/, '#'))));
chk('the file itself is never edited', /Reads MASTER_INSTRUCTIONS\.md at startup/.test(read('Routines/grok-morning.md')));
const log1 = read('System/logs/librarian-2026-11.md');
chk('the run is one log line with the counts', /\n- 2026-11-01 13:00 ET · cloud · applied 4, needs a look 4, waiting [1-9]\d*, path references 2 \(\d+ file changes\)\n$/.test(log1), log1);

runLibrarian(BRAIN, { now: NOW, runner: 'cloud' });
chk('a second run does not signal the same lines again', pathSignals().length === 2, pathSignals().join(', '));
chk('a run that changed nothing adds no log line', read('System/logs/librarian-2026-11.md') === log1, read('System/logs/librarian-2026-11.md'));
put('Routines/grok-morning.md', read('Routines/grok-morning.md').replace('Reads MASTER_INSTRUCTIONS.md at startup.', 'Reads MASTER_INSTRUCTIONS.md at wake.'));
runLibrarian(BRAIN, { now: NOW, runner: 'cloud' });
const again = pathSignals().filter((f) => !ps.includes(f));
chk('a changed line is signalled again, and only it', again.length === 1 && /- Line: Reads MASTER_INSTRUCTIONS\.md at wake\./.test(read(`Inbox/${again[0]}`))
  && !/at startup/.test(read(`Inbox/${again[0]}`)), again.join(', '));

// --- 17.4: hand-off files ---
console.log('\nHand-off files (17.4)');
const grokItems = parseItems(read(GROK_FILE, ROOT));
const laundry = grokItems.find((x) => x.id === 'G-2026-10-29-1050');
chk('Grok\'s list-style asks are read, titled and dated by their ID', grokItems.filter((x) => x.side === 'G').length === 3
  && laundry?.title === 'Mark laundry as folded yesterday in the user\'s routines' && laundry?.opened === '2026-10-29 10:50 ET'
  && grokItems.find((x) => x.id === 'G-2026-10-30-1200')?.title === 'Operation improvements for the loop (user\'s suggestions)', JSON.stringify(grokItems));
const beforeCheck = read(CLAUDE_FILE, ROOT);
let out = check(BRAIN, { now: NOW });
chk('check flags asks open 48 hours with no report as "waiting N days"', out.items.some((i) => i.kind === 'grok ask' && i.ref === 'G-2026-10-29-1050' && /^waiting 3 days · /.test(i.status))
  && out.items.some((i) => i.kind === 'our ask' && i.ref === 'C-2026-10-29-0800' && /^waiting 3 days · /.test(i.status))
  && out.items.some((i) => i.ref === 'G-2026-11-01-1200' && !/waiting/.test(i.status)), JSON.stringify(out.items));
chk('check without --apply writes nothing', read(CLAUDE_FILE, ROOT) === beforeCheck);
const open = spawnSync(process.execPath, [OPEN], { env: { ...process.env, ALFRED_SHARED_BRAIN: BRAIN, ALFRED_NOW: '2026-11-01T18:00:00Z' }, encoding: 'utf8' });
const openLines = open.stdout.split('\n');
chk('the session-start list puts asks waiting over 48 hours first', /Hand-off asks waiting over 48 hours \(3\)/.test(openLines[1] || '')
  && /grok ask · G-2026-10-29-1050 · waiting 3 days/.test(open.stdout), open.stdout);
chk('the session-start list wrote nothing', read(CLAUDE_FILE, ROOT) === beforeCheck);

check(BRAIN, { apply: true, now: NOW });
let mine = read(CLAUDE_FILE, ROOT);
const loopRe = /^- \*\*Grok's file:\*\* .*\n- \*\*Last updated:\*\* 2026-11-01 13:00 ET\n- \*\*Loop:\*\* synced 2026-11-01 13:00 ET · open asks 2 · reports pending 3 · oldest open C-2026-10-28-0900 \(4d\)\n/m;
chk('check --apply writes the Loop line right under the header fields', loopRe.test(mine), mine.slice(0, 500));
const later = easternNow(new Date('2026-11-01T19:05:00Z'));
const id = ask(BRAIN, 'Read out the new brief time', { todo: 'say 06:45 in the brief' }, later);
mine = read(CLAUDE_FILE, ROOT);
chk('a new ask is a "### <ID> · <title>" block with Status open and Opened', new RegExp(`### ${id} · Read out the new brief time\\n- \\*\\*Status:\\*\\* open\\n- \\*\\*Opened:\\*\\* 2026-11-01 14:05 ET\\n`).test(mine), mine);
chk('… and the Loop line is rewritten, once', (mine.match(/\*\*Loop:\*\*/g) || []).length === 1 && /- \*\*Loop:\*\* synced 2026-11-01 14:05 ET · open asks 3 · reports pending 3 · /.test(mine), mine.slice(0, 600));
report(BRAIN, 'G-2026-10-29-1050', { status: 'done', text: 'marked done' }, later);
mine = read(CLAUDE_FILE, ROOT);
chk('a report takes the list-style ask\'s title and lowers reports pending', /### G-2026-10-29-1050 · Mark laundry as folded yesterday in the user's routines\n/.test(mine)
  && /reports pending 2 · /.test(mine), mine.slice(0, 700));
chk('a reported ask is no longer flagged', !check(BRAIN, { now: later }).items.some((i) => i.ref === 'G-2026-10-29-1050'));
clearItem(BRAIN, 'C-2026-10-28-0900', 'Grok reported done', later);
mine = read(CLAUDE_FILE, ROOT);
chk('clearing rewrites the Loop line (oldest open moves on)', /open asks 2 · reports pending 2 · oldest open C-2026-10-29-0800 \(3d\)/.test(mine), mine.slice(0, 600));
chk('Grok\'s file is never written', !/Loop/.test(read(GROK_FILE, ROOT)));

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
