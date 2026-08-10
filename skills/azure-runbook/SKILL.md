---
name: azure-runbook
description: Scaffolds an Azure Automation runbook (PowerShell) in this framework's production shape for Entra/Graph/Table Storage automations — phased structure, Managed Identity + Key Vault auth chain, retry/backoff, health checks, idempotency, and exit codes. Use when the user asks to write, scaffold, or review an Azure Automation runbook, a scheduled PowerShell automation, or a "sync"/"alert" script that authenticates via Managed Identity.
---

# Azure Automation Runbook Structure

This framework's production runbook shape, mined from `Sync-EntraAppsToTable.ps1` and
`Send-AppExpiryAlerts.ps1` (TenantSync project — 3000+ apps synced
daily). Not a toy template — this is what's actually running in Azure Automation.

## Skeleton

```
Runbook.ps1
├── Comment-based help (.SYNOPSIS/.DESCRIPTION/.PARAMETER/.NOTES with exit codes)
├── param() block — string-typed switches (Automation passes strings, not bools)
├── $ErrorActionPreference = "Stop" (or "Continue" for multi-item loops that must finish)
├── Configuration (hashtables: $KeyVaultConfig, $AppConfig, $TableName)
├── Phase 0: Auth chain (Managed Identity -> Key Vault -> SPN token)
├── Helper functions (Write-Phase, Write-Log, retry wrapper, health checks)
├── Phase 1..N: Discovery / Processing / Sync (each phase = Write-Phase banner)
└── Summary block + explicit exit code
```

## Phase 0: The auth chain (always this order)

Managed Identity is step 1 — it authenticates the runbook to Azure itself, nothing
else. It then unlocks Key Vault, which hands back the *real* credential (an SPN
secret) used to talk to the actual target API (Graph, ServiceNow, etc.).

```powershell
$ErrorActionPreference = "Continue"   # multi-item loop — one bad app shouldn't kill the run

$KeyVaultConfig = @{
    VaultName        = "ets-cloudops-kv"
    ClientSecretName = "TenantSync-Client-Secret"
}
$AppConfig = @{ TenantId = "<tenant-guid>"; ClientId = "<spn-client-id>" }

Write-Output "STEP 1/4: Authenticating with System-assigned Managed Identity..."
try {
    Connect-AzAccount -Identity -ErrorAction Stop | Out-Null
} catch {
    Write-Error "CRITICAL: Failed to authenticate with System MI: $_"
    exit 10   # 10-14 reserved for auth/config failures — see Exit Codes below
}

Write-Output "STEP 2/4: Retrieving SPN client secret from Key Vault..."
$kvSecret = Get-AzKeyVaultSecret -VaultName $KeyVaultConfig.VaultName -Name $KeyVaultConfig.ClientSecretName -ErrorAction Stop
$ClientSecret = $kvSecret.SecretValue | ConvertFrom-SecureString -AsPlainText

Write-Output "STEP 3/4: Obtaining Graph access token via SPN client credentials..."
$body = @{ grant_type = "client_credentials"; client_id = $AppConfig.ClientId; client_secret = $ClientSecret; scope = "https://graph.microsoft.com/.default" }
$tokenResponse = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$($AppConfig.TenantId)/oauth2/v2.0/token" -ContentType "application/x-www-form-urlencoded" -Body $body
$script:GraphAccessToken = $tokenResponse.access_token

# Clear plaintext secret from memory once consumed
$ClientSecret = $null; [System.GC]::Collect()
```

See [[graph-api-rest]] for the pagination + retry wrapper used against the token above.

## Phase banners and structured logging

```powershell
function Write-Phase { param([string]$Message)
    Write-Output ""
    Write-Output "════════════════════════════════════════════"
    Write-Output "  $Message"
    Write-Output "════════════════════════════════════════════"
}
function Write-Log { param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    switch ($Level) {
        "ERROR" { Write-Error "[$ts] [$Level] $Message" }
        "WARN"  { Write-Warning "[$ts] [$Level] $Message" }
        default { Write-Verbose "[$ts] [$Level] $Message" -Verbose }
    }
}
```
Always `Write-Output`, never `Write-Host` — Automation job logs only capture the
output stream.

## Health checks before committing changes

Before a sync writes anything destructive (marking rows inactive, deleting), sanity-check
the discovery counts so an API/permission hiccup doesn't wipe good data:

```powershell
function Test-SyncHealthCheck {
    param([int]$Discovered, [int]$TableRecordCount, [int]$MinExpected = 2500)
    $issues = @()
    if ($Discovered -lt $MinExpected) { $issues += "CRITICAL: only $Discovered discovered (expected >= $MinExpected)" }
    $dropPercent = if ($TableRecordCount -gt 0) { (($TableRecordCount - $Discovered) / $TableRecordCount) * 100 } else { 0 }
    if ($dropPercent -gt 25) { $issues += "CRITICAL: $([Math]::Round($dropPercent,1))% record drop — possible API/permission failure" }
    return $issues
}
```
A `-SafetyThreshold` param (e.g. max 500 rows marked inactive per run) is the
companion guardrail — never let one run silently delete everything.

## Idempotency + safe re-runs

- Sync operations: `InsertOrReplace` / upsert, never insert-only (see [[project-note]]
  vault path for Table Storage pattern details).
- Notification/alert runbooks: write an audit row keyed by
  `PartitionKey=<entityId>, RowKey="<credId>_<threshold>"` and skip if it already
  exists — makes a daily cron safe to re-run without duplicate emails.
- Always support `-DryRun` / `-WhatIf`-style switches that log every action but
  skip the actual write/send call.
- Support `-TestAppFilter` / `-SampleSize` params for scoped manual testing before
  a full production run.

## Retry with exponential backoff

```powershell
function Invoke-GraphRequestWithRetry {
    param([string]$Uri, [hashtable]$Headers, [int]$MaxRetries = 3, [int]$InitialDelaySeconds = 2)
    $attempt = 0; $delay = $InitialDelaySeconds
    while ($attempt -lt $MaxRetries) {
        try { return Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Get -ErrorAction Stop }
        catch {
            $attempt++
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($attempt -lt $MaxRetries -and ($statusCode -eq 429 -or $statusCode -ge 500)) {
                Start-Sleep -Seconds $delay; $delay *= 2
            } else { throw }
        }
    }
}
```

## Exit code convention (used for Automation alerting)

| Range | Meaning |
|---|---|
| 0 | Success |
| 1 | Completed with (non-fatal) errors |
| 2 | Completed with health-check warnings |
| 10-14 | Critical auth/config failures (MI auth, KV secret fetch, token fetch, missing config) — reserve a distinct code per failure point so alerts tell you exactly where it died |

## Key conventions
- Managed Identity > Key Vault reference > Automation Credential > hardcoded (never). See [[graph-api-rest]] and Secret-Management-Pattern in the vault.
- Coerce Automation's string params to bool explicitly: `$Force = $Force -in @('true','1','yes','True')`.
- Suppress PSScriptAnalyzer false-positives on credential-*metadata* variable names with a documented `SuppressMessageAttribute`, not by renaming into something less clear.

Source: distilled from production PowerShell/Azure automation the author maintained. The patterns below were extracted from code that ran on a schedule against a live tenant, not from documentation examples.
