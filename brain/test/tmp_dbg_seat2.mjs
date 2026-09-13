import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.resolve('brain/test');
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-dbg-'));
const echoScript = 'process.stdout.write("ALFRED_TERM_OK\n");process.stdin.setEncoding("utf8");process.stdin.on("data",function(d){process.stdout.write("GOT:"+d);});';
const PORT = 7798;
const server = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), ALFRED_VAULT: path.join(HERE, 'fixtures', 'vault'),
    ALFRED_INDEX: path.join(stub, 'index.json'), ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'), ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1', ALFRED_COUNCIL_HELPER: HELPER, ALFRED_COUNCIL_STUB_DIR: stub,
    ALFRED_PROVIDERS: REGISTRY, ALFRED_TERM_STUB_CMD: JSON.stringify([process.execPath, '-e', echoScript]) },
  stdio: ['ignore','pipe','pipe'],
});
let log=''; server.stdout.on('data',d=>log+=d); server.stderr.on('data',d=>log+=d);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function up() { const deadline=Date.now()+30000; while(Date.now()<deadline){ try{ if((await fetch('http://127.0.0.1:'+PORT+'/api/status')).ok) return true;}catch{} await sleep(300);} return false; }
if (!(await up())) { console.log('server did not boot', log.slice(-800)); process.exit(1); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'domcontentloaded' });
await page.click('#landing').catch(()=>{});
await page.waitForTimeout(1200);
await page.click('[data-view="command"]');
await page.waitForFunction(() => document.querySelectorAll('#cc-seats .seat').length > 0, null, { timeout: 10000 }).catch(()=>{});

const seatMoreBtns = page.locator('#cc-seats .seat-more');
const seatRowCount = await seatMoreBtns.count();
let openedCount = 0;
for (let i = 0; i < seatRowCount && openedCount < 2; i++) {
  await seatMoreBtns.nth(i).click();
  const openBtn = page.locator('#seat-popover button:has-text("Open terminal")');
  if (await openBtn.count()) {
    await openBtn.first().click();
    openedCount++;
  }
}
await page.keyboard.press('Escape').catch(() => {});
console.log('opened', openedCount, 'of', seatRowCount);

await page.waitForTimeout(500);

// intern step
await page.evaluate(() => {
  var t = document.getElementById('intern-toggle'); if (t) t.click();
  document.getElementById('intern-section-available').open = true;
});

// deepseek loop
let webBtnCount = 0;
for (let i = 0; i < seatRowCount; i++) {
  await seatMoreBtns.nth(i).click();
  const btn = page.locator('#seat-popover button:has-text("Open panel")');
  const c = await btn.count();
  if (c) webBtnCount += c;
}
await page.keyboard.press('Escape').catch(() => {});
console.log('webBtnCount', webBtnCount);

const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#cc-seats .seat')];
  const main = rows[0] ? rows[0].querySelector('.seat-main') : null;
  return {
    popoverOpen: document.getElementById('seat-popover').classList.contains('open'),
    popoverStyle: getComputedStyle(document.getElementById('seat-popover')).display,
    mainRect: main ? main.getBoundingClientRect() : null,
    benchScrollTop: document.getElementById('bench').scrollTop,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'brain/test/tmp_seats2.png' });
await browser.close();
server.kill();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}
