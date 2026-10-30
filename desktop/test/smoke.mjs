// --- smoke.mjs -----------------------------------------------------------------
// Drives the desktop app end to end with Playwright, against a throwaway engine on a
// test port with a throwaway brain (never the live one): the app starts the engine, the
// dashboard opens in its own window, minimising it shows the floating brain with its
// badge, clicking the brain brings the dashboard back, closing hides to the brain, and
// quitting stops the engine the app started. Screenshots go to ALFRED_SHOTS (or test/).
// ALFRED_APP_EXE=dist/win-unpacked/Alfred.exe runs the same checks on the packaged app.
//   node test/smoke.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const ENGINE = path.join(APP, '..', 'brain');
const require = createRequire(path.join(ENGINE, 'package.json'));
const { _electron: electron } = require('playwright');

// --- Configuration ---
const PORT = 7791;
const URL = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-desktop-'));
const SHOTS = process.env.ALFRED_SHOTS || HERE;
const BRAIN = path.join(TMP, 'Second Brain');

let pass = 0;
const fails = [];
const chk = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(BRAIN, rel)), { recursive: true }); fs.writeFileSync(path.join(BRAIN, rel), text); };
const up = async () => { try { return (await fetch(`${URL}/api/status`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };

// --- A throwaway brain: one late reminder, so the brain should turn rose with a badge ---
put('README.md', '# Test brain\n');
put('Reminders/2026-01-01--late.md', '# Renew the test permit\n\n- **Kind:** reminder\n- **Status:** open\n- **Due:** 2026-01-01\n- **Scope:** personal\n- **Author:** Claude Code\n');
put('Inbox/README.md', '# Inbox\n');

if (await up()) { console.log(`port ${PORT} is already taken; stop whatever holds it first`); process.exit(1); }

const app = await electron.launch({
  // ALFRED_APP_EXE tests the packaged app (dist/win-unpacked/Alfred.exe) instead of the source.
  executablePath: process.env.ALFRED_APP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: process.env.ALFRED_APP_EXE ? [] : [APP],
  env: {
    ...process.env,
    ALFRED_ENGINE_URL: URL,
    ALFRED_ENGINE_DIR: ENGINE,
    ALFRED_USER_DATA: path.join(TMP, 'userData'),
    ALFRED_TOKEN_FILE: path.join(TMP, 'engine.token'),
    ALFRED_SHARED_BRAIN: BRAIN,
    ALFRED_VAULT: path.join(ENGINE, 'test', 'fixtures', 'vault'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(TMP, 'config'),
    ALFRED_CC_DRY_RUN: '1',
    OLLAMA_URL: 'http://127.0.0.1:1',
  },
});

const windows = async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
  id: w.id, url: w.webContents.getURL(), visible: w.isVisible(), onTop: w.isAlwaysOnTop(), bounds: w.getBounds(),
})));
const isWidget = (w) => /widget\.html/.test(w.url);
const mainWin = async () => (await windows()).find((w) => !isWidget(w));
const widgetWin = async () => (await windows()).find(isWidget);
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}

try {
  console.log('\nStarting');
  chk('the app starts the engine itself when none is running', await until(up, 90000));
  chk('the dashboard opens in its own window, not a browser', await until(async () => (await mainWin())?.url.startsWith(URL), 30000)
    && (await mainWin()).visible, JSON.stringify(await windows()));
  const w0 = await widgetWin();
  chk('the floating brain exists, hidden while the dashboard shows, always on top, 132 px square',
    !!w0 && !w0.visible && w0.onTop && w0.bounds.width === 132 && w0.bounds.height === 132, JSON.stringify(w0));

  const widgetPage = app.windows().find((p) => /widget\.html/.test(p.url()));
  const mainPage = app.windows().find((p) => p.url().startsWith(URL));
  await mainPage.screenshot({ path: path.join(SHOTS, 'desktop-main.png') });

  console.log('\nMinimise');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('http')).minimize());
  chk('minimising the dashboard leaves just the floating brain', await until(async () => !(await mainWin()).visible && (await widgetWin()).visible, 5000),
    JSON.stringify(await windows()));
  const w1 = await widgetWin();
  chk('the brain starts in the bottom-right corner of the screen', w1.bounds.x > 400 && w1.bounds.y > 300, JSON.stringify(w1.bounds));
  chk('the badge shows what is left, rose because something is late', await until(() => widgetPage.evaluate(() => {
    const b = document.getElementById('badge');
    return !b.hidden && b.textContent === '1' && b.classList.contains('attention');
  }), 40000), await widgetPage.evaluate(() => document.getElementById('badge').outerHTML));
  chk('hovering the brain names what is next', /Renew the test permit/.test(await widgetPage.evaluate(() => document.body.title)),
    await widgetPage.evaluate(() => document.body.title));
  await sleep(1200);
  await widgetPage.screenshot({ path: path.join(SHOTS, 'desktop-widget.png'), omitBackground: true });

  console.log('\nClick');
  await widgetPage.mouse.move(66, 66);
  await widgetPage.mouse.down();
  await widgetPage.mouse.up();
  chk('clicking the brain brings the dashboard back and hides the brain', await until(async () => (await mainWin()).visible && !(await widgetWin()).visible, 5000),
    JSON.stringify(await windows()));

  console.log('\nClose');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('http')).close());
  chk('closing the dashboard hides it to the brain; Alfred keeps running', await until(async () => {
    const m = await mainWin();
    return m && !m.visible && (await widgetWin()).visible;
  }, 5000), JSON.stringify(await windows()));
  chk('the window state is saved for next time', await until(() => fs.existsSync(path.join(TMP, 'userData', 'state.json')), 3000));

  console.log('\nQuit');
  await app.evaluate(({ app: a }) => a.quit());
  await app.close().catch(() => {});
  chk('quitting stops the engine the app started', await until(async () => !(await up()), 15000));
} catch (err) {
  fails.push(`crashed: ${err.message}`);
  console.log(`  FAIL  crashed: ${err.stack}`);
  await app.close().catch(() => {});
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
