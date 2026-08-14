#!/usr/bin/env node
/**
 * Audits the skill/helper library for drift. The companion to validate-org.mjs, which does the
 * same job for the agent roster.
 *
 * Why this exists: on 2026-08-14 an audit found 12 local firecrawl skills that were stale
 * hand-copies of the official firecrawl plugin — 8 of them byte-identical to the plugin's own
 * version, plus 261KB of stray scraped Azure docs committed inside a skill folder. Nothing in
 * the framework checked for that, so it sat there accumulating. This is that check.
 *
 * Deliberately NOT a token-savings tool. The charter ablation (commit d7ce052) measured that
 * cutting instruction text does not reduce cost and can raise it. This checks for things that
 * are WRONG — duplication, drift, dead files — not things that are merely long.
 *
 * Run: node validate-library.mjs        (exit 1 if any ERROR-level finding)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.USERPROFILE || os.homedir();
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SKILLS = path.join(REPO, 'skills');
const HELPERS = path.join(REPO, 'helpers');
const PLUGINS = path.join(HOME, '.claude', 'plugins', 'cache');

const findings = [];
const add = (level, area, msg) => findings.push({ level, area, msg });

// --- Read every local skill -------------------------------------------------
const readFront = (p) => {
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/^---\s*\n([\s\S]*?)\n---/);
  const fm = m ? m[1] : '';
  const g = (k) => (fm.match(new RegExp(`^${k}:\\s*\\|?\\s*\\n?\\s*(.+)`, 'm')) || [])[1]?.trim();
  return { src, name: g('name'), description: g('description') };
};

const skills = [];
for (const d of fs.readdirSync(SKILLS, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const sp = path.join(SKILLS, d.name, 'SKILL.md');
  if (!fs.existsSync(sp)) { add('ERROR', d.name, 'folder in skills/ has no SKILL.md'); continue; }
  const s = readFront(sp);
  if (!s.name) add('ERROR', d.name, 'SKILL.md has no name: in frontmatter');
  // The harness resolves skills by FOLDER name, so a mismatch is drift, not breakage.
  else if (s.name.replace(/^["']|["']$/g, '') !== d.name)
    add('WARN', d.name, `frontmatter name ${s.name} != folder name — harness uses the folder, so fix the frontmatter`);
  if (!s.description) add('ERROR', d.name, 'SKILL.md has no description: — it will never trigger');
  skills.push({ folder: d.name, ...s });
}

// --- Compare against plugin-provided skills ---------------------------------
const pluginSkills = new Map();
const walkPlugins = (dir, depth = 0) => {
  if (depth > 6 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPlugins(p, depth + 1);
    else if (e.name === 'SKILL.md') {
      const owner = path.basename(path.dirname(p));
      if (!pluginSkills.has(owner)) pluginSkills.set(owner, p);
    }
  }
};
walkPlugins(PLUGINS);

for (const s of skills) {
  const hit = pluginSkills.get(s.folder);
  if (!hit) continue;
  const same = fs.readFileSync(hit, 'utf8') === s.src;
  add(same ? 'ERROR' : 'WARN', s.folder,
    same ? `byte-identical to plugin-provided skill — delete the local copy (${path.relative(PLUGINS, hit)})`
         : `a plugin also provides "${s.folder}" — confirm the local copy is deliberately customised`);
}

// --- Working artifacts committed inside a skill (factory/product mixing) -----
const PRODUCT_DIRS = new Set(['.firecrawl', 'output', 'out', 'tmp', 'downloads', 'cache']);
for (const s of skills) {
  const base = path.join(SKILLS, s.folder);
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || !PRODUCT_DIRS.has(e.name)) continue;
    const bytes = fs.readdirSync(path.join(base, e.name)).reduce((n, f) => {
      try { return n + fs.statSync(path.join(base, e.name, f)).size; } catch { return n; }
    }, 0);
    add('ERROR', s.folder, `run output committed inside the skill: ${e.name}/ (${Math.round(bytes / 1024)}KB) — skills hold rules, not artifacts`);
  }
}

// --- Helpers with no caller anywhere ----------------------------------------
const codeFiles = [];
const walkRepo = (dir, depth = 0) => {
  if (depth > 8) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '_archive', 'backups'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRepo(p, depth + 1);
    else if (/\.(mjs|cjs|js|md|json|ps1|sh|cmd)$/.test(e.name)) codeFiles.push(p);
  }
};
walkRepo(REPO);
const corpus = codeFiles.map((p) => ({ p, t: fs.readFileSync(p, 'utf8') }));
const settings = ['settings.json', 'settings.local.json']
  .map((f) => path.join(HOME, '.claude', f)).filter(fs.existsSync)
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');

for (const h of fs.readdirSync(HELPERS)) {
  if (!/\.(mjs|cjs|js)$/.test(h)) continue;
  const stem = h.replace(/\.(mjs|cjs|js)$/, '');
  const called = corpus.some(({ p, t }) =>
    !p.endsWith(path.join('helpers', h)) &&
    new RegExp(`(require\\([^)]*${stem}|from ['"][^'"]*${stem}|import [^;]*${stem}|node [^\\n]*${stem})`).test(t));
  if (!called && !settings.includes(h)) add('WARN', h, 'no caller found in repo or settings — candidate for _archive/');
}

// --- Report -----------------------------------------------------------------
const C = { ERROR: '\x1b[31m', WARN: '\x1b[33m', OK: '\x1b[32m', R: '\x1b[0m' };
const errs = findings.filter((f) => f.level === 'ERROR');
const warns = findings.filter((f) => f.level === 'WARN');

console.log(`\nLibrary audit — ${skills.length} skills, ${pluginSkills.size} plugin skills visible\n`);
for (const f of [...errs, ...warns]) console.log(`  ${C[f.level]}${f.level.padEnd(5)}${C.R} ${f.area}\n         ${f.msg}`);
if (!findings.length) console.log(`  ${C.OK}clean${C.R} — no duplication, drift, or dead files found`);
console.log(`\n${errs.length} error(s), ${warns.length} warning(s)\n`);
process.exit(errs.length ? 1 : 0);
