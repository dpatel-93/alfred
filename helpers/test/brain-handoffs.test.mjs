#!/usr/bin/env node
// --- brain-handoffs.test.mjs -------------------------------------------------
// Checks the two handoff files at the Drive root: Grok's asks are listed until
// Claude reports them, Claude's reports and asks are written only to Claude's
// file, cleared items are kept in a log, one-off handoff files and Grok's
// Inbox signals still surface, and waiting change notes are applied first.
//
//   node ~/.claude/helpers/test/brain-handoffs.test.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { easternNow } from '../brain-core.mjs';
import { ask, check, clearItem, CLAUDE_FILE, GROK_FILE, parseItems, report } from '../brain-handoffs.mjs';

const ROOT = path.join(os.tmpdir(), `handoffs-test-${process.pid}`);
const BRAIN = path.join(ROOT, 'Second Brain');
const NOW = easternNow(new Date('2026-10-26T19:30:00Z')); // Monday 15:30 ET
let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const put = (full, text) => { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text, 'utf8'); };
const read = (full) => (fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '');
const mine = () => read(path.join(ROOT, CLAUDE_FILE));
const refs = (out) => out.items.map((i) => i.ref);
const sig = (type, from, to, status, extra = '') =>
  `# ${type}\n\n- **Kind:** signal\n- **Type:** ${type}\n- **From:** ${from}\n- **To:** ${to}\n- **Status:** ${status}\n- **Created:** 2026-10-26 09:00 ET\n${extra}`;

fs.rmSync(ROOT, { recursive: true, force: true });
put(path.join(BRAIN, 'Reminders/2026-10-25--vet.md'), '# Vet\n\n- **Kind:** reminder\n- **Status:** open\n- **Due:** 2026-10-27\n- **Last updated:** 2026-10-20 09:00 ET\n');
put(path.join(BRAIN, 'Inbox/README.md'), '# Inbox\n');
chk('with no files there is nothing new', check(BRAIN, { apply: true, now: NOW }).items.length === 0);

// --- Grok's file, as Grok writes it ---
put(path.join(ROOT, GROK_FILE), [
  '# Grok → Claude handoff file', '', '- **Author:** Grok', '', '## Asks for Claude', '',
  '### G-2026-10-26-1400 · Add aisle seats to the profile', '- **Status:** pending', '- **The user\'s words:** "remember I like aisle seats"', '',
  '### G-2026-10-26-1410 · Old idea', '- **Status:** cancelled', '',
  '## Done or answered (Claude\'s asks)', '',
  '### C-2026-10-26-0900 · Move the news bots to 05:45', '- **Status:** done (2026-10-26 10:00 ET)', '- **What I did:** all eight bots moved.', ''].join('\n'));
put(path.join(ROOT, CLAUDE_FILE), [
  '# Claude → Grok handoff file', '', '- **Author:** Claude Code', '- **Last updated:** 2026-10-26 09:00 ET', '',
  "## Done or answered (Grok's asks)", '',
  '### G-2026-10-25-2000 · Something Grok has since cleared', '- **Status:** done (2026-10-25 20:10 ET)', '- **What changed:** x', '',
  '## Asks for Grok', '',
  '### C-2026-10-26-0900 · Move the news bots to 05:45', '- **Status:** pending', '- **What to do:** move them', ''].join('\n'));

const items = parseItems(read(path.join(ROOT, GROK_FILE)));
chk('items are read from "### <ID> · title" headings, with their status', items.length === 3 && items[0].id === 'G-2026-10-26-1400'
  && items[0].title === 'Add aisle seats to the profile' && items[0].state === 'pending' && items[1].state === 'cancelled', JSON.stringify(items));

let out = check(BRAIN, { now: NOW });
chk('an open Grok ask is listed', out.items.some((i) => i.kind === 'grok ask' && i.ref === 'G-2026-10-26-1400'), JSON.stringify(out.items));
chk('a cancelled Grok ask is not', !refs(out).includes('G-2026-10-26-1410'));
chk('Grok\'s answer to our ask is listed for reading', out.items.some((i) => i.kind === 'grok answered' && i.ref === 'C-2026-10-26-0900'));
chk('a report whose ask Grok cleared is listed for clearing', out.items.some((i) => i.kind === 'clear report' && i.ref === 'G-2026-10-25-2000'));

out = check(BRAIN, { apply: true, now: NOW });
chk('with --apply that report is cleared from Claude\'s file and kept in the log', out.cleared.includes('G-2026-10-25-2000')
  && !/G-2026-10-25-2000/.test(mine()) && /cleared G-2026-10-25-2000[\s\S]*Something Grok has since cleared/.test(read(path.join(BRAIN, 'System/logs/handoffs-2026-10.md'))));

// --- Reporting, asking, clearing ---
report(BRAIN, 'G-2026-10-26-1400', { status: 'done', text: 'added to Memory/profile.md', forYou: 'nothing' }, NOW);
const m1 = mine();
chk('a report goes under "Done or answered" with the ask\'s title, status and time', /## Done or answered \(Grok's asks\)\n\n### G-2026-10-26-1400 · Add aisle seats to the profile\n- \*\*Status:\*\* done \(2026-10-26 15:30 ET\)\n- \*\*What changed:\*\* added to Memory\/profile\.md\n- \*\*For you:\*\* nothing/.test(m1), m1);
chk('Claude\'s file gets a fresh Last updated', /\*\*Last updated:\*\* 2026-10-26 15:30 ET/.test(m1));
chk('a reported ask is no longer listed', !refs(check(BRAIN, { now: NOW })).includes('G-2026-10-26-1400'));
report(BRAIN, 'G-2026-10-26-1400', { status: 'done', text: 'added, and noted in travel too' }, NOW);
chk('reporting again replaces the report', (mine().match(/G-2026-10-26-1400/g) || []).length === 1 && /noted in travel too/.test(mine()));
let threw = false;
try { report(BRAIN, 'C-2026-10-26-0900', { status: 'done', text: 'x' }, NOW); } catch { threw = true; }
chk('only Grok\'s asks (G-…) take a report', threw);

const a1 = ask(BRAIN, 'Turn off news bot notifications', { words: '"no notification overload"', todo: 'switch each bot\'s Notifications off' }, NOW);
const a2 = ask(BRAIN, 'Second ask, same minute', { todo: 'something' }, NOW);
chk('an ask gets a C- ID from the time, unique within the minute', a1 === 'C-2026-10-26-1530' && a2 === 'C-2026-10-26-1530-2', `${a1} ${a2}`);
chk('asks go under "Asks for Grok"', /## Asks for Grok[\s\S]*### C-2026-10-26-1530 · Turn off news bot notifications\n- \*\*Status:\*\* pending\n- \*\*Asked:\*\* 2026-10-26 15:30 ET\n- \*\*The user's words:\*\* "no notification overload"/.test(mine()), mine());
chk('clearing our answered ask removes it and logs it', clearItem(BRAIN, 'C-2026-10-26-0900', 'Grok reported done', NOW)
  && !/C-2026-10-26-0900/.test(mine()) && /cleared C-2026-10-26-0900 \(Grok reported done\)/.test(read(path.join(BRAIN, 'System/logs/handoffs-2026-10.md'))));
chk('Grok\'s file is never written', !/Claude/.test(read(path.join(ROOT, GROK_FILE)).replace(/Claude's asks|Grok → Claude|Asks for Claude/g, '')));

// --- One-off handoff files, Grok's Inbox signals, waiting notes ---
put(path.join(ROOT, 'handoff-2026-10-26-pull-time.md'), '# Handoff: pull time\n\n- **Status:** pending implementation\n');
put(path.join(ROOT, 'handoff-2026-10-23-old.md'), '# Handoff: old\n\n- **Status:** done (implemented by Claude Code)\n');
put(path.join(BRAIN, 'Inbox/2026-10-26-0755--grok--librarian--amend--refused.md'), sig('amend', 'grok', 'librarian', 'needs a look (bad date)', '- **Target:** Reminders/2026-10-25--vet.md\n'));
put(path.join(BRAIN, 'Inbox/2026-10-26-0805--grok--claude-code--capture--home.md'), sig('capture', 'grok (Home Bot)', 'claude-code', 'open', '- **Target:** Memory/topics/home.md\n- (2026-10-26) Boiler serviced.\n'));
put(path.join(BRAIN, 'Inbox/2026-10-26-0810--grok--librarian--amend--move-vet.md'), sig('amend', 'grok', 'librarian', 'open', '- **Target:** Reminders/2026-10-25--vet.md\n- **Set:** Due = 2026-10-28\n'));
put(path.join(BRAIN, 'Inbox/2026-10-26-0815--claude-code--grok--fyi--hello.md'), sig('fyi', 'claude-code', 'grok', 'open'));
put(path.join(BRAIN, 'Inbox/2026-10-26-0825--grok--claude--handoff--later.md'), sig('handoff', 'grok', 'claude', 'open', '- Deferred: 2026-10-26 08:30 ET: needs a desk session\n'));
out = check(BRAIN, { apply: true, now: NOW });
const r = refs(out).map((x) => path.basename(x));
chk('a pending one-off handoff file is listed, a done one is not', r.includes('handoff-2026-10-26-pull-time.md') && !r.includes('handoff-2026-10-23-old.md'), r.join(', '));
chk('the two handoff files themselves are not listed as one-offs', !r.includes(GROK_FILE) && !r.includes(CLAUDE_FILE));
chk('a refused note and a capture from a Grok bot are listed', out.items.some((i) => i.kind === 'refused note') && r.includes('2026-10-26-0805--grok--claude-code--capture--home.md'));
chk('a waiting change note is applied by the Librarian, not listed', out.ran > 0 && !r.some((x) => /move-vet/.test(x))
  && /\*\*Due:\*\* 2026-10-28/.test(read(path.join(BRAIN, 'Reminders/2026-10-25--vet.md'))));
chk('signals from Claude, or deferred, are not listed', !r.some((x) => /hello|later/.test(x)));
chk('with nothing waiting the Librarian is not run', check(BRAIN, { apply: true, now: NOW }).ran === 0);

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
