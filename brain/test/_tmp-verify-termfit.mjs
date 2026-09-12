// TEMP verification script for the Phase-1 terminal-refit fix. Not part of the suite; deleted
// after use. Boots an isolated stub server (same pattern as test/terminals.mjs) so every seat is
// "ready" and every terminal runs a harmless echo stub, then drives the REAL browser UI (Playwright)
// through the actual Open/hide buttons to exercise ccMountTerminal's new ResizeObserver end to end.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-termfit-'));
const echoScript = 'process.stdout.write("READY\\n");process.stdin.resume();';
const PORT = 7779;
const B = `http://127.0.0.1:${PORT}`;

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
    try { if ((await fetch(B + '/api/status')).ok) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let exitCode = 1;
try {
  if (!(await up())) { console.log('FAIL - server did not boot:', serverLog.slice(-800)); throw new Error('boot'); }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log('  [pageerror]', err.message));

  await page.goto(B + '/', { waitUntil: 'networkidle' });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.click('.view-btn[data-view="command"]');
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.waitForTimeout(300);

  // Open 4 lanes via the real "Open terminal" button (same seat, opened repeatedly — each
  // click spawns a genuinely distinct terminal with its own id and its own .cc-term lane,
  // which is all the resize/refit test needs).
  const openBtnCount = await page.locator('#cc-seats .btn.big').count();
  console.log('seats with an Open button found:', openBtnCount);
  if (openBtnCount < 1) { console.log('FAIL - no ready seats to open a lane from'); throw new Error('seats'); }
  for (let i = 0; i < 4; i++) {
    await page.locator('#cc-seats .btn.big').first().click();
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(500);

  const countAfterOpen = await page.locator('.cc-term').count();
  console.log('.cc-term lanes mounted:', countAfterOpen);
  if (countAfterOpen < 3) { console.log('FAIL - fewer than 3 lanes actually mounted'); throw new Error('mount'); }

  const before = await page.locator('.cc-term').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  console.log('lane widths before closing one:', before.map((w) => w.toFixed(1)));

  // Close the second lane the same way a user does: its "hide" button. Force-click: the lane
  // strip scrolls horizontally past the viewport at this lane count, and the click point is
  // correct even though Playwright's actionability check sees the fixed .stage above it.
  const hideBtn = page.locator('.cc-term').nth(1).locator('button', { hasText: 'hide' });
  await hideBtn.scrollIntoViewIfNeeded();
  await hideBtn.click({ force: true });
  await page.waitForTimeout(600); // rAF-debounced ResizeObserver settle time

  const after = await page.locator('.cc-term').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  console.log('lane widths after closing one:', after.map((w) => w.toFixed(1)));

  const remainingBefore = before.filter((_, i) => i !== 1);
  const grew = after.every((w, i) => w > remainingBefore[i] + 5);
  console.log(grew ? 'PASS - remaining lanes widened after a lane closed (refit fired)' : 'FAIL - remaining lanes did NOT resize after a lane closed');

  await browser.close();
  exitCode = grew && countAfterOpen >= 3 ? 0 : 1;
} catch (e) {
  console.log('error:', e.message);
} finally {
  stopServer();
  try { fs.rmSync(stub, { recursive: true, force: true }); } catch { /* temp */ }
}
process.exit(exitCode);
