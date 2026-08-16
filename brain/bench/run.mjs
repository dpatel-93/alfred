#!/usr/bin/env node
/**
 * The benchmark runner.
 *
 *   node bench/run.mjs --check              free. verify arms, fixtures and auth without spending
 *   node bench/run.mjs --plan [reps]        free. print the run plan and projected cost
 *   node bench/run.mjs --run [reps]         spend. execute every arm x scenario x rep
 *   node bench/run.mjs --grade [file]       free. grade a completed run, blinded
 *
 * NOTHING HERE TOUCHES ~/.claude. Every arm is a set of flags (see arms.mjs) and every run gets
 * its own throwaway sandbox. That is deliberate: the previous harness swapped the operator's live
 * agent directory in and out between arms, which worked but modified a running setup, and could
 * only ever compare Alfred against Alfred.
 *
 * Runs are SEQUENTIAL by default. orchestration-eval.mjs records a run invalidated by parallel
 * arms sharing one working directory — one arm read a file the other had just written and treated
 * it as evidence. Separate sandboxes make parallelism safe in principle; --jobs exists for that,
 * but the default stays 1 until the fixtures are proven independent.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ARMS, vendored, assertRunnable, VENDOR } from './arms.mjs';
import { SCENARIOS, FIXTURE_IDS } from './scenarios.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FIXTURE = path.join(HERE, '..', 'make-staffing-fixture.mjs');
const SANDBOX = path.join(os.tmpdir(), 'alfred-bench');
const OUT = path.join(HERE, 'results.jsonl');
// The real executable, NOT the .cmd shim. A shim can only be launched through a
// shell, and a Windows shell concatenates argv unescaped — which silently
// shredded this harness's own results: the ICM arm passes a multi-word
// --append-system-prompt, cmd.exe split it on spaces, and the model received the
// single word "all" as its prompt in 7 of 8 scenarios. It answered that word
// plausibly every time, so the run looked healthy and scored 4/8.
//
// This is the SECOND time this exact bug has been paid for here — peer-run.mjs
// hit it in August and its fix note says, in as many words, do not simplify this
// back to shell:true. Pointing at the .exe removes the shell, and with it the
// entire class of failure.
const WIN_CLAUDE_EXE = path.join(process.env.APPDATA || '', 'npm', 'node_modules',
  '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const CLAUDE_BIN = process.platform === 'win32' ? WIN_CLAUDE_EXE : 'claude';

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
const mode = process.argv[2] || '--check';
const reps = Math.max(1, parseInt(process.argv[3], 10) || 1);

// --- Setup -------------------------------------------------------------------------------------

function fetchVendored() {
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const arm of vendored()) {
    const dest = path.join(VENDOR, arm.vendor.into);
    if (fs.existsSync(dest)) { console.log(`  ${C.d}have${C.x} ${arm.vendor.repo}`); continue; }
    console.log(`  fetching ${arm.vendor.repo} → ${dest}`);
    // Third-party config: cloned to a throwaway dir and loaded per-run. Never installed.
    execFileSync('gh', ['repo', 'clone', arm.vendor.repo, dest, '--', '--depth', '1'], { stdio: 'pipe' });
  }
}

function makeSandbox(id, arm, rep) {
  const box = path.join(SANDBOX, `${arm}-${id}-r${rep}`);
  fs.rmSync(box, { recursive: true, force: true });
  if (FIXTURE_IDS.has(id)) execFileSync(process.execPath, [FIXTURE, box], { stdio: 'pipe' });
  else fs.mkdirSync(box, { recursive: true });
  return box;
}

// --- Execution ---------------------------------------------------------------------------------

function runOne(arm, scen, rep) {
  const box = makeSandbox(scen.id, arm.label, rep);
  const started = Date.now();
  let raw;
  try {
    // No shell, and therefore no quoting: every argument arrives exactly as
    // written, spaces and all. JSON.stringify around the task is gone with it —
    // it existed only to survive the shell, and left the model reading a
    // quoted string where a plain instruction was meant.
    raw = execFileSync(CLAUDE_BIN,
      [...arm.flags(), '-p', scen.task, '--output-format', 'json'],
      { cwd: box, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return { box, error: String(e.message).slice(0, 240), seconds: Math.round((Date.now() - started) / 1000) };
  }
  let j; try { j = JSON.parse(raw); } catch { return { box, error: 'unparseable output' }; }
  const u = j.usage || {};
  return {
    box,
    seconds: Math.round((Date.now() - started) / 1000),
    turns: j.num_turns,
    cost: j.total_cost_usd,
    total: (u.input_tokens || 0) + (u.output_tokens || 0)
         + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    text: j.result || '',
  };
}

// --- Grading (blinded) -------------------------------------------------------------------------

function grade(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const scen = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
  // Blind: shuffle deterministically so the grader is not walking arms in a fixed order, and
  // grade purely from (sandbox, text) without consulting the arm label.
  const shuffled = [...rows].sort((a, b) => (a.id + a.rep).localeCompare(b.id + b.rep));
  const graded = shuffled.map((r) => {
    const s = scen[r.id];
    if (!s || r.error) return { ...r, verdict: null };
    let v;
    try { v = s.grade(r.box, r.text || ''); } catch (e) { v = { kind: 'error', pass: false, detail: String(e.message) }; }
    return { ...r, verdict: v };
  });

  const arms = [...new Set(graded.map((r) => r.arm))];
  console.log(`\n${'scenario'.padEnd(28)}${arms.map((a) => a.padStart(14)).join('')}`);
  console.log('-'.repeat(28 + arms.length * 14));
  for (const s of SCENARIOS) {
    const cells = arms.map((a) => {
      const hits = graded.filter((r) => r.id === s.id && r.arm === a && r.verdict);
      if (!hits.length) return '—'.padStart(14);
      const p = hits.filter((h) => h.verdict.pass).length;
      const mark = p === hits.length ? `${C.g}${p}/${hits.length}${C.x}` : `${C.r}${p}/${hits.length}${C.x}`;
      return mark.padStart(14 + C.g.length + C.x.length);
    });
    console.log(s.id.padEnd(28) + cells.join(''));
  }
  const review = graded.filter((r) => r.verdict?.needsHumanReview);
  console.log(`\n${C.y}${review.length} result(s) graded from TEXT — read these before reporting them.${C.x}`);
  console.log(`${C.d}A text grader catches a wildly wrong answer. It does not settle a close one.${C.x}\n`);
  fs.writeFileSync(file.replace(/\.jsonl$/, '-graded.jsonl'),
    graded.map((g) => JSON.stringify(g)).join('\n') + '\n', 'utf8');
}

// --- Entry points ------------------------------------------------------------------------------

if (mode === '--check') {
  console.log('\nBenchmark preflight\n');
  const problems = assertRunnable();
  console.log(`  arms       ${Object.keys(ARMS).length} — ${Object.values(ARMS).map((a) => a.label).join(', ')}`);
  console.log(`  scenarios  ${SCENARIOS.length} (${FIXTURE_IDS.size} with planted ground truth)`);
  const fsGraded = SCENARIOS.filter((s) => !s.grade.toString().includes("kind: 'text'")).length;
  console.log(`  graders    ${fsGraded} machine-checked, ${SCENARIOS.length - fsGraded} text (human-reviewed)`);
  console.log(`  fixture    ${fs.existsSync(FIXTURE) ? 'present' : C.r + 'MISSING' + C.x}`);
  if (problems.length) {
    console.log(`\n${C.r}  cannot run yet:${C.x}`);
    for (const p of problems) console.log(`  - ${p}`);
    console.log(`\n${C.d}  everything above this line is verifiable without spending anything.${C.x}\n`);
    process.exit(1);
  }
  console.log(`\n${C.g}  ready${C.x}\n`);
} else if (mode === '--plan') {
  const runs = Object.keys(ARMS).length * SCENARIOS.length * reps;
  // $1.89/M measured over the 2026-08-14 staffing run; ~440k tokens per scenario-run observed.
  const est = runs * 0.44e6 * 1.89e-6;
  console.log(`\n  ${Object.keys(ARMS).length} arms × ${SCENARIOS.length} scenarios × ${reps} rep(s) = ${C.y}${runs} runs${C.x}`);
  console.log(`  projected: ~${(runs * 0.44).toFixed(0)}M tokens, ~$${est.toFixed(0)}, ~${Math.round(runs * 1.3)} min sequential\n`);
} else if (mode === '--run') {
  const problems = assertRunnable();
  if (problems.length) { console.log(`\n${C.r}refusing to run:${C.x}\n- ${problems.join('\n- ')}\n`); process.exit(1); }
  fetchVendored();
  fs.rmSync(OUT, { force: true });
  for (const arm of Object.values(ARMS)) {
    for (const s of SCENARIOS) {
      for (let rep = 1; rep <= reps; rep++) {
        const r = runOne(arm, s, rep);
        fs.appendFileSync(OUT, JSON.stringify({ arm: arm.label, id: s.id, rep, task: s.task, ...r }) + '\n');
        console.log(`  ${arm.label.padEnd(12)}${s.id.padEnd(28)}${String(r.total || 0).padStart(9)} tok ${String(r.turns ?? '-').padStart(3)}t${r.error ? '  ' + C.r + 'ERR' + C.x : ''}`);
      }
    }
  }
  console.log(`\nwrote ${OUT} — grade it with: node bench/run.mjs --grade\n`);
} else if (mode === '--grade') {
  grade(process.argv[3] && process.argv[3].endsWith('.jsonl') ? process.argv[3] : OUT);
} else {
  console.log('usage: --check | --plan [reps] | --run [reps] | --grade [file]');
}
