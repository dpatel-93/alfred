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
import { applyAction, applyPlan, assistantFeed, authorIsOurs, brainNote, tellItemList, latestBrief, parsePlan, routineDueToday, tellPrompt, writeSignal } from '../brain-assistant.mjs';
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
chk('index.md is regenerated by the action: gone from the open items, listed under recent changes',
  /## Open items/.test(read('index.md')) && !read('index.md').split('## Changed in the last 48 hours')[0].includes('A to-do Grok wrote')
  && /## Changed in the last 48 hours[\s\S]*A to-do Grok wrote · closed /.test(read('index.md')));
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
chk('a waiting close note from Grok hides its item, as if already done', (() => {
  put('Reminders/2026-10-21--pending.md', reminder('todo', 'open', 'none', 'Pending one'));
  put('Inbox/2026-10-26-0800--grok--claude--close--pending-one.md', '# Close\n\n- **Kind:** signal\n- **Type:** close\n- **From:** grok\n- **To:** claude\n- **Re:** Reminders/2026-10-21--pending.md\n- **Status:** open\n');
  const feed = assistantFeed(ROOT, NOW);
  const ok = !feed.todos.some((i) => i.title === 'Pending one') && fs.existsSync(path.join(ROOT, 'Reminders/2026-10-21--pending.md'));
  fs.rmSync(path.join(ROOT, 'Inbox/2026-10-26-0800--grok--claude--close--pending-one.md'));
  return ok;
})());
chk('a waiting change note shows the new date and title, marked pending', (() => {
  put('Inbox/2026-10-26-0805--grok--librarian--amend--pending-one.md', '# Amend\n\n- **Kind:** signal\n- **Type:** amend\n- **From:** grok\n- **To:** librarian\n'
    + '- **Target:** Reminders/2026-10-21--pending.md\n- **Status:** open\n- **Created:** 2026-10-26 08:05 ET\n- **Set:** Due = 2026-10-28 15:00\n- **Set:** Title = Pending one, moved\n');
  const it = assistantFeed(ROOT, NOW).upcoming.find((i) => i.file === 'Reminders/2026-10-21--pending.md');
  fs.rmSync(path.join(ROOT, 'Inbox/2026-10-26-0805--grok--librarian--amend--pending-one.md'));
  return it?.due === '2026-10-28' && it?.time === '15:00' && it?.title === 'Pending one, moved' && it?.pending === 'amend';
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
console.log('\nTell Alfred');
const prompt = tellPrompt('remind me to call the plumber Saturday and dentist Tuesday 3pm', NOW);
chk('the prompt carries the user\'s words, today\'s date and weekday, and asks for JSON only',
  prompt.includes('"remind me to call the plumber Saturday and dentist Tuesday 3pm"') && prompt.includes('Monday 2026-10-26') && /ONLY one JSON object/.test(prompt));
chk('a plan wrapped in a code fence still parses', parsePlan('Sure!\n```json\n{"reply":"Done.","items":[]}\n```')?.reply === 'Done.');
chk('an answer with no plan is null, not a crash', parsePlan('I cannot help with that.') === null && parsePlan('{"reply":"x"}') === null);
const words = 'remind me to call the plumber Saturday, dentist Tuesday 3pm, and remember the wifi router is in the basement';
const plan = { reply: 'Got it: plumber Saturday, dentist Tuesday at 3.', items: [
  { type: 'reminder', kind: 'reminder', title: 'Call the plumber', due: '2026-10-31', time: null, scope: 'personal' },
  { type: 'event', title: 'Dentist', date: '2026-10-27', time: '15:00', endTime: null, location: 'Main St clinic' },
  { type: 'other', summary: 'Remember: the wifi router is in the basement (home topic)' },
  { type: 'reminder', kind: 'reminder', title: 'Back-dated', due: '2026-10-01' },
  { type: 'reminder', kind: 'chore', title: 'Unknown kind' },
  { type: 'event', title: 'No date' },
] };
const res = applyPlan(ROOT, plan, words, NOW);
const rem = res.saved.find((s) => s.type === 'reminder');
const remText = rem ? fs.readFileSync(path.join(ROOT, rem.file), 'utf8') : '';
chk('a reminder becomes one file in Reminders/, dated by its due date, authored by the user via the Tell Alfred box',
  rem && rem.file === 'Reminders/2026-10-31--call-the-plumber.md' && /- \*\*Kind:\*\* reminder/.test(remText) && /- \*\*Status:\*\* open/.test(remText)
  && /- \*\*Due:\*\* 2026-10-31/.test(remText) && /- \*\*Author:\*\* user \(Tell Alfred box\)/.test(remText) && remText.includes(words), remText);
chk('the new reminder shows up in the feed', assistantFeed(ROOT, NOW).upcoming.some((i) => i.title === 'Call the plumber'));
const cal = fs.readFileSync(path.join(ROOT, 'Calendar/events.md'), 'utf8');
chk('an event becomes a line in the shared calendar, added by the user', cal.includes('- 2026-10-27 15:00 Dentist @ Main St clinic (added by user)'), cal);
const inbox = res.saved.find((s) => s.type === 'inbox');
chk('anything else goes to Claude Code\'s inbox in the user\'s words', inbox && /--user--claude-code--capture--/.test(inbox.file)
  && fs.readFileSync(path.join(ROOT, inbox.file), 'utf8').includes(words), JSON.stringify(inbox));
chk('a past date, an unknown kind and an event with no date are refused and reported, not written',
  res.skipped.length === 3 && !fs.readdirSync(path.join(ROOT, 'Reminders')).some((f) => /back-dated|unknown-kind/.test(f)), JSON.stringify(res.skipped));
chk('the one-line reply is passed back', res.reply === 'Got it: plumber Saturday, dentist Tuesday at 3.');
const empty = applyPlan(ROOT, { reply: 'Hmm.', items: [{ type: 'reminder', kind: 'nope' }] }, 'do the thing', NOW);
chk('when nothing in the plan can be saved, the words still reach Claude Code\'s inbox', empty.saved.length === 1 && empty.saved[0].type === 'inbox');
const errand = applyPlan(ROOT, { items: [{ type: 'reminder', kind: 'errand', title: 'Buy milk', due: 'none' }] }, 'add milk to my errands', NOW);
chk('an errand with no date is due today and ends with the day', errand.saved[0]?.due === NOW.date
  && /- \*\*Until:\*\* end-of-day/.test(fs.readFileSync(path.join(ROOT, errand.saved[0].file), 'utf8')));

// --- Tell Grok: routines, edits and closes by number ---
console.log('\nTell Alfred: routines and edits');
const list = tellItemList(ROOT, NOW);
const plumberRef = list.refs.findIndex((r) => r.file === rem.file) + 1;
const pausedRef = list.refs.findIndex((r) => r.file === 'Routines/user-paused.md') + 1;
const milkRef = list.refs.findIndex((r) => r.file === errand.saved[0].file) + 1;
chk('the list numbers open reminders and the user\'s routines, paused ones included, never AI routines',
  plumberRef > 0 && pausedRef > 0 && milkRef > 0 && !list.refs.some((r) => /grok-brief/.test(r.file))
  && list.lines[plumberRef - 1].startsWith(`#${plumberRef} reminder · Call the plumber · due 2026-10-31`), list.lines.join(' | '));
const listed = tellPrompt('move the plumber to Friday', NOW, list);
chk('the prompt carries the numbered list and the edit, close and routine shapes', listed.includes(list.lines[0])
  && /"type":"edit","id"/.test(listed) && /"type":"close","id"/.test(listed) && /"type":"routine"/.test(listed));
const edits = applyPlan(ROOT, { reply: 'Done.', items: [
  { type: 'edit', id: plumberRef, set: { due: '2026-10-30', time: '16:00', file: '../../evil.md' } },
  { type: 'edit', id: pausedRef, set: { status: 'active' } },
  { type: 'close', id: milkRef },
  { type: 'routine', title: 'Water the plants', schedule: 'Sundays', time: '10:00' },
  { type: 'edit', id: 999, set: { title: 'x' } },
  { type: 'close', id: pausedRef },
  { type: 'routine', title: 'Sometimes', schedule: 'now and then' },
] }, 'move the plumber to Friday 4pm, restart my paused habit, milk is done, water plants Sundays at 10', NOW, list.refs);
chk('an edit by number moves the reminder and logs it as the user from the Tell Alfred box', /- \*\*Due:\*\* 2026-10-30 16:00/.test(fs.readFileSync(path.join(ROOT, rem.file), 'utf8'))
  && /Edited: .* by user \(Tell Alfred box\): due 2026-10-31 → 2026-10-30 16:00/.test(fs.readFileSync(path.join(ROOT, rem.file), 'utf8')));
chk('a field Grok should not set (a path) is ignored', !fs.existsSync(path.join(ROOT, '..', '..', 'evil.md')));
chk('an edit by number resumes a paused routine', /- \*\*Status:\*\* active/.test(fs.readFileSync(path.join(ROOT, 'Routines/user-paused.md'), 'utf8')));
chk('a close by number files the reminder in Done', !fs.existsSync(path.join(ROOT, errand.saved[0].file))
  && fs.existsSync(path.join(ROOT, 'Reminders', 'Done', path.basename(errand.saved[0].file))));
const plants = edits.saved.find((s) => s.type === 'routine' && !s.edit);
chk('a new routine from the box is the user\'s, with its day and time', plants && /- \*\*Schedule:\*\* Sundays 10:00/.test(fs.readFileSync(path.join(ROOT, plants.file), 'utf8'))
  && /- \*\*Runs:\*\* the user/.test(fs.readFileSync(path.join(ROOT, plants.file), 'utf8')));
chk('an unknown number and closing a routine are refused and reported', edits.skipped.length === 2
  && /no item #999/.test(edits.skipped[0].error) && /only a reminder can be closed/.test(edits.skipped[1].error), JSON.stringify(edits.skipped));
chk('only the first six items of a plan are taken', !fs.readdirSync(path.join(ROOT, 'Routines')).some((f) => /sometimes/.test(f)));
const odd = applyPlan(ROOT, { items: [{ type: 'routine', title: 'Sometimes', schedule: 'now and then' }] }, 'sometimes', NOW, list.refs);
chk('a routine whose schedule Alfred cannot read is refused, and the words go to Claude Code\'s inbox', /can't read the schedule/.test(odd.skipped[0]?.error)
  && odd.saved[0]?.type === 'inbox');
const feed2 = assistantFeed(ROOT, NOW);
chk('the feed lists paused routines apart and gives reminders their time', Array.isArray(feed2.routines.paused)
  && !feed2.routines.paused.some((r) => r.file === 'Routines/user-paused.md')
  && feed2.upcoming.find((i) => i.file === rem.file)?.time === '16:00', JSON.stringify(feed2.routines.paused));
chk('the feed gives a routine its time from the schedule', [...feed2.routines.today, ...feed2.routines.other].find((r) => r.file === plants?.file)?.time === '10:00');

// --- Weekly chores, the 7-day agenda and progress ---
console.log('\nWeekly chores and the week');
const chore = (title, schedule, status, weekOf, log) => `# Weekly chore: ${title}\n\n- **Kind:** routine\n- **Type:** habit\n- **Runs:** the user\n`
  + `- **Schedule:** ${schedule}\n- **Cadence:** weekly, Monday to Sunday\n- **Status:** ${status}\n- **Week of:** ${weekOf}\n- **Author:** grok\n`
  + `- **Last updated:** 2026-10-24 10:00 ET\n\nA weekly chore.\n\n## Weekly log\n${log}\n\n## Changes\n- (2026-10-23 22:45 ET) Added fields · via grok\n`;
put('Routines/weekly-laundry.md', chore('Fold the laundry', 'weekly, Tuesdays', 'open', '2026-10-26', '- 2026-10-26 week (Oct 26-Nov 1): open'));
put('Routines/weekly-dust.md', chore('Dusting', 'weekly (Monday to Sunday)', 'done', '2026-10-19', '- 2026-10-19 week (Oct 19-25): done\n  - Closed: 2026-10-24 16:57 ET by user (via grok)'));
put('Routines/weekly-trash.md', chore('Trash and recycling', 'weekly (Monday to Sunday)', 'open', '2026-10-19', '- 2026-10-19 week (Oct 19-25): open'));
const wk = assistantFeed(ROOT, NOW);
const byFile = (list, f) => list.find((c) => c.file === `Routines/${f}`);
chk('a weekly chore is found, with its day and this week\'s due date', byFile(wk.chores.all, 'weekly-laundry.md')?.day === 'tuesday'
  && byFile(wk.chores.all, 'weekly-laundry.md')?.due === '2026-10-27' && byFile(wk.chores.all, 'weekly-laundry.md')?.title === 'Fold the laundry',
  JSON.stringify(wk.chores.all));
chk('"Monday to Sunday" is not read as a Sunday chore', byFile(wk.chores.all, 'weekly-dust.md')?.day === null);
chk('a chore Grok hasn\'t opened for the new week counts as open, and a missed week shows',
  byFile(wk.chores.all, 'weekly-dust.md')?.done === false && byFile(wk.chores.all, 'weekly-dust.md')?.missedLastWeek === false
  && byFile(wk.chores.all, 'weekly-trash.md')?.missedLastWeek === true);
chk('chores are not listed again as plain routines', ![...wk.routines.today, ...wk.routines.other].some((r) => /weekly-/.test(r.file)));
chk('the week runs the next 7 days, a day chore on its day', wk.week.days.length === 7 && wk.week.from === '2026-10-27' && wk.week.to === '2026-11-02'
  && wk.week.days[0].chores.some((c) => c.file === 'Routines/weekly-laundry.md'));
chk('the week lists dated reminders and routines on their days', wk.week.days.find((d) => d.date === '2026-10-28')?.items.some((i) => i.title === 'Soon thing')
  && wk.week.days.find((d) => d.date === '2026-11-02')?.routines.some((r) => r.file === 'Routines/user-monday.md'), JSON.stringify(wk.week.days.map((d) => d.routines.length)));
chk('chores with no day are "anytime this week", by Sunday', wk.week.anytime.by === '2026-11-01'
  && wk.week.anytime.chores.map((c) => c.file).sort().join() === 'Routines/weekly-dust.md,Routines/weekly-trash.md');
chk('on a Monday nothing is late yet', !wk.chores.late.length && !wk.chores.due.length);
const total0 = wk.progress.total;
const trash = applyAction(ROOT, { file: 'Routines/weekly-trash.md', action: 'close', by: 'user' }, NOW);
const trashText = fs.readFileSync(path.join(ROOT, 'Routines/weekly-trash.md'), 'utf8');
chk('Done on a chore opens the new week and marks it done', trash.status === 200 && /- \*\*Status:\*\* done/.test(trashText)
  && /- \*\*Week of:\*\* 2026-10-26/.test(trashText) && /^- 2026-10-26 week \(Oct 26-Nov 1\): done\n {2}- Closed: 2026-10-26 09:00 ET by user \(Alfred dashboard\)/m.test(trashText),
  trashText);
chk('the missed week stays on the log as not done', /^- 2026-10-19 week \(Oct 19-25\): not done$/m.test(trashText)
  && /- Edited: 2026-10-26 09:00 ET by user \(Alfred dashboard\): done for the week of 2026-10-26/.test(trashText));
chk('the new week\'s line goes in the log, not in Changes', trashText.indexOf('2026-10-26 week') < trashText.indexOf('## Changes'));
const lau = applyAction(ROOT, { file: 'Routines/weekly-laundry.md', action: 'close', by: 'user' }, NOW);
const lauText = fs.readFileSync(path.join(ROOT, 'Routines/weekly-laundry.md'), 'utf8');
chk('Done on a chore already on this week marks its line done', lau.status === 200 && /^- 2026-10-26 week \(Oct 26-Nov 1\): done\n {2}- Closed: /m.test(lauText)
  && (lauText.match(/2026-10-26 week/g) || []).length === 1, lauText);
chk('a chore done this week can\'t be closed again, or moved', applyAction(ROOT, { file: 'Routines/weekly-laundry.md', action: 'close' }, NOW).status === 400
  && applyAction(ROOT, { file: 'Routines/weekly-dust.md', action: 'tomorrow' }, NOW).status === 400
  && applyAction(ROOT, { file: 'Routines/user-monday.md', action: 'close' }, NOW).status === 400);
const wk2 = assistantFeed(ROOT, NOW);
chk('chores done today count toward the day\'s progress', wk2.chores.done.length === 2 && wk2.progress.done === wk.progress.done + 2
  && wk2.progress.total === total0 + 2, JSON.stringify([wk.progress, wk2.progress]));
chk('a chore done this week leaves the week\'s list', !wk2.week.days[0].chores.length
  && wk2.week.anytime.chores.map((c) => c.file).join() === 'Routines/weekly-dust.md');

// --- Needs you ---
console.log('\nNeeds you');
const NEST = path.join(os.tmpdir(), `assistant-needs-${process.pid}`);
const NB = path.join(NEST, 'Second Brain');
fs.rmSync(NEST, { recursive: true, force: true });
fs.mkdirSync(path.join(NB, 'Inbox'), { recursive: true });
fs.writeFileSync(path.join(NEST, 'handoff-claude-to-grok.md'), "# Claude → Grok handoff file\n\n## Done or answered (Grok's asks)\n\n"
  + '### G-2026-10-25-2100 · Change the master rules\n- **Status:** needs-the-user (waits for the user at the desk)\n\n'
  + '### G-2026-10-25-2101 · Add milk\n- **Status:** done\n\n## Asks for Grok\n', 'utf8');
fs.writeFileSync(path.join(NB, 'Inbox', '2026-10-25-2000--grok--librarian--amend--bad-date.md'),
  '# Amend: bad date\n\n- **Kind:** signal\n- **Type:** amend\n- **From:** grok\n- **To:** librarian\n- **Status:** needs a look (past date)\n- **Created:** 2026-10-25 20:00 ET\n', 'utf8');
fs.writeFileSync(path.join(NB, 'Inbox', '2026-10-25-2001--grok--user--question--which-day.md'),
  '# Question: which day?\n\n- **Kind:** signal\n- **Type:** question\n- **From:** grok\n- **To:** user\n- **Status:** open\n- **Created:** 2026-10-25 20:01 ET\n', 'utf8');
fs.writeFileSync(path.join(NB, 'Inbox', '2026-10-25-2002--grok--claude--fyi--between-ais.md'),
  '# Fyi\n\n- **Kind:** signal\n- **Type:** fyi\n- **From:** grok\n- **To:** claude\n- **Status:** open\n- **Created:** 2026-10-25 20:02 ET\n', 'utf8');
const ny = assistantFeed(NB, NOW).needsYou;
chk('a Grok ask left for the user shows, with why', ny.some((n) => n.kind === 'grok ask' && n.title === 'Change the master rules' && n.why === 'waits for the user at the desk'),
  JSON.stringify(ny));
chk('a refused change note and a signal to the user show', ny.some((n) => n.kind === 'refused note') && ny.some((n) => n.kind === 'signal' && /which day/i.test(n.title)));
chk('done asks and signals between AIs do not', ny.length === 3);
fs.rmSync(NEST, { recursive: true, force: true });

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
