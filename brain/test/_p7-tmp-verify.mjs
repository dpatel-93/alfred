// P7 verification: sheets + navigation. Throwaway script, not part of the
// permanent suite. Boots its own server exactly like redesign.mjs, on a
// dedicated test port (never 7777).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');

const HERE = 'C:/dev/alfred/brain/test';
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const R = [];
const chk = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-p7-'));
const echoScript = 'process.stdout.write("ALFRED_TERM_OK\\n");'
  + 'process.stdin.setEncoding("utf8");'
  + 'process.stdin.on("data",function(d){process.stdout.write("GOT:"+d);});';

const PORT = Number(process.env.ALFRED_TERM_TEST_PORT || 7822);
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(HERE, 'fixtures', 'vault'),
    ALFRED_INDEX: path.join(stub, 'index.json'),
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
    ALFRED_COUNCIL_HELPER: HELPER,
    ALFRED_COUNCIL_STUB_DIR: stub,
    ALFRED_PROVIDERS: REGISTRY,
    ALFRED_TERM_STUB_CMD: JSON.stringify([process.execPath, '-e', echoScript]),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
function stopServer() {
  try { server.kill(); } catch { /* gone */ }
  if (process.platform === 'win32' && server.pid) {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); } catch { /* dead */ }
  }
}
process.on('exit', stopServer);

async function up() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE + '/api/status')).ok) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await up())) {
  chk('p7 test server boots', false, serverLog.slice(-800));
} else {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    try { localStorage.setItem('alfred-rail-collapsed', '0'); } catch (e) {}
    document.body.classList.remove('bench-tight', 'rail-collapsed');
  });

  const view = () => page.evaluate(() => location.hash.replace('#', '') || 'brain');

  // --- 1. each sheet opens via dock icon; Esc returns to prior state -------
  const DOCK = [
    { view: 'library', sheet: 'sheet-library', label: 'Library' },
    { view: 'directory', sheet: 'sheet-roster', label: 'Roster' },
    { view: 'auto', sheet: 'sheet-protocols', label: 'Protocols' },
    { view: 'ops', sheet: null, label: 'Enterprise' }, // fallback: full pane, not a sheet
    { view: 'dev', sheet: 'sheet-workshop', label: 'Workshop' },
  ];

  await page.click('[data-view="command"]');
  await page.waitForTimeout(300);
  for (const d of DOCK) {
    await page.click(`.dock-btn[data-view="${d.view}"]`);
    await page.waitForTimeout(300);
    const v = await view();
    chk(`dock icon opens ${d.label}`, v === d.view, `hash=${v}`);
    if (d.sheet) {
      const visible = await page.evaluate((id) => !document.getElementById(id).hidden, d.sheet);
      chk(`${d.label} sheet is unhidden`, visible);
      const scrimOpen = await page.evaluate(() => document.getElementById('sheet-scrim').classList.contains('open'));
      chk(`${d.label} sheet-scrim is open`, scrimOpen);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const back = await view();
    chk(`Esc closes ${d.label} back to Command`, back === 'command', `hash=${back}`);
    if (d.sheet) {
      const stillHidden = await page.evaluate((id) => document.getElementById(id).hidden, d.sheet);
      chk(`${d.label} sheet re-hidden after Esc`, stillHidden);
      const scrimClosed = await page.evaluate(() => !document.getElementById('sheet-scrim').classList.contains('open'));
      chk(`${d.label} sheet-scrim closed after Esc`, scrimClosed);
    }
  }

  // --- 2. hotkeys L R P E W, and 1/2 -----------------------------------------
  await page.click('[data-view="brain"]');
  await page.waitForTimeout(300);
  const HOTKEYS = [
    { key: 'l', view: 'library' }, { key: 'r', view: 'directory' }, { key: 'p', view: 'auto' },
    { key: 'e', view: 'ops' }, { key: 'w', view: 'dev' },
  ];
  for (const h of HOTKEYS) {
    await page.click('body');
    await page.keyboard.press(h.key);
    await page.waitForTimeout(250);
    const v = await view();
    chk(`hotkey '${h.key}' opens ${h.view}`, v === h.view, `hash=${v}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('2');
  await page.waitForTimeout(200);
  chk("hotkey '2' -> brain", (await view()) === 'brain', await view());
  await page.keyboard.press('1');
  await page.waitForTimeout(200);
  chk("hotkey '1' -> command", (await view()) === 'command', await view());

  // Guard: hotkeys must not fire while typing in the composer.
  await page.click('#search-input');
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  chk("'l' typed into composer does not open Library", (await view()) === 'command', await view());
  await page.keyboard.press('Escape'); // blur

  // --- 3. Ctrl+K palette: open, search, select ------------------------------
  await page.click('body');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(250);
  let paletteOpen = await page.evaluate(() => document.getElementById('palette').classList.contains('open'));
  chk('Ctrl+K opens the palette', paletteOpen);
  await page.fill('#palette-input', 'roster');
  await page.waitForTimeout(150);
  const paletteCount = await page.locator('#palette-results .palette-item').count();
  chk('palette fuzzy-search finds Roster', paletteCount >= 1, `count=${paletteCount}`);
  await page.locator('#palette-results .palette-item').first().click();
  await page.waitForTimeout(300);
  chk('selecting a palette item opens the Roster sheet', (await view()) === 'directory', await view());
  paletteOpen = await page.evaluate(() => document.getElementById('palette').classList.contains('open'));
  chk('palette closes after selection', !paletteOpen);

  // Esc ladder: palette closes before the sheet underneath.
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  paletteOpen = await page.evaluate(() => document.getElementById('palette').classList.contains('open'));
  chk('Esc closes the palette first (sheet still open behind it)', !paletteOpen && (await view()) === 'directory', `paletteOpen=${paletteOpen} view=${await view()}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  chk('second Esc then closes the sheet', (await view()) === 'command', await view());

  // --- 4. Roster/Library master-detail scroll independently at 1024px ------
  await page.click('.dock-btn[data-view="directory"]');
  await page.waitForTimeout(600);
  const rosterScroll = await page.evaluate(() => {
    var list = document.getElementById('directory-list');
    var prev = document.getElementById('directory-preview');
    return { listScrollable: list.scrollHeight > list.clientHeight, listCls: list.className, prevCls: prev.className };
  });
  chk('Roster .mdlist is scrollable (enough rows) at 1024px', rosterScroll.listScrollable, JSON.stringify(rosterScroll));
  chk('Roster list uses renamed .mdlist class', rosterScroll.listCls.indexOf('mdlist') !== -1, rosterScroll.listCls);
  chk('Roster preview uses renamed .mdprev class', rosterScroll.prevCls.indexOf('mdprev') !== -1, rosterScroll.prevCls);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.click('.dock-btn[data-view="library"]');
  await page.waitForTimeout(600);
  const libClasses = await page.evaluate(() => ({
    listCls: document.getElementById('library-list').className,
    prevCls: document.getElementById('library-preview').className,
  }));
  chk('Library list uses renamed .mdlist class', libClasses.listCls.indexOf('mdlist') !== -1, JSON.stringify(libClasses));
  chk('Library preview uses renamed .mdprev class', libClasses.prevCls.indexOf('mdprev') !== -1, JSON.stringify(libClasses));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- 5. Protocols pyramid renders ------------------------------------------
  await page.click('.dock-btn[data-view="auto"]');
  await page.waitForTimeout(800);
  const pyramidBands = await page.locator('#sheet-protocols .pyr-band').count();
  chk('Protocols pyramid renders bands', pyramidBands > 0, `bands=${pyramidBands}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- 6. src-modal opens from inside a sheet; nested z-order + Esc order --
  await page.click('.dock-btn[data-view="dev"]');
  await page.waitForTimeout(600);
  // Workshop's cards open the source editor via openSourceEditor(id) on click;
  // fall back to calling it directly if no clickable row rendered in the fixture.
  const opened = await page.evaluate(() => {
    var btn = document.querySelector('#dev-grid [data-open-src], #dev-grid .card, #dev-grid button');
    if (btn) { btn.click(); return 'clicked'; }
    if (typeof openSourceEditor === 'function') { openSourceEditor('CLAUDE.md'); return 'direct'; }
    return 'none';
  });
  await page.waitForTimeout(400);
  let srcOpen = await page.evaluate(() => document.getElementById('src-modal').classList.contains('open'));
  if (!srcOpen) {
    // Card click may not map to a real openable source in the fixture vault —
    // force it directly to still exercise the z-order/Esc-ladder contract.
    await page.evaluate(() => { if (typeof openSourceEditor === 'function') openSourceEditor('CLAUDE.md'); });
    await page.waitForTimeout(400);
    srcOpen = await page.evaluate(() => document.getElementById('src-modal').classList.contains('open'));
  }
  chk('src-modal opens from inside a sheet', srcOpen, `openedVia=${opened}`);
  const zOrder = await page.evaluate(() => {
    var modalZ = getComputedStyle(document.getElementById('src-modal')).zIndex;
    var sheetZ = getComputedStyle(document.getElementById('sheet-workshop')).zIndex;
    return { modalZ: Number(modalZ), sheetZ: Number(sheetZ) };
  });
  chk('src-modal z-index is above the sheet', zOrder.modalZ > zOrder.sheetZ, JSON.stringify(zOrder));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterFirstEsc = await page.evaluate(() => ({
    srcOpen: document.getElementById('src-modal').classList.contains('open'),
    sheetHidden: document.getElementById('sheet-workshop').hidden,
  }));
  chk('first Esc closes src-modal, sheet still open', !afterFirstEsc.srcOpen && !afterFirstEsc.sheetHidden, JSON.stringify(afterFirstEsc));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterSecondEsc = await page.evaluate(() => document.getElementById('sheet-workshop').hidden);
  chk('second Esc closes the sheet', afterSecondEsc);

  // --- 7. Enterprise draws the org chart (fallback pane, not a sheet) ------
  await page.evaluate(() => { location.hash = 'ops'; });
  await page.waitForTimeout(2000);
  const orgDbg = await page.evaluate(() => (window.__alfredDebug ? window.__alfredDebug() : null));
  chk('Enterprise (ops) draws nodes on the shared canvas', !!(orgDbg && orgDbg.nodes && orgDbg.nodes.length > 0), orgDbg ? orgDbg.nodes.length : 'no debug hook');
  const opsCanvasBody = await page.evaluate(() => document.body.classList.contains('ops-canvas'));
  chk('body.ops-canvas set while Enterprise is open', opsCanvasBody);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  chk('Esc from Enterprise returns to lastPlace', (await view()) === 'brain', await view());

  // --- 8. Ctrl+1-9 / Ctrl+\ still work while a terminal has focus ----------
  await page.click('[data-view="command"]');
  await page.waitForTimeout(300);
  const seatMoreBtns = page.locator('#cc-seats .seat-more');
  const seatRowCount = await seatMoreBtns.count();
  let openedForTerm = 0;
  for (let i = 0; i < seatRowCount && openedForTerm < 1; i++) {
    await seatMoreBtns.nth(i).click();
    const openBtn = page.locator('#seat-popover button:has-text("Open terminal")');
    if (await openBtn.count()) { await openBtn.first().click(); openedForTerm++; }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1000);
  chk('a console opened to test Ctrl+\\ against', openedForTerm >= 1, `opened=${openedForTerm}`);
  if (openedForTerm >= 1) {
    // Click into the terminal so xterm's hidden textarea holds focus, exactly
    // the scenario ccHandleGlobalShortcut's own comment calls out.
    await page.click('#cc-terms .cc-term');
    await page.waitForTimeout(200);
    const gridBefore = await page.evaluate(() => document.getElementById('cc-terms').classList.contains('cc-grid'));
    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(400);
    const gridAfter = await page.evaluate(() => document.getElementById('cc-terms').classList.contains('cc-grid'));
    chk('real Ctrl+\\ toggles grid mode while a terminal has focus', gridBefore !== gridAfter, `before=${gridBefore} after=${gridAfter}`);
    // And the new plain \ (no ctrl) must NOT also fire while focus is in the
    // terminal and ctrl is down — already proven above by the single toggle;
    // additionally confirm plain \ (flight rail) does its own thing outside
    // the terminal without disturbing grid mode.
    await page.click('body');
    const flightBefore = await page.evaluate(() => document.body.classList.contains('flight-collapsed'));
    await page.keyboard.press('\\');
    await page.waitForTimeout(200);
    const flightAfter = await page.evaluate(() => document.body.classList.contains('flight-collapsed'));
    chk('plain \\ toggles the flight rail (not grid mode)', flightBefore !== flightAfter, `before=${flightBefore} after=${flightAfter}`);
    const gridStillSame = await page.evaluate(() => document.getElementById('cc-terms').classList.contains('cc-grid'));
    chk('plain \\ did not also toggle grid mode', gridStillSame === gridAfter, `gridAfter=${gridAfter} gridStillSame=${gridStillSame}`);
  }

  chk('no uncaught JS errors across the whole run', errs.length === 0, errs.slice(0, 5).join(' | '));

  await ctx.close();
  await browser.close();
}

stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch { /* temp */ }

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 300)));
const failed = R.filter((r) => !r.ok).length;
console.log(`\n${R.length - failed} passed, ${failed} failed`);
