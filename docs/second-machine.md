# Running Alfred on a second machine

Written 2026-08-16, when a Mac joined a setup that had only ever run on Windows.

## The rule that matters most: one machine at a time

**Do not do the same work on both machines in parallel and merge later.** The artifact sync
(`alfred-sync.mjs`, SessionStart pull / SessionEnd push) is **newest-wins per file, not a merge**.
If both machines edit `helpers/alfred-speak.mjs`, the second one to sync silently overwrites the
first. Git would give you a conflict to resolve; the sync will not — it will just quietly pick one.

So: finish a change on one machine, push, pull on the other, continue there. Parallel work is safe
only when the two machines are touching genuinely different files, and it is rarely worth the risk
of finding out you were wrong about that.

`vault-memory-sync.cjs` is gentler — it merges `MEMORY.md` section by section and never deletes,
keeping a losing edit beside the winner rather than discarding it. Notes and memories are therefore
safer to write from both machines than code is.

## First run on the new machine

```bash
git clone <repo>           # or pull, if it is already there
./install.sh               # merge-only; it never deletes on the target
cd ~/.claude/helpers && npm install
```

That last line is the one that is easy to miss. `node_modules` is git-ignored, so the neural voice
dependency is **not** in the repo. Without it talk-back still works — it falls back to the built-in
system voice — which means the symptom is "it sounds wrong", not "it is broken".

## Verify the voice

```bash
node ~/.claude/helpers/alfred-speak.mjs status
node ~/.claude/helpers/alfred-speak.mjs test
```

`status` reports `neural: ready (en-GB-RyanNeural)` or tells you exactly what is missing.

If `test` sounds robotic, the neural path failed and fell back. Read the receipt:

```bash
cat ~/.claude/helpers/.alfred-speak-last.json
```

It records which engine actually spoke and why the preferred one did not. That file exists because
a fallback **sounds like a working speaker with the wrong voice** — no error, nothing in a log,
nothing to notice. It was caught by ear once; it should not have to be again.

## What differs between the two platforms

| | Windows | macOS |
|---|---|---|
| Launching the speaker | A Task Scheduler task. A child of the Stop hook dies when the hook exits ~80ms in, so it needs a parent that outlives it. | Nothing. An orphaned process is re-parented to `init` and keeps running, so `detached` is enough. |
| Playing the audio | `System.Windows.Media.MediaPlayer` | `afplay`, which ships with the OS |
| Fallback voice | SAPI 5 (Zira, David) | `say` |
| `speak install` | Registers the scheduled task | Prints "nothing to install" — correctly |

`settings.json` is **never** synced between machines: it holds absolute paths, and copying it
across breaks every hook on the receiving side. Each machine keeps its own.

Per-machine runtime state is excluded for the same reason — the voice config, the greeting's
"have we met" flag, the speech queue. A file rewritten on every greeting that syncs to the other
machine produces a commit and a push per greeting; that happened, five times in one afternoon,
before it was caught.

## Known-good state as of 2026-08-16

- Voice: `en-GB-RyanNeural` via Edge Neural, both platforms, system voice as automatic fallback.
- Talk-back speaks the lead paragraph only; `full` restores whole-answer reading.
- The HUD greets on entry with a spoken status briefing.
- macOS-specific fixes already in: the vault behind a symlink no longer 403s every note, and
  `resolveClaudeBin` no longer probes only for `claude.exe`.
