#!/usr/bin/env node
// --- alfred-sync.mjs -------------------------------------------------------
// Keeps the framework artifacts identical on every machine.
//
// Division of labour, deliberately:
//   GitHub   carries skills / commands / agents / helpers - code and prompts
//   OneDrive carries the vault and memories - content you edit continuously
//
// A `git pull` on its own changes NOTHING that Claude Code reads, because the
// live setup is ~/.claude and the repo is a separate folder that the installer
// copies FROM. So pulling must be followed by mirroring into ~/.claude, and a
// skill authored locally must be mirrored back out or it never leaves the box.
// Both directions are newest-wins per file and neither ever deletes.
//
// settings.json is excluded on purpose: it contains absolute machine paths, so
// copying it between a PC and a Mac breaks every hook on the receiving side.
//
// CLI:  node alfred-sync.mjs pull | push | status
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// --- Configuration ---------------------------------------------------------

// Overridable so the mirror rules can be tested against throwaway folders
// instead of the operator's live setup.
const CLAUDE_HOME = process.env.ALFRED_CLAUDE_HOME || path.join(os.homedir(), '.claude');
const PROFILE_PATH = path.join(CLAUDE_HOME, 'alfred-profile.md');
const STATE_PATH = path.join(CLAUDE_HOME, 'helpers', '.alfred-sync.state.json');
const GIT_TIMEOUT_MS = 20000;

// Artifact folders that are safe to share verbatim across operating systems.
// Everything here is markdown or path-independent JS. Anything holding an
// absolute path belongs in the exclusion list below, not here.
const SHARED_DIRS = ['skills', 'commands', 'agents', 'helpers'];
const NEVER_SYNC = new Set([
  'settings.json',        // absolute hook paths, per-machine
  'settings.local.json',
  '.alfred-sync.state.json',
  '.alfred-speak.pid',
  '.alfred-speak-queue.txt',
  'alfred-speak.config.json', // per-machine voice choice
  // Rewritten on EVERY HUD greeting. Syncing it produced a commit and a push
  // per greeting — five in one afternoon before it was caught. Per-machine
  // runtime state has no business travelling between machines.
  '.alfred-greeting.json',
]);
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '__pycache__']);

const CYAN = '\x1b[0;36m'; const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[0;33m'; const DIM = '\x1b[2m'; const RESET = '\x1b[0m';
const log = (m) => console.log(`${CYAN}[AlfredSync] ${m}${RESET}`);
const ok = (m) => console.log(`${GREEN}[AlfredSync] ${m}${RESET}`);
const warn = (m) => console.log(`${YELLOW}[AlfredSync] ${m}${RESET}`);
const dim = (m) => console.log(`  ${DIM}${m}${RESET}`);

// --- Locating the repo -----------------------------------------------------

// Read from the operator's own profile rather than a hardcoded path: this file
// is copied verbatim to every machine, and the repo lives somewhere different
// on each one.
function getRepoRoot() {
  if (process.env.ALFRED_REPO) return process.env.ALFRED_REPO;
  try {
    const text = fs.readFileSync(PROFILE_PATH, 'utf8');
    const m = text.match(/^\s*-\s*\*\*Alfred repo location[^*]*\*\*:\s*(.+)$/m);
    if (!m) return null;
    const value = m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    return value && !/^\(?not specified\)?$/i.test(value) ? value : null;
  } catch { return null; }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ...readState(), ...patch }, null, 2), 'utf8');
  } catch { /* state is an optimisation, never a requirement */ }
}

function git(repo, args, timeout = GIT_TIMEOUT_MS) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout, windowsHide: true });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim(), timedOut: !!r.error };
}

// --- Mirroring -------------------------------------------------------------

function walkFiles(root, rel = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name) || NEVER_SYNC.has(e.name)) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...walkFiles(root, r));
    else out.push(r);
  }
  return out;
}

/**
 * Copy every file from src into dst where src is both different AND newer.
 * Never deletes: a file missing on one side means "not created here yet", not
 * "deleted", and there is no way to tell those apart without a delete log.
 */
function mirrorNewer(src, dst) {
  const changed = [];
  const skippedOlder = [];
  for (const rel of walkFiles(src)) {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    let content;
    try { content = fs.readFileSync(from); } catch { continue; }

    if (fs.existsSync(to)) {
      let existing;
      try { existing = fs.readFileSync(to); } catch { existing = null; }
      if (existing && existing.equals(content)) continue;
      if (fs.statSync(to).mtimeMs > fs.statSync(from).mtimeMs) { skippedOlder.push(rel); continue; }
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, content);
    changed.push(rel);
  }
  return { changed, skippedOlder };
}

function mirrorAll(fromRoot, toRoot) {
  const changed = [];
  const skippedOlder = [];
  for (const dir of SHARED_DIRS) {
    const src = path.join(fromRoot, dir);
    if (!fs.existsSync(src)) continue;
    const r = mirrorNewer(src, path.join(toRoot, dir));
    changed.push(...r.changed.map((f) => `${dir}/${f}`));
    skippedOlder.push(...r.skippedOlder.map((f) => `${dir}/${f}`));
  }
  return { changed, skippedOlder };
}

// --- Commands --------------------------------------------------------------

function doPull() {
  const repo = getRepoRoot();
  if (!repo || !fs.existsSync(path.join(repo, '.git'))) return;

  const before = git(repo, ['rev-parse', 'HEAD']);
  // --ff-only on purpose: an automatic merge at session start, on a repo two
  // machines write to, is how you get a conflicted tree nobody asked for.
  const pulled = git(repo, ['pull', '--ff-only']);
  const after = git(repo, ['rev-parse', 'HEAD']);

  if (!pulled.ok) {
    // Offline is the common case and is not worth shouting about; a diverged
    // branch is, because it means nothing will sync until a human looks.
    if (/diverge|non-fast-forward|not possible to fast-forward/i.test(pulled.out)) {
      warn('Repo has diverged from origin/master — run a manual pull. Syncing local copies only.');
    }
  }

  const moved = before.out !== after.out;
  const { changed, skippedOlder } = mirrorAll(repo, CLAUDE_HOME);

  if (changed.length) {
    ok(`Updated ${changed.length} artifact${changed.length === 1 ? '' : 's'} from the repo${moved ? ' (new commits)' : ''}`);
    for (const f of changed.slice(0, 8)) dim(`< ${f}`);
    if (changed.length > 8) dim(`… and ${changed.length - 8} more`);
  }
  if (skippedOlder.length) {
    dim(`${skippedOlder.length} local file(s) newer than the repo — kept, will go out on push`);
  }
  writeState({ lastPullHead: after.out, lastPullAt: new Date().toISOString() });
}

function doPush() {
  const repo = getRepoRoot();
  if (!repo || !fs.existsSync(path.join(repo, '.git'))) return;

  const { changed } = mirrorAll(CLAUDE_HOME, repo);

  // Stage the WHOLE repo, not just the mirrored dirs. Staging only SHARED_DIRS
  // silently orphaned brain/, docs/, _archive/ and the onboarding files for
  // months - they were committed nowhere and survived on exactly one machine,
  // while every commit message cheerfully reported a successful sync.
  // SHARED_DIRS stays the MIRROR list only: brain/ must NOT be copied into
  // ~/.claude (install.ps1 leaves it in the checkout on purpose - it is a full
  // Node app with its own node_modules). .gitignore already excludes
  // node_modules, brain/index.json, logs and every credentials file.
  // The old early-return on an empty `changed` also meant a repo-only edit
  // (anything authored under brain/ or docs/) could never trigger a push.

  const add = git(repo, ['add', '-A']);
  if (!add.ok) { warn(`git add failed: ${add.out.slice(0, 200)}`); return; }

  const staged = git(repo, ['diff', '--cached', '--name-only']);
  if (!staged.out) return;
  const stagedFiles = staged.out.split('\n').filter(Boolean);

  log(`Publishing ${stagedFiles.length} change${stagedFiles.length === 1 ? '' : 's'} to the repo…`);
  for (const f of (changed.length ? changed : stagedFiles).slice(0, 8)) dim(`> ${f}`);

  const host = os.hostname();
  const msg = `Sync ${stagedFiles.length} framework artifact(s) from ${host}\n\n` +
    stagedFiles.slice(0, 20).map((f) => `- ${f}`).join('\n') +
    (stagedFiles.length > 20 ? `\n- …and ${stagedFiles.length - 20} more` : '');
  const commit = git(repo, ['commit', '-m', msg]);
  if (!commit.ok) { warn(`commit failed: ${commit.out.slice(0, 200)}`); return; }

  const push = git(repo, ['push', 'origin', 'HEAD']);
  if (push.ok) ok(`Pushed ${stagedFiles.length} artifact change(s) to GitHub.`);
  else warn(`Committed locally but push failed — run "git push" in the repo. ${push.out.slice(0, 160)}`);
}

function doStatus() {
  const repo = getRepoRoot();
  console.log('\n=== Alfred Sync Status ===\n');
  console.log(`  Repo:        ${repo || 'NOT CONFIGURED in alfred-profile.md'}`);
  if (!repo || !fs.existsSync(path.join(repo, '.git'))) { console.log(''); return; }

  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], 5000);
  const head = git(repo, ['rev-parse', '--short', 'HEAD'], 5000);
  const dirty = git(repo, ['status', '--porcelain'], 5000);
  console.log(`  Branch:      ${branch.out} @ ${head.out}`);
  console.log(`  Uncommitted: ${dirty.out ? dirty.out.split('\n').length + ' file(s)' : 'clean'}`);

  // Report drift by comparing, never by mirroring — a status command that
  // writes files is a trap.
  let ahead = 0;
  for (const dir of SHARED_DIRS) {
    const local = path.join(CLAUDE_HOME, dir);
    if (!fs.existsSync(local)) continue;
    for (const rel of walkFiles(local)) {
      const there = path.join(repo, dir, rel);
      let a, b;
      try { a = fs.readFileSync(path.join(local, rel)); } catch { continue; }
      try { b = fs.existsSync(there) ? fs.readFileSync(there) : null; } catch { b = null; }
      if (!b || !a.equals(b)) ahead++;
    }
  }
  console.log(`  Local ahead: ${ahead} file(s) differ from the repo`);
  console.log(`  Shared dirs: ${SHARED_DIRS.join(', ')}`);
  console.log(`  Excluded:    ${[...NEVER_SYNC].join(', ')}`);
  console.log(`  Last pull:   ${readState().lastPullAt || 'never'}`);
  console.log('');
}

// --- Entry point -----------------------------------------------------------
// A sync helper must never take a session down with it.

try {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'pull') doPull();
  else if (cmd === 'push') doPush();
  else if (cmd === 'status') doStatus();
  else console.log('Usage: alfred-sync.mjs <pull|push|status>');
} catch (err) {
  try { dim(`AlfredSync error (non-critical): ${err.message}`); } catch { /* ignore */ }
}
process.exitCode = 0;
