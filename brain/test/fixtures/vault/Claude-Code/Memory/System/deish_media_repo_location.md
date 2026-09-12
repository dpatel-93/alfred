---
name: deish-media-repo-location
description: "Where the Deish Media brand's files and git repo live on disk"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2486ed6c-ee67-4729-8e0f-bc7650209d45
  modified: 2026-09-07T23:03:48.131Z
---

All "Deish Media" related files go in `C:\Users\Owner\OneDrive\Desktop\DeishMedia`.
That folder is a clone of the private GitHub repo `dpatel-93/deish-media`
("DP Audio — monorepo for audio plugins (Prisma analyzer)"), remote
`https://github.com/dpatel-93/deish-media.git`, containing apparel, audio,
docs, infra, licensing, marketing, plugin-kit, tools, trading, and website
subfolders.

Two pre-existing items sit alongside the repo, untracked by it, and are
intentional — do not move or "clean up" them on a future audit:
- `DP_TradingView_Scripts/` — a separate git repo (own remote:
  `dpatel-93/DP_TradingView_Scripts`). The user confirmed trading tooling is
  part of the Deish Media brand, so this belongs here despite the name split.
- `PrismaSuite-0.22.0-trial.zip` — an audio-plugin installer relevant to the
  audio side of the brand.

**Why**: set up 2026-09-07 so new Deish Media work has one canonical home
instead of scattering across Desktop/Downloads.
**How to apply**: when the user mentions Deish Media, DP Audio, or asks where
brand assets/code should live, point to this folder. Related: [[downloads-auto-organize]].
