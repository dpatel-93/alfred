# alfred repo

This repo is the portable, installable snapshot of Dishi's live setup — **Alfred**,
one system with two halves: the brain layer (`brain/` dir — semantic search, HUD
UI, voice) and the native Claude Code orchestration framework (agents/skills/
commands/helpers). Branding is Alfred everywhere (2026-08-08 decision — the earlier
Jarvis/Alfred split is retired). The live setup (`~/.claude` + home `CLAUDE.md` +
the running server) is the source of truth; this repo tracks it.
GitHub: `dpatel-93/alfred` (private; old claude-flow-era repo archived as
`alfred-v3-archive`).

## First-time setup — a new user asking to install Alfred

If the person you're talking to asks you to install, set up, or get started with Alfred in
this repo — "install this," "set this up for me," "how do I use Alfred" — **stop and run the
onboarding conversation in `ONBOARDING.md` before touching `install.ps1` or `install.sh`.**
Do not run the installer first and ask questions after; the installer's job is purely
mechanical (copy files, rewrite paths) and the onboarding conversation is what makes the
result actually belong to the person running it instead of arriving pre-loaded with a
stranger's identity, learning-level calibration, and side-project examples.

This applies whether the person opened the CLI or an IDE extension — both read this file the
same way, so this instruction reaches either surface. It applies on a fresh machine even if
the person is Dishi himself: the profile step is cheap, and skipping it because "it's probably
me" is exactly the kind of unverified assumption this framework's own incident history argues
against.

Rules for working in this repo:
- After meaningful changes to `~/.claude` (new skills/commands/agents, hook or
  helper edits, CLAUDE.md updates), re-sync: copy the changed artifacts here,
  commit with a one-line message, push to remote (master branch).
- Never commit secrets: no `.credentials.json`, no `settings.local.json`, no
  `.claude.json`, no tokens. `settings/settings.reference.json` must stay free of
  machine-secrets (it currently is — keep it that way).
- `install.ps1` must stay idempotent and merge-only (never delete on target).
- Edits over rebuilds — this framework grows by editing existing artifacts.
