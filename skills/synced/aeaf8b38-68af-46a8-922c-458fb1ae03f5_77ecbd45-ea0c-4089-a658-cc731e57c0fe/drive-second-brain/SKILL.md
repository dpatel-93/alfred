---
name: "drive-second-brain"
description: "Use at the start of any substantive task and whenever durable facts, decisions or outputs come up: read and write the user's AI-neutral Second Brain in Google Drive per its MANIFESTO."
---

# Drive Second Brain

The user keeps one AI-neutral memory in the Google Drive folder "Second Brain", shared by Claude, Grok, Alfred, Gemini and the CLIs. `MANIFESTO.md` at its root is the rulebook and overrides this skill if they ever disagree.

## Finding files: by name, never by stored file ID
Files in the brain get replaced (a new file is created and the old one renamed `...-superseded...`), so file IDs go stale. Folder IDs are stable.

- Root folder "Second Brain": `1oeLPeC6qcCQsqxsiROKFCS0yuAC4htDW`. If it doesn't resolve, search `title = 'Second Brain' and mimeType = 'application/vnd.google-apps.folder'` and tell the user the ID changed.
- To find a file, search inside its parent folder by exact title and skip anything whose title contains `superseded`:
  `parentId = '<folder id>' and title = 'MANIFESTO.md'`
- Folders reach each other by name too: search `parentId = '<root id>' and title = 'Shared' and mimeType = 'application/vnd.google-apps.folder'`, then go down a level the same way (`Shared/Me`, `Shared/Health`, `Agents/Claude`, `Inbox`, `Memory/Claude Bot`, `Outputs/Claude Bot`, `Research`).
- If two non-superseded files share a title, don't guess: tell the user and ask which one is current.

## At the start of a task
1. Read `MANIFESTO.md` (root) and `Agents/Claude/RULES.md` once per conversation.
2. Read `Shared/Me/profile.md`.
3. For the topic, read the matching `Shared/` area, the last ~20 lines of `Shared/CHANGELOG.md`, and any related notes in `Inbox/` (not `Inbox/Done/`).
4. Health: list `Shared/Health/`, drop files with `superseded` in the title, and take the `health-profile-*` file that sorts last by name; confirm against the latest CHANGELOG line that names the current snapshot. `child-health*.md` is the user's child, not the user.
5. Use what you read silently.

## Edit ownership (MANIFESTO §13)
Google Drive lets each app edit only files it created, and Claude's Drive connector can't edit file contents at all. So Claude:
- **Creates** new files freely in its lane (`Memory/Claude Bot/`, `Outputs/Claude Bot/`, `Agents/Claude/`), `Inbox/`, `Research/`, and in `Shared/` after the user approves.
- **Never tries to edit** an existing file. To change one, it either writes a full replacement (where the area uses dated snapshots, like Health) or a dated Inbox note `Inbox/YYYY-MM-DD-Claude-<topic>.md` describing the exact edit, for the owner to merge.
- **Never edits `Shared/CHANGELOG.md`**; Grok owns it. Put the CHANGELOG line(s) in an Inbox note, formatted `- YYYY-MM-DD HH:MM ET | Claude | <file> | <what changed> | approved by user`.
- **Renames** (metadata only) a file to `...-superseded...` only when replacing its own file, or when the user explicitly asks. Never deletes or trashes anything.
- With Claude Code on the PC via Drive for Desktop, local edits are possible, but the same ownership rules apply.

## Writing
- **Own lane:** memory as dated snapshots `memory-YYYY-MM-DD.md` (newest wins); one journal file per day `journal-YYYY-MM-DD.md`; deliverables as `Outputs/Claude Bot/YYYY-MM-DD-slug.md`.
- **Shared/:** only after the user says yes in this conversation. Ask plainly, e.g. "Do you want me to add this to Shared/Projects?" Claude owns Shared/Health and Shared/Projects; Grok owns Work, Personal, CHANGELOG, README and the current MANIFESTO; Alfred owns Systems; the user owns Me.
- **Health snapshots:** a new `health-profile-YYYY-MM-DD[-suffix].md` must carry the **entire** profile forward, never just the new items, and its name must sort after the current one. Then send the CHANGELOG line via Inbox naming it as current.
- **Promotion:** when a conversation produces a lasting fact about the user, a decision or plan, a project update, a health result, or a reference document other AIs will need, ask once whether it should go to `Shared/<area>`.
- Never write to other AIs' folders, `Briefs/`, `index.md`, `README.md` or `MANIFESTO.md`. Never rename or move folders you don't own.

## File format
Plain Markdown: `create_file` with `contentMimeType: text/markdown` and `disableConversionToGoogleType: true`. Header:
```
# <Title>

- **Owner:** <AI or "the user">
- **Updated by:** Claude
- **Date:** YYYY-MM-DD
- **Last updated:** YYYY-MM-DD HH:MM ET
```
Lasting facts as `- (YYYY-MM-DD) fact`. Times in ET.

## Voice sessions with other AIs
When the user puts Claude and another AI (e.g. Grok) on the same voice call, use walkie-talkie style: end every turn with "over", speak only after someone says "over", and "over and out" ends the conversation.

## Privacy (hard rule)
Refer to the user only as "the user". No names, family names, email, handles, addresses, phone numbers, birthdates, ID or account numbers, credentials, or sensitive work configuration. Medical data only in `Shared/Health/`. Never share files or create links. Scan before every upload.