# Contributing to Alfred

Thanks for the interest. Alfred's contribution model is **suggestions, not code**:

## What's welcome

- **Issues** — bugs, installer problems on your platform, a rough edge in the HUD, a missing
  agent role you think belongs on the roster, a skill or command idea. Be specific: what you
  ran, what you expected, what happened instead.
- **Discussions** — everything looser than a bug report: "have you considered...", questions
  about how a piece works, showing off something you built on top of Alfred.

Every issue and discussion gets read. If an idea is good, it gets built into the framework
directly rather than merged from a PR.

## What's not: pull requests

Alfred doesn't accept or review pull requests. This isn't a judgment on contribution quality —
it's because the framework is deliberately curated rather than crowd-built:

- The **role roster** (`skills/orgagent/references/charters/`) is scoped on purpose. Roles get added when they're real,
  durable career archetypes (a RAG pipeline engineer, a FinOps engineer) — not for every
  framework or platform that exists (see `skills/orgagent/references/ORG.md` for the full charter contract every
  agent must satisfy, and `helpers/validate-org.mjs` for how that gets enforced).
- The **CLAUDE.md templates, onboarding flow, and installer** are the first thing a new
  operator experiences. Getting that experience right requires a single coherent voice, not a
  patchwork of independently-reviewed changes.
- The **HUD** (`brain/`) has an intentional visual identity. Styling changes land as part of a
  deliberate design pass, not as incremental PRs.

If you open a PR anyway, it'll be closed with a pointer back to this file — not out of
unfriendliness, just to keep the maintenance model honest about what it actually is.

## If you fork it

Fork away — it's MIT licensed. If you build something substantially different on top of Alfred,
that's a great use of a fork; it doesn't need to come back as a PR to belong here.
