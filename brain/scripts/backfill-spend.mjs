#!/usr/bin/env node
// Backfill / incremental scanner that walks ~/.claude/projects and turns
// usage-bearing transcript lines into spend-ledger records via
// helpers/spend-ledger.mjs. This file owns ONLY the walk + byte-offset
// checkpoint + classification logic — it does not define the record shape,
// pricing, or checkpoint file format; all of that lives in spend-ledger.mjs
// (read in full before touching this file: search it for "CONTRACT for the
// caller" for the byte-offset rules this script is built against).
//
// Hard constraint: transcripts are STREAMED line-by-line via
// node:readline over a bounded fs.createReadStream({start, end}) range.
// fs.readFileSync is never called on transcript CONTENT anywhere in this
// file (fs.statSync / fs.readdirSync for file discovery is fine — that's
// listing, not reading transcript bytes). This is what lets the walk scale
// to a 700MB+ tree without holding more than one file's new chunk in memory
// at a time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

import {
  buildSpendRecord,
  appendSpendRecords,
  loadCheckpoint,
  saveCheckpoint,
  resolveProjectName,
  DEFAULT_LEDGER_PATH,
  DEFAULT_CHECKPOINT_PATH,
} from '../../helpers/spend-ledger.mjs';

export const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// --- Discovery: recursively find every *.jsonl file under projectsDir.
// Directory listing (readdirSync) is metadata-only, not a content read, so
// this does not violate the streaming constraint above. Skips a directory
// it can't read (e.g. permissions) rather than aborting the whole walk. ---
function* walkJsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield full;
    }
  }
}

// --- Classification: strictly by PATH SHAPE, never by sidecar presence. A
// file counts as a subagent run if 'subagents' appears ANYWHERE among the
// path segments between projectsDir and the file — not only as the
// immediate parent — because agents can be nested further, e.g.
// subagents/workflows/wf_<id>/agent-<id>.jsonl. A subagents-tree file with
// no sidecar is still a known subagent run (agentId is in the filename
// regardless), just an "unknown-subagent" for attribution purposes. ---
export function classifyFile(file, projectsDir) {
  const relFile = path.relative(projectsDir, file).split(path.sep).join('/');
  const dirKey = relFile.split('/')[0];
  const relSegments = relFile.split('/');
  const isUnderSubagents = relSegments.slice(0, -1).includes('subagents');

  if (!isUnderSubagents) {
    return {
      file, relFile, dirKey,
      agent: 'main', agentId: null, parentAgentId: null, spawnDepth: null,
      classKind: 'main',
    };
  }

  const base = path.basename(file, '.jsonl'); // e.g. "agent-a087ef51522b141fb"
  const agentId = base.startsWith('agent-') ? base.slice('agent-'.length) : base;
  const sidecarPath = path.join(path.dirname(file), `${base}.meta.json`);

  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  } catch {
    meta = null; // missing or unparsable sidecar -> unknown-subagent, not a crash
  }

  if (meta) {
    return {
      file, relFile, dirKey,
      agent: meta.agentType, agentId,
      parentAgentId: meta.parentAgentId ?? null,
      spawnDepth: meta.spawnDepth ?? null,
      classKind: 'known-subagent',
    };
  }
  return {
    file, relFile, dirKey,
    agent: 'unknown-subagent', agentId, parentAgentId: null, spawnDepth: null,
    classKind: 'unknown-subagent',
  };
}

// --- Per-file streaming pass. See helpers/spend-ledger.mjs's checkpoint
// CONTRACT comment for the byte-offset rules this implements. ---
async function processFile(fileMeta, checkpoint, ledgerPath, checkpointPath) {
  const { file, relFile, dirKey, agent, agentId, parentAgentId, spawnDepth } = fileMeta;
  const startOffset = checkpoint.get(relFile)?.byteOffset ?? 0;

  let fileSize;
  try {
    fileSize = fs.statSync(file).size; // captured ONCE, fixes the read boundary
  } catch {
    return { recordsAdded: 0, newBytes: 0, startOffset, commitOffset: startOffset, fileSize: null };
  }

  if (fileSize <= startOffset) {
    // Nothing new (or file shrunk/rotated) -> no-op, never re-read from scratch.
    return { recordsAdded: 0, newBytes: 0, startOffset, commitOffset: startOffset, fileSize };
  }

  const stream = fs.createReadStream(file, { start: startOffset, end: fileSize - 1 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const lines = []; // { j: parsed-or-null, lineBytes } in order
  let cumulativeBytes = 0;
  let chunkCwd = null;

  for await (const line of rl) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1; // +1 for the '\n' this line occupies on disk
    cumulativeBytes += lineBytes;
    let j = null;
    try { j = JSON.parse(line); } catch { j = null; } // corrupt line still counts toward offset below
    if (chunkCwd === null && j && j.cwd) chunkCwd = j.cwd;
    lines.push({ j, lineBytes });
  }

  const rangeSize = fileSize - startOffset;
  let usableLines;
  let commitOffset;
  if (cumulativeBytes === rangeSize) {
    // Every emitted line was cleanly newline-terminated within the range.
    usableLines = lines;
    commitOffset = fileSize;
  } else {
    // cumulativeBytes > rangeSize: the bounded read ended mid-line, so the
    // phantom "+1 for \n" we added while summing the last line's bytes
    // didn't actually exist on disk within this range. Drop that last line
    // entirely — it may be truncated JSON — and never commit past the last
    // CONFIRMED complete line.
    const last = lines[lines.length - 1];
    usableLines = lines.slice(0, -1);
    commitOffset = last ? startOffset + (cumulativeBytes - last.lineBytes) : startOffset;
  }

  // Dedupe grain: per-file/per-chunk, mirroring tallyUsage()'s dedupe key in
  // server.mjs but scoped to this pass only — a duplicate message id across
  // two unrelated files/chunks is not a real collision and must not suppress
  // a legitimate record.
  const seenIds = new Set();
  const usageLines = [];
  for (const { j } of usableLines) {
    if (!j || j.type !== 'assistant' || !j.message?.usage) continue;
    const id = j.message?.id ?? j.uuid;
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    usageLines.push(j);
  }

  // Group by raw model string; first usage line in each group supplies `date`.
  const modelGroups = new Map();
  for (const j of usageLines) {
    const model = j.message.model;
    let g = modelGroups.get(model);
    if (!g) {
      g = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, firstTs: j.timestamp };
      modelGroups.set(model, g);
    }
    const u = j.message.usage;
    g.inputTokens += u.input_tokens || 0;
    g.outputTokens += u.output_tokens || 0;
    g.cacheCreationTokens += u.cache_creation_input_tokens || 0;
    g.cacheReadTokens += u.cache_read_input_tokens || 0;
  }

  const project = resolveProjectName({ cwd: chunkCwd, dirKey });
  const records = [];
  for (const [model, g] of modelGroups) {
    const date = new Date(g.firstTs).toISOString().slice(0, 10);
    const dedupeKey = `${relFile}:${startOffset}-${commitOffset}:${model}`;
    records.push(buildSpendRecord({
      date, agent, agentId, parentAgentId, spawnDepth,
      model, project,
      inputTokens: g.inputTokens,
      outputTokens: g.outputTokens,
      cacheCreationTokens: g.cacheCreationTokens,
      cacheReadTokens: g.cacheReadTokens,
      dedupeKey, sourceFile: relFile,
    }));
  }

  // Append first, then advance the checkpoint. This ordering leaves a
  // narrow, ACCEPTED at-least-once window: if the process is killed between
  // a successful append and its checkpoint save below, this file's chunk
  // will be reprocessed on the next run (checkpoint didn't advance) and
  // its records appended AGAIN as literal duplicate lines with an IDENTICAL
  // dedupeKey. Acceptable for a personal decision-support ledger; a
  // dedupeKey-aware reader would be the fix if this ever needs to be exact,
  // but that's a change to spend-ledger.mjs's read side, out of scope here.
  if (records.length > 0) {
    appendSpendRecords(records, ledgerPath);
  }
  if (commitOffset > startOffset) {
    checkpoint.set(relFile, { byteOffset: commitOffset });
    saveCheckpoint(checkpointPath, checkpoint);
  }

  return {
    recordsAdded: records.length,
    newBytes: commitOffset - startOffset,
    startOffset,
    commitOffset,
    fileSize,
  };
}

// --- Orchestration: walk, classify, process one file at a time, save
// checkpoint per-file (not batched at the end — see comment in processFile
// on the accepted crash window this bounds). Overridable paths so the
// caller (CLI entry point below, or a fixture smoke test) never has to
// touch the real estate. ---
export async function runBackfill({
  projectsDir = DEFAULT_PROJECTS_DIR,
  ledgerPath = DEFAULT_LEDGER_PATH,
  checkpointPath = DEFAULT_CHECKPOINT_PATH,
  sampleMemoryMs = 250,
} = {}) {
  const checkpoint = loadCheckpoint(checkpointPath);

  const stats = {
    filesScanned: 0,
    mainFiles: 0,
    knownSubagentFiles: 0,
    unknownSubagentFiles: 0,
    filesUnchanged: 0,
    filesGrown: 0,
    recordsWritten: 0,
    grownFileDetail: [], // { relFile, startOffset, commitOffset, newBytes, recordsAdded }
  };

  let peakRss = process.memoryUsage().rss;
  const memTimer = sampleMemoryMs > 0
    ? setInterval(() => {
        const rss = process.memoryUsage().rss;
        if (rss > peakRss) peakRss = rss;
      }, sampleMemoryMs)
    : null;

  const startedAt = Date.now();
  try {
    for (const file of walkJsonlFiles(projectsDir)) {
      const meta = classifyFile(file, projectsDir);
      stats.filesScanned++;
      if (meta.classKind === 'main') stats.mainFiles++;
      else if (meta.classKind === 'known-subagent') stats.knownSubagentFiles++;
      else stats.unknownSubagentFiles++;

      const result = await processFile(meta, checkpoint, ledgerPath, checkpointPath);
      stats.recordsWritten += result.recordsAdded;
      if (result.newBytes > 0) {
        stats.filesGrown++;
        stats.grownFileDetail.push({
          relFile: meta.relFile,
          startOffset: result.startOffset,
          commitOffset: result.commitOffset,
          newBytes: result.newBytes,
          recordsAdded: result.recordsAdded,
        });
      } else {
        stats.filesUnchanged++;
      }
    }
  } finally {
    if (memTimer) clearInterval(memTimer);
  }

  const rssNow = process.memoryUsage().rss;
  if (rssNow > peakRss) peakRss = rssNow;

  return {
    ...stats,
    durationMs: Date.now() - startedAt,
    peakRssBytes: peakRss,
    peakRssMB: Math.round((peakRss / 1024 / 1024) * 10) / 10,
  };
}

// --- CLI entry point ---
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--projects-dir') out.projectsDir = argv[++i];
    else if (a === '--ledger-path') out.ledgerPath = argv[++i];
    else if (a === '--checkpoint-path') out.checkpointPath = argv[++i];
  }
  return out;
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  const cli = parseArgs(process.argv.slice(2));
  const opts = {
    projectsDir: cli.projectsDir || process.env.ALFRED_BACKFILL_PROJECTS_DIR || DEFAULT_PROJECTS_DIR,
    ledgerPath: cli.ledgerPath || process.env.ALFRED_BACKFILL_LEDGER_PATH || DEFAULT_LEDGER_PATH,
    checkpointPath: cli.checkpointPath || process.env.ALFRED_BACKFILL_CHECKPOINT_PATH || DEFAULT_CHECKPOINT_PATH,
  };
  console.log(`[backfill-spend] projectsDir=${opts.projectsDir}`);
  console.log(`[backfill-spend] ledgerPath=${opts.ledgerPath}`);
  console.log(`[backfill-spend] checkpointPath=${opts.checkpointPath}`);
  runBackfill(opts)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('[backfill-spend] fatal error:', err);
      process.exitCode = 1;
    });
}
