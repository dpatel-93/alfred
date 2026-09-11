// Browser terminals: a real PTY (node-pty / ConPTY) behind a token-gated
// WebSocket. Boots its own server with ALFRED_TERM_STUB_CMD, a small node
// script that echoes what it is sent, so the whole path — spawn, attach,
// scrollback, input, resize, kill, drop — is exercised without a signed-in CLI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const R = [];
const chk = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-term-'));
const echoScript = 'process.stdout.write("ALFRED_TERM_OK\\n");'
  + 'process.stdin.setEncoding("utf8");'
  + 'process.stdin.on("data",function(d){process.stdout.write("GOT:"+d);if(d.indexOf("quit")!==-1)process.exit(3);});';

const PORT = Number(process.env.ALFRED_TERM_TEST_PORT || 7797);
const B = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(HERE, 'fixtures', 'vault'),
    ALFRED_INDEX: path.join(stub, 'index.json'),
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
    ALFRED_COUNCIL_HELPER: HELPER,
    ALFRED_COUNCIL_STUB_DIR: stub,
    ALFRED_PROVIDERS: REGISTRY,
    ALFRED_TERM_STUB_CMD: JSON.stringify([process.execPath, '-e', echoScript]),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
function stopServer() {
  try { server.kill(); } catch { /* gone */ }
  if (process.platform === 'win32' && server.pid) {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); } catch { /* dead */ }
  }
}
process.on('exit', stopServer);

async function j(p, o) { const r = await fetch(B + p, o); let d = null; try { d = await r.json(); } catch { /* not json */ } return { s: r.status, d }; }
async function up() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(B + '/api/status')).ok) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opens a socket and collects every message; resolves helpers to wait for text.
function attach(id, token) {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${PORT}/ws/terminal/${id}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url, { origin: `http://127.0.0.1:${PORT}` });
    const msgs = [];
    let text = '';
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); msgs.push(m); if (m.type === 'data') text += m.data; if (m.type === 'hello') text += m.scrollback || ''; });
    ws.on('open', () => resolve({
      ws, msgs,
      text: () => text,
      until: async (needle, ms = 15000) => { const d = Date.now() + ms; while (Date.now() < d) { if (text.includes(needle)) return true; await sleep(100); } return false; },
      untilType: async (type, ms = 15000) => { const d = Date.now() + ms; while (Date.now() < d) { if (msgs.some((m) => m.type === type)) return true; await sleep(100); } return false; },
      send: (m) => ws.send(JSON.stringify(m)),
    }));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)));
  });
}

if (!(await up())) {
  chk('terminals test server boots', false, serverLog.slice(-600));
} else {
  const html = await (await fetch(B + '/')).text();
  const TOKEN = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1];
  const H = { 'X-Alfred-Token': TOKEN, 'Content-Type': 'application/json' };
  const G = { headers: { 'X-Alfred-Token': TOKEN } };

  // --- vendor assets ---
  const xt = await fetch(B + '/vendor/xterm/xterm.js');
  chk('GET /vendor/xterm/xterm.js serves the library', xt.status === 200 && /javascript/.test(xt.headers.get('content-type') || '') && (await xt.text()).length > 10000, `got ${xt.status}`);
  const css = await fetch(B + '/vendor/xterm/xterm.css');
  chk('GET /vendor/xterm/xterm.css serves the stylesheet', css.status === 200 && /text\/css/.test(css.headers.get('content-type') || ''), `got ${css.status}`);
  const trav = await fetch(B + '/vendor/xterm/..%2Fpackage.json');
  chk('vendor route is an allowlist, not a directory', trav.status === 404, `got ${trav.status}`);
  chk('page loads xterm from the vendor route', html.includes('/vendor/xterm/xterm.js') && html.includes('id="cc-terms"'), 'markup');

  // --- create ---
  const noTok = await fetch(B + '/api/terminals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"provider":"claude"}' });
  chk('POST /api/terminals without token blocked', noTok.status === 401 || noTok.status === 403, `got ${noTok.status}`);
  const badId = await j('/api/terminals', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'nope!' }) });
  chk('POST /api/terminals rejects a malformed provider id', badId.s === 400, `got ${badId.s}`);
  const unknown = await j('/api/terminals', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'nope' }) });
  chk('POST /api/terminals for an unknown seat -> 404', unknown.s === 404, `got ${unknown.s}`);
  const created = await j('/api/terminals', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'claude', cols: 90, rows: 25 }) });
  const t = created.d?.terminal;
  chk('POST /api/terminals spawns a real console', created.s === 200 && t && /^term\d+$/.test(t.id) && t.status === 'running' && t.pid > 0 && t.cols === 90 && t.rows === 25 && t.provider === 'claude', JSON.stringify(created.d).slice(0, 200));
  const listNoTok = await fetch(B + '/api/terminals');
  chk('GET /api/terminals without token blocked', listNoTok.status === 401 || listNoTok.status === 403, `got ${listNoTok.status}`);
  const list = await j('/api/terminals', G);
  chk('GET /api/terminals lists the console', list.s === 200 && list.d.terminals.some((x) => x.id === t.id), `got ${list.s}`);

  // --- websocket gate ---
  let refused = null;
  try { await attach(t.id, 'wrong-token'); refused = 'connected'; } catch (e) { refused = e.message; }
  chk('WebSocket with a wrong token is refused', /403/.test(refused), refused);
  let badOrigin = null;
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal/${t.id}?token=${encodeURIComponent(TOKEN)}`, { origin: 'http://evil.example' });
      ws.on('open', () => { badOrigin = 'connected'; ws.close(); resolve(); });
      ws.on('unexpected-response', (_r, res) => { badOrigin = `http ${res.statusCode}`; resolve(); });
      ws.on('error', (e) => { badOrigin = e.message; resolve(); });
    });
  } catch (e) { badOrigin = e.message; }
  chk('WebSocket from a foreign origin is refused', /403/.test(badOrigin), badOrigin);
  let missing = null;
  try { await attach('term999', TOKEN); missing = 'connected'; } catch (e) { missing = e.message; }
  chk('WebSocket to an unknown terminal is refused', /404/.test(missing), missing);

  // --- attach, io, resize ---
  const a = await attach(t.id, TOKEN);
  chk('attach receives hello with the terminal summary', await a.untilType('hello', 5000) && a.msgs[0].type === 'hello' && a.msgs[0].terminal.id === t.id, JSON.stringify(a.msgs[0]).slice(0, 160));
  chk('console output reaches the page', await a.until('ALFRED_TERM_OK'), a.text().slice(-200));
  a.send({ type: 'input', data: 'hello\r' });
  chk('keystrokes reach the console and its reply comes back', await a.until('GOT:hello'), a.text().slice(-200));
  a.send({ type: 'resize', cols: 120, rows: 40 });
  await sleep(300);
  const afterResize = (await j('/api/terminals', G)).d.terminals.find((x) => x.id === t.id);
  chk('resize over the socket is applied', afterResize && afterResize.cols === 120 && afterResize.rows === 40, JSON.stringify(afterResize));
  const rz = await j(`/api/terminals/${t.id}/resize`, { method: 'POST', headers: H, body: JSON.stringify({ cols: 9999, rows: 1 }) });
  chk('resize over HTTP clamps to sane bounds', rz.s === 200 && rz.d.terminal.cols === 500 && rz.d.terminal.rows === 10, JSON.stringify(rz.d));

  // A second attach sees the scrollback so far — this is what a reload relies on.
  const b = await attach(t.id, TOKEN);
  chk('a second attach replays the scrollback', await b.untilType('hello', 5000) && (b.msgs[0].scrollback || '').includes('ALFRED_TERM_OK') && (b.msgs[0].scrollback || '').includes('GOT:hello'), (b.msgs[0].scrollback || '').slice(-160));
  b.ws.close();

  // --- drop ---
  const dropped = await j(`/api/terminals/${t.id}/drop`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'shot (1).png', data: Buffer.from('png-bytes').toString('base64') }) });
  chk('a dropped file is saved and its path typed into the console', dropped.s === 200 && fs.existsSync(dropped.d.path) && /shot_1_\.png$/.test(dropped.d.path) && await a.until(dropped.d.path), JSON.stringify(dropped.d));
  const dropEmpty = await j(`/api/terminals/${t.id}/drop`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'x.bin', data: '' }) });
  chk('an empty drop is refused', dropEmpty.s === 400, `got ${dropEmpty.s}`);

  // --- exit + kill ---
  a.send({ type: 'input', data: 'quit\r' });
  chk('process exit is announced on the socket with its code', await a.untilType('exit', 15000) && a.msgs.find((m) => m.type === 'exit').code === 3, JSON.stringify(a.msgs.filter((m) => m.type === 'exit')));
  await sleep(200);
  const gone = (await j('/api/terminals', G)).d.terminals.find((x) => x.id === t.id);
  chk('an exited console is listed as exited with its code', gone && gone.status === 'exited' && gone.exitCode === 3, JSON.stringify(gone));
  const killExited = await j(`/api/terminals/${t.id}/kill`, { method: 'POST', headers: H, body: '{}' });
  chk('kill on an exited console is a no-op, not an error', killExited.s === 200 && killExited.d.ok === false, JSON.stringify(killExited.d));
  a.ws.close();

  const c2 = await j('/api/terminals', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'grok' }) });
  const t2 = c2.d?.terminal;
  const k2 = await j(`/api/terminals/${t2.id}/kill`, { method: 'POST', headers: H, body: '{}' });
  await sleep(1500);
  const afterKill = (await j('/api/terminals', G)).d.terminals.find((x) => x.id === t2.id);
  chk('kill stops a running console', k2.s === 200 && k2.d.ok === true && afterKill && afterKill.status === 'exited', JSON.stringify(afterKill));
  const killMissing = await j('/api/terminals/term999/kill', { method: 'POST', headers: H, body: '{}' });
  chk('kill on an unknown console -> 404', killMissing.s === 404, `got ${killMissing.s}`);
}

stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch { /* temp */ }

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
