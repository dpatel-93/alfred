#!/usr/bin/env node
/**
 * Collect orchestration-eval run results from transcripts, REFUSING to score incomplete runs.
 *
 *   node brain/scripts/collect-run.mjs <subagents-dir> <prefix>
 *
 * WHY THIS EXISTS, and it is not a nicety. Twice in one session a result was read off a transcript
 * that was still being written, and both times the wrong number was published:
 *
 *   - the stage-1 headline included a scenario whose token totals were mid-flight, which handed
 *     ALFRED a completion edge and its only cheaper-than-baseline result;
 *   - the same scenario's baseline was scored as failing to flag a policy conflict, when in fact
 *     it flags it in the final summary it had not yet emitted.
 *
 * Both errors ran in the same direction — they flattered the system being evaluated — and neither
 * was a reasoning failure. They were failures to check whether the thing being measured had
 * finished. Vigilance does not fix that; a refusal does.
 *
 * COMPLETION IS DEFINED BY THE CONTRACT, not by heuristics: a run is complete iff its last
 * assistant message parses as the JSON object the prompt demanded. An agent still mid-build has
 * prose there, not a contract object. Anything else — a hung run, a dead run, a run that ignored
 * the output format — is INCOMPLETE and is not scored, because a partial transcript is not a
 * cheaper version of a result, it is a different result.
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , dir, prefix] = process.argv;
if (!dir || !prefix) { console.error('usage: collect-run.mjs <subagents-dir> <prefix>'); process.exit(2); }

function brace(t) {
  const out = []; let d = 0, st = null;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') { if (d === 0) st = i; d++; }
    else if (t[i] === '}') { d--; if (d === 0 && st !== null) { out.push(t.slice(st, i + 1)); st = null; } }
  }
  return out;
}

function readRun(file) {
  let last = '', u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, turns = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const usage = d?.message?.usage;
    if (usage) {
      u.input += usage.input_tokens || 0; u.output += usage.output_tokens || 0;
      u.cacheRead += usage.cache_read_input_tokens || 0; u.cacheWrite += usage.cache_creation_input_tokens || 0;
      turns++;
    }
    const c = d?.message?.content;
    if (!c || d.type !== 'assistant') continue;
    const s = typeof c === 'string' ? c : c.filter((x) => x && typeof x.text === 'string').map((x) => x.text).join(' ');
    if (s.trim()) last = s.trim();
  }
  // The contract object must be the LAST thing said, not merely present somewhere. An agent that
  // emitted the shape early and then kept working has not finished.
  let result = null;
  for (const b of brace(last).reverse()) {
    try { const o = JSON.parse(b); if ('agents_spawned' in o) { result = o; break; } } catch { /* not it */ }
  }
  return { result, tokens: u.input + u.output + u.cacheRead + u.cacheWrite, turns, tail: last.slice(-110) };
}

const runs = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  const m = f.match(/^agent-a(.+)-[0-9a-f]{8,}\.jsonl$/);
  if (!m || !m[1].startsWith(prefix)) continue;
  const p = path.join(dir, f);
  const mtime = fs.statSync(p).mtimeMs;
  const prev = runs.get(m[1]);
  if (prev && prev.mtime > mtime) continue;      // newest wins; never blend runs
  runs.set(m[1], { name: m[1], mtime, ...readRun(p) });
}

const all = [...runs.values()].sort((a, b) => a.name.localeCompare(b.name));
const done = all.filter((r) => r.result);
const pending = all.filter((r) => !r.result);

for (const r of done) {
  console.log(JSON.stringify({ name: r.name, tokens: r.tokens, turns: r.turns,
                               agents_spawned: r.result.agents_spawned, did: r.result.did }));
}
console.error(`\ncomplete ${done.length}/${all.length}`);
for (const r of pending) console.error(`  INCOMPLETE ${r.name} — ${r.turns} turns, ${(r.tokens / 1e6).toFixed(2)}M so far — "${r.tail}"`);
if (pending.length) {
  console.error(`\nREFUSING TO SCORE. ${pending.length} run(s) have not emitted their contract object.`);
  console.error('Scoring a running transcript published a wrong number twice; it does not get a third.');
  process.exit(1);
}
