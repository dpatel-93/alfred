#!/usr/bin/env node
// --- bg-run.mjs --------------------------------------------------------------
// Launches another node script fully detached and exits immediately, so a
// SessionStart hook that calls this returns in milliseconds instead of
// blocking the session on the real script's runtime (git pulls, file walks,
// OneDrive I/O). The real script keeps running in the background; its output
// goes to a log file under .claude/logs instead of the terminal, since no one
// is blocked waiting to read it.
//
// Usage: node bg-run.mjs <script.mjs|script.cjs> [args...]
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('Usage: bg-run.mjs <script> [args...]');
  process.exit(1);
}

const LOG_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'logs');
try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* best effort */ }

const logName = path.basename(script).replace(/\.(mjs|cjs|js)$/, '') + '.log';
const logPath = path.join(LOG_DIR, logName);
let out;
try { out = openSync(logPath, 'a'); } catch { out = 'ignore'; }

const child = spawn(process.execPath, [script, ...args], {
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: true,
});
child.unref();
process.exit(0);
