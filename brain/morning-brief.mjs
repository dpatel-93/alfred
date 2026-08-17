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

/**
 * @param {object} o
 * @param {string} o.statusText  Alfred's own status line(s) — reuse buildGreeting's text.
 * @param {?object} o.dpBrief    { date, mode, articleCount, digest, spokenText } from
 *   output/latest-brief.json, `{ error }` if the fetch/parse failed, or null/undefined
 *   if there is no GitHub connection to fetch it with at all.
 * @param {Date} o.now
 */
export function composeMorningBrief({ statusText, dpBrief, now }) {
  const lines = [];
  const status = String(statusText || '').trim();
  if (status) lines.push(status);

  lines.push('Now, your daily brief.');

  if (!dpBrief) {
    lines.push('I could not reach GitHub for the daily brief — connect a GitHub account from the Workshop and try again.');
    return lines.join(' ');
  }
  if (dpBrief.error) {
    lines.push(`The daily brief could not be read: ${dpBrief.error}`);
    return lines.join(' ');
  }

  const text = String(dpBrief.spokenText || dpBrief.digest || '').trim();
  if (!text) {
    lines.push('The daily brief file was empty.');
    return lines.join(' ');
  }

  const ageHours = briefAgeHours(dpBrief.date, now);
  if (ageHours > STALE_BRIEF_HOURS) {
    const rounded = Math.max(1, Math.round(ageHours));
    lines.push(`Heads up — the newest brief I have is from about ${rounded} hours ago, not this morning's run.`);
  }
  lines.push(text);

  return lines.join(' ');
}
