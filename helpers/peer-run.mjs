#!/usr/bin/env node
// DEPRECATED — superseded by provider-run.mjs, which reads providers.json and handles every
// provider (including Ollama and Codex) rather than just Gemini and Grok.
//
// Kept as a forwarding shim because peer-run.mjs shipped in commit 8a7f243; anything already
// calling it keeps working. Update callers to provider-run.mjs — this shim will be removed.

import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

console.error('warning: peer-run.mjs is deprecated — use provider-run.mjs (same arguments).');

const target = path.join(os.homedir(), '.claude', 'helpers', 'provider-run.mjs');
const run = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
