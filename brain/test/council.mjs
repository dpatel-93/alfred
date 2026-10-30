// Council helper + the seat routes the dashboard still has.
//
// The helper (council-run.mjs, also the source of the seat list) runs against a stub directory
// (ALFRED_COUNCIL_STUB_DIR) so the whole pipeline is exercised without spending a token or needing
// a sign-in. The dashboard's own council and multi-seat window are gone; what is left over HTTP is
// the sign-in route behind the startup check and the "Open AI terminal" button's routes.
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
  chk('seats are the host, the CLIs and ollama — never the gateway or a removed seat', ['claude', 'gemini', 'grok', 'ollama'].every((id) => ids.includes(id)) && !['omniroute', 'codex', 'dsh'].some((id) => ids.includes(id)), ids.join(','));
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

  // --- Open AI terminal: the installed AI command-line tools, and opening one ---
  // Stub mode marks every registry seat installed and ready, so the list is deterministic.
  const listNoTok = await j('/api/claude/open-terminal');
  chk('GET /api/claude/open-terminal without token blocked', listNoTok.s === 401 || listNoTok.s === 403, `got ${listNoTok.s}`);
  const list = await j('/api/claude/open-terminal', G);
  const offered = (list.d?.providers || []).map((p) => p.id);
  chk('GET lists the CLIs with an interactive entry: claude, gemini and grok', list.s === 200 && ['claude', 'gemini', 'grok'].every((id) => offered.includes(id)), JSON.stringify(list.d));
  chk('ollama is not offered: `ollama run` needs a model, so it has no interactive entry', !offered.includes('ollama'), offered.join(','));
  chk('the list carries a label per tool and no binary path or launch command',
    list.s === 200 && list.d.providers.every((p) => typeof p.label === 'string' && p.label && Object.keys(p).sort().join() === 'id,label'), JSON.stringify(list.d?.providers?.[0]));

  const otNoTok = await fetch(B + '/api/claude/open-terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"provider":"claude"}' });
  chk('POST /api/claude/open-terminal without token blocked', otNoTok.status === 401 || otNoTok.status === 403, `got ${otNoTok.status}`);
  const otGrok = await j('/api/claude/open-terminal', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'grok' }) });
  chk('POST (dry run) for grok launches only its own command, fresh and not resumed',
    otGrok.s === 200 && otGrok.d.dryRun && otGrok.d.provider === 'grok' && JSON.stringify(otGrok.d.argv) === '["stub:grok"]' && otGrok.d.resumed === false, JSON.stringify(otGrok.d));
  const otClaude = await j('/api/claude/open-terminal', { method: 'POST', headers: H, body: '{}' });
  const argvC = otClaude.d?.argv || [];
  chk('POST with no provider defaults to claude, which resumes only when an idle session exists',
    otClaude.s === 200 && otClaude.d.provider === 'claude' && argvC[0] === 'stub:claude'
      && (otClaude.d.resumed ? argvC.join() === `stub:claude,--resume,${otClaude.d.sessionId}` : argvC.length === 1), JSON.stringify(otClaude.d));
  const otExtra = await j('/api/claude/open-terminal', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'gemini', argv: ['calc.exe'], launch: ['calc.exe'], command: 'calc' }) });
  chk('extra fields in the body never reach the command that is run', otExtra.s === 200 && JSON.stringify(otExtra.d.argv) === '["stub:gemini"]', JSON.stringify(otExtra.d));
  for (const bad of ['nope!', 'claude --dangerously-skip-permissions', '../claude', 'Claude']) {
    const r = await j('/api/claude/open-terminal', { method: 'POST', headers: H, body: JSON.stringify({ provider: bad }) });
    chk(`POST rejects the provider id "${bad}" before anything is looked up`, r.s === 400, `got ${r.s}`);
  }
  const otNope = await j('/api/claude/open-terminal', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'nope' }) });
  chk('POST for a well-formed id that is not in the registry -> 404', otNope.s === 404, `got ${otNope.s}`);
  const otOllama = await j('/api/claude/open-terminal', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'ollama' }) });
  chk('POST for ollama (no interactive entry) -> 404', otOllama.s === 404, `got ${otOllama.s}`);
  const otBadJson = await j('/api/claude/open-terminal', { method: 'POST', headers: H, body: '{not json' });
  chk('POST with a body that is not JSON -> 400', otBadJson.s === 400, `got ${otBadJson.s}`);

  // --- sign-in (the startup check's Sign in button) ---
  const signNoTok = await fetch(B + '/api/command-center/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"provider":"claude"}' });
  chk('POST /api/command-center/signin without token blocked', signNoTok.status === 401 || signNoTok.status === 403, `got ${signNoTok.status}`);
  const signClaude = await j('/api/command-center/signin', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'claude' }) });
  chk('POST signin (dry run) opens `claude auth login`', signClaude.s === 200 && signClaude.d.dryRun && signClaude.d.argv.slice(-2).join(' ') === 'auth login', JSON.stringify(signClaude.d));
  const signOllama = await j('/api/command-center/signin', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'ollama' }) });
  chk('POST signin for a seat with no console flow -> 409', signOllama.s === 409, `got ${signOllama.s}`);
  const signNope = await j('/api/command-center/signin', { method: 'POST', headers: H, body: JSON.stringify({ provider: 'nope' }) });
  chk('POST signin for an unknown seat -> 404', signNope.s === 404, `got ${signNope.s}`);
}

stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch { /* temp */ }

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
