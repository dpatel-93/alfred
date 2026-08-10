---
description: Token usage report — cloud consumption by day/model from local transcripts, local Ollama intern load, and the cloud-vs-local ratio. Args: number of days (default 7).
argument-hint: "[days]"
---

Run the Alfred v4 usage report and interpret it for me:

1. Execute: `node ~/.claude/helpers/usage-report.mjs $ARGUMENTS`
2. Summarize in 2-3 sentences: which models burned the most, the trend across days,
   and what percentage of token load the local interns carried.
3. If cloud usage looks heavy on Fable/Opus for work that could have gone to
   Sonnet/Haiku/interns, say so specifically and suggest the routing adjustment.
4. Remind the operator that official plan limits (session/weekly %) come from the built-in
   `/usage` command — this report tracks consumption, not remaining allowance.
