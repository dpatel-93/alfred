<#
.SYNOPSIS
  Safe Azure WAF validation probe (local-source variant).

  Fires inert, signature-matching requests at a WAF-fronted endpoint FROM THE LOCAL
  MACHINE and reports whether each was blocked (HTTP 403). Prefer run-waf-probe.sh
  (fires from a throwaway Azure container) so your own IP stays out of the WAF logs.

  These are NOT working exploits. Each payload is a benign string that matches an
  Azure DRS / OWASP CRS rule signature.

.PARAMETER TargetUrl
  Base URL of the WAF-fronted endpoint, e.g. https://www.example.com

.PARAMETER DelayMs
  Delay between requests in milliseconds (default 500).

.EXAMPLE
  ./Test-AzureWaf.ps1 -TargetUrl https://www.example.com

.NOTES
  Requires PowerShell 7+ (uses -SkipHttpErrorCheck). In Detection mode nothing is
  blocked and every probe "passes" — that is expected; check the WAF firewall log.
  Only run against a WAF you own or are explicitly authorized to test.
#>
param(
    [Parameter(Mandatory)][string]$TargetUrl,
    [int]$DelayMs = 500
)

$TargetUrl = $TargetUrl.TrimEnd('/')

$probes = @(
    @{ Name = 'Baseline (should PASS)';    Method = 'GET'; Path = '/?wafsim=baseline';                            Headers = @{} }
    @{ Name = 'SQLi signature (942xxx)';   Method = 'GET'; Path = "/?wafsim=sqli&id=1'%20OR%20'1'='1";            Headers = @{} }
    @{ Name = 'XSS signature (941xxx)';    Method = 'GET'; Path = '/?wafsim=xss&q=<script>alert(1)</script>';      Headers = @{} }
    @{ Name = 'Path traversal (930xxx)';   Method = 'GET'; Path = '/?wafsim=traversal&file=../../../../etc/passwd';Headers = @{} }
    @{ Name = 'Command inj (932xxx)';      Method = 'GET'; Path = '/?wafsim=cmd&cmd=;cat%20/etc/passwd';           Headers = @{} }
    @{ Name = 'Log4Shell (944xxx)';        Method = 'GET'; Path = '/?wafsim=log4shell'; Headers = @{ 'User-Agent' = '${jndi:ldap://127.0.0.1/a}' } }
)

Write-Host ("WAF validation against {0}`n" -f $TargetUrl) -ForegroundColor Cyan

foreach ($p in $probes) {
    $uri = "$TargetUrl$($p.Path)"
    try {
        $resp = Invoke-WebRequest -Uri $uri -Method $p.Method -Headers $p.Headers `
            -SkipHttpErrorCheck -MaximumRedirection 0 -TimeoutSec 20 -ErrorAction Stop
        $code = [int]$resp.StatusCode
    } catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
    }

    $isBaseline = $p.Name -like 'Baseline*'
    if ($isBaseline) {
        $verdict = if ($code -lt 400 -and $code -gt 0) { 'OK (endpoint reachable)' } else { "CHECK (baseline returned $code)" }
        $color   = if ($code -lt 400 -and $code -gt 0) { 'Green' } else { 'Yellow' }
    } else {
        $blocked = ($code -eq 403)
        $verdict = if ($blocked) { 'BLOCKED by WAF' } else { "NOT blocked ($code)" }
        $color   = if ($blocked) { 'Green' } else { 'Red' }
    }

    Write-Host ("[{0,4}] {1,-26} {2}" -f $code, $p.Name, $verdict) -ForegroundColor $color
    Start-Sleep -Milliseconds $DelayMs
}

Write-Host "`nA 403 with Server 'Microsoft-Azure-Application-Gateway' or from Front Door confirms a WAF block." -ForegroundColor DarkGray
Write-Host "In Detection mode all probes pass. Confirm matches in the WAF firewall log (filter requestUri for 'wafsim')." -ForegroundColor DarkGray

# Brotli Content-Encoding probe (CVE-2025-6176) — PowerShell blocks Content-Encoding as a
# custom header, so fire it with curl instead:
#   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Encoding: br' `
#     -H 'Content-Type: application/json' -d '{"test":"data"}' "$TargetUrl/?wafsim=brotli-ce"
