#!/usr/bin/env node
// Alfred provider setup — shows which model providers this machine can reach, and the exact
// command to connect the ones it can't. Run it during onboarding and any time afterwards.
//
// Usage: node provider-setup.mjs
//
// Read-only: it detects and reports. It never installs, never logs in, and never sends a prompt
// to any model — so it is safe to run unattended and costs nothing.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// --- Configuration ---

const isWin = process.platform === 'win32';
const home = os.homedir();
const registryPath = path.join(home, '.claude', 'helpers', 'providers.json');
const C = { r: '\x1b[0m', b: '\x1b[1m', grn: '\x1b[32m', red: '\x1b[31m', yel: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m' };

function expandPath(p) {
  return path.normalize(p.replace(/^~/, home).replace(/%([A-Z_]+)%/gi, (_, v) => process.env[v] ?? ''));
}

// --- Detection ---

function findBin(spec) {
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

function getVersion(bin, args) {
  const run = spawnSync(bin, args ?? ['--version'], { encoding: 'utf8', shell: false, timeout: 30_000 });
  if (run.status !== 0) return null;
  return (run.stdout ?? '').split('\n')[0].trim().slice(0, 40) || null;
}

// Authenticated is judged by artefact, not by asking the model — that would cost a call.
function checkAuth(spec) {
  if (spec.apiKeyEnv && process.env[spec.apiKeyEnv]) return { ok: true, how: `$${spec.apiKeyEnv}` };
  for (const p of spec.authPaths ?? []) {
    if (fs.existsSync(expandPath(p))) return { ok: true, how: 'signed in' };
  }
  if (!(spec.authPaths ?? []).length && !spec.apiKeyEnv) return { ok: true, how: 'no auth needed' };
  return { ok: false, how: null };
}

async function checkOllama(spec) {
  const res = await fetch(spec.endpoint.replace('/api/generate', '/api/tags'), { method: 'GET' }).catch(() => null);
  if (!res?.ok) return { ok: false, how: null };
  const j = await res.json().catch(() => ({ models: [] }));
  return { ok: true, how: `${(j.models ?? []).length} model(s) pulled` };
}

// --- Report ---

const registry = Object.fromEntries(
  Object.entries(JSON.parse(fs.readFileSync(registryPath, 'utf8'))).filter(([k]) => !k.startsWith('_')),
);

console.log(`${C.b}${C.cyan}Alfred — model providers on this machine${C.r}\n`);

const todo = [];
const ready = [];

for (const [id, spec] of Object.entries(registry)) {
  const bin = findBin(spec);
  const installed = Boolean(bin);
  let auth = { ok: false, how: null };
  if (installed) {
    auth = spec.transport === 'ollama-http' ? await checkOllama(spec) : checkAuth(spec);
  }

  const state = !installed ? `${C.gray}not installed${C.r}`
    : !auth.ok ? `${C.yel}installed, not signed in${C.r}`
    : `${C.grn}ready${C.r}`;
  const version = installed ? getVersion(bin, spec.versionArgs) : null;
  const gate = spec.approval === 'ask-per-use' ? `${C.yel}ask first${C.r}` : `${C.gray}no gate${C.r}`;

  console.log(`${C.b}${id.padEnd(9)}${C.r} ${state}`);
  console.log(`  ${spec.label}${version ? `  ${C.gray}(${version})${C.r}` : ''}`);
  console.log(`  cost: ${spec.cost}   approval: ${gate}${auth.how ? `   ${C.gray}${auth.how}${C.r}` : ''}`);
  if (installed && !auth.ok) {
    console.log(`  ${C.yel}->${C.r} connect with: ${C.b}${spec.loginCmd}${C.r}`);
    todo.push(`${id}: ${spec.loginCmd}`);
  } else if (!installed) {
    console.log(`  ${C.gray}-> not required. Install it only if you want Alfred to use it.${C.r}`);
  } else {
    ready.push(id);
  }
  console.log('');
}

// --- Summary ---

console.log(`${C.b}${C.cyan}Summary${C.r}`);
console.log(`  ready: ${ready.length ? C.grn + ready.join(', ') + C.r : C.red + 'none' + C.r}`);
if (todo.length) {
  console.log(`  ${C.yel}installed but not connected:${C.r}`);
  for (const t of todo) console.log(`    ${t}`);
}
if (!ready.length) {
  console.log(`\n  ${C.red}Alfred needs at least one provider.${C.r} Connect any one above and re-run this.`);
} else {
  console.log(`\n  ${C.gray}Alfred fills its org roles (c-suite / vp / manager / employee / intern) from whatever`);
  console.log(`  is ready. Roles are provider-neutral — see providers.json to change the mapping.${C.r}`);
}
console.log(`\n  ${C.gray}Providers marked "ask first" are never called without your explicit yes for that`);
console.log(`  specific use. Being signed in is not standing permission.${C.r}`);
