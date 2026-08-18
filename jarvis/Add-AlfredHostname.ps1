<#
.SYNOPSIS
    Maps http://alfred/ to the loopback address so the Alfred HUD has a friendly URL.

.DESCRIPTION
    Appends "127.0.0.1  alfred" to the Windows hosts file. Idempotent — re-running
    it detects an existing entry and makes no change. Requires elevation because
    the hosts file is writable only by Administrators.

    After running this, the HUD answers on http://alfred/ (port 80, if the server
    managed to bind it) or http://alfred:7777 (always).

.PARAMETER Remove
    Removes the Alfred hosts entry instead of adding it.

.EXAMPLE
    .\Add-AlfredHostname.ps1
.EXAMPLE
    .\Add-AlfredHostname.ps1 -Remove
#>
[CmdletBinding()]
param(
    [switch] $Remove
)

# --- Configuration ---
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$hostName  = 'alfred'
$entry     = "127.0.0.1`t$hostName"
$marker    = '# Alfred HUD'

# --- Preflight ---
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'This script edits the hosts file and must run elevated.' -ForegroundColor Red
    Write-Host 'Re-run it from an Administrator PowerShell prompt:' -ForegroundColor Yellow
    Write-Host "    powershell -File `"$PSCommandPath`"" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $hostsPath)) {
    Write-Host "hosts file not found at $hostsPath" -ForegroundColor Red
    exit 1
}

# --- Main Logic ---
$lines   = Get-Content -Path $hostsPath
$pattern = "^\s*[\d.:a-fA-F]+\s+$hostName\s*$"
$present = $lines | Where-Object { $_ -match $pattern }

if ($Remove) {
    if (-not $present) {
        Write-Host "No '$hostName' entry found — nothing to remove." -ForegroundColor Yellow
        exit 0
    }
    $kept = $lines | Where-Object { $_ -notmatch $pattern -and $_ -ne $marker }
    Set-Content -Path $hostsPath -Value $kept -Encoding ASCII
    Write-Host "Removed the '$hostName' hosts entry." -ForegroundColor Green
    exit 0
}

if ($present) {
    Write-Host "'$hostName' already maps to loopback — no change needed." -ForegroundColor Green
    Write-Host '  http://alfred/       (port 80, if bound)'
    Write-Host '  http://alfred:7777/  (always)'
    exit 0
}

try {
    Add-Content -Path $hostsPath -Value @($marker, $entry) -Encoding ASCII -ErrorAction Stop
} catch {
    Write-Host "Failed to write the hosts file: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "Added '$entry' to the hosts file." -ForegroundColor Green
Write-Host 'Alfred is now reachable at:' -ForegroundColor Green
Write-Host '  http://alfred/       (port 80, if bound)'
Write-Host '  http://alfred:7777/  (always)'
