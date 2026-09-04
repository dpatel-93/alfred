#!/usr/bin/env node
/**
 * Re-extract a routing-eval results file from RETAINED SUBAGENT TRANSCRIPTS.
 *
 *   node brain/scripts/reextract-routing-run.mjs <subagents-dir> <out.jsonl>
 *
 * WHY THIS EXISTS. The R3 run's capture step persisted only owner/depth/topology, so the three
 * required classification fields — stakes, blocking_premises, gate — were emitted by the router and
 * then dropped on the floor. Field compliance scored 0/24 against an artifact that had never been
 * asked to carry the fields, which made the intervention's emission rate unmeasurable.
 *
 * The raw transcripts survived. That makes the fix free: re-derive the results file from the
 * ORIGINAL responses with a capture step that keeps everything, and the retroactive number belongs
 * to the very run that set the shipped figures. No re-run, no tokens, no new evidence invented — the
 * router's answers are exactly what they were, only fully recorded this time.
 *
 * Matching is done by the REQUEST text carried in each transcript's prompt, against the case
 * questions, so a transcript can never be attributed to the wrong case by ordering assumptions.
 *
 * RUN DISAMBIGUATION, and why it is not optional. The transcript directory accumulates EVERY run —
 * r2, r3 and r4 all live there. A naive last-file-wins extraction silently blends them: the first
 * attempt at this produced a file that disagreed with the recorded run on 5 of 23 cases, including
 * r24 returning its pre-intervention answer. Blending runs would have manufactured a result set no
 * router ever produced. Each case therefore takes its answer from the NEWEST transcript answering
 * it, and --verify checks the reconstruction against the recorded owners/depths. If the two
 * disagree the reconstruction is wrong and must not be used, however plausible it looks.
 */
import fs from 'node:fs';
import path from 'node:path';
import CASES from '../routing-eval-questions.mjs';

const [, , dir, out] = process.argv;
if (!dir || !out) {
  console.error('usage: reextract-routing-run.mjs <subagents-dir> <out.jsonl>');
  process.exit(2);
}

/**
 * Every text block in a transcript, decoded. The transcript is JSONL, so the router's answer is
 * JSON nested inside JSON — regexing the raw file finds only escaped quotes and matches nothing.
 * Parse the envelope first, then look inside.
 */
function textsIn(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const c = d?.message?.content;
    if (!c) continue;
    const s = typeof c === 'string'
      ? c
      : c.filter((x) => x && typeof x.text === 'string').map((x) => x.text).join(' ');
    if (s.trim()) out.push({ role: d.type, text: s });
  }
  return out;
}

/** Pull every {...} block that parses and looks like a routing answer. */
function answersIn(text) {
  const hits = [];
  for (const m of text.matchAll(/\{[^{}]*"owner"\s*:[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]);
      // The RUBRIC itself contains a JSON template with "owner":"<agent name|NONE|CLARIFY>".
      // Skip anything still carrying the placeholder angle brackets — that is the prompt echoed
      // back, not an answer, and counting it would fabricate a result the router never gave.
      if (o && typeof o.owner === 'string' && !/^</.test(o.owner)) hits.push(o);
    } catch { /* not this one */ }
  }
  return hits;
}

const byQ = new Map(CASES.map((c) => [c.q.toLowerCase().slice(0, 50), c.id]));
const rows = new Map();
let scanned = 0, unmatched = 0;

const noAnswer = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  const blocks = textsIn(path.join(dir, f));
  const prompt = blocks.find((b) => b.text.includes('REQUEST:'));
  if (!prompt) continue;
  scanned++;

  // Which case is this transcript answering? Match on the REQUEST line only — matching against the
  // whole transcript would let a preloaded org-index or a quoted example claim the wrong case.
  const req = (prompt.text.match(/REQUEST:\s*"([^"]+)"/) || [])[1] || '';
  let id = null;
  for (const [frag, cid] of byQ) if (req.toLowerCase().startsWith(frag)) { id = cid; break; }
  if (!id) { unmatched++; continue; }

  // Last well-formed answer wins — a router that restates its JSON has refined it. Search only the
  // router's OWN output, never the prompt, so the rubric's template cannot be read back as a reply.
  const found = blocks.filter((b) => b.role === 'assistant').flatMap((b) => answersIn(b.text));
  if (!found.length) { noAnswer.push(id); continue; }
  const a = found[found.length - 1];

  // Newest transcript wins for a given case. Older runs of the same case are earlier experiments,
  // and mixing them would fabricate a result set that never existed as a single run.
  const mtime = fs.statSync(path.join(dir, f)).mtimeMs;
  if (rows.has(id) && rows.get(id)._mtime > mtime) continue;
  rows.set(id, {
    _mtime: mtime,
    id,
    owner: a.owner,
    depth: a.depth,
    review: a.review,
    topology: a.topology,
    stakes: a.stakes,
    blocking_premises: a.blocking_premises,
    gate: a.gate,
    why: a.why,
  });
}

for (const r of rows.values()) delete r._mtime;
const lines = CASES.filter((c) => rows.has(c.id)).map((c) => JSON.stringify(rows.get(c.id)));
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');

const FIELDS = ['owner', 'depth', 'topology', 'stakes', 'blocking_premises', 'gate', 'why'];
const complete = [...rows.values()].filter((r) => FIELDS.every((k) => r[k] !== undefined && r[k] !== ''));
console.log(`scanned ${scanned} transcripts · matched ${rows.size}/${CASES.length} cases`
          + `${unmatched ? ` · ${unmatched} unmatched` : ''}`);
console.log(`field-complete: ${complete.length}/${rows.size}`);
for (const c of CASES) if (!rows.has(c.id)) console.log(`  MISSING ${c.id}`);

// VERIFY against the recorded run. This is the whole reason the reconstruction can be trusted: if
// the rebuilt owners and depths do not reproduce the file the shipped numbers came from, then the
// rebuild is drawing on some other run and every field recovered from it is attributed to a result
// set that never existed.
const verifyAgainst = process.argv[4];
if (verifyAgainst) {
  const rec = new Map(fs.readFileSync(verifyAgainst, 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).map((r) => [r.id, r]));
  let agree = 0; const disagree = [];
  for (const [id, r] of rows) {
    const o = rec.get(id);
    if (!o) continue;
    // Recorded rows predate the depth split, so compare on the recorded vocabulary.
    if (o.owner === r.owner && o.depth === r.depth) agree++;
    else disagree.push(`${id}: recorded ${o.owner}/${o.depth} vs rebuilt ${r.owner}/${r.depth}`);
  }
  console.log(`\nverify vs ${path.basename(verifyAgainst)}: ${agree} agree, ${disagree.length} disagree`);
  for (const d of disagree) console.log(`  ${d}`);
  if (disagree.length) {
    console.log('\nRECONSTRUCTION REJECTED — it does not reproduce the recorded run. Do not score it.');
    process.exit(1);
  }
}
console.log(`-> ${out}`);
