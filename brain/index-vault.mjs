// Alfred vault indexer - walks the Obsidian vault, embeds notes via local Ollama,
// and writes index.json. Incremental: unchanged mtimes are kept, only new/modified
// notes get re-embedded.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chunkNote, buildEmbedText } from './retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---
// ALFRED_VAULT is the current name; JARVIS_VAULT is read as a fallback for one
// release so anyone with the old env var set doesn't silently lose their config.
//
// The final fallback used to be the original author's own vault path. On any
// other machine that resolved to a directory that does not exist, which the
// walker treats as an empty vault — the same graceful degradation as having no
// vault at all, but arrived at by accident and reading like a leftover. It is
// now `Alfred-Brain` beside the repo, which is where the installer and the
// onboarding conversation both put a new vault, so an unconfigured install
// lands somewhere plausible instead of somewhere personal.
const DEFAULT_VAULT = path.join(__dirname, '..', '..', 'Alfred-Brain');

// Resolved on every call, not once at import. The HUD's Settings panel writes
// the brain location to ~/.alfred/config.json, and a value that was captured
// at module load would mean "saved, but the server keeps reading the old
// folder until you restart it" — a setting that appears to work and does not.
// Read directly with fs rather than importing the server's config helper:
// this module is also a CLI (`node index-vault.mjs`) and must not depend on it.
const LOCAL_CONFIG = path.join(os.homedir(), '.alfred', 'config.json');

function configuredVault() {
  try {
    const v = JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8')).vaultPath;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch { return null; } // missing or corrupt config — fall through to the default
}

// Env wins over the settings file, matching how the cloud key already behaves:
// a variable set deliberately in the environment should not be silently
// overridden by something typed into a web page.
// ALFRED_VAULT is the current name; JARVIS_VAULT is the one-release fallback.
function resolveVaultDir() {
  return process.env.ALFRED_VAULT || process.env.JARVIS_VAULT || configuredVault() || DEFAULT_VAULT;
}
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

// A prior entry's chunks are only trustworthy for reuse if every chunk in it
// already carries a vector — mirrors the note-level rule just above
// (Array.isArray(prior.vector)) rather than inventing a separate convention.
// An entry with no `chunks` field at all (index built before this feature
// landed) or with any null chunk vector is treated as not fully up to date.
function chunksUpToDate(chunks) {
  return Array.isArray(chunks) && chunks.every((c) => c && Array.isArray(c.vector));
}

// --- Main indexing logic ---
async function buildIndex({ vaultDir = resolveVaultDir(), indexPath = INDEX_PATH, log = console.log } = {}) {
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
  let chunksEmbedded = 0;
  let chunksReused = 0;
  let chunksFailed = 0;

  for (const filePath of files) {
    const relPath = path.relative(vaultDir, filePath).split(path.sep).join('/');
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const prior = existingByPath.get(relPath);

    // A note that was indexed lexically because Ollama was down is NOT up to
    // date — reusing it would mean it never gets its vector once Ollama is
    // back, so an unembedded entry is always retried. Same philosophy now
    // extends to chunks: a prior entry missing `chunks` (pre-dates this
    // feature) or with any chunk missing a vector is also re-run through the
    // full block below rather than reused, so it eventually catches up.
    if (prior && prior.mtime === mtime && Array.isArray(prior.vector) && chunksUpToDate(prior.chunks)) {
      notes.push(prior);
      reused++;
      chunksReused += prior.chunks.length;
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

    // Chunking is pure text-splitting (no network call) so it always runs on
    // the FULL content, regardless of whether the note-level embed below
    // succeeds — this is what actually fixes retrieval for notes longer than
    // EMBED_CHARS, since the note-level vector/excerpt stay truncated as before.
    const chunkRecords = chunkNote({ title, content });

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
      // Ollama already just failed for this note — don't bother calling embed()
      // again per chunk, every chunk degrades to vector: null immediately.
      const chunks = chunkRecords.map((c) => ({ ...c, vector: null }));
      chunksFailed += chunks.length;
      notes.push({ path: relPath, title, folder, mtime, excerpt, links, vector: null, keywords, chunks });
      continue;
    }

    embedded++;
    usagePromptEval += result.promptEvalCount;
    usageDurationMs += result.durationMs;
    log(`[alfred] embedded (${embedded}) ${relPath}`);

    // Each chunk is embedded independently — one chunk's Ollama failure (e.g.
    // Ollama goes down mid-run) degrades just that chunk to vector: null
    // rather than aborting the note or the run.
    const chunks = [];
    for (const chunk of chunkRecords) {
      let chunkVector = null;
      try {
        const chunkResult = await embed(buildEmbedText({ noteTitle: title, chunk }));
        chunkVector = chunkResult.vector;
        chunksEmbedded++;
        usagePromptEval += chunkResult.promptEvalCount;
        usageDurationMs += chunkResult.durationMs;
      } catch (err) {
        chunksFailed++;
        if (chunksFailed === 1) log(`[alfred] WARN: chunk embed failed (${err.message}) — chunk indexed without vector`);
      }
      chunks.push({ ...chunk, vector: chunkVector });
    }

    notes.push({ path: relPath, title, folder, mtime, excerpt, links, vector: result.vector, keywords, chunks });
  }

  const index = { generatedAt: new Date().toISOString(), notes };
  fs.writeFileSync(indexPath, JSON.stringify(index));

  if (embedded > 0) {
    logUsage({ model: EMBED_MODEL, promptEvalCount: usagePromptEval, durationMs: usageDurationMs });
  }

  const totalChunks = notes.reduce((sum, n) => sum + (Array.isArray(n.chunks) ? n.chunks.length : 0), 0);

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const lexNote = unembedded ? `, ${unembedded} keyword-only` : '';
  log(`[alfred] index complete: ${notes.length} notes (${embedded} embedded, ${reused} reused${lexNote}) in ${elapsedSec}s`);
  log(`[alfred] chunks: ${totalChunks} across ${notes.length} notes (${chunksEmbedded} embedded, ${chunksReused} reused, ${chunksFailed} failed)`);
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

export { buildIndex, parseWikiLinks, linkKey, noteKey, topLevelFolder, resolveVaultDir, INDEX_PATH, SKIP_DIRS };
