// Manual verification for P6 (the composer). Boots its own stub server on a
// dedicated port (never 7777), exercises every point in the P6 brief, and
// prints a pass/fail line per check plus screenshots to this scratchpad dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');

const HERE = 'C:/dev/alfred/brain/test';
const HELPER = 'C:/Users/Owner/.claude/helpers/council-run.mjs';
const REGISTRY = 'C:/Users/Owner/.claude/helpers/providers.json';
const OUT_DIR = 'C:/Users/Owner/AppData/Local/Temp/claude/C--Users-Owner/799a0310-95a7-45ac-99f2-72165ca2ebb2/scratchpad';

const R = [];
const chk = (n, c, d = '') => { R.push({ n, ok: !!c, d: String(d) }); console.log((c ? '  OK   ' : '  FAIL ') + n + (c ? '' : ' -> ' + d)); };

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-p6verify-'));
const echoScript = 'process.stdout.write("ALFRED_TERM_OK\\n");'
  + 'process.stdin.setEncoding("utf8");'
  + 'process.stdin.on("data",function(d){process.stdout.write("GOT:"+d);});';

const PORT = 7798; // dedicated verification port — never 7777
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ALFRED_VAULT: path.join(HERE, 'fixtures', 'vault'),
    ALFRED_INDEX: path.join(stub, 'index.json'),
    ALFRED_GREETING_STATE: path.join(stub, 'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub, 'cfg'),
    ALFRED_TOKEN_FILE: path.join(stub, 'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
    ALFRED_COUNCIL_HELPER: HELPER,
    ALFRED_COUNCIL_STUB_DIR: stub,
    ALFRED_PROVIDERS: REGISTRY,
    ALFRED_TERM_STUB_CMD: JSON.stringify([process.execPath, '-e', echoScript]),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
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
    try { if ((await fetch(BASE + '/api/status')).ok) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await up())) {
  chk('server boots', false, serverLog.slice(-800));
} else {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const councilRequests = [];
  await page.route('**/api/council', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      try { councilRequests.push(JSON.parse(req.postData() || '{}')); } catch { /* ignore */ }
    }
    await route.continue();
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.click('#landing').catch(() => {});
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    try { localStorage.setItem('alfred-rail-collapsed', '0'); } catch (e) {}
    document.body.classList.remove('bench-tight', 'rail-collapsed');
  });
  await page.click('[data-view="command"]');
  await page.waitForFunction(() => document.querySelectorAll('#cc-seats .seat').length > 0, null, { timeout: 10000 }).catch(() => {});

  // --- bench-composer state sync, both directions ------------------------
  const seatCount = await page.locator('#cc-seats .seat').count();
  chk('seats rendered on the Bench', seatCount > 0, `count=${seatCount}`);

  // Direction 1: tick a Bench seat -> composer chip reflects it.
  const readyBoxes = page.locator('#cc-seats .seat-tick input:not([disabled])');
  const readyCount = await readyBoxes.count();
  chk('at least 2 ready seats for council testing', readyCount >= 2, `readyCount=${readyCount}`);
  if (readyCount >= 1) {
    const firstBox = readyBoxes.first();
    const seatId = await firstBox.evaluate((el) => el.closest('.seat').dataset.seatId);
    await firstBox.check();
    await page.waitForTimeout(150);
    const chipActive = await page.evaluate((id) => {
      const chip = [...document.querySelectorAll('#route-chips .route-chip')].find((c) => c.textContent.trim() === document.querySelector(`.seat[data-seat-id="${id}"] .seat-name`).textContent.trim());
      return chip ? chip.classList.contains('active') : null;
    }, seatId);
    chk('ticking a Bench seat updates the composer route chip (Bench -> composer)', chipActive === true, `chipActive=${chipActive}`);

    // Direction 2: click the composer chip -> Bench tick reflects it (untick via chip).
    await page.evaluate((id) => {
      const label = document.querySelector(`.seat[data-seat-id="${id}"] .seat-name`).textContent.trim();
      const chip = [...document.querySelectorAll('#route-chips .route-chip')].find((c) => c.textContent.trim() === label);
      if (chip) chip.click();
    }, seatId);
    await page.waitForTimeout(150);
    const boxChecked = await firstBox.isChecked();
    chk('clicking the composer chip updates the Bench tick (composer -> Bench)', boxChecked === false, `boxChecked=${boxChecked}`);
    // Re-tick for the council test below.
    await firstBox.check();
  }

  // Tick a 2nd ready seat if available.
  if (readyCount >= 2) await readyBoxes.nth(1).check();
  await page.waitForTimeout(150);

  // --- Council-armed send: exact provider ids -----------------------------
  // The Council chip is always rendered last in #route-chips (renderRouteChips
  // appends it after every seat chip) — select by position, not text, since
  // the chip's label carries a ◎ glyph that :has-text matching can be brittle
  // against depending on how Playwright normalizes it.
  async function clickCouncilChip() {
    await page.evaluate(() => {
      const chips = document.querySelectorAll('#route-chips .route-chip');
      chips[chips.length - 1].click();
    });
  }
  await clickCouncilChip();
  await page.waitForTimeout(150);
  const footVisible = await page.evaluate(() => !document.getElementById('composer-foot').hidden);
  chk('arming Council reveals the synth checkbox/model foot', footVisible);

  const tickedIds = await page.evaluate(() => [...document.querySelectorAll('#cc-seats .seat-tick input:checked')].map((b) => b.closest('.seat').dataset.seatId));
  await page.fill('#search-input', 'What is the best approach here?');
  await page.click('#cc-ask-btn');
  await page.waitForFunction(() => !document.getElementById('cc-council').hidden, null, { timeout: 8000 }).catch(() => {});
  await sleep(1500);
  const lastCouncilReq = councilRequests[councilRequests.length - 1];
  chk('Council-armed Send POSTs /api/council with exactly the ticked seat ids',
    lastCouncilReq && JSON.stringify([...lastCouncilReq.providers].sort()) === JSON.stringify([...tickedIds].sort()),
    JSON.stringify({ sent: lastCouncilReq && lastCouncilReq.providers, ticked: tickedIds }));
  const answerCols = await page.locator('#cc-answers .cc-answer').count();
  chk('#cc-answers renders one column per ticked seat', answerCols === tickedIds.length, `cols=${answerCols} ticked=${tickedIds.length}`);
  await page.waitForFunction(() => !document.getElementById('cc-verdict').hidden, null, { timeout: 20000 }).catch(() => {});
  const verdictShown = await page.evaluate(() => !document.getElementById('cc-verdict').hidden);
  chk('verdict renders when synth is on', verdictShown, JSON.stringify(await page.evaluate(() => document.getElementById('cc-run-status').textContent)));

  const councilArmedShot = path.join(OUT_DIR, 'p6-1440-council-armed.png');
  await page.screenshot({ path: councilArmedShot });

  // --- Single-seat mode: request carries ONLY the focused seat -----------
  await clickCouncilChip(); // disarm
  await page.waitForTimeout(150);
  const armedAfterDisarm = await page.evaluate(() => document.getElementById('composer-foot').hidden === false);
  chk('Council chip actually disarmed', armedAfterDisarm === false, `footHidden=${!armedAfterDisarm}`);
  // Explicitly focus one specific seat by clicking its Bench row body —
  // ticking a checkbox (done above) is a different action from focusing.
  const focusTargetId = await page.evaluate(() => document.querySelector('#cc-seats .seat:not(.idle)').dataset.seatId);
  await page.click(`#cc-seats .seat[data-seat-id="${focusTargetId}"] .seat-main`);
  await page.waitForTimeout(600); // past the 420ms --focus transition
  const focusSeatId = await page.evaluate(() => document.body.dataset.focusSeat || '');
  chk('a seat is focused via its Bench row', focusSeatId === focusTargetId, `focusSeatId="${focusSeatId}" target="${focusTargetId}"`);
  await page.fill('#search-input', 'Second question, single seat.');
  await page.click('#cc-ask-btn');
  await page.waitForTimeout(1500);
  const singleReq = councilRequests[councilRequests.length - 1];
  chk('single-seat Send POSTs /api/council with exactly the focused seat',
    singleReq && singleReq.providers.length === 1 && singleReq.providers[0] === focusSeatId,
    JSON.stringify({ sent: singleReq && singleReq.providers, focus: focusSeatId }));
  chk('single-seat Send does not synthesize a verdict', singleReq && singleReq.synthesize === false, JSON.stringify(singleReq));

  // --- ? prefix -> runSearch ------------------------------------------------
  await page.fill('#search-input', '');
  await page.type('#search-input', '?alfred');
  await page.waitForFunction(() => document.getElementById('search-results').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
  const searchShown = await page.evaluate(() => document.getElementById('search-results').classList.contains('show'));
  const searchRowCount = await page.locator('#search-results .result').count();
  chk('? prefix runs runSearch() and results appear', searchShown && searchRowCount > 0, `shown=${searchShown} rows=${searchRowCount}`);

  // --- / prefix -> skill picker from real /api/library ---------------------
  await page.fill('#search-input', '');
  await page.type('#search-input', '/fire');
  await page.waitForFunction(() => !document.getElementById('composer-picker').hidden, null, { timeout: 5000 }).catch(() => {});
  const pickerRows = await page.locator('#composer-picker .composer-picker-row').count();
  chk('/ prefix shows a skill picker sourced from real /api/library data', pickerRows > 0, `rows=${pickerRows}`);

  // --- global / hotkey still focuses the composer --------------------------
  await page.fill('#search-input', '');
  await page.evaluate(() => { document.getElementById('search-input').blur(); document.body.focus(); });
  await page.keyboard.press('/');
  await page.waitForTimeout(150);
  const focusedIsComposer = await page.evaluate(() => document.activeElement && document.activeElement.id === 'search-input');
  chk('global "/" hotkey still focuses the composer', focusedIsComposer);

  // --- Shift+Enter newline vs Enter send -----------------------------------
  await page.fill('#search-input', 'line one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('line two');
  const val = await page.inputValue('#search-input');
  chk('Shift+Enter inserts a literal newline', val === 'line one\nline two', JSON.stringify(val));
  const reqCountBeforeEnter = councilRequests.length;
  await clickCouncilChip(); // arm council for a clean single Enter-send test
  await page.waitForTimeout(100);
  await page.fill('#search-input', 'plain enter send test');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  chk('plain Enter sends (posts /api/council)', councilRequests.length > reqCountBeforeEnter, `before=${reqCountBeforeEnter} after=${councilRequests.length}`);

  chk('no pageerror at 1440px', errs.length === 0, errs.slice(0, 3).join(' | '));

  // --- Screenshots at 1024 / 1440 / 1920, both modes -----------------------
  await page.fill('#search-input', '');
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, `p6-${width}-council-armed.png`) });
  }
  await clickCouncilChip(); // disarm -> single-seat view
  await page.waitForTimeout(150);
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, `p6-${width}-single-seat.png`) });
  }
  chk('no pageerror after all screenshots', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
}

stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch { /* temp */ }

const failed = R.filter((r) => !r.ok).length;
console.log(`\n${R.length - failed} passed, ${failed} failed`);
