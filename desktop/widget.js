// --- widget.js -----------------------------------------------------------------
// The floating brain: the same brain as the dashboard's Brain tab (the outline, the folds
// and the six regions of the Second Brain, in their colours), alive: each region breathes
// on its own beat, a region whose notes changed recently ripples, neurons twinkle and
// signals run between them. The outline pulses rose when something is late or waiting on
// the user, and the badge says how much is left today. Grey when the engine is away.
// Gestures: drag to move, drag the corner grip to resize, click to open Alfred,
// right-click for the menu. widget.html?size=512&still=1 draws one still frame (the icon).
// ---------------------------------------------------------------------------
(function () {
  const params = new URLSearchParams(location.search);
  const STILL = params.get('still') === '1';
  const FIXED = Number(params.get('size')) || 0;
  const canvas = document.getElementById('brain');
  const badge = document.getElementById('badge');
  const grip = document.getElementById('grip');
  const ctx = canvas.getContext('2d');

  // --- The dashboard's brain (ui.html: BRAIN_HALF, BRAIN_SULCI, BRAIN_LOBES, FOLDER_COLORS) ---
  // Unit space: the frontal poles at y = -1, the back at 0.97; the right half, mirrored.
  const BRAIN_HALF = [
    [0.30, -1.00, 0.56, -0.90, 0.63, -0.64],
    [0.71, -0.46, 0.77, -0.24, 0.76, -0.04],
    [0.75, 0.20, 0.66, 0.44, 0.50, 0.63],
    [0.36, 0.81, 0.19, 0.94, 0.00, 0.97],
  ];
  const BRAIN_SULCI = [
    [0.09, -0.72, 0.38, -0.60, 0.56, -0.34],
    [0.07, -0.34, 0.38, -0.24, 0.63, -0.02],
    [0.10, 0.08, 0.38, 0.16, 0.57, 0.33],
    [0.12, 0.46, 0.32, 0.52, 0.43, 0.63],
    [0.44, -0.14, 0.60, 0.04, 0.55, 0.28],
  ];
  const GAP = 0.022;
  const LOBES = [
    { key: 'Projects', folders: ['Projects'], x: 0.33, y: -0.56, r: 0.42, color: '#3d9bff' },
    { key: 'Memory', folders: ['Memory'], x: -0.33, y: -0.56, r: 0.40, color: '#b478ff' },
    { key: 'Knowledge', folders: ['Knowledge', 'Decisions', 'Patterns', 'Learning'], x: 0.43, y: 0.06, r: 0.42, color: '#ffb02e' },
    { key: 'Research', folders: ['Research', 'Outputs'], x: -0.45, y: 0.06, r: 0.42, color: '#2ff5a8' },
    { key: 'Day', folders: ['Reminders', 'Routines', 'Inbox', 'Calendar'], x: 0.21, y: 0.60, r: 0.36, color: '#ff5fa2' },
    { key: 'System', folders: ['System', '(root)', 'Claude-Code'], x: -0.22, y: 0.62, r: 0.36, color: '#ff7a3d' },
  ];
  const WIRE = '130,217,255';   // the page's wire colour: its ice pulled toward its cyan
  const ROSE = '255,77,109';
  const rgb = (hex) => { const v = parseInt(hex.slice(1), 16); return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`; };
  LOBES.forEach((L) => { L.rgb = rgb(L.color); });

  // One outline path (both hemispheres, the gap between them is the fissure) and the folds,
  // in unit space; drawn through a transform so any window size gets the same brain.
  function hemisphere(p, sign) {
    const P = (ux, uy) => [sign * ux + sign * GAP, uy];
    p.moveTo(...P(0, -1));
    for (const s of BRAIN_HALF) p.bezierCurveTo(...P(s[0], s[1]), ...P(s[2], s[3]), ...P(s[4], s[5]));
    p.closePath();
  }
  const outline = new Path2D();
  hemisphere(outline, 1);
  hemisphere(outline, -1);
  const folds = new Path2D();
  for (const s of BRAIN_SULCI) {
    for (const sign of [1, -1]) {
      folds.moveTo(sign * (s[0] + GAP), s[1]);
      folds.quadraticCurveTo(sign * (s[2] + GAP), s[3], sign * (s[4] + GAP), s[5]);
    }
  }

  // --- Neurons in each region, links between them, signals along the links ---
  let seed = 20261030;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const probe = document.createElement('canvas').getContext('2d');
  const inside = (x, y) => probe.isPointInPath(outline, x, y);
  const nodes = [];
  LOBES.forEach((L, li) => {
    let made = 0, tries = 0;
    while (made < 11 && tries++ < 2000) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * L.r * 0.82;
      const x = L.x + Math.cos(a) * d, y = L.y + Math.sin(a) * d;
      if (Math.sign(x) !== Math.sign(L.x) || Math.abs(x) < GAP + 0.05 || !inside(x, y)) continue;
      nodes.push({ x, y, lobe: li, ph: rnd() * Math.PI * 2, r: 0.016 + rnd() * 0.016, drift: 0.004 + rnd() * 0.006 });
      made++;
    }
  });
  const links = [];
  const seen = new Set();
  const link = (a, b) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a !== b && !seen.has(k)) { seen.add(k); links.push([a, b]); }
  };
  nodes.forEach((n, i) => {
    nodes.map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2, same: m.lobe === n.lobe }))
      .filter((o) => o.j !== i && o.same).sort((a, b) => a.d - b.d).slice(0, 2).forEach((o) => link(i, o.j));
    // and one longer path to the nearest neuron in another region on the same side
    const far = nodes.map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2, ok: m.lobe !== n.lobe && Math.sign(m.x) === Math.sign(n.x) }))
      .filter((o) => o.ok).sort((a, b) => a.d - b.d)[0];
    if (far && rnd() < 0.35) link(i, far.j);
  });
  // a few across the fissure, as the page's links do
  for (let k = 0; k < 5; k++) {
    const left = nodes.filter((n) => n.x < 0), right = nodes.filter((n) => n.x > 0);
    link(nodes.indexOf(left[Math.floor(rnd() * left.length)]), nodes.indexOf(right[Math.floor(rnd() * right.length)]));
  }

  // --- State from the app ---
  let mood = 'calm';               // calm | alert | offline
  let activity = LOBES.map(() => 0); // 0..1 per region: how recently its notes changed
  const pulses = [];
  function spawnPulse() {
    if (mood === 'offline' || !links.length) return;
    const [a, b] = links[Math.floor(rnd() * links.length)];
    const fwd = rnd() < 0.5;
    const from = fwd ? a : b;
    pulses.push({ a: from, b: fwd ? b : a, t: 0, speed: 0.012 + rnd() * 0.02, rgb: LOBES[nodes[from].lobe].rgb });
  }

  // --- Size: the canvas follows the window ---
  let size = 0, dpr = 1;
  function fit() {
    size = FIXED || Math.min(window.innerWidth, window.innerHeight);
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = `${size}px`;
    document.documentElement.style.setProperty('--size', `${size}px`);
  }
  fit();
  window.addEventListener('resize', fit);

  // --- Drawing ---
  function draw(t) {
    const R = size * 0.41;                 // the brain's radius in pixels
    const cx = size / 2, cy = size / 2 + R * 0.02;
    const off = mood === 'offline';
    const alertBeat = mood === 'alert' ? 0.5 + 0.5 * Math.sin(t / 420) : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // a soft dark backdrop, so the brain reads on a white page and on a photo alike
    const back = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, size * 0.5);
    back.addColorStop(0, 'rgba(7,8,13,0.62)');
    back.addColorStop(0.75, 'rgba(7,8,13,0.38)');
    back.addColorStop(1, 'rgba(7,8,13,0)');
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, size, size);

    // into unit space, breathing
    const breath = 1 + 0.012 * Math.sin(t / 1800);
    ctx.translate(cx, cy);
    ctx.scale(R * breath, R * breath);
    const px = 1 / R;                      // one pixel, in unit space
    if (off) ctx.globalAlpha = 0.55;

    // the dark body, then each region glowing inside the outline on its own beat
    ctx.fillStyle = 'rgba(9,13,24,0.88)';
    ctx.fill(outline);
    ctx.save();
    ctx.clip(outline);
    LOBES.forEach((L, i) => {
      const act = off ? 0 : activity[i];
      let a = 0.16 + 0.08 * (0.5 + 0.5 * Math.sin(t / 2600 + i * 1.7));
      if (act > 0) a += act * (0.18 + 0.26 * (0.5 + 0.5 * Math.sin(t / 900 + i)));
      const col = off ? '140,150,165' : L.rgb;
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      g.addColorStop(0, `rgba(${col},${Math.min(0.75, a).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(${col},${(Math.min(0.75, a) * 0.4).toFixed(3)})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
      ctx.fill();
      // a region whose notes were just touched sends out a ripple, as on the page
      if (act > 0.02) {
        const ph = ((t / 2400) + i * 0.37) % 1;
        ctx.strokeStyle = `rgba(${col},${(act * 0.6 * (1 - ph)).toFixed(3)})`;
        ctx.lineWidth = 1.6 * px;
        ctx.beginPath();
        ctx.arc(L.x, L.y, L.r * (0.15 + ph * 0.85), 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // links, then the signals running along them
    ctx.lineWidth = 0.9 * px;
    ctx.strokeStyle = `rgba(${WIRE},0.20)`;
    ctx.beginPath();
    for (const [a, b] of links) {
      const na = nodes[a], nb = nodes[b];
      ctx.moveTo(na.x + Math.sin(t / 1900 + na.ph) * na.drift, na.y + Math.cos(t / 2300 + na.ph) * na.drift);
      ctx.lineTo(nb.x + Math.sin(t / 1900 + nb.ph) * nb.drift, nb.y + Math.cos(t / 2300 + nb.ph) * nb.drift);
    }
    ctx.stroke();
    for (const n of nodes) {
      const lit = 0.5 + 0.45 * Math.sin(t / 800 + n.ph);
      const col = off ? '170,180,195' : LOBES[n.lobe].rgb;
      ctx.beginPath();
      ctx.arc(n.x + Math.sin(t / 1900 + n.ph) * n.drift, n.y + Math.cos(t / 2300 + n.ph) * n.drift, Math.max(n.r, 1.1 * px), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${col},${lit.toFixed(3)})`;
      ctx.fill();
    }
    for (const p of pulses) {
      const a = nodes[p.a], b = nodes[p.b];
      const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.026, 2.2 * px), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.rgb},0.95)`;
      ctx.shadowColor = `rgba(${p.rgb},1)`;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // the folds, then the outline on top so the silhouette stays crisp
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, size / 180) * px;
    ctx.strokeStyle = `rgba(${WIRE},0.26)`;
    ctx.stroke(folds);
    const edge = alertBeat ? ROSE : WIRE;
    ctx.lineWidth = Math.max(1.4, size / 110) * px;
    ctx.strokeStyle = `rgba(${edge},${(0.5 + 0.35 * alertBeat).toFixed(3)})`;
    ctx.shadowColor = `rgba(${edge},${(0.55 + 0.4 * alertBeat).toFixed(3)})`;
    ctx.shadowBlur = Math.max(8, size / 14);
    ctx.stroke(outline);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // --- Animation: about 30 frames a second; it stops on its own while the window is hidden ---
  let last = 0, nextPulse = 0;
  function frame(time) {
    requestAnimationFrame(frame);
    if (time - last < 33) return;
    last = time;
    if (time > nextPulse) { spawnPulse(); nextPulse = time + (mood === 'alert' ? 90 : 160); }
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].t += pulses[i].speed;
      if (pulses[i].t >= 1) pulses.splice(i, 1);
    }
    draw(time);
  }

  if (STILL) {
    activity = [0.6, 0, 0.3, 0, 0.8, 0];
    for (let i = 0; i < 16; i++) spawnPulse();
    pulses.forEach((p, i) => { p.t = (i % 8) / 8 + 0.06; });
    draw(1400);
    return;
  }
  requestAnimationFrame(frame);

  function show(s) {
    mood = !s.online ? 'offline' : s.attention ? 'alert' : 'calm';
    badge.hidden = !s.online || !s.count;
    badge.textContent = s.count > 99 ? '99+' : String(s.count);
    badge.classList.toggle('attention', !!s.attention);
    document.body.title = ['Alfred', ...(s.lines || [])].join('\n');
    // activity arrives per folder; a region takes the busiest of its folders
    const folders = s.activity || {};
    activity = LOBES.map((L) => Math.max(0, ...Object.keys(folders)
      .filter((f) => L.folders.includes(f) || (L.key === 'System' && !LOBES.some((o) => o.folders.includes(f))))
      .map((f) => Number(folders[f]?.score) || 0)));
  }
  if (window.alfred) window.alfred.onStatus(show);

  // --- Gestures: drag to move, the corner grip to resize, click to open, right-click for the menu ---
  let down = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !window.alfred) return;
    const resize = e.target === grip;
    down = { x: e.screenX, y: e.screenY, moved: false, resize };
    document.body.setPointerCapture(e.pointerId);
    window.alfred.send(resize ? 'widget:resize-start' : 'widget:drag-start');
  });
  document.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.moved && Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4) {
      down.moved = true;
      document.body.classList.add(down.resize ? 'resizing' : 'dragging');
    }
    if (down.moved) window.alfred.send(down.resize ? 'widget:resize' : 'widget:drag');
  });
  document.addEventListener('pointerup', () => {
    if (!down) return;
    if (down.resize) window.alfred.send('widget:resize-end');
    else window.alfred.send(down.moved ? 'widget:drag-end' : 'widget:open');
    document.body.classList.remove('dragging', 'resizing');
    down = null;
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.alfred) window.alfred.send('widget:menu');
  });
})();
