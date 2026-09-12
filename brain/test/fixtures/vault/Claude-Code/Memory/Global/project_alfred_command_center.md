---
name: project_alfred_command_center
description: "Alfred Command Center's true purpose is a provider-agnostic AI workstation — one window for all AI work across any backend, with the Alfred skill/agent/brain framework applying uniformly regardless of which provider is driving"
metadata: 
  node_type: memory
  type: project
  originSessionId: 799a0310-95a7-45ac-99f2-72165ca2ebb2
  modified: 2026-09-12T18:30:24.595Z
---

The Command Center (`brain/server.mjs` + `brain/ui.html` in [[project_alfred]]'s repo, `C:\dev\alfred`) is being redesigned as a single-window AI workstation, not just a terminal multiplexer with a nicer UI.

**Why (operator's own framing, 2026-09-12):** "what we're trying to do here is evolve alfred into a ai workstation that we work out of ... have our workflow and skills and agent framework apply anywhere our brain applies to all etc." The original implementation (terminal-per-provider lanes, council, roster/library views) was a good foundation, but the actual goal is broader: work out of *any* AI provider (Claude, GPT/Codex, Gemini, Grok, local Ollama) from one place, with Alfred's skills, workflows, and agent-org framework and the Brain (vault/notes) available and consistent no matter which provider/CLI is currently driving — not Claude-specific tooling with other providers bolted on as terminal lanes.

**How to apply:** when designing or implementing any Command Center feature (command palette, GitHub Scout, Brain save-to actions, skill/agent invocation, etc.), the bar is "does this work the same way regardless of which provider seat is focused" — not "does this work for Claude." Skills currently live as a Claude Code concept (`~/.claude/skills`); the open design question this reframing raises is how the same skill/workflow surface extends to non-Claude seats (Gemini, Grok, Codex, Ollama) rather than staying Claude-only. Surface this tension explicitly in future phase planning (especially the command palette and any skill-invocation UI) rather than silently building Claude-only affordances.

Full phased implementation plan (8 phases, grounded in actual code line numbers) lives at the scratchpad path used during the 2026-09-12 planning session — see session history; re-derive if stale rather than trusting old line numbers.
