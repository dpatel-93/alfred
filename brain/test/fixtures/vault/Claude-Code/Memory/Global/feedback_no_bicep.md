---
name: No Bicep — Terraform only for Azure IaC
description: User does Azure infrastructure-as-code exclusively in Terraform. Never propose Bicep or ARM templates, even when more Azure-native. For one-off ops use Azure portal or Azure CLI.
type: feedback
originSessionId: 1719abe8-57df-488f-8bdb-3ec7dc9fe94d
---
For Azure infrastructure-as-code work, **always use Terraform**. Never propose Bicep or ARM templates as alternatives, even when they would be more Azure-native or shorter.

For one-off operations or ad-hoc resource changes, use the **Azure portal** (clickops) or **Azure CLI**. Not Bicep.

**Why:** Standing user preference (set 2026-04-16). Single IaC tool across the estate keeps the team's mental model simple, and Terraform is portable across clouds + has stronger community/state-management story for the user's contexts. Bicep was offered as an option in an earlier RBAC-policy answer; user explicitly removed it from scope.

**How to apply:**
- When suggesting IaC for an Azure resource → write Terraform (`azurerm_*`, `azapi_*` for preview resources)
- When the user is doing a one-off / experimenting → suggest Azure portal or Azure CLI commands, not Bicep
- If a user pastes Bicep and asks for help → answer the question but do not extend with new Bicep; if they ask for changes, offer to translate to Terraform
- Do not include "Bicep / ARM" in language-toolchain tables or recommendations
