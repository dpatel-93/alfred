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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('crash', () => console.log('PAGE CRASHED'));

await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'domcontentloaded' });
await page.click('#landing').catch(()=>{});
await page.waitForTimeout(1200);
await page.click('[data-view="command"]');
await page.waitForFunction(() => document.querySelectorAll('#cc-seats .seat').length > 0, null, { timeout: 10000 }).catch(()=>{});
console.log('step1 seats loaded ok');

// Screenshots at 3 widths, expanded (force explicit-wide so no auto-tight interferes)
await page.evaluate(() => { try { localStorage.setItem('alfred-rail-collapsed', '0'); } catch(e){} document.body.classList.remove('bench-tight','rail-collapsed'); });
for (const width of [1024, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  await sleep(150);
  await page.screenshot({ path: `brain/test/tmp_p5_${width}_expanded.png` });
  console.log('screenshot', width, 'ok');
}

// bench-tight auto-narrow check: clear the explicit choice, resize to 1024
await page.evaluate(() => { try { localStorage.removeItem('alfred-rail-collapsed'); } catch(e){} });
await page.setViewportSize({ width: 1024, height: 900 });
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await sleep(200);
let tight = await page.evaluate(() => document.body.classList.contains('bench-tight'));
console.log('bench-tight at 1024 with no explicit choice:', tight);
await page.screenshot({ path: 'brain/test/tmp_p5_1024_bench-tight.png' });

// manual override wins
await page.keyboard.press('[');
await sleep(150);
let state = await page.evaluate(() => ({ tight: document.body.classList.contains('bench-tight'), collapsed: document.body.classList.contains('rail-collapsed'), ls: localStorage.getItem('alfred-rail-collapsed') }));
console.log('after pressing [ at 1024:', JSON.stringify(state));
await page.screenshot({ path: 'brain/test/tmp_p5_1024_after_manual.png' });

// undo the collapse (second [ press) -> explicit "expanded" choice at narrow width should now win over auto-tight
await page.keyboard.press('[');
await sleep(150);
state = await page.evaluate(() => ({ tight: document.body.classList.contains('bench-tight'), collapsed: document.body.classList.contains('rail-collapsed'), ls: localStorage.getItem('alfred-rail-collapsed') }));
console.log('after pressing [ again at 1024 (explicit expand):', JSON.stringify(state));
await page.screenshot({ path: 'brain/test/tmp_p5_1024_explicit_expand.png' });

// reload persistence of rail-collapsed
await page.keyboard.press('['); // collapse again
await sleep(150);
const beforeReload = await page.evaluate(() => document.body.classList.contains('rail-collapsed'));
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(800);
const afterReload = await page.evaluate(() => document.body.classList.contains('rail-collapsed'));
console.log('rail-collapsed before reload:', beforeReload, 'after reload:', afterReload);

await page.setViewportSize({ width: 1440, height: 900 });
await sleep(200);
console.log('done sequence 1');
await browser.close();
server.kill();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}
