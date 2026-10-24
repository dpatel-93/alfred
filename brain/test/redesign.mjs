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

    // The feed carries `calendar` (parsed from Calendar/events.md), and the fixture vault has no such
    // file. Inject the shape the server sends into the real feed: one timed event today with a place
    // and an author, plus one all-day event that spans today and tomorrow, with one unreadable line,
    // so the calendar card and "Today on the calendar" are checked against the real feed shape
    // rather than against a stub of the whole page.
    await page.route('**/api/assistant', async (route) => {
      // A poll can still be in flight when the context closes; that must not become an unhandled rejection.
      let resp, j;
      try { resp = await route.fetch(); j = await resp.json(); } catch { return route.abort().catch(() => {}); }
      const iso = j.date || new Date().toISOString().slice(0, 10);
      const day = (n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
      const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1];
      j.brain = j.brain || 'test-brain';
      // The add/edit checks below need known reminder and routine rows, whatever brain the server found.
      j.today = [{ file: 'Reminders/test-call-plumber.md', title: 'Call the plumber', kind: 'reminder', due: iso, time: '09:30',
        scope: 'personal', author: 'grok', ours: true, pending: false }];
      j.routines = {
        today: [{ file: 'Routines/test-walk.md', title: 'Morning walk', schedule: 'daily', status: 'active', today: true }],
        other: [
          { file: 'Routines/test-review.md', title: 'Weekly review', schedule: 'Fridays', status: 'active', today: false },
          { file: 'Routines/test-odd.md', title: 'Deep clean', schedule: 'every other Friday', status: 'active', today: false },
        ],
        paused: [{ file: 'Routines/test-water.md', title: 'Water the plants', schedule: 'Mondays and Thursdays 08:00', time: '08:00',
          status: 'paused', today: false }],
      };
      const timed = { id: 'ev-1', title: 'Test event', date: iso, end: null, time: '09:30', endTime: '10:00', allDay: false,
        location: 'Room 4', by: 'grok', line: 8 };
      const span = { id: 'ev-2', title: 'Team offsite', date: iso, end: day(1), time: null, endTime: null, allDay: true,
        location: null, by: 'claude-code', line: 9 };
      j.calendar = {
        source: 'file', file: 'Calendar/events.md', exists: true,
        from: new Date(Date.UTC(y, m - 1, 1, 12)).toISOString().slice(0, 10),
        to: new Date(Date.UTC(y, m + 2, 0, 12)).toISOString().slice(0, 10),
        count: 2,
        days: { [iso]: [timed, { ...span, spanStart: true, spanEnd: false }], [day(1)]: [{ ...span, date: day(1), spanStart: false, spanEnd: true }] },
        problems: [{ line: 12, text: '- 2026-13-40 broken line' }],
      };
      await route.fulfill({ response: resp, json: j }).catch(() => {});
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

    // Layout the user asked for: everything to act on on the left, the calendar alone in
    // the middle, Grok's brief leading the right, and no "Since you last looked" card.
    const dayLayout = await page.evaluate(() => [...document.querySelectorAll('.day-col')].map((c) =>
      [...c.children].map((card) => {
        const h = card.firstElementChild;
        return card.classList.contains('cal-card') ? 'CALENDAR' : String((h && h.firstChild && h.firstChild.textContent) || '').trim();
      })));
    const leftTitles = dayLayout[0] || [];
    chk(tag('Day: due today, this week and to-dos are in the left column, in that order'),
      ['Due today', 'This week', 'To-dos'].every((t) => leftTitles.includes(t))
        && leftTitles.indexOf('Due today') < leftTitles.indexOf('This week')
        && leftTitles.indexOf('This week') < leftTitles.indexOf('To-dos'), JSON.stringify(dayLayout));
    chk(tag('Day: the calendar has the middle column to itself'),
      JSON.stringify(dayLayout[1]) === '["CALENDAR"]', JSON.stringify(dayLayout[1]));
    chk(tag("Day: Grok's morning brief leads the right column"),
      (dayLayout[2] || [])[0] === "Grok's morning brief", JSON.stringify(dayLayout[2]));
    chk(tag('Day: there is no "Since you last looked" card'),
      !dayLayout.flat().some((t) => /since you last looked/i.test(t)), JSON.stringify(dayLayout));

    // --- Day: Tell Grok, the desk box. The server's answer is stubbed: Grok is never called here. ---
    await page.route('**/api/assistant/tell-grok', async (route) => {
      let sent = {};
      try { sent = JSON.parse(route.request().postData() || '{}'); } catch { /* checked below */ }
      await route.fulfill({ json: { via: 'grok', reply: `Got it: ${sent.text}.`,
        saved: [{ type: 'reminder', kind: 'reminder', title: 'Call the plumber', due: 'none', file: 'Reminders/x.md' }], skipped: [] } }).catch(() => {});
    });
    const tgBox = await page.evaluate(() => {
      const f = document.getElementById('tell-grok');
      return !!f && !!f.querySelector('input#tell-grok-input') && /Tell Grok/.test(f.textContent);
    });
    chk(tag('Day: the Tell Grok box sits in the Day header'), tgBox);
    await page.fill('#tell-grok-input', 'remind me to call the plumber');
    await page.press('#tell-grok-input', 'Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Got it: remind me to call the plumber/.test(t.textContent)),
      null, { timeout: 6000 }).catch(() => {});
    chk(tag("Day: sending to Grok shows Grok's reply and what was saved, and clears the box"), await page.evaluate(() =>
      [...document.querySelectorAll('.toast')].some((t) => /Got it: remind me to call the plumber/.test(t.textContent) && /Reminder: Call the plumber/.test(t.textContent))
      && document.getElementById('tell-grok-input').value === '' && !document.getElementById('tell-grok-input').disabled));
    await page.unroute('**/api/assistant/tell-grok').catch(() => {});
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
    chk(tag("Day: today's cell shows an event dot for each of the 2 events, and none is hollow"), await page.evaluate(() => {
      const t = document.querySelector('.cal-day.today');
      return t.querySelectorAll('.cal-dot:not(.rem)').length === 2 && t.querySelectorAll('.cal-dot.hollow').length === 0;
    }));
    chk(tag('Day: the agenda lists the timed event with its time range, place and author, and the all-day one'), await page.evaluate(() => {
      const a = document.querySelector('.cal-agenda').textContent;
      return /09:30–10:00/.test(a) && /Test event/.test(a) && /Room 4/.test(a) && /Grok/.test(a)
        && /all day/.test(a) && /Team offsite/.test(a) && /Claude/.test(a);
    }));
    chk(tag('Day: "Today on the calendar" leads column 1 and lists the timed event'), await page.evaluate(() => {
      const first = document.querySelector('.day-col').firstElementChild;
      return /Today on the calendar/.test(first.textContent) && /Test event/.test(first.textContent) && /09:30–10:00/.test(first.textContent);
    }));
    chk(tag('Day: the day summary says "2 events"'), await page.evaluate(() =>
      /\b2 events\b/.test(document.getElementById('day-summary').textContent)));
    chk(tag('Day: the note under the grid counts the month and links the events file; unreadable lines get a warning'), await page.evaluate(() => {
      const notes = [...document.querySelectorAll('.cal-card .cal-note')];
      const count = notes.find((n) => /events this month/.test(n.textContent));
      const warn = notes.find((n) => n.classList.contains('warn'));
      return !!count && /^2 events this month · Calendar\/events\.md$/.test(count.textContent)
        && !!count.querySelector('button.cal-link') && !!warn
        && /^1 line in Calendar\/events\.md could not be read$/.test(warn.textContent) && /12/.test(warn.title);
    }));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
    await page.click('.cal-agenda .cal-event');
    await page.waitForFunction(() => document.getElementById('panel').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    chk(tag('Day: clicking an event opens Calendar/events.md in the reader'), await page.evaluate(() =>
      document.getElementById('panel').classList.contains('open') && /Calendar/.test(document.getElementById('panel-title').textContent)));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
    chk(tag('Day: the page served at / has no Google Calendar and no /api/calendar/ calls left in it'), await page.evaluate(async () => {
      const src = await fetch('/').then((r) => r.text());
      return !src.includes('/api/calendar/') && !src.includes('Google Calendar');
    }));

    // --- Day: add and edit (the item editor) ---------------------------------------------
    // POST /api/assistant/item is stubbed: it records the body and answers like the server does (a
    // saved summary, no feed, so the page re-reads the injected one). The real server is never written to.
    const itemCalls = [];
    let itemAnswer = null;   // { status, json } to answer the next save with, once, instead of success
    await page.route('**/api/assistant/item', async (route) => {
      let sent = {};
      try { sent = JSON.parse(route.request().postData() || '{}'); } catch { /* checked below */ }
      itemCalls.push(sent);
      if (itemAnswer) {
        const a = itemAnswer; itemAnswer = null;
        return route.fulfill({ status: a.status, json: a.json }).catch(() => {});
      }
      await route.fulfill({ json: { ok: true, saved: { type: sent.type, title: (sent.fields && sent.fields.title) || 'Saved item',
        file: sent.file || 'Reminders/x.md' } } }).catch(() => {});
    });
    await page.waitForFunction(() => /Call the plumber/.test((document.getElementById('day-body') || {}).textContent || ''),
      null, { timeout: 8000 }).catch(() => {});
    const ie = '.ie-modal';
    const openAdd = async () => { await page.click('#day-add'); await page.waitForSelector(ie, { timeout: 4000 }); };
    const dialogGone = () => page.waitForFunction(() => !document.querySelector('.ie-modal'), null, { timeout: 4000 }).catch(() => {});
    const waitCalls = async (n) => { const t = Date.now(); while (itemCalls.length < n && Date.now() - t < 4000) await sleep(50); };
    const save = () => page.click(ie + ' button[type="submit"]');
    const lastCall = () => JSON.stringify(itemCalls[itemCalls.length - 1] || null);

    chk(tag('Day: the header has a + Add button beside Refresh'), await page.evaluate(() => {
      const t = document.querySelector('.day-tools');
      const kids = t ? [...t.children].map((c) => c.id) : [];
      return JSON.stringify(kids) === '["day-add","day-refresh"]' && /\+ Add/.test(document.getElementById('day-add').textContent);
    }));

    // + Add opens a labelled modal dialog with focus inside; Tab stays in it; Esc closes it and focus returns.
    await openAdd();
    chk(tag('Day: + Add opens a modal dialog, labelled by its title, with focus inside it'), await page.evaluate(() => {
      const d = document.querySelector('.ie-modal');
      const label = d && document.getElementById(d.getAttribute('aria-labelledby'));
      return !!d && d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true'
        && !!label && /Add to your day/.test(label.textContent) && d.contains(document.activeElement)
        && document.querySelectorAll('.ie-type').length === 5
        && document.querySelector('.ie-type[aria-pressed="true"]').textContent === 'To-do';
    }));
    const inside = [];
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press(i % 2 ? 'Tab' : 'Shift+Tab');
      inside.push(await page.evaluate(() => document.querySelector('.ie-modal').contains(document.activeElement)));
    }
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      inside.push(await page.evaluate(() => document.querySelector('.ie-modal').contains(document.activeElement)));
    }
    chk(tag('Day: Tab and Shift+Tab never leave the open dialog'), inside.every(Boolean), inside.join(','));
    await page.focus(ie + ' .icon-btn');
    await page.keyboard.press('Shift+Tab');
    chk(tag('Day: Shift+Tab from the first control wraps to Save, and Tab from Save wraps back to the first'), await page.evaluate(() =>
      document.activeElement.type === 'submit') && await (async () => {
      await page.keyboard.press('Tab');
      return page.evaluate(() => document.activeElement.classList.contains('icon-btn'));
    })());
    await page.keyboard.press('Escape');
    await dialogGone();
    chk(tag('Day: Esc closes the dialog and focus returns to the + Add button'), await page.evaluate(() =>
      !document.querySelector('.ie-modal') && !document.querySelector('.scrim.open') && document.activeElement.id === 'day-add'));

    // A To-do: title, scope, note. Sent as a reminder of kind todo with no date.
    await openAdd();
    chk(tag('Day: the To-do form has no date, no time and no schedule fields'), await page.evaluate(() =>
      ['ie-f-date', 'ie-f-time', 'ie-f-freq', 'ie-f-end'].every((id) => !document.getElementById(id).offsetParent)
      && !!document.getElementById('ie-f-scope').offsetParent && !!document.getElementById('ie-f-note').offsetParent));
    await save();
    chk(tag('Day: saving with no title is refused inline and sends nothing'), await page.evaluate(() => {
      const e = document.querySelector('.ie-error');
      return !!document.querySelector('.ie-modal') && e.getAttribute('role') === 'alert' && !e.hidden && /title/i.test(e.textContent);
    }) && itemCalls.length === 0);
    await page.fill('#ie-f-title', 'Buy stamps');
    await save();
    await waitCalls(1);
    await dialogGone();
    chk(tag('Day: adding a To-do sends a reminder of kind todo with due none'), lastCall() === JSON.stringify({ op: 'create',
      type: 'reminder', fields: { kind: 'todo', title: 'Buy stamps', due: 'none', time: null, scope: 'personal', note: '' } }), lastCall());
    chk(tag('Day: after a save the dialog is gone, a Saved toast shows, and focus is back on + Add'), await page.evaluate(() =>
      !document.querySelector('.ie-modal') && [...document.querySelectorAll('.toast')].some((t) => /Saved: Buy stamps/.test(t.textContent))
      && document.activeElement.id === 'day-add'));

    // A Reminder needs a date; an Errand has none (it is for today).
    await openAdd();
    await page.click('.ie-type[data-type="reminder"]');
    await page.fill('#ie-f-title', 'Renew passport');
    await save();
    chk(tag('Day: a Reminder without a date is refused inline'), await page.evaluate(() =>
      !!document.querySelector('.ie-modal') && /date/i.test(document.querySelector('.ie-error').textContent)) && itemCalls.length === 1);
    await page.fill('#ie-f-date', '2027-03-04');
    await page.fill('#ie-f-time', '14:15');
    await page.selectOption('#ie-f-scope', 'work');
    await save();
    await waitCalls(2);
    await dialogGone();
    chk(tag('Day: adding a Reminder sends its date, time and scope'), lastCall() === JSON.stringify({ op: 'create', type: 'reminder',
      fields: { kind: 'reminder', title: 'Renew passport', due: '2027-03-04', time: '14:15', scope: 'work', note: '' } }), lastCall());
    await openAdd();
    await page.click('.ie-type[data-type="errand"]');
    chk(tag('Day: the Errand form has no date field'), await page.evaluate(() => !document.getElementById('ie-f-date').offsetParent));
    await page.fill('#ie-f-title', 'Pick up dry cleaning');
    await save();
    await waitCalls(3);
    await dialogGone();
    const todayIso = await page.evaluate(() => document.querySelector('.cal-day.today').getAttribute('data-date'));
    chk(tag("Day: adding an Errand sends today's date"), lastCall() === JSON.stringify({ op: 'create', type: 'reminder',
      fields: { kind: 'errand', title: 'Pick up dry cleaning', due: todayIso, time: null, scope: 'personal', note: '' } }), lastCall());

    // Routines: the schedule builder composes the words the brain stores.
    await openAdd();
    await page.click('.ie-type[data-type="routine"]');
    await page.fill('#ie-f-title', 'Take vitamins');
    await page.selectOption('#ie-f-freq', 'weekly');
    await save();
    chk(tag('Day: a weekly routine with no day picked is refused inline'), await page.evaluate(() =>
      !!document.querySelector('.ie-modal') && /at least one day/i.test(document.querySelector('.ie-error').textContent)) && itemCalls.length === 3);
    await page.check(ie + ' input[aria-label="Monday"]');
    await page.check(ie + ' input[aria-label="Thursday"]');
    chk(tag('Day: the schedule preview reads "Mondays and Thursdays"'), await page.evaluate(() =>
      [...document.querySelectorAll('.ie-modal .ie-hint')].some((h) => h.textContent === 'Saved as: Mondays and Thursdays')));
    await page.check(ie + ' input[aria-label="Wednesday"]');
    await page.uncheck(ie + ' input[aria-label="Thursday"]');
    await page.check(ie + ' input[aria-label="Friday"]');
    chk(tag('Day: three days read "Mondays, Wednesdays and Fridays"'), await page.evaluate(() =>
      [...document.querySelectorAll('.ie-modal .ie-hint')].some((h) => h.textContent === 'Saved as: Mondays, Wednesdays and Fridays')));
    await page.uncheck(ie + ' input[aria-label="Wednesday"]');
    await page.uncheck(ie + ' input[aria-label="Friday"]');
    await page.check(ie + ' input[aria-label="Thursday"]');
    await page.fill('#ie-f-time', '08:00');
    await save();
    await waitCalls(4);
    await dialogGone();
    chk(tag('Day: a weekly routine on Monday and Thursday sends "Mondays and Thursdays"'), lastCall() === JSON.stringify({ op: 'create',
      type: 'routine', fields: { title: 'Take vitamins', schedule: 'Mondays and Thursdays', time: '08:00', note: '' } }), lastCall());
    await openAdd();
    await page.click('.ie-type[data-type="routine"]');
    await page.fill('#ie-f-title', 'Pay rent');
    await page.selectOption('#ie-f-freq', 'monthly');
    const previews = [];
    for (const day of ['1', '2', '3', '11', '12', '13', '15', '22', '23', '31']) {
      await page.fill('#ie-f-monthDay', day);
      previews.push(await page.evaluate(() => [...document.querySelectorAll('.ie-modal .ie-hint')].map((h) => h.textContent).find((t) => /^Saved as/.test(t))));
    }
    chk(tag('Day: monthly days get the right ordinal suffix (1st 2nd 3rd 11th 12th 13th 15th 22nd 23rd 31st)'),
      previews.map((p) => p.replace('Saved as: monthly on the ', '')).join(' ') === '1st 2nd 3rd 11th 12th 13th 15th 22nd 23rd 31st', previews.join(' | '));
    await page.fill('#ie-f-monthDay', '32');
    await save();
    chk(tag('Day: a monthly day outside 1 to 31 is refused inline'), await page.evaluate(() =>
      !!document.querySelector('.ie-modal') && /1 to 31/.test(document.querySelector('.ie-error').textContent)) && itemCalls.length === 4);
    await page.fill('#ie-f-monthDay', '15');
    await save();
    await waitCalls(5);
    await dialogGone();
    chk(tag('Day: a monthly routine on day 15 sends "monthly on the 15th"'), lastCall() === JSON.stringify({ op: 'create',
      type: 'routine', fields: { title: 'Pay rent', schedule: 'monthly on the 15th', time: null, note: '' } }), lastCall());

    // Events: a date, an optional end that cannot come first, optional times and a place.
    await openAdd();
    await page.click('.ie-type[data-type="event"]');
    await page.fill('#ie-f-title', 'Team offsite');
    await save();
    chk(tag('Day: an Event without a date is refused inline'), await page.evaluate(() =>
      !!document.querySelector('.ie-modal') && /date/i.test(document.querySelector('.ie-error').textContent)));
    await page.fill('#ie-f-date', '2027-05-10');
    await page.fill('#ie-f-end', '2027-05-09');
    await save();
    chk(tag('Day: an Event that ends before it starts is refused inline'), await page.evaluate(() =>
      !!document.querySelector('.ie-modal') && /end date/i.test(document.querySelector('.ie-error').textContent)) && itemCalls.length === 5);
    await page.fill('#ie-f-end', '2027-05-12');
    await page.fill('#ie-f-time', '09:00');
    await page.fill('#ie-f-endTime', '17:30');
    await page.fill('#ie-f-place', 'Lake house');
    await save();
    await waitCalls(6);
    await dialogGone();
    chk(tag('Day: adding an Event sends its dates, times and place'), lastCall() === JSON.stringify({ op: 'create', type: 'event',
      fields: { title: 'Team offsite', date: '2027-05-10', end: '2027-05-12', time: '09:00', endTime: '17:30', location: 'Lake house' } }), lastCall());

    // Edit on a "Due today" row: prefilled from the row, and only what changed is sent.
    chk(tag('Day: every reminder row with a Done button also has an Edit button'), await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.day-actions')].filter((g) => /Done/.test(g.textContent));
      return groups.length > 0 && groups.every((g) => [...g.querySelectorAll('button')].some((b) => b.textContent === 'Edit'));
    }));
    const dueRow = '.day-card:has(> .day-card-title:text-matches("^Due today")) .day-item';
    await page.click(dueRow + ' button:text-is("Edit")');
    await page.waitForSelector(ie, { timeout: 4000 });
    const prefill = await page.evaluate(() => ({
      head: document.getElementById('ie-title').textContent,
      title: document.getElementById('ie-f-title').value, kind: document.getElementById('ie-f-kind').value,
      date: document.getElementById('ie-f-date').value, time: document.getElementById('ie-f-time').value,
      scope: document.getElementById('ie-f-scope').value, types: document.querySelectorAll('.ie-type').length,
      kindShown: !!document.getElementById('ie-f-kind').offsetParent,
      focusInside: document.querySelector('.ie-modal').contains(document.activeElement),
    }));
    chk(tag('Day: Edit on a Due today row opens the editor prefilled with that row (title, kind, date, time, scope)'),
      prefill.head === 'Edit item' && prefill.title === 'Call the plumber' && prefill.kind === 'reminder' && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date)
        && prefill.time === '09:30' && prefill.scope === 'personal' && prefill.focusInside, JSON.stringify(prefill));
    chk(tag('Day: editing shows a Kind select instead of the type buttons'), prefill.kindShown && prefill.types === 0, JSON.stringify(prefill));
    await save();
    chk(tag('Day: saving an edit with nothing changed is refused inline'), await page.evaluate(() =>
      !!document.querySelector('.ie-modal') && /nothing has changed/i.test(document.querySelector('.ie-error').textContent)) && itemCalls.length === 6);
    await page.fill('#ie-f-title', 'Call the plumber back');
    await save();
    await waitCalls(7);
    await dialogGone();
    chk(tag('Day: saving an edited title sends only the changed field, with that row\'s file'), lastCall() === JSON.stringify({ op: 'update',
      type: 'reminder', file: 'Reminders/test-call-plumber.md', fields: { title: 'Call the plumber back' } }), lastCall());
    await page.waitForFunction(() => !!document.querySelector('.day-card .day-item'), null, { timeout: 5000 }).catch(() => {});
    chk(tag('Day: after saving an edit, focus is back on that row\'s Edit button or + Add'), await page.evaluate(() => {
      const a = document.activeElement;
      return a.id === 'day-add' || (a.textContent === 'Edit' && a.getAttribute('data-file') === 'Reminders/test-call-plumber.md');
    }));
    await page.click(dueRow + ' button:text-is("Edit")');
    await page.waitForSelector(ie, { timeout: 4000 });
    await page.selectOption('#ie-f-kind', 'watch');
    await page.fill('#ie-f-date', '');
    await page.fill('#ie-f-time', '');
    await page.fill('#ie-f-note', 'Ask about the leak');
    await save();
    await waitCalls(8);
    await dialogGone();
    chk(tag('Day: editing kind, date, time and a note sends each, the date as none and the time as null'), lastCall() === JSON.stringify({
      op: 'update', type: 'reminder', file: 'Reminders/test-call-plumber.md',
      fields: { kind: 'watch', due: 'none', time: null, note: 'Ask about the leak' } }), lastCall());

    // A refusal from the server keeps the dialog open and shows its words.
    await openAdd();
    await page.click('.ie-type[data-type="routine"]');
    await page.fill('#ie-f-title', 'Odd routine');
    await page.selectOption('#ie-f-freq', 'custom');
    await page.fill('#ie-f-custom', 'whenever the moon is full');
    itemAnswer = { status: 400, json: { error: 'I cannot read that schedule' } };
    await save();
    await waitCalls(9);
    await page.waitForFunction(() => /cannot read that schedule/.test((document.querySelector('.ie-error') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    chk(tag('Day: a 400 keeps the dialog open and shows the server\'s message inline (and in a toast)'), await page.evaluate(() => {
      const e = document.querySelector('.ie-error');
      return !!document.querySelector('.ie-modal') && !e.hidden && e.getAttribute('role') === 'alert' && e.textContent === 'I cannot read that schedule'
        && [...document.querySelectorAll('.toast')].some((t) => /I cannot read that schedule/.test(t.textContent));
    }));
    chk(tag('Day: after a refusal Save is enabled again, so the user can fix it and retry'), await page.evaluate(() =>
      !document.querySelector('.ie-modal button[type="submit"]').disabled));
    await page.keyboard.press('Escape');
    await dialogGone();

    // My routines: the card, its rows, Edit prefill, and Pause / Resume.
    const myRoutines = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('.day-col')];
      const card = cols[2] && [...cols[2].children].find((c) => /^My routines/.test(c.firstElementChild.textContent));
      if (!card) return null;
      return { tag: card.tagName, open: card.open, count: card.querySelector('.day-count').textContent,
        rows: [...card.querySelectorAll('.day-item')].map((r) => r.textContent), cardIndex: [...cols[2].children].indexOf(card) };
    });
    chk(tag('Day: a collapsed "My routines" card sits in the right column, counting every routine'),
      !!myRoutines && myRoutines.tag === 'DETAILS' && myRoutines.open === false && myRoutines.count === '4', JSON.stringify(myRoutines));
    chk(tag('Day: My routines lists active and paused routines with their schedules, paused marked'),
      !!myRoutines && myRoutines.rows.length === 4 && /Morning walk.*daily/.test(myRoutines.rows[0]) && /Weekly review.*Fridays/.test(myRoutines.rows[1])
        && /Water the plants.*Mondays and Thursdays.*paused/.test(myRoutines.rows[3]), JSON.stringify(myRoutines));
    chk(tag('Day: a routine row in "Routines today" has an Edit button'), await page.evaluate(() => {
      const card = [...document.querySelectorAll('.day-card')].find((c) => /^Routines today/.test(c.firstElementChild.textContent));
      return !!card && [...card.querySelectorAll('.day-item button')].some((b) => b.textContent === 'Edit');
    }));
    await page.evaluate(() => { [...document.querySelectorAll('details.day-card')].find((c) => /^My routines/.test(c.textContent)).open = true; });
    const mine = 'details.day-card:has(> summary:text-matches("^My routines"))';
    await page.click(mine + ' [aria-label="Pause routine: Morning walk"]');
    await waitCalls(10);
    chk(tag('Day: Pause sends only the status'), lastCall() === JSON.stringify({ op: 'update', type: 'routine',
      file: 'Routines/test-walk.md', fields: { status: 'paused' } }), lastCall());
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Paused: /.test(t.textContent)), null, { timeout: 4000 }).catch(() => {});
    await page.click(mine + ' [aria-label="Resume routine: Water the plants"]');
    await waitCalls(11);
    chk(tag('Day: Resume sends active'), lastCall() === JSON.stringify({ op: 'update', type: 'routine',
      file: 'Routines/test-water.md', fields: { status: 'active' } }), lastCall());
    await page.click(mine + ' [aria-label="Edit routine: Water the plants"]');
    await page.waitForSelector(ie, { timeout: 4000 });
    const routinePrefill = await page.evaluate(() => ({
      head: document.getElementById('ie-title').textContent, title: document.getElementById('ie-f-title').value,
      freq: document.getElementById('ie-f-freq').value,
      days: [...document.querySelectorAll('.ie-modal .ie-days input')].filter((c) => c.checked).map((c) => c.getAttribute('aria-label')),
      time: document.getElementById('ie-f-time').value,
    }));
    chk(tag('Day: editing a routine parses "Mondays and Thursdays 08:00" back into the days and the time'),
      routinePrefill.head === 'Edit routine' && routinePrefill.title === 'Water the plants' && routinePrefill.freq === 'weekly'
        && routinePrefill.days.join() === 'Monday,Thursday' && routinePrefill.time === '08:00', JSON.stringify(routinePrefill));
    await page.check(ie + ' input[aria-label="Saturday"]');
    await save();
    await waitCalls(12);
    await dialogGone();
    chk(tag('Day: changing a routine\'s days sends the new schedule and nothing else'), lastCall() === JSON.stringify({ op: 'update',
      type: 'routine', file: 'Routines/test-water.md', fields: { schedule: 'Mondays, Thursdays and Saturdays' } }), lastCall());
    await page.click(mine + ' [aria-label="Edit routine: Deep clean"]');
    await page.waitForSelector(ie, { timeout: 4000 });
    chk(tag('Day: a schedule the builder cannot parse opens as free text with a hint'), await page.evaluate(() => {
      const f = document.getElementById('ie-f-freq'), c = document.getElementById('ie-f-custom');
      return f.value === 'custom' && c.value === 'every other Friday' && !!c.offsetParent
        && /Write it the way you would say it/.test(c.closest('.ie-field').textContent);
    }));
    await page.keyboard.press('Escape');
    await dialogGone();
    await page.click(mine + ' button:text-is("+ Add routine")');
    await page.waitForSelector(ie, { timeout: 4000 });
    chk(tag('Day: "+ Add routine" opens the editor on the Routine type'), await page.evaluate(() =>
      document.querySelector('.ie-type[aria-pressed="true"]').textContent === 'Routine' && !!document.getElementById('ie-f-freq').offsetParent));
    await page.keyboard.press('Escape');
    await dialogGone();
    chk(tag('Day: Esc from "+ Add routine" returns focus to that button'), await page.evaluate(() =>
      document.activeElement.getAttribute('data-act') === 'add-routine'));
    chk(tag('Day: the editor leaves nothing behind (no dialog, scrim or ie-open class)'), await page.evaluate(() =>
      !document.querySelector('.ie-modal') && !document.querySelector('.scrim.open') && !document.body.classList.contains('ie-open')));
    await page.unroute('**/api/assistant/item').catch(() => {});

    // --- Brain map regions follow the Second Brain's folders -------------------
    const regions = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('.cat-btn')].map((b) => b.dataset.folder),
      legend: [...document.querySelectorAll('#legend .chip')].map((c) => c.textContent.trim()),
    }));
    const wantRegions = ['Projects', 'Memory', 'Knowledge', 'Research', 'Day', 'System'];
    chk(tag('Brain: one filter button per Second Brain region'),
      JSON.stringify(regions.buttons) === JSON.stringify(wantRegions), JSON.stringify(regions.buttons));
    chk(tag('Brain: the legend names the same regions, with no catch-all "Other"'),
      JSON.stringify(regions.legend) === JSON.stringify(wantRegions), JSON.stringify(regions.legend));

    // --- 7/8. no uncaught JS errors, at this width -------------------------
    chk(tag('no uncaught JS errors'), errs.length === 0, errs.slice(0, 3).join(' | '));

    await page.unroute('**/api/assistant').catch(() => {});
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
