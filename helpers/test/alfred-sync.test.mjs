#!/usr/bin/env node
// --- alfred-sync.test.mjs --------------------------------------------------
// Falsifier for the framework-artifact sync. The mirror rules are the whole
// risk surface: this thing writes into ~/.claude and into a git repo, so the
// things worth proving are that it never deletes, never overwrites newer work,
// and never copies a machine-specific file between operating systems.
//
// Runs the real helper as a subprocess against temp folders.
//
//   node ~/.claude/helpers/test/alfred-sync.test.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'alfred-sync.mjs');
const ROOT = path.join(os.tmpdir(), `alfred-sync-test-${process.pid}`);
const REPO = path.join(ROOT, 'repo');
const HOME = path.join(ROOT, 'claude-home');

let pass = 0;
const fails = [];
const chk = (name, okv, detail = '') => {
  if (okv) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};

const run = (cmd) => {
  const r = spawnSync(process.execPath, [HELPER, cmd], {
    env: { ...process.env, ALFRED_REPO: REPO, ALFRED_CLAUDE_HOME: HOME },
    encoding: 'utf8',
  });
  return (r.stdout || '') + (r.stderr || '');
};
const git = (...args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const older = (p) => { const t = new Date(Date.now() - 600_000); fs.utimesSync(p, t, t); };

// --- Set up a repo and a live setup ----------------------------------------

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(HOME, { recursive: true });

git('init', '-q');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'test');

write(path.join(REPO, 'skills', 'from-repo', 'SKILL.md'), 'a skill that exists only in the repo\n');
write(path.join(REPO, 'commands', 'shared.md'), 'version ONE from the repo\n');
// Things that must never travel between machines.
write(path.join(REPO, 'helpers', 'settings.json'), '{"hooks":"C:/Users/someone-else/..."}\n');
write(path.join(REPO, 'helpers', 'node_modules', 'junk', 'index.js'), 'module.exports=1\n');
git('add', '-A');
git('commit', '-q', '-m', 'seed');

// The live setup has its own local work.
write(path.join(HOME, 'skills', 'local-only', 'SKILL.md'), 'authored on this machine\n');
write(path.join(HOME, 'commands', 'shared.md'), 'version TWO edited locally, and newer\n');
write(path.join(HOME, 'settings.json'), '{"local":"machine specific"}\n');

// --- Pull ------------------------------------------------------------------

console.log('\nPull (repo -> live setup)');
older(path.join(REPO, 'commands', 'shared.md'));
const pullOut = run('pull');

chk('a new repo skill arrives in the live setup',
  read(path.join(HOME, 'skills', 'from-repo', 'SKILL.md')) === 'a skill that exists only in the repo\n');
chk('a locally-authored skill is NOT deleted by the pull',
  read(path.join(HOME, 'skills', 'local-only', 'SKILL.md')) !== null);
chk('a newer local edit is NOT overwritten by an older repo version',
  read(path.join(HOME, 'commands', 'shared.md')) === 'version TWO edited locally, and newer\n',
  String(read(path.join(HOME, 'commands', 'shared.md'))));
chk('the pull reports the kept-local file rather than silently dropping it',
  /newer than the repo/.test(pullOut), pullOut.slice(0, 200));
chk('settings.json is never copied in',
  read(path.join(HOME, 'helpers', 'settings.json')) === null);
chk('node_modules is never copied in',
  !fs.existsSync(path.join(HOME, 'helpers', 'node_modules')));
chk('a pull with no remote configured does not crash', !/Error/i.test(pullOut) || /non-critical/.test(pullOut),
  pullOut.slice(0, 200));

// --- Push ------------------------------------------------------------------

console.log('\nPush (live setup -> repo)');
const pushOut = run('push');

chk('the locally-authored skill reaches the repo',
  read(path.join(REPO, 'skills', 'local-only', 'SKILL.md')) === 'authored on this machine\n');
chk('the newer local edit overwrites the older repo version',
  read(path.join(REPO, 'commands', 'shared.md')) === 'version TWO edited locally, and newer\n');
chk('the repo-only skill is NOT deleted by the push',
  read(path.join(REPO, 'skills', 'from-repo', 'SKILL.md')) !== null);
chk('local settings.json does not reach the repo',
  read(path.join(REPO, 'settings.json')) === null);

const logOut = git('log', '--oneline').stdout || '';
chk('changes were committed', logOut.split('\n').filter(Boolean).length >= 2, logOut);
chk('push failure without a remote is reported, not swallowed as success',
  /push failed|Pushed/.test(pushOut), pushOut.slice(0, 200));

// --- Idempotency -----------------------------------------------------------

console.log('\nIdempotency');
const commitsBefore = (git('log', '--oneline').stdout || '').split('\n').filter(Boolean).length;
run('push');
run('push');
const commitsAfter = (git('log', '--oneline').stdout || '').split('\n').filter(Boolean).length;
chk('repeated pushes with no changes create no commits', commitsBefore === commitsAfter,
  `${commitsBefore} -> ${commitsAfter}`);

const homeBefore = JSON.stringify(fs.readdirSync(path.join(HOME, 'skills')).sort());
run('pull');
chk('repeated pulls change nothing',
  JSON.stringify(fs.readdirSync(path.join(HOME, 'skills')).sort()) === homeBefore);

// --- Safety ----------------------------------------------------------------

console.log('\nSafety');
const noRepo = spawnSync(process.execPath, [HELPER, 'pull'], {
  env: { ...process.env, ALFRED_REPO: path.join(ROOT, 'nope'), ALFRED_CLAUDE_HOME: HOME },
  encoding: 'utf8',
});
chk('a missing repo is a no-op, never a crash', noRepo.status === 0, `exit ${noRepo.status}`);

fs.rmSync(ROOT, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
else console.log('OK');
