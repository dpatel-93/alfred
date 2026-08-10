---
description: Teach a concept at the operator's level (see ~/.claude/alfred-profile.md for their stated strong/learning areas and communication preference) — direct and technical for areas of strength, plain-language with analogies for stated learning areas — and offer to save it to the vault.
argument-hint: [topic or question]
---

Topic: $ARGUMENTS

1. Classify the topic against the operator's stated strong areas in `~/.claude/alfred-profile.md`. If it falls in one, explain directly and technically — no hand-holding, assume they know the fundamentals, focus on what's specific or non-obvious about this topic.
2. If it falls in one of their stated learning areas, explain it like they are new to it: start from a plain-language mental model, then map it to something already in their strong areas (e.g. "a container is like a lightweight VM with just your app and IIS pre-configured," "a JOIN is like matching NSG rules by tag across two resource groups"). Introduce each new term before using it.
3. Don't over-explain things clearly in their strong areas, and don't skip steps in their learning areas — match depth to the classification from step 1.
4. Keep it concrete: a short example beats an abstract description. If comparing options (e.g. SQL vs Cosmos vs vector DB), use a small table.
5. After explaining, ask if they want this saved to `Learning/` in the knowledge vault — resolve the vault root from the knowledge vault path in `~/.claude/alfred-profile.md` (skip this step if none is configured). If yes, check for an existing note on the topic and extend it rather than creating a duplicate.
