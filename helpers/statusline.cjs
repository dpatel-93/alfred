#!/usr/bin/env node
// Alfred statusline — native Claude Code, no framework dependencies.
// Reads the statusline JSON Claude Code pipes on stdin; prints one ANSI line.
//
// Why context and cost are here rather than in a hook: hooks receive NO
// context-usage field on any event (verified against the current hook input
// spec), so "warn me at 50%" is not buildable as a hook. The statusline is the
// only surface that gets `context_window.used_percentage` and
// `cost.total_cost_usd` pre-calculated. It is also the right shape for it — a
// number that is always visible beats a warning that fires once and gets
// learned-past, which is exactly how a SKIP notice hid three dead test suites
// for months.
//
// The 50% mark is not decoration. Measured over 18 days of real transcripts:
// cache reads are 97.3% of all billed tokens, because the whole context is
// re-billed every turn and the context grows — so session cost is roughly
// QUADRATIC in turns. The `main` session alone was $1,709, 48% of $3,572 total.
// `used_percentage` is Claude Code's own figure against whatever
// autoCompactWindow is actually configured (600000 as of the compaction-loop
// fix, was 100000 when this comment was first written) — this stays a
// relative, not absolute, warning: half of a much larger budget is still a
// legitimately large amount of context, so the 50% mark scales correctly on
// its own without hardcoding the window size here.

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let d = {};
  // `|| {}` is load-bearing: JSON.parse('null') succeeds and returns null, and
  // `d.model?.display_name` then throws on `d.model` — the optional chain
  // guards the wrong hop. A statusline that throws prints an error into the
  // prompt on every single render.
  try { d = JSON.parse(raw) || {}; } catch { /* fall through to defaults */ }
  if (typeof d !== 'object') d = {};

  const C = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
  const model = d.model?.display_name || d.model?.id || 'Claude';
  const dir = (d.workspace?.current_dir || process.cwd()).replace(/\\/g, '/').split('/').pop();
  const style = d.output_style?.name;

  // Git branch, best-effort; execFileSync (no shell) with a hard timeout so it never hangs.
  let branch = '';
  try {
    const { execFileSync } = require('child_process');
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: d.workspace?.current_dir || process.cwd(),
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { /* not a repo */ }

  // Context pressure. Thresholds mirror CLAUDE.md, and the colour escalates so
  // the number is readable as a state at a glance rather than needing to be
  // compared against a remembered rule.
  //   <50 green · 50-69 yellow (worth noticing) · 70-84 orange · 85+ red
  let ctx = '';
  const pct = d.context_window?.used_percentage;
  if (typeof pct === 'number' && isFinite(pct)) {
    const p = Math.round(pct);
    const colour = p >= 85 ? '1;31' : p >= 70 ? '31' : p >= 50 ? '33' : '32';
    // The marker earns its place only past the line — before that it is noise.
    const flag = p >= 50 ? ' COMPACT' : '';
    ctx = C(colour, `ctx ${p}%${flag}`);
  }

  // Session cost. Shown from the first cent rather than at a threshold: the
  // expensive sessions were expensive gradually, and a number that only appears
  // once it is alarming teaches nothing on the way up.
  //
  // Labelled "api-eq", and that label is not decoration. `total_cost_usd` is
  // what this SESSION's tokens would cost at list API prices. On a Pro or Max
  // subscription nothing is billed per token, so the figure is a meter reading,
  // not an invoice — and it is per session, not per month. Unlabelled it reads
  // as spend, which is exactly how it was first misread here: a $305 session on
  // a $200/month plan looked like a $105 overrun and was neither.
  //
  // One label for every plan on purpose. The honest description is "cost at API
  // list prices", which is true on a subscription (where it is notional) and on
  // API billing (where it also happens to be the bill). Guessing the plan from
  // whether `rate_limits` is present would be a heuristic that is confidently
  // wrong for someone.
  let cost = '';
  const usd = d.cost?.total_cost_usd;
  if (typeof usd === 'number' && isFinite(usd) && usd > 0.005) {
    // Tier matters more than the absolute figure — $5 on haiku is a long
    // productive session, $5 on fable is a handful of turns.
    const tier = /fable|opus/i.test(model) ? (usd >= 5 ? '1;31' : usd >= 2 ? '31' : '33') : '90';
    cost = C(tier, `≈$${usd < 10 ? usd.toFixed(2) : Math.round(usd)} api-eq`);
  }

  // Rate limits, only once they are worth knowing about — a 5-hour window at
  // 12% is not information.
  let rl = '';
  const five = d.rate_limits?.five_hour?.used_percentage;
  if (typeof five === 'number' && five >= 70) {
    rl = C(five >= 90 ? '1;31' : '33', `5h ${Math.round(five)}%`);
  }

  const parts = [
    C('36', model),
    C('33', dir),
    branch && C('32', branch),
    ctx,
    cost,
    rl,
    style && C('35', style),
  ].filter(Boolean);

  process.stdout.write(parts.join(` ${C('90', '|')} `));
});
