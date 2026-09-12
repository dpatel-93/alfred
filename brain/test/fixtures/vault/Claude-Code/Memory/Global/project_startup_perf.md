---
name: project_startup_perf
description: Claude Code startup was slow due to 5 sequential SessionStart hooks; fixed by backgrounding the 2 genuinely slow ones via bg-run.mjs
metadata: 
  node_type: memory
  type: project
  originSessionId: d2364c48-cb38-45d5-8e3a-284b99c8b619
  modified: 2026-08-17T14:02:07.339Z
---

Diagnosed on 2026-08-17: Claude Code startup on this machine (dishi's desktop) took 37-67 sec because `~/.claude/settings.json`'s `SessionStart` hooks ran 5 scripts sequentially and blocking: alfred-sync.mjs pull (17-47s, dominant cost), project-note-check.mjs (8.7s), vault-memory-sync.cjs pull (4.5s), auto-memory-hook.mjs import (3.8s), config-doctor.mjs (2.6s).

**Not** a Claude/Anthropic outage and **not** the TTS/speak layer (`alfred-speak.mjs` only runs on the `Stop` hook, not `SessionStart` — never in the startup critical path).

**Root causes found:**
1. Alfred repo + knowledge vault both live under `OneDrive\Desktop\_Projects\`. `alfred-sync.mjs pull` does a live `git pull` plus a full recursive file-timestamp-comparison walk of that repo on every single startup.
2. **This machine pays a ~2.5-6 sec tax on every single new `node.exe` process creation** (measured directly, reproducible, consistent across `spawn()`, `cmd /c start /b`, and direct invocation) — almost certainly Windows Defender/MpDefenderCoreService real-time-scanning each new process image. This tax is already baked into every hook's measured runtime; it is not new overhead added by any fix. It means: don't add an *extra* process spawn as a "background wrapper" unless the work you're deferring is worth more than ~5-6s (paying the tax twice), or it makes things worse.

**Fix applied:** created `~/.claude/helpers/bg-run.mjs` — a detached-child launcher (`spawn(..., {detached:true, stdio:[file log], unref})` then `process.exit(0)`) — and wrapped ONLY `alfred-sync.mjs pull` and `project-note-check.mjs` (the two whose real work vastly exceeds the double-spawn tax) through it in `settings.json`. Left `vault-memory-sync.cjs`, `auto-memory-hook.mjs`, `config-doctor.mjs` as direct synchronous calls — their own runtime is already close to or below the ~5s wrapper overhead, so wrapping them would net negative.

Result: blocking startup dropped to ~21 sec flat, and — more importantly — it's now decoupled from network/OneDrive conditions (previously a slow GitHub connection or OneDrive hiccup could push startup past a minute; now those two hooks always return in ~5-6s regardless, with the real work finishing later in the background).

Side effect accepted by the user: output from the two backgrounded hooks (the cyan/green sync status lines) no longer prints live at session start — it goes to `.claude/logs/alfred-sync.log` and `.claude/logs/project-note-check.log` instead, since nothing is left waiting to display it.

**Why this matters for future work on this machine:** any future "why is X slow" investigation involving new process spawns (node, git, etc.) should account for the ~2.5-6s per-spawn AV tax as a baseline floor before assuming the script's own logic is the problem. See [[project_alfred]] for the broader framework this sits in.
