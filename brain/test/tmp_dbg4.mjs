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
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function up() { const deadline=Date.now()+30000; while(Date.now()<deadline){ try{ if((await fetch('http://127.0.0.1:'+PORT+'/api/status')).ok) return true;}catch{} await sleep(300);} return false; }
if (!(await up())) { console.log('server did not boot'); process.exit(1); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:'+PORT+'/', { waitUntil: 'domcontentloaded' });
await page.click('#landing').catch(()=>{});
await page.waitForTimeout(1200);
await page.click('[data-view="command"]');
await page.waitForFunction(() => document.querySelectorAll('#cc-seats .seat').length > 0, null, { timeout: 10000 }).catch(()=>{});
const before = await page.evaluate(() => ({
  ids: [...document.querySelectorAll('#cc-seats .seat')].map(r => r.dataset.seatId),
  accentBefore: getComputedStyle(document.body).getPropertyValue('--accent-primary').trim(),
}));
console.log('seat ids', before.ids);
await page.locator('#cc-seats .seat-main').first().click();
const after = await page.evaluate(() => ({
  focusSeat: document.body.dataset.focusSeat,
  accent: getComputedStyle(document.body).getPropertyValue('--accent-primary').trim(),
  focusVar: getComputedStyle(document.body).getPropertyValue('--focus').trim(),
  inlineFocus: document.body.style.getPropertyValue('--focus'),
}));
console.log('after', JSON.stringify(after, null, 2));
console.log('accent before', before.accentBefore);
await browser.close();
server.kill();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch {}
