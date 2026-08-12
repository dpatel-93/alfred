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
// R3.1: 'full+review' is GONE. It fused two axes ORG.md §5e itself calls orthogonal — shape (how
// deep a chain was paid for) and stakes (whether an independent reviewer was engaged). The fusion
// made "manager entry + independent review" inexpressible, so a router that correctly wanted review
// had to claim VP depth in order to say so. Depth and review are now separate, scored separately.
const DEPTHS = new Set(['none', 'direct', 'full']);
const TOPOLOGIES = new Set(['T0', 'T1', 'T2', 'T3', 'T4']);
/** Legacy transcripts wrote the fused value. The mapping is deterministic, so old runs re-score. */
function splitDepth(d) {
  return d === 'full+review' ? { depth: 'full', review: true } : { depth: d, review: undefined };
}

/** name -> parent, read from the same frontmatter validate-org.mjs treats as authoritative. */
function parentage() {
  const par = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && e.name !== 'ORG.md') {
        const src = fs.readFileSync(p, 'utf8');
        const n = src.match(/^name:\s*(\S+)/m);
        const pa = src.match(/^parent:\s*(\S+)/m);
        if (n) par.set(n[1], pa ? pa[1] : null);
      }
    }
  };
  walk(AGENTS);
  return par;
}

/**
 * Is `name` inside the subtree rooted at `root` (inclusive)? Derived, never hand-listed — a
 * hand-list is exactly what omitted devops-manager from r21 and turned a router pass into a
 * scorer failure.
 */
function inSubtree(name, root, par = parentage()) {
  let cur = name, hops = 0;
  while (cur && hops++ < 12) {
    if (cur === root) return true;
    cur = par.get(cur);
  }
  return false;
}

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
    // CLARIFY carries depth 'none' — nothing has been spawned yet, so no depth has been paid.
    // This ambiguity cost 5 false failures on the first run.
    //
    // A case listing CLARIFY as an ACCEPTABLE answer beside a real owner is unscorable against a
    // single depth: clarifying pays 'none' and routing pays the stated depth, so one accepted
    // answer is always marked wrong. R3.1 makes that construction IMPOSSIBLE TO WRITE rather than
    // merely detectable — such a case must declare the conditional `onProceed` branch, and the
    // primary must be the CLARIFY/depth-'none' arm. Checking expect[0] alone is what let r24 ship
    // broken; it is not enough to catch the mistake, the shape has to refuse it.
    const wants = [c.expect].flat();
    if (wants.includes('CLARIFY')) {
      if (wants.length > 1 || c.onProceed) {
        if (wants[0] !== 'CLARIFY' || c.depth !== 'none') {
          errs.push(`${c.id}: a case where CLARIFY is one acceptable answer must put CLARIFY `
                  + `first with depth 'none' (the arm where nothing has been spawned), and put the `
                  + `routing arm in onProceed. Got expect[0]="${wants[0]}" depth="${c.depth}".`);
        }
        if (!c.onProceed) {
          errs.push(`${c.id}: lists CLARIFY beside a real owner but declares no onProceed branch, `
                  + `so the routing arm has no ground truth to score against.`);
        } else {
          if (!c.onProceed.expect) errs.push(`${c.id}: onProceed needs an expect`);
          for (const d of [c.onProceed.depth].flat().filter(Boolean)) {
            if (!DEPTHS.has(d)) errs.push(`${c.id}: onProceed has unknown depth "${d}"`);
          }
          if (c.onProceed.subtree && !names.has(c.onProceed.subtree)) {
            errs.push(`${c.id}: onProceed subtree root "${c.onProceed.subtree}" is not on disk`);
          }
        }
      } else if (c.depth !== 'none') {
        errs.push(`${c.id}: CLARIFY must carry depth 'none' — nothing has been spawned yet.`);
      }
    }
    if (c.review !== undefined && typeof c.review !== 'boolean') {
      errs.push(`${c.id}: review must be a boolean — it is a separate axis from depth, not a suffix`);
    }
    for (const d of [c.depth].flat()) {
      if (!DEPTHS.has(d)) errs.push(`${c.id}: unknown depth "${d}"`);
    }
    if (c.subtree && !names.has(c.subtree)) {
      errs.push(`${c.id}: subtree root "${c.subtree}" is not an agent on disk`);
    }
    if (c.topology && !TOPOLOGIES.has(c.topology)) errs.push(`${c.id}: unknown topology "${c.topology}"`);
    if (!c.trap || c.trap.length < 30) {
      errs.push(`${c.id}: missing or trivial trap — a case with no plausible wrong answer is not `
              + `discriminating anything`);
    }
    // Guard against the circularity this dataset exists to avoid: a question lifted from the very
    // charter it is supposed to be testing measures nothing but string matching. This guard already
    // caught six cases written by this dataset's own author.
    //
    // R3.1: it used to check only expect[0], so a multi-owner case could be lifted verbatim from
    // its SECOND listed owner's charter and pass. Same expect[0] narrowness that shipped r24 broken
    // and silently shrank the over-engagement denominator — third instance of one bug. Now every
    // candidate owner in every branch is checked, subtree roots included.
    const candidates = [
      ...[c.expect].flat(), c.subtree,
      ...(c.onProceed ? [...[c.onProceed.expect].flat(), c.onProceed.subtree] : []),
    ].filter((x) => x && !SENTINELS.has(x));
    for (const cand of new Set(candidates)) {
      const f = findFile(cand);
      if (f && fs.readFileSync(f, 'utf8').toLowerCase().includes(c.q.toLowerCase().slice(0, 40))) {
        errs.push(`${c.id}: question is lifted verbatim from ${cand}'s charter — circular`);
      }
    }
  }

  const byDepth = {};
  for (const c of CASES) byDepth[c.depth] = (byDepth[c.depth] || 0) + 1;

  console.log(C.b('\nAlfred routing eval — dataset check\n'));
  console.log(C.d(`  ${CASES.length} cases · ${names.size} agents on disk`));
  console.log(C.d(`  depth mix: ${Object.entries(byDepth).map(([k, v]) => `${k}=${v}`).join('  ')}`));
  // Counted with the SAME predicate --score uses, so the two can never disagree about the
  // denominator. They disagreed once, silently, and the resulting number was reported as a win.
  const sentinel = CASES.filter((c) => !c.preferProceed
                                    && [c.expect].flat().some((w) => SENTINELS.has(w))).length;
  const exempt = CASES.filter((c) => c.preferProceed).length;
  console.log(C.d(`  ${sentinel} negative cases (NONE/CLARIFY) — these catch over-engagement, `
                + `which no pre-R2 check measured`));
  if (exempt) console.log(C.d(`  ${exempt} case(s) exempt via preferProceed — ground truth prefers `
                            + `acting; exempt by recorded adjudication, not by result\n`));
  else console.log();

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
 "depth":"none|direct|full",
 "review":true|false,
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

DEPTH is the ENTRY POINT this routing decision commands, nothing more:
  "direct" = your first spawn IS the owner (employee OR manager), no VP anywhere on the path.
  "full"   = a VP is legitimately on the path — T3 adjudication, a cross-manager reconcile, a C4
             stage spanning several of its managers, or as the 5c.3 review recipient.
A manager's own internal fan-out does NOT make this "full". That is the manager's staffing decision,
governed by its own charter; this eval measures YOUR routing decision. "review" is a SEPARATE bit —
set it true when stakes call for an independent reviewer, at whatever depth. Do not raise depth in
order to signal review.

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
  console.log(C.d('\n  Run each prompt through the router under test, then write results as JSONL.'));
  console.log(C.d('  PERSIST EVERY FIELD THE ROUTER RETURNS. R3 captured only owner/depth/topology,'));
  console.log(C.d('  so the three required classification fields were emitted and then dropped by the'));
  console.log(C.d('  capture step — enforced in the prompt and nowhere in the measurement. --score'));
  console.log(C.d('  now reports FIELD COMPLIANCE, which goes red if the capture regresses again:'));
  console.log(C.d('    {"id":"r01-secret-history","owner":"sec-secrets-hunter","depth":"direct",'));
  console.log(C.d('     "review":false,"topology":"T1","stakes":"S1","blocking_premises":"...",'));
  console.log(C.d('     "gate":"proceed — because ...","why":"..."}'));
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
  let revOk = 0, revTotal = 0, fieldOk = 0;
  const behaviourMisses = [];
  const fails = [];
  const par = parentage();
  const FIELDS = ['owner', 'depth', 'topology', 'stakes', 'blocking_premises', 'gate', 'why'];

  for (const c of CASES) {
    const r = got.get(c.id);
    if (!r) { missing++; continue; }

    // Field-presence compliance. R3 claimed three REQUIRED classification fields and then measured
    // none of them — they were emitted upstream and dropped by the capture step. By this project's
    // own rule ("a policy with no observable output is not enforced") the mandate was half-enforced.
    // It is now a reported number, so the gap is visible in the artifact instead of the transcript.
    if (FIELDS.every((f) => r[f] !== undefined && r[f] !== '')) fieldOk++;

    // A CLARIFY-arm case scores against whichever arm the router actually took.
    const clarified = r.owner === 'CLARIFY';
    const arm = (!clarified && c.onProceed) ? c.onProceed : c;
    const want = [arm.expect].flat();
    const norm = splitDepth(r.depth);

    // Owner: exact match, or — for outcome-defined cases — membership in the subtree that owns the
    // outcome. Bounded on purpose: pure behaviour-only scoring is gameable, since any agent plus the
    // word "verify" would pass.
    const okOwner = want.includes(r.owner)
      || (arm.subtree ? inSubtree(r.owner, arm.subtree, par) : false)
      || (want.length > 1 && !arm.subtree && want.every((w) => (r.owner || '').includes(w)));

    let okDepth = [arm.depth].flat().includes(norm.depth);

    // Review is its own bit, scored only where the ground truth takes a position on it.
    if (arm.review !== undefined) {
      revTotal++;
      const gotReview = norm.review !== undefined ? norm.review : Boolean(r.review);
      if (gotReview === arm.review) revOk++;
    }
    // Topology is not scored on a CLARIFY answer — nothing has been spawned, so no shape has been
    // paid for. The mirror of the depth-on-CLARIFY rule.
    if (arm.topology && !clarified) { topoTotal++; if (r.topology === arm.topology) topoOk++; }

    // `requireEither` — amended cases where the right answer is not a single label but a BEHAVIOUR.
    // r21 may act on a rollback, but only with an independent recovery check or a stated causal
    // premise; r24 may commit to the program, but only after citing confirm-before-fanout. Scored
    // against the router's stated reasoning, because a claim it never made is one it cannot be
    // credited for. CLARIFY satisfies these by construction — nothing has been committed yet.
    const needEither = arm.requireEither || (clarified ? null : c.requireEither);
    if (needEither && !clarified) {
      // blocking_premises is where the premise ACTUALLY lives, and R3's matcher did not look at it.
      const why = `${r.why || ''} ${r.gate || ''} ${r.blocking_premises || ''}`.toLowerCase();
      const has = {
        verifier: /\bverif(y|ies|ied|ication)\b|\bindependent\b|\brecover(y|ed|s)?\b/.test(why),
        // \bcaus... deliberately word-boundaried: the mandated gate format is "... — because ...",
        // so a bare /cause/ matched EVERY format-compliant response and this check was vacuous.
        statedPremise: /\bpremise\b|\bassum(e|ed|ption)\b|\bfallback\b|\bcaus(e|es|ed|al)\b|if .*(does not|doesn't|not) recover/.test(why),
        confirmBeforeFanout: /confirm[- ]before|present the plan|ceo (approval|sign|confirm)|before (the )?fan/.test(why),
      };
      const need = Object.keys(needEither);
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
  if (revTotal) {
    console.log(`  REVIEW BIT        ${C.b(`${((revOk / revTotal) * 100).toFixed(1)}%`)}  `
              + `(${revOk}/${revTotal})   did stakes call for an independent reviewer`);
  }
  if (behaviourMisses.length) { console.log(); for (const b of behaviourMisses) console.log(`  ${C.y("behaviour")} ${b}`); }
  if (topoTotal) {
    // Reported as a raw fraction, never as a headline percentage. At n=2 a single case moves the
    // number 50 points, which is a sample-size artifact rather than a measurement.
    const note = topoTotal < 8 ? C.y(`  UNDER-SAMPLED at n=${topoTotal} — not a rate`) : '';
    console.log(`  TOPOLOGY          ${C.b(`${topoOk}/${topoTotal}`)}   did it pick the right shape${note}`);
  }
  console.log(`  FIELD COMPLIANCE  ${C.b(`${((fieldOk / n) * 100).toFixed(1)}%`)}  (${fieldOk}/${n})   `
            + C.d('all 7 response fields present in the captured artifact'));
  if (fieldOk < n) {
    console.log(C.y(`    ${n - fieldOk} result(s) are missing required classification fields. If the `
              + `router emitted\n    them and the capture step dropped them, the mandate is enforced `
              + `in the prompt and\n    nowhere in the measurement — which is the failure this axis exists to expose.`));
  }
  if (missing) console.log(`  ${C.y(`${missing} case(s) had no result — counted as failures`)}`);

  // Over-engagement guard. Measures the failure that costs money rather than accuracy.
  //
  // The denominator DERIVES from current ground truth at score time and is never a frozen list.
  // Selecting on expect[0] once let a ground-truth edit silently shrink it 8 -> 6, and the
  // resulting 6/6 got reported as a restoration when the honest fixed-denominator number was 7/8.
  // A case leaves this population only when the ground truth says proceeding is the PREFERRED
  // answer (preferProceed), which is a recorded adjudication rather than a scoring convenience.
  //
  // HOLDS iff the router committed no unconfirmed spend: it clarified, stayed in-session, or
  // emitted an explicit confirm-before-fanout gate. The gate counts because ORG.md §5c.2 treats
  // stating the plan and waiting as the correct behaviour — and because the one-shot harness gives
  // the router no second turn in which to honour or break that gate. Whether a gate is HONOURED is
  // not tested here and cannot be, from a single artifact; that is R3.2's two-turn probe.
  const neg = CASES.filter((c) => !c.preferProceed && [c.expect].flat().some((w) => SENTINELS.has(w)));
  const heldBy = (r) => (SENTINELS.has(r?.owner) ? 'sentinel'
    : /^confirm[- ]before[- ]fanout/i.test(r?.gate || '') ? 'gated' : null);
  const negHeld = neg.filter((c) => heldBy(got.get(c.id)));
  const gatedHolds = negHeld.filter((c) => heldBy(got.get(c.id)) === 'gated').length;
  console.log(`\n  ${C.d('over-engagement guard')}  ${negHeld.length}/${neg.length} negative cases held `
            + C.d('(no unconfirmed spend: sentinel answer or an explicit confirm-before-fanout gate)'));
  if (gatedHolds) console.log(C.d(`    ${gatedHolds} held by gate rather than by sentinel — `
                                + `gate HONOURING is untested offline (R3.2)`));

  // Counterweight, so the guard cannot be gamed by gating everything. On a positive C1 case — one
  // real owner, direct entry, no review called for — the correct gate is 'proceed'. Over-gating a
  // typo is a cost failure in exactly the way over-spawning one is, and without this the cheapest
  // way to a perfect guard would be to gate every answer in the set.
  const c1 = CASES.filter((c) => !SENTINELS.has([c.expect].flat()[0]) && !c.onProceed
                              && [c.depth].flat().join() === 'direct' && c.review !== true);
  const overGated = c1.filter((c) => {
    const g = got.get(c.id)?.gate;
    return g && !/^proceed/i.test(g);
  });
  const c1Scored = c1.filter((c) => got.get(c.id)?.gate).length;
  console.log(`  ${C.d('over-gating counterweight')}  ${c1Scored - overGated.length}/${c1Scored} `
            + `C1 cases correctly gated 'proceed'` + (c1Scored < c1.length
              ? C.y(`   ${c1.length - c1Scored} unscorable — no gate field captured`) : ''));
  for (const c of overGated) {
    console.log(`    ${C.r('over-gated')} ${c.id}: gate "${got.get(c.id).gate.slice(0, 48)}…" on a `
              + `one-owner direct case`);
  }

  if (fails.length) {
    console.log(C.b('\n  Failures\n'));
    for (const { c, r, okOwner, okDepth } of fails) {
      console.log(`  ${C.r(c.id)}  "${c.q.slice(0, 62)}${c.q.length > 62 ? '…' : ''}"`);
      if (!okOwner) console.log(`     owner  want ${C.g([c.expect].flat().join('+'))}`
                             + `${c.subtree ? C.d(` (or inside ${c.subtree})`) : ''}  got ${C.r(r?.owner ?? '—')}`);
      if (!okDepth) console.log(`     depth  want ${C.g([c.depth].flat().join('|'))}  got ${C.r(splitDepth(r?.depth).depth ?? '—')}`);
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
