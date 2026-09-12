---
name: downloads-auto-organize
description: Scheduled task that auto-sorts Downloads into DP by file type
metadata: 
  node_type: memory
  type: project
  originSessionId: 2486ed6c-ee67-4729-8e0f-bc7650209d45
  modified: 2026-09-07T23:03:55.818Z
---

`C:\Users\Owner\Downloads` is auto-organized into
`C:\Users\Owner\OneDrive\Desktop\DP` by a Windows Scheduled Task named
`Alfred-OrganizeDownloads`, running
`C:\Users\Owner\Scripts\Organize-Downloads.ps1` every 15 minutes. The script
checks actual system idle time itself (via GetLastInputInfo, threshold 5 min)
and no-ops if the machine isn't idle — a Task Scheduler ONIDLE trigger was
deliberately avoided because it's unreliable about re-firing.

Files are sorted by extension into DP's existing convention
(`_Docs`, `_Images`, `_Audio`, `_Videos`, `_Installers`, `_Zips`, `_Scripts`,
`_Torrents`, unmatched -> `_Misc`).

**Critical safeguard**: folders are never split apart. Any folder sitting
directly in Downloads (with files or its own subfolders inside) moves as a
single unit into `DP\_Extracts`, never descended into. This exists because
past runs scattered a dropped folder's contents across DP's type folders,
making it impossible to tell which files belonged together.

Files under 2 minutes old, or with extensions `.crdownload/.part/.tmp/.download`,
are skipped (still-downloading protection). Name collisions get `(2)`, `(3)`,
etc. appended rather than overwriting. Log at
`C:\Users\Owner\Scripts\Organize-Downloads.log`.

**Why**: user wants Downloads auto-cleared into the already-existing DP
folder structure without manual effort, and got burned before by folder
contents getting scattered.
**How to apply**: if the user reports files missing from Downloads, check
DP's category folders or `DP\_Extracts` first — they were likely
auto-moved, not lost. A DP-folder audit/cleanup pass was planned as a
follow-up (not yet done as of 2026-09-07). Related: [[deish-media-repo-location]].
