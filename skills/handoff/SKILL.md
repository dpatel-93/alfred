---
name: handoff
description: Team mode only - ask another AI on the user's team to do something, report back on what another AI asked of you, clear finished items, and take or give back the pen before editing shared files. Use at the start of every session in team mode, when the user says to get another AI to do something, or before editing a brain file another AI might also be editing.
---

# Hand-off

Work in the brain folder named in your instructions (`RULEBOOK.md` §16 there). Use this only when `Team:` in `System/settings.md` lists at least one AI; with `Team: none`, there is nothing to hand off.

**Now** is `YYYY-MM-DD HH:MM` in the user's time zone. **Short names and letters:** `claude` C, `codex` X, `gemini` G, `grok` K (also `Handoff letters:` in `System/settings.md`). **`<me>`** is your short name, **`<L>`** your letter, and **`<Me>`** your folder in `Agents/`: your short name with a capital (`Claude`, `Codex`, `Gemini`, `Grok`); **`<Them>`** is theirs.

## The one rule
Each AI writes only in its own folder, `Agents/<Me>/`: its outgoing files are `Agents/<Me>/handoffs/to-<them>.md`, and it reads the ones addressed to it, `Agents/<Them>/handoffs/to-<me>.md`. Never edit another AI's hand-off file.

**An older brain** (made before Alfie 0.3) may still have `Handoffs/<them>-to-<me>.md` and `Handoffs/pen.md`: read those too. When you write to a pair whose old file `Handoffs/<me>-to-<them>.md` is still there, put all of its items into `Agents/<Me>/handoffs/to-<them>.md`, then move the old file to `Archive/YYYY-MM/Handoffs/`. Never delete it.

## 1. At the start of every session: check
1. Read every `Agents/*/handoffs/to-<me>.md` (and any old `Handoffs/*-to-<me>.md`).
2. **Their asks for you** (`## Asks for <me>`, items whose ID starts with their letter) that you have not reported yet: do each one now, or report it `in progress` and say when. Stay within the brain and what the user asked; anything else is `needs the user (why)`.
3. **Their reports on your asks** (under `## Done or answered (<me>'s asks)` in their file):
   - `done`: tell the user if it matters to them, then clear your ask (step 5).
   - `needs the user (why)`: tell the user, then clear your ask.
   - `in progress`: leave it.
4. **Your reports whose ask is gone** from their file: clear your report (step 5).

## 2. Ask another AI
When the user wants another AI on the team to do something, or the work suits it better:
1. Open (or create, step 6) `Agents/<Me>/handoffs/to-<them>.md`.
2. Make the ID: `<L>-YYYY-MM-DD-HHMM` from now, such as `C-2026-10-30-1430`. If that ID is already in the file, add `-2`, then `-3`.
3. Add under `## Asks for <them>`:
```
### <ID> · <short title>
- **Status:** pending
- **Asked:** <now>
- **The user's words:** "<what they said>"
- **What to do:** <the task, with file paths>
- **Done looks like:** <what the result should be, and where it goes>
```
4. Set the file's `Last updated`, and tell the user: "I've asked Codex. Alfie will wake it if Alfie is running; otherwise it picks this up the next time it runs."
5. Until it is reported, treat it as on its way, not done.

## 3. Report on an ask
In **your own** file to the asker, `Agents/<Me>/handoffs/to-<asker>.md`, under `## Done or answered (<asker>'s asks)`, with the same ID and title:
```
### <ID> · <their title>
- **Status:** done (<now>)
- **What changed:** <what you did, with file paths>
- **For you:** <anything the asker still has to do, or nothing>
```
`Status:` is `in progress`, `done (<now>)` or `needs the user (<why>)`. To update a report, replace its block. Set the file's `Last updated`.

## 4. The pen
Before editing any existing shared file (an item, `index.md`, `Calendar/events.md`, a memory file), open `Agents/pen.md` (in an older brain without one, `Handoffs/pen.md`). A new file, and anything in your own `Agents/<Me>/` folder, need no pen.
1. If `Holder:` is `none`, or `Until:` is earlier than now: set `Holder: <me>`, `Since: <now>`, `Until:` now plus 10 minutes, `Working on:` the files, and `Last updated`. Read `pen.md` again; if another name is there, they got it first: wait.
2. Make your edits. Need longer? Move `Until:` on, 10 minutes at a time.
3. Give it back at once: `Holder: none`, `Since: none`, `Until: none`, `Working on: none`, and `Last updated`.
4. If someone else holds a pen that hasn't run out: wait a minute and check again. If the user is waiting, tell them, and put your change in an ask instead. Never edit around the pen.

## 5. Clear
- Clear your **ask** once their file reports it `done`, or `needs the user` and you have told the user.
- Clear your **report** once its ask is gone from the asker's file.
- To clear, take the whole block (its `###` heading down to the next heading) out of your file and add it to `System/logs/handoffs-YYYY-MM.md` (make it if needed, titled `# Hand-off log: YYYY-MM`): first `- <now> cleared <ID> (<why>)`, then a blank line and the block with its heading changed from `###` to `####`. Nothing is lost.
- Set your file's `Last updated`.

## 6. A new hand-off file
```
# <me> → <them> hand-offs

- **Kind:** handoff file
- **From:** <me>
- **To:** <them>
- **Author:** <me> (only <me> writes this file; <them> reads it)
- **Their file:** `Agents/<Them>/handoffs/to-<me>.md`
- **Last updated:** <now>

## Done or answered (<them>'s asks)

## Asks for <them>
```
