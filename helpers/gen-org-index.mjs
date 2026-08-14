#!/usr/bin/env node
/**
 * Generates the `org-index` skill — a compact roster preloaded into VP/manager charters via the
 * native `skills:` frontmatter field, so an agent that needs to know who else exists gets the
 * answer WITHOUT a tool call.
 *
 * Why this exists: the routing eval measured ~5-7s and ~20k tokens per file read, on the critical
 * path, at every level of the chain. Reading ORG.md (431 lines) to answer "who owns backups?" is
 * the single most wasteful thing the org did. Preloading costs ~1.5k tokens once per spawn and
 * removes a round trip.
 *
 * Regenerate after any roster change: node gen-org-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(process.env.USERPROFILE || os.homedir(), '.claude', 'skills', 'orgagent', 'references', 'charters');
const OUT = path.join(process.env.USERPROFILE || os.homedir(), '.claude', 'skills', 'orgagent', 'references', 'roster.md');

const agents = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md') && e.name !== 'ORG.md') {
      const src = fs.readFileSync(p, 'utf8');
      const g = (k) => (src.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim();
      const name = g('name');
      if (!name) continue;
      // First sentence of Mission is the surface; fall back to the description's opening clause.
      const mission = (src.match(/^## Mission\s*\n+([\s\S]*?)(?:\n\n|\n##)/m) || [])[1];
      let surface = (mission || (src.match(/^description:\s*\|?\s*\n?\s*(.+)/m) || [])[1] || '')
        .replace(/\n\s*/g, ' ').replace(/`/g, '').trim();
      surface = surface.split(/(?<=[a-z0-9)])\.\s/)[0].replace(/\.$/, '');
      if (surface.length > 118) surface = surface.slice(0, 115).replace(/\s\S*$/, '') + '…';
      const skills = (g('skills') || '').split(',').map((x) => x.trim())
        .filter((x) => x && !['org-index', 'vault-recall', 'verification-before-completion',
                              'systematic-debugging'].includes(x));
      agents.push({ name, tier: g('tier') || 'specialist', parent: g('parent') || '—', surface, skills });
    }
  }
})(ROOT);

const ORDER = { vp: 0, manager: 1, employee: 2, specialist: 3 };
agents.sort((a, b) => (ORDER[a.tier] - ORDER[b.tier]) || a.name.localeCompare(b.name));

const rows = (tier) => agents.filter((a) => a.tier === tier)
  .map((a) => `| \`${a.name}\` | ${a.parent === '—' ? '—' : `\`${a.parent}\``} | ${a.surface} | `
            + `${a.skills.length ? a.skills.map((s) => `\`${s}\``).join(' ') : '—'} |`)
  .join('\n');

const body = `# Roster — every role Alfred can staff

**Generated from \`skills/orgagent/references/charters/**/*.md\`. Do not hand-edit — regenerate
with \`node ~/.claude/helpers/gen-org-index.mjs\`.**

These are ROLE DEFINITIONS, not running agents. Nothing here is loaded into a session until
\`orgagent\` is invoked, and nothing here spawns on its own. To staff one, compose it per
\`orgagent\`'s brief template — the name in this table becomes the assembled agent's ROLE, and
its \`charters/\` file is the long-form contract to read only if the one-line surface is not enough.

Read \`ORG.md\` for the *contracts and rules* (§4 charter spec, §5 return shapes, §5b/§5c the
structural rules) — not to look up a name.

## Chain of command

\`\`\`
CEO → Chief of Staff (main session) → VP (opus) → Manager (sonnet) → Employee (haiku)
\`\`\`

Spawning is top-down. To reach a tier ABOVE you, return an escalation request — do not spawn upward.

## VPs — one per domain

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
${rows('vp')}

## Managers — one per discipline

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
${rows('manager')}

## Employees — one bounded surface each

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
${rows('employee')}

## Specialists — delegated to by name, exempt from the charter (ORG.md §7)

| Agent | Reports to | Owns | Specialist skills |
|---|---|---|---|
${rows('specialist')}

---

${agents.filter((a) => a.tier === 'vp').length} VPs · ${agents.filter((a) => a.tier === 'manager').length} managers · ${agents.filter((a) => a.tier === 'employee').length} employees · ${agents.filter((a) => a.tier === 'specialist').length} specialists.
Counts are generated, not asserted. If they disagree with ORG.md, run \`node ~/.claude/helpers/validate-org.mjs\`.
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body, 'utf8');
const tokens = Math.round(body.length / 4);
console.log(`wrote ${OUT}`);
console.log(`  ${agents.length} agents · ${body.split('\n').length} lines · ~${tokens} tokens preloaded`);
