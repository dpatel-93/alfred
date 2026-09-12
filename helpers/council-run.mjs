#!/usr/bin/env node
// Alfred council — one question, every signed-in AI seat answers in parallel, then Claude
// chairs: where they agree, where they disagree, and a verdict. This is the engine behind the
// HUD's Command Center and it runs the same way from any terminal.
//
// Usage: node council-run.mjs "<question>"                        # every ready seat + verdict
//        node council-run.mjs "<question>" --providers claude,grok
//        node council-run.mjs "<question>" --models claude=opus,gemini=gemini-3.1-pro-high
//        node council-run.mjs "<question>" --synth-model haiku     # who chairs (default sonnet)
//        node council-run.mjs "<question>" --no-synth              # raw answers only
//        cat brief.md | node council-run.mjs "Review this:"        # stdin is appended
//        node council-run.mjs --json "<question>"                  # NDJSON events (the HUD)
//        node council-run.mjs --status [--json]                    # who can sit right now
//
// APPROVAL: gemini / grok / codex are approval:"ask-per-use" in providers.json. Naming them
// here — or ticking them in the HUD — for THIS question is the operator's yes for this call.
// The selection is explicit and printed before anything leaves the machine; nothing in this
// file adds a seat the operator did not choose.
//
// Claude is the host, so provider-run.mjs refuses it by design. The Claude seat and the
// synthesis are spawned here directly as headless `claude -p` turns. Every other seat goes
// through provider-run.mjs, so providers.json stays the only place vendor specifics live.
//
// ALFRED_COUNCIL_STUB_DIR is TEST-ONLY: when set, seats read <dir>/<provider>.txt and the
// verdict reads <dir>/synthesis.txt instead of spawning anything. It exists so the test suite
// can exercise the whole pipeline without spending a token or needing a sign-in.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

// --- Configuration ---

const isWin = process.platform === 'win32';
const home = os.homedir();
const HELPERS_DIR = path.join(home, '.claude', 'helpers');
const REGISTRY_PATH = process.env.ALFRED_PROVIDERS ?? path.join(HELPERS_DIR, 'providers.json');
const PROVIDER_RUN = process.env.ALFRED_PROVIDER_RUN ?? path.join(HELPERS_DIR, 'provider-run.mjs');
const METRICS_DIR = path.join(home, '.claude', 'metrics');
const STUB_DIR = process.env.ALFRED_COUNCIL_STUB_DIR || null;

const CLAUDE_SEAT_MODEL = process.env.ALFRED_COUNCIL_CLAUDE_MODEL ?? 'sonnet';
const SYNTH_MODEL = process.env.ALFRED_COUNCIL_SYNTH_MODEL ?? 'sonnet';
const TIMEOUT_MS = Number(process.env.ALFRED_COUNCIL_TIMEOUT_MS ?? 600_000);
// Windows caps a command line around 32k characters. Past this the request rides on stdin,
// which both `claude -p` and provider-run.mjs append to the argv prompt.
const ARGV_MAX_CHARS = 20_000;
const MAX_QUESTION_CHARS = 200_000;

// Council seats: the host, every CLI the operator signs into, and the local Ollama models —
// a seat on the operator's own GPU costs nothing and leaves nothing behind. The gateway
// (openai-http) does not get a vote: its answering model is unknowable, which breaks the
// provenance every seat here carries.
const SEAT_TRANSPORTS = new Set(['host', 'cli', 'ollama-http']);

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', grn: '\x1b[32m', red: '\x1b[31m', yel: '\x1b[33m', cyan: '\x1b[36m' };

// --- Registry ---

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) die(`registry not found at ${REGISTRY_PATH}`, 1);
  const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}

function die(msg, code) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

function expandPath(p) {
  return path.normalize(p.replace(/^~/, home).replace(/%([A-Z_]+)%/gi, (_, v) => process.env[v] ?? ''));
}

// --- Seat detection (same artefact-based rules as provider-setup.mjs: never costs a call) ---

function resolveBin(spec) {
  for (const candidate of spec.binFallbacks ?? []) {
    const abs = expandPath(candidate);
    if (fs.existsSync(abs)) return abs;
  }
  const lookup = spawnSync(isWin ? 'where.exe' : 'which', [spec.bin], { encoding: 'utf8', timeout: 20_000 });
  if (lookup.status === 0) {
    const hit = (lookup.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
    if (hit && fs.existsSync(hit)) return hit;
  }
  return null;
}

// `claude` on PATH is an npm shim on Windows, and spawn() with shell:false does no PATHEXT
// lookup — resolve the real executable, exactly as the HUD server does.
function resolveClaudeBin() {
  const candidates = [];
  if (process.env.ALFRED_CLAUDE_BIN) candidates.push(process.env.ALFRED_CLAUDE_BIN);
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  }
  const exe = isWin ? 'claude.exe' : 'claude';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, exe));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* unreadable dir */ }
  }
  return null;
}

function isSignedIn(spec) {
  if (spec.apiKeyEnv && process.env[spec.apiKeyEnv]) return true;
  for (const p of spec.authPaths ?? []) if (fs.existsSync(expandPath(p))) return true;
  return !(spec.authPaths ?? []).length && !spec.apiKeyEnv;
}

function councilStatus(registry) {
  const seats = [];
  for (const [id, spec] of Object.entries(registry)) {
    if (!SEAT_TRANSPORTS.has(spec.transport)) continue;
    const bin = STUB_DIR ? `stub:${id}` : (spec.transport === 'host' ? resolveClaudeBin() : resolveBin(spec));
    const installed = Boolean(bin);
    const signedIn = STUB_DIR ? true : (installed && isSignedIn(spec));
    // How to open this seat interactively in a console pane: an executable runs as-is; an
    // npm-published CLI is a JS entry and runs under this node.
    const exe = !bin ? null : (!STUB_DIR && /\.[cm]?js$/i.test(bin)) ? [process.execPath, bin] : [bin];
    const launch = exe ? [...exe, ...(Array.isArray(spec.launchArgv) ? spec.launchArgv : [])] : null;
    // Interactive sign-in argv, when the provider has a console flow (key-based seats do not).
    const signin = exe && Array.isArray(spec.loginArgv) ? [...exe, ...spec.loginArgv] : null;
    seats.push({
      id, label: spec.label, transport: spec.transport, bin, launch, signin,
      installed, signedIn, ready: installed && signedIn,
      cost: spec.cost, approval: spec.approval, specialism: spec.specialism ?? null,
      loginCmd: spec.loginCmd ?? null, outputContract: spec.outputContract ?? null,
      models: Array.isArray(spec.models) ? spec.models : [],
      councilModel: spec.councilModel ?? null,
      // Every seat is a console (tty) unless the registry says otherwise — dsh's
      // "web" surface runs a real HTTP UI in the browser, not a TUI in the pane.
      surface: spec.surface ?? 'tty',
      webUrl: spec.webUrl ?? null,
      modelFlag: spec.headless?.modelFlag ?? null,
      modelPositional: Boolean(spec.modelPositional),
    });
  }
  return seats;
}

// --- Argument parsing ---

function parseArgs(argv) {
  const opts = { providers: null, synth: true, json: false, status: false, models: {}, synthModel: null };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--status') { opts.status = true; continue; }
    if (a === '--no-synth') { opts.synth = false; continue; }
    if (a === '--providers' && argv[i + 1]) { opts.providers = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); continue; }
    // --models claude=opus,gemini=gemini-3.1-pro-high — per-seat model; unnamed seats use the
    // registry's councilModel, and a seat with neither lets the provider pick.
    if (a === '--models' && argv[i + 1]) {
      for (const pair of argv[++i].split(',')) {
        const [id, model] = pair.split('=').map((s) => s.trim());
        if (id && model) opts.models[id] = model;
      }
      continue;
    }
    if (a === '--synth-model' && argv[i + 1]) { opts.synthModel = argv[++i]; continue; }
    words.push(a);
  }
  return { opts, prompt: words.join(' ') };
}

const MODEL_ID_RE = /^[\w.:-]+$/;

function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// --- Process plumbing ---

function spawnCollect(bin, args, { input = null } = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, args, {
        cwd: home, shell: false, windowsHide: true,
        stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return resolve({ code: null, stdout: '', stderr: '', error: err.message });
    }
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, TIMEOUT_MS);
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ code: null, stdout, stderr, error: err.message }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, error: null }); });
    if (input != null) { proc.stdin.on('error', () => {}); proc.stdin.end(input); }
  });
}

function splitForTransport(prompt) {
  if (prompt.length <= ARGV_MAX_CHARS) return { arg: prompt, stdin: null };
  return { arg: 'The full request follows on stdin.', stdin: prompt };
}

// --- Seats ---

function readStub(name) {
  const p = path.join(STUB_DIR, `${name}.txt`);
  if (!fs.existsSync(p)) throw new Error(`stub missing: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

async function runClaude(prompt, model) {
  const bin = resolveClaudeBin();
  if (!bin) throw new Error('claude CLI not found on PATH');
  const { arg, stdin } = splitForTransport(prompt);
  const run = await spawnCollect(bin, ['-p', arg, '--model', model, '--output-format', 'json'], { input: stdin });
  if (run.error || run.code !== 0) throw new Error(`claude exited ${run.code ?? 'signal'}: ${(run.error ?? run.stderr).slice(0, 500)}`);
  let parsed = null;
  try { parsed = JSON.parse(run.stdout); } catch { /* plain text */ }
  if (!parsed) return { text: run.stdout.trim(), model, inTokens: 0, outTokens: 0 };
  return {
    text: String(parsed.result ?? parsed.text ?? run.stdout).trim(),
    model: Object.keys(parsed.modelUsage ?? {})[0] ?? model,
    inTokens: parsed.usage?.input_tokens ?? 0,
    outTokens: parsed.usage?.output_tokens ?? 0,
  };
}

async function runProvider(id, prompt, model) {
  if (!fs.existsSync(PROVIDER_RUN)) throw new Error(`provider-run.mjs not found at ${PROVIDER_RUN}`);
  const { arg, stdin } = splitForTransport(prompt);
  const args = [PROVIDER_RUN, id, arg, ...(model ? ['--model', model] : [])];
  const run = await spawnCollect(process.execPath, args, { input: stdin });
  if (run.error || run.code !== 0) throw new Error((run.error ?? run.stderr ?? `exit ${run.code}`).trim().slice(0, 500));
  return { text: run.stdout.trim(), model: model ?? null, inTokens: 0, outTokens: 0 };
}

async function runSeat(seat, prompt, model) {
  // The stub echoes the model it was asked for, so a test can prove the choice reached the seat.
  if (STUB_DIR) return { text: readStub(seat.id).trim(), model: `stub:${model ?? 'default'}`, inTokens: 0, outTokens: 0 };
  return seat.transport === 'host'
    ? runClaude(prompt, model ?? CLAUDE_SEAT_MODEL)
    : runProvider(seat.id, prompt, model);
}

// --- Synthesis ---

function buildSynthesisPrompt(question, results, seats) {
  const parts = [
    'You are the chair of a council of AI models. The operator asked one question; each seat',
    'answered independently, without seeing the others. Produce the council\'s verdict.',
    '', 'QUESTION:', question, '',
  ];
  for (const r of results) {
    parts.push(`--- SEAT: ${r.label} [${r.provider}] ---`);
    parts.push(r.error ? `(no answer: ${r.error})` : r.text);
    parts.push('');
  }
  const contracts = seats.filter((s) => s.outputContract).map((s) => `- ${s.id}: ${s.outputContract}`);
  if (contracts.length) parts.push('Provider contracts you must honour:', ...contracts, '');
  parts.push(
    'Write, in this order, using exactly these headings:',
    '## Where they agree',
    '## Where they disagree',
    '## Verdict',
    'The best answer to the question, revised with the strongest points from every seat.',
    'Say what is verified versus a lead still to check.',
    '## Confidence',
    'One line: high, medium or low, and why.',
    'Be concrete. Do not pad. Do not restate the question.',
  );
  return parts.join('\n');
}

async function runSynthesis(question, results, seats, model) {
  if (STUB_DIR) return { text: readStub('synthesis').trim(), model: `stub:${model}`, inTokens: 0, outTokens: 0 };
  return runClaude(buildSynthesisPrompt(question, results, seats), model);
}

// --- Usage logging (provider-run logs its own seats; the Claude turns are logged here) ---

function logClaudeUsage(role, out, promptChars, ms) {
  if (STUB_DIR) return;
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.appendFileSync(path.join(METRICS_DIR, 'peer-usage.jsonl'), JSON.stringify({
      provider: 'claude', ts: new Date().toISOString(), model: out.model, role,
      in_tokens: out.inTokens, out_tokens: out.outTokens,
      prompt_chars: promptChars, response_chars: out.text.length, duration_ms: ms,
    }) + '\n');
  } catch { /* metrics are best-effort */ }
}

function logCouncil(record) {
  if (STUB_DIR) return;
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.appendFileSync(path.join(METRICS_DIR, 'council.jsonl'), JSON.stringify(record) + '\n');
  } catch { /* best-effort */ }
}

// --- Output ---

function makeEmitter(json) {
  if (json) return (ev) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');
  return (ev) => {
    const rule = (t, col) => `\n${col}${C.b}═══ ${t} ═══${C.r}\n`;
    switch (ev.type) {
      case 'start':
        process.stdout.write(`${C.cyan}${C.b}Alfred council${C.r} — ${ev.providers.join(', ')}${ev.synthesize ? ' · Claude chairs' : ' · raw answers'}\n`);
        break;
      case 'answer':
        process.stdout.write(rule(`${ev.label} · ${ev.model ?? 'default'} · ${(ev.ms / 1000).toFixed(1)}s`, C.grn) + ev.text + '\n');
        break;
      case 'error':
        process.stdout.write(rule(`${ev.label} · no answer`, C.red) + `${C.red}${ev.message}${C.r}\n`);
        break;
      case 'synthesis':
        process.stdout.write(rule(`COUNCIL VERDICT · ${ev.model ?? SYNTH_MODEL} · ${(ev.ms / 1000).toFixed(1)}s`, C.yel) + ev.text + '\n');
        break;
      case 'synthesis-error':
        process.stdout.write(rule('COUNCIL VERDICT · failed', C.red) + `${C.red}${ev.message}${C.r}\n`);
        break;
      case 'done':
        process.stdout.write(`\n${C.dim}${ev.answered}/${ev.seats} seats answered in ${(ev.ms / 1000).toFixed(1)}s${C.r}\n`);
        break;
      default: break;
    }
  };
}

function printStatus(seats, json) {
  if (json) { process.stdout.write(JSON.stringify({ seats }) + '\n'); return; }
  console.log(`${C.b}${C.cyan}Council seats on this machine${C.r}\n`);
  for (const s of seats) {
    const state = !s.installed ? `${C.dim}not installed${C.r}` : !s.signedIn ? `${C.yel}not signed in${C.r}` : `${C.grn}ready${C.r}`;
    console.log(`  ${C.b}${s.id.padEnd(8)}${C.r} ${state}   ${C.dim}${s.label}${C.r}`);
    if (s.installed && !s.signedIn && s.loginCmd) console.log(`           ${C.yel}->${C.r} ${s.loginCmd}`);
  }
}

// --- Main ---

const registry = loadRegistry();
const { opts, prompt: argPrompt } = parseArgs(process.argv.slice(2));
const seats = councilStatus(registry);

if (opts.status) { printStatus(seats, opts.json); process.exit(0); }

const question = [argPrompt, readStdin()].filter(Boolean).join('\n\n').trim();
if (!question) die('empty question (pass text as an argument or on stdin)', 1);
if (question.length > MAX_QUESTION_CHARS) die(`question too long (${question.length} chars; max ${MAX_QUESTION_CHARS})`, 1);

let chosen;
if (opts.providers) {
  chosen = [];
  for (const id of opts.providers) {
    const s = seats.find((x) => x.id === id);
    if (!s) die(`'${id}' is not a council seat — seats: ${seats.map((x) => x.id).join(', ')}`, 1);
    if (!s.ready) die(`'${id}' is ${s.installed ? 'not signed in' : 'not installed'}${s.loginCmd ? ` — ${s.loginCmd}` : ''}`, 2);
    chosen.push(s);
  }
} else {
  chosen = seats.filter((s) => s.ready);
}
if (!chosen.length) die('no seat is ready — run with --status to see why', 2);

for (const [id, m] of Object.entries(opts.models)) {
  if (!MODEL_ID_RE.test(m)) die(`invalid model id for ${id}: '${m}'`, 1);
}
const synthModel = opts.synthModel ?? SYNTH_MODEL;
if (!MODEL_ID_RE.test(synthModel)) die(`invalid synthesis model id: '${synthModel}'`, 1);
const modelFor = (seat) => opts.models[seat.id] ?? seat.councilModel ?? null;

const emit = makeEmitter(opts.json);
const started = Date.now();
emit({
  type: 'start', question, providers: chosen.map((s) => s.id), synthesize: opts.synth,
  models: Object.fromEntries(chosen.map((s) => [s.id, modelFor(s)])), synthModel: opts.synth ? synthModel : null,
});

const results = await Promise.all(chosen.map(async (seat) => {
  emit({ type: 'seat', provider: seat.id, label: seat.label, status: 'running', model: modelFor(seat) });
  const t0 = Date.now();
  try {
    const out = await runSeat(seat, question, modelFor(seat));
    const ms = Date.now() - t0;
    if (seat.transport === 'host') logClaudeUsage('council', out, question.length, ms);
    emit({ type: 'answer', provider: seat.id, label: seat.label, text: out.text, model: out.model, ms, inTokens: out.inTokens, outTokens: out.outTokens });
    return { provider: seat.id, label: seat.label, text: out.text, error: null, ms };
  } catch (err) {
    const ms = Date.now() - t0;
    emit({ type: 'error', provider: seat.id, label: seat.label, message: err.message, ms });
    return { provider: seat.id, label: seat.label, text: '', error: err.message, ms };
  }
}));

const answered = results.filter((r) => !r.error);
let synthesis = null;
if (opts.synth && answered.length) {
  const t0 = Date.now();
  try {
    const out = await runSynthesis(question, results, chosen, synthModel);
    const ms = Date.now() - t0;
    logClaudeUsage('council-synth', out, question.length, ms);
    synthesis = { ok: true, ms };
    emit({ type: 'synthesis', text: out.text, model: out.model, ms, inTokens: out.inTokens, outTokens: out.outTokens });
  } catch (err) {
    synthesis = { ok: false, ms: Date.now() - t0 };
    emit({ type: 'synthesis-error', message: err.message });
  }
}

const ms = Date.now() - started;
emit({ type: 'done', seats: chosen.length, answered: answered.length, ms });
logCouncil({
  ts: new Date().toISOString(), question_chars: question.length,
  providers: chosen.map((s) => s.id), answered: answered.map((r) => r.provider),
  errored: results.filter((r) => r.error).map((r) => r.provider),
  synthesis: synthesis ? (synthesis.ok ? 'ok' : 'failed') : 'skipped', duration_ms: ms,
});
process.exit(answered.length ? 0 : 4);
