#!/usr/bin/env node
// --- vault-memory-sync.test.mjs --------------------------------------------
// Proves memories actually round-trip between two machines through the vault.
//
// Simulates a Windows box and a Mac whose folder names for the SAME project are
// completely different, which is the thing that makes this hard:
//   Windows  C--Users-alice-OneDrive-Desktop--Projects-Demo
//   macOS    -Users-bob-Library-CloudStorage-OneDrive-Personal-Desktop--Projects-Demo
//
// Runs the real hook as a subprocess against throwaway folders - no mocking, and
// the operator's real memories are never touched.
//
//   node ~/.claude/helpers/test/vault-memory-sync.test.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vault-memory-sync.cjs');
const ROOT = path.join(os.tmpdir(), `vms-test-${process.pid}`);
const VAULT = path.join(ROOT, 'vault');
const WIN = path.join(ROOT, 'win-projects');
const MAC = path.join(ROOT, 'mac-projects');
const WIN_SLUG = 'C--Users-alice-OneDrive-Desktop--Projects-Demo';
const MAC_SLUG = '-Users-bob-Library-CloudStorage-OneDrive-Personal-Desktop--Projects-Demo';

const winMem = path.join(WIN, WIN_SLUG, 'memory');
const macMem = path.join(MAC, MAC_SLUG, 'memory');

let pass = 0;
const fails = [];
function chk(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
}

function run(base, cmd) {
  const r = spawnSync(process.execPath, [HOOK, cmd], {
    env: { ...process.env, ALFRED_VAULT: VAULT, ALFRED_MEMORY_BASE: base },
    encoding: 'utf8',
  });
  return (r.stdout || '') + (r.stderr || '');
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

// --- Set up two machines ---------------------------------------------------

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(winMem, { recursive: true });
fs.mkdirSync(macMem, { recursive: true });
fs.mkdirSync(VAULT, { recursive: true });

const memA = `---
name: windows-only-fact
description: A fact learned on the Windows machine
metadata:
  type: user
---

Batman prefers executive summaries. Links to [[other-note]].
`;

fs.writeFileSync(path.join(winMem, 'windows-only-fact.md'), memA, 'utf8');
fs.writeFileSync(path.join(winMem, 'MEMORY.md'), `# Memory

## User
- [windows-only-fact](windows-only-fact.md) — prefers executive summaries
`, 'utf8');

// The Mac has its own separate memory and its own index.
fs.writeFileSync(path.join(macMem, 'mac-only-fact.md'), `---
name: mac-only-fact
description: A fact learned on the Mac
metadata:
  type: project
---

The Mac runs the brain on port 7777.
`, 'utf8');
fs.writeFileSync(path.join(macMem, 'MEMORY.md'), `# Memory

## Project-Specific Notes
- [mac-only-fact](mac-only-fact.md) — brain runs on 7777
`, 'utf8');

// --- Windows pushes, Mac pulls ---------------------------------------------

console.log('\nWindows -> vault -> Mac');
run(WIN, 'sync');

const vaultCopy = path.join(VAULT, 'Claude-Code', 'Memory', 'Demo', 'windows-only-fact.md');
chk('windows memory reached the vault under the shared project name', fs.existsSync(vaultCopy),
  fs.existsSync(path.join(VAULT, 'Claude-Code', 'Memory'))
    ? fs.readdirSync(path.join(VAULT, 'Claude-Code', 'Memory')).join(',') : 'no Memory dir');
chk('vault copy is byte-identical (round-trippable, not reformatted)', read(vaultCopy) === memA,
  JSON.stringify(read(vaultCopy).slice(0, 120)));

run(MAC, 'pull');

const macCopy = path.join(macMem, 'windows-only-fact.md');
chk('mac received it despite a totally different folder name', fs.existsSync(macCopy));
chk('what landed on the mac is the original file', read(macCopy) === memA,
  JSON.stringify(read(macCopy).slice(0, 120)));
chk('frontmatter the memory system reads survived', /^name: windows-only-fact$/m.test(read(macCopy)) &&
  /type: user/.test(read(macCopy)));

// --- The index must merge, never overwrite ---------------------------------

console.log('\nIndex merging');
const macIndex = read(path.join(macMem, 'MEMORY.md'));
chk("mac index kept its own entry", macIndex.includes('mac-only-fact'), macIndex);
chk("mac index gained the windows entry", macIndex.includes('windows-only-fact'), macIndex);
chk('both headings present', macIndex.includes('## User') && macIndex.includes('## Project-Specific Notes'), macIndex);

run(MAC, 'sync');
run(WIN, 'pull');
const winIndex = read(path.join(winMem, 'MEMORY.md'));
chk('windows index gained the mac entry on the way back', winIndex.includes('mac-only-fact'), winIndex);
chk('windows index kept its own entry', winIndex.includes('windows-only-fact'), winIndex);
chk('mac memory reached windows', fs.existsSync(path.join(winMem, 'mac-only-fact.md')));

// --- Nothing is destroyed on a genuine conflict ----------------------------

console.log('\nConflicts and idempotency');
fs.writeFileSync(path.join(winMem, 'windows-only-fact.md'), memA.replace('executive summaries', 'EDITED ON WINDOWS'), 'utf8');
run(WIN, 'sync');
// Make the vault copy newer than the mac's, with different content.
const macBefore = read(macCopy);
run(MAC, 'pull');
const macAfter = read(macCopy);
chk('mac picked up the newer edit', macAfter.includes('EDITED ON WINDOWS'), macAfter.slice(0, 100));
chk('the overwritten version was preserved, not discarded',
  macAfter === macBefore || fs.readdirSync(macMem).some((f) => f.includes('.conflict-')),
  fs.readdirSync(macMem).join(','));

const before = fs.readdirSync(macMem).sort().join(',');
run(MAC, 'pull');
run(MAC, 'pull');
chk('repeated pulls change nothing (no conflict-file spam)',
  fs.readdirSync(macMem).sort().join(',') === before, fs.readdirSync(macMem).sort().join(','));

// --- Legacy vault notes must never come back down --------------------------
// The real vault already holds 37 folders written in the old rewritten format.
// Pulling one over a real memory would strip `name:` and `metadata.type`.

console.log('\nLegacy vault notes');
const legacyDir = path.join(VAULT, 'Claude-Code', 'Memory', 'Demo');
const goodLocal = read(path.join(macMem, 'mac-only-fact.md'));
fs.writeFileSync(path.join(legacyDir, 'mac-only-fact.md'), `---
source: claude-code
type: project
project: Demo
synced: 2026-01-01 00:00:00
---

The Mac runs the brain on port 7777.

---
*Synced from Claude Code on 2026-01-01*
*Source: \`somewhere\`*
`, 'utf8');
// Make it unambiguously newer than the local file, so only the format check saves it.
const future = new Date(Date.now() + 60_000);
fs.utimesSync(path.join(legacyDir, 'mac-only-fact.md'), future, future);

run(MAC, 'pull');
chk('a legacy vault note is NOT pulled over a real memory',
  read(path.join(macMem, 'mac-only-fact.md')) === goodLocal,
  read(path.join(macMem, 'mac-only-fact.md')).slice(0, 80));

run(MAC, 'sync');
chk('pushing replaces the legacy vault copy with the verbatim memory',
  read(path.join(legacyDir, 'mac-only-fact.md')) === goodLocal,
  read(path.join(legacyDir, 'mac-only-fact.md')).slice(0, 80));

// --- Safety ----------------------------------------------------------------

console.log('\nSafety');
const noVault = spawnSync(process.execPath, [HOOK, 'both'], {
  env: { ...process.env, ALFRED_VAULT: path.join(ROOT, 'does-not-exist'), ALFRED_MEMORY_BASE: WIN },
  encoding: 'utf8',
});
chk('a missing vault is a no-op, never a crash', noVault.status === 0, `exit ${noVault.status}`);

fs.rmSync(ROOT, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
else console.log('OK');
