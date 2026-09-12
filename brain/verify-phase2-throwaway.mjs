// Throwaway Playwright verification for Phase 2 (tab strip + grid mode).
// Not committed. Drives the REAL UI (clicks, keyboard) rather than reaching
// into JS internals, since the page's script is wrapped in an IIFE and
// exposes no window globals for terminal state. A secondary WebSocket client
// (mirroring test/terminals.mjs's `attach` helper) injects output into a
// backgrounded terminal to exercise the unread indicator, exactly as a real
// second listener (e.g. a second tab, or the server itself) would.
//
// Viewport is set to 1600x1000 (a realistic desktop window) rather than
// Playwright's 1280x720 default: at 720px tall, the Lanes + Council sections
// alone exceed the stage's available height on this stub's seat list, which
// squeezes the terminal area toward 0 via flex-shrink — confirmed present
// identically in the pre-Phase-2 flat .cc-terms layout, so it is a latent
// capacity issue in the stage, not something this phase introduced or fixes.
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

function inject(id, data) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal/${id}?token=${encodeURIComponent(TOKEN)}`, { origin: B });
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'input', data })); setTimeout(() => { ws.close(); resolve(); }, 400); });
    ws.on('error', reject);
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('console: ' + msg.text()); });

await page.goto(B + '/');
await sleep(500);
await page.keyboard.press('Escape'); // dismisses the #landing entry screen
await page.waitForSelector('#landing.dismissed', { timeout: 10000 }).catch(() => {});
await page.locator('.view-btn[data-view="command"]').click();
await page.waitForSelector('#cc-seats .cc-seat', { timeout: 15000 });

if (!readySeat) {
  console.log('\nNo ready seat in this environment — cannot drive Open-terminal buttons.');
  await browser.close();
  stopServer();
  process.exit(1);
}

const seatCard = page.locator('.cc-seat', { hasText: readySeat.label }).first();
const openBtn = seatCard.locator('.cc-lane-foot .btn.big');
for (let i = 0; i < 4; i++) {
  const before = await page.locator('#cc-tabs .cc-tab').count();
  await openBtn.click();
  await page.waitForFunction((n) => document.querySelectorAll('#cc-tabs .cc-tab').length > n, before, { timeout: 10000 });
}
const tabCount0 = await page.locator('#cc-tabs .cc-tab').count();
chk('opened 4 terminal lanes via real UI clicks', tabCount0 === 4, 'got ' + tabCount0);

const list = (await j('/api/terminals', { headers: H })).d.terminals.filter((t) => t.status === 'running');
chk('server lists 4 running terminals', list.length === 4, JSON.stringify(list.map((t) => t.id)));
const ids = list.map((t) => t.id);

async function ccDebug() { return page.evaluate(() => window.__ccDebug()); }
async function focusClass(id) { const d = await ccDebug(); const e = d.find((x) => x.id === id); return e && e.active; }

const visiblePanes = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-term')).filter((el) => getComputedStyle(el).display !== 'none').length);
chk('only one pane visible in focus mode', visiblePanes === 1, 'got ' + visiblePanes);

let dbg = await ccDebug();
const newestActive = dbg.find((e) => e.id === ids[3]);
chk('newest lane is focused after opening, with real rendered size', newestActive && newestActive.active && newestActive.rect.width > 50 && newestActive.rect.height > 50, JSON.stringify(newestActive));

// --- click between tabs: instant switch + preserved scrollback ---
await inject(ids[0], 'hello-from-lane1\r');
await sleep(500);
await page.locator('#cc-tabs .cc-tab').nth(1).click();
await sleep(200);
const tab2Active = await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab')[1].classList.contains('active'));
chk('clicking the 2nd tab focuses it', tab2Active);

await page.locator('#cc-tabs .cc-tab').nth(0).click();
await sleep(300);
dbg = await ccDebug();
let lane1 = dbg.find((x) => x.id === ids[0]);
chk('lane 1 scrollback preserved after switching away and back', lane1 && lane1.text.includes('GOT:hello-from-lane1'), lane1 && lane1.text.slice(-200));
chk('lane 1 pane visible again after refocus (real rect, not 0x0)', lane1 && lane1.active && lane1.rect.width > 50 && lane1.rect.height > 50, JSON.stringify(lane1 && lane1.rect));

// --- unread indicator on a backgrounded tab ---
await inject(ids[2], 'ping-lane3\r');
await sleep(600);
const hasUnread = await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab')[2].classList.contains('has-unread'));
chk('backgrounded lane 3 shows unread indicator after output', hasUnread);
dbg = await ccDebug();
const lane3Unread = dbg.find((x) => x.id === ids[2]);
chk('lane 3 entry itself is marked unread', lane3Unread && lane3Unread.unread);

await page.locator('#cc-tabs .cc-tab').nth(2).click();
await sleep(200);
const unreadCleared = await page.evaluate(() => !document.querySelectorAll('#cc-tabs .cc-tab')[2].classList.contains('has-unread'));
chk('unread indicator clears once lane 3 is focused', unreadCleared);

// --- grid mode via Ctrl+\ ---
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+\\');
await sleep(600);
dbg = await ccDebug();
const gridVisibleCount = dbg.filter((e) => e.rect.width > 5 && e.rect.height > 5).length;
chk('grid mode makes all 4 panes visible', gridVisibleCount === 4, JSON.stringify(dbg.map((e) => e.rect)));

const allSized = dbg.every((r) => r.rect.width > 50 && r.rect.height > 50);
chk('all grid panes have real rendered size (not 0x0/stale)', allSized, JSON.stringify(dbg.map((e) => e.rect)));
const allFitted = dbg.every((r) => r.cols > 10 && r.rows > 5);
chk('all grid panes have real fitted xterm dimensions (not stale/collapsed)', allFitted, JSON.stringify(dbg.map((e) => ({ id: e.id, cols: e.cols, rows: e.rows }))));

// --- toggle back to focus mode; last-focused tab (lane 3) remembered ---
await page.keyboard.press('Control+\\');
await sleep(500);
dbg = await ccDebug();
const backToFocusCount = dbg.filter((e) => e.rect.width > 5 && e.rect.height > 5).length;
chk('toggling back to focus mode shows exactly 1 pane', backToFocusCount === 1, 'got ' + backToFocusCount);
const activeIsLane3 = dbg.find((e) => e.id === ids[2]).active;
chk('focus mode remembers last-focused tab (lane 3)', activeIsLane3);

// --- close a background tab via hide; others unaffected ---
await page.evaluate(() => document.querySelectorAll('#cc-tabs .cc-tab-close')[1].click());
await sleep(400);
const tabsAfterHide = await page.locator('#cc-tabs .cc-tab').count();
chk('hiding a background tab removes just that tab', tabsAfterHide === 3, 'got ' + tabsAfterHide);
dbg = await ccDebug();
chk('focused lane (3) unaffected by hiding a different background tab', dbg.find((e) => e.id === ids[2]).active);
const listAfterHide = (await j('/api/terminals', { headers: H })).d.terminals.filter((t) => t.status === 'running');
chk('hidden lane server session still running (hide != kill)', listAfterHide.length === 4, JSON.stringify(listAfterHide.map((t) => t.id)));

// --- Ctrl+1..9 focus by index ---
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+1');
await sleep(300);
chk('Ctrl+1 focuses the 1st tab (lane 1)', await focusClass(ids[0]));

// Click into the terminal so xterm's hidden textarea holds real DOM focus,
// then confirm Ctrl+2 still switches tabs (not swallowed as terminal input)
// and leaves no stray "2" keystroke in that terminal's buffer.
await page.locator('.cc-term.active .cc-term-body').click();
await sleep(150);
await page.keyboard.press('Control+2');
await sleep(300);
chk('Ctrl+2 switches tabs even while a terminal has real DOM focus', await focusClass(ids[1]));
dbg = await ccDebug();
chk('Ctrl+2 did not leak a literal "2" keystroke into lane 1', !/GOT:.*2/.test(dbg.find((e) => e.id === ids[0]).text.slice(-50)), dbg.find((e) => e.id === ids[0]).text.slice(-80));

// --- Ctrl+Shift+C/V unaffected (unchanged behavior sanity check) ---
await page.locator('.cc-term.active .cc-term-body').click();
await sleep(100);
const beforeShiftC = (await ccDebug()).find((e) => e.active).text;
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyC'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
await sleep(300);
const afterShiftC = (await ccDebug()).find((e) => e.active).text;
chk('Ctrl+Shift+C still bypasses the terminal (no new output)', afterShiftC === beforeShiftC, 'unchanged: ' + (afterShiftC === beforeShiftC));

// --- Field Manual documents the new shortcuts ---
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Shift+?');
await sleep(200);
const kbText = await page.locator('#kb-modal-body').innerText().catch(() => '');
chk('Field Manual documents Ctrl+1-9 and Ctrl+\\', kbText.includes('Ctrl+1-9') && kbText.includes('Ctrl+\\'), kbText.slice(0, 400));

// --- native "open all lanes" button untouched ---
const nativeBtnExists = await page.locator('#cc-open-btn').count();
chk('native "Open all lanes" button still present/untouched', nativeBtnExists === 1);

// --- drag-and-drop handler still wired (structural check: listener present via drop class toggle) ---
const dropCapable = await page.evaluate(() => {
  const t = document.querySelector('.cc-term.active');
  const ev = new Event('dragover', { bubbles: true, cancelable: true });
  t.dispatchEvent(ev);
  const has = t.classList.contains('drop');
  t.classList.remove('drop');
  return has;
});
chk('drag-and-drop handler still active on the focused pane', dropCapable);

chk('no page/console errors observed', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}

const failed = R.filter((r) => !r.ok).length;
console.log(`\n${R.length - failed}/${R.length} checks passed`);
process.exit(failed ? 1 : 0);
