#!/usr/bin/env node
/**
 * Vault Memory Sync Hook
 *
 * Syncs Claude Code auto-memory files to the Alfred Brain vault on SessionEnd.
 * Each memory becomes a plain-markdown note in Claude-Code/Memory/.
 * A session log entry is appended to Claude-Code/SessionLog.md.
 *
 * The vault is a plain-markdown folder — Obsidian was retired 2026-08-08 and is
 * not required. YAML frontmatter and wiki-links are kept because they are useful
 * on their own and stay compatible with any reader that understands them.
 *
 * Usage:
 *   node vault-memory-sync.cjs sync       # SessionEnd: sync memories to vault
 *   node vault-memory-sync.cjs status     # Show sync status
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Configuration ---

// The vault path comes from the operator's own profile, never a hardcoded one —
// this file is copied verbatim by the installer to every machine, not just its
// author's. Unset or absent means "no vault configured", which is a supported
// state: the hook degrades to a no-op rather than inventing a directory.
const PROFILE_PATH = path.join(os.homedir(), '.claude', 'alfred-profile.md');

function getVaultRoot() {
  try {
    const text = fs.readFileSync(PROFILE_PATH, 'utf8');
    const m = text.match(/^\s*-\s*\*\*Knowledge vault path[^*]*\*\*:\s*(.+)$/m);
    if (!m) return null;
    const value = m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    if (!value || /^\(?not specified\)?$/i.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

const VAULT_ROOT = getVaultRoot();
const VAULT_MEMORY_DIR = VAULT_ROOT && path.join(VAULT_ROOT, 'Claude-Code', 'Memory');
const VAULT_SESSION_LOG = VAULT_ROOT && path.join(VAULT_ROOT, 'Claude-Code', 'SessionLog.md');

// Claude Code memory directories — scan all project memory dirs
const CLAUDE_MEMORY_BASE = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects');

// Colors
const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const YELLOW = '\x1b[0;33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const log = (msg) => console.log(`${CYAN}[VaultSync] ${msg}${RESET}`);
const success = (msg) => console.log(`${GREEN}[VaultSync] ${msg}${RESET}`);
const warn = (msg) => console.log(`${YELLOW}[VaultSync] ${msg}${RESET}`);
const dim = (msg) => console.log(`  ${DIM}${msg}${RESET}`);

// --- Helpers ---

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function getDateStamp() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Parse a Claude memory file's frontmatter and content.
 */
function parseMemoryFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const result = { name: '', description: '', type: '', content: '', raw };

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const fm = fmMatch[1];
    result.content = fmMatch[2].trim();

    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    if (nameMatch) result.name = nameMatch[1].trim();

    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (descMatch) result.description = descMatch[1].trim();

    const typeMatch = fm.match(/^type:\s*(.+)$/m);
    if (typeMatch) result.type = typeMatch[1].trim();
  } else {
    // No frontmatter — treat entire file as content
    result.content = raw.trim();
    result.name = path.basename(filePath, '.md');
  }

  return result;
}

/**
 * Convert a Claude memory file into a vault note.
 * Uses YAML frontmatter properties and wiki-links.
 */
function toVaultNote(memory, sourcePath, projectName) {
  const lines = [];

  // YAML frontmatter properties
  lines.push('---');
  lines.push(`source: claude-code`);
  lines.push(`type: ${memory.type || 'unknown'}`);
  lines.push(`project: ${projectName}`);
  lines.push(`synced: ${getTimestamp()}`);
  if (memory.description) lines.push(`description: "${memory.description.replace(/"/g, '\\"')}"`);
  lines.push('---');
  lines.push('');

  // Content with wiki-links to related notes
  if (memory.content) {
    lines.push(memory.content);
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Synced from Claude Code on ${getDateStamp()}*`);
  lines.push(`*Source: \`${sourcePath}\`*`);

  return lines.join('\n');
}

/**
 * Derive a project name from a Claude project memory path.
 * e.g., C--Users-<you>-Meridian → Meridian
 *       C--Users-<you>-OneDrive-Desktop--Projects-DailyBrief → DailyBrief
 *       C--Users-<you> → Global
 */
function deriveProjectName(dirName) {
  // Strip worktree suffixes (--claude-worktrees-*)
  let cleaned = dirName.replace(/--claude-worktrees-.*$/, '');

  // Remove the drive-and-user prefix for WHATEVER operator is running this —
  // matching a specific username here meant every other machine fell through
  // and kept the full path as the "project name".
  // Also handles paths like c--Windows-System32 that have no Users segment.
  cleaned = cleaned.replace(/^[A-Za-z]--Users-[^-]+-?/, '');
  cleaned = cleaned.replace(/^[A-Za-z]--/, '');

  if (!cleaned) return 'Global';

  // Common path segments to strip — we just want the project name
  // e.g., OneDrive-Desktop--Projects-DailyBrief → DailyBrief
  //        OneDrive-Desktop-Portfolio-Project → Portfolio-Project

  // Strip known path prefixes
  cleaned = cleaned
    .replace(/^OneDrive-Desktop--Projects-/, '')
    .replace(/^OneDrive-Desktop-/, '')
    .replace(/^OneDrive-Documents-/, '')
    .replace(/^DP-/, '')
    .replace(/^[Ww]indows-[Ss]ystem32$/, 'System')
    .trim();

  // Convert remaining dashes to readable form (keep as-is for project names like ComplianceHub)
  return cleaned || 'Global';
}

// --- Commands ---

function doSync() {
  log('Syncing Claude memories to the Alfred Brain vault...');

  if (!VAULT_ROOT) {
    dim('No knowledge vault configured in alfred-profile.md — nothing to sync.');
    return;
  }

  if (!fs.existsSync(VAULT_ROOT)) {
    warn('Vault not found at ' + VAULT_ROOT);
    return;
  }

  ensureDir(VAULT_MEMORY_DIR);

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  const syncedFiles = [];

  // Scan all project memory directories
  if (!fs.existsSync(CLAUDE_MEMORY_BASE)) {
    warn('No Claude memory directories found');
    return;
  }

  const projectDirs = fs.readdirSync(CLAUDE_MEMORY_BASE).filter(d => {
    const fullPath = path.join(CLAUDE_MEMORY_BASE, d, 'memory');
    return fs.existsSync(fullPath);
  });

  for (const projectDir of projectDirs) {
    const memoryDir = path.join(CLAUDE_MEMORY_BASE, projectDir, 'memory');
    const projectName = deriveProjectName(projectDir);
    const projectSubDir = path.join(VAULT_MEMORY_DIR, projectName);

    ensureDir(projectSubDir);

    const memFiles = fs.readdirSync(memoryDir).filter(f =>
      f.endsWith('.md') && f !== 'MEMORY.md'
    );

    for (const memFile of memFiles) {
      const srcPath = path.join(memoryDir, memFile);

      try {
        const memory = parseMemoryFile(srcPath);
        const srcStat = fs.statSync(srcPath);
        const destPath = path.join(projectSubDir, memFile);

        // Check if vault copy exists and is up-to-date
        if (fs.existsSync(destPath)) {
          const destStat = fs.statSync(destPath);
          if (destStat.mtimeMs >= srcStat.mtimeMs) {
            skipped++;
            continue;
          }
        }

        // Write the vault note
        const vaultNote = toVaultNote(memory, srcPath, projectName);
        fs.writeFileSync(destPath, vaultNote, 'utf-8');
        synced++;
        syncedFiles.push({ file: memFile, project: projectName, type: memory.type });
      } catch (err) {
        errors++;
        dim(`Failed to sync ${memFile}: ${err.message}`);
      }
    }
  }

  // Append session log entry
  if (synced > 0) {
    appendSessionLog(syncedFiles);
  }

  success(`Synced ${synced} memories (${skipped} unchanged, ${errors} errors)`);
  for (const f of syncedFiles) {
    dim(`+ ${f.project}/${f.file} (${f.type})`);
  }
}

function appendSessionLog(syncedFiles) {
  const timestamp = getTimestamp();
  const date = getDateStamp();

  let logContent = '';
  if (fs.existsSync(VAULT_SESSION_LOG)) {
    logContent = fs.readFileSync(VAULT_SESSION_LOG, 'utf-8');
  } else {
    logContent = '# Claude Code Session Log\n\nAuto-generated log of Claude Code sessions and memory syncs.\n\n';
  }

  const entry = [
    `## ${timestamp}`,
    '',
    `**Memories synced:** ${syncedFiles.length}`,
    ...syncedFiles.map(f => `- [[Claude-Code/Memory/${f.project}/${f.file.replace('.md', '')}|${f.file.replace('.md', '')}]] (${f.type})`),
    '',
    '---',
    '',
  ].join('\n');

  // Append at the end (newest entries at bottom, chronological order)
  logContent = logContent.trimEnd() + '\n\n' + entry;

  fs.writeFileSync(VAULT_SESSION_LOG, logContent, 'utf-8');
}

function doStatus() {
  console.log('\n=== Vault Memory Sync Status ===\n');

  if (!VAULT_ROOT) {
    console.log('  Vault:          NOT CONFIGURED');
    dim('Set "Knowledge vault path" in ~/.claude/alfred-profile.md to enable syncing.');
    console.log('');
    return;
  }

  console.log(`  Vault:          ${fs.existsSync(VAULT_ROOT) ? 'Found' : 'NOT FOUND'}`);
  console.log(`  Memory dir:     ${fs.existsSync(VAULT_MEMORY_DIR) ? 'Exists' : 'Will be created on first sync'}`);
  console.log(`  Session log:    ${fs.existsSync(VAULT_SESSION_LOG) ? 'Exists' : 'Will be created on first sync'}`);
  console.log(`  Memory base:    ${fs.existsSync(CLAUDE_MEMORY_BASE) ? 'Found' : 'NOT FOUND'}`);

  if (fs.existsSync(VAULT_MEMORY_DIR)) {
    let count = 0;
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (f.endsWith('.md')) count++;
      }
    };
    walk(VAULT_MEMORY_DIR);
    console.log(`  Vault memories: ${count}`);
  }

  console.log('');
}

// --- Main ---
const command = process.argv[2] || 'status';

try {
  switch (command) {
    case 'sync': doSync(); break;
    case 'status': doStatus(); break;
    default:
      console.log('Usage: vault-memory-sync.cjs <sync|status>');
      break;
  }
} catch (err) {
  // Hooks must never crash Claude Code
  try { dim(`Error (non-critical): ${err.message}`); } catch (_) {}
}
