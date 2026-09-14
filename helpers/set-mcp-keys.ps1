<#
.SYNOPSIS
    One-time setup: stores the API keys the pending MCP servers need as
    persistent Windows User environment variables, so they never have to be
    pasted into a Claude Code chat transcript.

.HOW TO USE
    1. Open THIS FILE yourself (Notepad, VS Code, whatever) and replace each
       "PASTE-...-HERE" placeholder below with the real key.
    2. Save it.
    3. Run it: right-click > Run with PowerShell, or from a terminal:
           powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\helpers\set-mcp-keys.ps1"
    4. Close and reopen your terminal / Claude Code session — User env vars
       only apply to NEW processes, not ones already running.
    5. Tell Claude which ones you filled in; it reads them from the
       environment at that point and wires up `claude mcp add` without ever
       needing you to paste the raw value into the chat.

.NOTES
    - [Environment]::SetEnvironmentVariable(..., "User") persists in the
      registry (HKCU\Environment) — survives reboots, unlike $env:NAME which
      is only good for the current process.
    - Skip any block whose key you don't have yet — leaving a placeholder
      unset is harmless, it just means that one MCP server isn't wired up yet.
    - Once all three are set and confirmed working, it's fine to blank out
      the values in this file again (or delete it) — it's a one-time
      installer, not meant to be a secrets store itself.
#>

# --- GitHub (fine-grained PAT) --------------------------------------------
# github.com -> Settings -> Developer settings -> Personal access tokens
$githubPat = "PASTE-YOUR-GITHUB-PAT-HERE"
if ($githubPat -and $githubPat -ne "PASTE-YOUR-GITHUB-PAT-HERE") {
    [Environment]::SetEnvironmentVariable("GITHUB_PAT", $githubPat, "User")
    Write-Host "GITHUB_PAT set." -ForegroundColor Green
} else {
    Write-Host "GITHUB_PAT skipped (placeholder still in place)." -ForegroundColor Yellow
}

# --- Stitch (Google design-to-code) ---------------------------------------
# The PREVIOUS key leaked in a chat transcript and was flagged for rotation —
# get a genuinely NEW one, don't reuse the old value.
$stitchKey = "PASTE-YOUR-NEW-STITCH-API-KEY-HERE"
if ($stitchKey -and $stitchKey -ne "PASTE-YOUR-NEW-STITCH-API-KEY-HERE") {
    [Environment]::SetEnvironmentVariable("STITCH_API_KEY", $stitchKey, "User")
    Write-Host "STITCH_API_KEY set." -ForegroundColor Green
} else {
    Write-Host "STITCH_API_KEY skipped (placeholder still in place)." -ForegroundColor Yellow
}

# --- 21st.dev Magic (React/Tailwind UI generation) -------------------------
# Get a key at https://21st.dev/mcp — old keys were reset platform-wide.
$twentyFirstKey = "PASTE-YOUR-21ST-DEV-KEY-HERE"
if ($twentyFirstKey -and $twentyFirstKey -ne "PASTE-YOUR-21ST-DEV-KEY-HERE") {
    [Environment]::SetEnvironmentVariable("TWENTY_FIRST_API_KEY", $twentyFirstKey, "User")
    Write-Host "TWENTY_FIRST_API_KEY set." -ForegroundColor Green
} else {
    Write-Host "TWENTY_FIRST_API_KEY skipped (placeholder still in place)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Close and reopen your terminal / Claude Code session for these to take effect." -ForegroundColor Cyan
