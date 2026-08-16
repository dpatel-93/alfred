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
  // ALFRED_VAULT wins, matching how the brain server resolves the same folder.
  // One machine, one answer — a hook and a server disagreeing about where the
  // vault is would sync memories somewhere the brain never reads.
  if (process.env.ALFRED_VAULT) return process.env.ALFRED_VAULT;
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

// Claude Code memory directories — scan all project memory dirs.
// Overridable so the round-trip can be tested against throwaway folders rather
// than the operator's real memories.
const CLAUDE_MEMORY_BASE = process.env.ALFRED_MEMORY_BASE ||
  path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects');

// The index file is a list of pointers that BOTH machines append to, so it is
// the one file where "newest wins" silently destroys work. It is merged, never
// overwritten. Everything else is one-fact-per-file and safe to copy.
const INDEX_FILE = 'MEMORY.md';

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

// Memory files are copied VERBATIM in both directions. They were previously
// rewritten into a "vault note" with different frontmatter and a footer, which
// reads fine but cannot be copied back: the reconstructed file lost `name:` and
// `metadata.type`, the two fields the memory system actually reads. A store you
// cannot restore from is a backup, not a sync.

/**
 * Union-merge two copies of the pointer index, section by section.
 * Both machines append to this file, so whichever copy is written second would
 * otherwise erase the other's entries. Order of the first argument is kept and
 * lines unique to the second are appended under their own heading.
 */
function mergeIndexMarkdown(primary, secondary) {
  const parse = (text) => {
    const sections = new Map([['', []]]);
    let current = '';
    for (const line of String(text || '').split(/\r?\n/)) {
      if (/^##\s+/.test(line)) {
        current = line.trim();
        if (!sections.has(current)) sections.set(current, []);
      } else {
        sections.get(current).push(line);
      }
    }
    return sections;
  };

  const a = parse(primary);
  const b = parse(secondary);

  for (const [heading, linesB] of b) {
    if (!a.has(heading)) { a.set(heading, linesB); continue; }
    const linesA = a.get(heading);
    const seen = new Set(linesA.map((l) => l.trim()).filter(Boolean));
    for (const line of linesB) {
      const key = line.trim();
      if (key && !seen.has(key)) { linesA.push(line); seen.add(key); }
    }
  }

  const out = [];
  for (const [heading, lines] of a) {
    if (heading) out.push(heading);
    out.push(...lines);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Merge the index file at both ends so neither machine loses a pointer. */
function syncIndexFile(localPath, vaultPath) {
  const local = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf-8') : '';
  const vault = fs.existsSync(vaultPath) ? fs.readFileSync(vaultPath, 'utf-8') : '';
  if (!local && !vault) return false;

  const merged = mergeIndexMarkdown(local || vault, vault);
  let changed = false;
  if (merged !== local) { fs.writeFileSync(localPath, merged, 'utf-8'); changed = true; }
  if (merged !== vault) { fs.writeFileSync(vaultPath, merged, 'utf-8'); changed = true; }
  return changed;
}

/**
 * Vault copies written before this file learned to store memories verbatim.
 * They carry rewritten frontmatter and a footer, and they are DERIVED artifacts:
 * safe to overwrite from the real memory, never safe to copy back down, because
 * they no longer carry `name:` or `metadata.type`. Both directions check this —
 * pushing replaces them, pulling ignores them.
 */
function isLegacyVaultNote(text) {
  return /^source:\s*claude-code$/m.test(text) && /\*Synced from Claude Code on /.test(text);
}

/**
 * Copy src over dest when src is genuinely newer and different. If dest also
 * changed, its version is preserved beside it rather than discarded — this hook
 * must never be the reason a memory disappears.
 */
function copyIfNewer(srcPath, destPath) {
  const src = fs.readFileSync(srcPath, 'utf-8');
  if (fs.existsSync(destPath)) {
    const dest = fs.readFileSync(destPath, 'utf-8');
    if (dest === src) return 'same';
    // A legacy vault note loses to the real memory regardless of timestamps,
    // and is not worth preserving as a conflict copy - it is a lossy render of
    // the very file replacing it.
    if (isLegacyVaultNote(dest)) {
      fs.writeFileSync(destPath, src, 'utf-8');
      return 'copied';
    }
    if (fs.statSync(destPath).mtimeMs >= fs.statSync(srcPath).mtimeMs) return 'older';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(destPath.replace(/\.md$/, `.conflict-${stamp}.md`), dest, 'utf-8');
  }
  fs.writeFileSync(destPath, src, 'utf-8');
  return 'copied';
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

  // A project under the operator's _Projects folder. Everything after the
  // marker is the name, and this is the one rule that reads the same on both
  // platforms — which is the entire point, because the two machines encode the
  // same project as different folder names:
  //   Windows  C--Users-x-OneDrive-Desktop--Projects-Alfred
  //   macOS    -Users-x-Library-CloudStorage-OneDrive-Personal-Desktop--Projects-Alfred
  // Without this, every rule below is Windows-only and a Mac matches nothing.
  const marker = '--Projects-';
  const at = cleaned.lastIndexOf(marker);
  if (at !== -1) return cleaned.slice(at + marker.length) || 'Global';

  // A bare home directory on either platform: C--Users-x, -Users-x, -home-x.
  if (/^([A-Za-z]-)?-Users-[^-]+$/.test(cleaned) || /^-home-[^-]+$/.test(cleaned)) return 'Global';

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

    // The index is merged rather than copied — see syncIndexFile.
    try {
      if (syncIndexFile(path.join(memoryDir, INDEX_FILE), path.join(projectSubDir, INDEX_FILE))) {
        synced++;
        syncedFiles.push({ file: INDEX_FILE, project: projectName, type: 'index' });
      }
    } catch (err) {
      errors++;
      dim(`Failed to merge ${projectName}/${INDEX_FILE}: ${err.message}`);
    }

    const memFiles = fs.readdirSync(memoryDir).filter(f =>
      f.endsWith('.md') && f !== INDEX_FILE && !f.includes('.conflict-')
    );

    for (const memFile of memFiles) {
      const srcPath = path.join(memoryDir, memFile);

      try {
        const result = copyIfNewer(srcPath, path.join(projectSubDir, memFile));
        if (result === 'copied') {
          synced++;
          syncedFiles.push({ file: memFile, project: projectName, type: parseMemoryFile(srcPath).type });
        } else {
          skipped++;
        }
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

/**
 * Pull memories from the vault back down to this machine — the half that makes
 * a second computer see the first one's memories.
 *
 * Only fills memory folders that already exist locally. The folder name Claude
 * Code derives from a path is machine-specific, so this cannot invent the right
 * one; the first session in a project on a new machine creates it and the next
 * session populates it.
 */
function doPull() {
  if (!VAULT_ROOT || !fs.existsSync(VAULT_MEMORY_DIR) || !fs.existsSync(CLAUDE_MEMORY_BASE)) return;

  // Which local folder answers to which vault project name.
  const localByProject = new Map();
  for (const dir of fs.readdirSync(CLAUDE_MEMORY_BASE)) {
    const memoryDir = path.join(CLAUDE_MEMORY_BASE, dir, 'memory');
    if (fs.existsSync(memoryDir)) localByProject.set(deriveProjectName(dir), memoryDir);
  }

  let pulled = 0;
  let errors = 0;

  for (const projectName of fs.readdirSync(VAULT_MEMORY_DIR)) {
    const vaultDir = path.join(VAULT_MEMORY_DIR, projectName);
    const memoryDir = localByProject.get(projectName);
    if (!memoryDir || !fs.statSync(vaultDir).isDirectory()) continue;

    try {
      if (syncIndexFile(path.join(memoryDir, INDEX_FILE), path.join(vaultDir, INDEX_FILE))) pulled++;
    } catch (err) {
      errors++;
      dim(`Failed to merge ${projectName}/${INDEX_FILE}: ${err.message}`);
    }

    for (const memFile of fs.readdirSync(vaultDir)) {
      if (!memFile.endsWith('.md') || memFile === INDEX_FILE || memFile.includes('.conflict-')) continue;
      const vaultFile = path.join(vaultDir, memFile);
      try {
        // Never pull a legacy rewritten note down over a real memory. The next
        // push from the machine that owns it replaces the vault copy properly.
        if (isLegacyVaultNote(fs.readFileSync(vaultFile, 'utf-8'))) continue;
        if (copyIfNewer(vaultFile, path.join(memoryDir, memFile)) === 'copied') {
          pulled++;
          dim(`< ${projectName}/${memFile}`);
        }
      } catch (err) {
        errors++;
        dim(`Failed to pull ${memFile}: ${err.message}`);
      }
    }
  }

  if (pulled || errors) success(`Pulled ${pulled} memories from the vault (${errors} errors)`);
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
    case 'pull': doPull(); break;
    // One command for machines that only get to run a hook once per session.
    case 'both': doPull(); doSync(); break;
    case 'status': doStatus(); break;
    default:
      console.log('Usage: vault-memory-sync.cjs <sync|pull|both|status>');
      break;
  }
} catch (err) {
  // Hooks must never crash Claude Code
  try { dim(`Error (non-critical): ${err.message}`); } catch (_) {}
}
