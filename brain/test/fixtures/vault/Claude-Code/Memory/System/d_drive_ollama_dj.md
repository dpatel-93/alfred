---
name: d-drive-ollama-dj
description: "D:\\ drive hosts both Ollama's model cache (blobs/manifests) and DJ/production software data"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3857e8b3-7c7d-4c6f-8364-f357cb55c939
  modified: 2026-09-06T15:29:26.261Z
---

D:\ is primarily a music production / DJ drive (Serato, Serato Backup, VirtualDJ, Native Instruments, reFX, Pioneer, Samples, Tracks folders) that also happens to host Ollama's model storage directly at its root: `D:\blobs` (content-addressed model weight/config files, named `sha256-<hash>`) and `D:\manifests` (per-model manifest pointers). This means `OLLAMA_MODELS` is effectively set to `D:\`.

At least one Qwen-family model (im_start/im_end chat template with tool-calling XML tags) is cached there, alongside several large blobs (hundreds of MB to ~6.5GB) consistent with full model weight files.

**Why this matters:** D: is a shared, large media drive rather than a dedicated model-cache drive — disk space for Ollama models competes with DJ sample libraries and track storage. If disk space runs low or the DJ software's own housekeeping tools touch the drive root, don't mistake the `blobs`/`manifests` folders for orphaned junk — they are the [[ollama-interns]] local-model cache referenced in the user's Alfred framework.

**How to apply:** When helping with Ollama setup, model management, or disk-space cleanup on this machine, check `D:\blobs` and `D:\manifests` before assuming free space or suggesting deletions on D:\. When advising on DJ-drive cleanup, don't touch these two folders.
