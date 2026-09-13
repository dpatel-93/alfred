import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:7777/', { waitUntil: 'domcontentloaded' });
await page.click('#landing').catch(() => {});
await page.waitForTimeout(1000);

// Spy on speechSynthesis.speak before the click
await page.evaluate(() => {
  window.__spoken = null;
  const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
  window.speechSynthesis.speak = (utter) => { window.__spoken = utter.text; };
});

await page.click('#morning-brief-btn');
await page.waitForFunction(() => document.getElementById('answer-panel').classList.contains('show'), null, { timeout: 15000 });
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const drawer = document.getElementById('ask-drawer');
  const panel = document.getElementById('answer-panel');
  const text = document.getElementById('answer-text');
  const drawerRect = drawer.getBoundingClientRect();
  return {
    spokenLength: (window.__spoken || '').length,
    drawerMaxHeight: getComputedStyle(drawer).maxHeight,
    drawerOverflowY: getComputedStyle(drawer).overflowY,
    drawerScrollHeight: drawer.scrollHeight,
    drawerClientHeight: drawer.clientHeight,
    textLength: text.textContent.length,
    panelShowing: panel.classList.contains('show'),
    withinViewport: drawerRect.bottom <= 900 && drawerRect.top >= 0,
  };
});
console.log(JSON.stringify(info, null, 2));

await page.screenshot({ path: 'C:/dev/alfred/brain/brief_shot.png' });
await browser.close();
