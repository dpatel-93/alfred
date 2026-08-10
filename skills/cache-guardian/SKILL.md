---
name: "Cache Guardian"
description: "Enforce stable prompt prefix ordering across swarm members so Claude's prompt cache hits at 90%+. Use when designing system prompts, agent templates, or multi-agent message layouts where each agent shares overlapping context (CLAUDE.md, MCP tool list, project files). Cuts token cost by 50–80% on repeated sessions."
---

# Cache Guardian

## What this skill does

Audits and enforces **prompt cache stability** for Claude Code agents. The Anthropic
prompt cache has a 5-minute TTL and rewards keeping the prompt PREFIX byte-for-byte
identical across calls. Cache hits cost ~10% of a fresh call.

Properly designed swarms hit 80–95% cache rates. Poorly designed ones thrash the
cache and pay full price on every spawn.

## When to use

- Designing a new agent template (especially one that will be spawned often)
- Reviewing why a multi-agent session is burning tokens fast
- Building system prompts that wrap user context
- Any agent that injects timestamps, UUIDs, or counters near the top of the prompt

## The 4 cache-stability rules

1. **Stable content goes FIRST** — system prompt, CLAUDE.md, agent definition,
   tool list. These should be identical across every spawn within a session.

2. **Volatile content goes LAST** — user prompt, current file contents, current
   timestamp, agent counter. Cache breaks at the first byte of difference, so push
   churn to the end.

3. **No timestamps in stable sections** — `Generated at 2026-04-16T15:23:45Z` in
   the system prompt invalidates the cache on every call. Move it to the user
   message or omit it.

4. **Same MCP tool order every time** — if the alfred-flow MCP server reorders its
   tool list between calls, the entire system prompt recaches. Pin tool ordering.

## Audit checklist for an agent definition

- [ ] No `${Date.now()}`, `${uuid()}`, or counters in the agent body
- [ ] Hooks `pre`/`post` shell blocks don't echo timestamps into the agent context
- [ ] System prompt header is byte-stable across calls (no env var interpolation)
- [ ] User-supplied input is appended at the end, not interleaved
- [ ] If the agent uses `current_date` / `git_commit`, it's in a clearly marked
      "volatile context" section near the bottom

## Common offenders in Alfred today

- Coordinator `pre` hooks echo `$(date)` into memory — fine if scoped to memory
  store, problematic if echoed into the agent's prompt
- Some `${TASK_ID}` interpolations near the top of agent definitions
- Agent definitions that include "Last updated: …" comments in their body

## Quick verification

Use the Anthropic message dashboard (or `prompt_cache_read_input_tokens` in the
API response) to confirm cache hits. Target: cached_tokens / input_tokens >= 0.8
within a session.

## Reference

- Anthropic prompt-caching docs:
  https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Walturn analysis: Claude Code achieves ~92% cache hit rate, ~81% cost cut
- Alfred 3-tier router: Tier 2 (Haiku) and Tier 3 (Sonnet/Opus) both benefit
