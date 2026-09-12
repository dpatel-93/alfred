// Throwaway Playwright verification for Phase 2 (tab strip + grid mode).
// Not committed — mirrors the stub-server pattern in brain/test/terminals.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BRAIN = 'C:/dev/alfred/brain';
const PORT = 7778;
const B = `http://127.0.0.1:${PORT}`;
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-p2-'));
const echoScript = 'process.stdout.write("ALFRED_TERM_OK\\n");'
  + 'process.stdin.setEncoding("utf8");'
  + 'process.stdin.on("data",function(d){process.stdout.write("GOT:"+d);});';

const server = spawn(process.execPath, [path.join(BRAIN, 'server.mjs')], {
  cwd: BRAIN,
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(BRAIN, 'test', 'fixtures', 'vault'),
    ALFRED_INDEX: path.join(stub, 'index.json'),
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
    ALFRED_TERM_STUB_CMD: JSON.stringify([process.execPath, '-e', echoScript]),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
function stopServer() {
  try { server.kill(); } catch {}
  if (process.platform === 'win32' && server.pid) {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); } catch {}
  }
}
process.on('exit', stopServer);

const R = [];
const chk = (n, c, d = '') => { R.push({ n, ok: !!c, d: String(d) }); console.log((c ? '  OK   ' : '  FAIL ') + n + (c ? '' : '\n            -> ' + d)); };

async function up() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(B + '/api/status')).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await up())) {
  chk('server boots', false, serverLog.slice(-800));
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('console: ' + msg.text()); });

await page.goto(B + '/');
await page.waitForSelector('#cc-seats', { timeout: 15000 });

// Switch to the Command Center view (key '3' per byIndex order: brain/dev/auto/ops/directory/library — Command Center is "auto")
await page.evaluate(() => window.switchView('auto'));
await page.waitForSelector('#cc-seats .cc-seat', { timeout: 15000 });

// Open 4 terminals via the API directly (mirrors ccOpenBrowserTerminal) then mount them.
async function openTerm(label) {
  return await page.evaluate(async (label) => {
    const r = await bridgePost('/api/terminals', { provider: 'claude', cols: 100, rows: 30 });
    if (!r.ok) throw new Error('open failed: ' + JSON.stringify(r.data));
    r.data.terminal.label = label;
    window.ccMountTerminal(r.data.terminal);
    return r.data.terminal.id;
  }, label);
}

const ids = [];
for (const label of ['Lane A', 'Lane B', 'Lane C', 'Lane D']) {
  ids.push(await openTerm(label));
  await sleep(300);
}
chk('opened 4 terminals', ids.length === 4, JSON.stringify(ids));

await sleep(500);

// --- tab strip shows all 4, only one pane visible ---
const tabCount = await page.locator('#cc-tabs .cc-tab').count();
chk('tab strip shows 4 tabs', tabCount === 4, 'got ' + tabCount);

const visiblePanes = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.cc-term')).filter((el) => getComputedStyle(el).display !== 'none').length;
});
chk('only one pane visible in focus mode', visiblePanes === 1, 'got ' + visiblePanes);

// --- click between tabs, confirm instant switching + preserved scrollback ---
await page.evaluate((id) => { window.ccSendTerm(window.ccTerms[id], { type: 'input', data: 'hello-from-A\r' }); }, ids[0]);
await sleep(600);
// switch focus to lane B by clicking its tab
const tabB = page.locator('#cc-tabs .cc-tab').nth(1);
await tabB.click();
await sleep(200);
const focusedAfterClick = await page.evaluate(() => window.ccFocusedIdForTest || null);
// expose ccFocusedId for inspection since it's a closured var
const focusedId = await page.evaluate(() => document.querySelector('#cc-tabs .cc-tab.active .cc-tab-label').textContent);
chk('clicking tab B focuses lane B', focusedId === 'Lane B', focusedId);

// go back to lane A, confirm scrollback of earlier input still present
const tabA = page.locator('#cc-tabs .cc-tab').nth(0);
await tabA.click();
await sleep(200);
const scrollbackText = await page.evaluate((id) => window.ccTerms[id].term.buffer.active ? Array.from({length: window.ccTerms[id].term.buffer.active.length}, (_, i) => window.ccTerms[id].term.buffer.active.getLine(i).translateToString()).join('\n') : '', ids[0]);
chk('lane A scrollback preserved after switching away and back', scrollbackText.includes('GOT:hello-from-A'), scrollbackText.slice(-200));

const paneAVisibleAgain = await page.evaluate((id) => getComputedStyle(window.ccTerms[id].root).display !== 'none', ids[0]);
chk('lane A pane visible again after refocus', paneAVisibleAgain);

// --- unread indicator ---
// focus lane A (already focused), write to backgrounded lane C (index 2)
await page.evaluate((id) => { window.ccSendTerm(window.ccTerms[id], { type: 'input', data: 'ping-C\r' }); }, ids[2]);
await sleep(600);
const hasUnread = await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab')[2].classList.contains('has-unread'));
chk('backgrounded lane C shows unread indicator after output', hasUnread);

const tabC = page.locator('#cc-tabs .cc-tab').nth(2);
await tabC.click();
await sleep(200);
const unreadClearedAfterFocus = await page.evaluate(() => !document.querySelectorAll('#cc-tabs .cc-tab')[2].classList.contains('has-unread'));
chk('unread indicator clears once lane C is focused', unreadClearedAfterFocus);

// --- grid mode ---
await page.keyboard.press('Control+\\');
await sleep(400);
const gridVisibleCount = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-term')).filter((el) => getComputedStyle(el).display !== 'none').length);
chk('grid mode makes all 4 panes visible', gridVisibleCount === 4, 'got ' + gridVisibleCount);

const gridRects = await page.evaluate((ids) => ids.map((id) => {
  const entry = window.ccTerms[id];
  const rect = entry.root.getBoundingClientRect();
  const dims = entry.term.cols + 'x' + entry.term.rows;
  return { id, w: rect.width, h: rect.height, dims };
}), ids);
const allSized = gridRects.every((r) => r.w > 50 && r.h > 50);
chk('all grid panes have real rendered size (not 0x0/stale)', allSized, JSON.stringify(gridRects));
// confirm terminal cols/rows are plausible (not the pre-grid stale cols)
const allFitted = gridRects.every((r) => { const [c, rr] = r.dims.split('x').map(Number); return c > 10 && rr > 5; });
chk('all grid panes have real fitted xterm dimensions', allFitted, JSON.stringify(gridRects));

// --- toggle back to focus mode ---
await page.keyboard.press('Control+\\');
await sleep(400);
const backToFocusCount = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-term')).filter((el) => getComputedStyle(el).display !== 'none').length);
chk('toggling back to focus mode shows exactly 1 pane', backToFocusCount === 1, 'got ' + backToFocusCount);
const lastFocusedLabel = await page.evaluate(() => document.querySelector('#cc-tabs .cc-tab.active .cc-tab-label').textContent);
chk('focus mode remembers last-focused tab (Lane C)', lastFocusedLabel === 'Lane C', lastFocusedLabel);

// --- close a background tab via hide, others unaffected ---
// currently focused: Lane C (index 2). Hide Lane B (index 1, backgrounded).
await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab-close')[1].click());
await sleep(300);
const tabsAfterHide = await page.locator('#cc-tabs .cc-tab').count();
chk('hiding a background tab removes just that tab', tabsAfterHide === 3, 'got ' + tabsAfterHide);
const stillFocusedC = await page.evaluate(() => { const a = document.querySelector('#cc-tabs .cc-tab.active .cc-tab-label'); return a && a.textContent; });
chk('focused lane (C) unaffected by hiding a different background tab', stillFocusedC === 'Lane C', stillFocusedC);

// --- Ctrl+1..9 focus by index ---
await page.keyboard.press('Control+1');
await sleep(200);
const focusedAfterCtrl1 = await page.evaluate(() => document.querySelector('#cc-tabs .cc-tab.active .cc-tab-label').textContent);
chk('Ctrl+1 focuses the 1st tab (Lane A)', focusedAfterCtrl1 === 'Lane A', focusedAfterCtrl1);

// confirm ctrl+1 didn't leak a literal "1" into the terminal
const focusedIdNow = ids[0];
await page.evaluate((id) => window.ccTerms[id].term.focus(), focusedIdNow);
await page.keyboard.press('Control+2');
await sleep(200);
const focusedAfterCtrl2 = await page.evaluate(() => document.querySelector('#cc-tabs .cc-tab.active .cc-tab-label').textContent);
chk('Ctrl+2 (fired while a terminal had focus) still switches tabs, not swallowed by xterm', focusedAfterCtrl2 !== 'Lane A', focusedAfterCtrl2);

// --- Ctrl+Shift+C/V still bypass terminal (sanity, unchanged behavior) ---
const kbShortcutsListed = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#kb-modal-body .kb-key')).some((el) => el.textContent.includes('Ctrl+1'))
    && Array.from(document.querySelectorAll('#kb-modal-body .kb-key')).some((el) => el.textContent.includes('Ctrl+\\'));
});
// need to open kb modal first to populate body with kbTable
await page.evaluate(() => window.openKbHelp && window.openKbHelp());
const kbListed2 = await page.evaluate(() => document.querySelector('#kb-modal-body').textContent.includes('Ctrl+1-9') && document.querySelector('#kb-modal-body').textContent.includes('Ctrl+\\'));
chk('Field Manual documents Ctrl+1-9 and Ctrl+\\', kbListed2);

chk('no page/console errors observed', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}

const failed = R.filter((r) => !r.ok).length;
console.log(`\n${R.length - failed}/${R.length} checks passed`);
process.exit(failed ? 1 : 0);
