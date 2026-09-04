// Installer coverage. Until this suite existed, install.ps1/install.sh had NONE —
// the 400-odd tests all covered brain/, while the installer is the first thing a
// new user runs and the only component with real Windows/macOS parity.
//
// Runs the platform's own installer end to end into a throwaway profile OUTSIDE
// the real home (a target under the real profile would make "no source user in
// the output" vacuously true, since the account name is in the path). Then asserts
// the properties that actually matter: paths rewritten, nothing personal carried
// over, and a re-run that does not clobber the operator's own answers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const R = [];
const chk = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

// The account name baked into the exported settings. Read from the script rather
// than hardcoded, so this suite keeps working if the export machine ever changes.
const SOURCE_USER = (fs.readFileSync(path.join(REPO, 'install.sh'), 'utf8')
  .match(/^SOURCE_USER="([^"]+)"/m) || [])[1] || 'C:/Users/dishi';
const SOURCE_ACCOUNT = path.basename(SOURCE_USER);

// --- Static guards: both installers, on every platform -----------------------
// The rewrite base must come from the home-dir PARAMETER, not the environment.
// install.ps1 read $env:USERPROFILE while honouring -HomeDir for destinations, so
// an explicit target got every hook path rewritten to the wrong home while the
// script reported success.
const ps1 = fs.readFileSync(path.join(REPO, 'install.ps1'), 'utf8');
const sh = fs.readFileSync(path.join(REPO, 'install.sh'), 'utf8');
chk('install.ps1 derives its rewrite target from $HomeDir, not the environment',
  /\$targetUser\s*=\s*\$HomeDir/.test(ps1), (ps1.match(/\$targetUser\s*=.*/) || [''])[0]);
chk('install.sh derives its rewrite target from $HOME_DIR, not the environment',
  /"\$SOURCE_USER"\s+"\$HOME_DIR"|\$HOME_DIR\)/.test(sh), '');

// The template must not ship a persona as the DEFAULT operator name. It shipped
// "Address me as: Batman", so every fresh install told Claude to call the new
// user that — and the same line later leaked into a published screenshot.
const template = fs.readFileSync(path.join(REPO, 'claude-md', 'alfred-profile.template.md'), 'utf8');
// A bare word after the colon is a name; "(not specified — ...)" is a prompt.
chk('the profile template does not hardcode an operator name as the default',
  !/\*\*Address me as\*\*:\s*\w/.test(template),
  (template.match(/\*\*Address me as\*\*:.*/) || [''])[0].slice(0, 120));

// --- End-to-end install ------------------------------------------------------
// Deliberately outside the real profile: see the header note.
const isWin = process.platform === 'win32';
// os.tmpdir() is NOT outside the profile on Windows — it is
// C:\Users\<account>\AppData\Local\Temp, so installing there puts the account
// name in the target path and makes "no source account in the output" pass for
// the wrong reason on the export machine and fail for the wrong reason on any
// other. Pick the first candidate root that does not contain the source account.
function pickRoot() {
  const candidates = [os.tmpdir()];
  if (isWin) candidates.push(process.env.PUBLIC || 'C:\\Users\\Public');
  else candidates.push('/tmp');
  const clean = candidates.find((c) => !c.toLowerCase().includes(SOURCE_ACCOUNT.toLowerCase()));
  return path.join(clean || os.tmpdir(), `alfred-install-suite-${process.pid}`);
}

const ROOT = pickRoot();
const HOME_DIR = path.join(ROOT, 'home');
const CLAUDE_HOME = path.join(HOME_DIR, '.claude');

function runInstaller(homeDir, claudeHome) {
  if (isWin) {
    const exe = ['pwsh', 'powershell'].find((c) => {
      try { execFileSync(c, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore' }); return true; }
      catch { return false; }
    });
    if (!exe) throw new Error('neither pwsh nor powershell is available');
    return execFileSync(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(REPO, 'install.ps1'), '-ClaudeHome', claudeHome, '-HomeDir', homeDir],
      { encoding: 'utf8', timeout: 240000 });
  }
  return execFileSync('bash', [path.join(REPO, 'install.sh'),
    '--claude-home', claudeHome, '--home-dir', homeDir], { encoding: 'utf8', timeout: 240000 });
}

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

try {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(HOME_DIR, { recursive: true });

  // Seed a pre-2026-08-14 agents/ directory so the installer's legacy handling
  // is exercised rather than assumed. Roles stopped shipping as standing agent
  // definitions on that date and now live inside skills/orgagent, so a leftover
  // agents/ dir would quietly re-register 69 stale charters on every session.
  const legacyAgents = path.join(CLAUDE_HOME, 'agents');
  fs.mkdirSync(legacyAgents, { recursive: true });
  fs.writeFileSync(path.join(legacyAgents, 'stale-vp.md'), '---\nname: stale-vp\n---\n\nA charter from before the move.\n');

  let ranOk = true, runErr = '';
  try { runInstaller(HOME_DIR, CLAUDE_HOME); } catch (err) { ranOk = false; runErr = err.message; }
  chk('the installer runs to completion', ranOk, runErr.slice(0, 300));

  // 'agents' is deliberately absent from this list — see the legacy assertions
  // below. Asserting it populated was a stale expectation that failed on every
  // run after the move, which is worse than no coverage: a permanently red
  // check trains everyone to read the suite as "1 known failure" and stop
  // looking.
  for (const d of ['skills', 'commands', 'helpers']) {
    const n = walk(path.join(CLAUDE_HOME, d)).length;
    chk(`${d}/ is populated`, n > 0, `${n} files`);
  }

  // What replaced agents/: the role definitions ship inside the orgagent skill.
  const charterDir = path.join(CLAUDE_HOME, 'skills', 'orgagent', 'references', 'charters');
  const charterCount = walk(charterDir).filter((p) => p.toLowerCase().endsWith('.md')).length;
  chk('role charters install under skills/orgagent/references/charters/', charterCount > 0, `${charterCount} charters`);

  // And the legacy directory is parked, not left in place to be re-registered.
  chk('a pre-existing agents/ directory is moved out of the way',
    !fs.existsSync(legacyAgents), fs.existsSync(legacyAgents) ? 'agents/ still present after install' : '');
  const parked = walk(path.join(CLAUDE_HOME, 'backups')).filter((p) => p.endsWith('stale-vp.md'));
  chk('and its contents are preserved in backups/, never deleted', parked.length === 1,
    `${parked.length} copies found`);

  const settingsPath = path.join(CLAUDE_HOME, 'settings.json');
  let settings = null;
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* asserted below */ }
  chk('settings.json is written and is valid JSON', !!settings, '');

  // No trace of the export machine's account anywhere in the installed tree.
  const textExt = new Set(['.json', '.md', '.mjs', '.cjs', '.js', '.ps1', '.sh', '.cmd', '.txt', '.yml', '.yaml']);
  const leaks = walk(CLAUDE_HOME)
    .filter((p) => textExt.has(path.extname(p).toLowerCase()))
    .filter((p) => {
      try { return fs.readFileSync(p, 'utf8').includes(SOURCE_ACCOUNT); } catch { return false; }
    });
  chk(`no installed file carries the export machine's account name ("${SOURCE_ACCOUNT}")`,
    leaks.length === 0, leaks.slice(0, 3).map((p) => path.relative(CLAUDE_HOME, p)).join(', '));

  // Every hook and the statusline must point INSIDE the target profile.
  const commands = [];
  for (const matchers of Object.values(settings?.hooks || {})) {
    for (const m of matchers || []) for (const h of m.hooks || []) if (h.command) commands.push(h.command);
  }
  if (settings?.statusLine?.command) commands.push(settings.statusLine.command);
  const targetFwd = HOME_DIR.split(path.sep).join('/');
  chk('there are hook commands to check at all', commands.length > 0, `${commands.length}`);
  chk('every hook/statusline command points inside the target profile',
    commands.every((c) => c.includes(targetFwd)),
    (commands.find((c) => !c.includes(targetFwd)) || '').slice(0, 160));

  // The Windows-only `cmd /c` wrapper must not survive a POSIX install.
  if (!isWin) {
    chk('the POSIX installer strips the Windows `cmd /c` hook wrapper',
      !commands.some((c) => c.includes('cmd /c')),
      (commands.find((c) => c.includes('cmd /c')) || '').slice(0, 160));
  } else {
    chk('the Windows installer keeps the `cmd /c` hook wrapper it needs',
      commands.some((c) => c.includes('cmd /c')), '');
  }

  // --- Idempotency: a re-run must not clobber the operator's own answers ------
  const profilePath = path.join(CLAUDE_HOME, 'alfred-profile.md');
  const scaffolded = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8') : '';
  chk('a fresh install scaffolds a profile', scaffolded.length > 0, '');

  const MINE = '# MY OWN PROFILE — a re-run must not clobber this';
  fs.writeFileSync(profilePath, MINE);
  const settingsBefore = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';

  let rerunOk = true;
  try { runInstaller(HOME_DIR, CLAUDE_HOME); } catch (err) { rerunOk = false; runErr = err.message; }
  chk('the installer is re-runnable', rerunOk, runErr.slice(0, 200));
  chk('a re-run preserves an existing alfred-profile.md',
    fs.readFileSync(profilePath, 'utf8') === MINE, '');
  chk('a re-run does not overwrite an existing settings.json',
    fs.readFileSync(settingsPath, 'utf8') === settingsBefore, '');
  chk('a re-run writes settings.merged-proposal.json instead',
    fs.existsSync(path.join(CLAUDE_HOME, 'settings.merged-proposal.json')), '');
} catch (err) {
  chk('install suite ran without throwing', false, err.message);
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true });
}

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
