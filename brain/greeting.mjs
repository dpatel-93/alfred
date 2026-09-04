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

/**
 * @param {object} o
 * @param {string}  o.name       what to call the operator
 * @param {Date}    o.now        used only for time of day
 * @param {object}  o.counts     { skill, command, agents }
 * @param {number}  o.notes      vault note count
 * @param {boolean} o.indexStale
 * @param {?Array}  o.mcpServers null means "not probed yet" — distinct from []
 * @param {string[]} o.recent    recently touched note titles
 * @param {boolean} o.returning  false on the very first greeting ever
 */
export function composeGreeting({ name, now, counts, notes, indexStale, mcpServers, recent, returning }) {
  const lines = [];
  lines.push(`${timeOfDayGreeting(now)}, ${name}. ${returning ? 'Welcome back.' : 'Welcome.'}`);

  const ready = [];
  if (counts.skill) ready.push(countNoun(counts.skill, 'skill'));
  if (counts.command) ready.push(countNoun(counts.command, 'command'));
  if (counts.agents) ready.push(countNoun(counts.agents, 'agent'));
  if (ready.length) lines.push(`${spokenList(ready)} ready.`);

  // null and [] mean different things and must not collapse: "still checking"
  // is honest, "no tool servers are configured" is a finding.
  if (!mcpServers) {
    lines.push('Still checking the tool connections.');
  } else if (!mcpServers.length) {
    lines.push('No tool servers are configured.');
  } else {
    const broken = mcpServers.filter((s) => s.state !== 'connected');
    if (!broken.length) {
      lines.push(`All ${countNoun(mcpServers.length, 'tool server')} connected.`);
    } else {
      const named = broken.map((s) => `${spokenServerName(s.name)} ${s.state === 'auth' ? 'needs signing in' : 'is down'}`);
      lines.push(`${mcpServers.length - broken.length} of ${countNoun(mcpServers.length, 'tool server')} connected. ${spokenList(named)}.`);
    }
  }

  lines.push(`The brain holds ${countNoun(notes, 'note')}${indexStale ? ', and the index is stale — worth a refresh' : ', index fresh'}.`);
  if (recent.length) lines.push(`Newest in the brain: ${spokenList(recent)}.`);

  return lines.join(' ');
}
