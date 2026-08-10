# Alfred v4 installer - merges this repo into the current machine's Claude Code setup.
# Idempotent: backs up before touching, merges (never deletes), rewrites source-machine
# paths to the target profile. Run with -DryRun to preview.

param(
    [string]$ClaudeHome = (Join-Path $env:USERPROFILE ".claude"),
    [string]$HomeDir    = $env:USERPROFILE,
    [switch]$DryRun,
    [switch]$SkipClaudeMd
)

# --- Configuration ---
$repoRoot   = $PSScriptRoot
$sourceUser = "C:/Users/dishi"   # path baked into hooks/settings at export time
# Derived from $HomeDir, NOT $env:USERPROFILE. They are the same thing by default, but when
# -HomeDir is passed explicitly (a sandboxed install test, a profile somewhere else) reading
# the env var instead rewrote every hook path to the WRONG home while cheerfully reporting
# success — the parameter was honoured for destinations and silently ignored for rewriting.
$targetUser = $HomeDir -replace '\\', '/'
$stamp      = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir  = Join-Path $ClaudeHome "backups\alfred-v4-install-$stamp"

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Copy-Merged($from, $to) {
    if ($DryRun) { Write-Warn2 "[dry-run] would merge $from -> $to"; return }
    if (Test-Path $to) {
        New-Item -ItemType Directory -Force $backupDir | Out-Null
        Copy-Item -Recurse -Force $to (Join-Path $backupDir (Split-Path $to -Leaf)) -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force $to | Out-Null
    Copy-Item -Recurse -Force "$from\*" $to
    Write-Ok "merged $(Split-Path $from -Leaf) -> $to"
}

# --- Main Logic ---
try {
    Write-Step "Alfred v4 install (target: $ClaudeHome)"
    if ($DryRun) { Write-Warn2 "DRY RUN - no changes will be made" }

    Copy-Merged (Join-Path $repoRoot "agents")   (Join-Path $ClaudeHome "agents")
    Copy-Merged (Join-Path $repoRoot "skills")   (Join-Path $ClaudeHome "skills")
    Copy-Merged (Join-Path $repoRoot "commands") (Join-Path $ClaudeHome "commands")
    Copy-Merged (Join-Path $repoRoot "helpers")  (Join-Path $ClaudeHome "helpers")

    # CLAUDE.md files (skippable; backed up if present)
    if (-not $SkipClaudeMd) {
        foreach ($pair in @(
            @{ src = "claude-md\home-CLAUDE.md";   dst = Join-Path $HomeDir    "CLAUDE.md" },
            @{ src = "claude-md\global-CLAUDE.md"; dst = Join-Path $ClaudeHome "CLAUDE.md" }
        )) {
            $src = Join-Path $repoRoot $pair.src
            if ($DryRun) { Write-Warn2 "[dry-run] would install $($pair.src) -> $($pair.dst)"; continue }
            if (Test-Path $pair.dst) {
                New-Item -ItemType Directory -Force $backupDir | Out-Null
                Copy-Item -Force $pair.dst (Join-Path $backupDir ((Split-Path $pair.dst -Leaf) + "." + [IO.Path]::GetFileName($pair.src)))
            }
            Copy-Item -Force $src $pair.dst
            Write-Ok "installed $($pair.src)"
        }
    }

    # Settings: path-rewritten; only auto-written when absent
    $settingsSrc = Join-Path $repoRoot "settings\settings.reference.json"
    $settingsDst = Join-Path $ClaudeHome "settings.json"
    $rewritten = (Get-Content $settingsSrc -Raw) -replace [regex]::Escape($sourceUser), $targetUser
    $rewritten = $rewritten -replace [regex]::Escape(($sourceUser -replace '/', '\\\\')), ($targetUser -replace '/', '\\\\')
    # Git-Bash/WSL-style form ("//c/Users/dishi" — lowercase drive letter, double leading
    # slash) some permission patterns use, since Claude Code's own path matching sees that
    # form on Windows when a hook or pattern runs through bash. Neither of the two rewrites
    # above touches it, so without this it silently survives an install untouched.
    $sourceDrive = $sourceUser.Substring(0, 1).ToLower()
    $sourceUserPosix = "//$sourceDrive" + $sourceUser.Substring(2)
    $targetDrive = $targetUser.Substring(0, 1).ToLower()
    $targetUserPosix = "//$targetDrive" + $targetUser.Substring(2)
    $rewritten = $rewritten -replace [regex]::Escape($sourceUserPosix), $targetUserPosix
    if ($DryRun) { Write-Warn2 "[dry-run] would handle settings.json" }
    elseif (-not (Test-Path $settingsDst)) {
        Set-Content -Path $settingsDst -Value $rewritten -Encoding utf8
        Write-Ok "wrote settings.json (no existing file)"
    } else {
        Set-Content -Path (Join-Path $ClaudeHome "settings.merged-proposal.json") -Value $rewritten -Encoding utf8
        Write-Warn2 "settings.json exists - wrote settings.merged-proposal.json; merge hooks/permissions manually"
    }

    if (-not $DryRun) {
        Copy-Item -Force (Join-Path $repoRoot "settings\config-policy.json") (Join-Path $ClaudeHome "config-policy.json")
        Write-Ok "installed config-policy.json"
    }

    # Operator profile: NEVER overwrite an existing one — a re-run must not clobber someone's
    # answers. Only scaffolds a blank template so the "Check ~/.claude/alfred-profile.md"
    # instruction in agent charters resolves to something even if this script is run
    # directly instead of through ONBOARDING.md.
    $profileDst = Join-Path $ClaudeHome "alfred-profile.md"
    if ($DryRun) {
        Write-Warn2 "[dry-run] would scaffold alfred-profile.md if absent"
    } elseif (-not (Test-Path $profileDst)) {
        Copy-Item -Force (Join-Path $repoRoot "claude-md\alfred-profile.template.md") $profileDst
        Write-Ok "scaffolded alfred-profile.md (blank — fill it in, or ask Claude to run ONBOARDING.md)"
    } else {
        Write-Ok "alfred-profile.md already exists, left untouched"
    }

    Write-Step "Done. Backup (if any): $backupDir"
    Write-Host "Next: review settings.merged-proposal.json if produced; run 'claude' and check /status." -ForegroundColor Cyan
}
catch {
    Write-Host "INSTALL FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
