#!/usr/bin/env node
/**
 * gut-compaction-loop.mjs — remove the runaway auto-compaction loop from a
 * LIVE Claude Code install.
 *
 *   node gut-compaction-loop.mjs            # dry run: report only, touch nothing
 *   node gut-compaction-loop.mjs --apply    # back up, then write
 *
 * WHY THIS EXISTS, AND WHY IT DOESN'T JUST COPY THE REPO'S FILES
 * --------------------------------------------------------------
 * Two instructions in the global CLAUDE.md feed each other:
 *
 *   "At 80%+: Auto-compact. Do not wait for me to ask."
 *   "Never suggest /clear, /compact ... without first completing the handoff.
 *    This applies to auto-compact at 80% too: handoff first."
 *
 * CLAUDE.md is re-injected AFTER every compaction, so the threshold re-arms
 * itself on the freshly compacted context. And because the handoff is tied to
 * it, each cycle runs a four-step ritual (commit, push, rewrite the vault
 * project note, emit a report) that ADDS context before compacting again. The
 * loop is self-sustaining and each turn is expensive.
 *
 * This edits the live files in place rather than overwriting them from the
 * repo, because the machine's copy has almost certainly drifted from the
 * snapshot and clobbering it would discard real local edits. Every change is
 * a targeted pattern with a reported hit count, so a file that has already
 * been fixed reports zero and is left alone (safe to re-run).
 *
 * Options:
 *   --apply            actually write (default is a dry run)
 *   --keep a,b,c       plugin names to keep (default: firecrawl,code-review,github)
 *   --claude-home PATH override ~/.claude
 *   --no-plugins       only fix CLAUDE.md, leave settings.json alone
 *   --auto-compact N   set autoCompactWindow to N ("off" removes the override).
 *                      Use this when the HUD reads "0% until auto-compact" on a
 *                      fresh session: that means the always-on floor already
 *                      exceeds the window, so the harness compacts on turn one
 *                      and recovers nothing. No CLAUDE.md edit can fix that.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const APPLY = has('--apply');
const DO_PLUGINS = !has('--no-plugins');
const HOME = os.homedir();
const CLAUDE_HOME = valOf('--claude-home', path.join(HOME, '.claude'));
const KEEP = valOf('--keep', 'firecrawl,code-review,github').split(',').map((s) => s.trim()).filter(Boolean);
// null = report only. A number sets the window; "off" removes the override.
const AUTO_COMPACT = has('--auto-compact') ? valOf('--auto-compact', null) : null;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = path.join(CLAUDE_HOME, 'backups', `gut-loop-${stamp}`);

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m', off: '\x1b[0m' };
const say = (m) => console.log(m);
const step = (m) => say(`${C.cyn}==> ${m}${C.off}`);
const ok = (m) => say(`    ${C.grn}${m}${C.off}`);
const warn = (m) => say(`    ${C.yel}${m}${C.off}`);
const note = (m) => say(`    ${C.dim}${m}${C.off}`);

let totalEdits = 0;

function backup(file) {
  if (!APPLY) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // Flatten the path into the filename so ~/CLAUDE.md and ~/.claude/CLAUDE.md
  // cannot overwrite each other in the backup directory.
  const flat = file.replace(/[\\/:]/g, '_');
  fs.copyFileSync(file, path.join(BACKUP_DIR, flat));
}

// A short guard so a future session does not helpfully re-add the ladder.
const GUARD = [
  '- **Compaction is the harness\'s job, not the model\'s.** Do not add context-percentage',
  '  thresholds here. This file is re-injected *after* every compaction, so a rule like',
  '  "at 80%, auto-compact" re-arms itself on the compacted context and fires forever.',
  '  Claude cannot reliably read its own context usage, so such a rule fires on a guess.',
].join('\n');

// --- the patterns that make up the loop ---------------------------------
// Each returns { text, hits }. Shape-matched, not exact-matched, so a file
// that has been hand-edited since the snapshot still gets cleaned.
const RULES = [
  {
    name: 'context-percentage ladder ("At 50%/70%/80%/90% …")',
    apply(t) {
      // Whole bullet lines that key off a context-usage percentage.
      const re = /^[ \t]*[-*][ \t]*At[ \t]+\*{0,2}\d{1,3}\s?%.*$\n?/gim;
      const hits = (t.match(re) || []).length;
      return { text: t.replace(re, ''), hits };
    },
  },
  {
    name: 'handoff tied to auto-compaction ("applies to auto-compact … too")',
    apply(t) {
      const re = /\s*This applies to auto-?compact(?:ion)?[^.]*\./gi;
      const hits = (t.match(re) || []).length;
      return { text: t.replace(re, ''), hits };
    },
  },
  {
    name: '/compact listed as a reset that needs a handoff',
    apply(t) {
      // "Never suggest `/clear`, `/compact`, or ..." -> drop only /compact, and
      // take the now-dangling comma with it so the sentence still reads.
      const re = /(Never suggest[^\n]*?)`\/clear`,\s*`\/compact`,(\s*or)/gi;
      let hits = (t.match(re) || []).length;
      let text = t.replace(re, '$1`/clear`$2');
      // Fallback for any other ordering of the same list.
      const re2 = /(Never suggest[^\n]*?)`\/compact`,?\s*/gi;
      hits += (text.match(re2) || []).length;
      text = text.replace(re2, '$1');
      // Whichever order the list was in, removing an item can strand a comma
      // before the "or". These lines are instructions the model reads; leaving
      // them ungrammatical is its own small cost.
      text = text.replace(/(Never suggest[^\n]*?)`,\s+or\b/gi, '$1` or');
      return { text, hits };
    },
  },
  {
    name: '"compact aggressively" standing order',
    apply(t) {
      const re = /^([ \t]*[-*][ \t]*Context rot is real)[^\n]*$/gim;
      const FIXED = ' — but let the harness decide when to compact.';
      let hits = 0;
      const text = t.replace(re, (whole, head) => {
        if (whole === head + FIXED) return whole;   // already rewritten
        hits++;
        return head + FIXED;
      });
      return { text, hits };
    },
  },
  {
    name: 'MANDATORY-before-any-reset heading',
    apply(t) {
      const re = /^(#{1,4}[ \t]*Session Handoff[ \t]*)\(MANDATORY[^)]*\)/gim;
      const hits = (t.match(re) || []).length;
      return { text: t.replace(re, '$1(before *you* suggest a fresh session)'), hits };
    },
  },
  {
    // Anything left in the section that still talks about compaction is an
    // instruction about a decision the model does not get to make — including
    // the "when compacting, always preserve X" checklist, which quietly invites
    // a future session to reason about *when* to compact again. Strip those
    // lines and lead with the guard. Lines that are about something else
    // (`/clear` hygiene, for instance) are kept: they are not part of the loop.
    name: 'remaining compaction directives under Context Window Management',
    apply(t) {
      // Stop at the next heading or rule — or at end of file, when the section
      // happens to be the last one.
      const re = /^(#{1,4}[ \t]*Context Window Management[ \t]*)$\n([\s\S]*?)(?=^\s*(?:#{1,4}[ \t]|---\s*$)|(?![\s\S]))/gim;
      let hits = 0;
      const text = t.replace(re, (whole, heading, body) => {
        const kept = [];
        let dropping = false;          // inside a dropped bullet's sub-list
        for (const line of body.split('\n')) {
          const indented = /^[ \t]+\S/.test(line);
          if (dropping && (indented || !line.trim())) continue;
          dropping = false;
          if (/compact/i.test(line)) { dropping = true; continue; }
          kept.push(line);
        }
        const rest = kept.join('\n').replace(/^\s+|\s+$/g, '');
        const rebuilt = `${heading}\n${GUARD}\n${rest ? `${rest}\n` : ''}`;
        // The lazy match ends wherever the next heading's lookahead first
        // succeeds, so trailing blank lines are not stable between runs —
        // compare without them or every run reports a change and adds one.
        if (rebuilt.trimEnd() === whole.trimEnd()) return whole;
        hits++;
        return rebuilt;
      });
      return { text, hits };
    },
  },
];

function fixMarkdown(file) {
  if (!fs.existsSync(file)) { note(`skip (not present): ${file}`); return; }
  const before = fs.readFileSync(file, 'utf8');
  let text = before;
  const applied = [];

  for (const rule of RULES) {
    const r = rule.apply(text);
    if (r.hits > 0) { applied.push(`${r.hits}x ${rule.name}`); text = r.text; }
  }

  if (text === before) { ok(`already clean: ${file}`); return; }

  step(`${APPLY ? 'FIXING' : 'would fix'}  ${file}`);
  for (const a of applied) say(`      - ${a}`);
  totalEdits += applied.length;

  if (APPLY) { backup(file); fs.writeFileSync(file, text); ok('written (backed up)'); }
}

function fixPlugins(file) {
  if (!fs.existsSync(file)) { note(`skip (not present): ${file}`); return; }
  let json;
  const raw = fs.readFileSync(file, 'utf8');
  try { json = JSON.parse(raw); }
  catch (e) { warn(`NOT valid JSON, leaving alone: ${file} (${e.message})`); return; }

  // Claude Code stores this as an OBJECT — { "name@marketplace": true|false } —
  // not a list. Rewriting it as a list produces a config the CLI will not read,
  // so disabling means setting the value false and keeping the key.
  const cur = json.enabledPlugins;
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
    warn(`enabledPlugins is ${Array.isArray(cur) ? 'an array' : typeof cur}, expected an object — leaving alone: ${file}`);
    return;
  }

  const names = Object.keys(cur);
  const shouldKeep = (p) => KEEP.some((k) => p === k || p.startsWith(`${k}@`));
  const keep = names.filter(shouldKeep);
  // Only count the ones actually flipping true -> false as changes.
  const cut = names.filter((p) => !shouldKeep(p) && cur[p]);
  if (!cut.length) { ok(`plugins already pruned (${names.filter((p) => cur[p]).length} enabled)`); return; }

  // A keep-name that matched nothing is almost certainly a typo, and silently
  // cutting a plugin the user meant to keep is the worst outcome here.
  const unmatched = KEEP.filter((k) => !names.some((p) => p === k || p.startsWith(`${k}@`)));
  if (unmatched.length) warn(`--keep names that matched no installed plugin: ${unmatched.join(', ')}`);

  step(`${APPLY ? 'PRUNING' : 'would prune'}  ${file}`);
  say(`      keep ${keep.length}: ${keep.map((p) => p.split('@')[0]).join(', ') || '(none)'}`);
  say(`      cut  ${cut.length}: ${cut.map((p) => p.split('@')[0]).join(', ')}`);
  totalEdits += cut.length;

  if (APPLY) {
    backup(file);
    for (const p of cut) json.enabledPlugins[p] = false;
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    ok('written (backed up) — keys kept, values set false, so re-enabling is one edit');
  }
}

// The native compaction knob, and the one that actually matters once the
// always-on floor is large. If the floor alone exceeds this number, the
// harness compacts on turn one, recovers almost nothing (there is no
// conversation to summarise yet), and is immediately back over the line —
// "0% until auto-compact" before you have typed anything. No CLAUDE.md edit
// can fix that; it is floor >= window, and only one of those two is a knob.
function handleAutoCompact(file) {
  if (!fs.existsSync(file)) return;
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  const cur = j.autoCompactWindow;
  if (cur == null && AUTO_COMPACT == null) return;

  if (AUTO_COMPACT == null) {
    note(`autoCompactWindow = ${cur} tokens`);
    note('   if the HUD shows "0% until auto-compact" on a fresh session, your floor');
    note('   already exceeds this. Re-run with --auto-compact 600000 (or "off").');
    return;
  }

  const target = AUTO_COMPACT === 'off' ? undefined : Number(AUTO_COMPACT);
  if (AUTO_COMPACT !== 'off' && (!Number.isFinite(target) || target <= 0)) {
    warn(`--auto-compact expects a positive number or "off", got "${AUTO_COMPACT}"`);
    return;
  }
  if (cur === target) { ok(`autoCompactWindow already ${cur}`); return; }

  step(`${APPLY ? 'SETTING' : 'would set'}  autoCompactWindow: ${cur ?? '(unset)'} -> ${target ?? '(removed, harness default)'}`);
  totalEdits += 1;
  if (APPLY) {
    backup(file);
    if (target === undefined) delete j.autoCompactWindow; else j.autoCompactWindow = target;
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
    ok('written (backed up)');
  }
}

// MCP servers are usually the single largest item in the floor — every server
// injects the full JSON schema of every tool it exposes, on every request. They
// live in several places, and ~/.claude.json is the one people forget: it holds
// both a global mcpServers map and a per-project one under projects[<path>].
function findMcpSources() {
  const out = [];
  const consider = (file, label, servers) => {
    const names = Object.keys(servers || {});
    if (names.length) out.push({ file, label, names });
  };
  for (const f of [path.join(HOME, '.mcp.json'), path.join(CLAUDE_HOME, 'settings.local.json'),
                   path.join(HOME, '.claude.json')]) {
    if (!fs.existsSync(f)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { warn(`unreadable JSON: ${f}`); continue; }
    consider(f, 'global', j.mcpServers);
    for (const [proj, cfg] of Object.entries(j.projects || {})) {
      consider(f, `project ${proj}`, cfg && cfg.mcpServers);
    }
    if (Array.isArray(j.enabledMcpjsonServers) && j.enabledMcpjsonServers.length) {
      out.push({ file: f, label: 'enabledMcpjsonServers', names: j.enabledMcpjsonServers });
    }
  }
  return out;
}

function reportMcp() {
  const found = findMcpSources();
  if (!found.length) { note('no MCP servers found outside the plugin system'); return; }
  let total = 0;
  for (const s of found) {
    total += s.names.length;
    note(`${s.file} [${s.label}]: ${s.names.join(', ')}`);
  }
  note(`${total} MCP server entr${total === 1 ? 'y' : 'ies'} — each injects its full tool schema every request.`);
  note('   Not edited here: disabling one can break a live integration. Remove with');
  note('   `claude mcp remove <name>`, or delete the entry by hand.');
}

// --- run -----------------------------------------------------------------
say('');
step(APPLY ? 'GUTTING THE COMPACTION LOOP (writing)' : 'DRY RUN — nothing will be written');
note(`claude home: ${CLAUDE_HOME}`);
say('');

step('CLAUDE.md files');
const mdTargets = [
  path.join(CLAUDE_HOME, 'CLAUDE.md'),
  path.join(HOME, 'CLAUDE.md'),
  ...argv.filter((a) => a.toLowerCase().endsWith('.md')),
];
for (const f of [...new Set(mdTargets)]) fixMarkdown(f);

if (DO_PLUGINS) {
  say('');
  step('plugins');
  fixPlugins(path.join(CLAUDE_HOME, 'settings.json'));
}

say('');
step('auto-compaction window');
handleAutoCompact(path.join(CLAUDE_HOME, 'settings.json'));

say('');
step('MCP servers (report only — the biggest part of the floor)');
reportMcp();

say('');
if (!totalEdits) {
  ok('nothing to change — this install is already clean');
} else if (APPLY) {
  ok(`${totalEdits} change(s) applied. Backups: ${BACKUP_DIR}`);
  say(`${C.yel}    Restart the Claude CLI for this to take effect.${C.off}`);
} else {
  warn(`${totalEdits} change(s) pending. Re-run with --apply to write them.`);
}
say('');
process.exit(0);
