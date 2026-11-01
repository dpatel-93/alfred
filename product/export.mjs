#!/usr/bin/env node
// --- export.mjs -----------------------------------------------------------------
// Builds the shareable product from this repo: copies every tracked file the manifest marks
// `ship` or `generalise` into a clean folder (no git history), then scans the copy for the
// owner's personal details using the local redaction rules (~/.alfred/redact.json, which never
// leaves the machine) plus an optional ~/.alfred/scrub-markers.txt (one plain string per line).
// It fails while any personal detail or unclassified file remains, so nothing personal ships.
//   node product/export.mjs [--out <folder>] [--dry]
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --- Configuration ---
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(REPO, '..', 'alfred-product'));
const DRY = args.includes('--dry');
const REDACT = process.env.ALFRED_REDACT_RULES || path.join(os.homedir(), '.alfred', 'redact.json');
const MARKERS = process.env.ALFRED_SCRUB_MARKERS || path.join(os.homedir(), '.alfred', 'scrub-markers.txt');
const SHIPPED = new Set(['ship', 'generalise']);
const TEXT = /\.(md|mjs|cjs|js|json|jsonl|html|css|ps1|sh|cmd|vbs|txt|yml|yaml|toml|py|ts)$/i;

// --- Rules ---
function toRegex(rule) {
  const body = rule.split('/').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')).join('/');
  return new RegExp(`^${body}(/.*)?$`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'product', 'manifest.json'), 'utf8'));
const rules = manifest.rules.map((r) => ({ ...r, re: toRegex(r.path) }));
const classify = (file) => rules.find((r) => r.re.test(file));

function markers() {
  const found = [];
  if (fs.existsSync(REDACT)) {
    for (const r of JSON.parse(fs.readFileSync(REDACT, 'utf8')).replace || []) {
      try { found.push({ label: `redact rule ${found.length + 1}`, re: new RegExp(r.find, (r.flags || '').replace('g', '')) }); } catch { /* a rule this engine can't compile */ }
    }
  }
  if (fs.existsSync(MARKERS)) {
    for (const line of fs.readFileSync(MARKERS, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
      found.push({ label: `marker ${found.length + 1}`, re: new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    }
  }
  return found;
}

// --- Main Logic ---
const files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
const tally = {};
const unclassified = [];
const shipping = [];
for (const file of files) {
  const rule = classify(file);
  if (!rule) { unclassified.push(file); continue; }
  tally[rule.keep] = (tally[rule.keep] || 0) + 1;
  if (SHIPPED.has(rule.keep)) shipping.push({ file, rule });
}

const checks = markers();
const hits = [];
for (const { file, rule } of shipping) {
  if (!TEXT.test(file)) continue;
  const text = fs.readFileSync(path.join(REPO, file), 'utf8');
  for (const m of checks) {
    if (m.re.test(text)) hits.push({ file, keep: rule.keep, marker: m.label });
  }
}

if (!DRY) {
  if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) {
    console.error(`\x1b[31m${OUT} is not empty; pick an empty folder with --out\x1b[0m`);
    process.exit(2);
  }
  for (const { file } of shipping) {
    fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), path.join(OUT, file));
  }
}

console.log(`${files.length} tracked files: ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`${DRY ? 'would copy' : 'copied'} ${shipping.length} to ${OUT}`);
if (!checks.length) console.log('\x1b[33mno scrub rules found (~/.alfred/redact.json or scrub-markers.txt): personal details were NOT checked\x1b[0m');
if (unclassified.length) {
  console.log(`\x1b[31m${unclassified.length} file(s) match no rule (left out):\x1b[0m`);
  for (const f of unclassified.slice(0, 40)) console.log(`  ${f}`);
}
const byFile = new Map();
for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) || []), h.marker]);
if (byFile.size) {
  console.log(`\x1b[31m${byFile.size} shipped file(s) still hold personal details:\x1b[0m`);
  for (const [f, ms] of byFile) console.log(`  ${f}  (${ms.join(', ')})`);
}
const clean = !unclassified.length && !byFile.size && checks.length;
console.log(clean ? '\x1b[32mclean: nothing personal in the product\x1b[0m' : '\x1b[33mnot clean yet\x1b[0m');
process.exitCode = clean ? 0 : 1;
