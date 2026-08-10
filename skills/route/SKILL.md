---
name: route
description: Decide which VP (or VPs) should own a request when the routing table in CLAUDE.md does not clearly match — ambiguous asks, requests spanning several domains, or work where the obvious owner is probably the wrong one. Use when a request matches no row of the routing table, matches two or more rows, names a symptom rather than a domain ("it's broken", "this feels slow", "is this ready"), or when engaging the obvious VP would produce a mostly-empty answer. Do NOT use when the table already gives a clean single match — routing an unambiguous request through this skill just adds a hop.
---

# Routing an ambiguous request

The table in the home-root `CLAUDE.md` (installed by this framework — `%USERPROFILE%\CLAUDE.md`
on Windows, `~/CLAUDE.md` on macOS/Linux) handles clean matches. This skill exists for the rest.
The org map is `~/.claude/agents/ORG.md`; every VP's `description` field carries its own trigger
conditions and worked examples, which are the ground truth when this guidance is unclear.

## Step 0 — should the org be engaged at all?

Before routing, apply the cheaper test. Multi-agent costs roughly **15× a plain conversation**.
Answer in the main session, and say so, when the request is:

- answerable from context already loaded
- a single-file edit, rename, typo, or one-line fix
- an iterative back-and-forth where briefing would cost more than doing
- one known fact from one known file

If any of these fit, stop here. Not routing is a valid routing decision.

## Step 1 — classify by the question behind the request

The trap is routing on **surface nouns** rather than on what the CEO actually wants to know. The
same words belong to different VPs depending on the question underneath.

| The CEO says | Wrong read | The question underneath | Owner |
|---|---|---|---|
| "is this endpoint safe" | backend → `cto` | can an attacker abuse it | `cso` |
| "this endpoint is slow" | security → `cso` | why is it slow | `coo` (running system) or `cto` (code) |
| "our storage account is public" | security finding | who made it public and how do we stop it recurring | `cso` finds it, `architect` fixes the shape |
| "the deploy keeps failing" | infra → `architect` | the pipeline is broken | `coo` |
| "should this be Cosmos or Postgres" | data → `cfo` | it is a design decision | `architect` leads, `cfo` advises |
| "is this ready to ship" | pick one | three independent questions | all three, in parallel |

Ask: **what would a complete answer contain?** Route to whoever owns that content, not to whoever
owns the files.

## Step 2 — symptom requests

"It's broken." "This feels wrong." "Something's off." These name no domain because the CEO does
not yet know the domain — that is the actual ask.

Do not guess a VP. Engage `coo` (`sre-manager` owns triage) to establish **what is actually
happening** first, then route the diagnosis to whoever owns the cause. A misrouted symptom wastes
a whole branch and returns a confident answer about the wrong system.

## Step 3 — genuinely cross-domain

Engage several VPs **in parallel**, each with an explicitly narrowed brief that names what the
other VPs are covering so they do not duplicate. Then reconcile.

Common shapes:

- **"Is this ready to ship?"** → `cso` (exploitable?) + `coo` (tested and deployable?) +
  `cto` (does it do the thing?). Three answers, one verdict.
- **"Audit this whole project."** → `cso` + `architect` + `coo`. `cfo` only if it
  touches data or spend.
- **"Why is this costing so much?"** → `cfo` leads (spend analysis), `architect` advises
  (is the shape wrong).
- **"Review this design."** → `architect` leads, `cso` reviews the threat surface.

When VPs disagree, report both positions and say which has better evidence. Averaging two verdicts
produces a third one nobody can act on.

## Step 4 — write the brief

A routing decision is worthless without a brief the VP can act on. Every engagement needs:

1. **Objective** — what a complete answer contains
2. **Output format** — the VP's return contract from `ORG.md` §5
3. **Sources and boundaries** — what to look at, and explicitly what NOT to
4. **Effort** — fact-finding (one manager), scoped audit (two), full sweep (all)

Vague briefs are the documented cause of subagents duplicating work and leaving gaps. "Research the
security" is not a brief. "Determine whether any endpoint in `brain/server.mjs` can be reached
without the token check, ignoring dependency CVEs which appsec covers separately" is.

## Step 5 — say what you did

Tell the CEO which VP was engaged and why, in one line, before the answer. A routing decision the
CEO cannot see is a routing decision they cannot correct.

## Anti-patterns

1. **Routing on file paths.** The files a task touches are downstream of the question, not the same
   as it.
2. **Engaging the whole org because the request was vague.** Vague means clarify or triage, not
   fan out five branches.
3. **Sequential when parallel was correct.** Cross-domain VPs read disjoint surfaces; running them
   one after another buys nothing and costs wall-clock.
4. **Routing something the main session should have just done.** Step 0 exists for a reason.
5. **Averaging disagreeing VPs** into a mushy consensus instead of surfacing the conflict.
