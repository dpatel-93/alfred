import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = process.cwd();
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-verify-ui2-'));
const PORT = 7902;
const B = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(HERE, 'test', 'fixtures', 'vault'),
    ALFRED_INDEX: path.join(stub, 'index.json'),
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => log += d);
server.stderr.on('data', d => log += d);

function stop() {
  try { server.kill(); } catch {}
  if (process.platform === 'win32' && server.pid) {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); } catch {}
  }
}

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(B + '/api/status'); if (r.status) return true; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

let browser;
try {
  const up = await waitUp();
  if (!up) { console.log('SERVER FAILED TO START\n' + log); process.exit(1); }

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Never actually let the browser hit the real dsh binary or open a real tab:
  // stub the two endpoints ccOpenWebPanel/ccKillWebPanel call, and neutralize window.open.
  let fakeCounter = 0;
  await page.route('**/api/terminals', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    fakeCounter += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terminal: { id: 'faketerm' + fakeCounter, provider: 'dsh', status: 'running' } }) });
  });
  await page.route('**/api/terminals/*/kill', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto(B + '/', { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: "window.open = function(u){ window.__lastOpen = u; return null; };" });

  const landingBtn = await page.$('#landing-enter');
  if (landingBtn) { await landingBtn.click(); await page.waitForTimeout(300); }

  await page.click('.view-btn[data-view="command"]');
  await page.waitForSelector('#cc-seats .cc-seat', { timeout: 15000 });

  // Locate the DeepSeek card and click "Open panel".
  const dshCard = page.locator('#cc-seats .cc-seat', { hasText: 'DeepSeek Harness' });
  await dshCard.locator('button', { hasText: 'Open panel' }).click();
  await page.waitForTimeout(400);

  const afterOpen = await dshCard.evaluate((el) => el.outerHTML);
  console.log('AFTER OPEN:', afterOpen);
  const lastOpen = await page.evaluate(() => window.__lastOpen);
  console.log('window.open called with:', lastOpen);

  const panel = await dshCard.screenshot();
  fs.writeFileSync('/tmp/cc-dsh-running.png', panel);

  // Now kill it.
  await dshCard.locator('button', { hasText: 'kill' }).click();
  await page.waitForTimeout(400);
  const afterKill = await dshCard.evaluate((el) => el.outerHTML);
  console.log('AFTER KILL:', afterKill);
  const panel2 = await dshCard.screenshot();
  fs.writeFileSync('/tmp/cc-dsh-exited.png', panel2);
} finally {
  if (browser) await browser.close();
  stop();
}
