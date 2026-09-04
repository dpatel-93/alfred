const B = process.env.ALFRED_TEST_BASE || 'http://localhost:7777';
const R = []; const T = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });
const j = async (p, o) => { const r = await fetch(B + p, o); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };

// Ollama is unreachable in this environment, so every call here exercises the
// degraded path — which is exactly the thing that used to return nothing.
const status = (await j('/api/status')).d;
T('ollama really is offline for this run', status.ollama === 'offline', status.ollama);
T('the index is not empty despite that', status.notes === 3, `${status.notes} notes`);

const s1 = await j('/api/search?q=alfred');
T('GET /api/search answers 200 with ollama down', s1.s === 200, `got ${s1.s}`);
T('search returns keyword hits', Array.isArray(s1.d) && s1.d.length > 0, JSON.stringify(s1.d).slice(0, 200));
T('the best hit is the note actually about alfred', s1.d[0] && /Alfred/i.test(s1.d[0].title), s1.d[0]?.title);

const s2 = await j('/api/search?q=orchestration%20org%20chart%20routing');
T('multi-term query ranks the orchestration note first', s2.d[0] && /Orchestration/i.test(s2.d[0].title),
  JSON.stringify(s2.d.map(x => x.title)));

const s3 = await j('/api/search?q=zzzznotathinginthevault');
T('a query matching nothing returns an empty list, not an error',
  s3.s === 200 && Array.isArray(s3.d) && s3.d.length === 0, `${s3.s} ${JSON.stringify(s3.d)}`);

const s4 = await j('/api/search?q=' + 'a'.repeat(5000));
T('a 5k query still answers 200', s4.s === 200, `got ${s4.s}`);

// /api/ask needs a generation engine too; with everything down it must still
// answer coherently rather than 502.
const a1 = await j('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'what is alfred' }) });
T('POST /api/ask answers 200 with ollama down', a1.s === 200, `got ${a1.s} ${JSON.stringify(a1.d).slice(0, 160)}`);
T('ask reports the retrieval mode it used', a1.d && a1.d.retrieval === 'keyword', JSON.stringify(a1.d?.retrieval));
T('ask still cites sources from the keyword shortlist',
  a1.d && Array.isArray(a1.d.sources) && a1.d.sources.length > 0, JSON.stringify(a1.d?.sources));

const a2 = await j('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'zzzznotathing' }) });
T('ask with no matches says so instead of erroring',
  a2.s === 200 && /nothing in the vault/i.test(a2.d.answer || ''), `${a2.s} ${a2.d?.answer}`);

// the graph is built off the same index, so it must be populated too
const g = (await j('/api/graph')).d;
T('the graph has nodes again', Array.isArray(g.nodes) && g.nodes.length === 3, `${g.nodes?.length} nodes`);
T('wiki-links survived lexical-only indexing', Array.isArray(g.links) && g.links.length > 0, `${g.links?.length} links`);

// --- the force layout must be able to stop -------------------------------
// Measured before this was believed: with no cooling, 9.5% of the screen was
// still repainting 20s after load, against 1.2% for the same page with the
// physics disabled outright. Cooling took it to 0.8% — i.e. to the decorative
// floor. These are structural guards against that being quietly undone; they
// prove the mechanism is present, not that the page is smooth. The real check
// is the pixel-diff probe, which needs a browser and does not belong in here.
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const ui = fs.readFileSync(path.join(here, '..', 'ui.html'), 'utf8');
  const start = ui.indexOf('function physicsTick()');
  const body = ui.slice(start, ui.indexOf('\n  }', ui.indexOf('SETTLE_FRAMES) physicsSettled', start)));

  T('physicsTick can be skipped once the layout has settled',
    /if\s*\(physicsSettled\s*&&\s*!draggedNode\)\s*return/.test(body), '');
  T('every force is scaled by alpha, so the simulation provably cools',
    /REPULSE\s*=\s*\([^)]*\)\s*\*\s*alpha/.test(body)
    && /SPRING_K\s*=\s*[\d.]+\s*\*\s*alpha/.test(body)
    && /GRAVITY\s*=\s*[\d.]+\s*\*\s*alpha/.test(body), '');
  T('and alpha actually decays each tick', /alpha\s*-=\s*alpha\s*\*\s*ALPHA_DECAY/.test(body), '');
  T('a drag holds it warm instead of letting it go inert mid-gesture',
    /draggedNode\)\s*\{\s*alpha\s*=\s*Math\.max\(alpha,\s*0\.3\)/.test(body), '');

  // Polls are skipped while the tab is hidden, which is correct — but a skipped
  // tick used to be lost outright, including the immediate one fired on view
  // entry, so a HUD loaded in a background tab showed "--" on every rail row
  // until the next interval landed (up to two minutes for the workshop poll).
  // Caught by loading it in an automated Chrome tab, where document.hidden
  // stays true for the whole session and the rail never filled in at all.
  T('the pollers catch up when the tab becomes visible again',
    /addEventListener\('visibilitychange'/.test(ui) && /activePollTicks\.forEach/.test(ui), '');
  T('and the tick list is cleared with the timers, so a stale view cannot be re-ticked',
    /activePollTimers = \[\];\s*\n\s*activePollTicks = \[\];/.test(ui), '');
}

const p = [...R].filter(r => r.ok);
console.log(`pass ${p.length} / fail ${R.length - p.length}\n`);
for (const r of R) console.log((r.ok ? '  OK   ' : '  FAIL ') + r.n + (r.ok ? '' : '\n            -> ' + r.d.slice(0, 180)));
// The runner reads this line; everything else on stdout is diagnostics.
console.log('__ALFRED_RESULTS__' + JSON.stringify(R));

