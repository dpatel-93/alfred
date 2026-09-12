---
name: reminder-cli-anything-install
description: Pending action for Batman at his desk — install the CLI-Anything plugin with two slash commands
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b97087f-0813-409b-a4ba-9777ca9c0126
  modified: 2026-08-16T11:16:03.740Z
---

**Pending, requested 2026-08-16: install CLI-Anything when at the desk.**

It was evaluated and approved during the 2026-08-16 repo review, but installation needs two Claude
Code slash commands that only the operator can type — Claude cannot invoke slash commands itself:

```
/plugin marketplace add HKUDS/CLI-Anything
/plugin install cli-anything
```

Then `/cli-anything <software-path-or-repo>` generates a CLI for that software.

**Why:** `HKUDS/CLI-Anything` (Apache-2.0) generates production-grade CLIs for GUI software so
agents can drive it. Git Bash is already installed, which satisfies its Windows requirement.

**Surface this at the start of a desk session** until it is done, then delete this memory file.

Related: [[project_alfred]]
