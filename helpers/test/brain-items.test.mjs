#!/usr/bin/env node
// --- brain-items.test.mjs ----------------------------------------------------
// Builds a throwaway brain and checks the one writer for the user's own items:
// schedules (daily, weekly, weekdays, monthly), adding and editing reminders,
// routines and calendar events, and every refusal the editor relies on.
//
//   node ~/.claude/helpers/test/brain-items.test.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createEvent, createReminder, createRoutine, isDay, routineDueToday, updateReminder, updateRoutine,
} from '../brain-items.mjs';
import { easternNow, readFields } from '../brain-librarian.mjs';
import { parseEvents } from '../brain-calendar.mjs';

const ROOT = path.join(os.tmpdir(), `items-test-${process.pid}`);
const NOW = easternNow(new Date('2026-10-26T13:00:00Z')); // Monday 09:00 ET
const LATER = easternNow(new Date('2026-10-27T14:30:00Z')); // Tuesday 10:30 ET

let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const refuses = (name, fn, re) => {
  try { fn(); chk(name, false, 'no error'); } catch (err) { chk(name, err.status === 400 && re.test(err.message), err.message); }
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
};
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

// --- Schedules ---
console.log('Schedules');
chk('daily and weekdays fall on a Monday', routineDueToday('daily 07:00', '2026-10-26') && routineDueToday('weekdays', '2026-10-26'));
chk('weekends and Tuesdays do not fall on a Monday', routineDueToday('weekends', '2026-10-26') === false
  && routineDueToday('Tuesdays', '2026-10-26') === false);
chk('"Mondays and Thursdays" falls on both days', routineDueToday('Mondays and Thursdays', '2026-10-26')
  && routineDueToday('Mondays and Thursdays', '2026-10-29') && !routineDueToday('Mondays and Thursdays', '2026-10-27'));
chk('"monthly on the 15th" falls on the 15th only', routineDueToday('monthly on the 15th', '2026-11-15')
  && routineDueToday('monthly on the 15th', '2026-11-14') === false);
chk('"monthly on the 31st" falls on the last day of a short month', routineDueToday('monthly on the 31st', '2026-11-30')
  && routineDueToday('monthly on the 31st', '2026-10-31') && !routineDueToday('monthly on the 31st', '2026-10-30'));
chk('a schedule with no fixed day reads as null', routineDueToday('now and then', '2026-10-26') === null
  && routineDueToday('monthly', '2026-10-26') === null);
chk('isDay refuses a day that does not exist', isDay('2026-10-26') && !isDay('2026-11-31') && !isDay('2026-13-01') && !isDay('soon'));

// --- Reminders: add ---
console.log('\nReminders: add');
const todo = createReminder(ROOT, { kind: 'todo', title: 'Book the dentist', due: 'none', scope: 'personal', note: 'Ask about Saturdays' }, { now: NOW });
const todoText = read(todo.file);
const th = readFields(todoText);
chk('a to-do is written to Reminders/ with the header fields', /^Reminders\/2026-10-26--book-the-dentist\.md$/.test(todo.file)
  && th.kind === 'todo' && th.status === 'open' && th.due === 'none' && th.until === 'done', JSON.stringify(th));
chk('the author is the dashboard and the note is kept', /user \(Alfred dashboard\)/.test(th.author) && todoText.includes('Ask about Saturdays'));
const rem = createReminder(ROOT, { kind: 'reminder', title: 'Call the plumber', due: '2026-10-31', time: '15:30' }, { now: NOW });
chk('a reminder keeps its date and time in Due', readFields(read(rem.file)).due === '2026-10-31 15:30' && rem.time === '15:30');
const errand = createReminder(ROOT, { kind: 'errand', title: 'Buy milk' }, { now: NOW });
chk('an errand with no date is due today and ends with the day', errand.due === NOW.date
  && readFields(read(errand.file)).until === 'end-of-day');
const twin = createReminder(ROOT, { kind: 'todo', title: 'Book the dentist' }, { now: NOW });
chk('a second item with the same title gets its own file', twin.file !== todo.file && fs.existsSync(path.join(ROOT, twin.file)));
const words = createReminder(ROOT, { kind: 'watch', title: 'Van quote' }, { now: NOW, words: 'keep an eye on the van quote', author: 'grok' });
chk('the user\'s words and another author are recorded', read(words.file).includes('keep an eye on the van quote')
  && readFields(read(words.file)).author === 'grok');
refuses('a reminder with no date is refused', () => createReminder(ROOT, { kind: 'reminder', title: 'X', due: 'none' }, { now: NOW }), /needs a date/);
refuses('a past date is refused', () => createReminder(ROOT, { kind: 'todo', title: 'X', due: '2026-10-01' }, { now: NOW }), /in the past/);
refuses('a date that does not exist is refused', () => createReminder(ROOT, { kind: 'todo', title: 'X', due: '2026-11-31' }, { now: NOW }), /not a date/);
refuses('an unknown kind is refused', () => createReminder(ROOT, { kind: 'chore', title: 'X' }, { now: NOW }), /unknown kind/);
refuses('an empty title is refused', () => createReminder(ROOT, { kind: 'todo', title: '   ' }, { now: NOW }), /title/);

// --- Reminders: edit ---
console.log('\nReminders: edit');
const e1 = updateReminder(ROOT, todo.file, { title: 'Book the dentist for a cleaning', due: '2026-10-30', time: '09:00' }, { now: LATER });
const e1Text = read(todo.file);
chk('title, date and time change in place', /^# Book the dentist for a cleaning$/m.test(e1Text)
  && readFields(e1Text).due === '2026-10-30 09:00' && fs.existsSync(path.join(ROOT, todo.file)), e1Text);
chk('the edit is stamped and logged with who changed what', readFields(e1Text)['last updated'] === LATER.stamp
  && /- Edited: 2026-10-27 10:30 ET by user \(Alfred dashboard\): title → .*due none → 2026-10-30 09:00/.test(e1Text), e1Text);
chk('the result lists the changes', e1.changed.length === 2, JSON.stringify(e1));
updateReminder(ROOT, todo.file, { kind: 'errand' }, { now: LATER });
chk('changing to an errand sets it to end with the day', readFields(read(todo.file)).until === 'end-of-day'
  && readFields(read(todo.file)).kind === 'errand');
updateReminder(ROOT, todo.file, { kind: 'todo', due: 'none' }, { now: LATER });
const backTodo = readFields(read(todo.file));
chk('changing back to an undated to-do clears the date and the end-of-day', backTodo.kind === 'todo' && backTodo.due === 'none'
  && backTodo.until === 'done', JSON.stringify(backTodo));
updateReminder(ROOT, rem.file, { note: 'He said after 3' }, { now: LATER });
chk('a note is appended with its date, nothing replaced', read(rem.file).includes('- (2026-10-27) He said after 3')
  && readFields(read(rem.file)).due === '2026-10-31 15:30');
updateReminder(ROOT, rem.file, { time: null }, { now: LATER });
chk('clearing the time keeps the date', readFields(read(rem.file)).due === '2026-10-31');
put('Reminders/2026-10-20--overdue.md', '# Old thing\n\n- **Kind:** reminder\n- **Status:** open\n- **Due:** 2026-10-20\n- **Author:** grok\n- **Last updated:** x\n');
updateReminder(ROOT, 'Reminders/2026-10-20--overdue.md', { title: 'Old thing, renamed', due: '2026-10-20' }, { now: LATER });
chk('an overdue item can be renamed without moving its date', /^# Old thing, renamed$/m.test(read('Reminders/2026-10-20--overdue.md'))
  && readFields(read('Reminders/2026-10-20--overdue.md')).due === '2026-10-20');
put('Reminders/2026-10-21--snoozed.md', '# Snoozed\n\n- **Kind:** todo\n- **Status:** snoozed\n- **Due:** 2026-10-28\n- **Author:** grok\n');
updateReminder(ROOT, 'Reminders/2026-10-21--snoozed.md', { due: '2026-10-29' }, { now: LATER });
chk('a new date reopens a snoozed item', readFields(read('Reminders/2026-10-21--snoozed.md')).status === 'open');
refuses('an edit that changes nothing is refused', () => updateReminder(ROOT, rem.file, {}, { now: LATER }), /nothing to change/);
refuses('moving to a past date is refused', () => updateReminder(ROOT, rem.file, { due: '2026-10-01' }, { now: LATER }), /in the past/);
refuses('a path outside Reminders/ is refused', () => updateReminder(ROOT, '../secrets.md', { title: 'x' }, { now: LATER }), /expected a file/);
refuses('a closed item in Reminders/Done is refused', () => updateReminder(ROOT, 'Reminders/Done/x.md', { title: 'x' }, { now: LATER }), /expected a file/);
refuses('the folder README is refused', () => updateReminder(ROOT, 'Reminders/README.md', { title: 'x' }, { now: LATER }), /expected a file/);
refuses('a missing file is reported', () => updateReminder(ROOT, 'Reminders/nope.md', { title: 'x' }, { now: LATER }), /not there/);

// --- Routines ---
console.log('\nRoutines');
const walk = createRoutine(ROOT, { title: 'Evening walk', schedule: 'daily', time: '19:00', note: 'Around the block' }, { now: NOW });
const wt = read(walk.file);
const wh = readFields(wt);
chk('a routine is written as the user\'s own, active, with its schedule and time', walk.file === 'Routines/user-evening-walk.md'
  && /^# The user: Evening walk$/m.test(wt) && wh.runs === 'the user' && wh.status === 'active' && wh.schedule === 'daily 19:00', wt);
chk('the routine says what it is', /## What it is\nAround the block/.test(wt));
const bins = createRoutine(ROOT, { title: 'Bins out', schedule: 'Mondays and Thursdays' }, { now: NOW });
const rent = createRoutine(ROOT, { title: 'Pay the sitter', schedule: 'monthly on the 1st' }, { now: NOW });
chk('weekly and monthly routines are accepted', readFields(read(bins.file)).schedule === 'Mondays and Thursdays'
  && readFields(read(rent.file)).schedule === 'monthly on the 1st');
refuses('a schedule Alfred cannot read is refused with the help text', () => createRoutine(ROOT, { title: 'X', schedule: 'now and then' }, { now: NOW }),
  /can't read the schedule.*monthly on the 15th/);
refuses('a routine with no schedule is refused', () => createRoutine(ROOT, { title: 'X', schedule: '' }, { now: NOW }), /schedule is needed/);
updateRoutine(ROOT, walk.file, { schedule: 'weekdays' }, { now: LATER });
chk('changing the schedule keeps the time', readFields(read(walk.file)).schedule === 'weekdays 19:00', readFields(read(walk.file)).schedule);
updateRoutine(ROOT, walk.file, { time: '18:30' }, { now: LATER });
chk('changing only the time keeps the days', readFields(read(walk.file)).schedule === 'weekdays 18:30');
updateRoutine(ROOT, walk.file, { status: 'paused' }, { now: LATER });
chk('pausing records since when', readFields(read(walk.file)).status === 'paused (since 2026-10-27)' && /: paused$/m.test(read(walk.file)));
updateRoutine(ROOT, walk.file, { status: 'active', title: 'Evening stroll' }, { now: LATER });
const resumed = read(walk.file);
chk('resuming and renaming work, the "The user:" title prefix stays', readFields(resumed).status === 'active'
  && /^# The user: Evening stroll$/m.test(resumed) && /resumed/.test(resumed));
put('Routines/grok-sync.md', '# Grok: sync\n\n- **Kind:** routine\n- **Runs:** grok\n- **Schedule:** daily\n- **Status:** active\n');
refuses('an AI\'s own routine cannot be changed from here', () => updateRoutine(ROOT, 'Routines/grok-sync.md', { status: 'paused' }, { now: LATER }),
  /only your own routines/);
refuses('an unknown status is refused', () => updateRoutine(ROOT, bins.file, { status: 'gone' }, { now: LATER }), /active or paused/);
refuses('a routine edit that changes nothing is refused', () => updateRoutine(ROOT, bins.file, { status: 'active' }, { now: LATER }), /nothing to change/);

// --- Events ---
console.log('\nEvents');
const ev = createEvent(ROOT, { title: 'Dinner with S.', date: '2026-10-31', time: '19:00', endTime: '21:00', location: 'Home' }, { now: NOW });
const cal = read('Calendar/events.md');
const parsed = parseEvents(cal);
chk('an event becomes one line in Calendar/events.md under its month', /## 2026-10/.test(cal)
  && cal.includes('- 2026-10-31 19:00-21:00 Dinner with S. @ Home (added by user)'), cal);
chk('the calendar file still parses cleanly', parsed.events.length === 1 && parsed.problems.length === 0, JSON.stringify(parsed.problems));
createEvent(ROOT, { title: 'Trip', date: '2026-11-20', end: '2026-11-23' }, { now: NOW, by: 'grok' });
chk('a multi-day event is written with its range and author', read('Calendar/events.md').includes('- 2026-11-20..2026-11-23 Trip (added by grok)'));
chk('a stray "@" in a title cannot fake a place', createEvent(ROOT, { title: 'Lunch @ noon', date: '2026-11-02' }, { now: NOW }).title === 'Lunch at noon');
refuses('an event with no date is refused', () => createEvent(ROOT, { title: 'X' }, { now: NOW }), /not a date/);
refuses('a past event is refused', () => createEvent(ROOT, { title: 'X', date: '2026-10-01' }, { now: NOW }), /in the past/);
refuses('an end date before the start is refused', () => createEvent(ROOT, { title: 'X', date: '2026-11-05', end: '2026-11-04' }, { now: NOW }), /before the start/);
refuses('an end time before the start time is refused', () => createEvent(ROOT, { title: 'X', date: '2026-11-05', time: '10:00', endTime: '09:00' }, { now: NOW }),
  /end time/);

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
