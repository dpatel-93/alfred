// Ad-hoc P4 verification: hover tooltip position, wheel-zoom centering,
// ResizeObserver refit on bench-collapse / flight-hide, flight-rail
// auto-hide on Brain, and screenshots at 3 widths. Not part of the
// committed suite — a one-off check run from the scratchpad, own port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');
const HERE = 'C:/dev/alfred/brain/test';
const R = [];
const chk = (n, c, d = '') => { R.push({ n, ok: !!c, d: String(d) }); console.log((c ? '  OK   ' : '  FAIL ') + n + (c ? '' : ' -> ' + d)); };

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-p4verify-'));
const PORT = 7798;
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

async function up() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE + '/api/status')).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await up())) {
  chk('server boots', false, serverLog.slice(-800));
} else {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const WIDTHS = [1024, 1440, 1920];
  for (const width of WIDTHS) {
    const tag = (n) => `[${width}px] ${n}`;
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await sleep(1500);

    // Brain is the default/initial view.
    const flightVisible = await page.evaluate(() => getComputedStyle(document.getElementById('flight')).display !== 'none');
    chk(tag('flight rail is hidden on the Brain place'), !flightVisible, `display check`);

    const canvasRect1 = await page.evaluate(() => document.getElementById('graph').getBoundingClientRect().toJSON());
    chk(tag('canvas fills the deck column width (no-flight reclaimed it)'), canvasRect1.width > width * 0.6, JSON.stringify(canvasRect1));

    // --- hover tooltip position ---
    const dbg = await page.evaluate(() => window.__alfredDebug());
    const canvasRect = await page.evaluate(() => document.getElementById('graph').getBoundingClientRect().toJSON());
    const local = dbg.screen[0];
    const pageX = canvasRect.x + local.x, pageY = canvasRect.y + local.y;
    await page.mouse.move(pageX, pageY);
    await sleep(200);
    const tt = await page.evaluate(() => {
      const t = document.getElementById('tooltip');
      return { display: t.style.display, left: parseFloat(t.style.left), top: parseFloat(t.style.top) };
    });
    const ttOffsetX = tt.left - 16 - pageX; // showTooltip adds +16/+12
    const ttOffsetY = tt.top - 12 - pageY;
    chk(tag('tooltip is visible on hover over a node'), tt.display === 'block', JSON.stringify(tt));
    chk(tag('tooltip is positioned at the real cursor position (not offset)'), Math.abs(ttOffsetX) < 2 && Math.abs(ttOffsetY) < 2,
      `tooltip=(${tt.left},${tt.top}) cursor=(${pageX.toFixed(1)},${pageY.toFixed(1)}) delta=(${ttOffsetX.toFixed(1)},${ttOffsetY.toFixed(1)})`);

    // --- wheel-zoom centers on cursor ---
    // No dedicated debug hook for screenToWorld; verify centering
    // behaviorally instead: the screen position of a fixed world point
    // under the cursor should not move when the zoom is centered there.
    await page.mouse.move(pageX, pageY);
    await page.mouse.wheel(0, -200); // zoom in, centered at (pageX,pageY)
    await sleep(150);
    const afterDbg = await page.evaluate(() => window.__alfredDebug());
    // The node originally at (pageX,pageY) in screen space should still be
    // very close to (local.x, local.y) after a zoom centered on it — that's
    // what "centers on cursor" means: the point under the cursor doesn't move.
    const afterLocal = afterDbg.screen[0];
    const driftX = afterLocal.x - local.x, driftY = afterLocal.y - local.y;
    chk(tag('wheel-zoom keeps the point under the cursor stationary (centers on cursor, not old fixed viewport center)'),
      Math.abs(driftX) < 3 && Math.abs(driftY) < 3,
      `before=(${local.x.toFixed(1)},${local.y.toFixed(1)}) after=(${afterLocal.x.toFixed(1)},${afterLocal.y.toFixed(1)}) drift=(${driftX.toFixed(2)},${driftY.toFixed(2)})`);

    // --- ResizeObserver: collapse the bench, graph re-fits ---
    const before2 = await page.evaluate(() => document.getElementById('graph').width);
    await page.evaluate(() => { document.body.classList.add('rail-collapsed'); });
    await sleep(400); // ResizeObserver callback + rAF
    const after2 = await page.evaluate(() => document.getElementById('graph').width);
    chk(tag('collapsing the bench changes the canvas pixel width (ResizeObserver fired, not window.resize)'),
      after2 !== before2, `before=${before2} after=${after2}`);
    await page.evaluate(() => { document.body.classList.remove('rail-collapsed'); });
    await sleep(400);

    // --- screenshot ---
    await page.screenshot({ path: path.join('C:/Users/Owner/AppData/Local/Temp/claude/C--Users-Owner/799a0310-95a7-45ac-99f2-72165ca2ebb2/scratchpad', `p4-brain-${width}.png`) });

    chk(tag('no uncaught JS errors'), errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
}

stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}
const failed = R.filter((r) => !r.ok).length;
console.log(`\n${R.length - failed}/${R.length} passed`);
process.exit(failed ? 1 : 0);
