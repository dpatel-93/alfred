# --- alfred-play.ps1 --------------------------------------------------------
# Plays an audio file that has ALREADY been rendered. No synthesis, no queue, no
# scheduled task.
#
# Why this exists separately from alfred-speak.ps1: that script is launched via
# Task Scheduler because a child of the Stop hook dies ~80ms in, and paying for
# that indirection costs 2-3 seconds before a word is heard. The brain server
# has no such problem - it is long-lived, so a child of it simply survives - and
# the HUD greeting is rendered in advance anyway. Removing both the scheduler
# and the synthesis from that path is the difference between five seconds and
# under one.
#
# Exit: 0 played · 2 no such file · 1 playback failed
# ---------------------------------------------------------------------------

param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$Volume = 95
)

$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot '.alfred-speak.pid'

if (-not (Test-Path -LiteralPath $Path)) { exit 2 }

try {
    # A newer utterance supersedes whatever is still speaking; nobody wants two
    # voices at once. Same pid file the synthesising launcher uses, so the two
    # paths can interrupt each other rather than overlapping.
    if (Test-Path -LiteralPath $pidPath) {
        try {
            $old = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
            if ($old -gt 0 -and $old -ne $PID) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
        } catch { }
    }
    Set-Content -LiteralPath $pidPath -Value $PID -Encoding ASCII -Force

    Add-Type -AssemblyName presentationCore
    $player = New-Object System.Windows.Media.MediaPlayer
    $player.Open([uri]$Path)

    # Open() is asynchronous and the duration is not known immediately; calling
    # Play() before it resolves plays nothing at all, silently.
    $deadline = (Get-Date).AddSeconds(5)
    while (-not $player.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 30
    }
    if (-not $player.NaturalDuration.HasTimeSpan) { $player.Close(); exit 1 }

    $player.Volume = [Math]::Max(0, [Math]::Min(100, $Volume)) / 100
    $player.Play()
    Start-Sleep -Seconds ($player.NaturalDuration.TimeSpan.TotalSeconds + 0.3)
    $player.Stop()
    $player.Close()

    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    exit 0
}
catch {
    exit 1
}
