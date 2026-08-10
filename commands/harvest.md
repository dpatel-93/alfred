---
description: End-of-session capture — extract decisions, reusable patterns, and learning notes from this session into the Obsidian vault, and update the project's Current State.
argument-hint: [optional project name, else infer from cwd]
---

Vault root: resolve it from the knowledge vault path in `~/.claude/alfred-profile.md` (skip this step if none is configured). Every path below is relative to that root.

Review this entire session (not just the last message) and extract what's worth keeping:

1. **Decisions** — any architecture or approach choice made with real tradeoffs. For each, write or append `Decisions/YYYY-MM-DD - <title>.md` using the format: Project, Context, Decision, Alternatives, Why. Use today's actual date.
2. **Patterns** — anything reusable across projects (a script structure, an auth pattern, a deployment approach). Check `Patterns/` first for an existing note to extend before creating a new one.
3. **Learning** — any concept you explained in depth this session (SQL, AKS, Python, frontend, etc.). Check `Learning/` for an existing note on the topic and build on it rather than starting over.
4. **Project note** — identify the project ($ARGUMENTS if given, else infer from the working directory). Open `Projects/<ProjectName>.md` (create from `Templates/New-Project.md` if missing) and update its "Current State" section with what was done this session and what's next.
5. Use Obsidian wiki-link syntax (`[[Projects/ProjectName]]`) to cross-link new notes to the project note. Keep every note concise — decisions and state, not a transcript.
6. Skip anything that's just normal code already visible in git history — only capture what isn't obvious from the diff.
7. Report a short list of what you wrote or updated, with file paths.
