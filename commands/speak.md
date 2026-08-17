---
description: Control Claude Code talk-back (spoken answers). Usage: /speak on|off|status|test|list|voice <name>|rate <n>
---

Control the talk-back speaker, which reads my final answer of each turn aloud
through a neural voice (Edge TTS), falling back to the platform's built-in
speech engine if that is unavailable.

Run exactly one command via Bash or PowerShell, matching the user's argument
`$ARGUMENTS` (default to `status` if empty), then report the result in one line:

```
node "$HOME/.claude/helpers/alfred-speak.mjs" $ARGUMENTS
```

Valid arguments: `on`, `off`, `status`, `list`, `test`, `dry`,
`voice "<name>"`, `rate <-10..10>`, `install`, `uninstall`.

Notes:
- `off` and `on` persist across sessions; nothing needs restarting.
- `list` shows the installed voice names; pass one verbatim to `voice`.
- `rate` is speaking speed on a -10..10 scale: 0 is normal, higher is faster.
  It means the same thing on Windows and macOS, so the setting is portable even
  though the underlying engines are not.
- `dry` prints what the last answer would have sounded like without speaking it,
  which is the right tool if the user says the speech sounded wrong.
- If `status` reports the launcher is NOT INSTALLED, run `install` and say so.
  That only ever applies on Windows; macOS speaks through the built-in `say`
  and has nothing to register.
- Settings are per-machine on purpose — the sync never copies this config, so
  the Mac and the PC each keep their own voice.

Do not edit the config file by hand; the CLI is the interface.
