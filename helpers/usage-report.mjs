#!/usr/bin/env node
// Alfred v4 usage report — tallies Claude token consumption from local session
// transcripts (~/.claude/projects/**/*.jsonl) and local Ollama intern usage
// (~/.claude/metrics/ollama-usage.jsonl, written by intern-run.mjs).
// Zero dependencies. Usage: node usage-report.mjs [days]  (default 7)
// NOTE: official plan LIMITS (session/weekly %) are server-side — see /usage in the CLI.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Configuration ---
const days = Math.max(1, parseInt(process.argv[2] ?? '7', 10) || 7);
const cutoff = Date.now() - days * 86400_000;
const projectsDir = path.join(os.homedir(), '.claude', 'projects');
const ollamaLog = path.join(os.homedir(), '.claude', 'metrics', 'ollama-usage.jsonl');
const C = { r: '\x1b[0m', b: '\x1b[1m', cyan: '\x1b[36m', grn: '\x1b[32m', yel: '\x1b[33m', gray: '\x1b[90m' };

// --- Collect transcript files ---
function jsonlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p));
    else if (e.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= cutoff) out.push(p);
  }
  return out;
}

// --- Tally cloud usage by day × model ---
const tally = {}; // day -> model -> {in, out, cacheRead, cacheWrite}
const seen = new Set();
let totalMsgs = 0;

for (const file of jsonlFiles(projectsDir)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const u = j?.message?.usage;
    if (!u || j.type !== 'assistant') continue;
    const ts = Date.parse(j.timestamp ?? 0);
    if (!ts || ts < cutoff) continue;
    const id = j.message.id ?? j.uuid;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const day = new Date(ts).toISOString().slice(0, 10);
    const model = (j.message.model ?? 'unknown').replace(/-\d{8}$/, '');
    const t = ((tally[day] ??= {})[model] ??= { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
    t.in += u.input_tokens ?? 0;
    t.out += u.output_tokens ?? 0;
    t.cacheRead += u.cache_read_input_tokens ?? 0;
    t.cacheWrite += u.cache_creation_input_tokens ?? 0;
    totalMsgs++;
  }
}

// --- Tally local Ollama usage ---
const local = {}; // model -> {in, out, calls}
if (fs.existsSync(ollamaLog)) {
  for (const line of fs.readFileSync(ollamaLog, 'utf8').split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (!j.ts || Date.parse(j.ts) < cutoff) continue;
    const t = (local[j.model] ??= { in: 0, out: 0, calls: 0 });
    t.in += j.prompt_eval_count ?? 0;
    t.out += j.eval_count ?? 0;
    t.calls++;
  }
}

// --- Report ---
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
console.log(`${C.b}${C.cyan}== Claude usage, last ${days}d ==${C.r}  (${totalMsgs} assistant messages)`);
let cloudTotal = 0;
for (const day of Object.keys(tally).sort()) {
  console.log(`${C.b}${day}${C.r}`);
  for (const [model, t] of Object.entries(tally[day])) {
    const burn = t.in + t.out; // non-cache tokens are what matter for limits
    cloudTotal += burn + t.cacheWrite;
    console.log(`  ${model.padEnd(26)} in ${C.yel}${fmt(t.in).padStart(7)}${C.r}  out ${C.yel}${fmt(t.out).padStart(7)}${C.r}  cacheR ${C.gray}${fmt(t.cacheRead).padStart(8)}${C.r}  cacheW ${C.gray}${fmt(t.cacheWrite).padStart(7)}${C.r}`);
  }
}
console.log(`${C.b}${C.cyan}== Local Ollama (interns), last ${days}d ==${C.r}`);
let localTotal = 0;
if (!Object.keys(local).length) console.log(`  ${C.gray}no logged intern calls (intern-run.mjs writes the log)${C.r}`);
for (const [model, t] of Object.entries(local)) {
  localTotal += t.in + t.out;
  console.log(`  ${model.padEnd(26)} in ${C.grn}${fmt(t.in).padStart(7)}${C.r}  out ${C.grn}${fmt(t.out).padStart(7)}${C.r}  calls ${t.calls}`);
}
const pct = cloudTotal + localTotal ? Math.round((localTotal / (cloudTotal + localTotal)) * 100) : 0;
console.log(`${C.b}totals:${C.r} cloud ${C.yel}${fmt(cloudTotal)}${C.r} (incl. cache-writes) · local ${C.grn}${fmt(localTotal)}${C.r} · interns carried ${C.b}${pct}%${C.r} of token load`);
console.log(`${C.gray}official plan limits: run /usage in the CLI (server-side, not in transcripts)${C.r}`);
