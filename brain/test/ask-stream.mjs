const B = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = [];
function T(n, c, d = '') { R.push({ n, ok: !!c, d: String(d) }); }

// Helper to read and parse NDJSON response
async function readNdjson(response) {
  const text = await response.text();
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((x) => x !== null);
}

// Reads only up to (and including) the first NDJSON line, then cancels the
// rest of the stream. This is the routing corpus's whole point: assert on
// classification without paying for retrieval/generation to finish — a
// question-shaped corpus entry still runs the real (offline, extractive-
// fallback) local pipeline behind the route line, and a task-shaped entry
// now short-circuits to `done` in two lines total, but neither case should
// need the test to wait for the full body.
async function firstLine(q) {
  const r = await fetch(B + '/api/ask/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q }),
  });
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    const nl = buf.indexOf('\n');
    if (nl !== -1) {
      const line = buf.slice(0, nl);
      try { await reader.cancel(); } catch { /* stream already closing */ }
      try { return JSON.parse(line); } catch { return null; }
    }
    if (done) break;
  }
  try { return JSON.parse(buf.trim()); } catch { return null; }
}

// Helper to make fetch requests
async function j(p, o) {
  const r = await fetch(B + p, o);
  let d = null;
  try { d = await r.json(); } catch {}
  return { s: r.status, d };
}

// ============================================================================
// 1. Classifier routes both branches correctly
// ============================================================================

// Test local/question route classification
const localResp = await fetch(B + '/api/ask/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'what is alfred' }),
});
T('POST /api/ask/stream with local question answers 200', localResp.status === 200, `got ${localResp.status}`);
const localText = await localResp.text();
const localLines = localText.split('\n').filter((l) => l.trim());
const localFirstLine = localLines[0] ? JSON.parse(localLines[0]) : null;
T('first NDJSON line is route event for local question', localFirstLine && localFirstLine.type === 'route', JSON.stringify(localFirstLine).slice(0, 150));
T('local question routes to route=local', localFirstLine && localFirstLine.route === 'local', localFirstLine?.route);
T('local question routes to category=question', localFirstLine && localFirstLine.category === 'question', localFirstLine?.category);
T('local question routes to engine=ollama', localFirstLine && localFirstLine.engine === 'ollama', localFirstLine?.engine);
T('local question has reason=default-local', localFirstLine && localFirstLine.reason === 'default-local', localFirstLine?.reason);

// Test task/research route classification. This used to spawn a real Haiku
// CLI process and wait up to 20-30s for it — that dependency is gone now
// (see server.mjs handleAskStream: route==="research" short-circuits before
// any retrieval/generation), so this is a plain, fast, deterministic request.
const taskResp = await fetch(B + '/api/ask/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'fix the login bug' }),
});
T('POST /api/ask/stream with task-shaped question answers 200', taskResp.status === 200, `got ${taskResp.status}`);
const taskEvents = await readNdjson(taskResp);
const taskFirstLine = taskEvents[0] || null;
T('first NDJSON line is route event for task question', taskFirstLine && taskFirstLine.type === 'route', JSON.stringify(taskFirstLine).slice(0, 150));
T('task question routes to route=research', taskFirstLine && taskFirstLine.route === 'research', taskFirstLine?.route);
T('task question routes to category=task', taskFirstLine && taskFirstLine.category === 'task', taskFirstLine?.category);
T('task question routes to engine=needs-agent', taskFirstLine && taskFirstLine.engine === 'needs-agent', taskFirstLine?.engine);
T('task question has reason=action-verb:fix', taskFirstLine && taskFirstLine.reason === 'action-verb:fix', taskFirstLine?.reason);

// ============================================================================
// 2. NDJSON event order and shape, local route
// ============================================================================

const localFullResp = await fetch(B + '/api/ask/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'what is alfred' }),
});
const localEvents = await readNdjson(localFullResp);

T('local response: first event is route', localEvents[0] && localEvents[0].type === 'route', `got ${localEvents[0]?.type}`);
T('local response: route event has route=local', localEvents[0] && localEvents[0].route === 'local', localEvents[0]?.route);

const localSourcesEvent = localEvents.find((e) => e.type === 'sources');
T('local response: exactly one sources event', localSourcesEvent && localEvents.filter((e) => e.type === 'sources').length === 1, `${localEvents.filter((e) => e.type === 'sources').length} sources events`);
T('local response: sources appear after route', localSourcesEvent && localEvents.indexOf(localSourcesEvent) > 0, `sources at index ${localEvents.indexOf(localSourcesEvent)}`);
T('local response: sources is an array with results', localSourcesEvent && Array.isArray(localSourcesEvent.sources) && localSourcesEvent.sources.length > 0, `${localSourcesEvent?.sources?.length} sources`);
T('local response: retrieval mode is keyword (ollama offline)', localSourcesEvent && localSourcesEvent.retrieval === 'keyword', localSourcesEvent?.retrieval);

const localAckEvent = localEvents.find((e) => e.type === 'ack');
T('local response: no ack event (ack was removed from the wire contract entirely)', !localAckEvent, localAckEvent ? 'ack event present' : 'none');

const localDeltaEvents = localEvents.filter((e) => e.type === 'delta');
T('local response: has at least one delta event', localDeltaEvents.length > 0, `${localDeltaEvents.length} deltas`);
T('local response: delta events appear after sources', localDeltaEvents.length > 0 && localEvents.indexOf(localDeltaEvents[0]) > (localEvents.indexOf(localSourcesEvent) || 0), `first delta at index ${localEvents.indexOf(localDeltaEvents[0])}`);

const localDoneEvent = localEvents.find((e) => e.type === 'done');
T('local response: exactly one done event', localDoneEvent && localEvents.filter((e) => e.type === 'done').length === 1, `${localEvents.filter((e) => e.type === 'done').length} done events`);
T('local response: done has non-empty answer', localDoneEvent && localDoneEvent.answer && typeof localDoneEvent.answer === 'string' && localDoneEvent.answer.length > 0, `answer length ${localDoneEvent?.answer?.length}`);
T('local response: done.route=local', localDoneEvent && localDoneEvent.route === 'local', localDoneEvent?.route);
T('local response: done has ms.route', localDoneEvent && typeof localDoneEvent.ms?.route === 'number', `${localDoneEvent?.ms?.route}`);
T('local response: done has ms.firstDelta', localDoneEvent && typeof localDoneEvent.ms?.firstDelta === 'number', `${localDoneEvent?.ms?.firstDelta}`);
T('local response: done has ms.total', localDoneEvent && typeof localDoneEvent.ms?.total === 'number', `${localDoneEvent?.ms?.total}`);
T('local response: ms.route <= ms.firstDelta <= ms.total', localDoneEvent && localDoneEvent.ms.route <= localDoneEvent.ms.firstDelta && localDoneEvent.ms.firstDelta <= localDoneEvent.ms.total, `route=${localDoneEvent?.ms?.route} firstDelta=${localDoneEvent?.ms?.firstDelta} total=${localDoneEvent?.ms?.total}`);

T('local response headers: content-type is ndjson', localFullResp.headers.get('content-type')?.includes('application/x-ndjson'), localFullResp.headers.get('content-type'));
T('local response headers: cache-control includes no-cache', localFullResp.headers.get('cache-control')?.includes('no-cache'), localFullResp.headers.get('cache-control'));

// ============================================================================
// 3. Task/research route short-circuits honestly (no more fake "I'll look
//    that up" -> vault-only-refusal round trip)
// ============================================================================
// Previously this section waited up to 30s for a real Haiku CLI spawn and
// asserted an `ack` event fired before `done`. That flow is gone: Haiku was
// never able to satisfy a "research" classification (vault-only, temperature
// 0, instructed to refuse anything not in the excerpts) — it always produced
// the ack promise followed immediately by "I don't have that in the vault,
// sir." The fix is to stop attempting it, so this is now a plain, fast,
// two-line response: route, then done.

const shortCircuitResp = await fetch(B + '/api/ask/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'what is the weather like today' }),
});
const shortCircuitEvents = await readNdjson(shortCircuitResp);

T('task response: first event is route', shortCircuitEvents[0]?.type === 'route', `got ${shortCircuitEvents[0]?.type}`);
T('task response: route=research', shortCircuitEvents[0]?.route === 'research', shortCircuitEvents[0]?.route);
T('task response: category=task', shortCircuitEvents[0]?.category === 'task', shortCircuitEvents[0]?.category);
T('task response: has no ack event', !shortCircuitEvents.some((e) => e.type === 'ack'), 'ack event present');
T('task response: has no sources event', !shortCircuitEvents.some((e) => e.type === 'sources'), 'sources event present');
T('task response: has no delta event', !shortCircuitEvents.some((e) => e.type === 'delta'), 'delta event present');
T('task response: exactly two events total (route, done)', shortCircuitEvents.length === 2, `${shortCircuitEvents.length} events: ${shortCircuitEvents.map((e) => e.type).join(',')}`);

const shortCircuitDone = shortCircuitEvents.find((e) => e.type === 'done');
T('task response: has done event', !!shortCircuitDone, 'no done event');
T('task response: done.askEngine=needs-agent (never haiku/ollama/extractive/none)', shortCircuitDone?.askEngine === 'needs-agent', shortCircuitDone?.askEngine);
T('task response: done.route=research', shortCircuitDone?.route === 'research', shortCircuitDone?.route);
T('task response: done.answer is a non-empty honest explanation, not a vault refusal', !!shortCircuitDone?.answer && !/i don't have that in the vault/i.test(shortCircuitDone.answer), shortCircuitDone?.answer);

// ============================================================================
// 4. the removed voice surface stays removed
// ============================================================================
// /api/tts and /api/tts/cached went with WS2. Asserted as 404 rather than just
// deleted, because a route quietly coming back — via a revert, a bad merge, or
// someone reinstating the npm dependency — should fail loudly right here.
for (const p of ['/api/tts/cached?id=ack-research', '/api/tts/cached?id=nonsense']) {
  const r = await j(p);
  T(`GET ${p} -> 404 (TTS removed)`, r.s === 404, `got ${r.s}`);
}
{
  const r = await fetch(B + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"x"}' });
  T('POST /api/tts -> 404 (TTS removed)', r.status === 404, `got ${r.status}`);
}

// ============================================================================
// 5. POST /api/ask unchanged
// ============================================================================

const askGetResp = await fetch(B + '/api/ask', { method: 'GET' });
T('GET /api/ask returns 405', askGetResp.status === 405, `got ${askGetResp.status}`);

const askPostResp = await j('/api/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'what is alfred' }),
});
T('POST /api/ask answers 200', askPostResp.s === 200, `got ${askPostResp.s}`);
T('POST /api/ask response has answer field', askPostResp.d && typeof askPostResp.d.answer === 'string', `${JSON.stringify(askPostResp.d).slice(0, 200)}`);
T('POST /api/ask response has sources array', askPostResp.d && Array.isArray(askPostResp.d.sources), `${JSON.stringify(askPostResp.d?.sources)}`);
T('POST /api/ask response has askEngine field', askPostResp.d && typeof askPostResp.d.askEngine === 'string', `${askPostResp.d?.askEngine}`);

// ============================================================================
// 6. Routing corpus — question-shaped, task-shaped, both override
//    directions, and the tricky "question-shaped surface but must resolve to
//    task" case. Asserts against the route/category/reason of the FIRST
//    NDJSON line only — never waits on generation to finish.
// ============================================================================

const ROUTING_CORPUS = [
  // plain default question — no keyword in any tier
  { q: 'what is alfred', category: 'question', route: 'local', reason: 'default-local' },
  { q: 'explain how the classifier works', category: 'question', route: 'local', reason: 'default-local' },
  // vault-scope tier (server-only tier 4, additional to the client's 4 tiers)
  { q: 'what does my vault say about tickr', category: 'question', route: 'local', reason: 'local-keyword:vault-scope' },
  // the tricky case: question-shaped surface, must resolve to task/research
  { q: "what is the weather like today", category: 'task', route: 'research', reason: 'external-info:weather' },
  // external-info keywords (tier 2) — task even though phrased as a request, not a command
  { q: 'look up the population of France', category: 'task', route: 'research', reason: 'external-info:look up' },
  { q: 'check the current version of node', category: 'task', route: 'research', reason: 'external-info:current version' },
  { q: 'who won the game last night', category: 'task', route: 'research', reason: 'external-info:who won' },
  { q: 'google the nearest coffee shop', category: 'task', route: 'research', reason: 'external-info:google' },
  // action verbs (tier 3) — imperative, task-shaped
  { q: 'fix the bug in the login page', category: 'task', route: 'research', reason: 'action-verb:fix' },
  { q: 'commit these changes and push', category: 'task', route: 'research', reason: 'action-verb:commit' },
  // force-task override (tier 1) — overrides even a plain request
  { q: 'please go do the migration for me', category: 'task', route: 'research', reason: 'force-task:go do' },
  { q: 'take care of the deployment tonight', category: 'task', route: 'research', reason: 'force-task:take care of' },
  // force-question override (tier 1) — overrides even action-verb-shaped phrasing
  { q: 'quick question, what time is it', category: 'question', route: 'local', reason: 'force-question:quick question' },
  { q: 'just tell me what alfred is', category: 'question', route: 'local', reason: 'force-question:just tell me' },
];

for (const c of ROUTING_CORPUS) {
  const line = await firstLine(c.q);
  T(`routing corpus: "${c.q}" -> category=${c.category}`, line?.category === c.category, `got category=${line?.category} (full: ${JSON.stringify(line)})`);
  T(`routing corpus: "${c.q}" -> route=${c.route}`, line?.route === c.route, `got route=${line?.route}`);
  T(`routing corpus: "${c.q}" -> reason=${c.reason}`, line?.reason === c.reason, `got reason=${line?.reason}`);
}

// ============================================================================
// Report results
// ============================================================================

const pass = R.filter((r) => r.ok).length;
console.log(`pass ${pass} / fail ${R.length - pass}\n`);
for (const r of R) {
  console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 180)));
}
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
