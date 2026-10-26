#!/usr/bin/env node
// --- brain-librarian.test.mjs -----------------------------------------------
// Runs the real librarian against a throwaway brain with a fixed clock and
// checks every mechanical step, dry-run safety and idempotency.
//
//   node ~/.claude/helpers/test/brain-librarian.test.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'brain-librarian.mjs');
const OPEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'brain-open-items.mjs');
const ROOT = path.join(os.tmpdir(), `librarian-test-${process.pid}`);
const NOW = '2026-10-24T13:00:00Z'; // 09:00 ET on 2026-10-24

let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const p = (...x) => path.join(ROOT, ...x);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const put = (rel, text, mtime) => {
  fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
  fs.writeFileSync(p(rel), text, 'utf8');
  if (mtime) fs.utimesSync(p(rel), mtime, mtime);
};
const run = (args = [], extra = {}) => spawnSync(process.execPath, [HOOK, ...args], {
  env: { ...process.env, ALFRED_SHARED_BRAIN: ROOT, ALFRED_NOW: NOW, ...extra }, encoding: 'utf8' });
const reminder = (kind, status, due, until, title = 'Item') =>
  `# ${title}\n\n- **Kind:** ${kind}\n- **Status:** ${status}\n- **Due:** ${due}\n- **Until:** ${until}\n- **Scope:** personal\n- **Author:** grok\n\nBody.\n`;
const signal = (type, from, to, re, status = 'open') =>
  `# ${type}\n\n- **Kind:** signal\n- **Type:** ${type}\n- **From:** ${from}\n- **To:** ${to}\n- **Re:** ${re}\n- **Status:** ${status}\n`;

// --- Fixture ---
fs.rmSync(ROOT, { recursive: true, force: true });
const old = new Date(Date.parse(NOW) - 40 * 86400000);
put('Reminders/2026-10-23--yesterday-errand.md', reminder('errand', 'open', '2026-10-23', 'end-of-day', 'Yesterday errand'));
put('Reminders/2026-10-24--today-errand.md', reminder('errand', 'open', '2026-10-24', 'end-of-day', 'Today errand'));
put('Reminders/2026-10-20--overdue.md', reminder('reminder', 'open', '2026-10-20', 'done', 'Overdue thing'));
put('Reminders/2026-10-01--watch.md', reminder('watch', 'open', 'none', '2026-10-10', 'Lapsed watch'));
put('Reminders/2026-10-21--todo.md', reminder('todo', 'open', 'none', 'done', 'Plain todo'));
put('Reminders/2026-10-22--closed-by-signal.md', reminder('reminder', 'open', '2026-10-30', 'done', 'Close me'));
put('Reminders/2026-10-22--author-closed.md', reminder('reminder', 'done', '2026-10-22', 'done', 'Author closed'));
put('Reminders/README.md', '# Reminders\n');
put('Reminders/Done/2026-09-01--ancient.md', reminder('todo', 'done', 'none', 'done', 'Ancient'), old);
put('Inbox/2026-10-24-0800--claude--grok--close--close-me.md', signal('close', 'claude', 'grok', 'Reminders/2026-10-22--closed-by-signal.md'));
// Structured amends (MANIFESTO §6 / §9): a Set: header, a "replace … with …" body line, a reopen, and one that needs judgement.
put('Inbox/2026-10-24-0810--grok--claude--amend--move-todo.md', `${signal('amend', 'grok', 'claude', 'Reminders/2026-10-21--todo.md')}- **Set:** Due = 2026-10-28\n\nThe user asked for next Wednesday.\n`);
put('Reminders/Done/2026-10-23--expired-errand.md', reminder('errand', 'expired', '2026-10-23', 'end-of-day', 'Expired errand'));
put('Inbox/2026-10-24-0815--grok--claude--amend--reopen-errand.md', `${signal('amend', 'grok', 'claude', 'Reminders/Done/2026-10-23--expired-errand.md')}\nReopen it: replace \`- **Status:** expired\` with \`- **Status:** open\` and replace \`- **Due:** 2026-10-23\` with \`- **Due:** 2026-10-24\`.\n`);
put('Inbox/2026-10-24-0820--grok--claude--amend--topic-fact.md', `${signal('amend', 'grok', 'claude', 'Memory/topics/home.md')}\nAdd a line about the boiler.\n`);
put('Inbox/2026-10-23-0900--grok--claude--handoff--do-thing.md', signal('handoff', 'grok', 'claude', 'none'));
put('Inbox/2026-10-24-0700--claude--grok--reply--did-thing.md', signal('reply', 'claude', 'grok', '2026-10-23-0900--grok--claude--handoff--do-thing.md'));
put('Inbox/2026-10-10-0900--grok--claude--capture--stale.md', signal('capture', 'grok', 'claude', 'Memory/topics/home.md'), old);
put('Inbox/2026-10-24-0600--grok--claude--close--missing.md', signal('close', 'grok', 'claude', 'Reminders/does-not-exist.md'));
put('Memory/topics/home.md', '# Home\n\n- (2026-10-01) Permanent fact · via grok\n- (2026-10-01) Away this week · until 2026-10-20 · via grok\n- (2026-10-01) Future temp · until 2026-12-01 · via grok\n');
put('System/logs/grok-2026-06.md', '# old log\n', old);
put('index.md', '# Second Brain: Index\n\n- **Author:** Grok\n');
put('Calendar/events.md', '# Calendar\n\n## 2026-10 (October 2026)\n\n- 2026-10-20 Past event (added by grok)\n- 2026-10-27 10:00 Dentist @ clinic (added by grok)\n- ~~2026-10-28 Cancelled lunch~~ (cancelled by user via claude-code)\n\n## 2026-11 (November 2026)\n\n- 2026-11-20 Too far out (added by grok)\n');

// --- Dry run changes nothing ---
console.log('\nDry run');
const before = JSON.stringify(fs.readdirSync(p('Reminders')));
const dry = run(['--dry-run']);
chk('dry run reports actions', /\(dry run\) move/.test(dry.stdout), dry.stdout.slice(0, 200));
chk('dry run moves nothing', JSON.stringify(fs.readdirSync(p('Reminders'))) === before);

// --- Real run ---
console.log('\nReminders');
run();
const done = (f) => fs.existsSync(p('Reminders/Done', f));
chk('yesterday\'s errand expired and filed', done('2026-10-23--yesterday-errand.md')
  && /Status:\*\* expired/.test(read(p('Reminders/Done/2026-10-23--yesterday-errand.md'))));
chk('today\'s errand stays open', fs.existsSync(p('Reminders/2026-10-24--today-errand.md')));
chk('overdue reminder stays open (only the user closes it)', fs.existsSync(p('Reminders/2026-10-20--overdue.md')));
chk('watch past its Until date expired', done('2026-10-01--watch.md'));
chk('undated todo stays open', fs.existsSync(p('Reminders/2026-10-21--todo.md')));
chk('author-closed item filed to Done', done('2026-10-22--author-closed.md'));
const closed = read(p('Reminders/Done/2026-10-22--closed-by-signal.md'));
chk('close signal closes and files its reminder', /Status:\*\* done/.test(closed) && /Closed: .* by claude/.test(closed));
chk('applied close signal filed to Inbox/Done', fs.existsSync(p('Inbox/Done/2026-10-24-0800--claude--grok--close--close-me.md')));
chk('close signal with a missing target is left for a person', fs.existsSync(p('Inbox/2026-10-24-0600--grok--claude--close--missing.md')));

console.log('\nSignals and age-out');
chk('a reply files itself and the signal it answers', fs.existsSync(p('Inbox/Done/2026-10-23-0900--grok--claude--handoff--do-thing.md'))
  && fs.existsSync(p('Inbox/Done/2026-10-24-0700--claude--grok--reply--did-thing.md')));
chk('unanswered capture stays in Inbox', fs.existsSync(p('Inbox/2026-10-10-0900--grok--claude--capture--stale.md')));
chk('Done item older than 30 days goes to Archive', fs.existsSync(p('Archive/2026-10/Reminders-Done/2026-09-01--ancient.md')));
chk('log older than 90 days stays (40 days old)', fs.existsSync(p('System/logs/grok-2026-06.md')));

console.log('\nMemory and index');
const home = read(p('Memory/topics/home.md'));
chk('expired temporary memory line removed', !/Away this week/.test(home) && /Permanent fact/.test(home) && /Future temp/.test(home));
chk('expired line kept in Archive', /Away this week/.test(read(p('Archive/2026-10/expired-memory.md'))));
const index = read(p('index.md'));
chk('index lists today\'s errand and the reopened one under Due today', /### Due today \(2\)[\s\S]*Expired errand[\s\S]*Today errand|### Due today \(2\)[\s\S]*Today errand[\s\S]*Expired errand/.test(index), index.slice(0, 600));
chk('index lists the overdue item', /### Overdue \(1\)[\s\S]*Overdue thing/.test(index));
chk('index offers yesterday\'s errand for carry-over', /carry over \(1\)[\s\S]*Yesterday errand/.test(index));
chk('index flags the stale signal', /older than 7 days/.test(index));
chk('index lists the calendar\'s next 7 days: upcoming only, no cancelled, no past, nothing beyond a week',
  /### On the calendar, next 7 days \(1\)\n- 2026-10-27 10:00 Dentist @ clinic · `Calendar\/events\.md`/.test(index), (index.match(/### On the calendar[\s\S]*?\n\n/) || [''])[0]);
chk('the catalog points at the calendar file', /### Calendar\n- `Calendar\/events\.md`/.test(index));
chk('index keeps Grok as author line', /Author:\*\* Grok/.test(index));
chk('run is logged', /Librarian log/.test(read(p('System/logs/librarian-2026-10.md'))));

console.log('\nAmend signals');
const movedTodo = read(p('Reminders/2026-10-21--todo.md'));
chk('a Set: amend changes the field and notes who asked', /\*\*Due:\*\* 2026-10-28/.test(movedTodo) && /- Edited: 2026-10-24 09:00 ET by grok \(change note, applied 2026-10-24 09:00 ET\): due none → 2026-10-28/.test(movedTodo), movedTodo);
chk('its signal is filed as applied', !fs.existsSync(p('Inbox/2026-10-24-0810--grok--claude--amend--move-todo.md'))
  && /done \(applied by librarian/.test(read(p('Inbox/Done/2026-10-24-0810--grok--claude--amend--move-todo.md'))));
const reopened = read(p('Reminders/2026-10-23--expired-errand.md'));
chk('a replace-with amend reopens an expired errand and moves it back', !!reopened && /\*\*Status:\*\* open/.test(reopened) && /\*\*Due:\*\* 2026-10-24/.test(reopened)
  && !fs.existsSync(p('Reminders/Done/2026-10-23--expired-errand.md')), reopened);
chk('an amend on a non-reminder is left for a person', fs.existsSync(p('Inbox/2026-10-24-0820--grok--claude--amend--topic-fact.md'))
  && !/boiler/.test(read(p('Memory/topics/home.md'))));

console.log('\nIdempotency and open-items hook');
const again = run(['--dry-run']);
chk('second run has nothing to do', !/(move|edit) /.test(again.stdout), again.stdout);
const open = spawnSync(process.execPath, [OPEN], { env: { ...process.env, ALFRED_SHARED_BRAIN: ROOT, ALFRED_NOW: NOW }, encoding: 'utf8' });
chk('open-items hook shows due today and overdue', /Today errand/.test(open.stdout) && /Overdue thing/.test(open.stdout), open.stdout);
chk('open-items hook lists signals addressed to Claude', /capture--stale/.test(open.stdout), open.stdout);
chk('open-items hook offers carry-over', /Yesterday errand/.test(open.stdout), open.stdout);
chk('open-items hook shows the calendar\'s next 7 days', /On the calendar, next 7 days[\s\S]*2026-10-27 10:00 Dentist @ clinic/.test(open.stdout)
  && !/Cancelled lunch|Too far out|Past event/.test(open.stdout), open.stdout);

console.log('\nCloud Librarian in charge, PC stands by');
const heartbeat = (stamp) => put('System/librarian-heartbeat.md', `# Librarian heartbeat\n\n- **Kind:** status\n- **Author:** librarian (cloud)\n- **Last run:** ${stamp}\n`);
put('Reminders/2026-10-23--standby-errand.md', reminder('errand', 'open', '2026-10-23', '', 'Standby errand'));
heartbeat('2026-10-24 08:50 ET');  // ten minutes ago
const standby = run();
chk('a fresh cloud heartbeat makes the PC stand by', fs.existsSync(p('Reminders/2026-10-23--standby-errand.md'))
  && /standing by: the cloud Librarian ran at 2026-10-24 08:50 ET/.test(standby.stdout), standby.stdout);
const forced = run(['--force']);
chk('--force runs anyway', !fs.existsSync(p('Reminders/2026-10-23--standby-errand.md')), forced.stdout);
put('Reminders/2026-10-22--stale-errand.md', reminder('errand', 'open', '2026-10-22', '', 'Stale errand'));
heartbeat('2026-10-24 08:00 ET');  // an hour ago: the cloud has gone quiet
run();
chk('a stale heartbeat makes the PC take over', !fs.existsSync(p('Reminders/2026-10-22--stale-errand.md')));
const lib = await import(pathToFileURL(HOOK).href);
const at = lib.easternNow(new Date(NOW));
put('Reminders/2026-10-21--cloud-errand.md', reminder('errand', 'open', '2026-10-21', '', 'Cloud errand'));
const cloudActions = lib.runLibrarian(ROOT, { runner: 'cloud', now: at });
chk('the cloud runner works even with a fresh heartbeat and leaves its own', cloudActions.some((a) => /cloud-errand/.test(a))
  && /\*\*Last run:\*\* 2026-10-24 09:00 ET/.test(read(p('System/librarian-heartbeat.md'))), cloudActions.join('; '));
chk('its run is logged as the cloud', /## 2026-10-24 09:00 ET · cloud/.test(read(p('System/logs/librarian-2026-10.md'))));
chk('cloudLibrarian reports the heartbeat', lib.cloudLibrarian(ROOT, at).fresh && lib.cloudLibrarian(ROOT, at).at === '2026-10-24 09:00 ET');

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
