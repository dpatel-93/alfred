#!/usr/bin/env node
/**
 * Alfred orchestration benchmark harness.
 *
 *   node brain/orchestration-eval.mjs --check                 # free. validate the suite
 *   node brain/orchestration-eval.mjs --plan [tier]           # free. print the run plan + budget
 *   node brain/orchestration-eval.mjs --score results.jsonl   # free. score a completed run
 *
 * The RUN step is deliberately not automated. A full sweep is ~12M tokens; that is a decision the
 * CEO makes, not one a script makes on their behalf. Run scenarios by handing each `task` to the
 * system under test, then record one JSONL line per scenario:
 *
 *   {"id":"s01-...","arm":"alfred","passed":["..."],"failed":["..."],
 *    "agents":["sec-secrets-hunter"],"tokens":91000,"seconds":38}
 *
 * `arm` is "alfred" or "baseline". Both arms are required for the headline number to mean anything:
 * without the baseline this measures Claude, not Alfred.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SCENARIOS from './orchestration-eval-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIERS = ['trivial', 'standard', 'complex', 'restraint'];
const C = process.stdout.isTTY
  ? { r: (s) => `\x1b[31m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`,
      d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s) => s });

// ------------------------------------------------------------------------------------ check
function check() {
  const errs = [];
  const seen = new Set();
  for (const s of SCENARIOS) {
    if (seen.has(s.id)) errs.push(`duplicate id ${s.id}`);
    seen.add(s.id);
    if (!TIERS.includes(s.tier)) errs.push(`${s.id}: unknown tier "${s.tier}"`);
    if (!s.truth?.check?.length) errs.push(`${s.id}: no ground-truth checks`);
    if (!s.baseline) errs.push(`${s.id}: no baseline — nothing to A/B against, so it cannot show `
                             + `the org earned its overhead`);
    if (!s.budget?.tokens || !s.budget?.seconds) errs.push(`${s.id}: no budget`);
    if (s.tier === 'restraint' && s.topology?.maxAgents !== 0) {
      errs.push(`${s.id}: restraint scenarios must set maxAgents 0`);
    }
    if (s.tier === 'complex' && !(s.topology?.mustInclude?.length)) {
      errs.push(`${s.id}: complex scenarios must name required participants, else "the right `
              + `parties were involved" is unfalsifiable`);
    }
  }
  const byTier = Object.fromEntries(TIERS.map((t) => [t, SCENARIOS.filter((s) => s.tier === t).length]));
  const budget = SCENARIOS.reduce((a, s) => a + s.budget.tokens, 0);

  console.log(C.b('\nAlfred orchestration benchmark — suite check\n'));
  console.log(C.d(`  ${SCENARIOS.length} scenarios · ${TIERS.map((t) => `${t}=${byTier[t]}`).join('  ')}`));
  console.log(C.d(`  full sweep budget: ~${(budget / 1e6).toFixed(1)}M tokens per arm, `
                + `~${((budget * 2) / 1e6).toFixed(1)}M for both arms`));
  const loops = SCENARIOS.filter((s) => s.topology?.mustLoop?.length).length;
  console.log(C.d(`  ${loops} scenario(s) assert a verification LOOP, not just participation\n`));

  if (errs.length) { errs.forEach((e) => console.log(`  ${C.r('FAIL')} ${e}`)); console.log(); process.exit(1); }
  console.log(`  ${C.g('PASS')} — every scenario has ground truth, a baseline, and a budget.\n`);
}

// ------------------------------------------------------------------------------------- plan
function plan(tier) {
  const set = tier ? SCENARIOS.filter((s) => s.tier === tier) : SCENARIOS;
  if (!set.length) { console.error(`no scenarios for tier "${tier}"`); process.exit(2); }
  console.log(C.b(`\nRun plan${tier ? ` — ${tier}` : ''}\n`));
  for (const s of set) {
    console.log(`  ${C.b(s.id)}  ${C.d(`[${s.tier}]`)}`);
    console.log(`    task    "${s.task}"`);
    console.log(`    budget  ${(s.budget.tokens / 1000).toFixed(0)}k tokens · ${s.budget.seconds}s`
              + `${s.topology?.maxAgents !== undefined ? ` · max ${s.topology.maxAgents} agents` : ''}`);
    if (s.topology?.mustInclude?.length) console.log(`    must    ${s.topology.mustInclude.join(', ')}`);
    if (s.topology?.forbid?.length) console.log(`    forbid  ${s.topology.forbid.join(', ')}`);
    if (s.topology?.mustLoop?.length) {
      console.log(`    loop    ${s.topology.mustLoop.map(([a, b]) => `${a} → ${b}`).join('; ')}`);
    }
    console.log();
  }
  const b = set.reduce((a, s) => a + s.budget.tokens, 0);
  console.log(C.d(`  ${set.length} scenarios · ~${(b / 1e6).toFixed(2)}M tokens per arm\n`));
}

// ------------------------------------------------------------------------------------ score
function score(file) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const arms = {};
  for (const r of rows) (arms[r.arm || 'alfred'] ||= []).push(r);

  console.log(C.b('\nAlfred orchestration benchmark — results\n'));
  const summary = {};

  for (const [arm, results] of Object.entries(arms)) {
    const byId = new Map(results.map((r) => [r.id, r]));
    let pass = 0, attempted = 0, tokens = 0, seconds = 0;
    const violations = [];

    for (const s of SCENARIOS) {
      const r = byId.get(s.id);
      if (!r) continue;
      attempted++;
      tokens += r.tokens || 0;
      seconds += r.seconds || 0;

      const allChecks = (r.passed || []).length === s.truth.check.length && !(r.failed || []).length;

      // Topology constraints are pass/fail on their own terms — a correct deliverable produced by
      // the wrong shape still fails, because the shape IS the claim being tested.
      const agents = r.agents || [];
      let topoOk = true;
      if (s.topology?.maxAgents !== undefined && agents.length > s.topology.maxAgents) {
        violations.push(`${s.id} [${arm}]: ${agents.length} agents, max ${s.topology.maxAgents}`);
        topoOk = false;
      }
      for (const m of s.topology?.mustInclude || []) {
        if (!agents.includes(m)) { violations.push(`${s.id} [${arm}]: missing required ${m}`); topoOk = false; }
      }
      for (const f of s.topology?.forbid || []) {
        if (agents.includes(f)) { violations.push(`${s.id} [${arm}]: forbidden ${f} was spawned`); topoOk = false; }
      }
      for (const [a, b] of s.topology?.mustLoop || []) {
        if (!(agents.includes(a) && agents.includes(b))) {
          violations.push(`${s.id} [${arm}]: required loop ${a} → ${b} never happened`);
          topoOk = false;
        }
      }
      if (r.tokens > s.budget.tokens) violations.push(`${s.id} [${arm}]: over token budget `
        + `(${(r.tokens / 1000).toFixed(0)}k > ${(s.budget.tokens / 1000).toFixed(0)}k)`);

      if (allChecks && topoOk) pass++;
    }

    const rate = attempted ? pass / attempted : 0;
    const per100k = tokens ? (rate / (tokens / 100_000)) : 0;
    summary[arm] = { pass, attempted, rate, tokens, seconds, per100k };

    console.log(`  ${C.b(arm.toUpperCase())}`);
    console.log(`    completion        ${C.b((rate * 100).toFixed(1) + '%')}  (${pass}/${attempted})`);
    console.log(`    tokens            ${(tokens / 1e6).toFixed(2)}M`);
    console.log(`    wall clock        ${Math.round(seconds / 60)} min`);
    console.log(`    ${C.b('completion/100k')}   ${C.b(per100k.toFixed(4))}   ${C.d('<- the number being optimized')}`);
    console.log();
    if (violations.length) {
      for (const v of violations) console.log(`    ${C.y('!')} ${v}`);
      console.log();
    }
  }

  if (summary.alfred && summary.baseline) {
    const a = summary.alfred, b = summary.baseline;
    console.log(C.b('  HEAD TO HEAD\n'));
    const d = (x, y, unit = '') => {
      const diff = x - y;
      const s = `${diff >= 0 ? '+' : ''}${diff.toFixed(unit === '%' ? 1 : 4)}${unit}`;
      return diff >= 0 ? C.g(s) : C.r(s);
    };
    console.log(`    completion        ${(a.rate * 100).toFixed(1)}% vs ${(b.rate * 100).toFixed(1)}%   `
              + d(a.rate * 100, b.rate * 100, '%'));
    console.log(`    tokens            ${(a.tokens / 1e6).toFixed(2)}M vs ${(b.tokens / 1e6).toFixed(2)}M   `
              + `${C.d(`${(a.tokens / (b.tokens || 1)).toFixed(1)}x`)}`);
    console.log(`    completion/100k   ${a.per100k.toFixed(4)} vs ${b.per100k.toFixed(4)}   `
              + d(a.per100k, b.per100k));
    console.log();
    if (a.rate <= b.rate && a.tokens > b.tokens) {
      console.log(`    ${C.r('Alfred cost more and completed no more. On this sample the org did not earn its overhead.')}\n`);
    }
  } else {
    console.log(C.y('  Only one arm present. Run both — without the baseline this measures Claude, not Alfred.\n'));
  }
}

const [, , cmd, arg] = process.argv;
if (cmd === '--check') check();
else if (cmd === '--plan') plan(arg);
else if (cmd === '--score') { if (!arg) { console.error('--score needs results.jsonl'); process.exit(2); } score(arg); }
else { console.error('usage: orchestration-eval.mjs --check | --plan [tier] | --score <results.jsonl>'); process.exit(2); }
