#!/usr/bin/env node
// Token/dollar spend ledger for the Alfred estate.
//
// This module owns: the record shape written to the ledger, the append
// function (append-only, never rewrites), a read-all function, and query
// helpers shaped for a future `GET /api/usage?days=N` endpoint. It does NOT
// walk the ~/.claude/projects transcript tree itself — that is the backfill
// script's job (a separate file, sequenced after this one). This module only
// defines the contract that script writes against.
//
// Nothing in this file has import-time side effects (no directory creation,
// no server boot) — safe to import from a test or from a future HTTP handler.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Default on-disk locations (path-overridable everywhere below; tests
// must never touch these real paths) ---
export const DEFAULT_LEDGER_PATH = path.join(os.homedir(), '.claude', 'metrics', 'spend.jsonl');
export const DEFAULT_CHECKPOINT_PATH = path.join(os.homedir(), '.claude', 'metrics', 'spend-backfill-state.json');

// --- Pricing (copied from brain/server.mjs:676-683 [modelFamily] and
// brain/server.mjs:690-695 [DEFAULT_PRICES] — keep these two blocks in sync
// by hand if server.mjs's prices ever change; not imported directly because
// server.mjs is a live-editing server entrypoint with top-level boot side
// effects). List price per million tokens, by model family. ---
export function modelFamily(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('fable')) return 'fable';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'other';
}

const DEFAULT_PRICES = {
  fable:  { in: 10, out: 50 },
  opus:   { in: 5,  out: 25 },
  sonnet: { in: 3,  out: 15 },
  haiku:  { in: 1,  out: 5 },
};

// Approximate Anthropic cache economics relative to a model's base input price.
// A sibling agent is finalizing exact multipliers elsewhere — these are placeholders
// that can be corrected here without touching the record shape or the writer/reader API.
const CACHE_WRITE_MULTIPLIER = 1.25; // cache creation ~= 1.25x base input price
const CACHE_READ_MULTIPLIER  = 0.10; // cache read ~= 0.10x base input price

// costUsd() in server.mjs (line ~705) only ever priced inTok/outTok — it never
// looked at cache_creation_input_tokens or cache_read_input_tokens at all. In
// an agent estate, cache reads/writes dominate total token volume, so ignoring
// them silently understates spend. This version prices all four token types,
// pricing the two cache types off the SAME family's base input rate.
export function costUsd({ family, inTok = 0, outTok = 0, cacheCreationTok = 0, cacheReadTok = 0 } = {}) {
  const p = DEFAULT_PRICES[family];
  if (!p) return 0; // unpriced family (local/intern models, "other") -> 0, same fallback as server.mjs
  const base = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
  const cacheWrite = (cacheCreationTok / 1e6) * p.in * CACHE_WRITE_MULTIPLIER;
  const cacheRead = (cacheReadTok / 1e6) * p.in * CACHE_READ_MULTIPLIER;
  return base + cacheWrite + cacheRead;
}

// --- Project name resolution ---
// This estate's projects all live under a `_Projects\<Name>\...` path segment in
// `cwd`. That is a far better label than `dirKey` (the mangled-cwd directory
// name transcripts are actually stored under), so prefer it whenever a cwd is
// available and fall back to dirKey only when it isn't (e.g. a transcript line
// that never recorded cwd).
const PROJECTS_DIR_SEGMENT_RE = /_Projects[\\/]([^\\/]+)/;
export function resolveProjectName({ cwd, dirKey } = {}) {
  if (cwd) {
    const m = String(cwd).match(PROJECTS_DIR_SEGMENT_RE);
    if (m) return m[1];
  }
  return dirKey || null;
}

// --- Record shape ---
// One JSON object per line in the ledger, one record per (transcript-chunk x
// model) — a single byte-range chunk can carry usage for more than one model
// if the session switched models mid-chunk, and each (chunk, model) pair gets
// its own record/dedupeKey. Field list is fixed — do not add fields beyond
// this without updating the table this was speced against.
//
//   date                  YYYY-MM-DD, from the FIRST usage-bearing line's timestamp in the chunk
//   agent                 agentType from sidecar; "main" for top-level sessions;
//                         "unknown-subagent" for a subagents/-dir file with no sidecar
//   agentId               from the sidecar filename; null for top-level sessions
//   parentAgentId         from sidecar; null if none
//   spawnDepth            from sidecar (number); null if none
//   model                 raw model string off the transcript line
//   modelFamily           fable|opus|sonnet|haiku|other, via modelFamily() above
//   project               resolveProjectName() result
//   inputTokens           sum of usage.input_tokens in the chunk for this model
//   outputTokens          sum of usage.output_tokens
//   cacheCreationTokens   sum of usage.cache_creation_input_tokens (never folded into inputTokens)
//   cacheReadTokens       sum of usage.cache_read_input_tokens (never folded into inputTokens)
//   costUsd               costUsd() over the four token fields above
//   dedupeKey             "<relSourceFile>:<chunkStartByte>-<chunkEndByte>:<model>"
//   sourceFile            transcript path relative to ~/.claude/projects
export function buildSpendRecord({
  date, agent, agentId = null, parentAgentId = null, spawnDepth = null,
  model, project = null, inputTokens = 0, outputTokens = 0,
  cacheCreationTokens = 0, cacheReadTokens = 0, dedupeKey, sourceFile,
} = {}) {
  const family = modelFamily(model);
  const cost = costUsd({
    family,
    inTok: inputTokens,
    outTok: outputTokens,
    cacheCreationTok: cacheCreationTokens,
    cacheReadTok: cacheReadTokens,
  });
  return {
    date, agent, agentId, parentAgentId, spawnDepth,
    model, modelFamily: family, project,
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    costUsd: cost,
    dedupeKey, sourceFile,
  };
}

// --- Append (write side) ---
// spend.jsonl is append-only: never read-modify-rewrite it. Skip the whole
// operation for an empty array so a rerun that found nothing new never even
// opens the file — that "skip when nothing new" behavior is what makes
// rerun-adds-zero-records true for the caller.
export function appendSpendRecords(records, ledgerPath = DEFAULT_LEDGER_PATH) {
  if (!Array.isArray(records) || records.length === 0) return;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(ledgerPath, lines, 'utf8');
}

// --- Read-all (read side) ---
// The ledger is small relative to the 706MB transcript tree it summarizes —
// a plain full read is fine here. Malformed lines (e.g. a torn write from a
// crash mid-append) are skipped rather than throwing, since one bad line
// should not blind every other query against the file.
export function readAllRecords(ledgerPath = DEFAULT_LEDGER_PATH) {
  if (!fs.existsSync(ledgerPath)) return [];
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip a torn/malformed line */ }
  }
  return out;
}

// --- Checkpoint (idempotency mechanism) ---
//
// CONTRACT for the caller that owns the actual read loop (the backfill
// script, built next, against THIS module's API — read this before hand-
// rolling anything against the checkpoint file):
//
//   1. Transcripts are append-only and only ever grow. Re-reading a
//      transcript file from a saved byte offset (fs.createReadStream({start:
//      offset})) is therefore always safe and cheap, even against a live
//      session that is still being written to.
//   2. The checkpoint file maps relSourceFile -> { byteOffset }, where
//      byteOffset is how far into that file processing has already gotten.
//   3. The caller MUST only advance a file's byteOffset up to the end of the
//      LAST FULLY-TERMINATED line it actually saw (i.e. a line ending in
//      '\n') — never to a byte position in the middle of a line, because the
//      file's tail may be being written concurrently by a live session and a
//      half-written line read now may not be the line that ends up on disk.
//   4. The caller is responsible for skipping appendSpendRecords entirely
//      (call it with an empty array, which is a no-op) when a rerun finds no
//      new fully-terminated lines past the saved offset — that is what makes
//      "rerun adds zero records" true end to end.
//   5. This file is NOT the append-only ledger. It is a small, plain JSON
//      checkpoint — a full rewrite on every save is fine and expected.
//
// loadCheckpoint on a path that does not exist (first run ever) returns an
// empty Map rather than throwing.
export function loadCheckpoint(checkpointPath = DEFAULT_CHECKPOINT_PATH) {
  try {
    const raw = fs.readFileSync(checkpointPath, 'utf8');
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export function saveCheckpoint(checkpointPath = DEFAULT_CHECKPOINT_PATH, checkpointMap = new Map()) {
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const obj = Object.fromEntries(checkpointMap);
  fs.writeFileSync(checkpointPath, JSON.stringify(obj, null, 2), 'utf8');
}

// --- Query helpers (shaped for a future GET /api/usage?days=N; the endpoint
// itself is NOT built here) ---

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

// Whole-calendar-day distance between two YYYY-MM-DD strings, computed at
// UTC midnight for both so DST/local-timezone never shifts the boundary.
function daysBetween(dateStr, todayStr) {
  const a = Date.parse(`${dateStr}T00:00:00Z`);
  const b = Date.parse(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity; // malformed date -> never matches a window
  return Math.round((b - a) / 86400000);
}

function inLastNDays(record, days, todayStr) {
  const diff = daysBetween(record.date, todayStr);
  return diff >= 0 && diff < days; // 0 = today; days=7 covers today + 6 prior days, inclusive
}

// groupBy in {'agent','model','modelFamily','project'}. Returns rows sorted
// by costUsd descending. Empty/nonexistent ledger -> empty array, never throws.
export function queryUsage({ ledgerPath = DEFAULT_LEDGER_PATH, days = 7, groupBy = 'agent' } = {}) {
  const today = todayDateString();
  const rows = readAllRecords(ledgerPath).filter((r) => inLastNDays(r, days, today));

  const groups = new Map();
  for (const r of rows) {
    const key = r[groupBy] ?? 'unknown';
    let g = groups.get(key);
    if (!g) {
      g = { key, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, recordCount: 0 };
      groups.set(key, g);
    }
    g.costUsd += r.costUsd || 0;
    g.inputTokens += r.inputTokens || 0;
    g.outputTokens += r.outputTokens || 0;
    g.cacheCreationTokens += r.cacheCreationTokens || 0;
    g.cacheReadTokens += r.cacheReadTokens || 0;
    g.recordCount += 1;
  }
  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd);
}

// Parent-tree roll-up, same concept as brain/test/org.mjs's subtreeCost
// assertions: every node's rolled-up total is its own direct spend plus the
// recursive sum of everything transitively parented under it.
//
// Grouping key: agentId when present. Every record with agentId === null is a
// top-level ("main") session — and EVERY such record shares the literal value
// null, which would collapse every distinct main session into one bucket if
// used as the grouping key directly. To keep each main session distinguishable
// (and still satisfy "records with agentId: null are their own roots" — a
// main session's own parentAgentId is always null, so it can never be anyone
// else's child), main-session records are keyed by `main:<sourceFile>`
// instead; multiple chunks of the same session's transcript still merge into
// one node, and each session remains its own root.
export function rollUpBySpawnTree({ ledgerPath = DEFAULT_LEDGER_PATH, days = 7 } = {}) {
  const today = todayDateString();
  const rows = readAllRecords(ledgerPath).filter((r) => inLastNDays(r, days, today));

  const nodeKey = (r) => (r.agentId != null ? r.agentId : `main:${r.sourceFile}`);

  const nodes = new Map(); // key -> accumulator
  for (const r of rows) {
    const key = nodeKey(r);
    let n = nodes.get(key);
    if (!n) {
      n = {
        key, agentId: r.agentId ?? null, parentKey: null,
        ownCostUsd: 0, ownInputTokens: 0, ownOutputTokens: 0,
        ownCacheCreationTokens: 0, ownCacheReadTokens: 0, ownRecordCount: 0,
      };
      nodes.set(key, n);
    }
    n.ownCostUsd += r.costUsd || 0;
    n.ownInputTokens += r.inputTokens || 0;
    n.ownOutputTokens += r.outputTokens || 0;
    n.ownCacheCreationTokens += r.cacheCreationTokens || 0;
    n.ownCacheReadTokens += r.cacheReadTokens || 0;
    n.ownRecordCount += 1;
    // A main-session record's parentAgentId is always null -> stays a root.
    if (r.agentId != null && r.parentAgentId != null) n.parentKey = r.parentAgentId;
  }

  const childrenOf = new Map(); // parentKey -> [childKey, ...]
  for (const n of nodes.values()) {
    if (n.parentKey != null) {
      if (!childrenOf.has(n.parentKey)) childrenOf.set(n.parentKey, []);
      childrenOf.get(n.parentKey).push(n.key);
    }
  }

  function subtreeTotals(key, seen) {
    const n = nodes.get(key);
    if (!n || seen.has(key)) {
      return { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, recordCount: 0 };
    }
    seen.add(key);
    const totals = {
      costUsd: n.ownCostUsd, inputTokens: n.ownInputTokens, outputTokens: n.ownOutputTokens,
      cacheCreationTokens: n.ownCacheCreationTokens, cacheReadTokens: n.ownCacheReadTokens,
      recordCount: n.ownRecordCount,
    };
    for (const childKey of childrenOf.get(key) || []) {
      const c = subtreeTotals(childKey, seen);
      totals.costUsd += c.costUsd;
      totals.inputTokens += c.inputTokens;
      totals.outputTokens += c.outputTokens;
      totals.cacheCreationTokens += c.cacheCreationTokens;
      totals.cacheReadTokens += c.cacheReadTokens;
      totals.recordCount += c.recordCount;
    }
    return totals;
  }

  return [...nodes.keys()].map((key) => {
    const n = nodes.get(key);
    const sub = subtreeTotals(key, new Set());
    return {
      key,
      agentId: n.agentId,
      parentAgentId: n.parentKey,
      ownCostUsd: n.ownCostUsd,
      subtreeCostUsd: sub.costUsd,
      subtreeInputTokens: sub.inputTokens,
      subtreeOutputTokens: sub.outputTokens,
      subtreeCacheCreationTokens: sub.cacheCreationTokens,
      subtreeCacheReadTokens: sub.cacheReadTokens,
      subtreeRecordCount: sub.recordCount,
    };
  }).sort((a, b) => b.subtreeCostUsd - a.subtreeCostUsd);
}
