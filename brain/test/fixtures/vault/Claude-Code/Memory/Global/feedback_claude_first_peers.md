---
name: feedback-claude-first-peers
description: "Global protocol — Claude models first for everything; ask before every single Gemini or Grok (peer) call, being logged in is not standing permission"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ae97ed03-0231-4e70-9dce-c41cf39a2c04
  modified: 2026-08-15T18:05:36.960Z
---

Standing global protocol set 2026-08-15: **Claude models are always first choice.** Gemini
(Antigravity CLI, `agy`) and Grok (Grok Build CLI, `grok`) are logged in and wired into Alfred as
the "Peers" tier, but **every individual use requires asking first and getting a yes.** This holds
for subagent briefs too — no brief may tell an agent to call a peer without prior approval.

**Why:** being authenticated is not the same as being authorized. The logins exist so that once
approval is given, the work can happen immediately — not so the question can be skipped. The user
wants to know when their work leaves Claude and goes to a third party, and to make that call
themselves each time.

**How to apply:** default every task to the Claude tiers. When a peer looks like the better tool,
ask in one line before spending — what it would be asked, why Claude is worse for it, which peer —
then wait. If the answer is no, do it on Claude and do not re-ask. Never treat a peer as a fallback
when Claude work is going badly. Never send secrets, credentials, client data, or WORK-mode context
to a peer even when approved.

**One exemption, narrowed 2026-08-15 after the rule cost two round-trips on a 3-second wiring test:**
connectivity checks need no approval — `provider-run.mjs <provider> --selftest`. It sends a fixed
probe and discards any prompt or stdin, so it structurally cannot carry the user's content. The
exemption is that specific code path, NOT a judgement call: never hand-roll a "quick test" prompt to
claim it. Anything Alfred composes is work and gets asked for, however trivial.
Related: [[project_alfred]], [[user_org_chart_model_routing]].
