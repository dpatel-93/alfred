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
                          ['/api/search?q=alfred',200],['/api/projects',200],['/api/deish',200],['/api/nope',404]]) {
  const r = await j(p); chk(`GET ${p} -> ${want}`, r.s===want, `got ${r.s}`);
}

// --- auth surface ---
const noTok = await j('/api/claude/state'); chk('GET /api/claude/state without token blocked', noTok.s===401||noTok.s===403, `got ${noTok.s}`);
const opt = await fetch(B+'/api/status',{method:'OPTIONS'}); chk('OPTIONS preflight refused', opt.status===403, `got ${opt.status}`);
const badTok = await fetch(B+'/api/claude/send',{method:'POST',headers:{'X-Alfred-Token':'wrong','Content-Type':'application/json'},body:'{}'});
chk('POST bridge with wrong token blocked', badTok.status===401||badTok.status===403, `got ${badTok.status}`);
const getAsk = await fetch(B+'/api/ask'); chk('GET /api/ask -> 405', getAsk.status===405, `got ${getAsk.status}`);

const H = {'X-Alfred-Token':TOKEN,'Content-Type':'application/json'};
const st = await j('/api/claude/state?after=0',{headers:{'X-Alfred-Token':TOKEN}});
chk('GET /api/claude/state with token', st.s===200, `got ${st.s} ${JSON.stringify(st.d).slice(0,120)}`);
const ag = await j('/api/agents',{headers:{'X-Alfred-Token':TOKEN}}); chk('GET /api/agents with token', ag.s===200, `got ${ag.s}`);
const to = await j('/api/terminal/output?after=0',{headers:{'X-Alfred-Token':TOKEN}}); chk('GET /api/terminal/output with token', to.s===200, `got ${to.s}`);

// --- payload shapes ---
const status = (await j('/api/status')).d;
chk('/api/status reports ttsEngine', 'ttsEngine' in (status||{}), JSON.stringify(status).slice(0,200));
const graph = (await j('/api/graph')).d;
chk('/api/graph returns nodes array', Array.isArray(graph?.nodes), `nodes=${graph?.nodes?.length}`);
const org = (await j('/api/org')).d;
chk('/api/org returns agents', Array.isArray(org?.agents)||Array.isArray(org?.nodes), Object.keys(org||{}).join(','));

// --- tts off-mode contract (the free-voice fallback path) ---
const tts = await fetch(B+'/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'hello'})});
chk('POST /api/tts in off-mode -> 503 (UI falls back to browser voice)', tts.status===503, `got ${tts.status}`);

// --- injection / traversal probes ---
const trav = await j('/api/note?path=../../../etc/passwd');
chk('/api/note rejects path traversal', trav.s!==200 || !JSON.stringify(trav.d).includes('root:'), `got ${trav.s}`);
const bigQ = await j('/api/search?q='+'a'.repeat(5000)); chk('/api/search survives 5k query', bigQ.s===200, `got ${bigQ.s}`);
const badJson = await fetch(B+'/api/claude/send',{method:'POST',headers:H,body:'{not json'});
chk('POST malformed JSON -> 400', badJson.status===400, `got ${badJson.status}`);

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));

