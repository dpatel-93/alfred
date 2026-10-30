// --- widget.js -----------------------------------------------------------------
// The floating brain: two hemispheres of neurons with signals running between them, a
// badge with what's left today, and the gestures (drag to move, click to open Alfred,
// right-click for the menu). Calm cyan when all is well, rose when something is late or
// waiting on the user, grey when Alfred's engine isn't answering.
// widget.html?size=512&still=1 draws one still frame at that size (the app icon).
// ---------------------------------------------------------------------------
(function () {
  const params = new URLSearchParams(location.search);
  const STILL = params.get('still') === '1';
  const canvas = document.getElementById('brain');
  const badge = document.getElementById('badge');
  const ctx = canvas.getContext('2d');
  const SIZE = Number(params.get('size')) || 132;
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = SIZE * DPR;
  canvas.height = SIZE * DPR;
  canvas.style.width = canvas.style.height = `${SIZE}px`;
  ctx.scale(DPR, DPR);
  const S = SIZE / 132;          // everything below is drawn on a 132 grid
  const C = 66;

  const PALETTE = {
    calm: { glow: '76,201,255', line: '76,201,255', node: '230,247,255', pulse: ['#4cc9ff', '#2ef2b2', '#e6f7ff'] },
    alert: { glow: '255,77,109', line: '255,140,170', node: '255,230,236', pulse: ['#ff4d6d', '#c77dff', '#4cc9ff'] },
    offline: { glow: '120,130,150', line: '120,130,150', node: '170,180,195', pulse: [] },
  };
  let mood = 'calm';

  // --- The brain's shape: two hemispheres seen from above, flat along the fissure,
  // rounded on the outside, a little narrower at the front, with folds across them ---
  let seed = 20261030;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const W = 34, RY = 46, CY = C + 1, GAP = 2;
  function hemiPath(side) {
    const x = (k) => C + side * (GAP + k * W);
    const p = new Path2D();
    p.moveTo(x(0), CY - RY + 7);
    p.bezierCurveTo(x(0.1), CY - RY - 1, x(0.75), CY - RY - 1, x(0.92), CY - RY * 0.45);
    p.bezierCurveTo(x(1.08), CY - RY * 0.05, x(1.06), CY + RY * 0.6, x(0.78), CY + RY * 0.88);
    p.bezierCurveTo(x(0.55), CY + RY * 1.06, x(0.12), CY + RY * 1.02, x(0), CY + RY * 0.84);
    p.closePath();
    return p;
  }
  function foldsPath(side) {
    const p = new Path2D();
    for (let j = 1; j <= 6; j++) {
      const y0 = CY - RY + j * (2 * RY / 7) + (rnd() * 4 - 2);
      p.moveTo(C + side * GAP, y0);
      for (let s = 1; s <= 8; s++) {
        const k = s / 8;
        p.lineTo(C + side * (GAP + k * W * 1.05), y0 + Math.sin(k * Math.PI * 3 + j) * 3.2 + (k - 0.5) * (j - 3.5) * 1.6);
      }
    }
    return p;
  }
  const HEMI = [-1, 1].map((side) => ({ side, shape: hemiPath(side), folds: foldsPath(side) }));
  const nodes = [];
  for (const h of HEMI) {
    let made = 0;
    while (made < 34) {
      const px = C + h.side * (GAP + 2 + rnd() * (W - 4)), py = CY - RY + rnd() * 2 * RY;
      if (!ctx.isPointInPath(h.shape, px * DPR, py * DPR)) continue;
      nodes.push({ x: px, y: py, side: h.side, ph: rnd() * Math.PI * 2, r: 0.9 + rnd() * 1.3 });
      made++;
    }
  }
  const links = [];
  const seen = new Set();
  const link = (a, b) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || seen.has(k)) return;
    seen.add(k);
    links.push([a, b]);
  };
  nodes.forEach((n, i) => {
    nodes.map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2, same: m.side === n.side }))
      .filter((o) => o.same && o.j !== i).sort((a, b) => a.d - b.d).slice(0, 3).forEach((o) => link(i, o.j));
  });
  // the bridge between the hemispheres
  const inner = (side) => nodes.map((n, i) => ({ i, n })).filter((o) => o.n.side === side).sort((a, b) => Math.abs(a.n.x - C) - Math.abs(b.n.x - C)).slice(0, 6);
  inner(-1).forEach((a, k) => link(a.i, inner(1)[k].i));

  // --- Signals running along the links ---
  const pulses = [];
  function spawnPulse() {
    const p = PALETTE[mood].pulse;
    if (!p.length) return;
    const [a, b] = links[Math.floor(rnd() * links.length)];
    const fwd = rnd() < 0.5;
    pulses.push({ a: fwd ? a : b, b: fwd ? b : a, t: 0, speed: 0.025 + rnd() * 0.035, color: p[Math.floor(rnd() * p.length)] });
  }

  function draw(time) {
    const pal = PALETTE[mood];
    ctx.save();
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.scale(S, S);
    const breath = 1 + 0.018 * Math.sin(time / 900);
    ctx.translate(C, C);
    ctx.scale(breath, breath);
    ctx.translate(-C, -C);

    // halo
    const halo = ctx.createRadialGradient(C, C, 8, C, C, 64);
    halo.addColorStop(0, `rgba(${pal.glow},0.30)`);
    halo.addColorStop(0.6, `rgba(${pal.glow},0.10)`);
    halo.addColorStop(1, `rgba(${pal.glow},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 132, 132);

    // the hemispheres: a dark body, its folds, a thin outline
    for (const h of HEMI) {
      ctx.fillStyle = 'rgba(9,14,26,0.86)';
      ctx.fill(h.shape);
      ctx.save();
      ctx.clip(h.shape);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${pal.line},0.16)`;
      ctx.stroke(h.folds);
      ctx.restore();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = `rgba(${pal.node},0.5)`;
      ctx.stroke(h.shape);
    }

    // links
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = `rgba(${pal.line},0.28)`;
    ctx.beginPath();
    for (const [a, b] of links) {
      const na = nodes[a], nb = nodes[b];
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
    }
    ctx.stroke();

    // neurons
    for (const n of nodes) {
      const lit = 0.45 + 0.4 * Math.sin(time / 700 + n.ph);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${pal.node},${lit.toFixed(3)})`;
      ctx.fill();
    }

    // signals
    for (const p of pulses) {
      const a = nodes[p.a], b = nodes[p.b];
      const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
      ctx.beginPath();
      ctx.arc(x, y, 2.1, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // --- Animation: about 30 frames a second, and it stops while the window is hidden ---
  let last = 0, nextPulse = 0;
  function frame(time) {
    requestAnimationFrame(frame);
    if (time - last < 33) return;
    last = time;
    if (time > nextPulse) { spawnPulse(); nextPulse = time + (mood === 'alert' ? 110 : 190); }
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].t += pulses[i].speed;
      if (pulses[i].t >= 1) pulses.splice(i, 1);
    }
    draw(time);
  }

  if (STILL) {
    for (let i = 0; i < 14; i++) spawnPulse();
    pulses.forEach((p, i) => { p.t = (i % 7) / 7 + 0.07; });
    draw(1200);
    return;
  }
  requestAnimationFrame(frame);

  // --- Status from the app ---
  function show(s) {
    mood = !s.online ? 'offline' : s.attention ? 'alert' : 'calm';
    badge.hidden = !s.online || !s.count;
    badge.textContent = s.count > 99 ? '99+' : String(s.count);
    badge.classList.toggle('attention', !!s.attention);
    document.body.title = ['Alfred', ...(s.lines || [])].join('\n');
  }
  if (window.alfred) window.alfred.onStatus(show);

  // --- Gestures: drag to move, click to open, right-click for the menu ---
  let down = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !window.alfred) return;
    down = { x: e.screenX, y: e.screenY, moved: false };
    document.body.setPointerCapture(e.pointerId);
    window.alfred.send('widget:drag-start');
  });
  document.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.moved && Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4) {
      down.moved = true;
      document.body.classList.add('dragging');
    }
    if (down.moved) window.alfred.send('widget:drag');
  });
  document.addEventListener('pointerup', () => {
    if (!down) return;
    window.alfred.send(down.moved ? 'widget:drag-end' : 'widget:open');
    document.body.classList.remove('dragging');
    down = null;
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.alfred) window.alfred.send('widget:menu');
  });
})();
