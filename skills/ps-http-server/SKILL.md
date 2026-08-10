---
name: ps-http-server
description: Stands up a lightweight PowerShell HttpListener web UI for a quick internal admin portal or dashboard, backed by Azure Table Storage or another data source — no Node/Python required. Use when the user wants a fast local admin tool, a proof-of-concept web UI in PowerShell, or asks how their Northwind-style admin portal pattern works.
---

# PowerShell HTTP Server (Local Admin Portal)

Real pattern from `Northwind\admin-portal\Admin-Portal.ps1` — a single-file
PowerShell script that serves an editable data-grid UI over Azure Table
Storage with zero Node/Python dependency. Good for internal tools where a
full web stack is overkill.

## When to use
- Quick internal admin portal / dashboard for a script-driven data source
- Local web UI for PowerShell-driven tools
- Proof-of-concept before investing in a real web app
- **Not production-grade**: single-threaded (one request at a time), no HTTPS
  without extra cert setup, no WebSockets (poll instead)

## Shape

```
Admin-Portal.ps1
├── param(Port) + module prerequisite check (auto-install if missing)
├── Config hashtable (connection string, editable field allow-list)
├── $HtmlTemplate  (here-string: inline CSS + JS, {{PLACEHOLDER}} injection points)
├── Data functions (Get-AllApps, Update-App — talk to the backing store)
├── Send-Response helper (writes bytes + closes stream)
├── HttpListener setup + Start-Process to auto-open the browser
└── Main loop: GetContext() -> switch -Regex on path -> route
```

## Prerequisite auto-install (nice UX for a shared script)

```powershell
$RequiredModules = @(@{ Name = "Az.Storage"; MinVersion = "4.0.0" }, @{ Name = "AzTable"; MinVersion = "2.0.0" })
foreach ($module in $RequiredModules) {
    $installed = Get-Module -ListAvailable -Name $module.Name | Where-Object { $_.Version -ge [version]$module.MinVersion } | Select-Object -First 1
    if (-not $installed) {
        $scope = if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { "AllUsers" } else { "CurrentUser" }
        Install-Module -Name $module.Name -MinimumVersion $module.MinVersion -Scope $scope -Force -AllowClobber -SkipPublisherCheck
    }
}
```

## Server + routing (the actual reusable core)

```powershell
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Start-Process "http://localhost:$Port"   # auto-open browser — nice touch for internal tools

while ($listener.IsListening) {
    $context  = $listener.GetContext()   # blocks until a request arrives
    $request  = $context.Request
    $response = $context.Response
    $path     = $request.Url.AbsolutePath
    $method   = $request.HttpMethod

    try {
        switch -Regex ($path) {
            "^/$"                 { Send-Response -Response $response -StatusCode 200 -Body $html -ContentType "text/html" }
            "^/api/apps$"         {
                if ($method -eq "GET") {
                    $json = (Get-AllApps -CloudTable $cloudTable) | ConvertTo-Json -Depth 10 -Compress
                    Send-Response -Response $response -StatusCode 200 -Body $json
                }
            }
            "^/api/apps/(.+)$"    {
                $rowKey = $matches[1]
                if ($method -eq "PUT") {
                    $reader = New-Object System.IO.StreamReader($request.InputStream)
                    $updates = ($reader.ReadToEnd()) | ConvertFrom-Json -AsHashtable
                    $reader.Close()
                    Update-App -CloudTable $cloudTable -RowKey $rowKey -Updates $updates
                    Send-Response -Response $response -StatusCode 200 -Body '{"success":true}'
                }
            }
            default { Send-Response -Response $response -StatusCode 404 -Body '{"error":"Not found"}' }
        }
    } catch {
        Send-Response -Response $response -StatusCode 500 -Body "{`"error`":`"$($_.Exception.Message)`"}"
    }
}
```
`switch -Regex` on `$path` is the whole router — no framework needed. Always
wrap the route body in try/catch so one bad request doesn't crash the listener
loop, and always `finally { $listener.Stop() }` around the whole loop.

## Response helper (write bytes, set content-type, close stream)

```powershell
function Send-Response {
    param($Response, $StatusCode, $Body, $ContentType = "application/json")
    $Response.StatusCode = $StatusCode
    $Response.ContentType = $ContentType
    if ($Body) {
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($Body)
        $Response.ContentLength64 = $buffer.Length
        $Response.OutputStream.Write($buffer, 0, $buffer.Length)
    }
    $Response.OutputStream.Close()
}
```

## Writing to the backing store — allow-list editable fields
Never let the API blindly write whatever the client PUTs. Whitelist which
columns are user-editable and merge onto the existing row (don't drop untouched fields):

```powershell
function Update-App {
    param($CloudTable, $RowKey, $Updates)
    $existing = Get-AzTableRow -Table $CloudTable -PartitionKey "Production" -RowKey $RowKey
    if (-not $existing) { throw "App not found: $RowKey" }
    $updateProps = @{}
    foreach ($prop in $existing.PSObject.Properties) {
        if ($prop.Name -notin @('TableTimestamp','Etag','PartitionKey','RowKey','Timestamp') -and $prop.Value) {
            $updateProps[$prop.Name] = [string]$prop.Value
        }
    }
    foreach ($key in $Updates.Keys) {
        if ($key -in $EditableFields) { $updateProps[$key] = [string]$Updates[$key] }   # allow-list gate
    }
    $updateProps['LastModified'] = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $updateProps['ModifiedBy']   = $env:USERNAME
    Add-AzTableRow -Table $CloudTable -PartitionKey "Production" -RowKey $RowKey -Property $updateProps -UpdateExisting | Out-Null
}
```

## HTML/JS template injection

Keep the frontend as a PowerShell here-string (`@'...'@`) with `{{PLACEHOLDER}}`
tokens replaced via `.Replace()` before the listener starts — avoids a build
step entirely:

```powershell
$html = $HtmlTemplate.Replace('{{EDITABLE_FIELDS}}', ($EditableFields | ConvertTo-Json))
```
Client-side: cache API responses in `localStorage` with a TTL (5 min is a good
default) and refresh in the background — makes the UI feel instant on repeat
loads without hammering the backing store.

## When to upgrade off this pattern
- Need concurrent users → [[zero-cost-azure]] (Static Web Apps + Functions)
- Need auth → Static Web Apps built-in Entra ID auth
- Need HTTPS → reverse proxy (Caddy/nginx) or move to Azure

Source: distilled from production PowerShell/Azure automation the author maintained. The patterns below were extracted from code that ran on a schedule against a live tenant, not from documentation examples.
