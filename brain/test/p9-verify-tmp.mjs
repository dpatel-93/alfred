// P9 verification: reduced-motion assertions, responsive sweep + screenshots,
// zero-pageerror exercise of every surface. Throwaway — not part of the suite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'C:/dev/alfred';
const HELPER = 'C:/Users/Owner/.claude/helpers/council-run.mjs';
const REGISTRY = 'C:/Users/Owner/.claude/helpers/providers.json';
const R = [];
const chk = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-p9-'));
const PORT = 7796;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(REPO, 'brain', 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(REPO, 'brain', 'test', 'fixtures', 'vault'),
    ALFRED_INDEX: path.join(stub, 'index.json'),
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
    ALFRED_COUNCIL_HELPER: HELPER,
    ALFRED_COUNCIL_STUB_DIR: stub,
    ALFRED_PROVIDERS: REGISTRY,
    ALFRED_TERM_STUB_CMD: JSON.stringify([process.execPath, '-e', 'process.stdout.write("OK\\n");']),
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
  chk('p9 test server boots', false, serverLog.slice(-800));
} else {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---------------------------------------------------------------
  // Part A: prefers-reduced-motion assertions, injected elements so no
  // app-state dependency is needed to exercise every targeted rule.
  // ---------------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.click('#landing').catch(() => {});
    await sleep(300);

    const result = await page.evaluate(() => {
      function mk(tag, cls) { var e = document.createElement(tag); e.className = cls; document.body.appendChild(e); return e; }
      var out = {};

      var aura = document.getElementById('aura');
      out.aura = aura ? getComputedStyle(aura).animationName : 'MISSING';

      var body = document.body;
      out.bodyTransitionDuration = getComputedStyle(body).transitionDuration;

      var skel = mk('div', 'skeleton');
      out.skeleton = getComputedStyle(skel, '::before').animationName;
      skel.remove();

      var prog = mk('div', 'cc-progress');
      var bar = document.createElement('i');
      prog.appendChild(bar);
      document.body.appendChild(prog);
      out.ccSweep = getComputedStyle(bar).animationName;
      prog.remove();

      var card = mk('div', 'card is-live');
      out.spineBreathe = getComputedStyle(card, '::before').animationName;
      out.spineOpacity = getComputedStyle(card, '::before').opacity;
      card.remove();

      var icon = mk('button', 'icon-btn spinning');
      out.iconSpin = getComputedStyle(icon).animationName;
      icon.remove();

      return out;
    });
    chk('reduced-motion: #aura animation suppressed', result.aura === 'none', result.aura);
    chk('reduced-motion: body --focus transition collapsed to ~0', parseFloat(result.bodyTransitionDuration) <= 0.001, result.bodyTransitionDuration);
    chk('reduced-motion: .skeleton::before shimmer suppressed', result.skeleton === 'none', result.skeleton);
    chk('reduced-motion: .cc-progress > i sweep suppressed', result.ccSweep === 'none', result.ccSweep);
    chk('reduced-motion: .card.is-live::before spine-breathe suppressed', result.spineBreathe === 'none', result.spineBreathe);
    chk('reduced-motion: spine stays visible (opacity 1, not animating toward .7)', result.spineOpacity === '1', result.spineOpacity);
    chk('reduced-motion: .icon-btn.spinning rotation suppressed', result.iconSpin === 'none', result.iconSpin);

    await ctx.close();
  }

  // Control group: WITHOUT reduced motion, the same rules should still animate.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.click('#landing').catch(() => {});
    await sleep(300);
    const auraAnim = await page.evaluate(() => getComputedStyle(document.getElementById('aura')).animationName);
    const bodyDur = await page.evaluate(() => getComputedStyle(document.body).transitionDuration);
    chk('control (no reduced-motion): #aura still animates', auraAnim === 'aurabreathe', auraAnim);
    chk('control (no reduced-motion): body --focus transition is 420ms', parseFloat(bodyDur) > 0.1, bodyDur);
    await ctx.close();
  }

  // ---------------------------------------------------------------
  // Part B: responsive sweep + screenshots + zero pageerror exercise
  // ---------------------------------------------------------------
  const WIDTHS = [1024, 1280, 1440, 1680, 1920];
  const SHOT_DIR = HERE;
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
    await page.route('**/api/interns/catalog*', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ results: ['qwen3.5:9b'], tags: [] }),
    }));

    try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.click('#landing').catch(() => {});
    await sleep(1000);
    // Force the full Bench open even below the 1180px auto-narrow threshold
    // (plan §3.3) so the grid-mode/seat-popover exercise below can reach
    // .seat-more at 1024px too — same override redesign.mjs uses.
    await page.evaluate(() => {
      try { localStorage.setItem('alfred-rail-collapsed', '0'); } catch (e) {}
      document.body.classList.remove('bench-tight', 'rail-collapsed');
    });

    // Command place
    await page.click('[data-view="command"]');
    await sleep(300);
    const noHScrollCommand = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    chk(tag('Command: no horizontal body scroll'), noHScrollCommand);
    await page.screenshot({ path: path.join(SHOT_DIR, `p9-${width}-command.png`) });

    // Brain place
    await page.click('[data-view="brain"]');
    await sleep(500);
    const noHScrollBrain = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    chk(tag('Brain: no horizontal body scroll'), noHScrollBrain);
    await page.screenshot({ path: path.join(SHOT_DIR, `p9-${width}-brain.png`) });

    // Composer
    await page.fill('#search-input', 'hello p9').catch(() => {});
    await sleep(100);
    await page.screenshot({ path: path.join(SHOT_DIR, `p9-${width}-composer.png`) });
    await page.fill('#search-input', '').catch(() => {});

    // Region rects: no overlap, all nonzero, roughly sum to viewport
    const rects = await page.evaluate(() => {
      function r(id) { var e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; }
      return { top: r('top'), bench: r('bench'), deck: r('deck'), flight: r('flight') };
    });
    const allPositive = ['top', 'bench', 'deck', 'flight'].every((k) => rects[k] && rects[k].width > 0 && rects[k].height > 0);
    chk(tag('#top/#bench/#deck/#flight all have nonzero rects'), allPositive, JSON.stringify(rects));

    // Sheets
    const sheets = [
      ['library', 'sheet-library'],
      ['directory', 'sheet-roster'],
      ['auto', 'sheet-protocols'],
      ['ops', null], // Enterprise: full pane fallback (body.ops-canvas), not a .sheet
      ['dev', 'sheet-workshop'],
    ];
    for (const [view, sheetId] of sheets) {
      await page.click(`[data-view="${view}"]`);
      await sleep(400);
      const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      chk(tag(`sheet "${view}": no horizontal body scroll`), noHScroll);
      if (sheetId) {
        const visible = await page.evaluate((id) => {
          var el = document.getElementById(id);
          return !!el && !el.hidden && el.getBoundingClientRect().width > 0;
        }, sheetId);
        chk(tag(`sheet "${view}" (#${sheetId}) opens and is laid out`), visible);
      } else {
        const opsCanvas = await page.evaluate(() => document.body.classList.contains('ops-canvas'));
        chk(tag(`Enterprise place: body.ops-canvas active`), opsCanvas);
      }
      await page.screenshot({ path: path.join(SHOT_DIR, `p9-${width}-sheet-${view}.png`) });
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(200);
    }

    // Flight rail toggle
    await page.click('[data-view="command"]');
    await sleep(200);
    await page.keyboard.press('\\').catch(() => {});
    await sleep(200);
    await page.keyboard.press('\\').catch(() => {});
    await sleep(200);

    // Grid mode (needs 2 open consoles)
    const seatMoreBtns = page.locator('#cc-seats .seat-more');
    const seatRowCount = await seatMoreBtns.count();
    let openedCount = 0;
    const openedIds = [];
    for (let i = 0; i < seatRowCount && openedCount < 2; i++) {
      await seatMoreBtns.nth(i).click({ timeout: 5000 }).catch(() => {});
      const openBtn = page.locator('#seat-popover button:has-text("Open terminal")');
      if (await openBtn.count()) { await openBtn.first().click(); openedCount++; }
    }
    await page.keyboard.press('Escape').catch(() => {});
    if (openedCount >= 2) {
      await sleep(500);
      await page.click('#cc-grid-toggle');
      await sleep(400);
      const gridNoHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      chk(tag('grid mode: no horizontal body scroll'), gridNoHScroll);
      await page.screenshot({ path: path.join(SHOT_DIR, `p9-${width}-grid.png`) });
      const dbg = await page.evaluate(() => window.__ccDebug());
      chk(tag('grid mode: every console has nonzero width'), dbg.every((d) => d.rect.width > 0), JSON.stringify(dbg.map((d) => d.rect.width)));
      // fetch ids for cleanup
      dbg.forEach((d) => openedIds.push(d.id));
      await page.click('#cc-grid-toggle');
      await sleep(200);
    } else {
      chk(tag('grid mode: skipped (fewer than 2 seats available)'), false, `openedCount=${openedCount}`);
    }
    const html = await (await fetch(BASE + '/')).text();
    const TOKEN = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1];
    for (const id of openedIds) {
      await fetch(`${BASE}/api/terminals/${id}/kill`, { method: 'POST', headers: { 'X-Alfred-Token': TOKEN, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    }

    chk(tag('no uncaught JS errors across the whole exercise'), errs.length === 0, errs.slice(0, 5).join(' | '));
    } catch (e) {
      chk(tag('width sweep completed without throwing'), false, String(e && e.message || e));
    }
    await ctx.close();
  }

  await browser.close();
}

stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}

let pass = 0, fail = 0;
for (const r of R) {
  console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 400)));
  if (r.ok) pass++; else fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
