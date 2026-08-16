# --- alfred-speak.ps1 -------------------------------------------------------
# Speaks queued text aloud using the Windows built-in speech engine.
#
# Launched via Task Scheduler by alfred-speak.mjs. That indirection is not
# decoration: a process spawned as a child of the Stop hook dies the moment the
# hook's node process exits, roughly 80ms in, long before speech begins. This
# was measured across every spawn variant (detached, stdio ignore, cmd /c start)
# and all of them lose the child. A scheduled task runs under the Task Scheduler
# service with no parent to inherit that death.
#
# Text arrives via a file, never an argument: response text routinely contains
# quotes, newlines and backticks that no amount of escaping survives.
# ---------------------------------------------------------------------------

param(
    [string]$TextFile = ''
)

$ErrorActionPreference = 'Stop'

$queuePath  = Join-Path $PSScriptRoot '.alfred-speak-queue.txt'
$configPath = Join-Path $PSScriptRoot 'alfred-speak.config.json'
$pidPath    = Join-Path $PSScriptRoot '.alfred-speak.pid'

try {
    # --- Resolve the text ---------------------------------------------------
    if (-not $TextFile) { $TextFile = $queuePath }
    if (-not (Test-Path -LiteralPath $TextFile)) { exit 0 }

    $text = Get-Content -LiteralPath $TextFile -Raw -Encoding UTF8

    # Consume immediately. If a newer response kills this process mid-sentence,
    # nothing is left behind and the stale text can never be spoken twice.
    Remove-Item -LiteralPath $TextFile -Force -ErrorAction SilentlyContinue

    if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

    # --- Settings -----------------------------------------------------------
    $voice = 'Microsoft Zira Desktop'
    $rate = 1
    $volume = 95
    if (Test-Path -LiteralPath $configPath) {
        try {
            $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            if ($null -ne $cfg.voice)  { $voice  = [string]$cfg.voice }
            if ($null -ne $cfg.rate)   { $rate   = [int]$cfg.rate }
            if ($null -ne $cfg.volume) { $volume = [int]$cfg.volume }
        }
        catch { }
    }

    # --- Stop whatever is already speaking ----------------------------------
    # A new answer supersedes the old one; nobody wants two voices at once.
    if (Test-Path -LiteralPath $pidPath) {
        try {
            $old = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
            if ($old -gt 0 -and $old -ne $PID) {
                Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
            }
        }
        catch { }
    }
    Set-Content -LiteralPath $pidPath -Value $PID -Encoding ASCII -Force

    # --- Speak --------------------------------------------------------------
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

    if ($voice) {
        # A missing or renamed voice must not silence the hook.
        try { $synth.SelectVoice($voice) } catch { }
    }

    $synth.Rate   = [Math]::Max(-10, [Math]::Min(10, $rate))
    $synth.Volume = [Math]::Max(0, [Math]::Min(100, $volume))

    $synth.Speak($text)
    $synth.Dispose()

    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    exit 0
}
catch {
    exit 1
}
