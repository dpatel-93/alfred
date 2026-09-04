// Alfred CLI query — semantic search over the vault index.
// Usage: node query.mjs "question" [--k 8] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankChunks, cosineSim } from './retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, 'index.json');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';
const STALE_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = { k: 8, json: false, query: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--k') {
      args.k = parseInt(argv[++i], 10) || 8;
    } else if (argv[i] === '--json') {
      args.json = true;
    } else {
      rest.push(argv[i]);
    }
  }
  args.query = rest.join(' ');
  return args;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('Usage: node query.mjs "question" [--k 8] [--json]');
    process.exit(1);
  }

  if (!fs.existsSync(INDEX_PATH)) {
    console.error('[alfred] index.json not found — run: node index-vault.mjs');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const ageMs = Date.now() - new Date(index.generatedAt).getTime();
  if (ageMs > STALE_MS) {
    console.error(`[alfred] WARN: index is ${(ageMs / 3600000).toFixed(1)}h old — consider: node index-vault.mjs`);
  }

  let qVec;
  try {
    qVec = await embed(`search_query: ${args.query}`);
  } catch (err) {
    console.error(`[alfred] embed failed: ${err.message}`);
    process.exit(1);
  }

  // index-vault.mjs (data-pipeline-eng) attaches `notes[i].chunks` once the
  // chunk pipeline is wired up. Until then no note has a `chunks` field yet,
  // so we fall back to the pre-chunking note-level ranking rather than
  // silently returning nothing.
  const hasChunks = index.notes.some((n) => Array.isArray(n.chunks) && n.chunks.length > 0);

  let results;
  if (hasChunks) {
    results = rankChunks({ notes: index.notes, queryVector: qVec, queryText: args.query, topK: args.k });
  } else {
    results = index.notes
      .filter((n) => Array.isArray(n.vector))
      .map((n) => ({
        score: cosineSim(qVec, n.vector),
        folder: n.folder,
        title: n.title,
        path: n.path,
        heading: null,
        headingPath: null,
        text: n.excerpt,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, args.k);
  }

  if (args.json) {
    console.log(JSON.stringify(results.map(({ score, folder, title, path: p, heading, headingPath, text }) => ({
      score, folder, title, path: p, heading, headingPath, text,
    })), null, 2));
    return;
  }

  for (const { score, folder, title, path: p, headingPath, text } of results) {
    const firstLine = text.split('\n').find((l) => l.trim()) || '';
    const where = headingPath ? `${folder}/${title} > ${headingPath}` : `${folder}/${title}`;
    console.log(`${score.toFixed(4)} | ${where} | ${firstLine.slice(0, 80)} | ${p}`);
  }
}

main();
