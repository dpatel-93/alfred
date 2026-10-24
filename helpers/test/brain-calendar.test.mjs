#!/usr/bin/env node
// --- brain-calendar.test.mjs -------------------------------------------------
// Runs the calendar sync against a throwaway brain and an in-memory fake of the
// Google Calendar API (injected through setFetch), with a fixed clock.
//
//   node ~/.claude/helpers/test/brain-calendar.test.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(os.tmpdir(), `calendar-test-${process.pid}`);
const CONF = path.join(os.tmpdir(), `calendar-test-conf-${process.pid}`);
process.env.ALFRED_LOCAL_CONFIG_DIR = CONF;   // never the operator's ~/.alfred
process.env.ALFRED_SHARED_BRAIN = ROOT;
const { calendarStatus, calendarView, connectUrl, finishConnect, disconnect, saveConfig, setFetch, syncCalendar } = await import('../brain-calendar.mjs');
const { easternNow } = await import('../brain-librarian.mjs');
const NOW = easternNow(new Date('2026-10-26T13:00:00Z')); // Monday 09:00 ET

let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), text, 'utf8'); };
const read = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '');
const reminder = (kind, status, due, title, author = 'grok') =>
  `# ${title}\n\n- **Kind:** ${kind}\n- **Status:** ${status}\n- **Due:** ${due}\n- **Scope:** personal\n- **Author:** ${author}\n- **Last updated:** 2026-10-25 10:00 ET\n\nBody.\n`;

// --- A fake Google: tokens, one calendar list, events per calendar ---
const G = { calendars: { primary: { id: 'me@example.com', summary: 'me', primary: true, backgroundColor: '#1b6' }, shared: { id: 'fam@group.calendar.google.com', summary: 'Family', backgroundColor: '#f60' } },
  events: {}, tokenCalls: 0, log: [] };
let nextId = 1;
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
setFetch(async (url, opts = {}) => {
  const u = new URL(String(url));
  const method = opts.method || 'GET';
  G.log.push(`${method} ${u.pathname}${u.search}`);
  if (u.hostname === 'oauth2.googleapis.com') {
    G.tokenCalls++;
    const f = new URLSearchParams(opts.body);
    if (f.get('grant_type') === 'authorization_code') return json(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 });
    return json(200, { access_token: `at${G.tokenCalls}`, expires_in: 3600 });
  }
  if ((opts.headers || {}).Authorization !== `Bearer at${G.tokenCalls}`) return json(401, { error: { message: 'bad token' } });
  const p = u.pathname.replace('/calendar/v3', '');
  if (p === '/users/me/calendarList') return json(200, { items: Object.values(G.calendars).map((c) => ({ ...c, selected: true, accessRole: 'owner' })) });
  if (p === '/calendars/primary') return json(200, G.calendars.primary);
  if (p === '/calendars' && method === 'POST') { const b = JSON.parse(opts.body); const id = 'brain@group.calendar.google.com'; G.calendars.brain = { id, summary: b.summary, backgroundColor: '#2ef' }; G.events[id] = []; return json(200, { id }); }
  const m = p.match(/^\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/);
  if (!m) return json(404, { error: { message: 'no route ' + p } });
  const calId = decodeURIComponent(m[1]);
  const evId = m[2] ? decodeURIComponent(m[2]) : null;
  const cal = Object.values(G.calendars).find((c) => c.id === calId);
  if (!cal) return json(404, { error: { message: 'no calendar' } });
  G.events[calId] ||= [];
  if (!m[0].includes('/events')) return json(200, cal);
  if (method === 'GET' && !evId) {
    const showDeleted = u.searchParams.get('showDeleted') === 'true';
    const items = G.events[calId].filter((e) => showDeleted || e.status !== 'cancelled');
    return json(200, { items });
  }
  if (method === 'POST') { const b = JSON.parse(opts.body); const ev = { id: `ev${nextId++}`, status: 'confirmed', ...b }; G.events[calId].push(ev); return json(200, ev); }
  const ev = G.events[calId].find((e) => e.id === evId);
  if (!ev) return json(404, { error: { message: 'no event' } });
  if (method === 'PATCH') { const b = JSON.parse(opts.body); Object.assign(ev, b, { extendedProperties: { private: { ...(ev.extendedProperties?.private || {}), ...(b.extendedProperties?.private || {}) } } }); return json(200, ev); }
  if (method === 'DELETE') { ev.status = 'cancelled'; return { ok: true, status: 204, json: async () => ({}) }; }
  return json(405, { error: { message: 'method' } });
});

// --- Fixture ---
fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(CONF, { recursive: true, force: true });
put('Reminders/2026-10-26--errand.md', reminder('errand', 'open', '2026-10-26', 'Pick up dry cleaning'));
put('Reminders/2026-10-28--dentist.md', reminder('reminder', 'open', '2026-10-28', 'Dentist', 'Claude Code'));
put('Reminders/2026-10-21--chore.md', reminder('todo', 'open', 'none', 'Clean the gutters'));
put('Reminders/README.md', '# Reminders\n');

console.log('\nConnect');
chk('status starts unconfigured', !calendarStatus().configured && !calendarStatus().connected);
saveConfig({ clientId: 'cid', clientSecret: 'sec' });
const url = connectUrl(7777);
const state = new URL(url).searchParams.get('state');
chk('the consent URL asks for offline calendar access with a loopback redirect',
  /accounts\.google\.com/.test(url) && /access_type=offline/.test(url) && /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A7777%2Foauth2%2Fgoogle/.test(url) && state?.length === 32, url);
let bad = null; try { await finishConnect({ code: 'x', state: 'nope' }); } catch (e) { bad = e.message; }
chk('an unknown state is refused', /unknown|expired/.test(bad || ''), bad);
const st = await finishConnect({ code: 'code1', state });
chk('connecting stores the refresh token, the account label and creates the Second Brain calendar',
  st.connected && st.account === 'me@example.com' && st.brainCalendarId === 'brain@group.calendar.google.com' && G.calendars.brain.summary === 'Second Brain', JSON.stringify(st));
const saved = JSON.parse(fs.readFileSync(path.join(CONF, 'google-calendar.json'), 'utf8'));
chk('the saved file holds the refresh token and never an access token', saved.refreshToken === 'rt1' && !JSON.stringify(saved).includes('at1'));
chk('the page-facing status never carries a secret or token', !JSON.stringify(calendarStatus()).match(/sec|rt1|at1/));

console.log('\nBrain -> calendar');
let r = await syncCalendar(ROOT, NOW);
const brainEvents = () => G.events['brain@group.calendar.google.com'];
chk('first sync creates one all-day event per open dated reminder, none for the undated to-do',
  r.ok && brainEvents().length === 2 && brainEvents().every((e) => e.start.date && e.extendedProperties.private.brainFile.startsWith('Reminders/'))
  && !brainEvents().some((e) => /gutters/i.test(e.summary)), JSON.stringify(r));
const dentist = brainEvents().find((e) => e.summary === 'Dentist');
chk('the event carries the brain file, the date and a transparent (free) status', dentist.start.date === '2026-10-28' && dentist.end.date === '2026-10-29'
  && dentist.extendedProperties.private.brainFile === 'Reminders/2026-10-28--dentist.md' && dentist.transparency === 'transparent');
r = await syncCalendar(ROOT, NOW);
chk('a second sync is idempotent', r.ok && r.actions.length === 0 && brainEvents().length === 2, JSON.stringify(r.actions));

put('Reminders/2026-10-28--dentist.md', reminder('reminder', 'open', '2026-10-30', 'Dentist', 'Claude Code'));
r = await syncCalendar(ROOT, NOW);
chk('moving the reminder at the desk moves the event', dentist.start.date === '2026-10-30' && r.actions.some((a) => /updated in calendar: 2026-10-30/.test(a)), JSON.stringify(r.actions));

fs.mkdirSync(path.join(ROOT, 'Reminders/Done'), { recursive: true });
fs.renameSync(path.join(ROOT, 'Reminders/2026-10-26--errand.md'), path.join(ROOT, 'Reminders/Done/2026-10-26--errand.md'));
r = await syncCalendar(ROOT, NOW);
chk('closing the reminder removes its event', brainEvents().find((e) => /dry cleaning/.test(e.summary)).status === 'cancelled' && r.actions.some((a) => /^remove/.test(a)), JSON.stringify(r.actions));

console.log('\nCalendar -> brain');
brainEvents().push({ id: 'g1', status: 'confirmed', summary: 'Call the plumber', start: { date: '2026-10-27' }, end: { date: '2026-10-28' }, description: 'Grok added this from the car.' });
brainEvents().push({ id: 'g2', status: 'confirmed', summary: 'Pediatrician 3pm', start: { dateTime: '2026-10-29T15:00:00-04:00' }, end: { dateTime: '2026-10-29T15:30:00-04:00' }, location: 'Main St' });
brainEvents().push({ id: 'g3', status: 'confirmed', summary: 'Dentist', start: { date: '2026-10-30' }, end: { date: '2026-10-31' } });
r = await syncCalendar(ROOT, NOW);
const plumber = read('Reminders/2026-10-27--call-the-plumber.md');
chk('a foreign all-day event becomes a reminder file with the event id and the description', /- \*\*Kind:\*\* reminder/.test(plumber) && /- \*\*Due:\*\* 2026-10-27/.test(plumber)
  && /Grok added this from the car/.test(plumber) && /Calendar event: g1/.test(plumber) && /Author:\*\* calendar/.test(plumber), plumber);
const ped = read('Reminders/2026-10-29--pediatrician-3pm.md');
chk('a timed event keeps its time and place', /- \*\*Due:\*\* 2026-10-29 15:00/.test(ped) && /Where: Main St/.test(ped), ped);
chk('the adopted events now carry their brain file', brainEvents().find((e) => e.id === 'g1').extendedProperties.private.brainFile === 'Reminders/2026-10-27--call-the-plumber.md');
chk('an event that duplicates a reminder that already has its event (same title and day) is removed, not turned into a second file',
  brainEvents().find((e) => e.id === 'g3').status === 'cancelled' && !fs.existsSync(path.join(ROOT, 'Reminders/2026-10-30--dentist.md'))
  && r.actions.some((a) => /^remove  duplicate event "Dentist"/.test(a)), JSON.stringify(r.actions));
chk('exactly one live Dentist event remains', brainEvents().filter((e) => e.summary === 'Dentist' && e.status !== 'cancelled').length === 1);

const g1 = brainEvents().find((e) => e.id === 'g1');
g1.start = { date: '2026-10-31' }; g1.end = { date: '2026-11-01' };
r = await syncCalendar(ROOT, NOW);
chk('moving the event in the calendar moves the reminder', /- \*\*Due:\*\* 2026-10-31/.test(read('Reminders/2026-10-27--call-the-plumber.md'))
  && /- Moved: .* via Google Calendar/.test(read('Reminders/2026-10-27--call-the-plumber.md')), read('Reminders/2026-10-27--call-the-plumber.md'));

brainEvents().find((e) => e.id === 'g2').status = 'cancelled';
r = await syncCalendar(ROOT, NOW);
chk('deleting the event closes the reminder into Done', !fs.existsSync(path.join(ROOT, 'Reminders/2026-10-29--pediatrician-3pm.md'))
  && /- Closed: .* via Google Calendar \(event removed\)/.test(read('Reminders/Done/2026-10-29--pediatrician-3pm.md')));
r = await syncCalendar(ROOT, NOW);
chk('steady state is quiet again', r.ok && r.actions.length === 0, JSON.stringify(r.actions));

console.log('\nMonth view');
G.events['me@example.com'] = [
  { id: 'p1', status: 'confirmed', summary: 'Standup', start: { dateTime: '2026-10-27T09:30:00-04:00' }, end: { dateTime: '2026-10-27T09:45:00-04:00' } },
  { id: 'p2', status: 'confirmed', summary: 'Declined thing', start: { dateTime: '2026-10-27T11:00:00-04:00' }, end: { dateTime: '2026-10-27T12:00:00-04:00' }, attendees: [{ self: true, responseStatus: 'declined' }] },
  { id: 'p3', status: 'confirmed', summary: 'Invite', start: { dateTime: '2026-10-28T13:00:00-04:00' }, end: { dateTime: '2026-10-28T14:00:00-04:00' }, attendees: [{ self: true, responseStatus: 'needsAction' }] },
];
G.events['fam@group.calendar.google.com'] = [{ id: 'f1', status: 'confirmed', summary: 'Anniversary dinner', start: { date: '2026-10-24' }, end: { date: '2026-10-25' } }];
const view = await calendarView(NOW);
chk('the view lists every selected calendar, marks the brain one, and groups events by day',
  view.connected && view.calendars.length === 3 && view.calendars.some((c) => c.brain) && view.days['2026-10-24']?.[0].calendar === 'Family'
  && view.days['2026-10-27']?.length === 1 && view.days['2026-10-27'][0].time === '09:30', JSON.stringify(view).slice(0, 300));
chk('declined invitations are left out, pending ones are flagged', !JSON.stringify(view).includes('Declined thing') && view.days['2026-10-28'].some((e) => e.invite && e.response === 'needsAction'));
chk('brain events show up with their file', view.days['2026-10-31']?.some((e) => e.brain && e.brainFile === 'Reminders/2026-10-27--call-the-plumber.md'), JSON.stringify(view.days['2026-10-31']));

console.log('\nTokens and disconnect');
G.tokenCalls++;  // the fake now expects a newer token: the next call must refresh once and succeed
r = await syncCalendar(ROOT, NOW);
chk('an expired access token is refreshed transparently', r.ok, JSON.stringify(r));
chk('the fake never saw a secret in a URL', !G.log.some((l) => /sec|rt1/.test(l)));
disconnect();
chk('disconnect forgets the token and the calendar id', !calendarStatus().connected && !calendarStatus().brainCalendarId);
r = await syncCalendar(ROOT, NOW);
chk('sync without a connection is a clean no', r.ok === false && /not connected/.test(r.error));

fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(CONF, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
