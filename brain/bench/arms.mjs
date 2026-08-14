/**
 * Benchmark arms — each one is a set of CLI FLAGS, never installed state.
 *
 * This is the change that makes the whole suite trustworthy. The previous harness
 * (staffing-ab.mjs) swapped ~/.claude/agents in and out between arms and relied on exit traps
 * to put the live tree back. That worked, but it modified the operator's real setup mid-run,
 * and it could only ever compare Alfred against Alfred — the user CLAUDE.md loaded into every
 * arm regardless, which orchestration-eval.mjs flagged as invalidating the "baseline".
 *
 * `claude --bare` skips hooks, plugin sync, auto-memory and CLAUDE.md auto-discovery. That is
 * the org-free baseline the older harness said it could not produce. Every arm now starts from
 * that zero and adds back exactly what it is meant to be testing.
 *
 * CONSEQUENCE, and it is the point: nothing here touches ~/.claude. The same command runs
 * identically on this machine or in a fresh container, which is what makes cloud execution an
 * optimisation rather than a correctness requirement.
 *
 * AUTH: --bare authenticates strictly via ANTHROPIC_API_KEY (OAuth and keychain are never read
 * in bare mode). That bills the API account, NOT a Claude subscription. Deliberate: a benchmark
 * that quietly spends subscription allowance is a benchmark nobody re-runs.
 */
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.USERPROFILE || os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

/**
 * Where a competing config gets cloned to. Deliberately NOT installed — a third-party config
 * is someone else's instructions and hooks, and it runs in a throwaway directory or not at all.
 */
export const VENDOR = path.join(os.tmpdir(), 'alfred-bench-vendor');

export const ARMS = {
  /**
   * The true zero. No instructions, no skills, no hooks, no memory. Every claim of the form
   * "Alfred is better than nothing" is measured against THIS, and it has never existed here.
   */
  bare: {
    label: 'bare',
    describe: 'Claude Code with nothing loaded',
    flags: () => ['--bare'],
  },

  /**
   * Alfred as it ships. Skills and the org handbook are supplied from the REPO, not from the
   * installed tree, so the arm is reproducible on a machine that has never installed Alfred.
   */
  alfred: {
    label: 'alfred',
    describe: 'Alfred: org handbook + skill library, supplied as flags',
    flags: () => [
      '--bare',
      '--add-dir', REPO,
      '--system-prompt-file', path.join(REPO, 'claude-md', 'global-CLAUDE.md'),
    ],
  },

  /**
   * The head-to-head that actually matters: another configuration for the same runtime and the
   * same model. Isolates the CONFIG, with nothing else varying — which no cross-framework
   * comparison (CrewAI, LangGraph, AutoGen) can do, because those bring their own runtime.
   */
  superpowers: {
    label: 'superpowers',
    describe: 'obra/superpowers (272k stars), loaded as a plugin',
    flags: () => ['--bare', '--plugin-dir', path.join(VENDOR, 'superpowers')],
    vendor: { repo: 'obra/superpowers', into: 'superpowers' },
  },

  /**
   * Filing conventions only — no org model, no roles. Separates "the folder discipline is doing
   * the work" from "the org model is doing the work". Those are conflated constantly, including
   * by me earlier in this project.
   */
  icm: {
    label: 'icm',
    describe: 'ICM folder conventions only, no org model',
    flags: () => [
      '--bare',
      '--add-dir', path.join(CLAUDE, 'skills', 'icm-architect'),
      '--append-system-prompt',
      'Structure all work using the ICM conventions in the icm-architect skill available to you.',
    ],
  },
};

/** Arms whose config must be fetched before the run. */
export const vendored = () => Object.values(ARMS).filter((a) => a.vendor);

export function assertRunnable() {
  const problems = [];
  if (!process.env.ANTHROPIC_API_KEY) {
    problems.push(
      'ANTHROPIC_API_KEY is not set. --bare will not authenticate without it: OAuth and the\n' +
      '  keychain are deliberately never read in bare mode. Set it as a user environment\n' +
      '  variable (not on the command line — that lands in shell history) and reopen the shell.\n' +
      '  Get one at console.anthropic.com; set a spend limit on it.');
  }
  return problems;
}
