import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.resolve('brain/test');
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-verify2-'));
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
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function up() { const deadline=Date.now()+30000; while(Date.now()<deadline){ try{ if((await fetch('http://127.0.0.1:'+PORT+'/api/status')).ok) return true;}catch{} await sleep(300);} return false; }
if (!(await up())) { console.log('server did not boot'); process.exit(1); }
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'domcontentloaded' });
await page.click('#landing').catch(()=>{});
await page.waitForTimeout(1200);
await page.click('[data-view="command"]');
await page.waitForFunction(() => document.querySelectorAll('#cc-seats .seat').length > 0, null, { timeout: 10000 }).catch(()=>{});

// re-tint count + transition timing
const result = await page.evaluate(async () => {
  function sample() {
    var all = document.querySelectorAll('*');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var cs = getComputedStyle(all[i]);
      out.push(cs.color + '|' + cs.borderColor + '|' + cs.backgroundColor + '|' + cs.boxShadow + '|' + cs.textShadow);
    }
    return out;
  }
  var before = sample();
  document.querySelector('#cc-seats .seat[data-seat-id="gemini"] .seat-main').click();
  await new Promise(r => setTimeout(r, 30));
  var justAfter = sample();
  await new Promise(r => setTimeout(r, 700));
  var settled = sample();
  var changedSettled = 0, changedJustAfter = 0;
  for (var i = 0; i < before.length; i++) {
    if (before[i] !== settled[i]) changedSettled++;
    if (before[i] !== justAfter[i]) changedJustAfter++;
  }
  return { changedSettled, changedJustAfter, totalEls: before.length,
    accentPrimarySettled: getComputedStyle(document.body).getPropertyValue('--accent-primary').trim() };
});
console.log('retint result:', JSON.stringify(result));
await page.screenshot({ path: 'brain/test/tmp_p5_1440_focus-gemini.png' });

await page.click('#cc-seats .seat[data-seat-id="grok"] .seat-main');
await sleep(600);
await page.screenshot({ path: 'brain/test/tmp_p5_1440_focus-grok.png' });

await page.click('#cc-seats .seat[data-seat-id="claude"] .seat-main');
await sleep(600);
await page.screenshot({ path: 'brain/test/tmp_p5_1440_focus-claude.png' });

// idle seat check
const idleInfo = await page.evaluate(() => {
  var rows = [...document.querySelectorAll('#cc-seats .seat')];
  return rows.map(r => ({ id: r.dataset.seatId, idle: r.classList.contains('idle'), visible: r.offsetParent !== null }));
});
console.log('seat idle states:', JSON.stringify(idleInfo));

// model round-trip
let posted = null;
page.on('request', (req) => { if (req.url().includes('/api/command-center/config') && req.method() === 'POST') posted = req.postData(); });
await page.locator('#cc-seats .seat-more').first().click();
await page.fill('#seat-popover .cc-model-input', 'opus');
await page.locator('#seat-popover .cc-model-input').press('Tab');
await sleep(400);
console.log('model config POST body:', posted);

await browser.close();
server.kill();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}
