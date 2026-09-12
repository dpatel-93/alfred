---
name: feedback-visual-verification
description: "Always verify UI changes visually with Playwright before committing — spacing, overlap, overlays, both tabs/states — never ship on a builder agent's word alone"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8455ca54-06de-4239-8a96-18ed0da22951
  modified: 2026-08-08T05:59:53.168Z
---

Standing instruction from Dishi (2026-08-08, Alfred Framework UI work): after any UI change (by me or a subagent), use Playwright to SEE the result before committing/reporting — navigate the real page, exercise the states (tabs, panels open/closed, search results, answer overlay, expanded terminal), screenshot, and inspect for spacing problems, overlapping elements, and overlay/z-index issues.

**Why:** builder agents test markup presence and syntax, not visual correctness — the scanline-opacity bug and a stray arc behind the tabs both shipped "tested" and were only caught by actually looking.

**How to apply:** after each UI build round: hard-load the page in Playwright, dismiss landing, screenshot each tab/state changed, read the screenshots critically (not just confirm elements exist), fix or queue nits, THEN commit. Send the user screenshots of significant changes.
