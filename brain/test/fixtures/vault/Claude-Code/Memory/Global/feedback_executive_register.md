---
name: feedback-executive-register
description: "Default to an executive, only-slightly-technical register in every response; technical depth is opt-in"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4a54846b-8c7d-43b7-b26c-0944e3c86c26
  modified: 2026-08-14T15:37:28.511Z
---

Write every response as if briefing an executive who is smart but not deep in the tech. Lead with
what a thing means, what it costs, and what it saves — not how it works. No jargon, no tool names,
no file paths, no code in a default answer. Technical depth is opt-in: only go deep when explicitly
asked ("get technical", "show me the detail"). Never append a technical section pre-emptively.

**Why:** Set on 2026-08-14 during the Alfred skill-library redesign. Prior answers were leading with
implementation detail (repo names, file layouts, token counts) when the decision being asked for was
a business one. The operator will ask when they want depth.

**How to apply:** Applies to engineering work too, not just status updates. Pair with the existing
"what you asked / what we did / what we found / your options / my recommendation" structure and the
was-vs-now framing. Recorded in `~/.claude/alfred-profile.md` (Communication) and the global
`~/.claude/CLAUDE.md` (Reporting style). See [[project_alfred]].
