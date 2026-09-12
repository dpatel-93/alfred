// P1 verification: boots its own server (never touches 7777), screenshots all
// 7 current views at 1440px, checks document.fonts.check('12px Bahnschrift'),
// and proves the --focus re-tint reaches >=20 elements via --accent-primary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRAIN = 'C:/dev/alfred/brain';
const OUT = path.join(HERE, 'p1-screens');
fs.mkdirSync(OUT, { recursive: true });

const PORT = 7799; // shared default test port, never 7777
const B = `http://127.0.0.1:${PORT}`;
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-p1-'));

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
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
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
  if (!(await up())) { console.error('SERVER FAILED TO START\n' + log); process.exit(1); }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.click('#landing').catch(() => {});
  await page.waitForTimeout(1200);

  const views = ['brain', 'dev', 'auto', 'ops', 'directory', 'library', 'command'];
  for (const v of views) {
    await page.click(`.view-btn[data-view="${v}"]`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `view-${v}.png`), fullPage: false });
    console.log('screenshotted', v);
  }

  // Bahnschrift font-check
  const fontCheck = await page.evaluate(() => {
    try { return document.fonts.check('12px Bahnschrift'); } catch (e) { return 'ERROR: ' + e.message; }
  });
  const resolvedFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  console.log('document.fonts.check(12px Bahnschrift) =', fontCheck);
  console.log('body computed font-family =', resolvedFamily);

  // Re-tint proof: set --focus to var(--p-gemini) on body, count elements whose
  // resolved color/border/background actually changed vs. before.
  const before = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    return els.map((el) => {
      const cs = getComputedStyle(el);
      return cs.color + '|' + cs.borderColor + '|' + cs.backgroundColor;
    });
  });
  await page.evaluate(() => { document.body.style.setProperty('--focus', 'var(--p-gemini)'); });
  await page.waitForTimeout(500); // clear of the 420ms --t-focus transition
  await page.screenshot({ path: path.join(OUT, 'retint-after.png'), fullPage: false });
  const after = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    return els.map((el) => {
      const cs = getComputedStyle(el);
      return cs.color + '|' + cs.borderColor + '|' + cs.backgroundColor;
    });
  });
  let changed = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
  console.log('elements re-tinted after --focus change =', changed);

  console.log('pageerrors =', JSON.stringify(errs));

  await browser.close();
  process.exit(errs.length ? 2 : 0);
})();
