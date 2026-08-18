# The Alfred Framework

**Alfred** is one framework, four parts: an interactive HUD (graph + search),
voice (speech in, speech out), a **brain** (a plain-markdown folder of your
own notes), and a Claude Code orchestration layer that routes agent work down
a model-tiered org chart. One name, one system — not a separate front-of-house
assistant and a separate back-of-house framework. Batman's butler, doing both.

The HUD/voice/brain code lives in `jarvis/` — a legacy directory name kept for
now; everything user-facing is branded Alfred.

## Architecture

```
                       THE BRAIN LAYER (jarvis/)
  ------------------------------------------------------------------
  your brain folder  (plain markdown files, synced however you like -
                       OneDrive, Dropbox, git, a bare local folder)
        |
        | walk + embed each note (local Ollama, nomic-embed-text)
        v
  index-vault.mjs  ---------------------------------->  index.json
        |                                                   |
        | (incremental: unchanged files are skipped)        | loaded by
        v                                                   v
  query.mjs  (CLI search, no server needed)           server.mjs :7777
                                                              |
                                          +-------------------+-------------------+
                                          |                   |                   |
                                  GET /api/*           POST /api/ask       POST /api/tts
                              (status/graph/search/  (voice-composed      (Kokoro local /
                               note)                   answer)             edge online)
                                          |                   |                   |
                                          v                   v                   v
                                   ui.html  --  the HUD: force-directed graph,
                                                 search bar, note panel, mic/voice


                CLAUDE CODE LAYER  (everything else in this repo)
  ------------------------------------------------------------------
  CLAUDE.md   (the constitution: who you are, how we work, hard rules)
        |
        v
  agents/     (model-tiered: Fable -> Opus -> Sonnet -> Haiku -> local Ollama)
        |
        v
  skills/     (loaded on demand: vault-recall, evolve, ollama-interns, ...)
        |
        v
  commands/   (slash-command prompt library: /fanout, /review-loop, /harvest, ...)
        |
        v
  hooks/ + helpers/   (session capture, memory sync, intern usage logging)
```

The two layers don't depend on each other to run — the HUD works with zero
Claude Code config installed, and the orchestration framework works with zero
brain indexed. Together, Alfred's agents can call the `vault-recall` skill to
query the same index directly instead of guessing filenames.

## Prerequisites

- **Windows 11**, Node.js 20+, git
- **[Ollama](https://ollama.com)**, running locally, with:
  ```
  ollama pull nomic-embed-text
  ollama pull qwen2.5:1.5b-instruct
  ```
  `nomic-embed-text` powers search (required). `qwen2.5:1.5b-instruct` is the
  default voice/ask model — it fits fully in 8GB of VRAM alongside the embedder,
  so spoken answers come back in a few seconds. Optionally also
  `ollama pull qwen3.5:4b` for noticeably better answer quality at the cost of
  10-60+ seconds per answer (`ALFRED_ASK_MODEL=qwen3.5:4b` to switch).
- **`npm install` inside `jarvis/`** — the HUD/index/server code itself has no
  dependencies, but voice *output* does: `kokoro-js` (local text-to-speech)
  and `msedge-tts` (online fallback). `server.mjs` imports both unconditionally,
  so skipping this step means the server won't start at all, not just voice.
- **Claude Code** — the CLI, or the VS Code extension. Either reads `~/.claude/`.
- **Microsoft Edge** helps but isn't required for voice. Spoken answers come
  from the server (`/api/tts`: Kokoro-82M running locally, or Microsoft's
  online voices as a fallback) — Edge only matters as a last-resort browser
  fallback if `/api/tts` itself is unreachable, where it ships noticeably
  better free neural voices than Chrome/Firefox's system TTS. Voice *input*
  (the mic button) needs `webkitSpeechRecognition`/`SpeechRecognition`, which
  is Chrome/Edge only — other browsers just hide the mic button and everything
  else still works.
- **Any markdown editor works for hand-editing brain notes** — VS Code,
  Obsidian, Notepad, whatever you like. The brain is just a folder of `.md`
  files; Alfred doesn't call any editor's API or require one to be installed.

## Quickstart

```powershell
# 1. Clone (ask Dishi for repo access - it's private)
git clone https://github.com/dpatel-93/alfred.git alfred
cd alfred

# 2. Install the Claude Code layer into ~/.claude
.\install.ps1              # preview first with: .\install.ps1 -DryRun

# 3. Install the HUD/voice server's own dependencies
cd jarvis
npm install
cd ..
```

`install.ps1` is idempotent and merge-only: it backs up anything it's about to
touch under `~/.claude/backups/`, copies `agents/`, `skills/`, `commands/`, and
`helpers/` into `~/.claude/` (merging, never deleting your own files), and
installs the two `CLAUDE.md` files. If you already have a `~/.claude/settings.json`,
it writes a `settings.merged-proposal.json` next to it instead of overwriting —
merge the hooks/permissions you want by hand.

```powershell
# 4. Point Alfred at your notes (skip this to use Dishi's default brain path)
$env:ALFRED_VAULT = "C:\Users\you\Notes"

# 5. Build the search index (first run embeds everything; reruns are incremental)
node jarvis\index-vault.mjs

# 6. Launch
jarvis\Alfred.cmd
```

That starts the server in the background and opens `http://localhost:7777` in
your default browser. If you don't set `ALFRED_VAULT`, `index-vault.mjs` falls
back to Dishi's own brain folder — set it before step 5 or nothing will index
for you.

```powershell
# 7. Optional: make it start automatically at logon (pick one)

# Route A - needs an elevated (Run as Administrator) PowerShell:
powershell -ExecutionPolicy Bypass -File jarvis\Install-AlfredAutostart.ps1

# Route B - no admin rights needed, runs from your Startup folder instead:
powershell -ExecutionPolicy Bypass -File jarvis\Install-AlfredStartup.ps1
```

Both are idempotent and both take `-Uninstall` to remove themselves. If Route A
fails with "Access is denied" (Task Scheduler needs elevation it doesn't have),
it prints the Route B command for you automatically.

## Using Alfred

Everything happens from the search bar at the top of the HUD:

| Action | What it does |
|---|---|
| `Enter` | List search — top matches appear as a ranked results list |
| `Shift+Enter` | Ask — composes a 2-3 sentence spoken-style answer from your top notes and speaks it |
| Click the mic icon, or hold `Space` (when the search box isn't focused) | Voice input — talk, and it's transcribed into the search box and asked automatically |
| `Esc` | Stops speech playback if Alfred is talking, otherwise closes the open results/answer panel |
| Category buttons (top-left, under the status panel) | Filter the graph to one note folder at a time; click the active one again to clear |
| Click a node | Opens that note in the side panel, with its linked notes listed below |
| FX Sound toggle (status panel) | Mutes/unmutes the UI's interface bleeps only — spoken answers are unaffected; your choice is remembered |

### API reference

All endpoints are served by `server.mjs` on `http://localhost:7777` (or your
`PORT`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/status` | Note/link counts, index freshness, Ollama online/offline, session intern token count, TTS engine state |
| `GET` | `/api/graph` | Full node + link graph for rendering the HUD |
| `GET` | `/api/search?q=...` | Top-10 semantic matches for a query, with scores |
| `GET` | `/api/note?path=...` | Raw markdown for one note (path-traversal-guarded to the brain root) |
| `POST` | `/api/ask` `{"q": "..."}` | Top-5 semantic matches composed into a short spoken-style answer via a local Ollama model, plus `sources` |
| `POST` | `/api/tts` `{"text": "..."}` | Speech audio for the given text — WAV from local Kokoro, or MP3 from the online edge fallback, whichever engine answers |

### Config knobs (environment variables)

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `7777` | Server port |
| `ALFRED_VAULT` | Dishi's brain folder path | Folder of `.md` files to index — set this to your own notes folder. `JARVIS_VAULT` is still read as a fallback for one release. |
| `ALFRED_ASK_MODEL` | `qwen2.5:1.5b-instruct` | Ollama model used by `/api/ask`; try `qwen3.5:4b` for better answers if you have the VRAM and patience. `JARVIS_ASK_MODEL` is still read as a fallback for one release. |
| `ALFRED_TTS_MODE` | `local` | `local` (Kokoro, then edge as fallback), `online` (edge first, Kokoro as fallback), or `off` (voice always falls back to browser `speechSynthesis`) |
| `ALFRED_TTS_VOICE` | `bm_george` | Kokoro voice name (British male by default) |
| `OLLAMA_URL` | `http://localhost:11434` | Where to reach Ollama, if not the default local install |

## Alfred orchestration

Once installed, Claude Code in this project routes work down a fixed org chart
instead of doing everything itself:

| Rank | Model | Role |
|---|---|---|
| CEO | You | Direction and approvals — the only human in the loop |
| C-suite | Fable (the main session) | Architecture, orchestration, synthesis — delegates aggressively, never does bulk work itself |
| VPs | Opus | Hard debugging, design review, adversarial verification |
| Managers | Sonnet | Default coding subagents — most implementation work |
| Employees | Haiku | Parallel search, research, bulk mechanical work |
| Interns | Local Ollama | Free drafts/summaries/embeddings — **always reviewed by a higher tier before use, never shipped raw** |

Agent count is dynamic — the main session fans out as many cheap-tier
subagents as a task needs, never capped to an arbitrary number, and is more
deliberate about spawning multiple expensive Opus/Fable agents in parallel.

**Review-loop pattern**: anything shipped goes worker -> reviewer -> synthesis,
one tier up from whoever produced it. `/review-loop` automates this for
uncommitted changes: it runs a worker/reviewer/refiner cycle until a review
pass approves, capped at 3 iterations.

**Prompt library** (`commands/`, installed as slash commands):

| Command | What it does |
|---|---|
| `/fanout` | Decomposes a task into independent chunks, runs each as a parallel subagent at the cheapest tier that can handle it, then synthesizes the results |
| `/review-loop` | Worker/reviewer/refiner loop on the current uncommitted diff until approved (max 3 iterations) |
| `/harvest` | End-of-session capture — pulls decisions, patterns, and learnings out of the session into the brain |
| `/deep-debug` | Layered debugging for a hard bug: reproduce, isolate, then parallel per-layer investigators before verifying the fix |
| `/azure-audit` | Reviews Azure resources or Terraform IaC for security misconfigurations and cost issues |
| `/explain` | Teaches a concept, calibrated to what you already know, with an offer to save the explanation to the brain |
| `/plan-day` | Scans active project notes and recent git activity to propose the day's highest-leverage work |
| `/pr-desc` | Writes a small, focused PR description for the current branch's diff |
| `/intern` | One-off manual trigger to offload a draft/summary/mechanical task to the local Ollama tier |
| `/status` | One-screen status: repo/branch/changes, running background tasks, brain note freshness |
| `/tokens` | Token usage report — cloud spend by day/model plus local intern load, so you can see the cloud-vs-local ratio |

**Key skills** (`skills/`, loaded automatically when relevant):
- `vault-recall` — semantic search over the brain via this same nomic-embed
  index, so agents can ask "what do we know about X" instead of guessing
  filenames or re-deriving prior decisions.
- `evolve` — the self-evolution engine: turns a workflow that's repeated 2+
  times into a proper skill, command, or agent instead of re-explaining it
  every session.
- `ollama-interns` — the model matrix for the local intern tier (which model
  for which kind of grunt work) and the "always reviewed, never shipped raw"
  rule.
- Intern-run logging + `/tokens` — every local Ollama call for search/ask
  (not TTS — that's not token work) logs to
  `~/.claude/metrics/ollama-usage.jsonl`; `/tokens` turns that into a report.

**Self-evolution loop**: session-start/stop hooks capture what happened into
memory and the brain. When the same workflow shows up 2+ times, `/evolve`
promotes it into a skill or command so the next session doesn't re-derive it.
This repo is the durable, installable snapshot of that accumulated state —
after a meaningful change to your own `~/.claude/`, re-sync it back into this
repo and push.

**Personalize after install**: the two `CLAUDE.md` files in `claude-md/` are
Dishi-personalized — his name, role, communication preferences, hard rules.
After running `install.ps1`, open `~/.claude/CLAUDE.md` and your home
`CLAUDE.md`, and edit the "Who I Am" / preferences sections to describe
*yourself*, not Dishi. The org-chart routing and orchestration mechanics below
that point are meant to be shared as-is.

## Troubleshooting

- **Server won't start at all** — almost certainly missing dependencies.
  `cd jarvis && npm install`; `server.mjs` imports `kokoro-js` and `msedge-tts`
  unconditionally, so without `node_modules` it fails before binding the port.
- **Ollama pill is red / "OLLAMA: OFFLINE"** — Ollama isn't running or isn't
  reachable at `OLLAMA_URL`. Start it (`ollama serve`, or the desktop app) and
  refresh; search and voice both degrade to an error state without it, but the
  graph itself still renders.
- **Ask/voice answers are slow** — the default `qwen2.5:1.5b-instruct` should
  answer in a few seconds once warm. If it's crawling, check `ollama ps` for
  whether the model spilled to CPU (too little free VRAM) — close other
  GPU-heavy apps, or drop context further. `ALFRED_ASK_MODEL=qwen3.5:4b` gets
  better answers but is meaningfully slower, especially cold (can take a
  minute-plus on first call after Ollama loads it).
- **Spoken voice sounds robotic, or there's no voice at all** — check
  `/api/status`'s `ttsEngine` field. `"kokoro"` or `"edge"` means the server is
  producing real speech; if you're still hearing a robotic voice with either
  of those, the browser played its fallback anyway — check the console for a
  fetch error. `"off"` means `ALFRED_TTS_MODE=off`, and everything routes to
  the browser's built-in `speechSynthesis` — use Microsoft Edge there for the
  best free neural UK voices, or install additional UK English voices via
  Windows Settings > Time & Language > Speech.
- **First spoken answer is slow, later ones are fine** — Kokoro is lazy-loaded
  on first use and pre-warmed right after you dismiss the landing screen; if
  you ask something within a second or two of entering, you may catch it
  before the pre-warm finishes.
- **No mic button** — your browser doesn't support `SpeechRecognition`. Use
  Chrome or Edge; the mic hides itself gracefully everywhere else, and typed
  search/ask still work fully.
- **Index freshness shows amber** — the index is more than 24 hours old, or a
  note changed since the last index. Rerun `node jarvis\index-vault.mjs`; it's
  incremental, so only new/changed notes get re-embedded.
- **Port already in use** — another process (maybe a previous Alfred instance)
  is holding 7777. Find and stop it (`netstat -ano | findstr :7777`, then
  `Stop-Process -Id <pid>`), or run this instance on a different port:
  `$env:PORT = 8080; node jarvis\server.mjs`.
