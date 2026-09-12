---
name: feedback_browser_verification_traps
description: "The Chrome-extension tab freezes rAF/animations, so UI state read through it is unreliable; verify motion with headless chromium instead"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 743b5fa6-2f9d-410c-a8b7-089aa16eeeb1
  modified: 2026-08-24T12:21:35.637Z
---

When visually verifying UI, the `mcp__claude-in-chrome` tab is **not trustworthy for
anything time-based**. Measured on 2026-08-24 while building scroll-linked motion for
deishmedia.com:

- `document.timeline.currentTime` stays **0** and every CSS animation reports
  `playState: "running"` with `currentTime: 0`. Elements sit frozen in their `from`
  state, so an entrance animation looks like a broken layout.
- `await new Promise(r => requestAnimationFrame(r))` **never resolves** — it hung until
  the 45s CDP timeout. Anything driven by rAF or IntersectionObserver may never fire.
- Screenshots still render, which is what makes this dangerous: the tab looks like it is
  working. Three separate "bugs" diagnosed this way were artifacts (a figure caught
  mid-sweep, a lazy image mid-load, a mark reported as clipped).

**Use headless chromium instead** for anything involving animation, scroll or observers:
`~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe --headless=new
--disable-gpu --window-size=W,H --virtual-time-budget=N --screenshot=out.png <url>`.
Add `--dump-dom` plus a temporary in-page probe script to read computed state. Add
`--no-sandbox` if it dies with a sandbox error.

Traps inside that path too:
- `--disable-javascript` is **not a Chrome flag** and is silently ignored, so a "JS off"
  test can quietly run with JS on. `--blink-settings=scriptEnabled=false` does disable it
  but breaks `--screenshot`. The reliable way to test the no-JS path is to serve a copy of
  the page with the script tags removed.
- Driving an **iframe** from an outer probe page is unreliable: `scrollTo` needs
  `behavior:'instant'` (the site sets `scroll-behavior:smooth`), and rAF/IO often never run
  in that setup. Probe the page directly, not through an iframe.
- Resizing the extension's Chrome window to phone width does not change the layout
  viewport. For responsive checks, measure `scrollWidth` vs `clientWidth` in same-origin
  iframes at fixed widths, or render headless at the target width.

**Why:** a verification tool that fails silently is worse than none — it produces
confident, wrong bug reports and wasted fixes.

**How to apply:** never conclude "the animation is broken" or "content is hidden" from the
extension tab alone. Reproduce it headless first. If the two disagree, the headless run is
the real one. See [[feedback_visual_verification]].
