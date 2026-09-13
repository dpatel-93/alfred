import path from 'node:path';
const { chromium } = await import('playwright');
const BASE = 'http://127.0.0.1:7796';
const WIDTHS = [1024, 1440, 1920];
const OUT = 'C:\\Users\\Owner\\AppData\\Local\\Temp\\claude\\C--Users-Owner\\799a0310-95a7-45ac-99f2-72165ca2ebb2\\scratchpad';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = {};

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const rects = await page.evaluate(() => {
    function r(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
    }
    return {
      top: r('top'), bench: r('bench'), deck: r('deck'), flight: r('flight'), frame: r('frame'),
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
    };
  });

  // overlap checks
  function overlap(a, b) {
    if (!a || !b) return null;
    return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
  }
  const overlaps = {
    benchDeck: overlap(rects.bench, rects.deck),
    deckFlight: overlap(rects.deck, rects.flight),
    benchFlight: overlap(rects.bench, rects.flight),
  };
  const widthSum = (rects.bench ? rects.bench.width : 0) + (rects.deck ? rects.deck.width : 0) + (rects.flight ? rects.flight.width : 0);

  // legacy deep links
  const legacyResults = {};
  for (const v of ['library', 'ops', 'directory', 'auto', 'dev']) {
    await page.evaluate((view) => { location.hash = view; }, v);
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      hash: location.hash,
      commandActive: document.querySelector('.view-btn[data-view="command"]').classList.contains('active'),
      bodyBlank: document.body.getBoundingClientRect().width === 0,
    }));
    legacyResults[v] = { ...state, errCount: errs.length };
  }

  // back to brain, screenshot
  await page.evaluate(() => { location.hash = 'brain'; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `p3_brain_${width}.png`) });
  await page.evaluate(() => { document.querySelector('[data-view="command"]').click(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `p3_command_${width}.png`) });

  results[width] = { rects, overlaps, widthSum, legacyResults, errs };
  await ctx.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
