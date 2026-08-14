---
name: async-supervisor
description: "Run long subagents in the background and reattach when they complete. Use for tasks that take more than ~30 seconds (test suites, large refactors, multi-step research) so the parent agent stays responsive instead of blocking. Pairs with run_in_background and the Monitor tool."
---

# Async Supervisor

## What this skill does

Documents the **fire-and-await** pattern for Claude Code subagents. The parent
agent spawns one or more workers with `run_in_background: true`, continues
useful work (planning, evaluating prior outputs, writing the PR description),
and is automatically notified when each worker completes — no polling, no
sleep loops.

Replaces the old "spawn, then loop checking status every N seconds" pattern,
which burns the prompt cache and wastes parent-agent context.

## When to use

- Long-running test suites (>30s)
- Multi-file refactors via spawned workers
- Background research the parent doesn't need immediately
- Any time you'd otherwise write a `sleep + check_status` loop

## When NOT to use

- Tasks under ~10 seconds (overhead exceeds savings)
- Tasks whose result you need on the very next tool call (use foreground)
- Single read-only questions (just answer them)

## Pattern

```
# Step 1 — spawn (single message, all backgrounded)
Task(subagent_type: "tester", run_in_background: true,
     prompt: "run full test suite, report failures with stack traces")
Task(subagent_type: "reviewer", run_in_background: true,
     prompt: "static analysis on src/api/**, flag OWASP issues")

# Step 2 — do other useful work while workers run
#  (write commit message, plan next step, draft PR body)

# Step 3 — workers complete; you receive a notification automatically
# Do NOT poll. Do NOT sleep. Do NOT call TaskOutput repeatedly.
```

## Cache-aware design

Each `sleep` between status checks crosses the 5-minute prompt-cache TTL,
which is the primary cost of long sessions. Backgrounded subagents avoid this
entirely because the parent isn't re-running.

If you genuinely need to wait for an external event (build finishing, deploy
turning green), use the `Monitor` tool with an `until` loop instead — it gets a
single notification on the matching event rather than polling.

## Anti-patterns

- `for i in $(seq 1 30); do check_status; sleep 30; done` — burns cache
- Calling `TaskOutput` repeatedly to "see if it's done yet" — same problem
- Spawning workers in separate messages — they run serially, not parallel
- Running short tasks in the background — adds wakeup overhead with no benefit

## Coordinator integration

All swarm coordinators (hierarchical, mesh, adaptive) have been updated to
default `run_in_background: true` for spawned workers. This skill documents the
parent-side rules.

## Reference

- Anthropic Claude Code Task tool — `run_in_background` parameter
- Anthropic prompt-caching docs (5-minute TTL)
- Alfred CLAUDE.md "Swarm Execution Rules"
