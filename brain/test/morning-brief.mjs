// --- morning-brief.mjs -------------------------------------------------------
// The on-demand morning brief: composition, and the endpoint that serves it.
//
// Same two-half shape as greeting.mjs's suite. The pure half asserts what gets
// SAID in the states a healthy machine cannot reproduce on demand — no brief in
// the shared brain, an unreadable brain, a stale brief (weekend, or Grok has not
// run yet), a brief with nothing to read. The live half points the server at a
// throwaway shared brain holding one known brief, and proves the endpoint is
// wired, gated, silent when asked to be, and reads Grok's file — never GitHub
// and never a live Grok search.
//
//   node brain/test/morning-brief.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { composeMorningBrief, composeMorningBriefParagraphs, spokenBrief } from '../morning-brief.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const PORT = 7914;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const chk = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -- ${detail}`}`);
};

// --- spokenBrief ---------------------------------------------------------------

const BRIEF_MD = [
  '# Morning brief, Friday',
  '',
  '- Coordinator: Grok Bot | Date: 2026-01-02 | Last updated: 2026-01-02 7:10 AM ET | Retention: 5 days',
  '',
  '## Top of the brief',
  '1. **Firewalls need patching.** A hotfix lands today. Second sentence is not read.',
  '2. **Tech sold off.** The index fell.',
  '',
  '## Cloud, security and AI',
  '1. **Palo Alto hotfix dates.**',
  '   - Detail bullet that is not read aloud.',
  '   - Sources: https://example.com/a | https://example.com/b',
  '2. **Entra token replay**',
  '',
  '## Climate and weather',
  '- **Central Jersey:** Mild and dry.',
  '- Sources: https://example.com/c',
  '',
  '## Sports',
  '1. **Giants at Texans, Sunday 1 PM ET,**',
].join('\n');

const spoken = spokenBrief(BRIEF_MD);
chk('the Top items are read in full: headline plus one sentence',
  spoken[0] === 'Firewalls need patching. A hotfix lands today.', spoken[0]);
chk('other sections are read as headlines only, after their title',
  spoken.includes('Cloud, security and AI. Palo Alto hotfix dates. Entra token replay.'), JSON.stringify(spoken));
chk('sources, urls and sub-bullets are never read aloud', !/https?:|Sources|Detail bullet/.test(spoken.join(' ')), spoken.join(' '));
chk('a bullet-only section reads its first sentences', spoken.some((p) => p.startsWith('Climate and weather. Central Jersey')),
  JSON.stringify(spoken));
chk('stray trailing punctuation is tidied into a full stop',
  spoken.includes('Sports. Giants at Texans, Sunday 1 PM ET.'), JSON.stringify(spoken));
chk('the metadata line before the first section is skipped', !spoken.join(' ').includes('Coordinator'));

// --- composeMorningBrief ------------------------------------------------------

const STATUS = 'Good morning, Batman. Due today: nothing.';
const FRESH = { file: 'Outputs/briefs/2026-01-02.md', date: '2026-01-02', isToday: true, markdown: BRIEF_MD };

const fresh = composeMorningBrief({ statusText: STATUS, brief: FRESH });
chk('opens with the status line', fresh.startsWith(STATUS), fresh.slice(0, 60));
chk("announces Grok's brief next", fresh.includes("Now, Grok's morning brief."), fresh);
chk('a fresh brief carries no staleness warning', !fresh.includes('Heads up'), fresh);

const stale = composeMorningBrief({ statusText: STATUS, brief: { ...FRESH, isToday: false } });
chk('a brief from an earlier day is flagged with its weekday', stale.includes("this is Friday's"), stale);
chk('the stale brief still reads its content after the warning', stale.includes('Firewalls need patching.'), stale);

const none = composeMorningBrief({ statusText: STATUS, brief: null });
chk('no brief at all says so in plain terms', none.includes('no morning brief from Grok'), none);
chk('still opens with status when there is no brief', none.startsWith(STATUS));

const unreadable = composeMorningBrief({ statusText: STATUS, brief: { error: 'the shared brain is not reachable' } });
chk('a read error is surfaced, not swallowed', unreadable.includes('could not be read: the shared brain is not reachable'), unreadable);

const empty = composeMorningBrief({ statusText: STATUS, brief: { ...FRESH, markdown: '# Morning brief\n\nNothing yet.\n' } });
chk('a brief with nothing to read says so', empty.includes('nothing to read out'), empty);

chk('an empty status still produces a brief rather than a leading blank',
  !composeMorningBrief({ statusText: '', brief: null }).startsWith(' '));

const paragraphs = composeMorningBriefParagraphs({ statusText: STATUS, brief: FRESH });
chk('composeMorningBriefParagraphs returns an array', Array.isArray(paragraphs), JSON.stringify(paragraphs));
chk('the status line is its own paragraph', paragraphs[0] === STATUS, JSON.stringify(paragraphs));
chk('joining the paragraphs reproduces composeMorningBrief', paragraphs.join(' ') === fresh);

// --- The live endpoint ------------------------------------------------------

const stamp = `alfred-morning-brief-test-${process.pid}`;
const vault = path.join(os.tmpdir(), stamp);
fs.mkdirSync(path.join(vault, 'Projects'), { recursive: true });
fs.writeFileSync(path.join(vault, 'Projects', 'Probe.md'), '# Probe\n\nA note that exists.\n', 'utf8');

// A throwaway shared brain with one brief, dated far in the past so it is
// always "the latest, not today's" whatever day the suite runs.
const brain = path.join(vault, 'shared-brain');
fs.mkdirSync(path.join(brain, 'Outputs', 'briefs'), { recursive: true });
fs.mkdirSync(path.join(brain, 'Reminders'), { recursive: true });
fs.writeFileSync(path.join(brain, 'Outputs', 'briefs', '2026-01-02.md'), BRIEF_MD, 'utf8');

const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    ALFRED_VAULT: vault,
    ALFRED_INDEX: path.join(vault, 'test-index.json'),
    ALFRED_GREETING_STATE: path.join(vault, 'greeting-state.json'),
    ALFRED_SHARED_BRAIN: brain,
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

    // Speaking is a side effect — bridge-only, same gate as /api/greeting.
    const noToken = await fetch(`${BASE}/api/morning-brief`, { method: 'POST', body: '{}' });
    chk('morning-brief is token-gated', noToken.status === 403, `got ${noToken.status}`);

    const headers = { 'X-Alfred-Token': token, 'Content-Type': 'application/json' };
    const r = await fetch(`${BASE}/api/morning-brief`, { method: 'POST', headers, body: JSON.stringify({ speak: false }) });
    const body = await r.json().catch(() => ({}));
    chk('morning-brief endpoint answers', r.status === 200, `got ${r.status}`);
    chk('carries text', typeof body.text === 'string' && body.text.length > 10, JSON.stringify(body).slice(0, 200));
    chk('speak:false does not speak', body.spoke === false, JSON.stringify(body).slice(0, 200));
    chk("reads Grok's brief from the shared brain", body.brief?.file === 'Outputs/briefs/2026-01-02.md'
      && body.brief.markdown === BRIEF_MD, JSON.stringify(body.brief).slice(0, 200));
    chk('the spoken text carries the brief', /Firewalls need patching\./.test(body.text || ''), body.text);
    chk('an old brief is flagged as not today', body.brief?.isToday === false && /Heads up/.test(body.text || ''), body.text);
    chk('the status leaves out its own brief line', !/Grok's brief:/.test(body.statusText || ''), body.statusText);
    chk('no GitHub digest or live search fields remain', !('dpBrief' in body) && !('worldPulse' in body), Object.keys(body).join(','));
    chk('still opens with the real status line', /Good (morning|afternoon|evening)/.test(body.text || ''), body.text);
    chk('carries paragraphs as a real array, not just the joined text',
      Array.isArray(body.paragraphs) && body.paragraphs.length > 0, JSON.stringify(body.paragraphs).slice(0, 200));
    chk('joining the paragraphs reproduces the flat text field',
      typeof body.paragraphs === 'object' && body.paragraphs.join(' ') === body.text);
    chk('speak:false means no audio URL either', body.audioUrl === null, JSON.stringify(body.audioUrl));

    const method = await fetch(`${BASE}/api/morning-brief`, { headers });
    chk('GET is not a way in', method.status === 404 || method.status === 405, `got ${method.status}`);

    // Browser-playable audio: the endpoint's own gate (query token, since an
    // <audio src> cannot carry a header) and its "nothing rendered yet"
    // response, without triggering a real TTS synthesis call in this suite.
    const audioNoToken = await fetch(`${BASE}/api/morning-brief/audio`);
    chk('morning-brief audio is gated too', audioNoToken.status === 403, `got ${audioNoToken.status}`);

    const audioBadToken = await fetch(`${BASE}/api/morning-brief/audio?token=not-the-real-token`);
    chk('a wrong token does not get in either', audioBadToken.status === 403, `got ${audioBadToken.status}`);

    const audioNoneRendered = await fetch(`${BASE}/api/morning-brief/audio?token=${token}`);
    chk('with speak:false above, no audio has been rendered yet', audioNoneRendered.status === 404, `got ${audioNoneRendered.status}`);
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
