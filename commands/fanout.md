---
description: Decompose a task into independent chunks and run them as parallel subagents at the cheapest tier that can handle each chunk, then synthesize the results.
argument-hint: [task description]
---

Task to fan out: $ARGUMENTS

1. Break the task above into independent, non-overlapping chunks. Independent means chunk B does not need chunk A's output to start. If the task is inherently sequential, say so and do not fan out — run it normally instead.
2. For each chunk, pick the cheapest tier that can do it correctly, per the org-chart model: Haiku for lookups/search/simple transforms/research, Sonnet for real coding or moderate reasoning, Opus only for chunks that need hard debugging or architectural judgment. Default to Haiku unless a chunk clearly needs more.
3. Spawn all chunk agents in a single message with multiple Agent tool calls so they run in parallel. Each agent prompt must be self-contained: state the specific chunk, the relevant file paths, and what "done" looks like for that chunk. Do not assume the subagent has any context from this conversation.
4. After all agents return, read every result yourself before reporting anything. Do not just relay agent summaries verbatim — check that file edits actually match what was claimed.
5. Synthesize: merge the results into one coherent answer or diff. Call out any conflicts between subagent outputs (e.g. two agents touched the same file) and resolve them yourself rather than leaving both changes in place.
6. Report back a short summary of what was split, which tier handled each piece, and the combined outcome — not a blow-by-blow transcript of each agent.
