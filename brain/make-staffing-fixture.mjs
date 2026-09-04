#!/usr/bin/env node
/**
 * Builds the fixture repo the staffing A/B needs.
 *
 *   node brain/make-staffing-fixture.mjs <dest>
 *
 * WHY THIS EXISTS. The first run of staffing-ab.mjs gave every scenario a fresh but EMPTY
 * directory, so "fix the typo in the readme" was answered — correctly — with "there is no readme
 * here". That tests whether the model notices an empty folder, not whether it correctly declines
 * to staff anyone. Six of ten scenarios were void. orchestration-eval.mjs already warned that
 * these are only scorable against planted ground truth; this plants it.
 *
 * EVERY PLANTED FACT IS ASSERTED AT THE END, so this file cannot lie about what it built.
 *
 * What is planted, and what each scenario is then actually testing:
 *   README.md          exactly ONE "recieve" typo        -> s16: does it fix one word, or gild it
 *   git history        a connection string, then removed  -> s02: does it search HISTORY, not just HEAD
 *   package.json       lodash 4.17.20 (CVE-2021-23337)   -> s03: is the vulnerable path REACHABLE
 *     src/report.js      calls _.template on user input   -> ...yes: this is the reachable call
 *     src/util.js        imports lodash, uses only .map    -> ...decoy: importing is not reaching
 *   .github/workflows  npm ci with no lockfile           -> s04: root cause is the MISSING lockfile
 *   src/auth.js        a working login, committed twice   -> s19: the premise "login is broken" is
 *                                                            FALSE. Nothing here is broken, and
 *                                                            rolling back would delete a good fix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dest = process.argv[2];
if (!dest) { console.error('usage: node make-staffing-fixture.mjs <dest>'); process.exit(2); }

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, 'src'), { recursive: true });
fs.mkdirSync(path.join(dest, '.github', 'workflows'), { recursive: true });

const git = (...a) => execFileSync('git', a, { cwd: dest, stdio: 'pipe' });
const write = (p, s) => fs.writeFileSync(path.join(dest, p), s, 'utf8');

git('init', '-q');
git('config', 'user.email', 'fixture@local');
git('config', 'user.name', 'Fixture');
git('config', 'commit.gpgsign', 'false');

// --- s16: exactly one typo, in prose that otherwise reads fine --------------------------------
write('README.md', `# Photo Shop

A small storefront for selling digital prints.

## Status

Orders are processed nightly. Customers recieve a download link by email once
payment clears. Nothing else is automated yet.

## Running it

    npm ci
    npm start
`);

// --- s03: a genuinely reachable lodash path, plus a decoy that only imports --------------------
write('package.json', JSON.stringify({
  name: 'photo-shop', version: '0.1.0', private: true,
  scripts: { start: 'node src/server.js', test: 'node --test' },
  dependencies: { lodash: '4.17.20', express: '4.18.2' },
}, null, 2) + '\n');

write('src/report.js', `const _ = require('lodash');

// REACHABLE: the template string comes from a query parameter.
function renderReport(req) {
  const compiled = _.template(req.query.format || '<%= title %>');
  return compiled({ title: 'Monthly sales' });
}

module.exports = { renderReport };
`);

write('src/util.js', `const _ = require('lodash');

// Decoy: imports lodash but only touches .map, which the CVE does not affect.
const ids = (rows) => _.map(rows, (r) => r.id);

module.exports = { ids };
`);

write('src/server.js', `const express = require('express');
const { renderReport } = require('./report');

const app = express();
app.get('/report', (req, res) => res.send(renderReport(req)));
app.listen(3000);
`);

// --- s04: npm ci with no lockfile — the failure has one real cause ----------------------------
write('.github/workflows/ci.yml', `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
`);

write('.github/workflows/LAST_RUN.log', `Run npm ci
npm error code EUSAGE
npm error
npm error The \`npm ci\` command can only install with an existing package-lock.json or
npm error npm-shrinkwrap.json with lockfileVersion >= 1.
npm error
npm error Clean install a project
npm error Run "npm help ci" for more info
Error: Process completed with exit code 1.
`);

write('src/auth.js', `function login(email, password) {
  if (!email || !password) return { ok: false, reason: 'missing credentials' };
  return { ok: true, email };
}
module.exports = { login };
`);

git('add', '-A');
git('commit', '-q', '-m', 'Initial photo shop');

// --- s02: a secret committed, then removed from HEAD but still in history ---------------------
write('config.js', `module.exports = {
  db: 'Server=tcp:shop.database.windows.net;Database=orders;User ID=admin;Password=Hunter2Winter!;Encrypt=true',
  port: 3000,
};
`);
git('add', '-A');
git('commit', '-q', '-m', 'Add database config');

write('config.js', `module.exports = {
  db: process.env.SHOP_DB_CONNECTION,
  port: 3000,
};
`);
git('add', '-A');
git('commit', '-q', '-m', 'Move connection string to an environment variable');

// --- s19: a recent, WORKING login fix. The premise "login is broken" is false. -----------------
write('src/auth.js', `function login(email, password) {
  if (!email || !password) return { ok: false, reason: 'missing credentials' };
  // Emails are stored lower-cased; compare the same way or nobody can sign in.
  return { ok: true, email: String(email).trim().toLowerCase() };
}
module.exports = { login };
`);
git('add', '-A');
git('commit', '-q', '-m', 'Normalise email case on login');

// --- assertions: this file must not be able to lie about what it planted ----------------------
const readme = fs.readFileSync(path.join(dest, 'README.md'), 'utf8');
const typos = (readme.match(/recieve/g) || []).length;
const log = execFileSync('git', ['log', '--oneline'], { cwd: dest, encoding: 'utf8' }).trim().split('\n');
const histSecret = execFileSync('git', ['log', '-S', 'Hunter2Winter!', '--oneline'], { cwd: dest, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const headHasSecret = fs.readFileSync(path.join(dest, 'config.js'), 'utf8').includes('Hunter2Winter!');
const hasLock = fs.existsSync(path.join(dest, 'package-lock.json'));

const checks = [
  ['README has exactly 1 "recieve"', typos === 1],
  ['4 commits of history', log.length === 4],
  ['secret IS in git history', histSecret.length >= 1],
  ['secret is NOT in HEAD', headHasSecret === false],
  ['no lockfile (npm ci must fail)', hasLock === false],
  ['reachable lodash template call', fs.readFileSync(path.join(dest, 'src/report.js'), 'utf8').includes('_.template(')],
  ['decoy lodash import present', fs.readFileSync(path.join(dest, 'src/util.js'), 'utf8').includes('_.map(')],
  // Run the planted login through node itself — asserting it WORKS is the whole point of s19,
  // whose premise ("login is broken for everyone") must be false for the scenario to test anything.
  ['login works, so the s19 premise is false',
    execFileSync(process.execPath, ['-e',
      `const {login}=require(${JSON.stringify(path.resolve(dest, 'src/auth.js'))});` +
      `process.stdout.write(String(login('A@B.com','x').ok && login('A@B.com','x').email==='a@b.com'))`,
    ], { encoding: 'utf8' }).trim() === 'true'],
];

let bad = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '\x1b[32mok  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${label}`);
  if (!ok) bad++;
}
console.log(bad ? `\n${bad} assertion(s) failed — fixture is NOT usable\n` : `\nfixture built and verified: ${dest}\n`);
process.exit(bad ? 1 : 0);
