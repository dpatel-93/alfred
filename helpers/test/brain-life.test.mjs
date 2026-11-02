#!/usr/bin/env node
// --- brain-life.test.mjs -------------------------------------------------------
// Life admin for the AIs that work by file (Grok in the car): the "Life admin"
// part of index.md (what to remind the user about, and from when), and the
// Librarian applying a change note to a Life/ record: close = done this time
// (the date moves on, the record stays), Set Next due = snooze, and so on.
//
//   node ~/.claude/helpers/test/brain-life.test.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { easternNow, readFields } from '../brain-core.mjs';
import { renderIndex, runLibrarian } from '../brain-librarian.mjs';
import { createRecord } from '../life-store.mjs';

const ROOT = path.join(os.tmpdir(), `life-test-${process.pid}`);
const BRAIN = path.join(ROOT, 'Second Brain');
const MADE = easternNow(new Date('2026-11-02T14:00:00Z')); // Monday 09:00 ET
const NOW = easternNow(new Date('2026-11-02T16:00:00Z'));  // 11:00 ET
let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(BRAIN, rel)), { recursive: true }); fs.writeFileSync(path.join(BRAIN, rel), text, 'utf8'); };
const read = (rel) => (fs.existsSync(path.join(BRAIN, rel)) ? fs.readFileSync(path.join(BRAIN, rel), 'utf8') : '');
const fields = (rel) => readFields(read(rel));
const NOTE = (name) => `Inbox/2026-11-02-1000--grok--librarian--${name}.md`;
const changeNote = (name, target, { type = 'amend', reason, set = [] } = {}) => put(NOTE(name), [
  `# ${name}`, '', '- **Schema:** 1', '- **Kind:** signal', `- **Type:** ${type}`, '- **From:** grok',
  '- **To:** librarian', `- **Target:** ${target}`, '- **Author:** grok', '- **Status:** open',
  '- **Created:** 2026-11-02 10:00 ET', ...(reason ? [`- **Reason:** ${reason}`] : []), '',
  ...set.map((s) => `- **Set:** ${s}`), ''].join('\n'));
const applied = (name) => fs.existsSync(path.join(BRAIN, NOTE(name).replace('Inbox/', 'Inbox/Done/')));
const refused = (name) => /needs a look/.test(fields(NOTE(name)).status);

fs.rmSync(ROOT, { recursive: true, force: true });
try {
  chk('no life admin, no Life part', !/## Life admin/.test(renderIndex(BRAIN, NOW, [])));
  const make = (register, it) => createRecord(BRAIN, register, it, { now: MADE });
  make('recurring', { title: 'Water bill', area: 'home', type: 'bill', repeats: 'every month on the 5th', nextDue: '2026-11-05', remind: '5 days before', amount: '60' });
  make('recurring', { title: 'Phone bill', area: 'money', type: 'bill', repeats: 'every month on the 28th', nextDue: '2026-10-28', amount: '45', autopay: 'yes' });
  make('recurring', { title: 'Furnace filter', area: 'home', type: 'upkeep', repeats: 'every 3 months', nextDue: '2026-11-02' });
  make('recurring', { title: 'Car registration', area: 'car', type: 'renewal', repeats: 'every year', nextDue: '2026-11-25', remind: '7 days before' });
  make('people', { name: 'Sam', relationship: 'friend', birthday: 'Nov 4', remind: '3 days before' });
  make('documents', { title: 'My passport', type: 'passport', expires: '2027-05-01' });
  chk('records are written with " ET" stamps', /- Created: |\*\*Created:\*\* 2026-11-02 09:00 ET/.test(read('Life/Recurring/water-bill.md')));

  changeNote('paid-water', 'Life/Recurring/water-bill.md', { type: 'close', reason: 'done' });
  const life = renderIndex(BRAIN, NOW, []).split('## Life admin')[1]?.split('\n## ')[0] || '';
  chk('index.md has a Life admin part', !!life);
  chk('late: the phone bill', life.includes('### Late (1)\n- Phone bill · was due 2026-10-28 (5 days ago) · $45.00 · autopay'), life);
  chk('due today: the filter', life.includes('### Due today (1)\n- Furnace filter · due 2026-11-02 (today)'), life);
  chk('remind now: the water bill, with when reminding began', life.includes('- Water bill · due 2026-11-05 (in 3 days) · $60.00 · remind from 2026-10-31'), life);
  chk('a waiting note shows beside it', /Water bill[^\n]*change waiting: done/.test(life), life);
  chk("remind now: Sam's birthday", life.includes("Sam's birthday · due 2026-11-04"), life);
  chk('coming up: the registration, and the day to start', life.includes('- Car registration · due 2026-11-25 (in 23 days) · remind from 2026-11-18'), life);

  runLibrarian(BRAIN, { now: NOW, force: true });
  const water = fields('Life/Recurring/water-bill.md');
  chk('done note applied and filed', applied('paid-water'));
  chk('the bill moves to next month and stays', water['next due'] === '2026-12-05' && water.status === 'active', JSON.stringify(water));
  chk('done on the day the note was written', water['last done'] === '2026-11-02');
  chk('signed by the Librarian for Grok', /by librarian via grok/.test(read('Life/Recurring/water-bill.md')));
  chk('index.md lists the change for the other AIs', /Water bill · edited[^\n]*done 2026-11-02/.test(read('index.md')), read('index.md').slice(-1500));
  chk('the catalog names Life/', read('index.md').includes('`Life/` (life admin'));

  changeNote('later-filter', 'Life/Recurring/furnace-filter.md', { set: ['Next due = 2026-11-09'] });
  changeNote('skip-phone', 'Life/Recurring/phone-bill.md', { type: 'close', reason: 'not-needed' });
  changeNote('wished-sam', 'Life/People/sam.md', { type: 'close' });
  changeNote('passport', 'Life/Documents/my-passport.md', { set: ['Expires = 2037-05-01'] });
  changeNote('amount', 'Life/Recurring/car-registration.md', { set: ['Amount = 99'] });
  runLibrarian(BRAIN, { now: NOW, force: true });
  chk('snoozed', fields('Life/Recurring/furnace-filter.md')['next due'] === '2026-11-09');
  const phone = fields('Life/Recurring/phone-bill.md');
  chk('skipped, not marked done', phone['next due'] === '2026-11-28' && !phone['last done']);
  chk('birthday taken care of', fields('Life/People/sam.md')['birthday done'] === '2026-11-04');
  chk('passport renewed', fields('Life/Documents/my-passport.md').expires === '2037-05-01');
  chk('a field an AI may not set is left for a person', refused('amount'));
  chk('the others applied', ['later-filter', 'skip-phone', 'wished-sam', 'passport'].every(applied));
} catch (err) {
  fails.push(`crashed: ${err.stack}`);
  console.log(err.stack);
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
