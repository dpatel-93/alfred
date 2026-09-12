---
name: alfred-agent-orchestration
description: "Alfred — native-primitives-only orchestration framework (org-chart routing, self-evolution). Repo dpatel-93/alfred, local _Projects\Alfred. R3 (2026-08-11) added the first behavioural evals. alfred-flow/claude-flow lineage retired 2026-08-07."
metadata: 
  node_type: memory
  type: project
  originSessionId: 8455ca54-06de-4239-8a96-18ed0da22951
  modified: 2026-08-08T00:48:54.972Z
---

**Alfred v4 (current, built 2026-08-07)** — thin framework over NATIVE Claude Code primitives only: Agent tool subagents with explicit model tiers, Agent Teams (env flag enabled), Workflow tool, hooks, skills, commands. Spec lives in `C:\Users\dishi\CLAUDE.md`; global personal instructions in `~/.claude/CLAUDE.md`. Portable snapshot repo: **`dpatel-93/alfred`** (private GitHub, master branch) with idempotent `install.ps1` — re-sync + push after meaningful `~/.claude` changes.

**Routing**: org-chart model ([[user-org-chart-model-routing]]) — Fable=C-suite orchestrator, Opus=VPs, Sonnet=managers, Haiku=employees, local Ollama=interns (always reviewed). Agent count dynamic, never capped; fan out freely at cheap tiers.

**Self-evolution loop**: hooks (absolute paths in settings.json — SessionStart auto-memory import + obsidian-launch + config-doctor; Stop auto-memory sync; SessionEnd obsidian-memory-sync) capture to memory + Obsidian vault → repeated workflows (2+ times) get promoted to skills/commands via the `evolve` skill → additions logged to vault `Claude-Code/Evolution-Log.md`.

**Inventory (2026-08-07)**: 16 model-tiered agents (fictional "self-learning" content stripped); skills incl. evolve, ollama-interns, azure-runbook, graph-api-rest, ps-http-server, zero-cost-azure, project-note; 10-command prompt library (/fanout /review-loop /harvest /deep-debug /azure-audit /explain /plan-day /pr-desc /intern /status); helpers: statusline.cjs (rewritten native), auto-memory-hook.mjs, obsidian-*.cjs, config-doctor.mjs (policy pins model claude-fable-5[1m]).

**History (condensed)**: Alfred v3.x was a private rebrand of `ruvnet/claude-flow` (renamed `ruvnet/ruflo` Feb 2026). Independent audits (roman-rr gist; ruflo issues #1514, #1748) found ~97% of its MCP tools were stubs, benchmarks fabricated, net token cost NEGATIVE (+15-25k/session). The package was never actually installed here — native Claude Code did all real work. 2026-07-21 session slimmed config (agents 92→29, commands 88→0) but left CLAUDE.md docs stale, causing docs-vs-reality contradiction. 2026-08-07: full de-Alfred completed — 13 ghost-MCP agents archived, both CLAUDE.md files rewritten honest, hooks fixed to absolute paths (previously silently dead outside home dir), .claude.json case-dup project keys merged, MCP consolidated to ~/.mcp.json. Backups: `~/.claude/backups/pre-v4-20260807/` and `de-alfred-20260807/`.

**R3 (2026-08-11) — first behavioural evals.** Prompted by two external critiques: "this is a hierarchical swarm already done across the industry" and "a wrong premise at the top derails everything below it". Both were correct. Built `brain/routing-eval.mjs` (24 ground-truth cases, circularity guard) and `brain/orchestration-eval.mjs` (20 scenarios, completion-per-100k metric, never run). Full 19-section writeup at `brain/R3-FINAL-REPORT.md` — read it before re-litigating any of this.

Durable lessons, not in the code:
- **Structure beats exhortation, measured.** Prose telling the router to weigh stakes never entered three consecutive routers' reasoning. Three REQUIRED emitted fields (`stakes`, `blocking_premises`, `gate`) worked first try. A field that must be emitted is falsifiable; one that must be remembered competes with everything else.
- **Three of four failures in that cycle were invisible until a check written for a DIFFERENT purpose caught them.** Argues for cheap checks everywhere; does NOT validate the stakes-gating threshold, which is still design rather than measurement.
- **Never let an eval's denominator move with a ground-truth edit.** A selector reading only `expect[0]` silently shrank the over-engagement population 8→6, and the resulting "6/6" got reported as a win when the honest fixed-denominator number was 7/8.
- Fable was principal architect/adjudicator for R3 and ruled against its own prior position twice.
- **Nobody should quote the 95.8% routing figure outside this repo** — Layer 2 never ran, so there is still no evidence the org beats a single agent.

**R3.2 VERDICT (2026-08-12) — settled, do not re-litigate.** 16 head-to-head runs, Alfred's full org vs a single agent carrying the same rules. **Quality was identical in every configuration tested.** Cost: small work 1.48x, big single-discipline work 1.02x, big cross-discipline work 0.87x. Four hypotheses about where the cost lives; three were wrong and each was only falsified by building the fix and measuring it:

1. the org chart (~3,100 tokens) — a lazy-loading gate bought 4%
2. charter length — a 13x cut changed small-task cost by 0%
3. the C0-C4 classification — removing it made cross-domain work 32% WORSE (it picks a cheaper shape: 3 VPs reconciling internally beats 5 flat employees)
4. **the verification discipline — this is the real cost, and it is the product, not overhead.** Both charter variants cost ~606k on a typo; a bare agent costs 414k. The gap is grep-for-other-instances, check-git, confirm-the-fix.

Shipped: a **breadth gate** at step 0 of the CoS charter (engage the org only when work spans specialties that would each read different material — breadth, NOT size; a 12-file single-discipline migration stays in-session), org-index stripped from all 33 employee charters, dr-manager and vendor-manager folded as single-employee relays. Full evidence in `brain/R3-FINAL-REPORT.md` §20-24. The only lever left is scaling verification to stakes, which is a risk-appetite decision.

**Never**: reinstall alfred-flow/ruflo/claude-flow or any external swarm orchestrator. Improvements are EDITS to existing artifacts (CLAUDE.md, skills, commands), never new frameworks.

**Note**: `dpatel-93/alfred` (old repo) and `dpatel-93/claude-code-config` are superseded by `dpatel-93/alfred` as the portable setup; old repos kept as history.
