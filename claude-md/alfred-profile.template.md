<!--
  Alfred operator profile — filled in by ONBOARDING.md, or by hand.

  Agent charters read this file via an explicit instruction ("Check ~/.claude/alfred-profile.md")
  instead of having one person's identity, learning level, and project examples embedded
  directly in framework files. This is a plain Read, not Claude Code's `@import` syntax — that
  syntax is only confirmed-documented for CLAUDE.md files, not arbitrary charter prose. Edit
  this file any time your situation changes; there's no installer step to re-run afterward.

  If you're filling this in by hand instead of through the onboarding conversation: keep
  answers short and specific. "New to Python, ten years in Go" calibrates an explanation
  correctly. "Intermediate" does not.
-->

# Operator Profile

## Identity
- **Address me as**: (not specified — Alfred uses your name once you put one here. If you want the
  butler-and-employer framing the name comes from, "Batman" works and is what the author uses.)
- **Role**: (not specified)

## Expertise
- **Strong areas**: (not specified)
- **Learning areas**: (not specified — agents should explain concepts here before using them,
  not assume familiarity)

## Communication
- **Preferred style**: (not specified — default to direct and technical until told otherwise)

## Recurring context
- **Primary stack/tools**: (not specified)
- **Projects Alfred should know about**: (not specified)
- **Other standing context**: (not specified)

## Framework paths
- **Alfred repo location**: (not specified — the path where this repo was cloned; the `vault-recall`
  skill and the HUD server under `brain/` need this to find their scripts, since the installer
  copies `agents/skills/commands/helpers` into `~/.claude` but deliberately leaves `brain/` — a
  full Node app with its own `node_modules` — in the repo checkout instead of duplicating it)
- **Knowledge vault path (optional)**: (not specified — a markdown vault of decisions, patterns,
  and project notes, if you keep one. `vault-recall` uses this for cross-session memory; leave
  unset and that skill degrades to "no vault configured" rather than failing)
