#!/usr/bin/env node
// Stands in for the Claude CLI in the api suite, so the Tell Alfred box's real spawn path runs
// without calling Claude. It takes the same arguments and reads the prompt from stdin to the
// end: if the server ever leaves the pipe open, this blocks until the server's timeout and the
// test fails (the hang the first live Grok test hit on 2026-10-23).
//
//   node tell-runner-stub.mjs -p --model sonnet ... < prompt
import fs from 'node:fs';

const prompt = fs.readFileSync(0, 'utf8');
if (!process.argv.includes('-p') || !process.argv.includes('--tools')) {
  console.error('error: the stub expected -p and --tools');
  process.exit(3);
}
if (/STUB-FAIL/.test(prompt)) {
  console.error('error: the stub was told to fail');
  process.exit(2);
}
const today = (/^Now: \w+ (\d{4}-\d{2}-\d{2})/m.exec(prompt) || [])[1] || '2026-01-01';
const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
process.stdout.write(JSON.stringify({
  reply: 'Got it, I will remind you tomorrow.',
  items: [{ type: 'reminder', kind: 'reminder', title: 'Stub reminder from the desk box', due: tomorrow, time: null, scope: 'personal' }],
}));
