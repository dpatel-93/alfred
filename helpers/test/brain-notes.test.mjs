#!/usr/bin/env node
// --- brain-notes.test.mjs ----------------------------------------------------
// Builds a throwaway brain and checks Grok's change notes end to end: reading
// them, the Librarian applying them "as of" when they were written, a later
// desk change winning, refusals left for a person, every view showing a
// waiting note as already applied, and the recent-changes list Grok reads.
//
//   node ~/.claude/helpers/test/brain-notes.test.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { easternNow, readFields } from '../brain-core.mjs';
import { collectOpenItems, runLibrarian, upcomingEvents } from '../brain-librarian.mjs';
import { openNotes, parseNote, pendingChanges, recentChanges } from '../brain-notes.mjs';
import { assistantFeed } from '../brain-assistant.mjs';
import { calendarView, readCalendar } from '../brain-calendar.mjs';

const ROOT = path.join(os.tmpdir(), `notes-test-${process.pid}`);
const NOW = easternNow(new Date('2026-10-26T14:00:00Z')); // Monday 10:00 ET

let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
};
const read = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const reminder = (title, kind, due, lu = '2026-10-20 09:00 ET') =>
  `# ${title}\n\n- **Kind:** ${kind}\n- **Status:** open\n- **Due:** ${due}\n- **Until:** done\n- **Scope:** personal\n- **Author:** Claude Code\n- **Last updated:** ${lu}\n`;
const note = (type, target, created, extra = '', from = 'grok') =>
  `# ${type}\n\n- **Kind:** signal\n- **Type:** ${type}\n- **From:** ${from}\n- **To:** librarian\n- **Target:** ${target}\n- **Re:** from the car\n- **Status:** open\n- **Created:** ${created}\n${extra}`;
const REPLACED = '# Grok: errands read-out\n\n- **Kind:** routine\n- **Type:** ai\n- **Runs:** Grok\n- **Schedule:** at wake; in the morning brief\n- **Status:** active\n- **Last updated:** 2026-10-26 08:31 ET\n\n## What it does\nReads errands at wake. No hourly nudge.\n';

// --- Fixture ---
fs.rmSync(ROOT, { recursive: true, force: true });
put('Reminders/2026-10-21--dentist.md', reminder('Book the dentist', 'todo', 'none'));
put('Reminders/2026-10-25--plumber.md', reminder('Call the plumber', 'reminder', '2026-10-27'));
put('Reminders/2026-10-22--milk.md', reminder('Buy milk', 'errand', '2026-10-26'));
put('Reminders/2026-10-23--desk-wins.md', reminder('Desk wins', 'reminder', '2026-10-30', '2026-10-26 08:50 ET'));
put('Reminders/2026-10-23--past.md', reminder('Past refusal', 'reminder', '2026-10-30'));
put('Reminders/Done/2026-10-24--gutters.md', reminder('Clean the gutters', 'todo', 'none').replace('**Status:** open', '**Status:** done'));
put('Routines/user-walk.md', '# The user: Evening walk\n\n- **Kind:** routine\n- **Runs:** the user\n- **Schedule:** daily 19:00\n- **Status:** active\n- **Last updated:** 2026-10-20 09:00 ET\n');
put('Routines/grok-errands.md', '# Grok: errands\n\n- **Kind:** routine\n- **Runs:** Grok\n- **Schedule:** hourly 11:00-23:59\n- **Status:** active\n- **Author:** Claude Code\n- **Last updated:** 2026-10-23 17:50 ET\n\nOld text.\n');
put('Routines/gemini-scan.md', '# Gemini: scan\n\n- **Kind:** routine\n- **Runs:** Gemini\n- **Schedule:** daily\n- **Status:** active\n');
put('Calendar/events.md', '# Calendar\n\n- **Kind:** calendar\n- **Last updated:** 2026-10-20 09:00 ET\n\n## 2026-10 (October 2026)\n\n- 2026-10-31 19:00 Dinner with S. @ Home (added by claude-code)\n');
put('MANIFESTO.md', '# Manifesto\n\nLocked.\n');

put('Inbox/2026-10-26-0800--grok--librarian--amend--move-dentist.md', note('amend', 'Reminders/2026-10-21--dentist.md', '2026-10-26 08:00 ET',
  '- **Set:** Due = 2026-10-30 15:00\n- **Set:** Title = Dentist cleaning\n\nThe user asked for Friday at 3.\n'));
put('Inbox/2026-10-26-0805--grok--librarian--close--milk.md', note('close', 'Reminders/2026-10-22--milk.md', '2026-10-26 08:05 ET'));
put('Inbox/2026-10-26-0810--grok--librarian--amend--reopen-gutters.md', note('amend', 'Reminders/Done/2026-10-24--gutters.md', '2026-10-26 08:10 ET',
  'Reopen it: replace `- **Status:** done` with `- **Status:** open`.\n'));
put('Inbox/2026-10-26-0815--grok--librarian--amend--desk-wins.md', note('amend', 'Reminders/2026-10-23--desk-wins.md', '2026-10-26 08:15 ET', '- **Set:** Due = 2026-11-05\n'));
put('Inbox/2026-10-26-0820--grok--librarian--amend--past.md', note('amend', 'Reminders/2026-10-23--past.md', '2026-10-26 08:20 ET', '- **Set:** Due = 2026-10-01\n'));
put('Inbox/2026-10-26-0825--grok--librarian--amend--pause-walk.md', note('amend', 'Routines/user-walk.md', '2026-10-26 08:25 ET', '- **Set:** Status = paused\n'));
put('Inbox/2026-10-26-0830--grok--librarian--amend--errands.md', note('amend', 'Routines/grok-errands.md', '2026-10-26 08:30 ET',
  `\nReplace the entire content with:\n\n=====\n${REPLACED}=====\n`));
put('Inbox/2026-10-26-0835--grok--librarian--amend--gemini.md', note('amend', 'Routines/gemini-scan.md', '2026-10-26 08:35 ET', '- **Set:** Status = paused\n'));
put('Inbox/2026-10-26-0840--grok--librarian--amend--manifesto.md', note('amend', 'MANIFESTO.md', '2026-10-26 08:40 ET',
  `\n=====\n# Manifesto\n\nGrok rewrote this whole file, which must never happen.\n=====\n`));
put('Inbox/2026-10-26-0845--grok--librarian--amend--calendar.md', note('amend', 'Calendar/events.md', '2026-10-26 08:45 ET',
  '- **Add:** 2026-11-02 18:00-19:00 Parent-teacher night @ School\n- **Cancel:** 2026-10-31 Dinner with S.\n'));
put('Inbox/2026-10-26-0850--grok--librarian--capture--ignite.md', note('capture', 'Calendar/events.md', '2026-10-26 08:50 ET',
  '\nPlease add this line:\n\n- 2026-11-17..2026-11-20 Microsoft Ignite @ San Francisco (added by grok)\n'));
put('Inbox/2026-10-26-0855--grok--claude--amend--topic.md', note('amend', 'Memory/topics/home.md', '2026-10-26 08:55 ET', '\nAdd a line about the boiler.\n'));
// Shapes seen from Grok's bots on 2026-10-24: a close note that files another signal, and a
// whole-file replacement between HTML comment markers, both signed "grok (<bot name>)".
put('Inbox/2026-10-25-2100--user--grok--handoff--old-ask.md', '# Handoff: old ask\n\n- **Kind:** signal\n- **Type:** handoff\n- **From:** user\n- **To:** grok\n- **Status:** open\n- **Created:** 2026-10-25 21:00 ET\n\nDone already.\n');
put('Inbox/2026-10-26-0900--grok--librarian--close--file-old-ask.md', note('close', 'Inbox/2026-10-25-2100--user--grok--handoff--old-ask.md', '2026-10-26 09:00 ET', '', 'grok (Grok Bot)'));
put('Outputs/news/cloud/2026-10-26-brief.md', '# Brief\n\nPlaceholder.\n');
put('Inbox/2026-10-26-0905--grok--all--amend--brief.md', note('amend', 'Outputs/news/cloud/2026-10-26-brief.md', '2026-10-26 09:05 ET',
  '\nReplace its whole content with:\n\n<!-- BEGIN REPLACEMENT -->\n# Cloud brief, Monday\n\nThree verified stories, with sources, written by the cloud bot.\n<!-- END REPLACEMENT -->\n', 'grok (Cloud Engineering Bot)'));

// --- Reading ---
console.log('Reading');
const parsed = parseNote('x.md', read('Inbox/2026-10-26-0800--grok--librarian--amend--move-dentist.md'));
chk('Set lines, the target and the time it was written are read', parsed.target === 'Reminders/2026-10-21--dentist.md'
  && parsed.set.due === '2026-10-30 15:00' && parsed.set.title === 'Dentist cleaning' && parsed.created === '2026-10-26 08:00 ET' && parsed.actionable, JSON.stringify(parsed));
const cal = parseNote('c.md', read('Inbox/2026-10-26-0845--grok--librarian--amend--calendar.md'));
chk('Add and Cancel lines are read as calendar changes', cal.add.length === 1 && cal.add[0].title === 'Parent-teacher night' && cal.add[0].time === '18:00'
  && cal.cancel[0]?.date === '2026-10-31' && cal.cancel[0]?.title === 'Dinner with S.', JSON.stringify(cal));
chk('a calendar capture\'s plain event line is read too', parseNote('i.md', read('Inbox/2026-10-26-0850--grok--librarian--capture--ignite.md')).add[0]?.end === '2026-11-20');
chk('a "=====" block is read as a whole-file replacement', parseNote('e.md', read('Inbox/2026-10-26-0830--grok--librarian--amend--errands.md')).replace === REPLACED);
chk('a note with no structured change is not actionable', !parseNote('t.md', read('Inbox/2026-10-26-0855--grok--claude--amend--topic.md')).actionable);

// --- Shown as applied before the Librarian runs ---
console.log('\nShown as applied while waiting');
const open = collectOpenItems(ROOT, NOW);
const dentist = open.all.find((i) => i.file === 'Reminders/2026-10-21--dentist.md');
chk('a waiting date change shows the new date, time and title', dentist?.due === '2026-10-30' && dentist?.time === '15:00' && dentist?.title === 'Dentist cleaning', JSON.stringify(dentist));
chk('a waiting close hides the item', !open.all.some((i) => i.file === 'Reminders/2026-10-22--milk.md'));
chk('a note overtaken by a later desk change is not shown', open.all.find((i) => i.file === 'Reminders/2026-10-23--desk-wins.md')?.due === '2026-10-30');
const feed = assistantFeed(ROOT, NOW);
chk('a waiting pause shows the routine as paused', feed.routines.paused.some((r) => r.file === 'Routines/user-walk.md'));
const view = calendarView(ROOT, NOW, { pending: pendingChanges(ROOT).calendar });
chk('a waiting calendar add is drawn, and a waiting cancel hides its event', (view.days['2026-11-02'] || []).some((e) => e.title === 'Parent-teacher night' && e.pending)
  && !(view.days['2026-10-31'] || []).some((e) => e.title === 'Dinner with S.'), JSON.stringify(view.days['2026-10-31']));
chk('the index\'s next 7 days include waiting calendar changes', upcomingEvents(ROOT, NOW).some((e) => e.title === 'Parent-teacher night')
  && !upcomingEvents(ROOT, NOW).some((e) => e.title === 'Dinner with S.'));

// --- Dry run writes nothing ---
console.log('\nApplying');
const before = read('Reminders/2026-10-21--dentist.md');
runLibrarian(ROOT, { dryRun: true, now: NOW });
chk('a dry run changes nothing', read('Reminders/2026-10-21--dentist.md') === before && openNotes(ROOT).length === 14);
chk('a bot\'s signature "grok (Cloud Engineering Bot)" reads as grok', parseNote('b.md', read('Inbox/2026-10-26-0905--grok--all--amend--brief.md')).from === 'grok');

// --- The Librarian applies ---
const actions = runLibrarian(ROOT, { now: NOW });
const den = read('Reminders/2026-10-21--dentist.md');
chk('a date change is written as of when Grok wrote it', /\*\*Due:\*\* 2026-10-30 15:00/.test(den) && /^# Dentist cleaning$/m.test(den)
  && readFields(den)['last updated'] === '2026-10-26 08:00 ET' && /- Edited: 2026-10-26 08:00 ET by grok \(change note, applied 2026-10-26 10:00 ET\)/.test(den), den);
chk('its note is filed in Inbox/Done with what was done', /done \(applied by librarian/.test(read('Inbox/Done/2026-10-26-0800--grok--librarian--amend--move-dentist.md'))
  && /- Applied: 2026-10-26 10:00 ET: changed Reminders\/2026-10-21--dentist\.md/.test(read('Inbox/Done/2026-10-26-0800--grok--librarian--amend--move-dentist.md')));
chk('a close files the reminder in Done', exists('Reminders/Done/2026-10-22--milk.md') && /- Closed: 2026-10-26 08:05 ET by grok/.test(read('Reminders/Done/2026-10-22--milk.md')));
chk('a reopen moves a done item back', exists('Reminders/2026-10-24--gutters.md') && /\*\*Status:\*\* open/.test(read('Reminders/2026-10-24--gutters.md')));
const desk = read('Reminders/2026-10-23--desk-wins.md');
chk('a later desk change wins: the note is filed as superseded and nothing is overwritten', /\*\*Due:\*\* 2026-10-30/.test(desk)
  && /superseded: .* was changed at 2026-10-26 08:50 ET/.test(read('Inbox/Done/2026-10-26-0815--grok--librarian--amend--desk-wins.md')), desk);
const past = read('Inbox/2026-10-26-0820--grok--librarian--amend--past.md');
chk('a change that fails its checks stays in the Inbox marked for a person', /\*\*Status:\*\* needs a look \(2026-10-01 is in the past\)/.test(past)
  && /\*\*Due:\*\* 2026-10-30/.test(read('Reminders/2026-10-23--past.md')), past);
chk('a refused ("needs a look") note is never shown as applied', collectOpenItems(ROOT, NOW).all.find((i) => i.file === 'Reminders/2026-10-23--past.md')?.due === '2026-10-30'
  && !pendingChanges(ROOT).reminders.has('2026-10-23--past.md'));
chk('a user routine is paused, with the date', /\*\*Status:\*\* paused \(since 2026-10-26\)/.test(read('Routines/user-walk.md')));
const errands = read('Routines/grok-errands.md');
const kept = fs.readdirSync(path.join(ROOT, 'Archive/2026-10/replaced')).find((f) => f.startsWith('Routines__grok-errands--'));
chk('the AI that runs a routine can replace its whole text, and the old text is kept', errands === REPLACED
  && !!kept && /Old text\./.test(fs.readFileSync(path.join(ROOT, 'Archive/2026-10/replaced', kept), 'utf8')), kept);
chk('another AI\'s routine is refused', /needs a look \(only Gemini/.test(read('Inbox/2026-10-26-0835--grok--librarian--amend--gemini.md'))
  && /\*\*Status:\*\* active/.test(read('Routines/gemini-scan.md')));
chk('MANIFESTO.md cannot be replaced by note', read('MANIFESTO.md') === '# Manifesto\n\nLocked.\n'
  && /needs a look \(MANIFESTO\.md is not changed by note/.test(read('Inbox/2026-10-26-0840--grok--librarian--amend--manifesto.md')));
const calText = read('Calendar/events.md');
chk('calendar notes add a line and strike one through (never delete)', /- 2026-11-02 18:00-19:00 Parent-teacher night @ School \(added by grok\)/.test(calText)
  && /- ~~2026-10-31 19:00 Dinner with S\. @ Home~~ \(cancelled by user via grok\)/.test(calText), calText);
chk('a calendar capture is added once, under its month', (calText.match(/Microsoft Ignite/g) || []).length === 1 && /## 2026-11/.test(calText)
  && readCalendar(ROOT).problems.length === 0);
chk('a close note files another signal it points at', exists('Inbox/Done/2026-10-25-2100--user--grok--handoff--old-ask.md')
  && /\*\*Status:\*\* done/.test(read('Inbox/Done/2026-10-25-2100--user--grok--handoff--old-ask.md'))
  && /- Handled: .* by grok \(change note/.test(read('Inbox/Done/2026-10-25-2100--user--grok--handoff--old-ask.md')));
chk('a replacement between HTML comment markers is applied', read('Outputs/news/cloud/2026-10-26-brief.md').startsWith('# Cloud brief, Monday')
  && exists('Inbox/Done/2026-10-26-0905--grok--all--amend--brief.md'), read('Outputs/news/cloud/2026-10-26-brief.md'));
chk('a note with nothing structured is left for a person, untouched', exists('Inbox/2026-10-26-0855--grok--claude--amend--topic.md')
  && /\*\*Status:\*\* open/.test(read('Inbox/2026-10-26-0855--grok--claude--amend--topic.md')));
chk('the run is logged', actions.some((a) => /change note applied/.test(a)) && /Librarian log/.test(read('System/logs/librarian-2026-10.md')));
const again = runLibrarian(ROOT, { dryRun: true, now: NOW });
chk('a second run has nothing to apply', !again.some((a) => /(edit|move) .*(Reminders|Routines|Calendar)/.test(a)), again.join(' | '));

// --- Same Ignite line again: no duplicate ---
put('Inbox/2026-10-26-0900--grok--librarian--capture--ignite-again.md', note('capture', 'Calendar/events.md', '2026-10-26 09:00 ET',
  '\n- 2026-11-17..2026-11-20 Microsoft Ignite @ San Francisco (added by grok)\n'));
runLibrarian(ROOT, { now: NOW });
chk('a calendar line that is already there is not added twice', (read('Calendar/events.md').match(/Microsoft Ignite/g) || []).length === 1
  && /already there/.test(read('Inbox/Done/2026-10-26-0900--grok--librarian--capture--ignite-again.md')));

// --- The other direction: recent changes for Grok ---
console.log('\nRecent changes');
const recent = recentChanges(ROOT, NOW);
chk('recent changes list the closes and edits, newest first', recent.some((r) => r.title === 'Buy milk' && /^closed /.test(r.what))
  && recent.some((r) => r.title === 'Dentist cleaning' && /^edited /.test(r.what)) && recent[0].stamp >= recent[recent.length - 1].stamp, JSON.stringify(recent.slice(0, 3)));
chk('older changes are left out', !recentChanges(ROOT, easternNow(new Date('2026-10-30T14:00:00Z'))).length);
const index = read('index.md');
chk('index.md carries the list for Grok', /## Changed in the last 48 hours[\s\S]*Buy milk · closed /.test(index));

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
