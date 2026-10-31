---
name: morning-brief
description: Build the user's daily brief from their brain - what is due today, what is late, the week ahead, today's routines and what needs their decision - save it for the Day page, and tell them the top of it. Use at the first session of the day, when a morning routine runs, or when the user asks what's on today, what's due, or for their brief.
---

# Morning brief

Work in the brain folder named in your instructions (`RULEBOOK.md` §14 there). Build the brief from the files, never from memory or an earlier conversation: the user may have closed or moved things elsewhere.

**Today** is the date in the user's time zone (`Time zone:` in `System/settings.md`). **Now** is `YYYY-MM-DD HH:MM` in that zone. **`<who>`** is your short name.

## 1. Read
1. `System/profile.md`: how brief to be, and what they want kept track of.
2. Every file in `Reminders/` (not `README.md`) with `Status: open` or `snoozed`.
3. `Calendar/events.md`: lines dated today to 7 days ahead, including multi-day events that touch those days. Skip struck-through lines.
4. `Routines/`: files with `Runs: the user` and `Status: active`.
5. `Inbox/`: open notes to `user` or `all`, and any note open for more than 7 days.
6. `Outputs/shutdowns/`: the wrap-up whose `For:` is today (normally yesterday's file). Its "Next three" are the user's own picks for today.
7. `Outputs/briefs/<today>.md`, if it exists: the Alfie app may already have written a plain brief at the user's chosen time (`Author: alfie`).
8. Team mode only: reports marked `needs the user` in the hand-off files addressed to you.

## 2. Tidy first
- An open `errand` whose `Due:` is before today, or a `watch` whose `Until:` date has passed, expires: `Status: expired`, add `- Expired: <now> by <who> (errand day ended)` or `(Until date passed)`, set `Last updated`, move it to `Reminders/Done/`. Yesterday's expired errands go under **Needs you** as "carry over?".
- In team mode, take the pen (`Handoffs/pen.md`) for these edits and give it back after.

## 3. Sort
| Section | What goes in it |
|---|---|
| **Due today** | items due today (timed ones first, by time) and today's calendar events |
| **Late** | open items due before today, oldest first, with how many days late |
| **This week** | the next 7 days, grouped by day (`### Saturday 2026-10-31`): items due and events |
| **Routines today** | active habits whose schedule falls on today: `daily`; `weekdays` (Mon-Fri); `weekends`; a named day; `monthly on the Nth` (on short months, the last day). Show the time if the schedule has one |
| **Needs you** | questions and memory proposals in `Inbox/` to `user`, notes open more than 7 days, errands to carry over, team reports marked `needs the user` |

## 4. Choose the top
At most five lines, in this order: the three the user picked last night that are not done yet, timed things today, anything late, the rest of today, then decisions waiting. If a section is empty it gets no top line.

## 5. Save
Write `Outputs/briefs/<today>.md` (make the folder if needed). If today's brief already exists (the app's or an earlier one), improve it in place: keep the format, set `Last updated` and add `- Edited: <now> by <who>: refreshed`.
```
# Morning brief: <Weekday> <today>

- **Kind:** brief
- **Author:** <who>
- **Created:** <now>
- **Last updated:** <now>

## Top
1. **<Title>** <one short line of detail>

## Due today
- 09:30 Dentist check-up @ High Street clinic (calendar)
- Renew the car insurance (reminder) · `Reminders/2026-10-30--renew-the-car-insurance.md`

## Late
- Pay the window cleaner, 2 days late · `Reminders/2026-10-28--pay-the-window-cleaner.md`

## This week
### Saturday 2026-10-31
- Pick up the dry cleaning (errand)

## Routines today
- Water the plants (08:00)

## Needs you
- Keep "the boiler is serviced every October"? · `Inbox/2026-10-30-1405--claude--user--capture--home-heating.md`
```
Every section is present; an empty one says `- nothing`. Each top line starts with a bold title, as shown.

Then rebuild `index.md` from the files (RULEBOOK §13).

## 6. Tell the user
- Lead with the top lines, as briefly as their profile asks. Times as people say them ("half past nine" or "09:30", whichever they prefer).
- Ask about carry-overs once: "Yesterday's errands weren't marked done. Carry any over?"
- Raise decisions one at a time, and only if they have a moment.
- Nothing due? One cheerful line, such as "Nothing due today. Enjoy it."
- If this ran as a routine with nobody there, save the brief and stop: no messages.
