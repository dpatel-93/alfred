#!/usr/bin/env node
// Stands in for ~/.claude/helpers/provider-run.mjs in the api suite, so the desk box's real
// spawn path runs without calling Grok. It reads stdin to the end exactly as provider-run does
// when stdin is not a terminal: if the server ever leaves the pipe open again, this blocks until
// the server's timeout and the test fails, which is the hang the first live test hit (2026-10-23).
//
//   node grok-runner-stub.mjs grok "<prompt>"
import fs from 'node:fs';

if (!process.stdin.isTTY) fs.readFileSync(0, 'utf8');
const prompt = process.argv[3] || '';
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
