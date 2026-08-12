#!/usr/bin/env node
// Alfred gate enforcement — a PreToolUse hook that makes `confirm-before-fanout` mean something.
//
// THE PROBLEM IT SOLVES. R3 made the Chief of Staff emit a `gate` field on every classification,
// and measured emission at 23/23. It measured HONOURING nowhere. Run B then measured it directly:
// see brain/gate-honour-eval.mjs. A router that writes "confirm-before-fanout — because this is
// production-mutating" and then spawns anyway has produced an artifact that looks like diligence
// and functions as none, and that is strictly worse than never having written it, because the
// artifact now reads as care.
//
// Structure beats exhortation. That is the lesson that produced the three required fields, and this
// is the same lesson applied one level down: a gate that only a model remembers to honour is an
// instruction; a gate a hook refuses to let it pass is a control.
//
// HOW IT WORKS. The gate becomes a small state file. While an unconfirmed non-proceed gate is
// outstanding for this session, every Agent spawn resolves to `ask` — Claude Code's own permission
// prompt, in the session that made the request. The operator is the one who clears it, which is the
// entire point: the gate exists because a human was supposed to answer.
//
//   node alfred-gate-enforce.mjs set "<gate text>" "<blocking premises>"   # arm
//   node alfred-gate-enforce.mjs clear                                     # operator confirmed
//   node alfred-gate-enforce.mjs status                                    # inspect
//
// THE HONEST WEAKNESS, stated here rather than discovered later. Something has to WRITE the state,
// and that writer is the Chief of Staff — a model following an instruction. So this converts
// "remember to honour the gate" into "remember to record the gate", which is a smaller ask but is
// still an ask. What makes it not merely relocated exhortation is that the recording is now
// OBSERVABLE and therefore testable: the routing eval already measures gate emission, and a test
// can assert that an emitted non-proceed gate produced a state file. An unrecorded gate is a
// falsifiable defect rather than an invisible one. That is a real improvement and it is not a
// complete solution; a fully structural version would require the harness itself to surface the
// classification to the hook, which is not available today.
//
// FAILING OPEN IS DELIBERATE on every path that is not a live gate. A cost/safety control that
// wedges sessions gets disabled within a week, and a disabled control protects nothing. Per Claude
// Code's hooks reference, exit 0 with no stdout reports no decision and the call proceeds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE = path.join(os.homedir(), '.claude', 'metrics', 'gate-state.json');
const LOG = path.join(os.homedir(), '.claude', 'metrics', 'model-policy.jsonl');
const STDIN_TIMEOUT_MS = 2_000;
// A gate outlives its turn but must not outlive its usefulness. An hour is long enough that a real
// pause survives a coffee break and short enough that a forgotten `clear` cannot silently gate a
// session tomorrow. Staleness fails OPEN, and says so in the log.
const MAX_AGE_MS = 60 * 60 * 1000;

function emit(decision, reason) {
  const payload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  });
  try { fs.writeSync(1, payload); } catch { /* stdout gone; exit anyway */ }
  process.exit(0);
}
const allow = (r) => emit('allow', r);
const ask = (r) => emit('ask', r);

function log(event, extra = {}) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), event, ...extra }) + '\n');
  } catch { /* logging must never break a spawn */ }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; }
}

// ------------------------------------------------------------------------------------- CLI
const [, , cmd, ...rest] = process.argv;

if (cmd === 'set') {
  const [gate, premises] = rest;
  if (!gate) { console.error('usage: alfred-gate-enforce.mjs set "<gate>" ["<premises>"]'); process.exit(2); }
  if (/^proceed/i.test(gate)) {
    // Arming on `proceed` would gate every ordinary turn — the over-gating failure the routing
    // eval's counterweight exists to catch, reproduced in the enforcement layer.
    console.error('refusing to arm on a "proceed" gate — that would gate every ordinary turn');
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({
    at: new Date().toISOString(),
    session: process.env.CLAUDE_SESSION_ID || null,
    gate: String(gate).slice(0, 400),
    blocking_premises: String(premises || '').slice(0, 800),
  }, null, 2));
  log('gate-armed', { gate: String(gate).slice(0, 200) });
  console.log(`gate ARMED — Agent spawns will require confirmation until cleared.\n  ${gate}`);
  process.exit(0);
}

if (cmd === 'clear') {
  const s = readState();
  try { fs.unlinkSync(STATE); } catch { /* already clear */ }
  log('gate-cleared', { was: s?.gate?.slice(0, 200) || null });
  console.log(s ? 'gate CLEARED — spawns proceed normally.' : 'no gate was armed.');
  process.exit(0);
}

if (cmd === 'status') {
  const s = readState();
  if (!s) { console.log('no gate armed'); process.exit(0); }
  const age = Date.now() - new Date(s.at).getTime();
  console.log(`gate armed ${Math.round(age / 1000)}s ago${age > MAX_AGE_MS ? ' (STALE — fails open)' : ''}`);
  console.log(`  gate:     ${s.gate}`);
  if (s.blocking_premises) console.log(`  premises: ${s.blocking_premises}`);
  process.exit(0);
}

// -------------------------------------------------------------------------------- hook mode
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = await Promise.race([
  readStdin().catch(() => ''),
  new Promise((r) => setTimeout(() => r(''), STDIN_TIMEOUT_MS)),
]);

let evt;
try { evt = JSON.parse(raw); } catch { allow('unparseable or unreadable hook payload'); }

const tool = String(evt?.tool_name || '').trim();
if (tool !== 'Agent' && tool !== 'Task') allow('not an Agent spawn');

const state = readState();
if (!state) allow('no gate armed');

const age = Date.now() - new Date(state.at).getTime();
if (!(age >= 0) || age > MAX_AGE_MS) {
  // Stale gates fail open and are logged. A gate nobody cleared is far more likely to be a
  // forgotten one than a live pause, and a control that silently blocks tomorrow's work on
  // yesterday's question gets switched off, at which point it protects nothing.
  log('gate-stale-expired', { armedAt: state.at });
  try { fs.unlinkSync(STATE); } catch { /* best effort */ }
  allow('armed gate is stale — expired, failing open');
}

const who = String(evt?.tool_input?.subagent_type || 'agent').slice(0, 60);
log('gate-blocked-spawn', { subagent_type: who, gate: state.gate?.slice(0, 200) });

ask(
  `A confirmation gate is OUTSTANDING and has not been answered.\n\n`
  + `  gate:     ${state.gate}\n`
  + (state.blocking_premises ? `  premises: ${state.blocking_premises}\n` : '')
  + `\nThis spawn (${who}) would commit work the gate said to confirm first. Approve only if you `
  + `are answering that question now. Clearing it afterwards: `
  + `node ~/.claude/helpers/alfred-gate-enforce.mjs clear`
);
