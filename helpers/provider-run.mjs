#!/usr/bin/env node
// Alfred provider dispatch — run a prompt on ANY registered model provider and log the usage.
// The registry (providers.json) is the only place vendor specifics live, so adding a provider
// is a data edit, not a code change.
//
// Usage: node provider-run.mjs <provider> "<prompt>" [--role manager] [--model X] [--effort Y]
//        cat file.md | node provider-run.mjs gemini "Summarize in 5 bullets:"
//        node provider-run.mjs --list
//
// APPROVAL: providers marked approval:"ask-per-use" must have the operator's explicit yes for
// THIS call before this script is run. Being logged in is not permission. See home CLAUDE.md.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// --- Configuration ---

const isWin = process.platform === 'win32';
const home = os.homedir();
const registryPath = path.join(home, '.claude', 'helpers', 'providers.json');
const metricsDir = path.join(home, '.claude', 'metrics');
const TIMEOUT_MS = Number(process.env.ALFRED_PROVIDER_TIMEOUT_MS ?? 600_000);

function loadRegistry() {
  if (!fs.existsSync(registryPath)) die(`registry not found at ${registryPath}`, 1);
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}

function die(msg, code) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

// Registry paths use ~ and %VAR% so one file works on every platform.
function expandPath(p) {
  let out = p.replace(/^~/, home);
  out = out.replace(/%([A-Z_]+)%/gi, (_, v) => process.env[v] ?? '');
  return path.normalize(out);
}

// --- Argument parsing ---

function parseArgs(argv) {
  const opts = { role: null, model: null, effort: null, list: false };
  const words = [];
  let provider = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') { opts.list = true; continue; }
    if (a === '--role' && argv[i + 1]) { opts.role = argv[++i]; continue; }
    if (a === '--model' && argv[i + 1]) { opts.model = argv[++i]; continue; }
    if (a === '--effort' && argv[i + 1]) { opts.effort = argv[++i]; continue; }
    if (!provider) { provider = a; continue; }
    words.push(a);
  }
  return { provider, opts, prompt: words.join(' ') };
}

function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// --- Binary resolution ---

// Always resolve to an ABSOLUTE path so the provider is spawned with shell:false. Spawning
// through a shell on Windows concatenates argv unescaped, which silently shreds any prompt
// containing spaces or punctuation — the model then answers a fragment and looks fine doing it.
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

// --- Response parsing (envelope shape differs per vendor and per version) ---

function extractResponse(stdout) {
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* provider returned plain text */ }
  if (!parsed) return { text: stdout, inTokens: 0, outTokens: 0, model: null };

  const usage = parsed.usage ?? parsed.metadata?.usage ?? parsed.stats ?? {};
  const text = parsed.response ?? parsed.text ?? parsed.result ?? parsed.output ?? parsed.content ?? stdout;
  return {
    text: typeof text === 'string' ? text : JSON.stringify(text),
    inTokens: usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0,
    outTokens: usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0,
    model: parsed.model ?? parsed.metadata?.model ?? null,
  };
}

// --- Transports ---

function runCli(spec, prompt, model, effort) {
  const bin = resolveBin(spec);
  if (!bin) {
    die(`'${spec.bin}' not found on PATH or at any known install location.\n` +
        `  Not installed yet, or this shell predates the install and has a stale PATH.\n` +
        `  Sign in with: ${spec.loginCmd}`, 2);
  }
  const h = spec.headless ?? {};
  const argv = [
    ...(h.argv ?? []).map((a) => a.replace('{prompt}', prompt)),
    ...(h.jsonArgv ?? []),
    ...(model && h.modelFlag ? [h.modelFlag, model] : []),
    ...(effort && h.effortFlag ? [h.effortFlag, effort] : []),
  ];
  const run = spawnSync(bin, argv, { encoding: 'utf8', shell: false, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (run.error || run.status !== 0) {
    console.error(`error: ${spec.label} exited ${run.status ?? 'signal'} — ${run.error?.message ?? ''}`);
    if (run.stderr) console.error(run.stderr.slice(0, 2000));
    process.exit(3);
  }
  return extractResponse(run.stdout ?? '');
}

async function runOllama(spec, prompt, model) {
  if (!model) die(`ollama needs a model — pass --model or --role (registry has no default for that role)`, 1);
  const res = await fetch(spec.endpoint, {
    method: 'POST',
    body: JSON.stringify({ model, prompt, stream: false }),
  }).catch(() => null);
  if (!res?.ok) die(`ollama unreachable (${res?.status ?? 'no response'}) — is 'ollama serve' running?`, 2);
  const j = await res.json();
  return { text: j.response ?? '', inTokens: j.prompt_eval_count ?? 0, outTokens: j.eval_count ?? 0, model };
}

// --- Usage logging (ollama keeps its own log so existing reporting stays intact) ---

function logUsage(providerId, spec, record) {
  fs.mkdirSync(metricsDir, { recursive: true });
  if (spec.transport === 'ollama-http') {
    fs.appendFileSync(path.join(metricsDir, 'ollama-usage.jsonl'), JSON.stringify({
      ts: record.ts, model: record.model,
      prompt_eval_count: record.in_tokens, eval_count: record.out_tokens,
      duration_ms: record.duration_ms,
    }) + '\n');
    return;
  }
  fs.appendFileSync(path.join(metricsDir, 'peer-usage.jsonl'),
    JSON.stringify({ provider: providerId, ...record }) + '\n');
}

// --- Main ---

const registry = loadRegistry();
const { provider, opts, prompt: argPrompt } = parseArgs(process.argv.slice(2));

if (opts.list || !provider) {
  console.log('Registered providers:\n');
  for (const [id, s] of Object.entries(registry)) {
    const gate = s.approval === 'ask-per-use' ? 'ASK FIRST' : 'no gate';
    console.log(`  ${id.padEnd(9)} ${String(s.cost).padEnd(13)} ${gate.padEnd(10)} ${s.label}`);
  }
  console.log(`\nusage: provider-run.mjs <provider> "<prompt>" [--role R] [--model M] [--effort E]`);
  process.exit(opts.list ? 0 : 1);
}

const spec = registry[provider];
if (!spec) die(`unknown provider '${provider}' — known: ${Object.keys(registry).join(', ')}`, 1);
if (spec.transport === 'host') {
  die(`'${provider}' is the HOST that runs Alfred — reach it through the Agent tool, not provider-run.`, 1);
}

const prompt = [argPrompt, readStdin()].filter(Boolean).join('\n\n');
if (!prompt.trim()) die('empty prompt (pass text as an argument or on stdin)', 1);

// --model wins over --role; --role looks the model up in the registry for this provider.
const model = opts.model ?? (opts.role ? spec.roles?.[opts.role] ?? null : null);
if (opts.role && !spec.roles?.hasOwnProperty(opts.role)) {
  die(`unknown role '${opts.role}' — known: ${Object.keys(spec.roles ?? {}).join(', ')}`, 1);
}

const started = Date.now();
const out = spec.transport === 'ollama-http'
  ? await runOllama(spec, prompt, model)
  : runCli(spec, prompt, model, opts.effort);

process.stdout.write(out.text);

logUsage(provider, spec, {
  ts: new Date().toISOString(),
  model: out.model ?? model ?? 'default',
  role: opts.role ?? null,
  in_tokens: out.inTokens,
  out_tokens: out.outTokens,
  prompt_chars: prompt.length,
  response_chars: out.text.length,
  duration_ms: Date.now() - started,
});
