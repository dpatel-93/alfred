---
description: End-of-session capture — extract decisions, reusable patterns, and learning notes from this session into the knowledge vault, and update the project's Current State.
argument-hint: [optional project name, else infer from cwd]
---

Vault root: resolve it from the knowledge vault path in `~/.claude/alfred-profile.md` (skip this step if none is configured). Every path below is relative to that root.

Review this entire session (not just the last message) and extract what's worth keeping:

1. **Decisions** — any architecture or approach choice made with real tradeoffs. For each, write or append `Decisions/YYYY-MM-DD - <title>.md` using the format: Project, Context, Decision, Alternatives, Why. Use today's actual date.
2. **Patterns** — anything reusable across projects (a script structure, an auth pattern, a deployment approach). Check `Patterns/` first for an existing note to extend before creating a new one.
3. **Learning** — any concept you explained in depth this session (SQL, AKS, Python, frontend, etc.). Check `Learning/` for an existing note on the topic and build on it rather than starting over.
4. **Project note** — identify the project ($ARGUMENTS if given, else infer from the working directory). With a shared brain ("Shared brain path" in the profile), update `<brain>/Projects/<project-slug>/status.md` (create from `<brain>/System/templates/project-status.md` if missing): "Where it stands", "Next" and the Read-aloud summary; put detailed notes in that project's `notes/`. Otherwise open the vault's `Projects/<ProjectName>.md` (create from `Templates/New-Project.md`) and update its "Current State".
5. Use wiki-link syntax (`[[Projects/ProjectName]]`) to cross-link new notes to the project note. Keep every note concise — decisions and state, not a transcript.
6. Skip anything that's just normal code already visible in git history — only capture what isn't obvious from the diff.
6a. **Memories** — with a shared brain, also run its memory protocol (MANIFESTO §8): taught context about the user's setup goes to `Memory/topics/<topic>.md` (detail to `Knowledge/Docs/`), events and decisions to `Memory/timeline/YYYY-MM.md`, anything due to `Reminders/`.
7. If the vault is shared with other AIs (a "Shared brain path" is set in the profile), follow that brain's MANIFESTO.md: no personal names, handles, emails, account or tenant IDs, or secrets in any note.
8. Report a short list of what you wrote or updated, with file paths.
