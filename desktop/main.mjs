// --- main.mjs ------------------------------------------------------------------
// Alfred on the desktop. Finds Alfred's engine (the same server the dashboard always
// used, on 127.0.0.1 only) or starts it, and shows the dashboard in its own window.
// Minimised or closed, the window gives way to a small floating brain that can be
// dragged anywhere; clicking it brings the dashboard back. Quit from the brain's
// right-click menu or the tray icon.
// ---------------------------------------------------------------------------
import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Configuration ---
// ALFRED_USER_DATA keeps a test run's saved state and log away from the real app's.
if (process.env.ALFRED_USER_DATA) app.setPath('userData', process.env.ALFRED_USER_DATA);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_URL = process.env.ALFRED_ENGINE_URL || 'http://127.0.0.1:7777';
const TOKEN_FILE = process.env.ALFRED_TOKEN_FILE || path.join(os.homedir(), '.claude', 'alfred-session.token');
const STATE_FILE = path.join(app.getPath('userData'), 'state.json');
const ENGINE_LOG = path.join(app.getPath('userData'), 'engine.log');
const ICON = path.join(HERE, 'build', 'icon.png');
const SIZES = [['Small', 160], ['Medium', 220], ['Large', 320], ['Extra large', 440]];
const MIN_SIZE = 120;
const MAX_SIZE = 800;
const DEFAULT_SIZE = 220;
const EDGE = 24;
const POLL_MS = 30 * 1000;
const RETRY_MS = 4 * 1000;
const ENGINE_WAIT_MS = 90 * 1000;
const STARTED_HIDDEN = process.argv.includes('--hidden');

let main = null;
let widget = null;
let tray = null;
let engine = null;          // the engine process, only when this app started it
let quitting = false;
let status = { online: false, count: 0, attention: false, lines: ['Starting Alfred…'] };

// --- Saved state: window bounds and where the brain sits ---
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
let state = readState();
// The brain's saved spot ("home"): where it opens, and where "Go back" takes it. Moving or
// resizing it doesn't change home until the user saves from the menu. The first version
// saved every move (widget, widgetSize); that last spot becomes the home once.
if (!state.home && state.widget) {
  state = { ...state, home: { x: state.widget.x, y: state.widget.y, size: Number(state.widgetSize) || DEFAULT_SIZE } };
  delete state.widget;
  delete state.widgetSize;
}
const clampSize = (s) => Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(s) || DEFAULT_SIZE)));
const homeSize = () => clampSize(state.home?.size);
const currentSize = () => (widget ? widget.getBounds().width : homeSize());
const pinned = () => state.pinned !== false;   // on top of other windows unless the user turned it off
let saveTimer = null;
function saveState(patch) {
  state = { ...state, ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
  }, 400);
}

// --- The engine ---
function engineDir() {
  if (process.env.ALFRED_ENGINE_DIR) return process.env.ALFRED_ENGINE_DIR;
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'engine.json'), 'utf8')).dir; } catch { /* not packaged */ }
  return path.resolve(HERE, '..', 'brain');
}

function nodeExe() {
  if (process.env.ALFRED_NODE) return process.env.ALFRED_NODE;
  const standard = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe');
  return fs.existsSync(standard) ? standard : 'node';
}

function token() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim().split(':').slice(1).join(':'); } catch { return ''; }
}

async function engineUp() {
  try { return (await fetch(`${ENGINE_URL}/api/status`, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}

// Uses the engine that is already running (the sign-in script starts one); starts it otherwise.
async function ensureEngine() {
  if (await engineUp()) return true;
  const dir = engineDir();
  if (!fs.existsSync(path.join(dir, 'server.mjs'))) throw new Error(`Alfred's engine isn't at ${dir}`);
  fs.mkdirSync(path.dirname(ENGINE_LOG), { recursive: true });
  const log = fs.openSync(ENGINE_LOG, 'a');
  engine = spawn(nodeExe(), ['server.mjs'], {
    cwd: dir, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, PORT: new URL(ENGINE_URL).port || '80' },
  });
  engine.on('exit', () => { engine = null; });
  const until = Date.now() + ENGINE_WAIT_MS;
  while (Date.now() < until) {
    if (await engineUp()) return true;
    if (!engine) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Alfred's engine didn't start. Its log is ${ENGINE_LOG}`);
}

// --- The dashboard window ---
function onScreen(rect) {
  if (!rect || rect.x == null) return false;
  const wa = screen.getDisplayMatching(rect).workArea;
  return rect.x < wa.x + wa.width - 40 && rect.x + rect.width > wa.x + 40 && rect.y >= wa.y - 10 && rect.y < wa.y + wa.height - 40;
}

const isEngine = (url) => url.startsWith(`${ENGINE_URL}/`) || url === ENGINE_URL;

function createMain() {
  const b = onScreen(state.main) ? state.main : { width: 1600, height: 1000 };
  main = new BrowserWindow({
    ...b, minWidth: 900, minHeight: 600, show: false, title: 'Alfred', icon: ICON,
    backgroundColor: '#07080d', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  main.setMenuBarVisibility(false);
  main.loadFile(path.join(HERE, 'loading.html'));
  const keep = () => { if (!main.isMinimized() && !main.isMaximized()) saveState({ main: main.getBounds() }); };
  main.on('resize', keep);
  main.on('move', keep);
  main.on('minimize', () => toWidget());
  main.on('close', (e) => { if (!quitting) { e.preventDefault(); toWidget(); } });
  // Links out of the dashboard open in the browser; its own pages stay here.
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (isEngine(url)) return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, backgroundColor: '#07080d' } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  main.webContents.on('will-navigate', (e, url) => {
    if (isEngine(url) || url.startsWith('file:')) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
}

function showMain() {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  widget?.hide();
}

function toWidget() {
  main?.hide();
  if (widget) { widget.setAlwaysOnTop(pinned(), 'floating'); widget.showInactive(); }
}

// Runs a step on the dashboard's Day page once it is showing.
async function onDayPage(script) {
  showMain();
  if (!isEngine(main.webContents.getURL())) return;
  await main.webContents.executeJavaScript(
    `(() => { const day = document.querySelector('.view-btn[data-view="day"]'); if (day) day.click(); ${script} })()`, true).catch(() => {});
}

// --- The floating brain ---
// A square window drawn edge to edge by widget.js. It sizes itself (the grip in its corner,
// or the Size menu) rather than through Windows' frame, which a transparent window lacks.
function defaultSpot(size = DEFAULT_SIZE) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - size - EDGE, y: wa.y + wa.height - size - EDGE };
}

// Home if it is saved and still on a connected screen; the primary screen's corner otherwise.
function homeSpot() {
  const size = homeSize();
  const h = state.home;
  return h && onScreen({ x: h.x, y: h.y, width: size, height: size }) ? { x: h.x, y: h.y, size } : { ...defaultSpot(size), size };
}

function createWidget() {
  const { x, y, size } = homeSpot();
  const spot = { x, y };
  widget = new BrowserWindow({
    x: spot.x, y: spot.y, width: size, height: size, show: false,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: pinned(),
    title: 'Alfred', icon: ICON,
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  widget.setAlwaysOnTop(pinned(), 'floating');
  widget.loadFile(path.join(HERE, 'widget.html'));
  widget.webContents.on('did-finish-load', () => widget.webContents.send('widget:status', status));
  widget.on('close', (e) => { if (!quitting) { e.preventDefault(); widget.hide(); } });
}

function setWidgetSize(size) {
  if (!widget) return;
  const s = clampSize(size);
  const b = widget.getBounds();
  widget.setBounds({ x: Math.round(b.x + (b.width - s) / 2), y: Math.round(b.y + (b.height - s) / 2), width: s, height: s });
}

const atHome = () => {
  const b = widget?.getBounds();
  return !!(b && state.home && b.x === state.home.x && b.y === state.home.y && b.width === homeSize());
};
function saveHome() {
  if (!widget) return;
  const b = widget.getBounds();
  saveState({ home: { x: b.x, y: b.y, size: b.width } });
}
function clearHome() {
  saveState({ home: undefined });
  const spot = defaultSpot(DEFAULT_SIZE);
  widget?.setBounds({ ...spot, width: DEFAULT_SIZE, height: DEFAULT_SIZE });
}
function goHome() {
  const { x, y, size } = homeSpot();
  widget?.setBounds({ x, y, width: size, height: size });
}

function setPinned(on) {
  saveState({ pinned: on });
  widget?.setAlwaysOnTop(on, 'floating');
}

let drag = null;
ipcMain.on('widget:drag-start', () => {
  if (!widget) return;
  drag = { ...widget.getBounds(), from: screen.getCursorScreenPoint() };
});
ipcMain.on('widget:drag', () => {
  if (!widget || !drag) return;
  const now = screen.getCursorScreenPoint();
  widget.setBounds({ x: drag.x + now.x - drag.from.x, y: drag.y + now.y - drag.from.y, width: drag.width, height: drag.height });
});
ipcMain.on('widget:drag-end', () => { drag = null; });

// The grip resizes from the top-left corner, keeping the window square.
let sizing = null;
ipcMain.on('widget:resize-start', () => {
  if (!widget) return;
  sizing = { ...widget.getBounds(), from: screen.getCursorScreenPoint() };
});
ipcMain.on('widget:resize', () => {
  if (!widget || !sizing) return;
  const now = screen.getCursorScreenPoint();
  const grow = Math.max(now.x - sizing.from.x, now.y - sizing.from.y);
  const s = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, sizing.width + grow)));
  widget.setBounds({ x: sizing.x, y: sizing.y, width: s, height: s });
});
ipcMain.on('widget:resize-end', () => { sizing = null; });
ipcMain.on('widget:save-home', () => saveHome());
ipcMain.on('widget:clear-home', () => clearHome());
ipcMain.on('widget:open', () => showMain());
ipcMain.on('widget:menu', () => menu().popup({ window: widget }));

// --- Menu (the brain's right-click and the tray) ---
function menu() {
  const login = app.isPackaged ? [{
    label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
    click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
  }] : [];
  return Menu.buildFromTemplate([
    { label: 'Open Alfred', click: () => showMain() },
    { label: 'Tell Alfred…', click: () => onDayPage("const i = document.getElementById('tell-alfred-input'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); }") },
    { label: 'Morning brief', click: () => onDayPage("const b = document.getElementById('day-brief'); if (b) b.click();") },
    { type: 'separator' },
    { label: 'Keep on top of other windows', type: 'checkbox', checked: pinned(), click: (item) => setPinned(item.checked) },
    { label: 'Size', submenu: SIZES.map(([label, px]) => ({
      label, type: 'radio', checked: currentSize() === px, click: () => setWidgetSize(px),
    })) },
    { type: 'separator' },
    atHome() ? { label: 'This spot and size are saved', enabled: false } : { label: 'Save this spot and size', click: () => saveHome() },
    { label: state.home ? 'Go back to the saved spot' : 'Put the brain back in the corner', click: () => goHome() },
    { label: 'Clear the saved spot and size', enabled: !!state.home, click: () => clearHome() },
    ...login,
    { type: 'separator' },
    { label: 'Quit Alfred', click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Alfred');
  tray.on('click', () => (main?.isVisible() ? toWidget() : showMain()));
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

// --- What the brain shows: what's left today and what needs the user ---
const len = (a) => (Array.isArray(a) ? a.length : 0);
async function poll() {
  try {
    const r = await fetch(`${ENGINE_URL}/api/assistant`, { headers: { 'X-Alfred-Token': token() }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`engine answered ${r.status}`);
    const f = await r.json();
    const late = len(f.overdue) + len(f.carryOver) + len(f.chores?.late);
    const needs = len(f.needsYou);
    const left = Math.max(0, (f.progress?.total || 0) - (f.progress?.done || 0));
    const next = [...(f.overdue || []), ...(f.carryOver || []), ...(f.chores?.late || []), ...(f.today || []), ...(f.chores?.due || [])][0];
    const lines = [left ? `${left} left today` : 'Nothing left today'];
    if (late) lines.push(`${late} late`);
    if (needs) lines.push(`${needs} waiting on you`);
    if (next) lines.push(`Next: ${next.title}`);
    // Which regions of the brain had notes change lately, so they ripple as on the Brain tab.
    const s = await fetch(`${ENGINE_URL}/api/status`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()).catch(() => ({}));
    status = { online: true, count: left + needs, attention: late + needs > 0, lines, activity: s.brainActivity?.folders || {} };
  } catch {
    status = { online: false, count: 0, attention: false, lines: ["Alfred's engine isn't answering"], activity: {} };
  }
  widget?.webContents.send('widget:status', status);
  tray?.setToolTip(['Alfred', ...status.lines].join('\n'));
}

// --- Start ---
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.on('before-quit', () => { quitting = true; });
  // Only an engine this app started is stopped, with everything it started (its terminals).
  app.on('will-quit', () => {
    if (!engine) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { windowsHide: true });
    else engine.kill();
  });
  app.on('window-all-closed', () => { /* the brain and the tray keep Alfred running */ });
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.alfred.desktop');
    createMain();
    createWidget();
    createTray();
    if (STARTED_HIDDEN) toWidget(); else main.show();
    try {
      await ensureEngine();
      await main.loadURL(`${ENGINE_URL}/`);
    } catch (err) {
      await main.loadFile(path.join(HERE, 'loading.html'), { query: { error: err.message } });
    }
    // Every 30 seconds; every few while the engine isn't answering yet (it is still starting).
    const loop = async () => { await poll(); setTimeout(loop, status.online ? POLL_MS : RETRY_MS); };
    loop();
  });
}
