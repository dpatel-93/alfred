---
name: vault-recall
description: Semantic search over the Alfred Brain (plain-markdown OneDrive folder) using local nomic-embed-text embeddings — associative recall instead of filename guessing. Use at the start of any task that might touch prior knowledge ("what do we know about X", past decisions, patterns, project history), before re-deriving anything, or when a vault note's location isn't obvious. Free (runs on local Ollama), so use liberally.
---

# Vault Recall — ask the brain before re-deriving

First, read `~/.claude/alfred-profile.md`'s "Framework paths" section for two values:

- **Alfred repo location** — where the `brain/query.mjs` and `brain/index-vault.mjs` scripts
  this skill calls actually live. The installer copies `agents/skills/commands/helpers` into
  `~/.claude`, but deliberately leaves `brain/` (a full Node app with its own `node_modules`) in
  the repo checkout, so this path is instance-specific.
- **Knowledge vault path** — the markdown folder this skill searches. If unset, say so plainly
  ("no vault configured in alfred-profile.md — skipping recall") and move on; this is an
  optional capability, not a required one.

If either is unset, do not guess a path — report the gap and continue without vault recall.

This skill queries the vault by MEANING (768-dim nomic-embed vectors over every note), not by
filename.

## Query

```bash
node "<Alfred repo location>/brain/query.mjs" "your question" --k 8
```

Add `--json` for structured output. Results: score | folder/title | excerpt | path.
Then Read the top hit(s) directly — the excerpt is a teaser, not the content.

## Refresh the index

The index (`brain/index.json`) updates incrementally — only new/modified notes
get re-embedded:

```bash
node "<Alfred repo location>/brain/index-vault.mjs"
```

Run it when query.mjs warns the index is stale, or after a session that wrote
multiple vault notes (e.g. after /harvest).

## Rules

- Prefer this over Glob/Grep for "do we already know…" questions — it finds
  notes regardless of naming.
- Requires Ollama running locally (`ollama serve`, usually auto on Windows).
  If Ollama is down, fall back to Grep over the vault.
- The visual layer for the same index is the Alfred HUD: `brain/Alfred.cmd` on Windows
  (localhost:7777), run from the Alfred repo location.
