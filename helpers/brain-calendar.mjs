#!/usr/bin/env node
// --- brain-calendar.mjs ------------------------------------------------------
// Google Calendar as the date bus of the shared brain.
//
// The brain's Reminders/ files stay the truth. This module keeps a dedicated
// Google calendar ("Second Brain") in step with them, both ways:
//   brain -> calendar   every open dated reminder is an all-day event there;
//                       closing the reminder removes the event
//   calendar -> brain   an event anyone (Grok's connector, the phone, the user)
//                       creates in that calendar becomes a reminder file; moving
//                       the event moves the reminder; deleting it closes it
// and reads the user's other calendars (shared ones and invitations included)
// so the dashboard can show the month with dots.
//
// Auth is Google's OAuth "desktop app" loopback flow: the HUD opens the consent
// page, Google redirects to http://127.0.0.1:<port>/oauth2/google, the server
// exchanges the code once and keeps only the refresh token, in an owner-only
// file under ~/.alfred. No credential is ever logged or returned to the page.
//
//   node brain-calendar.mjs status | sync | view
// ---------------------------------------------------------------------------
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { addDays, collectOpenItems, easternNow, readFields, setField, sharedBrainPath } from './brain-librarian.mjs';

// --- Configuration ---------------------------------------------------------
const CONFIG_DIR = process.env.ALFRED_LOCAL_CONFIG_DIR || path.join(os.homedir(), '.alfred');
const CONFIG_FILE = path.join(CONFIG_DIR, 'google-calendar.json');
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const BRAIN_CALENDAR_NAME = 'Second Brain';
const TIMEZONE = 'America/New_York';
const CLOSED_LOOKBACK_DAYS = 30;

// The network is injectable so the sync logic is testable against a fake Google.
let fetchImpl = (...args) => globalThis.fetch(...args);
export function setFetch(fn) { fetchImpl = fn || ((...args) => globalThis.fetch(...args)); }

export function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined || next[k] === '') delete next[k];
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* Windows */ }
  return next;
}

// What the page may know. Never the secret, never a token.
export function calendarStatus() {
  const c = loadConfig();
  return {
    configured: !!(c.clientId && c.clientSecret),
    connected: !!c.refreshToken,
    account: c.account || null,
    brainCalendarId: c.brainCalendarId || null,
    lastSync: c.lastSync || null,
    lastError: c.lastError || null,
  };
}

// --- OAuth (desktop loopback) ----------------------------------------------
const pending = new Map(); // state -> { port, at }

export function connectUrl(port) {
  const c = loadConfig();
  if (!c.clientId || !c.clientSecret) throw new Error('Google client ID and secret are not set');
  const state = crypto.randomBytes(16).toString('hex');
  pending.set(state, { port, at: Date.now() });
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri(port), response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, include_granted_scopes: 'true',
  });
  return `${AUTH_URL}?${q}`;
}
const redirectUri = (port) => `http://127.0.0.1:${port}/oauth2/google`;

export async function finishConnect({ code, state }) {
  const p = pending.get(state);
  if (!p || Date.now() - p.at > 10 * 60 * 1000) throw new Error('sign-in request expired or unknown; start again');
  pending.delete(state);
  const c = loadConfig();
  const tok = await postForm(TOKEN_URL, {
    code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(p.port), grant_type: 'authorization_code',
  });
  if (!tok.refresh_token) throw new Error('Google did not return a refresh token; remove Alfred under Google account > Security > Third-party access and connect again');
  accessCache = { token: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 - 60000 };
  saveConfig({ refreshToken: tok.refresh_token, lastError: null });
  // Whose calendar is this? The primary calendar's id is the account address; keep it for the label only.
  try {
    const primary = await gcal('GET', '/calendars/primary');
    saveConfig({ account: primary.id || null });
  } catch { /* label only */ }
  await ensureBrainCalendar();
  return calendarStatus();
}

export function disconnect() {
  accessCache = null;
  saveConfig({ refreshToken: null, account: null, brainCalendarId: null, syncTokens: null, lastSync: null, lastError: null });
  return calendarStatus();
}

let accessCache = null;
async function accessToken() {
  if (accessCache && Date.now() < accessCache.exp) return accessCache.token;
  const c = loadConfig();
  if (!c.refreshToken) throw new Error('Google Calendar is not connected');
  const tok = await postForm(TOKEN_URL, {
    refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token',
  });
  accessCache = { token: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 - 60000 };
  return accessCache.token;
}

async function postForm(url, fields) {
  const res = await fetchImpl(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in: ${body.error_description || body.error || res.status}`);
  return body;
}

// One call shape for the whole API. A 401 refreshes once; anything else surfaces.
export async function gcal(method, p, { query, body } = {}) {
  const url = new URL(`${API}${p}`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let attempt = 0;
  for (;;) {
    const token = await accessToken();
    const res = await fetchImpl(url, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt++ === 0) { accessCache = null; continue; }
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Google Calendar ${method} ${p}: ${data.error?.message || res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
}

// --- The Second Brain calendar ---------------------------------------------
export async function ensureBrainCalendar() {
  const c = loadConfig();
  if (c.brainCalendarId) {
    try { await gcal('GET', `/calendars/${encodeURIComponent(c.brainCalendarId)}`); return c.brainCalendarId; } catch { /* recreate below */ }
  }
  const list = await gcal('GET', '/users/me/calendarList', { query: { minAccessRole: 'writer' } });
  const found = (list.items || []).find((x) => x.summary === BRAIN_CALENDAR_NAME);
  const id = found ? found.id : (await gcal('POST', '/calendars', { body: { summary: BRAIN_CALENDAR_NAME, timeZone: TIMEZONE,
    description: 'Dated reminders from the shared brain. Alfred keeps this in step with Reminders/; events created here become reminders.' } })).id;
  saveConfig({ brainCalendarId: id });
  return id;
}

// --- Sync: Reminders/ <-> the Second Brain calendar -------------------------
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'event';
const titleOf = (text, fallback) => (text.match(/^#\s+(.+)$/m) || [, fallback])[1].trim();
const firstWord = (v) => String(v || '').toLowerCase().split(/[\s(·]/)[0];
const dateOf = (when) => (when?.date) || (when?.dateTime ? toEastern(when.dateTime) : null);
function toEastern(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function timeOf(when) {
  if (!when?.dateTime) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(when.dateTime)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

function eventFor(item, rel) {
  return {
    summary: item.title,
    description: `${item.kind}${item.scope ? ` · ${item.scope}` : ''}\n\nbrain: ${rel}\nKept in step by Alfred. Move or delete this event and the reminder follows.`,
    start: { date: item.due }, end: { date: addDays(item.due, 1) },
    transparency: 'transparent',
    extendedProperties: { private: { brainFile: rel, brainKind: item.kind || 'reminder', syncedDue: item.due } },
  };
}

function reminderFileFor(ev, now) {
  const due = dateOf(ev.start);
  const at = timeOf(ev.start);
  const kind = due === now.date ? 'errand' : 'reminder';
  const text = [`# ${ev.summary || 'Untitled'}`, '',
    `- **Kind:** ${kind}`, '- **Status:** open', `- **Due:** ${due}${at ? ` ${at}` : ''}`, `- **Until:** ${kind === 'errand' ? 'end-of-day' : 'done'}`,
    '- **Scope:** personal', '- **Nudge:** car + wake', '- **Author:** calendar (created in the Second Brain Google calendar)', `- **Created:** ${now.stamp}`,
    `- **Last updated:** ${now.stamp}`, '',
    ...(ev.description ? [ev.description.trim(), ''] : []),
    ...(ev.location ? [`Where: ${ev.location}`, ''] : []),
    `Calendar event: ${ev.id}`, ''].join('\n');
  return { name: `${due}--${slugify(ev.summary)}.md`, text, due, kind };
}

async function brainEvents(calendarId, { updatedMin } = {}) {
  const out = [];
  let pageToken;
  do {
    const page = await gcal('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, {
      query: { showDeleted: 'true', singleEvents: 'true', maxResults: 250, pageToken, ...(updatedMin ? { updatedMin } : {}) },
    });
    out.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * One pass, both directions. Returns what it did, as lines, like the Librarian.
 * Order matters: pull the calendar's own changes first (moves, deletes, new events),
 * then push the brain's state, so a reminder closed at the desk wins over a stale event.
 */
export async function syncCalendar(brain = sharedBrainPath(), now = easternNow()) {
  const actions = [];
  const c = loadConfig();
  if (!c.refreshToken) return { ok: false, error: 'not connected', actions };
  if (!brain || !fs.existsSync(brain)) return { ok: false, error: 'shared brain not found', actions };
  try {
    const calendarId = await ensureBrainCalendar();
    const open = collectOpenItems(brain, now);
    const dated = open.all.filter((i) => i.due);
    const byFile = new Map(dated.map((i) => [i.file, i]));
    const events = await brainEvents(calendarId);
    const byBrainFile = new Map();
    const foreign = [];
    for (const ev of events) {
      const rel = ev.extendedProperties?.private?.brainFile;
      if (rel) byBrainFile.set(rel, ev);
      else if (ev.status !== 'cancelled') foreign.push(ev);
    }

    // 1. Calendar -> brain. New events become reminders; moved events move the reminder;
    //    deleted events close it.
    for (const ev of foreign) {
      if (!dateOf(ev.start)) continue;
      const file = reminderFileFor(ev, now);
      const dup = dated.find((i) => i.title.toLowerCase() === String(ev.summary || '').toLowerCase() && i.due === file.due);
      let rel;
      if (dup && byBrainFile.has(dup.file)) {
        // The reminder already has its event; this one is a second copy (Grok wrote the file and the event).
        await gcal('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`);
        actions.push(`remove  duplicate event "${ev.summary}"  (reminder ${dup.file} already has one)`);
        continue;
      }
      if (dup) rel = dup.file;  // Grok wrote the file AND the event, with no event of ours yet: adopt it
      else {
        rel = `Reminders/${file.name}`;
        let full = path.join(brain, rel);
        for (let n = 2; fs.existsSync(full); n++) { rel = `Reminders/${file.name.replace(/\.md$/, `-${n}.md`)}`; full = path.join(brain, rel); }
        fs.writeFileSync(full, file.text, 'utf8');
        actions.push(`create  ${rel}  (from calendar event "${ev.summary}")`);
      }
      await gcal('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`, {
        body: { extendedProperties: { private: { brainFile: rel, brainKind: file.kind, syncedDue: file.due } } } });
      byBrainFile.set(rel, { ...ev, extendedProperties: { private: { brainFile: rel, syncedDue: file.due } } });
    }
    for (const [rel, ev] of byBrainFile) {
      const full = path.join(brain, rel);
      const inOpen = byFile.get(rel);
      if (ev.status === 'cancelled') {
        if (inOpen && fs.existsSync(full)) {
          let t = fs.readFileSync(full, 'utf8');
          t = `${setField(t, 'Status', 'done').replace(/^- \*\*Last updated:\*\*.*$/m, `- **Last updated:** ${now.stamp}`).trimEnd()}\n- Closed: ${now.stamp} via Google Calendar (event removed)\n`;
          fs.writeFileSync(full, t, 'utf8');
          const done = path.join(brain, 'Reminders', 'Done'); fs.mkdirSync(done, { recursive: true });
          const dest = path.join(done, path.basename(full)); if (!fs.existsSync(dest)) fs.renameSync(full, dest);
          actions.push(`close   ${rel}  (event removed from calendar)`);
        }
        continue;
      }
      const evDue = dateOf(ev.start);
      const synced = ev.extendedProperties?.private?.syncedDue;
      if (inOpen && evDue && synced && evDue !== synced && evDue !== inOpen.due) {
        // The event moved since we last synced it and the file did not: the calendar wins.
        let t = fs.readFileSync(full, 'utf8');
        t = `${setField(t, 'Due', evDue).replace(/^- \*\*Last updated:\*\*.*$/m, `- **Last updated:** ${now.stamp}`).trimEnd()}\n- Moved: ${now.stamp} to ${evDue} via Google Calendar\n`;
        fs.writeFileSync(full, t, 'utf8');
        inOpen.due = evDue;
        actions.push(`move    ${rel}  -> ${evDue} (event moved in calendar)`);
        await gcal('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`, {
          body: { extendedProperties: { private: { ...ev.extendedProperties.private, syncedDue: evDue } } } });
      }
    }

    // 2. Brain -> calendar. Every open dated reminder has an event; closed ones lose theirs.
    //    Re-read the brain first: step 1 may have created, moved or closed files.
    const current = collectOpenItems(brain, now).all.filter((i) => i.due);
    const currentByFile = new Map(current.map((i) => [i.file, i]));
    for (const item of current) {
      const ev = byBrainFile.get(item.file);
      if (!ev || ev.status === 'cancelled') {
        await gcal('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, { body: eventFor(item, item.file) });
        actions.push(`event   ${item.file}  (created in calendar)`);
      } else if (dateOf(ev.start) !== item.due || ev.summary !== item.title) {
        await gcal('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`, { body: eventFor(item, item.file) });
        actions.push(`event   ${item.file}  (updated in calendar: ${item.due})`);
      }
    }
    for (const [rel, ev] of byBrainFile) {
      if (currentByFile.has(rel) || ev.status === 'cancelled') continue;
      // The file is closed, undated now, or gone: the event goes.
      await gcal('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`);
      actions.push(`remove  event for ${rel}  (reminder closed or gone)`);
    }
    saveConfig({ lastSync: new Date().toISOString(), lastError: null });
    return { ok: true, actions, calendarId };
  } catch (err) {
    saveConfig({ lastError: String(err.message || err).slice(0, 200) });
    return { ok: false, error: String(err.message || err).slice(0, 200), actions };
  }
}

// --- The month view: every calendar the account sees, including shared ones and invites ---
// Window: from the 1st of last month through the end of next month, so the grid's ‹ › never
// steps into blank weeks within one month either side of today.
const monthStart = (date, offset) => { const [y, m] = date.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + offset, 1)); return d.toISOString().slice(0, 10); };
export async function calendarView(now = easternNow(), { from: fromOpt, to: toOpt } = {}) {
  const c = loadConfig();
  if (!c.refreshToken) return { connected: false };
  const from = fromOpt || monthStart(now.date, -1);
  const to = toOpt || monthStart(now.date, 2);  // exclusive: the first day after next month
  const list = await gcal('GET', '/users/me/calendarList');
  const calendars = (list.items || []).filter((x) => x.selected !== false && !x.deleted).map((x) => ({
    id: x.id, name: x.summaryOverride || x.summary, color: x.backgroundColor || null, primary: !!x.primary,
    brain: x.id === c.brainCalendarId, role: x.accessRole,
  }));
  const days = {};
  for (const cal of calendars) {
    let pageToken;
    do {
      let page;
      try {
        page = await gcal('GET', `/calendars/${encodeURIComponent(cal.id)}/events`, { query: {
          timeMin: `${from}T00:00:00-04:00`, timeMax: `${to}T00:00:00-04:00`, singleEvents: 'true', orderBy: 'startTime', maxResults: 250, pageToken,
        } });
      } catch (err) { if (err.status === 404 || err.status === 403) break; throw err; }
      for (const ev of page.items || []) {
        if (ev.status === 'cancelled') continue;
        const mine = (ev.attendees || []).find((a) => a.self);
        if (mine && mine.responseStatus === 'declined') continue;
        const date = dateOf(ev.start);
        if (!date) continue;
        // A multi-day event sits on every day it covers (all-day end dates are exclusive).
        let last = ev.end?.date ? addDays(ev.end.date, -1) : (ev.end?.dateTime ? toEastern(ev.end.dateTime) : date);
        if (last < date) last = date;
        const row = {
          id: ev.id, calendar: cal.name, calendarId: cal.id, color: cal.color, brain: cal.brain,
          title: ev.summary || '(no title)', allDay: !!ev.start?.date, start: ev.start?.dateTime || ev.start?.date, end: ev.end?.dateTime || ev.end?.date,
          time: timeOf(ev.start), location: ev.location || null, htmlLink: ev.htmlLink || null,
          invite: !!mine, response: mine ? mine.responseStatus : null, brainFile: ev.extendedProperties?.private?.brainFile || null,
        };
        for (let d = date, i = 0; d <= last && i < 60; d = addDays(d, 1), i++) {
          if (d < from || d >= to) continue;
          (days[d] ||= []).push(d === date && d === last ? row : { ...row, spanStart: d === date, spanEnd: d === last, time: d === date ? row.time : null });
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  for (const d of Object.keys(days)) days[d].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { connected: true, account: c.account || null, from, to: addDays(to, -1), calendars, days, fetchedAt: new Date().toISOString() };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const cmd = process.argv[2] || 'status';
  (async () => {
    if (cmd === 'status') console.log(JSON.stringify(calendarStatus(), null, 2));
    else if (cmd === 'sync') console.log(JSON.stringify(await syncCalendar(), null, 2));
    else if (cmd === 'view') console.log(JSON.stringify(await calendarView(), null, 2));
    else console.log('usage: brain-calendar.mjs status | sync | view');
  })().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
