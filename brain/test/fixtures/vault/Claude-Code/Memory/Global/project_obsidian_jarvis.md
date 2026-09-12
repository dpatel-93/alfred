---
name: obsidian-jarvis-brain
description: "The Alfred Brain — central, machine-independent, self-evolving memory as a plain-markdown OneDrive folder. Obsidian and Claudian RETIRED 2026-08-08; the whole system is \"the Alfred Framework.\""
metadata: 
  node_type: memory
  type: project
  originSessionId: 8455ca54-06de-4239-8a96-18ed0da22951
  modified: 2026-08-08T03:46:03.172Z
---

**The Alfred Framework** (2026-08-08 decision — supersedes all earlier Obsidian/Jarvis framings): one system with four parts — interactive HUD UI (localhost:7777), voice (Kokoro local TTS + speech recognition), the **brain**, and the Claude Code orchestration layer. Repo: `dpatel-93/alfred`.

**The brain** is a plain-markdown folder synced via OneDrive — currently `C:\Users\dishi\OneDrive\Desktop\_Projects\DP_Obsidian_Vault`, being renamed to `_Projects\Alfred-Brain`. It is central evolving memory that outlives any machine/session: Projects/, Patterns/, Decisions/, Learning/, Claude-Code/ (Evolution-Log), Templates/.

**Obsidian and Claudian are RETIRED** — no app dependency. The brain is files + local embeddings + a server we own. Hand-edits happen in any editor (VS Code). The obsidian-launch SessionStart hook was removed; memory-sync hooks remain (plain file writes, app-independent). Semantic recall via the `vault-recall` skill (query.mjs against the brain index).

**Division of labor:** brain folder = machine-independent knowledge (OneDrive-synced); `dpatel-93/alfred` repo = per-machine install of the framework (install.ps1). On any new machine: clone repo, install, point ALFRED_VAULT at the OneDrive brain folder.

See brain note `Decisions/2026-08-08 -- Retire Obsidian, Unify as Alfred Framework`. Related: [[project_alfred]], [[user-org-chart-model-routing]]
