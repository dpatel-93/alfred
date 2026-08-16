---
name: evolve
description: Turns repetition AND correction into capability — the self-evolution engine of the Alfred Framework. Use when the user says "evolve", at the end of any substantial work session, whenever the user corrects, redirects or overrides you in a way that would generalise, and proactively whenever the same workflow, explanation, fix or prompt pattern has occurred 2+ times. Also fires when the user mentions observations, the observation log, cross-cutting principles, or asks what a session taught. Converts repeated work and corrected judgement into a permanent artifact so neither has to be re-derived.
---

# Evolve — repetition and correction become capability

The framework grows itself. Every repeated workflow is a missed skill; every
correction you had to be given is a rule that wasn't written down.

This skill has two halves that must not be collapsed into one:

| Half | Trigger | Output | Threshold |
|---|---|---|---|
| **Observe** | A correction, an override, a judgement call, a gap | One observation file | **Once is enough** |
| **Build** | Accumulated observations, or plain repetition | A skill/command/agent/hook/pattern | **Twice, or an approved observation** |

Observing is cheap and is not a commitment to build anything. That separation is
the point: it lets a single correction be captured without licensing speculative
artifact-building off one data point.

> The observation-log and cross-cutting-principles mechanisms below are adapted
> from **"One Skill to Rule Them All" (task-observer)** by **Eoghan Henn /
> [rebelytics.com](https://rebelytics.com)**, licensed CC BY 4.0 —
> <https://github.com/rebelytics/one-skill-to-rule-them-all>. Adapted, not
> vendored: the shared-numbered-log machinery is deliberately replaced (see
> "Why one file per observation").

---

## Part 1 — Observe

### When to observe

Active for any substantive working session — execution, review, and the
discussion *about* the work. **The observation mindset does not switch off when
the conversation turns from doing to discussing**; feedback in review is often
the highest-signal input there is. Inactive only for casual chat and one-shot
factual questions.

### What to watch for

**A NEW artifact might be needed when:** a reusable multi-step workflow appears;
the user explains a methodology nothing captures; a task type recurs with the
same shape; the user describes how they always do something.

**An EXISTING artifact needs improving when:** you violated a documented rule
(the rule needs *enforcement*, not louder wording); a correction reveals a
missing rule or edge case; a better workflow emerged than the artifact
recommends; feedback generalises beyond the immediate case; an assumption you
made was wrong.

**An artifact needs SIMPLIFYING when:** a section is never relevant; a rule came
from a single unvalidated observation; the user consistently shortcuts a step;
rules contradict; complexity was added "just in case" and never fired; **a rule
you repeatedly fail to follow** — convert it to structural enforcement (a
checklist, a verification step, a command that refuses) or delete it.
Ask *"what can we remove?"* as deliberately as *"what should we add?"* —
Alfred has historically only ever grown, and that is a defect.

**Do NOT log:** one-off corrections that don't generalise; preferences already
captured somewhere; tool bugs unrelated to method; anything needing client or
WORK-mode specifics to be useful.

### How to log — one file per observation

Write to `<vault>/Claude-Code/Observations/YYYY-MM-DD-<short-slug>.md`
(vault path from `~/.claude/alfred-profile.md`; **if no vault is configured,
skip silently** — never block work on a missing vault).

```markdown
# <one-line statement of what was noticed>

- **Date:** YYYY-MM-DD
- **Trigger:** correction | override | gap | repetition | self-observation
- **Target:** <skill/command/agent/hook name, or "new", or "all">
- **Status:** OPEN

**What happened:** <the concrete incident, not a generality>

**What it implies:** <the rule or artifact this argues for>

**Enforcement:** <how it would be made structural rather than remembered —
or "none available" if it genuinely can only be prose>
```

Write it **in the same turn or the next** — the act of writing is the
enforcement. Never bank observations mentally for the end of a session; that is
exactly when they are lost.

### Why one file per observation

Because a single shared numbered log is a concurrency hazard, and Alfred runs
parallel agents by default. A shared log needs number pre-checks, post-write
collision verification, renumbering races, and bounded-mutation discipline to
avoid one session's write-back destroying another's entries. One file per
observation deletes that entire class of problem: appends can never collide, no
numbering exists to race on, and no mutation can span an entry boundary. Take
the mechanism, not its accident.

---

## Part 2 — Build

### Procedure

1. **Name it in one sentence.** "We keep X," or "I was corrected about Y."
   Sources: this session, OPEN observation files, memory, vault `Patterns/`,
   `Decisions/`, project notes.

2. **Check for an existing home.** Search `~/.claude/skills/`,
   `~/.claude/commands/`, `~/.claude/agents/`, and vault `Patterns/` first.
   If something close exists, **EDIT it** — improvements are edits, not new
   builds.

3. **Consult the cross-cutting principles** (Part 3). This is mandatory before
   creating or regenerating any artifact, not advisory.

4. **Pick the smallest adequate artifact:**

   | Repetition looks like | Artifact |
   |---|---|
   | A prompt you keep writing | Command in `~/.claude/commands/<name>.md` |
   | A procedure with steps/reference knowledge | Skill in `~/.claude/skills/<name>/SKILL.md` |
   | A role you keep delegating with the same brief | Agent in `~/.claude/agents/custom/<name>.md` (set `model:` per org chart) |
   | A rule that must fire automatically, not when Claude remembers to | Hook in `~/.claude/helpers/<name>.mjs`, registered in `~/.claude/settings.json` |
   | An architecture/approach worth remembering, not automating | Vault `Patterns/<name>.md` |
   | A one-line fact about the user/projects | Memory file (auto-memory system) |

   **Prefer the hook row whenever the rule is one you might forget.** A rule the
   harness enforces beats a rule the model must remember — measured repeatedly
   in this framework, most recently when a prose routing rule failed to enter
   three consecutive routers' reasoning.

5. **Build it.** Frontmatter with a trigger-specific description (third person,
   states WHEN). Concrete commands and snippets from the actual incident — no
   platitudes. Under 150 lines.

6. **Close the loop.** Mark the source observation `Status: ACTIONED` (edit that
   one file only). Append one line to `<vault>/Claude-Code/Evolution-Log.md`:
   `- YYYY-MM-DD — created|updated <type>/<name> — <why, one clause>`

7. **Tell the user** in one sentence what changed and what to type to use it.

### Constraints

- One artifact per detected repetition — don't speculatively batch-create.
- **Building** needs twice, or one observation the user approved. **Observing**
  needs once. Don't conflate them.
- Never duplicate a plugin-provided capability (check the skills list first).
- Deletions and major rewrites: propose, don't auto-apply.
- Compression destroys enforcement machinery first, because checklists and
  assertions read as redundancy. When rewriting any artifact, inventory its
  enforcement mechanisms explicitly and confirm each survived.

---

## Part 3 — Cross-cutting principles

Some observations aren't about one artifact — they're about how all of them
should be written. These live in
`<vault>/Claude-Code/Cross-Cutting-Principles.md` and are a **mandatory
checklist whenever any skill, command or agent is created or regenerated.**

```markdown
### <principle title>
- **Added:** YYYY-MM-DD
- **Applies to:** all skills | all agents | anything with rules
- **Requirement:** <what it demands>
- **Propagation:** immediate | opportunistic
- **Status:** active
```

*Immediate* means sweep every artifact now — reserve it for correctness and
safety. *Opportunistic* means apply at each artifact's next edit, which is the
sane default. **The user chooses which; never decide propagation timing
unilaterally.**

---

## Review

When the user asks "any observations?", is closing a session, or `/evolve` is
invoked with no hint: list OPEN observations grouped by target, and propose the
smallest set of edits that would close the most of them. Do not batch-apply —
propose, get approval, then act.

If more than a handful are open and none has been actioned in a while, say so
plainly in one line. Do not gate the user's actual work on a review.
