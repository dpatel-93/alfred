---
name: "Worktree Orchestrator"
description: "Spawn parallel Claude Code subagents in isolated git worktrees so they edit the same repo concurrently without merge collisions. Use when running multi-file refactors, parallel feature work, or any swarm where 2+ agents will write to overlapping files. Requires git repo. Falls back gracefully for non-git directories."
---

# Worktree Orchestrator

## What this skill does

Coordinates parallel Task subagents using **native Claude Code worktree isolation**
(`isolation: "worktree"` in the Task tool). Each subagent gets its own ephemeral
git worktree on a throwaway branch, edits in isolation, and returns its branch
+ change summary so the parent can review and merge.

Replaces the old "lock the file, queue the writes" coordination pattern with
git's native conflict resolution — which is what git was built for.

## When to use

- Refactor spanning many files (rename a function across modules)
- Parallel feature work (auth + billing + notifications, all editing different parts)
- Swarm coordination where >1 agent might touch the same file
- Anything where you'd otherwise spawn agents serially "to avoid conflicts"

## When NOT to use

- Single-file edits (overhead isn't worth it)
- Read-only research (no need to isolate)
- Non-git directories (worktree falls back to no-op; use plain Task instead)
- Operations that need shared in-memory state across agents

## Quick Start

```
# Spawn 3 agents in parallel — each in its own worktree, all backgrounded
Task(subagent_type: "coder",     isolation: "worktree", run_in_background: true,
     prompt: "implement /auth route in src/api/auth.ts ...")
Task(subagent_type: "coder",     isolation: "worktree", run_in_background: true,
     prompt: "implement /billing route in src/api/billing.ts ...")
Task(subagent_type: "tester",    isolation: "worktree", run_in_background: true,
     prompt: "add integration tests for /auth and /billing ...")
```

All three start immediately. None block each other. Each returns
`{branch: "claude/agent-xxx", path: "/tmp/worktree-xxx", changed_files: [...]}`.

## Merge strategy (parent's job)

```bash
# 1. Review each branch
for b in $(git branch --list "claude/agent-*"); do
  git diff master..$b --stat
done

# 2. Merge in dependency order (or fan-out if independent)
git checkout master
git merge --no-ff claude/agent-auth-001
git merge --no-ff claude/agent-billing-001
git merge --no-ff claude/agent-tests-001

# 3. Clean up
git worktree prune
git branch --list "claude/agent-*" | xargs -r git branch -D
```

## Conflict handling

- Merge conflicts are resolved by the parent agent, NOT by workers
- If two workers edit the same line, the parent picks the winner or asks the user
- Hard conflicts (binary files, lockfiles) → escalate to user

## Coordinator agent integration

The hierarchical, mesh, and adaptive coordinators have all been updated (Apr 2026)
to default to `isolation: "worktree"` + `run_in_background: true`. This skill
documents the underlying pattern they emit.

## Reference

- Anthropic Claude Code Task tool — `isolation` parameter
- Git worktree docs: https://git-scm.com/docs/git-worktree
- Pattern published in Alfred Decisions log (2026-04-16)
