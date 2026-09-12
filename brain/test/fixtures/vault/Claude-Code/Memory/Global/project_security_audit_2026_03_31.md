---
name: Security Audit 2026-03-31
description: Comprehensive security assessment results — 7 secrets need rotation, SecretManagement vault being set up, remediations completed and pending
type: project
---

Full security audit completed 2026-03-31 across Claude config, Obsidian vault, local repos, GitHub repos, and home directory.

**Key findings**: 12 critical, 15 high, 17 medium, 16 low issues total.

**7 hardcoded secrets found in local project files** (PSSA-Entra, AppReg, TickerQFA, MCP-UseCase):
- Entra ID Client Secret, Azure Storage Account Key, ServiceNow Client Secret, ADO PAT, Admin Password, AppReg API Key, FMP API Key
- All need rotation — assume compromised since they're in plaintext on disk

**Remediations completed**:
- .credentials.json locked to owner-only ACL
- github-safe.js command injection fixed (execSync → execFileSync)
- Obsidian vault .gitignore hardened (blocks certs, keys, plugin data.json)
- PSSA-Entra_App_Creation and AI-Controls .gitignore created
- PSReadLine history filter added to PS7 profile (blocks secrets from being saved)
- Git conditional identity set up (personal email for GitHub repos, work email for ADO)

**Still pending (Dishi's manual actions)**:
- Set up PowerShell SecretManagement vault (modules installed, needs interactive setup)
- Rotate all 7 secrets in their respective portals
- Refactor scripts to use Get-Secret instead of hardcoded values
- Purge sensitive lines from PowerShell history
- Move PFX cert off OneDrive path
- Check BitLocker status
- Clean up settings.local.json stale permissions

**Why:** Preventive security hardening. No evidence of compromise, but secrets in plaintext code is a ticking time bomb.

**How to apply:** When working on PSSA-Entra, AppReg, or TickerQFA projects, check if secrets have been rotated and scripts refactored. Remind Dishi about pending items if relevant.
