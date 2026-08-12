// Gate-enforcement hook behaviour.
//
// This is the control that makes `confirm-before-fanout` mean something instead of describing
// something. It is therefore exactly the kind of file that must be tested by its FAILURE modes, not
// its happy path: a gate that silently stops arming, or that arms and never clears, is worse than
// no gate — the first protects nothing while appearing to, and the second gets the whole mechanism
// switched off within a week.
//
// Every assertion below drives the real hook through real stdin, the way Claude Code invokes it.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOK = path.join(os.homedir(), '.claude', 'helpers', 'alfred-gate-enforce.mjs');
const STATE = path.join(os.homedir(), '.claude', 'metrics', 'gate-state.json');
const R = [];
const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const AGENT_CALL = JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'devops-manager' } });

function hook(input) {
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  try { return JSON.parse(r.stdout).hookSpecificOutput; } catch { return { raw: r.stdout, err: r.stderr }; }
}
const cli = (...args) => spawnSync(process.execPath, [HOOK, ...args], { encoding: 'utf8' });

// Preserve any real armed gate so running the suite never disarms the operator's live session.
const saved = fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8') : null;
try {
  cli('clear');

  // --- fails open, on every path that is not a live gate -------------------------------------
  T('no gate armed -> allow', hook(AGENT_CALL).permissionDecision === 'allow');
  T('unparseable payload -> allow', hook('not json').permissionDecision === 'allow',
    'a crashed or confused hook must never wedge a session');
  T('empty payload -> allow', hook('').permissionDecision === 'allow');

  // --- arming -------------------------------------------------------------------------------
  cli('set', 'confirm-before-fanout — rollback is production-mutating', 'that the deploy caused it');
  T('gate file written on set', fs.existsSync(STATE));

  const gated = hook(AGENT_CALL);
  T('armed gate turns an Agent spawn into ask', gated.permissionDecision === 'ask',
    `got ${gated.permissionDecision}`);
  T('ask reason carries the gate text', /production-mutating/.test(gated.permissionDecisionReason || ''),
    'the operator must see WHAT they are being asked to confirm, not just that something is gated');
  T('ask reason carries the blocking premise',
    /deploy caused it/.test(gated.permissionDecisionReason || ''),
    'the premise is the part that lets the operator notice the gate is about the wrong thing');

  // --- scope: it gates spawns, not everything ------------------------------------------------
  const bash = hook(JSON.stringify({ tool_name: 'Bash', tool_input: {} }));
  T('non-Agent tools pass through while gated', bash.permissionDecision === 'allow',
    'gating Read/Edit/Bash would make the control unusable, and an unusable control gets removed');

  // --- clearing -----------------------------------------------------------------------------
  cli('clear');
  T('clear disarms', hook(AGENT_CALL).permissionDecision === 'allow');
  T('gate file removed on clear', !fs.existsSync(STATE));

  // --- the two ways this control could quietly become useless ---------------------------------
  // 1. Arming on a 'proceed' gate would gate EVERY ordinary turn — the over-gating failure the
  //    routing eval's counterweight exists to catch, reproduced one layer down.
  const onProceed = cli('set', 'proceed — nothing risky here');
  T('refuses to arm on a proceed gate', onProceed.status === 2 && !fs.existsSync(STATE),
    'arming on proceed would gate every turn, and a control that blocks everything gets disabled');

  // 2. A gate nobody cleared is far more likely forgotten than live. Staleness must fail OPEN, or
  //    yesterday's unanswered question silently blocks today's work.
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({
    at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    gate: 'confirm-before-fanout — stale',
  }));
  const stale = hook(AGENT_CALL);
  T('a stale gate fails open', stale.permissionDecision === 'allow',
    `got ${stale.permissionDecision} — a gate that outlives its turn turns into a session-wide block`);
  T('a stale gate is cleaned up, not left to re-fire', !fs.existsSync(STATE));

  // 3. A corrupt state file must not be read as "gated forever" OR crash the hook.
  fs.writeFileSync(STATE, '{ this is not json');
  T('corrupt state file fails open', hook(AGENT_CALL).permissionDecision === 'allow');
  cli('clear');
} finally {
  try {
    if (saved !== null) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, saved); }
    else if (fs.existsSync(STATE)) fs.unlinkSync(STATE);
  } catch { /* best effort */ }
}

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
