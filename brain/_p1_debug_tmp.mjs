import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const BRAIN = 'C:/dev/alfred/brain';
const PORT = 7799;
const B = `http://127.0.0.1:${PORT}`;
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-p1d-'));

const server = spawn(process.execPath, [path.join(BRAIN, 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(BRAIN, 'test', 'fixtures', 'vault'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_INDEX: path.join(stub, 'index.json'),
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    OLLAMA_URL: 'http://127.0.0.1:1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
function stopServer() {
  try { server.kill(); } catch { /* gone */ }
  if (process.platform === 'win32' && server.pid) {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); } catch { /* dead */ }
  }
}
process.on('exit', stopServer);
async function up() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(B + '/api/status')).ok) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const { chromium } = await import('playwright');
(async () => {
  if (!(await up())) { console.error('boot fail'); process.exit(1); }
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  const page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.click('#landing').catch(() => {});
  await page.waitForTimeout(1200);

  const r1 = await page.evaluate(() => {
    const bs = getComputedStyle(document.body);
    const el = document.querySelector('#status .val') || document.querySelector('.rail-glyph');
    return {
      focusVar: bs.getPropertyValue('--focus').trim(),
      accentVar: bs.getPropertyValue('--accent-primary').trim(),
      elFound: !!el,
      elSelector: el ? (el.id ? '#'+el.id : el.className) : null,
      elColor: el ? getComputedStyle(el).color : null,
    };
  });
  console.log('BEFORE', JSON.stringify(r1, null, 2));

  await page.evaluate(() => { document.body.style.setProperty('--focus', 'var(--p-gemini)'); });
  await page.waitForTimeout(500);

  const r2 = await page.evaluate(() => {
    const bs = getComputedStyle(document.body);
    const el = document.querySelector('#status .val') || document.querySelector('.rail-glyph');
    return {
      focusVar: bs.getPropertyValue('--focus').trim(),
      accentVar: bs.getPropertyValue('--accent-primary').trim(),
      elColor: el ? getComputedStyle(el).color : null,
      bodyInlineFocus: document.body.style.getPropertyValue('--focus'),
    };
  });
  console.log('AFTER', JSON.stringify(r2, null, 2));

  await browser.close();
  process.exit(0);
})();
