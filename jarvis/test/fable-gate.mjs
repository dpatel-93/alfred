// Fail-open contract for helpers/alfred-fable-gate.mjs.
//
// This hook sits in front of every Agent spawn on the CEO's daily driver, so
// the property under test is not "does it gate Fable" but "can it EVER wedge a
// session". Every case below therefore asserts a decision AND a time budget.
//
// Self-contained: spawns its own mock approval servers on ephemeral ports and
// redirects HOME, so it never touches the real ~/.claude or the shared test
// server. Needs no browser, so it cannot be skipped.
import { spawn } from 'node:child_process';
import http from 'node:http';
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
async function server(handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, port: s.address().port };
}
const DENY = (_q, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"decision":"deny"}'); };
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
  const { s, port } = await server(DENY);
  const env = home('deny', `${port}:tok`);
  await expect('model: fable -> gated', agent({ subagent_type: 'x', model: 'fable' }), env, 'deny', 5000);
  await expect('model: Fable (case) -> gated', agent({ subagent_type: 'x', model: 'Fable' }), env, 'deny', 5000);
  // The full model id is what an explicit pin looks like; an anchored /^fable/
  // regex missed this and it shipped as a silent false pass.
  await expect('model: claude-fable-5 -> gated', agent({ subagent_type: 'x', model: 'claude-fable-5' }), env, 'deny', 5000);
  s.close();
}

// --- 3. tier inherited from the agent charter, not the call ---------------
{
  const { s, port } = await server(DENY);
  const env = home('fm', `${port}:tok`);
  const agentsDir = path.join(env.HOME, '.claude', 'agents', 'vp', 'deep');
  fs.mkdirSync(agentsDir, { recursive: true });
  const mk = (n, m) => fs.writeFileSync(path.join(agentsDir, `${n}.md`),
    `---\nname: ${n}\nmodel: ${m}\n---\n# ${n}\n`);
  mk('fx-fable', 'fable'); mk('fx-opus', 'opus');
  fs.writeFileSync(path.join(agentsDir, 'fx-nomodel.md'), `---\nname: fx-nomodel\n---\n# x\n`);

  await expect('subagent_type only, charter says fable -> gated', agent({ subagent_type: 'fx-fable' }), env, 'deny', 5000);
  await expect('subagent_type only, charter says opus -> allow', agent({ subagent_type: 'fx-opus' }), env, 'allow', 5000);
  await expect('charter has no model: line -> allow', agent({ subagent_type: 'fx-nomodel' }), env, 'allow', 5000);
  await expect('unknown subagent_type -> allow', agent({ subagent_type: 'no-such-agent' }), env, 'allow', 5000);
  await expect('explicit opus overrides fable charter', agent({ subagent_type: 'fx-fable', model: 'opus' }), env, 'allow', 5000);
  await expect('traversal in subagent_type is refused', agent({ subagent_type: '../../../../etc/passwd' }), env, 'allow', 5000);
  s.close();
}

// --- 4. the wedge cases: nothing may block past the timeout ---------------
await expect('no token -> allow fast', agent({ subagent_type: 'x', model: 'fable' }), home('notok', null), 'allow', 3000);
await expect('malformed token -> allow fast', agent({ subagent_type: 'x', model: 'fable' }), home('badtok', 'garbage'), 'allow', 3000);
await expect('token points at a dead port -> allow fast',
  agent({ subagent_type: 'x', model: 'fable' }), home('deadport', '1:tok'), 'allow', 5000);
{
  const { s, port } = await server(() => { /* accept, never answer */ });
  const env = { ...home('hang', `${port}:tok`), ALFRED_GATE_TIMEOUT_MS: '3000' };
  await expect('server never replies -> allow at timeout', agent({ subagent_type: 'x', model: 'fable' }), env, 'allow', 8000);
  s.close();
}
{
  // The whole reason the hook's timeout must stay below the server's: on its
  // own 60s timer the server manufactures a deny that looks identical to a
  // human refusal. Aborting first is what keeps an unattended gate open.
  const { s, port } = await server((_q, res) => setTimeout(() => {
    try { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"decision":"deny"}'); } catch {}
  }, 5000));
  const env = { ...home('late', `${port}:tok`), ALFRED_GATE_TIMEOUT_MS: '1500' };
  await expect('deny arriving AFTER the window -> allow, not deny',
    agent({ subagent_type: 'x', model: 'fable' }), env, 'allow', 4000);
  s.close();
}
{
  const { s, port } = await server(DENY);
  const env = { ...home('misconf', `${port}:tok`), ALFRED_GATE_TIMEOUT_MS: '60000' };
  await expect('timeout >= server 60s -> refuses to gate at all',
    agent({ subagent_type: 'x', model: 'fable' }), env, 'allow', 5000);
  s.close();
}
{
  const { s, port } = await server((_q, res) => { res.writeHead(200); res.end('<html>nope</html>'); });
  await expect('non-JSON 200 -> allow', agent({ subagent_type: 'x', model: 'fable' }), home('junk', `${port}:tok`), 'allow', 5000);
  s.close();
}
{
  const { s, port } = await server((_q, res) => { res.writeHead(500); res.end('boom'); });
  await expect('HTTP 500 -> allow', agent({ subagent_type: 'x', model: 'fable' }), home('err', `${port}:tok`), 'allow', 5000);
  s.close();
}
{
  const { s, port } = await server((_q, res) => res.socket.destroy());
  await expect('connection reset mid-request -> allow', agent({ subagent_type: 'x', model: 'fable' }), home('reset', `${port}:tok`), 'allow', 5000);
  s.close();
}

// --- 5. an in-window human refusal must still work ------------------------
{
  const { s, port } = await server(DENY);
  await expect('explicit in-window deny IS honoured',
    agent({ subagent_type: 'x', model: 'fable' }), home('real', `${port}:tok`), 'deny', 5000);
  s.close();
}

// --- 6. the three P0s an adversarial review found -------------------------
// None of these were reachable by the cases above: they live in stdin, in the
// response BODY (after headers), and in fetch's redirect default.

// P0-1: stdin is read before any timer exists. An unclosed stdin blocked
// forever, bounded only by Claude Code's 600s default hook timeout.
R.push(await (async () => {
  const t0 = Date.now();
  const env = home('stdinhang', null);
  const p = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  // Write a valid payload but NEVER call .end() — stdin stays open.
  p.stdin.write(JSON.stringify(agent({ subagent_type: 'x', model: 'fable' })));
  const code = await new Promise((res) => {
    const k = setTimeout(() => { p.kill(); res('TIMEOUT'); }, 15000);
    p.on('close', () => { clearTimeout(k); res('exited'); });
  });
  const ms = Date.now() - t0;
  let decision = null;
  try { decision = JSON.parse(out.trim()).hookSpecificOutput.permissionDecision; } catch {}
  const ok = code === 'exited' && decision === 'allow' && ms < 10000;
  return { n: 'unclosed stdin -> allow, does not hang', ok,
    d: ok ? `allow in ${ms}ms` : `code=${code} decision=${decision} ms=${ms}` };
})());

// P0-2: clearTimeout used to run before res.json(), leaving the body read
// unbounded. A lying Content-Length needs no adversary — a server dying
// mid-body produces it.
{
  const { s, port } = await server((_q, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
    res.write('{"de'); // never completes the promised 1000 bytes
  });
  const env = { ...home('dribble', `${port}:tok`), ALFRED_GATE_TIMEOUT_MS: '2000' };
  await expect('truncated body (lying Content-Length) -> allow in budget',
    agent({ subagent_type: 'x', model: 'fable' }), env, 'allow', 6000);
  s.close();
}
{
  const { s, port } = await server((_q, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
    setInterval(() => { try { res.write(' '); } catch {} }, 3000).unref();
  });
  const env = { ...home('slowbody', `${port}:tok`), ALFRED_GATE_TIMEOUT_MS: '2000' };
  await expect('body dribbles forever -> allow at timeout',
    agent({ subagent_type: 'x', model: 'fable' }), env, 'allow', 7000);
  s.close();
}

// P0-3: fetch follows redirects and forwards X-Alfred-Token to the target,
// which then gets to answer "deny" as though the CEO had. The only
// demonstrated path to a deny with no human refusal.
{
  let leaked = false;
  const b = await server((req, res) => {
    if (req.headers['x-alfred-token']) leaked = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"decision":"deny"}');
  });
  const a = await server((_q, res) => { res.writeHead(301, { Location: `http://127.0.0.1:${b.port}/api/approvals` }); res.end(); });
  await expect('redirect is refused, not followed',
    agent({ subagent_type: 'x', model: 'fable' }), home('redir', `${a.port}:tok`), 'allow', 5000);
  add('redirect target never receives the token', !leaked, leaked ? 'TOKEN LEAKED to redirect target' : 'no token leaked');
  a.s.close(); b.s.close();
}

// --- 7. misconfiguration must fail loudly, never silently open ------------
{
  const { s, port } = await server(DENY);
  const tok = `${port}:tok`;
  // A typo'd env var used to coerce to NaN, fire setTimeout immediately, and
  // auto-approve every Fable spawn — silently, while the opposite mistake got
  // a loud "gate misconfigured".
  for (const bad of ['abc', '20000abc', '0', '-1', '']) {
    await expect(`garbage timeout ${JSON.stringify(bad)} -> allow, stated`,
      agent({ subagent_type: 'x', model: 'fable' }),
      { ...home(`bad${bad || 'empty'}`, tok), ALFRED_GATE_TIMEOUT_MS: bad }, 'allow', 5000);
  }
  await expect('timeout above harness ceiling -> refuses to gate',
    agent({ subagent_type: 'x', model: 'fable' }),
    { ...home('ceiling', tok), ALFRED_GATE_TIMEOUT_MS: '30000' }, 'allow', 5000);
  await expect('valid custom timeout still gates',
    agent({ subagent_type: 'x', model: 'fable' }),
    { ...home('validto', tok), ALFRED_GATE_TIMEOUT_MS: '5000' }, 'deny', 6000);
  s.close();
}

// --- 8. frontmatter resolution edge cases ---------------------------------
{
  const { s, port } = await server(DENY);
  const env = home('fm2', `${port}:tok`);
  const dir = path.join(env.HOME, '.claude', 'agents', 'vp');
  fs.mkdirSync(dir, { recursive: true });

  // Five real charters already exceed the old 4000-char frontmatter slice, so
  // resolution died before reaching the model line on 7% of the roster.
  const pad = 'x'.repeat(6000);
  fs.writeFileSync(path.join(dir, 'fx-big.md'),
    `---\nname: fx-big\ndescription: |\n  ${pad}\nmodel: fable\n---\n# big\n`);
  await expect('frontmatter >4000 chars still resolves', agent({ subagent_type: 'fx-big' }), env, 'deny', 5000);

  fs.writeFileSync(path.join(dir, 'fx-comment.md'), `---\nname: fx-comment\nmodel: fable  # top tier\n---\n# c\n`);
  await expect('trailing YAML comment on model line', agent({ subagent_type: 'fx-comment' }), env, 'deny', 5000);

  fs.writeFileSync(path.join(dir, 'fx-bom.md'), '﻿' + `---\nname: fx-bom\nmodel: fable\n---\n# b\n`);
  await expect('UTF-8 BOM does not defeat the match', agent({ subagent_type: 'fx-bom' }), env, 'deny', 5000);

  fs.writeFileSync(path.join(dir, 'fx-crlf.md'), `---\r\nname: fx-crlf\r\nmodel: fable\r\n---\r\n# c\r\n`);
  await expect('CRLF line endings resolve', agent({ subagent_type: 'fx-crlf' }), env, 'deny', 5000);

  await expect('absurdly long subagent_type -> allow',
    agent({ subagent_type: 'a'.repeat(5000) }), env, 'allow', 5000);
  s.close();
}

// --- 9. response shapes that must not be read as a refusal ----------------
{
  const cases = [
    ['uppercase DENY is still a deny', '{"decision":"DENY"}', 'deny'],
    ['decision as array -> not a deny', '{"decision":["deny"]}', 'allow'],
    ['no decision field -> allow', '{"reason":"whatever"}', 'allow'],
    ['null body -> allow', 'null', 'allow'],
    ['decision allow -> allow', '{"decision":"allow"}', 'allow'],
  ];
  for (const [name, payload, want] of cases) {
    const { s, port } = await server((_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(payload);
    });
    await expect(name, agent({ subagent_type: 'x', model: 'fable' }),
      home(`resp${cases.findIndex((c) => c[0] === name)}`, `${port}:tok`), want, 5000);
    s.close();
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
