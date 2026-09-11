// Council + Command Center.
//
// The helper runs against a stub directory (ALFRED_COUNCIL_STUB_DIR) so the
// whole pipeline is exercised without spending a token or needing a sign-in.
// The HTTP half boots its OWN throwaway server: the shared test server is
// started before any suite runs, so it cannot carry the stub env this needs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const R = [];
const chk = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-council-'));
fs.writeFileSync(path.join(stub, 'claude.txt'), 'Claude says: use Terraform.\n');
fs.writeFileSync(path.join(stub, 'grok.txt'), 'Grok says: everyone on X uses Terraform.\n');
fs.writeFileSync(path.join(stub, 'synthesis.txt'), '## Where they agree\nTerraform.\n## Verdict\nTerraform, verified.\n');
// gemini.txt is deliberately absent: that seat must fail without sinking the council.
const env = { ...process.env, ALFRED_COUNCIL_STUB_DIR: stub, ALFRED_PROVIDERS: REGISTRY };

function helper(args, input) {
  const r = spawnSync(process.execPath, [HELPER, ...args], { env, encoding: 'utf8', input, timeout: 60000 });
  const events = (r.stdout || '').split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', events };
}

// --- helper: status ---
{
  const r = helper(['--status', '--json']);
  let seats = [];
  try { seats = JSON.parse(r.stdout).seats; } catch { /* asserted below */ }
  const ids = seats.map((s) => s.id);
  chk('--status --json exits 0 and lists seats', r.status === 0 && ids.length > 0, `exit ${r.status} ids=${ids}`);
  chk('seats are the host, the CLIs, ollama and the local harness — never the gateway', ['claude', 'gemini', 'grok', 'codex', 'ollama', 'dsh'].every((id) => ids.includes(id)) && !ids.includes('omniroute'), ids.join(','));
  chk('stub mode marks every seat ready', seats.every((s) => s.ready), JSON.stringify(seats.map((s) => [s.id, s.ready])));
  const claude = seats.find((s) => s.id === 'claude');
  const ollama = seats.find((s) => s.id === 'ollama');
  chk('claude seat carries a console sign-in (claude auth login) and model suggestions', claude && Array.isArray(claude.signin) && claude.signin.slice(-2).join(' ') === 'auth login' && claude.models.includes('opus') && claude.councilModel === 'sonnet', JSON.stringify(claude && { signin: claude.signin, models: claude.models }));
  chk('ollama seat has no sign-in, launches `ollama run`, takes the model positionally', ollama && ollama.signin === null && ollama.launch.slice(-1)[0] === 'run' && ollama.modelPositional === true && ollama.councilModel, JSON.stringify(ollama && { signin: ollama.signin, launch: ollama.launch, mp: ollama.modelPositional }));
}

// --- helper: per-seat models and the chair model reach the seats ---
{
  const r = helper(['--json', 'Q', '--providers', 'claude,gemini', '--models', 'claude=opus', '--synth-model', 'haiku']);
  const start = r.events.find((e) => e.type === 'start');
  const claude = r.events.find((e) => e.type === 'answer' && e.provider === 'claude');
  const synth = r.events.find((e) => e.type === 'synthesis');
  chk('--models overrides one seat and the registry default fills the other', start && start.models.claude === 'opus' && start.models.gemini === 'gemini-3.7-flash-high', JSON.stringify(start && start.models));
  chk('the chosen model reaches the seat', claude && claude.model === 'stub:opus', JSON.stringify(claude && claude.model));
  chk('--synth-model picks who chairs', synth && synth.model === 'stub:haiku' && start.synthModel === 'haiku', JSON.stringify(synth && synth.model));
  const bad = helper(['--json', 'Q', '--providers', 'claude', '--models', 'claude=not a model']);
  chk('a malformed model id is refused', bad.status === 1 && /invalid model id/.test(bad.stderr), `exit ${bad.status}`);
}

// --- helper: a full council with one failing seat ---
{
  const r = helper(['--json', 'Which IaC tool?', '--providers', 'claude,gemini,grok']);
  const types = r.events.map((e) => e.type);
  const start = r.events.find((e) => e.type === 'start');
  const claude = r.events.find((e) => e.type === 'answer' && e.provider === 'claude');
  const grok = r.events.find((e) => e.type === 'answer' && e.provider === 'grok');
  const gem = r.events.find((e) => e.type === 'error' && e.provider === 'gemini');
  const synth = r.events.find((e) => e.type === 'synthesis');
  const done = r.events.find((e) => e.type === 'done');
  chk('council exits 0 when at least one seat answered', r.status === 0, `exit ${r.status} ${r.stderr.slice(0, 200)}`);
  chk('start event names the chosen seats', start && start.providers.join(',') === 'claude,gemini,grok' && start.synthesize === true, JSON.stringify(start));
  chk('claude seat answers from the stub', claude && claude.text.includes('Terraform') && claude.label === 'Claude (Anthropic)', JSON.stringify(claude));
  chk('grok seat answers from the stub', grok && grok.text.includes('everyone on X'), JSON.stringify(grok));
  chk('a seat with no answer errors without stopping the others', gem && /stub missing/.test(gem.message), JSON.stringify(gem));
  chk('the verdict is emitted after the answers', synth && synth.text.includes('Verdict') && types.indexOf('synthesis') > types.lastIndexOf('answer'), types.join('>'));
  chk('done reports answered/seats', done && done.answered === 2 && done.seats === 3, JSON.stringify(done));
}

// --- helper: --no-synth, stdin, bad input ---
{
  const r = helper(['--json', '--no-synth', 'Q', '--providers', 'claude']);
  chk('--no-synth emits no verdict', r.status === 0 && !r.events.some((e) => e.type === 'synthesis'), r.events.map((e) => e.type).join('>'));
  const s = helper(['--json', 'Head', '--providers', 'claude'], 'body on stdin');
  const st = s.events.find((e) => e.type === 'start');
  chk('stdin is appended to the argv question', st && st.question === 'Head\n\nbody on stdin', JSON.stringify(st && st.question));
  const h = helper(['Which IaC tool?', '--providers', 'claude,grok']);
  chk('human mode prints a COUNCIL VERDICT section', h.status === 0 && h.stdout.includes('COUNCIL VERDICT') && h.stdout.includes('Claude (Anthropic)'), h.stdout.slice(0, 200));
  const bad = helper(['--json', 'Q', '--providers', 'omniroute']);
  chk('a non-seat provider is refused', bad.status === 1 && /not a council seat/.test(bad.stderr), `exit ${bad.status} ${bad.stderr.slice(0, 120)}`);
  const empty = helper(['--json', '--providers', 'claude']);
  chk('an empty question is refused', empty.status === 1 && /empty question/.test(empty.stderr), `exit ${empty.status}`);
}

// --- HTTP: own server with the stub wired in ---
const PORT = Number(process.env.ALFRED_COUNCIL_TEST_PORT || 7798);
const B = `http://127.0.0.1:${PORT}`;
const indexTmp = path.join(stub, 'index.json');
const server = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs')], {
  env: {
    ...env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(HERE, 'fixtures', 'vault'),
    ALFRED_INDEX: indexTmp,
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
    ALFRED_COUNCIL_HELPER: HELPER,
    ALFRED_CC_DRY_RUN: '1',
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

if (!(await up())) {
  chk('council test server boots', false, serverLog.slice(-500));
} else {
  const html = await (await fetch(B + '/')).text();
  const TOKEN = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1];
  const H = { 'X-Alfred-Token': TOKEN, 'Content-Type': 'application/json' };
  const G = { headers: { 'X-Alfred-Token': TOKEN } };

  const noTok = await j('/api/command-center/seats');
  chk('GET /api/command-center/seats without token blocked', noTok.s === 401 || noTok.s === 403, `got ${noTok.s}`);
  const seats = await j('/api/command-center/seats', G);
  chk('GET /api/command-center/seats lists ready seats', seats.s === 200 && seats.d.seats.some((s) => s.id === 'claude' && s.ready), JSON.stringify(seats.d).slice(0, 200));
  chk('seat payload carries no binary path', seats.s === 200 && seats.d.seats.every((s) => !('bin' in s)), Object.keys(seats.d.seats[0] || {}).join(','));

  const openNoTok = await fetch(B + '/api/command-center/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  chk('POST /api/command-center/open without token blocked', openNoTok.status === 401 || openNoTok.status === 403, `got ${openNoTok.status}`);
  const badId = await j('/api/command-center/open', { method: 'POST', headers: H, body: JSON.stringify({ providers: ['nope!'] }) });
  chk('POST open rejects a malformed provider id', badId.s === 400, `got ${badId.s}`);
  const two = await j('/api/command-center/open', { method: 'POST', headers: H, body: JSON.stringify({ providers: ['claude', 'grok'] }) });
  const argv2 = two.d?.argv || [];
  chk('POST open (dry run) builds one wt window with two panes', two.s === 200 && two.d.dryRun && argv2[0] === '-w' && argv2[1] === 'new' && argv2.filter((a) => a === 'split-pane').length === 1 && argv2.includes('0.500'), JSON.stringify(argv2));
  chk('panes are titled by seat label', argv2.includes('Claude (Anthropic)') && argv2.includes('Grok (xAI, via Grok Build CLI)'), JSON.stringify(argv2));
  const lane = await j('/api/command-center/open', { method: 'POST', headers: H, body: JSON.stringify({ providers: ['grok'], lane: true }) });
  const argvL = lane.d?.argv || [];
  chk('a lane open targets the shared named window and adds one pane', lane.s === 200 && lane.d.lane && argvL[0] === '-w' && argvL[1] === 'alfred-command-center' && argvL[2] === 'split-pane' && !argvL.includes('new-tab') && argvL.includes('Grok (xAI, via Grok Build CLI)'), JSON.stringify(argvL));
  const all = await j('/api/command-center/open', { method: 'POST', headers: H, body: JSON.stringify({}) });
  const argvAll = all.d?.argv || [];
  const sizes = argvAll.filter((a) => /^0\.\d{3}$/.test(a));
  // k-th split takes (n-k)/(n-k+1) of what is left — derived from the seat count so a new
  // registry entry does not silently invalidate this assertion.
  const nReady = seats.d.seats.filter((s) => s.ready).length;
  const expected = Array.from({ length: nReady - 1 }, (_, i) => ((nReady - 1 - i) / (nReady - i)).toFixed(3)).join(',');
  chk('POST open with no list uses every ready seat, equal columns', all.s === 200 && argvAll.filter((a) => a === 'split-pane').length === nReady - 1 && sizes.join(',') === expected, `${sizes.join(',')} vs ${expected} (n=${nReady})`);

  // --- per-seat model config, sign-in ---
  const cfgNoTok = await fetch(B + '/api/command-center/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  chk('POST /api/command-center/config without token blocked', cfgNoTok.status === 401 || cfgNoTok.status === 403, `got ${cfgNoTok.status}`);
  const cfgBad = await j('/api/command-center/config', { method: 'POST', headers: H, body: JSON.stringify({ models: { claude: 'not a model' } }) });
  chk('POST config rejects a malformed model id', cfgBad.s === 400, `got ${cfgBad.s}`);
  const cfgEmpty = await j('/api/command-center/config', { method: 'POST', headers: H, body: JSON.stringify({}) });
  chk('POST config with nothing to update -> 400', cfgEmpty.s === 400, `got ${cfgEmpty.s}`);
  const cfgOk = await j('/api/command-center/config', { method: 'POST', headers: H, body: JSON.stringify({ models: { claude: 'opus' }, synthModel: 'haiku' }) });
  chk('POST config saves a seat model and the chair model', cfgOk.s === 200 && cfgOk.d.models.claude === 'opus' && cfgOk.d.synthModel === 'haiku', JSON.stringify(cfgOk.d));
  chk('config landed in the test config dir, not the real one', fs.existsSync(path.join(stub, 'cfg', 'config.json')), path.join(stub, 'cfg', 'config.json'));
  const seats2 = await j('/api/command-center/seats', G);
  const claudeSeat = seats2.d?.seats.find((s) => s.id === 'claude');
  const geminiSeat = seats2.d?.seats.find((s) => s.id === 'gemini');
  chk('GET seats reflects the override, the default and the chair', claudeSeat?.model === 'opus' && claudeSeat?.defaultModel === 'sonnet' && geminiSeat?.model === 'gemini-3.7-flash-high' && seats2.d.synthModel === 'haiku', JSON.stringify({ c: claudeSeat?.model, g: geminiSeat?.model, s: seats2.d?.synthModel }));
  const openModel = await j('/api/command-center/open', { method: 'POST', headers: H, body: JSON.stringify({ providers: ['claude', 'ollama'] }) });
  const argvM = openModel.d?.argv || [];
  const iClaude = argvM.indexOf('--model');
  chk('panes open with the chosen model: a flag for claude, positional after `ollama run`', iClaude > 0 && argvM[iClaude + 1] === 'opus' && argvM.indexOf('run') > 0 && /^[\w.:-]+$/.test(argvM[argvM.indexOf('run') + 1]), JSON.stringify(argvM));
  const cfgClear = await j('/api/command-center/config', { method: 'POST', headers: H, body: JSON.stringify({ models: { claude: '' } }) });
  chk('blank model clears the override', cfgClear.s === 200 && !('claude' in cfgClear.d.models), JSON.stringify(cfgClear.d));

  const signNoTok = await fetch(B + '/api/command-center/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"provider":"claude"}' });
  chk('POST /api/command-center/signin without token blocked', signNoTok.status === 401 || signNoTok.status === 403, `got ${signNoTok.status}`);
  const signClaude = await j('/api/command-center/signin', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'claude' }) });
  chk('POST signin (dry run) opens `claude auth login`', signClaude.s === 200 && signClaude.d.dryRun && signClaude.d.argv.slice(-2).join(' ') === 'auth login', JSON.stringify(signClaude.d));
  const signOllama = await j('/api/command-center/signin', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'ollama' }) });
  chk('POST signin for a seat with no console flow -> 409', signOllama.s === 409, `got ${signOllama.s}`);
  const signNope = await j('/api/command-center/signin', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'nope' }) });
  chk('POST signin for an unknown seat -> 404', signNope.s === 404, `got ${signNope.s}`);

  const askNoTok = await fetch(B + '/api/council', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  chk('POST /api/council without token blocked', askNoTok.status === 401 || askNoTok.status === 403, `got ${askNoTok.status}`);
  const noQ = await j('/api/council', { method: 'POST', headers: H, body: JSON.stringify({ providers: ['claude'] }) });
  chk('POST /api/council without a question -> 400', noQ.s === 400, `got ${noQ.s}`);
  const noSeats = await j('/api/council', { method: 'POST', headers: H, body: JSON.stringify({ question: 'Q', providers: [] }) });
  chk('POST /api/council without seats -> 400', noSeats.s === 400, `got ${noSeats.s}`);

  const ask = await j('/api/council', { method: 'POST', headers: H, body: JSON.stringify({ question: 'Which IaC tool?', providers: ['claude', 'gemini', 'grok'] }) });
  chk('POST /api/council -> 202 with a run id and queued seats', ask.s === 202 && /^council\d+$/.test(ask.d.id) && ask.d.status === 'running' && Object.keys(ask.d.seats).length === 3, JSON.stringify(ask.d).slice(0, 200));
  let run = ask.d;
  const deadline = Date.now() + 20000;
  while (run && run.status === 'running' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    run = (await j('/api/council/' + ask.d.id, G)).d;
  }
  chk('council run completes', run && run.status === 'done', JSON.stringify(run).slice(0, 300));
  chk('run carries each seat answer', run && run.seats.claude.status === 'done' && run.seats.claude.text.includes('Terraform') && run.seats.grok.status === 'done', JSON.stringify(run && run.seats).slice(0, 300));
  chk('a failed seat is reported, not hidden', run && run.seats.gemini.status === 'error' && /stub missing/.test(run.seats.gemini.error), JSON.stringify(run && run.seats.gemini));
  chk('run carries the verdict', run && run.synthesis && run.synthesis.status === 'done' && run.synthesis.text.includes('verified'), JSON.stringify(run && run.synthesis));
  chk('the saved chair model and the registry seat default reached the council', run && run.synthesis.model === 'stub:haiku' && run.seats.claude.model === 'stub:sonnet', JSON.stringify(run && { synth: run.synthesis.model, claude: run.seats.claude.model }));

  const list = await j('/api/council', G);
  chk('GET /api/council lists runs', list.s === 200 && list.d.runs.some((r) => r.id === ask.d.id), `got ${list.s}`);
  const missing = await j('/api/council/nope', G);
  chk('GET /api/council/<unknown> -> 404', missing.s === 404, `got ${missing.s}`);
  const getNoTok = await fetch(B + '/api/council/' + ask.d.id);
  chk('GET /api/council/<id> without token blocked', getNoTok.status === 401 || getNoTok.status === 403, `got ${getNoTok.status}`);
}

stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch { /* temp */ }

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
