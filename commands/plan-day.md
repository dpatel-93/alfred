---
description: Scan active project notes in the vault and recent git activity to propose today's highest-leverage work.
---

Vault projects: `Projects/` under the vault root — resolve that root from the knowledge vault path in `~/.claude/alfred-profile.md` (skip this step if none is configured).

1. List the project notes in the vault's `Projects/` folder and read each one's "Current State" / next-steps section — don't read entire notes if they're long, just the state and open items.
2. For each active project (has a local repo path), check recent git activity: last commit date, any uncommitted changes, open branches without a merged PR. Use this to judge what's actually in-flight vs stale.
3. Cross-reference: a project with recent commits and an open "next step" in its vault note is likely still hot; a project untouched for weeks needs a decision (resume, park, or close) more than new work.
4. Propose a short, ranked list (3-5 items) of today's highest-leverage work — weigh urgency (blocking something), effort vs impact, and anything explicitly flagged as next in a project note. Include one-line why for each.
5. Don't start any of the work — this command only plans. Ask which item to start on, or wait for direction.
