#!/usr/bin/env node
// Alfred test runner.
//
//   node test/run.mjs            # every suite
//   node test/run.mjs api org    # named suites only
//
// Boots one throwaway server against test/fixtures/vault, runs
// each suite against it, and reports a single pass/fail tally. Each suite ends
// with one sentinel line — `__ALFRED_RESULTS__` followed by a JSON array of
// {n, ok, d} — and anything else it emits is diagnostic noise, surfaced only on
// failure. A suite that prints a bare JSON array is reported as CRASHED, not
// parsed: the sentinel is the contract.
//
// The browser suites need Playwright's chromium. If it is not installed they
// are SKIPPED — and a skip now FAILS the run by default, because a run where
// every browser suite silently skipped must never report green. (This is the
// fix for a real incident: resolvePlaywright() returned null on Windows for
// months, the browser suites printed SKIP on every run, and the run
// still exited 0 — a lane-cap regression and a stale 51-node assertion both
// survived undetected under that cover.) To legitimately run on a bare
// checkout without Playwright installed, set ALFRED_ALLOW_SKIP=1 — the run
// will still print an unmissable banner naming exactly which suites it
// skipped, so skipping stays a decision a human can see, never a silent
// default.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ALFRED_TEST_PORT || 7799);
const BASE = `http://127.0.0.1:${PORT}`;

const SUITES = [
  { name: 'api', file: 'api.mjs', browser: false },
  { name: 'no-compaction-directives', file: 'no-compaction-directives.mjs', browser: false },
  { name: 'install', file: 'install.mjs', browser: false },
  { name: 'brain', file: 'brain.mjs', browser: false },
  { name: 'fable-gate', file: 'fable-gate.mjs', browser: false },
  { name: 'source', file: 'source.mjs', browser: false },
  { name: 'github', file: 'github.mjs', browser: false },
  { name: 'spend', file: 'spend.mjs', browser: false },
  { name: 'retrieval', file: 'retrieval.mjs', browser: false },
  { name: 'routing', file: 'routing.mjs', browser: false },
  { name: 'ask-stream', file: 'ask-stream.mjs', browser: false },
  { name: 'search-nav', file: 'search-nav.mjs', browser: true },
  { name: 'org', file: 'org.mjs', browser: true },
  { name: 'charter', file: 'charter.mjs', browser: true },
];

const wanted = process.argv.slice(2);
const selected = wanted.length ? SUITES.filter((s) => wanted.includes(s.name)) : SUITES;
// A typo'd suite name on the command line (`node test/run.mjs api typo`) must
// not silently run a subset while the human believes they asked for two
// suites — that is its own false-green path. Any unmatched name is a hard
// error, not a warning, whether or not other names on the line did match.
const unknown = wanted.filter((w) => !SUITES.some((s) => s.name === w));
if (unknown.length) {
  console.error(`unknown suite name(s): ${unknown.join(', ')} — available: ${SUITES.map((s) => s.name).join(', ')}`);
  process.exit(2);
}
if (!selected.length) {
  console.error(`no such suite. available: ${SUITES.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

function hasPlaywright() {
  try { return !!resolvePlaywright(); } catch { return false; }
}
// Finding Playwright is not "check three Linux paths". This ran on the author's
// Windows box for months resolving to null every time, so every browser suite
// reported SKIP on every run — and a lane-cap regression and a stale 51-node
// assertion both survived in a suite that looked green. A skip you never stop
// seeing is indistinguishable from a pass.
//
// Order: explicit override, then normal module resolution (local dep, NODE_PATH,
// a linked global), then npm's own global root, then the hardcoded CI paths.
let playwrightCache;
function resolvePlaywright() {
  if (playwrightCache !== undefined) return playwrightCache;
  return (playwrightCache = findPlaywright());
}
function playwrightUrl() {
  const p = resolvePlaywright();
  return p ? pathToFileURL(p).href : null;
}
function findPlaywright() {
  if (process.env.PLAYWRIGHT_INDEX) {
    // May already be a file:// URL from an outer run; accept either form.
    const raw = process.env.PLAYWRIGHT_INDEX;
    const asPath = raw.startsWith('file:') ? fileURLToPath(raw) : raw;
    if (fs.existsSync(asPath)) return asPath;
  }
  // require.resolve honours node_modules lookup from the repo upward, which is
  // what a plain `npm i -D playwright` produces. Ask for package.json rather
  // than the entry point: the export map may not expose index.mjs by path.
  for (const base of [path.join(HERE, 'x.js'), path.join(HERE, '..', 'x.js')]) {
    try {
      const pkg = createRequire(base).resolve('playwright/package.json');
      const entry = path.join(path.dirname(pkg), 'index.mjs');
      if (fs.existsSync(entry)) return entry;
    } catch { /* not resolvable from here */ }
  }
  const roots = [
    '/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules',
  ];
  // `npm root -g` is the only reliable global path on Windows (%APPDATA%\npm\
  // node_modules) and respects a user-configured prefix everywhere else.
  try {
    const npm = os.platform() === 'win32' ? 'npm.cmd' : 'npm';
    const out = execFileSync(npm, ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) roots.unshift(out);
  } catch { /* npm not on PATH — fall through to the fixed roots */ }
  for (const root of roots) {
    const p = path.join(root, 'playwright', 'index.mjs');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, suite.file)], {
      // The suites feed this straight to dynamic import(), and import() rejects
      // a bare Windows path ("Received protocol 'c:'"). Hand them a file:// URL,
      // which is valid on every platform.
      env: { ...process.env, ALFRED_TEST_BASE: BASE, PLAYWRIGHT_INDEX: playwrightUrl() || '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      // Suites end with one sentinel line carrying their results as JSON.
      // Sniffing for "the last JSON-looking thing" instead is unreliable —
      // the diagnostics above it are full of braces and brackets.
      let results = null;
      const marked = out.split('\n').filter((l) => l.startsWith('__ALFRED_RESULTS__')).pop();
      if (marked) {
        try { results = JSON.parse(marked.slice('__ALFRED_RESULTS__'.length)); }
        catch { /* fall through to the crash path */ }
      }
      resolve({ suite, results, code, out, err });
    });
  });
}

// This runner MUTATES the shared brain/index.json — it swaps the real vault
// index out for a fixture-built one and restores it afterwards. That is safe
// exactly once at a time, and catastrophic concurrently:
//
//   run A: backs up the real index (69 notes), writes the fixture (3)
//   run B: starts mid-flight, "backs up" the FIXTURE as if it were real
//   run A: restores 69          run B: restores 3  <- the real index is gone
//
// This actually happened: the CEO's 69-note index was reduced to 3 fixture
// notes, and index.json.testbak — the supposed safety net — held 3 notes too,
// because it was written during exactly this window. A backup taken from
// already-corrupt state is not a backup.
//
// Two guards. A lock so runs serialise, and a sanity check so a fixture is
// never mistaken for a real index worth restoring.
const indexPath = path.join(HERE, '..', 'index.json');
const lockPath = path.join(HERE, '..', '.index.lock');
// mkdir is atomic on every platform — succeeds for exactly one caller.
// Liveness by PID, not by age. Windows has no real signals — an external kill
// (including the SIGTERM `timeout` sends) is a TerminateProcess, so no exit
// handler runs and the lock CANNOT be released by its owner. Cleanup-on-kill is
// not achievable here, which makes recovery the thing that has to work. A lock
// whose owner is gone is a corpse and is broken instantly; only an age fallback
// covers the case where the PID has been recycled onto something else.
const STALE_LOCK_MS = 20 * 60 * 1000;
const pidFile = path.join(lockPath, 'owner.pid');
const alive = (pid) => {
  if (!pid || !Number.isFinite(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
function takeLock() {
  fs.mkdirSync(lockPath);
  fs.writeFileSync(pidFile, String(process.pid));
}
try {
  takeLock();
} catch (err) {
  if (err.code !== 'EEXIST') throw err;
  let owner = NaN, ageMs = Infinity;
  try { owner = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10); } catch { /* no pid recorded */ }
  try { ageMs = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { /* vanished */ }

  if (alive(owner) && ageMs <= STALE_LOCK_MS) {
    console.error(
      `another test run (pid ${owner}) already owns the index, held for ${Math.round(ageMs / 1000)}s.\n`
      + 'Two concurrent runs DESTROY the real vault index — refusing to start.'
    );
    process.exit(2);
  }
  const why = alive(owner) ? `${Math.round(ageMs / 60000)} min old` : `owner pid ${owner || '?'} is gone`;
  console.error(`  (breaking abandoned index lock — ${why})`);
  try {
    fs.rmSync(lockPath, { recursive: true, force: true });
    takeLock();
  } catch {
    console.error(`could not break the lock — remove ${lockPath} by hand`);
    process.exit(2);
  }
}

const REAL_INDEX_MIN_NOTES = 10; // the fixture vault has 3; the real vault has ~69
function indexNoteCount(buf) {
  try {
    const j = JSON.parse(buf.toString('utf8'));
    const notes = Array.isArray(j) ? j : j.notes;
    return Array.isArray(notes) ? notes.length : -1;
  } catch { return -1; }
}

const hadIndex = fs.existsSync(indexPath);
let indexBackup = null;
if (hadIndex) {
  const buf = fs.readFileSync(indexPath);
  const n = indexNoteCount(buf);
  if (n >= REAL_INDEX_MIN_NOTES) {
    indexBackup = buf;
  } else {
    // Do NOT save this as the thing to restore — restoring it would overwrite a
    // rebuilt real index with a fixture, which is how the corruption persists
    // across runs rather than being a one-off.
    console.error(
      `\n  WARNING: brain/index.json holds only ${n < 0 ? 'unparseable data' : n + ' notes'} — that is a
  leftover FIXTURE, not the real vault index. A previous run did not restore it.
  This run will NOT back it up and will NOT restore it afterwards.
  Rebuild the real index when convenient:  node brain/index-vault.mjs\n`
    );
  }
}
// Each run indexes the fixture vault from scratch; a real index left in place
// would make the brain suite assert against the developer's own notes.
try { fs.unlinkSync(indexPath); } catch { /* none to remove */ }

const server = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(HERE, 'fixtures', 'vault'),
    // The brain suite exists to cover the DEGRADED path — keyword fallback with
    // no embeddings and no generation. It used to get that for free by assuming
    // Ollama was unreachable, which made it fail on any machine where Ollama was
    // actually running: four red assertions that said nothing about the code.
    // Point the server at a closed port so the offline path is a property of the
    // run, not of the developer's box. Same reasoning as the fixture vault above.
    // ALFRED_TEST_OLLAMA=1 opts back into the real daemon to exercise the online
    // path deliberately (the brain suite's offline assertions will then fail).
    ...(process.env.ALFRED_TEST_OLLAMA ? {} : { OLLAMA_URL: 'http://127.0.0.1:1' }),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let shutdownDone = false;
function shutdown() {
  if (shutdownDone) return;
  shutdownDone = true;
  try { server.kill(); } catch { /* already gone */ }
  // On Windows, kill() terminates the direct child only. If it spawned anything
  // (or ignored the signal) the listener survives, holds PORT, and the NEXT run's
  // server cannot bind — every suite then fails ECONNREFUSED, which reads as
  // "whatever you just changed broke everything" rather than "a corpse holds the
  // port". Reap the tree.
  if (process.platform === 'win32' && server.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'],
        { stdio: 'ignore', timeout: 5000 });
    } catch { /* already dead — the common case */ }
  }
  try { fs.unlinkSync(indexPath); } catch { /* fine */ }
  if (indexBackup) {
    fs.writeFileSync(indexPath, indexBackup);
  } else if (hadIndex) {
    // We refused to back up a fixture, so there is nothing to put back — but
    // leaving NO index is worse than leaving a stale one: the live server then
    // serves zero notes. Rebuild the real index rather than walking away from
    // a hole we dug.
    try {
      execFileSync(process.execPath, [path.join(HERE, '..', 'index-vault.mjs')], {
        cwd: path.join(HERE, '..'), stdio: 'ignore', timeout: 120000,
      });
      console.log('  (rebuilt brain/index.json — the pre-run file was a leftover fixture)');
    } catch {
      console.error('  WARNING: could not rebuild index.json. Run: node brain/index-vault.mjs');
    }
  }
  // Release last, and never leave the lock behind — a stale lock blocks every
  // future run, which is its own kind of outage.
  try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch { /* fine */ }
}
process.on('exit', shutdown);
// SIGTERM was missing, and it is the signal that actually arrives in practice:
// `timeout 300 node test/run.mjs` sends SIGTERM, Node's default handling
// terminates WITHOUT running the exit handler, and the server is orphaned. That
// orphan then poisons every subsequent run. SIGBREAK is Windows' Ctrl-Break.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => { shutdown(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

if (!(await waitForServer())) {
  // Distinguish "my server failed to boot" from "someone else already owns this
  // port". They produce identical ECONNREFUSED cascades downstream, and the
  // second one is not a code failure at all — it is a corpse from a previous
  // run. Saying which costs one probe and saves an afternoon.
  let squatter = '';
  try {
    const r = await fetch(`${BASE}/api/status`);
    if (r.ok) squatter = `\n\nSomething ELSE is already serving ${BASE} — almost certainly an orphaned\n`
      + `server from an earlier run that was killed before it could clean up.\n`
      + (process.platform === 'win32'
        ? `Find and kill it:  netstat -ano | findstr :${PORT}    then    taskkill /PID <pid> /T /F`
        : `Find and kill it:  lsof -ti:${PORT} | xargs kill -9`);
  } catch { /* nothing listening — a genuine boot failure */ }
  console.error('alfred did not start on ' + BASE + squatter + '\n' + serverLog);
  process.exit(1);
}

const browserOk = hasPlaywright();
let pass = 0, fail = 0, skipped = 0;
const failures = [];
const skippedSuites = [];

for (const suite of selected) {
  if (suite.browser && !browserOk) {
    // Say how to fix it. A bare "skipped" is easy to read past forever.
    console.log(`  SKIP  ${suite.name} (playwright not found — \`npm i -D playwright && npx playwright install chromium\`, or set PLAYWRIGHT_INDEX)`);
    skipped++;
    skippedSuites.push(suite.name);
    continue;
  }
  const { results, code, out, err } = await runSuite(suite);
  if (!results) {
    fail++;
    failures.push(`${suite.name}: suite crashed (exit ${code})\n${(err || out).slice(-800)}`);
    console.log(`  FAIL  ${suite.name} — crashed`);
    continue;
  }
  if (!results.length) {
    // `__ALFRED_RESULTS__[]` — a suite that ran zero assertions looks
    // identical to one that ran everything and passed unless we call it out.
    // A suite that proves nothing is a failure, not a silent "OK — 0/0".
    fail++;
    failures.push(`${suite.name}: reported 0/0 — suite executed zero tests, proves nothing`);
    console.log(`  FAIL  ${suite.name} — 0/0 (ran no tests)`);
    continue;
  }
  const bad = results.filter((r) => !r.ok);
  // A valid sentinel does not mean the suite is done: a nonzero exit code
  // after the sentinel was printed means something crashed on the way out
  // (uncaught exception, process.exit(n) after results) and must still fail
  // the suite — `code` was previously destructured and never checked.
  const crashedAfterResults = code !== 0;
  pass += results.length - bad.length;
  fail += bad.length + (crashedAfterResults ? 1 : 0);
  for (const r of bad) failures.push(`${suite.name}: ${r.n}\n      ${String(r.d).slice(0, 300)}`);
  if (crashedAfterResults) {
    failures.push(`${suite.name}: exited with code ${code} after emitting results — something failed after the sentinel was produced`);
  }
  const label = (bad.length || crashedAfterResults) ? 'FAIL' : ' OK ';
  console.log(`  ${label}  ${suite.name} — ${results.length - bad.length}/${results.length}${crashedAfterResults ? ` (exit ${code})` : ''}`);
}

// A skip is not a pass. By default any skip fails the whole run — the only
// way around that is the explicit, loud, human-visible opt-in below. Require
// the exact string '1' — `!!process.env.X` would treat ALFRED_ALLOW_SKIP=0
// (which a cautious human would reasonably expect to mean "off") as truthy,
// silently re-enabling the opt-out they thought they'd disabled.
const skipsAllowed = process.env.ALFRED_ALLOW_SKIP === '1';
if (skipped && skipsAllowed) {
  const bar = '!'.repeat(70);
  console.log(`\n${bar}`);
  console.log(`ALFRED_ALLOW_SKIP=1 is set — ${skipped} suite(s) skipped by EXPLICIT HUMAN OPT-IN:`);
  for (const n of skippedSuites) console.log(`  - ${n}`);
  console.log('This run does NOT exercise those suites. Do not read it as full coverage.');
  console.log(`${bar}\n`);
}
const skipFailure = skipped > 0 && !skipsAllowed;

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} suite(s) skipped${skipFailure ? ' — UNAPPROVED (set ALFRED_ALLOW_SKIP=1 to opt in), failing the run' : ''}` : ''}`);
if (failures.length) {
  console.log('\n--- failures ---');
  for (const f of failures) console.log('  ' + f);
}
process.exit((fail || skipFailure) ? 1 : 0);
