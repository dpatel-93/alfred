# Creates a Desktop shortcut to Alfred.cmd.
# Run this once: powershell -ExecutionPolicy Bypass -File Alfred-Desktop-Shortcut.ps1

$brainDir = $PSScriptRoot
$targetCmd = Join-Path $brainDir 'Alfred.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Alfred.lnk'

if (-not (Test-Path $targetCmd)) {
    Write-Host "Alfred.cmd not found at $targetCmd" -ForegroundColor Red
    exit 1
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetCmd
$shortcut.WorkingDirectory = $brainDir
$shortcut.Description = 'Launch ALFRED - HUD, semantic search and voice'
$shortcut.IconLocation = 'shell32.dll,13'
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
Write-Host "Double-click it any time to start ALFRED." -ForegroundColor Green
