# Memory

## Feedback
- [feedback_executive_register.md](feedback_executive_register.md) — Default to executive, only-slightly-technical writing in EVERY response; technical depth is opt-in only
- [feedback_visual_verification.md](feedback_visual_verification.md) — Always Playwright-verify UI changes visually (spacing/overlap/overlays, all states) before committing
- [feedback_clipboard.md](feedback_clipboard.md) — Always copy TradingView script files to clipboard after edits
- [feedback_deck_corrections.md](feedback_deck_corrections.md) — AI Controls decks: no exec titles, source links required, skills ARE portable, phases not dates, expand ungoverned scope
- [feedback_no_bicep.md](feedback_no_bicep.md) — Azure IaC = Terraform only. Never propose Bicep or ARM. Clickops = Azure portal or Azure CLI.
- [feedback_claude_first_peers.md](feedback_claude_first_peers.md) — Claude models first, always; ask before every Gemini/Grok call — logged in ≠ permission
- [feedback_jarvis_interaction_model.md](feedback_jarvis_interaction_model.md) — The goal is JARVIS: spoken both ways, short aloud, proactive not polled, a partner not an oracle

## Reference Files
- **claude-code-tips.md**: Comprehensive power user tips — keyboard shortcuts, hooks, rewind system, worktrees, custom commands, skills, headless mode, permissions, MCP, common pitfalls.

## Project-Specific Notes
- [project_trading_automation.md](project_trading_automation.md) — Trading is the priority from 2026-08-15: Pine authoring → backtesting → automated paper trading on MNQ/MES. TradingView has no order API; webhook→broker is the only sanctioned path.
- **Tickr project**: Always commit & push all changes (standing instruction). Probability analysis dashboard for major markets (1d/1w/1m out). Eventually subscription-driven access.
- [project_threatintel_lookup.md](project_threatintel_lookup.md) — Personal OSINT toolkit at `_Projects\ThreatIntel-Lookup`. Use for IP/domain/email breach checks before web search.

## User
- [user_org_chart_model_routing.md](user_org_chart_model_routing.md) — Org-chart routing: Fable=C-suite, Opus=VPs, Sonnet=managers, Haiku=employees, Ollama=interns; dynamic agent count, never capped

## Alfred Framework Brain
- [project_obsidian_jarvis.md](project_obsidian_jarvis.md) — Alfred Brain = plain-markdown OneDrive folder (renaming to _Projects\Alfred-Brain); Obsidian+Claudian RETIRED 2026-08-08; whole system = "the Alfred Framework", repo dpatel-93/alfred

## Pending Actions
- [reminder_cli_anything_install.md](reminder_cli_anything_install.md) — AT DESK: run the two `/plugin` commands to install CLI-Anything, then delete this

## Alfred Agent Orchestration
- [project_alfred.md](project_alfred.md) — Alfred v4 (2026-08-07): native-primitives-only framework, org-chart routing, self-evolution via hooks→vault→/evolve. Repo dpatel-93/alfred-v4. Never reinstall alfred-flow/ruflo.
- [project_alfred_remotes.md](project_alfred_remotes.md) — Push to `origin` (public); `archive` is a stale private mirror whose divergence is expected — never force-push to "fix" it
- [project_startup_perf.md](project_startup_perf.md) — Fixed slow (37-67s) Claude startup by backgrounding 2 of 5 SessionStart hooks; this machine has a ~2.5-6s per-node.exe-spawn AV tax — factor into future perf work

## Claude Code Config Repo
- **dpatel-93/claude-code-config**: Portable merge-safe setup for Claude Code. Installs Alfred, 19 plugins, MCP servers, CLAUDE.md template.

## CLAUDE.md Power User Research (2026-03-17)
- [claude_md_research.md](claude_md_research.md) — Patterns from Anthropic repos, Trail of Bits, evantahler, wshobson, and other power users. Reference for future CLAUDE.md improvements.

## Security
- [project_security_audit_2026_03_31.md](project_security_audit_2026_03_31.md) — Full security audit: 7 secrets need rotation, remediations done + pending items
