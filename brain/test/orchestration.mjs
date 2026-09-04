// Orchestration-benchmark suite integrity.
//
// Same job as test/routing.mjs, one level up: it does not measure orchestration quality (that needs
// a ~24M-token two-arm sweep), it guards the scenarios from rotting. Ground truth here references
// real agent names, so a rename turns a scenario into a test of nothing — this framework's own
// anti-pattern #1.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import SCENARIOS from '../orchestration-eval-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(HERE, '..', 'orchestration-eval.mjs');
const AGENTS = path.join(os.homedir(), '.claude', 'skills', 'orgagent', 'references', 'charters');
const R = [];
const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

let out = '', failed = false;
try { out = execFileSync(process.execPath, [EVAL, '--check'], { encoding: 'utf8' }); }
catch (e) { failed = true; out = `${e.stdout || ''}${e.stderr || ''}`; }

T('suite check exits clean', !failed, out.split('\n').filter((l) => l.includes('FAIL')).join(' | '));

// Every agent named in a topology constraint must exist, or the constraint is decorative.
const roster = new Set();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md') && e.name !== 'ORG.md') {
      const m = fs.readFileSync(p, 'utf8').match(/^name:\s*(\S+)/m);
      if (m) roster.add(m[1]);
    }
  }
})(AGENTS);

const named = new Set();
for (const s of SCENARIOS) {
  for (const a of [...(s.topology?.mustInclude || []), ...(s.topology?.forbid || [])]) named.add(a);
  for (const [a, b] of s.topology?.mustLoop || []) { named.add(a); named.add(b); }
}
const ghosts = [...named].filter((a) => !roster.has(a));
T('every agent named in a topology constraint exists on disk', ghosts.length === 0,
  `not on roster: ${ghosts.join(', ')}`);

T('all four tiers are populated',
  ['trivial', 'standard', 'complex', 'restraint'].every((t) => SCENARIOS.some((s) => s.tier === t)));

T('restraint tier still forbids spawning',
  SCENARIOS.filter((s) => s.tier === 'restraint').every((s) => s.topology?.maxAgents === 0),
  'restraint is the axis no competing orchestrator can score on — losing it guts the benchmark');

T('complex tier still asserts verification loops',
  SCENARIOS.filter((s) => s.tier === 'complex').some((s) => s.topology?.mustLoop?.length),
  'without a mustLoop, "the quants verified the developers" is unfalsifiable');

T('every scenario carries a single-agent baseline',
  SCENARIOS.every((s) => typeof s.baseline === 'string' && s.baseline.length > 20),
  'no baseline means the suite measures Claude, not Alfred');

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
