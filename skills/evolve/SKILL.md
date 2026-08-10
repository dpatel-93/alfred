---
name: evolve
description: Turns repetition into capability — the self-evolution engine of the Alfred Framework. Use when the user says "evolve", at the end of any substantial work session, or proactively whenever Claude notices the same workflow, explanation, fix, or prompt pattern has occurred 2+ times (in this session or across vault/memory history). Converts repeated work into a new skill, command, agent, or vault pattern so it never has to be re-derived.
---

# Evolve — repetition becomes capability

The framework grows itself. Every repeated workflow is a missed skill. This skill
converts observed repetition into a permanent artifact, then logs the evolution.

## When this fires

- User invokes `/evolve` (optionally with a hint: `/evolve graph api paging`)
- End of a session where something non-trivial was done more than once
- Mid-session, proactively, the moment you catch yourself doing or explaining
  the same thing a second time — don't wait to be asked

## Procedure

1. **Identify the repetition.** Name it in one sentence: "We keep X."
   Sources: current session, memory files, vault `Patterns/`, `Decisions/`,
   recent project notes in the knowledge vault (path in `~/.claude/alfred-profile.md`;
   skip the vault sources entirely if none is configured).

2. **Check for an existing home.** Search `~/.claude/skills/`, `~/.claude/commands/`,
   `~/.claude/agents/`, and vault `Patterns/` first. If something close exists,
   EDIT it — improvements are edits, not new builds.

3. **Pick the smallest adequate artifact:**
   | Repetition looks like | Artifact |
   |---|---|
   | A prompt you keep writing | Command in `~/.claude/commands/<name>.md` |
   | A procedure with steps/reference knowledge | Skill in `~/.claude/skills/<name>/SKILL.md` |
   | A role you keep delegating with the same brief | Agent in `~/.claude/agents/custom/<name>.md` (set `model:` per org chart) |
   | A rule that must fire automatically, not when Claude remembers to | Hook in `~/.claude/helpers/<name>.mjs`, registered in `~/.claude/settings.json` |
   | An architecture/approach worth remembering, not automating | Vault `Patterns/<name>.md` |
   | A one-line fact about the user/projects | Memory file (auto-memory system) |

4. **Build it.** Frontmatter with a trigger-specific description (third person,
   states WHEN). Concrete commands/snippets from the actual repetition — no
   platitudes. Under 150 lines.

5. **Log the evolution.** Append one line to vault
   `Claude-Code/Evolution-Log.md` (create if missing):
   `- YYYY-MM-DD — created|updated <type>/<name> — <why, one clause>`

6. **Tell the user** in one sentence what was created and what to type to use it.

## Constraints

- One artifact per detected repetition — don't speculatively batch-create.
- Never create an artifact for something done once. Twice is the threshold.
- Never duplicate a plugin-provided capability (check the skills list first).
- Deletions/major rewrites of existing artifacts: propose, don't auto-apply.
