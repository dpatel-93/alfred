#!/usr/bin/env node
// --- github-mcp-headers.mjs ------------------------------------------------
// Emits the Authorization header for GitHub's MCP server, read live from the
// `gh` CLI at connection time.
//
// Why this exists. The plugin ships `"Authorization": "Bearer ${GITHUB_PERSONAL_
// ACCESS_TOKEN}"`, and with that variable unset the literal `${...}` is sent as
// the token — which is the "Authorization header is badly formatted" failure.
// Stripping the header instead does NOT fall back to OAuth: api.githubcopilot.com
// answers "does not support dynamic client registration", so a bearer token is
// the only route in. Measured, both ways, 2026-08-16.
//
// The obvious fix is to paste a PAT into an environment variable. This is the
// better one: the machine already holds a working GitHub login in the `gh`
// keyring, so asking `gh` each time means no second copy of a credential exists
// to leak, expire, or drift out of sync when the token rotates.
//
// Contract (see Claude Code's `headersHelper`): print a JSON object of headers
// on stdout, exit 0. Printing `{}` is the correct failure — Claude Code then
// reports the server as needing authentication, which is true and actionable.
// Anything noisier turns a missing login into a broken config.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';

// `gh` is a .cmd shim on Windows, and spawn without a shell will not find the
// bare name. Trying both candidates is cheaper and safer than shell:true, which
// this framework has already been bitten by once (it concatenates args unescaped).
const CANDIDATES = process.platform === 'win32' ? ['gh.cmd', 'gh.exe', 'gh'] : ['gh'];

function readToken() {
  for (const bin of CANDIDATES) {
    const r = spawnSync(bin, ['auth', 'token'], { encoding: 'utf8', windowsHide: true });
    if (r.error) continue;               // this candidate is not on PATH
    const token = (r.stdout || '').trim();
    if (r.status === 0 && token) return token;
  }
  return '';
}

const token = readToken();
process.stdout.write(token ? JSON.stringify({ Authorization: `Bearer ${token}` }) : '{}');
