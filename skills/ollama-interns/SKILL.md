---
name: ollama-interns
description: Offloads token-burning grunt work to free local Ollama models (the "interns" tier) on the operator's local GPU (see ~/.claude/alfred-profile.md's Primary stack/tools for the specific hardware). Use when a subtask is a draft, summary, bulk classification, embedding, or mechanical text transform where a 4-9B local model is adequate and Claude API tokens would be wasted — especially inside loops over many files/items. Never for final code, architecture, or anything shipped unreviewed.
---

# Ollama Interns — free local labor, always reviewed

Hardware reality: fit depends on the operator's local GPU VRAM (see
~/.claude/alfred-profile.md's Primary stack/tools for the specific hardware).
Installed models (`ollama list`):

| Model | Fits | Use for |
|---|---|---|
| `qwen3.5:9b` | tight on lower-VRAM GPUs (partial CPU offload, slower) | best-quality drafts, summaries, extraction |
| `qwen3.5:4b` | comfortable, fast on most GPUs | default intern — summaries, classification, first drafts |
| `qwen2.5:1.5b-instruct` | instant, fully in VRAM on most GPUs | fast Q&A/summaries — Alfred /api/ask default |
| `qwen2.5-coder:1.5b-base` | instant | mechanical code transforms, boilerplate, comments |
| `nomic-embed-text` | instant | embeddings (274MB, CPU-fine) |

## Invocation (from Bash)

One-shot prompt:
```bash
ollama run qwen3.5:4b "Summarize the following in 5 bullets: $(cat notes.md)"
```

File through stdin (avoids quoting pain on Windows/Git Bash):
```bash
cat big-log.txt | ollama run qwen3.5:4b "Extract every distinct error message as a list."
```

Embeddings via local API:
```bash
curl -s http://localhost:11434/api/embeddings -d '{"model":"nomic-embed-text","prompt":"text here"}'
```

Structured output — ask for JSON and validate it yourself; small models drift:
```bash
cat items.txt | ollama run qwen3.5:4b "Return ONLY a JSON array of {name, category}."
```

## Rules of engagement

- **Right-size**: default `qwen3.5:4b`; escalate to `:9b` only when 4b output fails
  review; drop to `qwen2.5-coder:1.5b-base` for pure mechanical transforms.
- **Always review**: intern output is a draft. A Claude tier (you, or a Haiku/Sonnet
  subagent for bulk) checks it before it's used or shown as fact.
- **Batch loops locally**: summarizing 40 files? Loop `ollama run` in Bash, then
  review the batch in ONE Claude pass — that's where the token savings live.
- **Never intern**: final code, security-sensitive analysis, architecture decisions,
  anything numeric-critical, anything going straight to the user.
- **Latency note**: first call loads the model into VRAM (~5-15s); subsequent calls
  are warm. Don't interleave 9b and 4b in a loop — model swapping thrashes VRAM.
- If `ollama` isn't running, `ollama serve` starts it (usually auto on Windows).
