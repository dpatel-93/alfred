// Fail-open contract for helpers/alfred-fable-gate.mjs.
//
// This hook sits in front of every Agent spawn on the CEO's daily driver, so
// the property under test is not "does it gate Fable" but "can it EVER wedge a
// session". Every case below therefore asserts a decision AND a time budget.
//
// Self-contained: redirects HOME so it never touches the real ~/.claude, and
// needs neither a browser nor a server. Since the `ask` rewrite the hook makes
// no network call at all — which is most of the point, and why the mock
// approval servers this file used to stand up are gone.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, '..', '..', 'helpers', 'alfred-fable-gate.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-gate-'));
const R = [];
const add = (n, ok, d) => R.push({ n, ok, d: String(d).slice(0, 300) });

function runHook(payload, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    const kill = setTimeout(() => p.kill(), 60000);
    p.on('close', () => {
      clearTimeout(kill);
      const ms = Date.now() - t0;
      const raw = out.trim();
      // More than one decision object means a code path fell through after
      // emitting — the bug fs.writeSync+exit exists to prevent.
      const doubled = raw.includes('}{') || (raw.match(/hookEventName/g) || []).length > 1;
      let decision = null, reason = '';
      try {
        const o = JSON.parse(raw).hookSpecificOutput;
        decision = o.permissionDecision; reason = o.permissionDecisionReason;
      } catch { /* decision stays null -> the assertion reports it */ }
      resolve({ decision, reason, ms, raw, doubled });
    });
    p.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}

async function expect(name, payload, env, want, budgetMs) {
  const r = await runHook(payload, env);
  const bad = [];
  if (r.doubled) bad.push('emitted >1 decision');
  if (r.decision !== want) bad.push(`want ${want}, got ${r.decision} (raw: ${r.raw.slice(0, 60)})`);
  if (budgetMs != null && r.ms > budgetMs) bad.push(`${r.ms}ms exceeds ${budgetMs}ms budget`);
  add(name, !bad.length, bad.length ? bad.join('; ') : `${r.decision} in ${r.ms}ms — ${r.reason}`);
}

function home(name, token) {
  const h = path.join(TMP, name);
  fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
  if (token) fs.writeFileSync(path.join(h, '.claude', 'alfred-session.token'), token);
  return { USERPROFILE: h, HOME: h };
}
const agent = (input) => ({ tool_name: 'Agent', tool_input: input });

// --- 1. pass-through: must not gate, must not touch the network -----------
const bare = home('bare', null);
await expect('Read is not gated', { tool_name: 'Read', tool_input: { file_path: 'x' } }, bare, 'allow', 3000);
await expect('Bash is not gated', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, bare, 'allow', 3000);
await expect('Write is not gated', { tool_name: 'Write', tool_input: { file_path: 'x' } }, bare, 'allow', 3000);
await expect('Agent/haiku is not gated', agent({ subagent_type: 'x', model: 'haiku' }), bare, 'allow', 3000);
await expect('Agent/opus is not gated', agent({ subagent_type: 'x', model: 'opus' }), bare, 'allow', 3000);
await expect('Agent/sonnet is not gated', agent({ subagent_type: 'x', model: 'sonnet' }), bare, 'allow', 3000);
await expect('garbage stdin fails open', 'not json at all', bare, 'allow', 3000);
await expect('empty stdin fails open', '', bare, 'allow', 3000);

// --- 2. Fable IS recognised, in every spelling ----------------------------
{
  const env = home('deny', null);
  await expect('model: fable -> ask', agent({ subagent_type: 'x', model: 'fable' }), env, 'ask', 5000);
  await expect('model: Fable (case) -> ask', agent({ subagent_type: 'x', model: 'Fable' }), env, 'ask', 5000);
  // The full model id is what an explicit pin looks like; an anchored /^fable/
  // regex missed this and it shipped as a silent false pass.
  await expect('model: claude-fable-5 -> ask', agent({ subagent_type: 'x', model: 'claude-fable-5' }), env, 'ask', 5000);
}

// --- 3. tier inherited from the agent charter, not the call ---------------
{
  const env = home('fm', null);
  const agentsDir = path.join(env.HOME, '.claude', 'skills', 'orgagent', 'references', 'charters', 'vp', 'deep');
  fs.mkdirSync(agentsDir, { recursive: true });
  const mk = (n, m) => fs.writeFileSync(path.join(agentsDir, `${n}.md`),
    `---\nname: ${n}\nmodel: ${m}\n---\n# ${n}\n`);
  mk('fx-fable', 'fable'); mk('fx-opus', 'opus');
  fs.writeFileSync(path.join(agentsDir, 'fx-nomodel.md'), `---\nname: fx-nomodel\n---\n# x\n`);

  await expect('subagent_type only, charter says fable -> ask', agent({ subagent_type: 'fx-fable' }), env, 'ask', 5000);
  await expect('subagent_type only, charter says opus -> allow', agent({ subagent_type: 'fx-opus' }), env, 'allow', 5000);
  await expect('explicit opus overrides fable charter', agent({ subagent_type: 'fx-fable', model: 'opus' }), env, 'allow', 5000);
}

// --- 3b. an unresolvable model is the EXPENSIVE case, not the safe one -----
// A spawn with no explicit model and no charter inherits the parent's tier.
// The ledger priced that at $754.92 (21% of 18 days' spend) on general-purpose
// and workflow-subagent — built-in types with no charter to declare anything.
// These four all previously returned allow, which is exactly how it leaked.
{
  const env = home('implicit', null); // no token: proves the deny is local, not gate-dependent
  const dir = path.join(env.HOME, '.claude', 'skills', 'orgagent', 'references', 'charters');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fx-nomodel.md'), `---\nname: fx-nomodel\n---\n# x\n`);

  // DEFAULT POLICY IS INJECT, NOT DENY. Denying stops the leak but breaks any
  // caller that legitimately omits model. Injecting fixes the cost with no
  // friction — possible only because PreToolUse supports updatedInput.
  const injects = async (name, input) => {
    const r = await runHook(agent(input), env);
    const bad = [];
    if (r.decision !== 'allow') bad.push(`want allow, got ${r.decision}`);
    let ui = null;
    try { ui = JSON.parse(r.raw).hookSpecificOutput.updatedInput; } catch {}
    if (!ui) bad.push('no updatedInput returned');
    else {
      if (ui.model !== 'sonnet') bad.push(`model not injected (got ${ui.model})`);
      // updatedInput REPLACES the input object — every original field must survive.
      for (const k of Object.keys(input)) {
        if (JSON.stringify(ui[k]) !== JSON.stringify(input[k])) bad.push(`field "${k}" lost or altered`);
      }
    }
    add(name, !bad.length, bad.length ? bad.join('; ') : `injected model=sonnet, ${Object.keys(input).length} field(s) preserved`);
  };

  await injects('charter declares no model -> inject sonnet', { subagent_type: 'fx-nomodel', prompt: 'p', description: 'd' });
  await injects('general-purpose -> inject sonnet', { subagent_type: 'general-purpose', prompt: 'do work', description: 'x' });
  await injects('workflow-subagent -> inject sonnet', { subagent_type: 'workflow-subagent', prompt: 'p' });
  await injects('no subagent_type at all -> inject', { prompt: 'do a thing' });
  await injects('unresolvable traversal -> inject', { subagent_type: '../../../../etc/passwd', prompt: 'p' });
  await injects('absurdly long subagent_type -> inject', { subagent_type: 'a'.repeat(5000), prompt: 'p' });

  // The strict policy must still be available for anyone who wants it loud.
  await expect('ALFRED_MODEL_POLICY=deny still refuses',
    agent({ subagent_type: 'general-purpose' }), { ...env, ALFRED_MODEL_POLICY: 'deny' }, 'deny', 3000);
  await expect('ALFRED_MODEL_POLICY=off allows untouched',
    agent({ subagent_type: 'general-purpose' }), { ...env, ALFRED_MODEL_POLICY: 'off' }, 'allow', 3000);

  // An explicit model always satisfies the rule, whatever the tier.
  for (const m of ['haiku', 'sonnet', 'opus']) {
    await expect(`explicit ${m} on an uncharted type -> allow`, agent({ subagent_type: 'general-purpose', model: m }), env, 'allow', 3000);
  }
  // The deny must be instant and local — it must not depend on, or wait for,
  // the approval server. There is no token in this env at all.
  const t0 = Date.now();
  await expect('implicit-model handling needs no server', agent({ subagent_type: 'general-purpose' }), env, 'allow', 2500);
  add('implicit-model handling is fast (<2.5s, no network)', Date.now() - t0 < 2500, `${Date.now() - t0}ms`);
}

// --- 4. frontmatter resolution edge cases --------------------------------
// No mock server anywhere below: the hook is fully local now, so these run
// against nothing but the charter files on disk.
{
  const env = home('fm2', null);
  const dir = path.join(env.HOME, '.claude', 'skills', 'orgagent', 'references', 'charters', 'vp');
  fs.mkdirSync(dir, { recursive: true });

  // Five real charters already exceed the old 4000-char frontmatter slice, so
  // resolution died before reaching the model line on 7% of the roster.
  const pad = 'x'.repeat(6000);
  fs.writeFileSync(path.join(dir, 'fx-big.md'),
    `---\nname: fx-big\ndescription: |\n  ${pad}\nmodel: fable\n---\n# big\n`);
  await expect('frontmatter >4000 chars still resolves', agent({ subagent_type: 'fx-big' }), env, 'ask', 5000);

  fs.writeFileSync(path.join(dir, 'fx-comment.md'), `---\nname: fx-comment\nmodel: fable  # top tier\n---\n# c\n`);
  await expect('trailing YAML comment on model line', agent({ subagent_type: 'fx-comment' }), env, 'ask', 5000);

  fs.writeFileSync(path.join(dir, 'fx-bom.md'), '﻿' + `---\nname: fx-bom\nmodel: fable\n---\n# b\n`);
  await expect('UTF-8 BOM does not defeat the match', agent({ subagent_type: 'fx-bom' }), env, 'ask', 5000);

  fs.writeFileSync(path.join(dir, 'fx-crlf.md'), `---\r\nname: fx-crlf\r\nmodel: fable\r\n---\r\n# c\r\n`);
  await expect('CRLF line endings resolve', agent({ subagent_type: 'fx-crlf' }), env, 'ask', 5000);
}

// --- 5. the gate no longer depends on Alfred running ----------------------
// This is the whole point of moving to `ask`, so it is asserted directly
// rather than left as a property of the other cases. Previously every one of
// these produced ALLOW: the hook POSTed to /api/approvals and failed open on
// any error, which meant the Fable gate silently disarmed whenever the HUD was
// down, unwatched, or simply slow. The teeth were on loan from a server.
{
  await expect('no token file -> still asks',
    agent({ subagent_type: 'x', model: 'fable' }), home('notok', null), 'ask', 3000);
  await expect('malformed token -> still asks',
    agent({ subagent_type: 'x', model: 'fable' }), home('badtok', 'garbage'), 'ask', 3000);
  // A token pointing at a closed port used to mean a connection attempt and a
  // fail-open. Now nothing is dialled at all, so it must be as fast as the
  // no-token case rather than merely eventually correct.
  await expect('token at a dead port -> still asks, without dialling it',
    agent({ subagent_type: 'x', model: 'fable' }), home('deadport', '1:tok'), 'ask', 3000);
}

// --- 6. no path may block: there is nothing left to wait on ----------------
// The only remaining wait in the hook is the stdin read. Everything else --
// the abort controller, the server-timeout mirror, the harness ceiling -- went
// with the network call, so the budget here is deliberately tight.
{
  const t0 = Date.now();
  await expect('a Fable spawn resolves in well under a second',
    agent({ subagent_type: 'x', model: 'fable' }), home('fast', null), 'ask', 1500);
  add('Fable decision is local and fast (<1.5s, no network)', Date.now() - t0 < 1500, `${Date.now() - t0}ms`);
}

// The stdin read is now the ONLY thing in this file that can wait on something
// outside the process, which makes its own bound the last line of defence
// against riding Claude Code's 600s hook default. Kept verbatim from the
// adversarial pass that found it: write a valid payload and never call .end().
R.push(await (async () => {
  const t0 = Date.now();
  const env = home('stdinhang', null);
  const p = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stdin.write(JSON.stringify(agent({ subagent_type: 'x', model: 'fable' })));
  const code = await new Promise((res) => {
    const k = setTimeout(() => { p.kill(); res('TIMEOUT'); }, 15000);
    p.on('close', () => { clearTimeout(k); res('exited'); });
  });
  const ms = Date.now() - t0;
  let decision = null;
  try { decision = JSON.parse(out.trim()).hookSpecificOutput.permissionDecision; } catch { /* reported below */ }
  const ok = code === 'exited' && decision === 'allow' && ms < 10000;
  return { n: 'unclosed stdin -> allow, does not hang', ok,
    d: ok ? `allow in ${ms}ms` : `code=${code} decision=${decision} ms=${ms}` };
})());

// --- 7. ALFRED_GATE_TIMEOUT_MS is retired, not silently honoured -----------
// It used to bound the approval round trip. With no round trip it means
// nothing, and a stale value in someone's settings.json must not change any
// decision -- least of all reopen the gate, which is what a garbage value did
// before (NaN -> setTimeout fires immediately -> auto-approve).
{
  for (const stale of ['abc', '0', '-1', '', '30000', '5000']) {
    await expect(`stale ALFRED_GATE_TIMEOUT_MS ${JSON.stringify(stale)} changes nothing`,
      agent({ subagent_type: 'x', model: 'fable' }),
      { ...home(`stale${stale || 'empty'}`, null), ALFRED_GATE_TIMEOUT_MS: stale }, 'ask', 3000);
  }
}
// --- Model-policy audit trail -----------------------------------------------------------------
// The injection path itself is covered above. What was NOT covered is whether the injection leaves
// an AUDIT RECORD — and the hook's own header says why that matters: "An injection nobody can see
// is its own silent default." Model-tier policy that silently rewrites a spawn and writes nothing
// is a cost control with no evidence, which is the same failure class as a test suite that prints
// SKIP and exits 0. The control was verified working by hand; this test is what keeps it working.
{
  const env = home('modelpolicy', null);
  const ledger = path.join(env.HOME, '.claude', 'metrics', 'model-policy.jsonl');
  try { fs.rmSync(ledger, { force: true }); } catch {}

  const out = await runHook(agent({ subagent_type: 'general-purpose', prompt: 'x' }), env);
  let decision = null;
  try { decision = JSON.parse(out.raw).hookSpecificOutput; } catch { /* reported below */ }

  add('implicit model is injected, not inherited',
    decision?.updatedInput?.model === 'sonnet',
    `got ${JSON.stringify(decision?.updatedInput?.model)}`);

  const wrote = fs.existsSync(ledger);
  add('model injection writes an audit record', wrote,
    'injection fired with no ledger entry — the cost control leaves no evidence it acted');

  if (wrote) {
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(ledger, 'utf8').trim().split('\n').pop()); } catch {}
    add('audit record names the event, the agent and the injected tier',
      rec?.event === 'model-injected' && rec?.subagent_type === 'general-purpose'
        && rec?.model === 'sonnet',
      `record was ${JSON.stringify(rec)}`);
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
