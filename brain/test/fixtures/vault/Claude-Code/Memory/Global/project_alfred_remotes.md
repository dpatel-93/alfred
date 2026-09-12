---
name: project-alfred-remotes
description: "Alfred repo has two remotes — origin (public, the working one) and archive (private, stale mirror; ignore its divergence)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4a54846b-8c7d-43b7-b26c-0944e3c86c26
  modified: 2026-08-14T17:29:51.955Z
---

The Alfred repo at `C:\Users\dishi\OneDrive\Desktop\_Projects\Alfred` has **two** git remotes:

- **`origin` → github.com/dpatel-93/alfred (PUBLIC)** — the working remote. Push here.
- **`archive` → github.com/dpatel-93/alfred-archive (PRIVATE)** — a stale mirror with its own
  divergent history. As of 2026-08-14 it read 37 ahead / 130 behind vs local. **That divergence is
  expected and must not be "fixed".**

**Why:** On 2026-08-14 a push to `archive` was rejected, which looked like a badly diverged repo and
nearly led to a force-push that would have discarded 130 commits — including work that replaced real
project names with fictional ones and removed a screenshot exposing a private note title. Local was
actually 1-ahead/0-behind of `origin` the whole time. The alarm was entirely an artifact of checking
the wrong remote.

**How to apply:** Default to `git push origin master`. If a push is rejected, check *which* remote
before concluding anything about divergence, and never force-push either one. Other related repos:
`alfred-brain` (private), `alfred-v3-archive` (private). See [[project_alfred]].
