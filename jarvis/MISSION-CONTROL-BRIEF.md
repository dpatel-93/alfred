# Alfred Mission Control — Execution-Bridge Build Brief (v2: terminal proxy + wake word)

Run this yourself from the repo root:
`claude "$(Get-Content -Raw jarvis/MISSION-CONTROL-BRIEF.md)"`
It builds browser-triggered command execution, so it is deliberately user-commissioned.
Security hardening is non-negotiable and comes FIRST.

## Security foundation (build FIRST, before any feature)
- Server binds 127.0.0.1 explicitly (never 0.0.0.0).
- At boot, generate a session token (crypto.randomUUID); template-inject into served
  ui.html. EVERY mutating endpoint (terminal input, chat, launch, kill) requires header
  `X-Alfred-Token` — the custom header forces CORS preflight, killing cross-origin
  drive-by POSTs from random webpages. Verify Origin when present; reject non-loopback
  remoteAddress. GET observe endpoints unchanged.
- Spawns: child_process.spawn, args arrays, shell:false wherever a distinct binary is
  launched. The terminal proxy is the one deliberate exception (it IS a shell) — its
  input goes only to the shell's stdin pipe, never string-concatenated into a command.

## Feature 1 — TERMINAL PROXY (the centerpiece)
The CEO's design: when Alfred's server boots, it spawns ONE persistent hidden shell
(pwsh.exe -NoLogo -NoExit; fallback cmd.exe), cwd = C:\Users\dishi. The browser UI's
"CLAUDE TERMINAL" panel is that shell's face — you type there, never in a real window.
- Server: keep the shell child alive for the server's lifetime; restart it if it dies
  (log restarts). POST /api/terminal/input {line} (token-gated) writes line + newline
  to shell stdin. Ring-buffer the last ~2000 lines of merged stdout/stderr;
  GET /api/terminal/output?after=N returns increments (UI polls ~700ms while the
  panel is focused, 3s otherwise).
- UI: the CLAUDE TERMINAL panel becomes live: scrollback area (textContent-safe,
  monospace, autoscroll unless user scrolled up) + an input line. Enter sends. Basic
  ANSI escape stripping on display (v1: strip, don't render, colors).
- HONEST LIMITATION (state it in the panel's help line): this is a line-based pipe,
  not a PTY — full-screen TUIs (including Claude Code's interactive UI) won't render
  here in v1. That's what Feature 2 solves for Claude specifically. (v2 stretch goal,
  only with explicit approval during the build: node-pty + vendored xterm.js for true
  ConPTY fidelity — a native npm dependency, ask the CEO first.)

## Feature 2 — WAKE WORD: "Alfred, wake up"
Typed in the terminal panel or search bar, OR spoken via the existing voice input:
match /\b(alfred[,!]?\s+wake\s+up|wake\s+up[,!]?\s+alfred)\b/i on transcripts and
typed lines.
- On wake: start the CEO Claude session — NOT by typing `claude` into the piped shell
  (interactive TUI won't survive a pipe); instead start the headless session-chained
  chat: spawn `claude -p "<first message>" --output-format stream-json` (capture
  session_id; later messages add `--resume <sessionId>`), cwd = C:\Users\dishi (the
  home folder is already trusted, so no trust prompt appears; do NOT pass permission-
  bypass flags — the default auto mode is the CEO's standing configuration).
- After wake, the terminal panel switches to CHAT MODE (badge: "ALFRED // CLAUDE
  ONLINE"): input lines go to the Claude session, assistant replies + one-line tool
  summaries render in the scrollback, and Alfred SPEAKS a short ack on wake ("At your
  service, sir.") via the existing /api/tts. `\quit` or "Alfred, stand down" returns
  the panel to raw shell mode. `\term` shows raw shell, `\claude` returns to chat.
- "OPEN IN TERMINAL" button while in chat mode: spawn a VISIBLE terminal
  (wt, fallback cmd /c start) running `claude --resume <sessionId>` — same session,
  full TUI, for when the browser panel isn't enough.
- Model: opus default. NEVER fable unless the CEO explicitly picks it (standing gate).

## Feature 3 — AGENT LAUNCH (org-chart integration)
POST /api/agents/launch {prompt, model} (token-gated) → `claude -p --model
<haiku|sonnet|opus> --output-format stream-json` one-shots, cwd home. Track
{id,pid,status,events(last 200)}; GET /api/agents; GET /api/agents/<id>/output;
POST /api/agents/<id>/kill (execFile taskkill /T /F). Launched agents appear in the
org chart under their tier, green while running, edge from the CEO chat session when
one is active. Command-bar shorthand from chat mode: "@haiku <task>" etc.

## Feature 4 — OLLAMA quick actions
Interns lane panel: per-model buttons + prompt input → `node
~/.claude/helpers/intern-run.mjs <model> "<prompt>"` (ledger-logged), output to panel.

## Feature 5 — friendly URL
Also listen on 127.0.0.1:80 (same handler; skip silently on EACCES/EADDRINUSE).
`Add-AlfredHostname.ps1`: elevation-checked script appending `127.0.0.1  alfred` to
the hosts file. Result: http://alfred/ (port 80) or http://alfred:7777.

## Tests (must actually run)
- Token enforcement: mutating endpoints 403 without header, work with it.
- Terminal: `git --version` round-trips through the pipe; shell survives an
  intentionally bad command; restart-on-death works (kill the shell pid, verify respawn).
- Wake word: typed "Alfred wake up" flips to chat mode, first message returns, second
  message proves --resume context retention; "Alfred stand down" returns to shell.
- One @haiku launch completes; a second killed mid-run; both visible in /api/org.
- node --check on ui.html script block; regression: /api/graph, /api/search,
  /api/note traversal guard, /api/tts all still pass.
