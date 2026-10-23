// --- greeting.mjs -----------------------------------------------------------
// Composes the HUD's spoken welcome. Pure: no clock, no filesystem, no network,
// no speech. Everything it needs arrives as an argument.
//
// Kept out of server.mjs precisely so the interesting cases can be asserted
// cheaply. What a greeting says when a tool server is down, when the index has
// gone stale, or when it is the very first one, all matter — and none of them
// are reachable from a live server on a healthy machine, which is the only
// machine the tests ever run on.
// ---------------------------------------------------------------------------

/**
 * Parse `claude mcp list`. Lines look like:
 *   name: <target> - ✔ Connected
 *   plugin:github:github: <url> (HTTP) - ✘ Failed to connect — <detail>
 *   name: <url> - ! Needs authentication
 *
 * Classified on the WORDS, never the tick/cross glyphs. Those are the part most
 * likely to be mangled by a console codepage, and a mangled cross read as "fine"
 * would make the greeting lie in the only direction that actually costs anything.
 * Anything that is neither connected nor an auth prompt is treated as failed:
 * unrecognised is not the same as healthy.
 */
export function parseMcpList(stdout) {
  const servers = [];
  for (const raw of String(stdout).split('\n')) {
    const m = raw.trim().match(/^(.+?):\s+(.*?)\s+-\s+(.+)$/);
    if (!m) continue;
    const detail = m[3].trim();
    let state = 'failed';
    if (/\bconnected\b/i.test(detail)) state = 'connected';
    else if (/needs authentication/i.test(detail)) state = 'auth';
    servers.push({ name: m[1].trim(), state, detail });
  }
  return servers;
}

/** The short name a person would say out loud: "plugin:github:github" -> "github". */
export function spokenServerName(name) {
  const parts = String(name).split(':').map((p) => p.trim()).filter(Boolean);
  return (parts[parts.length - 1] || String(name)).replace(/[-_]+/g, ' ');
}

/** Join a list the way it is read aloud: "a, b and c". */
export function spokenList(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function countNoun(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function timeOfDayGreeting(now) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Folders that are MIRRORS, not knowledge. The memory-sync hook rewrites the
// whole Claude-Code/ tree in one pass, so every file in it shares a timestamp
// and, sorted by recency, it buries everything a person actually wrote.
// Measured, not guessed: the first live greeting announced "SessionLog, MEMORY
// and project_cloudopsmcp" — three machine-written files — while that morning's
// real work sat four hundred entries down.
export const MIRRORED_FOLDERS = new Set(['Claude-Code']);

/**
 * A note title as it should be READ, not as it is filed.
 *
 * Vault filing conventions are hostile to speech. Decision notes are named
 * "2026-08-16 — Title", so a greeting reads the date twice over (once per note)
 * before saying anything useful, and an ASCII "--" separator is pronounced.
 * Long titles are cut at a word boundary: a spoken list is scanned by ear, and
 * a fourteen-word title in the middle of one loses the listener entirely.
 */
export function spokenTitle(title, maxChars = 52) {
  let t = String(title)
    .replace(/^\s*\d{4}-\d{2}-\d{2}\s*[-–—:]*\s*/, '')  // leading date stamp
    .replace(/\s*[-–—]{2,}\s*/g, ', ')                   // ASCII dash separators
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = String(title).trim();                      // a title that was ONLY a date
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  let out = lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace) : cut;
  // Cutting at a word boundary is not enough — "Adopt Edge Provenance Not the"
  // ends on two words that promise a noun that never arrives, which sounds like
  // the speaker was interrupted. Drop trailing words that cannot end a phrase.
  out = out.replace(/(\s+(?:a|an|the|and|or|but|of|for|to|in|on|at|by|with|from|not|is|as|its|it)\b)+\s*$/i, '');
  return out.replace(/[,;:]\s*$/, '').trim();
}

/**
 * The most recently touched notes a person would recognise, newest first.
 * Machine-mirrored folders are excluded; "what's new" means what YOU changed.
 */
export function recentNoteTitles(notes, limit = 3) {
  return notes
    .filter((n) => !MIRRORED_FOLDERS.has(String(n.folder || '')))
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    .slice(0, limit)
    .map((n) => spokenTitle(n.title || ''))
    .filter(Boolean);
}

// --- Tools: report the ones the operator set up, count the rest -------------
// `claude mcp list` also lists every connector that plugins and claude.ai
// bundle: a hundred-odd entries, the same Gmail once per plugin that ships it,
// almost none ever signed into. Reading those out buried the one or two that
// mattered. So the greeting names only servers configured directly, once each,
// and merely counts the optional connectors that are switched on.
export function isOptionalServer(name) {
  return /^plugin:/i.test(String(name)) || /^claude\.ai\s/i.test(String(name));
}

/** One entry per spoken name; connected anywhere beats down anywhere. */
function dedupe(servers) {
  const rank = { connected: 2, auth: 1, failed: 0 };
  const byName = new Map();
  for (const s of servers) {
    const key = spokenServerName(s.name).toLowerCase();
    const prev = byName.get(key);
    if (!prev || (rank[s.state] ?? 0) > (rank[prev.state] ?? 0)) byName.set(key, { ...s, spoken: spokenServerName(s.name) });
  }
  return [...byName.values()];
}

export function summarizeTools(mcpServers) {
  const own = dedupe(mcpServers.filter((s) => !isOptionalServer(s.name)));
  const optional = dedupe(mcpServers.filter((s) => isOptionalServer(s.name)));
  return {
    own: own.length,
    ownConnected: own.filter((s) => s.state === 'connected').length,
    ownBroken: own.filter((s) => s.state !== 'connected'),
    optionalConnected: optional.filter((s) => s.state === 'connected').length,
  };
}

function toolsLine(mcpServers) {
  if (!mcpServers) return 'still checking the tool connections.';
  if (!mcpServers.length) return 'no tool servers are configured.';
  const t = summarizeTools(mcpServers);
  const extra = t.optionalConnected ? `, plus ${countNoun(t.optionalConnected, 'add-on connector')}` : '';
  if (!t.own) return `${countNoun(t.optionalConnected, 'add-on connector')} connected.`;
  if (!t.ownBroken.length) return `all ${countNoun(t.own, 'tool')} connected${extra}.`;
  const named = t.ownBroken.map((s) => `${s.spoken} ${s.state === 'auth' ? 'needs signing in' : 'is down'}`);
  return `${t.ownConnected} of ${countNoun(t.own, 'tool')} connected${extra}; ${spokenList(named)}.`;
}

// --- The day, from the shared brain (brain-assistant.mjs's feed) --------------
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (iso) => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const MAX_NAMED = 3;

function namedItems(items, describe = (i) => spokenTitle(i.title, 60)) {
  const shown = items.slice(0, MAX_NAMED).map(describe);
  if (items.length > MAX_NAMED) shown.push(`${items.length - MAX_NAMED} more`);
  return `${spokenList(shown)}.`;
}

function dayLines(today) {
  if (!today) return [];
  if (!today.brain) return [{ label: 'Today', text: 'the shared brain is not reachable, so no reminders.' }];
  const lines = [];
  const late = [...today.overdue, ...today.carryOver];
  if (late.length) lines.push({ label: 'Overdue', text: namedItems(late) });
  lines.push({ label: 'Due today', text: today.today.length ? namedItems(today.today) : 'nothing.' });
  if (today.upcoming.length) {
    lines.push({ label: 'Coming up', text: namedItems(today.upcoming, (i) => `${spokenTitle(i.title, 60)} on ${dayName(i.due)}`) });
  }
  if (today.routines.today.length) lines.push({ label: 'Routines', text: namedItems(today.routines.today) });
  if (today.todos.length) lines.push({ label: 'To-dos', text: `${today.todos.length} open.` });
  if (!('brief' in today)) return lines; // the Morning Brief reads the brief itself
  const b = today.brief;
  if (!b) lines.push({ label: "Grok's brief", text: 'none yet.' });
  else if (!b.isToday) lines.push({ label: "Grok's brief", text: `none yet today; the latest is ${dayName(b.date)}'s.` });
  else lines.push({ label: "Grok's brief", text: b.top.length ? `${b.top[0].title.replace(/\.$/, '')}, and more in the Morning Brief.` : 'in, with no headlines.' });
  return lines;
}

/**
 * The greeting as labelled lines, so the HUD can show it as a short list.
 * Personal-assistant content first, machinery last and in one line.
 *
 * @param {object} o
 * @param {string}  o.name       what to call the operator
 * @param {Date}    o.now        used only for time of day
 * @param {object}  o.counts     { skill, command, agents }
 * @param {number}  o.notes      vault note count
 * @param {boolean} o.indexStale
 * @param {?Array}  o.mcpServers null means "not probed yet" — distinct from []
 * @param {boolean} o.returning  false on the very first greeting ever
 * @param {?object} o.today      brain-assistant.mjs feed, or null to leave the day out
 */
export function composeGreetingLines({ name, now, counts, notes, indexStale, mcpServers, returning, today = null }) {
  const lines = [{ label: null, text: `${timeOfDayGreeting(now)}, ${name}. ${returning ? 'Welcome back.' : 'Welcome.'}` }];
  lines.push(...dayLines(today));

  const ready = [];
  if (counts.skill) ready.push(countNoun(counts.skill, 'skill'));
  if (counts.command) ready.push(countNoun(counts.command, 'command'));
  if (counts.agents) ready.push(countNoun(counts.agents, 'agent'));
  const brain = `brain ${countNoun(notes, 'note')}${indexStale ? ', index stale (worth a refresh)' : ''}`;
  lines.push({ label: 'Systems', text: `${ready.length ? `${spokenList(ready)} ready; ` : ''}${toolsLine(mcpServers).replace(/\.$/, '')}; ${brain}.` });
  return lines;
}

/** The same greeting as one string, for speech. */
export function composeGreeting(args) {
  return composeGreetingLines(args).map((l) => (l.label ? `${l.label}: ${l.text}` : l.text)).join(' ');
}
