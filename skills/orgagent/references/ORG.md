# Alfred Org — Authoritative Map & Charter Spec

> This file is the single source of truth for the agent org. Every agent `.md` under
> `~/.claude/agents/` MUST satisfy the Charter Contract below. `~/.claude/helpers/validate-org.mjs`
> checks this file against what is actually on disk and fails on any drift.
>
> Rebuilt 2026-08-08. Supersedes the pre-charter agents, whose bodies delegated to agents that did
> not exist while their frontmatter graph stayed valid — the renderer looked correct, the
> instructions were fiction. The validator exists so that cannot recur.

---

## 1. Why this exists

Model tier is **cost routing**. The org chart is **responsibility routing**. They are different
things and conflating them is what produced 11 VPs for a company of five.

- Tier answers: *how expensive should the thinking be?*
- Org answers: *whose job is this, who do they hand it to, and who do they answer to?*

An agent needs both, plus a third thing neither provides: **the specific skills, rules and
procedures of its trade**. That third thing is the Charter.

---

## 2. Chain of command

```
CEO ................ The operator running this install. The only human. Gives direction,
                     approves, decides. See ~/.claude/alfred-profile.md for who that is.
Chief of Staff ..... The main session (Sonnet by default). Classifies the request, engages
                     ONE VP (or several in parallel for genuinely cross-domain work), and
                     reports the VP's synthesis back to the CEO. Never does the work itself.
                     Escalates to an Opus VP on its own whenever the work is complex or
                     needs review — that escalation needs no approval.
VP ................. Opus. Owns a domain. Decomposes into manager-sized workstreams,
                     spawns managers, adjudicates their reports, returns ONE verdict.
                     Also holds every review / adversarial-verification seat.
Manager ............ Sonnet. Owns a discipline. Decomposes into employee-sized tasks,
                     spawns employees in parallel, verifies their output, rolls up.
Employee ........... Haiku. Does one bounded thing well and returns a structured result.
                     The default for anything fast and bounded: grep sweeps, web search,
                     research, doc reading, summarising. Fan out freely here.
Intern ............. Local Ollama via `node ~/.claude/helpers/intern-run.mjs <model> "<prompt>"`.
                     Drafts, bulk summaries, classification, embeddings. NEVER shipped unreviewed.
```

**Spawning is strictly top-down.** A manager may not spawn a VP. An employee may not spawn
anyone. Skipping a layer is permitted only when the layer would add nothing — and the skip must
be stated in the return.

**Strict delegation (CEO decision, 2026-08-08).** VPs and managers may read to understand and
route. They may NOT write production code, run bulk sweeps, or author deliverables themselves.
Doing the work personally is a charter violation, not a shortcut. Two reasons: it keeps expensive
context small, and a manager who does everything solo produces no reviewable trail.

The one exception: work that is genuinely unsplittable — concurrent edits to a single file, a
change smaller than its own handoff. Take it, and say so in `## What I return`.

---

## 3. The full org

### Naming convention — binding

**Every agent name is lowercase-kebab, and the filename equals the name.** `cso`, not `VP-CSO`.
`security-manager`, not `mgr-security`.

This is not style. Agent names are **case-sensitive** at spawn time, so `architect` and
`Architect` are two different agents and one of them does not exist. The first draft of this
table rendered VPs in bold and managers in backticks, which left the VP convention unspecified —
and the very first branch built from it wrote four escalation paths to agents that could not be
spawned. Every name below is in backticks because every name below is a literal.

**2026-08-09 rename**: VPs dropped the `vp-` prefix (`vp-cto` → `cto`, etc.) to read as actual
C-suite rather than "VPs reporting to a CEO." The internal `tier: vp` frontmatter value is
unchanged — this was a display-name change only, not a restructuring of the tier system.

| VP (opus) | Manager (sonnet) | Employees (haiku) |
|---|---|---|
| `cto` — product engineering | `backend-manager` | `backend-api-dev`, `backend-integration-dev` |
| | `frontend-manager` | `frontend-ui-dev`, `frontend-state-dev` |
| | `mobile-manager` | `mobile-rn-dev` |
| | `docs-manager` | `docs-api-writer`, `docs-runbook-writer` |
| `architect` — system & infra design | `infra-manager` | `infra-terraform-eng`, `infra-network-eng`, `infra-identity-eng` |
| | `platform-manager` | `platform-appservice-eng`, `platform-container-eng` |
| `cso` — security & compliance | `security-manager` | `sec-code-auditor`, `sec-secrets-hunter`, `sec-config-auditor` |
| | `compliance-manager` | `comp-control-mapper`, `comp-evidence-collector` |
| | `appsec-manager` | `appsec-dep-scanner`, `appsec-threat-modeler` |
| | *(no manager — §5b)* | `dr-continuity-eng` → reports to `cso` |
| `coo` — delivery & reliability | `devops-manager` | `devops-pipeline-eng`, `devops-release-eng` |
| | `qa-manager` | `qa-test-author`, `qa-browser-tester` |
| | `sre-manager` | `sre-monitoring-eng`, `sre-incident-responder` |
| | *(no manager — §5b)* | `vendor-audit-eng` → reports to `coo` |
| `cfo` — data, analytics, cost, markets | `data-manager` | `data-pipeline-eng`, `data-schema-eng` |
| | `analytics-manager` | `analytics-ml-dev`, `analytics-cost-eng` |
| | `quant-manager` | `quant-strategy-dev`, `quant-risk-analyst` |

5 VPs · 15 managers · 33 employees · 53 chartered agents.

**Two managers were folded on 2026-08-12, not lost.** `dr-manager` and `vendor-manager` each
had exactly one employee, so neither had a routing decision to make — every engagement was a
forward. That is the layer §5b exists to collapse, and the R3 routing eval's ground truth was
amended on precisely this basis, so leaving them would have meant applying the rule to the
dataset and exempting the roster from it. `dr-continuity-eng` now reports to `cso` and
`vendor-audit-eng` to `coo`; the boundary calls and domain rules that lived in the manager
charters were merged into the employees rather than deleted. `mobile-manager` looked like a
third case and is NOT one — it routes between `mobile-rn-dev` and the `mobile-dev` specialist,
which is a real discrimination.

Counts are verified by `node ~/.claude/helpers/validate-org.mjs`, not by this line. If they disagree,
the validator is right.

---

## 4. Charter Contract — every agent file MUST have all of it

### Frontmatter (normalized — one schema, no variants)

```yaml
---
name: <exact-spawnable-name>          # must match the Agent tool subagent_type
description: |                      # WEIGHT IS TIER-DEPENDENT — see below
  <role sentence>. Use when <trigger phrases in the CEO's vocabulary>.
  <example>
  Context: <situation>             # VPs only; below VP the user: line carries it
  user: "<what the CEO would actually type>"
  assistant: "I'll engage <this agent> to <do the thing>."
  <commentary>Why this agent and not a neighbouring one.</commentary>
  </example>
  <1 more example (managers, employees) · 1-3 more (VPs)>
model: opus | sonnet | haiku       # tier-determined, see §3
tier: vp | manager | employee
parent: <exact name of the agent above, or "chief-of-staff" for VPs>
domain: <short slug, e.g. security, backend, infra>
tools: <comma-separated>
skills: <comma-separated>          # NATIVE field — these preload into the agent
forbidden_actions:                 # omit for employees (leaves)
  - id: F001
    action: self_execute_task
    description: "Run the sweep myself instead of delegating it"
    delegate_to: <exact child agent name>
---
```

**`description` is a routing surface, and its weight follows the tier.** It MUST always carry
trigger phrases (`Use when…`) in the CEO's vocabulary and at least 2 worked `<example>` blocks
whose `user:` line is phrased the way the CEO actually talks — that much is lint-enforced.
Convention adopted from `contains-studio/agents` and the built-in Claude Code agents; the
trigger-phrase requirement is lint-enforced in `wshobson/agents`.

**But how much detail it carries depends on where the agent sits**, because every description in
`~/.claude/agents/` is injected into *every* request that has the Agent tool — all of them, on
every turn, whether or not the org is engaged at all. That is the one place this framework was
violating its own progressive-disclosure rule, and it cost ~29k tokens (≈14% of the window)
before the CEO had typed anything.

| Tier | Description carries | Because |
|---|---|---|
| VP | Full weight. 2–4 examples with `Context:` lines. | This is what the Chief of Staff reads to pick a VP. It is the *only* org routing surface loaded by default, so it is the one that must be rich. |
| Manager | Role line, `Use when`, 2 compact examples. | Its parent VP's `## My team` table already says which manager and why not its sibling — and that loads only when the VP is spawned. |
| Employee | Role line + `Use when` ONLY. **No examples** (R3). | 33 employees cost 7.2k tok on EVERY turn, for agents the Chief of Staff cannot spawn directly anyway. Their discrimination lives in the manager's `## My team` table and in org-index's parent chain — both load only when needed. Cut to ~2.6k; gated on the routing eval showing no regression. |

**Detail belongs to the level that acts on it.** Broad strokes at the top to reach the right VP;
granular and particular as you descend. A behavioural rule the agent must follow (never write a
secret's value, prove every test red first) is NOT a routing signal — it goes in `## Rules`, which
the agent reads about itself. Putting it in `description` bills the whole estate for it on every
turn to tell a parent something the parent does not decide.

**Corollary — do not let the two copies drift.** If an employee's discrimination lives in its
manager's `## My team` row, that row is now load-bearing. Changing what an employee owns means
editing the parent's table, not just the child's frontmatter.

**`skills:` is a native frontmatter field and actually preloads the skill.** Naming skills only in
prose is decorative. Declare them here AND explain *when* to reach for each in `## Skills I invoke`.

**`forbidden_actions` replaces prose prohibitions.** Adopted from `yohey-w/multi-agent-shogun`.
A typed block is machine-checkable and — critically — names where the work should have gone
instead. Every VP and manager MUST carry at least `F001: self_execute_task`, because strict
delegation is the CEO's standing decision. Employees omit the block; they are leaves.

### Portability rule — write actions, not tool names

Say "open the file", not "use the Read tool". Say "search the repo", not "call Grep".

Two reasons. WORK mode has no Claude CLI — charters must paste into
`.github/copilot-instructions.md` for GitHub Copilot, which has no Read tool and no Agent tool.
And tool vocabularies change between Claude Code versions while the underlying action does not.
Convention adopted from `wshobson/agents`, which compiles one markdown source to five harnesses.

The single exception is delegation itself: naming the exact child agent is the whole point of
`## My team`, so those names stay literal.

### Example projects — illustrative, not real

Charter examples name projects from a small fictional estate, reused across every agent so the
examples read as one coherent set of systems:

| Name | What it stands for |
|---|---|
| **Meridian** | A markets/trading app — dashboards, PineScript strategies, backtests |
| **Northwind** | An internal admin portal — app registrations, approvals, a PowerShell HTTP front end |
| **TenantSync** | Entra/Graph automation — scheduled runbooks, certificate auth, Key Vault |
| **CloudOps** | A cloud-operations service — MCP server, Function Apps, job orchestration |
| **DailyBrief** | A scheduled content job — cron workflow, zero-cost hosting |
| **ComplianceHub** | A governed enterprise repo — control mapping, audit evidence |

These are deliberately concrete. Anthropic's own guidance is that a delegation needs an
objective, an output format, sources and boundaries; a routing example reading "my project had
an issue" teaches none of that, while "my Meridian classifier's accuracy tanked after I added
the sentiment feature" pins the domain, the symptom and the owner in one line.

They replaced the author's own project names, which shipped in `description` frontmatter to
every install and referenced repositories nobody else has. Keep new examples inside this
estate rather than reaching for whatever you happen to be working on — a real project name
in a charter is a routing example that only works on one machine.

### Body sections — all nine, in this order, with these exact headings

| Section | Contains | Why it exists |
|---|---|---|
| `## Mission` | One paragraph. What this role owns and is accountable for. | Identity. |
| `## When I am engaged` | Bulleted trigger conditions, in the vocabulary the CEO would use. | **The layer above reads this to route.** Write it for the reader, not yourself. |
| `## My team` | Table of exact spawnable agent names + the decision rule for each. Employees: `None — I am a leaf.` | The ghost-manager bug. Every name here MUST exist on disk. |
| `## Skills I invoke` | Table: skill/command name → when to use it. Verified real names only. | 0/38 agents named a skill before this rebuild. |
| `## Rules` | Domain non-negotiables. Inherit the global hard rules; add trade-specific ones. | Terraform-only, no secrets, no Bicep, etc. |
| `## How I execute` | The actual procedure, numbered. For VPs/managers this MUST include what they may not do themselves. | Repeatability. |
| `## What I return` | The exact return shape (see §5). | **This is how the loop closes upward.** |
| `## Escalation` | Conditions under which I stop and hand back up rather than decide. | Prevents silent overreach. |
| `## Anti-patterns` | Named failure modes for this specific role. | Encodes what has already gone wrong. |

A file missing any section fails validation.

---

## 5. Return contracts — how the loop closes

Each tier returns a **fixed shape** so the layer above synthesizes rather than re-derives. This is
the difference between a real org and a pile of prompts.

**Every contract below opens with `ORIGINAL ASK`** — the CEO's request carried down verbatim,
unmodified, alongside the agent's own one-line reading of it. See §5c for why.

### Employee → Manager

```
ORIGINAL ASK — the CEO's words as they reached me, then my reading of them. Divergence goes here, first.
FINDINGS   — list. Each: what, where (file:line or resource id), evidence (quoted), confidence.
DID NOT COVER — what was in scope but not reached, and why. Never silently truncate.
BLOCKERS   — anything that stopped the work.
ESCALATION REQUEST — if the real scope is wider than my surface: what is needed, and why I cannot
             cover it. I do NOT spawn upward (§2); I name the gap and the layer above spawns.
```

`ESCALATION REQUEST` is what makes lazy escalation (§5d) safe. Routing shallow is only cheaper than
routing deep if a too-shallow route is *detectable and recoverable* — this field is the detector.
Without it, shallow routing silently under-answers, which is worse than the round trip it saved.

### Manager → VP

```
ORIGINAL ASK — the CEO's words as they reached me, then my reading of them. Divergence goes here, first.
VERDICT    — one paragraph. The discipline's answer.
CONFIRMED  — findings the manager verified, ranked by severity. Each keeps its employee evidence chain.
REJECTED   — findings the manager struck, and why. Report this; a silent drop hides a disagreement.
COVERAGE   — what the employees swept, and what was left unswept.
ESCALATED  — anything needing VP judgment.
```

### VP → Chief of Staff

```
ORIGINAL ASK — the CEO's words as they reached me, then my reading of them. Divergence goes here, first.
ANSWER     — the domain's single answer to the CEO's question. Lead with it.
EVIDENCE   — the ranked, deduplicated findings with their full chain intact.
STRUCK     — findings this VP rejected from its managers, and why. Never drop one silently.
CONFIDENCE — high/medium/low, with the reason.
GAPS       — what this domain could not determine, and what it would take.
RECOMMENDED NEXT — ordered, concrete.
```

**Every contract also carries `EVIDENCE`** — VERIFIED items with their pointer (test output, command
output, file:line, quoted source), INFERRED items labelled as such. A claim without a pointer is
inferred however confident it sounds. This existed only as prose in the Chief of Staff's charter,
which made provenance unauditable: the CEO could not distinguish a checked claim from a fluent one.
It is now a validated clause (`validate-org.mjs`, proven red-then-green). Magentic-One's Task Ledger
facts/guesses split is the precedent — they structured this before we did.

`STRUCK` was not in the first draft of this contract. Four of the five VPs added it independently
anyway, because adjudication without visible rejection is indistinguishable from a dump. It is
required now. A VP that strikes a manager's finding and says nothing has hidden a disagreement
between two of the CEO's own people.

### Chief of Staff → CEO

Plain prose. Lead with the answer. Surface disagreements between VPs rather than averaging them.
Never present a VP's verdict as fact if another VP contradicted it — say both and say which is
better supported.

**Rule: no layer may pass its children's raw output upward unsynthesized.** Forwarding a dump is
the thing this structure exists to prevent.

**Why fixed shapes rather than freeform prose.** MetaGPT's paper measured this directly and named
the mechanism: *"in the telephone game (or Chinese whispers), after several rounds of communication,
the original information may be quite distorted."* Their roles exchange typed artifacts instead of
dialogue. The Berkeley MAST study (NeurIPS 2025, 200+ traces across MetaGPT, ChatDev, AG2 and
others) found **36.9% of all multi-agent failures were inter-agent misalignment** — the single
largest fixable category. A four-level org without fixed return shapes is four chances to garble.

---

## 5b. The three rules that keep this from being theatre

MAST found ChatDev at **33.33% task correctness**, and — importantly — that refining role prompts
and topology bought only **+15.6%**. Reliability here is architectural, not a matter of writing
better charters. Three structural rules, each aimed at one measured failure category.

### The anti-relay test (Specification failures — 41.8%)

Before spawning, every VP and manager asks: *am I adding judgment, or forwarding a message?*

If the task arrives already decomposed and leaves unchanged, **the layer is waste**. Collapse it:
spawn the grandchild directly and state in the return that the layer was skipped and why. Azure's
antipattern list names this exactly — *"adding agents that don't provide meaningful specialization"*
— and no published framework demonstrates a working four-level hierarchy. Ours is permitted by the
platform (Claude Code's ceiling is main + 3) but unproven, so every layer earns its place per task
or steps aside.

### Employees investigate by default; writing is a scoped exception (Misalignment — 36.9%)

The default employee job is **read, analyze, and return findings** — not produce code. Cognition's
critique of multi-agent systems singles out Claude Code's restraint as the reason it works:
*"it never does work in parallel with the subtask agent, and the subtask agent is usually only
tasked with answering a question, not writing any code."*

When parallel writing is genuinely required, it MUST come with **explicit file ownership** — one
file, one writer, named in the brief — and worktree isolation via `worktree-orchestrator` if the
writers share a repo. Two agents editing one file is not a merge problem to solve later; it is a
brief that should never have been written.

### Verification is a separate step, never the same prompt (Verification — 21.3%)

The agent that did the work does not certify the work. Whoever verifies is a different spawn with a
different prompt, ideally one tier up, and is told to **refute** rather than confirm. Folding
"did I get this right?" into the prompt that produced the output is why MAST's third category
exists — premature termination and absent validation.

**This rule shipped as prose and was implemented by zero charters** — an R2 audit found `refute`
appearing nowhere on the roster except this paragraph. A rule that lives only in a file no agent
loads is decoration. It is now operationalized in §5c mechanism 3, with an explicit trigger
(stakes), an explicit input restriction (original ask + deliverable, never the intermediate
briefs), and an explicit home in the VP charters. Verifying against the chain's own reasoning is
not verification; it is the chain agreeing with itself.

---

## 5c. Intent integrity — the failure this org is most exposed to

Added for Release 2, in response to external review. The critique, stated fairly:

> A wrong understanding at the top of the chain derails the entire outcome even when every agent
> below performs its job perfectly. The Chief of Staff slightly misunderstands; the VP receives an
> already-filtered interpretation; the manager decomposes that interpretation; employees execute it
> flawlessly; the VP reviews the result **against the same incorrect premise**. The result is a
> beautifully organized wrong answer.

This was verified against the actual roster before being accepted, and the roster confirmed it:

| Property | Before R2 |
|---|---|
| Charters carrying the CEO's verbatim ask | **0 / 71** |
| Charters implementing refute-style verification | **0 / 71** (the rule existed only in §5b prose) |
| Escalation triggers for "I may have misunderstood" | **0 / 55** — every trigger was a domain-boundary handoff or a 5-attempt limit |
| Plan → execute → evaluate → **replan** loop | none; the flow was strictly one-pass |

Every escalation path answered *"is this my job?"* and none answered *"is this the right job?"*
The org could detect that work belonged to someone else, and could not detect that the work was
the wrong work. Three mechanisms close that.

### 1. The intent anchor (every tier, always on)

The CEO's request travels **verbatim and unmodified** to every layer, alongside — never replaced
by — the interpreted brief. Every agent opens its return by restating the original ask and its own
reading of it, and flags divergence *first*, before any finding.

This inverts who can catch the error. Previously only the Chief of Staff saw the CEO's actual
words, so a misreading at the top was undetectable everywhere below. Now the **lowest** agent in
the chain sees both the original words and the filtered brief, which makes a Haiku employee the
cheapest possible detector of an Opus-level misinterpretation. Cost is roughly 30 tokens per spawn.

### 2. Confirm before fan-out (Chief of Staff only)

Before any fan-out that spawns more than one VP, or any work that writes, spends, or ships, the
Chief of Staff states its interpretation to the CEO in one sentence and waits.

This is the highest-leverage mechanism in this section and it is available to us specifically
because **we have a human in the loop that autonomous orchestrators do not**. Magentic-One's
Orchestrator cannot ask; it re-plans against its own ledger, which is a strictly weaker signal
than the person who made the request. One clarifying sentence at the top beats any amount of
downstream quorum, and costs a fraction as much.

### 3. Independent review — gated by stakes, not applied by default

For **irreversible or high-stakes** work only — writes to `master`, spends money, changes
production, or asserts a security or compliance position — one reviewer is spawned that receives:

- the CEO's **original ask**, and
- the **final deliverable**

and nothing else. **Never the intermediate briefs.** A reviewer that reads the chain's reasoning
inherits the chain's premise and is worth nothing. It is told to **refute**, not to confirm, and
its dissent is reported to the CEO even when the VP disagrees with it.

Blanket quorum is deliberately rejected: it triples cost against a failure that is rare at low
stakes and nearly free to prevent at high stakes via mechanism 2.

### The unifying rule — three axes, three levers

Chain depth was previously fixed at four levels regardless of what was asked. It is now decomposed:

- **Shape follows complexity** → topology, §5e
- **Care follows stakes** → independent review, §5c.3 above
- **Clarification follows ambiguity** → confirm before fan-out, §5c.2 above

An earlier draft of this section folded shape into stakes with a single 2×2 table. That conflated
two genuinely different questions and could not express a low-stakes, unambiguous, deeply coupled
build — which is most real engineering work. See §5e for the classes and topologies.

Anti-relay (§5b) already collapses layers that add nothing — but it can only fire *after* the VP
has been spawned and paid for, so it saves the manager and never the VP. This rule fires one level
earlier, at the Chief of Staff, which is the only place the saving is real.

---

## 5d. Latency — what the chain actually costs in wall-clock

Measured on the first routing-eval run, 22 Opus spawns:

| Spawn shape | Wall clock | Tokens |
|---|---|---|
| 0 tool calls (answered from injected context) | **~7s** | **~41k** |
| 2 tool calls | ~13–20s | ~87k |
| 3 tool calls | ~28s | ~89k |

Two things follow, and they are the whole latency story.

**A file read costs ~5–7s and ~20k tokens, on the critical path, at every level.** That is why the
roster now preloads as the `org-index` skill (~2.8k tokens, zero tool calls for chartered agents) —
opening a 431-line ORG.md to look up which agent owns backups was the most wasteful thing this org
did. Read ORG.md for *contracts and rules*; never to look up a name.

Measured on the same three routing cases, three ways:

| Setup | Latency | Tokens | Correct |
|---|---|---|---|
| Read CLAUDE.md + ORG.md (pre-R2 behaviour) | 12.6–18.6s | ~88k | 3/3 by dept |
| No reads, no roster | **2.2–6.9s** | **~41k** | **1/3** |
| `org-index` loaded, no file reads | 5.4–9.6s | ~96k | **3/3**, one better than baseline |

**The roster is load-bearing, and cutting it to go fast is the wrong trade.** Stripping reads was
the fastest and cheapest configuration and it routed a secrets sweep to `cso` instead of
`sec-secrets-hunter`, and a backup question to `coo` when `dr-continuity-eng` reports to `cso`. Agent
descriptions say what each agent *does*; only the roster gives the *parent chain*, without which
every depth decision is a guess.

The win is real but it is **latency, not tokens**: one skill load beats two file reads by roughly
half the wall clock. For chartered agents the preload is free of tool calls entirely, which is
where the token win also lands.

**Levels are serial and paid twice.** Every tier is a full spawn on the way down and a synthesis on
the way back, so orchestration overhead is roughly `2 × depth × per-spawn latency` before the
employee's actual work is counted. A 4-level chain spends ~30–60s orchestrating before any real
work starts. This is the cost the CEO feels as "the Alfred layer added slowness," and it is real.

### The VP is on the wrong side of the critical path

A VP does two jobs with opposite latency profiles, and the pre-R2 design paid Opus latency for both
before any work began:

| VP job | When it happens | On the critical path? |
|---|---|---|
| **Route** — decide which managers, with what boundaries | before any work | **yes — everything waits** |
| **Adjudicate** — strike, dedupe, rank, synthesize | after work returns | **no — work is already done** |

Routing is classification. Adjudication is judgment. Only the second needs a VP.

**So the Chief of Staff routes, and VPs adjudicate.** The CoS already holds every agent description
in context on every turn — it is the departmental router whether or not anyone calls it that, and
the routing eval measured it reaching the correct department on 20/22 cases with no VP involved.
Standing a VP up *to decide who should work* adds a serial round trip to answer a question the CoS
had already answered.

Engage a VP when there is genuinely something to adjudicate: several managers whose findings must
be reconciled, a cross-domain call, or high-stakes work needing the §5c.3 review. Not to be told
where to send a secrets sweep.

### Lazy escalation — build the chain upward on demand, not downward on spec

The old default was: instantiate the chain, then let anti-relay collapse what turned out to be
unnecessary. That pays for every layer and refunds some. Invert it.

Route to the shallowest agent that could plausibly own the work. If that agent discovers the scope
is genuinely wider than its surface, it returns an **escalation request** naming what it needs and
why — and the Chief of Staff spawns the wider chain. Spawning stays strictly top-down (§2); nobody
spawns upward. One extra round trip in the rare case beats four guaranteed round trips in every case.

The cost asymmetry is the entire argument. Over-deep costs `2 × depth` round trips on **every**
request. Too-shallow costs one escalation on **the minority** that need it.

---

## 5e. Complexity and topology — what shape the work takes

§5c scaled depth by **stakes × ambiguity**. That was right about *when to be careful* and silent
about *what shape the work takes*. A cross-discipline build can be low-stakes and perfectly
unambiguous and still need four specialties and a verification loop — and the pre-R2 org had
exactly one shape for it: fan VPs out in parallel and reconcile at the top.

That shape cannot express *"the quant verifies the developer's indicator, the developer revises,
QA regresses it."* Parallel fan-out has no loop in it. So the org could staff complex work and
could not *close* it.

**Three orthogonal axes, three different levers.** They do not compete; each answers its own question:

| Axis | Question | Lever |
|---|---|---|
| **Complexity** | what shape? | topology (this section) |
| **Stakes** | how careful? | independent review (§5c.3) |
| **Ambiguity** | do I understand? | confirm before fan-out (§5c.2) |

### Complexity classes

Classified by the Chief of Staff from the request text plus `org-index` — no spawn, no file read.

| Class | Definition | Signals | Topology | Cost of over-classing | Cost of under-classing |
|---|---|---|---|---|---|
| **C0** Trivial | Answerable or doable in-session | single fact; typo; tight refinement loop; answer already in context | T0 | ~15× a chat turn for nothing | none — agents can still be stood up mid-task |
| **C1** Specialist task | One bounded artifact, one discipline | one concrete deliverable + one technology; org-index yields a unique owner | T1 | a VP+manager round trip (~2×2×41k tokens, ~30s) wasted on a script | caught by `ESCALATION REQUEST`; costs one extra hop |
| **C2** Discipline job | Several bounded tasks, or one build needing verification, inside one discipline | plural deliverables under one routing-table row; or a single-discipline build that writes | T1 + verifier, or T3 within the discipline | Opus VP paid to relay to one Sonnet manager | unverified code ships — MAST's 21.3% class |
| **C3** Cross-discipline build | Deliverable whose **merit is judged by a different specialty than the one building it** | verbs/nouns spanning ≥2 routing-table rows joined by one deliverable; "is it actually good/valid/safe" answerable only outside the building discipline | T2 | decorative parallel agents, ~15× spend, no loop closing | **the failure the CEO named**: one agent guessing with its own reasoning. MAST's 41.8% class |
| **C4** Program | Several C3 workstreams where a later stage is worthless if an earlier one fails | deliverables from different rows, sequentially dependent ("an indicator **and** a website **to sell it**") | T4 | over-ceremony, stalled gates | building stage 2 on a stage 1 that should have been killed |

### Topologies

Five, and deliberately no more. Every topology is something a router must learn to pick correctly
and the eval must assert — a sixth costs more in routing error than it buys in expressiveness.

| Name | Shape | Pick when |
|---|---|---|
| **T0** In-session | no spawn | C0 — the handoff costs more than the work |
| **T1** Direct | CoS → one specialist; `ESCALATION REQUEST` is the escape hatch | C1 — org-index yields a unique owner |
| **T2** Build → verify → revise | builder → **verifier (different spawn, told to refute)** → REJECTED findings with evidence → builder revises → verifier re-checks *only the rejected items*; **≤2 cycles then escalate** | any deliverable whose merit is judged by a different specialty; any C2+ that writes |
| **T3** Fan-out → reconcile | N independent workers in parallel → one adjudicator strikes, dedupes, ranks | **only genuinely independent** read/analyze workstreams: audits, sweeps, ship-readiness. Never coupled builds — parallel writers need §5b file ownership and worktrees |
| **T4** Staged gates | serial stages, each internally T0–T3; a CEO-visible gate wherever a stage can invalidate everything downstream; CoS holds a task ledger and **replans** rather than re-spawning after 2 stalls | C4 |

### Selection — feasible set first, then cheapest by dominance

An earlier draft picked topology by coupling alone. That answered "what shape fits the work" and
never asked "what is the cheapest shape that can still produce the required evidence" — so it could
select a correct-but-expensive topology and never notice. Coupling survives, but only inside the
parallelism trigger below.

Run in one classification pass — no spawn, no file read:

1. **Restate the ORIGINAL ASK.** Classify **C** (complexity, above) and **S** (stakes, home
   `CLAUDE.md`). Write the merit contract: done-test, premise register, evidence tier. Any
   **BLOCKING** premise → ground it or ask the CEO *now*, before anything is spawned.
2. **Feasible set** — the topologies that can produce the required evidence tier. E0–E2 are
   topology-independent (a deterministic check works at any size). **E3 requires two independent
   agents**, so T0 is infeasible at S3; the minimum there is work + a separate reviewer.
3. **Cheapest by dominance.** Cost ≈ recurring + spawns×41k + 2×depth×per-spawn (serial) +
   reads×20k + rework. So: **fewer spawns ≺ shallower depth ≺ cheaper models.** Smaller wins by
   default. Escalate only on a named trigger:
   - **review** — S ≥ 2 and no deterministic falsifier → add one independent reviewer.
   - **parallel** — ≥3 genuinely *independent* chunks, each worth more than a spawn floor of work.
     This is where coupling still decides, and where multi-agent's ~15× cost actually pays back.
   - **isolation** — output volume would poison the main context. Context protection is a real
     cost, so spawn even at C1.
   - Otherwise **stay small.**

**Bias small, deliberately — but only while the work is reversible.** Under-provisioning is
recoverable mid-flight: the agent returns an `ESCALATION REQUEST` and the layer above spawns wider.
Over-provisioning is sunk the moment the spawn lands. The risk is asymmetric, so the default leans
to the recoverable side.

**Every classification emits three required fields** — `Stakes: S_`, `Blocking premises: [...] or
none`, `Gate: proceed | CLARIFY | confirm-before-fanout — because ...`. See home `CLAUDE.md`; this
copy is documentation, the operative one is there because that is what the Chief of Staff reads.

**Structure beats exhortation, and this was measured rather than assumed.** An earlier fix stated
the rule as prose — "at S ≥ 2 the blocking-premise check outranks any topology conclusion." Three
consecutive routers across two file placements never mentioned it, and the guard did not move. A
rule that must be *emitted* is falsifiable in the output; a rule that must be *remembered* competes
with everything else in the prompt. This is the same lesson as Magentic-One's ledger — they made
the orchestrator write facts and guesses down rather than trusting it to keep them in mind.

The corollary is uncomfortable and worth keeping: **the falsifiability principle this framework
applies to the work it commissions also applies to its own instructions.** A policy with no
observable output is not enforced, however carefully it is worded.

**Expected failure cost is handled ordinally, through S.** That is the honest version of "expected
cost of an undetected failure" when nobody has real probabilities — inventing numbers to multiply
would be worse than ranking.

### T2 is the primitive that was missing

§5b has said since the rebuild that verification must be a separate spawn told to refute. **Zero
loop shapes implemented it** — it described a property with no structure to hang it on. T2 is that
structure:

1. The builder's brief states the **merit criteria** the verifier will judge against. Written down
   before the build, so the bar cannot move to fit the output.
2. The verifier is a **different spawn**, ideally a different discipline, receiving the original
   ask and the artifact — **not the builder's reasoning**. A verifier that reads the build log
   inherits its premise and is worth nothing.
3. It returns **REJECTED findings with evidence**, not a grade.
4. The builder revises. The verifier re-checks **only the rejected items** — a full re-verify per
   cycle is how a 2-cycle cap turns into a 6-cycle bill.
5. **2 cycles, then escalate to the CEO.** Borrowed from Magentic-One's stall threshold and
   consistent with the 5-iteration hard rule.

A T2 loop whose verifier never rejects anything on the first pass is a smell: either the merit
criteria were written to be passed, or the verifier is confirming rather than refuting.

---

## 6. Verified skill registry

Only these names exist. Naming anything else fails validation. This is the actual selling point of
the skills library over an unstructured skills folder: every skill below is placed by who uses it,
not just alphabetized — the same way a real company's shared-services catalog tells you which team
owns a tool before you go looking for it.

**Universal (4)** — every chartered agent may use these regardless of domain:
`org-index` (the roster, preloaded — use INSTEAD of opening this file to look up a name),
`vault-recall` (check prior knowledge before re-deriving), `verification-before-completion`
(evidence before any success claim), `systematic-debugging` (any bug or unexpected behaviour).

`org-index` is generated from `agents/**/*.md`, never hand-edited, and preloads via the native
`skills:` field — so it costs no tool call. It exists because a file read is ~5-7s and ~20k tokens
on the critical path at every level (§5d).

**Domain-owned (21)** — declared in a specific agent's `skills:` frontmatter; this is the ground
truth for ownership, not this table (rebuild it from `agents/**/*.md` if the two drift):

| Skill | Owning domain(s) |
|---|---|
| `azure-runbook` | backend |
| `backtesting-frameworks` | quant |
| `before-you-build` | appsec |
| `browser` | qa |
| `docx` | compliance, docs |
| `graph-api-rest` | backend, infra |
| `helm-chart-scaffolding` | platform |
| `k8s-manifest-generator` | platform |
| `mcp-builder` | backend |
| `postgresql` | backend, data |
| `pptx` | docs |
| `ps-http-server` | backend |
| `python-testing-patterns` | qa |
| `redesign` | engineering, frontend |
| `risk-metrics-calculation` | data, quant |
| `taste` | engineering, frontend |
| `terraform-module-library` | architecture, infra |
| `worktree-orchestrator` | engineering |
| `xlsx` | analytics, compliance |
| `zero-cost-azure` | analytics, architecture, platform |
| `async-supervisor` | devops |

**Shared tooling (24)** — not preloaded by any single charter's `skills:` frontmatter; available to
any agent or directly to the Chief of Staff/operator, the way a shared-services pool serves every
department rather than belonging to one:

- *Web research* (search, scrape, crawl, map, download, interact): the `firecrawl-cli` plugin skill
  and its siblings, supplied by the official firecrawl plugin. Alfred keeps no local copies — 12
  stale hand-copies were archived on 2026-08-14 after `validate-library` found 8 byte-identical to
  the plugin's own version. Use the plugin; it is the maintained one.
- *Web research* (integrating Firecrawl into product code, not just using it): `firecrawl-build`
- *Framework self-maintenance*: `evolve` (turn repetition into a skill/command/agent),
  `self-improve` (audit Alfred against current Anthropic best practices), `skill-builder`
  (scaffold a new skill correctly), `agent-builder` (scaffold a new org agent that passes
  `validate-org.mjs` on the first run — the charter-contract counterpart to `skill-builder`),
  `route` (Chief of Staff's ambiguous-request classifier), `project-note` (vault-writing convention)
- *Dev/build tooling*: `python-project-structure` `uv-package-manager` `cache-guardian`
  `ollama-interns` (local-model offload — see the operator's `alfred-profile.md` for actual
  hardware)
- *Design/media*: `brandkit` `img2threejs`

**Commands (11):** `azure-audit` `deep-debug` `explain` `fanout` `harvest` `intern` `plan-day`
`pr-desc` `review-loop` `status` `tokens`

**Hooks:** `SessionStart` `SessionEnd` `Stop` (in `~/.claude/settings.json`)

---

## 7. Reuse map — existing specialists, do not duplicate

These agents predate the rebuild, carry real depth, and are delegated to by name. Do not write
thin replacements.

**R2 correction — the contract hole under this map.** These specialists were exempted from the
9-section charter (correctly — they carry depth a thin rewrite would lose), but the validator
filtered them out entirely, so the exemption silently extended to the *return contract* as well.
An audit found **15 of them actively delegated to by chartered agents while returning freeform
prose** into a chain whose entire premise (§5, citing MetaGPT) is that typed artifacts stop the
telephone game. `validate-org.mjs` printed PASS the whole time, because it only inspected agents
that declared a `tier`.

That is anti-pattern #1 — the green picture — reproduced *inside the tool built to prevent it*.
All 15 now carry the employee-tier return contract plus the §5c intent anchor, and the validator
warns on any future delegation target that lacks one. They remain exempt from the other eight
charter sections. The lesson generalizes: **an exemption granted for one reason quietly becomes an
exemption from everything unless the check names its own scope.**

| Specialist | Delegated to by | For |
|---|---|---|
| `database-architect` | `data-manager` | Schema design, technology selection |
| `terraform-specialist` | `infra-manager` | Advanced module/state work |
| `azure-infra-engineer` | `infra-manager` | Azure network + Entra + PowerShell automation |
| `windows-infra-admin` | `infra-manager` | AD, DNS, DHCP, GPO |
| `quant-analyst` | `quant-manager` | Models, backtests, market data |
| `risk-manager` | `quant-manager` | R-multiples, position limits, expectancy |
| `production-validator` | `qa-manager` | No-mocks / deployment-readiness sweeps |
| `tdd-london-swarm` | `qa-manager` | Mockist outside-in TDD |
| `code-analyzer`, `analyst` | `security-manager`, `qa-manager` | Read-only quality analysis |
| `system-architect` | `architect` | ADRs, diagrams, technology evaluation |
| `mobile-dev` | `mobile-manager` | React Native |
| `cicd-engineer` | `devops-manager` | GitHub Actions pipelines |
| `api-docs` | `docs-manager` | OpenAPI |
| `ml-developer` | `analytics-manager` | Training, tuning, deployment prep |

---

## 8. Global rules every charter inherits

From `~/.claude/CLAUDE.md` and the home-root `CLAUDE.md` (`%USERPROFILE%\CLAUDE.md` on Windows, `~/CLAUDE.md` elsewhere):

- Azure IaC is **Terraform only**. Never Bicep, never ARM. Clickops = portal or Azure CLI.
- Never commit secrets, `.env` files, or credentials. Never write them into a file or a note.
- Never force-push to `master`. Never amend pushed commits.
- Never install dependencies without asking the CEO.
- Never delete test files or test data.
- Stop after 5 failed iterations and escalate. Do not spiral.
- 95% confidence rule — below it, ask rather than proceed.
- Evidence before assertions. A success claim without a verification command is a violation.
- Report what was NOT covered. Silent truncation reads as completeness and is the most damaging
  failure mode this org has (see: three test suites that printed SKIP for months).

---

## 9. Anti-patterns the whole org must avoid

1. **The green picture.** Validating structure against a field nobody reads. The frontmatter graph
   was consistent while every delegation instruction pointed at a nonexistent agent.
2. **The solo manager.** A manager doing all the work itself. Produces no reviewable trail and
   burns Sonnet context on Haiku work.
3. **The dump.** Forwarding children's raw output upward instead of synthesizing it.
4. **The silent skip.** Omitting scope without saying so. Always populate `DID NOT COVER`.
5. **The confident guess.** Inventing a fact rather than reporting it as unknown. "Not on disk" is
   a complete and correct answer.
6. **Tier as rank.** Seniority is declared here, never inferred from model. An Opus specialist is
   not a VP.
