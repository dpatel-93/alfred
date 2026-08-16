// --- greeting.mjs -----------------------------------------------------------
// The HUD's spoken welcome: composition, and the endpoint that serves it.
//
// Two halves, deliberately. The pure half asserts what the briefing SAYS in the
// states that matter — a tool server down, a stale index, the first greeting
// ever — none of which a healthy machine can reproduce on demand. The live half
// asserts only that the endpoint is wired, gated, and silent when asked to be.
//
//   node brain/test/greeting.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { composeGreeting, parseMcpList, recentNoteTitles, spokenList, spokenServerName, spokenTitle } from '../greeting.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const PORT = 7913;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const chk = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -- ${detail}`}`);
};

// --- Parsing `claude mcp list` ---------------------------------------------

const SAMPLE = [
  'Checking MCP server health…',
  '',
  'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected',
  'plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✘ Failed to connect — HTTP 400: bad request',
  'claude.ai Aha!: https://big.aha.io/api/v1/mcp - ! Needs authentication',
  'tradingview: C:\\Users\\dishi\\.local\\bin\\tradingview-mcp.exe  - ✔ Connected',
].join('\n');

const parsed = parseMcpList(SAMPLE);
chk('parses one entry per server, ignoring the header', parsed.length === 4, `got ${parsed.length}`);
chk('a colon-laden plugin name survives intact',
  parsed[1].name === 'plugin:github:github', parsed[1].name);
chk('a Windows path as the target does not break the split',
  parsed[3].name === 'tradingview' && parsed[3].state === 'connected', JSON.stringify(parsed[3]));
chk('states are read from the words',
  parsed.map((s) => s.state).join(',') === 'connected,failed,auth,connected',
  parsed.map((s) => s.state).join(','));

// The glyphs are the part a console codepage mangles. Reading a mangled cross
// as healthy is the only failure here that costs anything, so it is asserted.
const mangled = parseMcpList('a: x - ? Failed to connect\nb: y - ? Connected');
chk('a mangled tick still reads as connected', mangled[1].state === 'connected', mangled[1].state);
chk('a mangled cross does NOT read as connected', mangled[0].state === 'failed', mangled[0].state);
chk('an unrecognised verdict is failed, not healthy',
  parseMcpList('c: z - something nobody has seen')[0].state === 'failed');

// --- Small spoken helpers ---------------------------------------------------

chk('spokenList reads two items with "and"', spokenList(['a', 'b']) === 'a and b', spokenList(['a', 'b']));
chk('spokenList reads three with a comma then "and"',
  spokenList(['a', 'b', 'c']) === 'a, b and c', spokenList(['a', 'b', 'c']));
chk('spokenList of one has no connector', spokenList(['a']) === 'a');
chk('spokenList of none is empty', spokenList([]) === '');
chk('spokenServerName drops the plugin prefixes',
  spokenServerName('plugin:github:github') === 'github', spokenServerName('plugin:github:github'));
chk('spokenServerName unpicks separators',
  spokenServerName('microsoft-learn') === 'microsoft learn', spokenServerName('microsoft-learn'));

chk('recentNoteTitles is newest first and capped',
  recentNoteTitles([
    { title: 'old', mtime: 1 }, { title: 'newest', mtime: 9 },
    { title: 'mid', mtime: 5 }, { title: 'oldest', mtime: 0 },
  ], 2).join(',') === 'newest,mid');
chk('recentNoteTitles tolerates a note with no mtime',
  recentNoteTitles([{ title: 'a' }, { title: 'b', mtime: 5 }], 1).join(',') === 'b');

// The regression that the first live greeting actually exhibited: the memory
// mirror is rewritten wholesale, so its files are always the newest and always
// uninteresting. "What's new" must mean what the operator changed.
chk('machine-mirrored folders never win "newest"',
  recentNoteTitles([
    { title: 'SessionLog', folder: 'Claude-Code', mtime: 100 },
    { title: 'MEMORY', folder: 'Claude-Code', mtime: 100 },
    { title: 'Real work', folder: 'Patterns', mtime: 50 },
  ], 3).join(',') === 'Real work');
// Vault filing conventions vs. speech. Every one of these came off a real note.
chk('a leading date stamp is not read aloud',
  spokenTitle('2026-08-16 — OmniRoute as a gated reserve provider')
    === 'OmniRoute as a gated reserve provider',
  spokenTitle('2026-08-16 — OmniRoute as a gated reserve provider'));
chk('an ASCII double dash becomes a pause, not a word',
  spokenTitle('2026-08-10 -- Graphify Evaluation') === 'Graphify Evaluation',
  spokenTitle('2026-08-10 -- Graphify Evaluation'));
// Cut at a word boundary AND not left dangling: "...Provenance Not the" ends on
// words that promise a noun which never arrives, and sounds like an interruption.
chk('a long title is cut at a word boundary with no dangling filler',
  spokenTitle('2026-08-10 -- Graphify Evaluation, Adopt Edge Provenance Not the Tool')
    === 'Graphify Evaluation, Adopt Edge Provenance',
  spokenTitle('2026-08-10 -- Graphify Evaluation, Adopt Edge Provenance Not the Tool'));
chk('a trailing comma left by the trim is removed too',
  !/[,;:]$/.test(spokenTitle('One, two, three, four, five, six, seven, eight, nine, and ten')),
  spokenTitle('One, two, three, four, five, six, seven, eight, nine, and ten'));
chk('a short title is left completely alone',
  spokenTitle('Windows fire-and-forget from a hook') === 'Windows fire-and-forget from a hook',
  spokenTitle('Windows fire-and-forget from a hook'));
chk('a single hyphen inside a word is preserved',
  spokenTitle('fire-and-forget') === 'fire-and-forget');
chk('a title that is only a date still says something',
  spokenTitle('2026-08-16') === '2026-08-16', spokenTitle('2026-08-16'));
chk('titles reach the greeting already spoken-ready',
  recentNoteTitles([{ title: '2026-08-16 — A Decision', folder: 'Decisions', mtime: 5 }])
    .join(',') === 'A Decision');

chk('recentNoteTitles does not mutate the array it is given', (() => {
  const notes = [{ title: 'a', mtime: 1 }, { title: 'b', mtime: 9 }];
  recentNoteTitles(notes);
  return notes[0].title === 'a';
})());

// --- Composition ------------------------------------------------------------

const BASE_ARGS = {
  name: 'Batman',
  now: new Date(2026, 0, 1, 9, 0, 0),      // 09:00 — a fixed clock, not the real one
  counts: { skill: 91, command: 36, agents: 89 },
  notes: 154,
  indexStale: false,
  mcpServers: [{ name: 'a', state: 'connected' }, { name: 'b', state: 'connected' }],
  recent: ['Alfred', 'Tickr'],
  returning: true,
};

const healthy = composeGreeting(BASE_ARGS);
chk('greets by name at the right time of day', healthy.startsWith('Good morning, Batman.'), healthy.slice(0, 40));
chk('says welcome back to a returning operator', healthy.includes('Welcome back.'));
chk('counts what is ready', healthy.includes('91 skills, 36 commands and 89 agents ready.'), healthy);
chk('reports a clean bill of health', healthy.includes('All 2 tool servers connected.'), healthy);
chk('reports the brain', healthy.includes('The brain holds 154 notes, index fresh.'), healthy);
chk('names what is new', healthy.includes('Newest in the brain: Alfred and Tickr.'), healthy);

chk('first ever greeting says Welcome, not Welcome back',
  composeGreeting({ ...BASE_ARGS, returning: false }).includes('Welcome.'));
chk('afternoon and evening are distinguished',
  composeGreeting({ ...BASE_ARGS, now: new Date(2026, 0, 1, 14, 0) }).startsWith('Good afternoon')
  && composeGreeting({ ...BASE_ARGS, now: new Date(2026, 0, 1, 21, 0) }).startsWith('Good evening'));

const broken = composeGreeting({
  ...BASE_ARGS,
  mcpServers: [
    { name: 'claude.ai Gmail', state: 'connected' },
    { name: 'plugin:github:github', state: 'failed' },
    { name: 'claude.ai Aha!', state: 'auth' },
  ],
});
chk('a broken server is counted out of the total', broken.includes('1 of 3 tool servers connected.'), broken);
chk('a failure is named and described', broken.includes('github is down'), broken);
chk('an auth prompt is described differently from a failure',
  broken.includes('Aha! needs signing in'), broken);

chk('a stale index is flagged, not glossed over',
  composeGreeting({ ...BASE_ARGS, indexStale: true }).includes('the index is stale'));

// null means "not probed yet" and [] means "none configured" — a real finding.
chk('an unprobed MCP state says so rather than claiming health',
  composeGreeting({ ...BASE_ARGS, mcpServers: null }).includes('Still checking the tool connections.'));
chk('zero configured servers is reported as a finding',
  composeGreeting({ ...BASE_ARGS, mcpServers: [] }).includes('No tool servers are configured.'));

chk('a singular count is not pluralised',
  composeGreeting({ ...BASE_ARGS, notes: 1, counts: { skill: 1, command: 0, agents: 0 } })
    .includes('1 skill ready.'));
chk('an empty vault still produces a greeting',
  composeGreeting({ ...BASE_ARGS, notes: 0, counts: {}, recent: [] }).includes('The brain holds 0 notes'));

// --- The live endpoint ------------------------------------------------------

const stamp = `alfred-greeting-test-${process.pid}`;
const vault = path.join(os.tmpdir(), stamp);
fs.mkdirSync(path.join(vault, 'Projects'), { recursive: true });
fs.writeFileSync(path.join(vault, 'Projects', 'Probe.md'), '# Probe\n\nA note that exists.\n', 'utf8');

const statePath = path.join(vault, 'greeting-state.json');
const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    ALFRED_VAULT: vault,
    // Both redirected. Redirecting only the vault is what let an earlier test
    // rebuild the REAL index against a throwaway one.
    ALFRED_INDEX: path.join(vault, 'test-index.json'),
    ALFRED_GREETING_STATE: statePath,
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

    // Speaking is a side effect, so the endpoint sits behind the same gate as
    // the rest of the bridge. An unauthenticated page must not be able to make
    // the machine talk.
    const noToken = await fetch(`${BASE}/api/greeting`, { method: 'POST', body: '{}' });
    chk('greeting is token-gated', noToken.status === 403, `got ${noToken.status}`);

    const headers = { 'X-Alfred-Token': token, 'Content-Type': 'application/json' };
    // speak:false throughout — a test suite must never make the machine talk.
    const r = await fetch(`${BASE}/api/greeting`, { method: 'POST', headers, body: JSON.stringify({ speak: false }) });
    const body = await r.json().catch(() => ({}));
    chk('greeting endpoint answers', r.status === 200, `got ${r.status}`);
    chk('greeting carries text', typeof body.text === 'string' && body.text.length > 20, JSON.stringify(body).slice(0, 200));
    chk('speak:false does not speak', body.spoke === false, JSON.stringify(body).slice(0, 200));
    chk('the live greeting counts the real vault', /The brain holds \d+ notes?/.test(body.text || ''), body.text);

    // First call records the visit; the second must notice.
    chk('first greeting of a fresh machine is a Welcome', /Welcome\./.test(body.text || ''), body.text);
    const again = await (await fetch(`${BASE}/api/greeting`, { method: 'POST', headers, body: JSON.stringify({ speak: false }) })).json();
    chk('second greeting is a Welcome back', /Welcome back\./.test(again.text || ''), again.text);
    chk('greeting state was written to the override path, not the real one',
      fs.existsSync(statePath));

    const method = await fetch(`${BASE}/api/greeting`, { headers });
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
// The sentinel run.mjs parses. Without it a suite is reported as CRASHED no
// matter how green it looked when run on its own — the contract is the line,
// not the exit code.
console.log('__ALFRED_RESULTS__' + JSON.stringify(results.map((r) => ({ n: r.name, ok: r.ok, d: r.detail }))));
process.exitCode = bad.length > 0 ? 1 : 0;
