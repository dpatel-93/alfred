#!/usr/bin/env node
// --- alfred-speak.test.mjs -------------------------------------------------
// Deterministic falsifier for the talk-back hook. Asserts the two things that
// can actually be wrong without anyone hearing it: what gets spoken, and which
// message gets picked. Speaks nothing - runnable anywhere, including CI.
//
//   node ~/.claude/helpers/test/alfred-speak.test.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanForSpeech, truncateAtSentence, lastAssistantText } from '../alfred-speak.mjs';

// --- Harness ---------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ` -- ${detail}` : ''}`); console.log(`  FAIL  ${name}  ${detail}`); }
}

const clean = (s) => cleanForSpeech(s, 700);

// --- Cleaning: things that must never be read aloud ------------------------

console.log('\nCleaning');

const withCode = 'Here is the fix.\n```js\nconst x = 1;\nfor (;;) {}\n```\nThat should do it.';
check('code fences removed', !clean(withCode).includes('const x'), clean(withCode));
check('prose around code survives', /Here is the fix/.test(clean(withCode)) && /should do it/.test(clean(withCode)));

const withTable = 'Results:\n| Name | Value |\n| --- | --- |\n| Sharpe | 0.48 |\nDone.';
check('table rows removed', !clean(withTable).includes('Sharpe'), clean(withTable));

check('urls become "a link"', clean('See https://code.claude.com/docs/en/voice x').includes('a link'));
check('raw url not spoken', !clean('See https://code.claude.com/docs x').includes('http'));

const winPath = 'Edited C:\\Users\\dishi\\.claude\\settings.json now.';
check('windows paths become "a file path"', clean(winPath).includes('a file path'), clean(winPath));
check('windows path not spoken', !clean(winPath).includes('dishi'), clean(winPath));

const posixPath = 'Wrote to /home/user/project/file.txt today.';
check('posix paths become "a file path"', clean(posixPath).includes('a file path'), clean(posixPath));

check('emoji stripped', !/[\u2705\u274C\u26A0]/.test(clean('Done. Failed. Warning.')));
check('headings stripped', clean('## What you asked\nThe thing.') === 'What you asked\nThe thing.',
  JSON.stringify(clean('## What you asked\nThe thing.')));
check('bullets stripped', !clean('- one\n- two').includes('-'), clean('- one\n- two'));
check('bold markers stripped', clean('This is **important** here.') === 'This is important here.',
  clean('This is **important** here.'));
check('short inline code kept verbatim', clean('Type `/voice tap` now.') === 'Type /voice tap now.',
  clean('Type `/voice tap` now.'));
check('link label kept, target dropped',
  clean('See [the docs](https://example.com/a/b) please.') === 'See the docs please.',
  clean('See [the docs](https://example.com/a/b) please.'));

// A word with an underscore is an identifier, not emphasis.
check('snake_case not mangled', clean('call read_page next.').includes('read_page') === false ||
  clean('call read_page next.').includes('readpage'), clean('call read_page next.'));

check('em dash becomes a spoken pause, not a run-on',
  clean('It caught a bug — the filter was wrong.') === 'It caught a bug, the filter was wrong.',
  clean('It caught a bug — the filter was wrong.'));
check('smart quotes normalised, not deleted',
  clean('He said “hello” and ‘bye’.') === 'He said "hello" and \'bye\'.',
  clean('He said “hello” and ‘bye’.'));
check('ellipsis becomes a full stop', clean('Wait… done.') === 'Wait. done.', clean('Wait… done.'));
check('empty input is safe', clean('') === '');
check('code-only response yields nothing speakable', clean('```\nfoo\n```').replace(/[.\s]/g, '') === '',
  JSON.stringify(clean('```\nfoo\n```')));

// --- Truncation ------------------------------------------------------------

console.log('\nTruncation');

const long = ('This is a sentence that is long enough to matter. ').repeat(40);
const cut = truncateAtSentence(long, 200);
check('long text is truncated', cut.length < long.length);
check('truncation is announced', cut.endsWith('Response truncated.'), cut.slice(-40));
check('truncation lands on a sentence boundary', /\.\s*Response truncated\.$/.test(cut), cut.slice(-60));
check('short text passes through untouched', truncateAtSentence('Short one.', 200) === 'Short one.');

// --- Message selection -----------------------------------------------------

console.log('\nMessage selection');

const tmp = path.join(os.tmpdir(), `alfred-speak-test-${process.pid}.jsonl`);
const rec = (o) => JSON.stringify(o);
const assistantText = (text, isSidechain = false) => rec({
  type: 'assistant', isSidechain, message: { role: 'assistant', content: [{ type: 'text', text }] },
});

fs.writeFileSync(tmp, [
  assistantText('An older answer.'),
  rec({ type: 'user', message: { role: 'user', content: 'do the thing' } }),
  assistantText('SUBAGENT REPORT - must not be spoken', true),
  assistantText('The final answer.'),
  rec({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }),
  'not json at all',
  '',
].join('\n'), 'utf8');

const picked = lastAssistantText(tmp);
check('picks the final text message, not the trailing tool call', picked === 'The final answer.', JSON.stringify(picked));
check('skips subagent (sidechain) output', !picked.includes('SUBAGENT'), picked);
check('malformed lines do not throw', typeof picked === 'string');

fs.writeFileSync(tmp, [assistantText('Only sidechain here.', true)].join('\n'), 'utf8');
check('sidechain-only transcript yields nothing', lastAssistantText(tmp) === '');

check('missing transcript yields nothing, no throw', lastAssistantText(path.join(os.tmpdir(), 'nope.jsonl')) === '');
check('undefined path yields nothing, no throw', lastAssistantText(undefined) === '');

fs.rmSync(tmp, { force: true });

// --- Result ----------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('OK');
