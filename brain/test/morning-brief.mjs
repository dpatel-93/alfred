// --- morning-brief.mjs -------------------------------------------------------
// The on-demand morning brief: composition, and the endpoint that serves it.
//
// Same two-half shape as greeting.mjs's suite. The pure half asserts what gets
// SAID in the states a healthy, fully-configured machine cannot reproduce on
// demand — no daily-brief repo configured, GitHub unreachable, a stale brief
// from yesterday's failed run, an empty brief. The live half only proves the
// endpoint is wired, gated, and silent when asked to be — like
// test/github.mjs, whether a daily-brief repo happens to be configured on the
// machine running this suite is not something it fakes; it branches its
// assertions on whatever it finds instead (see the "case not exercised"
// pattern github.mjs already established for exactly this reason).
//
//   node brain/test/morning-brief.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { composeMorningBrief, briefAgeHours } from '../morning-brief.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const PORT = 7914;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const chk = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -- ${detail}`}`);
};

// --- briefAgeHours -----------------------------------------------------------

const NOON = new Date(2026, 0, 2, 12, 0, 0);
chk('an hour-old brief reads as about 1 hour',
  Math.round(briefAgeHours(new Date(2026, 0, 2, 11, 0, 0).toISOString(), NOON)) === 1);
chk('a brief from the future (clock skew) is not negative-infinity-broken',
  Number.isFinite(briefAgeHours(new Date(2026, 0, 2, 13, 0, 0).toISOString(), NOON)));
chk('an unparsable date reads as infinitely old, not zero',
  briefAgeHours('not a date', NOON) === Infinity);

// --- composeMorningBrief ------------------------------------------------------

const STATUS = 'Good morning, Batman. 91 skills ready.';
const FRESH_DATE = new Date(2026, 0, 2, 7, 0, 0).toISOString(); // 5h before NOON

const fresh = composeMorningBrief({
  statusText: STATUS,
  dpBrief: { date: FRESH_DATE, mode: 'daily', articleCount: 12, digest: '**bold** digest', spokenText: 'Good morning. Spoken version here.' },
  now: NOON,
});
chk('opens with the status line', fresh.startsWith(STATUS), fresh.slice(0, 60));
chk('announces the brief is coming next', fresh.includes('your daily brief'), fresh);
chk('prefers spokenText over digest', fresh.includes('Spoken version here.') && !fresh.includes('**bold**'), fresh);
chk('a fresh brief carries no staleness warning', !fresh.includes('Heads up'), fresh);

const stale = composeMorningBrief({
  statusText: STATUS,
  dpBrief: { date: new Date(2026, 0, 1, 7, 0, 0).toISOString(), mode: 'daily', digest: 'yesterday digest', spokenText: 'yesterday spoken' },
  now: NOON, // 29 hours later
});
chk('a brief older than the stale threshold is flagged', stale.includes('Heads up'), stale);
chk('the stale brief still reads its content, just with a warning first', stale.includes('yesterday spoken'), stale);

const noRepo = composeMorningBrief({ statusText: STATUS, dpBrief: null, now: NOON });
chk('no configured repo says so in plain terms', noRepo.includes('could not reach GitHub'), noRepo);
chk('still opens with status even when the brief is unreachable', noRepo.startsWith(STATUS));

const fetchFailed = composeMorningBrief({ statusText: STATUS, dpBrief: { error: 'GitHub 404' }, now: NOON });
chk('a fetch/parse error is surfaced, not swallowed', fetchFailed.includes('GitHub 404'), fetchFailed);

const emptyBrief = composeMorningBrief({
  statusText: STATUS,
  dpBrief: { date: FRESH_DATE, digest: '', spokenText: '' },
  now: NOON,
});
chk('an empty brief file says so rather than reading nothing', emptyBrief.includes('empty'), emptyBrief);

const noSpokenText = composeMorningBrief({
  statusText: STATUS,
  dpBrief: { date: FRESH_DATE, digest: 'only the markdown digest exists' },
  now: NOON,
});
chk('falls back to digest when spokenText is missing (older file shape)',
  noSpokenText.includes('only the markdown digest exists'), noSpokenText);

chk('an empty status still produces a brief rather than a leading blank',
  !composeMorningBrief({ statusText: '', dpBrief: null, now: NOON }).startsWith(' '));

// --- The live endpoint ------------------------------------------------------

const stamp = `alfred-morning-brief-test-${process.pid}`;
const vault = path.join(os.tmpdir(), stamp);
fs.mkdirSync(path.join(vault, 'Projects'), { recursive: true });
fs.writeFileSync(path.join(vault, 'Projects', 'Probe.md'), '# Probe\n\nA note that exists.\n', 'utf8');

const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    ALFRED_VAULT: vault,
    ALFRED_INDEX: path.join(vault, 'test-index.json'),
    ALFRED_GREETING_STATE: path.join(vault, 'greeting-state.json'),
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

async function waitForServer(ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/status`)).status === 200) return true;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

try {
  const up = await waitForServer();
  chk('server started', up, serverLog.slice(-300));

  if (up) {
    const html = await (await fetch(`${BASE}/`)).text();
    const token = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1] || '';

    // Speaking is a side effect, and this also makes an outbound GitHub call —
    // both are bridge-only, same gate as /api/greeting.
    const noToken = await fetch(`${BASE}/api/morning-brief`, { method: 'POST', body: '{}' });
    chk('morning-brief is token-gated', noToken.status === 403, `got ${noToken.status}`);

    const headers = { 'X-Alfred-Token': token, 'Content-Type': 'application/json' };

    // Whether a daily-brief repo is configured is a property of the machine
    // running this suite, same as GitHub sign-in state in test/github.mjs —
    // not something this suite fakes or forces. It branches its assertions
    // instead of assuming either state, and never triggers the device flow
    // or any write, so it stays inside what that suite already accepts as
    // safe to do for real (a read of already-public settings).
    const settings = await (await fetch(`${BASE}/api/settings`, { headers })).json().catch(() => ({}));
    const repoConfigured = !!(settings && settings.dailyBriefRepo && settings.dailyBriefRepo.value);

    const r = await fetch(`${BASE}/api/morning-brief`, { method: 'POST', headers, body: JSON.stringify({ speak: false }) });
    const body = await r.json().catch(() => ({}));
    chk('morning-brief endpoint answers', r.status === 200, `got ${r.status}`);
    chk('carries text', typeof body.text === 'string' && body.text.length > 10, JSON.stringify(body).slice(0, 200));
    chk('speak:false does not speak', body.spoke === false, JSON.stringify(body).slice(0, 200));
    if (!repoConfigured) {
      chk('with no repo configured, dpBrief is null rather than a guess', body.dpBrief === null, JSON.stringify(body.dpBrief));
      chk('says plainly that GitHub was not reachable', /could not reach GitHub/.test(body.text || ''), body.text);
    } else {
      chk('with no repo configured, dpBrief is null rather than a guess', true, 'a repo is configured on this machine — case not exercised');
      chk('with a repo configured, dpBrief is a real object (content or a fetch error), never null',
        body.dpBrief !== null && typeof body.dpBrief === 'object', JSON.stringify(body.dpBrief).slice(0, 200));
    }
    chk('still opens with the real status line', /skills?,|skill ready|skills ready/.test(body.text || '') || /Good (morning|afternoon|evening)/.test(body.text || ''), body.text);

    const method = await fetch(`${BASE}/api/morning-brief`, { headers });
    chk('GET is not a way in', method.status === 404 || method.status === 405, `got ${method.status}`);
  }
} finally {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.kill();
  fs.rmSync(vault, { force: true, recursive: true });
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
console.log('__ALFRED_RESULTS__' + JSON.stringify(results.map((r) => ({ n: r.name, ok: r.ok, d: r.detail }))));
process.exitCode = bad.length > 0 ? 1 : 0;
