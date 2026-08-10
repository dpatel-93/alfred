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
Chief of Staff ..... The main session (Opus). Classifies the request, engages ONE VP
                     (or several in parallel for genuinely cross-domain work), and reports
                     the VP's synthesis back to the CEO. Never does the work itself.
VP ................. Opus. Owns a domain. Decomposes into manager-sized workstreams,
                     spawns managers, adjudicates their reports, returns ONE verdict.
Manager ............ Sonnet. Owns a discipline. Decomposes into employee-sized tasks,
                     spawns employees in parallel, verifies their output, rolls up.
Employee ........... Haiku. Does one bounded thing well and returns a structured result.
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
| | `dr-manager` | `dr-continuity-eng` |
| `coo` — delivery & reliability | `devops-manager` | `devops-pipeline-eng`, `devops-release-eng` |
| | `qa-manager` | `qa-test-author`, `qa-browser-tester` |
| | `sre-manager` | `sre-monitoring-eng`, `sre-incident-responder` |
| | `vendor-manager` | `vendor-audit-eng` |
| `cfo` — data, analytics, cost, markets | `data-manager` | `data-pipeline-eng`, `data-schema-eng` |
| | `analytics-manager` | `analytics-ml-dev`, `analytics-cost-eng` |
| | `quant-manager` | `quant-strategy-dev`, `quant-risk-analyst` |

5 VPs · 17 managers · 33 employees · 55 chartered agents.

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
| Employee | Role line, `Use when`, 2 compact examples. | Its manager's `## My team` table already separates it from its siblings by surface, and its own `## Mission`/`## Rules` carry every behavioural constraint. |

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

### Employee → Manager

```
FINDINGS   — list. Each: what, where (file:line or resource id), evidence (quoted), confidence.
DID NOT COVER — what was in scope but not reached, and why. Never silently truncate.
BLOCKERS   — anything that stopped the work.
```

### Manager → VP

```
VERDICT    — one paragraph. The discipline's answer.
CONFIRMED  — findings the manager verified, ranked by severity. Each keeps its employee evidence chain.
REJECTED   — findings the manager struck, and why. Report this; a silent drop hides a disagreement.
COVERAGE   — what the employees swept, and what was left unswept.
ESCALATED  — anything needing VP judgment.
```

### VP → Chief of Staff

```
ANSWER     — the domain's single answer to the CEO's question. Lead with it.
EVIDENCE   — the ranked, deduplicated findings with their full chain intact.
STRUCK     — findings this VP rejected from its managers, and why. Never drop one silently.
CONFIDENCE — high/medium/low, with the reason.
GAPS       — what this domain could not determine, and what it would take.
RECOMMENDED NEXT — ordered, concrete.
```

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

---

## 6. Verified skill registry

Only these names exist. Naming anything else fails validation. This is the actual selling point of
the skills library over an unstructured skills folder: every skill below is placed by who uses it,
not just alphabetized — the same way a real company's shared-services catalog tells you which team
owns a tool before you go looking for it.

**Universal (3)** — every chartered agent may use these regardless of domain:
`vault-recall` (check prior knowledge before re-deriving), `verification-before-completion`
(evidence before any success claim), `systematic-debugging` (any bug or unexpected behaviour).

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

- *Web research* (Firecrawl CLI actions): `firecrawl` `firecrawl-agent` `firecrawl-crawl`
  `firecrawl-download` `firecrawl-interact` `firecrawl-map` `firecrawl-scrape` `firecrawl-search`
- *Web research* (integrating Firecrawl into product code, not just using it): `firecrawl-build-interact`
  `firecrawl-build-onboarding` `firecrawl-build-scrape` `firecrawl-build-search`
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
