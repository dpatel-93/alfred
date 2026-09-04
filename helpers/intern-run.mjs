#!/usr/bin/env node
// Alfred v4 intern wrapper — runs a prompt on a local Ollama model AND logs token
// counts so usage-report.mjs can show local-vs-cloud load.
// Usage: node intern-run.mjs <model> "<prompt>"     (or pipe stdin as the prompt body:
//        cat file.md | node intern-run.mjs qwen3:4b "Summarize in 5 bullets:")

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [model, ...rest] = process.argv.slice(2);
if (!model) { console.error('usage: intern-run.mjs <model> "<prompt>" [< stdin]'); process.exit(1); }

let prompt = rest.join(' ');
if (!process.stdin.isTTY) {
  const stdin = fs.readFileSync(0, 'utf8');
  prompt = prompt ? `${prompt}\n\n${stdin}` : stdin;
}

const res = await fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  body: JSON.stringify({ model, prompt, stream: false }),
}).catch(() => null);

if (!res?.ok) { console.error(`ollama unreachable or model error (${res?.status ?? 'no response'}) — is 'ollama serve' running?`); process.exit(2); }
const j = await res.json();
process.stdout.write(j.response ?? '');

const logDir = path.join(os.homedir(), '.claude', 'metrics');
fs.mkdirSync(logDir, { recursive: true });
fs.appendFileSync(path.join(logDir, 'ollama-usage.jsonl'), JSON.stringify({
  ts: new Date().toISOString(),
  model,
  prompt_eval_count: j.prompt_eval_count ?? 0,
  eval_count: j.eval_count ?? 0,
  duration_ms: Math.round((j.total_duration ?? 0) / 1e6),
}) + '\n');
