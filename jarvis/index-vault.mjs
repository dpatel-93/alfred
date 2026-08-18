// Alfred vault indexer - walks the Obsidian vault, embeds notes via local Ollama,
// and writes index.json. Incremental: unchanged mtimes are kept, only new/modified
// notes get re-embedded.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---
// ALFRED_VAULT is the current name; JARVIS_VAULT is read as a fallback for one
// release so anyone with the old env var set doesn't silently lose their config.
const VAULT_DIR = process.env.ALFRED_VAULT || process.env.JARVIS_VAULT || 'C:\\Users\\dishi\\OneDrive\\Desktop\\_Projects\\Alfred-Brain';
const INDEX_PATH = path.join(__dirname, 'index.json');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';
// Retired claude-flow-era note copies live in _Archive — never index them.
const SKIP_DIRS = new Set(['.obsidian', 'Templates', '.git', 'node_modules', '_Archive']);
const EXCERPT_LEN = 400;
const EMBED_CHARS = 2000;
const USAGE_LOG_PATH = path.join(os.homedir(), '.claude', 'metrics', 'ollama-usage.jsonl');

// --- Usage logging (same shape as ~/.claude/helpers/intern-run.mjs, batched
// into one line per indexing run so /tokens can see embedding load) ---
function logUsage({ model, promptEvalCount, durationMs }) {
  try {
    fs.mkdirSync(path.dirname(USAGE_LOG_PATH), { recursive: true });
    fs.appendFileSync(USAGE_LOG_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      model,
      prompt_eval_count: promptEvalCount,
      eval_count: 0,
      duration_ms: durationMs,
    }) + '\n');
  } catch {
    // usage logging is best-effort — never fail indexing over it
  }
}

// --- Vault walking ---
function walkVault(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walkVault(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

function topLevelFolder(vaultDir, filePath) {
  const rel = path.relative(vaultDir, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : '(root)';
}

// --- Wiki-link parsing ---
// Matches [[Target]] or [[Target|Alias]] or [[Path/To/Target#heading]]
function parseWikiLinks(content) {
  const links = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[1].trim();
    if (raw) links.push(raw);
  }
  return links;
}

// Resolve a wiki-link target (path form or bare name) to a note "key" -
// we use the bare filename (no extension) as the resolution key since that's
// how Obsidian primarily resolves links within a vault of unique-ish names.
function linkKey(target) {
  const base = target.split('/').pop().split('\\').pop();
  return base.trim().toLowerCase();
}

function noteKey(title) {
  return title.trim().toLowerCase();
}

// --- Ollama embedding ---
async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return {
    vector: data.embeddings[0],
    promptEvalCount: data.prompt_eval_count ?? 0,
    durationMs: Math.round((data.total_duration ?? 0) / 1e6),
  };
}

// Keyword shortlist per note, so search still works with no vectors at all.
// Storing the full body would multiply index.json by the size of the vault;
// the most frequent distinct terms carry nearly all the recall for a fraction
// of the bytes.
const STOPWORDS = new Set(('the a an and or but if then else of to in on at for with from by as is are was were be been '
  + 'being it its this that these those i you he she we they them his her their our your not no yes do does did done '
  + 'can could should would will just so than too very more most some any all each into out up down over under again '
  + 'about which who whom what when where why how there here also new use used using via per vs etc').split(' '));
const KEYWORD_LIMIT = 40;

function extractKeywords(text) {
  const freq = new Map();
  const tokens = String(text).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, KEYWORD_LIMIT)
    .map(([t]) => t);
}

// --- Main indexing logic ---
async function buildIndex({ vaultDir = VAULT_DIR, indexPath = INDEX_PATH, log = console.log } = {}) {
  const startTime = Date.now();
  let existing = { notes: [] };
  if (fs.existsSync(indexPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch {
      log('[alfred] index.json unreadable, rebuilding from scratch');
    }
  }
  const existingByPath = new Map(existing.notes.map((n) => [n.path, n]));

  const files = walkVault(vaultDir);
  log(`[alfred] found ${files.length} markdown files in vault`);

  const notes = [];
  let embedded = 0;
  let reused = 0;
  let unembedded = 0;
  let usagePromptEval = 0;
  let usageDurationMs = 0;

  for (const filePath of files) {
    const relPath = path.relative(vaultDir, filePath).split(path.sep).join('/');
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const prior = existingByPath.get(relPath);

    // A note that was indexed lexically because Ollama was down is NOT up to
    // date — reusing it would mean it never gets its vector once Ollama is
    // back, so an unembedded entry is always retried.
    if (prior && prior.mtime === mtime && Array.isArray(prior.vector)) {
      notes.push(prior);
      reused++;
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      log(`[alfred] WARN: could not read ${relPath}: ${err.message}`);
      continue;
    }

    const title = path.basename(filePath, '.md');
    const folder = topLevelFolder(vaultDir, filePath);
    const excerpt = content.slice(0, EXCERPT_LEN).trim();
    const links = parseWikiLinks(content);
    // nomic-embed-text is trained with task prefixes — "search_document:" for
    // indexed content, "search_query:" for queries (see query.mjs / server.mjs).
    // Omitting these measurably hurts retrieval quality (generic notes outrank
    // exact matches).
    const embedInput = `search_document: ${title}\n\n${content.slice(0, EMBED_CHARS)}`;

    const keywords = extractKeywords(title + ' ' + content);

    let result = null;
    try {
      result = await embed(embedInput);
    } catch (err) {
      // Dropping the note here is what used to empty the entire brain whenever
      // Ollama was unreachable: three failed embeds, zero notes indexed, no
      // search, no graph, no ask context. It goes in without a vector instead
      // and stays findable by keyword until it can be embedded.
      unembedded++;
      if (unembedded === 1) log(`[alfred] WARN: embed failed (${err.message}) — indexing lexically only`);
      notes.push({ path: relPath, title, folder, mtime, excerpt, links, vector: null, keywords });
      continue;
    }

    embedded++;
    usagePromptEval += result.promptEvalCount;
    usageDurationMs += result.durationMs;
    log(`[alfred] embedded (${embedded}) ${relPath}`);

    notes.push({ path: relPath, title, folder, mtime, excerpt, links, vector: result.vector, keywords });
  }

  const index = { generatedAt: new Date().toISOString(), notes };
  fs.writeFileSync(indexPath, JSON.stringify(index));

  if (embedded > 0) {
    logUsage({ model: EMBED_MODEL, promptEvalCount: usagePromptEval, durationMs: usageDurationMs });
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const lexNote = unembedded ? `, ${unembedded} keyword-only` : '';
  log(`[alfred] index complete: ${notes.length} notes (${embedded} embedded, ${reused} reused${lexNote}) in ${elapsedSec}s`);
  if (unembedded) log('[alfred] re-run indexing once Ollama is up to add vectors for those notes');

  return index;
}

// --- CLI entrypoint ---
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  buildIndex().catch((err) => {
    console.error('[alfred] indexing failed:', err);
    process.exit(1);
  });
}

export { buildIndex, parseWikiLinks, linkKey, noteKey, topLevelFolder, VAULT_DIR, INDEX_PATH };
