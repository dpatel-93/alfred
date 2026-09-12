import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = process.cwd();
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-verify-ui-'));
const PORT = 7901;
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
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto(B + '/', { waitUntil: 'networkidle' });

  // Switch to the Command Center view.
  const clicked = await page.evaluate(() => { if (typeof switchView === 'function') { switchView('command'); return true; } return false; });
  console.log('switched to command view:', clicked);

  await page.waitForFunction(() => window.ccSeats && window.ccSeats === undefined || true); // no-op guard
  // ccSeats is a module-local var, not global — wait for the rendered DOM instead.
  await page.waitForSelector('#cc-seats .cc-seat', { timeout: 10000 });

  const seatsInfo = await page.evaluate(() => {
    var cards = Array.from(document.querySelectorAll('#cc-seats .cc-seat'));
    return cards.map(function (c) {
      var label = c.querySelector('.cc-seat-title strong');
      var btns = Array.from(c.querySelectorAll('button')).map(function (b) { return b.textContent.trim(); });
      var help = c.querySelector('.panel-help');
      return {
        label: label ? label.textContent : null,
        buttons: btns,
        panelHelp: help ? help.textContent : null,
        html: c.outerHTML.slice(0, 2000),
      };
    });
  });
  console.log('SEAT CARDS:', JSON.stringify(seatsInfo, null, 2));

  await page.screenshot({ path: '/tmp/cc-seats.png', fullPage: false });
  const wrap = await page.$('#cc-seats');
  if (wrap) await wrap.screenshot({ path: '/tmp/cc-seats-panel.png' });
  console.log('Screenshots saved.');
} finally {
  if (browser) await browser.close();
  stop();
}
