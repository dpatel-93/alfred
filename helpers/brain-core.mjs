// --- brain-core.mjs ----------------------------------------------------------
// The smallest shared pieces of the Second Brain helpers: Eastern time, header
// fields, and folder listing. A leaf module (no imports from the other helpers),
// so the Librarian, the item writer and the change-note reader can all use it
// without an import cycle. brain-librarian.mjs re-exports these for older callers.
// ---------------------------------------------------------------------------
import fs from 'node:fs';

export const DAY_MS = 24 * 60 * 60 * 1000;

// --- Time (the brain keeps Eastern time) ---
export function easternNow(now = new Date(process.env.ALFRED_NOW || Date.now())) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, stamp: `${date} ${p.hour}:${p.minute} ET`, month: `${p.year}-${p.month}`, ms: now.getTime() };
}
export const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// "2026-10-23 22:44 ET" -> the same shape easternNow() returns, so a change can be applied
// "as of" the moment it was asked for. null when the stamp cannot be read.
export function nowFromStamp(stamp) {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s*ET\b/.exec(String(stamp || '').trim());
  if (!m) return null;
  return { date: m[1], stamp: `${m[1]} ${m[2]}:${m[3]} ET`, month: m[1].slice(0, 7), ms: Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) };
}
export const stampOf = (v) => (/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*ET/.exec(String(v || '')) || [''])[0].replace(/\s*ET$/, ' ET');

// --- Header fields: "- **Field:** value" lines near the top ---
export function readFields(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/).slice(0, 40)) {
    const m = line.match(/^- \*\*([A-Za-z ]+):\*\*\s*(.*)$/);
    // First one wins, as setField edits the first: a quoted block lower down can't override the header.
    if (m && !(m[1].trim().toLowerCase() in fields)) fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return fields;
}

export function setField(text, field, value) {
  const re = new RegExp(`^- \\*\\*${field}:\\*\\*.*$`, 'm');
  if (re.test(text)) return text.replace(re, `- **${field}:** ${value}`);
  const lines = text.split('\n');
  let last = -1;
  lines.slice(0, 40).forEach((l, i) => { if (/^- \*\*[A-Za-z ]+:\*\*/.test(l)) last = i; });
  lines.splice(last + 1, 0, `- **${field}:** ${value}`);
  return lines.join('\n');
}

// --- Item schema v1 (MANIFESTO §17.2, §17.3) ---
// Any writer that creates a file, or changes a header field of one, writes `- **Schema:** 1`
// (as the first header field when it is missing). A file without it is schema 0, read as before.
export function withSchema(text) {
  if (/^- \*\*Schema:\*\*.*$/m.test(text)) return text.replace(/^- \*\*Schema:\*\*.*$/m, '- **Schema:** 1');
  const lines = text.split('\n');
  const first = lines.slice(0, 40).findIndex((l) => /^- \*\*[A-Za-z ]+:\*\*/.test(l));
  if (first < 0) return text;
  lines.splice(first, 0, '- **Schema:** 1');
  return lines.join('\n');
}

// The closed list of reason codes; writers use only these.
export const REASONS = ['done', 'cancelled', 'not-needed', 'expired', 'superseded', 'duplicate', 'moved', 'mistake'];
export const reasonOf = (v, fallback) => (REASONS.includes(String(v || '').trim().toLowerCase().split(/[\s(]/)[0])
  ? String(v).trim().toLowerCase().split(/[\s(]/)[0] : fallback);
// One line at the end of the file for every change of state.
export const closedLine = (stamp, who, reason) => `- Closed: ${stamp} by ${who} · reason: ${reason}`;
export const reopenedLine = (stamp, who, reason) => `- Reopened: ${stamp} by ${who} · reason: ${reason}`;
export const appendLine = (text, line) => `${text.trimEnd()}\n${line}\n`;

export const firstWord = (v) => String(v || '').toLowerCase().split(/[\s(·]/)[0];
export const cleanRef = (v) => String(v || '').replace(/[`"]/g, '').split(/\s+\(|;/)[0].trim().replace(/\\/g, '/');
export const mdFiles = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md') : []);
