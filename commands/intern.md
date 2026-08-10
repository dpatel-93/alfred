---
description: Explicitly offload a draft, summary, or mechanical transform to the local Ollama intern tier for this one task, then review its output before using it.
argument-hint: [task for the local model]
---

Task for the intern model: $ARGUMENTS

This is a manual, one-off trigger for the intern tier. Load the `ollama-interns` skill first — it holds the current model matrix (which local model to use for what, right-sized to the operator's actual hardware — see `~/.claude/alfred-profile.md`'s Primary stack/tools) and the review rules. Do not hardcode a model name here; the skill is the single source of truth for that and may change as models get added/removed.

1. Confirm the task is actually intern-appropriate per the skill's rules (draft/summary/classification/mechanical transform). If it needs real reasoning or domain judgment, say so and do it yourself at the Sonnet/Opus tier instead of delegating down.
2. Follow the skill's invocation pattern and model choice, run it, and read the raw output critically — check it against the actual requirement, don't just relay it. Look for hallucinated facts, wrong assumptions, or generic filler.
3. If it's good enough as a draft, present it clearly marked as intern output pending review. If it's wrong or low quality, fix it yourself or redo the task properly rather than polishing a bad draft.
4. Never treat intern output as final without this review step, even for small tasks.
