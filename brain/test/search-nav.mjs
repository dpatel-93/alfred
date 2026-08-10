// Search navigation: clicking a result must land on the thing, from ANY view.
//
// This suite exists because of a specific bug that shipped. Search is global —
// the input lives in the persistent rail, so it works from every view — but the
// note-hit handler resolved against the live `nodeById`, and `applyOrgPayload`
// reassigns that to the ORG dataset for the duration of the Enterprise view.
// From there the lookup returned undefined and the click silently did nothing.
// Two older sites had the same defect, and one of them additionally never
// switched views, so a hit clicked from Library flew a canvas nobody could see.
//
// Every test below therefore starts by navigating AWAY from the Brain view.
// A version of these that only ran on Brain would have passed against the bug,
// which is exactly how it survived review in the first place.
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');
const BASE = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = []; const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext();
// The poll scheduler freezes on document.hidden, and a headless page can report
// hidden depending on how it was launched. Pin it so polled views actually load.
await ctx.addInitScript(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// #landing intercepts pointer events until dismissed; every click below would
// otherwise land on it instead of on the app.
await page.click('#landing').catch(() => {});
await page.waitForTimeout(1200);

async function typeSearch(q) {
  await page.fill('#search-input', '');
  await page.fill('#search-input', q);
  await page.dispatchEvent('#search-input', 'input');
  await page.waitForFunction(
    () => document.getElementById('search-results').classList.contains('show'),
    null, { timeout: 8000 },
  ).catch(() => {});
  await page.waitForTimeout(250);
}

// Read the result rows' kind labels so a test can pick a hit of a given kind
// instead of assuming an index, which would break the moment ranking changes.
async function rows() {
  return page.$$eval('#search-results .result', (els) => els.map((el) => ({
    kind: (el.querySelector('.rfolder') || {}).textContent || '',
    title: (el.querySelector('.rtitle') || {}).textContent || '',
  })));
}

async function clickKind(prefix) {
  const all = await rows();
  const idx = all.findIndex((r) => r.kind.toLowerCase().startsWith(prefix));
  if (idx < 0) return null;
  await page.click(`#search-results .result:nth-child(${idx + 1})`);
  await page.waitForTimeout(1400);
  return all[idx];
}

const view = () => page.evaluate(() => location.hash.replace('#', '') || 'brain');

// --- a NOTE hit, clicked from the org chart -------------------------------
// The exact shape of the shipped bug.
await page.evaluate(() => { location.hash = 'ops'; });
await page.waitForTimeout(2500);
T('setup: on the Enterprise view before searching', (await view()) === 'ops', await view());

await typeSearch('alfred');
const noteHit = await clickKind('note');
T('a note result exists to click from the Ops view', !!noteHit, JSON.stringify((await rows()).slice(0, 3)));
T('clicking a note hit from Ops switches to the Brain view',
  (await view()) === 'brain', `hash=${await view()} title=${noteHit && noteHit.title}`);
T('clicking a note hit from Ops opens its panel',
  await page.evaluate(() => document.getElementById('panel').classList.contains('open')),
  'panel did not open — the click resolved to nothing');

// --- an AGENT hit, clicked from the Library view --------------------------
await page.evaluate(() => { location.hash = 'library'; });
await page.waitForTimeout(2000);
await typeSearch('cso');
const agentHit = await clickKind('agent');
T('an agent result exists to click from the Library view', !!agentHit, JSON.stringify((await rows()).slice(0, 3)));
T('clicking an agent hit from Library switches to the Roster',
  (await view()) === 'directory', `hash=${await view()}`);
T('clicking an agent hit selects that row in the Roster',
  await page.evaluate(() => !!document.querySelector('#directory-list .list-row.selected')),
  'no row selected — the parked-selection handoff did not fire');

// --- a LIBRARY hit, clicked from the Roster view --------------------------
// Also covers the cold path: the Library list has never rendered in this page
// load, so the selection has to be parked and honoured by the first render.
await page.evaluate(() => { location.hash = 'directory'; });
await page.waitForTimeout(1500);
await typeSearch('firecrawl');
const skillHit = await clickKind('skill');
T('a skill result exists to click from the Roster view', !!skillHit, JSON.stringify((await rows()).slice(0, 3)));
T('clicking a skill hit from the Roster switches to the Library',
  (await view()) === 'library', `hash=${await view()}`);
T('a selection made before the Library ever rendered is honoured, not dropped',
  await page.evaluate(() => !!document.querySelector('#library-list .list-row.selected')),
  'no row selected — pendingLibrarySelect was dropped');
T('the Library preview actually loaded for the clicked item',
  await page.evaluate(() => (document.getElementById('library-preview').textContent || '').length > 40),
  'preview pane empty');

// --- navigating to a hit must not leave a filter hiding it -----------------
// Arriving at a list that has silently filtered out the thing you just clicked
// is worse than not navigating at all.
T('navigating to the Library resets its filters to "all"',
  await page.evaluate(() => [...document.querySelectorAll('#stage-library .filter-chip.active')]
    .every((c) => c.dataset.filter === 'all')),
  await page.evaluate(() => [...document.querySelectorAll('#stage-library .filter-chip.active')].map((c) => c.dataset.filter).join(',')));

T('no uncaught JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 200)));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));

await browser.close();
