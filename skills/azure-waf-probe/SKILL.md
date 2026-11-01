---
name: azure-waf-probe
description: >-
  Validate an Azure WAF (Application Gateway or Front Door) by firing inert,
  signature-matching attack probes at it from a throwaway Azure Container
  Instance, then correlating the blocks in the WAF firewall log. Use when asked
  to test or simulate a malicious request against an Azure WAF, confirm it is in
  Prevention mode, generate sample WAF firewall-log entries, or validate a Brotli
  Content-Encoding (CVE-2025-6176) custom rule. Fires from a disposable Azure
  egress IP, reports source IP + HTTP status per probe, and emits the KQL to find
  the matches. Authorized testing of your own or in-scope WAF only.
---

# Azure WAF probe

Fire inert, signature-matching "attack" requests at an Azure WAF from a one-shot,
disposable Azure Container Instance (ACI), so the WAF logs real block events you can
inspect — without exposing your own IP and without any working exploit.

## Safety gate — check BEFORE firing
- **Authorization.** Only run against a WAF the user owns or is explicitly, currently
  authorized to test. Establish it first: enumerate the user's Azure for the Front Door /
  Application Gateway / WAF policy fronting the target host, or get the user's explicit
  confirmation that the host is their own environment and in scope. Do NOT fire at a
  domain you cannot tie to the user.
- **Inert only.** The payloads are benign strings that match WAF signatures, plus a
  header-only Brotli probe. Never send a real exploit or a decompression bomb.
- **No standing infra without consent.** This skill is one-shot. A recurring harness is
  persistent config plus ongoing attack traffic — confirm before building one.
- **Tear down** the throwaway resource group when finished.

## Prerequisites
- `az login` to the subscription that will HOST THE THROWAWAY SOURCE. The WAF and its
  logs may live in a different tenant that the user reads themselves — the source just
  needs outbound internet to reach the target.
- `Microsoft.ContainerInstance` provider registered (the script registers it).

## Run it
```bash
bash scripts/run-waf-probe.sh https://www.TARGET.com            # fire, leave RG for re-runs
bash scripts/run-waf-probe.sh https://www.TARGET.com --delete   # fire, delete the RG after
```
Per-probe output: `HTTP 403` = blocked by the WAF (Prevention mode); `200` / `404` on the
benign baseline = the request reached the app. The script prints the `SOURCE_IP` the
container used (your simulated attacker) and a UTC timestamp.

Each probe is tagged `?wafsim=<name>`, and the Brotli one also carries User-Agent
`WAFSIM-BROTLI-CVE-2025-6176`, so you can find the exact rows in the WAF log regardless
of the egress IP — which changes on every run.

## See it in the logs
Query the FIREWALL log (`ApplicationGatewayFirewallLog`), not the access log — the access
log only records the listener rule and the 403, never the matched WAF rule.

```kql
AzureDiagnostics
| where Category == "ApplicationGatewayFirewallLog"
| where TimeGenerated > ago(1h)
| where requestUri_s contains "wafsim"
| project TimeGenerated, action_s, ruleId_s, ruleSetType_s, Message, requestUri_s, clientIp_s, hostname_s
| order by TimeGenerated asc
```
- The `wafsim=brotli-ce` row is the Brotli attempt. If a custom rule matches the
  `Content-Encoding: br` header, its name appears in `ruleId_s` (ruleSetType `Custom`) —
  that is the definitive "it was Brotli" line. Managed rules will not label it Brotli.
- Resource-specific tables: use `AGWFirewallLogs` with `Action`, `RuleId`, `RuleSetType`,
  `Message`, `RequestUri`. Front Door: `FrontDoorWebApplicationFirewallLog`.
- No rows while the access log shows the 403 → the firewall-log diagnostic category is not
  flowing to that workspace. Enable it on the gateway's Diagnostic settings.

## Identify / block Brotli explicitly
Standard logs do not record the `Content-Encoding` header. To make a Brotli attempt
self-identifying in the firewall log, add an App Gateway WAF custom rule:
- Match variable `RequestHeaders`, header `Content-Encoding`, operator `Regex`,
  value `(^|,|\s*)br(\s*(;[^,]*)?(,|$))`, transform `Lowercase`, action `Deny`.
- Give it a recognizable name; that name is what shows in the firewall log when it fires.

## Gotchas (learned)
- **Egress IP changes every run** → filter by the `wafsim` marker, not the IP.
- **Apex 301-redirects to www**; the WAF enforces on the redirected host → the script
  follows redirects and preserves POST.
- **Use the MCR image** `mcr.microsoft.com/azure-cli` — Docker Hub pulls can rate-limit
  ("retry later") on the second pull.
- ACI create + image pull can exceed 2 minutes → run it in the background.
- The azure-cli image lacks `awk` (cosmetic; the script avoids it).

## Files
- `scripts/run-waf-probe.sh` — orchestrator: RG + one-shot ACI + poll + logs + teardown.
- `scripts/probe-template.sh` — the probe set (`__TARGET__` placeholder, substituted at run).
- `scripts/Test-AzureWaf.ps1` — PowerShell variant that fires from the local machine
  (uses your own IP; prefer the ACI version to keep your IP out of the logs).
