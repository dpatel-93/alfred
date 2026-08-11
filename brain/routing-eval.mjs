#!/usr/bin/env node
/**
 * Routing eval harness for the Alfred org.
 *
 *   node brain/routing-eval.mjs --check              # free. validate the dataset against the roster
 *   node brain/routing-eval.mjs --emit [out.jsonl]   # free. write one routing prompt per case
 *   node brain/routing-eval.mjs --score results.jsonl# free. score a completed run
 *
 * --check and --emit and --score are all deterministic and cost nothing. Only the RUN step between
 * --emit and --score spends tokens, and it is deliberately left to the operator or CI rather than
 * fired automatically: a 22-case run spawns 22 routing decisions.
 *
 * Scoring reports two numbers that matter for different critiques:
 *   ROUTING ACCURACY — did it pick the right owner?           (is the org correct)
 *   DEPTH ACCURACY   — did it pay for the right chain length? (is the org efficient)
 * A router that is 100% accurate and always runs four levels deep has failed the second test, and
 * that failure is invisible to every check this framework had before R2.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import CASES from './routing-eval-questions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENTS = path.join(os.homedir(), '.claude', 'agents');
const SENTINELS = new Set(['NONE', 'CLARIFY']);
const DEPTHS = new Set(['none', 'direct', 'full', 'full+review']);
const TOPOLOGIES = new Set(['T0', 'T1', 'T2', 'T3', 'T4']);

const C = process.stdout.isTTY
  ? { r: (s) => `\x1b[31m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`,
      y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s) => s });

/** Every agent name that actually exists on disk. */
function roster() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && e.name !== 'ORG.md') {
        const m = fs.readFileSync(p, 'utf8').match(/^name:\s*(\S+)/m);
        if (m) names.add(m[1]);
      }
    }
  };
  walk(AGENTS);
  return names;
}

// ---------------------------------------------------------------------------- check
function check() {
  const names = roster();
  const seen = new Set();
  const errs = [];

  for (const c of CASES) {
    if (seen.has(c.id)) errs.push(`duplicate id: ${c.id}`);
    seen.add(c.id);

    for (const want of [c.expect].flat()) {
      if (!SENTINELS.has(want) && !names.has(want)) {
        errs.push(`${c.id}: expects "${want}" which is not an agent on disk`);
      }
    }
    if (!DEPTHS.has(c.depth)) errs.push(`${c.id}: unknown depth "${c.depth}"`);
    if ([c.expect].flat()[0] === 'CLARIFY' && c.depth !== 'none') {
      errs.push(`${c.id}: CLARIFY must carry depth 'none' — nothing has been spawned yet, so no `
              + `depth has been paid. This ambiguity cost 5 false failures on the first run.`);
    }
    if (c.topology && !TOPOLOGIES.has(c.topology)) errs.push(`${c.id}: unknown topology "${c.topology}"`);
    if (!c.trap || c.trap.length < 30) {
      errs.push(`${c.id}: missing or trivial trap — a case with no plausible wrong answer is not `
              + `discriminating anything`);
    }
    // Guard against the circularity this dataset exists to avoid.
    if (!SENTINELS.has([c.expect].flat()[0])) {
      const f = findFile([c.expect].flat()[0]);
      if (f && fs.readFileSync(f, 'utf8').toLowerCase().includes(c.q.toLowerCase().slice(0, 40))) {
        errs.push(`${c.id}: question is lifted verbatim from the target charter — circular`);
      }
    }
  }

  const byDepth = {};
  for (const c of CASES) byDepth[c.depth] = (byDepth[c.depth] || 0) + 1;

  console.log(C.b('\nAlfred routing eval — dataset check\n'));
  console.log(C.d(`  ${CASES.length} cases · ${names.size} agents on disk`));
  console.log(C.d(`  depth mix: ${Object.entries(byDepth).map(([k, v]) => `${k}=${v}`).join('  ')}`));
  const sentinel = CASES.filter((c) => SENTINELS.has([c.expect].flat()[0])).length;
  console.log(C.d(`  ${sentinel} negative cases (NONE/CLARIFY) — these catch over-engagement, `
                + `which no pre-R2 check measured\n`));

  if (errs.length) {
    for (const e of errs) console.log(`  ${C.r('FAIL')} ${e}`);
    console.log();
    process.exit(1);
  }
  console.log(`  ${C.g('PASS')} — every expected owner resolves, every case discriminates.\n`);
}

function findFile(name) {
  let hit = null;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === `${name}.md`) hit = p;
    }
  };
  walk(AGENTS);
  return hit;
}

// ---------------------------------------------------------------------------- emit
const RUBRIC = `You are the Alfred Chief of Staff. Route the request below per ~/.claude/CLAUDE.md
and agents/ORG.md.

Load the org-index skill first. Do not open ORG.md to look up a name.

Answer with JSON only, no prose. EVERY field is required:
{"owner":"<exact agent name, or NONE to stay in-session, or CLARIFY to confirm with the CEO first>",
 "depth":"none|direct|full|full+review",
 "topology":"T0|T1|T2|T3|T4",
 "stakes":"S0|S1|S2|S3",
 "blocking_premises":"<the assumptions that make this worthless if false, or 'none'>",
 "gate":"proceed|CLARIFY|confirm-before-fanout — because ...",
 "why":"<one sentence>"}

Three ORTHOGONAL axes decide this (ORG.md 5e). Do not collapse them:
- COMPLEXITY decides topology.  C0 in-session -> T0.  C1 one artifact, one discipline -> T1.
  C2 several tasks or one build needing verification, one discipline -> T1+verifier or T3.
  C3 merit judged by a DIFFERENT specialty than the builder -> T2 build/verify/revise.
  C4 staged workstreams where a later stage is worthless if an earlier fails -> T4 staged gates.
- STAKES decides review (writes/spends/ships/asserts -> independent refute-review, 5c.3).
- AMBIGUITY decides clarification (5c.2). CLARIFY always carries depth "none" — nothing spawned yet.

- NONE = engaging the org is the wrong call (answerable from context, trivial edit, tight iteration).
- Route to the OWNER, not the department. If the ask arrives scoped to one employee's surface, name
  that employee — not its manager and not its VP. A VP belongs on the path only to adjudicate a T3
  reconcile, to run/receive a 5c.3 review, or to own a C4 stage spanning several of its managers.
- The coupling rule: independent work -> T3. Dependent judgment -> T2. Dependent stages -> T4.`;

function emit(out) {
  const lines = CASES.map((c) => JSON.stringify({
    id: c.id,
    prompt: `${RUBRIC}\n\nREQUEST: "${c.q}"`,
  }));
  const dest = out || path.join(HERE, 'routing-eval-prompts.jsonl');
  fs.writeFileSync(dest, lines.join('\n') + '\n', 'utf8');
  console.log(C.b('\nAlfred routing eval — prompts emitted\n'));
  console.log(`  ${lines.length} prompts -> ${dest}`);
  console.log(C.d('\n  Run each prompt through the router under test, then write results as JSONL:'));
  console.log(C.d('    {"id":"r01-secret-history","owner":"sec-secrets-hunter","depth":"direct"}'));
  console.log(C.d('\n  Score with:  node brain/routing-eval.mjs --score results.jsonl\n'));
}

// ---------------------------------------------------------------------------- score
function score(file) {
  const got = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    got.set(r.id, r);
  }

  let owner = 0, depth = 0, both = 0, missing = 0, topoOk = 0, topoTotal = 0;
  const behaviourMisses = [];
  const fails = [];

  for (const c of CASES) {
    const r = got.get(c.id);
    if (!r) { missing++; continue; }
    const want = [c.expect].flat();
    const okOwner = want.includes(r.owner)
      || (want.length > 1 && want.every((w) => (r.owner || '').includes(w)));
    let okDepth = r.depth === c.depth;
    if (c.topology) { topoTotal++; if (r.topology === c.topology) topoOk++; }

    // `requireEither` — amended cases where the right answer is not a single label but a BEHAVIOUR.
    // r21 may act on a rollback, but only with an independent recovery check or a stated causal
    // premise; r24 may commit to the program, but only after citing confirm-before-fanout. Scored
    // against the router's stated reasoning, because a claim it never made is one it cannot be
    // credited for. CLARIFY satisfies these by construction — nothing has been committed yet.
    if (c.requireEither && r.owner !== 'CLARIFY') {
      const why = `${r.why || ''} ${r.gate || ''}`.toLowerCase();
      const has = {
        verifier: /verif|independent|confirm(ed|s)? (that )?login|recover/.test(why),
        statedPremise: /premise|assum|if .*(does not|doesn't|not) recover|fallback|cause/.test(why),
        confirmBeforeFanout: /confirm[- ]before|present the plan|ceo (approval|sign|confirm)|before (the )?fan/.test(why),
      };
      const need = Object.keys(c.requireEither);
      const met = need.some((k) => has[k]);   // "either" — any one satisfies
      if (!met) {
        okDepth = false;   // fold into the pass/fail so it cannot silently pass on owner alone
        behaviourMisses.push(`${c.id}: none of [${need.join(', ')}] present in the router's reasoning`);
      }
    }
    if (okOwner) owner++;
    if (okDepth) depth++;
    if (okOwner && okDepth) both++;
    if (!okOwner || !okDepth) {
      fails.push({ c, r, okOwner, okDepth });
    }
  }

  const n = CASES.length;
  const pct = (x) => `${((x / n) * 100).toFixed(1)}%`;

  console.log(C.b('\nAlfred routing eval — results\n'));
  console.log(`  ROUTING ACCURACY  ${C.b(pct(owner))}  (${owner}/${n})   did it pick the right owner`);
  console.log(`  DEPTH ACCURACY    ${C.b(pct(depth))}  (${depth}/${n})   did it pay for the right chain`);
  console.log(`  BOTH              ${C.b(pct(both))}  (${both}/${n})`);
  if (behaviourMisses.length) { console.log(); for (const b of behaviourMisses) console.log(`  ${C.y("behaviour")} ${b}`); }
  if (topoTotal) {
    const tp = `${((topoOk / topoTotal) * 100).toFixed(1)}%`;
    console.log(`  TOPOLOGY ACCURACY ${C.b(tp)}  (${topoOk}/${topoTotal})   did it pick the right shape`);
  }
  if (missing) console.log(`  ${C.y(`${missing} case(s) had no result — counted as failures`)}`);

  // Over-engagement is scored separately: it is the failure that costs money rather than accuracy.
  const neg = CASES.filter((c) => SENTINELS.has([c.expect].flat()[0]));
  const negOk = neg.filter((c) => SENTINELS.has(got.get(c.id)?.owner)).length;
  console.log(`\n  ${C.d('over-engagement guard')}  ${negOk}/${neg.length} negative cases held `
            + C.d('(spawning on a NONE/CLARIFY is a pure cost leak)'));

  if (fails.length) {
    console.log(C.b('\n  Failures\n'));
    for (const { c, r, okOwner, okDepth } of fails) {
      console.log(`  ${C.r(c.id)}  "${c.q.slice(0, 62)}${c.q.length > 62 ? '…' : ''}"`);
      if (!okOwner) console.log(`     owner  want ${C.g([c.expect].flat().join('+'))}  got ${C.r(r?.owner ?? '—')}`);
      if (!okDepth) console.log(`     depth  want ${C.g(c.depth)}  got ${C.r(r?.depth ?? '—')}`);
      console.log(C.d(`     trap: ${c.trap}`));
      console.log();
    }
  }
  console.log();
  process.exit(fails.length || missing ? 1 : 0);
}

// ---------------------------------------------------------------------------- main
const [, , cmd, arg] = process.argv;
if (cmd === '--check') check();
else if (cmd === '--emit') emit(arg);
else if (cmd === '--score') {
  if (!arg) { console.error('--score needs a results.jsonl path'); process.exit(2); }
  score(arg);
} else {
  console.error('usage: routing-eval.mjs --check | --emit [out.jsonl] | --score <results.jsonl>');
  process.exit(2);
}
