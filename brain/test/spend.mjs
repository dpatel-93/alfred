// Isolated unit suite for helpers/spend-ledger.mjs — no Playwright, no HUD
// server on port 7777. Everything runs against throwaway temp files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  costUsd, modelFamily, buildSpendRecord, appendSpendRecords, readAllRecords,
  loadCheckpoint, saveCheckpoint, queryUsage, rollUpBySpawnTree,
} from '../../helpers/spend-ledger.mjs';

const R = [];
function chk(name, cond, detail = '') { R.push({ n: name, ok: !!cond, d: String(detail) }); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-spend-test-'));
const LEDGER = path.join(TMP, 'spend.jsonl');
const CHECKPOINT = path.join(TMP, 'spend-backfill-state.json');

// --- costUsd() prices all four token types ---
{
  // sonnet: in=3, out=15 per million.
  const onlyBase = costUsd({ family: 'sonnet', inTok: 1_000_000, outTok: 1_000_000, cacheCreationTok: 0, cacheReadTok: 0 });
  chk('costUsd prices plain input+output', Math.abs(onlyBase - (3 + 15)) < 1e-9, onlyBase);

  // cache-only case: zero in/out, only cache tokens.
  const cacheOnly = costUsd({ family: 'sonnet', inTok: 0, outTok: 0, cacheCreationTok: 1_000_000, cacheReadTok: 1_000_000 });
  const expectedCacheOnly = 3 * 1.25 + 3 * 0.10; // cache priced off sonnet's base input rate
  chk('costUsd prices cache tokens with zero in/out', Math.abs(cacheOnly - expectedCacheOnly) < 1e-9, `${cacheOnly} vs ${expectedCacheOnly}`);

  const all4 = costUsd({ family: 'opus', inTok: 500_000, outTok: 200_000, cacheCreationTok: 100_000, cacheReadTok: 300_000 });
  const p = { in: 5, out: 25 };
  const expectedAll4 = (500_000 / 1e6) * p.in + (200_000 / 1e6) * p.out + (100_000 / 1e6) * p.in * 1.25 + (300_000 / 1e6) * p.in * 0.10;
  chk('costUsd prices all four token types together', Math.abs(all4 - expectedAll4) < 1e-9, `${all4} vs ${expectedAll4}`);

  chk('costUsd returns 0 for an unpriced family', costUsd({ family: 'other', inTok: 1_000_000, outTok: 1_000_000 }) === 0);
}

// --- modelFamily() classification sanity (same rule as brain/server.mjs) ---
chk('modelFamily classifies sonnet', modelFamily('claude-sonnet-4-5-20260514') === 'sonnet');
chk('modelFamily classifies haiku', modelFamily('claude-haiku-4-5') === 'haiku');
chk('modelFamily falls back to other', modelFamily('some-unknown-model') === 'other');

// --- appendSpendRecords: append-only, never truncates ---
{
  fs.writeFileSync(LEDGER, JSON.stringify({ marker: 'pre-existing-line' }) + '\n', 'utf8');
  const rec1 = buildSpendRecord({
    date: '2026-08-08', agent: 'main', model: 'claude-sonnet-4-5', project: 'Alfred',
    inputTokens: 1000, outputTokens: 500, dedupeKey: 'a:0-100:claude-sonnet-4-5', sourceFile: 'dirA/session1.jsonl',
  });
  appendSpendRecords([rec1], LEDGER);
  const afterFirst = fs.readFileSync(LEDGER, 'utf8').trim().split('\n');
  chk('append after pre-existing content keeps prior line', afterFirst[0].includes('pre-existing-line'), afterFirst[0]);
  chk('append after pre-existing content adds new line', afterFirst.length === 2, afterFirst.length);

  const rec2 = buildSpendRecord({
    date: '2026-08-08', agent: 'main', model: 'claude-sonnet-4-5', project: 'Alfred',
    inputTokens: 2000, outputTokens: 700, dedupeKey: 'a:100-200:claude-sonnet-4-5', sourceFile: 'dirA/session1.jsonl',
  });
  appendSpendRecords([rec2], LEDGER);
  const afterSecond = fs.readFileSync(LEDGER, 'utf8').trim().split('\n');
  chk('a second append preserves both prior lines and adds one more', afterSecond.length === 3, afterSecond.length);

  const sizeBefore = fs.statSync(LEDGER).size;
  appendSpendRecords([], LEDGER);
  const sizeAfter = fs.statSync(LEDGER).size;
  chk('appendSpendRecords is a no-op for an empty array', sizeBefore === sizeAfter, `${sizeBefore} vs ${sizeAfter}`);
}

// --- buildSpendRecord shape sanity ---
{
  const rec = buildSpendRecord({
    date: '2026-08-08', agent: 'security-manager', agentId: 'agent-abc', parentAgentId: 'agent-root',
    spawnDepth: 2, model: 'claude-opus-4-1', project: 'Alfred',
    inputTokens: 10, outputTokens: 20, cacheCreationTokens: 5, cacheReadTokens: 7,
    dedupeKey: 'x:0-1:claude-opus-4-1', sourceFile: 'dirB/s/subagents/agent-abc.jsonl',
  });
  const expectedFields = ['date', 'agent', 'agentId', 'parentAgentId', 'spawnDepth', 'model', 'modelFamily',
    'project', 'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'costUsd', 'dedupeKey', 'sourceFile'];
  chk('buildSpendRecord produces exactly the speced fields', expectedFields.every((f) => f in rec) && Object.keys(rec).length === expectedFields.length,
    Object.keys(rec).join(','));
  chk('buildSpendRecord derives modelFamily from model', rec.modelFamily === 'opus', rec.modelFamily);
  chk('buildSpendRecord computes a non-zero costUsd', rec.costUsd > 0, rec.costUsd);
}

// --- queryUsage: groups by at least two dimensions on a small synthetic ledger ---
{
  const qLedger = path.join(TMP, 'query-spend.jsonl');
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tooOld = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const rows = [
    buildSpendRecord({ date: today, agent: 'agentA', model: 'claude-sonnet-4-5', project: 'Alfred',
      inputTokens: 1_000_000, outputTokens: 0, dedupeKey: 'f1:0-1:claude-sonnet-4-5', sourceFile: 'f1.jsonl' }), // $3
    buildSpendRecord({ date: yesterday, agent: 'agentA', model: 'claude-sonnet-4-5', project: 'Alfred',
      inputTokens: 1_000_000, outputTokens: 0, dedupeKey: 'f2:0-1:claude-sonnet-4-5', sourceFile: 'f2.jsonl' }), // $3
    buildSpendRecord({ date: today, agent: 'agentB', model: 'claude-opus-4-1', project: 'Meridian',
      inputTokens: 1_000_000, outputTokens: 0, dedupeKey: 'f3:0-1:claude-opus-4-1', sourceFile: 'f3.jsonl' }), // $5
    // Outside the 7-day window on purpose — must be excluded.
    buildSpendRecord({ date: tooOld, agent: 'agentA', model: 'claude-sonnet-4-5', project: 'Alfred',
      inputTokens: 1_000_000, outputTokens: 0, dedupeKey: 'f4:0-1:claude-sonnet-4-5', sourceFile: 'f4.jsonl' }),
  ];
  appendSpendRecords(rows, qLedger);

  const byAgent = queryUsage({ ledgerPath: qLedger, days: 7, groupBy: 'agent' });
  chk('queryUsage excludes rows outside the day window', byAgent.reduce((s, g) => s + g.recordCount, 0) === 3,
    JSON.stringify(byAgent));
  chk('queryUsage groupBy agent sums per agent', (byAgent.find((g) => g.key === 'agentA') || {}).costUsd === 6,
    JSON.stringify(byAgent));
  chk('queryUsage sorts by costUsd descending', byAgent[0].key === 'agentA' && byAgent[0].costUsd === 6,
    JSON.stringify(byAgent));

  const byProject = queryUsage({ ledgerPath: qLedger, days: 7, groupBy: 'project' });
  chk('queryUsage groupBy project sums per project', (byProject.find((g) => g.key === 'Meridian') || {}).costUsd === 5,
    JSON.stringify(byProject));
  chk('queryUsage groupBy project produces two groups within window', byProject.length === 2, JSON.stringify(byProject));
}

// --- queryUsage negative test: empty/nonexistent ledger ---
{
  const missing = path.join(TMP, 'does-not-exist.jsonl');
  const res = queryUsage({ ledgerPath: missing, days: 7, groupBy: 'agent' });
  chk('queryUsage on nonexistent ledger returns empty array, not a throw', Array.isArray(res) && res.length === 0, JSON.stringify(res));
}

// --- rollUpBySpawnTree: 3-level chain root -> child -> grandchild ---
{
  const treeLedger = path.join(TMP, 'tree-spend.jsonl');
  const today = new Date().toISOString().slice(0, 10);
  const rows = [
    buildSpendRecord({ date: today, agent: 'root-agent', agentId: 'root-1', parentAgentId: null, spawnDepth: 0,
      model: 'claude-sonnet-4-5', project: 'Alfred', inputTokens: 1_000_000, outputTokens: 0,
      dedupeKey: 'r:0-1:claude-sonnet-4-5', sourceFile: 's/subagents/agent-root-1.jsonl' }), // $3
    buildSpendRecord({ date: today, agent: 'child-agent', agentId: 'child-1', parentAgentId: 'root-1', spawnDepth: 1,
      model: 'claude-sonnet-4-5', project: 'Alfred', inputTokens: 1_000_000, outputTokens: 0,
      dedupeKey: 'c:0-1:claude-sonnet-4-5', sourceFile: 's/subagents/agent-child-1.jsonl' }), // $3
    buildSpendRecord({ date: today, agent: 'grandchild-agent', agentId: 'grandchild-1', parentAgentId: 'child-1', spawnDepth: 2,
      model: 'claude-sonnet-4-5', project: 'Alfred', inputTokens: 1_000_000, outputTokens: 0,
      dedupeKey: 'g:0-1:claude-sonnet-4-5', sourceFile: 's/subagents/agent-grandchild-1.jsonl' }), // $3
  ];
  appendSpendRecords(rows, treeLedger);
  const tree = rollUpBySpawnTree({ ledgerPath: treeLedger, days: 7 });
  const byAgentId = Object.fromEntries(tree.map((n) => [n.agentId, n]));

  chk('root subtree cost includes all three levels', Math.abs(byAgentId['root-1'].subtreeCostUsd - 9) < 1e-9,
    JSON.stringify(byAgentId['root-1']));
  chk('child subtree cost includes itself + grandchild', Math.abs(byAgentId['child-1'].subtreeCostUsd - 6) < 1e-9,
    JSON.stringify(byAgentId['child-1']));
  chk('grandchild (leaf) subtree cost is just its own spend', Math.abs(byAgentId['grandchild-1'].subtreeCostUsd - 3) < 1e-9,
    JSON.stringify(byAgentId['grandchild-1']));
  chk('leaf ownCostUsd equals its subtreeCostUsd', byAgentId['grandchild-1'].ownCostUsd === byAgentId['grandchild-1'].subtreeCostUsd);

  // A main-session record (agentId: null) must surface as its own root, not
  // get folded into some other null-keyed bucket.
  const mainLedger = path.join(TMP, 'main-spend.jsonl');
  appendSpendRecords([
    buildSpendRecord({ date: today, agent: 'main', agentId: null, parentAgentId: null, spawnDepth: null,
      model: 'claude-sonnet-4-5', project: 'Alfred', inputTokens: 1_000_000, outputTokens: 0,
      dedupeKey: 'm1:0-1:claude-sonnet-4-5', sourceFile: 'dirA/session1.jsonl' }), // $3
    buildSpendRecord({ date: today, agent: 'main', agentId: null, parentAgentId: null, spawnDepth: null,
      model: 'claude-sonnet-4-5', project: 'Meridian', inputTokens: 1_000_000, outputTokens: 0,
      dedupeKey: 'm2:0-1:claude-sonnet-4-5', sourceFile: 'dirB/session2.jsonl' }), // $3
  ], mainLedger);
  const mainTree = rollUpBySpawnTree({ ledgerPath: mainLedger, days: 7 });
  chk('two distinct main sessions surface as two distinct roots', mainTree.length === 2 && mainTree.every((n) => n.agentId === null),
    JSON.stringify(mainTree));
  chk('each main-session root only carries its own spend', mainTree.every((n) => Math.abs(n.subtreeCostUsd - 3) < 1e-9),
    JSON.stringify(mainTree));
}

// --- loadCheckpoint / saveCheckpoint round-trip ---
{
  const cp = new Map([
    ['dirA/session1.jsonl', { byteOffset: 4096 }],
    ['dirB/s/subagents/agent-x.jsonl', { byteOffset: 128 }],
  ]);
  saveCheckpoint(CHECKPOINT, cp);
  const loaded = loadCheckpoint(CHECKPOINT);
  chk('checkpoint round-trips entry count', loaded.size === 2, loaded.size);
  chk('checkpoint round-trips byteOffset values', loaded.get('dirA/session1.jsonl')?.byteOffset === 4096,
    JSON.stringify([...loaded.entries()]));

  const missingCp = path.join(TMP, 'no-such-checkpoint.json');
  const empty = loadCheckpoint(missingCp);
  chk('loadCheckpoint on nonexistent path returns empty Map, not a throw', empty instanceof Map && empty.size === 0);
}

// --- readAllRecords sanity (used internally by queryUsage/rollUpBySpawnTree) ---
chk('readAllRecords on nonexistent ledger returns empty array', readAllRecords(path.join(TMP, 'nope.jsonl')).length === 0);

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
