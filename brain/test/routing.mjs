// Routing-eval dataset integrity.
//
// This suite does NOT measure routing accuracy — that needs a live router and real spawns, run via
// `routing-eval.mjs --emit` / `--score`. What it guards is the thing that silently rots: the
// dataset's expected owners are agent names, so any rename or removal on the roster turns a
// ground-truth case into a test of nothing. That is this framework's own anti-pattern #1 (the green
// picture — validating structure against a field nobody reads), so the eval gets the same treatment
// the org itself does.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(HERE, '..', 'routing-eval.mjs');
const R = [];
const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

let out = '', failed = false;
try {
  out = execFileSync(process.execPath, [EVAL, '--check'], { encoding: 'utf8' });
} catch (e) {
  failed = true;
  out = `${e.stdout || ''}${e.stderr || ''}`;
}

T('routing dataset check exits clean', !failed,
  failed ? out.split('\n').filter((l) => l.includes('FAIL')).join(' | ') : '');
T('every expected owner resolves to a real agent', /PASS/.test(out), out.slice(-300));
T('dataset still carries negative cases', /negative cases/.test(out),
  'NONE/CLARIFY cases are what catch over-engagement — losing them silently weakens the eval');
T('dataset still carries stakes-scaled depth mix', /depth mix:.*direct=.*full=/.test(out), out);

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
