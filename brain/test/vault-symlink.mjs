// --- vault-symlink.mjs -----------------------------------------------------
// Falsifier for the macOS "path escapes vault directory" bug.
//
// handleNote resolved the requested note against the CONFIGURED vault root but
// checked containment against the REALPATH'd root. Those are the same string on
// Windows and different on macOS, where OneDrive lives behind a symlink
// (~/OneDrive -> ~/Library/CloudStorage/OneDrive-*). When they differ, the
// relative path starts with '..' and EVERY note 403s.
//
// Reproduced here by pointing the vault at a symlink/junction, which is exactly
// what the Mac does, and asserting a note inside it is still servable.
//
//   node brain/test/vault-symlink.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const PORT = 7911;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const chk = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -- ${detail}`}`);
};

// --- Build a real vault behind a real symlink ------------------------------

const stamp = `alfred-symlink-test-${process.pid}`;
const realVault = path.join(os.tmpdir(), `${stamp}-real`);
const linkVault = path.join(os.tmpdir(), `${stamp}-link`);

fs.mkdirSync(path.join(realVault, 'Patterns'), { recursive: true });
fs.writeFileSync(path.join(realVault, 'Patterns', 'Probe.md'),
  '# Probe\n\nThis note is only reachable if the containment check is consistent.\n', 'utf8');

// 'junction' is Windows-only and ignored elsewhere, so this is cross-platform.
try {
  fs.symlinkSync(realVault, linkVault, 'junction');
} catch (e) {
  console.log(`SKIP: cannot create a symlink here (${e.code}); this test needs one.`);
  process.exit(0);
}
chk('symlinked vault created', fs.existsSync(path.join(linkVault, 'Patterns', 'Probe.md')));
chk('the symlink genuinely differs from its target',
  fs.realpathSync(linkVault) !== linkVault, `real=${fs.realpathSync(linkVault)}`);

// --- Boot the server against the symlinked path ----------------------------

// ALFRED_INDEX is not optional here. Without it this server rebuilds the REAL
// brain/index.json against this throwaway vault and destroys the operator's
// index — which is precisely what happened the first time this test was run.
const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    ALFRED_VAULT: linkVault,
    ALFRED_INDEX: path.join(realVault, 'test-index.json'),
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

async function waitForServer(ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.status === 200) return true;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

let failed = false;
try {
  const up = await waitForServer();
  chk('server started against the symlinked vault', up, serverLog.slice(-300));

  if (up) {
    const html = await (await fetch(`${BASE}/`)).text();
    const token = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1] || '';
    const headers = token ? { 'X-Alfred-Token': token } : {};

    // The bug: this returned 403 "path escapes vault directory" for every note.
    const r = await fetch(`${BASE}/api/note?path=${encodeURIComponent('Patterns/Probe.md')}`, { headers });
    const body = await r.json().catch(() => ({}));
    chk('note inside a symlinked vault is served, not 403', r.status === 200,
      `got ${r.status} ${JSON.stringify(body).slice(0, 160)}`);
    chk('served content is the real note', String(body.markdown || '').includes('only reachable'),
      JSON.stringify(body).slice(0, 160));

    // The guard must still do its job.
    const esc = await fetch(`${BASE}/api/note?path=${encodeURIComponent('../outside.md')}`, { headers });
    chk('traversal outside the vault is still refused', esc.status === 403 || esc.status === 404,
      `got ${esc.status}`);
  }
} finally {
  // Tear the pipes down before killing, or libuv aborts on Windows and the
  // exit code becomes 127 regardless of whether the assertions passed.
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.kill();
  fs.rmSync(linkVault, { force: true, recursive: true });
  fs.rmSync(realVault, { force: true, recursive: true });
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
failed = bad.length > 0;
process.exitCode = failed ? 1 : 0;
