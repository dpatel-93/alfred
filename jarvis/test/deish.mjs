#!/usr/bin/env node
// Deish test suite — proves three bugs in server.mjs
//
// D1: loadIndex() never re-reads index.json after first load
// D2: handleReindex clears indexCache/graphCache but not deishCache
// D3: computeDeishPayload() early-returns before computing businessNotes
//
// Each scenario spawns its own throwaway server, runs assertions, and kills it.
// Backup/restore index.json and token file once at the top level to avoid
// collision with any live server on 7777.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JARVIS_DIR = path.resolve(HERE, '..');
const INDEX_PATH = path.join(JARVIS_DIR, 'index.json');
const TOKEN_FILE = path.join(os.homedir(), '.claude', 'alfred-session.token');

const R = [];
const ACTIVE_PROCS = [];
const ACTIVE_TEMPS = [];

// --- Helpers ---
function chk(name, cond, detail = '') { R.push({ n: name, ok: !!cond, d: String(detail) }); }

function writeIndex(notes) {
  const index = {
    generatedAt: new Date().toISOString(),
    notes: notes || [],
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
}

function makeNote(overrides = {}) {
  return {
    path: overrides.path || 'Test/TestNote.md',
    title: overrides.title || 'TestNote',
    folder: overrides.folder || 'Test',
    mtime: overrides.mtime || Date.now(),
    excerpt: overrides.excerpt || 'Test excerpt',
    links: overrides.links || [],
    vector: overrides.vector !== undefined ? overrides.vector : null,
    keywords: overrides.keywords || [],
  };
}

function backupFile(p) {
  if (!fs.existsSync(p)) return undefined;
  return fs.readFileSync(p);
}

function restoreFile(p, backup) {
  if (backup === undefined) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  } else {
    fs.writeFileSync(p, backup);
  }
}

function spawnServer(port, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      ALFRED_VAULT: path.join(HERE, 'fixtures', 'vault'),
      ALFRED_TTS_MODE: 'off',
      OLLAMA_URL: 'http://127.0.0.1:1',
      ...envOverrides,
    };
    const proc = spawn(process.execPath, [path.join(JARVIS_DIR, 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    ACTIVE_PROCS.push(proc);

    let started = false;
    const deadline = Date.now() + 30000;
    const poll = setInterval(async () => {
      if (started || Date.now() > deadline) {
        clearInterval(poll);
        if (!started) {
          killServer(proc);
          reject(new Error(`Server on port ${port} failed to start`));
        }
        return;
      }
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/status`);
        if (r.ok) {
          clearInterval(poll);
          started = true;
          resolve({ proc, port, base: `http://127.0.0.1:${port}` });
        }
      } catch { /* not up yet */ }
    }, 300);
  });
}

function killServer(proc) {
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
  try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  const idx = ACTIVE_PROCS.indexOf(proc);
  if (idx >= 0) ACTIVE_PROCS.splice(idx, 1);
}

async function getToken(base) {
  const html = await (await fetch(base + '/')).text();
  const m = html.match(/var ALFRED_TOKEN = '([^']+)'/);
  return m ? m[1] : null;
}

async function j(base, path, opts) {
  const r = await fetch(base + path, opts);
  let d = null;
  try { d = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, d };
}

// --- Scenarios ---

async function scenarioD1() {
  console.log('\n--- Scenario D1: loadIndex() never re-reads index.json ---');
  const port = 7815;
  let server = null;
  const testVaultDir = path.join(HERE, 'fixtures', 'vault-d1');
  const testNoteDir = path.join(testVaultDir, 'TestNotes');
  try {
    // Create test vault directory
    if (fs.existsSync(testVaultDir)) fs.rmSync(testVaultDir, { recursive: true });
    fs.mkdirSync(testNoteDir, { recursive: true });

    // Write two test notes to the vault
    fs.writeFileSync(path.join(testNoteDir, 'NoteA.md'), '# NoteA\nContent A');
    fs.writeFileSync(path.join(testNoteDir, 'NoteB.md'), '# NoteB\nContent B');

    // Build initial index with both notes
    writeIndex([
      makeNote({ path: 'TestNotes/NoteA.md', title: 'NoteA', folder: 'TestNotes' }),
      makeNote({ path: 'TestNotes/NoteB.md', title: 'NoteB', folder: 'TestNotes' }),
    ]);

    server = await spawnServer(port, {
      ALFRED_VAULT: testVaultDir,
    });
    const base = server.base;

    // Get initial status
    let r1 = await j(base, '/api/status');
    const count1 = r1.d?.notes || 0;
    chk('D1: initial /api/status returns 2 notes', r1.s === 200 && count1 === 2, `count=${count1}`);

    // Replace index.json with only 1 note (without server restart or vault change)
    writeIndex([
      makeNote({ path: 'TestNotes/NoteA.md', title: 'NoteA', folder: 'TestNotes' }),
    ]);

    // Small delay to ensure disk write is visible
    await new Promise(r => setTimeout(r, 100));

    // Query status again - should now see 1 after the index.json change (if the bug is fixed)
    let r2 = await j(base, '/api/status');
    const count2 = r2.d?.notes || 0;

    // D1 BUG: count2 will equal 2 (cached), but it SHOULD be 1 (fresh read from index.json)
    // When fixed, loadIndex() will re-read from disk instead of returning the cached value
    chk('D1: after index.json change, /api/status reflects new count from disk',
        r2.s === 200 && count2 === 1,
        `count1=${count1}, count2=${count2} (expected count2=1 after file change, got ${count2} - cache bug if still 2)`);
  } catch (err) {
    chk('D1: scenario crashed', false, err.message);
  } finally {
    if (server) killServer(server.proc);
    try { fs.rmSync(testVaultDir, { recursive: true }); } catch { /* ok */ }
  }
}

async function scenarioD2() {
  console.log('\n--- Scenario D2: handleReindex clears indexCache but not deishCache ---');
  const port = 7816;
  let server = null;
  try {
    // Create temp dir with Plugins subfolder (so DEISH.repoPath exists)
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-d2-'));
    ACTIVE_TEMPS.push(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'Plugins'), { recursive: true });

    // Write index with a note
    writeIndex([makeNote({ path: 'Test/NoteA.md', title: 'NoteA' })]);

    server = await spawnServer(port, {
      ALFRED_PROJECT_ROOTS: tmpRoot,
    });
    const base = server.base;
    const token = await getToken(base);

    // First /api/deish call — should compute and cache
    let d1 = await j(base, '/api/deish');
    const computedAt1 = d1.d?.computedAt;
    chk('D2: first /api/deish call succeeds', d1.s === 200 && !!computedAt1,
        `available=${d1.d?.available}, computedAt=${computedAt1}`);

    // Record timing to ensure elapsed time is well under cache TTL
    const t1 = Date.now();

    // POST /api/reindex
    const reindexRes = await fetch(base + '/api/reindex', {
      method: 'POST',
      headers: { 'X-Alfred-Token': token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    chk('D2: POST /api/reindex returns 202', reindexRes.status === 202, `status=${reindexRes.status}`);

    // Poll terminal output until reindex completes
    let reindexDone = false;
    let reindexFailed = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(r => setTimeout(r, 150));
      const termRes = await j(base, '/api/terminal/output?after=0', {
        headers: { 'X-Alfred-Token': token },
      });
      if (termRes.s === 200 && termRes.d?.lines) {
        const lastLines = termRes.d.lines.map((l) => l.text || '').join('\n');
        if (lastLines.includes('reindex complete.')) {
          reindexDone = true;
          break;
        }
        if (lastLines.includes('reindex failed')) {
          reindexFailed = true;
          reindexDone = true;
          break;
        }
      }
    }
    chk('D2: reindex completes', reindexDone, reindexFailed ? 'reindex failed' : 'timed out waiting for completion');

    // Second /api/deish call — should recompute if cache was cleared
    let d2 = await j(base, '/api/deish');
    const computedAt2 = d2.d?.computedAt;
    const t2 = Date.now();
    const elapsedMs = t2 - t1;

    chk('D2: second /api/deish call succeeds', d2.s === 200 && !!computedAt2,
        `available=${d2.d?.available}, computedAt=${computedAt2}`);

    // D2 BUG: computedAt2 will equal computedAt1 because deishCache wasn't cleared
    const timestampsAreDifferent = computedAt1 !== computedAt2;
    chk('D2: cache invalidation — computedAt timestamps differ after reindex', timestampsAreDifferent,
        `t1=${computedAt1}, t2=${computedAt2}, elapsed=${elapsedMs}ms (should differ, elapsed < 60s)`);

    chk('D2: elapsed time well under cache TTL', elapsedMs < 40000, `${elapsedMs}ms < 60000ms`);
  } catch (err) {
    chk('D2: scenario crashed', false, err.message);
  } finally {
    if (server) killServer(server.proc);
    for (const tmpDir of ACTIVE_TEMPS) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
    }
    ACTIVE_TEMPS.length = 0;
  }
}

async function scenarioD3() {
  console.log('\n--- Scenario D3: computeDeishPayload() early-returns without businessNotes ---');
  const port = 7817;
  let server = null;
  try {
    // Create fixture vault with Business notes
    const fixtureVaultDir = path.join(HERE, 'fixtures', 'vault-business');
    if (!fs.existsSync(fixtureVaultDir)) {
      fs.mkdirSync(fixtureVaultDir, { recursive: true });
    }
    const businessDir = path.join(fixtureVaultDir, 'Business');
    if (!fs.existsSync(businessDir)) {
      fs.mkdirSync(businessDir, { recursive: true });
    }
    fs.writeFileSync(path.join(businessDir, 'CompanyStrategy.md'), '# Company Strategy\nSome content here.');

    // Create temp dir WITHOUT Plugins subfolder (so DEISH.repoPath doesn't exist)
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-d3-'));
    ACTIVE_TEMPS.push(tmpRoot);
    // Intentionally do NOT create Plugins subdirectory

    // Index the fixture vault (with Business notes)
    // We need to write an index that includes a Business note
    writeIndex([
      makeNote({
        path: 'Business/CompanyStrategy.md',
        title: 'CompanyStrategy',
        folder: 'Business'
      }),
      makeNote({
        path: 'Test/SomeNote.md',
        title: 'SomeNote',
        folder: 'Test'
      }),
    ]);

    server = await spawnServer(port, {
      ALFRED_VAULT: fixtureVaultDir,
      ALFRED_PROJECT_ROOTS: tmpRoot,
    });
    const base = server.base;

    // Call /api/deish
    let deishRes = await j(base, '/api/deish');

    chk('D3: /api/deish returns response', deishRes.s === 200, `status=${deishRes.s}`);
    chk('D3: /api/deish returns available:false (repo path missing)',
        deishRes.d?.available === false,
        `available=${deishRes.d?.available}`);

    // D3 BUG: businessNotes will be undefined/missing (key doesn't exist in response) when repo path missing
    // When FIXED: even though available:false, businessNotes should be present and contain filtered notes
    const hasBusinessNotesKey = 'businessNotes' in (deishRes.d || {});
    const businessNotes = deishRes.d?.businessNotes;

    chk('D3: response includes businessNotes key even when available:false', hasBusinessNotesKey,
        `key present=${hasBusinessNotesKey} (bug if false - should always compute businessNotes)`);

    chk('D3: businessNotes is an array', Array.isArray(businessNotes),
        `type=${typeof businessNotes}, isArray=${Array.isArray(businessNotes)}`);

    chk('D3: businessNotes contains Business folder notes', Array.isArray(businessNotes) && businessNotes.length > 0,
        `length=${businessNotes?.length || 'N/A'}, notes=${businessNotes?.map(n => n.title).join(', ') || 'none'}`);
  } catch (err) {
    chk('D3: scenario crashed', false, err.message);
  } finally {
    if (server) killServer(server.proc);
    for (const tmpDir of ACTIVE_TEMPS) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
    }
    ACTIVE_TEMPS.length = 0;
  }
}

// --- Main ---
const indexBackup = backupFile(INDEX_PATH);
const tokenBackup = backupFile(TOKEN_FILE);

function cleanup() {
  try {
    for (const proc of ACTIVE_PROCS) killServer(proc);
    for (const tmpDir of ACTIVE_TEMPS) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
    }
  } catch { /* ok */ }
  restoreFile(INDEX_PATH, indexBackup);
  restoreFile(TOKEN_FILE, tokenBackup);
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

try {
  await scenarioD1();
  await scenarioD2();
  await scenarioD3();
} catch (err) {
  console.error('Unhandled exception:', err);
  chk('Suite crashed', false, err.message);
} finally {
  cleanup();
}

// --- Results ---
for (const r of R) {
  console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
}
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
