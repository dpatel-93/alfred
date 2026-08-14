---
name: research-note
description: Capture what was LEARNED from research into a durable per-topic note — the conclusions and the sources that formed them, never the source content itself. Use after reading anything to answer a question (web research, docs, a paper, a repo sweep, a comparison), when the operator says "save what we learned", "write this up", or "remember this research", and whenever a topic already has a note that new findings should be folded into rather than duplicated. Do NOT use for session state (that is auto-captured), project status (that is the project note), or a concept explanation with no sources (that is a Learning note).
---

# Research notes — keep the conclusion, drop the corpus

Twenty topics researched over a month can span a hundred sources. Storing the sources
is storing the problem: re-reading a hundred pages to answer one question is exactly
what the note is supposed to prevent.

**One note per topic. It accumulates. It holds what we concluded and where that came
from — and none of the material itself.**

## The unit is a topic, not a session

This is the decision people get wrong. A session-shaped note ("what I looked at on
Tuesday") is useless three weeks later because nobody searches by day. A topic-shaped
note is the thing you actually reach for.

- Researching something already noted → **update that note.** Never open a second one.
- Genuinely new subject → new note.
- Turns out to be a sub-part of an existing topic → a section in the parent, not a sibling.

**One home per fact.** If the same conclusion is drifting into two notes, one of them
should be a link.

## Where it goes

`Research/<Topic-In-Title-Case>.md` in the vault (path in `~/.claude/alfred-profile.md`).
Neighbours, so the right folder gets picked:

| Folder | Holds | Not this |
|---|---|---|
| `Research/` | a topic that accumulates, with sources | — |
| `Learning/` | a concept explained for the operator, no sources | has citations → Research |
| `Investigations/` | one dated look at one specific thing | recurring subject → Research |
| `Decisions/` | what we chose and why | what we found out → Research |

## The shape

```markdown
# Cheap Static Hosting for Small Shops

> Updated 2026-08-14 · confidence: working · 6 sources

## What we concluded
- Static hosting with a serverless function for checkout stays free under ~100k
  visits/month. [1][3]
- Image-heavy sites blow the free bandwidth tier long before the request tier. [2]
- "Free" tiers that bill for egress are the ones that surprise people. [2][5]

## Still open
- Whether signed URLs are enough to stop bulk downloading, or a proxy is needed.

## Where this came from
1. [Provider pricing page](url) — the actual tier limits, not the marketing summary
2. [Cost teardown post](url) — where a real site crossed into paid, and on which metric
3. [Docs: functions on free tier](url) — confirmed the execution ceiling
5. [Forum thread](url) — three independent reports of surprise egress bills

## Superseded
- 2026-07-02: believed the free tier capped on requests. It caps on **bandwidth** —
  corrected by [2], which measured it.
```

### Rules that make it worth keeping

- **Every conclusion carries a source marker.** A claim you cannot trace is a claim you
  will not trust in a month, and it will get re-researched from scratch.
- **A source line says what it CONTRIBUTED, not what it is.** "Pricing page" is a
  bookmark. "The actual tier limits, not the marketing summary" tells you whether to
  reopen it.
- **Never paste the content.** No archived pages, no long quotes, no transcripts. If a
  source vanishes, the conclusion and its provenance survive — that is the trade being
  made deliberately.
- **Contradictions are recorded, not resolved silently.** If [2] and [4] disagree, say
  so and say which is better supported. Smoothing it over destroys the one signal that
  tells you the topic is unsettled.
- **Supersession is append-only.** When a later finding overturns an earlier one, the
  old belief stays with a line on what replaced it and why. That history is how you spot
  a topic that keeps flip-flopping — which usually means the question is wrong.
- **State confidence honestly:** `thin` (one source, or all from one author) ·
  `working` (several agreeing sources, no contradiction found) · `settled` (verified
  against a primary source or reproduced first-hand).

## Updating an existing note

1. **Read it first.** Folding in without reading is how duplicates and contradictions
   get introduced.
2. Add new conclusions with their source markers; renumber nothing — append sources.
3. If a new source **contradicts** an existing conclusion, do not overwrite. Move the old
   line to `## Superseded` with the date, the replacement, and the reason.
4. Move anything now answered out of `## Still open`.
5. Update the date, source count, and confidence.

## What not to write down

- Anything the repo, git history, or a project note already records.
- The source material itself.
- Anything that only mattered inside the conversation that produced it.
- A note for a topic looked at once with no conclusion reached — that is a browser tab,
  not knowledge. Write it when there is something to say.

## Anti-patterns

- **A note per research session.** Nobody searches by date. The topic is the unit.
- **A bare link list.** A bookmark file with no conclusions is not a research note; it
  is the corpus this skill exists to avoid keeping.
- **Conclusions with no sources.** That is a Learning note, and it belongs elsewhere.
- **Silently editing a superseded belief.** How understanding changed is often more
  useful than where it landed.
- **Saving it because effort was spent.** Effort is not a reason. A conclusion someone
  would act on is.
