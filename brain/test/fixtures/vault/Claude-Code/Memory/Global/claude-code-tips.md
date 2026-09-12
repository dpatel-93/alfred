# Claude Code Power User Tips & Tricks

Reference file for advanced Claude Code features and workflows.

## Keyboard Shortcuts
- **Shift+Tab**: Cycle modes: Normal -> Auto-Accept Edits -> Plan Mode
- **Escape, Escape** (double-tap): Open rewind menu (restore conversation, code, or both)
- **Ctrl+G**: Open Claude's plan in your IDE for manual editing
- **Ctrl+\**: Quick undo last action
- **Ctrl+R**: Reverse search input history
- **Ctrl+V**: Paste images/screenshots into Claude Code
- **Alt+T**: Toggle extended thinking on/off
- **/context**: See what's using context space
- **/compact [focus]**: Compact with focus, e.g., `/compact focus on the API changes`

## Extended Thinking
- Automatically enabled with 31,999 token budget
- Alt+T toggles on/off during session
- Old keywords (think, megathink, ultrathink) are deprecated
- Match thinking depth to problem complexity

## Hooks (Deterministic Rules)
Configured in `settings.json`. Unlike CLAUDE.md, hooks fire 100% of the time.

**Hook events**: PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop
**Exit codes**: 0 = proceed, 2 = block action (stderr fed back to Claude)

**Popular hooks**:
- Auto-format after edits (PostToolUse on Edit|Write -> prettier/ruff)
- Block dangerous commands (PreToolUse on Bash -> check for rm -rf, git push --force)
- Auto-run tests when test files change
- Type-check TypeScript (PostToolUse on Write -> tsc --noEmit)
- Block edits on main branch
- Desktop notifications when tasks complete

**Config locations**:
- `~/.claude/settings.json` (global)
- `.claude/settings.json` (project, shareable)
- `.claude/settings.local.json` (project-local, gitignored)

## .claude/rules/ Directory
Split rules into focused files instead of one giant CLAUDE.md:
```yaml
---
paths:
  - "src/api/**/*.ts"
---
# API Rules
Always use async/await. Never return raw database objects.
```
- Rules without `paths:` apply globally
- Path-based rules only trigger on file reads (not writes)
- Supports symlinks for sharing across projects

## Custom Slash Commands
- Project: `.claude/commands/command-name.md`
- Global: `~/.claude/commands/command-name.md`
- File name = command name (e.g., `review.md` -> `/review`)
- Support arguments: `$1`, `$2`, `$ARGUMENTS`
- Check into git to share with team

## Skills (.claude/skills/)
- Put domain knowledge in `.claude/skills/SKILL.md` files
- Claude auto-loads by relevance — more token-efficient than CLAUDE.md
- Good for: framework patterns, API guidelines, architecture docs

## Session Management
- `claude --resume` or `claude -r`: View/pick from recent sessions
- `claude --resume abc123`: Resume specific session
- `claude --continue`: Continue most recent session
- `claude --fork-session`: Branch off a session for experimentation
- `/resume`: Resume picker within active session

## Rewind System (Double-tap Escape)
- **Restore conversation only**: Keep code changes, undo conversational dead ends
- **Restore code only**: Revert file changes, keep conversation
- **Restore both**: Full rollback
- **Summarize from here**: Compress conversation from a point forward
- **Limitation**: Bash commands (rm, mv, cp) are NOT tracked by checkpoints

## Headless Mode & Automation
- `claude -p "prompt"`: Non-interactive mode for CI/CD
- `--output-format json`: Structured output
- `--output-format stream-json`: Real-time streaming
- Pipe data in: `git diff | claude -p "Review for security issues"`
- `--allowedTools`: Permit specific tools in headless mode

## Permissions Configuration
In `settings.json`:
- **allow**: Tools/commands that run without confirmation
- **deny**: Blocked tools/commands (priority over allow)
- **ask**: Tools that always prompt for confirmation
- `additionalDirectories`: Allowlist for accessible directories

## Git Worktrees
- Run 3-5 parallel Claude sessions, each in its own worktree
- `claude --worktree feature-auth` to auto-create isolated worktree
- Subagents can use worktree isolation: `isolation: worktree`

## Images & Visual Debugging
- Ctrl+V to paste screenshots
- Reference image paths: `@path/to/screenshot.png`
- Drag and drop files into Claude Code window
- Use for: UI bug screenshots, design mockups, comparing implementations

## MCP Server Tips
- Config in `.mcp.json` (project), `.claude/settings.local.json` (local), `~/.claude/settings.local.json` (global)
- Use `${VAR}` syntax for environment variables — keep API keys out of version control
- Tool Search dynamically loads MCP tools to avoid consuming >10% of context

## Common Pitfalls to Avoid
- **Over-specified CLAUDE.md**: Keep under 200 lines. Important rules get lost in noise.
- **Ghost context**: Don't assume Claude remembers previous conversations
- **Mega-prompt**: Don't request 5 features in a single message — leads to partial implementations
- **No verification**: Always include tests or verification steps
- **Missing Compact Instructions**: Without them, compaction may discard critical context
- **Everything marked IMPORTANT**: If everything is important, nothing is

## Model Selection
- `claude --model opus`: Complex architecture/debugging
- `claude --model sonnet`: Daily coding (best starting point)
- `claude --model haiku`: Quick lookups, simple tasks
- Model only applies to current session

## Status Line
- `/statusline` to configure custom status bar
- Display: model name, context %, tokens, git branch, uncommitted files
- Runs locally, no API token cost
