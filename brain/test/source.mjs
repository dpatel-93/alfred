// Protocols + source-editor suite.
//
// Every case here exists because it was a real bug or a real near-miss during
// the build, not because the route looked worth covering:
//
//   - Plugin files live UNDER ~/.claude, so the first editability rule ("is it
//     inside ~/.claude") reported every installed plugin command as writable.
//     A test write during verification truncated a real plugin file to one
//     byte. Two independent vetoes now guard it, and both are asserted.
//   - /api/library/item and /api/charter both serve markdown with the
//     frontmatter STRIPPED. Editing that and saving it would delete an agent's
//     name, tier and model. /api/source must serve the raw file, and this
//     suite proves the frontmatter is still there.
//   - A settings.json that does not parse takes hooks and permissions down
//     with it, and fails later as "the hook stopped firing" rather than as a
//     save error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const B = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = [];
function chk(name, cond, detail = '') { R.push({ n: name, ok: !!cond, d: String(detail) }); }

const html = await (await fetch(B + '/')).text();
const TOKEN = (html.match(/var ALFRED_TOKEN = '([^']+)'/) || [])[1];

async function j(p, o) { const r = await fetch(B + p, o); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; }
const H = { 'X-Alfred-Token': TOKEN, 'Content-Type': 'application/json' };
const save = (payload, headers = H) => fetch(B + '/api/source/save', { method: 'POST', headers, body: JSON.stringify(payload) });
const src = (id) => j('/api/source?id=' + encodeURIComponent(id));

// Every negative case below posts the file's OWN CURRENT CONTENT rather than a
// short marker string. The first version of this suite posted 'x', and when
// the plugin guard was deliberately broken to prove the test could go red, the
// test itself truncated a real plugin command to one byte. A guard test must
// be harmless in exactly the case it is designed to catch — otherwise the
// first time it earns its keep is the first time it does damage.
async function expectRefused(id, wantStatus, name) {
  const before = await src(id);
  const payload = typeof before.d?.content === 'string' ? before.d.content : '';
  const r = await save({ id, content: payload });
  chk(name, r.status === wantStatus, `got ${r.status}`);
  return before;
}

// --- /api/protocols ------------------------------------------------------
const proto = await j('/api/protocols');
chk('GET /api/protocols -> 200', proto.s === 200, `got ${proto.s}`);
const tiers = (proto.d && proto.d.tiers) || [];
chk('protocols returns all five scope tiers', tiers.length === 5, `got ${tiers.length}`);
chk('tiers are ordered broadest-scope first',
  tiers.map((t) => t.key).join(',') === 'enterprise,user,home,project,scoped',
  tiers.map((t) => t.key).join(','));
chk('every tier states which way precedence runs', tiers.every((t) => typeof t.note === 'string' && t.note.length > 0), '');
chk('an empty tier explains itself rather than rendering blank',
  tiers.every((t) => t.entries.length > 0 || (typeof t.emptyText === 'string' && t.emptyText.length > 0)), '');
chk('the payload states the precedence rule outright',
  typeof proto.d?.precedence === 'string' && /narrowest/i.test(proto.d.precedence), proto.d?.precedence || '');

const allEntries = tiers.flatMap((t) => t.entries);
chk('protocol entries never ship the absolute path',
  allEntries.every((e) => !('file' in e)), 'an entry carried `file`');
chk('protocol paths are tildified, so a screenshot cannot publish the account name',
  allEntries.every((e) => !e.path.includes(os.homedir())), '');
chk('each entry carries a rule preview and a real total',
  allEntries.every((e) => Array.isArray(e.rules) && typeof e.ruleCount === 'number' && e.ruleCount >= e.rules.length), '');

const userTier = tiers.find((t) => t.key === 'user');
const userClaudeMd = userTier.entries.find((e) => e.label === '~/.claude/CLAUDE.md');
chk('~/.claude/CLAUDE.md is present and editable', !!userClaudeMd && userClaudeMd.editable === true,
  userClaudeMd ? String(userClaudeMd.editable) : 'missing');

// --- closed-map lookup ---------------------------------------------------
for (const bad of ['../../../etc/passwd', '..\\..\\windows\\win.ini', 'protocol:deadbeefcafe', '']) {
  const r = await src(bad);
  chk(`GET /api/source rejects "${bad || '(empty)'}"`, r.s === 404 || r.s === 400, `got ${r.s}`);
  chk(`404 for "${bad || '(empty)'}" does not echo the id back`,
    !JSON.stringify(r.d || {}).includes(bad) || bad === '', JSON.stringify(r.d));
}

// --- raw source, frontmatter intact --------------------------------------
const lib = await j('/api/library');
const items = (lib.d && lib.d.items) || [];
const userAgent = (await j('/api/agent-directory')).d?.agents?.[0];
if (userAgent) {
  const raw = await src('agent:' + userAgent.name.toLowerCase());
  chk('agent source is served raw, frontmatter included',
    raw.s === 200 && typeof raw.d.content === 'string' && raw.d.content.trimStart().startsWith('---'),
    raw.d?.content ? raw.d.content.slice(0, 40) : `status ${raw.s}`);
  const display = await j('/api/charter?agent=' + encodeURIComponent(userAgent.name));
  chk('the display route still strips frontmatter — the two are NOT the same text',
    display.s === 200 && display.d.markdown !== raw.d.content, '');
} else {
  chk('agent source is served raw, frontmatter included', false, 'no agents in the directory to test against');
  chk('the display route still strips frontmatter — the two are NOT the same text', false, 'no agents');
}

// --- plugin files are never writable -------------------------------------
const pluginItem = items.find((i) => i.origin === 'plugin' && i.type !== 'hook');
if (pluginItem) {
  const ps = await src(pluginItem.id);
  chk('a plugin-installed file reports itself read-only', ps.s === 200 && ps.d.editable === false, String(ps.d?.editable));
  chk('and says why, naming the plugin update that would discard the edit',
    /plugin/i.test(ps.d?.readOnlyReason || ''), ps.d?.readOnlyReason || '');
  await expectRefused(pluginItem.id, 403, 'POST save on a plugin file -> 403');
} else {
  chk('a plugin-installed file reports itself read-only', false, 'no plugin items installed to test against');
  chk('and says why, naming the plugin update that would discard the edit', false, 'no plugin items');
  chk('POST save on a plugin file -> 403', false, 'no plugin items');
}

// --- files outside ~/.claude are never writable --------------------------
const projectEntry = tiers.find((t) => t.key === 'project').entries[0];
if (projectEntry) {
  const ps = await src(projectEntry.id);
  chk("a project's own CLAUDE.md reports itself read-only", ps.s === 200 && ps.d.editable === false, String(ps.d?.editable));
  await expectRefused(projectEntry.id, 403, 'POST save on a project CLAUDE.md -> 403');
} else {
  chk("a project's own CLAUDE.md reports itself read-only", true, 'no project CLAUDE.md on this machine — nothing to guard');
  chk('POST save on a project CLAUDE.md -> 403', true, 'no project CLAUDE.md on this machine');
}

// --- the write path, on a file this suite owns ---------------------------
// A real file under ~/.claude/commands so it flows through the same scanner
// and the same id space as everything else. Removed in the finally.
const FIXTURE = path.join(os.homedir(), '.claude', 'commands', 'alfred-source-suite-fixture.md');
const ORIGINAL = ['---', 'description: Temporary fixture written by brain/test/source.mjs.', '---', '',
  '# Fixture', '', 'LINE ONE — with an em dash, so an encoding bug shows up as a diff.', 'LINE TWO', ''].join('\n');
try {
  fs.writeFileSync(FIXTURE, ORIGINAL, 'utf8');
  const list = await j('/api/library');
  const fixture = (list.d.items || []).find((i) => i.source && i.source.includes('alfred-source-suite-fixture'));
  chk('a new ~/.claude command appears in the library', !!fixture, '');

  if (fixture) {
    const before = await src(fixture.id);
    chk('fixture is editable', before.d.editable === true, String(before.d.editable));
    chk('fixture source round-trips byte-for-byte', before.d.content === ORIGINAL, '');

    const noTok = await save({ id: fixture.id, content: ORIGINAL }, { 'Content-Type': 'application/json' });
    chk('POST save without a token -> 401/403', noTok.status === 401 || noTok.status === 403, `got ${noTok.status}`);
    chk('and the refused write left the file alone', fs.readFileSync(FIXTURE, 'utf8') === ORIGINAL, '');

    const stale = await save({ id: fixture.id, content: ORIGINAL + 'x', baseMtimeMs: 1 });
    chk('POST save with a stale mtime -> 409', stale.status === 409, `got ${stale.status}`);
    chk('and the conflicted write left the file alone', fs.readFileSync(FIXTURE, 'utf8') === ORIGINAL, '');

    const NEXT = ORIGINAL.replace('LINE ONE', 'LINE ONE REWRITTEN');
    const ok = await save({ id: fixture.id, content: NEXT, baseMtimeMs: before.d.mtimeMs });
    chk('POST save with the right token and mtime -> 200', ok.status === 200, `got ${ok.status}`);
    chk('the file on disk is exactly what was sent', fs.readFileSync(FIXTURE, 'utf8') === NEXT, '');
    chk('the em dash survived the round trip', fs.readFileSync(FIXTURE, 'utf8').includes('—'), '');

    const after = await src(fixture.id);
    chk('the mtime moved, so the next edit diffs against the new state', after.d.mtimeMs > before.d.mtimeMs, '');
  }
} finally {
  try { fs.unlinkSync(FIXTURE); } catch { /* already gone */ }
}

// --- a settings file that would not parse is refused ---------------------
const settingsEntry = userTier.entries.find((e) => e.label.endsWith('settings.json'));
if (settingsEntry) {
  const s = await src(settingsEntry.id);
  const bad = await save({ id: settingsEntry.id, content: '{ "hooks": ', baseMtimeMs: s.d.mtimeMs });
  chk('POST save of unparsable JSON -> 400', bad.status === 400, `got ${bad.status}`);
  const body = await bad.json().catch(() => ({}));
  chk('and the error says it is a JSON problem, not a generic failure', /json/i.test(body.error || ''), body.error || '');
  const still = await src(settingsEntry.id);
  chk('settings.json is untouched after the refusal', still.d.content === s.d.content, '');
} else {
  chk('POST save of unparsable JSON -> 400', false, 'no ~/.claude/settings.json to test against');
  chk('and the error says it is a JSON problem, not a generic failure', false, 'no settings.json');
  chk('settings.json is untouched after the refusal', false, 'no settings.json');
}

for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d));
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));
