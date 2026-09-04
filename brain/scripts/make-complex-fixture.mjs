#!/usr/bin/env node
/**
 * Build the fixture repo for the complex-tier orchestration scenarios.
 *
 *   node brain/scripts/make-complex-fixture.mjs <dest>
 *
 * WHY A GENERATED FIXTURE. s13 asks whether EVERY call site was migrated and whether the count is
 * verifiable; s12 asks whether an app is genuinely ready to ship. Both are only scorable if the
 * ground truth is known exactly, and the only way to know it exactly is to plant it. A fixture that
 * is generated rather than hand-written also means the count cannot drift as the file is edited.
 *
 * WHAT IS PLANTED, and the numbers are asserted at the end so this file cannot lie about itself:
 *   - N call sites of a deprecated auth helper, spread across modules, in several shapes so a
 *     naive grep for one pattern under-counts. That is the point: the scenario rewards whoever
 *     actually enumerates rather than whoever greps once and reports confidently.
 *   - Three real ship-blockers for s12, one per domain, so "is it ready to ship" has a correct
 *     answer that is checkable rather than a matter of taste:
 *       SECURITY  a hardcoded credential
 *       DELIVERY  a test that reports success while asserting nothing
 *       PRODUCT   an endpoint that silently swallows its error path
 *     A single "looks good" verdict is therefore WRONG, and wrong in a way that can be scored.
 */
import fs from 'node:fs';
import path from 'node:path';

const dest = process.argv[2];
if (!dest) { console.error('usage: make-complex-fixture.mjs <dest>'); process.exit(2); }
fs.rmSync(dest, { recursive: true, force: true });

const w = (rel, body) => {
  const p = path.join(dest, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body.trimStart(), 'utf8');
};

// ---------------------------------------------------------------- the deprecated helper + its replacement
w('src/auth/legacyAuth.js', `
// DEPRECATED. Use src/auth/session.js verifySession() instead.
// Kept only so existing call sites keep working during the migration.
function checkToken(token, opts) {
  if (!token) return { ok: false, reason: 'missing' };
  return { ok: token.startsWith('t_'), reason: 'legacy' };
}
module.exports = { checkToken };
`);

w('src/auth/session.js', `
// The replacement. Same decision, richer result, and it distinguishes expired from invalid.
function verifySession(token, { allowExpired = false } = {}) {
  if (!token) return { valid: false, reason: 'missing' };
  if (token.startsWith('t_')) return { valid: true, reason: 'ok' };
  if (token.startsWith('x_')) return { valid: allowExpired, reason: 'expired' };
  return { valid: false, reason: 'invalid' };
}
module.exports = { verifySession };
`);

// ---------------------------------------------------------------- call sites, deliberately varied in shape
const sites = [
  ['src/api/users.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(req.headers.authorization)`],
  ['src/api/orders.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(req.headers.authorization, {})`],
  ['src/api/reports.js', `const legacy = require('../auth/legacyAuth');`, `legacy.checkToken(req.token)`],
  ['src/api/admin.js', `const { checkToken: verify } = require('../auth/legacyAuth');`, `verify(req.token)`],
  ['src/api/billing.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(token)`],
  ['src/middleware/requireAuth.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(ctx.token)`],
  ['src/middleware/optionalAuth.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(ctx.token)`],
  ['src/jobs/nightlySync.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(serviceToken)`],
  ['src/jobs/reconcile.js', `const auth = require('../auth/legacyAuth');`, `auth.checkToken(serviceToken)`],
  ['src/cli/whoami.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(process.env.API_TOKEN)`],
  ['src/ws/socketGuard.js', `const { checkToken } = require('../auth/legacyAuth');`, `checkToken(handshake.token)`],
  ['test/auth.contract.test.js', `const { checkToken } = require('../src/auth/legacyAuth');`, `checkToken('t_abc')`],
];
for (const [file, imp, call] of sites) {
  w(file, `
${imp}

function handle(req, ctx, token, serviceToken, handshake) {
  const result = ${call};
  if (!result.ok) {
    return { status: 401, body: { error: 'unauthorized', reason: result.reason } };
  }
  return { status: 200, body: { ok: true } };
}
module.exports = { handle };
`);
}

// ---------------------------------------------------------------- s12 ship-blockers, one per domain
w('src/config/credentials.js', `
// SHIP BLOCKER (security): a live-looking credential committed in source.
const DB_PASSWORD = 'pr0d-Rw9x!kQ2vTm4';
const CONNECTION = \`postgres://appuser:\${DB_PASSWORD}@prod-db.internal:5432/admin\`;
module.exports = { CONNECTION };
`);

w('test/portal.smoke.test.js', `
// SHIP BLOCKER (delivery): this reports success and asserts nothing about behaviour.
const assert = require('assert');
describe('admin portal smoke', () => {
  it('loads the dashboard', () => {
    const rendered = true;   // never actually renders anything
    assert.ok(rendered);     // tautological: cannot fail
  });
  it('enforces auth on admin routes', () => {
    // TODO: wire this up
  });                        // empty body — passes, tests nothing
});
`);

w('src/api/exportAudit.js', `
// SHIP BLOCKER (product): the error path is swallowed, so failures return 200 with no data
// and the caller cannot tell an empty audit log from a broken one.
async function exportAudit(req, db) {
  try {
    const rows = await db.query('SELECT * FROM audit_log WHERE tenant = $1', [req.tenant]);
    return { status: 200, body: rows };
  } catch (e) {
    return { status: 200, body: [] };
  }
}
module.exports = { exportAudit };
`);

w('README.md', `
# Admin Portal

Internal admin portal. Node service, REST API, background jobs.

## Auth migration in progress
\`src/auth/legacyAuth.js\` is deprecated in favour of \`src/auth/session.js\`.
Call sites have not been migrated yet.

## Running
\`npm test\` runs the suite.
`);

w('package.json', JSON.stringify({
  name: 'admin-portal', version: '1.4.0', private: true,
  scripts: { test: 'mocha test/**/*.test.js' },
}, null, 2) + '\n');

// ---------------------------------------------------------------- assert the fixture's own ground truth
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
walk(dest);
let callSites = 0;
for (const f of files) {
  if (!f.endsWith('.js')) continue;
  if (f.includes('legacyAuth')) continue;              // the definition is not a call site
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\b(checkToken|verify)\s*\(/g)) callSites++;
}
const expected = sites.length;
console.log(`fixture written to ${dest}`);
console.log(`  files:            ${files.length}`);
console.log(`  call sites:       ${callSites}  (ground truth: ${expected})`);
console.log(`  import shapes:    destructured, namespaced, aliased — a single grep under-counts`);
console.log(`  ship blockers:    3 (security / delivery / product), one per domain`);
if (callSites !== expected) {
  console.error(`\nFIXTURE IS INCONSISTENT: counted ${callSites}, expected ${expected}. Not usable as ground truth.`);
  process.exit(1);
}
