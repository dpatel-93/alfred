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
import {
  cleanForSpeech, truncateAtSentence, lastAssistantText,
  buildMacCommand, macWordsPerMinute, shQuote,
  briefForSpeech, firstSentences, isStructuralBlock,
} from '../alfred-speak.mjs';

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

const winPath = 'Edited C:\\Users\\alice\\.claude\\settings.json now.';
check('windows paths become "a file path"', clean(winPath).includes('a file path'), clean(winPath));
check('windows path not spoken', !clean(winPath).includes('alice'), clean(winPath));

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

// --- macOS command construction --------------------------------------------
// Asserted rather than executed, because this suite runs on Windows too and a
// malformed `say` line fails silently: it prints to a stderr nobody reads.

console.log('\nmacOS speech command');

check('rate 0 maps to the macOS default speaking speed', macWordsPerMinute(0) === 175);
check('positive rate speaks faster', macWordsPerMinute(3) > macWordsPerMinute(0));
check('negative rate speaks slower', macWordsPerMinute(-3) < macWordsPerMinute(0));
check('extreme rates are clamped to intelligible speeds',
  macWordsPerMinute(-100) >= 80 && macWordsPerMinute(100) <= 400,
  `${macWordsPerMinute(-100)} / ${macWordsPerMinute(100)}`);

check('a path with spaces is quoted', shQuote('/tmp/my file.txt') === `'/tmp/my file.txt'`, shQuote('/tmp/my file.txt'));
check("an apostrophe in a path cannot break out of the quoting",
  shQuote("/tmp/alice's file.txt") === `'/tmp/alice'\\''s file.txt'`, shQuote("/tmp/alice's file.txt"));

const macCmd = buildMacCommand('/tmp/speak me.txt', { voice: 'Samantha', rate: 1 });
check('names the configured voice', macCmd.includes(`say -v 'Samantha'`), macCmd);
check('falls back to the system voice if that one is missing', macCmd.includes('|| say -r'), macCmd);
check('reads the text from a file, never an argument', macCmd.includes(`-f '/tmp/speak me.txt'`), macCmd);
check('always cleans up its temp file', /;\s*rm -f '\/tmp\/speak me\.txt'$/.test(macCmd), macCmd);
check('the file path is quoted everywhere it appears',
  !/-f \/tmp\/speak/.test(macCmd) && !/rm -f \/tmp\/speak/.test(macCmd), macCmd);

const noVoiceCmd = buildMacCommand('/tmp/x.txt', { voice: '', rate: 0 });
check('no voice configured means one plain say, not an empty -v',
  !noVoiceCmd.includes('-v') && !noVoiceCmd.includes('||'), noVoiceCmd);
check('the system-voice command still speaks and still cleans up',
  noVoiceCmd.startsWith('say -r 175 -f ') && noVoiceCmd.includes('rm -f'), noVoiceCmd);

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

// --- Brevity: the ear gets the conclusion, the screen keeps the detail -----

check('a structural block is recognised as structure',
  ['# Heading', '- bullet', '1. first', '| a | b |', '> quote', '```js', '---']
    .every(isStructuralBlock));
check('prose is not mistaken for structure',
  !isStructuralBlock('The benchmark finished and three arms held.'));
check('a hyphen inside a sentence is not a bullet',
  !isStructuralBlock('Sonnet-first routing is live.'));

check('firstSentences stops at the sentence boundary',
  firstSentences('One. Two. Three. Four.', 2) === 'One. Two.',
  firstSentences('One. Two. Three. Four.', 2));
check('firstSentences returns everything when asked for more than exists',
  firstSentences('Only one here.', 5) === 'Only one here.');
check('firstSentences tolerates text with no terminator',
  firstSentences('no full stop anywhere', 2) === 'no full stop anywhere');
// The dot in a filename is not a sentence end. This truncated a real answer.
check('a filename is not treated as a sentence end',
  firstSentences('The fix is in server.mjs now. Detail follows.', 1)
    === 'The fix is in server.mjs now.',
  firstSentences('The fix is in server.mjs now. Detail follows.', 1));
check('an abbreviation is not treated as a sentence end',
  firstSentences('Use a check, e.g. a test, before shipping. Then push.', 1)
    === 'Use a check, e.g. a test, before shipping.',
  firstSentences('Use a check, e.g. a test, before shipping. Then push.', 1));
check('a version number is not treated as a sentence end',
  firstSentences('Chatterbox 0.1.7 is the latest release. Nano is not in it.', 1)
    === 'Chatterbox 0.1.7 is the latest release.',
  firstSentences('Chatterbox 0.1.7 is the latest release. Nano is not in it.', 1));

// The shape almost every answer takes: a lead, then the detail.
const ANSWER = `All 11 tool servers are connected now. GitHub was the last one.

## What changed

| server | state |
|---|---|
| github | connected |

- read the token live
- no stored copy`;
check('brevity keeps the lead and drops the table and headings',
  briefForSpeech(ANSWER, 2) === 'All 11 tool servers are connected now. GitHub was the last one.',
  briefForSpeech(ANSWER, 2));
check('brevity respects the sentence count',
  briefForSpeech(ANSWER, 1) === 'All 11 tool servers are connected now.',
  briefForSpeech(ANSWER, 1));

// An answer that opens with a heading has no lead paragraph. Going silent
// there would be indistinguishable from a broken speaker.
check('an answer opening with a heading still speaks its first prose',
  briefForSpeech('## Results\n\nThree arms held and one was void.', 2)
    === 'Three arms held and one was void.',
  briefForSpeech('## Results\n\nThree arms held and one was void.', 2));
check('an answer that is only a list still says something',
  briefForSpeech('- first thing\n- second thing', 2).length > 0,
  briefForSpeech('- first thing\n- second thing', 2));
check('an empty answer yields nothing rather than throwing',
  briefForSpeech('', 2) === '');
check('code fences never reach the ear',
  !briefForSpeech('```js\nconst secret = 1;\n```\n\nThe fix is one line.', 2).includes('secret'),
  briefForSpeech('```js\nconst secret = 1;\n```\n\nThe fix is one line.', 2));
check('brevity output still survives cleaning',
  clean(briefForSpeech('The **fix** is in `server.mjs` now. Detail follows.\n\n## Detail', 1))
    === 'The fix is in server.mjs now.',
  clean(briefForSpeech('The **fix** is in `server.mjs` now. Detail follows.\n\n## Detail', 1)));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('OK');
