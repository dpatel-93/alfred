// Recall-proof harness for the chunk-retrieval work in retrieval.mjs.
//
// Computes a real BEFORE/AFTER recall table over the 6 ground-truth
// questions in eval-questions.mjs:
//   BEFORE = note-level ranking with excerpt-only visibility, reproducing
//            server.mjs's LIVE rankNotes()/queryTerms()/lexicalScore()
//            (read verbatim at server.mjs lines ~2291-2343 as of this
//            writing) as a standalone, side-effect-free copy in this file.
//            server.mjs is NEVER imported here — importing it boots an HTTP
//            server as a side effect and would collide with a live instance
//            already running on :7777.
//   AFTER  = rankChunks() from ./retrieval.mjs, visibility = each result's
//            own chunk .text (not the note excerpt).
//
// Usage: node retrieval-eval.mjs [--k 5]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankChunks } from './retrieval.mjs';
import { EVAL_QUESTIONS } from './eval-questions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Point this at a SNAPSHOT, not the live file, whenever the suite might run.
// test/run.mjs swaps brain/index.json for a 3-note fixture for the duration of
// a run — by design — so an eval that reads the live path mid-run scores 0% and
// looks like a retrieval failure. That produced two contradictory recall
// measurements today before anyone noticed the index was the variable.
const INDEX_PATH = process.env.ALFRED_EVAL_INDEX || path.join(__dirname, 'index.json');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';

function parseArgs(argv) {
  let k = 5;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--k') k = parseInt(argv[++i], 10) || 5;
  }
  return { k };
}

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embeddings[0];
}

// --- standalone reproduction of server.mjs's LIVE BEFORE ranking ----------
// (see header comment — never imported from server.mjs)
function queryTerms(q) {
  return [...new Set((String(q).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []))];
}
function lexicalScore(terms, note) {
  if (!terms.length) return 0;
  const title = String(note.title || '').toLowerCase();
  const folder = String(note.folder || '').toLowerCase();
  const excerpt = String(note.excerpt || '').toLowerCase();
  const keywords = new Set(note.keywords || []);
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 3;
    if (keywords.has(t)) score += 1.5;
    if (excerpt.includes(t)) score += 1;
    if (folder.includes(t)) score += 0.5;
  }
  return score / (terms.length * 3);
}
function cosineSimLocal(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
function rankNotesBefore(notes, qVec, q, limit) {
  const terms = queryTerms(q);
  const scored = notes.map((n) => {
    const lex = lexicalScore(terms, n);
    const sem = qVec && Array.isArray(n.vector) ? cosineSimLocal(qVec, n.vector) : null;
    const score = sem == null ? lex : sem * 0.8 + lex * 0.2;
    return { score, title: n.title, folder: n.folder, path: n.path, text: n.excerpt || '' };
  });
  return scored.filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
// ---------------------------------------------------------------------------

function containsSubstring(text, sub) {
  return String(text || '').toLowerCase().includes(String(sub).toLowerCase());
}
function recallAtK(results, sub, k) {
  return results.slice(0, k).some((r) => containsSubstring(r.text, sub));
}
function whereFor(r, isChunk) {
  if (!r) return '(no result)';
  const base = `${r.folder}/${r.title}`;
  return isChunk && r.headingPath ? `${base} > ${r.headingPath}  [${r.path}]` : `${base}  [${r.path}]`;
}

async function main() {
  const { k } = parseArgs(process.argv.slice(2));
  const kMax = Math.max(k, 5);

  if (!fs.existsSync(INDEX_PATH)) {
    console.error('[eval] index.json not found — run: node index-vault.mjs');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const notes = Array.isArray(index.notes) ? index.notes : [];

  if (notes.length < 60) {
    console.log('!'.repeat(70));
    console.log(`WARNING: index.json has only ${notes.length} notes — this looks like the`);
    console.log('test fixture, NOT the real vault. Run: node index-vault.mjs');
    console.log('Continuing anyway, but recall numbers below are not meaningful.');
    console.log('!'.repeat(70));
  }

  const perQuestion = [];

  for (const eq of EVAL_QUESTIONS) {
    let qVec = null;
    let embedError = null;
    try {
      qVec = await embed(`search_query: ${eq.q}`);
    } catch (err) {
      embedError = err.message;
      console.log(`[eval] embed failed for ${eq.id}: ${embedError} — continuing (keyword-only BEFORE, keyword-fallback AFTER)`);
    }

    const before = rankNotesBefore(notes, qVec, eq.q, kMax);
    const after = rankChunks({ notes, queryVector: qVec, queryText: eq.q, topK: kMax });

    const row = {
      id: eq.id,
      q: eq.q,
      substring: eq.substring,
      embedError,
      before: {
        r1: recallAtK(before, eq.substring, 1),
        r3: recallAtK(before, eq.substring, 3),
        r5: recallAtK(before, eq.substring, 5),
        top1: before[0] || null,
      },
      after: {
        r1: recallAtK(after, eq.substring, 1),
        r3: recallAtK(after, eq.substring, 3),
        r5: recallAtK(after, eq.substring, 5),
        top1: after[0] || null,
      },
    };

    if (eq.mustNotSurfaceSubstring) {
      row.forbidden = {
        substring: eq.mustNotSurfaceSubstring,
        beforeHasForbidden: before[0] ? containsSubstring(before[0].text, eq.mustNotSurfaceSubstring) : false,
        afterHasForbidden: after[0] ? containsSubstring(after[0].text, eq.mustNotSurfaceSubstring) : false,
      };
    }

    perQuestion.push(row);
  }

  console.log('\n=== per-question recall (BEFORE = note-level/excerpt-only, AFTER = rankChunks) ===');
  for (const r of perQuestion) {
    console.log(`\n[${r.id}] "${r.q}"`);
    console.log(`  substring: "${r.substring}"`);
    console.log(`  BEFORE  r@1=${r.before.r1}  r@3=${r.before.r3}  r@5=${r.before.r5}`);
    console.log(`    top1: ${whereFor(r.before.top1, false)}`);
    console.log(`  AFTER   r@1=${r.after.r1}  r@3=${r.after.r3}  r@5=${r.after.r5}`);
    console.log(`    top1: ${whereFor(r.after.top1, true)}`);
    if (r.forbidden) {
      console.log(`  FORBIDDEN check ("${r.forbidden.substring}"): BEFORE top1 has it=${r.forbidden.beforeHasForbidden}   AFTER top1 has it=${r.forbidden.afterHasForbidden}`);
    }
    if (r.embedError) console.log(`  (embed failed: ${r.embedError})`);
  }

  console.log('\n=== aggregate recall@k across all questions ===');
  const total = perQuestion.length;
  for (const kk of [1, 3, 5]) {
    const beforeHits = perQuestion.filter((r) => r.before[`r${kk}`]).length;
    const afterHits = perQuestion.filter((r) => r.after[`r${kk}`]).length;
    console.log(`  recall@${kk}:  BEFORE ${beforeHits}/${total} (${((100 * beforeHits) / total).toFixed(1)}%)   AFTER ${afterHits}/${total} (${((100 * afterHits) / total).toFixed(1)}%)`);
  }

  console.log('\nDone.');
}

main();
