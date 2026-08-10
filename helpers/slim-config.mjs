#!/usr/bin/env node
/**
 * slim-config.mjs — One-time "slim to native" migration (user-run).
 *
 * Removes the claude-flow / Alfred machinery from your Claude Code CONFIG files
 * and keeps only the native-aligned, useful bits. Reversible: backs everything
 * up first. DRY-RUN by default — pass --apply to write.
 *
 *   node slim-config.mjs            # preview what would change
 *   node slim-config.mjs --apply    # apply (after backup)
 *
 * Scope (config JSON only — agent/skill .md pruning is handled separately):
 *   settings.json        - drop alfredFlow block, alfred env vars, theatrical
 *                          hooks; keep safety + memory + obsidian + doctor;
 *                          set model alias "opus"; register config-doctor.
 *   settings.local.json  - remove broken permission fragments; drop alfred-flow
 *                          & flow-nexus from enabledMcpjsonServers.
 *   .mcp.json            - remove alfred-flow & flow-nexus servers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const claudeDir = path.resolve(__dirname, '..');
const home = path.resolve(claudeDir, '..');
const APPLY = process.argv.includes('--apply');

const settingsPath = path.join(claudeDir, 'settings.json');
const localPath = path.join(claudeDir, 'settings.local.json');
const mcpPath = path.join(home, '.mcp.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const stamp = new Date().toISOString().slice(0, 10);
const backupDir = path.join(claudeDir, 'backups', `slim-${stamp}`);
const summary = [];

// Config-flow ecosystem markers to strip.
const KILL_MCP = ['alfred-flow', 'flow-nexus'];
const BROKEN_PERM_PREFIXES = [
  'Bash(done)', 'Bash(wait)', 'Bash(do ', 'Bash(for pid in ', 'Bash(for repo:',
  'Bash(for wf:', 'Bash(while read:', 'Bash(echo "===', 'Bash(cat "./',
  'Bash(find C:Users',
];
// SessionStart helper scripts worth keeping (native-aligned).
const KEEP_SESSION_START = ['auto-memory-hook.mjs', 'config-doctor.mjs'];

function backup() {
  if (!APPLY) return;
  fs.mkdirSync(backupDir, { recursive: true });
  for (const p of [settingsPath, localPath, mcpPath]) {
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(backupDir, path.basename(p)));
  }
  summary.push(`Backed up 3 config files -> ${backupDir}`);
}

function slimSettings() {
  const s = readJson(settingsPath);

  if (s.alfredFlow) { delete s.alfredFlow; summary.push('settings.json: removed alfredFlow block (daemon, neural, swarm, adr, ddd, security auto-scan)'); }

  if (s.env) {
    for (const k of ['ALFRED_FLOW_V3_ENABLED', 'ALFRED_FLOW_HOOKS_ENABLED']) {
      if (k in s.env) { delete s.env[k]; summary.push(`settings.json: removed env ${k}`); }
    }
  }

  // Model currency via alias.
  if (s.model !== 'opus') { summary.push(`settings.json: model ${s.model ?? '(unset)'} -> opus (alias = latest)`); s.model = 'opus'; }
  if (s.fallbackModel !== 'sonnet') { s.fallbackModel = 'sonnet'; summary.push('settings.json: fallbackModel -> sonnet'); }

  // Slim hooks to the useful minimum.
  if (s.hooks) {
    const before = JSON.stringify(s.hooks).length;
    // Keep PreToolUse Bash safety only.
    if (s.hooks.PreToolUse) {
      s.hooks.PreToolUse = s.hooks.PreToolUse.filter((g) => JSON.stringify(g).includes('pre-bash'));
    }
    // SessionStart: keep only the useful helpers + doctor.
    if (s.hooks.SessionStart) {
      for (const g of s.hooks.SessionStart) {
        if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => KEEP_SESSION_START.some((k) => h.command?.includes(k)));
      }
      // Ensure config-doctor present.
      const flat = JSON.stringify(s.hooks.SessionStart);
      if (!flat.includes('config-doctor.mjs')) {
        (s.hooks.SessionStart[0] ??= { hooks: [] }).hooks.push({
          type: 'command',
          command: `cmd /c node ${claudeDir.replace(/\\/g, '/')}/helpers/config-doctor.mjs`,
          timeout: 10000,
        });
      }
    }
    // SessionEnd: keep obsidian sync only.
    if (s.hooks.SessionEnd) {
      for (const g of s.hooks.SessionEnd) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => h.command?.includes('vault-memory-sync'));
    }
    // Stop: keep auto-memory sync only (drop redundant obsidian sync).
    if (s.hooks.Stop) {
      for (const g of s.hooks.Stop) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => h.command?.includes('auto-memory-hook'));
    }
    // Drop theatrical hook events entirely.
    for (const ev of ['PostToolUse', 'UserPromptSubmit', 'PreCompact', 'SubagentStart', 'SubagentStop', 'Notification']) {
      if (s.hooks[ev]) { delete s.hooks[ev]; summary.push(`settings.json: removed ${ev} hooks (alfred telemetry/theater)`); }
    }
    if (JSON.stringify(s.hooks).length !== before) summary.push('settings.json: slimmed hooks to safety + memory + obsidian + doctor');
  }

  if (APPLY) fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
}

function slimLocal() {
  const s = readJson(localPath);
  if (s.permissions?.allow) {
    const before = s.permissions.allow.length;
    s.permissions.allow = s.permissions.allow.filter((e) => !BROKEN_PERM_PREFIXES.some((p) => e.startsWith(p)));
    const removed = before - s.permissions.allow.length;
    if (removed) summary.push(`settings.local.json: removed ${removed} broken permission fragment(s)`);
  }
  if (Array.isArray(s.enabledMcpjsonServers)) {
    const before = s.enabledMcpjsonServers.length;
    s.enabledMcpjsonServers = s.enabledMcpjsonServers.filter((n) => !KILL_MCP.includes(n));
    if (s.enabledMcpjsonServers.length !== before) summary.push(`settings.local.json: disabled MCP ${KILL_MCP.join(', ')} (kept the rest)`);
  }
  if (APPLY) fs.writeFileSync(localPath, JSON.stringify(s, null, 2) + '\n');
}

function slimMcp() {
  const s = readJson(mcpPath);
  if (s.mcpServers) {
    for (const n of KILL_MCP) if (s.mcpServers[n]) { delete s.mcpServers[n]; summary.push(`.mcp.json: removed server '${n}'`); }
  }
  if (APPLY) fs.writeFileSync(mcpPath, JSON.stringify(s, null, 2) + '\n');
}

// --- Run ---
backup();
slimSettings();
slimLocal();
slimMcp();

console.log(`\n=== slim-config ${APPLY ? '(APPLIED)' : '(DRY-RUN — pass --apply to write)'} ===\n`);
for (const line of summary) console.log('  • ' + line);
console.log(`\n${summary.length} change(s).${APPLY ? '' : '  Re-run with --apply to commit.'}\n`);
