---
name: CloudOpsMCP Project
description: Read-only Azure cloud ops knowledge base MCP server at Everest Re — Node.js v2.0, 28 tools, deploying to AKS to match Evre-ADO-MCP reference patterns
type: project
---

## Rewrite Status (2026-03-18)
- Phase 0: DONE — Node.js moved to nodejs-legacy/
- Phase 1: DONE — Config, models, KnowledgeStore, ScriptBuilder
- Phase 2: DONE — Program.cs + KnowledgeTools (5 tools)
- Phase 3: DONE — All 28 tools ported (5 McpTools classes, 6,493 lines C#)
- Phase 4: DONE — CloudOpsPrompts (3 prompts)
- Phase 5: DONE — Dockerfile rewritten for .NET 8 multi-stage build
- Phase 6: DONE — 40 unit tests passing (xUnit)
- Latest commit: `538ea54` on main (pushed)

## Current State

CloudOpsMCP is a **working Node.js MCP server** (v2.0) with 28 tools and 3 prompts. It's a read-only knowledge base for how Everest runs Azure — policies, SOPs, compliance, deployment guidance, audit scripts, and infrastructure standards.

**Repos:**
- Target: `~/repos/CloudOpsMCP` — `https://dev.azure.com/everestre/Infrastructure/_git/CloudOpsMCP` (branch: `main`)
- Reference: `~/repos/Evre-ADO-MCP` — `https://dev.azure.com/everestre/DevOps/_git/Evre-ADO-MCP` (C# .NET 8 reference implementation)

## Tech Stack (Current — Node.js)
- Runtime: Node.js 22, ES modules
- MCP SDK: `@modelcontextprotocol/sdk` ^1.0.4
- HTTP: Express ^5.2.1
- Transport: stdio (`index.js`) + Streamable HTTP + SSE (`index-http.js`)
- Port: 8080
- Knowledge base: JSON files (`knowledge/`) + markdown (`knowledge-base/`)

## What Exists
- **28 MCP tools**: 5 knowledge + 3 audit + 13 management + 7 operational
- **3 prompts**: azure_automation_expert, entra_app_workflow, servicenow_integration
- **Knowledge base**: 41 Everest policies, 924 industry practices, 2,990 SharePoint docs, 20 resource guides
- **AKS deployment scaffolding**: Dockerfile, Helm values, service-config, DAST, pre/post scripts
- **Both transports working**: stdio for local VS Code, HTTP for AKS

## Deployment Plan (from HANDOFF.md)
- **Phase 1**: Container image build (verify base images, pipeline creation)
- **Phase 2**: Identity & auth (App Registration, UMI, Key Vault, Entra JWT, OAuth proxy)
- **Phase 3**: AKS deployment to `caas-green-dev` cluster
- **Phase 4**: Environment promotion (qa, stage, prod)
- **Phase 5**: MCP registry registration

## Key Decision: Node.js vs C#
The reference repo (Evre-ADO-MCP) is C# .NET 8. CloudOpsMCP is Node.js. The user wants to **conform to the reference patterns** — need to clarify if that means rewriting to C# or just matching the deployment/security/config patterns while keeping Node.js.

## Target Hostname
`cloudops-mcp.dev.caas.everestre.net`

## Blockers
- Everest Node.js base images in ACR (need verification)
- vitest npm 403 on corporate network
- No Docker Desktop locally
- Identity Team request not started (longest lead time)
