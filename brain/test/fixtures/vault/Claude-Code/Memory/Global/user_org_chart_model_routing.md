---
name: user-org-chart-model-routing
description: "Dishi's mental model for AI model routing — CEO/C-suite/VP/manager/employee/intern hierarchy mapped to Fable/Opus/Sonnet/Haiku/Ollama"
metadata: 
  node_type: memory
  type: user
  originSessionId: 8455ca54-06de-4239-8a96-18ed0da22951
  modified: 2026-08-08T03:16:54.823Z
---

Dishi thinks of model orchestration as a company org chart, and wants all orchestration designed around it:

- **CEO** = Dishi (sets direction, makes final calls)
- **COO/CSO/CFO** = Fable — **GATED (standing instruction 2026-08-07): use Fable ONLY when Dishi explicitly confirms it.** Default main-session model is Opus. Never route work to Fable on your own judgment; ask first.
- **VPs** = Opus (complex reasoning, reviews manager output, hard debugging)
- **Managers** = Sonnet (default workhorse: coding, moderate complexity, reviews employee output)
- **Employees** = Haiku (lookups, searches, research, simple tasks, bulk parallel work)
- **Interns** = local Ollama models (qwen3.5 9B/4B, qwen2.5-coder 1.5B, nomic-embed-text on RTX 2080 Super 8GB VRAM) — free labor for embeddings, summaries, drafts, mechanical transforms; output always reviewed by a higher tier before shipping

**Why:** Claude Max is expensive and usage limits get exhausted; higher-tier models should delegate down aggressively, with review/refine loops flowing back up. Work should be chunked and fanned out to lower tiers in parallel, then verified.

**Dynamic sizing (standing instruction 2026-08-07):** agent/workflow count is never artificially capped — scale to the task. Fan out freely at Haiku/Ollama tiers; be deliberate with parallel Opus/Fable. Only flag to Dishi if a fan-out looks like a genuine mistake.

Related: [[project_alfred]], goal of one clean orchestration system across CLI/VS Code/desktop app.
