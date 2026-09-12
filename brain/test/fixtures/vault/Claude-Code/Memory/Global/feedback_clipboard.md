---
name: Always clip to clipboard
description: After editing DP_FuturesAlgo.txt (or any TradingView script), always copy the file contents to the clipboard using clip
type: feedback
---

After every edit to TradingView Pine Script files, always copy the updated file to the clipboard (`cat <file> | clip`).

**Why:** User pastes directly into TradingView editor — saves a manual step every time.
**How to apply:** Run `cat <filepath> | clip` immediately after completing edits to any TradingView script file.
