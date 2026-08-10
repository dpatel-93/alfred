---
description: One-screen status — current repo/branch/changes, running background tasks, and vault note freshness for this project.
---

Repo state:

!`git status -sb 2>&1`

Recent commits:

!`git log --oneline -5 2>&1`

1. Summarize the git output above: branch, ahead/behind remote, staged/unstaged/untracked file counts — don't dump the raw output back.
2. List any background tasks or agents you or a previous turn started that are still running (check via TaskList if the task system is in use this session).
3. Identify this project's vault note at `Projects/<ProjectName>.md` under the vault root from the knowledge vault path in `~/.claude/alfred-profile.md` (skip this step if none is configured) (infer the name from the repo/folder). Report whether it exists, and if so, how stale it looks relative to the latest commit date — flag it if the note's "Current State" clearly predates recent commits.
4. Present all of this as a compact status block, not prose paragraphs: repo line, changes line, background tasks line, vault freshness line.
