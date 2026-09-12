---
name: feedback-scraping-and-tooling-routing
description: Firecrawl is primary for all web fetch/search; Crawl4AI (crwl CLI) only as backup or for bulk crawl jobs. Browser automation = playwright-cli skill + Chrome extension only.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ae7ff2ab-bff6-4132-9c14-47a43e2f9f6d
  modified: 2026-08-24T03:23:25.249Z
---

Decisions from the 2026-08-23 tooling consolidation (CEO direction):

- **Web scraping/search: Firecrawl FIRST, always.** Crawl4AI (`crwl` CLI, installed via uv) is
  the fallback and the bulk-crawl tool — reach for it only when Firecrawl fails, or when a job
  is high-volume enough that Firecrawl usage/cost matters.
- **Browser automation: exactly two tools.** `playwright-cli` skill for headless/testing work,
  Claude-in-Chrome for interactive browsing. The `browser` skill (alfred-flow legacy) and the
  `playwright` plugin were deleted 2026-08-23 — do not recommend or reinstall them.
- **Design surface:** Figma MCP deemed redundant (21st.dev + Stitch + Claude Design + open-design
  cover it) — user is disconnecting it at claude.ai. Penpot rejected. `org-index` skill deleted.
- **Voicebox rejected** for Alfred TTS (GPU cost/latency vs instant SAPI) — uninstalled 2026-08-23.
  Alfred keeps Windows SAPI via alfred-speak.mjs.

**Why:** avoid duplicated tool surfaces; every overlapping tool adds routing ambiguity and
startup context. **How to apply:** when a task could use one of several overlapping tools, use
the designated primary above; never propose the deleted alternatives. See
[[project-selfhosted-lab]] for the app-level outcomes.
