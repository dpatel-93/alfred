---
name: agent-builder
description: |
  Scaffolds a new Alfred org agent (VP, manager, or employee) that satisfies the full charter
  contract in skills/orgagent/references/ORG.md §4 and passes helpers/validate-org.mjs on the first run — not a rough
  draft to be fixed up later. Use when a real, recurring workload has no owner in the current org
  (a genuine capability gap, not just "this would be nice"), when adding a new department under an
  existing VP, or when the CEO says "we need an agent for X." Do NOT use for one-off tasks that fit
  an existing agent, or for framework-level meta-skills (those are just skills, not agents — see
  the `skill-builder` skill instead).
---

# Agent Builder — scaffold a charter that passes validation the first time

This is the manual process behind every agent this framework has actually added since the v4
rebuild, written down so it doesn't have to be re-derived each time. It builds toward
`node ~/.claude/helpers/validate-org.mjs` passing clean, because that validator is the actual spec
— not this document. If the two ever disagree, the validator is right.

## Step 0 — is a new agent actually the right answer?

Before writing anything, check:

- **Is this a real, recurring workload**, or a one-off task that fits an existing agent's scope?
  A new agent is organizational overhead — tools, a charter, a place in the routing table — that
  only pays for itself if the workload recurs.
- **Does an existing specialist already cover this?** Check `skills/orgagent/references/ORG.md` §7 (Reuse map) first —
  several deep-domain specialists predate the org rebuild and are meant to be delegated to by name,
  not duplicated.
- **Does it fit under an existing manager**, just needing that manager's "My team" table extended
  with a new employee — rather than a whole new manager? Most new capability is a new employee
  under an existing manager, not a new department. A new manager is for a workload that doesn't
  cleanly fit any existing manager's domain and is substantial enough to be its own discipline.

If the honest answer is "this is a one-off" or "an existing agent already covers it," stop here —
building an unnecessary agent is exactly the org-bloat this framework's own routing rules exist to
avoid (multi-agent work costs roughly 15× a plain conversation; an unused agent is pure overhead).

## Step 1 — place it in the org

Decide, in order:

1. **Tier**: `vp` (Opus, reports to `chief-of-staff`), `manager` (Sonnet, reports to a VP),
   `employee` (Haiku, reports to a manager, and is always a leaf — employees never have a team).
2. **Parent**: the exact agent name it reports to. Must already exist, and must be exactly one tier
   above (a manager cannot report to another manager).
3. **Domain**: a single lowercase word capturing its area (`backend`, `dr`, `quant`, etc.) —
   matches the `domain:` frontmatter field used across the existing roster.
4. **Name**: lowercase-kebab, and the filename must equal the name exactly (`sre-manager.md` has
   `name: sre-manager`). Names are case-sensitive at spawn time — a mismatched case is a silent
   ghost reference, not a typo the system catches for you.

Read 2-3 existing charters at the same tier as your new agent, in a domain as close as possible to
what you're building (e.g. building another compliance-flavored manager? read `compliance-manager.md`
and its employee `comp-evidence-collector.md`). Copy their structure and rigor, not their prose.

## Step 2 — write the frontmatter

Required fields (all of them — `validate-org.mjs` fails a charter missing any):

```yaml
---
name: your-agent-name
description: |
  One paragraph: what it owns, what makes it distinct from adjacent agents (the boundary matters
  more than the mission — say explicitly what this agent is NOT for and who owns that instead).
  Must contain an explicit "Use when..." trigger phrase — the layer above reads this to route.
  <example>
  Context: one sentence setting up a realistic scenario.
  user: "a realistic thing the CEO might actually say"
  assistant: "I'll engage <this-agent>, which will <what happens next>."
  <commentary>Why this routes here and not to the adjacent agent it could be confused with.</commentary>
  </example>
  <example>
  ... at least 2 examples total, minimum. 3-4 is typical for a VP or manager with several
  plausible-but-wrong routings to disambiguate.
  </example>
model: opus | sonnet | haiku    # MUST match tier exactly — vp=opus, manager=sonnet, employee=haiku
tier: vp | manager | employee
parent: <exact name of the agent one tier up, or "chief-of-staff" for a VP>
domain: <single lowercase word>
tools: Read, Grep, Glob, Bash, ...   # add WebSearch/WebFetch if it researches; add Agent for vp/manager (required to delegate); employees never get Agent
skills: vault-recall, verification-before-completion, systematic-debugging, <domain-specific skills>
forbidden_actions:      # REQUIRED for vp/manager, meaningless (and flagged) for employee
  - id: F001
    action: self_execute_task
    description: "Do the specialist work myself instead of delegating"
    delegate_to: <the employee/manager this hands off to>
  # F002+ : domain-specific traps this agent must not fall into, each with either
  # delegate_to (a specific agent) or use_instead (a rule to follow)
---
```

**The capability-must-match-mandate trap**: if `forbidden_actions` forbids `self_execute_task` with
`delegate_to`, the `tools:` line MUST include `Agent` (or `Task`) — a VP/manager that's forbidden
from doing the work itself but has no tool to delegate with is an unobeyable mandate, and the
validator catches this specifically because it happened for real (46 of 51 agents once shipped this
way and passed every other check).

## Step 3 — write the nine required sections, in this order

`validate-org.mjs` checks for these exact headings — copy them verbatim, don't paraphrase:

1. **`## Mission`** — one paragraph. What this agent owns, and the one-sentence version of the
   boundary that keeps it from absorbing an adjacent agent's work.
2. **`## When I am engaged`** — bulleted triggers, in the CEO's vocabulary, not internal jargon.
   Close with an explicit "I am **not** the right owner for..." naming the adjacent agents and
   handing off rather than absorbing.
3. **`## My team`** — a markdown table, first column backticked agent names, second column "Engage
   when." **Employees write `None — I am a leaf.`** VPs/managers must have at least one row — a
   leader with zero reports fails validation (`no agent declares parent "X"`).
4. **`## Skills I invoke`** — a table: skill name, when to use it. `vault-recall` first (check
   prior knowledge before re-deriving), plus `verification-before-completion` and
   `systematic-debugging` are near-universal. Every skill named here AND in frontmatter `skills:`
   must actually exist — check `skills/orgagent/references/ORG.md` §6 or `ls skills/`.
5. **`## Rules`** — the non-negotiables. What NOT to do, and what to do instead. This is where
   domain-specific policy lives (e.g. "Terraform only, never Bicep/ARM").
6. **`## How I execute`** — numbered steps. For VP/manager tiers, this section MUST contain an
   **anti-relay check**: if a task already arrives scoped to exactly one report, skip the
   scoping/decomposition step, spawn that report directly, and say so in the return. Use the words
   "anti-relay" or "collapse" — the validator greps for them. End with **"I must not"** — the
   solo-manager failure mode named explicitly, with the one legitimate exception (work genuinely
   too small to hand off) stated.
7. **`## What I return`** — a fenced code block with the tier-specific field set, exactly:
   - VP: `ANSWER, EVIDENCE, STRUCK, CONFIDENCE, GAPS` (RECOMMENDED NEXT is common but not required)
   - Manager: `VERDICT, CONFIRMED, REJECTED, COVERAGE` (ESCALATED is standard)
   - Employee: `FINDINGS, DID NOT COVER` (BLOCKERS is standard)
8. **`## Escalation`** — when this agent stops and hands back upward, as a bulleted list including
   "five attempts have failed" as the hard stop.
9. **`## Anti-patterns`** — numbered list of named failure modes this agent must avoid, each with a
   one-line description of what it looks like when it happens.

## Step 4 — write the employee(s), if this is a manager

A manager with no employees is an orphaned leader. Give it at least one employee, following the
same frontmatter rules (tier: employee, model: haiku, no `Agent`/`Task` in tools, no
`forbidden_actions` needed, `## My team` reads `None — I am a leaf.`).

## Step 5 — wire it into the org map

- If it's a VP: add its "My team" row to the Chief of Staff's routing (the home-root `CLAUDE.md`)
  if it changes top-level routing.
- If it's a manager: add a row to its parent VP's `## My team` table.
- Update `skills/orgagent/references/ORG.md` §3 (the org table) and its tally line (`N VPs · N managers · N employees`)
  — the validator checks this tally against reality and fails if they disagree.
- If it fills a real gap in `skills/orgagent/references/ORG.md` §7 (Reuse map) or needs placement rules for the HUD
  (`brain/org-map.json`), update those too — see that file's own header comment for its schema.

## Step 6 — validate, don't assume

```bash
node ~/.claude/helpers/validate-org.mjs
```

Fix every error before considering the agent done — a chartered agent that fails validation is not
"mostly done," it's broken in a way that will silently misroute delegation later. Common first-run
failures and what they mean:

- `frontmatter missing required field: X` — see Step 2.
- `tier "X" requires model "Y", found "Z"` — model/tier mismatch, see Step 2.
- `no forbidden_actions` / `lacks action "self_execute_task"` — see Step 2's capability-mandate trap.
- `GHOST: "## My team" names "X" which does not exist on disk` — a typo'd or not-yet-created report.
- `description has no "Use when…" trigger phrase` — the routing surface is incomplete, see Step 2.
- `description carries N <example> block(s) — at least 2 required` — add more examples.
- `"## How I execute" has no anti-relay test` — see Step 3, item 6.
- `"## What I return" omits required field X` — see Step 3, item 7.
- `no agent declares parent "X"` — an orphaned leader with no reports, see Step 4.

Once it passes clean, run the full test suite (`node brain/test/run.mjs`) to confirm nothing else
regressed, then sync the new file(s) to `~/.claude/agents/...` if working from the repo checkout —
`install.ps1`/`install.sh` are merge-only and won't overwrite an existing live file with newer repo
content.

## Anti-patterns

1. **The thin wrapper.** An agent whose charter is technically complete but whose "Mission" and
   "When I am engaged" don't actually distinguish it from an existing agent — this is duplication
   wearing a charter, not a real capability gap.
2. **The un-delegatable mandate.** Forbidding self-execution without granting the `Agent` tool.
3. **The orphaned leader.** A manager or VP with an empty or missing "My team" table.
4. **The vague trigger.** A description with no concrete "Use when" phrase and fewer than 2
   worked examples — the layer above cannot route to an agent it cannot recognize a match for.
5. **The skipped validator.** Treating "looks right" as equivalent to "passes
   `validate-org.mjs`" — it isn't; run it before calling the agent done.
