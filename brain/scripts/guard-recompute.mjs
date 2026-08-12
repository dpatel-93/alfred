// Recompute the over-engagement guard for BOTH runs against the FROZEN d0ed46c ground truth,
// so the denominator cannot move underneath the comparison.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const CASES = (await import(pathToFileURL(process.argv[2]).href)).default;
const SENT = new Set(['NONE', 'CLARIFY']);
const neg = CASES.filter((c) => SENT.has([c.expect].flat()[0]));
console.log(`frozen negative population: ${neg.length} — ${neg.map((c) => c.id.split('-')[0]).join(' ')}\n`);

for (const [label, file] of [['R3 run (pre-fields)', process.argv[3]],
                             ['R4 run (required fields)', process.argv[4]]]) {
  const got = new Map(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).map((r) => [r.id, r]));
  const held = neg.filter((c) => SENT.has(got.get(c.id)?.owner));
  const broke = neg.filter((c) => !SENT.has(got.get(c.id)?.owner));
  console.log(`${label.padEnd(26)} ${held.length}/${neg.length}`);
  for (const c of broke) console.log(`    leaked: ${c.id} -> ${got.get(c.id)?.owner ?? 'no result'}`);
}
