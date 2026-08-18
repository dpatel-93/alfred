# alfred repo

This repo is the portable, installable snapshot of Dishi's live setup — **Alfred**,
one system with two halves: the vault brain (`jarvis/` dir — semantic search, HUD
UI, voice) and the native Claude Code orchestration framework (agents/skills/
commands/helpers). Branding is Alfred everywhere (2026-08-08 decision — the earlier
Jarvis/Alfred split is retired). The live setup (`~/.claude` + home `CLAUDE.md` +
the running server) is the source of truth; this repo tracks it.
GitHub: `dpatel-93/alfred` (private; old claude-flow-era repo archived as
`alfred-v3-archive`).

Rules for working in this repo:
- After meaningful changes to `~/.claude` (new skills/commands/agents, hook or
  helper edits, CLAUDE.md updates), re-sync: copy the changed artifacts here,
  commit with a one-line message, push to remote (master branch).
- Never commit secrets: no `.credentials.json`, no `settings.local.json`, no
  `.claude.json`, no tokens. `settings/settings.reference.json` must stay free of
  machine-secrets (it currently is — keep it that way).
- `install.ps1` must stay idempotent and merge-only (never delete on target).
- Edits over rebuilds — this framework grows by editing existing artifacts.
