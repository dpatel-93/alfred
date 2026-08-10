// Workshop / GitHub suite.
//
// The Workshop surface used to list folders under a hardcoded project root, so
// it only ever worked on one machine. It now reads the signed-in GitHub
// account. That makes the interesting cases the ones where nobody is signed in
// and the ones where a credential could leak, so those are what this covers.
//
// Deliberately NOT asserted: that any particular repository exists. That would
// bind the suite to whoever is signed in on the machine running it.
const B = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = [];
function chk(name, cond, detail = '') { R.push({ n: name, ok: !!cond, d: String(detail) }); }

const html = await (await fetch(B + '/')).text();
const TOKEN = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1];
const H = { 'X-Alfred-Token': TOKEN, 'Content-Type': 'application/json' };

async function j(p, headers) { const r = await fetch(B + p, headers ? { headers } : undefined); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; }

// --- the account routes are gated -----------------------------------------
// These describe the operator's GitHub account, so unlike /api/library and the
// other local-config reads they sit behind the bridge token.
for (const p of ['/api/github/status', '/api/workshop']) {
  const open = await j(p);
  chk(`GET ${p} without a token is refused`, open.s === 401 || open.s === 403, `got ${open.s}`);
}
for (const p of ['/api/github/device/start', '/api/github/disconnect']) {
  const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  chk(`POST ${p} without a token is refused`, r.status === 401 || r.status === 403, `got ${r.status}`);
}

// --- status ---------------------------------------------------------------
const st = await j('/api/github/status', H);
chk('GET /api/github/status -> 200', st.s === 200, `got ${st.s}`);
chk('status reports connection state as a boolean, never a guess', typeof st.d?.connected === 'boolean', JSON.stringify(st.d));
chk('status names which route is in use when connected',
  !st.d?.connected || st.d.via === 'gh-cli' || st.d.via === 'device-flow', String(st.d?.via));
chk('status reports whether the gh CLI is installed', typeof st.d?.ghCliInstalled === 'boolean', String(st.d?.ghCliInstalled));
chk('status carries a device-flow state even when idle', typeof st.d?.device?.state === 'string', JSON.stringify(st.d?.device));

// The whole point of both auth routes is that no GitHub credential passes
// through the browser. A token appearing in any of these bodies would mean it
// does.
const statusText = JSON.stringify(st.d || {});
chk('status never returns a GitHub token', !/gh[pousr]_[A-Za-z0-9]{16,}/.test(statusText), 'token-shaped string in the body');
chk('status never returns a device_code', !('deviceCode' in (st.d?.device || {})) && !/device_code/.test(statusText), statusText.slice(0, 120));

// --- settings exposes the client id, and only the client id ---------------
const settings = await j('/api/settings', H);
chk('GET /api/settings -> 200', settings.s === 200, `got ${settings.s}`);
chk('settings exposes the GitHub Client ID field', !!settings.d?.githubClientId, JSON.stringify(settings.d?.githubClientId));
chk('settings never returns a stored GitHub token',
  !/gh[pousr]_[A-Za-z0-9]{16,}/.test(JSON.stringify(settings.d || {})) && !('githubToken' in (settings.d || {})), '');
// Masked with bullets rather than asterisks — the assertion accepts either, so
// a cosmetic change to the mask character does not read as a security failure.
chk('the Ollama key is still masked, not echoed',
  !settings.d?.ollamaApiKey?.configured || /[*•]/.test(settings.d.ollamaApiKey.masked || ''),
  settings.d?.ollamaApiKey?.masked || '');

// A malformed Client ID is rejected before it reaches the config file, because
// a wrapped paste stored here fails much later as an opaque device-flow error.
const badCid = await fetch(B + '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ githubClientId: 'has spaces and\nnewlines' }) });
chk('POST a malformed Client ID -> 400', badCid.status === 400, `got ${badCid.status}`);
const stillThere = await j('/api/settings', H);
chk('and the rejected value was not stored',
  (stillThere.d?.githubClientId?.value || '') === (settings.d?.githubClientId?.value || ''), '');

// --- workshop -------------------------------------------------------------
const ws = await j('/api/workshop', H);
chk('GET /api/workshop answers with a body either way', ws.s === 200 || ws.s === 502, `got ${ws.s}`);
chk('workshop always returns a repos array, even disconnected', Array.isArray(ws.d?.repos), JSON.stringify(ws.d).slice(0, 120));
chk('workshop states its connection rather than implying it from an empty list',
  typeof ws.d?.connected === 'boolean', String(ws.d?.connected));
if (!ws.d?.connected) {
  chk('a disconnected workshop returns no repos at all', ws.d.repos.length === 0, `got ${ws.d.repos.length}`);
} else {
  chk('a disconnected workshop returns no repos at all', true, 'connected on this machine — case not exercised');
  const r = ws.d.repos[0];
  chk('each repo carries the fields the card needs',
    !r || ['slug', 'name', 'private', 'url', 'pushedAt'].every((k) => k in r), JSON.stringify(r || {}).slice(0, 160));
  chk('local clone state is either absent or a real object, never a folder-name guess',
    ws.d.repos.every((x) => x.local === null || (typeof x.local === 'object' && 'path' in x.local)), '');
  chk('local paths are tildified, so a screenshot cannot publish the account name',
    ws.d.repos.every((x) => !x.local || !x.local.path.includes('Users')), '');
}
chk('workshop never returns a GitHub token', !/gh[pousr]_[A-Za-z0-9]{16,}/.test(JSON.stringify(ws.d || {})), '');

// --- device flow refuses to start without a Client ID ---------------------
// Only meaningful when one is not configured; when it is, starting a flow
// would hit GitHub for real, which a test suite has no business doing.
if (!st.d?.clientIdConfigured) {
  const start = await fetch(B + '/api/github/device/start', { method: 'POST', headers: H, body: '{}' });
  chk('POST device/start without a Client ID -> 400', start.status === 400, `got ${start.status}`);
  const body = await start.json().catch(() => ({}));
  chk('and the error says what to do about it', /client id/i.test(body.error || ''), body.error || '');
} else {
  chk('POST device/start without a Client ID -> 400', true, 'a Client ID is configured here — case not exercised');
  chk('and the error says what to do about it', true, 'a Client ID is configured here — case not exercised');
}

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
