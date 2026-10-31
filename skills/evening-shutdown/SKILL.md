---
name: evening-shutdown
description: Close the user's day in about two minutes - what got done, what to do with what is still open, and the three things to start tomorrow with - and save it so tomorrow's morning brief starts from it. Use when the user says they are wrapping up, done for the day, signing off, or asks to plan tomorrow, or when an evening routine runs.
---

# Evening shutdown

Work in the brain folder named in your instructions (`RULEBOOK.md` §9 and §14.1 there). The Alfie app has the same thing as a button ("Wrap up the day"); this is the conversation version. Keep it short: the point is to stop working, not to start planning a week.

**Today** and **now** are in the user's time zone (`Time zone:` in `System/settings.md`); stamps are `YYYY-MM-DD HH:MM`. **Tomorrow** is the next day. **`<who>`** is your short name.

## 1. Look at the day (from the files, not from memory)
- **Done today:** files in `Reminders/Done/` with a `Closed:` line dated today and `Status: done`, and weekly chores closed today.
- **Still open:** open items in `Reminders/` due today or earlier (not `watch`).
- **Coming up:** items due tomorrow, open to-dos with no date, then items due in the next 7 days.
- If `Outputs/shutdowns/<today>.md` exists, the user already wrapped up once today: start from it.

## 2. Ask, in one short message
1. Say what got done in one line ("Three things done today: ...").
2. For what is still open, offer the choices together: "Move to tomorrow, pick a date, or leave as is?" Nothing moves unless the user says so; "leave it" is a fine answer.
3. "What are the three things you want to start tomorrow with?" Offer up to five candidates from Coming up; the user may name something new.
4. "Anything on your mind before you stop?" (optional; one line).

## 3. Do what they chose
- **Moves** (RULEBOOK §9): set `Due:`; if `Status:` was `snoozed`, set it to `open`; add `- Moved: <now> to <date> by <who>`; set `Last updated`.
- **Something new in the three** that is not yet a reminder: create a to-do due tomorrow (RULEBOOK §6), `Author: <who>`.
- In team mode, take the pen (`Agents/pen.md`) for these edits and give it back after.

## 4. Save the wrap-up
Write `Outputs/shutdowns/<today>.md` (make the folder if needed), exactly in the RULEBOOK §14.1 shape: `Kind: shutdown`, `Author: <who>`, `For: <tomorrow>`, `Created`, `Last updated`; sections `## Done today`, `## Moved`, `## Next three for <Weekday> <tomorrow>` (numbered, `1. **Title** · Reminders/<file>.md`), `## Note`; `- nothing` in an empty section. If the file exists, rewrite it in place: keep `Created`, set `Last updated`, and put the old text in `Archive/YYYY-MM/replaced/` first (§9).

## 5. Close
One line back: "Done. Tomorrow starts with: 1. ..., 2. ..., 3. ... Enjoy your evening." Don't propose memories or new work now unless the user brings something up.
