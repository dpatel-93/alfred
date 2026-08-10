---
name: "Self-Improve"
description: "Audit Alfred (agents, skills, hooks, commands, CLAUDE.md, MCP config) against the latest reputable Anthropic + Claude Code best practices and propose/apply concrete updates with cited sources. Use when the user asks to 'self-improve', 'audit the setup', 'check for updates', or 'modernize Alfred / our skills / our agents'. Defaults to a dry-run report; only writes changes when the user explicitly confirms."
---

# Self-Improve

## What this skill does

Performs a structured audit of the local Alfred / Claude Code setup
(`~/.claude/agents/`, `~/.claude/skills/`, `~/.claude/commands/`,
`~/.claude/helpers/`, `~/.claude/settings.json`, `~/.mcp.json`,
project + user `CLAUDE.md`) and compares it against the current state of the art
in Claude Code, the Anthropic Agent SDK, and the broader open-source
agent-orchestration community.

Produces a prioritized punch list of concrete updates, each with:

- **What to change** (file path + diff hint)
- **Why** (one sentence, plus the specific best-practice this aligns with)
- **Source** (URL — must be reputable; see "Source rules" below)
- **Risk** (low/med/high — does this break existing flows?)
- **Effort** (trivial/small/medium/large)

By default this is a **dry-run report**. Apply changes only after the user
confirms — never auto-rewrite agents/skills/hooks unsolicited.

## Source rules (REPUTABLE ONLY)

A change must cite at least one of these tiers. Higher tiers carry more weight; a
single Tier-1 source is enough, while Tier-3 needs corroboration.

### Tier 1 — Anthropic-official (highest trust)
- `docs.anthropic.com`, `platform.claude.com`, `code.claude.com`
- `anthropic.com/engineering/*` blog posts
- `github.com/anthropics/*` repos (claude-code, claude-agent-sdk-python, etc.)
- Official Anthropic release notes / changelogs / model cards

### Tier 2 — Reputable framework / spec maintainers
Any GitHub project that meets the bar **and** is actively maintained (commit in
the last 90 days). Examples that qualify today:
- **Spec / standards bodies**: `modelcontextprotocol.io` and `modelcontextprotocol/*`
- **Major agent frameworks** (≥ ~3k stars): LangChain/LangGraph, CrewAI, AutoGen,
  OpenHands, Letta/MemGPT, smolagents, Agency Swarm
- **Verified Claude Code ecosystem repos**: awesome-claude-code variants, the
  spillwavesolutions tooling, well-known plugins/skills with recent traction
- **Cloud vendor SDKs** (AWS, Azure, GCP) when the change involves their hosted
  agent runtime

### Tier 3 — Community signals (use only when corroborated)
- Individual GitHub repos with **at least 200+ stars OR 50+ forks** and a commit
  in the last 90 days. Below that bar, don't cite — it's noise.
- Posts by Anthropic employees on verified accounts (X/LinkedIn/Bluesky), linking
  to a persistent post (not a screenshot)
- Articles on engineering blogs of well-known companies (Stripe, Cloudflare,
  Shopify, Vercel, Notion engineering, Datadog, etc.)
- Conference talks with published video + slides (KubeCon, ICML, AI Engineer
  Summit, AnthropicCon)

**Tier-3 alone is not enough for a recommendation. Pair it with a Tier-1 or
Tier-2 source, OR cite at least two independent Tier-3 sources that agree.**

### Hard rejects
- Random Medium / Substack / dev.to posts with no author credentials
- AI-generated "best practice" listicles
- GitHub repos under the star/fork threshold
- Anything you can't link to or verify
- "I heard from a friend" / unsourced LLM summary

### Quick verification commands
Before citing a GitHub repo, verify the bar:

```bash
# Stars + last commit
gh repo view OWNER/REPO --json stargazerCount,pushedAt
# OR via API
curl -s https://api.github.com/repos/OWNER/REPO | jq '{stars: .stargazers_count, pushed: .pushed_at, archived: .archived}'
```

A repo that's archived or hasn't been pushed in 90+ days does not qualify
regardless of star count.

## Audit dimensions

Walk all 8 dimensions on every invocation:

| # | Dimension | What to check |
|---|-----------|---------------|
| 1 | **Agents** | Frontmatter format, `isolation`/`run_in_background` defaults, model references, deprecated tool names |
| 2 | **Skills** | YAML frontmatter (name + description required), progressive disclosure, missing trigger keywords |
| 3 | **Hooks** | Exit code semantics (PreToolUse: 2 = block, 0 = allow), JSON return format (decision/reason deprecated → exit codes), timeout values |
| 4 | **MCP** | Transport (stdio vs Streamable HTTP), auth pattern, tool ordering stability for cache hits |
| 5 | **CLAUDE.md** | Length (<500 lines ideal), modularity via `@imports`, project vs user separation |
| 6 | **Settings** | Permission allowlist hygiene, model defaults match latest releases |
| 7 | **Commands** | Overlap with skills (Anthropic now prefers skills + auto-discovery), legacy patterns |
| 8 | **Memory** | Stale entries (>90 days), conflicting facts, missing namespaces |

## Workflow

```
1. PROBE (parallel, read-only)
   - List ~/.claude/agents/**/*.md
   - List ~/.claude/skills/**/SKILL.md
   - Read ~/.claude/settings.json + ~/.mcp.json
   - Read user CLAUDE.md + project CLAUDE.md (if any)
   - Read ~/.claude/helpers/hook-handler.cjs (and other helpers)

2. RESEARCH (parallel, with Firecrawl)
   - Fetch docs.anthropic.com/en/docs/agents-and-tools/* — current spec
   - Fetch github.com/anthropics/claude-code releases — recent flags/features
   - Fetch anthropic.com/engineering — recent posts on patterns
   - Search github.com/trending for new high-signal multi-agent repos
   - Cross-reference against current dimensions list above

3. DIFF
   - For each dimension, list discrepancies between local state and current docs
   - Score each by impact × confidence

4. REPORT
   - Markdown table per dimension: Item | Current | Recommended | Source | Risk
   - Top 3 highest-leverage items called out separately
   - "What I'd skip and why" section (so user sees the full search)

5. (OPTIONAL) APPLY
   - Only if user types "apply" or names specific items
   - Use Edit tool, never Write, for existing files
   - Update Obsidian Decisions + Patterns folders with rationale
   - Update memory MEMORY.md index if a new stable pattern emerged
```

## Dry-run example

```
> /self-improve

📡 Probing local state... (98 agents, 36 skills, 88 commands found)
🔬 Researching anthropic.com, github.com/anthropics, MCP spec...

═══ HIGH PRIORITY ═══
1. agents/swarm/*.md — none specify `isolation: worktree` for spawned children
   → Source: docs.anthropic.com/en/docs/claude-code/sub-agents (Apr 2026)
   → Risk: low (additive)
   → Effort: trivial (10 min, 3 files)

2. helpers/hook-handler.cjs:143 uses exit code 1 to block dangerous commands
   → Per spec, exit 2 is required to actually block; exit 1 is logged + ignored
   → Source: docs.anthropic.com/en/docs/claude-code/hooks
   → Risk: low (fixes existing bug)
   → Effort: trivial (1-line change)

═══ MEDIUM PRIORITY ═══
... etc
```

## Anti-patterns

- **Don't** apply changes silently — always show the diff first
- **Don't** make changes inside the alfred-flow npm package (out of scope —
  PR upstream instead)
- **Don't** delete agents/skills the user wrote without asking, even if "stale"
- **Don't** invent sources — if you can't find a citation, drop the recommendation
- **Don't** run more than once per session unless explicitly re-invoked

## When to invoke

- User asks: "self-improve", "audit alfred", "any updates needed?", "modernize
  the orchestration layer", "are our skills current?"
- After a major Anthropic release (new Claude Code version, new SDK, new MCP spec)
- Quarterly hygiene check on the `.claude/` directory

## When NOT to invoke

- Inside a focused implementation task — would derail the work
- Right after the user just made changes to `.claude/` — let them settle
- When the user asks about a specific tool/skill (use the targeted skill instead)

## Reference

- Anthropic Claude Code docs: docs.anthropic.com/en/docs/claude-code
- Anthropic engineering: anthropic.com/engineering
- MCP spec: modelcontextprotocol.io
- Claude Agent SDK: github.com/anthropics/claude-agent-sdk-python
- This pattern was created 2026-04-16 as part of Alfred's first formal
  self-audit (see Obsidian Decisions/2026-04-16 — Adopt Worktree + Async + Evaluator)
