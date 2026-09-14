// --- morning-brief.mjs -------------------------------------------------------
// Composes the "morning brief" a button triggers on demand: Alfred's own status
// (the same content the startup greeting reports) followed by the dp brief —
// the AI-summarized daily digest DP_dailybrief's GitHub Action produces and
// commits back to its repo as output/latest-brief.json.
//
// Pure, like greeting.mjs, and for the same reason: a missing GitHub
// connection, a stale brief (today's Action run hasn't landed yet, or failed),
// and an empty brief all matter and none of them are reachable from a live
// server on a morning when everything actually worked.
// -------------------------------------------------------------------------

// The Action runs on an 8am EST cron. Age rather than calendar-date equality,
// so a check a few hours either side of midnight in either timezone (the
// runner's UTC vs. the operator's local clock) never misreads a brief that
// actually ran this morning as stale, or a genuinely stale one as fresh.
export const STALE_BRIEF_HOURS = 20;

export function briefAgeHours(dpBriefDateIso, now) {
  const then = new Date(dpBriefDateIso).getTime();
  if (!Number.isFinite(then)) return Infinity;
  return (now.getTime() - then) / 3600000;
}

// The dp digest/spokenText arrives as one AI-written block of prose. Shown
// as a single joined string it reads as a wall of text, so the modal wants
// it broken into paragraphs: honor blank-line breaks already in the source,
// and if there are none, group sentences into ~280-char chunks rather than
// handing back one unbroken block.
export function splitIntoParagraphs(text) {
  const byBlankLine = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;

  const sentences = text.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [text];
  const groups = [];
  let current = '';
  for (const s of sentences) {
    if (current && (current + s).length > 280) { groups.push(current.trim()); current = ''; }
    current += s;
  }
  if (current.trim()) groups.push(current.trim());
  return groups.length ? groups : [text];
}

/**
 * Same content as composeMorningBrief, kept as an array so a caller that
 * renders to HTML (the modal) can show real paragraphs instead of one
 * joined string. composeMorningBrief below is this, joined — every existing
 * caller that wants a flat string for speech keeps working unchanged.
 *
 * @param {object} o
 * @param {string} o.statusText  Alfred's own status line(s) — reuse buildGreeting's text.
 * @param {?object} o.dpBrief    { date, mode, articleCount, digest, spokenText } from
 *   output/latest-brief.json, `{ error }` if the fetch/parse failed, or null/undefined
 *   if there is no GitHub connection to fetch it with at all.
 * @param {Date} o.now
 */
export function composeMorningBriefParagraphs({ statusText, dpBrief, now }) {
  const paragraphs = [];
  const status = String(statusText || '').trim();
  if (status) paragraphs.push(status);

  paragraphs.push('Now, your daily brief.');

  if (!dpBrief) {
    paragraphs.push('I could not reach GitHub for the daily brief — connect a GitHub account from the Workshop and try again.');
    return paragraphs;
  }
  if (dpBrief.error) {
    paragraphs.push(`The daily brief could not be read: ${dpBrief.error}`);
    return paragraphs;
  }

  const text = String(dpBrief.spokenText || dpBrief.digest || '').trim();
  if (!text) {
    paragraphs.push('The daily brief file was empty.');
    return paragraphs;
  }

  const ageHours = briefAgeHours(dpBrief.date, now);
  if (ageHours > STALE_BRIEF_HOURS) {
    const rounded = Math.max(1, Math.round(ageHours));
    paragraphs.push(`Heads up — the newest brief I have is from about ${rounded} hours ago, not this morning's run.`);
  }
  paragraphs.push(...splitIntoParagraphs(text));

  return paragraphs;
}

export function composeMorningBrief(args) {
  return composeMorningBriefParagraphs(args).join(' ');
}
