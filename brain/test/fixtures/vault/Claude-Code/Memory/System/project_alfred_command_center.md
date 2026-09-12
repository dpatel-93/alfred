---
name: alfred-command-center
description: "Alfred HUD \"Command Center\" tab + council mode (2026-09-11) — one app for Claude/Gemini/Grok/Codex/Ollama/dsh; subscription-only auth; real PTY browser consoles (node-pty+xterm+ws), native wt.exe as escape hatch; README documented and pushed"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8e7696ba-b38c-4b66-94ec-ff3a4768bb07
  modified: 2026-09-11T20:29:39.143Z
---

The Alfred HUD (C:\dev\alfred\brain, localhost:7777) has a **Command Center** tab: "Open Terminals" launches one
Windows Terminal window with a pane per signed-in AI CLI, and "Ask the Council" fans one question out to every
ticked seat in parallel (helpers/council-run.mjs) with Claude chairing a verdict. Shipped 2026-09-11.

**Why:** the operator wants ONE app that holds every AI (Claude, Gemini, Grok, Codex, Ollama, DeepSeek Harness) —
flick between them, or ask all together ("council mode"). Decision history matters here: the codebase once removed a
line-based fake terminal ("observe surface, not a do surface"); first pass used native `wt.exe` panes; then the
operator chose **real PTY-backed browser terminals** (node-pty + xterm.js + ws) because the Harness has no TUI and
they want a custom client housing every CLI "without losing functionality". Native window stays as an escape hatch.

**How to apply:**
- Keep auth on **subscriptions, never metered API keys**: Claude = Claude Code login; Grok = SuperGrok/X Premium+
  via `grok` (installed, signed in); Gemini = Antigravity CLI `agy` on a Google AI Pro/Ultra sub (installed, operator
  still has to run `agy` once to sign in); Codex = ChatGPT Plus/Pro login (`@openai/codex` installed, `codex login`
  done); Ollama = fifth seat, free/local. AI Studio seat was tried and DROPPED: Google AI Pro does not include
  API credits, so a key would be a separate metered bill — do not re-suggest it.
- Model choice is per seat from the HUD (persisted in `~/.alfred/config.json`); registry defaults are the cheap
  tier on purpose. Operator's words: "fable won't be the immediate default given cost" — never make Fable/Opus a
  default anywhere; offer them as a per-seat choice.
- Hardware: RTX 5090 32 GB, 9950X, 126 GB RAM. Operator wants serious local models ("no more crappy intern
  models"). Pulled 2026-09-11: qwen3.8:27b (Ollama seat default), qwen3-embedding:8b, gpt-oss:20b. The 32 GB wall:
  Kimi/DeepSeek-full/Hermes-70B/gpt-oss-120b don't fit — don't re-pitch them without a second GPU.
- DeepSeek Harness (`dsh`) is installed and pointed at local Ollama (~/.dsh/settings.yaml); operator liked "dsh
  pulling on qwen or gpt locally". It is the sixth seat. Model for it is set in settings.yaml, not per call.
- Embedder switch (nomic → qwen3-embedding) is a pending A/B via brain/retrieval-eval.mjs, not a config flip.
- New seats are a data edit in `~/.claude/helpers/providers.json` (transport `cli` = council seat), no code change.
- Council output for grok is "lead, not fact" per the registry's outputContract — the synthesis prompt enforces it.
- The HUD server autostarts via `shell:startup\AlfredBrain.vbs` (no-admin path; Task Scheduler needed elevation).
  Restart after server.mjs edits: `taskkill` the `node server.mjs` on :7777, then `wscript.exe` that .vbs.
- Hook gotcha fixed this session: never prefix hook commands with `cmd /c` — Claude Code already runs hooks via
  Git Bash, and MSYS path-mangling turns `/c` into `C:\`, which drops cmd.exe into an interactive shell that
  echoes the hook's JSON. Plain `node <script>` is correct.
- The framework sync hook (`alfred-sync.mjs push`) auto-commits + pushes repo changes as "Sync N framework
  artifact(s)" — write the descriptive commit BEFORE the turn ends, or it gets swept up under a generic message.
