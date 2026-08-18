# Registers (or removes) a Windows Scheduled Task that starts the ALFRED server
# at user logon, hidden, restarting on failure. Server-only - no browser popup;
# open the UI on demand via Alfred.cmd or the desktop shortcut.
#
# Install:   powershell -ExecutionPolicy Bypass -File Install-AlfredAutostart.ps1
# Uninstall: powershell -ExecutionPolicy Bypass -File Install-AlfredAutostart.ps1 -Uninstall

param(
    [switch]$Uninstall
)

# --- Configuration ---
$taskName = 'AlfredBrain'
$jarvisDir = $PSScriptRoot

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "No scheduled task named '$taskName' found - nothing to remove." -ForegroundColor Yellow
        exit 0
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task '$taskName'." -ForegroundColor Green
    Write-Host "If an ALFRED server is currently running, stop it manually (netstat -ano | findstr :7777)." -ForegroundColor Yellow
    exit 0
}

# --- Resolve node.exe ---
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "node.exe not found on PATH - install Node.js first." -ForegroundColor Red
    exit 1
}
$nodePath = $nodeCmd.Source

if (-not (Test-Path (Join-Path $jarvisDir 'server.mjs'))) {
    Write-Host "server.mjs not found in $jarvisDir - run this script from the jarvis folder." -ForegroundColor Red
    exit 1
}

# --- Build the scheduled task ---
$action = New-ScheduledTaskAction -Execute $nodePath -Argument 'server.mjs' -WorkingDirectory $jarvisDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Task '$taskName' already exists - replacing it." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal `
        -Description 'ALFRED vault-brain server - starts hidden at logon, restarts on failure.' `
        -ErrorAction Stop | Out-Null
} catch {
    Write-Host "Failed to register scheduled task '$taskName': $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Message -match 'Access is denied|0x80070005') {
        Write-Host ""
        Write-Host "This is the standard 'Access is denied' failure when Task Scheduler needs" -ForegroundColor Yellow
        Write-Host "elevation this session didn't have. Two options:" -ForegroundColor Yellow
        Write-Host "  1) Re-run this script from an elevated (Run as Administrator) PowerShell." -ForegroundColor Yellow
        Write-Host "  2) Use the no-admin fallback in this repo:" -ForegroundColor Yellow
        Write-Host "     powershell -ExecutionPolicy Bypass -File Install-AlfredStartup.ps1" -ForegroundColor Yellow
        Write-Host "     (generates AlfredBrain-Startup.vbs with your paths baked in and installs" -ForegroundColor Yellow
        Write-Host "     it into shell:startup so it runs hidden at every logon - no admin needed)" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host "Scheduled task '$taskName' installed." -ForegroundColor Green
Write-Host "  Runs:    $nodePath server.mjs" -ForegroundColor Green
Write-Host "  Working: $jarvisDir" -ForegroundColor Green
Write-Host "  Trigger: at logon, hidden window, auto-restart on failure" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - It will start automatically at your next logon." -ForegroundColor Cyan
Write-Host "  - To start it right now:  Start-ScheduledTask -TaskName $taskName" -ForegroundColor Cyan
Write-Host "  - Then open http://localhost:7777 (or use Alfred.cmd / the desktop shortcut)." -ForegroundColor Cyan
Write-Host "  - To remove:  powershell -ExecutionPolicy Bypass -File Install-AlfredAutostart.ps1 -Uninstall" -ForegroundColor Cyan
