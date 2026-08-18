// Alfred CLI query — semantic search over the vault index.
// Usage: node query.mjs "question" [--k 8] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
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

  const scored = index.notes
    .filter((n) => Array.isArray(n.vector))
    .map((n) => ({ note: n, score: cosineSim(qVec, n.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, args.k);

  if (args.json) {
    console.log(JSON.stringify(scored.map(({ note, score }) => ({
      score, folder: note.folder, title: note.title, path: note.path, excerpt: note.excerpt,
    })), null, 2));
    return;
  }

  for (const { note, score } of scored) {
    const firstLine = note.excerpt.split('\n').find((l) => l.trim()) || '';
    console.log(`${score.toFixed(4)} | ${note.folder}/${note.title} | ${firstLine.slice(0, 80)} | ${note.path}`);
  }
}

main();
