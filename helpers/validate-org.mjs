#!/usr/bin/env node
/**
 * validate-org.mjs — proves the Alfred agent org is internally consistent.
 *
 * The bug this exists to prevent: agent bodies delegated to agents that did not exist, while the
 * frontmatter graph stayed valid. The HUD rendered a clean pyramid off the frontmatter and nobody
 * checked the prose the model actually reads. A green picture derived from the wrong field.
 *
 * Run:  node ~/.claude/helpers/validate-org.mjs [--json] [--quiet]
 * Exit: 0 clean · 1 errors found · 2 could not run
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Configuration ---------------------------------------------------------

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
// Charters moved out of ~/.claude/agents on 2026-08-14. They are role DEFINITIONS carried by the
// `orgagent` skill, not standing agent definitions the harness loads into every session.
const AGENTS_DIR = path.join(CLAUDE_DIR, 'skills', 'orgagent', 'references', 'charters');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const PLUGIN_CACHE = path.join(CLAUDE_DIR, 'plugins', 'cache');

const REQUIRED_FRONTMATTER = ['name', 'description', 'model', 'tier', 'parent', 'domain', 'tools'];

const REQUIRED_SECTIONS = [
  '## Mission',
  '## When I am engaged',
  '## My team',
  '## Skills I invoke',
  '## Rules',
  '## How I execute',
  '## What I return',
  '## Escalation',
  '## Anti-patterns',
];

const TIER_MODEL = { vp: 'opus', manager: 'sonnet', employee: 'haiku' };
const TIER_ORDER = { 'chief-of-staff': 0, vp: 1, manager: 2, employee: 3 };

const args = new Set(process.argv.slice(2));
const AS_JSON = args.has('--json');
const QUIET = args.has('--quiet');

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push({ file, msg });
const warn = (file, msg) => warnings.push({ file, msg });

// --- Discovery -------------------------------------------------------------

function walk(dir, ext = '.md') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/**
 * Dirent#isDirectory() reflects the raw dirent type (lstat-like) and returns false for a
 * symlinked directory — so a skill installed as a symlink (e.g. shared from ~/.agents/skills/)
 * silently vanished from discovery here, and any agent referencing it would fail validation
 * with a false "unknown skill" even though the skill resolves fine at runtime. Falling back to
 * a real stat (which follows symlinks) for anything the dirent check didn't already confirm.
 */
function listDirNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => {
      if (e.isDirectory()) return true;
      if (!e.isSymbolicLink()) return false;
      try { return fs.statSync(path.join(dir, e.name)).isDirectory(); }
      catch { return false; }
    })
    .map((e) => e.name);
}

/** Every skill name callable on this machine — user skills plus plugin-provided ones. */
function discoverSkills() {
  const names = new Set(listDirNames(SKILLS_DIR));
  for (const f of walk(COMMANDS_DIR)) names.add(path.basename(f, '.md'));
  // Plugin skills live at plugins/cache/<plugin>/<version>/skills/<name>/
  if (fs.existsSync(PLUGIN_CACHE)) {
    for (const plugin of listDirNames(PLUGIN_CACHE)) {
      for (const version of listDirNames(path.join(PLUGIN_CACHE, plugin))) {
        const skillsPath = path.join(PLUGIN_CACHE, plugin, version, 'skills');
        for (const s of listDirNames(skillsPath)) {
          names.add(s);
          names.add(`${plugin}:${s}`);
        }
      }
    }
  }
  return names;
}

// --- Parsing ---------------------------------------------------------------

/**
 * Frontmatter now carries block scalars (description: |) and a list of objects
 * (forbidden_actions), so a naive line scan would silently mis-read them. We keep the raw text and
 * extract each shape deliberately rather than pulling in a YAML dependency.
 */
function parseAgent(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const rel = path.relative(AGENTS_DIR, file);
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    err(rel, 'no YAML frontmatter block');
    return null;
  }
  const yaml = m[1];
  const lines = yaml.split(/\r?\n/);
  const fm = {};

  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([a-zA-Z_]+):[ \t]*(.*)$/);
    if (!kv) continue;
    const [, key, inline] = kv;

    // Block scalar or nested structure: consume the indented run that follows.
    if (inline === '' || inline === '|' || inline === '>') {
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === '') { block.push(''); continue; }
        if (!/^[ \t]/.test(lines[j])) break;
        block.push(lines[j].replace(/^[ \t]{1,2}/, ''));
      }
      fm[key] = block.join('\n');
      i = j - 1;
      continue;
    }
    fm[key] = inline.trim().replace(/^["']|["']$/g, '');
  }

  // forbidden_actions: parse the typed list into objects so delegate_to can be resolved.
  fm._forbidden = [];
  if (fm.forbidden_actions) {
    let cur = null;
    for (const line of fm.forbidden_actions.split(/\r?\n/)) {
      const start = line.match(/^\s*-\s*id:\s*(\S+)/);
      if (start) {
        cur = { id: start[1] };
        fm._forbidden.push(cur);
        continue;
      }
      const prop = line.match(/^\s+([a-z_]+):\s*(.+)$/);
      if (prop && cur) cur[prop[1]] = prop[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  return { file, rel, fm, body: m[2] };
}

const listField = (v) => (v || '').split(',').map((s) => s.trim().replace(/^["'`]|["'`]$/g, '')).filter(Boolean);

/**
 * Pull agent names out of a section. Charters list teammates in a markdown table whose first
 * column is a backticked agent name, so that is what we trust — prose mentions are not commitments.
 */
function namesInSection(body, heading) {
  const section = sectionText(body, heading);
  if (!section) return [];
  const found = new Set();
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const first = line.split('|')[1];
    if (!first) continue;
    for (const tick of first.matchAll(/`([a-zA-Z][\w.:-]*)`/g)) found.add(tick[1]);
  }
  return [...found];
}

function sectionText(body, heading) {
  const idx = body.indexOf(heading);
  if (idx === -1) return null;
  const after = body.slice(idx + heading.length);
  const next = after.search(/\r?\n## /);
  return next === -1 ? after : after.slice(0, next);
}

// --- Checks ----------------------------------------------------------------

function main() {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.error(`agents dir not found: ${AGENTS_DIR}`);
    process.exit(2);
  }

  const files = walk(AGENTS_DIR).filter((f) => path.basename(f) !== 'ORG.md');
  const agents = files.map(parseAgent).filter(Boolean);
  const skills = discoverSkills();

  const byName = new Map();
  for (const a of agents) {
    if (!a.fm.name) continue;
    if (byName.has(a.fm.name)) {
      err(a.rel, `duplicate agent name "${a.fm.name}" (also in ${byName.get(a.fm.name).rel})`);
    }
    byName.set(a.fm.name, a);
  }

  // Chartered agents are those declaring a tier; imported specialists are exempt from the
  // full charter but still must not be referenced if they do not exist.
  const chartered = agents.filter((a) => a.fm.tier && TIER_ORDER[a.fm.tier] !== undefined);

  // --- R2: the contract hole under the reuse map -----------------------------------------------
  // Exempting non-chartered agents from the charter is deliberate (ORG.md §7 — do not write thin
  // replacements for real specialists). Exempting them from VISIBILITY was not: this filter meant
  // a delegation target with no `## What I return` could never be flagged, so the validator printed
  // PASS while ~23% of the delegation surface returned freeform prose into a chain whose entire
  // premise (§5, citing MetaGPT) is that typed artifacts stop the telephone game.
  //
  // That is anti-pattern #1 — the green picture — reproduced inside the tool built to prevent it.
  // These are warnings, not errors: the fix is to give each one a return contract, not to delete a
  // working specialist because it predates the charter.
  const uncharteredTargets = new Set();
  for (const a of chartered) {
    for (const m of a.body.matchAll(/`([a-z][a-z0-9-]{2,})`/g)) {
      const t = byName.get(m[1]);
      if (t && !chartered.includes(t)) uncharteredTargets.add(t);
    }
  }
  // --- R2: org-index drift ---------------------------------------------------------------------
  // org-index is generated from these same files and preloaded into every chartered agent, so a
  // stale index is a roster that lies with authority. Cheaper to catch here than to debug a
  // misroute later.
  const idxPath = path.join(os.homedir(), '.claude', 'skills', 'org-index', 'SKILL.md');
  if (fs.existsSync(idxPath)) {
    const idx = fs.readFileSync(idxPath, 'utf8');
    for (const a of chartered) {
      if (!new RegExp(`\\|\\s*\`${a.fm.name}\`\\s*\\|`).test(idx)) {
        err('skills/org-index/SKILL.md', `missing \`${a.fm.name}\` — regenerate: `
          + `node ~/.claude/helpers/gen-org-index.mjs`);
        continue;
      }
      // The Skills column is the routing signal for "who knows which skill to use". If a charter
      // declares a skill the index does not show, the router cannot see it.
      const declared = (a.fm.skills || '').split(',').map((s) => s.trim())
        .filter((s) => s && !['org-index', 'vault-recall', 'verification-before-completion',
                              'systematic-debugging'].includes(s));
      const row = idx.split('\n').find((l) => l.includes(`\`${a.fm.name}\``)) || '';
      for (const sk of declared) {
        if (!row.includes(`\`${sk}\``)) {
          warn('skills/org-index/SKILL.md', `\`${a.fm.name}\` declares skill \`${sk}\` but the `
            + `index row does not show it — regenerate`);
        }
      }
    }
  } else {
    warn('skills/org-index/SKILL.md', 'not generated — every chartered agent preloads it; '
      + 'run node ~/.claude/helpers/gen-org-index.mjs');
  }

  // --- R3: the evidence ledger ------------------------------------------------------------------
  // "Never present a finding as verified when the chain says it was inferred" lived only as prose in
  // the CoS charter, which made provenance unauditable: the CEO could not tell a checked claim from
  // a confident one. Every return contract now separates VERIFIED (with a pointer) from INFERRED,
  // and this check keeps it there. Precedent is Magentic-One's Task Ledger facts/guesses split —
  // they structured this before we did.
  for (const a of chartered) {
    if (!/EVIDENCE\s+—/.test(a.body)) {
      err(a.rel, 'return contract has no EVIDENCE line — VERIFIED claims must carry a pointer and '
        + 'INFERRED ones must be labelled, or provenance cannot be audited (ORG.md §5)');
    }
  }

  for (const t of uncharteredTargets) {
    if (!/^##\s*What I return/m.test(t.body)) {
      warn(t.rel, 'delegated to by a chartered agent but has no `## What I return` — its caller '
                + 'receives freeform prose and must re-derive the structure the return contract '
                + 'exists to guarantee (ORG.md §5)');
    }
  }

  for (const a of chartered) {
    // 1. Frontmatter completeness
    for (const field of REQUIRED_FRONTMATTER) {
      if (!a.fm[field]) err(a.rel, `frontmatter missing required field: ${field}`);
    }

    // 2. Filename/name coherence — a mismatch makes an agent unspawnable by the name in ORG.md
    if (a.fm.name && path.basename(a.file, '.md') !== a.fm.name) {
      warn(a.rel, `filename does not match name "${a.fm.name}"`);
    }

    // 3. Tier/model routing — cost tier must follow the org, not drift per-file
    const expected = TIER_MODEL[a.fm.tier];
    if (expected && a.fm.model !== expected) {
      err(a.rel, `tier "${a.fm.tier}" requires model "${expected}", found "${a.fm.model}"`);
    }

    // 4. All nine charter sections present
    for (const s of REQUIRED_SECTIONS) {
      if (!a.body.includes(s)) err(a.rel, `charter section missing: ${s}`);
    }

    // 5. Parent resolves, and points strictly upward
    if (a.fm.parent && a.fm.parent !== 'chief-of-staff') {
      const parent = byName.get(a.fm.parent);
      if (!parent) {
        err(a.rel, `parent "${a.fm.parent}" does not exist on disk`);
      } else if (TIER_ORDER[parent.fm.tier] >= TIER_ORDER[a.fm.tier]) {
        err(a.rel, `parent "${a.fm.parent}" is tier ${parent.fm.tier}, not above ${a.fm.tier}`);
      }
    } else if (!a.fm.parent) {
      err(a.rel, 'no parent declared');
    } else if (a.fm.tier !== 'vp') {
      err(a.rel, `only VPs may report to chief-of-staff (tier is ${a.fm.tier})`);
    }

    // 6. THE GHOST CHECK — every teammate named in the body must exist and be directly below
    const team = namesInSection(a.body, '## My team');
    if (a.fm.tier === 'employee') {
      if (team.length) err(a.rel, `employee declares teammates (${team.join(', ')}) — employees are leaves`);
    } else if (!team.length) {
      err(a.rel, `${a.fm.tier} declares no team — every VP and manager must delegate`);
    }
    for (const name of team) {
      const child = byName.get(name);
      if (!child) {
        err(a.rel, `GHOST: "## My team" names "${name}" which does not exist on disk`);
        continue;
      }
      // Chartered children must actually report here. Imported specialists (no tier) are
      // shared resources and may be delegated to from more than one place.
      if (child.fm.tier && child.fm.parent !== a.fm.name) {
        warn(a.rel, `names "${name}" but its parent is "${child.fm.parent || 'none'}"`);
      }
      if (child.fm.tier && TIER_ORDER[child.fm.tier] <= TIER_ORDER[a.fm.tier]) {
        err(a.rel, `names "${name}" (tier ${child.fm.tier}) which is not below ${a.fm.tier}`);
      }
    }

    // 7. THE SKILL CHECK — a named skill that does not exist is the same class of bug.
    // Frontmatter `skills:` is what actually preloads; the prose table only documents when to use.
    const declared = listField(a.fm.skills);
    const documented = namesInSection(a.body, '## Skills I invoke');
    if (!declared.length) err(a.rel, 'frontmatter declares no skills: — prose alone does not preload');
    if (!documented.length) err(a.rel, '"## Skills I invoke" is empty — see ORG.md §6');
    for (const s of [...declared, ...documented]) {
      const bare = s.replace(/^\//, '');
      if (!skills.has(bare) && !skills.has(s)) err(a.rel, `unknown skill/command: "${s}"`);
    }
    for (const s of documented) {
      const bare = s.replace(/^\//, '');
      if (declared.length && !declared.includes(bare) && !declared.includes(s)) {
        warn(a.rel, `"${s}" is documented in prose but not in frontmatter skills: — it will not preload`);
      }
    }

    // 8. STRICT DELEGATION — typed and machine-checkable, not a prose regex.
    // Adopted from yohey-w/multi-agent-shogun: a forbidden action names where work should go instead.
    if (a.fm.tier === 'employee') {
      if (a.fm._forbidden.length) warn(a.rel, 'employees are leaves — forbidden_actions is meaningless here');
    } else {
      if (!a.fm._forbidden.length) {
        err(a.rel, 'no forbidden_actions — strict delegation requires at least F001 self_execute_task');
      }
      const f001 = a.fm._forbidden.find((f) => f.action === 'self_execute_task');
      if (!f001) err(a.rel, 'forbidden_actions lacks action "self_execute_task" (the CEO standing rule)');

      // CAPABILITY MUST MATCH MANDATE. Every VP and manager forbade self_execute_task while its
      // tools: line granted only Read/Grep/Glob/Bash — so the org mandated delegation and made it
      // impossible in the same file. 46 of 51 agents were unreachable and the validator passed all
      // of them, because it checked the rule and never checked the means to obey it.
      // A prohibition an agent physically cannot comply with is not a rule, it is a trap.
      if (!listField(a.fm.tools).some((t) => t === 'Agent' || t === 'Task')) {
        err(a.rel, 'forbids self_execute_task but tools: grants no Agent/Task — cannot delegate, so the mandate is unobeyable');
      }
      for (const f of a.fm._forbidden) {
        if (!f.description) err(a.rel, `forbidden_actions ${f.id}: missing description`);
        if (!f.delegate_to && !f.use_instead) {
          err(a.rel, `forbidden_actions ${f.id}: names no delegate_to — a prohibition without a destination`);
        }
        if (f.delegate_to && !byName.has(f.delegate_to)) {
          err(a.rel, `forbidden_actions ${f.id}: delegate_to "${f.delegate_to}" does not exist on disk`);
        }
      }
    }

    // 9. ROUTING SURFACE — description is what the layer above reads to choose between siblings.
    // Collapse whitespace first: block scalars preserve newlines, so a line-wrapped "Use\nwhen"
    // reads correctly to a human and fails a naive regex. That is a linter bug, not an author bug.
    const desc = (a.fm.description || '').replace(/\s+/g, ' ');
    if (!/use (when|this agent|proactively)/i.test(desc)) {
      err(a.rel, 'description has no "Use when…" trigger phrase — the parent cannot route to it');
    }
    // R3: employees are exempt. Their descriptions are injected into EVERY turn that has the Agent
    // tool — 33 of them cost 7.2k tokens before the CEO typed anything, for agents the Chief of
    // Staff cannot spawn directly anyway (chain of command). Their discrimination lives in the
    // parent's `## My team` table and in org-index's parent chain, both of which load only when
    // actually needed. VPs and managers keep the requirement: those ARE the routing surface.
    // Gated on the routing eval showing no regression — see ORG.md §4.
    const examples = (desc.match(/<example>/g) || []).length;
    const needed = a.fm.tier === 'employee' ? 0 : 2;
    if (examples < needed) {
      err(a.rel, `description carries ${examples} <example> block(s) — at least ${needed} required for routing`);
    }

    // 10. PORTABILITY — charters must paste into .github/copilot-instructions.md for WORK mode,
    // where Claude's tool vocabulary does not exist. Write actions, not tool names.
    const toolWords = /\b(Read|Grep|Glob|Edit|Write|Bash|WebFetch|WebSearch|NotebookEdit) tool\b/g;
    const hits = [...a.body.matchAll(toolWords)].map((m) => m[1]);
    if (hits.length) {
      warn(a.rel, `names Claude tools in prose (${[...new Set(hits)].join(', ')}) — write the action instead`);
    }

    // 11. THE CROSS-SECTION GHOST CHECK.
    // Checks 6 and 8 only resolve names inside "## My team" and delegate_to. But an escalation
    // path is a delegation too, and a wrong name there fails just as hard — it is simply invisible
    // to a structural check. Two detections, both zero-false-positive by construction:
    //   (a) case near-miss: resolves case-insensitively but not exactly. Names are case-sensitive,
    //       so this is always a real break, never style.
    //   (b) shape match: reads like an agent name by suffix but resolves to nothing at all.
    const lower = new Map([...byName.keys()].map((n) => [n.toLowerCase(), n]));
    const AGENT_SHAPE = /-(manager|dev|eng|auditor|hunter|scanner|modeler|mapper|collector|writer|responder|analyst|specialist|architect|tester|author)$|^vp-/;
    const scanned = new Set();
    for (const tick of `${a.fm.description || ''}\n${a.body}`.matchAll(/`([a-zA-Z][\w.:-]*)`/g)) {
      const token = tick[1];
      if (scanned.has(token)) continue;
      scanned.add(token);
      if (byName.has(token) || skills.has(token) || skills.has(token.replace(/^\//, ''))) continue;

      const near = lower.get(token.toLowerCase());
      if (near) {
        err(a.rel, `GHOST (case): references "${token}" but the agent on disk is "${near}" — names are case-sensitive`);
      } else if (AGENT_SHAPE.test(token)) {
        err(a.rel, `GHOST: references "${token}", which reads as an agent name but does not exist on disk`);
      }
    }

    // 12. THE ANTI-RELAY TEST (ORG.md §5b). A leader that cannot collapse itself charges the CEO
    // four layers of overhead for a one-employee question. Having forbidden_actions is not the same
    // thing — the first hand-written VP carried F001 and still had no collapse instruction, which is
    // how it shipped without one while four generated siblings included it.
    if (a.fm.tier !== 'employee') {
      const how = sectionText(a.body, '## How I execute') || '';
      if (!/anti-relay|collaps/i.test(how)) {
        err(a.rel, '"## How I execute" has no anti-relay test — see ORG.md §5b');
      }
      // NOT CHECKED HERE: whether the test also requires DISCLOSING the collapse in the return.
      // That is the second half of ORG.md §5b and it matters, but three correct charters phrased it
      // three ways — "say so in the return", "stating in the return that...", "say I collapsed the
      // layer" — and every pattern narrow enough to be meaningful flagged some of them. A check that
      // fires on correct input trains authors to ignore the linter, which costs more than the rule
      // it was protecting. Presence of the test is machine-checkable; adequacy of its wording is a
      // review judgment. Leave it to review and say so, rather than shipping a guard that cries wolf.
    }

    // 13. Tier-specific return fields the contract requires but a generic section check cannot see.
    const ret = sectionText(a.body, '## What I return') || '';
    const REQUIRED_RETURN = {
      vp: ['ANSWER', 'EVIDENCE', 'STRUCK', 'CONFIDENCE', 'GAPS'],
      manager: ['VERDICT', 'CONFIRMED', 'REJECTED', 'COVERAGE'],
      employee: ['FINDINGS', 'DID NOT COVER'],
    }[a.fm.tier] || [];
    for (const field of REQUIRED_RETURN) {
      if (!ret.includes(field)) err(a.rel, `"## What I return" omits required field ${field} (ORG.md §5)`);
    }
  }

  // 9. Orphan managers/VPs — a leader with no reports is the security-manager bug
  for (const a of chartered) {
    if (a.fm.tier === 'employee') continue;
    const kids = chartered.filter((c) => c.fm.parent === a.fm.name);
    if (!kids.length) err(a.rel, `no agent declares parent "${a.fm.name}" — leader with zero reports`);
  }

  // 10. Every ORG.md row exists on disk
  // ORG.md sits beside charters/, not inside it — it is the rules doc, not a role definition.
  const orgFile = path.join(AGENTS_DIR, '..', 'ORG.md');
  if (fs.existsSync(orgFile)) {
    const org = fs.readFileSync(orgFile, 'utf8');
    // Only actual table ROWS are the map. The surrounding prose legitimately names counter-examples
    // ("`security-manager`, not `mgr-security`"), and treating commentary as a commitment turns the
    // naming section into a linter error. Same rule as `## My team`: a row is a contract, prose is not.
    //
    // Both the org table (§3) AND the reuse map (§7) are maps. Scanning only §3 let a `VP-Architect`
    // ghost sit in §7 undetected — and the old `[a-z]` anchor would have skipped it even in range,
    // because the bug was a capital letter. Case is the whole point; match case-insensitively and
    // resolve exactly.
    const MAPS = [
      ['## 3. The full org', '## 4. Charter Contract'],
      ['## 7. Reuse map', '## 8. Global rules'],
    ];
    for (const [from, to] of MAPS) {
      const start = org.indexOf(from);
      if (start === -1) { err('ORG.md', `section "${from}" not found — the map cannot be checked`); continue; }
      const section = org.slice(start, org.indexOf(to));
      for (const line of section.split(/\r?\n/)) {
        if (!line.trim().startsWith('|') || /^\|[\s:|-]+\|$/.test(line.trim())) continue;
        for (const tick of line.matchAll(/`([a-zA-Z][\w-]*)`/g)) {
          const token = tick[1];
          if (byName.has(token)) continue;
          const near = [...byName.keys()].find((n) => n.toLowerCase() === token.toLowerCase());
          err('ORG.md', near
            ? `maps "${token}" but the agent on disk is "${near}" — names are case-sensitive`
            : `maps "${token}" which does not exist on disk`);
        }
      }
    }

    // The tally line drifts silently. It claimed 33 employees against a table listing 31, and that
    // number propagated into a task brief before anyone noticed. Assert it against reality.
    const tally = org.match(/(\d+)\s*VPs?\s*·\s*(\d+)\s*managers?\s*·\s*(\d+)\s*employees?/i);
    if (tally) {
      const actual = { vp: 0, manager: 0, employee: 0 };
      for (const a of chartered) actual[a.fm.tier]++;
      const claimed = { vp: +tally[1], manager: +tally[2], employee: +tally[3] };
      for (const tier of ['vp', 'manager', 'employee']) {
        if (claimed[tier] !== actual[tier]) {
          err('ORG.md', `tally claims ${claimed[tier]} ${tier}s, ${actual[tier]} exist on disk`);
        }
      }
    }
  } else {
    err('ORG.md', 'missing — the org has no authoritative map');
  }

  report(agents, chartered, byName, skills);
}

// --- Output ----------------------------------------------------------------

function report(agents, chartered, byName, skills) {
  if (AS_JSON) {
    console.log(JSON.stringify({
      ok: errors.length === 0,
      counts: { agents: agents.length, chartered: chartered.length, skills: skills.size },
      errors, warnings,
    }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  if (!QUIET) {
    const tiers = { vp: 0, manager: 0, employee: 0 };
    for (const a of chartered) tiers[a.fm.tier]++;
    console.log(C.bold('\nAlfred org validation'));
    console.log(C.dim(`  ${agents.length} agent files · ${chartered.length} chartered ` +
      `(${tiers.vp} VP / ${tiers.manager} mgr / ${tiers.employee} emp) · ${skills.size} skills known\n`));
  }

  if (warnings.length) {
    console.log(C.yellow(`  ${warnings.length} warning(s)`));
    for (const w of warnings) console.log(`    ${C.dim(w.file)}  ${w.msg}`);
    console.log();
  }

  if (errors.length) {
    console.log(C.red(`  ${errors.length} error(s)`));
    for (const e of errors) console.log(`    ${C.dim(e.file)}  ${C.red(e.msg)}`);
    console.log();
    process.exit(1);
  }

  console.log(C.green('  PASS — every delegation target and skill resolves.\n'));
  process.exit(0);
}

main();
