---
name: prior-art
description: Check whether something has already been built before building it. Searches GitHub via the gh CLI and API — never a browser — then judges each candidate on maintenance, licence and fit, and returns a verdict of ADOPT / ADAPT / BUILD with the evidence. Use before starting any new tool, skill, script, integration or framework; when the user asks "has anyone done this", "is there a library for this", "should we build or borrow"; or when a design is about to commit to a from-scratch implementation.
allowed-tools:
  - Bash(gh search *)
  - Bash(gh api *)
  - Bash(gh repo view *)
---

# Prior art — has this been built already?

Answer before writing code, not after. The cost of asking is about four seconds and
two API calls; the cost of not asking is a rebuild of something better-maintained
than yours will be.

This runs on the `gh` CLI against the GitHub API. **Never open a browser for this.**
Browser automation for code search is slower, flakier, and returns rendered HTML
instead of structured data.

## Prerequisites

`gh auth status` must show a logged-in account. If it does not, stop and tell the
operator to run `gh auth login` themselves — never handle credentials.

## The search

Search is the cheap part. Cast wide, then judge hard.

```bash
# The main sweep — description and name, ranked by stars
gh search repos "<the thing>" --limit 15 \
  --json fullName,description,stargazersCount,updatedAt,license,isArchived

# Same query against READMEs, which catches projects whose name says nothing
gh search repos "<the thing>" --match readme --limit 10 \
  --json fullName,description,stargazersCount,updatedAt

# Narrow by ecosystem when the language matters
gh search repos "<the thing>" --language python --sort updated --limit 10 \
  --json fullName,description,stargazersCount,updatedAt
```

### Query length is the whole game — measured, not guessed

GitHub matches repo **names and descriptions**, not meaning. Long queries return
nothing, and nothing looks exactly like "this has never been built." That false
negative is the only way this skill causes harm, so treat query length as the
first thing to check when a search comes back empty.

Measured on 2026-08-14:

| Query | Result |
|---|---|
| `claude code skill github prior art search` (6 words) | **0 hits** |
| `duplicate dependency detection existing solution finder` (5 words) | **0 hits** |
| `github repo discovery cli` (4 words) | **0 hits** |
| `awesome claude code skills` (4 words) | 431★ top hit |
| `prior art search` (3 words) | 520★ top hit |

**Two to four words. Never a sentence.** If a search returns zero, shorten it
before concluding anything — an empty result from a six-word query is not evidence.

Run **at least three phrasings**, and expect them to find different things:

1. **The user's words**, cut to three.
2. **What a library author would name it** — the noun, not the goal. `retry backoff`,
   not `handle failed requests gracefully`.
3. **`awesome <topic>`** — curated lists are the highest-yield single query in this
   whole procedure. One hit gives you fifty vetted candidates.

Watch for **overloaded terms**: `prior art` returns patent tooling, not
code-reuse tooling. If the results are all from a different domain, the term is
the problem, not the ecosystem.

Then inspect the serious candidates:

```bash
gh api repos/OWNER/REPO --jq '{stars:.stargazers_count, pushed:.pushed_at, archived:.archived, license:.license.spdx_id, issues:.open_issues_count}'
gh api repos/OWNER/REPO/git/trees/HEAD?recursive=1 --jq '.tree[] | select(.type=="blob") | .path' | head -40
gh api repos/OWNER/REPO/readme --jq '.content' | base64 -d | head -60
```

Reading the file tree is the fastest way to tell a real project from a README with
ambitions. A repo whose tree is one file and a licence is a blog post.

## The bar a candidate must clear

State each verdict against these. A candidate that fails **maintenance** or
**licence** is out regardless of how well it fits.

| Test | Fails when |
|---|---|
| **Maintenance** | archived, or no push in 12+ months |
| **Licence** | none declared, or copyleft where that is a problem for this use |
| **Substance** | the tree shows no implementation behind the README |
| **Fit** | it solves an adjacent problem, not this one |
| **Trust** | single author, no stars, no history — fine to read, not to depend on |

Stars are a weak signal on their own. A 40-star repo pushed last week beats a
2,000-star one archived in 2024. Say so when it happens.

## The verdict

Return exactly one, with evidence:

- **ADOPT** — use it as-is. Give the install/import line.
- **ADAPT** — take the design, not the dependency. Say precisely what to lift and
  what to change. This is the common answer for anything that must fit local
  conventions.
- **BUILD** — nothing clears the bar. Name what you searched and the closest miss,
  so the conclusion is falsifiable rather than an absence of effort.

Never return BUILD without listing the queries run. "I found nothing" and "I did not
look properly" are indistinguishable to the reader unless the queries are shown.

## Report format

```
VERDICT: ADAPT

  repo        RinDig/icm-architect
  signal      721 stars · pushed 2026-07-19 · MIT · not archived
  what it is  Claude skill that restructures a folder into a staged workspace
  fit         Covers ~70% — has the restructure mode we need
  gap         Its conventions are its own; our org charter needs reconciling

Also seen
  ktnCodes/icm-template        33★  template only, no restructure logic
  Naxxy/workspace-builder      12★  re-implementation, thinner

Queries run
  "interpretable context methodology" · "folder structure agent architecture"
  "ICM workspace builder" --match readme
```

## Anti-patterns

- **Browser automation.** If you are opening a tab to search GitHub, stop.
- **Stopping at the first plausible hit.** The best result is frequently third.
- **Reporting search results as a verdict.** A list of repos is not an answer;
  ADOPT/ADAPT/BUILD is.
- **Skipping the check because the task "seems novel".** It usually is not, and this
  is precisely when the check pays. Twelve duplicate skills accumulated in this very
  framework because nobody looked.
- **Recommending a dependency on unread code.** Read the tree before you suggest it.
