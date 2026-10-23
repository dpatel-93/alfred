#!/usr/bin/env node
// --- brain-assistant.test.mjs ------------------------------------------------
// Builds a throwaway brain and checks the HUD's personal-assistant feed:
// today's brief, reminders by bucket, the user's routines, and that a closed
// reminder drops off.
//
//   node ~/.claude/helpers/test/brain-assistant.test.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assistantFeed, brainNote, latestBrief, routineDueToday } from '../brain-assistant.mjs';
import { easternNow } from '../brain-librarian.mjs';

const ROOT = path.join(os.tmpdir(), `assistant-test-${process.pid}`);
const NOW = easternNow(new Date('2026-10-26T13:00:00Z')); // Monday 09:00 ET

let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
};
const reminder = (kind, status, due, title) =>
  `# ${title}\n\n- **Kind:** ${kind}\n- **Status:** ${status}\n- **Due:** ${due}\n- **Scope:** personal\n- **Author:** grok\n`;
const routine = (title, runs, schedule, status = 'active') =>
  `# ${title}\n\n- **Kind:** routine\n- **Runs:** ${runs}\n- **Schedule:** ${schedule}\n- **Status:** ${status}\n`;

// --- Fixture ---
fs.rmSync(ROOT, { recursive: true, force: true });
put('Reminders/2026-10-26--errand.md', reminder('errand', 'open', '2026-10-26', 'Pick up dry cleaning'));
put('Reminders/2026-10-25--late.md', reminder('reminder', 'open', '2026-10-25', 'Late thing'));
put('Reminders/2026-10-28--soon.md', reminder('reminder', 'open', '2026-10-28', 'Soon thing'));
put('Reminders/2026-10-21--chore.md', reminder('todo', 'open', 'none', 'Clean the gutters'));
put('Reminders/2026-10-21--watch.md', reminder('watch', 'open', 'none', 'Watch the van market'));
put('Reminders/2026-10-21--closed.md', reminder('todo', 'done', 'none', 'Already closed'));
put('Routines/user-monday.md', routine('The user: Monday time tracking', 'the user', 'Mondays (morning)'));
put('Routines/user-cadence.md', routine('The user: status updates', 'the user', 'cadence not yet recorded'));
put('Routines/user-paused.md', routine('The user: paused habit', 'the user', 'daily', 'paused'));
put('Routines/grok-brief.md', routine('Grok: morning brief', 'Grok Bot', 'weekdays ~07:00 ET'));
put('Outputs/briefs/2026-10-23.md', '# Morning brief, Friday\n\n- Last updated: 2026-10-23 7:10 AM ET | x\n\n## Top of the brief\n'
  + '1. **Old news.** From Friday.\n');
put('Outputs/briefs/2026-10-26.md', '# Morning brief, Monday\n\n- Coordinator: Grok | Last updated: 2026-10-26 7:05 AM ET | r\n\n'
  + '## Top of the brief\n1. **Firewalls need patching.** Hotfix lands today.\n2. Plain item\n\n## Markets\n1. **Not top.** x\n');
put('Outputs/briefs/2026-10-27.md', '# Tomorrow\n\n## Top of the brief\n1. **Future.** x\n');

// --- Schedules ---
console.log('\nSchedules');
chk('"Mondays (morning)" is due on a Monday', routineDueToday('Mondays (morning)', '2026-10-26') === true);
chk('"Saturdays ~09:00" is not due on a Monday', routineDueToday('Saturdays ~09:00 ET', '2026-10-26') === false);
chk('"weekdays" is due Monday, not Sunday', routineDueToday('weekdays ~07:00', '2026-10-26') === true
  && routineDueToday('weekdays ~07:00', '2026-10-25') === false);
chk('"daily" is always due', routineDueToday('daily ~02:30 ET', '2026-10-25') === true);
chk('an unknown cadence has no fixed day', routineDueToday('cadence not yet recorded', '2026-10-26') === null);

// --- Brief ---
console.log('\nBrief');
const brief = latestBrief(ROOT, NOW.date);
chk('picks today\'s brief, never a future one', brief?.date === '2026-10-26' && brief.isToday, brief?.date);
chk('reads only the Top section', brief.top.length === 2 && brief.top[0].title === 'Firewalls need patching.'
  && brief.top[0].text === 'Hotfix lands today.' && brief.top[1].title === 'Plain item', JSON.stringify(brief.top));
chk('reads the last-updated time', brief.updated === '2026-10-26 7:05 AM ET', brief.updated);
chk('falls back to the newest earlier brief', latestBrief(ROOT, '2026-10-25')?.date === '2026-10-23');

// --- Feed ---
console.log('\nFeed');
const feed = assistantFeed(ROOT, NOW);
const titles = (list) => list.map((i) => i.title).join('|');
chk('today holds the errand due today', titles(feed.today) === 'Pick up dry cleaning', titles(feed.today));
chk('overdue and upcoming are split', titles(feed.overdue) === 'Late thing' && titles(feed.upcoming) === 'Soon thing');
chk('undated todos and watches are split', titles(feed.todos) === 'Clean the gutters'
  && titles(feed.watching) === 'Watch the van market');
chk('closed reminders never show', !JSON.stringify(feed).includes('Already closed'));
chk('only the user\'s active routines, today vs other',
  titles(feed.routines.today) === 'Monday time tracking' && titles(feed.routines.other) === 'status updates',
  JSON.stringify(feed.routines));
chk('calendar is reported as not connected', feed.calendar.connected === false);

fs.writeFileSync(path.join(ROOT, 'Reminders/2026-10-26--errand.md'), reminder('errand', 'done', '2026-10-26', 'Pick up dry cleaning'));
chk('a reminder closed elsewhere drops off on the next read', assistantFeed(ROOT, NOW).today.length === 0);
chk('a missing brain reports brain:false, never throws', assistantFeed(path.join(ROOT, 'nope'), NOW).brain === false);

// --- Reader ---
console.log('\nReader');
chk('reads a brain file', brainNote(ROOT, 'Reminders/2026-10-21--chore.md').markdown?.includes('Clean the gutters'));
chk('refuses a path outside the brain', brainNote(ROOT, '../outside.md').status === 403);
chk('refuses an absolute path elsewhere', brainNote(ROOT, path.join(os.tmpdir(), 'x.md')).status === 403);
chk('refuses non-markdown', brainNote(ROOT, 'Reminders/x.txt').status === 400);
chk('a closed-and-moved file is a clear 404', brainNote(ROOT, 'Reminders/gone.md').status === 404);

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
