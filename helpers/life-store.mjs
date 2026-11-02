// Ported from Brainiac (the alfie repo, engine/src/life/); keep the two in step.
// --- life-store.mjs --------------------------------------------------------------------
// The life-admin records in the brain: one note per record under Life/ (Recurring, People, Documents, Assets),
// with the same header fields and §17 lines as every other item, so any AI can read and add to them. One writer
// for every path that changes them, so a field is checked the same way whoever asked.
//
// Describe, don't identify: no account, policy, licence, plate or serial numbers, and no full names. A free-text
// field holding something shaped like an ID is refused, and a person is a first name or nickname.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import {
  closedLine, easternNow, mdFiles, readFields, reopenedLine, setField, withSchema,
} from './brain-core.mjs';

// Alfred's clock is always the brain's Eastern time, and its stamps already end in " ET".
const USER = 'user';
const BY_USER = 'user';
const brainNow = () => easternNow();
const lineStamp = (now) => now.stamp;
const editedLine = (stamp, by, what) => `- Edited: ${stamp} by ${by}: ${what}`;
const noteText = (full) => fs.readFileSync(full, 'utf8');
import {
  MONTHS, describeLead, describeRepeats, firstDue, isCalendarRule, isDate, nextAfterDone, nextAfterSkip, parseLead,
  parseRepeats, REPEATS_HELP,
} from './life-schedule.mjs';

export const LIFE_DIR = 'Life';
export const REGISTERS = {
  recurring: { folder: 'Recurring', kind: 'recurring' },
  people: { folder: 'People', kind: 'person' },
  documents: { folder: 'Documents', kind: 'document' },
  assets: { folder: 'Assets', kind: 'asset' },
};
export const AREAS = ['money', 'taxes', 'business', 'work', 'home', 'car', 'health', 'family', 'pets', 'documents',
  'digital', 'other'];
export const TYPES = ['bill', 'subscription', 'renewal', 'upkeep', 'deadline', 'check-up', 'occasion', 'task'];
export const DOC_TYPES = ['passport', 'driving licence', 'trusted traveller', 'id card', 'insurance policy',
  'professional licence', 'vehicle registration', 'will', 'other'];
export const ASSET_TYPES = ['home', 'vehicle', 'appliance', 'device', 'pet', 'other'];
// How far ahead each shows, unless the record says otherwise.
export const TYPE_LEAD = { bill: 5, subscription: 7, renewal: 30, upkeep: 3, deadline: 14, 'check-up': 14,
  occasion: 7, task: 3 };
export const DOC_LEAD = { passport: 270, 'driving licence': 60, 'trusted traveller': 180, 'id card': 60,
  'insurance policy': 30, 'professional licence': 90, 'vehicle registration': 30, will: 30, other: 30 };
const AFTER_DONE_TYPES = ['upkeep', 'check-up', 'task'];
// Words that come before a first name without making it a full name.
const TITLES = new RegExp('^(aunt|auntie|uncle|cousin|grandma|grandpa|granny|nana|nani|papa|mama|dr|'
  + 'coach|mr|mrs|ms|miss|sir|baby|little|big|my|the|our)\\.?$', 'i');

export const fail = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
const line = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'record';
const pick = (v, list, dflt) => (list.includes(String(v ?? '').toLowerCase()) ? String(v).toLowerCase() : dflt);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// --- Guards ---
// Something shaped like an account, policy, card, social security, licence or phone number. Dates, amounts,
// thousands ("5,000 miles") and years are set aside first. Then: 7 or more digits however they are grouped
// (spaces, dashes, dots, brackets), a few letters followed by 6 or more digits ("POL-12-3456"), or one word with
// 6 or more digits in it ("X12345678"). Model names like "RTX4090" and "taxes2025" are fine.
export function looksLikeId(text) {
  const s = String(text || '').replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\$[\d,]+(\.\d+)?/g, ' ')
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' ');
  if (/(?:\d[\s().-]{0,2}){7,}/.test(s)) return true;
  if (/\b[A-Za-z]{1,5}[\s-]?(?:\d[\s-]?){6,}/.test(s)) return true;
  return s.split(/[^A-Za-z0-9]+/).some((t) => /[A-Za-z]/.test(t) && (t.match(/\d/g) || []).length >= 6);
}
// Two names in a row ("Jane Doe", "john smith"), not counting words like aunt, coach or my.
export function looksLikeFullName(text) {
  const words = String(text || '').split(/[\s,;/&+]+|\band\b/i).filter(Boolean);
  for (let i = 0; i + 1 < words.length; i++) {
    const [a, b] = [words[i], words[i + 1]];
    const named = (w) => /^[A-Za-z][a-z'’-]+$/.test(w) && !TITLES.test(w)
      && !/^(me|us|we|you|him|her|them|both|of|all|family|kids|and|or|with|friend|friends|mom|dad|mum)$/i.test(w);
    if (named(a) && named(b) && /^[A-Z]/.test(a) && /^[A-Z]/.test(b)) return true;
  }
  return false;
}
function who(v, n, what) {
  const s = free(v, n, what);
  if (looksLikeFullName(s)) {
    fail(`${what}: a relationship or first name only, please; the brain never keeps full names`);
  }
  return s;
}
function free(v, n, what) {
  const s = line(v, n);
  if (looksLikeId(s)) {
    fail(`${what} looks like it holds a number such as an account or ID; the brain never keeps those`);
  }
  return s;
}
function personName(v) {
  const s = free(v, 40, 'the name');
  if (!s) fail('a first name or nickname is needed');
  // After a word like aunt or coach, one name: "Aunt Priya" is fine, "john smith" is not, whatever the capitals.
  const words = s.split(' ').filter((w) => !TITLES.test(w));
  if (words.length > 1) {
    fail('a first name or nickname only, please: the brain never keeps full names');
  }
  return s;
}
function date(v, what, { past = true, today } = {}) {
  const s = String(v ?? '').trim();
  if (!s || s === 'to set') return '';
  if (!isDate(s)) fail(`${what}: "${line(s, 20)}" is not a date`);
  if (!past && today && s < today) fail(`${what}: ${s} is in the past`);
  return s;
}
// "$1,234.5" / "1234.50" / "120" -> "$1,234.50"; '' when empty.
export function money(v) {
  const s = String(v ?? '').replace(/[\s$,]/g, '');
  if (!s) return '';
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) fail(`"${line(v, 20)}" is not an amount`);
  return `$${Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const amountOf = (v) => Number(String(v || '').replace(/[$,]/g, '')) || 0;
// "May 3", "3 May", "05-03", "1985-05-03" -> "May 3" or "May 3, 1985"; '' when empty.
export function dayOfYear(v, what) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const say = (mm, dd, yy) => {
    if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= new Date(Date.UTC(2024, mm, 0)).getUTCDate())) {
      fail(`${what}: "${line(s, 20)}" is not a day of the year`);
    }
    return `${cap(MONTHS[mm - 1])} ${dd}${yy ? `, ${yy}` : ''}`;
  };
  if (m) return say(Number(m[2]), Number(m[3]), m[1]);
  m = /^(\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return say(Number(m[1]), Number(m[2]));
  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(s)
    || /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:,?\s+(\d{4}))?$/.exec(s);
  if (m) {
    const [word, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const mm = MONTHS.findIndex((x) => x.startsWith(word.toLowerCase()) && word.length >= 3) + 1;
    if (mm) return say(mm, Number(day), m[3]);
  }
  fail(`${what}: "${line(s, 20)}" is not a day of the year (try "May 3")`);
}
// A Birthday or Anniversary field however it was written ("November 5", "Nov 5", "Sept 5, 1985", "5 Nov") ->
// [month, day], or null when it can't be read (a hand edit like "Smarch 5" leaves the occasion out, not the page).
export function monthDayOf(said) {
  try {
    const m = /^(\w+) (\d{1,2})/.exec(dayOfYear(String(said || '').trim(), 'day'));
    return m ? [MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2])] : null;
  } catch {
    return null;
  }
}
function lead(v, dflt) {
  if (v == null || v === '') return describeLead(dflt);
  const days = typeof v === 'number' ? v : parseLead(v);
  if (days == null || days < 0 || days > 400) fail(`"${line(v, 30)}" is not a reminder time (try "7 days before")`);
  return describeLead(days);
}
const yesNo = (v) => (v === true || /^(yes|y|on|true)$/i.test(String(v ?? '')) ? 'yes' : 'no');
function lifeRef(brain, v, register) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const want = `${LIFE_DIR}/${REGISTERS[register].folder}/`;
  if (!s.startsWith(want) || /\.\.|[\\]/.test(s) || !s.endsWith('.md')) fail(`expected a file in ${want}`);
  if (!fs.existsSync(path.join(brain, s))) fail(`${s} is not there`);
  return s;
}

// --- The header fields of each register, in order: input -> [[Field, value]] ---
function recurringFields(brain, it, now) {
  const title = free(it.title, 80, 'the title');
  if (!title) fail('a title is needed');
  const rule = parseRepeats(it.repeats);
  if (!rule) fail(`I can't read "${line(it.repeats, 60)}". ${REPEATS_HELP}`);
  const type = pick(it.type, TYPES, 'task');
  const anchor = isCalendarRule(rule) ? 'fixed'
    : pick(it.anchor, ['fixed', 'after done'], AFTER_DONE_TYPES.includes(type) ? 'after done' : 'fixed');
  const weekends = /next weekday/i.test(it.weekends || '') ? 'next weekday' : '';
  const lastDone = date(it.lastDone, 'last done');
  let due = date(it.nextDue, 'next due');
  if (!due && rule.type !== 'once' && !it.dateToSet) {
    due = firstDue({ rule, lastDone, today: now.date, weekdays: !!weekends }) || '';
  }
  // A fixed interval counts every date from where it started, so month ends and weekend moves never drift.
  const counted = rule.type === 'interval' && anchor === 'fixed' && due;
  const started = counted ? (!it.restart && isDate(it.started) && it.started <= due ? it.started : due) : '';
  return [
    ['Area', pick(it.area, AREAS, 'other')], ['Type', type], ['Repeats', describeRepeats(rule)],
    ['Anchor', anchor], ...(weekends ? [['Weekends', weekends]] : []), ['Next due', due || 'to set'],
    ...(started ? [['Started', started]] : []),
    ['Remind', lead(it.remind, TYPE_LEAD[type])], ...(lastDone ? [['Last done', lastDone]] : []),
    ...(money(it.amount) ? [['Amount', money(it.amount)], ['Autopay', yesNo(it.autopay)]] : []),
    ...(free(it.provider, 60, 'the provider') ? [['Provider', free(it.provider, 60, 'the provider')]] : []),
    ...(who(it.who, 40, 'who') ? [['Who', who(it.who, 40, 'who')]] : []),
    ...(lifeRef(brain, it.asset, 'assets') ? [['Asset', lifeRef(brain, it.asset, 'assets')]] : []),
    ...(lifeRef(brain, it.person, 'people') ? [['Person', lifeRef(brain, it.person, 'people')]] : []),
    ['_title', title],
  ];
}
function personFields(brain, it) {
  const name = personName(it.name ?? it.title);
  const keep = String(it.keepInTouch ?? '').trim();
  const keepRule = keep ? parseRepeats(keep) : null;
  if (keep && (!keepRule || keepRule.type !== 'interval')) {
    fail(`keep in touch: try "every 4 weeks", not "${line(keep, 30)}"`);
  }
  return [
    ['Relationship', who(it.relationship, 40, 'the relationship') || 'friend'],
    ...(dayOfYear(it.birthday, 'birthday') ? [['Birthday', dayOfYear(it.birthday, 'birthday')]] : []),
    ...(dayOfYear(it.anniversary, 'anniversary') ? [['Anniversary', dayOfYear(it.anniversary, 'anniversary')]] : []),
    ...(keepRule ? [['Keep in touch', describeRepeats(keepRule)]] : []),
    ...(date(it.lastContact, 'last contact') ? [['Last contact', date(it.lastContact, 'last contact')]] : []),
    ['Remind', lead(it.remind, TYPE_LEAD.occasion)], ['_title', name],
  ];
}
function documentFields(brain, it) {
  const title = free(it.title, 80, 'the title');
  if (!title) fail('a title is needed');
  const type = pick(it.type, DOC_TYPES, 'other');
  return [
    ['Type', type], ['Whose', who(it.whose, 40, 'whose') || 'me'],
    ['Expires', date(it.expires, 'expires') || 'to set'], ['Renew', lead(it.remind ?? it.renew, DOC_LEAD[type])],
    ...(free(it.kept, 120, 'where it is kept') ? [['Kept', free(it.kept, 120, 'where it is kept')]] : []),
    ['_title', title],
  ];
}
function assetFields(brain, it) {
  const title = free(it.title, 80, 'the title');
  if (!title) fail('a title is needed');
  return [
    ['Type', pick(it.type, ASSET_TYPES, 'other')],
    ...(date(it.since, 'since') ? [['Since', date(it.since, 'since')]] : []),
    ...(date(it.warrantyUntil, 'warranty until') ? [['Warranty until', date(it.warrantyUntil, 'warranty until')]]
      : []),
    ...(date(it.leaseEnds, 'lease ends') ? [['Lease ends', date(it.leaseEnds, 'lease ends')]] : []),
    ['Remind', lead(it.remind, 30)], ['_title', title],
  ];
}
const FIELDS = { recurring: recurringFields, people: personFields, documents: documentFields, assets: assetFields };

// --- Reading ---
const toCamel = (k) => k.replace(/ (\w)/g, (_, c) => c.toUpperCase());
export function readRecord(brain, rel) {
  const text = noteText(path.join(brain, rel));
  const f = readFields(text);
  const register = Object.keys(REGISTERS).find((r) => rel.startsWith(`${LIFE_DIR}/${REGISTERS[r].folder}/`));
  const title = ((text.match(/^#\s+(.+)$/m) || [])[1] || path.basename(rel, '.md')).trim();
  const note = ((text.split(/\n## Notes\n/)[1] || '').split(/\n(?:## |- Edited:|- Closed:|- Reopened:)/)[0] || '')
    .trim();
  const history = [...text.matchAll(
    /^- (Edited|Closed|Reopened): (\d{4}-\d{2}-\d{2} \d{2}:\d{2})[^\n]*?(?:: |· )(.*)$/gm)]
    .map((m) => ({ what: m[1].toLowerCase(), at: m[2], said: m[3] })).slice(-12);
  const rec = { file: rel, register, title, note, history, status: String(f.status || 'active').split(/[\s(]/)[0] };
  for (const [k, v] of Object.entries(f)) if (!['status', 'schema'].includes(k)) rec[toCamel(k)] = v;
  return rec;
}
export function listRecords(brain) {
  const out = [];
  for (const { folder } of Object.values(REGISTERS)) {
    for (const f of mdFiles(path.join(brain, LIFE_DIR, folder))) {
      try {
        out.push(readRecord(brain, `${LIFE_DIR}/${folder}/${f}`));
      } catch { /* a note that can't be read is left out, not fatal */ }
    }
  }
  return out;
}

// --- Writing ---
function recordPath(brain, rel) {
  const ok = typeof rel === 'string' && /^Life\/(Recurring|People|Documents|Assets)\/[^/\\]+\.md$/.test(rel)
    && !rel.includes('..') && !/\/readme\.md$/i.test(rel);
  if (!ok) fail('expected a life-admin record in Life/');
  const full = path.join(brain, rel);
  if (!fs.existsSync(full)) fail(`${rel} is not there (it may have been moved)`);
  return full;
}
// Stamp the header and end the file with the §17 lines for this change.
const finish = (full, text, now, ...lines) => {
  fs.writeFileSync(full, `${withSchema(setField(text, 'Last updated', now.stamp)).trimEnd()}\n${lines.join('\n')}\n`,
    'utf8');
};
const save = (full, text, now, by, what) => finish(full, text, now, editedLine(lineStamp(now), by, what));

export function createRecord(brain, register, it = {}, { author = USER, now = brainNow(brain) } = {}) {
  if (!REGISTERS[register]) fail(`unknown register "${line(register, 20)}"`);
  const fields = FIELDS[register](brain, it, now);
  const title = fields.find(([k]) => k === '_title')[1];
  const header = fields.filter(([k]) => k !== '_title');
  const dir = path.join(brain, LIFE_DIR, REGISTERS[register].folder);
  fs.mkdirSync(dir, { recursive: true });
  let name = `${slugify(title)}.md`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${slugify(title)}-${n}.md`;
  const note = free(it.note, 600, 'the note');
  const text = [`# ${title}`, '', '- **Schema:** 1', `- **Kind:** ${REGISTERS[register].kind}`,
    ...header.map(([k, v]) => `- **${k}:** ${v}`), '- **Status:** active', `- **Author:** ${author}`,
    `- **Created:** ${lineStamp(now)}`, `- **Last updated:** ${now.stamp}`, '',
    ...(note ? ['## Notes', note, ''] : [])].join('\n');
  fs.writeFileSync(path.join(dir, name), text, 'utf8');
  return { register, title, file: `${LIFE_DIR}/${REGISTERS[register].folder}/${name}` };
}

// The record's current fields as input, so a change can be checked by the same rules as a new one.
function asInput(rec) {
  return { ...rec, title: rec.title, name: rec.title, remind: rec.remind ?? rec.renew, renew: rec.renew,
    amount: rec.amount, autopay: rec.autopay, nextDue: rec.nextDue === 'to set' ? '' : rec.nextDue,
    expires: rec.expires === 'to set' ? '' : rec.expires };
}

export function updateRecord(brain, file, changes = {}, { by = BY_USER, now = brainNow(brain) } = {}) {
  const full = recordPath(brain, file);
  const rec = readRecord(brain, file);
  const merged = { ...asInput(rec), ...changes };
  if (rec.register === 'recurring') {
    const dated = 'nextDue' in changes || 'repeats' in changes;
    // A new calendar schedule with no date given: the next date comes from the new schedule, not the old one.
    if ('repeats' in changes && !('nextDue' in changes) && isCalendarRule(parseRepeats(changes.repeats))) {
      merged.nextDue = '';
    }
    // Something waiting for a date keeps waiting when only its other fields change: no date is made up for it.
    if (rec.nextDue === 'to set' && !dated) merged.dateToSet = true;
    // A new date or schedule is a new start for a fixed interval.
    if (dated || 'anchor' in changes) merged.restart = true;
  }
  const fields = FIELDS[rec.register](brain, merged, now);
  let text = fs.readFileSync(full, 'utf8');
  const what = [];
  for (const [k, v] of fields) {
    if (k === '_title') {
      if (v !== rec.title) { text = text.replace(/^#\s+.*$/m, () => `# ${v}`); what.push(`title → "${v}"`); }
      continue;
    }
    const cur = readFields(text)[k.toLowerCase()] ?? '';
    if (cur !== v) { text = setField(text, k, v); what.push(`${k.toLowerCase()} → ${v}`); }
  }
  // Fields cleared in the form (no longer produced) are emptied out, not left stale.
  // Autopay belongs to an amount: clearing the amount clears it too. Started goes when a fixed interval stops.
  const named = { ...changesKeys(changes), ...('amount' in changes ? { Autopay: true } : {}), Started: true };
  for (const k of ['Amount', 'Autopay', 'Provider', 'Who', 'Asset', 'Person', 'Weekends', 'Last done', 'Birthday',
    'Anniversary', 'Keep in touch', 'Last contact', 'Kept', 'Since', 'Warranty until', 'Lease ends', 'Started']) {
    const there = readFields(text)[k.toLowerCase()];
    if (there && !fields.some(([f]) => f === k) && k in named) {
      text = text.replace(new RegExp(`^- \\*\\*${k}:\\*\\*.*\\n`, 'm'), '');
      what.push(`${k.toLowerCase()} cleared`);
    }
  }
  const note = changes.note != null ? free(changes.note, 600, 'the note') : null;
  if (note != null && note !== rec.note) {
    // Replaced by a function, so a "$" in the note is kept as written.
    text = rec.note ? text.replace(`## Notes\n${rec.note}`, () => (note ? `## Notes\n${note}` : ''))
      : `${text.trimEnd()}\n\n## Notes\n${note}\n`;
    what.push('note changed');
  }
  if (!what.length) fail('nothing to change');
  save(full, text, now, by, what.join('; '));
  return { file, title: readRecord(brain, file).title, changed: what };
}
// Which field names a change names, in the header's spelling ("lastDone" -> "Last done").
function changesKeys(changes) {
  const out = {};
  for (const k of Object.keys(changes)) out[cap(k.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`))] = true;
  return out;
}

// --- What happens to a record: done, skip, snooze, pause, resume, retire; people and documents too ---
export const ACTIONS = ['done', 'skip', 'snooze', 'pause', 'resume', 'retire', 'wished', 'contacted', 'renewed',
  'noted'];

export function actOn(brain, file, action, opts = {}, { by = BY_USER, now = brainNow(brain) } = {}) {
  if (!ACTIONS.includes(action)) fail(`unknown action "${line(action, 20)}"`);
  const full = recordPath(brain, file);
  const rec = readRecord(brain, file);
  let text = fs.readFileSync(full, 'utf8');
  const set = (k, v) => { text = setField(text, k, v); };
  const stamp = lineStamp(now);
  if (['pause', 'resume', 'retire'].includes(action)) {
    if (action === 'resume' && rec.status === 'active') fail('it is already active');
    if (action === 'pause' && rec.status !== 'active') fail('only something active can be paused');
    set('Status', { pause: `paused (since ${now.date})`, resume: 'active', retire: 'retired' }[action]);
    if (action === 'retire') finish(full, text, now, closedLine(stamp, by, 'not-needed'));
    else if (rec.status === 'retired' || rec.status === 'done') {
      finish(full, text, now, reopenedLine(stamp, by, 'mistake'));
    }
    else save(full, text, now, by, action === 'pause' ? 'paused' : 'resumed');
    return { file, title: rec.title, action, said: { pause: 'paused', resume: 'resumed', retire: 'retired' }[action] };
  }
  const what = (REGISTER_ACTIONS[rec.register] || {})[action]?.(rec, opts, now, set);
  if (!what) fail(`"${action}" does not apply to this record`);
  if (what.close) finish(full, text, now, editedLine(stamp, by, what.said), closedLine(stamp, by, 'done'));
  else save(full, text, now, by, what);
  return { file, title: rec.title, action, said: what.close ? what.said : what };
}

const ruleOf = (rec) => parseRepeats(rec.repeats);
const onDay = (opts, now, what) => date(opts.on, what) || now.date;

const REGISTER_ACTIONS = {
  recurring: {
    done(rec, opts, now, set) {
      const on = onDay(opts, now, 'done on');
      if (on > now.date) fail('done on: that day has not come yet');
      const due = isDate(rec.nextDue) ? rec.nextDue : null;
      const rule = ruleOf(rec);
      if (!rule) fail(`its schedule "${line(rec.repeats, 40)}" can't be read; change it first`);
      const next = nextAfterDone({ rule, anchor: rec.anchor, due, done: on, start: rec.started,
        weekdays: rec.weekends === 'next weekday' });
      set('Last done', on);
      if (!next && rule.type !== 'once') fail('Brainiac could not work out the next date; check its schedule');
      if (!next) { set('Status', 'done'); return { close: true, said: `done ${on}` }; }
      set('Next due', next);
      return `done ${on}${due ? ` (was due ${due})` : ''}; next ${next}`;
    },
    skip(rec, opts, now, set) {
      if (!isDate(rec.nextDue)) fail('it has no date to skip yet');
      const next = nextAfterSkip({ rule: ruleOf(rec), anchor: rec.anchor, due: rec.nextDue, start: rec.started,
        weekdays: rec.weekends === 'next weekday' });
      if (!next) fail('something that happens once can be retired, not skipped');
      set('Next due', next);
      return `skipped ${rec.nextDue}; next ${next}`;
    },
    snooze(rec, opts, now, set) {
      const to = date(opts.to, 'snooze to', { past: false, today: now.date });
      if (!to) fail('a day to snooze to is needed');
      set('Next due', to);
      return `snoozed ${isDate(rec.nextDue) ? rec.nextDue : 'no date'} → ${to}`;
    },
  },
  people: {
    wished(rec, opts, now, set) {
      const which = opts.occasion === 'anniversary' ? 'anniversary' : 'birthday';
      const on = date(opts.for, `${which} date`) || now.date;
      if (!rec[which]) fail(`no ${which} is kept for ${rec.title}`);
      set(`${cap(which)} done`, on);
      return `${which} ${on} taken care of`;
    },
    contacted(rec, opts, now, set) {
      const on = onDay(opts, now, 'contacted on');
      set('Last contact', on);
      return `in touch ${on}`;
    },
  },
  documents: {
    renewed(rec, opts, now, set) {
      const exp = date(opts.expires, 'new expiry date');
      if (!exp) fail('the new expiry date is needed');
      if (exp <= now.date) fail('the new expiry date should be in the future');
      set('Expires', exp);
      return `renewed; expires ${exp}`;
    },
  },
  assets: {
    noted(rec, opts, now, set) {
      const which = opts.what === 'lease' ? 'Lease' : 'Warranty';
      set(`${which} noted`, now.date);
      return `${which.toLowerCase()} end noted`;
    },
  },
};
