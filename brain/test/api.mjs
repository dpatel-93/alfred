import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const B = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = [];
function chk(name, cond, detail = '') { R.push({ n: name, ok: !!cond, d: String(detail) }); }

// token is template-injected into the served HTML
const html = await (await fetch(B+'/')).text();
const m = html.match(/var ALFRED_TOKEN = '([^']+)'/);
const TOKEN = m ? m[1] : null;
chk('UI serves with injected session token', !!TOKEN && TOKEN !== '__ALFRED_SESSION_TOKEN__', TOKEN?`len=${TOKEN.length}`:'NOT INJECTED');

async function j(p, o) { const r = await fetch(B+p, o); let d=null; try{d=await r.json();}catch{} return {s:r.status, d}; }

for (const [p, want] of [['/api/status',200],['/api/graph',200],['/api/org',200],['/api/usage',200],
                          ['/api/search?q=alfred',200],['/api/projects',200],['/api/nope',404]]) {
  const r = await j(p); chk(`GET ${p} -> ${want}`, r.s===want, `got ${r.s}`);
}

// --- auth surface ---
// Probed against a route that still EXISTS. Pointing these at /api/claude/state
// after WS2 deleted it made them pass on a 404 for the wrong reason — the auth
// check would have been unreachable and the tests would never have noticed.
const noTok = await j('/api/settings'); chk('GET a gated route without token blocked', noTok.s===401||noTok.s===403, `got ${noTok.s}`);
const opt = await fetch(B+'/api/status',{method:'OPTIONS'}); chk('OPTIONS preflight refused', opt.status===403, `got ${opt.status}`);
const badTok = await fetch(B+'/api/reindex',{method:'POST',headers:{'X-Alfred-Token':'wrong','Content-Type':'application/json'},body:'{}'});
chk('POST bridge with wrong token blocked', badTok.status===401||badTok.status===403, `got ${badTok.status}`);
const getAsk = await fetch(B+'/api/ask'); chk('GET /api/ask -> 405', getAsk.status===405, `got ${getAsk.status}`);

const H = {'X-Alfred-Token':TOKEN,'Content-Type':'application/json'};
const st = await j('/api/settings',{headers:{'X-Alfred-Token':TOKEN}});
chk('GET a gated route with token', st.s===200, `got ${st.s} ${JSON.stringify(st.d).slice(0,120)}`);
const ag = await j('/api/agents',{headers:{'X-Alfred-Token':TOKEN}}); chk('GET /api/agents with token', ag.s===200, `got ${ag.s}`);
// The terminal is removed (WS3). Assert its routes are actually GONE rather
// than dropping the check — a 404 here is the proof, and a 200 would mean an
// old server process is still holding the port.
const to = await j('/api/terminal/output?after=0',{headers:{'X-Alfred-Token':TOKEN}}); chk('GET /api/terminal/output removed -> 404', to.s===404, `got ${to.s}`);
const ti = await fetch(B+'/api/terminal/input',{method:'POST',headers:H,body:JSON.stringify({line:'echo hi'})});
chk('POST /api/terminal/input removed -> 404', ti.status===404, `got ${ti.status}`);
// Reindex progress rehomed off the shell ring onto its own token-gated route.
const rx = await j('/api/reindex/status?after=0',{headers:{'X-Alfred-Token':TOKEN}});
chk('GET /api/reindex/status with token', rx.s===200 && 'phase' in (rx.d||{}) && Array.isArray(rx.d?.lines), `got ${rx.s} ${JSON.stringify(rx.d).slice(0,120)}`);
const rxNoTok = await fetch(B+'/api/reindex/status?after=0');
chk('GET /api/reindex/status without token blocked', rxNoTok.status===401||rxNoTok.status===403, `got ${rxNoTok.status}`);

// --- payload shapes ---
const status = (await j('/api/status')).d;
chk('/api/status reports askEngine', 'askEngine' in (status||{}), JSON.stringify(status).slice(0,200));
// WS2 removed voice; ttsEngine going quietly missing would be invisible, so its
// ABSENCE is asserted rather than assumed.
chk('/api/status no longer reports ttsEngine', !('ttsEngine' in (status||{})), JSON.stringify(status).slice(0,200));
// WS10 — the Brain view's region glow reads this. Missing or malformed, the
// cortex silently falls back to its resting breath and looks fine while
// reporting nothing, which is exactly the failure a test has to catch.
const ba = status?.brainActivity;
chk('/api/status carries brainActivity with a folders map and a window',
  !!ba && typeof ba.folders === 'object' && ba.folders !== null && ba.windowMs > 0,
  JSON.stringify(ba).slice(0, 200));
// Shape assertions over an EMPTY folders map are vacuously true — .every() on
// nothing passes — so the signal has to be created first. Touch a fixture note
// and wait for the 15s server-side cache to roll over, then assert against a
// map that is actually populated. Without this the whole block would go green
// on a server that never computed anything.
const touched = new URL('./fixtures/vault/Projects/Meridian.md', import.meta.url);
try { fs.utimesSync(touched, new Date(), new Date()); } catch { /* asserted below via an empty map */ }
let baLive = null;
for (let i = 0; i < 11 && !baLive; i++) {
  const probe = (await j('/api/status')).d?.brainActivity;
  if (probe && Object.keys(probe.folders || {}).length > 0) baLive = probe;
  else await new Promise((r) => setTimeout(r, 2000));
}
chk('brainActivity picks up a freshly touched note within the cache window',
  !!baLive && !!baLive.folders.Projects, JSON.stringify(baLive?.folders).slice(0, 200));

const baShapeOk = baLive && Object.values(baLive.folders).every((f) =>
  typeof f.score === 'number' && f.score > 0 && f.score <= 1
  && typeof f.count === 'number' && f.count >= 1 && typeof f.lastMs === 'number' && f.lastMs >= 0);
chk('brainActivity entries score in (0,1] with a count and an age', !!baShapeOk, JSON.stringify(baLive?.folders).slice(0, 200));
// Stale notes must be ABSENT, not present with score 0 — a folder in the map is
// the signal that something happened there, and zero-scored entries would make
// every folder look permanently live to a caller checking for a key.
chk('brainActivity omits folders with nothing inside the window',
  !!baLive && Object.values(baLive.folders).every((f) => f.lastMs <= baLive.windowMs),
  JSON.stringify(baLive?.folders).slice(0, 200));
// The score must actually be a function of the age, not merely a number in
// range — a scorer that ignored mtime entirely would satisfy every bound above.
// Checked as an identity against the age the same response reports, which makes
// it independent of when the 15s cache happened to be computed. An earlier
// version asserted "> 0.99 because we just touched it" and went red at 0.964:
// the wait loop exited on the map being non-empty, which the PREVIOUS run's
// touch had already made true, so it never waited for the new one at all.
const decayOk = baLive && Object.values(baLive.folders).every((f) =>
  Math.abs(f.score - (1 - f.lastMs / baLive.windowMs)) < 0.01);
chk('brainActivity score is the linear decay of the age it reports', !!decayOk, JSON.stringify(baLive?.folders).slice(0, 200));

const graph = (await j('/api/graph')).d;
chk('/api/graph returns nodes array', Array.isArray(graph?.nodes), `nodes=${graph?.nodes?.length}`);
const org = (await j('/api/org')).d;
chk('/api/org returns agents', Array.isArray(org?.agents)||Array.isArray(org?.nodes), Object.keys(org||{}).join(','));

// --- org tier labels ---
// The top node is the HUMAN running the install, so its lane is "Owner" by default rather
// than "CEO" — one word meaning both the person and the top agent tier is what made the
// chart unable to show a person delegating to the org. Labels are overridable per machine
// from ~/.alfred/config.json's orgLabels, so the VALUES are machine-dependent; the shape,
// the key set, and the placeholder guard are not.
const tiers = org?.tiers || {};
const TIER_KEYS = ['ceo', 'csuite', 'vp', 'manager', 'employee', 'intern'];
chk('/api/org carries exactly the six known tiers',
  Object.keys(tiers).sort().join(',') === [...TIER_KEYS].sort().join(','), Object.keys(tiers).join(','));
chk('every tier has a non-empty label',
  TIER_KEYS.every((k) => typeof tiers[k]?.label === 'string' && tiers[k].label.trim().length > 0),
  TIER_KEYS.map((k) => `${k}=${JSON.stringify(tiers[k]?.label)}`).join(' '));
chk('the operator tier carries a name for the top node',
  typeof tiers.ceo?.name === 'string' && tiers.ceo.name.trim().length > 0, JSON.stringify(tiers.ceo));
// Regression: the profile template's placeholder is a parenthetical that WRAPS across two
// lines, and getCeoName's regex is single-line — so the unclosed fragment came back as the
// operator's name and got drawn on the org chart.
chk('the operator name is a name, not the template placeholder',
  !/^\(/.test(tiers.ceo?.name || '') && !/not specified/i.test(tiers.ceo?.name || ''),
  JSON.stringify(tiers.ceo?.name));

// --- org self-test ---
// Deliberately NOT executed here: running it spawns real `claude` processes and spends real
// tokens, which a test suite has no business doing. What IS asserted is the contract around
// it — the state it publishes, and that it cannot be triggered without the session token.
const selfT = org?.selfTest;
chk('/api/org publishes self-test state', selfT && typeof selfT === 'object', JSON.stringify(selfT));
chk('self-test is idle in a fresh server', selfT?.running === false, JSON.stringify(selfT?.running));
chk('self-test reports the active window it is imposing',
  typeof selfT?.activeWindowMs === 'number' && selfT.activeWindowMs > 0, JSON.stringify(selfT?.activeWindowMs));
chk('an idle self-test does not widen the org activity window',
  selfT?.activeWindowMs === 20000, `got ${selfT?.activeWindowMs}`);
const stNoTok = await fetch(B + '/api/org/selftest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
chk('POST /api/org/selftest without a token is blocked',
  stNoTok.status === 401 || stNoTok.status === 403, `got ${stNoTok.status}`);

// --- the voice surface stays removed ---
// Every route WS2 deleted, asserted gone. A revert or a bad merge that brings
// one back should fail here rather than ship a re-armed voice surface.
for (const p of ['/api/tts','/api/claude/send','/api/claude/stop','/api/claude/abort','/api/approvals','/api/approvals/arm']) {
  const r = await fetch(B+p,{method:'POST',headers:H,body:'{}'});
  chk(`POST ${p} -> 404 (removed by WS2)`, r.status===404, `got ${r.status}`);
}
for (const p of ['/api/claude/state','/api/approvals','/api/tts/cached?id=ack-research']) {
  const r = await j(p,{headers:{'X-Alfred-Token':TOKEN}});
  chk(`GET ${p} -> 404 (removed by WS2)`, r.s===404, `got ${r.s}`);
}

// --- directory endpoints (agent-directory was previously untested; keep the new one from repeating that gap) ---
const agentDir = await j('/api/agent-directory');
chk('GET /api/agent-directory -> 200 with agents array', agentDir.s===200 && Array.isArray(agentDir.d?.agents), `got ${agentDir.s} ${JSON.stringify(agentDir.d).slice(0,120)}`);

// --- Library API (replaces /api/skills-directory) ---
const libResp = await j('/api/library');
chk('GET /api/library -> 200 without token (ungated posture)', libResp.s===200, `got ${libResp.s}`);
const items = libResp.d?.items;
chk('/api/library returns non-empty items array', Array.isArray(items) && items.length>0, `len=${items?.length}`);

const itemShapeOk = Array.isArray(items) && items.every((it) =>
  typeof it.id==='string' && typeof it.type==='string' && typeof it.name==='string'
  && typeof it.description==='string' && typeof it.origin==='string' && typeof it.source==='string'
  && Array.isArray(it.usedBy));
chk('/api/library items have id/type/name/description/origin/source as strings and usedBy as array', itemShapeOk, JSON.stringify(items?.[0]).slice(0,200));

// Real, non-trivial thresholds observed via a manual scratch-port run against
// the real ~/.claude before writing these — see the task report for the
// actual counts. Lower bounds leave headroom for a plugin install/removal
// between runs without breaking the suite.
const countOf = (type, origin) => Array.isArray(items) ? items.filter((it) => it.type===type && it.origin===origin).length : -1;
const typeThresholds = [
  ['skill', 'user', 40], ['skill', 'plugin', 30],
  ['command', 'user', 8], ['command', 'plugin', 15],
  ['hook', 'user', 3], ['hook', 'plugin', 6],
  ['instruction', 'user', 2],
  // MCP servers come from ~/.claude.json, ~/.mcp.json and enabled plugins.
  // No plugin threshold: which plugins are switched on is the operator's call
  // and a suite that fails when they turn one off is testing their preferences.
  ['mcp', 'user', 3],
];
for (const [type, origin, min] of typeThresholds) {
  const n = countOf(type, origin);
  chk(`/api/library has >= ${min} ${type}/${origin} items`, n >= min, `got ${n}`);
}

const originsPresent = new Set((items||[]).map((it) => it.origin));
chk("/api/library includes both origin:'user' and origin:'plugin' items", originsPresent.has('user') && originsPresent.has('plugin'), [...originsPresent].join(','));

// Hook descriptions are built from the raw `command` string in settings.json, and
// on Windows that string carries forward slashes ("cmd /c node C:/Users/me/...")
// while os.homedir() is backslashed. tildify() used to split on homedir()
// literally, so it matched nothing and the pane published the account name — the
// exact thing its own comment says it exists to prevent. Caught by screenshotting
// the HUD and READING it, not by any grep.
const ACCOUNT = path.basename(os.homedir());
const hookItems = (items || []).filter((it) => it.type === 'hook');
const homeLeaks = (items || []).filter((it) => {
  const s = `${it.name} ${it.description}`;
  return s.includes(os.homedir()) || s.includes(ACCOUNT);
});
chk('library rows tildify local paths, so a screenshot cannot publish the account name',
  homeLeaks.length === 0,
  homeLeaks.length ? `${homeLeaks.length} leaked, e.g. ${homeLeaks[0].description}`.slice(0, 200) : '');
chk('and there were hook rows to actually exercise that',
  hookItems.length > 0, `got ${hookItems.length}`);

// GET /api/library/item — happy path on a real id pulled from the list.
const firstItem = Array.isArray(items) ? items[0] : null;
const itemDetail = firstItem ? await j('/api/library/item?id='+encodeURIComponent(firstItem.id)) : {s:0,d:null};
chk('GET /api/library/item -> 200 with non-empty markdown', itemDetail.s===200 && typeof itemDetail.d?.markdown==='string' && itemDetail.d.markdown.length>0,
  `got ${itemDetail.s} id=${firstItem?.id}`);

const noIdResp = await j('/api/library/item?id=');
chk('GET /api/library/item?id= -> 400', noIdResp.s===400, `got ${noIdResp.s}`);

const unknownResp = await j('/api/library/item?id=nope-this-does-not-exist');
chk('GET /api/library/item?id=<unknown> -> 404', unknownResp.s===404, `got ${unknownResp.s}`);

const travResp = await j('/api/library/item?id='+encodeURIComponent('skill:user:../../../etc/passwd'));
chk('GET /api/library/item traversal-shaped id -> 404 with no file content leaked', travResp.s===404 && !JSON.stringify(travResp.d).includes('root:'),
  `got ${travResp.s} ${JSON.stringify(travResp.d).slice(0,120)}`);

// Regression guard: firecrawl-scrape's `description:` is a YAML block scalar
// (`description: |` + indented prose). Losing this to the block-scalar
// indicator token ("|") falling back to "(no description)" is exactly the
// bug this checks for. Retargeted at the PLUGIN skill specifically.
const fcScrape = Array.isArray(items) ? items.find((it) => it.type==='skill' && it.origin==='plugin' && it.id.includes('firecrawl-scrape')) : null;
chk('firecrawl-scrape plugin skill (block-scalar description) resolves to real prose, not "(no description)"',
  !!fcScrape && typeof fcScrape.description === 'string' && fcScrape.description.length > 0 && fcScrape.description !== '(no description)',
  JSON.stringify(fcScrape?.description).slice(0,200));

// Scoped to USER skills only — plugin skills may legitimately lack a
// description (an honest gap), so only user-authored skills are held to the
// "every skill has a real description" bar.
const missingCount = Array.isArray(items) ? items.filter((it) => it.type==='skill' && it.origin==='user' && it.description === '(no description)').length : -1;
chk('/api/library has 0 user skills falling back to "(no description)"', missingCount === 0,
  `count=${missingCount} — every user skill under ~/.claude/skills carries a real description as of this run`);

// Hook markdown preview: find a real hook item and confirm its detail
// markdown contains both a piece of its own command and a snippet that can
// only come from the actual script source on disk.
const amHook = Array.isArray(items) ? items.find((it) => it.type==='hook' && it.name.includes('auto-memory-hook')) : null;
const amHookDetail = amHook ? await j('/api/library/item?id='+encodeURIComponent(amHook.id)) : {s:0,d:null};
chk('hook item markdown contains its own command and real script source',
  amHookDetail.s===200 && typeof amHookDetail.d?.markdown==='string'
  && amHookDetail.d.markdown.includes('auto-memory-hook.mjs') && amHookDetail.d.markdown.includes('AutoMemoryBridge'),
  `got ${amHookDetail.s} hookName=${amHook?.name} mdLen=${amHookDetail.d?.markdown?.length}`);

// MCP items are synthesized from JSON config, so they get the same two checks
// hooks get — the preview really renders, and it renders the right server —
// plus the one that only MCP needs: the redaction actually holds. An API key
// pasted literally into `headers` is the normal way people configure a remote
// server, and this pane is screenshotted for the README.
const mcpItems = Array.isArray(items) ? items.filter((it) => it.type === 'mcp') : [];
chk('/api/library returns mcp items to exercise', mcpItems.length > 0, `got ${mcpItems.length}`);

const mcpDetails = [];
for (const it of mcpItems) {
  const d = await j('/api/library/item?id=' + encodeURIComponent(it.id));
  mcpDetails.push({ it, d });
}
chk('every mcp item resolves to 200 with non-empty markdown',
  mcpDetails.length > 0 && mcpDetails.every((x) => x.d.s === 200 && typeof x.d.d?.markdown === 'string' && x.d.d.markdown.length > 0),
  mcpDetails.find((x) => x.d.s !== 200)?.it?.id || '');

chk('mcp markdown names its transport and where it is declared',
  mcpDetails.every((x) => /\*\*Transport\*\*/.test(x.d.d?.markdown || '') && /\*\*Declared in\*\*/.test(x.d.d?.markdown || '')),
  mcpDetails.find((x) => !/\*\*Transport\*\*/.test(x.d.d?.markdown || ''))?.it?.id || '');

// Parse the JSON block back out and assert every env/header value either
// references a ${VAR} (a NAME, safe — `Bearer ${TOKEN}` is the common shape) or
// is fully masked, AND that nothing outside a reference is long enough to be a
// credential. A literal surviving here is a published secret, so this is the
// falsifier that matters most on this pane.
const PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const CREDENTIAL_RUN = /[A-Za-z0-9_-]{12,}/;
const secretLeaks = [];
for (const { it, d } of mcpDetails) {
  const block = /```json\n([\s\S]*?)\n```/.exec(d.d?.markdown || '');
  if (!block) { secretLeaks.push(`${it.id}: no json block`); continue; }
  let cfg;
  try { cfg = JSON.parse(block[1]); } catch { secretLeaks.push(`${it.id}: unparsable json block`); continue; }
  for (const key of ['env', 'headers']) {
    for (const [k, v] of Object.entries(cfg[key] || {})) {
      const s = String(v).trim();
      if (s === '' || /^•+$/.test(s)) continue;
      if (s.match(PLACEHOLDER) && !CREDENTIAL_RUN.test(s.replace(PLACEHOLDER, ' '))) continue;
      secretLeaks.push(`${it.id}: ${key}.${k}`);
    }
  }
}
chk('mcp config previews mask every literal env/header value', secretLeaks.length === 0, secretLeaks.join(', ').slice(0, 300));

// --- inlineNodes' emphasis rule must not eat snake_case -------------------
// The italic rule added to renderMarkdown is the dangerous kind of regex: a
// naive `_(.+?)_` italicises the middle of every snake_case identifier these
// panes display — TWENTY_FIRST_API_KEY becomes TWENTY<em>FIRST</em>API_KEY, and
// it reads as styling rather than as corruption, so nobody reports it.
//
// The pattern is lifted out of the SHIPPED ui.html rather than restated here.
// A copy of the regex would keep passing after someone edited the real one,
// which is the specific way this class of test rots.
const uiSrc = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', 'ui.html'), 'utf8');
const patternLine = /var pattern = (\/.*\/g);/.exec(uiSrc);
chk('inlineNodes\' inline pattern is still findable in ui.html', !!patternLine, 'pattern line not found — this test can no longer see what ships');

if (patternLine) {
  // eslint-disable-next-line no-eval
  const inlinePattern = eval(patternLine[1]);
  const emphasised = (text) => {
    const found = [];
    for (const m of text.matchAll(new RegExp(inlinePattern.source, 'g'))) {
      if (m[7] !== undefined) found.push(m[7]);
    }
    return found;
  };

  const CASES = [
    ['A _real emphasis_ span', ['real emphasis'], 'plain prose emphasis still works'],
    ['TWENTY_FIRST_API_KEY', [], 'a screaming-snake env var is left whole'],
    ['some_snake_case_name here', [], 'a lowercase snake_case identifier is left whole'],
    ['enabledMcpjsonServers and disabled_mcp_servers', [], 'mixed identifiers are left whole'],
    ['_leading and trailing_ both flank whitespace', ['leading and trailing'], 'emphasis at a line edge works'],
    ['a _b_ and c_d_e', ['b'], 'emphasis next to an identifier does not bleed into it'],
  ];
  const emphasisFailures = [];
  for (const [input, want, why] of CASES) {
    const got = emphasised(input);
    if (JSON.stringify(got) !== JSON.stringify(want)) emphasisFailures.push(`${why}: ${JSON.stringify(input)} -> ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  }
  chk('the emphasis rule italicises prose and never splits snake_case identifiers',
    emphasisFailures.length === 0, emphasisFailures.join(' | ').slice(0, 400));
}

// --- WS5 unified search manifest ---
// The contract the in-page fuzzy matcher depends on. Every assertion here is a
// field openSearchHit() dereferences, so a silent shape change in the manifest
// would otherwise surface as a dead click rather than a failing test.
const sidx = await j('/api/search-index');
chk('GET /api/search-index -> 200 without token (ungated, same posture as /api/library)', sidx.s===200, `got ${sidx.s}`);
const sItems = sidx.d?.items;
chk('/api/search-index returns a non-empty items array', Array.isArray(sItems) && sItems.length>0, `len=${sItems?.length}`);
chk('/api/search-index count matches items.length', sidx.d?.count === sItems?.length, `count=${sidx.d?.count} len=${sItems?.length}`);

const sShapeOk = Array.isArray(sItems) && sItems.every((it) =>
  typeof it.id==='string' && it.id.length>0 && typeof it.kind==='string' && it.kind.length>0
  && typeof it.name==='string' && it.name.length>0 && typeof it.text==='string');
chk('/api/search-index items all carry non-empty id/kind/name and a string text', sShapeOk, JSON.stringify(sItems?.[0]).slice(0,200));

// The three sources must ALL be present. A silent throw in any one of
// buildSearchIndex's try blocks degrades to a partial manifest that still
// looks healthy — this is what catches that.
const sKinds = new Set((sItems||[]).map((it) => it.kind));
chk("/api/search-index merges all three sources (note + agent + library kinds present)",
  sKinds.has('note') && sKinds.has('agent') && sKinds.has('skill'), [...sKinds].join(','));

// Per-source floors, well under the real counts so a note or plugin coming and
// going between runs never breaks the suite. The note floor is 3, not the real
// vault's ~69: run.mjs deliberately swaps index.json for a 3-note fixture for
// the duration of the run, so anything higher would assert against the CEO's
// live vault size from inside a fixture.
for (const [kind, min] of [['note', 3], ['agent', 40], ['skill', 60]]) {
  const n = (sItems||[]).filter((it) => it.kind===kind).length;
  chk(`/api/search-index has >= ${min} ${kind} items`, n >= min, `got ${n}`);
}

// SEARCH_TEXT_CAP is what keeps this manifest cheap enough to ship whole.
const maxTextLen = Array.isArray(sItems) ? Math.max(...sItems.map((it) => it.text.length)) : -1;
chk('/api/search-index: every item text is <= 180 chars (SEARCH_TEXT_CAP)', maxTextLen <= 180, `max observed = ${maxTextLen}`);

// openSearchHit() routes library kinds straight into /api/library/item by id,
// so those ids must be the SAME ids /api/library issued — not a parallel scheme.
const libIds = new Set((items||[]).map((it) => it.id));
const strayLibId = (sItems||[]).find((it) => it.kind!=='note' && it.kind!=='agent' && !libIds.has(it.id));
chk('/api/search-index library ids all resolve against /api/library ids', !strayLibId, `stray=${strayLibId?.id}`);

// Agent ids are namespaced so they can never collide with a note path or a
// library id, while the name (what the roster selects on) stays intact.
const agentSample = (sItems||[]).find((it) => it.kind==='agent');
chk("/api/search-index agent ids are namespaced 'agent:<name>'",
  !!agentSample && agentSample.id === 'agent:'+agentSample.name, JSON.stringify(agentSample).slice(0,160));

// Regression guard: truncateDescription's ellipsis must never push the
// result past the documented <=200 char contract (off-by-one: slicing 200
// then appending '…' yields 201).
const maxDescLen = Array.isArray(items) ? Math.max(...items.map((it) => it.description.length)) : -1;
chk('/api/library: every item description is <= 200 chars', maxDescLen <= 200, `max observed = ${maxDescLen}`);

// Regression guard: a hook label derived from a shell one-liner must never
// pick up stray shell punctuation (e.g. the closing ']' of an earlier
// `[ ! -f ... ]` existence test) as a fake "trailing CLI arg".
const badHookNames = Array.isArray(items) ? items.filter((it) => it.type === 'hook' && /\]/.test(it.name)) : [];
chk('/api/library: no hook name contains a stray bracket', badHookNames.length === 0, JSON.stringify(badHookNames.map((h) => h.name)));

const oldSkillsDir = await j('/api/skills-directory');
chk('GET /api/skills-directory -> 404 (old route removed)', oldSkillsDir.s===404, `got ${oldSkillsDir.s}`);

// --- intern bench: local + cloud providers, and the pull control ---
const bench = await j('/api/interns/models',{headers:{'X-Alfred-Token':TOKEN}});
chk('GET /api/interns/models returns providers', bench.s===200 && Array.isArray(bench.d?.providers), `got ${bench.s} ${JSON.stringify(bench.d).slice(0,120)}`);
const provIds = (bench.d?.providers||[]).map(p=>p.id);
chk('bench exposes both a local and a cloud provider', provIds.includes('local') && provIds.includes('ollama-cloud'), provIds.join(','));
const cloudProv = (bench.d?.providers||[]).find(p=>p.id==='ollama-cloud');
// Unconfigured is the DEFAULT state for every new user, so it must be honest
// rather than silent: no key means configured:false plus a hint naming the
// exact variable to set. A dead-end "unavailable" would be the bug.
chk('unconfigured cloud provider reports how to configure it',
  !!cloudProv && (cloudProv.configured===true || (cloudProv.configured===false && /Settings|OLLAMA_API_KEY/.test(cloudProv.hint||''))),
  JSON.stringify(cloudProv));
chk('/api/interns/models keeps its legacy flat models array', Array.isArray(bench.d?.models), typeof bench.d?.models);

const pullStat = await j('/api/interns/pull/status?after=0',{headers:{'X-Alfred-Token':TOKEN}});
chk('GET /api/interns/pull/status with token', pullStat.s===200 && 'phase' in (pullStat.d||{}), `got ${pullStat.s}`);
const pullNoTok = await fetch(B+'/api/interns/pull/status?after=0');
chk('GET /api/interns/pull/status without token blocked', pullNoTok.status===401||pullNoTok.status===403, `got ${pullNoTok.status}`);
// The name reaches `ollama pull` as a spawn argument, so this is not a shell
// guard — it stops a name that would be read as a flag by ollama itself.
const badPull = await fetch(B+'/api/interns/pull',{method:'POST',headers:H,body:JSON.stringify({model:'--rm -rf'})});
chk('POST /api/interns/pull rejects a flag-shaped model name', badPull.status===400, `got ${badPull.status}`);
const emptyPull = await fetch(B+'/api/interns/pull',{method:'POST',headers:H,body:JSON.stringify({model:''})});
chk('POST /api/interns/pull rejects an empty model name', emptyPull.status===400, `got ${emptyPull.status}`);

// --- settings: the key is write-only from the UI's point of view ---
const setNoTok = await fetch(B+'/api/settings');
chk('GET /api/settings without token blocked', setNoTok.status===401||setNoTok.status===403, `got ${setNoTok.status}`);
const setGet = await j('/api/settings',{headers:{'X-Alfred-Token':TOKEN}});
chk('GET /api/settings with token', setGet.s===200 && !!setGet.d?.ollamaApiKey, `got ${setGet.s}`);
// The whole point of the masked field: a screenshot or a shoulder-surfer must
// not be able to recover the key from this response.
const setBody = JSON.stringify(setGet.d);
chk('/api/settings never returns a raw key', !/"ollamaApiKey"\s*:\s*"[^"]/.test(setBody) && (setGet.d?.ollamaApiKey?.masked===null || /^•+/.test(setGet.d.ollamaApiKey.masked||'')), setBody.slice(0,160));
chk('/api/settings reports where the key came from', 'source' in (setGet.d?.ollamaApiKey||{}), JSON.stringify(setGet.d?.ollamaApiKey));
// A wrapped paste or a copied label is a paste accident, not a key — storing
// it would resurface later as a confusing 401.
const badKey = await fetch(B+'/api/settings',{method:'POST',headers:H,body:JSON.stringify({ollamaApiKey:'has spaces in it'})});
chk('POST /api/settings rejects a whitespace-bearing key', badKey.status===400, `got ${badKey.status}`);
const noField = await fetch(B+'/api/settings',{method:'POST',headers:H,body:JSON.stringify({})});
chk('POST /api/settings rejects an empty patch', noField.status===400, `got ${noField.status}`);
const postNoTok = await fetch(B+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ollamaApiKey:''})});
chk('POST /api/settings without token blocked', postNoTok.status===401||postNoTok.status===403, `got ${postNoTok.status}`);

// --- settings: the brain location -----------------------------------------
// The failure this guards is specific: a saved path that does not exist makes
// the whole HUD render as "you have no notes", which is indistinguishable from
// an empty vault and gives the operator nothing to act on. So the path is
// validated BEFORE it is stored, and the read path reports existence and a
// note count rather than just echoing a string back.
const SEP = String.fromCharCode(92, 92); // an escaped backslash, for building the path regex below
chk('/api/settings reports the brain location as state, not just a path',
  !!setGet.d?.vault && typeof setGet.d.vault.exists === 'boolean' && typeof setGet.d.vault.noteCount === 'number',
  JSON.stringify(setGet.d?.vault));
chk('and says where that value came from', ['env','config','default'].includes(setGet.d?.vault?.source), String(setGet.d?.vault?.source));
chk('the displayed brain path is tildified, not an absolute home path',
  !new RegExp('[A-Za-z]:' + SEP + 'Users' + SEP).test(setGet.d?.vault?.display || ''), setGet.d?.vault?.display || '');

const vaultBefore = setGet.d.vault.path;
const MISSING_PATH = ['Z:', 'definitely', 'not', 'here', 'alfred-test'].join(String.fromCharCode(92));
const missing = await fetch(B+'/api/settings',{method:'POST',headers:H,body:JSON.stringify({vaultPath:MISSING_PATH})});
chk('POST a brain path that does not exist -> 400', missing.status===400, `got ${missing.status}`);
const missingBody = await missing.json().catch(()=>({}));
chk('and the error names the folder rather than failing silently', /not\s+here|No folder/i.test(missingBody.error||''), missingBody.error||'');

const notADir = await fetch(B+'/api/settings',{method:'POST',headers:H,body:JSON.stringify({vaultPath:process.execPath})});
chk('POST a file as the brain path -> 400', notADir.status===400, `got ${notADir.status}`);

const afterBad = await j('/api/settings',{headers:{'X-Alfred-Token':TOKEN}});
chk('a rejected brain path is never stored', afterBad.d?.vault?.path === vaultBefore,
  `${afterBad.d?.vault?.path} vs ${vaultBefore}`);

// --- injection / traversal probes ---
const trav = await j('/api/note?path=../../../etc/passwd');
chk('/api/note rejects path traversal', trav.s!==200 || !JSON.stringify(trav.d).includes('root:'), `got ${trav.s}`);
const bigQ = await j('/api/search?q='+'a'.repeat(5000)); chk('/api/search survives 5k query', bigQ.s===200, `got ${bigQ.s}`);
const badJson = await fetch(B+'/api/settings',{method:'POST',headers:H,body:'{not json'});
chk('POST malformed JSON -> 400', badJson.status===400, `got ${badJson.status}`);

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));

