---
name: graph-api-rest
description: Calls Microsoft Graph from PowerShell via raw REST (app-only client-credentials auth, pagination, throttling/retry) instead of the Microsoft.Graph SDK module. Use when the user asks to query or modify Entra ID / Azure AD / Graph API from a script, runbook, or Function App without installing the Graph SDK, or asks why REST is preferred over the SDK.
---

# Graph API Auth via REST (Client Credentials)

This framework's standing decision (see [[Decisions/2026-03-31 -- REST Over Graph SDK for
Automation]]): raw REST + `Invoke-RestMethod`, never the `Microsoft.Graph`
PowerShell module, for unattended automation. Lighter (no module install in
Azure Automation), same pattern works from PowerShell/Python/any HTTP client,
and gives exact control over API version and `$select`.

## When to use
- Daemon/service-to-service calls with no user present (Automation Runbooks,
  Function Apps, scheduled tasks)
- Needs Application permissions (not Delegated) granted in Entra

## Auth: client credentials flow

```powershell
$body = @{
    grant_type    = "client_credentials"
    client_id     = $env:AZURE_CLIENT_ID
    client_secret = $env:AZURE_CLIENT_SECRET      # NEVER hardcode — see Secret-Management-Pattern
    scope         = "https://graph.microsoft.com/.default"
}
$tokenResponse = Invoke-RestMethod -Method Post `
    -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
    -ContentType "application/x-www-form-urlencoded" `
    -Body $body
$headers = @{ Authorization = "Bearer $($tokenResponse.access_token)" }
```
In an Azure Automation runbook, the client_secret itself comes from Key Vault via
Managed Identity first — see [[azure-runbook]] Phase 0 for the full chain.

## Pagination — always a `do/while` on `@odata.nextLink`

Production example (fetching all app registrations, `$top=999` per page):

```powershell
$apps = @()
$nextLink = "https://graph.microsoft.com/v1.0/applications?`$select=id,appId,displayName,tags,requiredResourceAccess&`$top=999"
do {
    $response = Invoke-GraphRequestWithRetry -Uri $nextLink -Headers $headers
    $apps += $response.value
    $nextLink = $response.'@odata.nextLink'
    if ($nextLink) { Write-Output "  Retrieved $($apps.Count) so far, fetching more..." }
} while ($nextLink)
```
Note the backtick before `$select`/`$top` in the URI string — PowerShell would
otherwise try to interpolate `$select` as a variable.

## Retry with exponential backoff on throttling (429) and 5xx

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
                $retryAfter = $_.Exception.Response.Headers['Retry-After']
                $waitTime = if ($retryAfter) { [int]$retryAfter } else { $delay }
                Write-Warning "HTTP $statusCode. Retrying in $waitTime s (attempt $attempt/$MaxRetries)"
                Start-Sleep -Seconds $waitTime
                $delay *= 2
            } else { throw }
        }
    }
}
```
Rate limit: ~10,000 requests / 10 minutes per app per tenant. Respect
`Retry-After` when present instead of guessing.

## Resolving permission/role names from GUIDs

`requiredResourceAccess` only returns GUIDs, not human-readable names. Resolve
them once per unique `resourceAppId` by fetching that resource's service
principal and reading `appRoles` (Application perms) + `oauth2PermissionScopes`
(Delegated perms) — build a lookup hashtable, don't re-fetch per app:

```powershell
$spUri = "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '$resourceAppId'&`$select=appId,displayName,appRoles,oauth2PermissionScopes"
```

## Beta endpoints and skip-token expiry

Some data (e.g. `servicePrincipalSignInActivities`) only exists under
`/beta/reports/...` and requires `AuditLog.Read.All` or `Reports.Read.All`.
Beta skip-tokens can expire mid-pagination on large result sets (~20k+ records)
with "Skip token is null or expired" — the practical fix is to restart the
paginated fetch from the top (harmless if you're deduping into a hashtable keyed
by ID) rather than treating it as a hard failure.

## Gotchas
- Token lifetime ~1 hour — re-auth before expiry on long-running scripts
- `client_secret` expires (1-2yr default) — calendar-remind rotation
- `$count=true` is **not** supported on some beta endpoints (returns 400)

## Secret storage by context
Local dev: PS SecretManagement. Automation: Key Vault via Managed Identity.
Function Apps: App Settings / Key Vault reference. Full matrix in the vault's
Secret-Management-Pattern note.

Source: distilled from production PowerShell/Azure automation the author maintained. The patterns below were extracted from code that ran on a schedule against a live tenant, not from documentation examples.
