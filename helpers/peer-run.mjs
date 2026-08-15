#!/usr/bin/env node
// Alfred v4 peer wrapper — runs a prompt on a flat-rate subscription model (Gemini via
// Antigravity CLI, Grok via Grok Build CLI) AND logs usage so usage-report.mjs can show
// peer load next to Claude and the local Ollama interns.
//
// Peers are NOT interns: they are frontier models on a subscription you already pay for,
// so their marginal token cost is zero. They are also NOT trusted: output is reviewed by
// a Claude tier before it ships, same rule as the interns.
//
// Usage: node peer-run.mjs <gemini|grok> "<prompt>" [--model X] [--effort low|medium|high]
//        cat file.md | node peer-run.mjs gemini "Summarize in 5 bullets:"

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// --- Configuration ---

const isWin = process.platform === 'win32';
const home = os.homedir();

// Where each peer lives, how it is invoked headlessly, and how to pin a model / effort.
// Installers do not refresh PATH in an already-open shell, so absolute fallbacks are listed.
const PROVIDERS = {
  gemini: {
    label: 'gemini (antigravity)',
    bin: 'agy',
    fallbacks: [path.join(home, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'), path.join(home, '.agy', 'bin', 'agy')],
    buildArgs: (prompt, o) => [
      '-p', prompt,
      '--output-format', 'json',
      ...(o.model ? ['--model', o.model] : []),
      ...(o.effort ? ['--effort', o.effort] : []),
    ],
  },
  grok: {
    label: 'grok (grok build)',
    bin: 'grok',
    fallbacks: [path.join(home, '.grok', 'bin', 'grok.exe'), path.join(home, '.grok', 'bin', 'grok')],
    buildArgs: (prompt, o) => [
      '-p', prompt,
      '--output-format', 'json',
      ...(o.model ? ['--model', o.model] : []),
    ],
  },
};

const LOG_PATH = path.join(home, '.claude', 'metrics', 'peer-usage.jsonl');
const TIMEOUT_MS = Number(process.env.ALFRED_PEER_TIMEOUT_MS ?? 600_000);

// --- Argument parsing ---

function parseArgs(argv) {
  const [provider, ...rest] = argv;
  const opts = { model: null, effort: null };
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--model' && rest[i + 1]) { opts.model = rest[++i]; continue; }
    if (rest[i] === '--effort' && rest[i + 1]) { opts.effort = rest[++i]; continue; }
    words.push(rest[i]);
  }
  return { provider, opts, prompt: words.join(' ') };
}

function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// --- Binary resolution ---

// Always resolve to an ABSOLUTE path so the peer can be spawned with shell:false.
// Spawning through a shell on Windows concatenates argv without escaping, which silently
// shreds any prompt containing spaces, quotes or colons — the peer then answers a fragment.
function resolveBin(spec) {
  for (const candidate of spec.fallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const lookup = spawnSync(isWin ? 'where.exe' : 'which', [spec.bin], { encoding: 'utf8', timeout: 20_000 });
  if (lookup.status === 0) {
    const hit = (lookup.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
    if (hit && fs.existsSync(hit)) return hit;
  }
  return null;
}

// --- Usage extraction (envelope shapes differ per vendor and per version) ---

function extractUsage(stdout) {
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* plain text response */ }
  if (!parsed) return { text: stdout, inTokens: 0, outTokens: 0, model: null };

  const usage = parsed.usage ?? parsed.metadata?.usage ?? parsed.stats ?? {};
  const text = parsed.response ?? parsed.text ?? parsed.result ?? parsed.output ?? stdout;
  return {
    text: typeof text === 'string' ? text : JSON.stringify(text),
    inTokens: usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0,
    outTokens: usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0,
    model: parsed.model ?? parsed.metadata?.model ?? null,
  };
}

function logUsage(record) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
}

// --- Main ---

const { provider, opts, prompt: argPrompt } = parseArgs(process.argv.slice(2));
const spec = PROVIDERS[provider];
if (!spec) {
  console.error(`usage: peer-run.mjs <${Object.keys(PROVIDERS).join('|')}> "<prompt>" [--model X] [--effort Y]`);
  process.exit(1);
}

const stdin = readStdin();
const prompt = [argPrompt, stdin].filter(Boolean).join('\n\n');
if (!prompt.trim()) { console.error('error: empty prompt (pass text as an argument or on stdin)'); process.exit(1); }

const bin = resolveBin(spec);
if (!bin) {
  console.error(`error: '${spec.bin}' not found on PATH or at any known install location.`);
  console.error(`  ${provider} is not installed yet, or this shell predates the install and has a stale PATH.`);
  process.exit(2);
}

const started = Date.now();
const run = spawnSync(bin, spec.buildArgs(prompt, opts), {
  encoding: 'utf8',
  shell: false,
  timeout: TIMEOUT_MS,
  maxBuffer: 64 * 1024 * 1024,
});

if (run.error || run.status !== 0) {
  console.error(`error: ${spec.label} exited ${run.status ?? 'signal'} — ${run.error?.message ?? ''}`);
  if (run.stderr) console.error(run.stderr.slice(0, 2000));
  process.exit(3);
}

const { text, inTokens, outTokens, model } = extractUsage(run.stdout ?? '');
process.stdout.write(text);

logUsage({
  ts: new Date().toISOString(),
  provider,
  model: model ?? opts.model ?? 'default',
  in_tokens: inTokens,
  out_tokens: outTokens,
  prompt_chars: prompt.length,
  response_chars: text.length,
  duration_ms: Date.now() - started,
});
