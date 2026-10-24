// P0 regression harness for the Blend redesign (see the implementation plan,
// section 4, "P0 — Regression harness"). This suite pins the shipped behaviour
// the redesign must not break — the terminal tab strip, grid-mode refit, the
// unread dot, the Interns catalog search,
// and the Brain graph's click-to-open-panel path — at three widths. It MUST
// be green against the code as it stands before any redesign edit lands; a
// harness that has never passed on the old code proves nothing about the new
// code, so every later phase's exit criterion is "P0 still green."
//
// Port discipline: this suite boots its own server (fixture vault,
// ALFRED_COUNCIL_STUB_DIR so every registry seat is ready, ALFRED_TERM_STUB_CMD
// so opening a console never shells out to a real signed-in CLI) exactly like
// terminals.mjs does, on ALFRED_TERM_TEST_PORT. Never port 7777 — that is the
// operator's live session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const R = [];
const chk = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-redesign-'));
// Echoes whatever it is sent, exactly like terminals.mjs's stub console — the
// whole point is exercising the real spawn/attach/io path with no signed-in CLI.
const echoScript = 'process.stdout.write("ALFRED_TERM_OK\\n");'
  + 'process.stdin.setEncoding("utf8");'
  + 'process.stdin.on("data",function(d){process.stdout.write("GOT:"+d);});';

const PORT = Number(process.env.ALFRED_TERM_TEST_PORT || 7797);
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
    // The Day view auto-opens a sign-in console for a signed-out seat; never on a test run.
    ALFRED_CC_DRY_RUN: '1',
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
  chk('redesign test server boots', false, serverLog.slice(-800));
} else {
  const html = await (await fetch(BASE + '/')).text();
  const TOKEN = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1];
  const H = { 'X-Alfred-Token': TOKEN, 'Content-Type': 'application/json' };

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const WIDTHS = [1024, 1440, 1920];

  for (const width of WIDTHS) {
    const tag = (n) => `[${width}px] ${n}`;
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    // The poll scheduler freezes on document.hidden — a headless page can
    // report hidden depending on how it was launched (see search-nav.mjs).
    await ctx.addInitScript(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // Stub the catalog lookup — assertion 4 must not depend on reaching the
    // real ollama.com search from a test run.
    await page.route('**/api/interns/catalog*', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ results: ['qwen3.5:9b', 'qwen3.5:4b', 'qwen2.5-coder:1.5b'], tags: [] }),
    }));

    await page.goto(BASE + '/?nogate=1', { waitUntil: 'domcontentloaded' });
    await page.click('#landing').catch(() => {});
    await page.waitForTimeout(1200);

    // The Bench (and its <=1180px auto-narrow rail) was retired in the
    // everything-bar redesign — seats, Local GPU and status all live in the
    // composer now, at every width. rail-collapsed/bench-tight still exist
    // as inert body classes (nothing reads them anymore); this clears them
    // defensively in case a stale localStorage value from an older build is
    // present in the test profile.
    await page.evaluate(() => {
      try { localStorage.setItem('alfred-rail-collapsed', '0'); } catch (e) { /* localStorage unavailable */ }
      document.body.classList.remove('bench-tight', 'rail-collapsed');
    });

    // --- the Day place is the default landing ---------------------------------
    // No hash: the app opens on Day (not the Brain), and the nav is Day then Brain with
    // Day active. Command is no longer a tab (still reachable by hash and key 3, which the
    // Command section below uses). Instant checks only: the Command section that follows
    // races a once-per-page terminal re-attach, so nothing here may add delay before it.
    chk(tag('with no hash the app lands on the Day view'), await page.evaluate(() =>
      !document.getElementById('pane-day').hidden && document.getElementById('pane-brain').hidden
      && document.getElementById('pane-command').hidden));
    chk(tag('the nav is Day then Brain, Day active, and there is no Command tab'), await page.evaluate(() => {
      const b = [...document.querySelectorAll('#views .view-btn')];
      return b.map((x) => x.dataset.view).join(',') === 'day,brain' && b[0].classList.contains('active')
        && b[0].getAttribute('aria-selected') === 'true' && !b[1].classList.contains('active');
    }));

    // --- the Command place: tab strip, grid mode, unread dot, seats -------
    // Seats now render on the Bench (#cc-seats), visible on every place —
    // P5 moved them out of the Command pane's old "Lanes" section and moved
    // pollCommandCenter into GLOBAL_POLLS to match. Every control that used
    // to sit directly on a seat card (model, open/native/sign-in) now lives behind that row's own
    // "..." popover (#seat-popover) — plan §3.2.
    await page.evaluate(() => { location.hash = 'command'; }); // no tab any more: hash (or key 3)
    await page.waitForFunction(
      () => document.querySelectorAll('#cc-seats .seat').length > 0,
      null, { timeout: 10000 },
    ).catch(() => {});

    const seatMoreBtns = page.locator('#cc-seats .seat-more');
    const seatRowCount = await seatMoreBtns.count();

    // Opening a seat's popover replaces whatever popover was already open,
    // so consoles are opened one at a time: open a row's "...", check for
    // an "Open terminal" button inside the shared popover, click it if
    // present, then move to the next row.
    let openedIds = [];
    let openedCount = 0;
    for (let i = 0; i < seatRowCount && openedCount < 2; i++) {
      await seatMoreBtns.nth(i).click();
      const openBtn = page.locator('#seat-popover button:has-text("Open terminal")');
      if (await openBtn.count()) {
        await openBtn.first().click();
        openedCount++;
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    chk(tag('at least 2 ready tty seats to open a console on'), openedCount >= 2, `opened=${openedCount} of ${seatRowCount} seats`);

    if (openedCount >= 2) {
      // --- 1. terminal tab strip -----------------------------------------
      await page.waitForFunction(
        () => document.querySelectorAll('#cc-tabs .cc-tab').length === 2,
        null, { timeout: 10000 },
      ).catch(() => {});

      const tabCount = await page.locator('#cc-tabs .cc-tab').count();
      const activeTabCount = await page.locator('#cc-tabs .cc-tab.active').count();
      let dbg = await page.evaluate(() => window.__ccDebug());
      openedIds = dbg.map((d) => d.id);
      chk(tag('opening 2 consoles produces exactly 2 tabs'), tabCount === 2, `tabCount=${tabCount}`);
      chk(tag('exactly one tab is active'), activeTabCount === 1, `activeTabCount=${activeTabCount}`);
      // Only the focused pane is laid out outside grid mode — its sibling is
      // legitimately display:none (a single-focus tab strip, by design) until
      // grid mode (assertion 2) makes every pane visible at once.
      const focused1 = dbg.find((d) => d.active);
      chk(tag('the focused console has a laid-out (nonzero-width) pane'),
        dbg.length === 2 && !!focused1 && focused1.rect.width > 0, JSON.stringify(dbg.map((d) => d.rect.width)));

      // --- 2. grid mode ----------------------------------------------------
      // Real OS-level Ctrl+\ is delivered to whatever has focus; a just-opened
      // terminal holds it, and xterm's own attachCustomKeyEventHandler AND the
      // page-level window keydown listener both call ccHandleGlobalShortcut for
      // the same event as it bubbles — a double-toggle that nets to no visible
      // change. Drive the grid toggle button directly: it is the exact same
      // ccToggleGridMode()/ccSetGridMode() code path, without that ambiguity.
      await page.click('#cc-grid-toggle');
      await page.waitForFunction(
        () => document.getElementById('cc-terms').classList.contains('cc-grid'),
        null, { timeout: 5000 },
      ).catch(() => {});
      await sleep(300); // ccSetGridMode's own 60ms refit sweep, with margin

      const gridOn = await page.evaluate(() => document.getElementById('cc-terms').classList.contains('cc-grid'));
      dbg = await page.evaluate(() => window.__ccDebug());
      chk(tag('the grid-mode toggle turns on grid mode'), gridOn);
      chk(tag('every console refits in grid mode (width > 0)'),
        dbg.length === 2 && dbg.every((d) => d.rect.width > 0), JSON.stringify(dbg.map((d) => d.rect.width)));
      chk(tag('every console refits in grid mode (rows > 0)'),
        dbg.length === 2 && dbg.every((d) => d.rows > 0), JSON.stringify(dbg.map((d) => d.rows)));

      // Unread is only marked outside grid mode (every pane is already visible
      // in grid mode) — leave grid mode before the unread check.
      await page.click('#cc-grid-toggle');
      await page.waitForFunction(
        () => !document.getElementById('cc-terms').classList.contains('cc-grid'),
        null, { timeout: 5000 },
      ).catch(() => {});

      // --- 3. unread dot on a backgrounded tab -----------------------------
      dbg = await page.evaluate(() => window.__ccDebug());
      const activeEntry = dbg.find((d) => d.active);
      const bgEntry = dbg.find((d) => !d.active);
      if (bgEntry) {
        // A second, independent WebSocket to the backgrounded terminal — the
        // server broadcasts its output to every attached client, including
        // the page's own already-open socket for that terminal (the same
        // mechanism terminals.mjs's `attach()` exercises).
        const bgWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal/${bgEntry.id}?token=${encodeURIComponent(TOKEN)}`, { origin: BASE });
        await new Promise((resolve, reject) => {
          bgWs.on('open', resolve);
          bgWs.on('error', reject);
          setTimeout(() => reject(new Error('ws open timeout')), 5000);
        }).catch(() => {});
        bgWs.send(JSON.stringify({ type: 'input', data: 'ping\r' }));
        await page.waitForFunction(
          () => !!document.querySelector('#cc-tabs .cc-tab.has-unread'),
          null, { timeout: 8000 },
        ).catch(() => {});
        try { bgWs.close(); } catch { /* fine */ }

        const unreadTabCount = await page.locator('#cc-tabs .cc-tab.has-unread').count();
        const activeHasUnread = await page.evaluate(() => !!document.querySelector('#cc-tabs .cc-tab.active.has-unread'));
        dbg = await page.evaluate(() => window.__ccDebug());
        const bgAfter = dbg.find((d) => d.id === bgEntry.id);
        chk(tag('a backgrounded tab that receives output gets the unread dot'),
          unreadTabCount === 1 && !activeHasUnread, `unreadTabCount=${unreadTabCount} activeHasUnread=${activeHasUnread}`);
        chk(tag('the debug hook reports unread on that backgrounded console'),
          !!(bgAfter && bgAfter.unread === true), JSON.stringify(bgAfter));
      } else {
        chk(tag('a backgrounded tab exists to test unread on'), false, JSON.stringify(dbg));
      }

      // Clean up so the next width starts with no leftover consoles — a
      // second-page load would otherwise reattach these via ccReattachTerminals
      // and throw off the "exactly 2 tabs" assertion for the next width.
      for (const id of openedIds) {
        await fetch(`${BASE}/api/terminals/${id}/kill`, { method: 'POST', headers: H, body: '{}' }).catch(() => {});
      }
    }

    // --- 4. Interns catalog search ---------------------------------------
    // Local GPU moved off the retired Bench into the composer's tools row
    // (everything-bar redesign) as a native <details id="composer-tool-
    // interns">; #intern-toggle is gone (the outer <details> itself is the
    // open/close control now) — open it, then the "Available" <details>
    // nested inside it (itself still closed by default, only "Installed"
    // starts open) to reach the pull input at all.
    await page.evaluate(() => {
      document.getElementById('composer-tool-interns').open = true;
      document.getElementById('intern-section-available').open = true;
    });
    await page.fill('#intern-pull-input', '');
    await page.fill('#intern-pull-input', 'qwen');
    await page.dispatchEvent('#intern-pull-input', 'input');
    await page.waitForFunction(
      () => document.querySelectorAll('#intern-catalog-results .intern-catalog-item').length > 0,
      null, { timeout: 5000 },
    ).catch(() => {});
    const catalogCount = await page.locator('#intern-catalog-results .intern-catalog-item').count();
    chk(tag('typing a model name searches the Interns catalog'), catalogCount > 0, `count=${catalogCount}`);
    // Close it before the next section — Local GPU's popover and the seat
    // strip share the same small area at the foot of the screen, and a left-
    // open <details> would otherwise cover the "..." buttons clicked next
    // (the app itself now guards this too: opening a seat popover closes any
    // open .composer-tool, and vice versa — this mirrors that for the test).
    await page.evaluate(() => { document.getElementById('composer-tool-interns').open = false; });

    // (Section 5, the web-surface "Open panel" label, was dropped with the
    // DeepSeek Harness seat 2026-10-23 — no registered seat is web-surfaced.)

    // --- 5b. Focus mechanism (plan §3.2/§4 P5) -----------------------------
    // Clicking a seat's row body sets body[data-focus-seat] and re-tints
    // --accent-primary — the one CSS variable 85+ call sites already read.
    if (seatRowCount > 0) {
      const before = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent-primary').trim());
      await page.locator('#cc-seats .seat-main').first().click();
      const seatIdAfter = await page.evaluate(() => document.body.dataset.focusSeat || '');
      // --focus is registered via @property and transitions over --t-focus
      // (420ms) — reading the computed value in the same tick as the click
      // would still show the pre-transition value. Wait past the transition.
      await sleep(500);
      const after = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent-primary').trim());
      chk(tag('clicking a seat sets body[data-focus-seat]'), seatIdAfter.length > 0, `focusSeat="${seatIdAfter}"`);
      chk(tag('focusing a seat changes --accent-primary'), before !== after, `before="${before}" after="${after}"`);
    }

    // --- 6. Brain: click a node opens the panel ----------------------------
    // P4 contained #graph inside .brain-canvas — worldToScreen/__alfredDebug's
    // `screen` coordinates are canvas-LOCAL now (relative to the canvas's own
    // box), not page-absolute, because the canvas no longer sits at (0,0)
    // filling the viewport. A real click reports clientX/Y in PAGE space, so
    // this is the coordinate-space offset test itself (plan §2.4/§4 P4): it
    // adds the canvas's own getBoundingClientRect() to worldToScreen's output
    // and drives a REAL page.mouse.click() there — a plausible-but-offset
    // graph (the exact silent failure mode P4 risks) would land on the wrong
    // node or nothing, not just fail a synthetic dispatchEvent that skipped
    // the coordinate translation entirely. Checked against 3 distinct nodes,
    // not 1, so an off-by-a-constant error can't coincidentally cancel out.
    await page.click('[data-view="brain"]');
    await sleep(1500); // let the force layout settle before reading node positions
    chk(tag('the Brain graph fills its pane (the Today panel moved to the Day view)'), await page.evaluate(() => {
      const c = document.querySelector('.brain-canvas').getBoundingClientRect();
      const p = document.getElementById('pane-brain').getBoundingClientRect();
      return !document.getElementById('assistant') && Math.abs(c.width - p.width) < 2;
    }));
    const dbg = await page.evaluate(() => window.__alfredDebug ? window.__alfredDebug() : null);
    const canvasRect = await page.evaluate(() => document.getElementById('graph').getBoundingClientRect().toJSON());
    const nodeCount = dbg && dbg.nodes ? dbg.nodes.length : 0;
    chk(tag('the brain graph has at least one node to click'), nodeCount > 0, `count=${nodeCount}`);
    if (nodeCount > 0) {
      const sampleIdx = [0, Math.floor(nodeCount / 2), nodeCount - 1]
        .filter((v, i, a) => a.indexOf(v) === i); // de-dupe when nodeCount < 3
      for (const i of sampleIdx) {
        const node = dbg.nodes[i];
        const local = dbg.screen[i];
        const pageX = canvasRect.x + local.x;
        const pageY = canvasRect.y + local.y;
        await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
        await page.mouse.click(pageX, pageY);
        await page.waitForFunction(
          () => document.getElementById('panel').classList.contains('open'),
          null, { timeout: 5000 },
        ).catch(() => {});
        const open = await page.evaluate(() => document.getElementById('panel').classList.contains('open'));
        const title = await page.evaluate(() => (document.getElementById('panel-title').textContent || '').trim());
        chk(tag(`clicking node "${node.title}" at its computed screen position opens #panel`), open,
          `node=${node.title} local=(${local.x.toFixed(1)},${local.y.toFixed(1)}) page=(${pageX.toFixed(1)},${pageY.toFixed(1)})`);
        chk(tag(`the opened panel title matches node "${node.title}" exactly`), title === node.title,
          `expected="${node.title}" actual="${title}"`);
      }
    }

    // The feed carries `calendar` once Google is connected, and a test run never is. Inject one Google
    // event for today into the real feed, so the calendar card and "Today on the calendar" are checked
    // against the shape the server sends rather than against a stub of the whole page.
    await page.route('**/api/assistant', async (route) => {
      const resp = await route.fetch();
      const j = await resp.json();
      const iso = j.date || new Date().toISOString().slice(0, 10);
      j.brain = j.brain || 'test-brain';
      j.calendar = {
        configured: true, connected: true, account: 'me@example.com', brainCalendarId: 'b@x', lastSync: null, lastError: null,
        from: iso, to: iso, fetchedAt: new Date().toISOString(), calendars: [],
        days: { [iso]: [{ id: 'e1', calendar: 'Home', calendarId: 'home@x', color: '#4cc9ff', brain: false, title: 'Test event',
          allDay: false, start: iso + 'T09:30:00-04:00', end: iso + 'T10:00:00-04:00', time: '09:30', location: null,
          invite: true, response: 'needsAction', brainFile: null }] },
      };
      await route.fulfill({ response: resp, json: j });
    });

    // --- Day: key 1 returns to it; the date header and the bench strip are mounted -------
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press('1');
    await page.waitForFunction(() => !document.getElementById('pane-day').hidden, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => /,/.test(document.getElementById('day-date').textContent), null, { timeout: 8000 }).catch(() => {});
    chk(tag('key 1 returns to Day, with the weekday date header and the bench strip mounted'), await page.evaluate(() =>
      !document.getElementById('pane-day').hidden
      && /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}$/.test(document.getElementById('day-date').textContent)
      && !!document.getElementById('bench') && !!document.getElementById('signin-banner')));

    // --- Day: the calendar (month grid, today, dots, agenda, today's events) ------------
    await page.waitForFunction(() => !!document.querySelector('.cal-event'), null, { timeout: 8000 }).catch(() => {});
    chk(tag('Day: the Calendar card tops column 2 with a 6-week grid (42 day buttons)'), await page.evaluate(() => {
      const cols = document.querySelectorAll('.day-col');
      const card = cols[1] && cols[1].firstElementChild;
      return !!card && card.classList.contains('cal-card') && card.querySelectorAll('.cal-grid > button.cal-day').length === 42
        && /\b20\d\d\b/.test((card.querySelector('.cal-month') || {}).textContent || '');
    }));
    chk(tag('Day: today is ringed and selected, with one roving tab stop, and its agenda is shown'), await page.evaluate(() => {
      const t = document.querySelectorAll('.cal-day.today');
      return t.length === 1 && t[0].classList.contains('selected') && t[0].getAttribute('aria-current') === 'date'
        && document.querySelectorAll('.cal-day[tabindex="0"]').length === 1 && !!document.querySelector('.cal-agenda');
    }));
    chk(tag('Day: a pending invitation is a hollow dot, its event is in the agenda, and "Today on the calendar" lists it'), await page.evaluate(() => {
      const t = document.querySelector('.cal-day.today');
      const first = document.querySelector('.day-col').firstElementChild;
      return t.querySelectorAll('.cal-dot.hollow').length === 1 && /invite · needs answer/.test(document.querySelector('.cal-agenda').textContent)
        && /Today on the calendar/.test(first.textContent) && /\b1 event\b/.test(document.getElementById('day-summary').textContent);
    }));

    // --- 7/8. no uncaught JS errors, at this width -------------------------
    chk(tag('no uncaught JS errors'), errs.length === 0, errs.slice(0, 3).join(' | '));

    await ctx.close();
  }

  await browser.close();
}

// Explicit, not just the `process.on('exit', ...)` registration above — a live
// child process keeps this script's event loop alive, so without an explicit
// call here the process never reaches its own natural exit and just hangs
// after printing nothing (terminals.mjs has the same explicit call for the
// same reason).
stopServer();
try { fs.rmSync(stub, { recursive: true, force: true }); } catch { /* temp */ }

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 300)));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
