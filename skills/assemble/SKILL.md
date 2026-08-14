---
name: assemble
description: Compose a task-specific agent, or a small organ of agents, at the moment of need — with an explicit role, scope, named skills, a done-test and an evidence tier — instead of routing to a standing agent definition. Use when a task needs delegating but no chartered agent fits cleanly, when the work spans two surfaces that no single owner covers, when a one-off specialty is needed that does not deserve a permanent charter, or when the operator says "spin up an agent for this". Do NOT use when a chartered agent already owns the surface — route to that owner instead.
---

# Assemble — an agent built for this task, then discarded

The org chart is a good model of *responsibility*. It is a poor model of *staffing*: a
permanent roster has to anticipate every job in advance, and the jobs that don't fit get
forced into the nearest charter. This composes the right agent at the moment of need,
using the same separation of responsibility the standing org already encodes.

**This does not replace the org chart.** When a chartered agent owns the surface, route
to that owner — `org-index` names them, and that path is cheaper and better tested.
Assemble is for the gaps: a surface nobody owns, a pairing nobody anticipated, a
specialty that would be dead weight as a permanent charter.

## Honest status

The benefit here is **unproven**. The measured facts as of 2026-08-14:

- Agent *descriptions* cost ~9,800 tokens of always-on context. That number is real.
- Whether composing agents on demand actually beats the standing roster has **not been
  measured**. The one adjacent experiment (`d7ce052`) cut the *charter* and made things
  worse, so the intuition "less standing definition is cheaper" has already failed once
  in this framework.

Treat this as a hypothesis with a clean interface, not an established win. If it is
worth keeping, an A/B against the standing roster on the same task will show it.

## The composition

Every assembled agent needs all six. A missing field is how an agent goes and does the
wrong thing confidently.

| Field | What it fixes |
|---|---|
| **Role** | one surface, one job — never "handle the auth work and also the UI" |
| **Scope** | what is explicitly OUT, so it doesn't wander |
| **Skills** | the exact skills by name, so it doesn't rediscover them |
| **Done-test** | one observable check that would FALSIFY the work if it failed |
| **Premises** | the 1–3 assumptions that make it worthless if false, each tagged |
| **Evidence** | E0–E3, from the stakes rule in the root charter |

**If no done-test can be stated, the task is underspecified — stop and clarify.** That is
the cheapest possible moment to catch a bad spec, and specification failure is the largest
measured multi-agent failure class.

## Procedure

1. **Check for an owner first.** Load `org-index`. If a chartered agent owns this surface,
   route there and stop — do not assemble. Assembling over an existing owner is pure waste.
2. **Name the surfaces.** One surface → one agent. Two genuinely different surfaces → an
   organ. More than three → the task is a program; stage it and gate between stages.
3. **Pick the tier** per the root charter's org-chart routing: Opus for hard debugging and
   adversarial review, Sonnet for building, Haiku for search and bulk mechanical work.
   Pass `model` explicitly — never let it default.
4. **Name the skills explicitly** in the brief. This is the whole reason the library is
   kept clean: an assembled agent that is told *which* skills it has does not spend a turn
   discovering them.
5. **Carry the operator's words verbatim.** Open every brief with `ORIGINAL ASK`, unmodified,
   alongside your reading of it. The assembled agent is then the only layer that sees both,
   which makes it the detector for your own misreading.
6. **Separate the checker from the doer.** If the work needs verification and no cheap
   deterministic check exists, assemble a *second* agent to check it. Never the same one.
   And prefer the machine check: a falsifier cannot hallucinate agreement, a reviewer can.

## Brief template

```
ORIGINAL ASK (verbatim)
  <the operator's words, unedited>

MY READING
  <one sentence — where this differs from the above, say so>

ROLE      <one surface, one job>
SCOPE     in:  <...>
          out: <...>   ← name this, it is what stops the wandering
SKILLS    <exact skill names to use>
MODEL     <opus|sonnet|haiku> — <why this tier>

DONE-TEST <one observable check that would fail if the work is wrong>
PREMISES  1. <assumption> [GROUNDED <file:line|command> | ASSUMED | BLOCKING]
EVIDENCE  E<0-3>

RETURN    <the exact shape expected back>
```

A `BLOCKING` premise stops the spawn until it is grounded or the operator is asked.

## Anti-patterns

- **Assembling when an owner exists.** Check `org-index` first, every time.
- **A brief with no done-test.** Underspecified. Clarify before spending.
- **An organ where one agent would do.** Breadth, not size, justifies more than one — a
  twelve-file change in one discipline is still one agent.
- **The doer checking its own work.** A four-level chain that agrees with itself is this
  org's most exposed failure mode. Organised output is evidence of process, never of premise.
- **Claiming a token saving.** It is unmeasured. Say so.
