// --- smoke.mjs -----------------------------------------------------------------
// Drives the desktop app end to end with Playwright, against a throwaway engine on a
// test port with a throwaway brain (never the live one): the app starts the engine, the
// dashboard opens in its own window, minimising it shows the floating brain with its
// badge, clicking the brain brings the dashboard back, closing hides to the brain, and
// quitting stops the engine the app started. A second run starts hidden with a saved
// size and "keep on top" off, and checks both are remembered.
// Screenshots go to ALFRED_SHOTS (or test/).
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
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}

// --- A throwaway brain: one late reminder, so the brain should turn rose with a badge ---
put('README.md', '# Test brain\n');
put('Reminders/2026-01-01--late.md', '# Renew the test permit\n\n- **Kind:** reminder\n- **Status:** open\n- **Due:** 2026-01-01\n- **Scope:** personal\n- **Author:** Claude Code\n');
put('Inbox/README.md', '# Inbox\n');

function launch(userData, extra = []) {
  return electron.launch({
    executablePath: process.env.ALFRED_APP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [...(process.env.ALFRED_APP_EXE ? [] : [APP]), ...extra],
    env: {
      ...process.env,
      ALFRED_ENGINE_URL: URL,
      ALFRED_ENGINE_DIR: ENGINE,
      ALFRED_USER_DATA: userData,
      ALFRED_TOKEN_FILE: path.join(TMP, 'engine.token'),
      ALFRED_SHARED_BRAIN: BRAIN,
      ALFRED_VAULT: path.join(ENGINE, 'test', 'fixtures', 'vault'),
      ALFRED_LOCAL_CONFIG_DIR: path.join(TMP, 'config'),
      ALFRED_CC_DRY_RUN: '1',
      OLLAMA_URL: 'http://127.0.0.1:1',
    },
  });
}

function views(app) {
  const windows = async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
    id: w.id, url: w.webContents.getURL(), visible: w.isVisible(), onTop: w.isAlwaysOnTop(), bounds: w.getBounds(),
  })));
  const isWidget = (w) => /widget\.html/.test(w.url);
  return {
    windows,
    main: async () => (await windows()).find((w) => !isWidget(w)),
    widget: async () => (await windows()).find(isWidget),
    widgetPage: () => app.windows().find((p) => /widget\.html/.test(p.url())),
    mainPage: () => app.windows().find((p) => p.url().startsWith(URL)),
  };
}

async function quit(app) {
  await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
  await app.close().catch(() => {});
}

// --- Run 1: defaults ---
async function firstRun() {
  const app = await launch(path.join(TMP, 'userData'));
  const v = views(app);
  try {
    console.log('\nStarting');
    chk('the app starts the engine itself when none is running', await until(up, 90000));
    chk('the dashboard opens in its own window, not a browser', await until(async () => (await v.main())?.url.startsWith(URL), 30000)
      && (await v.main()).visible, JSON.stringify(await v.windows()));
    const w0 = await v.widget();
    chk('the floating brain exists, hidden while the dashboard shows, on top, 220 px square by default',
      !!w0 && !w0.visible && w0.onTop && w0.bounds.width === 220 && w0.bounds.height === 220, JSON.stringify(w0));
    await v.mainPage().screenshot({ path: path.join(SHOTS, 'desktop-main.png') });

    console.log('\nMinimise');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('http')).minimize());
    chk('minimising the dashboard leaves just the floating brain', await until(async () => !(await v.main()).visible && (await v.widget()).visible, 5000),
      JSON.stringify(await v.windows()));
    const w1 = await v.widget();
    chk('the brain starts in the bottom-right corner of the screen', w1.bounds.x > 300 && w1.bounds.y > 200, JSON.stringify(w1.bounds));
    const page = v.widgetPage();
    chk('the badge shows what is left, rose because something is late', await until(() => page.evaluate(() => {
      const b = document.getElementById('badge');
      return !b.hidden && b.textContent === '1' && b.classList.contains('attention');
    }), 40000), await page.evaluate(() => document.getElementById('badge').outerHTML));
    chk('hovering the brain names what is next', /Renew the test permit/.test(await page.evaluate(() => document.body.title)),
      await page.evaluate(() => document.body.title));
    chk('the brain is drawn edge to edge at the window size', await page.evaluate(() => {
      const c = document.getElementById('brain');
      return c.getBoundingClientRect().width === 220 && c.width >= 220;
    }));
    const frames = [];
    for (let i = 0; i < 2; i++) {
      frames.push(await page.evaluate(() => document.getElementById('brain').toDataURL()));
      await sleep(400);
    }
    chk('the brain is animated (frames differ)', frames[0] !== frames[1]);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-widget.png'), omitBackground: true });

    console.log('\nClick');
    await page.mouse.move(110, 110);
    await page.mouse.down();
    await page.mouse.up();
    chk('clicking the brain brings the dashboard back and hides the brain', await until(async () => (await v.main()).visible && !(await v.widget()).visible, 5000),
      JSON.stringify(await v.windows()));

    console.log('\nClose');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('http')).close());
    chk('closing the dashboard hides it to the brain; Alfred keeps running', await until(async () => {
      const m = await v.main();
      return m && !m.visible && (await v.widget()).visible;
    }, 5000), JSON.stringify(await v.windows()));
    chk('the window state is saved for next time', await until(() => fs.existsSync(path.join(TMP, 'userData', 'state.json')), 3000));

    console.log('\nQuit');
    await quit(app);
    chk('quitting stops the engine the app started', await until(async () => !(await up()), 15000));
  } catch (err) {
    fails.push(`run 1 crashed: ${err.message}`);
    console.log(`  FAIL  run 1 crashed: ${err.stack}`);
    await quit(app);
  }
}

// --- Run 2: started with Windows (hidden), the first version's saved spot, "keep on top" off ---
async function secondRun() {
  const userData = path.join(TMP, 'userData2');
  const stateFile = path.join(userData, 'state.json');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ widget: { x: 100, y: 100 }, widgetSize: 320, pinned: false }));
  const app = await launch(userData, ['--hidden']);
  const v = views(app);
  const saved = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
  try {
    console.log('\nSaved spot, size and pin');
    chk('started with Windows, only the brain shows', await until(async () => (await v.widget())?.visible && !(await v.main())?.visible, 15000),
      JSON.stringify(await v.windows()));
    const w = await v.widget();
    chk('the spot and size saved by the first version are kept (320 px at 100,100)',
      w.bounds.width === 320 && w.bounds.height === 320 && w.bounds.x === 100 && w.bounds.y === 100, JSON.stringify(w.bounds));
    chk('"keep on top" off: the brain sits among other windows', w.onTop === false, JSON.stringify(w));
    chk('turning "keep on top" back on applies at once', await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((x) => /widget\.html/.test(x.webContents.getURL()));
      win.setAlwaysOnTop(true, 'floating');
      return win.isAlwaysOnTop();
    }));
    chk('the brain lights up once the engine answers (not left grey)', await until(() => v.widgetPage().evaluate(() => {
      const b = document.getElementById('badge');
      return !b.hidden && b.textContent === '1';
    }), 60000), await v.widgetPage().evaluate(() => document.body.title));
    await sleep(800);
    await v.widgetPage().screenshot({ path: path.join(SHOTS, 'desktop-widget-large.png'), omitBackground: true });

    await v.widgetPage().evaluate(() => window.alfred.send('widget:clear-home'));
    chk('clearing the saved spot puts the brain back in the corner at the default size, and forgets it',
      await until(async () => {
        const b = (await v.widget()).bounds;
        return b.width === 220 && b.x > 300 && !saved().home;
      }, 5000), JSON.stringify({ bounds: (await v.widget()).bounds, state: saved() }));
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((x) => /widget\.html/.test(x.webContents.getURL())).setBounds({ x: 140, y: 120, width: 260, height: 260 });
    });
    await v.widgetPage().evaluate(() => window.alfred.send('widget:save-home'));
    chk('saving keeps this spot and size for next time', await until(() => {
      const h = saved().home;
      return !!h && h.x === 140 && h.y === 120 && h.size === 260;
    }, 5000), JSON.stringify(saved()));
    await quit(app);
    await until(async () => !(await up()), 15000);
  } catch (err) {
    fails.push(`run 2 crashed: ${err.message}`);
    console.log(`  FAIL  run 2 crashed: ${err.stack}`);
    await quit(app);
  }
}

if (await up()) { console.log(`port ${PORT} is already taken; stop whatever holds it first`); process.exit(1); }
try {
  await firstRun();
  await secondRun();
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; } else console.log('OK');
