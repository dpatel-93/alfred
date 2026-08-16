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
    $engine = 'edge'
    $edgeVoice = 'en-GB-RyanNeural'
    if (Test-Path -LiteralPath $configPath) {
        try {
            $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            if ($null -ne $cfg.voice)     { $voice     = [string]$cfg.voice }
            if ($null -ne $cfg.rate)      { $rate      = [int]$cfg.rate }
            if ($null -ne $cfg.volume)    { $volume    = [int]$cfg.volume }
            if ($null -ne $cfg.engine)    { $engine    = [string]$cfg.engine }
            if ($null -ne $cfg.edgeVoice) { $edgeVoice = [string]$cfg.edgeVoice }
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

    # --- Speak: neural first, built-in voice as the safety net ---------------
    # The neural voice needs the network. Offline, on a lapsed endpoint, or on a
    # machine where `npm install` has never run in this folder, it fails - and a
    # talk-back that goes silent is indistinguishable from one that is broken.
    # So every failure path falls through to the built-in voice rather than
    # returning. Robotic beats absent.
    $spoken = $false
    $usedEngine = 'none'
    $why = ''

    if ($engine -eq 'edge') {
        $mp3 = Join-Path ([IO.Path]::GetTempPath()) ("alfred-speak-$PID.mp3")
        $tmpText = Join-Path ([IO.Path]::GetTempPath()) ("alfred-speak-$PID.txt")
        try {
            Set-Content -LiteralPath $tmpText -Value $text -Encoding UTF8 -NoNewline
            $synthScript = Join-Path $PSScriptRoot 'alfred-tts-edge.mjs'
            # Task Scheduler does not necessarily inherit the interactive PATH,
            # so a bare `node` can fail here while working perfectly in a shell.
            # Resolve it, and record what happened either way.
            $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
            if (-not $nodeExe) {
                foreach ($cand in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
                    if (Test-Path -LiteralPath $cand) { $nodeExe = $cand; break }
                }
            }
            if (-not $nodeExe) { throw 'node not found on PATH' }
            # $ErrorActionPreference is 'Stop' for this script, which turns any
            # native stderr write into a TERMINATING error — so a synthesis that
            # merely logged progress would be treated as a crash. Relax it for
            # the call, keep the output, and judge on the exit code alone.
            $prevEAP = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $synthOut = & $nodeExe $synthScript --text-file $tmpText --out $mp3 `
                --voice $edgeVoice --rate $rate 2>&1
            $synthCode = $LASTEXITCODE
            $ErrorActionPreference = $prevEAP
            if ($synthCode -ne 0) { $why = "synth exit ${synthCode}: $($synthOut -join ' ' )" }
            if ($synthCode -eq 0 -and (Test-Path -LiteralPath $mp3)) {
                Add-Type -AssemblyName presentationCore
                $player = New-Object System.Windows.Media.MediaPlayer
                $player.Open([uri]$mp3)
                # Open() is asynchronous; the duration is not known immediately and
                # playing before it is known plays nothing at all.
                $deadline = (Get-Date).AddSeconds(5)
                while (-not $player.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) {
                    Start-Sleep -Milliseconds 40
                }
                if ($player.NaturalDuration.HasTimeSpan) {
                    $player.Volume = [Math]::Max(0, [Math]::Min(100, $volume)) / 100
                    $player.Play()
                    Start-Sleep -Seconds ($player.NaturalDuration.TimeSpan.TotalSeconds + 0.3)
                    $spoken = $true
                    $usedEngine = 'edge'
                } else { $why = 'duration never resolved' }
                $player.Stop(); $player.Close()
            }
        }
        catch { $why = $_.Exception.Message }
        finally {
            Remove-Item -LiteralPath $mp3 -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $tmpText -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not $spoken) {
        $usedEngine = 'system'
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
    }

    # Which engine actually spoke, and why the preferred one did not. Talk-back
    # fails by falling back, and a fallback sounds like a working speaker with
    # the wrong voice — there is no error anywhere to notice. This file is the
    # only way to tell "the neural voice is off" from "the neural voice failed".
    try {
        @{
            at = (Get-Date).ToString('o')
            requested = $engine
            used = $usedEngine
            voice = if ($usedEngine -eq 'edge') { $edgeVoice } else { $voice }
            why = $why
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.alfred-speak-last.json') -Encoding UTF8
    } catch { }

    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    exit 0
}
catch {
    exit 1
}
