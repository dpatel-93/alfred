// Ground-truth questions for the chunk-retrieval recall evaluation.
// Every `substring` below was verified verbatim against the real vault file
// against the author's own vault on 2026-08-08 —
// see retrieval-eval.mjs's header comment for how these are used.
//
// `offsetPct` is the substring's position as a percentage through the raw
// file (0 = start, 100 = end) — recorded so "answer sits late in the file"
// claims are backed by a number, not an assumption.
const EVAL_QUESTIONS = [
  {
    id: 'q1-org-chart-count',
    q: 'how many agents are in the alfred org chart',
    path: 'Projects/Alfred.md',
    substring: '51 chartered agents',
    mustNotSurfaceSubstring: 'commands 88', // the header/decision-log line the OLD system answers from instead
    offsetPct: 17, // 4314 / 25362
    note: 'Concrete bug from the brief: old system answers "88" (a commands-count line at the top of the file) instead of the real per-tier breakdown, which sits well past the 400-char excerpt and the 2000-char embed cutoff.',
  },
  {
    id: 'q2-obsidian-decision-no-regress',
    q: 'what did we decide about obsidian',
    path: 'Decisions/2026-08-08 -- Retire Obsidian, Unify as Alfred Framework.md',
    substring: 'Retire Obsidian (and Claudian) from the stack',
    offsetPct: 1, // file is only 1251 bytes; this is at char 15 — already correct today
    note: 'REGRESSION GUARD — this file is short enough (1.2KB) that today\'s note-level excerpt already contains the answer. Chunking must not make this WORSE.',
  },
  {
    id: 'q5-runbook-cadence',
    q: 'what is the recommended cadence for reviewing power platform environment governance',
    path: 'Patterns/Copilot-Studio-PowerPlatform-Environment-Governance-Runbook.md',
    substring: 'verify no unexpected envs; review env group rule drift',
    offsetPct: 94, // 26222 / 28002 — last third of a 28,304-byte note
    note: 'Late-in-long-note case #2.',
  },
  {
    id: 'q6-zero-cost-total',
    q: 'what is the total monthly cost of the zero-cost azure architecture',
    path: 'Patterns/Zero-Cost-Azure-Architecture.md',
    substring: '~$0.05/month',
    offsetPct: 54, // 1291 / 2397 — short file, mid-document cost table
    note: 'Sixth question (3+ required beyond the 3 given) — a specific number in a short note, sanity-checks chunking does not hurt easy cases.',
  },
];

export { EVAL_QUESTIONS };
