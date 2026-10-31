---
name: brain-capture
description: Add or change an item in the user's brain the right way - a reminder, to-do, errand, watch, habit or other routine, calendar event, or a memory proposal. Use whenever the user says remind me, add to my list, don't let me forget, every Monday, I have an appointment, remember that, or asks to move, snooze, close, pause or cancel something.
---

# Brain capture

Work in the brain folder named in your instructions. Its `RULEBOOK.md` is the full reference (§4 to §11); this skill is the short path for one item.

**Now** is the date and time in the user's time zone (`Time zone:` in `System/settings.md`), written `YYYY-MM-DD HH:MM`, 24-hour, no zone word. **`<who>`** is your short name: `claude`, `codex`, `gemini` or `grok`.

## 1. Before you write
1. **Decide what it is.**
   | The user means | It is |
   |---|---|
   | do or remember something on a date or at a time | `reminder` |
   | do it today ("add to my errands") | `errand` |
   | get it done some time, no date | `todo` |
   | waiting on someone or something, follow it up | `watch` |
   | it repeats ("every", "each", "on Mondays", "monthly") | a habit in `Routines/` |
   | it happens on a date (appointment, plan, birthday, trip) | a line in `Calendar/events.md`, plus a reminder only if they want a nudge |
   | a fact about them, how something of theirs works, a preference or a decision | a memory proposal |
2. **Work out the dates** against today in the user's time zone. Never write "Friday" or "next week" into a date field. A date in the past, or one you can't pin down, is a question for the user.
3. **Look first.** Search `Reminders/`, `Routines/` and `Calendar/events.md` for the same thing. If it is there, change it instead of adding a second one.
4. **Team mode only** (`Team:` in `System/settings.md` is not `none`): take the pen in `Handoffs/pen.md` before editing an existing file (RULEBOOK §16.5). A brand-new file needs no pen.

## 2. Add a reminder, errand, to-do or watch
File: `Reminders/<date>--<slug>.md`. `<date>` is the due date, or today if there is none. `<slug>` is the title in lowercase with every run of other characters turned into one hyphen, at most 48 characters. If the name is taken, add `-2`.
```
# <Title, a few words>

- **Kind:** reminder | todo | errand | watch
- **Status:** open
- **Due:** YYYY-MM-DD | YYYY-MM-DD HH:MM | none
- **Until:** done | end-of-day | YYYY-MM-DD
- **Scope:** personal | work
- **Nudge:** morning brief
- **Author:** <who>
- **Created:** <now>
- **Last updated:** <now>

<What to do, and any context.>

The user's words: "<what they said>"
```
- `reminder` needs a date. `errand` with no date is due today, `Until: end-of-day`. `watch` takes `Until:` the date to stop watching, or `done`. Everything else `Until: done`.
- `Scope: work` only when it is for their job.
- Confirm in one line: "Reminder set for Saturday 14 November at 09:00."

## 3. Change one
Re-read the file just before saving. Keep every header line, set `Last updated` to now, then add one line at the end:
- **New date** (move, snooze, "tomorrow"): set `Due:`; if `Status:` is `snoozed`, make it `open`; add `- Moved: <now> to YYYY-MM-DD by <who>`. Keep the file name.
- **Title, kind, scope:** change the `# ` line or the field; add `- Edited: <now> by <who>: <what changed>`, for example `title → "Book the dentist"`.
- **A note:** add `- (YYYY-MM-DD) <note>`.
- **Done** (only when the user says so): `Status: done`, add `- Closed: <now> by <who> (the user said so)`, move the file to `Reminders/Done/`.
- **Not needed any more:** `Status: cancelled`, add `- Closed: <now> by <who> (cancelled: the user said so)`, move it to `Reminders/Done/`.
- **Carry over** yesterday's missed errand: move it from `Reminders/Done/` back to `Reminders/`, `Status: open`, `Due:` today, add `- Moved: <now> to <today> by <who> (carried over)`.

## 4. Add a habit
File: `Routines/user-<slug>.md`. Schedule words: `daily`, `weekdays`, `weekends`, day names (`Mondays and Thursdays`) or `monthly on the 15th`, optionally followed by a time (`weekdays 07:30`).
```
# The user: <Title>

- **Kind:** routine
- **Type:** habit
- **Runs:** the user
- **Nudger:** <who> (morning brief) and the Day page
- **Schedule:** <schedule words>
- **Status:** active
- **Author:** <who>
- **Created:** <now>
- **Last updated:** <now>

## What it is
<One or two lines.>

The user's words: "<what they said>"
```
To **pause**: `Status: paused (since YYYY-MM-DD)`. To **resume**: `Status: active`. To **reschedule**: change `Schedule:`. Each change adds `- Edited: <now> by <who>: <what changed>`. A routine they no longer want moves to `Archive/YYYY-MM/Routines/`.

## 5. Add a calendar event
In `Calendar/events.md`, under `## YYYY-MM (Month YYYY)` (add the heading in month order if it's missing), in date and time order, one line:
```
- YYYY-MM-DD Title (added by user)
- YYYY-MM-DD HH:MM-HH:MM Title @ place (added by user)
- YYYY-MM-DD..YYYY-MM-DD Title (added by user)
```
Use `added by user` when the user asked for it, or your short name when you added it on your own judgement. A place name only, never a street address; no ` @ ` inside the title; a multi-day event spans at most 60 days. Set the file's `Last updated`.
- **Cancel:** replace the line with `- ~~<the line without its (added by ...)>~~ (cancelled by user via <who>)`. Never delete a line.
- **Move:** cancel the old line with `(cancelled by user via <who>: moved to YYYY-MM-DD)` and add the new one.
Confirm in one line: "Added: dentist, Wednesday 4 November at 09:30."

## 6. Propose a memory
1. Check it is worth keeping (two or more: needed again in over a week; annoying to repeat; about them, not general knowledge; stable; another AI would act differently knowing it).
2. Never: passwords, keys, account or ID numbers, addresses, phone numbers, anyone's full name. Ask first, every time, for health, money and other people.
3. Ask in one line: "Want me to remember that the boiler is serviced every October?" A direct "remember that..." is already a yes.
4. **On yes**, add `- (YYYY-MM-DD) <fact> · via <who>` to the right file: `System/profile.md` (who they are, how they like help), `Memory/topics/<topic>.md` (a part of life or work; health only in `health.md`), or `Memory/timeline/YYYY-MM.md` (events and decisions). A temporary fact ends `· until YYYY-MM-DD`. If the fact replaces an old one, replace that line.
5. **If they can't answer now**, leave a proposal for them: `Inbox/YYYY-MM-DD-HHMM--<who>--user--capture--<slug>.md` with `Kind: signal`, `Type: capture`, `From: <who>`, `To: user`, `Re:`, `Target: <the file>`, `Status: open`, `Created: <now>`, and the proposed lines in the body (RULEBOOK §11). Write nothing to memory until they say yes.

## 7. After any change
1. Update `index.md`: put the item in the right section (or take it out), fix the counts, set `Last updated`, and add a line at the top of "Changed in the last 48 hours" (RULEBOOK §13).
2. In team mode, give the pen back.
3. Tell the user in one short line what you saved and where.
