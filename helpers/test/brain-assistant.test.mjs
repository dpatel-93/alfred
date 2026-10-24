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
import { applyAction, applyGrokPlan, assistantFeed, authorIsOurs, brainNote, latestBrief, parseGrokPlan, routineDueToday, tellGrokPrompt, writeSignal } from '../brain-assistant.mjs';
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
let feed = assistantFeed(ROOT, NOW);
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

// --- Who may edit in place ---
console.log('\nAuthorship');
chk('"Claude Code (migrated; originally captured by Grok)" is ours', authorIsOurs('Claude Code (migrated; originally captured by Grok)'));
chk('"Grok (file created by Grok; text by Claude Code)" is not ours', !authorIsOurs('Grok (file created by Grok; text by Claude Code at the user\'s direction)'));
chk('Alfred and librarian are ours, an empty author is not', authorIsOurs('Alfred') && authorIsOurs('librarian') && !authorIsOurs(''));

// --- Actions: close / tomorrow / snooze / carryover ---
console.log('\nActions');
const ours = (kind, status, due, title) => reminder(kind, status, due, title).replace('**Author:** grok', '**Author:** Claude Code (migrated; originally captured by Grok)');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
put('Reminders/2026-10-21--ours-todo.md', ours('todo', 'open', 'none', 'Our own to-do'));
put('Reminders/2026-10-21--grok-todo.md', reminder('todo', 'open', 'none', 'A to-do Grok wrote'));
put('Reminders/2026-10-26--ours-errand.md', ours('errand', 'open', '2026-10-26', 'Our errand'));
put('Reminders/2026-10-26--grok-errand.md', reminder('errand', 'open', '2026-10-26', 'A Grok errand'));
put('Reminders/Done/2026-10-25--expired.md', `${ours('errand', 'expired', '2026-10-25', 'Yesterday\'s errand')}\n- Expired: 2026-10-26 02:30 ET by librarian (errand day ended)\n`);

let r = applyAction(ROOT, { file: 'Reminders/2026-10-21--ours-todo.md', action: 'close' }, NOW);
chk('closing our own file edits it in place and moves it to Done', r.status === 200 && r.via === 'direct' && r.applied
  && !exists('Reminders/2026-10-21--ours-todo.md') && /\*\*Status:\*\* done/.test(read('Reminders/Done/2026-10-21--ours-todo.md'))
  && /- Closed: 2026-10-26 09:00 ET by user \(Alfred dashboard\)/.test(read('Reminders/Done/2026-10-21--ours-todo.md')), JSON.stringify(r));
chk('it shows under done-today on the next read', assistantFeed(ROOT, NOW).doneToday.some((i) => i.title === 'Our own to-do'));

r = applyAction(ROOT, { file: 'Reminders/2026-10-21--grok-todo.md', action: 'close' }, NOW);
const grokDone = 'Reminders/Done/2026-10-21--grok-todo.md';
chk('closing Grok\'s file edits it in place too (rule 2) and says whose file it was',
  r.status === 200 && r.via === 'direct' && r.applied && !r.signal
  && exists(grokDone) && /- Closed: 2026-10-26 09:00 ET by user \(Alfred dashboard; file by grok\)/.test(read(grokDone)), JSON.stringify(r));
chk('no signal was written for it', !fs.existsSync(path.join(ROOT, 'Inbox')) || !fs.readdirSync(path.join(ROOT, 'Inbox')).some((f) => /--user--grok--close--/.test(f)));
chk('index.md is regenerated by the action', /## Open items/.test(read('index.md')) && !read('index.md').includes('A to-do Grok wrote'));
chk('closing it again is a clear 404', applyAction(ROOT, { file: 'Reminders/2026-10-21--grok-todo.md', action: 'close' }, NOW).status === 404);

r = applyAction(ROOT, { file: 'Reminders/2026-10-26--ours-errand.md', action: 'tomorrow' }, NOW);
chk('tomorrow on our own errand moves its Due and keeps it open in Reminders/', r.status === 200 && r.applied && r.due === '2026-10-27'
  && /\*\*Due:\*\* 2026-10-27/.test(read('Reminders/2026-10-26--ours-errand.md')) && /- Moved: .* to 2026-10-27 by user/.test(read('Reminders/2026-10-26--ours-errand.md')));
chk('it now sits in upcoming, not today', assistantFeed(ROOT, NOW).upcoming.some((i) => i.title === 'Our errand') && !assistantFeed(ROOT, NOW).today.some((i) => i.title === 'Our errand'));

r = applyAction(ROOT, { file: 'Reminders/2026-10-26--grok-errand.md', action: 'tomorrow' }, NOW);
chk('tomorrow on Grok\'s errand moves its Due in place and names the author', r.status === 200 && r.applied && r.due === '2026-10-27'
  && /\*\*Due:\*\* 2026-10-27/.test(read('Reminders/2026-10-26--grok-errand.md'))
  && /- Moved: .* by user \(Alfred dashboard; file by grok\)/.test(read('Reminders/2026-10-26--grok-errand.md')), JSON.stringify(r));
chk('it moved to upcoming', assistantFeed(ROOT, NOW).upcoming.some((i) => i.title === 'A Grok errand'));
chk('a second signal with the same subject gets a distinct file name',
  writeSignal(ROOT, { type: 'fyi', from: 'claude-code', to: 'grok', re: 'x', subject: 'Twice' }, NOW).endsWith('--twice.md')
  && writeSignal(ROOT, { type: 'fyi', from: 'claude-code', to: 'grok', re: 'x', subject: 'Twice' }, NOW).endsWith('--twice-2.md'));
chk('an open close signal from another AI still marks its item pending', (() => {
  put('Reminders/2026-10-21--pending.md', reminder('todo', 'open', 'none', 'Pending one'));
  put('Inbox/2026-10-26-0800--grok--claude--close--pending-one.md', '# Close\n\n- **Kind:** signal\n- **Type:** close\n- **From:** grok\n- **To:** claude\n- **Re:** Reminders/2026-10-21--pending.md\n- **Status:** open\n');
  const ok = assistantFeed(ROOT, NOW).todos.find((i) => i.title === 'Pending one')?.pending === 'close';
  fs.rmSync(path.join(ROOT, 'Inbox/2026-10-26-0800--grok--claude--close--pending-one.md'));
  return ok;
})());

chk('snooze needs a date', applyAction(ROOT, { file: 'Reminders/2026-10-26--ours-errand.md', action: 'snooze' }, NOW).status === 400);
r = applyAction(ROOT, { file: 'Reminders/2026-10-26--ours-errand.md', action: 'snooze', due: '2026-11-02' }, NOW);
chk('snooze to a date', r.status === 200 && r.due === '2026-11-02' && /\*\*Due:\*\* 2026-11-02/.test(read('Reminders/2026-10-26--ours-errand.md')));

r = applyAction(ROOT, { file: 'Reminders/Done/2026-10-25--expired.md', action: 'carryover' }, NOW);
chk('carry-over reopens yesterday\'s expired errand for today', r.status === 200 && r.applied && r.due === '2026-10-26'
  && exists('Reminders/2026-10-25--expired.md') && /\*\*Status:\*\* open/.test(read('Reminders/2026-10-25--expired.md'))
  && assistantFeed(ROOT, NOW).today.some((i) => i.title === 'Yesterday\'s errand'), JSON.stringify(r));
chk('carry-over refuses an item that is not in Done/', applyAction(ROOT, { file: 'Reminders/2026-10-26--ours-errand.md', action: 'carryover' }, NOW).status === 400);

console.log('\nAction safety');
chk('refuses files outside Reminders/', applyAction(ROOT, { file: 'Memory/profile.md', action: 'close' }, NOW).status === 400);
chk('refuses a path that escapes', applyAction(ROOT, { file: 'Reminders/../Memory/profile.md', action: 'close' }, NOW).status === 400);
chk('refuses the README', applyAction(ROOT, { file: 'Reminders/README.md', action: 'close' }, NOW).status === 400);
chk('refuses an unknown action', applyAction(ROOT, { file: 'Reminders/2026-10-26--ours-errand.md', action: 'delete' }, NOW).status === 400);
chk('refuses a bad actor name', applyAction(ROOT, { file: 'Reminders/2026-10-26--ours-errand.md', action: 'close', by: 'x; rm' }, NOW).status === 400);
chk('a missing brain is a 404', applyAction(path.join(ROOT, 'nope'), { file: 'Reminders/x.md', action: 'close' }, NOW).status === 404);

// --- Signals and projects in the feed ---
console.log('\nFeed extras');
const fyi = writeSignal(ROOT, { type: 'fyi', from: 'claude-code', to: 'grok', re: 'Routines/', subject: 'Dashboard can close items', body: 'Hello.' }, NOW);
const sig = read(fyi);
chk('a signal is named and headed per MANIFESTO §6', /^Inbox\/2026-10-26-0900--claude-code--grok--fyi--dashboard-can-close-items\.md$/.test(fyi)
  && /- \*\*Kind:\*\* signal\n- \*\*Type:\*\* fyi\n- \*\*From:\*\* claude-code\n- \*\*To:\*\* grok\n- \*\*Re:\*\* Routines\/\n- \*\*Status:\*\* open\n- \*\*Created:\*\* 2026-10-26 09:00 ET/.test(sig), sig);
feed = assistantFeed(ROOT, NOW);
chk('open signals appear in the feed with from, to and type', feed.signals.some((s) => s.file === fyi && s.from === 'claude-code' && s.to === 'grok' && s.type === 'fyi'));
put('Projects/demo/status.md', '# Demo\n\n- **Owner:** Claude\n- **Status:** Active\n- **Track:** Personal\n\n## Where it stands\n- (2026-10-25) **Nearly** done.\n- (2026-10-20) Started.\n\n## Next\n1. Ship it.\n');
put('Projects/_dormant/old.md', '# Old\n');
put('Projects/paused/status.md', '# Paused\n\n- **Status:** dormant\n\n## Where it stands\n- x\n');
feed = assistantFeed(ROOT, NOW);
chk('active projects give one status line and one next step', feed.projects.length === 1 && feed.projects[0].name === 'demo'
  && feed.projects[0].stands === '(2026-10-25) Nearly done.' && feed.projects[0].next === 'Ship it.' && feed.projects[0].track === 'Personal', JSON.stringify(feed.projects));
feed = assistantFeed(ROOT, NOW);
chk('the feed no longer carries a recent-changes list (the dashboard card was removed)', !('recent' in feed));

chk('items carry a short author and whether we may edit them',
  feed.upcoming.find((i) => i.title === 'A Grok errand')?.author === 'grok' && feed.upcoming.find((i) => i.title === 'A Grok errand')?.ours === false
  && feed.today.find((i) => i.title === 'Yesterday\'s errand')?.author === 'Claude Code' && feed.today.find((i) => i.title === 'Yesterday\'s errand')?.ours === true);

// --- The desk box: "Tell Grok" ---
console.log('\nTell Grok');
const prompt = tellGrokPrompt('remind me to call the plumber Saturday and dentist Tuesday 3pm', NOW);
chk('the prompt carries the user\'s words, today\'s date and weekday, and asks for JSON only',
  prompt.includes('"remind me to call the plumber Saturday and dentist Tuesday 3pm"') && prompt.includes('Monday 2026-10-26') && /ONLY one JSON object/.test(prompt));
chk('a plan wrapped in a code fence still parses', parseGrokPlan('Sure!\n```json\n{"reply":"Done.","items":[]}\n```')?.reply === 'Done.');
chk('an answer with no plan is null, not a crash', parseGrokPlan('I cannot help with that.') === null && parseGrokPlan('{"reply":"x"}') === null);
const words = 'remind me to call the plumber Saturday, dentist Tuesday 3pm, and remember the wifi router is in the basement';
const plan = { reply: 'Got it: plumber Saturday, dentist Tuesday at 3.', items: [
  { type: 'reminder', kind: 'reminder', title: 'Call the plumber', due: '2026-10-31', time: null, scope: 'personal' },
  { type: 'event', title: 'Dentist', date: '2026-10-27', time: '15:00', endTime: null, location: 'Main St clinic' },
  { type: 'other', summary: 'Remember: the wifi router is in the basement (home topic)' },
  { type: 'reminder', kind: 'reminder', title: 'Back-dated', due: '2026-10-01' },
  { type: 'reminder', kind: 'chore', title: 'Unknown kind' },
  { type: 'event', title: 'No date' },
] };
const res = applyGrokPlan(ROOT, plan, words, NOW);
const rem = res.saved.find((s) => s.type === 'reminder');
const remText = rem ? fs.readFileSync(path.join(ROOT, rem.file), 'utf8') : '';
chk('a reminder becomes one file in Reminders/, dated by its due date, authored by Grok via the desk box',
  rem && rem.file === 'Reminders/2026-10-31--call-the-plumber.md' && /- \*\*Kind:\*\* reminder/.test(remText) && /- \*\*Status:\*\* open/.test(remText)
  && /- \*\*Due:\*\* 2026-10-31/.test(remText) && /- \*\*Author:\*\* grok \(from the Alfred desk box\)/.test(remText) && remText.includes(words), remText);
chk('the new reminder shows up in the feed', assistantFeed(ROOT, NOW).upcoming.some((i) => i.title === 'Call the plumber'));
const cal = fs.readFileSync(path.join(ROOT, 'Calendar/events.md'), 'utf8');
chk('an event becomes a line in the shared calendar, added by Grok', cal.includes('- 2026-10-27 15:00 Dentist @ Main St clinic (added by grok)'), cal);
const inbox = res.saved.find((s) => s.type === 'inbox');
chk('anything else goes to Grok\'s inbox as a handoff in the user\'s words', inbox && /--user--grok--handoff--/.test(inbox.file)
  && fs.readFileSync(path.join(ROOT, inbox.file), 'utf8').includes(words), JSON.stringify(inbox));
chk('a past date, an unknown kind and an event with no date are refused and reported, not written',
  res.skipped.length === 3 && !fs.readdirSync(path.join(ROOT, 'Reminders')).some((f) => /back-dated|unknown-kind/.test(f)), JSON.stringify(res.skipped));
chk('Grok\'s one-line reply is passed back', res.reply === 'Got it: plumber Saturday, dentist Tuesday at 3.');
const empty = applyGrokPlan(ROOT, { reply: 'Hmm.', items: [{ type: 'reminder', kind: 'nope' }] }, 'do the thing', NOW);
chk('when nothing in the plan can be saved, the words still reach Grok\'s inbox', empty.saved.length === 1 && empty.saved[0].type === 'inbox');
const errand = applyGrokPlan(ROOT, { items: [{ type: 'reminder', kind: 'errand', title: 'Buy milk', due: 'none' }] }, 'add milk to my errands', NOW);
chk('an errand with no date is due today and ends with the day', errand.saved[0]?.due === NOW.date
  && /- \*\*Until:\*\* end-of-day/.test(fs.readFileSync(path.join(ROOT, errand.saved[0].file), 'utf8')));

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
