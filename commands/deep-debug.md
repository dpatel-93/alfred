---
description: Layered debugging for a hard bug — reproduce, isolate, then spawn parallel per-layer investigators (infra/network/app/data) before verifying the fix with a test.
argument-hint: [bug description or error]
---

Bug to debug: $ARGUMENTS

Work through these phases in order — do not jump to a fix before phase 3:

1. **Reproduce**: Find or write the minimal steps/command that reliably triggers the problem. If you can't reproduce it, say so explicitly and ask the operator for the missing repro steps rather than guessing.
2. **Isolate**: Narrow down which layer(s) are plausibly involved — infrastructure/network (DNS, firewall, NSG, connectivity), application (code logic, config, dependencies), or data (schema, query, bad state). Use the actual error and evidence, not assumption.
3. **Hypothesize in parallel**: For each layer still in play after isolation, spawn one investigator subagent in the same message, each with a specific hypothesis to confirm or rule out and the exact evidence to gather (logs, config, a targeted test). Don't spawn a layer you already ruled out in step 2.
4. Read every investigator's findings yourself. Identify the actual root cause — if two layers both show symptoms, find which one is upstream.
5. Implement the fix for the root cause, not just the symptom.
6. **Verify**: Write or run a test that fails before the fix and passes after it. If a proper test isn't feasible, re-run the exact repro from step 1 and show the before/after output.
7. Report root cause, fix, and verification evidence — skip the investigation play-by-play unless it's needed to justify the diagnosis.
