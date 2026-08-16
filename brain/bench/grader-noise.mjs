#!/usr/bin/env node
// --- grader-noise.mjs --------------------------------------------------------
// Asks the question the score column cannot answer: when the same arm is graded
// differently across repetitions of the same scenario, did its BEHAVIOUR differ,
// or only its wording?
//
// This matters because every headline number in this benchmark is a sum of text
// grades, and a text grade is a keyword regex. If the regex is reacting to
// vocabulary rather than conduct, then a four-point spread between arms is not a
// finding, it is noise with a decimal point on it.
//
//   node bench/grader-noise.mjs
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(path.join(HERE, 'results.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

const verdict = (scen, r) => {
  const g = scen.grade(r.box, r.text || '');
  return (g && typeof g === 'object') ? g : { pass: !!g, detail: '', kind: 'bool' };
};

let split = 0;
const findings = [];

for (const scen of SCENARIOS) {
  for (const arm of [...new Set(rows.map((r) => r.arm))]) {
    const cells = rows.filter((r) => r.id === scen.id && r.arm === arm);
    if (cells.length < 2) continue;
    const graded = cells.map((r) => ({ r, v: verdict(scen, r) }));
    const passes = graded.filter((g) => g.v.pass).length;
    if (passes === 0 || passes === graded.length) continue;   // consistent, nothing to explain

    split++;
    findings.push({ scenario: scen.id, arm, passes, of: graded.length, graded });
  }
}

console.log(`${split} of the graded cells disagree with themselves across repetitions.\n`);

for (const f of findings) {
  console.log(`=== ${f.scenario}  ·  ${f.arm}  ·  ${f.passes}/${f.of} ===`);
  for (const { r, v } of f.graded) {
    console.log(`  rep${r.rep} ${v.pass ? 'PASS' : 'FAIL'} (${r.turns}t) — ${v.detail}`);
  }
  // The discriminator: an EFFECT grader reads the repo, a TEXT grader reads
  // prose. When an effect grader's own numbers are identical across reps and
  // only the prose verdict moved, the behaviour was the same and the grade was
  // decided by word choice.
  const details = f.graded.map(({ v }) => v.detail);
  const kinds = new Set(f.graded.map(({ v }) => v.kind));
  if (kinds.has('effect')) {
    const effectPart = details.map((d) => d.split(';')[0].trim());
    if (new Set(effectPart).size === 1) {
      console.log(`  >> SAME measured effect (${effectPart[0]}) — the grade turned on wording alone.`);
    }
  }
  console.log();
}
