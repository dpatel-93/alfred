---
name: "Org Index"
description: "The Alfred roster in one preloaded table — every agent, its parent, and the surface it owns. Use when you need to know who owns a surface, who to delegate to, or who to escalate toward, INSTEAD of opening agents/ORG.md. Preloaded via the skills: frontmatter field, so it costs no tool call and no round trip."
---

# Org Index

**Generated from `~/.claude/agents/**/*.md`. Do not hand-edit — regenerate.**

This exists to remove a tool call from the critical path. Opening `ORG.md` (431 lines) to answer
"who owns backups?" cost ~5-7s and ~20k tokens *at every level of the chain*. This table is
preloaded with your charter, so the answer is already in your context.

Read `ORG.md` itself only when you need the *contracts and rules* (§4 charter spec, §5 return
shapes, §5b/§5c the structural rules) — not to look up a name.

## Chain of command

```
CEO → Chief of Staff (main session) → VP (opus) → Manager (sonnet) → Employee (haiku)
```

Spawning is top-down. To reach a tier ABOVE you, return an escalation request — do not spawn upward.

## VPs — one per domain

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
| `architect` | `chief-of-staff` | I own how systems are shaped — the Azure footprint, the network and identity layout, the hosting model, the IaC… | `zero-cost-azure` `terraform-module-library` |
| `cfo` | `chief-of-staff` | I own whether the data underneath everything is well-modeled, what it costs to run, and whether the trading… | `risk-metrics-calculation` |
| `coo` | `chief-of-staff` | I own whether this estate ships reliably and keeps running once it has shipped | — |
| `cso` | `chief-of-staff` | I own whether this estate is actually safe, and whether we can prove it | — |
| `cto` | `chief-of-staff` | I own whether the product actually works for the people using it — the backend services, the frontend UI, the… | `redesign` `taste` `worktree-orchestrator` |

## Managers — one per discipline

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
| `analytics-manager` | `cfo` | I own two different questions that both land here: whether an ML model is built and tuned right, and what the… | `zero-cost-azure` |
| `appsec-manager` | `cso` | I own whether this application's own code and its dependency tree are actually exploitable — not what an… | — |
| `backend-manager` | `cto` | I own server-side implementation across every project — the code that receives a request, decides what it means,… | `postgresql` `mcp-builder` `ps-http-server` |
| `compliance-manager` | `cso` | I own whether we can **prove** this estate is safe — not whether it is | — |
| `data-manager` | `cfo` | I own the data layer — schema, migrations, ingestion pipelines, and query performance — across every project that… | `postgresql` |
| `devops-manager` | `coo` | I own whether the pipes actually work: CI/CD pipeline health across GitHub Actions and Azure DevOps Pipelines, and… | `async-supervisor` |
| `docs-manager` | `cto` | I own writing documentation — API references, runbooks, READMEs, handoff docs — but only when someone explicitly… | `docx` `pptx` |
| `frontend-manager` | `cto` | I own whether the UI actually works and doesn't look or behave like it was thrown together — every component,… | `taste` `redesign` |
| `infra-manager` | `architect` | I own turning an infra requirement into a design that's actually buildable in Terraform — the module and state… | `terraform-module-library` |
| `mobile-manager` | `cto` | I own getting React Native work done correctly across both iOS and Android for every app in the portfolio that… | — |
| `platform-manager` | `architect` | I own where a workload actually runs — not the network under it, not the pipeline that ships it, just the platform… | `zero-cost-azure` |
| `qa-manager` | `coo` | I own whether our tests can be trusted, not whether they exist | `python-testing-patterns` |
| `quant-manager` | `cfo` | I own whether a trading idea is actually tradeable, not just whether it looks good | `backtesting-frameworks` `risk-metrics-calculation` |
| `security-manager` | `cso` | I own finding real, exploitable problems in code and cloud config — not documenting theoretical ones | — |
| `sre-manager` | `coo` | I own whether the operator's estate is up, monitored, and — when it isn't — why | — |

## Employees — one bounded surface each

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
| `analytics-cost-eng` | `analytics-manager` | I find out what an Azure resource actually costs, trace a spend spike to the thing causing it, and lay out or… | `zero-cost-azure` `xlsx` |
| `analytics-ml-dev` | `analytics-manager` | I diagnose ML work — preprocessing choices, feature engineering, model selection, training/tuning setups,… | — |
| `appsec-dep-scanner` | `appsec-manager` | I determine whether a dependency vulnerability is real risk or noise | — |
| `appsec-threat-modeler` | `appsec-manager` | I think like the attacker, not the auditor | `before-you-build` |
| `backend-api-dev` | `backend-manager` | I write and fix the app's own backend surface — endpoints, handlers, business logic, and data access — inside… | `postgresql` `ps-http-server` |
| `backend-integration-dev` | `backend-manager` | I write and fix the code that talks to systems outside the app — third-party APIs, webhooks, auth flows, and… | `graph-api-rest` `azure-runbook` |
| `comp-control-mapper` | `compliance-manager` | I tie what actually exists — a finding, a resource configuration, a Terraform file — to the exact named control it… | — |
| `comp-evidence-collector` | `compliance-manager` | I gather the actual proof that a named control is met — a config export, a policy assignment list, a log retention… | `xlsx` `docx` |
| `data-pipeline-eng` | `data-manager` | I move data from a source into somewhere it can be queried — a scheduled pull, an ADF pipeline, a one-off backfill | — |
| `data-schema-eng` | `data-manager` | I own what a table looks like and how fast it answers queries — schema design, new migrations, indexing, and… | `postgresql` |
| `devops-pipeline-eng` | `devops-manager` | I find out why a pipeline is broken, or what it would do if triggered, before anyone acts on a guess | — |
| `devops-release-eng` | `devops-manager` | I make sure a release is actually ready before it ships, and I document what shipped in the release notes | — |
| `docs-api-writer` | `docs-manager` | I write and maintain API reference documentation — endpoint descriptions, request/response schemas, examples, REST… | — |
| `docs-runbook-writer` | `docs-manager` | I write operational runbooks, READMEs, and handoff/close-out docs — the detailed explanation this framework's… | `docx` `pptx` |
| `dr-continuity-eng` | `cso` | I check whether a workload can actually be recovered — not whether it's backed up on paper | — |
| `frontend-state-dev` | `frontend-manager` | I own what the UI knows and when it knows it — client-side state, data fetching, and routing — inside exactly the… | — |
| `frontend-ui-dev` | `frontend-manager` | I build and fix the parts of a UI you can see and touch — components, layout, styling — inside exactly the file(s)… | `taste` |
| `infra-identity-eng` | `infra-manager` | I scope and document the Entra ID identity surface a service needs to authenticate — app registrations, Graph… | `graph-api-rest` |
| `infra-network-eng` | `infra-manager` | I design and review the network path a service actually runs on — not just whether a resource exists, but whether… | — |
| `infra-terraform-eng` | `infra-manager` | I check whether Terraform is actually safe to apply — module structure, state consistency, and plan output — not… | `terraform-module-library` |
| `mobile-rn-dev` | `mobile-manager` | I build and fix React Native screens and components so they behave the same way on iOS and Android, or I say… | — |
| `platform-appservice-eng` | `platform-manager` | I find the right Azure PaaS home for a workload and the cheapest tier that actually covers it | `zero-cost-azure` |
| `platform-container-eng` | `platform-manager` | I answer whether and how a workload should run in a container, on AKS, and I teach it while I do — this is a… | `k8s-manifest-generator` `helm-chart-scaffolding` |
| `qa-browser-tester` | `qa-manager` | I write browser tests that can actually fail, and I hunt the specific way browser suites go quietly wrong: a path… | `browser` |
| `qa-test-author` | `qa-manager` | I write tests that can actually fail | `python-testing-patterns` |
| `quant-risk-analyst` | `quant-manager` | I answer the question "how much can this actually cost me" with real math, not a feel for it | `risk-metrics-calculation` |
| `quant-strategy-dev` | `quant-manager` | I write and debug the PineScript that runs on the operator's TradingView setup, and I run the first-pass backtest… | `backtesting-frameworks` |
| `sec-code-auditor` | `security-manager` | I read code and find the specific place an attacker could actually break it — not a category of risk, a specific line | — |
| `sec-config-auditor` | `security-manager` | I check whether Azure resources and their Terraform are actually configured safely — not whether they're… | — |
| `sec-secrets-hunter` | `security-manager` | I find committed secrets before someone else does | — |
| `sre-incident-responder` | `sre-manager` | I find why something is actually broken, not the first plausible-sounding reason | — |
| `sre-monitoring-eng` | `sre-manager` | I answer "what does the current state actually show" for health, alerting, and availability — not "why is it… | — |
| `vendor-audit-eng` | `coo` | I determine whether a tool, skill, plugin, or MCP server is genuinely unused or duplicative — by actually reading… | — |

## Specialists — delegated to by name, exempt from the charter (ORG.md §7)

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
| `analyst` | — | Advanced code quality analysis agent performing comprehensive code, performance, security, and architecture… | — |
| `api-docs` | — | Expert agent for creating and maintaining OpenAPI 3.0 documentation for REST and GraphQL APIs | — |
| `azure-infra-engineer` | — | "Use when designing, deploying, or managing Azure infrastructure with focus on network architecture, Entra ID… | — |
| `cicd-engineer` | — | Specialized agent for GitHub Actions CI/CD pipeline creation and optimization | — |
| `code-analyzer` | — | Advanced code quality analysis agent for comprehensive code reviews and improvements | — |
| `database-architect` | — | Expert database architect specializing in data layer design from scratch, technology selection, schema modeling,… | — |
| `ml-developer` | — | ML developer specializing in data preprocessing, model selection, training, hyperparameter tuning, and deployment… | — |
| `mobile-dev` | — | Expert agent for React Native mobile application development across iOS and Android | — |
| `production-validator` | — | Production validation specialist ensuring applications are fully implemented (no mocks/stubs) and deployment-ready | — |
| `quant-analyst` | — | Build financial models, backtest trading strategies, and analyze market data | — |
| `risk-manager` | — | Monitor portfolio risk, R-multiples, and position limits | — |
| `system-architect` | — | Expert agent for system architecture design, patterns, and high-level technical decisions | — |
| `tdd-london-swarm` | — | TDD London School (mockist) specialist for outside-in, mock-driven development and behavior verification | — |
| `terraform-specialist` | — | Expert Terraform/OpenTofu specialist mastering advanced IaC automation, state management, and enterprise… | — |
| `test-long-runner` | — | Test agent that can run for 30+ minutes on complex tasks | — |
| `windows-infra-admin` | — | "Use when managing Windows Server infrastructure, Active Directory, DNS, DHCP, and Group Policy configurations,… | — |

---

5 VPs · 15 managers · 33 employees · 16 specialists.
Counts are generated, not asserted. If they disagree with ORG.md, run `node ~/.claude/helpers/validate-org.mjs`.
