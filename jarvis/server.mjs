// Alfred server — serves the HUD UI and a small API over the vault index.
// Core (index/graph/search/note/ask) is dependency-free node:http +
// node:fs/path/os only. Voice output (/api/tts) is the one place this pulls
// in real npm packages: kokoro-js (local TTS) and msedge-tts (online fallback).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIndex, linkKey, noteKey, VAULT_DIR } from './index-vault.mjs';
// kokoro-js and msedge-tts are imported lazily inside the TTS paths below.
// They are the only npm dependencies in the whole server, and a static import
// makes them a hard requirement for booting at all — including with
// ALFRED_TTS_MODE=off, and including for the test suite, which has no use for
// an 80MB ONNX runtime.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---
const PORT = parseInt(process.env.PORT, 10) || 7777;
// Loopback only, always. Binding 0.0.0.0 would expose a shell-execution bridge
// to the LAN — there is no configuration switch for this on purpose.
const BIND_HOST = '127.0.0.1';
const FRIENDLY_PORT = 80;
const INDEX_PATH = path.join(__dirname, 'index.json');
const UI_PATH = path.join(__dirname, 'ui.html');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';
// Default ask model: the 1.5b instruct fits fully in VRAM beside the embedder,
// so spoken answers come back in a few seconds instead of a minute-plus of CPU
// crawl. Override with ALFRED_ASK_MODEL=qwen3.5:4b for higher answer quality
// at the cost of latency. JARVIS_ASK_MODEL is read as a fallback for one release.
const ASK_MODEL = process.env.ALFRED_ASK_MODEL || process.env.JARVIS_ASK_MODEL || 'qwen2.5:1.5b-instruct';
// 'haiku' (default): a one-shot `claude -p ... --model haiku` turn via the
// bridge's own claude.exe resolution — a few seconds, no local model to warm
// up. 'ollama': the original local qwen path above. Haiku failing/timing out
// falls back to ollama automatically regardless of which is configured.
const ASK_ENGINE = process.env.ALFRED_ASK_ENGINE || 'haiku';
const ASK_HAIKU_TIMEOUT_MS = 30 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const USAGE_LOG_PATH = path.join(os.homedir(), '.claude', 'metrics', 'ollama-usage.jsonl');

// --- TTS configuration ---
// 'local'  (default): Kokoro (on-device) first, msedge-tts (online) as fallback.
// 'online': msedge-tts first, Kokoro as fallback.
// 'off':    /api/tts always 503s; the UI falls back to browser speechSynthesis.
const TTS_MODE = process.env.ALFRED_TTS_MODE || 'local';
const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_VOICE = process.env.ALFRED_TTS_VOICE || 'bm_george';
const EDGE_VOICE = 'en-GB-RyanNeural';

// Lazy-loaded on first /api/tts call so the ~80MB model never blocks server
// boot. kokoroLoadPromise is memoized so concurrent first-callers share one
// load instead of racing to load the model twice.
let kokoroLoadPromise = null;
function loadKokoro() {
  if (!kokoroLoadPromise) {
    kokoroLoadPromise = import('kokoro-js')
      .then((m) => m.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: 'q8' }));
  }
  return kokoroLoadPromise;
}

// Reported via /api/status so the HUD can show which engine is live.
let ttsEngineState = TTS_MODE === 'off' ? 'off' : 'loading';
// Which engine actually answered the last /api/ask call — starts as the
// configured default, updates after every call to reflect real fallbacks.
let lastAskEngine = ASK_ENGINE;

// --- Mission Control (OBSERVE side, read-only) configuration ---
const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ORG_ACTIVE_MS = 20 * 1000;
const USAGE_CACHE_MS = 60 * 1000;
const USAGE_WINDOW_HOURS = 24;

// --- Dev surface (GET /api/projects) configuration ---
const DEFAULT_PROJECT_ROOT = path.join(os.homedir(), 'OneDrive', 'Desktop', '_Projects');
const PROJECT_ROOTS = (process.env.ALFRED_PROJECT_ROOTS || DEFAULT_PROJECT_ROOT)
  .split(';').map((p) => p.trim()).filter(Boolean);
const PROJECTS_CACHE_MS = 15 * 1000;
const GIT_CONCURRENCY = 6;
// The vault's Projects/ note titles genuinely diverge from the repo folder
// names in a handful of cases — curated here rather than guessed at request
// time. See DESIGN-UX-SPEC §2.1.5.
const PROJECT_NOTE_ALIASES = {
  'Plugins': 'Projects/Prism.md',
  'Alfred': 'Projects/Alfred.md',
  'DailyUpdates': 'Projects/DailyUpdates.md',
  'TickerQFA': 'Projects/TickerQFA.md',
};

// --- Deish surface (GET /api/deish) configuration — one business, one endpoint ---
const DEISH = {
  repoPath: path.join(PROJECT_ROOTS[0] || DEFAULT_PROJECT_ROOT, 'Plugins'),
  slug: 'dpatel-93/deish-media',
  health: [
    { name: 'Website', url: 'https://www.deishmedia.com' },
    { name: 'Licensing API', url: 'https://deish-api-aggoucydbk3vw.azurewebsites.net/api/health' },
  ],
  downloadsRel: 'website/downloads',
  products: [
    { id: 'prisma', label: 'Prisma Suite', filePrefix: 'PrismaSuite' },
    { id: 'base6ix', label: 'Base6ix', filePrefix: 'Base6ix' },
    { id: 'balance', label: 'Prisma Balance', filePrefix: 'PrismaBalance' },
  ],
  catalogueRel: path.join('website', 'catalogue.mjs'),
};
const DEISH_CACHE_MS = 60 * 1000;

// Running total of tokens (prompt+eval) logged by this server process since it
// started — exposed via /api/status so the HUD can show session intern load.
let sessionInternTokens = 0;

// Same shape as ~/.claude/helpers/intern-run.mjs — one line per embed/generate
// call, so both search and voice-ask load show up in /tokens.
function logUsage({ model, promptEvalCount, evalCount = 0, durationMs }) {
  sessionInternTokens += promptEvalCount + evalCount;
  try {
    fs.mkdirSync(path.dirname(USAGE_LOG_PATH), { recursive: true });
    fs.appendFileSync(USAGE_LOG_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      model,
      prompt_eval_count: promptEvalCount,
      eval_count: evalCount,
      duration_ms: durationMs,
    }) + '\n');
  } catch {
    // best-effort — never fail a request over logging
  }
}

let indexCache = null;
let graphCache = null;

// Cleared on every reindex and on any mtime-detected change to index.json —
// see loadIndex() and handleReindex(). References deishCache/projectsCache,
// which are `let`-declared further down the file; safe because this function
// body isn't evaluated until it's called, by which point module init has
// finished and both bindings are initialized.
function invalidateIndexDerived() {
  graphCache = null;
  deishCache = null;
  projectsCache = null;
}

// --- Index loading / staleness ---
function isIndexStale() {
  if (!fs.existsSync(INDEX_PATH)) return true;
  const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const generatedAt = new Date(idx.generatedAt).getTime();
  if (Date.now() - generatedAt > STALE_MS) return true;
  // any note on disk newer than the index?
  for (const n of idx.notes) {
    const full = path.join(VAULT_DIR, n.path);
    try {
      if (fs.statSync(full).mtimeMs > n.mtime) return true;
    } catch {
      return true; // note deleted/moved — needs reindex
    }
  }
  return false;
}

function loadIndex() {
  let st;
  try { st = fs.statSync(INDEX_PATH); } catch { st = null; } // no valid mtime — fall through to read
  if (indexCache && indexCache.value && st && indexCache.mtimeMs === st.mtimeMs) {
    return indexCache.value;
  }
  const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); // unchanged: throws same as before if missing
  indexCache = { mtimeMs: st ? st.mtimeMs : 0, value: parsed };
  invalidateIndexDerived();
  return indexCache.value;
}

function buildGraph() {
  if (graphCache) return graphCache;
  const index = loadIndex();
  const byKey = new Map(index.notes.map((n) => [noteKey(n.title), n]));

  const degree = new Map();
  const links = [];
  const seen = new Set();

  for (const n of index.notes) {
    for (const rawLink of n.links || []) {
      const target = byKey.get(linkKey(rawLink));
      if (!target || target.path === n.path) continue;
      const pairKey = [n.path, target.path].sort().join('::');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      links.push({ source: n.path, target: target.path });
      degree.set(n.path, (degree.get(n.path) || 0) + 1);
      degree.set(target.path, (degree.get(target.path) || 0) + 1);
    }
  }

  const nodes = index.notes.map((n) => ({
    id: n.path,
    title: n.title,
    folder: n.folder,
    excerpt: n.excerpt,
    path: n.path,
    degree: degree.get(n.path) || 0,
  }));

  graphCache = { nodes, links };
  return graphCache;
}

// --- Ollama helpers ---
async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
  const data = await res.json();
  logUsage({
    model: EMBED_MODEL,
    promptEvalCount: data.prompt_eval_count ?? 0,
    durationMs: Math.round((data.total_duration ?? 0) / 1e6),
  });
  return data.embeddings[0];
}

// Composes a short spoken-style answer from the top matching notes via the
// local qwen3.5:4b intern model. Cold loads can take 10-60s — callers should
// show honest progress, never assume this resolves fast.
async function generate(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ASK_MODEL,
      prompt,
      stream: false,
      // Thinking models (qwen3.x, deepseek-r1) spend the whole token budget on
      // internal reasoning and return an empty visible answer unless disabled.
      // Non-thinking models reject the flag, so only send it where supported.
      ...(/qwen3|deepseek-r1/.test(ASK_MODEL) ? { think: false } : {}),
      // num_ctx capped so the model fits fully in 8GB VRAM — at the default
      // 32k context Ollama spills the model to CPU and answers crawl.
      options: { temperature: 0.3, num_ctx: 4096, num_predict: 256 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
  const data = await res.json();
  logUsage({
    model: ASK_MODEL,
    promptEvalCount: data.prompt_eval_count ?? 0,
    evalCount: data.eval_count ?? 0,
    durationMs: Math.round((data.total_duration ?? 0) / 1e6),
  });
  return data.response ?? '';
}

// --- Text-to-speech ---
// Kokoro produces real WAV via RawAudio#toWav(). msedge-tts has no WAV output
// (only MP3 / WebM-Opus) — we use MP3 and set Content-Type accordingly rather
// than pull in a transcoder; the client trusts the response's Content-Type
// instead of assuming WAV, so both engines play back correctly either way.
async function synthesizeKokoro(text) {
  const tts = await loadKokoro();
  const audio = await tts.generate(text, { voice: KOKORO_VOICE });
  return { buffer: Buffer.from(audio.toWav()), contentType: 'audio/wav' };
}

async function synthesizeEdge(text) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks = await new Promise((resolve, reject) => {
    const parts = [];
    audioStream.on('data', (chunk) => parts.push(chunk));
    audioStream.on('end', () => resolve(parts));
    audioStream.on('error', reject);
  });
  return { buffer: Buffer.concat(chunks), contentType: 'audio/mpeg' };
}

// --- Mission Control: org chart (OBSERVE side, read-only) ---
// Three sources merged into one payload: the static agent roster (always
// present, so the whole company shows even when idle), live session/subagent
// activity tailed from Claude Code's own transcripts, and locally-loaded
// Ollama "interns". Nothing here executes or spawns anything — every read is
// either a stat, a bounded tail-read, or a fixed-argument execFile.

function modelToTier(model) {
  if (!model) return 'unknown';
  const m = String(model).toLowerCase();
  if (m.includes('fable')) return 'csuite';
  if (m.includes('opus')) return 'vp';
  if (m.includes('sonnet')) return 'manager';
  if (m.includes('haiku')) return 'employee';
  return 'unknown';
}

function walkFiles(dir, ext) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, ext));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

// Minimal frontmatter parser for the flat `key: value` YAML the agent files
// actually use — no need for a full YAML dependency for name/description/model.
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[kv[1]] = val;
  }
  return fm;
}

// --- Org map -----------------------------------------------------------
// Placement rules for agents that cannot carry their own frontmatter. Plugin
// agent files live under a plugin's versioned cache directory, which the
// plugin system rewrites wholesale on update — anything we wrote into them
// would vanish on the next upgrade. So their tier/parent lives here instead.
// Reloaded when the file's mtime changes so edits land without a restart.
const ORG_MAP_PATH = path.join(__dirname, 'org-map.json');
let orgMapCache = { mtimeMs: 0, value: null };

function loadOrgMap() {
  let st;
  try { st = fs.statSync(ORG_MAP_PATH); } catch { return { vps: [], managers: [], agents: {}, rules: [] }; }
  if (orgMapCache.value && orgMapCache.mtimeMs === st.mtimeMs) return orgMapCache.value;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(ORG_MAP_PATH, 'utf8')); } catch (err) {
    console.log(`[alfred] org-map.json unreadable (${err.message}) — falling back to frontmatter only`);
    parsed = { vps: [], managers: [], agents: {}, rules: [] };
  }
  orgMapCache = { mtimeMs: st.mtimeMs, value: parsed };
  return parsed;
}

// Plugin agents: <plugins>/cache/<market>/<plugin>/<ver>/agents/*.md and the
// marketplace mirrors. Both are scanned; cache wins on a name collision since
// that is the copy Claude Code actually launches.
const PLUGIN_ROOT = path.join(os.homedir(), '.claude', 'plugins');

function pluginAgentFiles() {
  const out = [];
  for (const sub of ['cache', 'marketplaces']) {
    const root = path.join(PLUGIN_ROOT, sub);
    if (!fs.existsSync(root)) continue;
    for (const file of walkFiles(root, '.md')) {
      // Only files that actually sit in an `agents/` directory are agents —
      // plugins carry far more .md (skills, docs, references) than agents.
      if (path.basename(path.dirname(file)) !== 'agents') continue;
      out.push({ file, rank: sub === 'cache' ? 0 : 1 });
    }
  }
  return out;
}

// Resolves the manager an unparented agent reports to: explicit mapping first,
// then the first keyword rule that matches its name or description, then the
// configured fallback. Keeps ~90 agents placed without 90 hand-written entries.
function resolveManager(name, description, map) {
  const explicit = map.agents && map.agents[name];
  if (explicit) return explicit;
  const hay = (name + ' ' + description).toLowerCase();
  for (const rule of map.rules || []) {
    let re;
    try { re = new RegExp(rule.match, 'i'); } catch { continue; }
    if (re.test(hay)) return rule.manager;
  }
  return map.fallbackManager || null;
}

function loadRoster() {
  const map = loadOrgMap();
  const managerNames = new Set((map.managers || []).map((m) => m.name.toLowerCase()));
  const vpNames = new Set((map.vps || []).map((v) => v.name.toLowerCase()));

  const byName = new Map(); // lowercased name -> entry (first writer wins)
  const add = (file, fm, origin) => {
    const key = String(fm.name).toLowerCase();
    if (byName.has(key)) return; // user agents are added first and outrank plugins
    const declaredTier = fm.tier || null;
    const declaredParent = fm.parent_mgr || fm.parent_vp || fm.parent || null;

    // A VP or manager named in the org map keeps that rank even if its model
    // would infer something else — seniority is org structure, not model tier.
    // Seniority is org structure, not model tier. Inferring rank from the model
    // made every Opus agent a VP and every Sonnet agent a manager — 11 VPs and
    // 23 managers for a company with 5 and 7. An agent is senior only if it is
    // declared senior (frontmatter tier, or named in the org map's vps/managers
    // lists); everything else is an individual contributor reporting upward,
    // however capable the model behind it.
    let tier = declaredTier;
    if (!tier) {
      if (vpNames.has(key)) tier = 'vp';
      else if (managerNames.has(key)) tier = 'manager';
      else tier = 'employee';
    }

    let parent = declaredParent;
    if (!parent) {
      if (tier === 'vp') parent = null;                       // VPs hang off C-suite
      else if (tier === 'manager') {
        const m = (map.managers || []).find((x) => x.name.toLowerCase() === key);
        parent = m ? m.vp : null;
      } else if (tier === 'employee' || tier === 'intern') {
        parent = resolveManager(fm.name, fm.description || '', map);
      }
    }

    byName.set(key, {
      name: fm.name,
      description: fm.description || '',
      model: fm.model || '',
      tier,
      parent,
      origin,
      plugin: origin === 'plugin' ? path.basename(path.dirname(path.dirname(file))) : null,
    });
  };

  const readFm = (file) => {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const fm = parseFrontmatter(content);
    return fm && fm.name ? fm : null;
  };

  for (const file of walkFiles(AGENTS_DIR, '.md')) {
    const fm = readFm(file);
    if (fm) add(file, fm, 'user');
  }
  for (const { file } of pluginAgentFiles().sort((a, b) => a.rank - b.rank)) {
    const fm = readFm(file);
    if (fm) add(file, fm, 'plugin');
  }

  // Managers/VPs declared in the map but with no agent file yet would leave
  // their reports orphaned mid-chart. Synthesise the missing rungs so the
  // hierarchy is always connected, flagged so the UI can mark them unbuilt.
  for (const m of map.managers || []) {
    if (byName.has(m.name.toLowerCase())) continue;
    byName.set(m.name.toLowerCase(), {
      name: m.name, description: (m.label || '') + ' manager (not yet authored)',
      model: 'sonnet', tier: 'manager', parent: m.vp, origin: 'synthetic', plugin: null,
    });
  }
  for (const v of map.vps || []) {
    if (byName.has(v.name.toLowerCase())) continue;
    byName.set(v.name.toLowerCase(), {
      name: v.name, description: (v.domain || '') + ' VP (not yet authored)',
      model: 'opus', tier: 'vp', parent: null, origin: 'synthetic', plugin: null,
    });
  }

  return [...byName.values()];
}

// --- Per-agent invocation counts ---------------------------------------
// Ranks the roster for the chart's "top N per lane" cut. Counted from the
// sidecar <subagent>.meta.json files rather than the transcripts themselves:
// the sidecars are tiny, so this is a stat+small-read per historical subagent
// run instead of parsing multi-MB JSONL. Cached — the count only changes when
// a new subagent run lands.
const AGENT_USES_CACHE_MS = 60 * 1000;
let agentUsesCache = { at: 0, value: new Map() };

function getAgentUseCounts() {
  const now = Date.now();
  if (now - agentUsesCache.at < AGENT_USES_CACHE_MS) return agentUsesCache.value;
  const counts = new Map();
  for (const { path: file } of getTranscriptIndex()) {
    if (!isSubagentFile(file)) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { continue; }
    const label = meta && (meta.name || meta.agentType);
    if (!label) continue;
    const key = String(label).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  agentUsesCache = { at: now, value: counts };
  return counts;
}

// Reads only the last maxBytes of a (possibly huge, multi-MB) transcript file
// and parses whatever complete JSON lines land in that window — the file is
// never read in full. The first line in the window is likely a partial line
// left over from seeking mid-line, so it's discarded.
function tailJsonl(filePath, maxBytes = 65536) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // partial/malformed line (often the last one, still being written) — skip
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

// Walks backwards through a tailed chunk to find the most recent model, cwd,
// and timestamp without assuming a fixed line shape or position.
function summarizeSessionTail(lines) {
  let model = null, cwd = null, lastTs = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!lastTs && line.timestamp) lastTs = line.timestamp;
    if (!cwd && line.cwd) cwd = line.cwd;
    if (!model && line.type === 'assistant' && line.message && line.message.model) {
      model = line.message.model;
    }
    if (model && cwd && lastTs) break;
  }
  return { model, cwd, lastTs };
}

// One-liners for the side panel: tool name + first 80 chars of its input, or
// a short text snippet. Plain strings only — the client renders these via
// textContent, never innerHTML.
function recentEventSummaries(lines, limit = 15) {
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i];
    if (line.type !== 'assistant' || !line.message || !Array.isArray(line.message.content)) continue;
    for (const block of line.message.content) {
      if (out.length >= limit) break;
      if (block.type === 'tool_use') {
        out.push(`${block.name}: ${JSON.stringify(block.input || {}).slice(0, 80)}`);
      } else if (block.type === 'text' && block.text) {
        out.push(block.text.slice(0, 80));
      }
    }
  }
  return out;
}

function walkJsonlFiles(dir) {
  return walkFiles(dir, '.jsonl');
}

function isSubagentFile(file) {
  return path.basename(path.dirname(file)) === 'subagents';
}

// Shared, TTL-cached listing of every transcript file under PROJECTS_DIR.
// /api/org, /api/usage, and (as of this wave) /api/projects each need this
// walk; without one shared cache every poller re-walks the whole
// ~/.claude/projects tree independently, and that tree only grows. 10s TTL —
// short enough that "just started a session" shows up on the next poll tick,
// long enough to absorb a burst of view-scoped polls hitting at once.
// dirKey = the first path segment under PROJECTS_DIR (the mangled-cwd
// directory a session's transcripts live under); topLevel = true when the
// file sits directly in <PROJECTS_DIR>/<dirKey>/ rather than nested under
// <dirKey>/<parentSessionId>/subagents/.
const TRANSCRIPT_INDEX_TTL_MS = 10 * 1000;
let transcriptIndexCache = null; // { computedAtMs, files }
function getTranscriptIndex() {
  const now = Date.now();
  if (transcriptIndexCache && now - transcriptIndexCache.computedAtMs < TRANSCRIPT_INDEX_TTL_MS) {
    return transcriptIndexCache.files;
  }
  const files = walkJsonlFiles(PROJECTS_DIR).map((file) => {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* file vanished mid-walk — mtimeMs stays 0 */ }
    const rel = path.relative(PROJECTS_DIR, file);
    const parts = rel.split(path.sep);
    return { path: file, mtimeMs, dirKey: parts[0], topLevel: parts.length === 2 };
  });
  transcriptIndexCache = { computedAtMs: now, files };
  return files;
}

// Cheap pass for /api/status: stat-only, no tail-reads, no ollama call.
function countOrgActivity() {
  const roster = loadRoster();
  const now = Date.now();
  let activeSessions = 0, activeSubagents = 0;
  for (const { path: file, mtimeMs } of getTranscriptIndex()) {
    if (now - mtimeMs >= ORG_ACTIVE_MS) continue;
    if (isSubagentFile(file)) activeSubagents++; else activeSessions++;
  }
  return { rosterAgents: roster.length, activeSessions, activeSubagents };
}

function execFileText(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? '' : (stdout || '')));
  });
}

// `ollama ps` prints a padded text table, not JSON — columns are separated by
// 2+ spaces, which survives the "UNTIL" column's own multi-word values
// ("4 minutes from now") since those only ever have single spaces internally.
function parseOllamaPs(output) {
  const lines = output.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 4) continue;
    out.push({ name: cols[0], size: cols[2] || '', processor: cols[3] || '', context: cols[4] || '' });
  }
  return out;
}

function lastUsageByModel() {
  const map = new Map();
  try {
    for (const line of fs.readFileSync(USAGE_LOG_PATH, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try { entry = JSON.parse(trimmed); } catch { continue; }
      if (!entry.model || !entry.ts) continue;
      const prior = map.get(entry.model);
      if (!prior || new Date(entry.ts).getTime() > new Date(prior).getTime()) map.set(entry.model, entry.ts);
    }
  } catch {
    // no ledger yet — fine, interns just show as loaded-but-idle
  }
  return map;
}

async function loadInternAgents() {
  const loaded = parseOllamaPs(await execFileText('ollama', ['ps']));
  const lastUsage = lastUsageByModel();
  const now = Date.now();
  return loaded.map((m) => {
    const lastTs = lastUsage.get(m.name) || null;
    const active = !!lastTs && (now - new Date(lastTs).getTime() < ORG_ACTIVE_MS);
    return {
      id: 'intern:' + m.name,
      label: m.name,
      description: [m.size, m.processor, m.context ? `${m.context} ctx` : ''].filter(Boolean).join(', '),
      model: m.name,
      tier: 'intern',
      project: null,
      status: active ? 'active' : 'idle',
      lastActivity: lastTs,
      source: 'intern',
    };
  });
}

// --- Mission Control: usage tally (ported from ~/.claude/helpers/usage-report.mjs) ---
// This is the expensive one — full-content reads of every transcript touched
// in the window, not just a tail. Cached server-side for USAGE_CACHE_MS so a
// UI poll never re-triggers the scan; only a cache-miss does.
function modelFamily(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('fable')) return 'fable';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'other';
}

// List price per million tokens, by model family. Used to turn the per-agent
// token counts into a number the CEO can actually act on — "which branch of the
// org is eating the budget" is a dollar question, not a token question.
// Override with ALFRED_PRICES='{"opus":{"in":5,"out":25}}' when rates change;
// an unpriced family contributes tokens but no cost rather than a wrong number.
const DEFAULT_PRICES = {
  fable:  { in: 10, out: 50 },
  opus:   { in: 5,  out: 25 },
  sonnet: { in: 3,  out: 15 },
  haiku:  { in: 1,  out: 5 },
};
const MODEL_PRICES = (() => {
  if (!process.env.ALFRED_PRICES) return DEFAULT_PRICES;
  try { return { ...DEFAULT_PRICES, ...JSON.parse(process.env.ALFRED_PRICES) }; }
  catch (err) {
    console.log(`[alfred] ignoring bad ALFRED_PRICES (${err.message})`);
    return DEFAULT_PRICES;
  }
})();

function costUsd(family, inTok, outTok) {
  const p = MODEL_PRICES[family];
  if (!p) return 0;   // local/intern models and unknown families are free here
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

// Per-transcript-file usage, so the org chart can attribute spend to the agent
// that actually incurred it. Populated by the same pass that builds the global
// tally — reading every transcript twice to answer two questions about the same
// lines would double the cost of the endpoint.
let usageByFile = new Map();

function tallyUsage(hoursBack) {
  const cutoff = Date.now() - hoursBack * 3600 * 1000;
  const cloud = {}; // family -> {in, out}
  const seen = new Set();
  const byFile = new Map();

  for (const { path: file, mtimeMs } of getTranscriptIndex()) {
    if (mtimeMs < cutoff) continue; // untouched in the window -> can't contain new lines in it
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const u = j && j.message && j.message.usage;
      if (!u || j.type !== 'assistant') continue;
      const ts = Date.parse(j.timestamp || 0);
      if (!ts || ts < cutoff) continue;
      const id = (j.message && j.message.id) || j.uuid;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const family = modelFamily(j.message && j.message.model);
      const t = (cloud[family] = cloud[family] || { in: 0, out: 0 });
      t.in += u.input_tokens || 0;
      t.out += u.output_tokens || 0;

      const f = byFile.get(file) || { in: 0, out: 0, costUsd: 0 };
      f.in += u.input_tokens || 0;
      f.out += u.output_tokens || 0;
      f.costUsd += costUsd(family, u.input_tokens || 0, u.output_tokens || 0);
      byFile.set(file, f);
    }
  }
  usageByFile = byFile;

  const local = {}; // model -> {in, out}
  try {
    for (const line of fs.readFileSync(USAGE_LOG_PATH, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let j;
      try { j = JSON.parse(trimmed); } catch { continue; }
      if (!j.ts || Date.parse(j.ts) < cutoff) continue;
      const t = (local[j.model] = local[j.model] || { in: 0, out: 0 });
      t.in += j.prompt_eval_count || 0;
      t.out += j.eval_count || 0;
    }
  } catch {
    // no ledger yet — local stays empty
  }

  let cloudTotal = 0;
  for (const k of Object.keys(cloud)) cloudTotal += cloud[k].in + cloud[k].out;
  let localTotal = 0;
  for (const k of Object.keys(local)) localTotal += local[k].in + local[k].out;
  const internPct = (cloudTotal + localTotal) ? Math.round((localTotal / (cloudTotal + localTotal)) * 100) : 0;

  return {
    computedAt: new Date().toISOString(),
    hours: hoursBack,
    cloud, cloudTotal,
    local, localTotal,
    internPct,
  };
}

let usageCache = null; // { computedAtMs, payload }
function getUsagePayload() {
  const now = Date.now();
  if (!usageCache || now - usageCache.computedAtMs >= USAGE_CACHE_MS) {
    usageCache = { computedAtMs: now, payload: tallyUsage(USAGE_WINDOW_HOURS) };
  }
  return usageCache.payload;
}

// ============================================================================
// DEV SURFACE — GET /api/projects (DESIGN-UX-SPEC §2.1). Local git + brain +
// transcript data only, no `gh` calls here (P0 is deliberately offline-only —
// see spec §5 "P0 explicitly excludes gh").
// ============================================================================

// Runs a small pool of async workers over `items`, at most `limit` concurrent
// — used so scanning 20 project folders' git state doesn't fire 100 processes
// at once, but also doesn't serialize into a multi-second endpoint.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3000 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

// Never throws — a failing git command degrades that one field to null, it
// never drops the card (DESIGN-UX-SPEC §2.1.3: "Never drop a card").
async function scanProjectGit(dir) {
  const empty = { git: false, branch: null, dirty: null, ahead: null, behind: null, remote: null, host: null, slug: null, lastCommit: null };
  if (!fs.existsSync(path.join(dir, '.git'))) return empty;

  const [branchOut, statusOut, remoteOut, rangeOut, logOut] = await Promise.all([
    runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(dir, ['status', '--porcelain']),
    runGit(dir, ['remote', 'get-url', 'origin']),
    runGit(dir, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    runGit(dir, ['log', '-1', '--format=%h%x00%cI%x00%s']),
  ]);

  const branch = branchOut ? branchOut.trim() : null;
  const dirty = statusOut != null ? statusOut.split('\n').filter((l) => l.trim()).length : null;
  const remote = remoteOut ? remoteOut.trim() : null;

  let ahead = null, behind = null;
  if (rangeOut) {
    // `git rev-list --left-right --count @{u}...HEAD` prints "<behind> <ahead>"
    const m = rangeOut.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) { behind = parseInt(m[1], 10); ahead = parseInt(m[2], 10); }
  }

  let host = null, slug = null;
  if (remote) {
    if (/github\.com/i.test(remote)) {
      host = 'github';
      const m = remote.match(/github\.com[:/]+([^/]+)\/([^/.]+?)(\.git)?\/?$/i);
      if (m) slug = `${m[1]}/${m[2]}`;
    } else if (/dev\.azure\.com|visualstudio\.com/i.test(remote)) {
      host = 'ado';
    } else {
      host = 'other';
    }
  }

  let lastCommit = null;
  if (logOut && logOut.trim()) {
    const [sha, iso, ...subjectParts] = logOut.replace(/\n+$/, '').split('\0');
    lastCommit = { sha, iso, subject: subjectParts.join('\0') };
  }

  return { git: true, branch, dirty, ahead, behind, remote, host, slug, lastCommit };
}

// Precedence order from DESIGN-UX-SPEC §2.1.5: exact path -> curated alias ->
// case-insensitive title match -> none.
function matchBrainNote(projectName) {
  let notes;
  try { notes = loadIndex().notes; } catch { return null; }
  const exactPath = 'Projects/' + projectName + '.md';
  let note = notes.find((n) => n.path === exactPath);
  if (!note && PROJECT_NOTE_ALIASES[projectName]) {
    note = notes.find((n) => n.path === PROJECT_NOTE_ALIASES[projectName]);
  }
  if (!note) {
    const target = projectName.toLowerCase();
    note = notes.find((n) => n.folder === 'Projects' && n.title.toLowerCase() === target);
  }
  return note ? { path: note.path, title: note.title, mtime: note.mtime } : null;
}

// Claude Code mangles cwd into a directory name by replacing every
// non-alphanumeric character with '-', and — the documented gotcha — does
// NOT normalize case, so both spellings of the same folder exist on this
// machine. Rather than reproduce the exact mangle (drive-letter colon,
// backslashes, an untrimmed trailing char), match by case-insensitive
// suffix on '-<projectName>', which is what every mangled cwd ends with and
// is robust to that drive-letter edge case. Stat-only, no file content reads.
function projectSessionStats(projectName) {
  const suffix = ('-' + projectName).toLowerCase();
  let count = 0, lastMs = 0, dirKey = null;
  for (const f of getTranscriptIndex()) {
    if (!f.topLevel) continue; // excludes .../<sessionId>/subagents/*
    if (!f.dirKey.toLowerCase().endsWith(suffix)) continue;
    dirKey = f.dirKey;
    count++;
    if (f.mtimeMs > lastMs) lastMs = f.mtimeMs;
  }
  return count ? { count, lastIso: new Date(lastMs).toISOString(), dirKey } : { count: 0, lastIso: null, dirKey: null };
}

async function computeProjectsPayload() {
  const roots = PROJECT_ROOTS.filter((r) => fs.existsSync(r));
  const dirs = [];
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      dirs.push({ name: entry.name, path: path.join(root, entry.name) });
    }
  }

  const projects = await mapWithConcurrency(dirs, GIT_CONCURRENCY, async (d) => {
    let gitInfo;
    try { gitInfo = await scanProjectGit(d.path); }
    catch { gitInfo = { git: false, branch: null, dirty: null, ahead: null, behind: null, remote: null, host: null, slug: null, lastCommit: null }; }

    const noteMatch = matchBrainNote(d.name);
    let note = null;
    if (noteMatch) {
      const commitMs = gitInfo.lastCommit ? Date.parse(gitInfo.lastCommit.iso) : null;
      note = { ...noteMatch, stale: !!(commitMs && noteMatch.mtime < commitMs) };
    }

    return { name: d.name, path: d.path, ...gitInfo, note, sessions: projectSessionStats(d.name) };
  });

  // Sort order per spec: dirty repos (by last-commit desc), then clean git
  // repos (by last-commit desc), then non-git folders (alphabetical).
  const rank = (p) => (p.git && p.dirty > 0) ? 0 : p.git ? 1 : 2;
  projects.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) return a.name.localeCompare(b.name);
    const ta = a.lastCommit ? Date.parse(a.lastCommit.iso) : 0;
    const tb = b.lastCommit ? Date.parse(b.lastCommit.iso) : 0;
    return tb - ta;
  });

  return { roots, computedAt: new Date().toISOString(), projects };
}

let projectsCache = null; // { computedAtMs, payload }
async function getProjectsPayload() {
  const now = Date.now();
  if (!projectsCache || now - projectsCache.computedAtMs >= PROJECTS_CACHE_MS) {
    const payload = await computeProjectsPayload();
    projectsCache = { computedAtMs: now, payload };
  }
  return projectsCache.payload;
}

async function handleProjects(req, res) {
  try {
    sendJson(res, 200, await getProjectsPayload());
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

// ============================================================================
// DEISH SURFACE — GET /api/deish (DESIGN-UX-SPEC §2.3). "Is the business
// shipping, and is it up?" — nothing revenue-shaped is computed or rendered;
// see spec §0.6/§2.3.6 for why (no `az login`, no cached sales data anywhere).
// ============================================================================

async function probeHealth(target) {
  const startedAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(target.url, { signal: ctrl.signal });
    return { name: target.name, url: target.url, status: res.ok ? 'up' : 'degraded', httpStatus: res.status, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { name: target.name, url: target.url, status: 'down', httpStatus: null, latencyMs: Date.now() - startedAt, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

function scanDeishProducts() {
  const dlDir = path.join(DEISH.repoPath, DEISH.downloadsRel);
  let entries;
  try { entries = fs.readdirSync(dlDir); } catch { return null; }
  const re = /^([A-Za-z0-9]+)-([\d.]+)-(trial|macOS)\.(zip|pkg)$/;
  const byPrefix = {};
  for (const fname of entries) {
    const m = fname.match(re);
    if (!m) continue;
    const [, prefix, ver, variant, ext] = m;
    let stat;
    try { stat = fs.statSync(path.join(dlDir, fname)); } catch { continue; }
    const bucket = (byPrefix[prefix] = byPrefix[prefix] || {});
    const v = (bucket[ver] = bucket[ver] || []);
    v.push({ name: fname, variant, ext, sizeBytes: stat.size, mtime: stat.mtimeMs });
  }
  return DEISH.products.map((cfg) => {
    const versions = byPrefix[cfg.filePrefix];
    if (!versions || !Object.keys(versions).length) return { id: cfg.id, label: cfg.label, available: false };
    const latestVer = Object.keys(versions).sort().reverse()[0];
    const files = versions[latestVer];
    return { id: cfg.id, label: cfg.label, available: true, version: latestVer, files, builtAt: Math.max(...files.map((f) => f.mtime)) };
  });
}

// Presence check only — a readable Stripe Payment Link string, never a sales
// or payment status. See spec §2.3.2: "Never imply a payment status or a sale."
function scanDeishStripeLink() {
  try {
    return /buy\.stripe\.com/.test(fs.readFileSync(path.join(DEISH.repoPath, DEISH.catalogueRel), 'utf8'));
  } catch { return null; }
}

async function computeDeishPayload() {
  let businessNotes = [];
  try { businessNotes = loadIndex().notes.filter((n) => n.folder === 'Business').map((n) => ({ path: n.path, title: n.title, mtime: n.mtime })); } catch {}
  const health = await Promise.all(DEISH.health.map(probeHealth));

  if (!fs.existsSync(DEISH.repoPath)) {
    return { available: false, reason: `Repo not found at ${DEISH.repoPath}`, businessNotes, health };
  }
  const repo = await scanProjectGit(DEISH.repoPath);

  return {
    available: true,
    computedAt: new Date().toISOString(),
    health,
    products: scanDeishProducts(),
    stripeLinkPresent: scanDeishStripeLink(),
    repo: { ...repo, slug: repo.slug || DEISH.slug },
    businessNotes,
  };
}

let deishCache = null; // { computedAtMs, payload }
async function getDeishPayload() {
  const now = Date.now();
  if (!deishCache || now - deishCache.computedAtMs >= DEISH_CACHE_MS) {
    const payload = await computeDeishPayload();
    deishCache = { computedAtMs: now, payload };
  }
  return deishCache.payload;
}

async function handleDeish(req, res) {
  try {
    sendJson(res, 200, await getDeishPayload());
  } catch (err) {
    sendJson(res, 500, { available: false, reason: err.message });
  }
}

// A subagent file lives at <projectDir>/<parentSessionId>/subagents/agent-a*.jsonl
// — the parent session's own transcript is the sibling file
// <projectDir>/<parentSessionId>.jsonl, one level up. No tool_use parsing
// needed to recover the delegation relationship, it's structural.
function parentSessionFile(subagentFile) {
  const sessionDir = path.dirname(path.dirname(subagentFile)); // .../<parentSessionId>
  return { id: path.basename(sessionDir), file: sessionDir + '.jsonl' };
}

// Builds a 'session:' node from a specific file (active or not) — used both
// for the normal active-session pass and to backfill an idle parent session
// so a live delegation edge always has both endpoints, even when the
// orchestrator itself hasn't written to its transcript in the last 20s
// (extremely common while it's waiting on a subagent's report).
function buildSessionNode(file, statMtimeMs) {
  const lines = tailJsonl(file);
  const { model, cwd, lastTs } = summarizeSessionTail(lines);
  const project = cwd ? path.basename(cwd) : null;
  const now = Date.now();
  const active = now - statMtimeMs < ORG_ACTIVE_MS;
  const spend = usageByFile.get(file) || { in: 0, out: 0, costUsd: 0 };
  return {
    id: 'session:' + path.basename(file, '.jsonl'),
    label: (project || 'session') + ' (main session)',
    description: '',
    model: model || '',
    tier: modelToTier(model),
    project,
    status: active ? 'active' : 'idle',
    lastActivity: lastTs || new Date(statMtimeMs).toISOString(),
    source: 'session',
    tokens: spend.in + spend.out,
    costUsd: spend.costUsd,
  };
}

async function buildOrgPayload() {
  // Populates usageByFile as a side effect (cached for USAGE_CACHE_MS), so the
  // per-agent attribution below reads the same numbers the burn gauge shows.
  getUsagePayload();
  const roster = loadRoster();
  const rosterByName = new Map(roster.map((r) => [r.name.toLowerCase(), r]));
  const useCounts = getAgentUseCounts();

  const agents = roster.map((r) => ({
    id: 'roster:' + r.name,
    label: r.name,
    description: r.description,
    model: r.model,
    tier: r.tier,
    // How many times this agent has actually been launched. The chart ranks
    // each lane by this to pick the visible N, so the org you see is the org
    // you actually use rather than whatever sorted first alphabetically.
    uses: useCounts.get(r.name.toLowerCase()) || 0,
    origin: r.origin,
    plugin: r.plugin,
    // Frontmatter names the parent; the chart addresses agents by roster id.
    parent: r.parent && rosterByName.has(String(r.parent).toLowerCase())
      ? 'roster:' + rosterByName.get(String(r.parent).toLowerCase()).name
      : null,
    project: null,
    status: 'idle',
    lastActivity: null,
    source: 'roster',
  }));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const now = Date.now();
  let activeSessions = 0, activeSubagents = 0;
  const neededParents = new Map(); // parentSessionId -> file path, for the backfill pass below

  for (const { path: file, mtimeMs } of getTranscriptIndex()) {
    if (now - mtimeMs >= ORG_ACTIVE_MS) continue; // stat-only for the common (inactive) case

    const lines = tailJsonl(file);
    const { model, cwd, lastTs } = summarizeSessionTail(lines);
    const project = cwd ? path.basename(cwd) : null;
    const lastActivity = lastTs || new Date(mtimeMs).toISOString();

    if (isSubagentFile(file)) {
      activeSubagents++;
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch {}
      const label = (meta && (meta.name || meta.agentType)) || path.basename(file, '.jsonl');
      const subModel = (meta && meta.model) || model;
      const rosterMatch = rosterByName.get(String(label).toLowerCase());
      const parent = parentSessionFile(file);
      const parentId = 'session:' + parent.id;
      if (!agentById.has(parentId)) neededParents.set(parent.id, parent.file);

      const spend = usageByFile.get(file) || { in: 0, out: 0, costUsd: 0 };
      if (rosterMatch) {
        const target = agentById.get('roster:' + rosterMatch.name);
        target.status = 'active';
        target.project = project;
        target.lastActivity = lastActivity;
        target.source = 'subagent';
        target.parent = parentId;
        target.tokens = spend.in + spend.out;
        target.costUsd = spend.costUsd;
      } else {
        agents.push({
          id: 'subagent:' + path.basename(file, '.jsonl'),
          label,
          description: (meta && meta.description) || '',
          model: subModel || '',
          tier: modelToTier(subModel),
          project, status: 'active', lastActivity, source: 'subagent',
          parent: parentId,
          tokens: spend.in + spend.out,
          costUsd: spend.costUsd,
        });
      }
    } else {
      activeSessions++;
      const node = buildSessionNode(file, mtimeMs);
      agentById.set(node.id, node);
      agents.push(node);
    }
  }

  // Backfill any delegating parent session that wasn't independently active,
  // so `parent` always resolves to a real node on the client.
  for (const [parentId, parentFile] of neededParents) {
    const id = 'session:' + parentId;
    if (agentById.has(id)) continue;
    let stat;
    try { stat = fs.statSync(parentFile); } catch { continue; }
    const node = buildSessionNode(parentFile, stat.mtimeMs);
    agentById.set(node.id, node);
    agents.push(node);
  }

  agents.push(...await loadInternAgents());

  // Bridge-launched work joins the same chart as everything else. The CEO chat
  // session (when awake) is the parent of any agent launched while it is live,
  // so delegation edges render exactly like real subagent relationships.
  const chatNodeId = 'chat:ceo';
  if (chat.active) {
    agents.push({
      id: chatNodeId,
      label: 'ALFRED // CEO chat',
      description: chat.sessionId ? 'claude session ' + chat.sessionId.slice(0, 8) : 'starting…',
      model: chat.model,
      tier: modelToTier(chat.model),
      project: null,
      status: chat.busy ? 'active' : 'idle',
      lastActivity: new Date().toISOString(),
      source: 'chat',
    });
  }
  for (const run of agentRuns.values()) {
    agents.push({
      id: 'launch:' + run.id,
      label: `${run.model} · ${run.prompt.slice(0, 40)}`,
      description: run.prompt.slice(0, 160),
      model: run.model,
      tier: modelToTier(run.model),
      project: null,
      status: run.status === 'running' ? 'active' : 'idle',
      lastActivity: run.endedAt || run.startedAt,
      source: 'launch',
      runStatus: run.status,
      parent: chat.active ? chatNodeId : undefined,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    tiers: {
      ceo: { label: 'CEO', name: 'Dishi' },
      csuite: { label: 'C-Suite' },
      vp: { label: 'VPs' },
      manager: { label: 'Managers' },
      employee: { label: 'Employees' },
      intern: { label: 'Interns' },
    },
    agents,
    counts: { rosterAgents: roster.length, activeSessions, activeSubagents },
  };
}

// ============================================================================
// EXECUTION BRIDGE — everything below this line can start a process.
// ============================================================================
// Threat model: the server is loopback-only, but "loopback-only" is NOT a
// security boundary against a malicious webpage the user happens to have open
// — that page can POST to http://127.0.0.1:7777 from the user's own browser.
// Three independent controls close that hole:
//   1. A per-boot session token, template-injected into the served ui.html and
//      required on every mutating endpoint. A random webpage cannot read it
//      (it never leaves this origin) and cannot guess it.
//   2. The token travels in a CUSTOM header (X-Alfred-Token). Custom headers
//      are not "simple" per CORS, so any cross-origin POST must first pass a
//      preflight OPTIONS — which we never approve. That kills drive-by POSTs
//      even before the token is checked.
//   3. Origin (when present) must be loopback, and the socket's remote address
//      must be loopback. Belt, braces, and a second pair of braces.
// GET observe endpoints (/api/graph, /api/org, ...) are unchanged and unguarded
// — they only read, and the HUD polls them constantly.

const SESSION_TOKEN = crypto.randomUUID();
const SERVER_STARTED_MS = Date.now();
const UI_TOKEN_PLACEHOLDER = '__ALFRED_SESSION_TOKEN__';
const UI_BUILD_PLACEHOLDER = '__ALFRED_UI_BUILD__';

// The PreToolUse approval hook runs as a separate process, so it needs the
// rotating token from somewhere. Owner-only file in ~/.claude, rewritten each
// boot and removed on shutdown — the same trust boundary as the loopback bind,
// not a second one.
const TOKEN_FILE = path.join(os.homedir(), '.claude', 'alfred-session.token');
function writeTokenFile() {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, `${PORT}:${SESSION_TOKEN}`, { mode: 0o600 });
  } catch (err) {
    console.log(`[alfred] could not write token file (${err.message}) — approval gate will pass through`);
  }
}
function removeTokenFile() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* never existed */ }
}

// --- spoken approval gate ---------------------------------------------
// Armed by the HUD only while hands-free mode is on. When it is off the hook
// passes everything straight through, so typing in the terminal never blocks
// waiting for a spoken answer nobody is there to give.
const APPROVAL_TIMEOUT_MS = 60 * 1000;
const pendingApprovals = new Map();   // id -> { id, tool, summary, at, resolve, timer }
let approvalGateArmed = false;

// Models the bridge is allowed to launch. Fable is deliberately absent: the
// standing org-chart rule is that Fable is CEO-gated and never picked
// automatically. ALFRED_ALLOW_FABLE=1 opts in for a session, nothing else does.
const LAUNCHABLE_MODELS = ['haiku', 'sonnet', 'opus'];
const CHAT_MODEL = process.env.ALFRED_CHAT_MODEL || 'opus';
const ALLOW_FABLE = process.env.ALFRED_ALLOW_FABLE === '1';

function isModelAllowed(model) {
  if (LAUNCHABLE_MODELS.includes(model)) return true;
  return model === 'fable' && ALLOW_FABLE;
}

function isLoopbackAddress(addr) {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Constant-time compare so the token can't be recovered a byte at a time by
// timing repeated requests. Length is compared first (and leaks only length).
function tokenMatches(supplied) {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(SESSION_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Returns true when the request may mutate. Sends its own 403 and returns
// false otherwise, so callers just `if (!authorize(req, res)) return;`.
function authorize(req, res) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    sendJson(res, 403, { error: 'forbidden: non-loopback client' });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      const u = new URL(origin);
      ok = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === 'alfred';
    } catch { ok = false; }
    if (!ok) {
      sendJson(res, 403, { error: 'forbidden: bad origin' });
      return false;
    }
  }
  if (!tokenMatches(req.headers['x-alfred-token'])) {
    sendJson(res, 403, { error: 'forbidden: bad or missing X-Alfred-Token' });
    return false;
  }
  return true;
}

// --- Shared plumbing: ring buffers, line splitting, ANSI stripping ---

// Monotonic seq per ring so the client can poll with ?after=<seq> and receive
// only what it hasn't seen, even after old lines have been evicted.
function makeRing(max) {
  return { seq: 0, max, lines: [] };
}

function ringPush(ring, text, kind = 'out') {
  ring.seq += 1;
  ring.lines.push({ seq: ring.seq, kind, text });
  if (ring.lines.length > ring.max) ring.lines.splice(0, ring.lines.length - ring.max);
  return ring.seq;
}

function ringSince(ring, after) {
  const from = Number.isFinite(after) ? after : 0;
  return { seq: ring.seq, lines: ring.lines.filter((l) => l.seq > from) };
}

// CSI/OSC escape sequences. v1 strips rather than renders colour — see the
// honest-limitation note in the UI's terminal help line.
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '').replace(/\r/g, '');
}

// Stream chunks split lines at arbitrary byte boundaries; this holds the
// partial tail until its newline arrives so a JSON line is never parsed
// half-formed.
function makeLineSplitter(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const part of parts) onLine(part);
    },
    flush() {
      if (buffer) { onLine(buffer); buffer = ''; }
    },
  };
}

// --- Feature 1: the persistent hidden shell ---
// One shell process lives for the server's lifetime. Its stdin is a pipe, and
// user input is WRITTEN to that pipe — never concatenated into a command line.
// That distinction is the whole safety story here: the shell interprets the
// text as a command (that is the point of the feature), but nothing the user
// types can alter how the shell itself was launched.

const shellRing = makeRing(2000);
let shellProc = null;
let shellRestarts = 0;
let shellCommand = null;
let shuttingDown = false;
let lastShellStart = 0;

// pwsh 7 first, then Windows PowerShell, then cmd. `-Command -` is what makes
// PowerShell read commands from stdin; without it a piped stdin is ignored.
// The profile is intentionally loaded (no -NoProfile) so this behaves like the
// user's real shell, aliases and all.
function shellCandidates() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const psArgs = ['-NoLogo', '-Command', '-'];
  return [
    { cmd: 'pwsh.exe', args: psArgs },
    { cmd: path.join(pf, 'PowerShell', '7', 'pwsh.exe'), args: psArgs },
    { cmd: 'powershell.exe', args: psArgs },
    { cmd: path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: psArgs },
    { cmd: 'cmd.exe', args: [] },
  ];
}

function startShell(candidateIndex = 0) {
  const candidates = shellCandidates();
  if (candidateIndex >= candidates.length) {
    ringPush(shellRing, '[alfred] no usable shell found — terminal disabled', 'error');
    console.error('[alfred] terminal: no usable shell found');
    return;
  }
  const { cmd, args } = candidates[candidateIndex];
  let proc;
  try {
    proc = spawn(cmd, args, {
      cwd: os.homedir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
  } catch {
    return startShell(candidateIndex + 1);
  }

  let started = false;
  // A spawn failure (missing binary, bad cwd) surfaces asynchronously as an
  // 'error' event, not a throw — so candidate fallback has to live here.
  proc.on('error', () => {
    if (!started) startShell(candidateIndex + 1);
  });

  proc.once('spawn', () => {
    started = true;
    shellProc = proc;
    shellCommand = cmd;
    lastShellStart = Date.now();
    console.log(`[alfred] terminal shell up: ${cmd} (pid ${proc.pid})`);
    ringPush(shellRing, `[alfred] shell ready — ${path.basename(cmd)} (pid ${proc.pid}), cwd ${os.homedir()}`, 'system');
  });

  const outSplitter = makeLineSplitter((line) => ringPush(shellRing, stripAnsi(line), 'out'));
  const errSplitter = makeLineSplitter((line) => ringPush(shellRing, stripAnsi(line), 'error'));
  proc.stdout.on('data', (c) => outSplitter.push(c));
  proc.stderr.on('data', (c) => errSplitter.push(c));
  proc.stdin.on('error', () => { /* shell died mid-write; the exit handler restarts it */ });

  proc.on('exit', (code) => {
    outSplitter.flush();
    errSplitter.flush();
    if (proc !== shellProc) return; // a superseded candidate exiting — ignore
    shellProc = null;
    if (shuttingDown) return;
    shellRestarts += 1;
    ringPush(shellRing, `[alfred] shell exited (code ${code}) — restarting (#${shellRestarts})`, 'system');
    console.log(`[alfred] terminal shell exited code=${code}, restart #${shellRestarts}`);
    // Back off if it is crash-looping, so a broken profile can't spin the CPU.
    const rapid = Date.now() - lastShellStart < 2000;
    setTimeout(() => { if (!shuttingDown) startShell(0); }, rapid ? 3000 : 300);
  });
}

function handleTerminalInput(req, res, body) {
  const line = typeof body.line === 'string' ? body.line : '';
  if (line.includes('\n') || line.includes('\r')) {
    return sendJson(res, 400, { error: 'line must not contain newlines' });
  }
  // The wake phrase is intercepted here as a backstop so it never reaches the
  // shell as a bogus command, even if the client-side matcher is bypassed.
  if (WAKE_RE.test(line)) return sendJson(res, 200, { wake: true, seq: shellRing.seq });
  if (!shellProc || !shellProc.stdin.writable) {
    return sendJson(res, 503, { error: 'shell not running' });
  }
  ringPush(shellRing, '> ' + line, 'input'); // echo: a pipe is not a TTY, so nothing echoes on its own
  shellProc.stdin.write(line + '\n');
  sendJson(res, 200, { ok: true, seq: shellRing.seq });
}

// --- Feature 2: the Claude chat session ---
// Deliberately NOT `claude` typed into the pipe above: the interactive TUI
// needs a real console and would render as garbage through a pipe. Instead each
// message is a headless one-shot (`claude -p ... --output-format stream-json`)
// chained by session id via --resume, which preserves conversation context
// across messages while staying pipe-friendly.

// On Windows `claude` on PATH is an npm shim (claude.ps1 / claude.cmd), not an
// executable — and spawn() with shell:false does no PATHEXT resolution, so
// spawning "claude" fails with ENOENT. Resolve the real .exe once instead of
// reaching for shell:true, which would reintroduce a command-line parser.
let claudeBinCache = null;
function resolveClaudeBin() {
  if (claudeBinCache) return claudeBinCache;
  const candidates = [];
  if (process.env.ALFRED_CLAUDE_BIN) candidates.push(process.env.ALFRED_CLAUDE_BIN);
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'claude.exe'));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { claudeBinCache = c; return c; } } catch { /* unreadable dir */ }
  }
  claudeBinCache = 'claude.exe'; // last resort: let spawn try PATH itself
  return claudeBinCache;
}

// /api/ask composition via Haiku — three layers, each falling back to the
// next:
//   1. askSession: a genuinely PERSISTENT process (claude -p --input-format
//      stream-json --output-format stream-json), fed turns as JSON lines on
//      stdin. One spawn pays startup once; empirically verified against this
//      CLI version (2.1.224) at ~14s/turn 1, ~6s/turn 2, ~4s/turn 3 — a real
//      speedup, unlike a fresh --resume spawn per call which stayed flat.
//   2. askResumeSession: the previous one-shot --resume-chained approach
//      (still real session continuity, just no live process to skip
//      restart cost) — used if stream-json input is unsupported/broken on
//      this CLI version, or the persistent process just crashed mid-turn.
//   3. ollama (handled by the caller, handleAsk, on any non-ok result here).
// Both layers use their own dedicated session state — neither is ever
// chat.sessionId, so asking a question from the search bar can never fork
// or confuse the CEO's own resumed chat session.
const ASK_IDLE_KILL_MS = 15 * 60 * 1000;   // free the persistent process's memory after 15min unused
const ASK_RESTART_BACKOFF_MS = 2000;       // cooldown after an unexpected mid-turn crash before respawning again

const askSession = {
  proc: null,
  pending: null,           // { resolve, timer }
  streamJsonBroken: false, // permanent-for-this-run: --input-format stream-json itself failed to spawn/parse
  restartBackoffUntil: 0,
  idleTimer: null,
};

function askSessionTouch() {
  if (askSession.idleTimer) clearTimeout(askSession.idleTimer);
  askSession.idleTimer = setTimeout(() => {
    if (askSession.proc && !askSession.pending) {
      askSession.proc.kill();
      askSession.proc = null;
    }
  }, ASK_IDLE_KILL_MS);
}

// `result` (not the assistant text blocks) is the CLI's own final answer
// string for the turn — using it directly means Alfred never has to
// re-assemble a multi-block response itself.
function askSessionHandleEvent(evt) {
  if (!askSession.pending || evt.type !== 'result') return;
  const p = askSession.pending;
  askSession.pending = null;
  clearTimeout(p.timer);
  if (evt.is_error) {
    p.resolve({ ok: false, error: String(evt.result || 'ask session turn failed') });
    return;
  }
  const text = String(evt.result || '').trim();
  p.resolve(text ? { ok: true, text } : { ok: false, error: 'empty answer' });
}

function askSessionSpawn() {
  const proc = spawn(resolveClaudeBin(), [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--model', 'haiku',
  ], {
    cwd: os.homedir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  askSession.proc = proc;

  const splitter = makeLineSplitter((line) => {
    const t = line.trim();
    if (!t || !t.startsWith('{')) return;
    let evt;
    try { evt = JSON.parse(t); } catch { return; }
    askSessionHandleEvent(evt);
  });
  proc.stdout.on('data', (c) => splitter.push(c));
  proc.on('error', (err) => {
    askSession.streamJsonBroken = true;
    askSession.proc = null;
    if (askSession.pending) {
      const p = askSession.pending;
      askSession.pending = null;
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: err.message });
    }
  });
  proc.on('exit', () => {
    askSession.proc = null;
    if (askSession.pending) {
      const p = askSession.pending;
      askSession.pending = null;
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'ask session process exited unexpectedly' });
    }
  });
  return proc;
}

function askSessionRunTurn(prompt) {
  return new Promise((resolve) => {
    if (!askSession.proc) {
      try { askSessionSpawn(); } catch (err) { askSession.streamJsonBroken = true; return resolve({ ok: false, error: err.message }); }
    }
    const proc = askSession.proc;
    const timer = setTimeout(() => {
      askSession.pending = null;
      if (proc.pid) execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => {});
      resolve({ ok: false, error: 'timeout' });
    }, ASK_HAIKU_TIMEOUT_MS);
    askSession.pending = { resolve, timer };
    askSessionTouch();
    try {
      proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }) + '\n');
    } catch (err) {
      clearTimeout(timer);
      askSession.pending = null;
      resolve({ ok: false, error: err.message });
    }
  });
}

// One-shot --resume-chained turn (fallback layer 2). Kept verbatim from the
// earlier implementation — still a real, working approach, just without a
// live process to skip the startup tax on repeat calls.
function runClaudeAskTurn({ prompt, resumeId }) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--model', 'haiku', '--output-format', 'stream-json', '--verbose'];
    if (resumeId) args.push('--resume', resumeId);

    let proc;
    try {
      proc = spawn(resolveClaudeBin(), args, {
        cwd: os.homedir(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }

    let sessionId = null, answerText = '', resultIsError = null, errOut = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (proc.pid) execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => {});
      resolve({ ok: false, error: 'timeout' });
    }, ASK_HAIKU_TIMEOUT_MS);

    const splitter = makeLineSplitter((line) => {
      const t = line.trim();
      if (!t || !t.startsWith('{')) return;
      let evt;
      try { evt = JSON.parse(t); } catch { return; }
      if (evt.session_id && !sessionId) sessionId = evt.session_id;
      if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
        for (const block of evt.message.content) {
          if (block.type === 'text' && block.text) answerText += block.text;
        }
      } else if (evt.type === 'result') {
        resultIsError = !!evt.is_error;
        if (evt.is_error) answerText = String(evt.result || answerText);
      }
    });
    proc.stdout.on('data', (c) => splitter.push(c));
    proc.stderr.on('data', (c) => { errOut += c.toString(); });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      splitter.flush();
      const text = answerText.trim();
      if (code !== 0 || resultIsError || !text) {
        return resolve({ ok: false, error: errOut.trim() || `exit ${code}, empty output`, sessionId });
      }
      resolve({ ok: true, text, sessionId });
    });
  });
}

// Fallback layer 2's own session id — deliberately separate from both
// askSession (layer 1, the persistent process) and chat.sessionId.
const askResumeSession = { sessionId: null };

async function runResumeBasedAskTurn(prompt) {
  const resumeId = askResumeSession.sessionId;
  let result = await runClaudeAskTurn({ prompt, resumeId });
  if (!result.ok && resumeId) {
    // --resume failed against a session claude.exe no longer recognizes
    // (expired, crashed, etc.) — start a fresh session id and retry once
    // rather than surface a resume error to the caller.
    askResumeSession.sessionId = null;
    result = await runClaudeAskTurn({ prompt, resumeId: null });
  }
  if (result.ok && result.sessionId) askResumeSession.sessionId = result.sessionId;
  return result;
}

// Tries the persistent stream-json session first; falls through to the
// one-shot --resume chain on any failure — a broken/unsupported
// --input-format on this CLI version, a mid-turn crash (with a brief
// backoff before the NEXT call is allowed to respawn again, so a crash
// loop can't hammer claude.exe every request), or a timeout.
async function runPersistentHaikuAskOnce(prompt) {
  if (!askSession.streamJsonBroken && Date.now() >= askSession.restartBackoffUntil) {
    const wasRunning = !!askSession.proc;
    const result = await askSessionRunTurn(prompt);
    if (result.ok) return result;
    if (askSession.streamJsonBroken) {
      console.log(`[alfred] ask: --input-format stream-json unsupported/broken on this CLI — falling back to one-shot --resume for the rest of this run (${result.error})`);
    } else if (wasRunning) {
      askSession.restartBackoffUntil = Date.now() + ASK_RESTART_BACKOFF_MS;
      console.log(`[alfred] ask session died mid-turn (${result.error}) — backing off ${ASK_RESTART_BACKOFF_MS}ms before the next respawn attempt`);
    }
    // fall through to the resume-based path for this call regardless
  }
  return runResumeBasedAskTurn(prompt);
}

// Serializes calls (a promise queue) so two overlapping /api/ask requests
// can't both write a turn to the same live process (or both --resume the
// same session id) at once and race each other's turn ordering.
const askCallQueue = { chain: Promise.resolve() };
function runClaudeHaikuAsk(prompt) {
  const run = () => runPersistentHaikuAskOnce(prompt);
  const settled = askCallQueue.chain.then(run, run);
  askCallQueue.chain = settled.catch(() => {}); // keep the queue alive regardless of this call's outcome
  return settled;
}

const WAKE_RE = /\b(alfred[,!]?\s+wake\s+up[,!]?|wake\s+up[,!]?\s+alfred[,!]?)\b/i;
const STAND_DOWN_RE = /\b(alfred[,!]?\s+stand\s+down[,!]?|stand\s+down[,!]?\s+alfred[,!]?)\b/i;

const chatRing = makeRing(2000);
const chat = {
  active: false,
  sessionId: null,
  busy: false,
  model: CHAT_MODEL,
  proc: null,
};

// Turns one stream-json event into zero or more display lines. The verbose
// stream carries a lot the user does not want to read (hook chatter, thinking
// blocks, rate-limit pings) — only assistant text, one-line tool summaries and
// the final result are surfaced.
function pushClaudeEvent(ring, evt) {
  if (!evt || typeof evt !== 'object') return;
  if (evt.session_id && !chat.sessionId && ring === chatRing) chat.sessionId = evt.session_id;

  if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
    for (const block of evt.message.content) {
      if (block.type === 'text' && block.text && block.text.trim()) {
        for (const line of block.text.split('\n')) ringPush(ring, stripAnsi(line), 'assistant');
      } else if (block.type === 'tool_use') {
        const input = JSON.stringify(block.input || {});
        ringPush(ring, `· ${block.name} ${input.slice(0, 120)}`, 'tool');
      }
    }
    return;
  }
  if (evt.type === 'result') {
    const secs = evt.duration_ms ? (evt.duration_ms / 1000).toFixed(1) + 's' : '';
    const cost = typeof evt.total_cost_usd === 'number' ? ' · $' + evt.total_cost_usd.toFixed(4) : '';
    if (evt.is_error) ringPush(ring, `[error] ${stripAnsi(String(evt.result || 'run failed'))}`, 'error');
    else ringPush(ring, `[done${secs ? ' ' + secs : ''}${cost}]`, 'system');
  }
}

// ============================================================================
// Persistent CEO chat session — same pattern as the ask session (askSession
// above): claude -p --input-format stream-json --output-format stream-json
// stays alive and takes turns as JSON lines on stdin, so the wake word pays
// startup tax once per conversation instead of once per message. Verified
// empirically before building this: a killed process's session_id resumes
// correctly in a freshly respawned stream-json process (crash/idle
// recovery), AND that same session_id resumes correctly via a PLAIN
// `claude --resume <id>` afterward (OPEN IN TERMINAL keeps working — a
// stream-json session is a real session, not a stream-json-only artifact).
// Every event still funnels through pushClaudeEvent(chatRing, evt) exactly
// as the old one-shot path did, so the live-streaming display, chat.sessionId
// capture, and the terminal panel's rendering are all unchanged.
// ============================================================================
const CHAT_IDLE_KILL_MS = 15 * 60 * 1000;
const CHAT_RESTART_BACKOFF_MS = 2000;

const chatSession = {
  proc: null,
  pending: null,           // { resolve } -- resolves { ok } when this turn's result event lands
  streamJsonBroken: false,
  restartBackoffUntil: 0,
  idleTimer: null,
};

function chatSessionTouch() {
  if (chatSession.idleTimer) clearTimeout(chatSession.idleTimer);
  chatSession.idleTimer = setTimeout(() => {
    if (chatSession.proc && !chatSession.pending) {
      chatSession.proc.kill();
      chatSession.proc = null;
    }
  }, CHAT_IDLE_KILL_MS);
}

function chatSessionHandleEvent(evt) {
  pushClaudeEvent(chatRing, evt); // unchanged display/session-capture path
  if (evt.type === 'result' && chatSession.pending) {
    const p = chatSession.pending;
    chatSession.pending = null;
    p.resolve({ ok: !evt.is_error });
  }
}

function chatSessionSpawn(resumeId) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', chat.model];
  if (resumeId) args.push('--resume', resumeId);
  const proc = spawn(resolveClaudeBin(), args, {
    cwd: os.homedir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  chatSession.proc = proc;
  chat.proc = proc;

  const splitter = makeLineSplitter((line) => {
    const t = line.trim();
    if (!t || !t.startsWith('{')) return;
    let evt;
    try { evt = JSON.parse(t); } catch { return; }
    chatSessionHandleEvent(evt);
  });
  proc.stdout.on('data', (c) => splitter.push(c));
  const errSplitter = makeLineSplitter((line) => {
    if (line.trim()) ringPush(chatRing, stripAnsi(line), 'error');
  });
  proc.stderr.on('data', (c) => errSplitter.push(c));

  proc.on('error', (err) => {
    chatSession.streamJsonBroken = true;
    chatSession.proc = null;
    if (chatSession.pending) {
      const p = chatSession.pending;
      chatSession.pending = null;
      p.resolve({ ok: false, error: err.message });
    }
  });
  proc.on('exit', () => {
    chatSession.proc = null;
    if (chatSession.pending) {
      const p = chatSession.pending;
      chatSession.pending = null;
      p.resolve({ ok: false, error: 'chat session process exited unexpectedly' });
    }
  });
  return proc;
}

function chatSessionRunTurn(message, resumeIdIfRespawn) {
  return new Promise((resolve) => {
    if (!chatSession.proc) {
      try { chatSessionSpawn(resumeIdIfRespawn); } catch (err) { chatSession.streamJsonBroken = true; return resolve({ ok: false, error: err.message }); }
    }
    const proc = chatSession.proc;
    chatSession.pending = { resolve };
    chatSessionTouch();
    try {
      proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: message }] } }) + '\n');
    } catch (err) {
      chatSession.pending = null;
      resolve({ ok: false, error: err.message });
    }
  });
}

// Runs one `claude -p` turn. Returns a promise that settles when the process
// exits, so callers can clear the busy flag exactly once. Now fallback layer
// 2 for chat (one-shot --resume, same as the pre-persistent implementation)
// — used when the persistent session is broken/unsupported or just crashed.
function runClaudeTurn({ message, model, resumeId, ring, onSpawn }) {
  return new Promise((resolve) => {
    const args = ['-p', message, '--model', model, '--output-format', 'stream-json', '--verbose'];
    if (resumeId) args.push('--resume', resumeId);

    let proc;
    try {
      // shell:false + an args array: `message` is passed as a single argv
      // entry by the OS, so quotes/semicolons/backticks in it are inert data.
      proc = spawn(resolveClaudeBin(), args, {
        cwd: os.homedir(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      ringPush(ring, `[error] could not start claude: ${err.message}`, 'error');
      return resolve({ ok: false });
    }

    if (onSpawn) proc.once('spawn', () => onSpawn(proc));
    proc.on('error', (err) => {
      ringPush(ring, `[error] claude failed to start: ${err.message}`, 'error');
      resolve({ ok: false });
    });

    const splitter = makeLineSplitter((line) => {
      const t = line.trim();
      if (!t) return;
      if (t.startsWith('{')) {
        try { pushClaudeEvent(ring, JSON.parse(t)); return; } catch { /* not JSON — fall through */ }
      }
      ringPush(ring, stripAnsi(t), 'out');
    });
    proc.stdout.on('data', (c) => splitter.push(c));

    const errSplitter = makeLineSplitter((line) => {
      if (line.trim()) ringPush(ring, stripAnsi(line), 'error');
    });
    proc.stderr.on('data', (c) => errSplitter.push(c));

    proc.on('exit', (code) => {
      splitter.flush();
      errSplitter.flush();
      resolve({ ok: code === 0, code });
    });
  });
}

async function chatSend(message) {
  chat.busy = true;
  ringPush(chatRing, '> ' + message, 'input');
  const isFreshWake = !chat.sessionId;
  if (isFreshWake) {
    ringPush(chatRing, '[alfred] starting session…', 'system');
    // "A fresh wake starts a fresh conversation" — a still-warm process from
    // a prior (stood-down or crashed) conversation would otherwise just
    // continue THAT session under stream-json, since the live process IS
    // the session once running. Kill it and give the persistent path a
    // clean slate (and another chance, in case an earlier conversation hit
    // streamJsonBroken transiently).
    if (chatSession.proc) { chatSession.proc.kill(); chatSession.proc = null; }
    chatSession.streamJsonBroken = false;
  }

  try {
    if (!chatSession.streamJsonBroken && Date.now() >= chatSession.restartBackoffUntil) {
      const wasRunning = !!chatSession.proc;
      // Only pass --resume when respawning a dead process mid-conversation —
      // a brand-new wake (handled above) always starts with proc === null
      // AND chat.sessionId === null, so resumeIdIfRespawn is correctly null
      // for that case too.
      const resumeIdIfRespawn = wasRunning ? null : chat.sessionId;
      const result = await chatSessionRunTurn(message, resumeIdIfRespawn);
      if (result.ok) return;
      if (chatSession.streamJsonBroken) {
        console.log(`[alfred] chat: --input-format stream-json unsupported/broken — falling back to one-shot --resume for the rest of this run (${result.error})`);
      } else if (wasRunning) {
        chatSession.restartBackoffUntil = Date.now() + CHAT_RESTART_BACKOFF_MS;
        console.log(`[alfred] chat session died mid-turn (${result.error}) — backing off ${CHAT_RESTART_BACKOFF_MS}ms before the next respawn attempt`);
      }
      // fall through to the one-shot --resume path for this turn
    }
    await runClaudeTurn({
      message,
      model: chat.model,
      resumeId: chat.sessionId,
      ring: chatRing,
      onSpawn: (p) => { chat.proc = p; },
    });
  } finally {
    chat.busy = false;
    chat.proc = null;
  }
}

// --- Feature 3: agent launches ---
const agentRuns = new Map(); // id -> run record
let agentCounter = 0;

function launchAgent(prompt, model) {
  agentCounter += 1;
  const id = 'run' + agentCounter;
  const ring = makeRing(200);
  const run = {
    id, model, prompt,
    status: 'running',
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    ring,
  };
  agentRuns.set(id, run);
  ringPush(ring, `> [${model}] ${prompt}`, 'input');

  runClaudeTurn({
    message: prompt,
    model,
    resumeId: null,
    ring,
    onSpawn: (p) => { run.pid = p.pid; },
  }).then((r) => {
    run.status = run.status === 'killed' ? 'killed' : (r.ok ? 'done' : 'failed');
    run.endedAt = new Date().toISOString();
  });

  return run;
}

function agentSummary(run) {
  return {
    id: run.id, model: run.model, prompt: run.prompt, status: run.status,
    pid: run.pid, startedAt: run.startedAt, endedAt: run.endedAt,
    lastActivity: run.endedAt || run.startedAt,
  };
}

// /T kills the whole tree — `claude` spawns its own children, and killing only
// the parent would orphan them.
function killAgent(run) {
  if (run.status !== 'running' || !run.pid) return false;
  run.status = 'killed';
  run.endedAt = new Date().toISOString();
  ringPush(run.ring, '[alfred] killed by operator', 'system');
  execFile('taskkill', ['/PID', String(run.pid), '/T', '/F'], () => {});
  return true;
}

// --- Feature 4: intern quick actions ---
const INTERN_HELPER = path.join(os.homedir(), '.claude', 'helpers', 'intern-run.mjs');

// Read the actual installed model list rather than hardcoding one in the UI —
// a static list silently drifts from what `ollama pull` has actually fetched,
// and the failure only shows up as a 404 at run time. Embedding models are
// filtered out: they have no chat endpoint, so they can't answer a prompt.
async function listInternModels() {
  const out = await execFileText('ollama', ['list']);
  const lines = out.split(/\r?\n/).filter((l) => l.trim());
  const models = [];
  for (const line of lines.slice(1)) {
    const name = line.trim().split(/\s{2,}/)[0];
    if (!name || /embed/i.test(name)) continue;
    models.push(name);
  }
  return models;
}

function runIntern(model, prompt) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [INTERN_HELPER, model, prompt], {
      cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
    let out = '', err = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.stderr.on('data', (c) => { err += c.toString(); });
    proc.on('error', (e) => resolve({ ok: false, output: '', error: e.message }));
    proc.on('exit', (code) => resolve({ ok: code === 0, output: out.trim(), error: err.trim() }));
  });
}

function readJsonBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function pingOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
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

// --- HTTP helpers ---
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

// --- Route handlers ---
async function handleGraph(req, res) {
  sendJson(res, 200, buildGraph());
}

// --- retrieval ---------------------------------------------------------
// Semantic search is better when it is available, but making it the ONLY way
// in meant one unreachable service took the whole brain offline: /api/search
// answered 502 and /api/ask had no context to work from. Keyword scoring is
// the floor underneath it — worse ranking, but never nothing.

function queryTerms(q) {
  return [...new Set((String(q).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []))];
}

// Field-weighted term overlap. A hit in the title says far more about a note
// than the same word buried in the body.
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
  // Normalised so it lands on roughly the same 0..1 scale as cosine similarity
  // and the two can be compared in a blended ranking.
  return score / (terms.length * 3);
}

// Ranks the vault against a query, using vectors where they exist and keywords
// everywhere else. Returns { results, mode } — mode says which path answered,
// so the HUD can be honest about degraded ranking.
async function rankNotes(q, limit) {
  const index = loadIndex();
  const terms = queryTerms(q);
  let qVec = null;
  let mode = 'semantic';
  try {
    qVec = await embed(`search_query: ${q}`);
  } catch {
    mode = 'keyword';
  }

  const scored = index.notes.map((n) => {
    const lex = lexicalScore(terms, n);
    // A note with no vector is not invisible just because the others have one:
    // it competes on its keyword score alone.
    const sem = qVec && Array.isArray(n.vector) ? cosineSim(qVec, n.vector) : null;
    const score = sem == null ? lex : sem * 0.8 + lex * 0.2;
    return { score, title: n.title, folder: n.folder, path: n.path, excerpt: n.excerpt };
  });

  if (!qVec && !index.notes.some((n) => lexicalScore(terms, n) > 0)) {
    return { results: [], mode, empty: true };
  }
  const results = scored.filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return { results, mode };
}

// Last resort when there is no generation engine at all — neither the claude
// CLI nor a local model. Retrieval still worked, so hand back what was found
// instead of an error: the excerpts are the part with the actual information
// in them, and the phrasing was only ever the wrapper.
function extractiveAnswer(q, top) {
  const best = top[0];
  const others = top.slice(1, 3).map((n) => n.title);
  const excerpt = String(best.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  let out = `No answer engine is reachable, so here is the closest note. ${best.title}, in ${best.folder}: ${excerpt}`;
  if (others.length) out += ` Also see ${others.join(' and ')}.`;
  return out;
}

async function handleSearch(req, res, url) {
  const q = url.searchParams.get('q') || '';
  if (!q.trim()) return sendJson(res, 200, []);
  const { results } = await rankNotes(q, 10);
  sendJson(res, 200, results);
}

async function handleAsk(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' });
  }
  const q = String(body.q || '').trim();
  if (!q) return sendJson(res, 400, { error: 'missing q' });

  const { results: top, mode: retrievalMode } = await rankNotes(q, 5);
  if (!top.length) {
    return sendJson(res, 200, {
      answer: "Nothing in the vault matches that — the index may be empty or still building.",
      sources: [], askEngine: 'none', retrieval: retrievalMode,
    });
  }

  const context = top.map((n, i) => `[${i + 1}] ${n.title} (${n.folder})\n${n.excerpt}`).join('\n\n');
  const prompt = 'You are ALFRED, a concise voice assistant answering from a personal notes vault. '
    + 'Using ONLY the excerpts below, answer the question in 2-3 short spoken-style sentences, '
    + 'naturally mentioning which note(s) the answer comes from. If the excerpts do not answer '
    + "the question, say so briefly instead of guessing.\n\n"
    + `QUESTION: ${q}\n\nEXCERPTS:\n${context}\n\nANSWER:`;

  let answer, engineUsed;
  if (ASK_ENGINE === 'haiku') {
    const startedAt = Date.now();
    const haikuResult = await runClaudeHaikuAsk(prompt);
    if (haikuResult.ok) {
      answer = haikuResult.text;
      engineUsed = 'haiku';
      console.log(`[alfred] ask via haiku: ${Date.now() - startedAt}ms`);
    } else {
      console.log(`[alfred] ask haiku failed (${haikuResult.error}) after ${Date.now() - startedAt}ms — falling back to ollama`);
      try {
        answer = await generate(prompt);
        engineUsed = 'ollama';
      } catch (err) {
        answer = extractiveAnswer(q, top);
        engineUsed = 'extractive';
        console.log(`[alfred] ask: no generation engine (${err.message}) — returning excerpts`);
      }
    }
  } else {
    try {
      answer = await generate(prompt);
      engineUsed = 'ollama';
    } catch (err) {
      answer = extractiveAnswer(q, top);
      engineUsed = 'extractive';
      console.log(`[alfred] ask: no generation engine (${err.message}) — returning excerpts`);
    }
  }
  lastAskEngine = engineUsed;

  sendJson(res, 200, {
    answer: answer.trim(),
    sources: top.map((n) => ({ title: n.title, path: n.path, score: n.score })),
    askEngine: engineUsed,
    // 'keyword' means the answer was built from a degraded shortlist — worth
    // surfacing rather than quietly serving worse retrieval as if it were fine.
    retrieval: retrievalMode,
  });
}

async function handleTts(req, res) {
  if (TTS_MODE === 'off') {
    return sendJson(res, 503, { error: 'tts disabled (ALFRED_TTS_MODE=off)' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' });
  }
  const text = String(body.text || '').trim();
  if (!text) return sendJson(res, 400, { error: 'missing text' });

  const engines = TTS_MODE === 'online'
    ? [{ name: 'edge', run: synthesizeEdge }, { name: 'kokoro', run: synthesizeKokoro }]
    : [{ name: 'kokoro', run: synthesizeKokoro }, { name: 'edge', run: synthesizeEdge }];

  const startedAt = Date.now();
  for (const engine of engines) {
    if (engine.name === 'kokoro') ttsEngineState = 'loading';
    try {
      const result = await engine.run(text);
      ttsEngineState = engine.name;
      console.log(`[alfred] tts via ${engine.name}: ${Date.now() - startedAt}ms, ${result.buffer.length} bytes`);
      res.writeHead(200, { 'Content-Type': result.contentType, 'Content-Length': result.buffer.length });
      return res.end(result.buffer);
    } catch (err) {
      console.log(`[alfred] tts ${engine.name} failed (${Date.now() - startedAt}ms): ${err.message}`);
    }
  }

  return sendJson(res, 503, { error: 'tts unavailable: all engines failed' });
}

async function handleNote(req, res, url) {
  const reqPath = url.searchParams.get('path') || '';
  if (!reqPath.toLowerCase().endsWith('.md')) {
    return sendJson(res, 400, { error: 'only .md notes are servable' });
  }
  const vaultReal = fs.realpathSync(VAULT_DIR);
  const candidate = path.resolve(VAULT_DIR, reqPath);
  const rel = path.relative(vaultReal, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return sendJson(res, 403, { error: 'path escapes vault directory' });
  }
  if (!fs.existsSync(candidate)) {
    return sendJson(res, 404, { error: 'note not found' });
  }
  // re-verify realpath after existence check to defeat symlink tricks
  const candidateReal = fs.realpathSync(candidate);
  if (!candidateReal.startsWith(vaultReal + path.sep) && candidateReal !== vaultReal) {
    return sendJson(res, 403, { error: 'path escapes vault directory' });
  }
  const markdown = fs.readFileSync(candidate, 'utf8');
  sendJson(res, 200, { title: path.basename(candidate, '.md'), markdown });
}

// --- Agent charters ----------------------------------------------------
// GET /api/charter?agent=<name|roster:name> — serves an agent's own .md so the
// org chart's side panel can show the charter, not just a status line.
//
// Deliberately NOT shaped like handleNote(). handleNote defends an open input
// space (any path under the vault), so it resolves and then re-validates.
// Agent names are a CLOSED SET: every name the chart can emit came from a
// frontmatter `name:` on a file this process already scanned. So this builds a
// name -> absolute-path map and looks the request up as a KEY IN THAT MAP.
// No caller-supplied string ever reaches path.join/resolve, which makes
// traversal unrepresentable rather than merely rejected.
//
// Scan order mirrors loadRoster() exactly (user agents first, then plugin
// cache, then marketplaces, first writer wins) so the file the panel shows is
// the same file the chart derived that node from.
const CHARTER_CACHE_MS = 30 * 1000;
let charterMapCache = { at: 0, value: null };

function buildCharterMap() {
  const map = new Map(); // lowercased agent name -> { name, file, origin, meta }
  const add = (file, origin) => {
    if (path.basename(file) === 'ORG.md') return; // org spec, not an agent
    let fm;
    try { fm = parseFrontmatter(fs.readFileSync(file, 'utf8')); } catch { return; }
    if (!fm || !fm.name) return;
    const key = String(fm.name).toLowerCase();
    if (map.has(key)) return; // first writer wins — user agents outrank plugins
    map.set(key, { name: fm.name, file, origin, meta: fm });
  };
  for (const file of walkFiles(AGENTS_DIR, '.md')) add(file, 'user');
  for (const { file } of pluginAgentFiles().sort((a, b) => a.rank - b.rank)) add(file, 'plugin');
  return map;
}

function getCharterMap() {
  const now = Date.now();
  if (charterMapCache.value && now - charterMapCache.at < CHARTER_CACHE_MS) return charterMapCache.value;
  charterMapCache = { at: now, value: buildCharterMap() };
  return charterMapCache.value;
}

// Frontmatter is metadata for the agent loader, not prose for a human reader —
// it goes back as fields so the panel can show a header instead of rendering
// `name: vp-cto` as a paragraph.
function splitFrontmatter(content) {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : content;
}

function handleCharter(req, res, url) {
  const raw = (url.searchParams.get('agent') || '').trim();
  // The chart addresses roster agents as `roster:<name>`; bare names work too.
  const name = raw.startsWith('roster:') ? raw.slice('roster:'.length) : raw;
  if (!name) return sendJson(res, 400, { error: 'agent name required' });

  const entry = getCharterMap().get(name.toLowerCase());
  // Synthetic org-map rungs and live session/subagent nodes have no file. Say
  // so plainly — an empty panel or an invented charter would both be worse.
  // Deliberately does not echo the requested string back — the caller's input
  // never needs to round-trip, and not reflecting it keeps this response free
  // of anything an attacker chose.
  if (!entry) return sendJson(res, 404, { error: 'No charter file on disk for this agent.' });

  let content;
  try { content = fs.readFileSync(entry.file, 'utf8'); } catch (err) {
    return sendJson(res, 404, { agent: entry.name, error: `Charter file unreadable (${err.code || 'error'}).` });
  }
  sendJson(res, 200, {
    agent: entry.name,
    origin: entry.origin,
    tier: entry.meta.tier || null,
    model: entry.meta.model || null,
    parent: entry.meta.parent_mgr || entry.meta.parent_vp || entry.meta.parent || null,
    domain: entry.meta.domain || null,
    markdown: splitFrontmatter(content),
  });
}

// DESIGN-UX-SPEC §2.4 E4 — "Brain: N uncommitted" in the status frame. Cached
// 30s: `git status --porcelain` against a repo the size of the brain (248
// files at time of writing) is not free, and /api/status is now polled every
// 10s on the brain view alone.
let brainDirtyCache = null; // { computedAtMs, count }
const BRAIN_DIRTY_CACHE_MS = 30 * 1000;
async function getBrainDirtyCount() {
  const now = Date.now();
  if (brainDirtyCache && now - brainDirtyCache.computedAtMs < BRAIN_DIRTY_CACHE_MS) return brainDirtyCache.count;
  const out = await runGit(VAULT_DIR, ['status', '--porcelain']);
  const count = out != null ? out.split('\n').filter((l) => l.trim()).length : null;
  brainDirtyCache = { computedAtMs: now, count };
  return count;
}

async function handleStatus(req, res) {
  const index = loadIndex();
  const ollamaOnline = await pingOllama();
  const orgCounts = countOrgActivity();
  sendJson(res, 200, {
    notes: index.notes.length,
    generatedAt: index.generatedAt,
    ollama: ollamaOnline ? 'online' : 'offline',
    internTokens: sessionInternTokens,
    ttsEngine: ttsEngineState,
    askEngine: lastAskEngine,
    rosterAgents: orgCounts.rosterAgents,
    activeSessions: orgCounts.activeSessions,
    activeSubagents: orgCounts.activeSubagents,
    indexStale: isIndexStale(),
    brainDirty: await getBrainDirtyCount(),
    uiBuild: uiBuildStamp(),
    serverBuild: serverBuildStamp(),
    serverStarted: new Date(SERVER_STARTED_MS).toISOString(),
  });
}

// POST /api/reindex [token] — DESIGN-UX-SPEC §2.4 E3. Runs the existing
// buildIndex() (already imported for CLI parity with index-vault.mjs) and
// streams its log lines into the shell terminal ring buffer so the CEO can
// watch a slow embed loop progress without the HTTP request blocking on it.
let reindexRunning = false;
async function handleReindex(req, res) {
  if (reindexRunning) {
    return sendJson(res, 409, { error: 'reindex already running' });
  }
  reindexRunning = true;
  sendJson(res, 202, { started: true });
  ringPush(shellRing, '[alfred] reindex started…', 'system');
  try {
    await buildIndex({ log: (line) => ringPush(shellRing, String(line), 'system') });
    indexCache = null; invalidateIndexDerived(); // force a reload on the next /api/graph, /api/search, etc.
    ringPush(shellRing, '[alfred] reindex complete.', 'system');
  } catch (err) {
    ringPush(shellRing, '[alfred] reindex failed: ' + err.message, 'error');
  } finally {
    reindexRunning = false;
  }
}

// GET /api/org?detail=<id> re-locates one active session/subagent's transcript
// and returns its last ~15 events as plain one-liners for the side panel.
// Separate from the main payload so the 5s poll loop doesn't pay for every
// active agent's event history on every tick — only a click does.
async function buildOrgDetail(id) {
  const files = walkJsonlFiles(PROJECTS_DIR);
  let match = null;
  if (id.startsWith('session:')) {
    const sid = id.slice('session:'.length);
    match = files.find((f) => !isSubagentFile(f) && path.basename(f, '.jsonl') === sid);
  } else if (id.startsWith('subagent:')) {
    const base = id.slice('subagent:'.length);
    match = files.find((f) => isSubagentFile(f) && path.basename(f, '.jsonl') === base);
  }
  if (!match) return { id, events: [] };
  return { id, events: recentEventSummaries(tailJsonl(match, 131072), 15) };
}

async function handleOrg(req, res, url) {
  const detailId = url.searchParams.get('detail');
  try {
    if (detailId) return sendJson(res, 200, await buildOrgDetail(detailId));
    sendJson(res, 200, await buildOrgPayload());
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleUsage(req, res) {
  try {
    sendJson(res, 200, getUsagePayload());
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

// The served page is the only thing that ever learns the session token. It is
// injected at serve time rather than stored in ui.html, so the token never
// touches disk and rotates on every boot.
// A short fingerprint of the ui.html this process is serving. "Am I looking at
// the new build?" is otherwise unanswerable from the browser — an old server
// still running on the port, a stale tab, and a genuinely unchanged file all
// look identical. Computed per request because ui.html is re-read per request.
function uiBuildStamp() {
  try {
    const st = fs.statSync(UI_PATH);
    const h = crypto.createHash('sha1')
      .update(fs.readFileSync(UI_PATH))
      .digest('hex').slice(0, 7);
    return { hash: h, mtime: new Date(st.mtimeMs).toISOString() };
  } catch {
    return { hash: 'unknown', mtime: null };
  }
}

// Whether the PROCESS is stale — the question uiBuildStamp() structurally
// cannot answer. ui.html is re-read per request, so its hash always matches
// the file on disk even when the server.mjs running it is hours behind. This
// compares this file's mtime on disk against the moment the process booted:
// if the code changed after we started, this process is not serving it. One
// statSync on a handler that already stats and re-reads ui.html and walks
// every note in isIndexStale().
function serverBuildStamp() {
  try {
    const mtimeMs = fs.statSync(fileURLToPath(import.meta.url)).mtimeMs;
    return { mtime: new Date(mtimeMs).toISOString(), stale: mtimeMs > SERVER_STARTED_MS };
  } catch {
    return { mtime: null, stale: null };
  }
}

function handleUi(req, res) {
  fs.readFile(UI_PATH, 'utf8', (err, data) => {
    if (err) return sendText(res, 500, 'ui.html missing');
    const build = uiBuildStamp();
    const html = data
      .split(UI_TOKEN_PLACEHOLDER).join(SESSION_TOKEN)
      .split(UI_BUILD_PLACEHOLDER).join(build.hash);
    // The page is re-read from disk on every request precisely so an edit to
    // ui.html shows up on the next refresh — but without these headers the
    // browser is free to serve its own stale copy and the edit appears not to
    // have landed. The page also carries a session token that rotates on every
    // boot, so a cached copy is a stale token as well as stale markup.
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(html);
  });
}

// --- Execution-bridge route handlers ---

async function handleTerminalInputRoute(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
  return handleTerminalInput(req, res, body);
}

function handleTerminalOutput(req, res, url) {
  const after = parseInt(url.searchParams.get('after'), 10);
  const payload = ringSince(shellRing, after);
  sendJson(res, 200, {
    ...payload,
    running: !!shellProc,
    shell: shellCommand ? path.basename(shellCommand) : null,
    restarts: shellRestarts,
  });
}

async function handleChatSend(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
  const text = String(body.text || '').trim();
  if (!text) return sendJson(res, 400, { error: 'missing text' });
  if (chat.busy) return sendJson(res, 409, { error: 'claude is still working on the previous message' });

  if (STAND_DOWN_RE.test(text)) {
    chat.active = false;
    ringPush(chatRing, '[alfred] standing down — back to shell mode.', 'system');
    return sendJson(res, 200, { ok: true, active: false, seq: chatRing.seq });
  }

  const waking = !chat.active;
  if (waking) {
    chat.active = true;
    // A fresh wake starts a fresh conversation; --resume only chains within one.
    chat.sessionId = null;
    // Drop the previous session's transcript so the panel shows this
    // conversation only. seq keeps climbing, so a client polling with an older
    // ?after= still just receives what's new rather than re-reading history.
    chatRing.lines.length = 0;
    ringPush(chatRing, '[alfred] At your service, sir.', 'system');
  }
  // Fire and forget: the turn can take minutes, so the HTTP call returns
  // immediately and the UI watches the ring buffer for streamed output.
  chatSend(text);
  sendJson(res, 200, { ok: true, active: true, waking, model: chat.model, seq: chatRing.seq });
}

function handleChatState(req, res, url) {
  const after = parseInt(url.searchParams.get('after'), 10);
  sendJson(res, 200, {
    ...ringSince(chatRing, after),
    active: chat.active,
    busy: chat.busy,
    sessionId: chat.sessionId,
    model: chat.model,
  });
}

function handleChatStop(req, res) {
  chat.active = false;
  // Flipping the flag alone left the in-flight turn running to completion —
  // "stand down" has to actually stop the work, not just stop showing it.
  abortChatTurn('standing down');
  ringPush(chatRing, '[alfred] standing down — back to shell mode.', 'system');
  sendJson(res, 200, { ok: true, active: false });
}

// Kills the turn in flight but leaves the session alive, so a spoken "stop"
// interrupts what Claude is doing without ending the conversation.
function abortChatTurn(reason) {
  const proc = chat.proc;
  if (!proc) return false;
  try { proc.kill(); } catch { /* already gone */ }
  chat.proc = null;
  chat.busy = false;
  // Anything still queued behind this turn is moot once it is killed.
  for (const [id, p] of pendingApprovals) {
    clearTimeout(p.timer);
    p.resolve('deny');
    pendingApprovals.delete(id);
  }
  ringPush(chatRing, `[alfred] turn aborted — ${reason}.`, 'system');
  return true;
}

function handleChatAbort(req, res) {
  const killed = abortChatTurn('stopped by voice');
  sendJson(res, 200, { ok: true, aborted: killed, active: chat.active });
}

// --- approval gate routes ---------------------------------------------
// The hook blocks on this: it registers the pending call and long-polls for a
// decision. The HUD sees the same queue, asks out loud, and posts the answer.

function handleApprovalArm(req, res, body) {
  approvalGateArmed = !!body.armed;
  if (!approvalGateArmed) {
    // Disarming must not strand a hook that is already waiting.
    for (const [id, p] of pendingApprovals) {
      clearTimeout(p.timer);
      p.resolve('allow');
      pendingApprovals.delete(id);
    }
  }
  return sendJson(res, 200, { ok: true, armed: approvalGateArmed });
}

function handleApprovalRequest(req, res, body) {
  const tool = String(body.tool || 'tool');
  const summary = String(body.summary || '').slice(0, 300);
  if (!approvalGateArmed || !chat.active) {
    return sendJson(res, 200, { decision: 'allow', reason: 'gate disarmed' });
  }
  const id = crypto.randomUUID();
  const entry = { id, tool, summary, at: Date.now() };
  ringPush(chatRing, `[alfred] approval needed — ${tool}: ${summary}`, 'approval');

  // The response is deliberately withheld until the CEO answers; the hook is
  // sitting on this socket and Claude is blocked behind it.
  entry.resolve = (decision) => {
    if (entry.done) return;
    entry.done = true;
    sendJson(res, 200, { decision, id });
  };
  entry.timer = setTimeout(() => {
    if (!pendingApprovals.has(id)) return;
    pendingApprovals.delete(id);
    ringPush(chatRing, `[alfred] approval timed out — denied ${tool}.`, 'error');
    entry.resolve('deny');
  }, APPROVAL_TIMEOUT_MS);
  // A hook that hangs up (Claude killed, turn aborted) must not leak the entry.
  req.on('close', () => {
    if (entry.done) return;
    clearTimeout(entry.timer);
    pendingApprovals.delete(id);
    entry.done = true;
  });
  pendingApprovals.set(id, entry);
}

function handleApprovalList(req, res) {
  sendJson(res, 200, {
    armed: approvalGateArmed,
    pending: [...pendingApprovals.values()].map((p) => ({ id: p.id, tool: p.tool, summary: p.summary, at: p.at })),
  });
}

function handleApprovalDecide(req, res, id, body) {
  const entry = pendingApprovals.get(id);
  if (!entry) return sendJson(res, 404, { error: 'no such approval' });
  const allow = !!body.allow;
  clearTimeout(entry.timer);
  pendingApprovals.delete(id);
  ringPush(chatRing, `[alfred] ${allow ? 'approved' : 'denied'} ${entry.tool}.`, allow ? 'system' : 'error');
  entry.resolve(allow ? 'allow' : 'deny');
  sendJson(res, 200, { ok: true, allow });
}

// Hands the SAME session to a real console, where the full TUI can render —
// the escape hatch for when the line-based panel isn't enough.
function handleChatOpenTerminal(req, res) {
  if (!chat.sessionId) return sendJson(res, 400, { error: 'no claude session yet' });
  const home = os.homedir();
  const sid = chat.sessionId;
  const bin = resolveClaudeBin();
  // wt first (tabs, better font); cmd's `start` as the always-present fallback.
  execFile('wt.exe', ['-d', home, bin, '--resume', sid], (err) => {
    if (!err) return;
    execFile('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', bin, '--resume', sid], { cwd: home }, () => {});
  });
  sendJson(res, 200, { ok: true, sessionId: sid });
}

async function handleAgentLaunch(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
  const prompt = String(body.prompt || '').trim();
  const model = String(body.model || 'haiku').trim().toLowerCase();
  if (!prompt) return sendJson(res, 400, { error: 'missing prompt' });
  if (!isModelAllowed(model)) {
    return sendJson(res, 400, { error: `model not allowed: ${model} (allowed: ${LAUNCHABLE_MODELS.join(', ')})` });
  }
  const run = launchAgent(prompt, model);
  sendJson(res, 200, agentSummary(run));
}

function handleAgentList(req, res) {
  sendJson(res, 200, { agents: [...agentRuns.values()].map(agentSummary) });
}

function handleAgentOutput(req, res, id, url) {
  const run = agentRuns.get(id);
  if (!run) return sendJson(res, 404, { error: 'no such run' });
  const after = parseInt(url.searchParams.get('after'), 10);
  sendJson(res, 200, { ...agentSummary(run), ...ringSince(run.ring, after) });
}

function handleAgentKill(req, res, id) {
  const run = agentRuns.get(id);
  if (!run) return sendJson(res, 404, { error: 'no such run' });
  const killed = killAgent(run);
  sendJson(res, 200, { ok: killed, ...agentSummary(run) });
}

async function handleInternRun(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
  const model = String(body.model || '').trim();
  const prompt = String(body.prompt || '').trim();
  if (!model || !prompt) return sendJson(res, 400, { error: 'missing model or prompt' });
  if (!/^[\w.:-]+$/.test(model)) return sendJson(res, 400, { error: 'invalid model name' });
  if (!fs.existsSync(INTERN_HELPER)) return sendJson(res, 503, { error: 'intern-run.mjs helper not found' });
  sendJson(res, 200, await runIntern(model, prompt));
}

// --- Server ---
async function main() {
  if (isIndexStale()) {
    console.log('[alfred] index missing/stale — indexing now...');
    await buildIndex();
  }
  loadIndex();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);

      if (url.pathname === '/api/ask') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return await handleAsk(req, res);
      }

      if (url.pathname === '/api/tts') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return await handleTts(req, res);
      }

      // Never approve a cross-origin preflight. Combined with the custom
      // X-Alfred-Token header this is what stops a random webpage from POSTing
      // to the bridge: the browser asks first, and the answer is always no.
      if (req.method === 'OPTIONS') return sendText(res, 403, 'forbidden');

      // --- Mutating bridge endpoints: token-gated, loopback-only ---
      if (req.method === 'POST') {
        const agentAction = url.pathname.match(/^\/api\/agents\/([\w-]+)\/kill$/);
        const approvalDecide = url.pathname.match(/^\/api\/approvals\/([\w-]+)\/decide$/);
        const isBridgePost = url.pathname === '/api/terminal/input'
          || url.pathname === '/api/claude/send'
          || url.pathname === '/api/claude/stop'
          || url.pathname === '/api/claude/abort'
          || url.pathname === '/api/claude/open-terminal'
          || url.pathname === '/api/agents/launch'
          || url.pathname === '/api/interns/run'
          || url.pathname === '/api/reindex'
          || url.pathname === '/api/approvals'
          || url.pathname === '/api/approvals/arm'
          || approvalDecide
          || agentAction;
        if (!isBridgePost) return sendJson(res, 404, { error: 'not found' });
        if (!authorize(req, res)) return;

        if (url.pathname === '/api/approvals' || url.pathname === '/api/approvals/arm' || approvalDecide) {
          let body;
          try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
          if (url.pathname === '/api/approvals/arm') return handleApprovalArm(req, res, body);
          if (approvalDecide) return handleApprovalDecide(req, res, approvalDecide[1], body);
          return handleApprovalRequest(req, res, body);
        }

        if (url.pathname === '/api/terminal/input') return await handleTerminalInputRoute(req, res);
        if (url.pathname === '/api/claude/send') return await handleChatSend(req, res);
        if (url.pathname === '/api/claude/stop') return handleChatStop(req, res);
        if (url.pathname === '/api/claude/abort') return handleChatAbort(req, res);
        if (url.pathname === '/api/claude/open-terminal') return handleChatOpenTerminal(req, res);
        if (url.pathname === '/api/agents/launch') return await handleAgentLaunch(req, res);
        if (url.pathname === '/api/interns/run') return await handleInternRun(req, res);
        if (url.pathname === '/api/reindex') return await handleReindex(req, res);
        if (agentAction) return handleAgentKill(req, res, agentAction[1]);
      }

      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

      // Bridge reads. These expose shell output and chat transcripts, so unlike
      // the vault observe endpoints they are token-gated too.
      const agentOutput = url.pathname.match(/^\/api\/agents\/([\w-]+)\/output$/);
      if (url.pathname === '/api/terminal/output' || url.pathname === '/api/claude/state'
          || url.pathname === '/api/agents' || url.pathname === '/api/interns/models'
          || url.pathname === '/api/approvals' || agentOutput) {
        if (!authorize(req, res)) return;
        if (url.pathname === '/api/approvals') return handleApprovalList(req, res);
        if (url.pathname === '/api/terminal/output') return handleTerminalOutput(req, res, url);
        if (url.pathname === '/api/claude/state') return handleChatState(req, res, url);
        if (url.pathname === '/api/agents') return handleAgentList(req, res);
        if (url.pathname === '/api/interns/models') return sendJson(res, 200, { models: await listInternModels() });
        return handleAgentOutput(req, res, agentOutput[1], url);
      }

      if (url.pathname === '/' || url.pathname === '/index.html') return handleUi(req, res);
      if (url.pathname === '/api/graph') return await handleGraph(req, res);
      if (url.pathname === '/api/org') return await handleOrg(req, res, url);
      if (url.pathname === '/api/usage') return await handleUsage(req, res);
      if (url.pathname === '/api/search') return await handleSearch(req, res, url);
      if (url.pathname === '/api/note') return await handleNote(req, res, url);
      if (url.pathname === '/api/charter') return handleCharter(req, res, url);
      if (url.pathname === '/api/status') return await handleStatus(req, res);
      if (url.pathname === '/api/projects') return await handleProjects(req, res);
      if (url.pathname === '/api/deish') return await handleDeish(req, res);

      sendText(res, 404, 'not found');
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  server.listen(PORT, BIND_HOST, () => {
    console.log(`ALFRED online — http://localhost:${PORT}`);
    console.log(`[alfred] execution bridge armed (token rotates each boot)`);
    const b = uiBuildStamp();
    console.log(`[alfred] serving ui.html build ${b.hash} (modified ${b.mtime})`);
    writeTokenFile();
  });

  // Feature 5: the friendly URL. Port 80 needs no elevation on Windows when
  // it's free, but IIS/Skype/another Alfred may hold it — a failure here is
  // cosmetic, so it degrades silently to the :7777 URL.
  const friendly = http.createServer(server.listeners('request')[0]);
  friendly.on('error', (err) => {
    if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
      console.log(`[alfred] port 80 unavailable (${err.code}) — use http://localhost:${PORT}`);
    } else {
      console.log(`[alfred] port 80 error: ${err.message}`);
    }
  });
  friendly.listen(FRIENDLY_PORT, BIND_HOST, () => {
    console.log('[alfred] also on http://alfred/ (add the hosts entry with Add-AlfredHostname.ps1)');
  });

  startShell();

  // Let the shell go down with the server instead of lingering as an orphan.
  const shutdown = () => {
    shuttingDown = true;
    if (shellProc) { try { shellProc.kill(); } catch { /* already gone */ } }
    removeTokenFile();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
