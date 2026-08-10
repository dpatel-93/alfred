---
name: project-note
description: Maintains the Alfred Brain project note lifecycle — reads or creates Projects/ProjectName.md from the vault template when starting work on a project, and updates its Current State section when finishing a session. Use at the start of any work session in a project under _Projects\, and again before ending that session, to keep the vault's cross-session memory current.
---

# Project Note Lifecycle

Read `~/.claude/alfred-profile.md`'s "Knowledge vault path" first. If it's unset, say so plainly
("no vault configured in alfred-profile.md — skipping the project-note lifecycle") and stop; this
whole skill is a no-op without a configured vault.

Every project gets a note in the vault (plain markdown — no Obsidian or other app dependency).
This is the operator's cross-session memory — decisions, patterns, and state that git history and
code don't capture. Mandatory per the framework's global CLAUDE.md, not optional, whenever a vault
is configured.

"Vault root" below means the path from "Knowledge vault path" in `alfred-profile.md`.

## On starting work in a project

1. Check `Vault\Projects\<ProjectName>.md`. Name it to match the project
   folder name exactly (e.g. `Northwind.md`, `DailyBrief.md`, `TenantSync.md`).
2. If it exists: **read it before touching any code.** It has prior decisions
   and state that won't be in the repo.
3. If it doesn't exist: create it from `Vault\Templates\New-Project.md`:

```markdown
# {{title}}

> Created: {{date}}
> Status: Active | On Hold | Completed | Archived
> Repo: {{repo_url}}
> Branch: `master`

## Purpose
<!-- What is this project and why does it exist? -->

## Tech Stack
| Layer | Technology |
|---|---|
| Language | |
| Framework | |
| Hosting | |
| Database | |
| CI/CD | |
| Auth | |

## Architecture
<!-- High-level architecture notes, key design decisions -->

## Key Components
<!-- Major files, modules, services — what lives where -->

## Patterns & Decisions
<!-- Notable patterns, ADRs, or decisions made during development -->

## Dependencies
<!-- External services, APIs, packages worth noting -->

## Current State
<!-- What's done, what's in progress, what's next -->

## Notes
<!-- Anything else worth remembering across sessions -->

---
*This note is maintained by Claude Code. Updated automatically when working on this project.*
```

Fill in what's knowable immediately (Purpose, Tech Stack, initial Architecture).
Leave sections that need real work-in-progress (Current State) for the end of
the session.

## On finishing a session

Update the note — don't recreate it:
1. **Current State**: what got done this session, what's in progress, what's next. This is the section most worth keeping accurate — it's what the next session reads first.
2. **Patterns & Decisions**: only if something new and reusable emerged (a new
   architecture choice, a gotcha worth remembering). If it's reusable across
   *multiple* projects, it probably belongs in `Patterns/` instead — see below.
3. **Notes**: anything else non-obvious from the code/git history alone.

Don't rewrite sections that are still accurate. Edit in place, don't append a
"Session N update" log — the note should always read as current-state truth,
not a changelog (git already is the changelog).

## Vault-wide rules (apply to every note, not just project notes)

- **No YAML frontmatter** — these are plain markdown notes, no app-specific metadata format.
- **Wiki-links**: reference other notes as `[[Projects/ProjectName]]`,
  `[[Patterns/PatternName]]`, `[[Decisions/YYYY-MM-DD -- Title]]`.
- **Concise** — decisions, patterns, and state that isn't obvious from the
  code. Don't duplicate README content wholesale; summarize and link to the repo instead.
- The vault syncs via OneDrive — treat it as a shared resource, don't leave it
  mid-edit in a broken state.

## Related vault folders (check before proposing something new)

- `Patterns/` — reusable architecture/implementation patterns proven across
  projects (e.g. [[azure-runbook]], [[graph-api-rest]], [[ps-http-server]],
  [[zero-cost-azure]] are all sourced from here). Check this folder before
  suggesting a new approach — if one already exists, use and link it instead
  of reinventing it.
- `Decisions/` — significant architecture choices with Context/Decision/
  Alternatives/Why. Check before facing a similar choice in a new project.
- `Learning/` — notes as the operator ramps on topics in their alfred-profile.md
  Learning areas (e.g. databases, AKS, frontend, Python). Check for an existing
  note before re-explaining a concept from scratch; after a good explanation,
  offer to save one.

Source: `Vault\Templates\New-Project.md`, vault rules from the framework's global
CLAUDE.md "Alfred Brain Integration" section.
