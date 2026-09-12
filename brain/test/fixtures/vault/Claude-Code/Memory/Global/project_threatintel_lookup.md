---
name: ThreatIntel-Lookup project
description: Personal OSINT / threat-intel toolkit. Two PowerShell tools — Invoke-ThreatLookup.ps1 (on-demand single-target rep check) and Update/Search-ThreatIntel.ps1 (local feed scraper). Use this for breach / IP-rep / domain investigations.
type: project
originSessionId: accf508c-4d1b-48fd-9d9f-1e90049b956a
---
Personal OSINT toolkit at `C:\Users\dishi\OneDrive\Desktop\_Projects\ThreatIntel-Lookup`. Vault note: `Projects/ThreatIntel-Lookup.md`.

**Why:** Built 2026-05-08 to investigate indicodata.ai breach rumours (no breach found; surfaced suspicious saviourr.org / MSK / "DISCLOSE-MESH" CVD pulse on OTX dated 2026-05-01 — pattern matches beg-bounty extortion-adjacent operations, not a recognized researcher). Tool stays useful for any future "is X compromised" question.

**How to apply:**
- For any IP/domain/email/hash investigation in PERSONAL mode, default to running `.\Invoke-ThreatLookup.ps1 -Target X` from the project folder before web-searching
- For "is anything new in threat intel about Y" questions, use `.\Search-ThreatIntel.ps1 Y` after `.\Update-ThreatIntel.ps1` (cache is JSONL, dedupes by ID)
- Don't try to auto-edit `$PROFILE` to install `tlookup` — Claude Code harness blocks it as Unauthorized Persistence; use `profile-snippet.ps1` and instruct user to run the install line themselves
- Sources are PowerShell-only (no external modules), free / freemium APIs, all keys live in `.env` (gitignored)
- Three feeds known-flaky: Trellix, Sophos, The Hacker News (timeouts) — not worth fixing, the other 20 cover ground
- For email targets on free-mail domains (gmail.com, yahoo.com, etc.), don't query ransomware.live with the bare domain — false positives via substring match on contact emails in leak posts. Query the full address instead.
