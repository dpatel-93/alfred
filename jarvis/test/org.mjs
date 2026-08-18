const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');
const BASE = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = []; const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

// Real /api/org shape: agents carry label/tier/status/parent (roster ids).
function fleet() {
  const a = [{ id: 'roster:ceo', label: 'Dishi', tier: 'ceo', model: 'human', status: 'active', parent: null }];
  const active = new Set(['vp0', 'm0-0', 'e0-0-0']);   // one live delegation chain
  for (let v = 0; v < 5; v++) {
    a.push({ id: `roster:vp${v}`, label: `vp-${['cto', 'cso', 'cfo', 'coo', 'arch'][v]}`, tier: 'vp', model: 'opus',
             status: active.has(`vp${v}`) ? 'active' : 'idle', parent: 'roster:ceo' });
    for (let m = 0; m < 3; m++) {
      a.push({ id: `roster:m${v}-${m}`, label: `mgr-${v}${m}-backend`, tier: 'manager', model: 'sonnet',
               status: active.has(`m${v}-${m}`) ? 'active' : 'idle', parent: `roster:vp${v}` });
      for (let e = 0; e < 2; e++) {
        a.push({ id: `roster:e${v}-${m}-${e}`, label: `eng-${v}${m}${e}`, tier: 'employee', model: 'haiku',
                 status: active.has(`e${v}-${m}-${e}`) ? 'active' : 'idle', parent: `roster:m${v}-${m}`,
                 costUsd: 0.10, tokens: 20000 });
      }
    }
  }
  return { generatedAt: new Date().toISOString(), tiers: { ceo: { name: 'Dishi' } }, agents: a,
           counts: { ceo: 1, vp: 5, manager: 15, employee: 30, intern: 0 } };
}

const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

const payload = fleet();
await page.route('**/api/org*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#landing'); await page.waitForTimeout(1000);
await page.click('[data-view="ops"]'); await page.waitForTimeout(2500);

T('no JS errors rendering 51 agents', errs.length === 0, errs.slice(0, 3).join(' | '));

const geom = await page.evaluate(() => {
  const g = window.__alfredDebug;
  return g ? g() : null;
});
T('debug hook exposes layout', !!geom, JSON.stringify(geom).slice(0, 120));

// The fixture is 51 agents but the chart caps each lane at ORG_LANE_CAP (10),
// so the DRAWN set is smaller: 1 synthesized CEO + 5 VPs (under the cap) + 10 of
// 15 managers + 10 of 30 employees = 26. These numbers were 51/50 for a long
// time — written before the cap existed and never re-run, because Playwright
// resolution was Linux-only and every browser suite silently skipped.
const VISIBLE_NODES = 26;
const VISIBLE_LINKS = VISIBLE_NODES - 1;  // a tree rooted at the CEO

if (geom) {
  const { nodes, links, spacing } = geom;
  T('the capped org is laid out', nodes.length === VISIBLE_NODES, `${nodes.length} nodes`);
  T('every agent has a visible label', nodes.every(n => n.title && n.title !== 'undefined'),
    JSON.stringify(nodes.filter(n => !n.title).slice(0, 3)));

  // hierarchy: one edge per reporting line, not tier centroids
  T('one link per reporting line', links.length === VISIBLE_LINKS, `${links.length} links`);
  T('links are elbow-routed', links.every(l => l.elbow));
  // ceo->vp0, vp0->m0-0, m0-0->e0-0-0: every edge whose both ends are busy
  T('only the live delegation chain is lit', links.filter(l => l.live).length === 3,
    `${links.filter(l => l.live).length} live`);
  T('idle reporting lines are still drawn', links.filter(l => !l.live).length === VISIBLE_LINKS - 3,
    `${links.filter(l => !l.live).length} idle`);
  // A hidden agent must never leave a dangling edge behind it.
  const drawnIds = new Set(nodes.map(n => n.id));
  T('no edge points at a capped-out agent',
    links.every(l => drawnIds.has(l.source) && drawnIds.has(l.target)),
    JSON.stringify(links.filter(l => !drawnIds.has(l.source) || !drawnIds.has(l.target)).slice(0, 3)));
  // Rule 1 of the cap: a working agent is never hidden to respect a display limit.
  T('every active agent survives the cap',
    ['roster:vp0', 'roster:m0-0', 'roster:e0-0-0'].every(id => drawnIds.has(id)),
    [...drawnIds].filter(i => i.includes('0-0')).join(','));

  // children sit under their parent, not scattered across the tier
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  let maxDrift = 0;
  for (const l of links) {
    const kids = links.filter(k => k.source === l.source).map(k => byId[k.target].x);
    const centre = (Math.min(...kids) + Math.max(...kids)) / 2;
    maxDrift = Math.max(maxDrift, Math.abs(byId[l.source].x - centre));
  }
  T('every parent is centred over its own reports', maxDrift < 1.5, `max drift ${maxDrift.toFixed(2)}`);

  // no crossing links within the tree (a tidy tree has none)
  const spans = {};
  for (const l of links) {
    (spans[byId[l.source].orgTier] ||= []).push([byId[l.source].x, byId[l.target].x]);
  }
  T('the tree fits the target width', Math.max(...nodes.map(n => Math.abs(n.x))) <= 800,
    `half-width ${Math.max(...nodes.map(n => Math.abs(n.x))).toFixed(0)}`);
  T('slot spacing stays above the dot diameter', spacing >= 24, `spacing ${spacing.toFixed(1)}`);

  // --- per-subtree cost roll-up ---
  const byId2 = Object.fromEntries(nodes.map(n => [n.id, n]));
  // 30 employees x $0.10 = $3.00 total, 6 per VP
  T('CEO subtree cost is the whole fleet', Math.abs(byId2['ceo:dishi'].subtreeCost - 3.00) < 1e-6,
    `$${byId2['ceo:dishi'].subtreeCost}`);
  T('each VP rolls up only its own branch', Math.abs(byId2['roster:vp0'].subtreeCost - 0.60) < 1e-6,
    `$${byId2['roster:vp0'].subtreeCost}`);
  T('each manager rolls up its two reports', Math.abs(byId2['roster:m0-0'].subtreeCost - 0.20) < 1e-6,
    `$${byId2['roster:m0-0'].subtreeCost}`);
  T('a leaf subtree is just its own spend', Math.abs(byId2['roster:e0-0-0'].subtreeCost - 0.10) < 1e-6,
    `$${byId2['roster:e0-0-0'].subtreeCost}`);
  T('tokens roll up alongside cost', byId2['ceo:dishi'].subtreeTokens === 600000,
    `${byId2['ceo:dishi'].subtreeTokens} tokens`);
  T('a VP with no spend of its own still shows its branch',
    byId2['roster:vp0'].orgCost === 0 && byId2['roster:vp0'].subtreeCost > 0);
  // 30 employees x $0.10 = $3.00 even though only 10 are drawn. Rolling up the
  // visible nodes instead would report $1.00 and make the fleet's spend a
  // function of the viewport.
  T('cost rolls up the full roster, not the drawn subset',
    Math.abs(byId2['ceo:dishi'].subtreeCost - 3.00) < 1e-6 && nodes.filter(n => n.orgTier === 'employee').length === 10,
    `$${byId2['ceo:dishi'].subtreeCost} over ${nodes.filter(n => n.orgTier === 'employee').length} drawn`);
}

// --- lane cap: SEE ALL / SHOW LESS must survive its own press ---
// This control is painted onto a canvas, so there is no DOM node to click. The
// UI publishes its live hit rect for exactly this reason: the first version of
// this control shipped able to expand but never collapse, because a test that
// has to guess pixels does not get written.
const laneToggle = await page.evaluate(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const g = document.getElementById('graph');
  const dbg = () => window.__alfredDebug();
  const drawn = () => dbg().nodes.filter(n => n.orgTier === 'employee').length;
  const press = async () => {
    const r = dbg().lanes.employee.toggle;
    if (!r) return false;
    const o = { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, bubbles: true, cancelable: true, view: window };
    g.dispatchEvent(new MouseEvent('mousemove', o));
    g.dispatchEvent(new MouseEvent('click', o));
    await sleep(700);
    return true;
  };
  const out = { cap: dbg().cap, steps: [] };
  const snap = (tag) => { const L = dbg().lanes.employee; out.steps.push({ tag, drawn: drawn(), hidden: L.hidden, expanded: L.expanded, hasToggle: !!L.toggle }); };
  snap('start');
  out.pressed1 = await press(); snap('expanded');
  out.pressed2 = await press(); snap('collapsed');
  out.pressed3 = await press(); snap('re-expanded');
  // a lane under the cap must offer no toggle at all
  out.vpLane = dbg().lanes.vp;
  // Leave the chart collapsed: the spill assertions below measure the default
  // view, and an expanded lane legitimately runs wider than it.
  await press();
  out.restored = drawn();
  return out;
});
const S = laneToggle.steps;
T('a capped lane offers a toggle', S[0].hasToggle && S[0].hidden === 20, JSON.stringify(S[0]));
T('SEE ALL reveals the whole lane', laneToggle.pressed1 && S[1].drawn === 30 && S[1].expanded,
  JSON.stringify(S[1]));
T('the toggle still exists once expanded', S[1].hasToggle, JSON.stringify(S[1]));
T('SHOW LESS collapses it again', laneToggle.pressed2 && S[2].drawn === laneToggle.cap && !S[2].expanded,
  JSON.stringify(S[2]));
T('the toggle round-trips more than once', laneToggle.pressed3 && S[3].drawn === 30,
  JSON.stringify(S[3]));
T('a lane under the cap has no toggle', !laneToggle.vpLane.toggle && laneToggle.vpLane.total === 5,
  JSON.stringify(laneToggle.vpLane));

// on-screen: nothing may spill under the rail or off the right edge
const spill = await page.evaluate(() => {
  const g = window.__alfredDebug(); const out = { left: 0, right: 0, offscreen: 0 };
  g.screen.forEach(p => {
    if (p.x < 268 && p.y > 60 && p.y < 600) out.left++;      // behind the rail panel
    if (p.x > window.innerWidth - 90) out.right++;            // under the tier labels
    if (p.x < 0 || p.x > window.innerWidth) out.offscreen++;
  });
  return out;
});
T('no node hidden behind the left rail', spill.left === 0, JSON.stringify(spill));
T('no node collides with the right-edge tier labels', spill.right === 0, JSON.stringify(spill));
T('no node off-screen at default zoom', spill.offscreen === 0, JSON.stringify(spill));

// --- the status rail is chrome, not part of a view ---
// Every view writes itself into location.hash, so reloading or bookmarking the
// HUD anywhere other than the brain view deep-links straight into that view on
// the next boot. The rail's poll used to live only in POLLS.brain, so that boot
// left every row reading "--" forever while /api/status answered 200 the whole
// time. Load the deep link directly — going via the brain view hides the bug.
const deep = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await deep.goto(BASE + '/#ops', { waitUntil: 'domcontentloaded' });
await deep.waitForTimeout(900);
await deep.click('#landing');
await deep.waitForTimeout(4000);
const railText = await deep.evaluate(() =>
  [...document.querySelectorAll('#topleft .row, #topleft [class*=row]')].map(r => r.textContent.trim()).join(' | '));
T('the status rail fills when deep-linked past the brain view',
  /Notes\s*\d/.test(railText) && !/Notes\s*--/.test(railText), railText.slice(0, 160));
await deep.close();

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 180)));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));

await b.close();
