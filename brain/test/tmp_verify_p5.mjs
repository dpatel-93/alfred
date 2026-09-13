import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.resolve('brain/test');
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-verify-'));
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

async function freshPage(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', width, e.message));
  await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'domcontentloaded' });
  await page.click('#landing').catch(()=>{});
  await page.waitForTimeout(1200);
  await page.click('[data-view="command"]');
  await page.waitForFunction(() => document.querySelectorAll('#cc-seats .seat').length > 0, null, { timeout: 10000 }).catch(()=>{});
  return { ctx, page };
}

// --- 1. Screenshots at 1024/1440/1920, expanded ---
for (const width of [1024, 1440, 1920]) {
  const { ctx, page } = await freshPage(width);
  await page.screenshot({ path: `brain/test/tmp_p5_${width}_expanded.png` });
  await ctx.close();
}

// --- 2. bench-tight auto-narrow at <=1180, no explicit choice ---
{
  const { ctx, page } = await freshPage(1024);
  const tight = await page.evaluate(() => document.body.classList.contains('bench-tight'));
  console.log('bench-tight at 1024 (no explicit choice):', tight);
  // manual override: press [ -> explicit choice recorded -> bench-tight should clear
  await page.keyboard.press('[');
  await sleep(100);
  const afterExplicit = await page.evaluate(() => ({
    tight: document.body.classList.contains('bench-tight'),
    collapsed: document.body.classList.contains('rail-collapsed'),
    ls: localStorage.getItem('alfred-rail-collapsed'),
  }));
  console.log('after [ at 1024:', JSON.stringify(afterExplicit));
  await page.screenshot({ path: 'brain/test/tmp_p5_1024_bench-tight-then-manual.png' });
  await ctx.close();
}

// --- 3. wide viewport, no auto-narrow ---
{
  const { ctx, page } = await freshPage(1440);
  const tight = await page.evaluate(() => document.body.classList.contains('bench-tight'));
  console.log('bench-tight at 1440:', tight);
  await ctx.close();
}

// --- 4. [ collapse persists across reload ---
{
  const { ctx, page } = await freshPage(1440);
  await page.keyboard.press('[');
  await sleep(100);
  const collapsedBefore = await page.evaluate(() => document.body.classList.contains('rail-collapsed'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(500);
  const collapsedAfter = await page.evaluate(() => document.body.classList.contains('rail-collapsed'));
  console.log('rail-collapsed before reload:', collapsedBefore, 'after reload:', collapsedAfter);
  await page.screenshot({ path: 'brain/test/tmp_p5_1440_collapsed.png' });
  await ctx.close();
}

// --- 5. re-tint count + transition timing ---
{
  const { ctx, page } = await freshPage(1440);
  const result = await page.evaluate(async () => {
    function sample() {
      var all = document.querySelectorAll('*');
      var out = [];
      for (var i = 0; i < all.length; i++) {
        var cs = getComputedStyle(all[i]);
        out.push(cs.color + '|' + cs.borderColor + '|' + cs.backgroundColor + '|' + cs.boxShadow);
      }
      return out;
    }
    var before = sample();
    var t0 = performance.now();
    setFocusSeat('gemini');
    // Sample repeatedly to catch the mid-transition value and confirm it is NOT instant.
    await new Promise(r => setTimeout(r, 60));
    var mid = sample();
    await new Promise(r => setTimeout(r, 600));
    var after = sample();
    var t1 = performance.now();
    var changedAfter = 0, changedMid = 0;
    for (var i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) changedAfter++;
      if (before[i] !== mid[i]) changedMid++;
    }
    return { changedAfter, changedMid, totalEls: before.length, elapsedMs: t1 - t0 };
  });
  console.log('retint result', JSON.stringify(result));
  await page.screenshot({ path: 'brain/test/tmp_p5_1440_focus-gemini.png' });
  await ctx.close();
}

// --- 6. focus a different seat and screenshot ---
{
  const { ctx, page } = await freshPage(1440);
  await page.evaluate(() => setFocusSeat('grok'));
  await sleep(600);
  await page.screenshot({ path: 'brain/test/tmp_p5_1440_focus-grok.png' });
  await ctx.close();
}

// --- 7. model input round-trip ---
{
  const { ctx, page } = await freshPage(1440);
  await page.locator('#cc-seats .seat-more').first().click();
  await page.fill('#seat-popover .cc-model-input', 'opus');
  let posted = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/command-center/config') && req.method() === 'POST') {
      posted = req.postData();
    }
  });
  await page.locator('#seat-popover .cc-model-input').press('Tab'); // fires change
  await sleep(400);
  console.log('model POST body:', posted);
  await ctx.close();
}

await browser.close();
server.kill();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}
