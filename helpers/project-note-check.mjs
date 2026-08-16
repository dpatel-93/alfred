#!/usr/bin/env node
// --- project-note-check.mjs -------------------------------------------------
// Tells Claude, at session start, when the vault's project note has fallen
// behind the code — so keeping it current stops being something the operator
// has to remember to ask for.
//
// WHY A NUDGE AND NOT AN AUTO-WRITE. The mechanical halves of staying in sync
// are already automated: alfred-sync carries artifacts through GitHub, and
// vault-memory-sync carries memories through the vault, both on SessionStart
// and SessionEnd. A project note is the part that is NOT mechanical. Its
// Current State is a judgement — what shipped, what broke, what the next
// session should do first — and a hook that generated that from commit
// messages would produce a changelog, which the git log already is, and quietly
// overwrite the one artifact in the vault that carries reasoning.
//
// So this hook does the part a script can do well: notice, and say so. The
// writing stays with the model that has the session's context.
//
// Silence is the normal outcome. It prints only when there is something to do,
// because a line that appears every session is one nobody reads by the third.
//
// CLI:  node project-note-check.mjs [--cwd <dir>]   (also runs as a SessionStart hook)
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PROFILE_PATH = path.join(os.homedir(), '.claude', 'alfred-profile.md');
const GIT_TIMEOUT_MS = 10000;

// --- Locating things --------------------------------------------------------

/** The vault, read from the operator's profile. Absent is a supported state. */
export function getVaultRoot(profilePath = PROFILE_PATH) {
  if (process.env.ALFRED_VAULT) return process.env.ALFRED_VAULT;
  try {
    const m = fs.readFileSync(profilePath, 'utf8')
      .match(/^\s*-\s*\*\*Knowledge vault path[^*]*\*\*:\s*(.+)$/m);
    if (!m) return null;
    const value = m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    return !value || /^\(?not specified\)?$/i.test(value) ? null : value;
  } catch {
    return null;
  }
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args],
    { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '').trim() };
}

/**
 * The repo root containing `dir`, or null. The home directory is deliberately
 * excluded even when it is a repo: a session opened in ~ is not work on a
 * project, and nagging about one there would be noise on every single start.
 */
export function findRepoRoot(dir) {
  const home = path.resolve(os.homedir());
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  if (!r.ok || !r.out) return null;
  const root = path.resolve(r.out);
  return root === home ? null : root;
}

// --- The comparison ---------------------------------------------------------

/**
 * Decide what, if anything, to say. Pure so every branch is testable without a
 * repo, a vault, or a clock.
 *
 * @param {?number} noteMtimeMs  null when the note does not exist
 * @param {{sha: string, atMs: number, subject: string}[]} commitsSince
 */
export function decide({ project, noteMtimeMs, commitsSince }) {
  if (noteMtimeMs == null) {
    return { action: 'create', project, commits: commitsSince.length };
  }
  const newer = commitsSince.filter((c) => c.atMs > noteMtimeMs);
  if (!newer.length) return { action: 'none', project, commits: 0 };
  return { action: 'update', project, commits: newer.length, newest: newer[0] };
}

export function render(verdict) {
  if (verdict.action === 'none') return '';
  if (verdict.action === 'create') {
    return `[ProjectNote] No vault note for "${verdict.project}". Create `
      + `Projects/${verdict.project}.md from Templates/New-Project.md, and fill in Current State `
      + `before this session ends.`;
  }
  const s = verdict.commits === 1 ? '' : 's';
  return `[ProjectNote] "${verdict.project}" has ${verdict.commits} commit${s} newer than its vault `
    + `note (latest: ${verdict.newest.subject}). Update the note's Current State before this session `
    + `ends — demote the old one to Previous State. Do it without being asked.`;
}

// --- Wiring -----------------------------------------------------------------

function check(cwd) {
  const repo = findRepoRoot(cwd);
  if (!repo) return '';
  const vault = getVaultRoot();
  if (!vault) return '';                       // no vault configured: supported, silent

  const project = path.basename(repo);
  const notePath = path.join(vault, 'Projects', `${project}.md`);

  let noteMtimeMs = null;
  try { noteMtimeMs = fs.statSync(notePath).mtimeMs; } catch { /* stays null */ }

  // Only the recent past matters. A note that is a year behind and a note that
  // is a week behind need the same action, and reading the whole history to say
  // so would cost more than the check is worth.
  const log = git(repo, ['log', '-30', '--pretty=format:%H%x1f%ct%x1f%s']);
  if (!log.ok) return '';
  const commitsSince = log.out.split('\n').filter(Boolean).map((line) => {
    const [sha, ct, subject] = line.split('\x1f');
    return { sha, atMs: Number(ct) * 1000, subject: subject || '' };
  });

  return render(decide({ project, noteMtimeMs, commitsSince }));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (isMain) {
  try {
    const i = process.argv.indexOf('--cwd');
    const message = check(i > -1 ? process.argv[i + 1] : process.cwd());
    if (message) console.log(message);
  } catch {
    // A broken reminder must never break a session start.
  }
  process.exitCode = 0;
}
