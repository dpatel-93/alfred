import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:7777/', { waitUntil: 'domcontentloaded' });
await page.click('#landing').catch(() => {});
await page.waitForTimeout(1000);

// Switch to Enterprise (ops) view — agent/org graph
await page.click('[data-view="ops"]');
await page.waitForTimeout(1500);

const dbg = await page.evaluate(() => window.__alfredDebug ? window.__alfredDebug() : null);
const canvasRect = await page.evaluate(() => document.getElementById('graph').getBoundingClientRect().toJSON());
console.log('ops node count', dbg ? dbg.nodes.length : 'no debug hook');

const results = [];
const sampleCount = Math.min(10, dbg.nodes.length);
for (let i = 0; i < sampleCount; i++) {
  const idx = Math.floor(i * dbg.nodes.length / sampleCount);
  const node = dbg.nodes[idx];
  const local = dbg.screen[idx];
  const pageX = canvasRect.x + local.x;
  const pageY = canvasRect.y + local.y;
  await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
  await page.mouse.click(pageX, pageY);
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const list = document.getElementById('connected-list');
    const panelOpen = document.getElementById('panel').classList.contains('open');
    return {
      panelOpen,
      listChildCount: list ? list.children.length : null,
      listText: list ? list.textContent : null,
    };
  });
  results.push({ node: node.title, orgStatus: node.orgStatus, ...info });
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
