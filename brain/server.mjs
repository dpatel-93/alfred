// Alfred server — serves the HUD UI and a small API over the vault index.
// Dependency-free: node:http + node:fs/path/os and nothing else. Voice output
// was the only thing here that ever reached for npm (kokoro-js locally,
// msedge-tts online) and it went with WS2, taking an 80MB ONNX runtime — and
// the lazy-import dance that kept the test suite from paying for it — with it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIndex, linkKey, noteKey, resolveVaultDir, SKIP_DIRS } from './index-vault.mjs';

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
// 8192 fits qwen2.5:1.5b-instruct's KV cache in the ~4.4GB Ollama gets on an
// 8GB 2080 Super alongside the desktop's own ~3.6GB — the default 32k spills
// the model to CPU. keep_alive is intentionally long: a cold load costs 2.9s
// (vs 0.5-1.0s warm) and must be paid once per idle window, not once per
// question — verify residency with `ollama ps` after a question.
const ASK_NUM_CTX = parseInt(process.env.ALFRED_ASK_NUM_CTX, 10) || 8192;
const ASK_KEEP_ALIVE = process.env.ALFRED_ASK_KEEP_ALIVE || '30m';
const STALE_MS = 24 * 60 * 60 * 1000;
const USAGE_LOG_PATH = path.join(os.homedir(), '.claude', 'metrics', 'ollama-usage.jsonl');

// Which engine actually answered the last /api/ask call — starts as the
// configured default, updates after every call to reflect real fallbacks.
// Lived in the TTS config block until WS2 removed it; it is an Ask concern and
// only ever sat there because both were reported on the same status payload.
let lastAskEngine = ASK_ENGINE;

// --- Mission Control (OBSERVE side, read-only) configuration ---
const AGENTS_DIR = path.join(os.homedir(), '.claude', 'skills', 'orgagent', 'references', 'charters');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const PROFILE_PATH = path.join(os.homedir(), '.claude', 'alfred-profile.md');
const ORG_ACTIVE_MS = 20 * 1000;

// An edge on the org chart only GLOWS when both of its ends are active, and "active" means
// "wrote to its transcript in the last ORG_ACTIVE_MS". In a real delegation that is almost
// never true of the whole chain at one instant: the employee is working while the manager
// sits waiting, so the chain is structurally connected (buildSessionNode backfills idle
// parents) but only one link lights at a time. You therefore cannot photograph a five-level
// delegation, and more importantly you cannot SEE that your org actually wired up.
//
// While an orchestration self-test is running, the org views widen that window to cover the
// whole run. Nothing is faked: every node shown genuinely wrote a transcript inside the
// window. The window is just long enough to hold the shape of one delegation on screen.
const ORG_SELFTEST_ACTIVE_MS = 10 * 60 * 1000;

const selfTest = { running: false, runId: null, startedAt: null, endedAt: null, status: 'idle', error: null };

// Deliberately NOT used by the open-terminal session picker, which uses ORG_ACTIVE_MS
// directly to mean "live elsewhere, don't attach to it". Widening that would make the button
// refuse the very session you are sitting in.
function orgActiveMs() {
  return selfTest.running ? ORG_SELFTEST_ACTIVE_MS : ORG_ACTIVE_MS;
}
const USAGE_CACHE_MS = 60 * 1000;
const USAGE_WINDOW_HOURS = 24;

// The CEO node's display name comes from the operator's own profile, never a
// hardcoded person — this file ships to every install, not just its author's.
// "Batman" is the framework's own default (see alfred-profile.template.md);
// anything else in the file wins if the operator changed it.
// The org chart's tier labels. Generic by default so a fresh install reads as an org rather
// than as someone else's in-joke, and overridable per machine from ~/.alfred/config.json:
//
//   { "orgLabels": { "owner": "Batman", "chiefOfStaff": "Lucius Fox" } }
//
// Relabelling "CEO" to "Owner" is a modelling fix, not decoration: that node is the HUMAN
// running the install, and calling it CEO made the same word mean both the person and the
// top agent tier. The tier KEYS are untouched on purpose — `ceo` is an internal identifier
// woven through the lane order, geometry, colours and the synthesized `ceo:operator` node,
// and renaming it would be a wide, risky change to relabel one box.
//
// There is deliberately NO separate "Lucius Fox" lane. The README's analogy already treats
// "Alfred running the manor" and "Fox running the company day-to-day" as two names for the
// SAME role, and this codebase never invents a tier with nothing in it — an empty lane reads
// worse than a renameable label. Set `csuite` to "Lucius Fox" and the chart says so.
//
// `owner` here is the config key for the `ceo` tier: the config speaks the operator's
// language, the internals keep theirs.
const DEFAULT_ORG_LABELS = {
  owner: 'Owner',
  csuite: 'C-Suite',
  vp: 'VPs',
  manager: 'Managers',
  employee: 'Employees',
  intern: 'Interns',
};

function orgLabels() {
  const raw = loadLocalConfig().orgLabels;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ORG_LABELS };
  const out = { ...DEFAULT_ORG_LABELS };
  for (const k of Object.keys(DEFAULT_ORG_LABELS)) {
    const v = raw[k];
    // A blank or non-string override falls back rather than rendering an unlabelled lane.
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

function orgTiers() {
  const L = orgLabels();
  return {
    ceo: { label: L.owner, name: getCeoName(L.owner) },
    csuite: { label: L.csuite },
    vp: { label: L.vp },
    manager: { label: L.manager },
    employee: { label: L.employee },
    intern: { label: L.intern },
  };
}

function getCeoName(fallback = 'CEO') {
  try {
    const text = fs.readFileSync(PROFILE_PATH, 'utf8');
    const m = text.match(/^\s*-\s*\*\*Address me as\*\*:\s*(.+)$/m);
    if (!m) return fallback;
    // Strip a trailing parenthetical like "(thematic default, kept intentionally)".
    const name = m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    // The template's placeholder is a parenthetical that WRAPS across two lines, and this
    // regex is single-line — so the strip above cannot close it and the raw fragment
    // ("(not specified — Alfred uses your name once you put one here. If you want the")
    // came back as the operator's name and was rendered on the org chart. Any value that
    // opens a parenthetical is guidance text, not a name, regardless of where it ends.
    if (!name || name.startsWith('(') || /^not specified/i.test(name)) return fallback;
    return name;
  } catch {
    return fallback;
  }
}

// --- Dev surface (GET /api/projects) configuration ---
const DEFAULT_PROJECT_ROOT = path.join(os.homedir(), 'OneDrive', 'Desktop', '_Projects');
const PROJECT_ROOTS = (process.env.ALFRED_PROJECT_ROOTS || DEFAULT_PROJECT_ROOT)
  .split(';').map((p) => p.trim()).filter(Boolean);
const PROJECTS_CACHE_MS = 15 * 1000;
const GIT_CONCURRENCY = 6;
// A repo folder and its vault note usually share a name, and when they do the
// match is found without help. This map covers the cases where they diverge.
//
// It ships EMPTY on purpose. It used to hold the author's own four folder-to-note
// pairs, which is dead config on every other machine and quietly implied those
// projects were part of the framework. Add your own in
// ~/.alfred/config.json under "projectNoteAliases", e.g.
//   { "projectNoteAliases": { "Plugins": "Projects/AudioSuite.md" } }
// Read per call rather than captured at boot so an edit takes effect without a
// restart, matching how the brain location behaves.
function projectNoteAliases() {
  const raw = loadLocalConfig().projectNoteAliases;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [folder, note] of Object.entries(raw)) {
    if (typeof folder === 'string' && typeof note === 'string' && folder && note) out[folder] = note;
  }
  return out;
}

// Running total of tokens (prompt+eval) logged by this server process since it
// started — exposed via /api/status so the HUD can show session intern load.
let sessionInternTokens = 0;

// Same shape as ~/.claude/helpers/intern-run.mjs — one line per embed/generate
// call, so both search and ask load show up in /tokens.
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
// see loadIndex() and handleReindex(). References projectsCache, which is
// `let`-declared further down the file; safe because this function body isn't
// evaluated until it's called, by which point module init has finished and the
// binding is initialized.
function invalidateIndexDerived() {
  graphCache = null;
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
    const full = path.join(resolveVaultDir(), n.path);
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

// --- Ask prompt (shared by /api/ask and /api/ask/stream) ---------------
// Hardened 2026-08-08 after a real hallucination: asked "what is the airspeed
// velocity of an unladen swallow" (not in the vault) under the old prompt,
// the 1.5b model answered "approximately 7-8 miles per hour" instead of
// refusing. This exact wording at temperature 0 fixed it — re-verify BOTH
// out-of-vault refusal cases after any further wording change.
const ASK_REFUSAL = "I don't have that in the vault, sir.";
function buildAskPrompt(q, context) {
  return 'You are Alfred, a butler-voiced assistant answering only from the excerpts below. '
    + 'You are forbidden from using outside knowledge.\n\n'
    + 'RULES, in priority order:\n'
    + `1. If the excerpts do not contain the answer, reply with exactly: ${ASK_REFUSAL}\n`
    + '2. Never state a number that does not appear verbatim in an excerpt.\n'
    + '3. Cite the note title you took the answer from.\n'
    + '4. Two or three short spoken sentences. No preamble.\n\n'
    + `QUESTION: ${q}\n\nEXCERPTS:\n${context}\n\nANSWER:`;
}

// Composes a short spoken-style answer from the top matching notes via the
// local ASK_MODEL (qwen2.5:1.5b-instruct by default). Cold loads take ~2.9s;
// warm calls are 0.5-1.0s — ASK_KEEP_ALIVE exists so that cost is paid once
// per idle window, not once per question.
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
      keep_alive: ASK_KEEP_ALIVE,
      // num_ctx capped so the model fits fully in 8GB VRAM — at the default
      // 32k context Ollama spills the model to CPU and answers crawl.
      // temperature 0: required by the hardened prompt above, verified
      // against both out-of-vault refusal cases.
      options: { temperature: 0, num_ctx: ASK_NUM_CTX, num_predict: 256 },
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

// Streaming variant of generate(), used only by /api/ask/stream's local
// (ollama) path so the client can start speaking before the whole answer is
// composed. onDelta(text) is called once per incremental fragment Ollama
// emits; the full concatenated response is returned at the end and logged
// exactly like generate() does. Node's global fetch() gives a WHATWG
// ReadableStream on res.body, which supports `for await` natively (Node 18+).
async function generateStream(prompt, onDelta) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ASK_MODEL,
      prompt,
      stream: true,
      ...(/qwen3|deepseek-r1/.test(ASK_MODEL) ? { think: false } : {}),
      keep_alive: ASK_KEEP_ALIVE,
      options: { temperature: 0, num_ctx: ASK_NUM_CTX, num_predict: 256 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama generate failed: ${res.status}`);

  let full = '';
  let buffer = '';
  let lastUsage = null;
  const consumeLine = (line) => {
    const t = line.trim();
    if (!t) return;
    let data;
    try { data = JSON.parse(t); } catch { return; }
    if (data.response) { full += data.response; onDelta(data.response); }
    if (data.done) lastUsage = data;
  };
  for await (const chunk of res.body) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : Buffer.from(chunk).toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) consumeLine(line);
  }
  if (buffer.trim()) consumeLine(buffer);

  logUsage({
    model: ASK_MODEL,
    promptEvalCount: lastUsage?.prompt_eval_count ?? 0,
    evalCount: lastUsage?.eval_count ?? 0,
    durationMs: Math.round((lastUsage?.total_duration ?? 0) / 1e6),
  });
  return full;
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
    if (now - mtimeMs >= orgActiveMs()) continue;
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
    const active = !!lastTs && (now - new Date(lastTs).getTime() < orgActiveMs());
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

// Cache tokens are billed, and on this estate they are almost the whole bill:
// measured over 18 days of real transcripts, cache reads were 97.3% of every
// token paid for (4.37B of 4.49B). Pricing only input+output therefore
// understated real spend by ~13.6x — the HUD reported ~$13 against a true
// ~$188/day. Multipliers verified against the published price sheet: a cache
// WRITE costs 1.25x the base input rate, a cache READ 0.10x, and that ratio is
// identical across all four model families.
//
// This is also why long sessions dominate: the whole context is re-billed every
// turn and the context grows, so session cost is roughly quadratic in turns.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.10;
function costUsd(family, inTok, outTok, cacheCreationTok = 0, cacheReadTok = 0) {
  const p = MODEL_PRICES[family];
  if (!p) return 0;   // local/intern models and unknown families are free here
  return (inTok / 1e6) * p.in
    + (outTok / 1e6) * p.out
    + (cacheCreationTok / 1e6) * p.in * CACHE_WRITE_MULTIPLIER
    + (cacheReadTok / 1e6) * p.in * CACHE_READ_MULTIPLIER;
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
      // Cache tokens carry the bill on this estate (97.3% of billed tokens), so
      // they are tracked alongside in/out rather than discarded. Widening
      // costUsd() without widening THIS call site would have left the fix inert.
      const cIn = u.input_tokens || 0;
      const cOut = u.output_tokens || 0;
      const cCreate = u.cache_creation_input_tokens || 0;
      const cRead = u.cache_read_input_tokens || 0;

      // Cost per FAMILY as well as per file. It was only ever accumulated per file, so the
      // burn panel could show volume but not spend — and "tokens alone do not land with a
      // CFO" was already an open note in the write-up's own evidence log.
      const t = (cloud[family] = cloud[family] || { in: 0, out: 0, cacheCreate: 0, cacheRead: 0, costUsd: 0 });
      t.in += cIn;
      t.out += cOut;
      t.cacheCreate += cCreate;
      t.cacheRead += cRead;
      t.costUsd += costUsd(family, cIn, cOut, cCreate, cRead);

      const f = byFile.get(file) || { in: 0, out: 0, cacheCreate: 0, cacheRead: 0, costUsd: 0 };
      f.in += cIn;
      f.out += cOut;
      f.cacheCreate += cCreate;
      f.cacheRead += cRead;
      f.costUsd += costUsd(family, cIn, cOut, cCreate, cRead);
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
// LOCAL PROJECT SCAN — GET /api/projects. Local git + brain +
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
// never drops the card: a project with unreadable git state is still a
// project, and a missing card reads as "this does not exist".
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

// Precedence order: exact path -> curated alias ->
// case-insensitive title match -> none.
function matchBrainNote(projectName) {
  let notes;
  try { notes = loadIndex().notes; } catch { return null; }
  const exactPath = 'Projects/' + projectName + '.md';
  let note = notes.find((n) => n.path === exactPath);
  const aliases = projectNoteAliases();
  if (!note && aliases[projectName]) {
    note = notes.find((n) => n.path === aliases[projectName]);
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
  const active = now - statMtimeMs < orgActiveMs();
  const spend = usageByFile.get(file) || { in: 0, out: 0, costUsd: 0 };
  return {
    id: 'session:' + path.basename(file, '.jsonl'),
    label: (project || 'session') + ' (main session)',
    description: '',
    model: model || '',
    // A top-level session is the Chief of Staff by ROLE, not by model. This used to be
    // modelToTier(model), which maps only Fable to 'csuite' — and CLAUDE.md gates Fable, so
    // a normal Opus session landed in the VPs lane and the C-Suite lane was permanently
    // empty. That also made the one handoff the chart exists to show — a person delegating
    // to the org — skip a level. The model is still reported on the node; the lane is the job.
    tier: 'csuite',
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
    if (now - mtimeMs >= orgActiveMs()) continue; // stat-only for the common (inactive) case

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
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    tiers: orgTiers(),
    selfTest: selfTestSummary(),
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

// --- Execution-bridge authorization ---------------------------------------
// This lived under a "spoken approval gate" heading until WS2, which is how it
// very nearly went out with the voice removal: the section title named one
// feature and the section body held the token check the entire bridge depends
// on. Cut by heading, and every gated route starts answering
// "authorize is not defined". Given its own heading now, for that reason.

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

// The persistent hidden shell that used to live here — a pwsh/cmd child
// process fronted by /api/terminal/input and /api/terminal/output — is gone.
// Alfred is an observe surface: you run `claude` in your own terminal and
// watch the org chart here. /api/claude/open-terminal (which opens a real,
// SEPARATE console) is the supported way to get a prompt, and it survives.

// --- The Claude chat session ---
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
// any session the CEO is running in a real terminal — asking a question from
// the search bar must never fork or confuse a conversation happening elsewhere.
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
// askSession (layer 1, the persistent process) and from anything outside this
// server.
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

// Turns one stream-json event into zero or more display lines. The verbose
// stream carries a lot nobody wants to read (hook chatter, thinking blocks,
// rate-limit pings) — only assistant text, one-line tool summaries and the
// final result are surfaced. It used to also capture chat.sessionId off the
// first event; with the chat channel gone it is a pure formatter, which is why
// agent launches can keep using it unchanged.
function pushClaudeEvent(ring, evt) {
  if (!evt || typeof evt !== 'object') return;

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

// --- the intern bench: local models plus any configured free cloud tier ---
//
// OLLAMA_API_KEY is deliberately NOT prefixed: it is Ollama's own variable
// name, exactly as OLLAMA_URL above already is.
const OLLAMA_CLOUD_URL = process.env.OLLAMA_CLOUD_URL || 'https://ollama.com';

// --- local settings store -------------------------------------------------
//
// Lives in the OPERATOR'S HOME, never in the repo and never in ~/.claude. The
// repo is the obvious place and the wrong one: a secret sitting beside tracked
// files is one `git add -A` from being published, and no .gitignore survives
// somebody running that in a hurry. Putting it outside any working tree means
// the mistake is not available to make.
//
// It is plaintext. On a loopback dev tool holding a free-tier key that is
// proportionate; the OS-keychain version (DPAPI / Keychain / libsecret) is a
// cross-platform job and cross-platform is deferred to release 2. Said plainly
// here rather than implied, so nobody assumes this is encrypted.
const LOCAL_CONFIG_DIR = path.join(os.homedir(), '.alfred');
const LOCAL_CONFIG_PATH = path.join(LOCAL_CONFIG_DIR, 'config.json');

function loadLocalConfig() {
  try { return JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8')) || {}; }
  catch { return {}; } // missing or corrupt — an empty config is the honest read
}

function saveLocalConfig(patch) {
  const next = { ...loadLocalConfig(), ...patch };
  // Drop empties rather than storing "" — absent and blank should not be two
  // different states for a caller to reason about.
  for (const k of Object.keys(next)) {
    if (next[k] === '' || next[k] == null) delete next[k];
  }
  fs.mkdirSync(LOCAL_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  // mode on write only applies at creation; enforce it on an existing file too.
  try { fs.chmodSync(LOCAL_CONFIG_PATH, 0o600); } catch { /* no-op on Windows */ }
  return next;
}

// Env var wins over the settings file. That order matters: it keeps the
// README's documented knob authoritative, and lets a CI or ops environment
// override whatever a workstation happens to have saved.
function cloudKeySource() {
  if ((process.env.OLLAMA_API_KEY || '').trim()) return 'env';
  if ((loadLocalConfig().ollamaApiKey || '').trim()) return 'settings';
  return null;
}
function cloudKey() {
  return (process.env.OLLAMA_API_KEY || loadLocalConfig().ollamaApiKey || '').trim();
}

// Never returns the key itself — only enough to recognise which one is saved.
function maskKey(k) {
  if (!k) return null;
  return k.length <= 8 ? '••••' : '••••' + k.slice(-4);
}

// A directory that exists is not the same as a vault: the useful answer is how
// many notes are actually in it, because that is what tells the operator they
// pointed at the right folder. Capped depth-first walk, not a full index build.
//
// Applies the INDEXER's own SKIP_DIRS rather than a second, similar-looking
// list. The first version skipped only dotfiles and node_modules and reported
// 349 files against an index of 111 — two numbers describing the same folder
// and disagreeing, which is worse than not showing a number at all.
function countMarkdown(dir, budget = 20000) {
  let n = 0;
  const stack = [dir];
  while (stack.length && n < budget) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) stack.push(path.join(current, e.name));
      } else if (e.name.toLowerCase().endsWith('.md')) {
        n++;
      }
    }
  }
  return n;
}

function vaultState() {
  const dir = resolveVaultDir();
  let exists = false;
  try { exists = fs.statSync(dir).isDirectory(); } catch { exists = false; }
  const envVar = process.env.ALFRED_VAULT || process.env.JARVIS_VAULT;
  return {
    path: dir,
    display: tildify(dir),
    exists,
    noteCount: exists ? countMarkdown(dir) : 0,
    source: envVar ? 'env' : (loadLocalConfig().vaultPath ? 'config' : 'default'),
  };
}

function handleSettingsGet(req, res) {
  const key = cloudKey();
  sendJson(res, 200, {
    ollamaApiKey: { configured: !!key, masked: maskKey(key), source: cloudKeySource() },
    // A Client ID is public by design — GitHub prints it on the app's own
    // settings page — so unlike the Ollama key it is returned in full. There
    // is nothing to mask, and masking it would only make it impossible to
    // check against GitHub without deleting and retyping it.
    githubClientId: {
      value: storedGithubClientId() || '',
      source: process.env.ALFRED_GITHUB_CLIENT_ID ? 'env' : (loadLocalConfig().githubClientId ? 'config' : null),
    },
    // Where the brain actually is, plus how it got that value and whether the
    // folder exists — an install pointed at a folder that is not there reads
    // as "no notes" and is otherwise indistinguishable from an empty vault.
    vault: vaultState(),
    // Read-only context so the page can explain itself without a second call.
    configPath: tildify(LOCAL_CONFIG_PATH),
    envOverride: cloudKeySource() === 'env',
  });
}

async function handleSettingsPost(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
  const hasOllama = Object.prototype.hasOwnProperty.call(body, 'ollamaApiKey');
  const hasClientId = Object.prototype.hasOwnProperty.call(body, 'githubClientId');
  const hasVault = Object.prototype.hasOwnProperty.call(body, 'vaultPath');
  if (!hasOllama && !hasClientId && !hasVault) {
    return sendJson(res, 400, { error: 'nothing to update' });
  }
  if (hasVault) {
    const raw = String(body.vaultPath || '').trim();
    if (raw) {
      // Checked before it is stored, not after. A saved path that does not
      // exist silently degrades to "your brain is empty", which is the single
      // most confusing state this whole feature can produce.
      let stat = null;
      try { stat = fs.statSync(raw); } catch { /* reported below */ }
      if (!stat) return sendJson(res, 400, { error: `No folder at ${raw}. Create it first, or point at an existing notes folder.` });
      if (!stat.isDirectory()) return sendJson(res, 400, { error: `${raw} is a file, not a folder.` });
      saveLocalConfig({ vaultPath: path.resolve(raw) });
    } else {
      saveLocalConfig({ vaultPath: '' }); // back to the env var or the default beside the repo
    }
    // The index still describes the OLD folder, so everything derived from it
    // is now wrong. Dropping the caches makes the staleness visible straight
    // away rather than after the next 15-second boundary.
    indexCache = null;
    invalidateIndexDerived();
    activityCache = null;
    if (!hasOllama && !hasClientId) {
      return sendJson(res, 200, { ok: true, vault: vaultState(), reindexRequired: true });
    }
  }
  if (hasClientId) {
    const cid = String(body.githubClientId || '').trim();
    // GitHub Client IDs are `Iv1.` or `Ov23li`-prefixed alphanumerics. Checked
    // for shape only — a wrong-but-well-formed one fails visibly on the next
    // device-flow start, which is a clearer place to find out than here.
    if (cid && !/^[A-Za-z0-9._-]{8,100}$/.test(cid)) {
      return sendJson(res, 400, { error: 'that does not look like a GitHub Client ID — check for stray spaces or line breaks' });
    }
    saveLocalConfig({ githubClientId: cid });
    if (!hasOllama) {
      return sendJson(res, 200, { ok: true, githubClientId: { value: storedGithubClientId() || '', source: cid ? 'config' : null } });
    }
  }
  const raw = String(body.ollamaApiKey || '').trim();
  // Reject anything with whitespace or control characters — that is a paste
  // accident (a wrapped line, a copied label), not a key, and storing it would
  // fail later as a confusing 401.
  if (raw && !/^[\x21-\x7E]{8,400}$/.test(raw)) {
    return sendJson(res, 400, { error: 'that does not look like an API key — check for stray spaces or line breaks' });
  }
  saveLocalConfig({ ollamaApiKey: raw });
  // Echo the masked form only. The caller already has the key; sending it back
  // just puts it in one more log and response body for no reason.
  const key = cloudKey();
  sendJson(res, 200, {
    ok: true,
    ollamaApiKey: { configured: !!key, masked: maskKey(key), source: cloudKeySource() },
    envOverride: cloudKeySource() === 'env',
  });
}

// Cloud models are not pulled — they run on the provider's hardware and are
// addressable by name as soon as a key exists. So "install" only ever means
// something for the local bench.
// The key is PROVEN before any model is shown, and the two steps are separate
// on purpose:
//
//   /api/tags does NOT authenticate. Verified against the live service: no
//   header and a garbage header both return 200 with the full public catalog.
//   Listing from it alone made any typo'd key look like a working one — a green
//   dot and a model list, with the real failure deferred until work was routed.
//
//   /api/chat DOES authenticate, and checks auth BEFORE it validates the body.
//   Verified: an EMPTY body returns 401 unauthenticated and 401 with a bad key.
//   So an empty-body POST is a free probe — a valid key falls through to a body
//   complaint (4xx that is not 401), and no inference is ever run, so proving
//   the key costs nothing.
//
// An earlier version probed /api/ps. That was wrong and rejected every key,
// valid or not: /api/ps is not part of the documented cloud API and 401s
// unconditionally. The bug was indistinguishable from a bad credential from the
// outside, which is exactly why the probe now uses a documented endpoint.
async function listCloudModels() {
  const key = cloudKey();
  if (!key) return { configured: false, models: [], error: null };
  const auth = { Authorization: 'Bearer ' + key };
  try {
    const probe = await fetch(OLLAMA_CLOUD_URL + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(6000),
    });
    if (probe.status === 401 || probe.status === 403) {
      return { configured: true, models: [], error: 'key rejected (' + probe.status + ')' };
    }
    // Anything else — including the 400 a valid key earns for an empty body —
    // means the credential was accepted. Only auth failures are disqualifying.
    const res = await fetch(OLLAMA_CLOUD_URL + '/api/tags', {
      headers: auth, signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { configured: true, models: [], error: 'catalog unavailable (' + res.status + ')' };
    const data = await res.json();
    const models = (data.models || [])
      .map((m) => (typeof m === 'string' ? m : m.name || m.model))
      .filter((n) => n && !/embed/i.test(n));
    return { configured: true, models, error: null };
  } catch (err) {
    return { configured: true, models: [], error: err.name === 'TimeoutError' ? 'provider timed out' : err.message };
  }
}

async function buildInternBench() {
  const [local, cloud] = await Promise.all([listInternModels(), listCloudModels()]);
  return {
    providers: [
      {
        id: 'local', label: 'Local · Ollama', kind: 'local', configured: true,
        models: local, error: null,
        hint: local.length ? null : 'no local models — run `ollama pull qwen3.5:4b`',
      },
      {
        id: 'ollama-cloud', label: 'Cloud · Ollama', kind: 'cloud',
        configured: cloud.configured, models: cloud.models, error: cloud.error,
        // The hint is the actual setup instruction, not a shrug. A panel that
        // says "not configured" without saying how is a dead end. It points at
        // Settings rather than the env var because the key is read per request
        // — pasting it in the UI works immediately, with nothing to restart.
        hint: cloud.configured ? null : 'add a key in Settings to use free cloud interns',
      },
    ],
  };
}

// POST /api/interns/pull [token] — `ollama pull <model>` for the local bench.
//
// This is provisioning, not prompting. Removing the "prompt the intern" box
// was about Alfred not being a chat surface; managing which workers exist is
// the same category as the Library showing which skills exist, so it stays.
//
// Only ever local: cloud models are not downloaded.
const pullRing = makeRing(200);
const pullState = { running: false, model: null, phase: 'idle', error: null };

// Model names reach `ollama pull` as a spawn ARGUMENT, never a shell string,
// so there is no interpolation to escape. The allowlist below is belt-and-
// braces against a name that would confuse ollama itself (a leading dash
// reading as a flag), not a shell-injection guard.
const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,120}$/;

async function handleInternPull(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
  const model = String(body.model || '').trim();
  if (!MODEL_NAME_RE.test(model)) return sendJson(res, 400, { error: 'invalid model name' });
  if (pullState.running) return sendJson(res, 409, { error: 'a pull is already running' });

  pullState.running = true;
  pullState.model = model;
  pullState.phase = 'running';
  pullState.error = null;
  ringPush(pullRing, `[alfred] pulling ${model}…`, 'system');
  sendJson(res, 202, { started: true, model });

  const proc = spawn('ollama', ['pull', model], {
    cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
  });
  const outSplit = makeLineSplitter((line) => ringPush(pullRing, stripAnsi(line), 'out'));
  const errSplit = makeLineSplitter((line) => ringPush(pullRing, stripAnsi(line), 'out'));
  proc.stdout.on('data', (c) => outSplit.push(c));
  proc.stderr.on('data', (c) => errSplit.push(c)); // ollama writes progress to stderr
  proc.on('error', (e) => {
    pullState.running = false; pullState.phase = 'failed'; pullState.error = e.message;
    ringPush(pullRing, '[alfred] pull failed: ' + e.message, 'error');
  });
  proc.on('exit', (code) => {
    outSplit.flush(); errSplit.flush();
    if (!pullState.running) return; // already resolved by the error handler
    pullState.running = false;
    pullState.phase = code === 0 ? 'complete' : 'failed';
    if (code !== 0) pullState.error = 'ollama pull exited ' + code;
    ringPush(pullRing, code === 0 ? `[alfred] ${model} ready.` : `[alfred] pull failed (exit ${code})`, code === 0 ? 'system' : 'error');
  });
}

function handleInternPullStatus(req, res, url) {
  const after = parseInt(url.searchParams.get('after'), 10);
  sendJson(res, 200, {
    ...ringSince(pullRing, after),
    running: pullState.running, phase: pullState.phase,
    model: pullState.model, error: pullState.error,
  });
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

// ============================================================================
// CLASSIFIER — cheap keyword/heuristic routing. NO LLM call decides whether
// to make an LLM call. Tier order below is FROZEN to match the client-side
// classifier in ui.html (VOICE_CLASSIFIER_RULES / classifyUtterance) — the
// two must agree on `category` for the same utterance, because the client
// uses its own copy to decide QUESTION (-> this server's /api/ask/stream) vs
// TASK (-> the live Claude agent session, not this file) *before* ever
// calling this endpoint. This server-side copy exists so that (a) the wire
// contract's `category`/`route`/`reason` are inspectable without a browser,
// and (b) a client that skips its own classifier (or an older client) still
// gets an honest classification here rather than false hope from a
// vault-only model. See Job 2 below for what `route === 'research'` now does.
//
// category: 'question' | 'task' — mirrors the client's `branch`. This is the
//   field that MUST match window.__alfredVoice.classifyUtterance(...).branch
//   for the same text (see test/voice.mjs parity check).
// route: 'local' | 'research' — kept for wire back-compat with older
//   callers/tests. 'local' === category 'question' (served from the vault by
//   Ollama). 'research' === category 'task' (needs live external info or a
//   full agent turn — this server does not attempt it, see handleAskStream).
// engine: what actually generates the answer. 'ollama' for local/question.
//   For research/task there is deliberately no generation engine any more —
//   see ASK_ENGINE_NEEDS_AGENT below — because Haiku-via-buildAskPrompt is
//   vault-only and can never supply what a 'research' classification means.
//
// Tiers, first match wins (mirrors ui.html's classifyUtterance exactly):
//   1. forceTask / forceQuestion — explicit override phrases, either
//      direction, checked before anything else.
//   2. externalInfoKeywords — live/external-info words -> task, even when
//      the sentence is question-shaped ("what's the weather").
//   3. actionVerbs — imperative/action verbs -> task (needs tools, git, the
//      web, or a multi-step agent turn).
//   4. vault-scope — ADDITIONAL tier, not present client-side. Slotted here
//      (after 1-3, before the default) on purpose: tier 4's default is
//      already 'question', so this only changes the REASON string reported
//      for vault-scoped phrasing that hit no tier 1-3 pattern — it can never
//      change the actual category/route outcome, so it cannot break parity
//      with the client's 4-tier list.
//   5. default -> question / local.
//
// NOTE (flagged, not silently narrowed): 'price', 'stock', 'news', 'search',
// 'google', and bare action verbs like 'open', 'add', 'plan' are broad
// enough to false-positive on ordinary vault content ("what's the price
// section of the Meridian note say", "search my notes for X", "add a line to
// this note"). This is the client's frozen spec, mirrored as-is per brief —
// narrowing it here without the client also narrowing it would just
// reintroduce a parity mismatch, so it is flagged, not fixed, in this file.
//
// KNOWN CLIENT/BRIEF DRIFT: ui.html's actionVerbs list (as shipped) includes
// 'plan' in addition to the tier-3 verbs named in the brief text. Mirrored
// here against the ACTUAL live ui.html code (its actionVerbs list), not the
// brief's verb list, because parity is checked against the running client,
// not the brief.
function wb(phrase) {
  return new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
}
const VOICE_FORCE_TASK = ['look into', 'go do', 'work on', 'dig into', 'take care of'];
const VOICE_FORCE_QUESTION = ['quick question', 'just tell me', 'from my notes', 'off the top'];
const VOICE_EXTERNAL_INFO = [
  'weather', 'price', 'stock', 'news', 'latest', 'current version',
  'who won', 'search', 'google', 'look up', "today's",
];
const VOICE_ACTION_VERBS = [
  'fix', 'run', 'commit', 'push', 'deploy', 'create', 'write', 'edit',
  'delete', 'install', 'build', 'refactor', 'add', 'remove', 'rename',
  'restart', 'open', 'plan',
];
const CLASSIFIER_RULES = [
  ...VOICE_FORCE_TASK.map((phrase) => ({
    tier: 1, category: 'task', route: 'research', reason: `force-task:${phrase}`, pattern: wb(phrase),
  })),
  ...VOICE_FORCE_QUESTION.map((phrase) => ({
    tier: 1, category: 'question', route: 'local', reason: `force-question:${phrase}`, pattern: wb(phrase),
  })),
  ...VOICE_EXTERNAL_INFO.map((phrase) => ({
    tier: 2, category: 'task', route: 'research', reason: `external-info:${phrase}`, pattern: wb(phrase),
  })),
  ...VOICE_ACTION_VERBS.map((phrase) => ({
    tier: 3, category: 'task', route: 'research', reason: `action-verb:${phrase}`, pattern: wb(phrase),
  })),
  { tier: 4, category: 'question', route: 'local', reason: 'local-keyword:vault-scope',
    pattern: /\b(vault|note|notes|agent|agents|my (files|machine|config|configuration|projects?))\b/i },
];

// The value handleAskStream uses for `askEngine` when route === 'research':
// no generation engine is attempted for that classification at all (see Job
// 2 in handleAskStream) — this must read as "did not attempt this, needs the
// live agent", never as if Haiku or Ollama ran and produced the refusal.
const ASK_ENGINE_NEEDS_AGENT = 'needs-agent';

// Pure function of the question string — reachable via the first NDJSON line
// of POST /api/ask/stream (emitted before any retrieval/generation work), so
// tests can assert routing without waiting on Ollama or a Claude call.
function classifyQuestion(q) {
  const text = String(q || '');
  for (const rule of CLASSIFIER_RULES) {
    if (rule.pattern.test(text)) {
      return {
        route: rule.route,
        category: rule.category,
        engine: rule.route === 'research' ? ASK_ENGINE_NEEDS_AGENT : 'ollama',
        reason: rule.reason,
      };
    }
  }
  return { route: 'local', category: 'question', engine: 'ollama', reason: 'default-local' };
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
  const prompt = buildAskPrompt(q, context);

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

// POST /api/ask/stream — NDJSON, one JSON object per line, flushed as
// produced. Event order is a CONTRACT another team is coding a client
// against — do not reorder or add buffering that could coalesce lines:
//   1. {type:"route", ...}                    — before any slow work
//   2. {type:"sources", ...}                  — after retrieval
//   3. {type:"delta", text:"..."} * 0..n       — text is an INCREMENT
//   4. {type:"done", ...} exactly once, OR {type:"error", ...} instead of it
//
// route/category "research"/"task" (see classifyQuestion above) SHORT-
// CIRCUITS straight from step 1 to step 4 — no ack, no sources, no deltas.
// It used to ack "I'll need to look that up" and then run the SAME
// hardened, vault-only Haiku prompt used for local answers — Haiku has no
// external/web access and is instructed to refuse anything not in the vault
// excerpts, so every research-classified question produced a promise
// ("I'll look that up") immediately followed by a refusal
// ("I don't have that in the vault, sir"). There is no dependency add this
// wave that lets this server actually fulfill "look it up" — the honest fix
// is to stop promising a lookup this engine can never perform, not to fake
// one. askEngine is ASK_ENGINE_NEEDS_AGENT ('needs-agent') for this case:
// distinct from 'haiku'/'ollama'/'extractive'/'none' on purpose, so a
// caller can tell "we didn't attempt this, it needs the live agent" apart
// from every other askEngine value. The client's own classifier is meant to
// route TASK-branch utterances to the live Claude agent session before ever
// calling this endpoint (see ui.html) — this short-circuit is the honest
// fallback for whatever reaches /api/ask/stream anyway (older client, a
// client that skipped its own classifier, or a direct API caller).
async function handleAskStream(req, res) {
  const startedAt = Date.now();
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' });
  }
  const q = String(body.q || '').trim();
  if (!q) return sendJson(res, 400, { error: 'missing q' });

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
  const write = (obj) => { res.write(JSON.stringify(obj) + '\n'); };

  const cls = classifyQuestion(q);
  const routeMs = Date.now() - startedAt;
  write({ type: 'route', route: cls.route, category: cls.category, engine: cls.engine, reason: cls.reason });

  let firstDeltaAt = null;
  const markFirstDelta = () => { if (firstDeltaAt == null) firstDeltaAt = Date.now(); };
  const finish = (answer, engineUsed) => {
    lastAskEngine = engineUsed;
    const totalMs = Date.now() - startedAt;
    write({
      type: 'done',
      answer: answer.trim(),
      askEngine: engineUsed,
      route: cls.route,
      ms: { route: routeMs, firstDelta: (firstDeltaAt != null ? firstDeltaAt - startedAt : totalMs), total: totalMs },
    });
    res.end();
  };

  if (cls.route === 'research') {
    // See the handleAskStream doc comment above: this classification means
    // "needs live external info or the full agent", which this vault-only
    // engine cannot supply. Skip retrieval/generation entirely — no ack, no
    // sources, no deltas — and say so honestly.
    const answer = "That needs live information or the full agent session, sir — not something I can pull from the vault. Ask me to look into it directly and I'll dispatch a proper turn.";
    return finish(answer, ASK_ENGINE_NEEDS_AGENT);
  }

  try {
    const { results: top, mode: retrievalMode } = await rankNotes(q, 5);
    if (!top.length) {
      write({ type: 'sources', sources: [], retrieval: retrievalMode });
      const answer = 'Nothing in the vault matches that — the index may be empty or still building.';
      markFirstDelta();
      write({ type: 'delta', text: answer });
      return finish(answer, 'none');
    }
    write({
      type: 'sources',
      sources: top.map((n) => ({ title: n.title, path: n.path, score: n.score })),
      retrieval: retrievalMode,
    });

    const context = top.map((n, i) => `[${i + 1}] ${n.title} (${n.folder})\n${n.excerpt}`).join('\n\n');
    const prompt = buildAskPrompt(q, context);

    // route === 'local' is the only classification reaching this point
    // (route === 'research' returns above before retrieval) — engine is
    // always 'ollama' here per classifyQuestion, so there is no engine
    // branch left to select: just generate, with the extractive fallback
    // for when Ollama itself is unreachable.
    let answer = '', engineUsed;
    try {
      answer = await generateStream(prompt, (chunk) => { markFirstDelta(); write({ type: 'delta', text: chunk }); });
      engineUsed = 'ollama';
    } catch (err) {
      answer = extractiveAnswer(q, top);
      engineUsed = 'extractive';
      markFirstDelta();
      write({ type: 'delta', text: answer });
    }
    finish(answer, engineUsed);
  } catch (err) {
    write({ type: 'error', error: err.message || 'internal error' });
    res.end();
  }
}

async function handleNote(req, res, url) {
  const reqPath = url.searchParams.get('path') || '';
  if (!reqPath.toLowerCase().endsWith('.md')) {
    return sendJson(res, 400, { error: 'only .md notes are servable' });
  }
  // Re-resolved per request rather than captured once: the brain location is
  // settable at runtime, and a guard comparing against a stale root would
  // start rejecting every legitimate note the moment it changed.
  const vaultRoot = resolveVaultDir();
  const vaultReal = fs.realpathSync(vaultRoot);
  const candidate = path.resolve(vaultRoot, reqPath);
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
  // Same directory-mtime check as the library map — a newly added agent file
  // should be addressable immediately, not on the next 30s boundary.
  let sig = '';
  try { sig = String(fs.statSync(AGENTS_DIR).mtimeMs); } catch { sig = 'x'; }
  if (charterMapCache.value && charterMapCache.sig === sig && now - charterMapCache.at < CHARTER_CACHE_MS) return charterMapCache.value;
  charterMapCache = { at: now, sig, value: buildCharterMap() };
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

// GET /api/agent-directory — flat, browsable list of every chartered agent for
// the Agent Directory view. Reuses getCharterMap() (same 30s cache, no new
// scanner) instead of the org chart's graph shape — this is a list, not a tree.
const DIRECTORY_TIER_RANK = { vp: 0, manager: 1, employee: 2 };

// Frontmatter `description` is a YAML block scalar (parseFrontmatter can't
// read it), so the one-line summary comes from the charter body instead: every
// chartered agent carries a `## Mission` section by contract (ORG.md §4).
// Plugin/non-chartered agents may not — that's a missing section, not a bug.
function extractMission(markdownBody) {
  const m = markdownBody.match(/^##\s+Mission\s*\r?\n([\s\S]*?)(?=\r?\n##\s|\s*$)/m);
  if (!m) return '(no mission section)';
  const text = m[1].replace(/\s+/g, ' ').trim();
  if (!text) return '(no mission section)';
  return text.length > 200 ? text.slice(0, 200).trimEnd() + '…' : text;
}

// GET /api/search-index — one flat manifest of EVERYTHING searchable: brain
// notes, agent charters, and every Library artifact.
//
// This is the fuzzy half of WS5, and it is a manifest rather than a query
// endpoint on purpose. The CEO asked for search that feels FAST; a round trip
// per keystroke never does, and the semantic path additionally depends on
// Ollama being up. ~350 items of name + short text is small enough to ship
// once and match client-side, so typing costs nothing and works with Ollama
// offline. /api/search stays as the deeper semantic pass.
//
// Reuses loadIndex(), getCharterMap() and getLibraryMap() — the same cached
// sources the Brain graph, Roster and Library already read, so search can
// never disagree with what those views show.
const SEARCH_TEXT_CAP = 180;
function buildSearchIndex() {
  const items = [];
  try {
    for (const n of loadIndex().notes) {
      items.push({
        id: n.path, kind: 'note', name: n.title || n.path,
        sub: n.folder || '', text: String(n.excerpt || '').slice(0, SEARCH_TEXT_CAP),
      });
    }
  } catch { /* index unreadable — the other two sources are still honest */ }
  try {
    for (const entry of getCharterMap().values()) {
      items.push({
        id: 'agent:' + entry.name, kind: 'agent', name: entry.name,
        sub: entry.meta.tier || '', text: String(entry.meta.domain || entry.meta.description || '').slice(0, SEARCH_TEXT_CAP),
      });
    }
  } catch { /* roster unreadable */ }
  try {
    for (const it of getLibraryMap().values()) {
      items.push({
        id: it.id, kind: it.type, name: it.name,
        sub: it.origin, text: String(it.description || '').slice(0, SEARCH_TEXT_CAP),
      });
    }
  } catch { /* library scan failed */ }
  return items;
}

function handleSearchIndex(req, res) {
  const items = buildSearchIndex();
  sendJson(res, 200, { generatedAt: new Date().toISOString(), count: items.length, items });
}

function handleAgentDirectory(req, res) {
  const agents = [];
  for (const entry of getCharterMap().values()) {
    let mission = '(no mission section)';
    try { mission = extractMission(splitFrontmatter(fs.readFileSync(entry.file, 'utf8'))); } catch { /* file unreadable — mission stays the honest fallback */ }
    const skills = entry.meta.skills
      ? String(entry.meta.skills).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    agents.push({
      name: entry.name,
      tier: entry.meta.tier || null,
      model: entry.meta.model || null,
      domain: entry.meta.domain || null,
      parent: entry.meta.parent_mgr || entry.meta.parent_vp || entry.meta.parent || null,
      origin: entry.origin,
      skills,
      mission,
    });
  }
  agents.sort((a, b) => {
    const ra = DIRECTORY_TIER_RANK[a.tier] ?? 3;
    const rb = DIRECTORY_TIER_RANK[b.tier] ?? 3;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
  });
  sendJson(res, 200, { agents });
}

// User-installed skills live here, keyed by directory name rather than a
// frontmatter `name:` (which the agent charter map keys on instead). Plugin
// skills DO exist too — one directory level lower than this layout, under a
// plugin's chosen versioned cache dir
// (<plugin>/<version>/skills/<skill-name>/SKILL.md) — the Library API below
// (see getPluginVersionDirs / addSkillItems) merges those in under
// origin:'plugin'. This map stays scoped to the user layout only.
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const SKILLS_CACHE_MS = 30 * 1000;
let skillsMapCache = { at: 0, value: null };

// A handful of skills (the firecrawl-* family, agent-builder) write
// `description: |` as a YAML block scalar. parseFrontmatter only reads flat
// `key: value` lines, so a block scalar comes back as the literal indicator
// token itself ("|", ">", or a chomped variant like "|-") rather than the
// prose underneath it. Treating that token as a real description would show
// "|" in the UI instead of the honest "(no description)" fallback.
function isBlockScalarIndicator(val) {
  return /^[|>][-+]?\d*$/.test(val);
}

// When `description:` is a block scalar (`|`, `>`, or a chomped/indented
// variant like `|-`, `>-`, `|2`, `>+2`), parseFrontmatter only captures the
// indicator token itself — the prose lives on the indented lines that follow
// it. This walks the raw file text (deliberately NOT parseFrontmatter, which
// stays untouched — see the file-scope comment above buildSkillsMap) to pull
// that prose back out: it finds the `description:` key line, collects every
// following line that stays indented relative to that key, and folds them
// into one collapsed-whitespace string the same way the flat-scalar path
// already does. Stops at the first dedented line (the next frontmatter key,
// e.g. `allowed-tools:`) or the closing `---` fence, whichever comes first.
function extractBlockScalarDescription(rawContent) {
  const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return '';
  const lines = fmMatch[1].split(/\r?\n/);
  const keyLineIdx = lines.findIndex((l) => /^description:\s*[|>][-+]?\d*\s*$/.test(l));
  if (keyLineIdx === -1) return '';
  const out = [];
  for (let i = keyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { out.push(''); continue; } // blank line inside the block — keep folding
    if (!/^\s/.test(line)) break; // dedented back to key level — block scalar is over
    out.push(line);
  }
  return out.join('\n').replace(/\s+/g, ' ').trim();
}

function buildSkillsMap() {
  const map = new Map(); // dir name -> { dir, file }
  let dirs;
  try { dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }); } catch { return map; }
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue; // a bare directory with no SKILL.md isn't a skill
    map.set(entry.name, { dir: entry.name, file });
  }
  return map;
}

function getSkillsMap() {
  const now = Date.now();
  if (skillsMapCache.value && now - skillsMapCache.at < SKILLS_CACHE_MS) return skillsMapCache.value;
  skillsMapCache = { at: now, value: buildSkillsMap() };
  return skillsMapCache.value;
}

// GET /api/library and GET /api/library/item — unified, browsable list of
// every skill/command/hook/instruction from BOTH ~/.claude (origin 'user')
// and installed plugins (origin 'plugin'). Replaces /api/skills-directory
// (one commit old, no external consumers). Ungated like /api/agent-directory
// and the old skills-directory route — same class of local-config metadata.
const LIBRARY_CACHE_MS = 30 * 1000;
let libraryMapCache = { at: 0, value: null };

// Collapse the operator's home directory to `~` for anything the UI displays.
// Not a security control — this is a loopback HUD reading the operator's own
// machine. It exists because the README and the launch write-up will carry
// screenshots of these panes, and an absolute path publishes the account name
// along with them. `~/.claude/helpers/x.mjs` is also how the whole framework
// writes paths, so this matches the house style rather than inventing one.
// A literal split on homedir() only ever matched the NATIVE separator form, and
// on Windows — the primary platform — that is the one form these strings do not
// arrive in. `settings.json` stores hook commands with forward slashes
// ("cmd /c node C:/Users/me/.claude/helpers/x.mjs") and permission entries use
// the Git-Bash form ("//c/Users/me/..."), so the Hooks pane published the account
// name while the function above it claimed to prevent exactly that. Verified by
// screenshotting the search results and reading them, which is the only way this
// class of bug shows up at all.
function tildify(p) {
  const s = String(p);
  const home = os.homedir();
  if (!home) return s;
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sep = '[\\\\/]+';
  const drive = home.match(/^([A-Za-z]):[\\/]/);
  const tail = (drive ? home.slice(3) : home).split(/[\\/]+/).filter(Boolean).map(esc).join(sep);
  // "C:/Users/me" and "//c/Users/me" both name the same home as "C:\Users\me".
  const heads = drive ? [`${esc(drive[1])}:${sep}`, `${sep}${esc(drive[1])}${sep}`] : [sep];
  // Case-insensitive on Windows only: elsewhere /home/Me and /home/me can be
  // two different accounts, and over-redacting is its own kind of wrong.
  const flags = process.platform === 'win32' ? 'gi' : 'g';
  return s.replace(new RegExp(`(?:${heads.join('|')})${tail}`, flags), '~');
}

function truncateDescription(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '(no description)';
  return t.length > 200 ? t.slice(0, 199).trimEnd() + '…' : t;
}

// Shared by both skills and commands (user and plugin) — the exact
// block-scalar-aware regression guard the old handleSkillsDirectory had,
// now reused instead of duplicated.
function frontmatterDescription(fm, raw) {
  let description = (fm && fm.description) ? String(fm.description) : '';
  if (isBlockScalarIndicator(description)) {
    description = raw ? extractBlockScalarDescription(raw) : '';
  }
  return truncateDescription(description);
}

// --- Plugin version-dir selection ---------------------------------------
// The plugin cache holds stale duplicate version dirs per plugin, and some
// are empty stubs left behind by reinstalls (an orphaned .in_use lock dir
// with zero real SKILL.md/commands/agents/hooks content). Only ~/.claude/
// plugins/cache is scanned — marketplaces/ is a catalog dir that, for the
// impeccable marketplace, mirrors identical content into ~10 sibling
// non-Claude-Code harness dirs and would fill the Library with fakes.
// Per plugin: drop any version dir with zero artifacts, then keep the
// single newest-by-mtime survivor (tie-break: most artifacts). Cached like
// the charter/skills maps above; reused across the skills/commands/hooks
// passes below rather than rescanned per pass.
const PLUGIN_CACHE_ROOT = path.join(PLUGIN_ROOT, 'cache');
let pluginVersionDirsCache = { at: 0, value: null };

function scanPluginVersionDir(versionDir) {
  const mdFiles = walkFiles(versionDir, '.md');
  const skillFiles = mdFiles.filter((f) => path.basename(f) === 'SKILL.md');
  const commandFiles = mdFiles.filter((f) => path.basename(path.dirname(f)) === 'commands');
  const agentFiles = mdFiles.filter((f) => path.basename(path.dirname(f)) === 'agents');
  const hooksFile = path.join(versionDir, 'hooks', 'hooks.json');
  const hasHooks = fs.existsSync(hooksFile);
  const totalArtifacts = skillFiles.length + commandFiles.length + agentFiles.length + (hasHooks ? 1 : 0);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(versionDir).mtimeMs; } catch { /* dir vanished mid-scan — totalArtifacts already computed */ }
  return { skillFiles, commandFiles, agentFiles, hooksFile: hasHooks ? hooksFile : null, totalArtifacts, mtimeMs };
}

function buildPluginVersionDirs() {
  const chosen = []; // [{ marketplace, plugin, version, dir, skillFiles, commandFiles, agentFiles, hooksFile }]
  let marketplaces;
  try { marketplaces = fs.readdirSync(PLUGIN_CACHE_ROOT, { withFileTypes: true }); } catch { return chosen; }
  for (const mktEntry of marketplaces) {
    if (!mktEntry.isDirectory()) continue;
    const marketplace = mktEntry.name;
    const mktDir = path.join(PLUGIN_CACHE_ROOT, marketplace);
    let plugins;
    try { plugins = fs.readdirSync(mktDir, { withFileTypes: true }); } catch { continue; }
    for (const pluginEntry of plugins) {
      if (!pluginEntry.isDirectory()) continue;
      const plugin = pluginEntry.name;
      const pluginDir = path.join(mktDir, plugin);
      let versions;
      try { versions = fs.readdirSync(pluginDir, { withFileTypes: true }); } catch { continue; }
      let best = null;
      for (const verEntry of versions) {
        if (!verEntry.isDirectory()) continue;
        const version = verEntry.name;
        const scan = scanPluginVersionDir(path.join(pluginDir, version));
        if (scan.totalArtifacts === 0) continue; // empty stub — drop this version dir
        if (!best
          || scan.mtimeMs > best.scan.mtimeMs
          || (scan.mtimeMs === best.scan.mtimeMs && scan.totalArtifacts > best.scan.totalArtifacts)) {
          best = { version, scan };
        }
      }
      if (!best) continue; // every version dir for this plugin is an empty stub — drop the plugin entirely
      chosen.push({
        marketplace, plugin, version: best.version, dir: path.join(pluginDir, best.version),
        skillFiles: best.scan.skillFiles, commandFiles: best.scan.commandFiles,
        agentFiles: best.scan.agentFiles, hooksFile: best.scan.hooksFile,
      });
    }
  }
  return chosen;
}

function getPluginVersionDirs() {
  const now = Date.now();
  if (pluginVersionDirsCache.value && now - pluginVersionDirsCache.at < LIBRARY_CACHE_MS) return pluginVersionDirsCache.value;
  pluginVersionDirsCache = { at: now, value: buildPluginVersionDirs() };
  return pluginVersionDirsCache.value;
}

// --- usedBy (skills only) ------------------------------------------------
// Agents reference skills by whichever string they typed in `skills:`
// (usually the directory name, e.g. "taste"), which can differ from the
// skill's own frontmatter `name:` (e.g. "design-taste-frontend"), so index
// by both, case-insensitively. Same logic the old handleSkillsDirectory used,
// applied to both user AND plugin skills — a plugin skill legitimately
// coming back with an empty usedBy is honest, not a bug.
function buildLibraryUsedByMap() {
  const usedByMap = new Map(); // lowercased skill token -> Set(agent name)
  for (const entry of getCharterMap().values()) {
    if (!entry.meta.skills) continue;
    for (const token of String(entry.meta.skills).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      if (!usedByMap.has(token)) usedByMap.set(token, new Set());
      usedByMap.get(token).add(entry.name);
    }
  }
  return usedByMap;
}

function libraryUsedByFor(usedByMap, name, dir) {
  const set = new Set();
  for (const token of [name.toLowerCase(), dir.toLowerCase()]) {
    const hit = usedByMap.get(token);
    if (hit) for (const agentName of hit) set.add(agentName);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// --- Skills (user + plugin) ----------------------------------------------
function addLibrarySkillItems(map, usedByMap) {
  for (const { dir, file } of getSkillsMap().values()) {
    let raw = null, fm = null;
    try { raw = fs.readFileSync(file, 'utf8'); fm = parseFrontmatter(raw); } catch { /* fm/raw stay null */ }
    const name = (fm && fm.name) ? fm.name : dir;
    const id = 'skill:user:' + dir;
    map.set(id, {
      id, type: 'skill', name, description: frontmatterDescription(fm, raw), origin: 'user',
      source: '~/.claude/skills/' + dir, usedBy: libraryUsedByFor(usedByMap, name, dir), file,
    });
  }

  for (const p of getPluginVersionDirs()) {
    for (const skillFile of p.skillFiles) {
      const skillDirName = path.basename(path.dirname(skillFile));
      let raw = null, fm = null;
      try { raw = fs.readFileSync(skillFile, 'utf8'); fm = parseFrontmatter(raw); } catch { /* fm/raw stay null */ }
      const name = (fm && fm.name) ? fm.name : skillDirName;
      const id = `skill:plugin:${p.marketplace}/${p.plugin}/${skillDirName}`;
      map.set(id, {
        id, type: 'skill', name, description: frontmatterDescription(fm, raw), origin: 'plugin',
        source: `${p.marketplace}/${p.plugin}@${p.version}`,
        usedBy: libraryUsedByFor(usedByMap, name, skillDirName), file: skillFile,
      });
    }
  }
}

// --- Commands (user + plugin) --------------------------------------------
// User commands carry no frontmatter `name:` — only `description:` and
// sometimes `argument-hint:` — so the display name comes from the filename.
const COMMANDS_DIR = path.join(os.homedir(), '.claude', 'commands');

function addLibraryCommandItems(map) {
  let entries = [];
  try { entries = fs.readdirSync(COMMANDS_DIR, { withFileTypes: true }); } catch { /* dir missing — empty list */ }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const name = entry.name.slice(0, -3);
    const file = path.join(COMMANDS_DIR, entry.name);
    let raw = null, fm = null;
    try { raw = fs.readFileSync(file, 'utf8'); fm = parseFrontmatter(raw); } catch { /* fm/raw stay null */ }
    const id = 'command:user:' + name;
    map.set(id, {
      id, type: 'command', name, description: frontmatterDescription(fm, raw), origin: 'user',
      source: '~/.claude/commands/' + entry.name, usedBy: [], file,
    });
  }

  for (const p of getPluginVersionDirs()) {
    for (const cmdFile of p.commandFiles) {
      const name = path.basename(cmdFile, '.md');
      let raw = null, fm = null;
      try { raw = fs.readFileSync(cmdFile, 'utf8'); fm = parseFrontmatter(raw); } catch { /* fm/raw stay null */ }
      const id = `command:plugin:${p.marketplace}/${p.plugin}/${name}`;
      map.set(id, {
        id, type: 'command', name, description: frontmatterDescription(fm, raw), origin: 'plugin',
        source: `${p.marketplace}/${p.plugin}@${p.version}`, usedBy: [], file: cmdFile,
      });
    }
  }
}

// --- Instructions (user only — no plugin equivalent exists) --------------
const HOME_CLAUDE_MD_PATH = path.join(os.homedir(), 'CLAUDE.md');
const INSTRUCTION_FILES = [
  { id: 'instruction:user:claude-md', name: '~/.claude/CLAUDE.md', file: path.join(os.homedir(), '.claude', 'CLAUDE.md'), source: '~/.claude/CLAUDE.md' },
  { id: 'instruction:user:home-claude-md', name: '~/CLAUDE.md', file: HOME_CLAUDE_MD_PATH, source: '~/CLAUDE.md' },
  { id: 'instruction:user:alfred-profile', name: '~/.claude/alfred-profile.md', file: PROFILE_PATH, source: '~/.claude/alfred-profile.md' },
];

// First non-heading prose line, for the list-view description. Strips any
// frontmatter fence and HTML comment blocks first — alfred-profile.md opens
// with a multi-line <!-- ... --> comment, and without stripping it that
// comment prose would win over the real content below it.
function firstProseLine(content) {
  let text = splitFrontmatter(content).replace(/<!--[\s\S]*?-->/g, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('|')) continue;
    if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) continue;
    return line;
  }
  return '';
}

function addLibraryInstructionItems(map) {
  for (const spec of INSTRUCTION_FILES) {
    let raw;
    try { raw = fs.readFileSync(spec.file, 'utf8'); } catch { continue; } // skip missing files, never fabricate
    map.set(spec.id, {
      id: spec.id, type: 'instruction', name: spec.name, description: truncateDescription(firstProseLine(raw)),
      origin: 'user', source: spec.source, usedBy: [], file: spec.file,
    });
  }
}

// --- Hooks (user settings.json + plugin hooks.json) -----------------------
const HELPERS_DIR = path.join(os.homedir(), '.claude', 'helpers');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_SCRIPT_EXT_RE = /\.(mjs|cjs|js|py|sh|ps1)$/i;
// Shell punctuation/keyword tokens that can trail a script path purely as an
// artifact of one-liner syntax (e.g. the closing `]` of a `[ ! -f ... ]`
// existence test earlier in the command) — never a real trailing CLI arg.
const SHELL_PUNCTUATION_TOKENS = new Set([']', '[', '&&', '||', ';', '{', '}', 'then', 'fi', 'do', 'done']);

function stripSurroundingQuotes(s) {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// First whitespace-separated token (quotes stripped) ending in a known
// script extension. Returns the stripped token plus its position among all
// tokens, so the caller can also grab a trailing CLI arg for the label.
function findHookScriptToken(command) {
  const tokens = command.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const stripped = stripSurroundingQuotes(tokens[i]);
    if (HOOK_SCRIPT_EXT_RE.test(stripped)) return { token: stripped, index: i, tokens };
  }
  return null;
}

// Resolves scriptPath to a real file inside allowedRoot, realpath-ing both
// sides to defeat symlink games. Returns the resolved absolute path, or null
// if it doesn't exist or escapes the root — a legitimate "doesn't resolve"
// case, not an error.
function resolveHookScript(scriptPath, allowedRoot) {
  let real, allowedReal;
  try {
    allowedReal = fs.realpathSync(allowedRoot);
    real = fs.realpathSync(scriptPath);
  } catch {
    return null;
  }
  if (real === allowedReal || real.startsWith(allowedReal + path.sep)) return real;
  return null;
}

// Builds one Library item for a single (event, matcher-group, command)
// hook registration and adds it to map. Resolution happens once here, at
// scan time — never re-derived from a caller's request.
function addOneHookItem(map, { scope, event, matcher, command, timeout, origin, source, resolveRoot, pluginRootSub, pluginLabelPrefix }) {
  if (typeof command !== 'string' || !command) return;

  const effectiveCommand = pluginRootSub ? command.split('${CLAUDE_PLUGIN_ROOT}').join(pluginRootSub) : command;
  const found = findHookScriptToken(effectiveCommand);
  const resolvedScript = found ? resolveHookScript(found.token, resolveRoot) : null;

  let label;
  if (resolvedScript) {
    const base = path.basename(resolvedScript).replace(HOOK_SCRIPT_EXT_RE, '');
    const nextRaw = found.tokens[found.index + 1];
    const nextStripped = nextRaw ? stripSurroundingQuotes(nextRaw) : null;
    const nextArg = nextStripped && !SHELL_PUNCTUATION_TOKENS.has(nextStripped) ? nextStripped : null;
    label = nextArg ? `${base} ${nextArg}` : base;
  } else {
    label = effectiveCommand.slice(0, 60);
  }
  if (pluginLabelPrefix) label = `${pluginLabelPrefix}/${label}`;

  const name = `${event} · ${label}`;
  const description = truncateDescription(`${event}${matcher ? ` (${matcher})` : ''} → ${tildify(command)}`);
  // Hash the RAW command, not the tildified one — the id must stay stable and
  // is never displayed, so it has nothing to do with presentation.
  const hash = crypto.createHash('sha1').update(`${event}|${matcher || ''}|${command}`).digest('hex').slice(0, 10);
  const id = `hook:${scope}:${event}:${hash}`;

  let markdown = '**Registration**\n\n```json\n'
    + JSON.stringify({ event, matcher: matcher || null, command: tildify(command), timeout: timeout ?? null }, null, 2)
    + '\n```\n';
  if (resolvedScript) {
    let scriptSrc = '';
    try { scriptSrc = fs.readFileSync(resolvedScript, 'utf8'); } catch { /* unreadable — empty fence is honest here */ }
    const fenceLang = path.extname(resolvedScript).replace(/^\./, '');
    markdown += `\n**Script** (\`${tildify(resolvedScript)}\`)\n\n\`\`\`${fenceLang}\n${scriptSrc}\n\`\`\`\n`;
  } else {
    markdown += '\n_This command does not resolve to a readable script file — it runs inline (a shell '
      + 'one-liner, an unresolvable path, or a path outside the plugin/helpers root)._\n';
  }

  map.set(id, { id, type: 'hook', name, description, origin, source, usedBy: [], markdown });
}

function addLibraryHookItems(map) {
  // User hooks: ~/.claude/settings.json `hooks` key. Paths are already
  // absolute — no ${CLAUDE_PLUGIN_ROOT} substitution needed.
  let settings = null;
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { /* missing/unparsable — no user hooks */ }
  const userHooksCfg = (settings && settings.hooks) || {};
  for (const [event, groups] of Object.entries(userHooksCfg)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const matcher = group.matcher || null;
      for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
        addOneHookItem(map, {
          scope: 'user', event, matcher, command: hook.command, timeout: hook.timeout,
          origin: 'user', source: '~/.claude/settings.json', resolveRoot: HELPERS_DIR,
          pluginRootSub: null, pluginLabelPrefix: null,
        });
      }
    }
  }

  // Plugin hooks: <version-dir>/hooks/hooks.json for each chosen plugin
  // version dir. ${CLAUDE_PLUGIN_ROOT} means "this version dir".
  for (const p of getPluginVersionDirs()) {
    if (!p.hooksFile) continue;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(p.hooksFile, 'utf8')); } catch { continue; }
    const pluginHooksCfg = (parsed && parsed.hooks) || {};
    for (const [event, groups] of Object.entries(pluginHooksCfg)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const matcher = group.matcher || null;
        for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
          addOneHookItem(map, {
            scope: `plugin:${p.marketplace}/${p.plugin}`, event, matcher, command: hook.command, timeout: hook.timeout,
            origin: 'plugin', source: `${p.marketplace}/${p.plugin}@${p.version}`, resolveRoot: p.dir,
            pluginRootSub: p.dir, pluginLabelPrefix: p.plugin,
          });
        }
      }
    }
  }
}

function buildLibraryMap() {
  const map = new Map(); // id -> entry
  const usedByMap = buildLibraryUsedByMap();
  addLibrarySkillItems(map, usedByMap);
  addLibraryCommandItems(map);
  addLibraryInstructionItems(map);
  addLibraryHookItems(map);
  return map;
}

// A directory's own mtime moves when a file is added to or removed from it, so
// four stats are enough to notice a new skill, command or agent. Without this
// the 30s cache meant "I just added a skill and the HUD does not show it" —
// and worse, the source editor's id space stayed stale for the same 30s, so a
// file visible in one list could not be opened from another.
function claudeDirSignature() {
  let sig = '';
  for (const p of [AGENTS_DIR, SKILLS_DIR, COMMANDS_DIR, SETTINGS_PATH]) {
    try { sig += String(fs.statSync(p).mtimeMs) + '|'; } catch { sig += 'x|'; }
  }
  return sig;
}

function getLibraryMap() {
  const now = Date.now();
  const sig = claudeDirSignature();
  if (libraryMapCache.value && libraryMapCache.sig === sig && now - libraryMapCache.at < LIBRARY_CACHE_MS) return libraryMapCache.value;
  libraryMapCache = { at: now, sig, value: buildLibraryMap() };
  return libraryMapCache.value;
}

function handleLibrary(req, res) {
  const items = [...getLibraryMap().values()].map((it) => ({
    id: it.id, type: it.type, name: it.name, description: it.description,
    origin: it.origin, source: it.source, usedBy: it.usedBy || [],
  }));
  items.sort((a, b) => (a.type !== b.type ? a.type.localeCompare(b.type) : a.name.localeCompare(b.name)));
  sendJson(res, 200, { items });
}

// Closed-map lookup, mirroring handleCharter's exact posture: the caller
// passes an identifier only, looked up in a map built entirely at scan time.
// No caller-supplied string ever reaches path.join/resolve or an fs call,
// and an unknown id (including a traversal-shaped one) simply isn't in the
// map — this makes traversal unrepresentable, not merely rejected. The 404
// body never echoes the requested id string back.
function handleLibraryItem(req, res, url) {
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return sendJson(res, 400, { error: 'id required' });
  const entry = getLibraryMap().get(id);
  if (!entry) return sendJson(res, 404, { error: 'unknown library item' });
  let markdown = entry.markdown;
  if (markdown == null) {
    try {
      markdown = splitFrontmatter(fs.readFileSync(entry.file, 'utf8'));
    } catch (err) {
      return sendJson(res, 404, { id: entry.id, error: `File unreadable (${err.code || 'error'}).` });
    }
  }
  sendJson(res, 200, { id: entry.id, type: entry.type, name: entry.name, origin: entry.origin, source: entry.source, markdown });
}

// ============================================================================
// GITHUB — the Workshop surface's data source.
//
// Two ways in, tried in this order:
//
//   1. The `gh` CLI, if it is installed and already signed in. Costs the
//      operator nothing to set up and, more importantly, means this process
//      never holds a GitHub credential at all — it shells out to a tool that
//      already keeps one in the OS keyring.
//   2. OAuth device flow, for machines without `gh`. The operator supplies
//      only a Client ID, which GitHub publishes and is not a secret; the
//      access token is fetched by this server directly from GitHub and is
//      never typed into, echoed by, or displayed in the HUD.
//
// There is deliberately no "paste a personal access token" field. A PAT typed
// into a web page is the one shape of this feature that puts a long-lived
// credential through the browser, and neither path above needs it.
// ============================================================================
const GITHUB_API = 'https://api.github.com';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_SCOPE = 'repo read:org';
const GH_CLI_CACHE_MS = 60 * 1000;
const WORKSHOP_CACHE_MS = 5 * 60 * 1000;

let ghCliCache = { at: 0, value: null }; // { available, login }

// `gh api user` proves three things at once that `gh --version` does not: the
// binary exists, a credential is present, and it is still valid. Anything less
// and the Workshop would report "connected" and then fail on every fetch.
async function ghCliIdentity() {
  const now = Date.now();
  if (ghCliCache.value && now - ghCliCache.at < GH_CLI_CACHE_MS) return ghCliCache.value;
  const out = await new Promise((resolve) => {
    execFile('gh', ['api', 'user', '--jq', '.login'], { timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
  const login = out.trim();
  const value = { available: !!login, login: login || null };
  ghCliCache = { at: now, value };
  return value;
}

function storedGithubToken() {
  return String(loadLocalConfig().githubToken || '').trim() || null;
}
function storedGithubClientId() {
  return String(process.env.ALFRED_GITHUB_CLIENT_ID || loadLocalConfig().githubClientId || '').trim() || null;
}

// One reader for both paths, so every caller downstream is identical.
async function githubApi(pathAndQuery) {
  const token = storedGithubToken();
  if (token) {
    const res = await fetch(GITHUB_API + pathAndQuery, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'alfred-hud' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}${res.status === 401 ? ' — the stored authorisation was rejected; disconnect and reconnect' : ''}`);
    return res.json();
  }
  const cli = await ghCliIdentity();
  if (!cli.available) throw new Error('not connected to GitHub');
  const out = await new Promise((resolve, reject) => {
    execFile('gh', ['api', pathAndQuery], { timeout: 20000, maxBuffer: 8e6 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n')[0] || 'gh api failed'));
      resolve(String(stdout || ''));
    });
  });
  return JSON.parse(out);
}

async function githubIdentity() {
  const token = storedGithubToken();
  if (token) {
    try {
      const me = await githubApi('/user');
      return { connected: true, via: 'device-flow', login: me.login || null };
    } catch (err) {
      return { connected: false, via: 'device-flow', login: null, error: err.message };
    }
  }
  const cli = await ghCliIdentity();
  if (cli.available) return { connected: true, via: 'gh-cli', login: cli.login };
  return { connected: false, via: null, login: null };
}

// --- Device flow ----------------------------------------------------------
// The pending flow lives in memory only, and only one runs at a time. It holds
// a device_code, which is a short-lived bearer of the eventual token — it is
// never written to disk and never sent to the browser. The browser only ever
// sees the user_code, which is meaningless without the operator completing the
// prompt on github.com.
let deviceFlow = null; // { deviceCode, userCode, verificationUri, interval, expiresAt, state, error }

function deviceFlowPublicState() {
  if (!deviceFlow) return { state: 'idle' };
  return {
    state: deviceFlow.state,
    userCode: deviceFlow.userCode,
    verificationUri: deviceFlow.verificationUri,
    expiresAt: deviceFlow.expiresAt,
    error: deviceFlow.error || null,
  };
}

async function pollDeviceFlowOnce(clientId, deviceCode) {
  const res = await fetch(GITHUB_DEVICE_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'alfred-hud' },
    body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  return res.json();
}

// Polls on GitHub's own schedule and obeys slow_down, because polling faster
// than the interval GitHub asked for gets the flow rejected outright.
async function runDeviceFlow(clientId) {
  const flow = deviceFlow;
  let intervalMs = flow.interval * 1000;
  while (deviceFlow === flow && flow.state === 'pending') {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (deviceFlow !== flow) return; // superseded or cancelled
    if (Date.now() > flow.expiresAt) { flow.state = 'expired'; flow.error = 'The code expired before it was entered.'; return; }

    let body;
    try { body = await pollDeviceFlowOnce(clientId, flow.deviceCode); }
    catch (err) { flow.state = 'error'; flow.error = String(err.message || err); return; }

    if (body.access_token) {
      saveLocalConfig({ githubToken: body.access_token });
      ghCliCache = { at: 0, value: null };
      workshopCache = { at: 0, value: null };
      flow.state = 'connected';
      // The token is now on disk with 0600; drop every in-memory trace of the
      // exchange so nothing that can mint one survives in this object.
      flow.deviceCode = null;
      return;
    }
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') { intervalMs += (body.interval ? body.interval * 1000 : 5000); continue; }
    flow.state = body.error === 'expired_token' ? 'expired' : 'error';
    flow.error = body.error_description || body.error || 'GitHub refused the authorisation.';
    return;
  }
}

async function handleGithubDeviceStart(req, res) {
  const clientId = storedGithubClientId();
  if (!clientId) {
    return sendJson(res, 400, {
      error: 'No GitHub OAuth App Client ID configured. Create one at github.com/settings/developers with device flow enabled, then paste its Client ID here. A Client ID is public — it is not a secret.',
    });
  }
  let body;
  try {
    const r = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'alfred-hud' },
      body: JSON.stringify({ client_id: clientId, scope: GITHUB_SCOPE }),
    });
    body = await r.json();
  } catch (err) {
    return sendJson(res, 502, { error: `Could not reach GitHub: ${err.message}` });
  }
  if (!body.device_code) {
    return sendJson(res, 400, { error: body.error_description || body.error || 'GitHub did not issue a device code. Check that the Client ID is right and that device flow is enabled on the app.' });
  }

  deviceFlow = {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri || 'https://github.com/login/device',
    interval: Math.max(5, Number(body.interval) || 5),
    expiresAt: Date.now() + (Number(body.expires_in) || 900) * 1000,
    state: 'pending',
    error: null,
  };
  runDeviceFlow(clientId); // deliberately not awaited — the browser polls /api/github/status
  sendJson(res, 200, deviceFlowPublicState());
}

async function handleGithubStatus(req, res) {
  const identity = await githubIdentity();
  sendJson(res, 200, {
    ...identity,
    clientIdConfigured: !!storedGithubClientId(),
    ghCliInstalled: (await ghCliIdentity()).available,
    device: deviceFlowPublicState(),
  });
}

function handleGithubDisconnect(req, res) {
  saveLocalConfig({ githubToken: '' });
  deviceFlow = null;
  ghCliCache = { at: 0, value: null };
  workshopCache = { at: 0, value: null };
  // `gh` keeps its own credential in the OS keyring and this HUD has no
  // business revoking it, so say plainly which one was cleared.
  sendJson(res, 200, { ok: true, note: 'Cleared the authorisation this HUD stored. A `gh` CLI login, if you have one, is untouched — sign out with `gh auth logout`.' });
}

// --- Workshop -------------------------------------------------------------
let workshopCache = { at: 0, value: null };

// Local clones are matched to remote repos by owner/name parsed out of the
// git remote URL, never by folder name — a clone can be renamed, and matching
// on the folder would confidently attach the wrong repo's state to a card.
function remoteSlug(remote) {
  if (!remote) return null;
  const m = String(remote).match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

async function localClonesBySlug() {
  const bySlug = new Map();
  let payload;
  try { payload = await getProjectsPayload(); } catch { return bySlug; }
  for (const p of payload.projects || []) {
    const slug = remoteSlug(p.remote);
    if (slug && !bySlug.has(slug)) {
      bySlug.set(slug, { name: p.name, path: tildify(p.path), branch: p.branch, dirty: p.dirty, ahead: p.ahead, behind: p.behind, lastCommit: p.lastCommit });
    }
  }
  return bySlug;
}

async function computeWorkshop() {
  const identity = await githubIdentity();
  if (!identity.connected) return { connected: false, ...identity, repos: [] };

  // affiliation=owner,collaborator keeps this to repositories the operator
  // actually works in. Organisation-wide membership can run to hundreds of
  // repos nobody has touched, which would bury the useful cards.
  const raw = await githubApi('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator');
  const clones = await localClonesBySlug();

  const repos = (Array.isArray(raw) ? raw : []).map((r) => {
    const slug = String(r.full_name || '').toLowerCase();
    return {
      slug: r.full_name,
      name: r.name,
      description: r.description || null,
      private: !!r.private,
      fork: !!r.fork,
      archived: !!r.archived,
      language: r.language || null,
      stars: r.stargazers_count || 0,
      openIssues: r.open_issues_count || 0,
      defaultBranch: r.default_branch || null,
      pushedAt: r.pushed_at || null,
      url: r.html_url,
      local: clones.get(slug) || null,
    };
  });

  return {
    connected: true,
    via: identity.via,
    login: identity.login,
    computedAt: new Date().toISOString(),
    repos,
  };
}

async function handleWorkshop(req, res, url) {
  const now = Date.now();
  // ?refresh=1 bypasses the 5-minute cache. Without it there was no way to see a repo you
  // just pushed for up to five minutes, and the only "refresh" available was waiting.
  const forced = url && url.searchParams.get('refresh') === '1';
  if (!forced && workshopCache.value && now - workshopCache.at < WORKSHOP_CACHE_MS) {
    return sendJson(res, 200, workshopCache.value);
  }
  try {
    const value = await computeWorkshop();
    // Only a connected result is cached. Caching "not connected" would make the
    // surface sit on that answer for five minutes after a successful sign-in.
    if (value.connected) workshopCache = { at: now, value };
    sendJson(res, 200, value);
  } catch (err) {
    sendJson(res, 502, { connected: false, repos: [], error: err.message });
  }
}

// ============================================================================
// PROTOCOLS — GET /api/protocols. Claude Code's instruction hierarchy, drawn
// as a pyramid: broadest scope at the top, narrowest at the bottom.
//
// Precedence runs the OTHER WAY to the drawing — the narrowest file that
// speaks to a question is the one that wins — so every tier carries a `note`
// saying so. A pyramid that implies the top overrides the bottom would be a
// picture of the rule backwards, which is worse than no picture.
//
// Enumeration only. This reads the files that already govern the operator's
// installs; it never writes one, and it never invents a tier that has no file
// on disk (a tier with nothing in it renders as an explicit "nothing here",
// never as a silent gap).
// ============================================================================
const PROTOCOLS_CACHE_MS = 15 * 1000;
let protocolsCache = { at: 0, tiers: null, byId: null };

const OUTSIDE_READONLY_REASON = 'Outside your own ~/.claude config — the HUD does not write here.';
const PLUGIN_READONLY_REASON = 'Installed by a plugin — an edit here would be discarded on the next plugin update.';

// Where a managed enterprise policy lives, per platform. Present on very few
// personal machines — absent is the normal case and is reported as such.
function managedSettingsPath() {
  if (process.platform === 'win32') return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
  if (process.platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

const CLAUDE_HOME_DIR = path.join(os.homedir(), '.claude');
// Installed plugins live UNDER ~/.claude, so "inside ~/.claude" on its own is
// not the rule — it would have made every plugin's commands and skills
// writable. They belong to whoever published the plugin and are replaced
// wholesale on the next update, so an edit here is silently discarded later.
// Excluded by path, and each caller ALSO passes its own origin flag, because
// this directory layout is Claude Code's to change and a second, independent
// signal should not depend on it.
const CLAUDE_PLUGINS_DIR = path.join(CLAUDE_HOME_DIR, 'plugins');

// The single editability rule, in one place. The HUD writes the operator's own
// ~/.claude config and nothing else: not plugin-installed files, not a
// project's CLAUDE.md (that is checked into someone's repo), not an enterprise
// policy. Compared on resolved absolute paths with a trailing separator so a
// sibling directory like `~/.claude-backup` cannot pass on a prefix match.
function isUnder(dir, file) {
  const resolved = path.resolve(file);
  return resolved === dir || resolved.startsWith(dir + path.sep);
}
function isEditablePath(file) {
  return isUnder(CLAUDE_HOME_DIR, file) && !isUnder(CLAUDE_PLUGINS_DIR, file);
}

function protocolId(file) {
  return 'protocol:' + crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 12);
}

// What the pyramid shows for a file without opening it: markdown headings, or
// for a settings file its top-level keys. Capped, with the real total kept
// alongside so the UI can say "12 of 34" rather than quietly truncating.
function protocolRules(file, content) {
  const isJson = file.toLowerCase().endsWith('.json');
  let all = [];
  if (isJson) {
    try { all = Object.keys(JSON.parse(content)); } catch { all = []; }
  } else {
    const re = /^(#{1,3})\s+(.+?)\s*$/gm;
    let m;
    while ((m = re.exec(content)) !== null) all.push({ depth: m[1].length, text: m[2] });
  }
  const shown = all.slice(0, 14);
  return {
    kind: isJson ? 'keys' : 'headings',
    rules: isJson ? shown.map((k) => ({ depth: 1, text: k })) : shown,
    ruleCount: all.length,
  };
}

function protocolEntry(file, label, extra = {}) {
  let stat = null;
  try { stat = fs.statSync(file); } catch { return null; } // missing file is not an entry — never fabricate one
  if (!stat.isFile()) return null;
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { /* unreadable — reported as 0 rules below */ }
  const editable = isEditablePath(file);
  return {
    id: protocolId(file),
    label,
    path: tildify(file),
    file,
    bytes: stat.size,
    lines: content ? content.split(/\r?\n/).length : 0,
    mtimeMs: stat.mtimeMs,
    mtime: new Date(stat.mtimeMs).toISOString(),
    editable,
    readOnlyReason: editable ? null : (extra.readOnlyReason || OUTSIDE_READONLY_REASON),
    ...protocolRules(file, content),
    ...(extra.badge ? { badge: extra.badge } : {}),
  };
}

// Nested CLAUDE.md files one level below a project root, plus .claude/rules/.
// One level deep on purpose: a full recursive walk of every project would stat
// node_modules on a HUD that repaints every 30 seconds.
function scopedProtocolFiles(projectDir) {
  const out = [];
  const rulesDir = path.join(projectDir, '.claude', 'rules');
  let ruleFiles = [];
  try { ruleFiles = fs.readdirSync(rulesDir).filter((f) => f.toLowerCase().endsWith('.md')).sort(); } catch { /* no rules dir */ }
  for (const f of ruleFiles) out.push({ file: path.join(rulesDir, f), label: `${path.basename(projectDir)} · rules/${f}` });

  let subdirs = [];
  try {
    subdirs = fs.readdirSync(projectDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => d.name).sort();
  } catch { /* unreadable project dir */ }
  for (const sub of subdirs) {
    const f = path.join(projectDir, sub, 'CLAUDE.md');
    if (fs.existsSync(f)) out.push({ file: f, label: `${path.basename(projectDir)} · ${sub}/CLAUDE.md` });
  }
  return out;
}

function projectDirsWithConfig() {
  const dirs = [];
  for (const root of PROJECT_ROOTS) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
    for (const d of entries) {
      const p = path.join(root, d.name);
      if (fs.existsSync(path.join(p, 'CLAUDE.md')) || fs.existsSync(path.join(p, '.claude'))) dirs.push(p);
    }
  }
  return dirs.sort();
}

function buildProtocolTiers() {
  const push = (arr, file, label, extra) => { const e = protocolEntry(file, label, extra); if (e) arr.push(e); };

  const enterprise = [];
  push(enterprise, managedSettingsPath(), 'managed-settings.json', {
    readOnlyReason: 'Managed policy — set by whoever administers this machine, not by you.',
  });

  const user = [];
  push(user, path.join(CLAUDE_HOME_DIR, 'CLAUDE.md'), '~/.claude/CLAUDE.md', { badge: 'global' });
  push(user, path.join(CLAUDE_HOME_DIR, 'settings.json'), '~/.claude/settings.json');
  push(user, PROFILE_PATH, '~/.claude/alfred-profile.md');

  const home = [];
  push(home, HOME_CLAUDE_MD_PATH, '~/CLAUDE.md');

  const projectDirs = projectDirsWithConfig();
  const project = [];
  const scoped = [];
  for (const dir of projectDirs) {
    const name = path.basename(dir);
    push(project, path.join(dir, 'CLAUDE.md'), `${name}/CLAUDE.md`);
    push(project, path.join(dir, '.claude', 'settings.json'), `${name}/.claude/settings.json`);
    for (const s of scopedProtocolFiles(dir)) push(scoped, s.file, s.label);
  }

  return [
    {
      key: 'enterprise',
      label: 'Enterprise policy',
      scope: 'Every user on this machine',
      note: 'Administrator-managed. Nothing below can override it.',
      entries: enterprise,
      emptyText: 'No managed policy on this machine — normal for a personal install.',
    },
    {
      key: 'user',
      label: 'User',
      scope: 'Every project you open',
      note: 'Your own global instructions. This is the layer the HUD can edit.',
      entries: user,
      emptyText: 'No ~/.claude/CLAUDE.md yet.',
    },
    {
      key: 'home',
      label: 'Home directory',
      scope: 'Every project under your home folder',
      note: 'Picked up because Claude Code reads CLAUDE.md from the working directory up to the root.',
      entries: home,
      emptyText: 'No CLAUDE.md in your home directory.',
    },
    {
      key: 'project',
      label: 'Project',
      scope: 'One repository',
      note: 'Checked into the repo, so it travels with the code and applies to everyone working on it.',
      entries: project,
      emptyText: 'No project CLAUDE.md found under your project roots.',
    },
    {
      key: 'scoped',
      label: 'Scoped rules',
      scope: 'One directory inside a repository',
      note: 'The narrowest layer, and the one that wins where it applies.',
      entries: scoped,
      emptyText: 'No .claude/rules or nested CLAUDE.md files.',
    },
  ];
}

function getProtocols() {
  const now = Date.now();
  if (protocolsCache.tiers && now - protocolsCache.at < PROTOCOLS_CACHE_MS) return protocolsCache;
  const tiers = buildProtocolTiers();
  const byId = new Map();
  for (const tier of tiers) for (const e of tier.entries) byId.set(e.id, { ...e, tier: tier.key });
  protocolsCache = { at: now, tiers, byId };
  return protocolsCache;
}

function handleProtocols(req, res) {
  const { tiers } = getProtocols();
  // `file` is the absolute path, kept server-side for the source registry and
  // deliberately not shipped — the UI addresses entries by id and shows the
  // tildified path, so nothing here publishes the account name.
  sendJson(res, 200, {
    computedAt: new Date().toISOString(),
    precedence: 'Narrowest wins: a scoped rule beats a project CLAUDE.md, which beats your user file.',
    tiers: tiers.map((t) => ({ ...t, entries: t.entries.map(({ file, ...rest }) => rest) })),
  });
}

// ============================================================================
// SOURCE — GET /api/source and POST /api/source/save. One registry of every
// file the HUD is allowed to show as raw text or write back.
//
// Two things this deliberately does NOT reuse:
//   - /api/library/item and /api/charter both serve `splitFrontmatter(...)`.
//     Editing what they return and saving it would silently delete an agent's
//     frontmatter — its name, tier and model — so the editor reads the FULL
//     file through here instead, and never through a display route.
//   - path handling. Same closed-map posture as handleLibraryItem: ids are
//     minted at scan time from files this process already found, so a
//     traversal-shaped id is simply not a key in the map.
// ============================================================================
function buildSourceMap() {
  const map = new Map(); // id -> { id, label, file, kind, editable, readOnlyReason }
  // `fromPlugin` is a second, independent veto alongside the path check. Either
  // one alone is enough to make a file read-only.
  const add = (id, label, file, kind, { fromPlugin = false, reason = null } = {}) => {
    if (!id || !file || map.has(id)) return;
    const editable = isEditablePath(file) && !fromPlugin;
    map.set(id, {
      id, label, file, kind, editable,
      readOnlyReason: editable ? null
        : (reason || (fromPlugin ? PLUGIN_READONLY_REASON : OUTSIDE_READONLY_REASON)),
    });
  };

  for (const e of getProtocols().byId.values()) add(e.id, e.label, e.file, 'protocol', { reason: e.readOnlyReason });
  for (const e of getLibraryMap().values()) {
    if (!e.file) continue; // hooks are synthesized from settings.json, not a file of their own
    add(e.id, e.name, e.file, 'library', { fromPlugin: e.origin === 'plugin' });
  }
  for (const e of getCharterMap().values()) {
    add('agent:' + e.name.toLowerCase(), e.name, e.file, 'agent', { fromPlugin: e.origin === 'plugin' });
  }
  return map;
}

// Rebuilt on every call rather than cached separately: every input it composes
// is already cached (protocols 15s, library 30s, charters 30s), so a stale
// source map would only add a fourth, longer staleness window over the same
// data — and an id the UI just saw in a list must resolve on the next click.
function getSourceMap() { return buildSourceMap(); }

function sourceLanguage(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.md') return 'markdown';
  return ext.replace(/^\./, '') || 'text';
}

function handleSource(req, res, url) {
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return sendJson(res, 400, { error: 'id required' });
  const entry = getSourceMap().get(id);
  if (!entry) return sendJson(res, 404, { error: 'unknown source' });

  let content, stat;
  try {
    stat = fs.statSync(entry.file);
    content = fs.readFileSync(entry.file, 'utf8');
  } catch (err) {
    return sendJson(res, 404, { id: entry.id, error: `File unreadable (${err.code || 'error'}).` });
  }
  sendJson(res, 200, {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    path: tildify(entry.file),
    language: sourceLanguage(entry.file),
    editable: entry.editable,
    readOnlyReason: entry.readOnlyReason,
    mtimeMs: stat.mtimeMs,
    bytes: stat.size,
    content,
  });
}

async function handleSourceSave(req, res) {
  let body;
  try { body = await readJsonBody(req, 4e6); } catch (err) { return sendJson(res, 400, { error: err.message }); }

  const id = String(body.id || '').trim();
  const entry = getSourceMap().get(id);
  if (!entry) return sendJson(res, 404, { error: 'unknown source' });
  if (!entry.editable) return sendJson(res, 403, { error: entry.readOnlyReason || 'not editable' });
  if (typeof body.content !== 'string') return sendJson(res, 400, { error: 'content must be a string' });

  // A settings file that does not parse takes hooks, permissions and model
  // routing down with it, and the failure shows up later as "the hook stopped
  // firing" rather than as a save error. Refuse it here, where the cause is
  // still on screen.
  if (sourceLanguage(entry.file) === 'json') {
    try { JSON.parse(body.content); } catch (err) { return sendJson(res, 400, { error: `Not valid JSON: ${err.message}` }); }
  }

  // Optimistic-concurrency check. The editor diffs against the copy it loaded;
  // if the file moved underneath, that diff is describing a state that no
  // longer exists, so the write is refused rather than silently winning.
  let stat;
  try { stat = fs.statSync(entry.file); } catch (err) { return sendJson(res, 404, { error: `File unreadable (${err.code || 'error'}).` }); }
  if (body.baseMtimeMs != null && Math.abs(stat.mtimeMs - Number(body.baseMtimeMs)) > 1) {
    return sendJson(res, 409, { error: 'File changed on disk since you opened it. Reload it and re-apply your edit.', mtimeMs: stat.mtimeMs });
  }

  // Write via a sibling temp file and rename, so a crash mid-write leaves the
  // original intact instead of a truncated CLAUDE.md.
  const tmp = entry.file + '.alfred-tmp';
  try {
    fs.writeFileSync(tmp, body.content, 'utf8');
    fs.renameSync(tmp, entry.file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return sendJson(res, 500, { error: `Write failed (${err.code || 'error'}).` });
  }

  // Anything derived from this file is now wrong. Cheaper to drop the caches
  // than to work out which of them the edit touched.
  protocolsCache = { at: 0, tiers: null, byId: null };
  libraryMapCache = { at: 0, value: null };
  charterMapCache = { at: 0, value: null };

  const after = fs.statSync(entry.file);
  sendJson(res, 200, { ok: true, id: entry.id, mtimeMs: after.mtimeMs, bytes: after.size });
}

// "Brain: N uncommitted" in the status frame. Cached
// 30s: `git status --porcelain` against a repo the size of the brain (248
// files at time of writing) is not free, and /api/status is now polled every
// 10s on the brain view alone.
let brainDirtyCache = null; // { computedAtMs, count }
const BRAIN_DIRTY_CACHE_MS = 30 * 1000;
async function getBrainDirtyCount() {
  const now = Date.now();
  if (brainDirtyCache && now - brainDirtyCache.computedAtMs < BRAIN_DIRTY_CACHE_MS) return brainDirtyCache.count;
  const out = await runGit(resolveVaultDir(), ['status', '--porcelain']);
  const count = out != null ? out.split('\n').filter((l) => l.trim()).length : null;
  brainDirtyCache = { computedAtMs: now, count };
  return count;
}

// WS10 — per-folder brain activity, so the cortical regions in the Brain view
// light up for a REASON rather than on a decorative timer.
//
// The signal is note mtime: a memory that was written or rewritten recently is
// a region that has been active. This is the only access signal that actually
// exists on disk — nothing records a note being *read*, and inventing a
// plausible-looking number for that would be a lit region asserting something
// no file on this machine knows.
//
// Scored as a linear decay to zero over the window, per folder, taking the
// most recent note rather than a sum: one note touched a minute ago is a live
// region, and a folder with forty stale notes is not more active than one with
// two fresh ones.
//
// Scoped to index.notes, so a note created since the last reindex does not
// light its region until the index catches up. That is the honest boundary —
// the brain lights up for what it actually knows about, and the rail already
// shows an Indexed age and a Reindex button for exactly this gap.
const ACTIVITY_WINDOW_MS = 6 * 60 * 60 * 1000;
const ACTIVITY_CACHE_MS = 15 * 1000;
let activityCache = null; // { computedAtMs, value }

function buildBrainActivity(index) {
  const now = Date.now();
  if (activityCache && now - activityCache.computedAtMs < ACTIVITY_CACHE_MS) return activityCache.value;
  const folders = {};
  const vaultRoot = resolveVaultDir();
  for (const n of index.notes) {
    const folder = n.folder || 'Other';
    let mtimeMs;
    try { mtimeMs = fs.statSync(path.join(vaultRoot, n.path)).mtimeMs; } catch { continue; }
    const age = now - mtimeMs;
    if (age < 0 || age > ACTIVITY_WINDOW_MS) continue;
    const score = 1 - age / ACTIVITY_WINDOW_MS;
    const prior = folders[folder];
    if (!prior || score > prior.score) {
      folders[folder] = { score: Math.round(score * 1000) / 1000, lastMs: Math.round(age), count: prior ? prior.count + 1 : 1 };
    } else {
      prior.count += 1;
    }
  }
  const value = { windowMs: ACTIVITY_WINDOW_MS, folders };
  activityCache = { computedAtMs: now, value };
  return value;
}

// Counts for the rail's "Files" stat: vault notes plus every artifact the
// Library and Roster expose, keyed by kind. Deliberately derived from the same
// cached maps those views read, so the number in the rail can never disagree
// with what clicking through actually shows.
function buildFileCounts(index) {
  const out = { notes: index.notes.length, agents: 0, skill: 0, command: 0, hook: 0, instruction: 0 };
  try { out.agents = getCharterMap().size; } catch { /* unreadable roster — leave 0 */ }
  try {
    for (const item of getLibraryMap().values()) {
      if (out[item.type] != null) out[item.type] += 1;
    }
  } catch { /* library scan failed — the notes/agents figures are still honest */ }
  out.total = out.notes + out.agents + out.skill + out.command + out.hook + out.instruction;
  return out;
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
    askEngine: lastAskEngine,
    rosterAgents: orgCounts.rosterAgents,
    activeSessions: orgCounts.activeSessions,
    activeSubagents: orgCounts.activeSubagents,
    indexStale: isIndexStale(),
    brainDirty: await getBrainDirtyCount(),
    // Everything Alfred can see, broken down by kind. The rail used to show
    // only the vault-note count under the label "Case Files", which stopped
    // being the whole story once agents and the Library were indexed — it
    // reported 110 while the HUD could actually browse ~350 things. Both
    // sources are already cached (30s), so this costs a map lookup, not a scan.
    fileCounts: buildFileCounts(index),
    // Per-folder recency, driving the Brain view's region glow (WS10).
    brainActivity: buildBrainActivity(index),
    uiBuild: uiBuildStamp(),
    serverBuild: serverBuildStamp(),
    serverStarted: new Date(SERVER_STARTED_MS).toISOString(),
  });
}

// POST /api/reindex [token]. Runs the existing
// buildIndex() (already imported for CLI parity with index-vault.mjs) without
// blocking the HTTP request on it, so the CEO can watch a slow embed loop
// progress.
//
// Progress used to be pushed into the shell terminal's ring buffer and read
// back through /api/terminal/output. That coupled a first-class feature to a
// feature being deleted, so it now has its own small ring plus an explicit
// phase, polled at GET /api/reindex/status. 200 lines is ample: buildIndex
// logs roughly one line per embedded note and only the tail is interesting.
const reindexRing = makeRing(200);
const reindex = { running: false, phase: 'idle', startedAt: null, finishedAt: null, error: null };

async function handleReindex(req, res) {
  if (reindex.running) {
    return sendJson(res, 409, { error: 'reindex already running' });
  }
  reindex.running = true;
  reindex.phase = 'running';
  reindex.startedAt = new Date().toISOString();
  reindex.finishedAt = null;
  reindex.error = null;
  sendJson(res, 202, { started: true });
  ringPush(reindexRing, '[alfred] reindex started…', 'system');
  try {
    await buildIndex({ log: (line) => ringPush(reindexRing, String(line), 'system') });
    indexCache = null; invalidateIndexDerived(); // force a reload on the next /api/graph, /api/search, etc.
    reindex.phase = 'complete';
    ringPush(reindexRing, '[alfred] reindex complete.', 'system');
  } catch (err) {
    reindex.phase = 'failed';
    reindex.error = err.message;
    ringPush(reindexRing, '[alfred] reindex failed: ' + err.message, 'error');
  } finally {
    reindex.running = false;
    reindex.finishedAt = new Date().toISOString();
  }
}

// GET /api/reindex/status?after=<seq> [token] — the replacement read side.
// `phase` is the machine-readable answer ('idle' | 'running' | 'complete' |
// 'failed'); the lines are the human-readable progress the old terminal
// scrollback carried.
function handleReindexStatus(req, res, url) {
  const after = parseInt(url.searchParams.get('after'), 10);
  sendJson(res, 200, {
    ...ringSince(reindexRing, after),
    running: reindex.running,
    phase: reindex.phase,
    startedAt: reindex.startedAt,
    finishedAt: reindex.finishedAt,
    error: reindex.error,
  });
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

// Hands the SAME session to a real console, where the full TUI can render —
// the escape hatch for when the line-based panel isn't enough.
// The ONLY session affordance the HUD has left, and deliberately so. Alfred is
// an observe surface; when you want a prompt you get a real terminal, not a
// line-based imitation of one inside a dashboard.
//
// It resumes the most recently touched top-level transcript. A transcript's
// filename IS its session id — the same mapping buildOrgDetail relies on — and
// `topLevel` is what distinguishes a real session from a subagent transcript
// (those sit at <dirKey>/<parentSessionId>/subagents/, so parts.length is 4 or
// 6, not 2). Resuming a subagent's transcript would drop you into a child
// agent's context rather than your own session.
//
// Transcripts written within ORG_ACTIVE_MS are skipped. That is the same
// threshold the rest of this file uses to mean "this session is live", and a
// live transcript is one already open in a client somewhere — usually the very
// terminal the operator is sitting in. Without this the button would hand you a
// second client attached to the conversation you are already having, which is
// not what "open a terminal" means. Verified against the real tree: the naive
// most-recent pick selected the session running this HUD's own build work.
function mostRecentSessionId() {
  const now = Date.now();
  let best = null;
  for (const f of getTranscriptIndex()) {
    if (!f.topLevel) continue;
    if (now - f.mtimeMs < ORG_ACTIVE_MS) continue; // live elsewhere — don't double-attach
    if (!best || f.mtimeMs > best.mtimeMs) best = f;
  }
  return best ? path.basename(best.path, '.jsonl') : null;
}

function handleChatOpenTerminal(req, res) {
  const home = os.homedir();
  // A live HUD session still wins when there is one — falling straight to the
  // transcript scan would resume by mtime and could pick a different session.
  const sid = mostRecentSessionId();
  const bin = resolveClaudeBin();
  // No transcript anywhere means a first run: open a plain `claude` rather
  // than failing. There is nothing to resume, but "open me a terminal" is
  // still a request this can honour.
  const claudeArgs = sid ? [bin, '--resume', sid] : [bin];
  // wt first (tabs, better font); cmd's `start` as the always-present fallback.
  execFile('wt.exe', ['-d', home, ...claudeArgs], (err) => {
    if (!err) return;
    execFile('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', ...claudeArgs], { cwd: home }, () => {});
  });
  sendJson(res, 200, { ok: true, sessionId: sid, resumed: !!sid });
}

// POST /api/org/selftest [token] — prove the chain of command actually wires up.
//
// Spawns ONE real Claude Code turn whose prompt instructs a three-deep delegation:
// VP -> manager -> employee, each doing nothing but passing a word along. The nested
// subagent transcripts that produces are what the org chart reads, so the lineage it
// draws is REAL delegation, not injected activity. That distinction matters: a synthetic
// chain would make this feature a liar in the one place people photograph it.
//
// Costs a handful of tokens by design — every agent in it is told to answer in one word
// and to touch no files.
const SELFTEST_PROMPT = [
  'ORCHESTRATION SELF-TEST. Do no real work, read no files, write no files.',
  'Use the Agent tool to engage the `cto` agent with exactly this instruction:',
  '"Orchestration self-test. Use the Agent tool to engage `backend-manager` with exactly this',
  'instruction: \'Orchestration self-test. Use the Agent tool to engage `backend-api-dev` and ask',
  'it to reply with the single word READY. Reply with only the word it gave you.\' Reply with only',
  'the word it gave you."',
  'Then reply with only the word you received. Nothing else.',
].join(' ');

async function handleOrgSelfTest(req, res) {
  if (selfTest.running) {
    return sendJson(res, 409, { error: 'a self-test is already running', selfTest: selfTestSummary() });
  }
  const bin = resolveClaudeBin();
  if (!bin) return sendJson(res, 503, { error: 'the claude CLI was not found on PATH' });

  const run = launchAgent(SELFTEST_PROMPT, 'sonnet');
  selfTest.running = true;
  selfTest.runId = run.id;
  selfTest.startedAt = new Date().toISOString();
  selfTest.endedAt = null;
  selfTest.status = 'running';
  selfTest.error = null;

  // launchAgent resolves its own promise internally, so poll the run record rather than
  // reaching into it — the widened activity window must close even if the turn fails.
  const started = Date.now();
  const poll = setInterval(() => {
    const r = agentRuns.get(run.id);
    const timedOut = Date.now() - started > ORG_SELFTEST_ACTIVE_MS;
    if ((r && r.status !== 'running') || timedOut) {
      clearInterval(poll);
      selfTest.running = false;
      selfTest.endedAt = new Date().toISOString();
      selfTest.status = timedOut ? 'timeout' : (r ? r.status : 'unknown');
      if (timedOut) selfTest.error = 'the self-test exceeded its window and was abandoned';
    }
  }, 1000);
  poll.unref?.();

  sendJson(res, 202, { started: true, selfTest: selfTestSummary(), run: agentSummary(run) });
}

function selfTestSummary() {
  const run = selfTest.runId ? agentRuns.get(selfTest.runId) : null;
  return {
    running: selfTest.running,
    status: selfTest.status,
    runId: selfTest.runId,
    startedAt: selfTest.startedAt,
    endedAt: selfTest.endedAt,
    error: selfTest.error,
    // While a self-test holds the window open, say so on the API rather than letting the
    // chart silently imply everything was busy at the same instant.
    activeWindowMs: orgActiveMs(),
    runStatus: run ? run.status : null,
  };
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

      if (url.pathname === '/api/ask/stream') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return await handleAskStream(req, res);
      }

      // Never approve a cross-origin preflight. Combined with the custom
      // X-Alfred-Token header this is what stops a random webpage from POSTing
      // to the bridge: the browser asks first, and the answer is always no.
      if (req.method === 'OPTIONS') return sendText(res, 403, 'forbidden');

      // --- Mutating bridge endpoints: token-gated, loopback-only ---
      if (req.method === 'POST') {
        const agentAction = url.pathname.match(/^\/api\/agents\/([\w-]+)\/kill$/);
        // NOTE: this allowlist is the execution bridge, NOT the terminal's.
        // Removing the terminal removed /api/terminal/input from it; every
        // other entry — agents, interns, reindex, approvals — is shared
        // infrastructure and stays.
        const isBridgePost = url.pathname === '/api/claude/open-terminal'
          || url.pathname === '/api/agents/launch'
          || url.pathname === '/api/org/selftest'
          || url.pathname === '/api/interns/run'
          || url.pathname === '/api/interns/pull'
          || url.pathname === '/api/settings'
          || url.pathname === '/api/reindex'
          || url.pathname === '/api/source/save'
          || url.pathname === '/api/github/device/start'
          || url.pathname === '/api/github/disconnect'

          || agentAction;
        if (!isBridgePost) return sendJson(res, 404, { error: 'not found' });
        if (!authorize(req, res)) return;

        if (url.pathname === '/api/claude/open-terminal') return handleChatOpenTerminal(req, res);
        if (url.pathname === '/api/agents/launch') return await handleAgentLaunch(req, res);
        if (url.pathname === '/api/org/selftest') return await handleOrgSelfTest(req, res);
        if (url.pathname === '/api/interns/run') return await handleInternRun(req, res);
        if (url.pathname === '/api/interns/pull') return await handleInternPull(req, res);
        if (url.pathname === '/api/settings') return await handleSettingsPost(req, res);
        if (url.pathname === '/api/reindex') return await handleReindex(req, res);
        if (url.pathname === '/api/source/save') return await handleSourceSave(req, res);
        if (url.pathname === '/api/github/device/start') return await handleGithubDeviceStart(req, res);
        if (url.pathname === '/api/github/disconnect') return handleGithubDisconnect(req, res);
        if (agentAction) return handleAgentKill(req, res, agentAction[1]);
      }

      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

      // Bridge reads. These expose chat transcripts and agent output, so unlike
      // the vault observe endpoints they are token-gated too. Reindex progress
      // joins them because it used to be read through /api/terminal/output,
      // which was gated — dropping the gate would be a silent widening.
      const agentOutput = url.pathname.match(/^\/api\/agents\/([\w-]+)\/output$/);
      if (url.pathname === '/api/reindex/status'
          || url.pathname === '/api/interns/pull/status' || url.pathname === '/api/settings'
          || url.pathname === '/api/agents' || url.pathname === '/api/interns/models'
          || url.pathname === '/api/github/status' || url.pathname === '/api/workshop'
          || agentOutput) {
        if (!authorize(req, res)) return;
        if (url.pathname === '/api/github/status') return await handleGithubStatus(req, res);
        if (url.pathname === '/api/workshop') return await handleWorkshop(req, res, url);
        if (url.pathname === '/api/reindex/status') return handleReindexStatus(req, res, url);
        if (url.pathname === '/api/agents') return handleAgentList(req, res);
        if (url.pathname === '/api/interns/models') return sendJson(res, 200, { models: await listInternModels(), ...(await buildInternBench()) });
        if (url.pathname === '/api/interns/pull/status') return handleInternPullStatus(req, res, url);
        if (url.pathname === '/api/settings') return handleSettingsGet(req, res);
        return handleAgentOutput(req, res, agentOutput[1], url);
      }

      if (url.pathname === '/' || url.pathname === '/index.html') return handleUi(req, res);
      if (url.pathname === '/api/graph') return await handleGraph(req, res);
      if (url.pathname === '/api/org') return await handleOrg(req, res, url);
      if (url.pathname === '/api/usage') return await handleUsage(req, res);
      if (url.pathname === '/api/search') return await handleSearch(req, res, url);
      if (url.pathname === '/api/note') return await handleNote(req, res, url);
      if (url.pathname === '/api/charter') return handleCharter(req, res, url);
      if (url.pathname === '/api/agent-directory') return handleAgentDirectory(req, res);
      if (url.pathname === '/api/search-index') return handleSearchIndex(req, res);
      if (url.pathname === '/api/library') return handleLibrary(req, res);
      if (url.pathname === '/api/library/item') return handleLibraryItem(req, res, url);
      if (url.pathname === '/api/protocols') return handleProtocols(req, res);
      if (url.pathname === '/api/source') return handleSource(req, res, url);
      if (url.pathname === '/api/status') return await handleStatus(req, res);
      if (url.pathname === '/api/projects') return await handleProjects(req, res);

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

  const shutdown = () => {
    removeTokenFile();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
