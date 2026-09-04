// Regression guard for the compaction runaway loop (2026-08-09 incident).
//
// Two independent causes fed each other: CLAUDE.md is re-injected after every
// compaction, so a rule like "at 80%, auto-compact" re-arms itself on the
// freshly compacted context and fires forever; and a low autoCompactWindow
// shipped by settings.reference.json put the harness's always-on context
// floor near (or over) the window, forcing compaction before anything even
// happened. See helpers/gut-compaction-loop.mjs for the full writeup and the
// one-time cleanup script; this test is the permanent regression guard — the
// sweep that found and removed the loop was one-time, this is not.
//
// Self-contained: no server, no network, no browser. Walks `git ls-files` so
// it catches the loop reappearing in ANY tracked file, not just the ones that
// carried it originally.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const R = [];
const add = (n, ok, d) => R.push({ n, ok, d: String(d).slice(0, 500) });

// Files that document the incident by literally quoting the offending text
// are the fix, not a regression — excluded from the content scan. Keep this
// list short: exempting a file is a decision that needs a reason.
const EXEMPT = new Set([
  'helpers/gut-compaction-loop.mjs',
  'brain/test/no-compaction-directives.mjs',
]);

let tracked;
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
} catch (e) {
  add('git ls-files succeeds (this test needs a repo checkout)', false, e.message);
  console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
  process.exit(0);
}
add('repo has tracked files to scan', tracked.length > 100, `${tracked.length} tracked files`);

const TEXT_EXT = new Set(['.md', '.mjs', '.cjs', '.js', '.json', '.ps1', '.txt', '.yml', '.yaml']);

// Shape-matched, not exact-matched — phrasing varies across 73 agents and 76
// skills, so these key off the STRUCTURE of a compaction directive (a
// percentage tied to an instruction to act), not the old file's exact words.
const DIRECTIVE_PATTERNS = [
  { name: 'percentage-ladder bullet ("- At NN%: ...")', re: /^[ \t]*[-*][ \t]*\*{0,2}At[ \t]+\*{0,2}\d{1,3}\s?%/im },
  { name: 'mandatory auto-compact directive', re: /auto-?compact.{0,60}(do not wait|is mandatory|no permission needed|not a suggestion)/i },
  { name: '"HARD RULE" tied to compaction', re: /HARD RULE[^\n]{0,120}compact/i },
  { name: 'handoff ritual explicitly tied to auto-compaction', re: /this (applies|extends) to auto-?compact/i },
  { name: '"when compacting, preserve ..." checklist', re: /when compacting,?\s*(always\s+)?preserve/i },
  { name: 'context-usage threshold instructing an action', re: /at\s+\*{0,2}\d{1,3}\s?%\+?\*{0,2}\s*(of\s+)?context[^\n]{0,60}(compact|clear|suggest|recommend|auto-compact)/i },
];

// A line naming a percentage, "compact", and a model tier together is a
// directive regardless of word order ("HARD RULE — compact Fable/Opus at
// 50%" vs "on Fable or Opus, compacting at 50% is mandatory") — three
// separate substring checks per line catch both orderings a single
// left-to-right regex would miss.
function hasCompactPercentTier(line) {
  return /compact/i.test(line) && /\d{1,3}\s?%/.test(line) && /\b(fable|opus|sonnet|haiku)\b/i.test(line);
}

let scanned = 0;
for (const rel of tracked) {
  const normRel = rel.replace(/\\/g, '/');
  if (EXEMPT.has(normRel)) continue;
  const ext = path.extname(rel).toLowerCase();
  if (!TEXT_EXT.has(ext)) continue;
  const abs = path.join(ROOT, rel);
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
  scanned++;

  for (const p of DIRECTIVE_PATTERNS) {
    const m = text.match(p.re);
    if (m) add(`no compaction directive in ${normRel} [${p.name}]`, false, m[0].slice(0, 200));
  }
  for (const line of text.split('\n')) {
    if (hasCompactPercentTier(line)) {
      add(`no compaction directive in ${normRel} [compact tied to a percentage and a model tier]`, false, line.trim().slice(0, 200));
    }
  }
}
add(`scanned ${scanned} tracked text files for compaction directives`, scanned > 50, `${scanned} files scanned, ${EXEMPT.size} exempted`);

// The other half of the incident: a low autoCompactWindow ships a context
// floor that can exceed the window before a session has typed anything. Any
// tracked JSON file that sets this key must ship it comfortably above the
// floor — 500000 leaves headroom under the working default of 600000.
const MIN_AUTO_COMPACT_WINDOW = 500000;
let jsonWithKey = 0;
for (const rel of tracked.filter((f) => f.toLowerCase().endsWith('.json'))) {
  const abs = path.join(ROOT, rel);
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
  let j;
  try { j = JSON.parse(text); } catch { continue; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || !('autoCompactWindow' in j)) continue;
  jsonWithKey++;
  const v = j.autoCompactWindow;
  add(`autoCompactWindow >= ${MIN_AUTO_COMPACT_WINDOW} in ${rel}`,
    typeof v === 'number' && v >= MIN_AUTO_COMPACT_WINDOW, `got ${JSON.stringify(v)}`);
}
add('checked every tracked JSON file for autoCompactWindow', true, `${jsonWithKey} file(s) set the key`);

console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
