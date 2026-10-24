#!/usr/bin/env node
// --- brain-grok-watch.test.mjs -----------------------------------------------
// Checks the cheap first step of the 15-minute check: it applies waiting notes,
// then lists only what needs judgement (root handoffs, refused notes, Grok's
// signals to Claude), and skips what is done, deferred or not from Grok.
//
//   node ~/.claude/helpers/test/brain-grok-watch.test.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watch } from '../brain-grok-watch.mjs';

const ROOT = path.join(os.tmpdir(), `grok-watch-test-${process.pid}`);
const BRAIN = path.join(ROOT, 'Second Brain');
let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const put = (full, text) => { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text, 'utf8'); };
const sig = (type, from, to, status, extra = '') =>
  `# ${type}\n\n- **Kind:** signal\n- **Type:** ${type}\n- **From:** ${from}\n- **To:** ${to}\n- **Status:** ${status}\n- **Created:** 2026-10-24 09:00 ET\n${extra}`;

fs.rmSync(ROOT, { recursive: true, force: true });
put(path.join(BRAIN, 'Reminders/2026-10-25--vet.md'), '# Vet\n\n- **Kind:** reminder\n- **Status:** open\n- **Due:** 2026-10-27\n- **Last updated:** 2026-10-20 09:00 ET\n');
put(path.join(BRAIN, 'Inbox/README.md'), '# Inbox\n');
chk('an empty brain has nothing new', watch(BRAIN, { apply: true }).items.length === 0);

put(path.join(ROOT, 'handoff-2026-10-24-pull-time.md'), '# Handoff: pull time\n\n- **From:** Eve (via Grok voice)\n- **Status:** pending implementation\n\n## Goal\nMove it.\n');
put(path.join(ROOT, 'handoff-2026-10-23-old.md'), '# Handoff: old\n\n- **Status:** done (implemented by Claude Code)\n');
put(path.join(ROOT, 'handoff-2026-10-22-waits.md'), '# Handoff: waits\n\n- **Status:** needs a look (asks to send an email)\n- Deferred: 2026-10-22 10:00 ET by the 15-minute check: needs the user\n');
put(path.join(BRAIN, 'Inbox/2026-10-24-0755--grok--librarian--amend--refused.md'), sig('amend', 'grok', 'librarian', 'needs a look (bad date)', '- **Target:** Reminders/2026-10-25--vet.md\n'));
put(path.join(BRAIN, 'Inbox/2026-10-24-0800--grok--claude--handoff--profile.md'), sig('handoff', 'grok', 'claude', 'open', 'Add to my profile that I prefer aisle seats.\n'));
put(path.join(BRAIN, 'Inbox/2026-10-24-0805--grok--claude-code--capture--home.md'), sig('capture', 'grok (Home Bot)', 'claude-code', 'open', '- **Target:** Memory/topics/home.md\n- (2026-10-24) Boiler serviced.\n'));
put(path.join(BRAIN, 'Inbox/2026-10-24-0810--grok--librarian--amend--move-vet.md'), sig('amend', 'grok', 'librarian', 'open', '- **Target:** Reminders/2026-10-25--vet.md\n- **Set:** Due = 2026-10-28\n'));
put(path.join(BRAIN, 'Inbox/2026-10-24-0815--claude-code--grok--fyi--hello.md'), sig('fyi', 'claude-code', 'grok', 'open'));
put(path.join(BRAIN, 'Inbox/2026-10-24-0820--grok--user--question--which.md'), sig('question', 'grok', 'user', 'open'));
put(path.join(BRAIN, 'Inbox/2026-10-24-0825--grok--claude--handoff--later.md'), sig('handoff', 'grok', 'claude', 'open', 'Research leases.\n- Deferred: 2026-10-24 08:30 ET by the 15-minute check: needs a desk session\n'));

const out = watch(BRAIN, { apply: true });
const files = out.items.map((i) => path.basename(i.file));
chk('a pending root handoff is listed', files.includes('handoff-2026-10-24-pull-time.md'), files.join(', '));
chk('done and deferred root handoffs are not', !files.includes('handoff-2026-10-23-old.md') && !files.includes('handoff-2026-10-22-waits.md'));
chk('a refused Grok note is listed for a person', out.items.some((i) => i.kind === 'refused note' && /refused\.md$/.test(i.file)));
chk('Grok\'s handoff and capture to Claude are listed (a bot signature counts as grok)', files.includes('2026-10-24-0800--grok--claude--handoff--profile.md')
  && files.includes('2026-10-24-0805--grok--claude-code--capture--home.md'));
chk('a structured note is applied by the Librarian, not listed', out.ran > 0 && !files.some((f) => /move-vet/.test(f))
  && /\*\*Due:\*\* 2026-10-28/.test(fs.readFileSync(path.join(BRAIN, 'Reminders/2026-10-25--vet.md'), 'utf8')));
chk('signals from Claude, to the user, or deferred are not listed', !files.some((f) => /hello|which|later/.test(f)));
chk('exactly the four items', out.items.length === 4, files.join(', '));
chk('with nothing waiting the Librarian is not run', watch(BRAIN, { apply: true }).ran === 0);

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
