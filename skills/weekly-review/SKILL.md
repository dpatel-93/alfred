---
name: weekly-review
description: Once a week, look back and ahead with the user and tidy their brain - what got done, what's coming in the next two weeks, stale items to decide on, archiving finished things, merging duplicate memories and rebuilding the index. Use when the user asks for a weekly review or a tidy-up, or at the first session on or after Sunday when the last review is more than six days old.
---

# Weekly review

Work in the brain folder named in your instructions (`RULEBOOK.md` §9 and §15 there). The lead AI does this; in team mode, others leave it to the lead.

**Today** and **now** are in the user's time zone (`Time zone:` in `System/settings.md`); stamps are `YYYY-MM-DD HH:MM`. **`<who>`** is your short name. The week just gone is the 7 days up to today.

**When:** the user asks, or it is Sunday or later in the week and the newest line in `System/logs/reviews-YYYY-MM.md` (this month or last) is more than six days old.

In team mode, take the pen (`Handoffs/pen.md`) for each batch of edits and give it back after (RULEBOOK §16.5).

## 1. Look back
Gather, from the files:
- **Done:** files in `Reminders/Done/` with a `- Closed:` line this week (`done`, then `cancelled`).
- **Missed:** files that expired this week (`- Expired:` lines).
- **Moved:** `- Moved:` lines this week, especially anything moved three or more times (ask whether it still matters).
- **Decided and learned:** lines added this week to `Memory/timeline/`, `Memory/topics/`, `System/profile.md`, `Knowledge/Decisions/`.
- **Projects:** each `Projects/*/status.md` with `Status: active`, and whether its `Last updated` is older than the last work on it.
- **Team mode:** asks cleared this week (`System/logs/handoffs-YYYY-MM.md`).

## 2. Look ahead
- Items due in the next 14 days, and calendar events in that window.
- Watches whose `Until:` date falls in the next 14 days.
- To-dos with no date made more than 30 days ago: ask "keep, give it a date, or drop?" (drop means cancel, §9).
- Habits paused for more than 30 days: ask whether to resume or retire.

## 3. Tidy
Each move keeps the file name; `YYYY-MM` is this month (RULEBOOK §9).
1. Expire open errands past their day and watches past their `Until:` date.
2. Move files in `Reminders/Done/` and `Inbox/Done/` older than 30 days to `Archive/YYYY-MM/Reminders-Done/` and `Archive/YYYY-MM/Inbox-Done/`.
3. Move briefs in `Outputs/briefs/` older than 7 days to `Archive/YYYY-MM/briefs/`, and logs in `System/logs/` older than 90 days to `Archive/YYYY-MM/System-logs/`.
4. File handled `Inbox/` notes (`Status: done`) into `Inbox/Done/`. Notes open more than 7 days go to the user.
5. Memory lines ending `· until YYYY-MM-DD` with a date before today: take them out and add them to `Archive/YYYY-MM/expired-memory.md` with the file they came from.
6. Duplicate memory lines saying the same thing: keep the newest wording, take out the rest, add an `Edited:` line. If two topic files overlap, propose merging them.
7. Facts over six months old on things that change fast (work set-up, tools, projects): list them for the user to confirm.
8. Never delete anything; only move, as above.

Then rebuild `index.md` from the files (RULEBOOK §13).

## 4. Talk it through
Keep it short and in this order:
1. **Done this week:** a count and the few that matter. A word of credit is welcome.
2. **Coming up:** the next two weeks in a few lines.
3. **Your call:** the stale and paused items, one question at a time.
4. **Tidied:** one line ("Archived 12 finished items, merged 2 duplicate notes.").

## 5. Record
1. Offer a one-paragraph "week in review" for `Memory/timeline/YYYY-MM.md`, under `## Week of <Monday's date>`. Save it only on yes.
2. Add one line to `System/logs/reviews-YYYY-MM.md` (make it if needed, with a `# Weekly reviews: YYYY-MM` title and the usual header): `- <now> by <who>: <n> done, <n> archived, <n> questions for the user`.
3. Tell the user in one line what you saved and where.
