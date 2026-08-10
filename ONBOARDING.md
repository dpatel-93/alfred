# Alfred onboarding protocol

Instructions for Claude, not for the human. Triggered by `CLAUDE.md`'s "First-time setup"
section. Run this as a conversation — one or two questions per turn, not a wall of text. The
goal is a filled-in operator profile at `~/.claude/alfred-profile.md` that every agent charter
references instead of embedding one person's identity, followed by running the installer.

Do not run the installer before this conversation completes. Do not silently read any file
outside the current repo without asking first — steps 2 and 3 below both require explicit
consent before touching anything under the person's home directory.

## Step 1 — check for an existing profile

Look for `~/.claude/alfred-profile.md`. If it exists, read it and ask: "I found an existing
Alfred profile for **{name}** — reuse it as-is, update a few things, or start over?" Honor
their answer and skip to Step 5 if they choose to reuse it unchanged.

## Step 2 — offer to import, don't assume

Check (existence only, do not read yet) whether `~/.claude/CLAUDE.md` or a home-directory
`CLAUDE.md` already exists — a sign this person already uses Claude Code and may have
documented preferences you could reuse. If either exists, ask permission before reading:

> "I see you already have Claude Code configuration at `{path}`. Want me to check it for
> things like your name, role, and working preferences, so you don't have to retype them?"

If they decline, or neither file exists, go straight to Step 3. If they agree, read the
file(s), extract anything that looks like identity or preference information (a name, a role,
stated expertise/learning areas, a communication-style preference), and propose it back as a
draft — **never adopt it silently**:

> "Here's what I found: [summary]. Want to use this as your profile, or adjust anything?"

Treat their answer as the starting point for Step 3, filling in only what's still missing or
what they want changed.

## Step 3 — the interview

Ask what's still needed, conversationally, not as a rigid form. Cover:

1. **What do you do, in a sentence?** (role/profession — this calibrates which kinds of
   examples and analogies make sense later)
2. **Where are you strong, and where are you still learning?** (this is the single most
   load-bearing answer — it decides whether an agent should explain a concept before using it
   or just get straight to the technical work)
3. **How do you like an assistant to communicate?** (direct and terse, or explain the reasoning
   as it goes — there's no wrong answer, just say what actually holds their attention)
4. **Anything else Alfred should know as recurring context?** (optional — a primary tech stack,
   a side project, a team size, anything that would otherwise need re-explaining every session)
5. **Do you keep a markdown knowledge vault** (decisions, patterns, project notes) **you want
   `vault-recall` to search?** (optional — if yes, get its path; if no or unsure, leave unset)

Do not ask what to call them — the profile template already defaults **Address me as** to
"Batman," a deliberate nod to the Alfred theme, not a placeholder. Leave it as-is unless they
volunteer a preference unprompted; if they do, use that instead.

Skip any question they've effectively already answered in Step 2. Don't interrogate — four
real answers beat ten forced ones. If they want to skip a question, leave that section of the
profile as `(not specified)` rather than inventing a plausible-sounding default.

Fill in **Alfred repo location** yourself, without asking — it's the absolute path of the repo
this conversation is already running from (the current working directory), not something the
person needs to state.

## Step 4 — write and confirm the profile

Copy `claude-md/alfred-profile.template.md` to `~/.claude/alfred-profile.md` (create
`~/.claude/` first if it doesn't exist) and fill in the sections from Steps 2-3, plus the
Framework paths section. Show the person the filled-in file and ask if it's accurate before
moving on — every agent charter reads this file via an explicit instruction, so a wrong answer
here propagates everywhere.

## Step 5 — run the installer

Detect the OS (or ask if you genuinely can't tell) and run the matching script from the repo
root:
- Windows: `./install.ps1`
- macOS/Linux: `./install.sh`

Both are idempotent and merge-only — safe to re-run, and they never delete anything already on
the target machine. Report what the installer reports (what was merged, what already existed).
Do not template the profile's content into the installed files; the installer's job is
mechanical file placement only, and the explicit "Check ~/.claude/alfred-profile.md" instruction
already in each charter is what connects the two — nothing about the installer needs to know the
profile's contents.

## Step 6 — confirm and orient

Tell them setup is done, where things landed (`~/.claude/agents`, `~/.claude/skills`, the
profile at `~/.claude/alfred-profile.md`), and how to start the HUD if they want it
(`brain/Alfred.cmd` on Windows; check the README for the current macOS/Linux equivalent). If
anything in the installer's output looked like a conflict or a skipped merge, say so plainly
instead of declaring success — an installer report is evidence, not a formality.
