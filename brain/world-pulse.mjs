// --- world-pulse.mjs ---------------------------------------------------------
// A "what is the world talking about right now" section for the morning
// brief, sourced from Grok — per ~/.claude/helpers/providers.json, the one
// provider in Alfred's roster with native, live X and web search built in.
// Everything else in the brief is either a straight file read (the dp
// digest) or Claude's own status readout; this is the only part whose
// CONTENT, not just its wording, comes from a model measured at ~64%
// hallucination on settled facts (AA-Omniscience). That is why its output
// never gets folded into the dp digest's prose as if it were the same kind
// of claim — see WORLD_PULSE_LEAD_IN and Grok's own registry `outputContract`.
//
// Standing approval: the operator approved Grok specifically for this one
// feature — the morning brief's world-pulse section — on 2026-09-14, so
// fetchWorldPulse calls it without asking per run. That approval is scoped to
// this feature; nothing else in Alfred may call a peer provider without
// asking first, per ~/.claude/CLAUDE.md's peer-approval rule.
//
// Same pure/impure split as morning-brief.mjs and greeting.mjs: everything
// here except runGrok/fetchWorldPulse is a pure function over already-fetched
// text, so "Grok is unreachable / not logged in / timed out / replied with
// garbage" are all unit-testable without ever making a real call — and
// fetchWorldPulse takes an injectable `run` for exactly that reason.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Overridable so tests can point this at a stub instead of the real CLI —
// same reasoning as test/run.mjs forcing OLLAMA_URL to a closed port for the
// brain suite: a paid, rate-limited peer call has no business running
// unattended every time the test suite does.
const PROVIDER_RUN = process.env.ALFRED_PROVIDER_RUN_PATH
  || path.join(os.homedir(), '.claude', 'helpers', 'provider-run.mjs');
const GROK_TIMEOUT_MS = 60_000;

export const CATEGORIES = [
  { key: 'geopolitics', label: 'Geopolitics' },
  { key: 'techAI', label: 'Tech & AI' },
  { key: 'markets', label: 'Markets & economy' },
  { key: 'scienceCulture', label: 'Science & culture' },
];

export const WORLD_PULSE_LEAD_IN = "Now, a look at the wider world — this next part comes from "
  + "Grok's live search, so treat it as a lead worth checking, not settled fact:";

/** Deliberately broad — NOT filtered to the operator's own interests (Azure, trading, etc.), which the dp digest above this section already covers. */
export function worldPulsePrompt(now = new Date()) {
  const keys = CATEGORIES.map((c) => c.key);
  return [
    `It is ${now.toISOString()}. Using live web and X search, give me the most`,
    'critical, most widely-trending world news right now. Broad and general —',
    'not personalized to me, not Azure- or dev-specific, a genuine "what is',
    'the world talking about" pulse.',
    '',
    `Cover exactly these categories: ${keys.join(', ')}.`,
    'For each, 2-3 plain sentences on the single most significant trending',
    'story — skip a category only if nothing is genuinely trending there.',
    '',
    'Reply with ONLY a JSON object, no markdown fences, no commentary before or after:',
    `{"${keys.join('": "...", "')}": "..."}`,
  ].join('\n');
}

/**
 * @param {string} raw  Grok's raw reply — ideally just the JSON object asked
 *   for, but models wrap things in prose or code fences often enough that
 *   this pulls the first {...} blob out rather than requiring an exact match.
 * @returns {{categories: object}|{error: string}}
 */
export function parseWorldPulse(raw) {
  const text = String(raw || '').trim();
  if (!text) return { error: 'empty response' };

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { error: 'no JSON object in the response' };

  let parsed;
  try { parsed = JSON.parse(match[0]); } catch (e) { return { error: `unparsable response: ${e.message}` }; }

  const categories = {};
  for (const { key } of CATEGORIES) {
    const value = String(parsed?.[key] || '').trim();
    if (value) categories[key] = value;
  }
  if (!Object.keys(categories).length) return { error: 'response had no usable categories' };
  return { categories };
}

/**
 * @param {{categories?: object}} result  A successful parseWorldPulse() shape.
 *   Callers branch on `.error` before reaching here — same split
 *   composeMorningBriefParagraphs already uses for dpBrief.
 */
export function worldPulseParagraphs({ categories } = {}) {
  const lines = CATEGORIES
    .map(({ key, label }) => (categories && categories[key] ? `${label}: ${categories[key]}` : null))
    .filter(Boolean);
  return lines.length ? [WORLD_PULSE_LEAD_IN, ...lines] : [];
}

/**
 * Runs the `grok` CLI via provider-run.mjs — the framework's one sanctioned
 * entry point for reaching a peer provider, and the thing that logs usage
 * into ~/.claude/metrics/peer-usage.jsonl for /tokens. Spawned with an array
 * argv and no shell, so a multi-line prompt full of quotes and punctuation
 * reaches provider-run.mjs intact instead of being reassembled by a shell —
 * the exact bug alfred-tts-edge.mjs's header warns about for its own CLI.
 */
export function runGrok(prompt, { timeoutMs = GROK_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PROVIDER_RUN, 'grok', prompt], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('timed out')); }, timeoutMs);
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((err || out).trim().slice(0, 300) || `provider-run exited ${code}`));
      resolve(out);
    });
  });
}

/**
 * @param {object} o
 * @param {Date} [o.now]
 * @param {(prompt: string) => Promise<string>} [o.run]  Injected for tests —
 *   defaults to the real Grok call. A test must never leave this as the
 *   default; that would spend real quota on every run.
 * @returns {Promise<{categories: object}|{error: string}>}  Never throws —
 *   an unreachable/misbehaving Grok is a data shape, not an exception, same
 *   as fetchDpBrief's contract for an unreachable GitHub.
 */
export async function fetchWorldPulse({ now = new Date(), run = runGrok } = {}) {
  try {
    const raw = await run(worldPulsePrompt(now));
    return parseWorldPulse(raw);
  } catch (e) {
    return { error: e.message };
  }
}
