---
name: zero-cost-azure
description: Designs a personal automation or internal tool on Azure/GitHub free tiers — Static Web Apps, Functions consumption plan, Table Storage, GitHub Actions cron — with the decision checklist for when to outgrow it. Use when the user is building a personal project, prototype, or internal tool and wants to avoid Azure costs, or asks "what's the cheapest way to host this."
---

# Zero-Cost Azure Architecture

This framework's default stack for personal projects and internal tools. Proven in
DailyBrief (RSS-to-Telegram digest bot, runs on GitHub Actions cron — $0/month)
and Northwind's admin portal. Goal: stay in free tier, no VMs, no App Service plans
(those bill even when idle).

## Decision checklist — pick the cheapest layer that fits

| Need | Use | Free tier |
|---|---|---|
| Scheduled script, no hosting needed | **GitHub Actions cron** | 2,000 min/mo free (public repos: unlimited) |
| Scheduled script needing Azure-native identity/KV access | **Azure Automation runbook** | 500 min/mo free — see [[azure-runbook]] |
| Static frontend + API | **Azure Static Web Apps** | 2 apps, custom domain, SSL, built-in Functions |
| Standalone API / webhook | **Azure Functions (Consumption)** | 1M executions + 400K GB-s/mo |
| Simple key-value or config data | **Azure Table Storage** | ~$0.045/GB/mo — not really free but pennies |
| Need SQL joins/aggregations | Azure SQL Basic ($5/mo) or Postgres Flexible | Outgrown zero-cost — budget for it |
| Need WebSockets or server-side rendering | App Service Basic ($13/mo) or Container Apps | Outgrown zero-cost |

Rule of thumb: if a scheduled task doesn't need an Azure Managed Identity or
Key Vault access, **GitHub Actions cron is cheaper and simpler than Azure
Automation** — it's what DailyBrief uses instead of a runbook.

## GitHub Actions cron pattern (real example, DailyBrief)

```yaml
name: Daily Brief
on:
  schedule:
    - cron: "0 12 * * *"       # 8am EST = 12:00 UTC (EDT) — cron is always UTC
  workflow_dispatch:            # manual "run now" button in the Actions tab
    inputs:
      reason:
        description: "Reason for manual trigger"
        required: false
jobs:
  daily-brief:
    runs-on: ubuntu-latest
    timeout-minutes: 5          # always cap runtime — free minutes are finite
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: "pip" }
      - run: pip install -r requirements.txt
      - run: python -m src.main
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
```
Always add `workflow_dispatch` alongside `schedule` — lets you trigger a run
manually to test without waiting for the cron window. Secrets go in repo
Settings → Secrets, never in the yaml. See Secret-Management-Pattern in the
vault for the full per-context secret matrix.

## Static Web Apps deployment

```bash
az staticwebapp create \
  --name "my-app" \
  --resource-group "rg-personal" \
  --source "https://github.com/dpatel-93/my-app" \
  --branch "main" \
  --app-location "/" \
  --api-location "api" \
  --output-location "dist"
```
Static Web Apps auto-deploys from GitHub on push (no manual pipeline needed)
and gives free SSL + custom domain + built-in Functions API + Entra ID auth
if you later need login.

## Cost breakdown (typical personal project)

| Service | Free tier | Monthly cost |
|---|---|---|
| Static Web Apps | 2 apps, SSL, custom domain | $0 |
| Functions (Consumption) | 1M executions, 400K GB-s | $0 |
| GitHub Actions | 2,000 min/mo (public: unlimited) | $0 |
| Table Storage | First 1GB + transactions | ~$0.05 |
| Automation | 500 min/mo | $0 |
| Key Vault | 10K operations | $0 |
| **Total** | | **~$0.05/month** |

## Key conventions
- Static Web Apps for frontend, Functions for API — either bundled into SWA or standalone
- Table Storage for config/lookup data, not a real relational DB (see the
  vault's Azure-Table-Storage-Pattern note for PartitionKey strategy)
- GitHub Actions for cron that doesn't need Azure identity; Azure Automation
  for cron that does (Managed Identity, Key Vault) — see [[azure-runbook]]
- No VMs, no App Service plans — anything that bills while idle is off the table by default

## When you'll outgrow it
- Need server-side rendering → App Service Basic (~$13/mo)
- Need WebSockets → App Service or Container Apps
- Need > 500 Automation minutes or > 2,000 Actions minutes → pay-as-you-go on whichever ran the job
- Need relational queries/joins → Azure SQL Basic (~$5/mo) or Postgres Flexible

Source: distilled from production PowerShell/Azure automation the author maintained. The patterns below were extracted from code that ran on a schedule against a live tenant, not from documentation examples.
