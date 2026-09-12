---
name: AI Controls Deck Feedback
description: Corrections for Everest AI Controls HTML decks — tool inventory, portability framing, audience, regulatory scope, source requirements
type: feedback
---

## Tool Inventory Accuracy
Only reference tools the company actually has or is evaluating. Never include tools they don't have.
**Why:** First draft included Gemini Code Assist and Gemini personal which they don't have. Irrelevant data wastes leadership's time.
**How to apply:** Before listing tools, confirm against the inventory: M365 Copilot, GitHub Copilot Enterprise, ChatGPT Enterprise, Gemini Enterprise (chat only), Azure AI Foundry, EverAssist. Evaluating: Claude Code CLI. Have but not enabled: GH Copilot Agent Mode/CLI.

## Skills/Instructions ARE Portable
Do not frame Claude Code skills as "NOT portable" to GitHub Copilot. Both tools support reusable instructions — syntax differs but outcomes are functionally equivalent.
**Why:** User pointed out VS Code Copilot has `.github/copilot-instructions.md`, `.github/prompts/*.md`, custom chat modes, /invoke commands. A shared repo with both tool formats + a PowerShell install script makes this portable.
**How to apply:** Frame as "portable via shared repo strategy" not "NOT portable."

## No Executive Title Callouts
Never assign actions to specific executive roles (CISO, CTO, CIO, CFO) in decks. General audience — don't call out individuals.
**Why:** User doesn't want to single out anyone. Deck is for broad leadership consumption.

## Source Links Required
Every factual slide must include HTML source links. The decks must show where data comes from.
**Why:** "We need to remain factual and show our sources."

## Phases Not Dates
Never use specific timelines (90-day, Week 1-2). Use phases without dates — the org moves at its own pace.

## Global Regulatory Scope
Everest Re is global (US HQ, Europe and Asia offices). Always include EU AI Act, GDPR, APAC alongside NYDFS. Reference Gartner, OWASP, NIST as best practice frameworks.

## MCP Registry Exists
The company created an MCP registry in Azure, loaded sanctioned MCP servers via GitHub Copilot license. VS Code developers access approved MCPs through this. Include this as a positive control.

## Expand "Ungoverned" Beyond Agents
The visibility gap isn't just 354 agents. GitHub Copilot → Claude model prompts have zero monitoring. ChatGPT Enterprise and Gemini Enterprise Chat are also unmonitored. Raise whether Zenity or similar third-party governance is needed.
