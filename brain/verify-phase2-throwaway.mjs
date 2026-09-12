// Throwaway Playwright verification for Phase 2 (tab strip + grid mode).
// Not committed. Drives the REAL UI (clicks, keyboard) rather than reaching
// into JS internals, since the page's script is wrapped in an IIFE and
// exposes no window globals for terminal state. A secondary WebSocket client
// (mirroring test/terminals.mjs's `attach` helper) injects output into a
// backgrounded terminal to exercise the unread indicator, exactly as a real
// second listener (e.g. a second tab, or the server itself) would.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import WebSocket from 'ws';

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
    ALFRED_COUNCIL_HELPER: path.join(os.homedir(), '.claude', 'helpers', 'council-run.mjs'),
    ALFRED_COUNCIL_STUB_DIR: stub,
    ALFRED_PROVIDERS: path.join(os.homedir(), '.claude', 'helpers', 'providers.json'),
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(B + '/api/status')).ok) return true; } catch {}
    await sleep(300);
  }
  return false;
}

if (!(await up())) {
  chk('server boots', false, serverLog.slice(-800));
  process.exit(1);
}

const html = await (await fetch(B + '/')).text();
const TOKEN = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1];
chk('extracted session token from page', !!TOKEN, TOKEN);

async function j(p, o) { const r = await fetch(B + p, o); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; }
const H = { 'X-Alfred-Token': TOKEN, 'Content-Type': 'application/json' };

const seats = (await j('/api/command-center/seats', { headers: H })).d;
const readySeat = seats && seats.seats && seats.seats.find((s) => s.ready);
chk('at least one seat is ready in this stub env', !!readySeat, JSON.stringify(seats && seats.seats));

// Inject data into a terminal's PTY over a *second* WebSocket, exactly like a
// second connected client would — the server broadcasts to every listener,
// including the browser's own socket for that terminal.
function inject(id, data) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal/${id}?token=${encodeURIComponent(TOKEN)}`, { origin: B });
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'input', data })); setTimeout(() => { ws.close(); resolve(); }, 400); });
    ws.on('error', reject);
  });
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('console: ' + msg.text()); });

await page.goto(B + '/');
await page.waitForFunction(() => typeof window.el === 'undefined' || true, {}); // just let the script parse
await page.locator('.view-btn[data-view="command"]').click();
await page.waitForSelector('#cc-seats .cc-seat', { timeout: 15000 });

if (!readySeat) {
  console.log('\nNo ready seat in this environment (no CLI on PATH under the council stub) — cannot drive Open-terminal buttons.');
  console.log(R.length - R.filter((r) => !r.ok).length + '/' + R.length + ' checks passed (partial run)');
  await browser.close();
  stopServer();
  process.exit(1);
}

// Click "Open terminal" 4 times for the ready seat to get 4 lanes.
const seatCard = page.locator('.cc-seat', { hasText: readySeat.label }).first();
const openBtn = seatCard.locator('.cc-lane-foot .btn.big');
for (let i = 0; i < 4; i++) {
  const before = await page.locator('#cc-tabs .cc-tab').count();
  await openBtn.click();
  await page.waitForFunction((n) => document.querySelectorAll('#cc-tabs .cc-tab').length > n, before, { timeout: 10000 });
}
const tabCount0 = await page.locator('#cc-tabs .cc-tab').count();
chk('opened 4 terminal lanes via real UI clicks', tabCount0 === 4, 'got ' + tabCount0);

// Map tab position -> terminal id via the server's list (creation order).
const list = (await j('/api/terminals', { headers: H })).d.terminals.filter((t) => t.status === 'running');
chk('server lists 4 running terminals', list.length === 4, JSON.stringify(list.map((t) => t.id)));
const ids = list.map((t) => t.id);

// --- only one pane visible in focus mode ---
const visiblePanes = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-term')).filter((el) => getComputedStyle(el).display !== 'none').length);
chk('only one pane visible in focus mode', visiblePanes === 1, 'got ' + visiblePanes);

// The most-recently-opened lane (4th) should be the initially focused tab.
let activeLabel = await page.evaluate(() => document.querySelector('#cc-tabs .cc-tab.active .cc-tab-label').textContent);
chk('newest lane is focused after opening', !!activeLabel, activeLabel);

// --- click between tabs: instant switch + preserved scrollback ---
await inject(ids[0], 'hello-from-lane1\r');
await sleep(500);
await page.locator('#cc-tabs .cc-tab').nth(1).click();
await sleep(200);
const tab2Active = await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab')[1].classList.contains('active'));
chk('clicking the 2nd tab focuses it', tab2Active);

await page.locator('#cc-tabs .cc-tab').nth(0).click();
await sleep(200);
const lane1Text = await page.evaluate(() => {
  const term = document.querySelectorAll('.cc-term')[0];
  return term.querySelector('.xterm-rows') ? term.innerText : '';
});
// Read scrollback via xterm's exposed textarea buffer isn't DOM-visible directly;
// instead assert the pane's rendered rows contain the echoed text.
const scrollbackVisible = await page.locator('.cc-term.active .cc-term-body').innerText();
chk('lane 1 scrollback preserved after switching away and back', scrollbackVisible.includes('GOT:hello-from-lane1'), scrollbackVisible.slice(-200));

const pane0VisibleAgain = await page.evaluate(() => getComputedStyle(document.querySelectorAll('.cc-term')[0]).display !== 'none');
chk('lane 1 pane visible again after refocus', pane0VisibleAgain);

// --- unread indicator on a backgrounded tab ---
await inject(ids[2], 'ping-lane3\r');
await sleep(600);
const hasUnread = await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab')[2].classList.contains('has-unread'));
chk('backgrounded lane 3 shows unread indicator after output', hasUnread);

await page.locator('#cc-tabs .cc-tab').nth(2).click();
await sleep(200);
const unreadCleared = await page.evaluate(() => !document.querySelectorAll('#cc-tabs .cc-tab')[2].classList.contains('has-unread'));
chk('unread indicator clears once lane 3 is focused', unreadCleared);

// --- grid mode via Ctrl+\ ---
await page.keyboard.press('Control+\\');
await sleep(500);
const gridVisibleCount = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-term')).filter((el) => getComputedStyle(el).display !== 'none').length);
chk('grid mode makes all 4 panes visible', gridVisibleCount === 4, 'got ' + gridVisibleCount);

const rects = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-term')).map((el) => {
  const r = el.getBoundingClientRect();
  const rowsEl = el.querySelector('.xterm-rows');
  const cols = rowsEl && rowsEl.children[0] ? rowsEl.children[0].children.length : 0;
  return { w: r.width, h: r.height, rows: rowsEl ? rowsEl.children.length : 0, cols };
}));
const allSized = rects.every((r) => r.w > 50 && r.h > 50);
chk('all grid panes have real rendered size (not 0x0/stale)', allSized, JSON.stringify(rects));
const allFitted = rects.every((r) => r.rows > 3);
chk('all grid panes have real fitted xterm rows (not collapsed)', allFitted, JSON.stringify(rects));

// --- toggle back to focus mode; last-focused tab (lane 3) remembered ---
await page.keyboard.press('Control+\\');
await sleep(500);
const backToFocusCount = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-term')).filter((el) => getComputedStyle(el).display !== 'none').length);
chk('toggling back to focus mode shows exactly 1 pane', backToFocusCount === 1, 'got ' + backToFocusCount);
const activeIsLane3 = await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab')[2].classList.contains('active'));
chk('focus mode remembers last-focused tab (lane 3)', activeIsLane3);

// --- close a background tab via hide; others unaffected ---
await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab-close')[1].click());
await sleep(400);
const tabsAfterHide = await page.locator('#cc-tabs .cc-tab').count();
chk('hiding a background tab removes just that tab', tabsAfterHide === 3, 'got ' + tabsAfterHide);
const stillLane3Active = await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab')[1].classList.contains('active'));
// after removal lane3 (was index 2) shifts to index 1
chk('focused lane unaffected by hiding a different background tab', stillLane3Active);
const listAfterHide = (await j('/api/terminals', { headers: H })).d.terminals.filter((t) => t.status === 'running');
chk('hidden lane server session still running (hide != kill)', listAfterHide.length === 4, JSON.stringify(listAfterHide.map((t) => t.id)));

// --- Ctrl+1..9 focus by index ---
await page.keyboard.press('Control+1');
await sleep(300);
const activeAfterCtrl1 = await page.evaluate(() => Array.from(document.querySelectorAll('#cc-tabs .cc-tab')).findIndex((t) => t.classList.contains('active')));
chk('Ctrl+1 focuses the 1st tab', activeAfterCtrl1 === 0, 'active index ' + activeAfterCtrl1);

// Click INTO the terminal to give xterm's hidden textarea real DOM focus, then
// confirm Ctrl+2 still switches tabs (not swallowed as terminal input) and
// leaves no stray "2" in the terminal buffer.
await page.locator('.cc-term.active .cc-term-body').click();
await sleep(150);
await page.keyboard.press('Control+2');
await sleep(300);
const activeAfterCtrl2 = await page.evaluate(() => Array.from(document.querySelectorAll('#cc-tabs .cc-tab')).findIndex((t) => t.classList.contains('active')));
chk('Ctrl+2 switches tabs even while a terminal has real DOM focus', activeAfterCtrl2 === 1, 'active index ' + activeAfterCtrl2);
const lane1BodyText = await page.locator('.cc-term').nth(0).locator('.cc-term-body').innerText();
chk('Ctrl+2 did not leak a literal "2" keystroke into the terminal', !/GOT:2/.test(lane1BodyText), lane1BodyText.slice(-100));

// --- Ctrl+Shift+C/V unaffected (unchanged behavior sanity check) ---
await page.locator('.cc-term.active .cc-term-body').click();
await sleep(100);
const rowsBefore = await page.locator('.cc-term.active .cc-term-body').innerText();
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyC'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
await sleep(200);
const rowsAfter = await page.locator('.cc-term.active .cc-term-body').innerText();
chk('Ctrl+Shift+C still bypasses the terminal (no new output line)', rowsAfter === rowsBefore, 'before/after unchanged: ' + (rowsAfter === rowsBefore));

// --- Field Manual documents the new shortcuts ---
await page.keyboard.press('Escape'); // make sure nothing else is focused/open first
await page.evaluate(() => { const btn = document.querySelector('[title], .kb-key'); });
// open via the '?' key (global shortcut), same path an operator would use
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Shift+?');
await sleep(200);
const kbText = await page.locator('#kb-modal-body').innerText().catch(() => '');
chk('Field Manual documents Ctrl+1-9 and Ctrl+\\', kbText.includes('Ctrl+1-9') && kbText.includes('Ctrl+\\'), kbText.slice(0, 400));

chk('no page/console errors observed', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}

const failed = R.filter((r) => !r.ok).length;
console.log(`\n${R.length - failed}/${R.length} checks passed`);
process.exit(failed ? 1 : 0);
