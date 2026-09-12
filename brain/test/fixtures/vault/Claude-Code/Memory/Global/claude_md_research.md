---
name: CLAUDE.md Power User Research
description: Patterns and best practices from Anthropic repos, Trail of Bits, evantahler, wshobson, and other power users for structuring CLAUDE.md files
type: reference
---

# CLAUDE.md Power User Research (2026-03-17)

## Key Sources
- **Anthropic's own repos**: anthropics/claude-code-action — Commands first, "Things That Will Bite You" section, Key Concepts
- **evantahler/dot-claude**: Modular split-file architecture — CLAUDE.md as thin index, @PREFERENCES.md always loaded, WHOAMI.md/CODING_STYLE.md on demand
- **trailofbits/claude-code-config**: Hardened security config — concrete code quality numbers, language-specific toolchains, settings.json deny rules, PreToolUse hooks for guardrails
- **zircote/.claude**: Environment-conditional includes table, 95% confidence rule, slash commands table
- **wshobson gist**: 51 named subagents across 5 categories, orchestration patterns (maximalist approach)
- **centminmod/my-claude-code-setup**: Memory bank system — separate MD files for active context, patterns, decisions, troubleshooting
- **ykdojo/claude-code-tips**: Keep it simple, add instructions only after repeating corrections 2-3 times

## Universal Patterns (found in 80%+ of good configs)
1. Commands block first
2. Persona/WHOAMI section
3. Hard rules / DO NOT block (specific, not vague)
4. Concrete code quality numbers (max function lines, complexity ceiling)
5. Language-specific toolchains (name exact tools)
6. Workflow conventions (commit format, PR rules, branch patterns)
7. Context management hints
8. Safety rules (what Claude cannot touch)

## Advanced Patterns (for future consideration)
- Environment matrix table with conditional includes per language
- Modular @includes (always-loaded vs on-demand)
- Memory bank files for patterns/decisions/active context
- Named agent catalog with delegation rules
- settings.json deny rules blocking SSH keys, cloud creds, shell configs
- PreToolUse hooks blocking rm -rf and direct main pushes
- Custom statusline script showing context usage bar

## Sources
- https://github.com/evantahler/dot-claude
- https://github.com/trailofbits/claude-code-config
- https://github.com/zircote/.claude
- https://gist.github.com/wshobson/011992e50f39e48600917ddc0db389f4
- https://github.com/centminmod/my-claude-code-setup
- https://github.com/anthropics/claude-code-action/blob/main/CLAUDE.md
- https://github.com/ykdojo/claude-code-tips
