# Alfred Mission Control — Product/UX Specification

> Audience: Sonnet-tier implementers. Precision over prose.
> Author: UX architect pass, 2026-08-08.
> Companion doc: `MISSION-CONTROL-BRIEF.md` (the execution-bridge build, already delivered).
> **Every feature in this spec is grounded in a data source that exists on this machine today.**
> Where a feature needs data that does not exist, it is either marked BLOCKED with its unblock
> step, or listed in §6 Non-Goals. Implementers must not invent integrations to fill a card.

---

## 0. Ground truth — what exists today

Read this section before designing anything. It is the complete list of real data sources.

### 0.1 The application

| Thing | Reality |
|---|---|
| Server | `jarvis/server.mjs` — single file, 1616 lines, **zero web framework**. Node `http`, manual `url.pathname` dispatch in `main()` (line ~1516). |
| UI | `jarvis/ui.html` — single file, 2446 lines, vanilla JS in one IIFE, `'use strict'`. No build step, no bundler, no framework. |
| Bind | `127.0.0.1` only, ports 7777 + 80. Hard-coded, no config switch (deliberate — it is a shell-execution bridge). |
| Auth | Per-boot `crypto.randomUUID()` token, template-injected into `ui.html` at serve time. Every **mutating** endpoint requires `X-Alfred-Token`. GET observe endpoints are open on loopback. |
| Nav today | `#view-toggle` (`ui.html:555`) — two buttons, `data-view="brain"` and `data-view="ops"`. |
| Brain dir | `C:\Users\dishi\OneDrive\Desktop\_Projects\Alfred-Brain` (`ALFRED_VAULT` env override). |
| Model gate | `CHAT_MODEL` default `opus`. Fable requires `ALFRED_ALLOW_FABLE=1`. **Preserve this gate in every new surface.** |

**Constraint for all new work:** stay native — no npm dependencies without explicit CEO approval
(standing rule from `CLAUDE.md`). Everything specced below is achievable with `node:child_process`,
`node:fs`, `fetch`, and the `git` / `gh` / `schtasks` binaries already on PATH.

### 0.2 Existing API surface (all verified in `server.mjs`)

```
GET  /api/graph                     force-directed graph nodes+links from index.json
GET  /api/search?q=                 semantic search (nomic-embed-text cosine)
GET  /api/note?path=                one note's markdown (realpath traversal guard)
GET  /api/status                    notes, generatedAt, ollama, internTokens, ttsEngine,
                                    rosterAgents, activeSessions, activeSubagents
GET  /api/org[?detail=<id>]         org-chart payload; detail = last 15 event one-liners
GET  /api/usage                     24h token tally by model family + local ollama + internPct
GET  /api/terminal/output?after=N   shell ring buffer increments
GET  /api/claude/state?after=N      chat session ring buffer
GET  /api/agents                    launched one-shot agents
GET  /api/interns/models            live `ollama list`
POST /api/ask                       voice-composed answer (local ollama)
POST /api/tts                       Kokoro local / edge-tts fallback
POST /api/terminal/input            {line} -> hidden pwsh stdin          [token]
POST /api/claude/send               {message} -> headless claude session [token]
POST /api/claude/stop                                                    [token]
POST /api/claude/open-terminal      hand session to `wt`                 [token]
POST /api/agents/launch             {prompt, model}                      [token]
POST /api/agents/<id>/kill                                               [token]
POST /api/interns/run               {model, prompt}                      [token]
```

### 0.3 Real data sources available to the server

| # | Source | How it is read | What it yields |
|---|---|---|---|
| D1 | `index.json` | already loaded (`loadIndex()`) | note titles, folders, links, mtime, excerpt, vectors |
| D2 | `~/.claude/projects/**/*.jsonl` | `walkJsonlFiles()` + `tailJsonl()` | session transcripts: `cwd`, `model`, `timestamp`, `tool_use` blocks, `message.usage` token counts |
| D3 | `~/.claude/agents/**/*.md` | `loadRoster()` | agent roster: name, description, model → tier |
| D4 | `~/.claude/metrics/ollama-usage.jsonl` | line-parse | local intern token ledger |
| D5 | `ollama list` / `ollama ps` | `execFile` | installed + resident local models |
| D6 | `claude.exe` (resolved from `%APPDATA%\npm\...\bin\claude.exe`) | `spawn` | headless sessions, one-shot agents |
| D7 | **`git` CLI** | `execFile` — **not yet used by the server** | branch, dirty count, last commit, ahead/behind, remote URL |
| D8 | **`gh` CLI** (authenticated as `dpatel-93`, verified) | `execFile` — **not yet used** | repo metadata, open PRs, workflow list, **workflow run history**, manual `workflow run` dispatch |
| D9 | **Filesystem scan of `_Projects\`** | `fs.readdirSync` | 21 project folders, 17 of them git repos |
| D10 | **HTTP health probes** | `fetch` | `https://www.deishmedia.com`, `https://deish-api-aggoucydbk3vw.azurewebsites.net/api/health` |
| D11 | **`schtasks`** | `execFile` | Windows Task Scheduler query/create for local scheduled runs |

### 0.4 Verified project inventory (D9 + D7, captured 2026-08-08)

```
AI-Controls          main       dirty:12   ADO   dpatel93/AI-Controls
AZ-RG-Review         (no git)
Alfred-Brain         master     dirty:248  GH    dpatel-93/DP_Obsidian_Vault   <- stale remote name
Alfred-v4            master     clean      GH    dpatel-93/jarvis              <- superseded
Alfred                master    clean      GH    dpatel-93/alfred              <- THIS repo
AppReg               main       clean      ADO
CE-Project-Portfolio wip/...    clean      ADO
CE-Project-Portfolio-1 main     clean      ADO
CloudOpsMCP          dot-net-pivot dirty:15 ADO  everestre/Infrastructure
Confluence-API-Guide (no git)
Copilot-PowerUsers   master     dirty:1    ADO
DailyUpdates         master     clean      GH    dpatel-93/DP_dailybrief
Everest - AI Upskilling Course (no git)
MCP-UseCase          master     dirty:12   GH    dpatel-93/MCP-UseCase
PSSA-Entra_App_Creation master  clean      ADO
Plugins              master     clean      GH    dpatel-93/deish-media   <- DEISH MEDIA MONOREPO
ThreatIntel-Lookup   (no git)
TickerQFA            main       dirty:3    GH    dpatel-93/TickerQFA-Dev
_DesignArchive       (no git)
cloudops-knowledge-center (no git)
sm_Projects          (no git)
```

Two facts the Dev Cockpit must handle from day one:
1. **Not every project is a git repo** (5 of 21). Non-git folders still deserve a card.
2. **Not every git repo is on GitHub** (7 are Azure DevOps). `gh` returns nothing for those —
   the card must degrade to git-only data, not show an error.

### 0.5 Verified automation inventory (D8, captured 2026-08-08)

```
dpatel-93/DP_dailybrief    Daily Brief               cron 0 12 * * *     active
                           Pre-Market Brief          cron 55 12 * * 1-5  active
                           Sports Brief              active
                           Telegram Command Listener active (runs ~every 20 min)
                           Weekly Brief              active
dpatel-93/deish-media      Deploy Prisma site (Azure)      active
                           Back up signing secrets to KV   active
                           macOS plug-in build             active
                           Windows plug-in build           active
```

`gh run list -R <repo> --json name,status,conclusion,createdAt,databaseId,workflowName` returns
clean structured JSON (verified). `gh workflow run` dispatches manually. **GitHub Actions is
already the user's working automation substrate — the hub surfaces it, it does not replace it.**

Local scheduled tasks: **none exist.** `Get-ScheduledTask` matching alfred/claude/jarvis returns
nothing. Startup folder has `AlfredBrain.vbs` (the server autostart), `Ollama.lnk`.

Claude cloud routines/cron: **none exist** (`CronList` → "No scheduled jobs").

### 0.6 Verified Deish Media inventory

Deish Media is the audio-plugin business. Local clone: `_Projects\Plugins` → `dpatel-93/deish-media`.

**Real and queryable now:**
- Monorepo layout: `audio/{Prisma,Base6ix,PrismaBalance}/`, `website/`, `licensing/api/`,
  `infra/main.bicep`, `marketing/`, `docs/`, `trading/`, `apparel/`, `plugin-kit/`
- `website/downloads/` holds the **actual shipped artifacts**:
  `PrismaSuite-0.24.0-trial.zip` (8.1 MB), `PrismaSuite-0.24.0-macOS.pkg` (88.7 MB),
  `Base6ix-1.1.0-trial.zip` (4.5 MB), `Base6ix-1.1.0-macOS.pkg` (12.9 MB)
- Root `HANDOFF.md` contains one genuinely **structured** markdown table, "Live estate
  (all verified end-to-end)" (~line 963): site URL, licensing API URL, Stripe webhook URL,
  Azure resource names, repo, cost estimate. This is the only parseable business data in the repo.
- Stripe buy links are **hard-coded Payment Links** in `website/audio/index.html` and
  `website/catalogue.mjs` — not an API integration. They are readable strings, nothing more.
- Licensing API: `licensing/api/src/functions/{stripeWebhook,activate,deactivate,health}.js`.
  **`/api/health` is a real, free, unauthenticated uptime probe.**
- Product catalogue: `licensing/api/src/lib/products.js` — `prisma` (`PRSM-`), `base6ix` (`BASE-`)
- 0 open issues, 0 open PRs, no GitHub Releases used (distribution is via `website/downloads/`)

**NOT available — do not build UI that implies it exists:**
- Revenue, units sold, customer count, active device activations. These live only as rows in
  Azure Table Storage (`serials`, `activations`, `stripesessions` in storage account `deishlic*`,
  RG `deishmedia-rg`). **`az account show` currently returns "Please run 'az login'"** — the
  machine is not authenticated. There is no cached or exported copy anywhere on disk.
- Web analytics. `website/privacy/index.html` explicitly commits to running **no** analytics or
  tracking. Adding any is a privacy-policy change, not a feature.
- Any CRM, client list, invoice, or content-calendar data. None exists in any form.

### 0.7 Known landmines (from `Projects/Alfred.md` — respect these)

- `claude` on PATH is an npm **shim** (`claude.ps1`), not an exe. `spawn(..., {shell:false})`
  ENOENTs on it. `resolveClaudeBin()` already handles this — reuse it, never re-derive.
- `--output-format stream-json` requires `--verbose` under `-p`.
- `spawn` ENOENT on Windows also means **bad cwd**. This will bite the "open Claude here" feature.
- Fire-and-forget polling duplicates lines when a request outlives its interval. **Serialize
  every poll tick and add a view-generation guard.** This is already a fixed bug — do not
  reintroduce it in new surfaces.
- The terminal is a line pipe, **not a PTY**. Full-screen TUIs will not render. Unchanged here.

---

## 1. Information architecture

### 1.1 The five surfaces

| # | Surface | Question it answers | Primary data |
|---|---|---|---|
| 1 | **Mission Control** (exists) | "What does my brain know, and let me talk to Alfred." | D1, D6 |
| 2 | **Dev** (new) | "What is the state of everything I'm building?" | D7, D8, D9, D2, D1 |
| 3 | **Automations** (new) | "What runs without me, did it work, and can I run it now?" | D8, D11, D6, ledger |
| 4 | **Deish** (new) | "Is the business shipping and is it up?" | D7, D8, D10, D9, D1 |
| 5 | **Org Chart** (exists) | "What are my agents doing right now, and what is it costing?" | D2, D3, D4 |

Five is the ceiling. A sixth surface must displace one of these, not join them.

### 1.2 Navigation model

**Keep the existing segmented control.** `#view-toggle` grows from 2 buttons to 5, same visual
treatment, same `data-view` attribute pattern. Do not introduce a sidebar — the HUD identity
depends on an unobstructed canvas, and a sidebar would permanently eat ~240px of it.

```
data-view values:  brain | dev | auto | deish | ops
labels:            MISSION CONTROL | DEV | AUTOMATIONS | DEISH | ORG CHART
```

**Canvas persistence rule.** The force-directed graph canvas is Alfred's visual signature and it
is already running. It must not be destroyed on view switch.

- `brain`: canvas at full opacity, interactive.
- `dev` / `auto` / `deish`: canvas continues rendering at **`opacity: 0.12`, `pointer-events: none`**,
  with content rendered in a scrollable grid container above it. Costs nothing (the rAF loop is
  already there), keeps the surfaces from feeling like a different application.
- `ops`: canvas hidden (`display:none`) — the swimlanes are their own dense visual.

**View-scoped polling (mandatory).** Today three independent intervals run. With five surfaces
this becomes a thrash problem, and `/api/org` + `/api/usage` already walk every transcript file.

Implement one shared scheduler in `ui.html`:

```js
// single source of truth; each entry polls ONLY when its view is active
const POLLS = {
  brain:  [{ fn: pollStatus, ms: 10000 }],
  dev:    [{ fn: pollProjects, ms: 30000 }],
  auto:   [{ fn: pollAutomations, ms: 30000 }],
  deish:  [{ fn: pollDeish, ms: 60000 }],
  ops:    [{ fn: pollOrg, ms: 5000 }, { fn: pollUsage, ms: 60000 }],
  always: [{ fn: pollTerminal, ms: TERM_FOCUSED ? 700 : 3000 }]  // terminal panel is global
};
```

Rules: switching views cancels the old view's timers before starting the new view's. Every tick
is serialized (no overlapping fetches for the same poller). Every poller carries a monotonic
`viewGeneration` and drops its response if the generation changed mid-flight. `document.hidden`
suspends everything except `always`.

### 1.3 Persistent chrome (present on every view)

- **Top-left**: view toggle, status frame, Claude Terminal panel, Interns panel.
  The terminal/chat panel is global by design — the whole point is being able to talk to Alfred
  from wherever you are. It keeps its current position and collapse behavior.
- **Bottom-center**: the ASK bar (`#search-wrap`), promoted to a global omnibox (§4.2).
- **New, bottom-right**: toast stack (§4.3).

---

## 2. Surface specs

Each spec gives: purpose, layout, per-component data source, new endpoints, and states.

---

### 2.1 DEV — the coding cockpit

**Purpose.** One glance answers: what am I in the middle of, what's uncommitted, what's waiting
on me in GitHub, and where did I leave off with Claude.

#### 2.1.1 Layout

```
+--------------------------------------------------------------+
| DEV                                    [ all | git | dirty ]  |   filter chips
+--------------------------------------------------------------+
| +----------------+ +----------------+ +----------------+      |
| | PROJECT CARD   | | PROJECT CARD   | | PROJECT CARD   |      |   responsive grid
| +----------------+ +----------------+ +----------------+      |   minmax(340px, 1fr)
| ...                                                           |
+--------------------------------------------------------------+
```

Sort order (deliberate — most-relevant-first, not alphabetical):
1. dirty repos, by last-commit desc
2. clean git repos, by last-commit desc
3. non-git folders, alphabetical

Filter chips: `ALL` / `GIT` / `DIRTY` / `RECENT` (touched by a Claude session in last 7d).

#### 2.1.2 Project card anatomy

```
+-------------------------------------------------------+
| Plugins                              ● dirty 0         |   name, dirty badge
| dpatel-93/deish-media          master  ↑2 ↓0           |   remote (short), branch, ahead/behind
|-------------------------------------------------------|
| 2b1fbd6  "release Base6ix 1.1.0"          16h ago      |   last commit
|-------------------------------------------------------|
| PRs 0 open · CI ✓ passing                              |   gh strip (GitHub repos only)
| Brain note: Prism.md · updated 1d ago                  |   D1 match
| Claude: 3 sessions, last 16h ago                       |   D2 match
|-------------------------------------------------------|
| [ Open Claude here ]  [ Note ]  [ Sessions ]           |   actions
+-------------------------------------------------------+
```

| Row | Data source | Command / lookup | Notes |
|---|---|---|---|
| name | D9 | folder basename | |
| dirty badge | D7 | `git status --porcelain` line count | 0 = green dot, >0 = amber with count |
| remote | D7 | `git remote get-url origin` | shorten `https://github.com/X/Y.git` → `X/Y`; ADO → `ado:<project>` |
| branch | D7 | `git rev-parse --abbrev-ref HEAD` | |
| ahead/behind | D7 | `git rev-list --left-right --count @{u}...HEAD` | omit row if no upstream (don't error) |
| last commit | D7 | `git log -1 --format=%h%x00%cI%x00%s` | NUL-separated so subjects with pipes survive |
| PRs / CI | D8 | see 2.1.4 | **GitHub remotes only**; hidden entirely for ADO/no-git |
| brain note | D1 | see 2.1.5 | |
| Claude sessions | D2 | see 2.1.6 | |

#### 2.1.3 New endpoint: `GET /api/projects`

Local-only, must return in < 500 ms for 21 folders. **No `gh` calls here** — network latency
against 12 GitHub repos would make this a 10-second endpoint.

```jsonc
{
  "roots": ["C:\\Users\\dishi\\OneDrive\\Desktop\\_Projects"],
  "computedAt": "2026-08-08T...",
  "projects": [{
    "name": "Plugins",
    "path": "C:\\...\\_Projects\\Plugins",
    "git": true,
    "branch": "master",
    "dirty": 0,
    "ahead": 2, "behind": 0,          // null when no upstream
    "remote": "https://github.com/dpatel-93/deish-media.git",
    "host": "github",                  // "github" | "ado" | "other" | null
    "slug": "dpatel-93/deish-media",   // null unless host==="github"
    "lastCommit": { "sha": "2b1fbd6", "iso": "2026-08-07T20:19:55Z", "subject": "..." },
    "note": { "path": "Projects/Prism.md", "title": "Prism", "mtime": 1754... },
    "sessions": { "count": 3, "lastIso": "2026-08-07T22:10:00Z", "dirKey": "c--Users-..." }
  }]
}
```

Implementation notes:
- Run the git commands **in parallel with a concurrency cap of 6** (`execFile` with `cwd`, 3s
  timeout each, mirroring the existing `execFileText` helper at `server.mjs:390`).
- Any git command failing → that field is `null`, the project still appears. Never drop a card.
- Cache 15s server-side (same pattern as `usageCache`).
- Configurable roots via `ALFRED_PROJECT_ROOTS` (semicolon-separated), defaulting to `_Projects`.

#### 2.1.4 New endpoint: `GET /api/projects/github?slug=owner/repo`

On-demand, one repo per call, fired by the card when it scrolls into view (IntersectionObserver),
never in bulk. Cache **5 minutes** server-side per slug.

```
gh api repos/<slug> --jq '{issues:.open_issues_count,pushed:.pushed_at,private:.isPrivate}'
gh pr list -R <slug> --state open --json number,title,isDraft,updatedAt --limit 5
gh run list -R <slug> --limit 1 --json conclusion,status,workflowName,createdAt
```

Response merges the three. On `gh` failure (rate limit, network, ADO repo) return
`{ "available": false, "reason": "<one line>" }` and the card renders the row as `PRs —`, muted.
**A GitHub outage must never make a project card look broken.**

#### 2.1.5 Brain-note freshness matching

Match project folder → brain note, in this precedence order:

1. Exact: `Projects/<folderName>.md` exists in `index.json`
2. Alias map: a small curated table in `server.mjs`, because the names genuinely diverge —
   `Plugins → Projects/Prism.md`, `Alfred → Projects/Alfred.md`,
   `DailyUpdates → Projects/DailyUpdates.md`, `TickerQFA → Projects/TickerQFA.md`
3. Case-insensitive fuzzy on note title
4. No match → render `Brain note: none · [ Create ]`

Freshness colouring, computed from `note.mtime` vs `lastCommit.iso`:
- note newer than last commit → green "current"
- note older than last commit → amber "N commits behind" (count via
  `git rev-list --count --since=<noteMtime> HEAD`)
- no note → grey "none"

This is the highest-signal widget on the whole surface: it makes the `project-note` skill's
maintenance debt **visible**, which is the only thing that makes it get paid down.

`[ Create ]` posts to a new `POST /api/note/create` `{folder:"Projects", name, template}` [token]
which copies `Templates/New-Project.md` and substitutes the name. Reindex is *not* triggered
synchronously (embedding is slow) — instead show a toast: "Note created. Reindex to graph it."

#### 2.1.6 Session history per project

**The cwd → transcript-dir mapping is structural**, no parsing required. Claude Code mangles the
cwd by replacing every non-alphanumeric character with `-`:

```
C:\Users\dishi\OneDrive\Desktop\_Projects\Alfred
  -> C--Users-dishi-OneDrive-Desktop--Projects-Alfred
```

**GOTCHA — case is not normalized.** Both spellings exist on this machine right now:
`C--Users-dishi-OneDrive-Desktop--Projects-Alfred` and
`c--Users-dishi-OneDrive-Desktop--Projects-Plugins`. **Match case-insensitively.**

Per project: count `*.jsonl` at the top level of that dir (exclude `subagents/`), take the max
`mtime` as `lastIso`. Stat-only — do not read file contents in `/api/projects`.

`[ Sessions ]` opens the existing right-hand `#panel` with a list of that project's sessions
(id, model, started, last activity, first user message as a title). Requires
`GET /api/projects/sessions?dirKey=<key>` which tails each transcript
(reuse `tailJsonl` + `summarizeSessionTail`, cap at 20 most recent).

Clicking a session row → `[ Resume in terminal ]`, which reuses the **existing**
`POST /api/claude/open-terminal` path with that session id (spawns `wt` running
`claude --resume <id>`). No new spawn logic.

#### 2.1.7 "Open Claude here" — cwd switching

**Current behavior:** `chatSend()` spawns the headless session with cwd hard-coded to the home
directory (chosen because home is already trusted, avoiding a trust prompt).

**Required change:** the chat session becomes cwd-scoped.

- `POST /api/claude/send` accepts an optional `cwd`.
- The server keeps a **map of cwd → session state** (`{sessionId, ring, model}`), not a single
  global session. Switching cwd switches which session the terminal panel is bound to; the old
  session's ring buffer is retained (so switching back keeps scrollback).
- `GET /api/claude/state?after=N&cwd=<path>` scopes the poll.
- `cwd` is validated: it must resolve (`fs.realpathSync`) inside one of `ALFRED_PROJECT_ROOTS`
  or the home directory. **Reject anything else with 400.** This is a shell-execution bridge;
  an unvalidated cwd is an unnecessary widening of it.

**UX.** `[ Open Claude here ]` on a card:
1. Terminal panel expands and switches to chat mode.
2. Badge changes from `ALFRED // CLAUDE ONLINE` to `ALFRED // Plugins` (project name).
3. A `cwd` chip appears in the panel header; clicking it returns to the home session.
4. Alfred speaks a short ack via the existing `/api/tts`: *"Working in Plugins, sir."*
5. If a session already exists for that cwd, it resumes silently rather than starting fresh —
   the badge shows `↺ resumed`.

**RISK to verify during implementation:** untrusted-directory handling under `claude -p`. Home
was chosen originally *because* it is trusted. Behavior in an untrusted project dir is unknown —
it may prompt (and hang a headless pipe), may error, or may auto-trust. **Verify empirically
before shipping.** If it prompts: detect the prompt string in the stream and surface a card-level
`[ Trust this folder ]` action that runs the trust flow in a visible `wt` window once. Do **not**
work around it with a permission-bypass flag — that violates the standing configuration.

Also recall the landmine: **`spawn` ENOENT on Windows can mean bad cwd**, not a missing binary.
Stat the cwd before spawning and return a clear error if it is gone.

#### 2.1.8 States

| State | Treatment |
|---|---|
| Loading | Skeleton cards (6 grey shells, shimmer) — never a spinner-on-blank. Cards fill in as `/api/projects` resolves. |
| Loading (gh strip) | The gh row alone shows `···` while the per-card fetch is in flight. The rest of the card is already live. |
| Empty (no roots configured) | "No project roots configured. Set `ALFRED_PROJECT_ROOTS` or create folders under `_Projects\`." |
| Empty (filter) | "No dirty repos. Everything is committed." — celebratory, not an error. |
| Error (`/api/projects` 500) | Full-surface: "Couldn't scan project roots." + the error line + `[ Retry ]`. |
| Degraded (git missing) | Card renders name + path only, with a muted `no git` chip. Not an error state. |
| Degraded (gh unavailable) | gh row muted to `PRs —`. Tooltip explains why. |

---

### 2.2 AUTOMATIONS — the recurring-work hub

**Purpose.** Every thing that runs without Dishi present, in one list, with real status, real
history, and a button that runs it now.

#### 2.2.1 The core design decision: three kinds, no new scheduler

**Do not build a scheduler inside `server.mjs`.** A `setInterval` in a user-session Node process
has no durability, no missed-run catch-up, and no history if the box sleeps. The machine already
has two proven schedulers.

| Kind | Runs where | Scheduled by | Status + history from | Trigger via |
|---|---|---|---|---|
| `github-workflow` | GitHub cloud | the workflow's own `on: schedule` cron | `gh run list` (real, verified) | `gh workflow run` |
| `local-task` | this machine | Windows Task Scheduler (`schtasks`) | `schtasks /query /fo csv /v` → last run time + last result | `schtasks /run` |
| `local-agent` | this machine | Task Scheduler, invoking Alfred | Alfred's own run ledger (§2.2.4) | `POST /api/automations/run` |

Default recommendation to surface in the UI when the user adds a new automation: **if it can run
in the cloud, make it a GitHub Actions workflow.** It is free, it already works, it has durable
history, and it runs when the desktop is off. Local kinds are for things that genuinely need this
machine (local Ollama, local filesystem, Azure CLI with local auth).

#### 2.2.2 The registry: `automations.json`

User-curated, hand-editable, lives at `jarvis/automations.json` (checked into the repo — it
contains no secrets, only references). Alfred reads it; the UI can toggle `enabled` and edit
nothing else in P1.

```jsonc
{
  "version": 1,
  "automations": [
    {
      "id": "daily-brief",
      "name": "Daily News Brief",
      "description": "RSS -> Groq summary -> Edge TTS -> Telegram, 8am EST",
      "kind": "github-workflow",
      "repo": "dpatel-93/DP_dailybrief",
      "workflow": "daily-brief.yml",
      "schedule": "0 12 * * *",
      "enabled": true,
      "tags": ["personal", "daily"]
    },
    {
      "id": "deish-site-deploy",
      "name": "Deploy deishmedia.com",
      "kind": "github-workflow",
      "repo": "dpatel-93/deish-media",
      "workflow": "azure-swa-deploy.yml",
      "schedule": null,
      "enabled": true,
      "tags": ["deish", "deploy"],
      "surfaces": ["auto", "deish"]
    },
    {
      "id": "brain-reindex",
      "name": "Reindex the brain",
      "kind": "local-task",
      "command": "node",
      "args": ["C:\\...\\Alfred\\jarvis\\index-vault.mjs"],
      "cwd": "C:\\...\\Alfred\\jarvis",
      "schedule": "0 3 * * *",
      "scheduledTaskName": "Alfred\\BrainReindex",
      "enabled": true,
      "tags": ["alfred", "maintenance"]
    },
    {
      "id": "morning-standup",
      "name": "Morning standup brief",
      "kind": "local-agent",
      "prompt": "Run /plan-day and write the result to the brain as Projects/_Standup.md",
      "model": "sonnet",
      "cwd": "C:\\Users\\dishi",
      "schedule": "0 8 * * 1-5",
      "scheduledTaskName": "Alfred\\MorningStandup",
      "tier": "sonnet",
      "budgetTokens": 60000,
      "enabled": false,
      "tags": ["alfred", "daily"]
    }
  ]
}
```

**Guardrails, displayed on every card:**
- `tier` badge, colour-matched to the org-chart tier palette (`opus` violet / `sonnet` blue /
  `haiku` green / `intern` grey). Reuse `modelToTier()` (`server.mjs:231`) for consistency.
- **`fable` is rejected at load time** unless `ALFRED_ALLOW_FABLE=1`, exactly as
  `isModelAllowed()` (`server.mjs:726`) already does. An automation declaring `fable` renders
  disabled with a `GATED` badge and cannot be run.
- `budgetTokens` is advisory: the run ledger records actual tokens, and the card shows
  `last run: 43k / 60k budget`, amber over 100%. No hard kill in P1 — an automation killed
  mid-write is worse than one that overran.

#### 2.2.3 New endpoints

```
GET  /api/automations                     registry merged with live status
GET  /api/automations/<id>/history?n=20   run history for one automation
POST /api/automations/<id>/run            manual trigger                       [token]
POST /api/automations/<id>/enabled        {enabled:bool} -> writes registry     [token]
```

`GET /api/automations` merges the registry with live status:
- `github-workflow` → `gh run list -R <repo> -w <workflow> --limit 5 --json ...`
  (cache 60s per repo; **batch by repo**, not by automation — `DP_dailybrief` has 5 workflows
  and must cost one `gh` call, not five. Fetch `--limit 30` for the repo, group client-side.)
- `local-task` / `local-agent` → `schtasks /query /tn <name> /fo csv /v` for next-run + last-result,
  plus the Alfred ledger for the last N outcomes.

```jsonc
{
  "computedAt": "...",
  "automations": [{
    "id": "daily-brief", "name": "...", "kind": "github-workflow",
    "tier": null, "enabled": true, "schedule": "0 12 * * *",
    "scheduleHuman": "every day at 08:00 EST",
    "status": "success",            // success | failure | running | never | unknown | disabled
    "lastRun": { "iso": "...", "conclusion": "success", "durationMs": 41000,
                 "url": "https://github.com/..." },
    "nextRun": "2026-08-09T12:00:00Z",   // computed from cron, or schtasks for local
    "recent": ["success","success","failure","success","success"]  // sparkline, oldest->newest
  }]
}
```

`POST /api/automations/<id>/run`:
- `github-workflow` → `execFile('gh', ['workflow','run', workflow, '-R', repo])`, then poll
  `gh run list` for ~15s to pick up the new run id and stream its status into the card.
  (GitHub does not return the run id from `workflow run` — this poll is unavoidable.)
- `local-task` → `schtasks /run /tn <name>`
- `local-agent` → reuse the **existing** `launchAgent(prompt, model)` machinery
  (`server.mjs:1063`) with the automation's cwd, and write a ledger entry on exit.

#### 2.2.4 Run ledger

`~/.claude/metrics/automation-runs.jsonl` — append-only, one JSON object per line, mirroring the
existing `ollama-usage.jsonl` convention so `/tokens` and future reporting can consume both.

```jsonc
{"ts":"2026-08-08T12:00:03Z","id":"morning-standup","kind":"local-agent","trigger":"schedule",
 "status":"success","durationMs":48122,"model":"sonnet","tokensIn":31204,"tokensOut":4102,
 "exitCode":0,"note":"wrote Projects/_Standup.md"}
```

Only local kinds write here — GitHub runs already have durable history at GitHub and duplicating
it would immediately drift.

#### 2.2.5 Layout

```
+---------------------------------------------------------------+
| AUTOMATIONS            [ all | cloud | local | failing ]       |
+---------------------------------------------------------------+
| ● Daily News Brief                          github · sonnet-   |
|   every day 08:00 EST · next in 6h 12m                         |
|   ▪▪▪▫▪  last: success, 41s, 16h ago              [ Run now ]  |
|---------------------------------------------------------------|
| ● Telegram Command Listener                 github             |
|   every 20 min · next in 4m                                    |
|   ▪▪▪▪▪  last: success, 22s, 8m ago               [ Run now ]  |
|---------------------------------------------------------------|
| ○ Morning standup brief          local-agent · SONNET · 60k    |
|   DISABLED · weekdays 08:00                       [ Enable ]   |
+---------------------------------------------------------------+
```

Rows, not cards — automations are a **list** you scan for red, not a gallery. Sort: failing
first, then running, then by next-run ascending, then disabled last.

The 5-square sparkline (`recent`) is the highest-value pixel on this surface: a run that
succeeds today but failed three times this week is a different situation from one that has
never failed, and a single status dot hides that.

Clicking a row expands it inline: full history table (20 rows: when, trigger, status, duration,
tokens), the schedule in both cron and human form, and for GitHub kinds a link out to the run
on github.com.

#### 2.2.6 States

| State | Treatment |
|---|---|
| Loading | Row skeletons; the registry (names, schedules) renders instantly from `automations.json` and only the live-status columns shimmer. |
| Empty registry | "No automations registered yet." + a copyable `automations.json` starter snippet + a note that the 9 existing GitHub workflows can be imported. Ship a `[ Import from GitHub ]` action in P2 that scans `gh workflow list` across the user's repos and proposes registry entries. |
| `never` run | Grey dot, "never run", `[ Run now ]` prominent. |
| `running` | Pulsing amber dot, elapsed timer, `[ Run now ]` disabled. |
| `failure` | Red dot, the failure surfaced at row level (not hidden in the expand), `[ View log ]` for GitHub kinds. |
| `unknown` (gh failed) | Grey dot + "status unavailable" + reason tooltip. **Never render unknown as success.** |
| Disabled | Row at 50% opacity, hollow dot, `[ Enable ]`. |

---

### 2.3 DEISH — the business surface

**Purpose.** "Is the business shipping, and is it up?" Nothing more — because nothing more is
knowable from this machine (§0.6).

This surface earns its place through **honesty about its scope**. It is a shipping-and-uptime
board, not a business-intelligence dashboard. Every revenue-shaped widget is deliberately absent.

#### 2.3.1 Layout

```
+---------------------------------------------------------------+
| DEISH MEDIA                                deishmedia.com ↗    |
+---------------------------------------------------------------+
| LIVE ESTATE                                                    |
| ● Website          www.deishmedia.com              203ms       |
| ● Licensing API    deish-api-....azurewebsites.net  312ms      |
+---------------------------------------------------------------+
| PRODUCTS                                                       |
| +---------------------+ +---------------------+                |
| | PRISMA SUITE 0.24.0 | | BASE6IX 1.1.0       |                |
| | win 8.1MB · mac 88MB| | win 4.5MB · mac 12MB|                |
| | built 2026-08-07    | | built 2026-08-07    |                |
| | Stripe link ✓       | | Stripe link ✓       |                |
| | [ Buy page ] [ dl ] | | [ Buy page ] [ dl ] |                |
| +---------------------+ +---------------------+                |
| +---------------------+                                        |
| | PRISMA BALANCE      |  in development · no artifact          |
| +---------------------+                                        |
+---------------------------------------------------------------+
| BUILD & DEPLOY                                                 |
| Deploy Prisma site (Azure)   ✓ 16h ago      [ Run ]            |
| Windows plug-in build        ✓ 1d ago                          |
| macOS plug-in build          ✓ 1d ago                          |
| Back up signing secrets      ✓ 3d ago                          |
+---------------------------------------------------------------+
| REPO                monorepo dpatel-93/deish-media             |
| master · clean · 0 open PRs · 0 open issues                    |
| last: 2b1fbd6 "release Base6ix 1.1.0"      [ Open Claude here ]|
+---------------------------------------------------------------+
| BUSINESS NOTES  (brain: Business/)                             |
| Deish Media.md  · 2d ago      Pipeline.md · 9d ago  [stale]    |
| Content.md      · none        Metrics.md  · none    [create]   |
+---------------------------------------------------------------+
```

#### 2.3.2 Component data sources

| Component | Source | Mechanism |
|---|---|---|
| Live estate | D10 | `fetch` with 5s timeout, HEAD then GET fallback. Two targets, hard-coded from the `HANDOFF.md` "Live estate" table. Poll 60s while the view is active. Show status dot + latency. **A non-200 is amber "degraded", a timeout/refused is red "down".** |
| Products | D9 | `fs.readdirSync('<repo>/website/downloads')`, parse `^(?<product>[A-Za-z6]+)[-](?<ver>[\d.]+)[-](?<variant>trial\|macOS)\.(zip\|pkg)$`, group by product, take max version. Size + mtime from `statSync`. |
| Stripe link | D9 | grep `website/catalogue.mjs` for `buy.stripe.com` URLs. Presence check only — render `✓ link present` or `⚠ no buy link`. **Never imply a payment status or a sale.** |
| Build & deploy | D8 | `gh run list -R dpatel-93/deish-media --limit 30 --json workflowName,conclusion,createdAt,databaseId`, grouped by `workflowName`. Same call the Automations surface makes — **share one cache entry**. |
| Repo | D7 + D8 | identical to a Dev project card for `_Projects\Plugins`; **reuse the card component**, do not fork it. |
| Business notes | D1 | notes in `index.json` with `folder === "Business"` |

#### 2.3.3 New endpoint: `GET /api/deish`

One endpoint, server-side cached 60s, composing all of the above. It is fine for this to be a
single purpose-built endpoint rather than a generic one — there is exactly one business.

Config at the top of `server.mjs`, not scattered:

```js
const DEISH = {
  repoPath: path.join(PROJECT_ROOT, 'Plugins'),
  slug: 'dpatel-93/deish-media',
  health: [
    { name: 'Website',       url: 'https://www.deishmedia.com' },
    { name: 'Licensing API', url: 'https://deish-api-aggoucydbk3vw.azurewebsites.net/api/health' }
  ],
  downloadsRel: 'website/downloads',
  products: [
    { id: 'prisma',  label: 'Prisma Suite',   filePrefix: 'PrismaSuite' },
    { id: 'base6ix', label: 'Base6ix',        filePrefix: 'Base6ix' },
    { id: 'balance', label: 'Prisma Balance', filePrefix: 'PrismaBalance' }
  ]
};
```

If `repoPath` does not exist, `/api/deish` returns `{available:false, reason:"..."}` and the
surface renders a single honest empty state rather than five broken panels.

#### 2.3.4 The `Business/` brain folder convention — NEW, spec'd here

The brain indexer (`index-vault.mjs:19`) skips only `.obsidian`, `Templates`, `.git`,
`node_modules`, `_Archive` — **any new top-level folder is indexed and graphed automatically.**
No indexer change is needed. Only two things must be added:

1. A radial-menu chip in `ui.html:566` (the hard-coded 5-folder list):
   `<div class="cat-btn" data-folder="Business" style="--accent:#e0655f;">BIZ</div>`
2. The matching colour in the graph's folder→colour map.

**Folder contract** (create these as part of P1; each is a plain markdown note, no frontmatter,
consistent with every other brain folder):

| File | Purpose | Who writes it |
|---|---|---|
| `Business/Deish Media.md` | The company note: positioning, product lineup, pricing, current phase, what "done" looks like this quarter. The `Projects/Prism.md` note stays *technical*; this one is *commercial*. | Dishi + Claude |
| `Business/Pipeline.md` | Opportunities, leads, partnerships, distribution conversations. A markdown table (`Who \| What \| Stage \| Next step \| Updated`). | Dishi, manually |
| `Business/Content.md` | Marketing/content ideas and what shipped. Links to `marketing/` assets in the repo and `_DesignArchive`. | Dishi + Claude |
| `Business/Metrics.md` | **Manually recorded** monthly snapshot: units, revenue, activations, as of a date. | Dishi, manually |

`Business/Metrics.md` deserves its own paragraph, because this is where a lesser design would lie.
There is no live sales feed (§0.6). The Deish surface renders this note's contents verbatim under
a header that reads **"Last recorded by hand — <date>"**, and if the note is older than 45 days it
shows amber `stale`. It shows *what Dishi wrote*, dated, never a computed or estimated number.
That is honest, it is useful, and it costs one endpoint that already exists (`/api/note`).

Add `Templates/New-Business.md` to the brain templates folder so the `[ create ]` action has a
scaffold, matching the existing `New-Project.md` / `New-Decision.md` pattern.

#### 2.3.5 States

| State | Treatment |
|---|---|
| Loading | Estate dots grey and pulsing, product cards skeleton, everything else instant from local git. |
| Health check pending | Grey dot + `···`. **Never optimistically green.** |
| Health down | Red dot, "no response (5s timeout)", timestamp of last successful check if any. |
| No `Business/` folder | The notes panel shows: "No business notes yet. The brain has no `Business/` folder." + `[ Create Business/ ]` which scaffolds all four notes from templates. |
| Repo missing | Whole-surface empty state naming the expected path. |
| Balance (no artifact) | Card renders as an outline with "in development" — do not hide the product, its absence from downloads *is* the status. |

#### 2.3.6 The licensing data question (BLOCKED — P2)

Revenue/activation counts require `az login` (§0.6). The design position:

- **P0/P1: do not build it.** Do not render a placeholder revenue tile, a `--`, or a
  "connect to see sales" upsell. A blank space is more honest than a disabled widget that
  advertises data the product cannot provide.
- **P2, if the user wants it:** a `LICENSING` panel that first calls a new
  `GET /api/deish/licensing` which runs `az account show`. If unauthenticated it returns
  `{authed:false}` and the panel renders one line: *"Run `az login` in the terminal panel, then
  refresh."* — actionable, using a terminal that is already on screen. Once authed, a new
  **read-only** script (`licensing/tools/Get-LicenseStats.ps1` — new; the two existing tools
  `Issue-CompSerial.ps1` and `Reset-DeviceSlot.ps1` are read-then-**mutate** and must not be
  invoked from a dashboard) aggregates the `serials` / `activations` / `stripesessions` tables
  into counts. Sized L because it needs a new script, an Azure auth story, and careful
  read-only guarantees.

---

### 2.4 MISSION CONTROL — enhancements to the existing surface

Keep everything. Add four things that serve the new surfaces.

**E1 — `Business` category chip** (§2.3.4). S. One line of HTML plus a colour.

**E2 — Graph node colouring by freshness (opt-in toggle).** The graph currently colours by folder.
Add a `FRESH` toggle in the status frame that recolours nodes on a green→amber→red ramp by
`mtime` age. Turns the graph into an at-a-glance map of which parts of the brain have gone stale.
Data already in `index.json`. S.

**E3 — Index staleness is currently invisible.** `isIndexStale()` (`server.mjs:92`) exists and
`STALE_MS` is 24h, but the UI shows only `Indexed <date>`. Make the row **amber when stale** with
a `[ Reindex ]` button → `POST /api/reindex` [token], which runs `buildIndex()` and streams
progress into the terminal panel (it is a slow embed loop; it must not block the HTTP response).
S, and it removes a whole class of "why is search wrong" confusion.

**E4 — Brain health warning.** `Alfred-Brain` currently has **248 uncommitted files** and its git
remote still points at `dpatel-93/DP_Obsidian_Vault` (the pre-rename repo). The status frame
should show `Brain: 248 uncommitted` in amber, sourced from the same git helper the Dev surface
uses. The brain is the user's memory; a 248-file drift from its backup is the single highest-
consequence unnoticed risk on this machine. S.

---

### 2.5 ORG CHART — enhancements to the existing surface

**E5 — Cost lane.** `/api/usage` already computes 24h tokens per model family and `internPct`.
The org chart shows *who is running* but not *what it cost*. Add a right-hand rail: per-tier
24h token bars, the cloud-vs-local ratio as a single prominent number, and the `internPct` gauge.
The framework's whole economic thesis is "push work down the org chart" — this makes the
scoreboard visible. M.

**E6 — Session → project attribution.** `buildSessionNode()` already extracts `project` from the
transcript's `cwd`. Show it as a chip on each active session node, and make the chip a link that
switches to the Dev surface with that project's card scrolled into view and highlighted. This is
the connective tissue between Org Chart and Dev. S.

**E7 — Automation runs appear in the org chart.** A `local-agent` automation launched by the
scheduler is a `claude -p` process exactly like an `@haiku` launch, and it will already show up
via the existing transcript walk. Tag it with an `automation` badge and its automation name so a
3am scheduled run is distinguishable from something Dishi started. S — requires only that
`launchAgent()` records an optional `automationId`.

**E8 — Terminal panel: project-scoped chat.** Covered in §2.1.7; listed here because the panel is
global chrome, not Dev-surface-local.

---

## 3. Voice enhancements

The wake word and TTS already work. Two additions that serve the new surfaces, both small:

**V1 — Navigation by voice.** Extend the existing transcript matcher (which already handles
`alfred, wake up`) with a small intent table. This is a regex table, not an NLU model:

```
/\b(show|go to|open)\s+(dev|projects?)\b/i        -> switch to dev
/\b(show|go to|open)\s+(automations?|jobs?)\b/i   -> switch to auto
/\b(show|go to|open)\s+(deish|business)\b/i       -> switch to deish
/\b(show|go to|open)\s+(org|agents?)\b/i          -> switch to ops
/\b(what.?s|any)\s+(broken|failing|red)\b/i       -> switch to auto, filter=failing, speak count
```

**V2 — Spoken status digest.** "Alfred, status" composes one sentence from data already on hand:
*"Three dirty repos, one failing automation, both Deish endpoints up, 412 thousand tokens today,
31 percent local."* Uses the existing `/api/tts`. This is the single feature that makes the
voice layer feel like it has a job rather than being a demo. S.

Both must respect the existing "speak short acks only" behavior — no reading a dashboard aloud.

---

## 4. Cross-cutting UX

### 4.1 Navigation & state

- View is reflected in `location.hash` (`#dev`, `#auto`, `#deish`, `#ops`) so a view survives
  reload and the browser back button works. Default `#brain`.
- Filter chips and expanded rows persist in `sessionStorage` per view.
- **View switches must be instant.** Render from cached data immediately, then refresh. Never
  block a view switch on a fetch.

### 4.2 The omnibox

`#search-wrap` is already bottom-center on every view. Promote it to a global command bar. Prefix
determines mode, shown as a live chip inside the bar:

| Input | Mode | Behavior |
|---|---|---|
| `text` | SEARCH | existing semantic brain search |
| `Shift+Enter` | ASK | existing local-ollama composed answer |
| `>text` | COMMAND | **new** — fuzzy command palette |
| `@haiku text` | AGENT | existing agent launch, promoted from chat-mode-only to global |
| `alfred, wake up` | WAKE | existing |

Command palette entries (all map to things specced above): `go dev|automations|deish|org|brain`,
`open <project>` (→ Dev, card highlighted), `claude in <project>` (→ §2.1.7), `run <automation>`,
`reindex brain`, `status`. Fuzzy-matched, arrow keys to select, Enter to run. No new backend.

### 4.3 Toasts

None exist today. Every mutating action currently gives no feedback beyond terminal output.

- Container: fixed bottom-right, above the omnibox, `z-index` above `#panel`, max 4 stacked,
  newest at the bottom, `role="status"` `aria-live="polite"`.
- Kinds: `info` (cyan), `success` (green), `warn` (amber), `error` (red). Left accent bar in the
  kind colour, matching the existing HUD frame treatment.
- Auto-dismiss: success/info 4s, warn 8s, **error never** (manual close only — a failed
  automation trigger must not vanish while the user is looking elsewhere).
- Optional `action` button (e.g. "Reindex started" → `[ View ]` focuses the terminal panel).
- Every `[token]` POST in the app gets a toast on both success and failure. No silent mutations.

### 4.4 Keyboard map

Global, active unless focus is in a text input:

| Key | Action |
|---|---|
| `1`–`5` | switch to Mission Control / Dev / Automations / Deish / Org Chart |
| `/` | focus omnibox (search mode) |
| `>` | focus omnibox (command mode) |
| `Space` (hold) | push-to-talk — **existing, must not regress** |
| `Shift`+`Enter` | ask (in omnibox) — existing |
| `` ` `` | toggle terminal panel expand/collapse |
| `r` | refresh the active view |
| `f` | focus the active view's filter chips |
| `Esc` | close panel → dismiss toasts → blur omnibox (in that precedence) |
| `?` | keyboard help overlay (**new** — a HUD-styled modal listing this table) |

`?` opening a help overlay is not optional. Five surfaces with hotkeys and no discoverable map is
a feature nobody uses.

### 4.5 Loading, empty, and error patterns (apply everywhere)

**Loading.** Skeletons, never spinners, and never a blank surface. Structure renders from cached
or local data immediately; only genuinely-remote fields shimmer. Rule: **the slowest data source
on a surface must not gate the fastest.** A GitHub API stall must never blank a git-derived card.

**Empty.** Every empty state has three parts: what is empty (one line), why (one line, only if
non-obvious), and one primary action. Never a bare "No data." Empty-because-good (no dirty repos,
no failing automations) is styled positively — green, not grey.

**Error.** Errors are scoped to the smallest component that failed. Show the actual error message
(it is a single-user localhost tool; the user is the developer, so hiding the message helps
nobody), plus `[ Retry ]`. A component error never blanks its surface.

**Degraded ≠ error.** `gh` unavailable, `az` not logged in, no upstream branch, no brain note —
these are *muted* states with an explanatory tooltip, not red. Overusing red trains the user to
ignore it, which defeats the failing-automation alert that actually matters.

### 4.6 Performance budget

| Endpoint | Budget | Cache |
|---|---|---|
| `/api/projects` | < 500 ms | 15 s |
| `/api/projects/github` | < 2 s | 5 min per slug |
| `/api/automations` | < 2 s | 60 s, **batched per repo** |
| `/api/deish` | < 3 s | 60 s (health probes are the long pole) |
| `/api/org` | unchanged | unchanged |
| `/api/usage` | unchanged | 60 s (existing) |

`/api/org` and `/api/usage` both walk every `.jsonl` under `~/.claude/projects`, and
`/api/projects` will want the same tree for session counts. **Extract a shared `transcriptIndex`
cache** (dir → `{files, mtimes}`, invalidated on a 10s TTL) before adding the third consumer.
Doing this after the fact means three subtly different walkers.

### 4.7 Security (non-negotiable, carried from the existing build)

- Every new mutating endpoint requires `X-Alfred-Token` via the existing `authorize()`
  (`server.mjs:748`). No exceptions, including "harmless" ones like toggling `enabled`.
- Every new `spawn`/`execFile` uses an **args array with `shell:false`**. `gh`, `git`,
  `schtasks` all take args cleanly — there is no reason to build a command string.
- Repo slugs, workflow filenames, automation ids, and cwd paths arriving from the client are
  **validated against the registry / scan results**, never passed through. An id that is not in
  `automations.json` is a 400, not a lookup.
- `cwd` for chat sessions is realpath-validated inside allowed roots (§2.1.7).
- All rendering of server strings (commit subjects, error text, event summaries) uses
  `textContent`, never `innerHTML` — the existing code is careful about this and new surfaces
  render far more untrusted-ish text (commit messages, PR titles) than the old ones did.

---

## 5. Roadmap

Sizes: **S** ≈ under half a day · **M** ≈ 1–2 days · **L** ≈ 3+ days or needs a decision first.

### P0 — next build wave (highest value, lowest risk)

| # | Item | Size | Rationale |
|---|---|---|---|
| 1 | Nav shell: 5-view toggle, hash routing, canvas-persistence rule, shared view-scoped poll scheduler (§1.2) | M | Everything else needs it. Doing it first prevents three surfaces each inventing their own polling and racing each other. |
| 2 | Toast system + `[ Retry ]`/error/empty/skeleton primitives (§4.3, §4.5) | S | Cheap, and every subsequent feature depends on it for feedback. Building it after three surfaces means retrofitting three surfaces. |
| 3 | `GET /api/projects` + Dev surface cards, **local git only** (§2.1.2–2.1.3) | M | Highest daily value on the list. Local git is fast, offline, and always available — no `gh`, no network, no failure modes. |
| 4 | Brain-note freshness on Dev cards (§2.1.5) | S | Makes the `project-note` skill's debt visible. Data already in `index.json`; near-zero cost. |
| 5 | Session count/last-activity per project (§2.1.6) | S | Structural cwd→dir mapping, stat-only, no parsing. Answers "where did I leave off". |
| 6 | Deish surface: estate health probes, product cards from `downloads/`, repo strip (§2.3) | M | Genuinely useful, entirely local + 2 HTTP probes, zero blocked data. Delivers the third pillar in wave one. |
| 7 | Keyboard map + `?` overlay (§4.4) | S | Five surfaces without hotkeys is worse than two with none. |
| 8 | Brain health: uncommitted count + stale-index amber + `[ Reindex ]` (§2.4 E3, E4) | S | 248 uncommitted files in the brain is the highest-consequence unnoticed risk on the machine. |

**P0 explicitly excludes `gh`.** Every P0 item works offline against the local filesystem, git,
and two HTTP probes. That makes the wave fast to build, fast to load, and impossible to break
with a rate limit — and it proves the shell before network variance enters the picture.

### P1 — second wave

| # | Item | Size | Rationale |
|---|---|---|---|
| 9 | `GET /api/projects/github` — PRs, CI, issues on Dev cards, lazy + cached (§2.1.4) | M | High value, but it is the first network dependency; it needs the degraded-state discipline from P0 to already exist. |
| 10 | Automations: `automations.json`, `GET /api/automations`, list UI, GitHub-kind status + `[ Run now ]` (§2.2) | M | The 9 existing workflows make this immediately populated and useful on day one. GitHub kind first — its history is real and free. |
| 11 | Run ledger + local-agent kind + org-chart automation badge (§2.2.4, §2.5 E7) | M | Turns the hub from a viewer into a runner. |
| 12 | "Open Claude here" — cwd-scoped chat sessions (§2.1.7) | M | Big UX win, but M-not-S because the untrusted-directory behavior is genuinely unknown and must be verified empirically before it ships. |
| 13 | `Business/` brain folder + chip + 4 seeded notes + `New-Business.md` template (§2.3.4) | S | Gives the Deish surface its qualitative half and gives the graph a new cluster. Zero indexer changes. |
| 14 | Deish build/deploy strip via shared `gh` cache (§2.3.2) | S | Free once #9/#10 land — same cached call. |
| 15 | Org chart cost rail (§2.5 E5) + project chips (E6) | M | Makes the framework's economic thesis visible. |
| 16 | Omnibox command palette (`>`) (§4.2) | M | Becomes worthwhile once there are five surfaces and dozens of projects/automations to jump to. |

### P2 — later

| # | Item | Size | Rationale |
|---|---|---|---|
| 17 | `schtasks` registrar: create/update/delete scheduled tasks from the UI (§2.2.1) | M | Needs elevation handling and a careful uninstall story. Until then, `schtasks` by hand is fine and the UI still *shows* the schedule. |
| 18 | `[ Import from GitHub ]` — scan `gh workflow list` across repos, propose registry entries | S | Nice-to-have once the registry format has proven itself. |
| 19 | Licensing stats behind `az login` + new read-only `Get-LicenseStats.ps1` (§2.3.6) | L | The only path to real business numbers, but it needs a new script, an auth story, and read-only guarantees against tables that support tooling currently mutates. |
| 20 | Voice: navigation intents + spoken status digest (§3) | S | Small, delightful, but valueless until there are surfaces to navigate to. |
| 21 | Graph freshness colouring (§2.4 E2) | S | Pure polish. |
| 22 | PTY upgrade: `node-pty` + vendored `xterm.js` | L | **Requires explicit CEO approval — a native npm dependency.** Already flagged as the standing stretch goal. Unblocks real TUIs in the terminal panel. |
| 23 | Automation budget enforcement (hard token cap with graceful stop) | M | Only worth building after the ledger shows real overrun patterns. |

---

## 6. Non-goals and rejected ideas

Each of these was considered and rejected. Re-proposing one requires new data, not new enthusiasm.

| Rejected | Why |
|---|---|
| CRM / client / deal pipeline UI | No customer data exists anywhere on this machine. The brain's `Business/Pipeline.md` is the honest version. |
| Revenue, MRR, or units-sold tiles | Not queryable without `az login`; estimating or extrapolating them would be fabrication. |
| Website analytics / traffic / funnel | `website/privacy/index.html` explicitly commits to zero tracking. Adding analytics is a legal-copy change, not a dashboard feature. |
| Issue tracker / kanban board | `gh issues` is the tracker and it currently has 0 open issues across the repos. Building a second one guarantees drift. |
| Multi-user, auth, or LAN/remote access | The server binds `127.0.0.1` by design because it is a shell-execution bridge. Non-negotiable. |
| Rewriting `ui.html` in React/Vue/Svelte | Two files, no build step, instant startup. A framework buys nothing here and costs the zero-dependency property that makes install trivial. |
| A scheduler inside `server.mjs` | No durability, no missed-run catch-up, no history if the box sleeps. GitHub Actions and Task Scheduler already solve this and already have run history. |
| Email / calendar / Slack integration | No credentials configured, no MCP wired for them, and none of it answers a question this product exists to answer. |
| Mobile / responsive layout | Single-user desktop tool on a 3-monitor rig. Responsive work is pure cost. |
| Editing brain notes in the UI | Scope trap. The brain is edited by Claude and by the user's editor. The UI creates notes from templates (§2.1.5) and reads them; it does not become a markdown editor. |
| Auto-committing the brain on a timer | The 248-file drift should be **surfaced** (§2.4 E4), not silently resolved. An automatic commit of the user's memory without review is the wrong default. |
| Per-project cost attribution in dollars | Transcripts carry token counts, not prices, and price tables drift. Show tokens — they are the number that is actually true. |
| Real-time WebSocket/SSE push | The existing serialized-polling model works and its failure modes are already understood and fixed. A transport rewrite buys latency nobody has asked for. |
| A sixth surface (Trading / Tickr) | Real interest, real projects — but Tickr and the PineScript work are already covered as Dev cards. A dedicated surface needs live market data this product does not have. |

---

## 7. Open questions for the CEO

1. **Untrusted-directory behavior** for `claude -p` outside home (§2.1.7). Blocks P1 #12 until
   verified empirically. Implementers should test before designing around it.
2. **`ALFRED_PROJECT_ROOTS`** — should the Dev surface scan only `_Projects\`, or also
   `C:\dev\` (which holds build output, likely noise) and `~/Scripts`?
3. **Alfred-Brain remote** still points at `dpatel-93/DP_Obsidian_Vault` with 248 uncommitted
   files. Rename the remote, or is the drift intentional?
4. **`Alfred-v4` (`dpatel-93/jarvis`)** appears superseded by `Alfred` (`dpatel-93/alfred`).
   Archive it, or should it keep a Dev card?
5. **P2 #22 (node-pty)** — the standing stretch goal needs an explicit yes/no on adding the first
   native npm dependency.

---

## Backlog addendum (2026-08-08, CEO) — P1: THE WAKE BRIEF

On "Alfred, wake up" (and a manual [Brief me] affordance + optional first-wake-of-the-day auto-trigger),
Alfred delivers a spoken + rendered morning brief — "here's where we left off, sir; here's the day":

1. **Weather** — today for the user's locale (DP_dailybrief may already carry it — see brief-scout
   report; else open-meteo.com, free/no-key, one HTTP call)
2. **News** — latest output of the existing DP_dailybrief pipeline (github dpatel-93/DP_dailybrief,
   5 live Actions workflows; fetch path per brief-scout report)
3. **Where we left off** — synthesized from: auto-memory captures (~/.claude session learnings),
   brain Projects/* Current State sections changed in the last ~48h, and yesterday's git activity
   across ALFRED_PROJECT_ROOTS (transcriptIndex + /api/projects data already exist)
4. **What's on deck** — /plan-day logic (top 3-5 highest-leverage items), rendered as checkable rows

Delivery: composed by the ask engine (haiku) into a ~45-90s spoken brief (Kokoro) + a structured
brief panel (sections above, per design system); brief text saved to the brain under
DailyUpdates/Brief-YYYY-MM-DD.md so history accrues. Wake without brief stays available
("Alfred, wake up quietly" skips it; "Alfred, morning brief" triggers it standalone).
Server: GET /api/brief (compose+cache 30min), token-gated POST /api/brief/refresh.
Constraints: same security invariants; degrade gracefully per-section (missing news ≠ broken brief);
no new dependencies without CEO approval.

## Backlog addendum (2026-08-08, CEO) — P1: ORG CHART DELEGATION DEPTH
/api/org currently resolves one parentage level (session -> its subagents via path structure).
Extend to FULL RECURSIVE CHAINS: a subagent's own subagents/ directory nests the same way —
walk it to arbitrary depth, emit parent on every node, and render multi-level trees in the
swimlane chart (manager node -> its employee nodes beneath it within the lane band, edges
per level, green pulse only on the active segment of a chain). Also add a per-node "hired by"
line in the inspector panel. Rationale: chain-of-command visibility — the CEO should see
managers staffing work down, not just C-suite -> manager edges. Pairs with the CLAUDE.md
chain-of-command rule (briefs must name what gets delegated down).

### Wake Brief — data integration facts (brief-scout, 2026-08-08)
- DP_dailybrief: 5 workflows all green; Daily Brief cron 8am EST; output = data/last_digest.json
  {timestamp, articles[{index,title,link,summary,source,category,published}]}, 65+ feeds, 15 categories.
- CATCH: digest is Telegram-first — JSON lives in the Actions runner; the local copy is stale (Mar 31).
  REQUIRED P1 PRE-WORK: one-step change in DP_dailybrief's Daily Brief workflow to publish
  last_digest.json fetchably (commit to repo or upload-artifact; commit preferred — then Alfred fetches
  `gh api repos/dpatel-93/DP_dailybrief/contents/data/last_digest.json` or raw URL). Small PR, separate repo.
- Weather NOT in the digest — use open-meteo.com (free, keyless) as its own brief section.
- Bonus available later: Market Brief + Sports Brief workflows exist — optional brief sections.

### Wake Brief — REVISED integration (2026-08-08, CEO decision): local brief agent, no Telegram/Actions dependency
Instead of fetching the GitHub-published digest, Alfred runs its OWN digest flow on demand:
- `brief-digest` runner (node, zero new deps): reads the FEED LIST from the DailyUpdates repo's own
  config (single source of truth — local clone at _Projects/DailyUpdates; parse its feeds/categories
  so the two systems never drift), fetches a prioritized subset (Azure/AI/security/markets first,
  ~15-25 feeds, parallel, 5s per-feed timeout, tolerate failures), lean RSS/Atom XML parsing.
- Summarization = INTERN tier (local ollama qwen2.5:1.5b-instruct via intern-run pattern, batched,
  ledger-logged); composition of the final spoken brief = haiku ask engine. Org chart on display.
- Trigger: on wake (if today's brief not yet built), manual [Brief me], and optionally a
  pre-warm at first machine activity via the startup launcher (build quietly so wake is instant).
- Cache: brain DailyUpdates/Brief-YYYY-MM-DD.md + a digest JSON alongside; same-day wake reuses it.
- Degradation: feed failures shrink sections, never break the brief; if ollama down, haiku
  summarizes directly (more tokens, still works).
- The GitHub Actions -> Telegram pipeline continues UNCHANGED for phone delivery; no PR needed.
  (The publish-digest PR idea is superseded.)
