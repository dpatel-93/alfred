const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');
const BASE = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = []; const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__log = []; const log = (t, d) => window.__log.push({ t, d, at: Math.round(performance.now()) });
  class FakeRecognition {
    constructor() { this.lang = 'en-US'; this.continuous = false; this.interimResults = false; window.__rec = this; this.running = false; }
    start() { if (this.running) throw new Error('already started'); this.running = true; log('rec.start'); this.onstart && this.onstart(); }
    stop() { if (!this.running) return; this.running = false; log('rec.stop'); this.onend && this.onend(); }
    abort() { this.stop(); }
    _emit(text, isFinal) {
      const item = [{ transcript: text }]; item.isFinal = isFinal; item.length = 1;
      log('rec.result', { text, isFinal });
      this.onresult && this.onresult({ resultIndex: 0, results: Object.assign([item], { length: 1 }) });
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  const synth = {
    speaking: false, _c: null,
    getVoices: () => [{ name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB' }],
    speak(u) { this.speaking = true; this._c = u; log('say', u.text); u.onstart && u.onstart(); },
    cancel() { if (this.speaking) { this.speaking = false; log('cancel'); } },
    _finish() { if (!this.speaking) return; this.speaking = false; log('said.end'); this._c && this._c.onend && this._c.onend(); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
  // Drain the queue automatically: each utterance "plays" for 120ms.
  window.__autoDrain = setInterval(() => { if (window.speechSynthesis.speaking) window.speechSynthesis._finish(); }, 120);
});

const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));

let chatState = { seq: 0, lines: [], active: false, busy: false, sessionId: null, model: 'opus' };
let approvals = { armed: false, pending: [] };
const posts = [];
await page.route('**/api/**', async route => {
  const r = route.request(); const p = new URL(r.url()).pathname;
  if (r.method() === 'POST') posts.push({ url: p, body: r.postData() });
  const J = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  if (p === '/api/tts') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  if (p === '/api/ask') return J({ answer: 'Vault answer.', sources: [], askEngine: 'haiku' });
  if (p === '/api/claude/send') { chatState.active = true; chatState.busy = true; return J({ ok: true }); }
  if (p === '/api/claude/abort') { chatState.busy = false; return J({ ok: true, aborted: true }); }
  if (p === '/api/approvals/arm') { approvals.armed = JSON.parse(r.postData()).armed; return J({ ok: true, armed: approvals.armed }); }
  if (/^\/api\/approvals\/[\w-]+\/decide$/.test(p)) { approvals.pending = []; return J({ ok: true }); }
  if (p === '/api/approvals') return J(approvals);
  if (p === '/api/claude/state') return J({ ...chatState, lines: chatState.lines.splice(0) });
  return route.continue();
});

const said = async () => (await page.evaluate(() => window.__log.filter(l => l.t === 'say').map(l => l.d)));
const clearLog = () => page.evaluate(() => { window.__log.length = 0; });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#landing'); await page.waitForTimeout(1000);

// ---- get into a live Claude session over voice ----
await page.evaluate(() => document.getElementById('mic-btn').click());
await page.waitForTimeout(150);
T('entering voice arms the approval gate server-side',
  posts.some(p => p.url === '/api/approvals/arm' && /"armed":true/.test(p.body || '')),
  JSON.stringify(posts.map(p => p.url)));

await page.evaluate(() => window.__rec._emit('alfred wake up', true));
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});

// ================= 1. STREAMING TTS =================
await clearLog();
await page.evaluate(() => window.__rec._emit('plan the org chart work', false));
await page.waitForTimeout(2000);   // VAD dispatches

// Claude answers in fragments, still busy. Streaming must speak sentence 1
// before the turn is finished.
chatState.lines = [{ text: 'First I will widen the tier spacing.', kind: 'assistant' }];
chatState.seq += 1;
await page.waitForTimeout(1600);
const midTurn = await said();
T('speaks the first sentence while Claude is still writing', midTurn.length >= 1, JSON.stringify(midTurn));
T('does not wait for the whole turn before speaking',
  midTurn.some(s => /widen the tier spacing/.test(s)) && chatState.busy === true, JSON.stringify(midTurn));

// second fragment, still mid-turn: must become its own utterance rather than
// waiting to be merged into a single end-of-turn blob
chatState.lines = [{ text: 'Then I will add labels to every node.', kind: 'assistant' }];
chatState.seq += 1;
await page.waitForTimeout(1400);
const twoFrags = await said();
T('each streamed fragment becomes its own utterance',
  twoFrags.length >= 2 && twoFrags.some(s => /add labels/.test(s)),
  `${twoFrags.length} utterances: ${JSON.stringify(twoFrags)}`);

chatState.lines = [{ text: 'Finally I will route the links orthogonally.', kind: 'assistant' },
                   { text: '[done 3.1s]', kind: 'system' }];
chatState.seq += 2; chatState.busy = false;
await page.waitForTimeout(2000);
const full = await said();
T('later sentences are appended to the same stream', full.some(s => /orthogonally/.test(s)), JSON.stringify(full));
T('[done] footer still not spoken', !full.some(s => /\[done/.test(s)), JSON.stringify(full));

// ================= 2. SPOKEN APPROVAL =================
await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
await clearLog();
approvals = { armed: true, pending: [{ id: 'ap1', tool: 'Bash', summary: 'rm -rf build', at: Date.now() }] };
await page.waitForTimeout(1800);
const askedFor = await said();
T('a held tool call is asked about out loud', askedFor.some(s => /Shall I\?/i.test(s)), JSON.stringify(askedFor));
T('the question names the actual command', askedFor.some(s => /rm -rf build/.test(s)), JSON.stringify(askedFor));

// "no, don't" must deny — not match the "do" inside APPROVE_RE
await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
await page.evaluate(() => window.__rec._emit("no, don't do that", true));
await page.waitForTimeout(900);
const denyPost = posts.filter(p => /\/decide$/.test(p.url)).pop();
T('"no, don\'t do that" is read as a refusal', denyPost && /"allow":false/.test(denyPost.body || ''), denyPost?.body || 'no decide call');

// approve path
approvals = { armed: true, pending: [{ id: 'ap2', tool: 'Write', summary: 'server.mjs', at: Date.now() }] };
await page.waitForTimeout(1800);
await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
await page.evaluate(() => window.__rec._emit('yes go ahead', true));
await page.waitForTimeout(900);
const okPost = posts.filter(p => /\/decide$/.test(p.url)).pop();
T('"yes go ahead" approves', okPost && /"allow":true/.test(okPost.body || ''), okPost?.body || 'no decide call');

// an unrelated answer must not be taken as consent
approvals = { armed: true, pending: [{ id: 'ap3', tool: 'Bash', summary: 'git push', at: Date.now() }] };
await page.waitForTimeout(1800);
await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
const before = posts.filter(p => /\/decide$/.test(p.url)).length;
await page.evaluate(() => window.__rec._emit('what were we talking about', true));
await page.waitForTimeout(900);
T('an ambiguous reply neither approves nor denies',
  posts.filter(p => /\/decide$/.test(p.url)).length === before);
T('and it re-asks instead of guessing', (await said()).some(s => /yes or no/i.test(s)), JSON.stringify(await said()));
approvals = { armed: true, pending: [] };

// ================= 3. SPOKEN INTERRUPT =================
await page.waitForTimeout(900);
await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
await page.evaluate(() => window.__rec._emit('build the whole thing', false));
await page.waitForTimeout(2000);
chatState.busy = true;
await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
await page.evaluate(() => window.__rec._emit('stop', true));
await page.waitForTimeout(700);
T('spoken "stop" aborts the running turn', posts.some(p => p.url === '/api/claude/abort'));

// ================= 4. AMBIENT GATE =================
chatState.busy = false;
await page.waitForTimeout(800);
await page.evaluate(() => document.getElementById('ambient-btn').click());
await page.waitForTimeout(300);
T('ambient toggle reflects state', (await page.evaluate(() => document.getElementById('ambient-btn').className)).includes('on'));

await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
const sendsBefore = posts.filter(p => p.url === '/api/claude/send').length;
await page.evaluate(() => window.__rec._emit('so anyway I told him the deploy was fine', true));
await page.waitForTimeout(1200);
T('ambient ignores speech not addressed to Alfred',
  posts.filter(p => p.url === '/api/claude/send').length === sendsBefore,
  `${posts.filter(p => p.url === '/api/claude/send').length - sendsBefore} stray sends`);

await page.waitForFunction(() => window.__rec.running, { timeout: 6000 }).catch(() => {});
await page.evaluate(() => window.__rec._emit('alfred, check the build', true));
await page.waitForTimeout(1200);
const addressed = posts.filter(p => p.url === '/api/claude/send');
T('ambient acts when addressed by name', addressed.length === sendsBefore + 1, `${addressed.length - sendsBefore} sends`);
T('the wake word is stripped before Claude sees it',
  addressed.length && /check the build/.test(addressed[addressed.length - 1].body) &&
  !/alfred/i.test(JSON.parse(addressed[addressed.length - 1].body).text),
  addressed[addressed.length - 1]?.body || '');

// leaving voice must release the gate
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
T('leaving hands-free disarms the gate',
  posts.some(p => p.url === '/api/approvals/arm' && /"armed":false/.test(p.body || '')));

T('no uncaught JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 180)));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));

await browser.close();
