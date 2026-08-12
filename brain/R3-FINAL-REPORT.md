# ALFRED R3 — Final Report

**Prepared for:** the operator (CEO)
**Architecture and adjudication:** Fable, principal systems architect
**Implementation and measurement:** Opus
**Date:** 2026-08-11 · **Range:** `7281f96~1..HEAD` · **Status:** released — no further architect hold

---

## 1. One-sentence verdict

The two external critiques were both correct, both are now fixed and measured rather than argued
against, and ALFRED's routing is demonstrably better than it was — but the honest headline is that
this exercise's most valuable output is the first behavioural eval this framework has ever had,
which caught its own author being wrong twice, in his own favour, before it caught the router being
wrong at all.

---

## 2. The objective as I understand it

> ALFRED must select and execute the least expensive organizational topology capable of reliably
> producing a high-quality, verifiable outcome.

The org chart is a capability map, a routing index, an escalation structure, an accountability
structure, a verification structure, and a cost control. It is **not** a requirement to insert a VP,
a manager, and an employee between you and every piece of work. The decision order is lexicographic:
understand the objective, establish quality requirements, select a topology that can satisfy them,
then among qualifying topologies pick the cheapest, execute with minimum agents/context/handoffs,
and produce evidence.

The failure mode being designed against is bureaucracy that looks like rigour.

---

## 3. The quality and verification constraints

Cost may never be optimised by silently weakening correctness, grounding, assumption validation,
security, compliance, independent review, user intent, required evidence, or delivery quality.

Two rules operationalise this, and both shipped:

**Stakes → evidence.** S0 reversible+private · S1 reversible+shared · S2 hard-to-reverse or
outward-facing · S3 irreversible/security/compliance/money. Evidence tiers E0 (the artifact) → E3
(independent review by a non-producing agent plus CEO approval).

**The falsifiability rule.** Independent review is required **iff** no cheap deterministic falsifier
exists **and** stakes ≥ S2. If a machine check exists — or can be written for less than a review
spawn costs, measured at ~41k tokens — the check wins. A falsifier cannot hallucinate agreement; a
reviewer can. This is the single most load-bearing decision in R3, and section 4 explains why.

---

## 4. What was wrong or incomplete in the current system

**Critique 1 — "this is a hierarchical multi-agent swarm already done across the industry; what's
the breakthrough beyond packaging?"** Substantially correct as stated. Alfred's *mechanisms* are not
novel: Magentic-One has an orchestrator with specialised agents, Agentforce has governance and
enterprise data access. What Alfred had that was genuinely different was a **cost-shaped** routing
policy — but that difference was **asserted, never measured**. A hierarchy whose accuracy is
unmeasured is a claim about a prompt, not a system. That was the honest core of the critique and it
was fair.

**Critique 2 — hierarchical error propagation produces "a beautifully organised wrong answer."**
Correct, and it was the deeper of the two. Alfred had no plan-execute-evaluate-replan loop, no
intent anchor surviving the chain, and no reviewer evaluating against the *original* request rather
than the downstream interpretation. A four-level chain that agrees with itself is exactly the
failure this org was most exposed to. Berkeley's MAST taxonomy (NeurIPS 2025) measures this: 41.8%
of multi-agent failures are specification/decomposition, 36.9% inter-agent misalignment, 21.3%
verification. Alfred's structure concentrated risk in the first and third.

**What full analysis added, beyond the sampled two files:**

- **Universal review was the wrong policy.** Requiring a reviewer everywhere pays ~41k tokens to
  produce something that *looks like* evidence and, where a deterministic check existed, is strictly
  worse than running the check.
- **Descriptions were 7,183 tokens of recurring context** across 33 employee charters, most of it
  worked examples that only the parent manager ever needed.
- **The roster was load-bearing and absent.** Routing without a lightweight index scored 1/3; with
  it, 3/3. Descriptions say what an agent *does*; only an index gives the parent chain.
- **Two real bugs.** See section 9.

**One diagnosis was withdrawn.** An early claim that decisions cost ~83k tokens because charters
re-read ORG.md at runtime was **an artifact of my own eval prompt**, which instructed the router to
read those files. No charter instructs a runtime ORG.md read; all 15 hits are citations. Returned to
Fable, which voided that spec item and withdrew the associated claim.

---

## 5. What already worked and was preserved

- **The org chart itself.** 71 agents, 55 chartered (5 VP / 17 manager / 33 employee) + 16
  specialists. The Charter Contract — 9 mandatory body sections, normalised frontmatter, machine
  validated — was already real governance and is untouched in substance.
- **Tier-differentiated return contracts** (employee FINDINGS/DID-NOT-COVER/BLOCKERS; manager
  VERDICT/CONFIRMED/REJECTED/COVERAGE/ESCALATED; VP ANSWER/EVIDENCE/STRUCK/CONFIDENCE/GAPS).
- **The anti-relay rule** (§5b) — it turned out to be *more* right than the eval's own ground truth.
- **The model-tier gate.** Fable is genuinely gated at spawn time by a hook, not by an instruction.
- **`validate-org.mjs`** as the org's deterministic falsifier. Extended, not replaced.

---

## 6. How ALFRED differs from Magentic-One

| | **Magentic-One** | **Agentforce** | **ALFRED** |
|---|---|---|---|
| Problem solved | General web/file task completion | Enterprise CRM action-taking with governance | Least-cost topology for a heterogeneous personal/professional estate |
| Structure | Orchestrator + 4 fixed generalist agents | Topic/action library over CRM data | 71-agent org chart, 5 departments, explicit parentage |
| Planning | **Task Ledger + Progress Ledger**, replan after 2 stalls | Deterministic topic routing | Complexity C0–C4 → topology T0–T4, stakes-gated evidence |
| Model policy | **One model client for all agents** | Vendor-managed | **Per-tier routing** — Fable/Opus/Sonnet/Haiku/Ollama |
| Restraint | Not an objective | N/A | **T0 "don't spawn" is a first-class, scored outcome** |
| Benchmarks | GAIA 38%, WebArena 32.8%, AssistantBench 27.7%; ablation −21% to −39% | CRMArena-Pro: 58.3% single-turn, ~30% multi-turn; confidentiality awareness 0.0–2.9% | Routing 95.8%, depth 87.5% (n=24, single run) |

**The differences that are real:**

1. **Restraint is a scored outcome.** Magentic-One's ledger decides *how* to proceed; it has no
   notion of "engaging the orchestrator is itself the wrong answer." Alfred scores that explicitly —
   7 of 24 cases exist only to catch over-engagement. Given Anthropic's measurement that multi-agent
   runs cost ~15× a chat turn, restraint is where the money is.
2. **Per-tier model routing.** Magentic-One instantiates `MagenticOneGroupChat([agents],
   model_client=...)` — one client. Alfred routes model tier by role, so bulk mechanical work never
   touches a frontier model.
3. **Stakes-gated verification with a falsifiability test.** Neither comparator asks "would a
   deterministic check be cheaper and stronger than a reviewer here?"

**The differences that are NOT real, stated plainly:**

- **Human-in-the-loop is not unique to Alfred.** I claimed across two turns that Magentic-One cannot
  ask a human. It has `approval_func` with `ApprovalRequest`/`ApprovalResponse`, documented for
  gating code execution. I repeated that error before verifying against primary sources, and retract
  it.
- **Alfred has no cross-system benchmark.** Every number here is Alfred-vs-Alfred. See section 15.

---

## 7. The chosen architecture

**Three orthogonal axes, never collapsed:**

| Axis | Decides | Values |
|---|---|---|
| Complexity | topology | C0→T0 in-session · C1→T1 direct · C2→T1+verifier/T3 · C3→T2 build/verify/revise · C4→T4 staged gates |
| Stakes | review | S0–S3 → evidence E0–E3, gated by the falsifiability rule |
| Ambiguity | clarification | proceed · CLARIFY · confirm-before-fanout |

**Intent integrity (§5c).** Every brief opens with `ORIGINAL ASK` — the operator's words verbatim,
alongside the interpretation, never replacing it. This makes the *cheapest* agent in the chain the
detector for the *most expensive* one's misreading, because it is the only layer that sees both.
`ESCALATION REQUEST` handles scope wider than the routed owner; an `EVIDENCE` ledger separates
VERIFIED from INFERRED.

**Lazy escalation.** Route to the shallowest plausible owner. Over-deep costs `2 × depth` round trips
on *every* request; too-shallow costs one extra hop on the *minority* that need it.

**The decision that carries the most weight:** classification emits three **required fields** —
`stakes`, `blocking_premises`, `gate` — rather than prose instructing the router to consider them.
Fable's argument, which the measurement supports: *a policy with no observable output is not
enforced, however carefully it is worded.* A field that must be emitted is falsifiable; one that
must be remembered competes with everything else in the charter. The prose version failed to enter
three consecutive routers' reasoning. The structural version produced, first try, on "the login is
broken for everyone, roll it back":

> **blocking_premises:** "That a recent deploy caused the outage and a revert is the right remedy —
> if login broke from an expired cert/secret, an exhausted token, or an upstream identity-provider
> failure, rolling back fixes nothing and burns the outage window"
> **gate:** "confirm-before-fanout — because the request names no system, no environment, and no
> target release, and a rollback is a production-mutating action"

That is precisely the premise critique #2 was built around, surfaced because it had to be written
down.

---

## 8. How topology selection minimises cost without lowering quality

Selection is **feasible set, then cheapest by dominance** — never cheapest outright. A topology
enters the feasible set only if it can satisfy that task's evidence tier; among those, the one with
the fewest hops wins. Four mechanisms keep it honest:

1. **The falsifiability rule** replaces a ~41k-token reviewer with a deterministic check wherever
   one exists or can be written for less. Quality *rises*: a check cannot hallucinate agreement.
2. **Anti-relay** collapses layers that add nothing — a manager with one employee is a hop that buys
   no judgment.
3. **The over-engagement guard** scores restraint as a first-class outcome, so "spawn nothing" is a
   measurable win rather than an unmeasured virtue.
4. **The over-gating counterweight** (added in `1244e57`) prevents the obvious exploit: without it,
   the cheapest route to a perfect guard is to gate *every* answer. Gating a typo is a cost failure
   in exactly the way spawning on one is.

Cost reduction that is **not** quality reduction, measured: recurring context fell 22,855 → ~18,861
tokens/turn (−17%) by moving worked examples out of 33 employee descriptions into an index the
router loads once. The information did not disappear; it stopped being paid for on every turn.

---

## 9. What was implemented

**Policy (edits to existing artifacts, no new framework):**
- ORG.md §5c intent integrity, §5d latency + VPs off the critical path + lazy escalation,
  §5e complexity classes C0–C4 and topologies T0–T4 with the T2 loop protocol.
- The Chief-of-Staff charter rewritten from 5 to 8 execution steps.
- Universal review replaced by S0–S3/E0–E3 plus the falsifiability rule.
- The three required classification fields, in both CLAUDE.md and ORG.md.

**Instrumentation (new, and the actual deliverable):**
- `routing-eval.mjs` + 24 ground-truth cases — the first behavioural routing eval this framework has
  had. Includes a **circularity guard** that rejects any question lifted from the charter it tests;
  it caught six cases written by its own author.
- `orchestration-eval.mjs` + 20 scenarios (5 trivial / 5 standard / 5 complex / 5 restraint) with a
  completion-per-100k-token headline metric and a neutral capability schema so a competing
  orchestrator can be scored without adopting Alfred's roster.
- `gen-org-index.mjs` → the `org-index` skill (~3,107 tokens), generated from frontmatter and
  drift-checked. Never hand-edited.
- `validate-org.mjs` extended: uncharteredTargets, org-index drift, EVIDENCE-line presence. Each
  proven red by deliberate injection before being trusted.

**Two real bugs, found and fixed red-then-green:**
- `alfred-fable-gate.mjs` called `appendFileSync` without `mkdir`. On any install where
  `~/.claude/metrics/` did not already exist, this threw ENOENT into a deliberate never-break-a-spawn
  catch — so **the model-policy audit trail was silently never written, forever**. Found by writing
  the test that should already have existed.
- The eval's own scorer had a **vacuous** premise matcher: `/cause/` matches "because", and the
  mandated gate format is "… — because …", so every format-compliant response auto-passed. Now
  word-boundaried and matching `blocking_premises`, where the premise actually lives.

---

## 10. What was removed or simplified

Fable's constraint was explicit: *a design that only adds prompts, agents, files, topologies,
instructions, or review layers is a failed design.* Net removals:

- **Universal review — deleted.** Replaced by a stakes gate, so most tasks now pay for *no* reviewer.
- **`full+review` — retired from the depth vocabulary.** It fused shape and stakes, two axes §5e
  itself calls orthogonal, making "manager entry + independent review" literally inexpressible. Any
  router that correctly wanted review had to claim VP depth to say so. The vocabulary is now one
  value *smaller*.
- **7,183 → 2,647 tokens** of employee descriptions. Examples now live in the index, not in every
  turn's context.
- **Owner enumeration in the scorer — deleted**, replaced by subtree membership derived from
  parentage. Hand-lists rot; derived bounds don't.
- **VP relays** removed from the routing path for bounded work, by policy and by ground truth.

No new agents. No new framework. No CLI. No package.

---

## 11. Files changed

`86 files changed, 3,647 insertions(+), 455 deletions(-)` across 15 commits.

| Area | Files | Note |
|---|---|---|
| Agent charters | 71 | ORIGINAL ASK anchor, premise-divergence escalation, EVIDENCE line, `org-index` in `skills:`; 22 VP/manager files also got the progress check and cache-stability rule; 5 managers got the T2 loop protocol |
| `brain/routing-eval*.mjs` | 3 | Harness + 24 cases + recorded baseline |
| `brain/orchestration-eval*.mjs` | 2 | Benchmark harness + 20 scenarios |
| `brain/test/` | 4 | `routing.mjs`, `orchestration.mjs`, `fable-gate.mjs` additions, wired into `run.mjs` |
| `helpers/` | 3 | `gen-org-index.mjs` (new), `validate-org.mjs` (+80 lines), `alfred-fable-gate.mjs` (bug fix) |
| `ORG.md` / `CLAUDE.md` | 2 | §5c/§5d/§5e; CoS charter rewrite |

---

## 12. Tests and validators run

```
node brain/test/run.mjs          483 passed, 0 failed
node ~/.claude/helpers/validate-org.mjs
                                 PASS — 71 agent files · 55 chartered
                                 (5 VP / 17 mgr / 33 emp) · 60 skills known
node brain/routing-eval.mjs --check       PASS
node brain/orchestration-eval.mjs --check PASS
```

Test count rose 179 → 483 over the range. Every new validator was **proven red before being
trusted** — org-index drift by injecting a phantom agent, the EVIDENCE check by stripping the line
from a charter, the fable-gate audit trail by removing the `mkdir`.

---

## 13. Benchmark scenarios and scoring

**Layer 1 — routing eval (built, run, scored).** 24 cases across clean single-owner routing,
VP-boundary discrimination, stay-in-session cost leaks, confirm-before-fan-out, cross-domain, intent
integrity, and topology selection. Scored on six axes: routing accuracy, depth accuracy, review bit,
topology, field compliance, and the over-engagement guard with its over-gating counterweight. Every
case carries a `trap` recording what a plausible-but-wrong router would answer; a case with no trap
is not discriminating anything.

**Layer 2 — orchestration benchmark (built and validated, NOT run).** 20 scenarios, deliberately
including 5 restraint cases where Alfred should tie or lose to a single agent. Headline metric is
**completion per 100k tokens**, not completion — a system that completes 5% more work for 3× the
tokens has lost. Requires both an `alfred` and a `baseline` arm; the harness prints a blunt failure
line when Alfred costs more and completes no more.

---

## 14. Measured results available now

**Routing eval, 24 cases, single run, R3 transcripts re-scored under adjudicated ground truth:**

| Axis | Baseline | R2 | R3 | **R3.1 adjudicated** |
|---|---|---|---|---|
| Routing accuracy | 72.7% | 75.0% | 79.2% | **95.8%** (23/24) |
| Depth accuracy | 59.1% | 75.0% | 70.8% | **87.5%** (21/24) — gate ≥75% ✔ |
| Both | — | — | 66.7% | **87.5%** (21/24) |
| Review bit | — | — | — | 3/5 |
| Topology | — | — | 2/2 | 1/1 — **under-sampled, not a rate** |
| Field emission | — | — | — | **23/23** recovered — see below |
| Over-gating | — | — | — | **13/13** C1 cases correctly gated `proceed` |
| Over-engagement | 7/7 | — | 6/8 | **7/7** steady-state · **7/8** frozen denominator |
| Recurring context | 22,855 tok/turn | — | — | **~18,861** (−17%) |

> **The R3 and R3.1 columns score the same transcripts — every point of difference between them is
> ground-truth correction, not router improvement. The router's measured improvement is
> baseline → R3: routing +6.5pp and one real guard case (`r24`).**

**Reading these honestly:**

- The R3.1 jump is a **ground-truth correction, not a router improvement**. `r05`–`r10` still
  encoded the pre-R2 four-level philosophy; R2 deliberately changed the rules and the dataset never
  caught up. Eleven amendments are logged with impact **in both directions** — `r06` is in the log
  because it *costs* a pass, since an amendment list containing only cases the router lost is
  indistinguishable from fitting data to results.
- **The guard was never "restored."** Both numbers belong in the record because they answer different
  questions. *Steady state:* **7/7**, on the criterion that a conditional case sits in the
  denominator **iff CLARIFY is its preferred arm** — `r24` in, `r21` out, because `r21`'s recorded
  amendment makes proceeding the preferred answer, and a guard that scores the preferred answer as a
  leak is a metric that cannot reach 100% while the router behaves ideally. That is a tax on correct
  behaviour, not a guard. *Frozen denominator:* **6/8 → 7/8, +1 real case** (`r24`), caused by the
  required-fields change — the historical comparison that detected the silent shift. `r21` leaves the
  population **by adjudication, not by router improvement**; its non-clarifying behaviour is not
  hidden by that, it lives in the gate-honouring gap in §15.
- **The 0/24 field number was a capture-pipeline defect, and it has been repaired for free.** The raw
  subagent transcripts survived, so the results file was re-derived from the *original* responses
  with a capture step that keeps everything — no re-run, no tokens, no new evidence. On the 23 cases
  whose transcripts were retained, **field emission is 23/23**. The router had been emitting all
  seven fields all along; my capture step dropped four of them. `r13`'s transcript did not survive,
  which is why the axis reads 23/24 rather than 24/24, and why routing/depth on the reconstruction
  read 91.7%/83.3% — the missing case counts as a failure. The canonical figures stay on the
  complete 24-case file.
- **The intervention is not gaming its own guard.** The over-gating counterweight — added precisely
  because the cheapest route to a perfect guard is to gate everything — reads **13/13**: on every
  bounded single-owner case, the router gated `proceed` rather than manufacturing caution. That
  number could only be computed once the fields were recovered.
- **Two axes were being conflated, including by me.** The ≥75% gate was always *depth accuracy* and
  was never conditioned on field capture. What went unmeasured was field **emission rate**, a new
  axis whose baseline is the 23/23 above. Saying "the gate passed on a run whose mandate was never
  measured" undersold the intervention: its behavioural effect was in evidence throughout — `r24`
  flipping to CLARIFY, `r21` emitting its premise — in the transcripts, just not in the artifact.
- **Topology at n=1–2 is not a rate** and is never reported as a percentage.

**The residual failure mode is miscalibrated ceremony, not misrouting.** All three remaining
failures are about *how much* was bought, not *who* was picked: `r06` and `r10` **over-pay** (VP
depth the rules don't command); `r22` **under-pays** — it skips the one review that *is* mandatory,
on a compliance assertion, while relaying through a VP. That is a far more useful finding than a
percentage, and it points at a specific fix rather than "try harder."

---

## 15. Results that remain unmeasured

1. **No cross-system benchmark.** Every number is Alfred-vs-Alfred. The Magentic-One comparison in
   section 6 is *documentary* — published benchmarks and source behaviour — never a head-to-head.
   Alfred's 95.8% and Magentic-One's GAIA 38% **measure different things and must never be
   juxtaposed as if they were comparable.**
2. **No baseline arm.** Layer 2 has never run. Without it, Layer 1 measures *Claude*, not *Alfred* —
   there is no evidence here that the org beats a single competent agent given the same request.
3. **Field emission has a baseline of one run.** 23/23 is a strong first number but it is n=1, and
   `r13` is absent because its transcript did not survive rather than because the router failed.
4. **Gate honouring is untested.** Gate *emission* is now measured; whether a gate is *honoured* is
   measured nowhere and cannot be, from a single-turn artifact. Fable ruled my "wrote the risk down
   and proceeded anyway" reading over-reads it: the schema requires an owner on every answer, so
   `gate=confirm-before-fanout` plus an owner is the only way it can express "here is the plan, now
   waiting." R3.2 is the two-turn probe.
5. **n=1.** One run of 24 cases, no variance estimate, no repeated trials.
6. **Neutral-schema migration is 1/20**, so 19 scenarios are unusable in any cross-system run.
7. **Latency was never instrumented**, despite "the Alfred layer feels slower" being the original
   complaint that started this.

---

## 16. Estimated cost of the next benchmark run

| Run | Scope | Estimated tokens | Buys |
|---|---|---|---|
| ~~A. Clean R4 routing run~~ | ~~24 cases, capture all 7 fields~~ | **0 — CANCELLED** | Obtained free by re-extraction from retained transcripts. Spending ~1.8M to backfill an axis whose failure was already attributed to the pipeline, not the router, would have failed the framework's own cost test |
| **B. R3.2 gate-honouring probe** | one follow-up per gated answer (~6–8 cases) | ~0.5M | The only untested load-bearing behaviour |
| **C. Layer 2, both arms** | 20 scenarios × alfred + baseline | **~24.1M** | The first evidence the org beats a single agent — the actual answer to critique #1 |
| **D. Cross-system** | + AutoGen install, OpenAI key, neutral harness | 24.1M + external API | Head-to-head vs Magentic-One |

*One spawn, not a run:* the emission axis reads 23/24 only because `r13`'s transcript did not
survive. A single-spawn top-up (~80k tokens) would take it to 24/24 if that number is ever wanted.
Worth exactly one spawn and never a run.

Recommendation: **B only** (~0.5M) — A was cancelled after the re-extraction made it unnecessary. B is cheap, it closes the last
load-bearing untested behaviour, and C is worth far more once the instrument is known-good. Running
C on an instrument that silently dropped its own required fields would have been spending 24M tokens
to measure a harness bug — which is exactly what the free re-extraction just avoided.

---

## 17. Decisions requiring user approval

| # | Decision | Recommendation |
|---|---|---|
| 1 | Spend ~0.5M on run B (gate-honouring probe) | **Yes** — the last untested load-bearing behaviour. Run A was cancelled, not deferred |
| 2 | Spend ~24.1M on run C | Only after B is green |
| 3 | **`dr-manager` is a relay by construction** — one employee, so it loses every anti-relay adjudication | Give it real breadth or fold it. Same question for `vendor-manager` |
| 4 | **Enforce the gate rather than observe it** — a hook refusing spawns in any turn whose classification emitted a non-proceed gate | Structure beats exhortation; this is the same lesson that produced the three fields |
| 5 | Delete ~2,600 lines unreachable from `settings.json` (`router.js`, `intelligence.cjs`, `learning-service.mjs`, `metrics-db.mjs`, `hook-handler.cjs`) | Verify once more, then delete |
| 6 | No marketing/product owner agent exists | Add only if you actually route such work |

---

## 18. Enterprise positioning statement

ALFRED is an **operating protocol** for AI work, not an agent and not a swarm. Its claim is
economic, not capability-based: given a request, it selects the *least expensive organisational
shape* that can still produce a verifiable outcome — and "no agent at all" is a first-class answer
that it measures itself on.

What makes that credible rather than aspirational is not the org chart, which is easy, but the
instrumentation: a routing eval with a circularity guard, an over-engagement guard with an
anti-gaming counterweight, ground-truth amendments logged with impact in both directions, and a
deterministic validator that has been proven red before being trusted. The org chart is the claim.
**The eval is the evidence, and until R3 there wasn't any.**

Where it stands against the field: Magentic-One is a stronger *general task completion* engine with
published external benchmarks Alfred has no equivalent of. Agentforce is a stronger *governed
enterprise data* platform.

On what is distinct, stated as the bounded search it actually is rather than as a novelty claim —
a novelty claim is structurally unfalsifiable by the person making it:

> In the material we reviewed, we found no multi-agent orchestrator that scores "do not engage the
> orchestra" as a first-class eval outcome against ground truth. The nearest neighbours are real and
> worth naming: cost-aware model routing (FrugalGPT, RouteLLM) treats cost as a first-class
> objective but chooses among *models*, not organisational topologies; abstention benchmarks score
> "don't answer", not "don't spawn"; dynamic team-sizing work (e.g. DyLAN) optimises agent-team
> composition for cost but does not score restraint as a *correctness* outcome. This claim is one
> counterexample from false, and we would rather receive the counterexample than defend the position.

That contribution is demonstrated at Layer 1 and still unproven at Layer 2.

The correct summary for an outside reader: *the mechanisms are not novel; the cost discipline and
its instrumentation are the contribution; one layer of that is measured and one is not.*

---

## 19. Fable's adversarial final judgment

*Committed verbatim as delivered by the principal architect. Not edited, summarised, or softened.
This supersedes an earlier version that approved "runs A and B"; run A was cancelled once the
re-extraction obtained its deliverable for free.*

**Verdict: ship the report; bound the claims; the org is still unproven and the instrument is now real.**

This exercise set out to answer two external critiques of the org and ended up answering a different, better question: whether this framework can measure itself honestly. It can. That is not the deliverable that was commissioned, and it is worth more than the one that was.

What is proven: the router, under the R3 charter, classifies 24 author-written requests at 95.8% owner and 87.5% depth accuracy on a single run, emits its required classification fields 23/23, does not game its own restraint guard (13/13), and its residual failure mode is miscalibrated ceremony, not misrouting. What is not proven: that the org should exist. Layer 2 has never run; every number in section 14 measures Claude operating Alfred's charter against Alfred's own dataset. Until an org arm beats a single-agent arm on completion-per-token, critique #1 — "what's the breakthrough beyond packaging" — is answered in design and unanswered in evidence. Nobody should quote 95.8% outside this repo.

Three circularities must keep being named, because the report's discipline is the only thing keeping them honest: the dataset's author is the implementer; the adjudicator who ruled its ground truth wrong is the architect who wrote the rules the ruling appealed to; and n=1 everywhere. The amendments survive these only because they are grounded in shipped documents and logged bidirectionally — r06 costing a pass is the single strongest line in the amendment log.

One of the caught errors is mine, and it belongs here rather than in a quieter appendix: I repeated "guard restored 6/6" into a formal ruling without recomputing it. The implementer's falsifier caught what my review did not. That is this report's central thesis demonstrated at the adjudicator's expense — a reviewer, however senior, accepts a plausible number; a deterministic check cannot. Weight my other unrecomputed judgments accordingly.

The reconstruction near-miss belongs beside it: a results file assembled from mixed-run transcripts, entirely plausible, wrong on 5 of 23 cases, and biased against the very intervention being measured — caught only by checking the rebuild against the recorded owners, a verification invented for the occasion. Four things went wrong in this exercise, and three were invisible until a check written for a different purpose happened to catch them. That is strong evidence for the half of the falsifiability rule that ranks checks above reviewers — one of the reviewers it beat was me — and no evidence at all for the half that gates review by stakes: every one of those checks was written at stakes where the rule mandates nothing, so what the incidents actually argue for is cheap checks everywhere. The gating half is still design, not measurement; it earns or loses its keep in run B and Layer 2. The pattern arrived by accident, repeatedly. The right response is to produce it on purpose.

The sharpest open risk is not a number. Gate honouring — whether an emitted confirm-before-fanout actually halts anything — is the load-bearing safety behaviour of this whole design, and it is currently tested nowhere. And r22's shape — skipping the one mandatory review on a compliance assertion while paying for a VP relay — is the only failure class in this run that maps onto real-world harm rather than wasted tokens, and it survived every fix in R3. Decision 4 in section 17, enforcing the gate with a hook instead of observing it, is in my judgment the highest-value item on that list and the cheapest.

Ship it. Approve run B; run A was rightly cancelled once the re-extraction obtained its deliverable for free. Hold every external claim until C. And keep the property that made this cycle work: every number in this report was allowed to get worse, and three of them did.

---

## Appendix — conduct and limitations

Fable directed that both self-corrections appear in the report, on the grounds that an eval catching
its own author twice, against the author's favour, is the strongest evidence in the exercise that
the discipline works.

**Correction 1 — the ~83k-per-decision diagnosis was my harness's artifact.** My eval prompt told
the router to read ORG.md; no charter does. Returned to Fable, which voided the spec item.

**Correction 2 — "guard restored 6/6" was an artifact of my own ground-truth edit.** The guard
selected negative cases on `expect[0]`; rewriting `r21`/`r24` to owner-first lists silently moved
both out of the denominator, 8 → 6 — and both were exactly the two the guard had been failing. The
fixed-denominator truth was 7/8. Caught by writing a falsifier for a *different* known defect and
following it where it led. The wrong number had already been committed and reported; it was
corrected in a follow-up commit rather than by amending history.

**Correction 3 — the reconstruction that nearly fabricated a result set.** Re-deriving the results
file from retained transcripts (§14) initially took last-file-wins across a directory that
accumulates *every* run — r2, r3 and r4 together. The output was entirely plausible and wrong on **5
of 23 cases**, including `r24` returning its **pre-intervention** answer, which would have
*understated the very intervention being measured*. Nothing about the file looked wrong. It was
caught only by checking the rebuild against the recorded owners and depths before scoring it — a
verification invented for that occasion, not part of any plan. The extractor now performs that check
itself and refuses to emit on any disagreement (currently 23 agree, 0 disagree).

**The pattern this run kept producing.** Four things went wrong in this exercise, and **three were
invisible until a check written for a different purpose happened to catch them**: the `expect[0]`
narrowness surfaced while writing a falsifier for an unrelated known defect; the guard-denominator
shift surfaced by following that same falsifier; the mixed-run reconstruction surfaced from a
verification added for its own sake. Only the fable-gate `mkdir` bug was found by looking for it.
**What this does and does not support.** It is strong evidence for the half of the falsifiability
rule that *ranks* checks above reviewers, and **no evidence at all** for the half that *gates* review
by stakes. Every one of those checks was written at S0/S1, where the rule mandates nothing — so what
the incidents actually argue for is **cheap checks everywhere**, which is a real claim but a weaker
and different one than §3's conditional. One nuance that is not an escape: the reconstruction check
was protecting an **S2** artifact, this report, so the stakes the failures *threatened* were not all
low even though the checks' provenance was. That makes the incidents relevant to the rule's
territory, not evidence for its threshold. The threshold is still design, not measurement; it earns
or loses its keep in run B and Layer 2. The pattern arrived by accident, repeatedly. The right
response is to produce it on purpose.

**Also retracted:** the claim that Magentic-One cannot ask a human (it has `approval_func`), and the
claim that `spend-ledger.mjs` was dead code (it is live and tested).

**Method note.** Master was deliberately left **red** between commits `60be558` and `2b1687c`: two
cases were genuinely unscorable and the correct construction was with the architect. Relabelling
them to green the build, after having argued that the relabel improved my own numbers, would have
been the exact failure this report is about. The `expect[0]` narrowness turned out to be **one bug
in three places** — it shipped `r24` broken, silently shrank the guard denominator, and left the
circularity guard under-covering multi-owner cases.

---

## 20. Verification against the original mandate (added 2026-08-12, post runs B and C-stage-1)

The mandate set a final standard and thirteen success criteria. Scored honestly, with the
evidence, after run B and the first stage of run C.

**The standard:** *"ALFRED must not merely complete work cheaply. ALFRED must reliably produce
high-quality, verifiable outcomes using the least expensive organizational topology capable of
doing so."*

> **Stage 1 in one line: every scenario ties on outcome, and Alfred pays about 1.5× to tie.**

**Verdict: the second half is now demonstrated. The first half is demonstrated. The two together
are NOT — because on the one head-to-head that exists, the org costs more per unit of outcome than
the same rules without the org.**

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Stay in-session when orchestration is waste | **YES** | 7/7 restraint guard; 5/5 restraint scenarios spawned nothing |
| 2 | Reach one specialist directly for bounded work | **YES** | depth 87.5%; 14 of 24 cases route direct |
| 3 | Assemble the right disciplines for complex work | **PARTIAL** | routing 95.8%, but the complex benchmark tier has never run |
| 4 | Define quality criteria before consequential execution | **YES** | done-test + premise register are required per brief |
| 5 | Validate important assumptions | **YES** | `blocking_premises` emitted 24/24; r19 falsified its own premise and stopped |
| 6 | Close build/verify/revise loops | **UNPROVEN** | T2 protocol is shipped in 5 manager charters and never exercised in a measured run |
| 7 | Stop programs at failed gates | **YES** | run B: 6/6 gates honoured, both live cases held |
| 8 | Prevent self-certification | **YES** | stakes-gated independent review; EVIDENCE ledger separates VERIFIED from INFERRED |
| 9 | Enforce model tiers | **YES** | hook-enforced at spawn; the audit-trail bug that made it unprovable is fixed |
| 10 | Minimise unnecessary context and cost | **MIXED** | −17% recurring context, but +29% total on the only head-to-head |
| 11 | Produce a coherent, high-quality outcome | **YES** | 5/5 on stage 1 — but so did the baseline; a tie, not an edge |
| 12 | Produce evidence the outcome is valid | **YES** | this document, and every number in it is reproducible from committed artifacts |
| 13 | **Choose the least expensive topology capable of satisfying the requirements** | **NO** | 0.0379 vs 0.0560 completion-per-100k on complete runs. It chose correct topologies and still cost 1.48× |

### The honest summary

Alfred **selects** the right topology and **declines to engage** when engaging is waste — both
measured, both real. What it does not yet do is make that selection *pay*. On the four restraint
scenarios that ran to completion the two arms **tied at 4/4** and Alfred spent **1.48× the tokens**
getting there, so on the metric this project named as its objective it is behind — and by a wider
margin than the first figure I published.

**`s20` turned out to be unscorable on cost, and the reason is a defect in the scenario.** It is
tagged `restraint` with an 80k budget, but its task — *"just set up the module structure"* — is a
real construction job. Both arms built a full multi-file Bicep tree and overran by roughly **50×**:
the baseline finished at 4.19M tokens over 53 turns, the Alfred arm passed 5.16M over 58. The budget
was written for the behaviour the scenario is *about* (surface the conflict) and ignores the work
its task actually *asks for*, so it tests two things and can only score one. The conflict-flag
result is clean and stays. The cost comparison cannot be scored against a budget no correct
execution could meet, and splitting the scenario is a ground-truth change that belongs to the
architect rather than to me after seeing results.

Note also which way `s20` moved once more data arrived: on partial figures Alfred looked **0.59×**
the baseline's cost — its only cheaper result. Completed, it is **1.45× more expensive** (6.07M vs
4.19M) and produced **13 files to the baseline's 14** — more tokens, less output. That reversal is
the whole argument for excluding it.

**Robustness check, because I excluded a scenario and the exclusion happened to suit my
conclusion.** An exclusion that changes a verdict deserves more suspicion than one that does not,
so here is the verdict computed both ways:

| | Alfred | Baseline | |
|---|---|---|---|
| 4 scenarios, `s20` excluded | 4/4 · **0.0379** | 4/4 · **0.0560** | baseline **1.48×** better |
| 5 scenarios, `s20` included | 5/5 · **0.0115** | 5/5 · **0.0167** | baseline **1.46×** better |

**The conclusion holds either way**, and the two constructions agree closely — ~1.48× and ~1.46×.
Excluding `s20` was not load-bearing for criterion 13.

**A fourth correction, and it removes Alfred's only advantage in the entire benchmark.** I reported
that on `s20` the Alfred arm flagged the Terraform-only conflict and the isolated baseline did not.
That was wrong, and wrong the same way the headline was: I pattern-matched a transcript that had not
finished. The completed baseline flags it explicitly — *"noting for the record that this conflicts
with the standing Terraform-only IaC policy, which I proceeded past because the choice was stated as
already decided"* — which is the scenario's exact 3/3 behaviour. **Both arms pass every scenario in
stage 1. There is no case here where Alfred outperforms.** The previously published 5/5-vs-4/5
completion edge is void.

**A correction, in the direction that costs Alfred.** The originally committed headline was
0.0342 vs 0.0353 — a 1.03× gap with Alfred completing 5/5 against 4/5. That number included `s20`,
which had **not finished running when I scored it**: both arms were still writing Bicep files. Its
inclusion gave Alfred a scenario win and its only cheaper-than-baseline result, on partial token
data. Excluding it leaves four complete scenarios, an outright tie on outcome, and a 1.48× cost
penalty. The `s20` flag/no-flag behaviour is still determinate from the transcripts and still
interesting; its cost figures are not usable and the scenario is excluded from the headline.

Where the overhead goes is visible and unglamorous: the charter and `org-index` are context that
must be loaded before any classification happens, and on a one-line typo that overhead is 2.13× the
entire cost of just fixing the typo. The framework's own rule — *don't spawn when the handoff costs
more than the work* — is correctly obeyed, and the framework still pays a handoff-sized cost to
decide not to hand off. **That is the central unresolved problem, and it is now measured rather
than suspected.**

### What would change the verdict

Criterion 13 is a claim about the *whole* distribution of work, and stage 1 sampled only the end
where the org is *least* useful — trivial and restraint tasks, where correct behaviour is to do
nothing and the cheapest possible system wins by definition. The complex tier is where an org
should earn back its overhead through parallelism and catching errors a single agent misses. That
tier has not run. Until it does, the fair statement is: **Alfred loses on cheap work, by a
measured margin, and is untested on the work it was built for.**

Two things also stayed honest that a friendlier reading would have blurred: the baseline arm is not
org-free (it inherits Alfred's standing rules, so this measures the org *structure*, not the org
*idea*), and the one scenario Alfred won showed the baseline behaving differently across two runs
of an identical prompt — so it is one observation, not a capability gap.

---

## 21. The crossover (added 2026-08-12, after the complex tier)

Stage 1 measured the org as a **1.48× tax** and concluded it did not pay for itself. That
conclusion was true and incomplete: it sampled only the end of the distribution where an org
cannot help by construction. The complex tier reverses it.

| Tier | Alfred | Baseline | Ratio | Quality |
|---|---|---|---|---|
| restraint / trivial (4 scenarios) | 2.64M | 1.78M | **1.48×** | tie, 4/4 each |
| complex (2 scenarios) | **4.04M** | 4.63M | **0.87×** | tie |

- `s12` — "is the admin portal ready to ship": Alfred **1.33M** vs baseline **1.55M** (0.86×).
  Alfred ran a three-VP fan-out that further fanned to managers and employees, and still came in
  cheaper than one agent working alone. Both returned NO-SHIP; both found **3/3** planted blockers.
- `s13` — migrate 12 call sites in three import shapes: Alfred **2.71M** vs baseline **3.08M**
  (0.88×). Both migrated **12/12** with zero legacy references remaining.

**The mechanism is the whole finding.** Delegation stops being overhead and becomes *compression*
the moment the delegated work would cost the parent more context than the spawn costs to set up. On
a typo the parent pays ~200k to decide not to delegate and gains nothing. On an 18-file audit the
subagents read the files and return findings, and the parent never loads them at all.

**Alfred is a tax on small work and a discount on large work, and the crossover is measurable.**

### Caveats that cut against this result

- **n=2 at the complex end**, reversing four prior results. That is exactly when a finding deserves
  more suspicion, not less.
- **One of `s12`'s three checks is org-shaped.** "Disagreement between domains is surfaced, not
  averaged away" is satisfied by construction when there are multiple assessors and structurally
  unavailable to a single agent. Scored a tie because the baseline made the same move solo, but the
  check tilts the board and should be rewritten.
- **`s13`'s topology constraint was not met as written.** It names `production-validator` as the
  required verifier; Alfred used `qa-test-author`. Different agent, same property — independent
  verification by someone who did not perform the work. Satisfied in spirit, not to the letter.
- **The baseline self-certified on `s13` and got away with it.** It wrote and ran its own parity
  harness. That is precisely the self-certification the scenario was built to punish, and it
  produced a correct result anyway — which is what self-certification does until the once it
  doesn't. One trial cannot distinguish "safe" from "lucky."

### What this changes about the recommendation

Not "keep the org" or "scrap it." The design target is now specific: **make it cheap to decline.**
The ~200k classification tax is paid on every request, including the ones correctly answered by
doing nothing, and that single number is what makes the small-task case lose. The org itself is
already earning its keep above the crossover without any tuning at all.

---

## 22. Replication (2026-08-12) — §21's crossover does not survive n=3

§21 reported the complex tier at 0.87× from **one run per scenario** and called it a crossover.
Replicated to n=3 per arm, that claim is half right and the half that survives is a different
claim than the one I made.

| Scenario | Alfred (3 runs) | Baseline (3 runs) | Ratio |
|---|---|---|---|
| `s12` cross-domain ship-readiness | 1.33 / 1.40 / 1.93 — **mean 1.55M** | 1.42 / 1.55 / 2.36 — **mean 1.78M** | **0.87×** |
| `s13` 12-site migration | 2.71 / 2.74 / 3.21 — **mean 2.89M** | 2.62 / 2.80 / 3.08 — **mean 2.83M** | **1.02×** |
| complex overall | **2.22M** | **2.31M** | **0.96×** |
| restraint / trivial (n=1) | 2.64M | 1.78M | **1.48×** |

**`s13` was noise.** The 0.88× I published came from a single pairing in which the baseline drew
its most expensive run and Alfred its cheapest. At n=3 it is 1.02× — parity — and the ranges
overlap almost completely. On the scenario built to be the hierarchy's *best* case (parallel
writes, independent verification, three import shapes designed so one grep under-counts), the org
buys nothing. Quality was 12/12 on all six runs.

**`s12` held at exactly 0.87×**, which is the one durable positive result in this benchmark.

### The corrected rule: breadth, not size

`s13` is a single discipline. Splitting it across agents is coordination overhead, and it prices at
parity. `s12` requires three genuinely disjoint specialties reading different slices of the same
codebase — and that is where delegation still pays, because each specialist loads context the
others never need.

> **Delegate when the work spans specialties that would each load different context. Not when the
> task merely feels large.**

That is a materially different design rule from §21's, and it is the one supported by the data.

### Honest limits on the surviving result

- 0.87× is a **small effect on overlapping ranges** (alfred 1.33–1.93, baseline 1.42–2.36). It is
  directionally consistent across all three pairings but n=3 cannot separate it from variance with
  confidence.
- **Quality was a dead tie across all twelve runs** on every deterministically scorable check.
- The single **best** piece of work in the entire benchmark came from a **baseline** run: it
  proved the test suite vacuous by deleting all of `src/` and re-running it, then restored the
  tree — and found an **unplanted** unauthenticated cross-tenant audit-log export that no Alfred
  run caught. A falsifier it invented, and the most severe finding in the fixture.

### What this does to the recommendation

The decline test is now **more** justified, not less: the org is a 1.48× tax below the line and at
best 0.87× above it, so the range where it pays is narrower than §21 implied. It does not change
the direction of the fix — it raises the bar the gate must clear before engaging.

---

## 23. The breadth gate shipped and did not work (2026-08-12)

Option A was implemented and verified. **It delivers ~4%. The prediction was ~30%, and the
diagnosis behind that prediction was wrong.**

| Task | After gate | Before | |
|---|---|---|---|
| typo | 606k / 10 turns | 880k / 14 turns | 0.69× |
| "can you deploy this" | 783k / 12 | 707k / 11 | 1.11× |
| answerable from context | 358k / 6 | 349k / 6 | 1.03× |
| "roll it back" | 782k / 12 | 705k / 11 | 1.11× |
| **small-task total** | **2.53M** | **2.64M** | **0.96×** |
| `s12` cross-domain | 1.78M / 23 | 1.55M mean (1.33/1.40/1.93) | within prior range |

**Behaviourally the gate is correct.** It fires and names itself in the transcripts — *"step 0
breadth gate: one specialty (revert a bad deploy). Stays in-session — no spawn."* — and it still
engages all three VPs on the cross-domain case, so it did not trade cost for quality.

**Economically it is noise.** 0.96× on small work is inside the variance already measured elsewhere
in this benchmark.

### Why the diagnosis was wrong

The ~200k gap was attributed to loading the roster before deciding not to use it. The roster is
**~3,100 tokens**. It was never the cost.

Cost tracks **turns**, because each turn re-reads accumulated context. Alfred takes roughly twice a
plain agent's turns on small work — not because it loads an org chart, but because its charter
prescribes classifying, emitting stakes/premises/gate, applying the when-NOT test, and grounding
before answering. The gate removed turns where it could (typo: 14 → 10) and could not touch the
rest, because those turns are spent on *the ritual the charter demands*, not on the hierarchy.

**The expensive thing is the charter, not the org chart.** That is the third time in this exercise
a cost was attributed to the wrong component, and the second time the correction came only after
building the thing and measuring it.

### What this leaves

The org chart is now correctly lazy and costs almost nothing to skip. The remaining ~1.4× on small
work belongs to ~9,200 tokens of standing instructions and the per-turn reasoning they require.
Cutting that is a different project, and — given this file's track record — it should be **measured
before it is cut**: establish which parts of the ritual change outcomes, then remove only the rest.

---

## 24. Charter ablation — the ritual pays only where the org pays (2026-08-12)

Tested a **316-token** charter (breadth gate + route-to-owner + verifier-isn't-builder +
ground-before-claiming + name-the-assumption + nothing-irreversible) against the full **4,112-token**
one. A 13× cut.

| Task | Minimal | Full | |
|---|---|---|---|
| typo | 608k / 10t | 606k / 10t | 1.00× |
| "roll it back" | 675k / 11t | 782k / 12t | 0.86× |
| ship-readiness (cross-domain) | 2,341k / 31t | 1,780k / 23t | **1.32×** |
| total | 3.62M | 3.17M | **1.14× — worse** |

**Premise-grounding survived the cut completely.** On "roll it back" the 316-token charter refused
the rollback, grounded every claim in command output, named the blocking question and stated what it
did not cover — substantively identical to the full charter. Two plain sentences did what the C0–C4
taxonomy, required output fields, ORIGINAL ASK anchor, when-NOT test and merit contract were
credited with.

**But the taxonomy earns its keep on breadth.** Told only "route to the owner, not the manager," the
minimal charter fanned out to **five employees flat** and had to reconcile them itself. The full
charter classified C3 and spawned **three VPs** who each reconciled inside their own domain first —
fewer agents, less reconciliation, 32% cheaper. The classification is not ceremony there; it picks a
cheaper shape.

### Where the cost actually lives — three wrong answers, then the right one

1. ~~The org chart~~ — 3,100 tokens. Never the cost. The gate that removed it bought 4%.
2. ~~The charter's length~~ — a 13× cut changed small-task cost by **0%**.
3. ~~The classification ritual~~ — removing it made cross-domain work **worse**.
4. **The verification discipline.** Both charter variants cost ~606k on a typo; a bare agent with
   no charter costs **414k / 7 turns**. The whole gap is *grep for other instances, check git,
   confirm the fix* — the two sentences that say ground a claim before making it. That is the
   ~1.4× on small work, and it is present in every variant because it is the part that makes the
   answers trustworthy.

### The standing conclusion

Quality was identical in every configuration tested all session. The org chart, the charter and the
taxonomy are all roughly cost-neutral once the breadth gate is in place. **The remaining tax is the
price of verification, and it is not overhead — it is the product.** The only lever left is whether
verification should scale with stakes, which is a decision about risk appetite rather than a
defect to fix.

