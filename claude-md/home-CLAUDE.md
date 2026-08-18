# Alfred v4 — Native Orchestration Framework

A thin layer over native Claude Code primitives — no external orchestration packages, no custom CLI, no npm dependency. Improvements to this framework are edits to this file, not rebuilds of new tooling.

---

## Org-Chart Model Routing

| Rank | Model | Domain Examples | Responsibility |
|---|---|---|---|
| **CEO** | Dishi (human) | — | Direction, approvals, strategy |
| **C-suite (Main Session)** | Fable (GATED) or Opus | — | Orchestration, architecture, synthesis — never bulk work |
| **VPs** (5 domain leads) | Opus | CTO, CSO, CFO, COO, Architect | Hard decisions in their domain, review Manager work |
| **Managers** (10-15 leads) | Sonnet | Backend, DevOps, QA, Data/ML, Infra, etc. | Task breakdown, oversee Employees, code review |
| **Employees** (20-30 ICs) | Haiku | Developers, Engineers, Specialists | Implementation, bug fixes, unit testing |
| **Interns** | Local Ollama (qwen3.5, qwen2.5-coder) | Drafts, summaries, embeddings | Free work — always reviewed before use |

Delegation Rules:
- **CEO directs VPs** on strategy and major decisions. VPs handle their domain autonomously.
- **VPs delegate to Managers**, breaking work into coherent features/systems. Managers report back on progress.
- **Managers delegate to Employees**, who implement concrete tasks in parallel. Managers review and approve.
- **Employees can offload Interns** for mechanical work (summaries, drafts, bulk transforms).

Technical Rules:
- Spawn independent subagents in parallel (one message, multiple agents).
- Pass `model` explicitly per the table — never default silently.
- Use worktree isolation (`isolation: "worktree"`) when parallel agents write code.
- **Review loop** before shipping: Employee work → Manager review → VP sign-off (or Employee → Manager → CEO for major changes).
- **Intern output is draft-only** — never ship Ollama output directly; always reviewed by Employee tier.
- Route intern work through `node ~/.claude/helpers/intern-run.mjs <model> "<prompt>"` for logging in `/tokens`. Interns are batch workers (cold load ~1-2min), so batch calls, not one-offs.
- **Dynamic agent count** — scale freely at Employee/Intern tier. Be deliberate with Opus/Fable parallelism (that's where token burn happens). Flag CEO only if a fan-out looks like a mistake.

---

## Self-Evolution Loop

The framework is meant to grow itself, not be rebuilt:

- **Capture**: `SessionStart`/`Stop`/`SessionEnd` hooks in `~/.claude/settings.json` (absolute paths) auto-capture session learnings to memory and to the Obsidian vault.
- **Promote**: when Claude notices the same workflow performed ~2+ times, it should proactively create a skill or command for it using the `/evolve` skill, and log the addition in the vault under `Claude-Code/`.
- **Constrain**: orchestration changes are edits to this file — never a new framework, package, or CLI.

---

## Structure

| Location | Contents |
|---|---|
| `~/.claude/agents/` | Model-tiered agent roster |
| `~/.claude/skills/` | Skills |
| `~/.claude/commands/` | Prompt library / slash commands |
| `~/.claude/helpers/` | `statusline.cjs`, `auto-memory-hook.mjs`, `obsidian-*.cjs`, `config-doctor.mjs` + `config-policy.json` |
| `C:\Users\dishi\OneDrive\Desktop\_Projects\DP_Obsidian_Vault` | The evolving brain — vault for patterns, decisions, learning notes |
| GitHub: `dpatel-93/alfred` (private) | Portable repo for any machine — Alfred: the vault-brain UI/search/voice (`jarvis/` dir, being renamed) plus this orchestration framework. One name, one butler. |

---

## Hard Rules

- NEVER commit secrets, credentials, or `.env` files.
- NEVER create files unless they're absolutely necessary for achieving the goal.
- ALWAYS prefer editing an existing file to creating a new one.
- ALWAYS read a file before editing it.
- NEVER proactively create documentation files (`*.md`) or README files unless explicitly requested.
