#!/usr/bin/env node
/**
 * Attribute real token spend per orchestration-eval run, from subagent transcripts.
 *
 *   node brain/scripts/attribute-run-tokens.mjs <subagents-dir> <prefix>
 *
 * WHY. The benchmark's headline metric is completion-per-100k-tokens. Without real per-run token
 * numbers that metric is unmeasurable and the whole comparison degrades to "did it work", which is
 * the measurement Alfred already passes and which answers nothing about cost. A system that
 * completes 5% more work for 3x the tokens has lost, and only this number shows it.
 *
 * Each run's transcript carries its own usage records, so spend is attributable per scenario per
 * arm rather than estimated. Cache reads are counted: they are cheaper per token, not free, and
 * excluding them would flatter whichever arm loads more context — which is systematically the
 * ALFRED arm, since its charter and org-index are the context in question. Counting them is the
 * conservative choice AGAINST the system being advocated for, which is the direction an
 * author-built benchmark should lean.
 *
 * A run that spawned subagents must also carry ITS CHILDREN'S tokens, or the org arm gets to
 * delegate its cost off the books — the single most flattering error this harness could make.
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , dir, prefix] = process.argv;
if (!dir) { console.error('usage: attribute-run-tokens.mjs <subagents-dir> [prefix]'); process.exit(2); }

function usageOf(file) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const u = d?.message?.usage;
    if (!u) continue;
    t.input += u.input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0;
    t.turns++;
  }
  return t;
}

const rows = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  // Transcript names carry the spawn name: agent-a<name>-<hash>.jsonl
  const m = f.match(/^agent-a(.+)-[0-9a-f]{8,}\.jsonl$/);
  if (!m) continue;
  const name = m[1];
  if (prefix && !name.startsWith(prefix)) continue;
  const u = usageOf(path.join(dir, f));
  rows.push({ name, ...u, total: u.input + u.output + u.cacheRead + u.cacheWrite,
              mtime: fs.statSync(path.join(dir, f)).mtimeMs });
}

// Same-name reruns: newest wins, matching the reconstruction script's rule. Blending runs is the
// error that nearly corrupted the routing artifact; it is not repeated here.
const newest = new Map();
for (const r of rows.sort((a, b) => a.mtime - b.mtime)) newest.set(r.name, r);

const out = [...newest.values()].sort((a, b) => a.name.localeCompare(b.name));
for (const r of out) {
  console.log(JSON.stringify({
    name: r.name, turns: r.turns, input: r.input, output: r.output,
    cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, tokens: r.total,
  }));
}
if (!out.length) console.error(`no transcripts matched prefix "${prefix}"`);
