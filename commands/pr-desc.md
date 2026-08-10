---
description: Write a small, focused PR description for the current branch's diff against its base branch.
---

Branch info:

!`git branch --show-current`

Base comparison:

!`git log --oneline $(git merge-base HEAD origin/master 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null)..HEAD 2>/dev/null`

Full diff:

!`git diff $(git merge-base HEAD origin/master 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null)...HEAD 2>/dev/null`

1. Read every commit and the full diff above — not just the latest commit.
2. Write a PR description with:
   - A title under 70 characters
   - A short **Summary** (1-3 bullets) describing what changed and why, not a restatement of file names
   - A **Test plan** as a markdown checklist of what should be verified before merge
3. Keep it small and to the point — this is a focused PR, not a release note. Skip sections that don't apply (no test plan items if the change is docs-only, etc).
4. Output the description in a fenced block ready to paste into `gh pr create --body`. Do not create the PR yourself unless explicitly asked — the operator reviews before merge, standing workflow.
