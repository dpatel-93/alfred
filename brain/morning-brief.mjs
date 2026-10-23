// --- morning-brief.mjs -------------------------------------------------------
// Composes the "morning brief" a button triggers on demand: Alfred's status (the
// greeting's lines), then Grok's morning brief from the shared brain —
// Outputs/briefs/YYYY-MM-DD.md, which Grok Bot compiles every weekday around
// 07:00 ET. Grok owns the news now; this only reads what it already wrote, so
// there is no GitHub fetch and no live search behind the button any more.
//
// Pure, like greeting.mjs: a missing brief, an unreadable one, and a stale one
// (weekends, or Grok has not run yet) all matter, and none are reachable on
// demand from a live machine on a morning when everything worked.
// -------------------------------------------------------------------------

const plain = (s) => String(s)
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // [text](url) -> text
  .replace(/https?:\/\/\S+/g, '')                 // bare urls are not read aloud
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
  .replace(/\s+\|\s*$/, '').replace(/\s+/g, ' ').trim();

const firstSentence = (s) => (plain(s).match(/^.+?[.!?](?=\s|$)/) || [plain(s)])[0];
const endStop = (s) => {
  const t = s.replace(/[\s,:;–-]+$/, '');
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * Grok's markdown brief, turned into something worth listening to: the "Top of
 * the brief" in full (headline + one sentence), then every other section as
 * its headlines only. Sources, URLs, sub-bullets and the metadata line are for
 * reading, not hearing; the modal shows the whole file for that.
 */
export function spokenBrief(markdown) {
  const sections = [];
  let cur = null;
  for (const line of String(markdown).split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { cur = { title: plain(h[1]), items: [], bullets: [] }; sections.push(cur); continue; }
    if (!cur) continue;
    const n = line.match(/^\d+\.\s+(.*)$/);
    if (n) {
      const bold = n[1].match(/^\*\*(.+?)\*\*\s*(.*)$/);
      cur.items.push(bold ? { head: plain(bold[1]), rest: bold[2] } : { head: firstSentence(n[1]), rest: '' });
      continue;
    }
    const b = line.match(/^-\s+(.*)$/);
    if (b && !/^sources?:/i.test(b[1].trim())) cur.bullets.push(firstSentence(b[1]));
  }

  const out = [];
  for (const s of sections) {
    if (/^top\b/i.test(s.title)) {
      out.push(...s.items.map((i) => [endStop(i.head), i.rest && firstSentence(i.rest)].filter(Boolean).join(' ')));
      continue;
    }
    const heads = s.items.length ? s.items.map((i) => i.head) : s.bullets;
    if (heads.length) out.push(`${endStop(s.title)} ${heads.map(endStop).join(' ')}`);
  }
  return out.filter(Boolean);
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * @param {object} o
 * @param {string} o.statusText  Alfred's status — the greeting, minus its brief line.
 * @param {?object} o.brief      brain-assistant.mjs latestBrief(..., { withMarkdown: true }),
 *   `{ error }` if the brain could not be read, or null when there is no brief at all.
 */
export function composeMorningBriefParagraphs({ statusText, brief }) {
  const paragraphs = [];
  const status = String(statusText || '').trim();
  if (status) paragraphs.push(status);

  if (!brief) {
    paragraphs.push('There is no morning brief from Grok in the shared brain yet.');
    return paragraphs;
  }
  if (brief.error) {
    paragraphs.push(`Grok's morning brief could not be read: ${brief.error}`);
    return paragraphs;
  }
  if (!brief.isToday) {
    const day = WEEKDAY[new Date(`${brief.date}T12:00:00Z`).getUTCDay()];
    paragraphs.push(`Heads up: there is no brief from Grok yet today, so this is ${day}'s.`);
  }
  const spoken = spokenBrief(brief.markdown || '');
  if (!spoken.length) {
    paragraphs.push("Grok's morning brief is there, but it has nothing to read out.");
    return paragraphs;
  }
  paragraphs.push("Now, Grok's morning brief.", ...spoken);
  return paragraphs;
}

export function composeMorningBrief(args) {
  return composeMorningBriefParagraphs(args).join(' ');
}
