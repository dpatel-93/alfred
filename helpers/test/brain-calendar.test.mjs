#!/usr/bin/env node
// --- brain-calendar.test.mjs -------------------------------------------------
// The shared calendar file (Calendar/events.md): parsing, the month view the
// dashboard draws, the window used by the index, and adding events in order.
// Runs against a throwaway brain with a fixed clock.
//
//   node ~/.claude/helpers/test/brain-calendar.test.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CALENDAR_FILE, addEvent, calendarView, eventsBetween, parseEvents, readCalendar } from '../brain-calendar.mjs';
import { easternNow } from '../brain-librarian.mjs';

const ROOT = path.join(os.tmpdir(), `calendar-test-${process.pid}`);
const NOW = easternNow(new Date('2026-10-26T13:00:00Z')); // Monday 09:00 ET

let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const file = path.join(ROOT, CALENDAR_FILE);
const read = () => fs.readFileSync(file, 'utf8');

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

// --- Parsing ---
console.log('Parsing');
const sample = [
  '# Calendar', '',
  '- **Kind:** calendar',
  '- **Last updated:** 2026-10-25 10:00 ET', '',
  'Format: `- YYYY-MM-DD [HH:MM[-HH:MM]] Title [@ place] (added by <ai>)`', '',
  '```',
  '- 2026-01-01 An example inside a fence (added by nobody)',
  '```', '',
  '## 2026-10 (October 2026)', '',
  '- 2026-10-26 9:30-10:00 Dentist @ Main St clinic (added by grok)',
  '- 2026-10-26 School picture day (added by claude-code)',
  '- 2026-10-31..2026-11-02 Cabin weekend @ the lake (added by Grok)',
  '- ~~2026-10-27 Cancelled lunch~~ (cancelled by user via claude-code)',
  '- 2026-10-28 25:00 Broken time (added by grok)',
  '- 2026-13-01 Broken date',
  '- 2026-10-29 Plain event with no author', '',
  '## 2026-12 (December 2026)', '',
  '- 2026-12-24 Family dinner (added by grok)',
].join('\n');
const { events, problems } = parseEvents(sample);
const dentist = events.find((e) => e.title === 'Dentist');
chk('a timed event keeps its time, end time, place and author', !!dentist && dentist.date === '2026-10-26' && dentist.time === '09:30'
  && dentist.endTime === '10:00' && dentist.location === 'Main St clinic' && dentist.by === 'grok' && dentist.allDay === false, JSON.stringify(dentist));
const picture = events.find((e) => e.title === 'School picture day');
chk('an event with no time is all day', !!picture && picture.allDay && picture.time === null && picture.by === 'claude-code', JSON.stringify(picture));
const cabin = events.find((e) => e.title === 'Cabin weekend');
chk('a multi-day event keeps its end date; the author is lower-cased', !!cabin && cabin.end === '2026-11-02' && cabin.by === 'grok' && cabin.location === 'the lake', JSON.stringify(cabin));
chk('a struck-through (cancelled) event is not an event', !events.some((e) => /Cancelled lunch/.test(e.title)));
chk('example lines inside a code fence are ignored', !events.some((e) => /example inside a fence/.test(e.title)));
chk('an event with no author still reads', events.some((e) => e.title === 'Plain event with no author' && e.by === null));
chk('a bad time and a bad date are reported as problems with their line numbers, not dropped silently',
  problems.length === 2 && problems.every((p) => p.line > 0) && /25:00/.test(problems[0].text) && /2026-13-01/.test(problems[1].text), JSON.stringify(problems));
chk('each event carries its line number in the file', dentist && sample.split('\n')[dentist.line - 1].includes('Dentist'));

// --- Month view ---
console.log('\nMonth view');
chk('no file yet: the view says so, with no days and no problems', (() => {
  const v = calendarView(ROOT, NOW);
  return v.exists === false && v.count === 0 && Object.keys(v.days).length === 0 && v.file === CALENDAR_FILE;
})());
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, sample, 'utf8');
const v = calendarView(ROOT, NOW);
chk('the window runs from the 1st of last month to the last day of next month', v.from === '2026-09-01' && v.to === '2026-11-30', `${v.from}..${v.to}`);
chk('events outside the window are left out (December)', !Object.values(v.days).flat().some((e) => e.title === 'Family dinner'));
chk('a day lists its events, timed after all-day', JSON.stringify((v.days['2026-10-26'] || []).map((e) => e.title)) === '["School picture day","Dentist"]',
  JSON.stringify(v.days['2026-10-26']));
chk('a multi-day event sits on every day it covers, marked start and end', ['2026-10-31', '2026-11-01', '2026-11-02'].every((d) => (v.days[d] || []).some((e) => e.title === 'Cabin weekend'))
  && v.days['2026-10-31'].find((e) => e.title === 'Cabin weekend').spanStart === true && v.days['2026-11-02'].find((e) => e.title === 'Cabin weekend').spanEnd === true);
chk('count is events, not event-days', v.count === 4, String(v.count));
chk('problems reach the view so the dashboard can show them', v.problems.length === 2);
chk('the view says where it came from', v.source === 'file' && v.exists === true);

// --- The index window ---
console.log('\nIndex window');
const week = eventsBetween(ROOT, NOW.date, '2026-11-02');
chk('the next 7 days include an event that started before the window ends', JSON.stringify(week.map((e) => e.title))
  === '["School picture day","Dentist","Plain event with no author","Cabin weekend"]', JSON.stringify(week.map((e) => e.title)));

// --- Adding ---
console.log('\nAdding');
fs.rmSync(path.dirname(file), { recursive: true, force: true });
const l1 = addEvent(ROOT, { date: '2026-11-05', title: 'Parent-teacher night', time: '18:00', endTime: '19:30', location: 'school', by: 'claude-code' }, NOW);
chk('adding to a brain with no file creates it with the header and the month', fs.existsSync(file) && /^# Calendar/.test(read()) && /## 2026-11 \(November 2026\)/.test(read())
  && read().includes('- **Kind:** calendar'), read().slice(0, 300));
chk('the written line uses the documented format', l1 === '- 2026-11-05 18:00-19:30 Parent-teacher night @ school (added by claude-code)', l1);
addEvent(ROOT, { date: '2026-11-03', title: 'Vote', by: 'grok' }, NOW);
addEvent(ROOT, { date: '2026-11-05', time: '08:00', title: 'Breakfast meeting', by: 'grok' }, NOW);
addEvent(ROOT, { date: '2026-10-30', title: 'Halloween party', by: 'grok' }, NOW);
addEvent(ROOT, { date: '2026-12-01', end: '2026-12-03', title: 'Conference', by: 'claude-code' }, NOW);
const order = readCalendar(ROOT).events.map((e) => `${e.date} ${e.title}`);
chk('events stay in date and time order, months in order', JSON.stringify(order) === JSON.stringify([
  '2026-10-30 Halloween party', '2026-11-03 Vote', '2026-11-05 Breakfast meeting', '2026-11-05 Parent-teacher night', '2026-12-01 Conference',
]), JSON.stringify(order));
const headings = read().split('\n').filter((l) => l.startsWith('## '));
chk('one heading per month, in order', JSON.stringify(headings) === JSON.stringify(['## 2026-10 (October 2026)', '## 2026-11 (November 2026)', '## 2026-12 (December 2026)']), JSON.stringify(headings));
chk('Last updated is stamped', read().includes(`- **Last updated:** ${NOW.stamp}`));
chk('what was added reads back with no problems', readCalendar(ROOT).problems.length === 0);
let threw = false;
try { addEvent(ROOT, { date: '2026-11-31', title: 'Not a day' }, NOW); } catch { threw = true; }
chk('a date that does not exist is refused', threw);

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
