#!/usr/bin/env node
// --- inspect-cell.mjs --------------------------------------------------------
// Prints every arm's answer to one scenario, with the grader's own verdict and
// reason beside it.
//
// The harness says, every time it grades: "read these before reporting them."
// This is the tool for doing that. It exists because the alternative — trusting
// the score column — has already produced one confidently wrong report in this
// project, where an arm scored 4/8 on prompts it never received.
//
//   node bench/inspect-cell.mjs <scenarioId> [--full] [--arm alfred]
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results.jsonl');

const id = process.argv[2];
const full = process.argv.includes('--full');
const armIdx = process.argv.indexOf('--arm');
const onlyArm = armIdx > -1 ? process.argv[armIdx + 1] : null;

if (!id) {
  console.error(`usage: inspect-cell.mjs <scenarioId> [--full] [--arm <name>]\n\n`
    + SCENARIOS.map((s) => `  ${s.id}`).join('\n'));
  process.exit(2);
}
const scen = SCENARIOS.find((s) => s.id === id);
if (!scen) { console.error(`unknown scenario: ${id}`); process.exit(2); }

const rows = fs.readFileSync(RESULTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((r) => r.id === id && (!onlyArm || r.arm === onlyArm));

console.log(`TASK: ${scen.task}\n`);

for (const r of rows) {
  const g = scen.grade(r.box, r.text || '');
  const verdict = (g && typeof g === 'object') ? g : { pass: !!g, detail: '', kind: 'bool' };
  console.log(`--- ${r.arm.padEnd(12)} rep${r.rep}  ${verdict.pass ? 'PASS' : 'FAIL'}  `
    + `${r.turns}t  ${r.seconds}s  [${verdict.kind}]`);
  if (verdict.detail) console.log(`    grader: ${verdict.detail}`);
  const text = String(r.text || '');
  console.log(full ? text : `    ${text.replace(/\s+/g, ' ').slice(0, 220)}`);
  console.log();
}
