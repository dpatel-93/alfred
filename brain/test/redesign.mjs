// P0 regression harness for the Blend redesign (see the implementation plan,
// section 4, "P0 — Regression harness"). This suite pins the shipped behaviour
// the redesign must not break — the "Open AI terminal" menu, the Interns catalog search,
// and the Brain graph's click-to-open-panel path — at three widths. It MUST
// be green against the code as it stands before any redesign edit lands; a
// harness that has never passed on the old code proves nothing about the new
// code, so every later phase's exit criterion is "P0 still green."
//
// Port discipline: this suite boots its own server (fixture vault,
// ALFRED_COUNCIL_STUB_DIR so every registry seat is ready, ALFRED_CC_DRY_RUN so
// opening a terminal never starts a real window) on ALFRED_TERM_TEST_PORT.
// Never port 7777 — that is the operator's live session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, '..', '..', 'helpers', 'council-run.mjs');
const REGISTRY = path.join(HERE, '..', '..', 'helpers', 'providers.json');
const R = [];
const chk = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-redesign-'));
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
    // The Day view auto-opens a sign-in console for a signed-out seat, and "Open AI terminal" opens a
    // window; never on a test run.
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
    // No hash: the app opens on Day (not the Brain), and the nav is Day, Projects, Brain with
    // Day active. There is no Terminals tab any more.
    chk(tag('with no hash the app lands on the Day view'), await page.evaluate(() =>
      !document.getElementById('pane-day').hidden && document.getElementById('pane-brain').hidden
      && !document.getElementById('pane-command')));
    chk(tag('the nav is Day, Projects, Brain, with Day active'), await page.evaluate(() => {
      const b = [...document.querySelectorAll('#views .view-btn')];
      return b.map((x) => x.dataset.view).join(',') === 'day,projects,brain'
        && b.map((x) => x.textContent).join(',') === 'Day,Projects,Brain'
        && b.map((x) => x.getAttribute('aria-controls')).join(',') === 'pane-day,pane-projects,pane-brain'
        && b[0].classList.contains('active') && b[0].getAttribute('aria-selected') === 'true'
        && b.slice(1).every((x) => !x.classList.contains('active') && x.getAttribute('aria-selected') === 'false');
    }));

    // --- Open AI terminal: one header button and a menu of the installed AI tools ------------
    // The server runs with ALFRED_COUNCIL_STUB_DIR, so every registry seat counts as installed, and with
    // ALFRED_CC_DRY_RUN, so picking one is answered {dryRun:true} instead of opening a real window.
    chk(tag('the header has one "Open AI terminal" button, a closed menu, and no Org Self-Test button'), await page.evaluate(() => {
      const b = document.getElementById('open-terminal-btn');
      return !!b && /Open AI terminal/.test(b.textContent) && b.getAttribute('aria-expanded') === 'false'
        && !document.getElementById('org-selftest-btn') && !document.getElementById('org-selftest-status')
        && getComputedStyle(document.getElementById('ai-term-menu')).display === 'none';
    }));
    await page.click('#open-terminal-btn');
    await page.waitForFunction(() => document.querySelectorAll('#ai-term-menu .btn').length > 0, null, { timeout: 8000 }).catch(() => {});
    const menu = await page.evaluate(() => {
      const r = document.getElementById('ai-term-menu').getBoundingClientRect();
      return {
        open: document.getElementById('ai-term-menu').classList.contains('open'),
        expanded: document.getElementById('open-terminal-btn').getAttribute('aria-expanded'),
        items: [...document.querySelectorAll('#ai-term-menu .btn')].map((b) => b.textContent),
        box: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) },
      };
    });
    chk(tag('clicking it opens a menu of the installed AI tools: Claude, Gemini and Grok, not Ollama'), menu.open && menu.expanded === 'true'
      && ['Claude', 'Gemini', 'Grok'].every((n) => menu.items.some((t) => t.startsWith(n))) && !menu.items.some((t) => /ollama/i.test(t)), JSON.stringify(menu));
    chk(tag('the menu sits on screen, under the button'), menu.box.left >= 0 && menu.box.right <= width && menu.box.top > 0, JSON.stringify(menu.box));
    const posted = page.waitForResponse((r) => r.url().endsWith('/api/claude/open-terminal') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
    await page.click('#ai-term-menu .btn:has-text("Grok")');
    const resp = await posted;
    const sent = resp ? JSON.parse(resp.request().postData() || '{}') : null;
    const reply = resp ? await resp.json().catch(() => null) : null;
    chk(tag('picking Grok sends only its provider id, and the server answers for Grok'),
      !!resp && resp.status() === 200 && JSON.stringify(sent) === '{"provider":"grok"}' && !!reply && reply.provider === 'grok' && reply.dryRun === true,
      JSON.stringify({ sent, reply }));
    await page.waitForFunction(() => /Opened Grok/.test(document.getElementById('toast-stack').textContent), null, { timeout: 5000 }).catch(() => {});
    chk(tag('the menu closes after a pick and a toast says what opened'), await page.evaluate(() =>
      !document.getElementById('ai-term-menu').classList.contains('open')
      && document.getElementById('open-terminal-btn').getAttribute('aria-expanded') === 'false'
      && /Opened Grok/.test(document.getElementById('toast-stack').textContent)));
    await page.click('#open-terminal-btn');
    await page.keyboard.press('Escape');
    chk(tag('Esc closes the menu'), await page.evaluate(() => !document.getElementById('ai-term-menu').classList.contains('open')));
    await page.click('#open-terminal-btn');
    await page.evaluate(() => document.body.click());
    chk(tag('a click elsewhere closes the menu'), await page.evaluate(() => !document.getElementById('ai-term-menu').classList.contains('open')));
    chk(tag('there is no seat bar, console lane, council or Open Terminals checklist anywhere on the page'), await page.evaluate(() =>
      !['cc-seats', 'cc-term-stage', 'cc-council', 'cc-ask-btn', 'composer-foot', 'ext-term-btn', 'ext-term-menu', 'seat-popover', 'bench']
        .some((id) => document.getElementById(id)) && typeof window.__ccDebug === 'undefined'));

    // The Ask bar, Local GPU and Status sit over the Brain (they are hidden on Day), so the Interns check goes there.
    await page.evaluate(() => { location.hash = 'brain'; });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('composer-dock')).visibility === 'visible', null, { timeout: 5000 }).catch(() => {});

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
    // Close it before the next section — a left-open <details> pops up over the foot of the screen.
    await page.evaluate(() => { document.getElementById('composer-tool-interns').open = false; });

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

    // The Day cards are checked against the feed's real shape: the server's feed from the test brain
    // with known rows injected. Calendar events (Calendar/events.md): one timed event today with a
    // place and an author, and an all-day one spanning today and tomorrow, with one unreadable line.
    // Weekly chores (one due today, one late, one done today, one later this week), the next 7 days,
    // progress and Needs you. Every write below is stubbed; the real server is never written to.
    // feedBump changes the to-dos' titles, so a refresh after bumping it is a real repaint.
    let feedBump = 0;
    await page.route('**/api/assistant', async (route) => {
      // A poll can still be in flight when the context closes; that must not become an unhandled rejection.
      let resp, j;
      try { resp = await route.fetch(); j = await resp.json(); } catch { return route.abort().catch(() => {}); }
      const iso = j.date || new Date().toISOString().slice(0, 10);
      const day = (n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
      const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1];
      const rem = (file, title, kind, due, time) => ({ file, title, kind, due, time, scope: 'personal', author: 'grok', ours: true, pending: null });
      j.brain = j.brain || 'test-brain';
      // The add/edit checks below need known reminder and routine rows, whatever brain the server found.
      j.today = [rem('Reminders/test-call-plumber.md', 'Call the plumber', 'reminder', iso, '09:30')];
      j.overdue = [];
      j.carryOver = [];
      j.routines = {
        today: [{ file: 'Routines/test-walk.md', title: 'Morning walk', schedule: 'daily', time: '07:00', status: 'active', today: true }],
        other: [
          { file: 'Routines/test-review.md', title: 'Weekly review', schedule: 'Fridays', status: 'active', today: false },
          { file: 'Routines/test-odd.md', title: 'Deep clean', schedule: 'every other Friday', status: 'active', today: false },
        ],
        paused: [{ file: 'Routines/test-water.md', title: 'Water the plants', schedule: 'Mondays and Thursdays 08:00', time: '08:00',
          status: 'paused', today: false }],
      };
      const chore = (name, title, due, extra) => ({ file: `Routines/${name}.md`, title, kind: 'chore', schedule: 'weekly', day: null,
        due, done: false, missedLastWeek: false, closedOn: null, ...extra });
      const dust = chore('test-dust', 'Dusting', iso);
      const jira = chore('test-jira', 'Jira time sheet', day(-2), { day: 'monday' });
      const bath = chore('test-bath', 'Clean the bathrooms', iso, { done: true, closedOn: iso });
      const laundry = chore('test-laundry', 'Fold the laundry', day(3), { day: 'tuesday', missedLastWeek: true });
      j.chores = { due: [dust], late: [jira], done: [bath], all: [jira, dust, bath, laundry] };
      j.doneToday = [{ file: 'Reminders/Done/test-mail.md', title: 'Mail the package', kind: 'errand', status: 'done', closedOn: iso }];
      j.progress = { done: 2, total: 6 };
      j.needsYou = [
        { kind: 'grok ask', title: 'Which dentist do you use?', why: 'Grok needs it to book the cleaning', ref: 'G1' },
        { kind: 'signal', title: 'A note for you', why: 'from grok', file: 'Inbox/README.md' },
      ];
      const cake = rem('Reminders/test-cake.md', 'Pick up the cake', 'errand', day(1), '16:00');
      j.upcoming = [cake];
      j.week = { from: day(1), to: day(7), anytime: { by: day(7), chores: [dust, bath] },
        days: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ date: day(n), weekday: '', items: n === 1 ? [cake] : [], routines: [], chores: n === 3 ? [laundry] : [] })) };
      j.todos = ['One', 'Two', 'Three', 'Four'].map((t, i) => rem(`Reminders/test-todo-${i}.md`, `To-do ${t}${feedBump ? ' v' + feedBump : ''}`, 'todo', 'none', null));
      j.later = [rem('Reminders/test-later.md', 'Renew the passport', 'reminder', day(40), null)];
      j.watching = [];
      j.brief = { file: `Outputs/briefs/${iso}.md`, date: iso, isToday: true, title: 'Morning brief', updated: `${iso} 07:10`,
        top: [{ title: 'Test headline.', text: 'Body.' }] };
      j.projects = [{ file: 'Projects/demo/status.md', name: 'demo', title: 'Demo', status: 'Active', track: 'Personal',
        updated: '2026-01-01', stands: '(2026-01-01) Going fine.', next: 'Ship it.' }];
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
    // Chore Done and Tell Alfred are stubbed too: they record what was sent and answer like the server.
    const actionCalls = [], tellCalls = [];
    await page.route('**/api/assistant/action', async (route) => {
      let sent = {};
      try { sent = JSON.parse(route.request().postData() || '{}'); } catch { /* checked below */ }
      actionCalls.push(sent);
      await route.fulfill({ json: { applied: true, via: 'direct', title: 'Dusting' } }).catch(() => {});
    });
    await page.route('**/api/assistant/tell', async (route) => {
      let sent = {};
      try { sent = JSON.parse(route.request().postData() || '{}'); } catch { /* checked below */ }
      tellCalls.push(sent);
      await route.fulfill({ json: { via: 'claude', reply: `Got it: ${sent.text}.`,
        saved: [{ type: 'reminder', kind: 'reminder', title: 'Call the dentist', due: 'none', file: 'Reminders/x.md' }], skipped: [] } }).catch(() => {});
    });

    // --- Day: key 1 returns to it; the date header and the sign-in banner are mounted ------
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press('1');
    await page.waitForFunction(() => !document.getElementById('pane-day').hidden, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => /,/.test(document.getElementById('day-date').textContent), null, { timeout: 8000 }).catch(() => {});
    chk(tag('key 1 returns to Day, with the weekday date header and the sign-in banner mounted'), await page.evaluate(() =>
      !document.getElementById('pane-day').hidden
      && /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}$/.test(document.getElementById('day-date').textContent)
      && !!document.getElementById('signin-banner')));
    await page.waitForFunction(() => !!document.querySelector('.today-card') && /Morning walk/.test(document.querySelector('.today-card').textContent),
      null, { timeout: 8000 }).catch(() => {});

    // --- Day: the layout the user asked for ------------------------------------------------
    // Left: the calendar, then the picked day. Centre: Today, then This week. Right: Needs you,
    // Watching, Your routines, with Tell Alfred under them. Three columns on a desk, two at 1024.
    const layout = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('#day-body > .day-col')];
      const r = (n) => n.getBoundingClientRect();
      const tell = document.getElementById('tell-alfred');
      return {
        areas: cols.map((c) => ['left', 'mid', 'right'].find((a) => c.classList.contains(a))),
        cards: cols.map((c) => [...c.children].map((k) => k.classList.contains('cal-card') ? 'CAL' : k.classList.contains('pick-card') ? 'PICK'
          : k.classList.contains('today-card') ? 'TODAY' : k.classList.contains('week-card') ? 'WEEK' : k.classList.contains('needs-card') ? 'NEEDS'
          : k.classList.contains('routines-card') ? 'ROUTINES' : String((k.firstElementChild || {}).textContent || '').replace(/\d+$/, '').trim())),
        lefts: cols.map((c) => Math.round(r(c).left)), widths: cols.map((c) => Math.round(r(c).width)),
        rightTop: cols[2] ? Math.round(r(cols[2]).top) : 0, rightBottom: cols[2] ? Math.round(r(cols[2]).bottom) : 0,
        tell: tell ? { left: Math.round(r(tell).left), top: Math.round(r(tell).top), inBody: document.getElementById('day-body').contains(tell) } : null,
      };
    });
    chk(tag('Day: left column is the calendar then the picked day; centre is Today then This week; right is Needs you, Watching, Your routines'),
      JSON.stringify(layout.areas) === '["left","mid","right"]' && JSON.stringify(layout.cards) === JSON.stringify([['CAL', 'PICK'], ['TODAY', 'WEEK'],
        ['NEEDS', 'Watching', 'ROUTINES']]), JSON.stringify(layout));
    if (width >= 1200) {
      chk(tag('Day: three columns side by side, the centre one widest'), layout.lefts[0] < layout.lefts[1] && layout.lefts[1] < layout.lefts[2]
        && layout.widths[1] > layout.widths[0] && layout.widths[1] > layout.widths[2], JSON.stringify(layout));
      chk(tag('Day: the Tell Alfred box sits under the right column, outside the rebuilt #day-body'), !!layout.tell && !layout.tell.inBody
        && Math.abs(layout.tell.left - layout.lefts[2]) < 3 && layout.tell.top >= layout.rightBottom, JSON.stringify(layout));
    } else {
      chk(tag('Day: two columns on a narrow screen, the right column under the left one'), layout.lefts[0] < layout.lefts[1]
        && layout.lefts[2] === layout.lefts[0], JSON.stringify(layout));
      chk(tag('Day: the Tell Alfred box sits under the right column, outside the rebuilt #day-body'), !!layout.tell && !layout.tell.inBody
        && Math.abs(layout.tell.left - layout.lefts[0]) < 3 && layout.tell.top >= layout.rightBottom, JSON.stringify(layout));
    }
    chk(tag('Day: the header has Morning brief, + Add and Refresh, and no Tell Grok box or seat strip'), await page.evaluate(() => {
      const kids = [...document.querySelector('.day-tools').children].map((c) => c.id);
      const pane = document.getElementById('pane-day');
      return JSON.stringify(kids) === '["day-brief","day-add","day-refresh"]' && /Morning brief/.test(document.getElementById('day-brief').textContent)
        && !document.getElementById('tell-grok') && !pane.querySelector('#bench') && !pane.querySelector('#cc-seats');
    }));
    chk(tag('Day: the old cards are gone (brief, end of day, projects, signals, due today, routines today)'), await page.evaluate(() => {
      const titles = [...document.querySelectorAll('#pane-day .day-card-title, #pane-day details.day-card > summary')].map((t) => t.textContent);
      return !titles.some((t) => /morning brief|end of day|^projects|signals|due today|routines today|today on the calendar/i.test(t));
    }), await page.evaluate(() => [...document.querySelectorAll('#pane-day .day-card-title')].map((t) => t.textContent).join(' | ')));
    chk(tag('Day: the Ask bar is not on the Day page'), await page.evaluate(() =>
      getComputedStyle(document.getElementById('composer-dock')).visibility === 'hidden'
      && document.elementFromPoint(innerWidth / 2, innerHeight - 30) !== document.getElementById('search-input')));

    // --- Day: the calendar (month grid, today, dots) and the picked day ---------------------
    chk(tag('Day: the Calendar card tops the left column with a 6-week grid (42 day buttons)'), await page.evaluate(() => {
      const card = document.querySelector('.day-col.left').firstElementChild;
      return !!card && card.classList.contains('cal-card') && card.querySelectorAll('.cal-grid > button.cal-day').length === 42
        && /\b20\d\d\b/.test((card.querySelector('.cal-month') || {}).textContent || '');
    }));
    chk(tag('Day: today is ringed and selected, with one roving tab stop'), await page.evaluate(() => {
      const t = document.querySelectorAll('.cal-day.today');
      return t.length === 1 && t[0].classList.contains('selected') && t[0].getAttribute('aria-current') === 'date'
        && document.querySelectorAll('.cal-day[tabindex="0"]').length === 1;
    }));
    chk(tag("Day: today's cell has a blue dot per event and a mint dot per reminder and chore"), await page.evaluate(() => {
      const t = document.querySelector('.cal-day.today');
      return t.querySelectorAll('.cal-dot:not(.rem)').length === 2 && t.querySelectorAll('.cal-dot.rem').length === 2
        && /1 reminder, 1 chore, 2 events/.test(t.getAttribute('aria-label'));
    }), await page.evaluate(() => document.querySelector('.cal-day.today').getAttribute('aria-label')));
    const rowsOf = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((r) => ({
      time: (r.querySelector('.day-time') || {}).textContent, kind: (r.querySelector('.day-kind') || {}).textContent,
      title: r.querySelector('.day-title').textContent, text: r.textContent,
      done: !!r.querySelector('[aria-label^="Done for this week"], [aria-label^="Mark done"]') })), sel);
    const picked = await rowsOf('.pick-card .day-item');
    chk(tag('Day: the picked day (today) lists the routine, both events, the reminder and the chore, timed rows first by time'),
      JSON.stringify(picked.map((r) => [r.time, r.kind, r.title])) === JSON.stringify([['07:00', 'routine', 'Morning walk'],
        ['09:30', 'event', 'Test event'], ['09:30', 'reminder', 'Call the plumber'], ['all day', 'event', 'Team offsite'], ['', 'chore', 'Dusting']]),
      JSON.stringify(picked.map((r) => [r.time, r.kind, r.title])));
    chk(tag("Day: an event row shows its end time, place and author"), /to 10:00/.test(picked[1] && picked[1].text)
      && /Room 4/.test(picked[1].text) && /by Grok/.test(picked[1].text) && /by Claude/.test(picked[3] && picked[3].text), JSON.stringify(picked));
    chk(tag('Day: the picked day card is titled with the date and "today"'), await page.evaluate(() =>
      / · today$/.test(document.querySelector('.pick-card .day-card-title').textContent)));
    const tomorrow = await page.evaluate(() => {
      const t = document.querySelector('.cal-day.today').getAttribute('data-date');
      return new Date(Date.parse(t + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    });
    await page.click(`.cal-day[data-date="${tomorrow}"]`);
    await page.waitForFunction(() => !/ · today$/.test(document.querySelector('.pick-card .day-card-title').textContent), null, { timeout: 4000 }).catch(() => {});
    const pickedTomorrow = await rowsOf('.pick-card .day-item');
    chk(tag('Day: clicking another day shows what is on it (the errand at 16:00 and the all-day event), with its actions'),
      JSON.stringify(pickedTomorrow.map((r) => [r.time, r.title, r.done])) === JSON.stringify([['16:00', 'Pick up the cake', true], ['all day', 'Team offsite', false]])
        && await page.evaluate((d) => document.querySelector(`.cal-day[data-date="${d}"]`).classList.contains('selected')
          && document.activeElement.getAttribute('data-date') === d, tomorrow), JSON.stringify(pickedTomorrow));
    await page.click('.cal-card .cal-today');
    await page.waitForFunction(() => / · today$/.test(document.querySelector('.pick-card .day-card-title').textContent), null, { timeout: 4000 }).catch(() => {});
    chk(tag('Day: the Today button goes back to today'), await page.evaluate(() =>
      / · today$/.test(document.querySelector('.pick-card .day-card-title').textContent) && !document.querySelector('.cal-card .cal-today')));
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
    await page.click('.pick-card .day-item.event .day-title');
    await page.waitForFunction(() => document.getElementById('panel').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    chk(tag('Day: clicking an event opens Calendar/events.md in the reader'), await page.evaluate(() =>
      document.getElementById('panel').classList.contains('open') && /Calendar/.test(document.getElementById('panel-title').textContent)));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
    chk(tag('Day: the page served at / has no Google Calendar and no /api/calendar/ calls left in it'), await page.evaluate(async () => {
      const src = await fetch('/').then((r) => r.text());
      return !src.includes('/api/calendar/') && !src.includes('Google Calendar');
    }));

    // --- Day: Today --------------------------------------------------------------------------
    chk(tag('Day: Today shows "2 of 6 done" with a progress bar'), await page.evaluate(() => {
      const card = document.querySelector('.today-card');
      const bar = card.querySelector('.day-card-head [role="progressbar"]');
      return /^2 of 6 done$/.test(card.querySelector('.day-progress').textContent) && !!bar && bar.getAttribute('aria-valuenow') === '2'
        && bar.getAttribute('aria-valuemax') === '6' && bar.firstElementChild.style.width === '33%';
    }));
    const lateDay = await page.evaluate(() => {
      const t = document.querySelector('.cal-day.today').getAttribute('data-date');
      return new Date(Date.parse(t + 'T12:00:00Z') - 2 * 86400000).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    });
    chk(tag('Day: "Needs attention" leads Today with the late chore, "was due <weekday>", and a Done button'), await page.evaluate((wd) => {
      const g = document.querySelector('.today-card .day-attn');
      const row = g && g.querySelector('.day-item');
      return !!g && g === document.querySelector('.today-card .day-card-head').nextElementSibling
        && /^Needs attention \(1\)$/.test(g.querySelector('.day-group').textContent) && /Jira time sheet/.test(row.textContent)
        && row.querySelector('.day-when').textContent === 'was due ' + wd && !!row.querySelector('[aria-label="Done for this week: Jira time sheet"]');
    }, lateDay));
    const todayRows = await rowsOf('.today-card .day-attn + .day-list > .day-item');
    chk(tag("Day: Today's list merges routine, events, reminder and chore, timed first, each with a kind tag"),
      JSON.stringify(todayRows.map((r) => [r.time, r.kind, r.title])) === JSON.stringify(picked.map((r) => [r.time, r.kind, r.title])),
      JSON.stringify(todayRows.map((r) => [r.time, r.kind, r.title])));
    chk(tag('Day: Today\'s reminder has the full actions and the chore just Done'), await page.evaluate(() => {
      const rem = document.querySelector('.today-card .day-item.today');
      const cho = [...document.querySelectorAll('.today-card .day-item.chore')].find((r) => /Dusting/.test(r.textContent));
      const labels = (r) => [...r.querySelectorAll('.day-actions button')].map((b) => b.textContent).join('|');
      return labels(rem) === '✓ Done|→ Tomorrow|Edit|⋯' && labels(cho) === '✓ Done';
    }));
    chk(tag('Day: "Done today" lists what was closed and the chore done today, struck through'), await page.evaluate(() => {
      const card = document.querySelector('.today-card');
      const h = [...card.querySelectorAll('.day-group')].find((g) => /^Done today/.test(g.textContent));
      const rows = h ? [...h.nextElementSibling.querySelectorAll('.day-item.done')] : [];
      return !!h && h.textContent === 'Done today (2)' && rows.length === 2 && /Mail the package/.test(rows[0].textContent)
        && /Clean the bathrooms/.test(rows[1].textContent) && !rows.some((r) => r.querySelector('.day-actions'))
        && /line-through/.test(getComputedStyle(rows[0].querySelector('.day-title')).textDecorationLine);
    }));
    await page.click('.today-card [aria-label="Done for this week: Dusting"]');
    { const t = Date.now(); while (!actionCalls.length && Date.now() - t < 4000) await sleep(50); }
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Done for this week: Dusting/.test(t.textContent)),
      null, { timeout: 4000 }).catch(() => {});
    chk(tag("Day: a chore's Done sends close for its Routines/ file and says it is done for the week"),
      JSON.stringify(actionCalls[0] || null) === JSON.stringify({ file: 'Routines/test-dust.md', action: 'close' })
      && await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Done for this week: Dusting/.test(t.textContent))),
      JSON.stringify(actionCalls));

    // --- Day: This week ------------------------------------------------------------------------
    const week = await page.evaluate(() => {
      const card = document.querySelector('.week-card');
      const groups = [...card.querySelectorAll(':scope > .day-group')].map((h) => ({ h: h.textContent,
        rows: [...((h.nextElementSibling && h.nextElementSibling.querySelectorAll('.day-item')) || [])].map((r) => ({
          title: r.querySelector('.day-title').textContent, done: !!r.querySelector('.day-act.done'),
          tag: (r.querySelector('.badge') || {}).textContent || '' })) }));
      const folds = [...card.querySelectorAll('details.day-fold')].map((f) => ({ s: f.querySelector('summary').textContent, open: f.open }));
      return { range: (card.querySelector('.day-card-head .day-aside') || {}).textContent, groups, folds };
    });
    chk(tag('Day: This week shows its date range on the right'), /^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}$/.test(week.range || ''), week.range);
    chk(tag('Day: This week has one group per day with something on it (empty days skipped)'), week.groups.length === 3
      && /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/.test(week.groups[0].h) && /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/.test(week.groups[1].h)
      && JSON.stringify(week.groups[0].rows.map((r) => r.title)) === '["Pick up the cake","Team offsite"]'
      && JSON.stringify(week.groups[1].rows.map((r) => [r.title, r.done])) === '[["Fold the laundry",true]]', JSON.stringify(week.groups));
    chk(tag('Day: "Anytime this week (by …)" lists the any-day chores: Done when open, "done this week" when done'),
      /^Anytime this week \(by [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}\)$/.test((week.groups[2] || {}).h || '')
      && JSON.stringify(week.groups[2].rows.map((r) => [r.title, r.done, r.tag])) === '[["Dusting",true,""],["Clean the bathrooms",false,"done this week"]]',
      JSON.stringify(week.groups[2]));
    chk(tag('Day: To-dos (4) and Later (1) are collapsed groups under the week'),
      JSON.stringify(week.folds) === '[{"s":"To-dos (4)","open":false},{"s":"Later (1)","open":false}]', JSON.stringify(week.folds));

    // --- Day: Needs you, and Your routines' weekly chores --------------------------------------
    chk(tag('Day: Needs you lists each item with why; only one with a file is a button'), await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.needs-card .day-need')];
      return rows.length === 2 && rows[0].tagName === 'DIV' && /grok ask/.test(rows[0].textContent) && /Which dentist do you use\?/.test(rows[0].textContent)
        && /Grok needs it to book the cleaning/.test(rows[0].textContent) && rows[1].tagName === 'BUTTON' && /A note for you/.test(rows[1].textContent)
        && document.querySelector('.needs-card .day-count').textContent === '2';
    }));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
    await page.click('.needs-card button.day-need');
    await page.waitForFunction(() => document.getElementById('panel').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    chk(tag('Day: a Needs you row with a file opens it in the reader'), await page.evaluate(() =>
      document.getElementById('panel').classList.contains('open') && /A note for you/.test(document.getElementById('panel-title').textContent)));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
    const chores = await page.evaluate(() => {
      const card = document.querySelector('.routines-card');
      const h = [...card.querySelectorAll('.day-group')].find((g) => /^Weekly chores/.test(g.textContent));
      return { h: h && h.textContent, rows: [...card.querySelectorAll('.day-item.chore')].map((r) => [r.querySelector('.day-title').textContent,
        r.querySelector('.day-when').textContent, (r.querySelector('.badge') || {}).textContent || '', !!r.querySelector('.day-act.done')]) };
    });
    chk(tag('Day: Your routines lists the weekly chores: open ones with Done, done ones "done this week", a missed week marked'),
      chores.h === 'Weekly chores (4)' && JSON.stringify(chores.rows) === JSON.stringify([['Jira time sheet', 'open', '', true],
        ['Dusting', 'open', '', true], ['Clean the bathrooms', 'done this week', '', false], ['Fold the laundry', 'open', 'missed last week', true]]),
      JSON.stringify(chores));

    // --- Day: the Morning brief button opens a dialog; Esc and the scrim close it ----------------
    await page.click('#day-brief');
    await page.waitForSelector('.brief-modal.open', { timeout: 4000 }).catch(() => {});
    chk(tag('Day: Morning brief opens a labelled modal dialog with the brief, its actions and the end of day'), await page.evaluate(() => {
      const d = document.querySelector('.brief-modal');
      const label = d && document.getElementById(d.getAttribute('aria-labelledby'));
      const text = d ? d.textContent : '';
      return !!d && d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!label && label.textContent === 'Morning brief'
        && d.contains(document.activeElement) && /Test headline\./.test(text) && /Open full brief/.test(text) && /Read aloud/.test(text)
        && /End of day/.test(text) && /Done today \(2\)/.test(text) && /Mail the package/.test(text) && /Clean the bathrooms/.test(text)
        && /Tidy up \(run the Librarian\)/.test(text) && !!document.querySelector('.scrim.open');
    }));
    await page.keyboard.press('Shift+Tab');
    chk(tag('Day: Shift+Tab from the first control in the brief wraps to its last (Tidy up)'), await page.evaluate(() =>
      document.activeElement.textContent === 'Tidy up (run the Librarian)'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.brief-modal'), null, { timeout: 4000 }).catch(() => {});
    chk(tag('Day: Esc closes the brief, leaves nothing behind and puts focus back on the button'), await page.evaluate(() =>
      !document.querySelector('.brief-modal') && !document.querySelector('.scrim.open') && !document.body.classList.contains('brief-open')
      && document.activeElement.id === 'day-brief' && !document.getElementById('pane-day').hidden));
    await page.click('#day-brief');
    await page.waitForSelector('.brief-modal.open', { timeout: 4000 }).catch(() => {});
    await page.mouse.click(8, 890);
    await page.waitForFunction(() => !document.querySelector('.brief-modal'), null, { timeout: 4000 }).catch(() => {});
    chk(tag('Day: a click on the scrim closes the brief, focus back on the button'), await page.evaluate(() =>
      !document.querySelector('.brief-modal') && !document.querySelector('.scrim.open') && document.activeElement.id === 'day-brief'));
    await page.click('#day-brief');
    await page.waitForSelector('.brief-modal.open', { timeout: 4000 }).catch(() => {});
    await page.click('.brief-modal button:text-is("Open full brief")');
    await page.waitForFunction(() => document.getElementById('panel').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    chk(tag('Day: "Open full brief" closes the dialog and opens the brief in the reader'), await page.evaluate(() =>
      !document.querySelector('.brief-modal') && document.getElementById('panel').classList.contains('open')
      && /Morning brief/.test(document.getElementById('panel-title').textContent)));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });

    // --- Day: Tell Alfred keeps what is typed across a repaint, then posts to /api/assistant/tell --
    await page.evaluate(() => { const f = [...document.querySelectorAll('.week-card details.day-fold')][0]; f.open = true; });
    await sleep(100);
    await page.click('#tell-alfred-input');
    await page.fill('#tell-alfred-input', 'remind me Tuesday to call the dentist');
    feedBump = 1;
    await page.evaluate(() => document.getElementById('day-refresh').click());
    await page.waitForFunction(() => /To-do One v1/.test(document.querySelector('.week-card').textContent), null, { timeout: 6000 }).catch(() => {});
    chk(tag('Day: a feed refresh repaints the cards but keeps the typed text, the focus in the box and an opened group'), await page.evaluate(() =>
      /To-do One v1/.test(document.querySelector('.week-card').textContent)
      && document.getElementById('tell-alfred-input').value === 'remind me Tuesday to call the dentist'
      && document.activeElement.id === 'tell-alfred-input' && [...document.querySelectorAll('.week-card details.day-fold')][0].open === true));
    chk(tag('Day: the Tell Alfred box is labelled and says so'), await page.evaluate(() => {
      const f = document.getElementById('tell-alfred');
      return f.getAttribute('aria-label') === 'Tell Alfred' && document.querySelector('label[for="tell-alfred-input"]').textContent === 'Tell Alfred'
        && !/Grok/.test(f.textContent);
    }));
    await page.press('#tell-alfred-input', 'Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Got it: remind me Tuesday to call the dentist/.test(t.textContent)),
      null, { timeout: 6000 }).catch(() => {});
    chk(tag("Day: Tell Alfred posts the words to /api/assistant/tell, shows the reply and what was saved, and clears the box"),
      JSON.stringify(tellCalls[0] || null) === JSON.stringify({ text: 'remind me Tuesday to call the dentist' }) && await page.evaluate(() =>
        [...document.querySelectorAll('.toast')].some((t) => /Got it: remind me Tuesday to call the dentist/.test(t.textContent) && /Reminder: Call the dentist/.test(t.textContent))
        && document.getElementById('tell-alfred-input').value === '' && !document.getElementById('tell-alfred-input').disabled
        && document.activeElement.id === 'tell-alfred-input'), JSON.stringify(tellCalls));
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

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
      return JSON.stringify(kids.slice(-2)) === '["day-add","day-refresh"]' && /\+ Add/.test(document.getElementById('day-add').textContent);
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

    // Edit on today's reminder row: prefilled from the row, and only what changed is sent.
    chk(tag('Day: every reminder row with a Done button also has an Edit button (a chore has Done alone)'), await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.day-actions')].filter((g) => g.querySelector('[aria-label^="Mark done"]'));
      const chores = [...document.querySelectorAll('.day-actions')].filter((g) => g.querySelector('[aria-label^="Done for this week"]'));
      return groups.length > 0 && groups.every((g) => [...g.querySelectorAll('button')].some((b) => b.textContent === 'Edit'))
        && chores.length > 0 && chores.every((g) => g.querySelectorAll('button').length === 1);
    }));
    const dueRow = '.today-card .day-item.today';
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
    chk(tag("Day: Edit on today's reminder opens the editor prefilled with that row (title, kind, date, time, scope)"),
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

    // Your routines: the card, its rows, Edit prefill, and Pause / Resume.
    const myRoutines = await page.evaluate(() => {
      const col = document.querySelector('.day-col.right');
      const card = col && col.querySelector(':scope > .routines-card');
      if (!card) return null;
      return { tag: card.tagName, title: card.querySelector('.day-card-title').firstChild.textContent, count: card.querySelector('.day-count').textContent,
        rows: [...card.querySelectorAll('.day-item.routine')].map((r) => r.textContent) };
    });
    chk(tag('Day: a "Your routines" card sits in the right column, counting every routine'),
      !!myRoutines && myRoutines.tag === 'SECTION' && myRoutines.title === 'Your routines' && myRoutines.count === '4', JSON.stringify(myRoutines));
    chk(tag('Day: Your routines lists active and paused routines with their schedules, paused marked'),
      !!myRoutines && myRoutines.rows.length === 4 && /Morning walk.*daily/.test(myRoutines.rows[0]) && /Weekly review.*Fridays/.test(myRoutines.rows[1])
        && /Water the plants.*Mondays and Thursdays.*paused/.test(myRoutines.rows[3]), JSON.stringify(myRoutines));
    chk(tag("Day: today's routine row in Today has an Edit button"), await page.evaluate(() => {
      const row = document.querySelector('.today-card .day-item.routine');
      return !!row && [...row.querySelectorAll('button')].some((b) => b.textContent === 'Edit');
    }));
    const mine = '.routines-card';
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

    // --- Projects: a tab of its own ----------------------------------------------------------
    await page.click('#views [data-view="projects"]');
    await page.waitForFunction(() => !document.getElementById('pane-projects').hidden
      && document.querySelectorAll('#projects-body .day-project').length > 0, null, { timeout: 8000 }).catch(() => {});
    chk(tag('Projects: its tab shows the Projects pane (Day hidden, tab selected, no composer)'), await page.evaluate(() =>
      !document.getElementById('pane-projects').hidden && document.getElementById('pane-day').hidden
      && document.querySelector('#views [data-view="projects"]').getAttribute('aria-selected') === 'true' && location.hash === '#projects'
      && getComputedStyle(document.getElementById('composer-dock')).visibility === 'hidden'));
    chk(tag('Projects: each project shows its title, status, track, update, where it stands and next'), await page.evaluate(() => {
      const p = document.querySelector('#projects-body .day-project');
      return !!p && p.querySelector('.dp-name').textContent === 'Demo' && p.querySelector('.dp-meta').textContent === 'Active · Personal · updated 2026-01-01'
        && /^Where it stands\(2026-01-01\) Going fine\.$/.test(p.querySelector('.dp-stands').textContent)
        && /^NextShip it\.$/.test(p.querySelector('.dp-next').textContent)
        && /^1 project in the shared brain$/.test(document.getElementById('projects-summary').textContent);
    }));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); });
    await page.click('#projects-body .day-project');
    await page.waitForFunction(() => document.getElementById('panel').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    chk(tag("Projects: clicking a project opens its status note in the reader"), await page.evaluate(() =>
      document.getElementById('panel').classList.contains('open') && document.getElementById('panel-title').textContent === 'Demo'));
    await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); if (document.activeElement) document.activeElement.blur(); });

    // --- The Terminals tab is gone ---------------------------------------------------------
    await page.keyboard.press('4');
    await sleep(200);
    chk(tag('Terminals: key 4 does nothing now (still on Projects, no Terminals pane, tab or hash)'), await page.evaluate(() =>
      !document.getElementById('pane-projects').hidden && !document.getElementById('pane-command')
      && !document.querySelector('#views [data-view="command"]') && location.hash === '#projects'));
    await page.keyboard.press('2');
    await page.waitForFunction(() => !document.getElementById('pane-projects').hidden, null, { timeout: 5000 }).catch(() => {});
    chk(tag('Projects: key 2 opens the Projects tab'), await page.evaluate(() => !document.getElementById('pane-projects').hidden));
    await page.keyboard.press('1');
    await page.waitForFunction(() => !document.getElementById('pane-day').hidden, null, { timeout: 5000 }).catch(() => {});
    await page.keyboard.press('/');
    chk(tag('Day: "/" opens the Brain and puts focus in the Ask bar'), await page.evaluate(() =>
      !document.getElementById('pane-brain').hidden && document.activeElement.id === 'search-input'));
    await page.evaluate(() => { document.activeElement.blur(); });
    // An old bookmark to #command must land on Day, not on a blank page.
    const old = await ctx.newPage();
    await old.goto(BASE + '/?nogate=1#command', { waitUntil: 'domcontentloaded' });
    await old.waitForFunction(() => !!document.getElementById('pane-day'), null, { timeout: 5000 }).catch(() => {});
    chk(tag('an old #command link falls back to Day'), await old.evaluate(() =>
      !document.getElementById('pane-day').hidden && document.getElementById('pane-brain').hidden && document.getElementById('pane-projects').hidden), await old.evaluate(() => location.hash));
    await old.close();

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
    await page.unroute('**/api/assistant/action').catch(() => {});
    await page.unroute('**/api/assistant/tell').catch(() => {});
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
