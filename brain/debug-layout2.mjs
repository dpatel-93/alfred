import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 7779;
const B = `http://127.0.0.1:${PORT}`;
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-dbg-'));
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(PORT), ALFRED_VAULT: path.join('test','fixtures','vault'),
    ALFRED_INDEX: path.join(stub,'index.json'), ALFRED_GREETING_STATE: path.join(stub,'greeting.json'),
    ALFRED_LOCAL_CONFIG_DIR: path.join(stub,'cfg'), ALFRED_TOKEN_FILE: path.join(stub,'session.token'),
    OLLAMA_URL: 'http://127.0.0.1:1',
    ALFRED_COUNCIL_HELPER: path.join(os.homedir(),'.claude','helpers','council-run.mjs'),
    ALFRED_COUNCIL_STUB_DIR: stub, ALFRED_PROVIDERS: path.join(os.homedir(),'.claude','helpers','providers.json'),
    ALFRED_TERM_STUB_CMD: JSON.stringify([process.execPath,'-e','process.stdout.write("OK\n")']),
  }, stdio: ['ignore','pipe','pipe'],
});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function up(){ const dl=Date.now()+20000; while(Date.now()<dl){ try{ if((await fetch(B+'/api/status')).ok) return true; }catch{} await sleep(300);} return false; }
await up();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(B+'/');
await sleep(500);
await page.keyboard.press('Escape');
await page.locator('.view-btn[data-view="command"]').click();
await page.waitForSelector('#cc-seats .cc-seat', {timeout:15000});
await sleep(500);
await page.locator('.cc-lane-foot .btn.big').first().click();
await page.waitForSelector('#cc-tabs .cc-tab', {timeout:10000});
await sleep(500);
const info = await page.evaluate(() => {
  function r(sel){ const e=document.querySelector(sel); if(!e) return null; const b=e.getBoundingClientRect(); const cs=getComputedStyle(e); return {h:b.height,w:b.width, scrollH: e.scrollHeight, display:cs.display, flexBasis:cs.flexBasis, flexGrow:cs.flexGrow, flexShrink:cs.flexShrink, minHeight:cs.minHeight}; }
  return {
    viewport: {w: window.innerWidth, h: window.innerHeight},
    stage: r('#stage-command'),
    head: r('#stage-command .stage-head'),
    lanes: r('#stage-command .stage-section'),
    termStage: r('#cc-term-stage'),
    tabstrip: r('.cc-tabstrip'),
    terms: r('#cc-terms'),
    council: r('#cc-council'),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
try{ server.kill(); }catch{}
if (process.platform==='win32' && server.pid) { try{ execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});}catch{} }
try{ fs.rmSync(stub,{recursive:true,force:true}); }catch{}
