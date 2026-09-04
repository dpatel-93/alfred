// Falsifier for edge provenance in buildGraph().
//
// The bug this guards against: the vault contains six notes titled "README".
// The old lookup table was `new Map(notes.map(n => [noteKey(n.title), n]))`,
// so those six collapsed to whichever indexed last, and every [[README]] link —
// including path-qualified ones like [[Business/README]], whose path linkKey()
// discards — drew an edge to that single note. A wrong edge, drawn identically
// to a correct one.
//
// Run: node test/edge-provenance.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkKey, noteKey } from '../index-vault.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(here, '..', 'index.json');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
    failures++;
  }
};

if (!fs.existsSync(indexPath)) {
  console.error('index.json not found — run the indexer first.');
  process.exit(2);
}
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

// --- Reproduce the resolution rules exactly as server.mjs buildGraph() does ---
const byKey = new Map();
for (const n of index.notes) {
  const k = noteKey(n.title);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(n);
}
const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase();

function resolve(rawLink) {
  const candidates = byKey.get(linkKey(rawLink)) || [];
  if (candidates.length === 0) return null;
  let target = candidates[0];
  let pathMatched = false;
  if (rawLink.includes('/') || rawLink.includes('\\')) {
    const want = norm(rawLink);
    const hit = candidates.find((c) => norm(c.path) === want || norm(c.path).endsWith('/' + want));
    if (hit) { target = hit; pathMatched = true; }
  }
  if (!pathMatched && candidates.length > 1) {
    target = [...candidates].sort((a, b) => a.path.localeCompare(b.path))[0];
  }
  const written = rawLink.split('/').pop().split('\\').pop().trim();
  const hasPath = rawLink.includes('/') || rawLink.includes('\\');
  let provenance;
  if (candidates.length > 1 && !pathMatched) provenance = 'ambiguous';
  else if (written !== target.title) provenance = 'inferred';
  else if (hasPath && !pathMatched) provenance = 'inferred';
  else provenance = 'extracted';
  return { target, provenance, candidates: candidates.length };
}

console.log('\n--- Collision detection ---');
const collisions = [...byKey.entries()].filter(([, v]) => v.length > 1);
check('vault has at least one colliding title (the case under test)', collisions.length > 0,
  'no collisions found — this test is not exercising the bug');
for (const [k, v] of collisions) {
  console.log(`        "${k}" -> ${v.length} notes: ${v.map((n) => n.path).join(', ')}`);
}

console.log('\n--- Path-qualified links resolve to the right note ---');
for (const [, group] of collisions) {
  for (const note of group) {
    // Build the link a human would write for this exact note, e.g. "Business/README"
    const rel = norm(note.path);
    const r = resolve(rel);
    check(`[[${rel}]] -> ${note.path}`, r && r.target.path === note.path,
      r ? `got ${r.target.path}` : 'unresolved');
  }
}

console.log('\n--- Provenance classification ---');
const bare = collisions.length ? collisions[0][0] : null;
if (bare) {
  const r = resolve(bare);
  check(`bare [[${bare}]] across ${r.candidates} candidates is AMBIGUOUS`,
    r && r.provenance === 'ambiguous', r ? r.provenance : 'unresolved');
}
// An exact, unique title must be extracted.
const unique = index.notes.find((n) => (byKey.get(noteKey(n.title)) || []).length === 1);
if (unique) {
  const r = resolve(unique.title);
  check(`exact unique [[${unique.title}]] is EXTRACTED`,
    r && r.provenance === 'extracted', r ? r.provenance : 'unresolved');
  const r2 = resolve(unique.title.toUpperCase());
  const differs = unique.title.toUpperCase() !== unique.title;
  if (differs) {
    check(`case-folded [[${unique.title.toUpperCase()}]] is INFERRED`,
      r2 && r2.provenance === 'inferred', r2 ? r2.provenance : 'unresolved');
  }
}

console.log('\n--- Whole-vault tally ---');
const stats = { extracted: 0, inferred: 0, ambiguous: 0, unresolved: 0 };
const seen = new Set();
for (const n of index.notes) {
  for (const raw of n.links || []) {
    const r = resolve(raw);
    if (!r) { stats.unresolved++; continue; }
    if (r.target.path === n.path) continue;
    const pk = [n.path, r.target.path].sort().join('::');
    if (seen.has(pk)) continue;
    seen.add(pk);
    stats[r.provenance]++;
  }
}
console.log('       ', JSON.stringify(stats));
check('every drawn edge carries a provenance tag',
  stats.extracted + stats.inferred + stats.ambiguous === seen.size,
  `tagged ${stats.extracted + stats.inferred + stats.ambiguous} of ${seen.size}`);

console.log(failures === 0 ? '\nOK — all checks passed\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
