---
description: Run a worker/reviewer/refiner loop on the current uncommitted change until a reviewer pass approves it, capped at 3 iterations.
---

Current diff:

!`git diff HEAD`

Run this as a strict iteration loop, max 3 rounds:

1. **Worker pass**: If the diff above already represents finished work, treat round 1's worker output as that diff. Otherwise implement the pending change first.
2. **Reviewer pass**: Spawn a `code-review` (or `reviewer`) subagent with fresh eyes — it has not seen this conversation. Give it the diff and the original goal, and ask it to return a pass/fail verdict plus a concrete, prioritized list of issues (bugs first, then simplification/reuse). Do not let it rubber-stamp; require it to state what it checked.
3. **Refiner pass**: If the reviewer fails the change, fix every issue it raised yourself (don't re-delegate the fix), then go back to step 2 with the updated diff.
4. Stop as soon as a review pass approves, or after 3 rounds total — whichever comes first.
5. If round 3 still fails, stop and surface the unresolved issues to the user plainly: what's still wrong, what you tried, and what you'd need to proceed. Do not keep looping past 3 rounds.
6. Report the final verdict, iteration count, and a short list of what changed each round.
