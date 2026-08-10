---
description: Review Azure resources or Terraform IaC in scope for security misconfigurations and cost issues, aware of NIST/NYDFS/Azure Security Benchmark and Terraform-only IaC policy.
argument-hint: [path, resource group, or scope — else infer from cwd]
---

Scope: $ARGUMENTS (if empty, infer from the current directory's Terraform files or ask which resource group/subscription to target)

1. Determine mode: static (Terraform in this repo) vs live (actual Azure resources via `az` CLI or the azure-mcp tools). Do both if both are available and relevant.
2. **Security pass**: check against Azure Security Benchmark basics — public exposure (NSG rules open to 0.0.0.0/0, storage accounts with public blob access, Key Vaults without private endpoints or soft-delete/purge protection), identity (overly broad RBAC, app registrations with excess Graph permissions, missing MFA-adjacent conditional access where visible), encryption at rest/in transit, and logging/diagnostic settings gaps. If NIST or NYDFS applicability is unclear, ask before assuming enterprise scope.
3. **Cost pass**: flag oversized SKUs for observed usage, orphaned resources (unattached disks, idle public IPs, empty App Service plans), missing auto-shutdown on dev/test VMs, and Reserved Instance/Savings Plan opportunities if usage data is available.
4. For every finding, cite the exact resource/file:line and give a concrete remediation. If IaC changes are needed, propose Terraform only — never Bicep or ARM templates.
5. Rank findings by severity (critical/high/medium/low), not by discovery order.
6. Do not apply any fix without confirmation — this command is audit-only. Present findings and wait for the operator to choose what to act on.
