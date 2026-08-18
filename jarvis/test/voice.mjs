const { chromium } = await import(process.env.PLAYWRIGHT_INDEX || 'playwright');
const BASE = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R=[]; const T=(n,c,d='')=>R.push({n,ok:!!c,d});

const browser = await chromium.launch({args:['--no-sandbox']});
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__log=[]; const log=(t,d)=>window.__log.push({t,d,at:Math.round(performance.now())});
  class FakeRecognition {
    constructor(){this.lang='en-US';this.continuous=false;this.interimResults=false;window.__rec=this;this.running=false;}
    start(){if(this.running)throw new Error('already started');this.running=true;log('rec.start');this.onstart&&this.onstart();}
    stop(){if(!this.running)return;this.running=false;log('rec.stop');this.onend&&this.onend();}
    abort(){this.stop();}
    _emit(text,isFinal){const item=[{transcript:text}];item.isFinal=isFinal;item.length=1;
      const ev={resultIndex:0,results:Object.assign([item],{length:1})};log('rec.result',{text,isFinal});this.onresult&&this.onresult(ev);}
  }
  window.SpeechRecognition=FakeRecognition;
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;}};
  const synth={speaking:false,_c:null,
    getVoices:()=>[{name:'Microsoft Ryan Online (Natural) - English (United Kingdom)',lang:'en-GB'}],
    speak(u){this.speaking=true;this._c=u;log('tts.speak',u.text.slice(0,90));u.onstart&&u.onstart();},
    cancel(){if(this.speaking){this.speaking=false;log('tts.cancel');}},
    _finish(){if(!this.speaking)return;this.speaking=false;log('tts.end');this._c&&this._c.onend&&this._c.onend();}};
  Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true,writable:true});
});

const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));

// --- simulated Claude session ---
let chatState = { seq:0, lines:[], active:false, busy:false, sessionId:null, model:'opus' };
const posts=[];
await page.route('**/api/**', async route=>{
  const r=route.request(); const p=new URL(r.url()).pathname;
  if(r.method()==='POST') posts.push({url:p, body:r.postData()});
  if(p==='/api/tts')  return route.fulfill({status:503,contentType:'application/json',body:'{}'});
  if(p==='/api/ask')  return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({answer:'Vault answer.',sources:[],askEngine:'haiku'})});
  if(p==='/api/claude/send'){ chatState.active=true; chatState.busy=true; return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}); }
  if(p==='/api/claude/state') return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({...chatState, lines:chatState.lines.splice(0)}) });
  return route.continue();
});

await page.goto(BASE + '/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(900);
await page.click('#landing'); await page.waitForTimeout(1000);
const cls = s => page.evaluate(x=>{const e=document.querySelector(x);return e?e.className:'';}, s);

// ============ 1. no-session voice still answers from the vault ============
await page.evaluate(()=>document.getElementById('mic-btn').click());
await page.waitForTimeout(120);
await page.evaluate(()=>window.__rec._emit('what is in the vault about alfred',false));
await page.waitForTimeout(2000);
let asks = posts.filter(p=>p.url==='/api/ask').length;
T('no Claude session -> voice still uses vault ask', asks===1, `asks=${asks}`);

// ============ 2. THE double-send regression ============
await page.evaluate(()=>window.__rec._emit('what is in the vault about alfred',true));
await page.waitForTimeout(500);
T('late final result no longer double-sends', posts.filter(p=>p.url==='/api/ask').length===asks,
  `before=${asks} after=${posts.filter(p=>p.url==='/api/ask').length}`);

// ============ 3. barge-in ============
T('TTS is playing before barge-in', await page.evaluate(()=>window.speechSynthesis.speaking));
await page.evaluate(()=>{ if(!window.__rec.running) window.__rec.start(); window.__rec._emit('actually hold on',false); });
await page.waitForTimeout(200);
T('barge-in cancels playback when user talks over Alfred',
  (await page.evaluate(()=>window.speechSynthesis.speaking))===false);
T('barge-in clears reactor speaking state', !(await cls('#voice-reactor')).includes('speaking'));

// let that utterance land so state is clean
await page.waitForTimeout(1800);
await page.evaluate(()=>window.speechSynthesis._finish());
await page.waitForTimeout(900);

// ============ 4. wake, then voice must go to CLAUDE not the vault ============
posts.length=0;
await page.waitForFunction(()=>window.__rec.running,{timeout:5000}).catch(()=>{});
await page.evaluate(()=>window.__rec._emit('alfred wake up',true));
await page.waitForTimeout(1200);
T('wake starts a Claude session', posts.some(p=>p.url==='/api/claude/send'), JSON.stringify(posts.map(p=>p.url)));
await page.evaluate(()=>window.speechSynthesis._finish());   // finish "At your service"
await page.waitForTimeout(1200);

posts.length=0;
await page.waitForFunction(()=>window.__rec.running,{timeout:5000}).catch(()=>{});
await page.evaluate(()=>window.__rec._emit('refactor the org chart layout',false));
await page.waitForTimeout(2200);
const sends = posts.filter(p=>p.url==='/api/claude/send');
const strays = posts.filter(p=>p.url==='/api/ask');
T('spoken turn is routed to the Claude Terminal', sends.length===1, `claude/send=${sends.length} ask=${strays.length}`);
T('spoken turn carries the transcript', /refactor the org chart layout/.test(sends[0]?.body||''), sends[0]?.body||'none');
T('spoken turn does NOT also hit the vault engine', strays.length===0);

// ============ 5. Claude's reply is spoken back ============
await page.evaluate(()=>window.__log.push({t:'--- claude replies ---'}));
chatState.lines = [
  {text:'Here is the plan.',kind:'assistant'},
  {text:'· Read ui.html {"file":"ui.html"}',kind:'tool'},
  {text:'I will widen the tier spacing and add **labels** to each `node`.',kind:'assistant'},
  {text:'[done 4.2s · $0.0131]',kind:'system'},
];
chatState.seq += 4; chatState.busy = false;
await page.waitForTimeout(2500);
const spoke = await page.evaluate(()=>window.__log.filter(l=>l.t==='tts.speak').slice(-1)[0]);
T("Claude's reply is spoken back", !!spoke && /Here is the plan/.test(spoke.d||''), JSON.stringify(spoke));
T('tool lines are not read aloud', !!spoke && !/tool_use|Read ui\.html|\{"file"/.test(spoke.d||''), spoke?.d||'');
T('markdown is stripped before speaking', !!spoke && !/\*\*|`/.test(spoke.d||''), spoke?.d||'');
T('[done] footer is not read aloud', !!spoke && !/\[done/.test(spoke.d||''), spoke?.d||'');

// ============ 6. auto-resume after Claude's reply ============
await page.evaluate(()=>window.speechSynthesis._finish());
await page.waitForTimeout(900);
T('mic re-arms after Claude finishes speaking', (await page.evaluate(()=>window.__rec?.running))===true);

// ============ 7. Esc exits cleanly ============
// Fail loudly if the element is renamed again. Reaching straight for classList
// on a missing node crashed the whole suite with "Cannot read properties of
// null" and took every later assertion with it.
await page.evaluate(()=>{
  const el=document.getElementById('voice-reactor');
  if(!el) throw new Error('#voice-reactor missing — was the voice indicator renamed?');
  window.speechSynthesis.speaking=true; el.classList.add('speaking');
});
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
T('Esc clears reactor speaking state', !(await cls('#voice-reactor')).includes('speaking'));
T('Esc clears reactor listening state', !(await cls('#voice-reactor')).includes('listening'));
T('Esc does not silently re-arm the mic', (await page.evaluate(()=>window.__rec?.running))===false);

T('no uncaught JS errors', errs.length===0, errs.slice(0,2).join(' | '));
for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 180)));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));

await browser.close();
