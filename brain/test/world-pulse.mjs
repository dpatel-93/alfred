// --- world-pulse.mjs ----------------------------------------------------
// Pure-function coverage for the morning brief's Grok-sourced world-pulse
// section: prompt shape, response parsing (valid, malformed, fenced,
// partial), paragraph rendering, and fetchWorldPulse's error contract — all
// via the injected `run` so this suite never makes a real Grok call. A peer
// call is approval-gated and costs real quota; a test suite is not a place
// that gets to spend it on every run.
//
//   node brain/test/world-pulse.mjs
// ---------------------------------------------------------------------------

import {
  CATEGORIES, WORLD_PULSE_LEAD_IN,
  worldPulsePrompt, parseWorldPulse, worldPulseParagraphs, fetchWorldPulse,
} from '../world-pulse.mjs';

const results = [];
const chk = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -- ${detail}`}`);
};

// --- worldPulsePrompt ---------------------------------------------------------

const prompt = worldPulsePrompt(new Date(2026, 0, 2, 7, 0, 0));
chk('the prompt names every category', CATEGORIES.every((c) => prompt.includes(c.key)), prompt);
chk('the prompt asks for JSON only, no markdown fences', /JSON object/.test(prompt) && /no markdown fences/.test(prompt));
chk('the prompt says it is broad, not personalized', /not personalized/.test(prompt));

// --- parseWorldPulse -----------------------------------------------------------

const cleanJson = JSON.stringify({
  geopolitics: 'A ceasefire took effect.',
  techAI: 'A new model shipped.',
  markets: 'Stocks rallied.',
  scienceCulture: 'A telescope found something.',
});
const clean = parseWorldPulse(cleanJson);
chk('a clean JSON reply parses into categories', !clean.error && Object.keys(clean.categories).length === 4, JSON.stringify(clean));

const fenced = parseWorldPulse('```json\n' + cleanJson + '\n```');
chk('a reply wrapped in markdown fences still parses', !fenced.error && fenced.categories.geopolitics === 'A ceasefire took effect.', JSON.stringify(fenced));

const chatty = parseWorldPulse(`Sure, here you go:\n${cleanJson}\nHope that helps!`);
chk('a reply with chatty prose around the JSON still parses', !chatty.error && chatty.categories.markets === 'Stocks rallied.', JSON.stringify(chatty));

const partial = parseWorldPulse(JSON.stringify({ geopolitics: 'Something happened.', techAI: '' }));
chk('empty-string category values are dropped, not kept as blanks', !partial.error && !('techAI' in partial.categories), JSON.stringify(partial));
chk('a partial-but-nonempty reply still counts as success', !partial.error);

chk('an empty response is an error, not a crash', parseWorldPulse('').error === 'empty response');
chk('a response with no JSON object at all is an error', parseWorldPulse('no braces here').error === 'no JSON object in the response');
chk('malformed JSON inside braces is an error, not a throw', /unparsable/.test(parseWorldPulse('{not: valid, json}').error || ''));
chk('valid JSON with none of the expected keys is an error', parseWorldPulse('{"weather": "sunny"}').error === 'response had no usable categories');

// --- worldPulseParagraphs -------------------------------------------------------

const rendered = worldPulseParagraphs(clean);
chk('renders the disclaimer lead-in first', rendered[0] === WORLD_PULSE_LEAD_IN, JSON.stringify(rendered));
chk('renders one labeled line per category', rendered.length === CATEGORIES.length + 1, JSON.stringify(rendered));
chk('each line carries its category label', rendered.some((l) => l.startsWith('Geopolitics: ')), JSON.stringify(rendered));

chk('no categories at all renders as nothing, not an empty disclaimer', worldPulseParagraphs({ categories: {} }).length === 0);
chk('a missing categories object renders as nothing', worldPulseParagraphs({}).length === 0);

const onlyOne = worldPulseParagraphs({ categories: { markets: 'Stocks rallied.' } });
chk('a single surviving category still gets the disclaimer plus its own line', onlyOne.length === 2 && onlyOne[1] === 'Markets & economy: Stocks rallied.', JSON.stringify(onlyOne));

// --- fetchWorldPulse (injected run — never the real Grok call) -----------------

const okResult = await fetchWorldPulse({ run: async () => cleanJson });
chk('fetchWorldPulse resolves to categories when the injected run succeeds', !okResult.error && Object.keys(okResult.categories).length === 4, JSON.stringify(okResult));

const failResult = await fetchWorldPulse({ run: async () => { throw new Error('grok: not logged in'); } });
chk('a rejected run becomes an {error} result, not a thrown exception', failResult.error === 'grok: not logged in', JSON.stringify(failResult));

const garbledResult = await fetchWorldPulse({ run: async () => 'not json at all' });
chk('a garbled run output becomes an {error} result via parseWorldPulse', /no JSON object/.test(garbledResult.error || ''), JSON.stringify(garbledResult));

console.log(`\n${results.length - results.filter((r) => !r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed`);
console.log('__ALFRED_RESULTS__' + JSON.stringify(results.map((r) => ({ n: r.name, ok: r.ok, d: r.detail }))));
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
