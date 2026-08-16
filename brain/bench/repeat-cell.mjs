#!/usr/bin/env node
// --- repeat-cell.mjs ---------------------------------------------------------
// Re-runs ONE (arm, scenario) cell N times.
//
// A single benchmark rep cannot tell a real behavioural difference from a bad
// roll of the dice, and the interesting cells are always the surprising ones —
// exactly where that distinction matters most. Re-running the whole 32-cell
// sweep to settle one cell costs 32x what the question is worth.
//
//   node bench/repeat-cell.mjs <arm> <scenarioId> [reps]
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARMS } from './arms.mjs';
import { SCENARIOS, FIXTURE_IDS } from './scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', 'make-staffing-fixture.mjs');
const SANDBOX = path.join(os.tmpdir(), 'alfred-bench-repeat');

const WIN_CLAUDE_EXE = path.join(process.env.APPDATA || '', 'npm', 'node_modules',
  '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const CLAUDE_BIN = process.platform === 'win32' ? WIN_CLAUDE_EXE : 'claude';

const [armName, scenId, repsRaw] = process.argv.slice(2);
const reps = Math.max(1, parseInt(repsRaw, 10) || 3);

const arm = ARMS[armName];
const scen = SCENARIOS.find((s) => s.id === scenId);
if (!arm) { console.error(`unknown arm: ${armName}. Have: ${Object.keys(ARMS).join(', ')}`); process.exit(2); }
if (!scen) { console.error(`unknown scenario: ${scenId}`); process.exit(2); }
if (typeof scen.grade !== 'function') {
  console.error(`${scenId} has no grader — repeating it would prove nothing.`);
  process.exit(2);
}

// grade() returns {kind, pass, detail, needsHumanReview} — an OBJECT, which is
// always truthy. Coercing it with !! reports every rep as a pass and looks
// exactly like a real result. It did, for one run, before this line existed.
function verdict(scen, box, text) {
  const g = scen.grade(box, text);
  return (g && typeof g === 'object') ? { pass: !!g.pass, detail: g.detail || '', kind: g.kind || '?' }
    : { pass: !!g, detail: '', kind: 'bool' };
}

console.log(`${armName} x ${scenId}, ${reps} reps\n`);
const out = [];

for (let i = 1; i <= reps; i++) {
  const box = path.join(SANDBOX, `${scenId}-${armName}-${i}`);
  fs.rmSync(box, { recursive: true, force: true });
  fs.mkdirSync(box, { recursive: true });
  if (FIXTURE_IDS.has(scenId)) execFileSync(process.execPath, [FIXTURE, box], { stdio: 'pipe' });

  const started = Date.now();
  let text = '';
  let turns = 0;
  try {
    // No shell, exactly as bench/run.mjs does it now: a Windows shell
    // concatenates argv unescaped and silently rewrites the prompt.
    const raw = execFileSync(CLAUDE_BIN,
      [...arm.flags(), '-p', scen.task, '--output-format', 'json'],
      { cwd: box, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
    const j = JSON.parse(raw);
    text = j.result || '';
    turns = j.num_turns || 0;
  } catch (e) {
    console.log(`  rep ${i}: ERROR ${String(e.message).slice(0, 120)}`);
    out.push({ rep: i, pass: false, turns: 0, error: true });
    continue;
  }
  const v = verdict(scen, box, text);
  const secs = Math.round((Date.now() - started) / 1000);
  out.push({ rep: i, pass: v.pass, turns, secs, detail: v.detail });
  console.log(`  rep ${i}: ${v.pass ? 'PASS' : 'FAIL'}  ${turns} turns  ${secs}s  [${v.kind}] ${v.detail}`);
  console.log(`         ${text.replace(/\s+/g, ' ').slice(0, 150)}`);
}

const passes = out.filter((r) => r.pass).length;
console.log(`\n${passes}/${out.length} passed · turns ${out.map((r) => r.turns).join(', ')}`);
