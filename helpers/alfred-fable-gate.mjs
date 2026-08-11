#!/usr/bin/env node
// Alfred Fable spawn gate — a PreToolUse hook, deliberately narrow.
//
// Gates exactly one thing: an `Agent` spawn whose model resolves to Fable.
// Fable is the expensive top tier, so a spawn is worth a spoken confirmation.
// EVERY other tool call — Write, Edit, Bash, Read, and Agent spawns at any
// other tier — passes straight through without touching the network.
//
// Wire it up in ~/.claude/settings.json:
//   "hooks": { "PreToolUse": [ { "matcher": "Agent", "hooks": [
//     { "type": "command",
//       "command": "cmd /c node %USERPROFILE%/.claude/helpers/alfred-fable-gate.mjs",
//       "timeout": 30000 } ] } ] }
//
// The `"timeout": 30000` is REQUIRED, not illustrative. Claude Code's default
// command-hook timeout is 600 SECONDS. Every bound this file defines is
// internal; if one is ever escaped, that field is the only thing standing
// between a bug here and a ten-minute stall. Do not omit it.
//
// A crashed, killed or OOM'd hook is safe: per Claude Code's hooks reference,
// exit 0 with no stdout "reports no decision" and the call proceeds, and only
// exit 2 blocks. Absence of this hook is therefore an allow, by design of the
// harness rather than by anything this file does.
//
// DECISION CONTRACT. This file no longer touches the network at all; every
// path resolves locally and immediately.
//   - anything that is not a Fable Agent spawn  → allow, instantly
//   - unparseable or absent hook payload        → allow
//   - a Fable Agent spawn                       → ASK (the harness prompts)
//   - an Agent spawn with NO explicit model and no charter declaring one →
//     deny, with a message saying how to fix it. Local, instant and
//     deterministic; see the long note at the check itself.
//     ALFRED_ALLOW_IMPLICIT_MODEL=1 disables it.
//
// WHY `ask` RATHER THAN A ROUND TRIP TO ALFRED. This hook used to POST to the
// HUD's /api/approvals and block on a spoken answer. Every failure mode of that
// resolved to allow — Alfred not running, no token file, a non-2xx, a malformed
// body, or nobody at the desk before the timeout. The gate's teeth were on loan
// from a server that had to be both up and watched, and a cost control that
// silently disarms whenever the dashboard is closed is not a cost control.
// `ask` defers to Claude Code's own permission prompt, which is by definition
// present — it is what invoked this hook. It cannot time out into an allow, it
// works headless and with the HUD shut down, and the operator answers in the
// session that made the request instead of in a window they may not be facing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
// Reading stdin is the one thing here that can block on something outside this
// process, so it keeps its own bound. Everything the old timeout machinery
// guarded — the abort controller, the server-timeout mirror, the harness
// ceiling — went with the network call.
const STDIN_TIMEOUT_MS = 2_000;
// Tier used when a spawn omits `model`. Sonnet because this branch catches
// general-purpose and workflow-subagent, which do real work.
const DEFAULT_TIER = process.env.ALFRED_DEFAULT_TIER || 'sonnet';
// An injection nobody can see is its own silent default. Append-only, and a
// failure to log must never break a spawn.
const LOG_FILE = path.join(os.homedir(), '.claude', 'metrics', 'model-policy.jsonl');

// `process.stdout.write` on a pipe is ASYNC — a following `process.exit()` can
// truncate it and hand Claude half a JSON object. Exiting from the write
// callback instead would fix truncation but make `emit` non-terminating, so
// execution would fall through to the next statement and emit a SECOND object.
// `fs.writeSync(1, ...)` is the only form that is both flushed and immediate.
function emit(decision, reason, updatedInput) {
  const out = {
    hookEventName: 'PreToolUse',
    permissionDecision: decision,
    permissionDecisionReason: reason,
  };
  // `updatedInput` REPLACES the whole input object rather than merging, so the
  // caller must echo back every field it is not changing. Dropping one here
  // would silently strip a spawn's prompt.
  if (updatedInput) out.updatedInput = updatedInput;
  const payload = JSON.stringify({ hookSpecificOutput: out });
  try { fs.writeSync(1, payload); } catch { /* stdout gone; exit anyway */ }
  process.exit(0);
}
const allow = (reason) => emit('allow', reason);
const deny = (reason) => emit('deny', reason);
// `ask` defers to Claude Code's own permission prompt. Unlike deny it does not
// reject the call, and unlike allow it does not wave it through — the operator
// answers, in the session that made the request.
const ask = (reason) => emit('ask', reason);

// Resolve the model for a spawn. An explicit `model` on the call wins; other-
// wise fall back to the agent definition's frontmatter, since a bare
// `subagent_type` inherits whatever that charter declares.
function resolveModel(input) {
  const explicit = String(input?.model || '').trim();
  if (explicit) return explicit;

  const type = String(input?.subagent_type || '').trim();
  if (!type || !/^[\w.-]+$/.test(type)) return ''; // never build a path from unvetted input
  if (type.length > 128) return '';
  let hit = null;
  const walk = (dir, depth) => {
    if (hit || depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (hit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name === `${type}.md`) hit = full;
    }
  };
  walk(AGENTS_DIR, 0);
  if (!hit) return '';
  try {
    // 16k, not 4k: five of the 74 real charters already have frontmatter over
    // 4000 chars (infra-manager 4397, qa-manager 4239, cfo 4197, cto
    // 4171, coo 4071). For those the closing `---` fell outside the slice,
    // the match failed, and resolution died before ever reaching the model
    // line — a dead path on 7% of the roster that every charter edit widened.
    let head = fs.readFileSync(hit, 'utf8').slice(0, 16_000);
    if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1); // BOM defeats /^---/
    const fm = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return '';
    // Tolerate a trailing YAML comment; `model: fable  # why` is valid YAML and
    // an anchored `\s*$` silently treats it as no model at all.
    const m = fm[1].match(/^[ \t]*model:[ \t]*["']?([\w.-]+)["']?[ \t]*(?:#.*)?$/m);
    return m ? m[1] : '';
  } catch { return ''; }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// An unclosed stdin would block here unbounded — bounded only by Claude Code's
// 600s hook default. Race it. This is now the ONLY wait in the file, and an
// empty read already falls through to allow.
const raw = await Promise.race([
  readStdin().catch(() => ''),
  new Promise((r) => setTimeout(() => r(''), STDIN_TIMEOUT_MS)),
]);
let evt;
try { evt = JSON.parse(raw); } catch { allow('unparseable or unreadable hook payload'); }

const tool = String(evt?.tool_name || '').trim();
if (tool !== 'Agent' && tool !== 'Task') allow('not an Agent spawn');

// Substring, not prefix: the tier is spelled both `fable` and as the full
// model id `claude-fable-5`. No other model contains the word, so matching
// anywhere is safe and an anchored match silently misses the explicit pin.
const model = resolveModel(evt?.tool_input);

// UNSPECIFIED IS THE EXPENSIVE CASE, not the safe one. A spawn with no explicit
// model and no charter declaring one INHERITS THE PARENT'S TIER — so inside a
// Fable session it runs on Fable. The spend ledger priced this: $754.92, 21% of
// all spend over 18 days, went to Fable on `general-purpose` (29 runs, $528.47)
// and `workflow-subagent` (65 runs, $226.45). Neither is a chartered C-suite
// agent; neither was ever chosen to run there. CLAUDE.md already forbids it
// ("never let a subagent default silently") and nothing enforced it.
//
// An earlier review dismissed this as moot because "all 74 agents declare an
// explicit model" — true, and irrelevant: the costly spawns are BUILT-IN agent
// types, which have no charter file to declare anything.
//
// Deny is safe here in a way the approval gate's deny is not: this decision is
// local, deterministic and instant — no network, no timer, nothing that can
// hang. It cannot wedge a session, only reject one malformed call with a
// message saying how to fix it. ALFRED_ALLOW_IMPLICIT_MODEL=1 opts out.
if (!model) {
  const who = String(evt?.tool_input?.subagent_type || 'agent').slice(0, 60);
  const policy = process.env.ALFRED_MODEL_POLICY || 'inject';

  if (policy === 'off') allow('implicit model allowed by ALFRED_MODEL_POLICY=off');

  if (policy === 'deny') {
    deny(
      `Agent spawn for "${who}" has no explicit model and would inherit this session's tier. `
      + 'Pass model explicitly: haiku for search/bulk, sonnet for coding, opus for hard debugging '
      + 'or review, fable only for top-tier adjudication.'
    );
  }

  // DEFAULT: inject rather than refuse. Denying stops the leak but also breaks
  // any caller that legitimately omits `model`, including flows I do not
  // control — that is a bigger blast radius than the bug. Injecting the correct
  // cheap tier fixes the cost with no friction, and is only possible because
  // PreToolUse supports updatedInput.
  //
  // Sonnet, not haiku: this branch catches general-purpose and
  // workflow-subagent, which do real work. Haiku would be cheaper and worse,
  // and a wrong-tier answer costs more than the tokens it saves.
  const injected = { ...(evt?.tool_input || {}), model: DEFAULT_TIER };
  try {
    // mkdir first. appendFileSync does NOT create missing parent directories, so on any install
    // where ~/.claude/metrics/ does not already exist this threw ENOENT into the swallow below and
    // the audit trail was never written — silently, forever, because a failure to log must not
    // break a spawn. It only appeared to work on the author's box because the directory happened
    // to exist from an unrelated feature. A cost control whose evidence depends on that is not a
    // control; it is a coincidence.
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(
      LOG_FILE,
      JSON.stringify({ at: new Date().toISOString(), event: 'model-injected', subagent_type: who, model: DEFAULT_TIER }) + '\n'
    );
  } catch { /* logging must never break the spawn */ }
  emit('allow', `no explicit model — defaulted to ${DEFAULT_TIER} (would otherwise inherit this session's tier)`, injected);
}

// Slice before interpolating: an oversized model string would otherwise be
// echoed verbatim into a multi-megabyte payload written with a SYNCHRONOUS
// fs.writeSync, which blocks if nothing is draining stdout.
if (!/fable/i.test(model)) allow(`not a Fable spawn (model: ${String(model).slice(0, 80)})`);

// The confirmation is asked in Claude Code's OWN permission prompt, not routed
// through Alfred. That is a deliberate reversal of the original design, and it
// is strictly stronger.
//
// The reasoning is at the top of the file, under DECISION CONTRACT. In short:
// the old round trip to /api/approvals failed open on every error path, so the
// gate only had teeth while the HUD was up AND someone was watching it.
const label = String(evt?.tool_input?.subagent_type || 'agent').slice(0, 80);
const desc = String(evt?.tool_input?.description || '').slice(0, 120);

ask(
  `Fable spawn: ${label}${desc ? ' — ' + desc : ''}. `
  + 'Fable is the top tier and is gated by policy; approve only if this task genuinely '
  + 'needs top-tier adjudication rather than opus-tier review.'
);
