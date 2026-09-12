import { chromium } from 'playwright';

const BASE = 'http://localhost:7778';
const results = [];
function log(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' :: ' + detail : ''));
}

function overlaps(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') console.log('  [console error]', msg.text()); });
page.on('pageerror', (err) => console.log('  [pageerror]', err.message));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
// Dismiss landing screen (any keydown dismisses it per ui.html:2033-ish)
await page.keyboard.press('Space');
await page.waitForTimeout(300);
// Switch to the Command Center stage so .stage is actually visible.
await page.click('.view-btn[data-view="command"]');
await page.waitForTimeout(200);

const widths = [1024, 1440, 1920];
for (const w of widths) {
  for (const collapsed of [false, true]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.evaluate((c) => {
      document.body.classList.toggle('rail-collapsed', c);
    }, collapsed);
    await page.waitForTimeout(250); // let the CSS transition settle
    const rects = await page.evaluate(() => {
      function r(sel) {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width };
      }
      return { stage: r('.stage:not([hidden])'), topleft: r('#topleft'), viewToggle: r('#view-toggle') };
    });
    const label = 'w=' + w + ' collapsed=' + collapsed;
    if (!rects.stage || !rects.topleft) { log(label, false, 'missing elements: ' + JSON.stringify(rects)); continue; }
    const overlapTopleft = overlaps(rects.stage, rects.topleft);
    const overlapToggle = rects.viewToggle ? overlaps(rects.stage, rects.viewToggle) : false;
    log(label + ' no overlap #topleft', !overlapTopleft, JSON.stringify(rects.stage) + ' vs ' + JSON.stringify(rects.topleft));
    if (rects.viewToggle) log(label + ' no overlap #view-toggle', !overlapToggle, JSON.stringify(rects.stage) + ' vs ' + JSON.stringify(rects.viewToggle));
    // rail width sanity: collapsed should be much narrower than expanded
    log(label + ' topleft width sane', collapsed ? rects.topleft.width <= 70 : rects.topleft.width >= 200, 'topleft.width=' + rects.topleft.width);
  }
}

// Reset to a normal viewport/state for the terminal test
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => document.body.classList.remove('rail-collapsed'));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
process.exit(failed.length ? 1 : 0);
