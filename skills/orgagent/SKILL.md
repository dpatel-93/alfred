---
name: orgagent
description: The whole Alfred org — tiers, surfaces, ownership and the rules for staffing them — carried as knowledge rather than as standing agent definitions. Load it when work needs delegating and decide from it whether the job needs one employee, a manager, a manager plus employees, a VP to adjudicate, or nothing at all; then compose the agent(s) with an explicit role, scope, named skills, a done-test and an evidence tier. Use whenever the operator says delegate, spin up an agent, fan out, "who should do this", or a task plainly needs more hands than the current session. Do NOT load it to answer a question you can already answer — that is the most common and most expensive mistake here.
---

# Orgagent — the org as knowledge, not as staff

Alfred has no standing specialists. There is no roster of agents sitting loaded,
waiting. There is this skill, which knows what roles exist, what each one owns, and
how to decide which are needed — and composes them at the moment of need.

The org chart is still real. It is a model of **responsibility**, and it is a good
one. What it is not, and never was, is a **staffing plan**. A permanent roster has to
anticipate every job in advance, and every job that doesn't fit gets forced into the
nearest charter. This keeps the responsibility model and drops the standing cost.

**The dashboard reflects this literally.** The chart renders greyed out — every role
Alfred *could* staff. Only the CEO is lit by default. A role lights up when something
is actually running as it, and goes dark when it finishes. What you see lit is what is
genuinely happening.

## Gate zero — most work never gets here

Before reading another line, answer from the request text alone:

> **Does this genuinely need more than one specialty — people who would each read
> different material to answer their part?**

- **No → do it yourself. Stop. Do not staff anything.** Most requests end here, and
  that is the correct outcome, not a shortcut.
- **Yes → continue.**

**Breadth, not size, and not difficulty.** Measured, and easy to get backwards:

| Request | Verdict |
|---|---|
| "Cosmos or Table Storage?" — hard, one call | **stays with you** — one specialty, however hard |
| "migrate every call site off the old auth helper" — 12 files | **stays with you** — one discipline; splitting is pure overhead |
| "is the admin portal ready to ship?" | **staff it** — security, delivery and product each read different things |

The measured basis (12 head-to-head runs, `brain/R3-FINAL-REPORT.md` §22): small work
**1.48× more expensive** than a single agent for an identical result; big work in one
discipline **1.02×**, i.e. nothing; big work spanning disciplines **0.87×** — the only
case where staffing pays. Quality was tied in all twelve.

## The tiers, and what each is actually for

| Tier | Model | Exists to | Staff one when |
|---|---|---|---|
| **VP** | Opus | adjudicate between disciplines; own a staged programme | two disciplines disagree, or a programme spans several of its managers |
| **Manager** | Sonnet | own a discipline; split work and review what comes back | the job needs splitting, or an employee's output needs a reviewer |
| **Employee** | Haiku | one bounded surface, one job | the surface is known and the job is bounded |
| **Specialist** | varies | a named capability outside the charter | you need it by name |

**Route to the owner, not to their manager.** A VP belongs on the path only to
adjudicate a fan-out, to run or receive an independent review, or to own a staged
programme. Inserting one "to be safe" costs `2 × depth` round trips on every request.

### Which shape

| Situation | Staff |
|---|---|
| one bounded surface | **employee alone** |
| one discipline, needs splitting or review | **manager**, which staffs its own employees |
| one discipline, stakes ≥ S2, no cheap machine check | **manager + a separate reviewer** |
| two-plus disciplines, no conflict expected | **the owners in parallel**, you reconcile |
| two-plus disciplines likely to disagree | **VP** to adjudicate |
| several stages where a later one is worthless if an earlier fails | **staged, gate between stages** |

Prefer the shallowest plausible shape. If scope turns out wider, the agent returns an
escalation request and you staff wider — one extra hop on the minority that need it
beats over-depth on all of them.

## Who owns what

[references/roster.md](references/roster.md) — every role, its parent, the surface it
owns, and its specialist skills. Generated from the charters; never hand-edited.

Read a role's file in [references/charters/](references/charters/) **only** when the
one-line surface is not enough to brief it. Those files are the long-form contracts,
and they are where the accumulated judgement about which role fits which request
lives — worth reading when a routing call is genuinely close, wasteful otherwise.

[references/ORG.md](references/ORG.md) — the contracts and structural rules (§4 charter
spec, §5 return shapes, §5b/§5c). Read for rules, never to look up a name.

## Staffing one

There are no `subagent_type` definitions to call any more. You compose the agent:
spawn a general-purpose agent, pass `model` explicitly per the tier table, and give it
the brief below. **The role name from the roster becomes the assembled agent's ROLE** —
that is what lights up on the dashboard.

```
ORIGINAL ASK (verbatim)
  <the operator's words, unedited — never paraphrase into this>

MY READING
  <one sentence. If it differs from the above, say so.>

ROLE      <name from roster.md> — <the one surface it owns>
TIER      <vp|manager|employee|specialist>
SCOPE     in:  <...>
          out: <...>        ← name this; it is what stops the wandering
SKILLS    <exact skill names — so it doesn't spend a turn rediscovering them>
MODEL     <opus|sonnet|haiku> — <why this tier>

DONE-TEST <one observable check that would FALSIFY the work if it failed>
PREMISES  1. <assumption> [GROUNDED <file:line|cmd> | ASSUMED | BLOCKING]
EVIDENCE  E<0-3>
RETURN    <the exact shape expected back>
```

**No done-test means the task is underspecified — clarify before spending.** That is the
cheapest moment to catch a bad spec, and specification failure is the largest measured
multi-agent failure class. A `BLOCKING` premise stops the spawn until it is grounded or
the operator is asked.

**Carry `ORIGINAL ASK` verbatim into every brief.** The assembled agent is then the only
layer seeing both the operator's words and your reading of them, which makes the cheapest
agent in the chain the detector for your own misreading.

## Verification follows stakes

**S0** reversible+private · **S1** reversible+shared · **S2** hard-to-reverse or
outward-facing · **S3** irreversible / security / money.
**E0** the artifact · **E1** quoted output of a deterministic check · **E2** E1 + every
load-bearing premise grounded + confirmation before the irreversible step · **E3** E2 +
review by an agent that did not produce the work + operator approval.

**Independent review is required only when no cheap deterministic falsifier exists AND
stakes ≥ S2.** If a machine check exists, or can be written for less than a review spawn
costs (~41k tokens, measured), the check wins — a falsifier cannot hallucinate agreement,
a reviewer can.

Whoever checks must not be whoever did the work.

## Honest status

The responsibility model, the breadth gate and the tier shapes are **measured**. That
on-demand composition performs as well as the standing roster did is **not** — it removes
~9,800 tokens of always-on context, which is arithmetic, but the one adjacent experiment
(`d7ce052`) cut standing definition and results got *worse*. The old charters are archived,
not deleted. If on-demand loses on a real task, restoring takes minutes.

## Anti-patterns

- **Loading this skill to answer something you already know.** Gate zero exists for this.
- **Staffing a VP for a one-line change.** Not thoroughness. Slower and dearer.
- **A brief with no done-test.**
- **The doer checking its own work.** A chain that agrees with itself is this org's most
  exposed failure mode: organised output is evidence of process, never of premise.
- **Reading every charter before deciding.** The roster line is usually enough.
- **Claiming a token saving for on-demand staffing.** Unmeasured. Say so.
