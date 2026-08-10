// Charter panel: clicking a chartered agent in the ops org chart must open that
// agent's whole .md in the side panel, and a node with no charter file on disk
// must say so rather than showing a blank panel or invented prose.
//
// Drives the real user path — a click at the node's published screen position on
// the canvas — not a direct call to openAgentPanel(), which is closure-private
// and would prove nothing about the click handler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');
const BASE = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = []; const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

// cto is a real chartered agent on this machine; __ghost-agent deliberately
// is not; the subagent node is a live transcript, which must keep its old path.
const CHARTERED = 'roster:cto';
const GHOST = 'roster:__ghost-agent';
const LIVE = 'subagent:live-one';

const payload = {
  generatedAt: new Date().toISOString(),
  tiers: { ceo: { name: 'Operator' } },
  agents: [
    { id: CHARTERED, label: 'cto', tier: 'vp', model: 'opus', status: 'idle', parent: null },
    { id: GHOST, label: '__ghost-agent', tier: 'vp', model: 'opus', status: 'idle', parent: null },
    { id: LIVE, label: 'live-one', tier: 'manager', model: 'sonnet', status: 'active', parent: CHARTERED,
      project: 'alfred', lastActivity: new Date().toISOString() },
  ],
  counts: { ceo: 1, vp: 2, manager: 1, employee: 0, intern: 0 },
};

const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

await page.route('**/api/org*', (r) => {
  const u = new URL(r.request().url());
  const body = u.searchParams.get('detail')
    ? { events: ['ran Bash', 'edited server.mjs'] }
    : payload;
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#landing'); await page.waitForTimeout(1000);
await page.click('[data-view="ops"]'); await page.waitForTimeout(2500);

async function clickNode(id) {
  const pt = await page.evaluate((wanted) => {
    const g = window.__alfredDebug();
    const i = g.nodes.findIndex((n) => n.id === wanted);
    return i < 0 ? null : g.screen[i];
  }, id);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(900);
  return true;
}

// --- 1. chartered agent renders its whole charter -----------------------
const clickedCharter = await clickNode(CHARTERED);
T('the chartered node is clickable on the canvas', clickedCharter);

const charter = await page.evaluate(() => {
  const body = document.getElementById('panel-body');
  return {
    open: document.getElementById('panel').classList.contains('open'),
    text: body.innerText,
    headings: [...body.querySelectorAll('h1,h2,h3')].map((h) => h.textContent.trim()),
    tables: body.querySelectorAll('table').length,
    scripts: body.querySelectorAll('script').length,
  };
});

T('panel is open', charter.open);
T('status block survives above the charter', /IDLE/.test(charter.text), charter.text.slice(0, 60));
for (const section of ['Mission', 'My team', 'Skills I invoke', 'Rules', 'What I return', 'Escalation', 'Anti-patterns']) {
  T(`charter section rendered: ${section}`, charter.headings.some((h) => h === section),
    charter.headings.join(' | ').slice(0, 200));
}
T('the team/skills matrices render as real tables', charter.tables >= 2, `${charter.tables} tables`);
T('no script element was ever constructed from charter markdown', charter.scripts === 0);
T('charter body is substantial, not a stub', charter.text.length > 2000, `${charter.text.length} chars`);

// --- 2. no charter on disk degrades honestly ----------------------------
await clickNode(GHOST);
const ghost = await page.evaluate(() => {
  const body = document.getElementById('panel-body');
  return { text: body.innerText, empty: !!body.querySelector('.charter-empty'), headings: body.querySelectorAll('h2').length };
});
T('an agent with no charter file shows an explicit empty state', ghost.empty, ghost.text.slice(0, 160));
T('the empty state says why', /No charter file on disk/i.test(ghost.text), ghost.text.slice(0, 160));
T('nothing is fabricated for an uncharter\u0065d agent', ghost.headings === 0, `${ghost.headings} headings`);

// --- 3. live transcript path is not regressed ---------------------------
await clickNode(LIVE);
const live = await page.evaluate(() => {
  const body = document.getElementById('panel-body');
  return {
    charterBox: body.querySelectorAll('.charter-sep').length,
    events: [...document.getElementById('connected-list').querySelectorAll('.conn-item')].map((d) => d.textContent),
    text: body.innerText,
  };
});
T('a live subagent node fetches no charter', live.charterBox === 0);
T('a live subagent still lists its recent events', live.events.includes('ran Bash'), live.events.join(' | '));
T('a live subagent still shows its status', /ACTIVE/.test(live.text), live.text.slice(0, 80));

// --- 4. the XSS posture the charter renderer relies on ------------------
// The charter renderer is only safe because nothing on this page assigns markup.
// Assert the posture itself, not just today's diff.
const src = fs.readFileSync(path.join(HERE, '..', 'ui.html'), 'utf8');
const htmlSinks = src.match(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(/g) || [];
T('ui.html assigns raw markup nowhere', htmlSinks.length === 0, htmlSinks.join(', '));

T('no JS errors across all three panel paths', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 180)));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
