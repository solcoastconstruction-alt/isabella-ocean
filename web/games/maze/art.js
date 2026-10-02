/* Coral Maze — everything you see, drawn in code. Isabella, the coin, the chest, the key, the jellyfish,
 * the pufferfish, the shell, the sea and the particles are copied from the main game's web/render.js and
 * Shell Match's art.js (both untouched); the coral reef, its gates and currents, the light at the way out,
 * the hint trail and the dark water are new. The world is 540 units tall and scaled to the screen, like the
 * main game. The reef (rock, tunnels and the coral growing on it) is drawn once per level into an offscreen
 * canvas, so a frame only has to draw what moves. */
(function () {
  'use strict';
  const H = 540, TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;

  // Level looks: the main game's twenty THEMES (web/render.js), copied.
  const THEMES = [
    { top: '#7fe3f0', bot: '#1f8fc0', far: 'rgba(28,118,170,0.55)', sand: ['#f9e4ab', '#e0bd78'], rock: ['#c99f78', '#a07b58', '#e2c29f'], tip: ['#ff8fab', '#ffd166', '#ff6b6b'], ray: 0.22, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#5fd0e0', bot: '#1777a8', far: 'rgba(25,100,150,0.55)', sand: ['#f6d9a8', '#d9b47a'], rock: ['#d99191', '#b06666', '#f0b8b8'], tip: ['#ff5d8f', '#ff9e6d', '#c77dff', '#ffd166'], ray: 0.2, jelly: ['#e0c3ff', '#a66bff'] },
    { top: '#5ccfb0', bot: '#0f6b5e', far: 'rgba(10,80,70,0.55)', sand: ['#e8d9a0', '#c4b06e'], rock: ['#7e9a76', '#5c7656', '#a5c09a'], tip: ['#b8f27c', '#ffd166', '#7cf2c8'], ray: 0.18, jelly: ['#ffd0f0', '#ff8ad0'] },
    { top: '#62c6f2', bot: '#145ea8', far: 'rgba(15,70,130,0.5)', sand: ['#f3e0b0', '#d7bd86'], rock: ['#a7b0bd', '#7d8796', '#c9d0da'], tip: ['#ffd166', '#ff8fab', '#8ce99a'], ray: 0.2, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#4fb0c0', bot: '#0b4660', far: 'rgba(8,48,66,0.6)', sand: ['#d9c79a', '#b29f70'], rock: ['#8d735f', '#6b5545', '#b0957d'], tip: ['#ffb347', '#ff6b6b', '#8ce99a'], ray: 0.15, jelly: ['#ffe0a8', '#ffab4a'] },
    { top: '#8b7ee0', bot: '#2a2370', far: 'rgba(40,30,100,0.6)', sand: ['#d7c6e8', '#a996c4'], rock: ['#7a6aa8', '#5a4c85', '#a596d0'], tip: ['#ff7ad9', '#7afcff', '#ffd166'], ray: 0.12, jelly: ['#b8fff6', '#4de8d6'] },
    { top: '#86e0f5', bot: '#1f4f94', far: 'rgba(30,70,140,0.55)', sand: ['#e4f1fb', '#b8d3ea'], rock: ['#a9c6e8', '#7d9cc4', '#dcecff'], tip: ['#c2f0ff', '#ffffff', '#b9a7ff'], ray: 0.2, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#f4a76a', bot: '#6d2747', far: 'rgba(90,30,50,0.6)', sand: ['#7a6262', '#4a3a3e'], rock: ['#5b3d3d', '#3d2828', '#8a5a50'], tip: ['#ff7b3a', '#ffd166', '#ff3d6e'], ray: 0.1, jelly: ['#fff1a8', '#ffc94a'] },
    { top: '#1d3d70', bot: '#050d26', far: 'rgba(10,25,60,0.7)', sand: ['#2a3550', '#1a2238'], rock: ['#2c4266', '#1d2d48', '#3f5e8c'], tip: ['#5cf2ff', '#ff5cf0', '#9dff5c'], ray: 0.05, jelly: ['#a8fff9', '#3de0ff'] },
    { top: '#9feaf8', bot: '#5b78e0', far: 'rgba(130,140,230,0.45)', sand: ['#fbe7f3', '#e7c4dd'], rock: ['#d9bdf2', '#b394d6', '#f1e0ff'], tip: ['#ff8fab', '#ffd166', '#8ce99a', '#7ad7ff', '#c77dff'], ray: 0.22, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#b4f3ee', bot: '#2b9fb8', far: 'rgba(40,140,170,0.5)', sand: ['#fff6e0', '#ecd5ab'], rock: ['#e8dccb', '#c7b5a0', '#fff6ea'], tip: ['#ffd1e8', '#ffffff', '#bff4ff'], ray: 0.22, jelly: ['#ffd6f5', '#ff8fd8'] },
    { top: '#9ff0c8', bot: '#16846f', far: 'rgba(20,110,90,0.5)', sand: ['#efe6b0', '#d1c27c'], rock: ['#8fb38a', '#6a8f66', '#b9d8b3'], tip: ['#ffe066', '#ff9ec7', '#b8f27c'], ray: 0.2, jelly: ['#e0c3ff', '#a66bff'] },
    { top: '#8fe1ff', bot: '#2168b8', far: 'rgba(30,90,160,0.5)', sand: ['#ffd9a0', '#f0b874'], rock: ['#e0a982', '#bd8460', '#f3c9a8'], tip: ['#ff7b5c', '#ffd166', '#ff5d8f'], ray: 0.22, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#4f86d6', bot: '#0e2a63', far: 'rgba(15,40,100,0.6)', sand: ['#c9d4e8', '#9aa9c8'], rock: ['#6c7fa8', '#4f6189', '#93a6cf'], tip: ['#9ad8ff', '#ffd166', '#c9a7ff'], ray: 0.12, jelly: ['#b8fff6', '#4de8d6'] },
    { top: '#5ec2b5', bot: '#0d4f5a', far: 'rgba(10,60,70,0.6)', sand: ['#e6d39e', '#bfa66c'], rock: ['#7d6553', '#5a4636', '#a68b74'], tip: ['#ffcc33', '#ff6b6b', '#8ce99a'], ray: 0.16, jelly: ['#ffe0a8', '#ffab4a'] },
    { top: '#2c3f8f', bot: '#0a1238', far: 'rgba(20,30,80,0.65)', sand: ['#4a5480', '#2e365c'], rock: ['#3c4a80', '#28325c', '#5a6aa8'], tip: ['#c8b6ff', '#7afcff', '#ff9ef0'], ray: 0.08, jelly: ['#e6d6ff', '#a78bfa'] },
    { top: '#d4f6ff', bot: '#5aa0d8', far: 'rgba(120,170,220,0.5)', sand: ['#ffffff', '#d7ebf7'], rock: ['#cfe6f7', '#a3c4e0', '#ffffff'], tip: ['#bfefff', '#ffffff', '#d6c8ff'], ray: 0.24, jelly: ['#e8fbff', '#8fd8ff'] },
    { top: '#ff9a6b', bot: '#5a1530', far: 'rgba(100,20,40,0.6)', sand: ['#5e4446', '#3b2a2e'], rock: ['#4a2a2a', '#2e1a1a', '#7a4040'], tip: ['#ff5a1f', '#ffd166', '#ff2e63'], ray: 0.08, jelly: ['#fff1a8', '#ffc94a'] },
    { top: '#7d9a9e', bot: '#1f3439', far: 'rgba(30,50,55,0.65)', sand: ['#a8a58f', '#7b7866'], rock: ['#56656a', '#3d4a4e', '#7c8d92'], tip: ['#c6ff8a', '#ffe066', '#9ad8ff'], ray: 0.06, jelly: ['#d6ffe0', '#7de8a0'] },
    { top: '#c9a4ff', bot: '#3b1d7a', far: 'rgba(70,40,140,0.55)', sand: ['#ffe8a3', '#e8c56a'], rock: ['#b48be8', '#8a63c4', '#d9bfff'], tip: ['#ffd23f', '#ff8fd8', '#ffffff'], ray: 0.2, jelly: ['#ffd6f5', '#ff8fd8'] },
  ];
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38', GOLD = '#ffcc33';
  // each key and its gate share a colour: the gem in the key's bow and the lock on the gate
  const KEY_COLORS = ['#ff4d8d', '#4cc9f0', '#7bd93f'];
  const KEY_DARK = ['#b8235f', '#1b7fb8', '#3f8f1f'];
  const KEY_LIGHT = ['#ffc2dc', '#c4f1ff', '#d9f8bd'];
  const KEY_GLOW = ['rgba(255,120,180,0.9)', 'rgba(110,210,255,0.9)', 'rgba(150,235,100,0.9)'];

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  const parts = [], amb = [];
  let reefCache = null, fogCv = null, fogCtx = null, lightSprite = null;

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d');
    for (let i = 0; i < 30; i++) amb.push({ x: Math.random() * 2400, y: Math.random() * H, r: 1 + Math.random() * 3, sp: 10 + Math.random() * 30, ph: Math.random() * TAU });
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    s = canvas.height / H; VW = canvas.width / s;
    reefCache = null;
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toCss = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });

  // ---------- helpers (from render.js) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const glowCache = {};
  function glowSprite(color) {
    let c = glowCache[color];
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowCache[color] = c;
    }
    return c;
  }
  function glow(x, y, r, color, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a == null ? 1 : clamp(a, 0, 1);
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  function star(x, y, r1, r2, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath();
  }
  function heartPath(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.9);
    ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.7, y - r * 1.3, x, y - r * 0.45);
    ctx.bezierCurveTo(x + r * 0.7, y - r * 1.3, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
    ctx.closePath();
  }
  function rrect(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function oval(x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fill(); }

  // ---------- Isabella (copied from render.js) ----------
  function drawIsabella(x, y, time, o) {
    o = o || {};
    ctx.save();
    ctx.translate(x, y); ctx.rotate(o.tilt || 0);
    const sc = o.scale || 0.92; ctx.scale(o.flip ? -sc : sc, sc);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    const sw = time * (o.swim || 7);
    const hw1 = Math.sin(sw * 0.6) * 3, hw2 = Math.sin(sw * 0.6 - 1.2) * 6;

    // hair, back layer (flows behind her)
    ctx.fillStyle = HAIR;
    ctx.beginPath();
    ctx.moveTo(42, -22);
    ctx.bezierCurveTo(32, -36, 14, -32, 9, -19);
    ctx.bezierCurveTo(-6, -22 + hw1, -24, -17 + hw2, -44, -9 + hw2);
    ctx.bezierCurveTo(-28, -2 + hw2, -10, -3 + hw1, 6, -5);
    ctx.bezierCurveTo(14, -2, 18, -5, 21, -8);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = HAIR_HI; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(14, -22); ctx.bezierCurveTo(0, -18 + hw1, -18, -14 + hw2, -34, -8 + hw2); ctx.stroke();

    // tail spine
    const N = 12, pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      pts.push({ x: 4 - u * 78, y: 3 + Math.sin(sw - u * 2.4) * (1.5 + u * u * 11), w: 14 * (1 - u * 0.72) });
    }
    const grad = ctx.createLinearGradient(6, 0, -78, 0);
    RAINBOW.forEach((c, i) => grad.addColorStop(i / (RAINBOW.length - 1), c));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0].x + 6, pts[0].y - pts[0].w);
    for (const p of pts) ctx.lineTo(p.x, p.y - p.w);
    for (let i = N; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y + pts[i].w);
    ctx.lineTo(pts[0].x + 6, pts[0].y + pts[0].w);
    ctx.closePath(); ctx.fill();
    // scales
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.1;
    for (let i = 1; i < N - 1; i++) {
      const p = pts[i];
      for (const j of i % 2 ? [-0.45, 0.45] : [0]) {
        ctx.beginPath(); ctx.arc(p.x + 2, p.y + j * p.w, p.w * 0.38, -1.25, 1.25); ctx.stroke();
      }
    }
    // twinkles on the scales
    for (let i = 2; i < N - 1; i += 3) {
      const p = pts[i], tw = 0.5 + 0.5 * Math.sin(time * 5 + i * 1.7);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + tw * 0.6})`;
      star(p.x, p.y - p.w * 0.3, 2.4 * tw + 0.8, 0.8, 4, 0); ctx.fill();
    }
    // fin
    const tip = pts[N], prev = pts[N - 1], ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(ang);
    const flap = Math.sin(sw - 2.6) * 5;
    const fg = ctx.createLinearGradient(0, 0, 32, 0);
    fg.addColorStop(0, '#c86bfa'); fg.addColorStop(0.5, '#ff6bcb'); fg.addColorStop(1, '#7fdcff');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(-3, 0);
    ctx.bezierCurveTo(8, -6, 18, -22 + flap, 32, -25 + flap);
    ctx.bezierCurveTo(25, -12, 23, -4, 17, 0);
    ctx.bezierCurveTo(23, 4, 25, 12, 32, 25 + flap);
    ctx.bezierCurveTo(18, 22 + flap, 8, 6, -3, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    for (const k of [-1, 1]) for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(24 + r * 2, k * (10 + r * 6) + flap * 0.6); ctx.stroke(); }
    ctx.restore();

    // body
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.ellipse(13, -1, 15, 10, -0.08, 0, TAU); ctx.fill();
    // little scalloped waistband where the tail starts
    ctx.fillStyle = '#ff7ab8';
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(4, k * 5.2 + 1, 3.4, 0, TAU); ctx.fill(); }
    // shell top
    ctx.fillStyle = '#c86bfa';
    ctx.beginPath(); ctx.ellipse(19, 3, 6.5, 5.5, 0.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f0d4ff'; ctx.lineWidth = 0.9;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(16, 6); ctx.lineTo(19 + k * 2.4, -1.5); ctx.stroke(); }
    // arm reaching forward
    const armA = Math.sin(sw * 0.5) * 0.25;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(21, -2);
    if (o.happy) ctx.quadraticCurveTo(30, -20, 40 + armA * 6, -34);
    else ctx.quadraticCurveTo(32, 8 + armA * 10, 45, 6 + armA * 14);
    ctx.stroke();

    // head
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(33, -13, 14.5, 0, TAU); ctx.fill();
    // ear
    ctx.beginPath(); ctx.ellipse(22, -12, 3, 4, 0, 0, TAU); ctx.fill();
    // cheeks
    ctx.fillStyle = 'rgba(255,120,150,0.45)';
    ctx.beginPath(); ctx.arc(29, -7.5, 3.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(44, -7.5, 2.8, 0, TAU); ctx.fill();
    // eyes (blink every few seconds)
    const blink = (time % 3.7) < 0.12;
    for (const ex of [32, 41]) {
      if (blink) { ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(ex, -14, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); continue; }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, -14, 3.7, 4.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.arc(ex + 0.9, -13.6, 2.9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1d0f06'; ctx.beginPath(); ctx.arc(ex + 1, -13.5, 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 2, -15.2, 1.1, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a170a'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.ellipse(ex, -14, 3.9, 4.8, 0, -2.6, -0.35); ctx.stroke(); // upper lid
      ctx.beginPath(); ctx.moveTo(ex + 2.6, -17.8); ctx.lineTo(ex + 4.6, -19.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + 3.6, -16.4); ctx.lineTo(ex + 5.6, -17.4); ctx.stroke();
    }
    // nose + smile
    ctx.strokeStyle = '#d99878'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(37.5, -9.5, 1.3, -0.2, 1.6); ctx.stroke();
    if (o.happy) {
      ctx.fillStyle = '#c0395a'; ctx.beginPath(); ctx.arc(37, -6, 3.6, 0, Math.PI); ctx.fill();
    } else {
      ctx.strokeStyle = '#c0395a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(37, -7.6, 3.3, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke();
    }
    // hair front: crown + fringe
    ctx.fillStyle = HAIR;
    ctx.beginPath(); ctx.moveTo(19, -9);
    ctx.bezierCurveTo(15, -31, 45, -37, 48.5, -15);
    ctx.bezierCurveTo(46, -20, 43, -19, 41, -23);
    ctx.bezierCurveTo(38, -18.5, 34, -18.5, 31.5, -23.5);
    ctx.bezierCurveTo(29, -19, 25, -18, 23, -21);
    ctx.bezierCurveTo(21.5, -16, 21.5, -12, 19, -9);
    ctx.fill();
    // side lock over the shoulder
    ctx.beginPath(); ctx.moveTo(20, -15);
    ctx.bezierCurveTo(14, -4 + hw1 * 0.4, 17, 4, 12, 11 + hw1 * 0.6);
    ctx.bezierCurveTo(21, 5, 24, -4, 25, -13);
    ctx.fill();
    ctx.strokeStyle = HAIR_HI; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(32, -16, 12, -2.6, -1.4); ctx.stroke();
    // starfish hair clip
    ctx.fillStyle = '#ffd93d'; star(25, -27, 5.5, 2.4, 5, time * 0.5); ctx.fill();
    ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.arc(25, -27, 1.4, 0, TAU); ctx.fill();
    if (o.crown) {
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#b86e00'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(22, -28); ctx.lineTo(24, -42); ctx.lineTo(29, -34); ctx.lineTo(33.5, -45);
      ctx.lineTo(38, -34); ctx.lineTo(43, -42); ctx.lineTo(45, -28); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff4d8d';
      for (const [gx, gy] of [[24, -42], [33.5, -45], [43, -42]]) { ctx.beginPath(); ctx.arc(gx, gy, 1.9, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#4cc9f0'; ctx.beginPath(); ctx.arc(33.5, -32, 2.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  // Isabella centred on (x, y): her drawing's origin is at her waist, and she is about 154 units long from
  // fin tip to nose, so shift her forward along the way she faces.
  const ISA_LEN = 154, ISA_MID = 29;
  function drawIsabellaCentered(x, y, time, o) {
    const a = o.tilt || 0, sc = o.scale || 1, k = (o.flip ? -1 : 1) * ISA_MID * sc;
    drawIsabella(x + Math.cos(a) * k, y + Math.sin(a) * k, time, o);
  }

  // ---------- coin, pearl, key, chest, shell (from render.js / Shell Match) ----------
  function drawCoin(x, y, ph, r) {
    r = r || 13;
    const sx = 0.3 + 0.7 * Math.abs(Math.cos(ph));
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
    ctx.fillStyle = '#c98a00'; ctx.beginPath(); ctx.arc(0, 1.5, r, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 1, 0, 0, r);
    g.addColorStop(0, '#fff6b0'); g.addColorStop(0.45, '#ffd633'); g.addColorStop(1, '#e8a200');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(180,110,0,0.75)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(200,125,0,0.8)'; star(0, 0, r * 0.38, r * 0.17, 5, -Math.PI / 2); ctx.fill();
    ctx.restore();
  }
  function drawPearl(x, y, r, shine) {
    if (shine > 0) glow(x, y, r * 2.6, 'rgba(255,235,255,0.9)', shine);
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#fbeaf6'); g.addColorStop(1, '#d6b2d6');
    ctx.fillStyle = g; circle(x, y, r);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; circle(x - r * 0.38, y - r * 0.4, r * 0.24);
  }
  // the main game's golden key, with its gem in the colour of its gate
  function drawKey(x, y, rot, sc, gem) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
    ctx.fillStyle = '#e8a200'; ctx.strokeStyle = '#a86a00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-16, 0, 12.5, 0, TAU); ctx.arc(-16, 0, 8, 0, TAU, true); ctx.fill('evenodd'); ctx.stroke();
    rrect(-5, -4, 32, 8, 3); ctx.fill(); ctx.stroke();
    ctx.fillRect(16, 3, 5, 9); ctx.strokeRect(16, 3, 5, 9);
    ctx.fillRect(23, 3, 4, 6); ctx.strokeRect(23, 3, 4, 6);
    ctx.fillStyle = 'rgba(255,250,200,0.9)';
    ctx.fillRect(-2, -2.5, 20, 2);
    ctx.fillStyle = gem || '#ff4d8d'; heartPath(-16, 1, 7.4); ctx.fill();
    ctx.strokeStyle = 'rgba(80,20,40,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; circle(-18.6, -2.2, 1.8);
    ctx.restore();
  }
  function drawChest(x, y, open, time, sc) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    if (open > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const bg = ctx.createLinearGradient(0, -20, 0, -320);
      bg.addColorStop(0, `rgba(255,230,120,${0.55 * open})`); bg.addColorStop(1, 'rgba(255,230,120,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(-50, -20); ctx.lineTo(50, -20); ctx.lineTo(120, -330); ctx.lineTo(-120, -330); ctx.closePath(); ctx.fill();
      ctx.restore();
      glow(0, -30, 140, 'rgba(255,220,90,0.8)', open);
    }
    ctx.fillStyle = '#8b4a1c'; rrect(-60, -34, 120, 62, 8); ctx.fill();
    ctx.fillStyle = '#a65d27'; rrect(-56, -30, 112, 54, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(80,35,10,0.5)'; ctx.lineWidth = 2;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(-56, k * 14 - 3); ctx.lineTo(56, k * 14 - 3); ctx.stroke(); }
    ctx.fillStyle = GOLD;
    rrect(-62, -36, 12, 66, 3); ctx.fill(); rrect(50, -36, 12, 66, 3); ctx.fill();
    ctx.fillRect(-60, -36, 120, 7);
    if (open > 0.1) for (let i = 0; i < 9; i++) drawCoin(-40 + i * 10, -38 - Math.sin(i * 1.3) * 5, time * 2 + i, 9);
    ctx.save(); ctx.translate(-60, -36); ctx.rotate(-open * 1.9);
    ctx.fillStyle = '#8b4a1c';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(120, 0); ctx.quadraticCurveTo(122, -38, 60, -42); ctx.quadraticCurveTo(-2, -38, 0, 0); ctx.fill();
    ctx.fillStyle = '#b8652b';
    ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(115, -3); ctx.quadraticCurveTo(116, -34, 60, -37); ctx.quadraticCurveTo(4, -34, 5, -3); ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.fillRect(-2, -6, 12, 8); ctx.fillRect(110, -6, 12, 8);
    ctx.beginPath(); ctx.moveTo(54, 0); ctx.lineTo(66, 0); ctx.lineTo(66, -41); ctx.lineTo(54, -41); ctx.fill();
    ctx.restore();
    if (open < 0.05) {
      ctx.fillStyle = GOLD; rrect(-13, -40, 26, 28, 5); ctx.fill();
      ctx.fillStyle = '#5a3a10'; ctx.beginPath(); ctx.arc(0, -29, 4, 0, TAU); ctx.fill(); ctx.fillRect(-2, -29, 4, 10);
    }
    ctx.restore();
  }
  // the main game's checkpoint clam: once touched it stays open with its pearl showing
  function drawShell(x, y, open, time, sc) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    if (open) glow(0, -20, 60, 'rgba(255,200,255,0.7)', 0.6 + 0.3 * Math.sin(time * 3));
    ctx.fillStyle = '#ff9ec7';
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 14, 0, 0, Math.PI); ctx.fill();
    if (open) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -8, 10, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,240,0.9)'; ctx.beginPath(); ctx.arc(-3, -11, 4, 0, TAU); ctx.fill();
    }
    ctx.save(); if (open) { ctx.translate(-30, -2); ctx.rotate(-0.9); ctx.translate(30, 2); }
    ctx.fillStyle = '#ffb8d6';
    ctx.beginPath(); ctx.moveTo(-34, 0); ctx.quadraticCurveTo(0, -46, 34, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff7ab0'; ctx.lineWidth = 2;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(k * 9, -22 + Math.abs(k) * 4); ctx.stroke(); }
    ctx.restore();
    ctx.restore();
  }

  // ---------- the patrols (jellyfish and pufferfish from render.js), drawn around (0, 0) ~60 across ----------
  function drawJelly(x, y, sc, time, th, o) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    if (o.wobble > 0) { const w = Math.sin(o.wobble * 30) * 0.18 * o.wobble; ctx.rotate(w); }
    const pulse = 1 + Math.sin(time * 4 + o.ph) * 0.06;
    ctx.strokeStyle = th.jelly[1]; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.globalAlpha = 0.85;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(k * 7, 8);
      for (let j = 1; j <= 6; j++) ctx.lineTo(k * 7 + Math.sin(time * 5 + j * 0.9 + k) * 3.5, 8 + j * 5);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
    const g = ctx.createRadialGradient(-6, -12, 2, 0, -4, 30);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, th.jelly[0]); g.addColorStop(1, th.jelly[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-26 * pulse, 8);
    ctx.bezierCurveTo(-28 * pulse, -30, 28 * pulse, -30, 26 * pulse, 8);
    for (let k = 4; k >= -4; k--) ctx.quadraticCurveTo((k + 0.5) * 6 * pulse, 13, k * 6 * pulse, 8);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; oval(-11, -14, 5, 3, -0.5);
    // a friendly face: open eyes, a smile, and a blush when she is close
    for (const ex of [-7, 7]) { ctx.fillStyle = '#fff'; oval(ex, -4, 3.8, 4.4); ctx.fillStyle = '#3a1030'; circle(ex + 0.6, -3.4, 2.3); ctx.fillStyle = '#fff'; circle(ex + 1.4, -4.8, 0.9); }
    ctx.fillStyle = 'rgba(255,90,150,' + (0.35 + 0.4 * (o.near || 0)) + ')'; circle(-13, 2, 3); circle(13, 2, 3);
    ctx.strokeStyle = '#3a1030'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 1, 3.5, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.restore();
  }
  function drawPuffer(x, y, sc, time, o) {
    const r = 18 + 7 * (o.near || 0) + (o.wobble > 0 ? Math.sin(o.wobble * 20) * 2 : 0), puff = (r - 18) / 28;
    ctx.save(); ctx.translate(x, y + Math.sin(time * 2 + o.ph * 6) * 2); ctx.scale(sc * (o.face < 0 ? -1 : 1), sc);
    ctx.strokeStyle = '#c47a00'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU, l = r + 2 + puff * 10; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85); ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l); ctx.stroke(); }
    ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r - 13, -9 + Math.sin(time * 8) * 3); ctx.lineTo(-r - 13, 9 - Math.sin(time * 8) * 3); ctx.closePath(); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r);
    g.addColorStop(0, '#fff3a0'); g.addColorStop(0.6, '#ffc93a'); g.addColorStop(1, '#f29a00');
    ctx.fillStyle = g; circle(0, 0, r);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; oval(0, r * 0.35, r * 0.6, r * 0.4);
    for (const ex of [r * 0.05, r * 0.45]) {
      ctx.fillStyle = '#fff'; circle(ex, -r * 0.25, 4 + r * 0.08);
      ctx.fillStyle = '#222'; circle(ex + 1, -r * 0.22, 2 + r * 0.04);
      ctx.fillStyle = '#fff'; circle(ex + 1.8, -r * 0.3, 0.9);
    }
    ctx.fillStyle = 'rgba(255,110,140,0.5)'; circle(-r * 0.2, r * 0.12, 3);
    ctx.fillStyle = '#c0395a'; oval(r * 0.68, r * 0.12, 2.5 + puff * 2, 2 + puff * 3);
    ctx.restore();
  }

  // ---------- the sea ----------
  function drawWater(th, time, drift) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.top); g.addColorStop(1, th.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createLinearGradient(0, 0, 0, H);
    rg.addColorStop(0, `rgba(255,255,255,${th.ray})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    for (let i = 0; i < 6; i++) {
      const span = VW + 500, x = ((((i * 260 - drift * 0.08 + Math.sin(time * 0.3 + i) * 40) % span) + span) % span) - 250;
      const w = 40 + (i % 3) * 25;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w + 180, H); ctx.lineTo(x + 120, H); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(0, 0);
    for (let x = 0; x <= VW + 20; x += 20) ctx.lineTo(x, 12 + Math.sin((x + drift * 0.3) / 40 + time * 2) * 4);
    ctx.lineTo(VW, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = th.far;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= VW + 20; x += 20) { const u = x + drift * 0.2; ctx.lineTo(x, 420 + 30 * Math.sin(u / 160) + 15 * Math.sin(u / 57 + 1)); }
    ctx.lineTo(VW, H); ctx.closePath(); ctx.fill();
  }
  function drawBubbles(time, drift) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    for (const a of amb) {
      const x = ((((a.x - drift * 0.7) % (VW + 40)) + VW + 40) % (VW + 40)) - 20;
      const y = ((((a.y - time * a.sp) % H) + H) % H);
      ctx.beginPath(); ctx.arc(x + Math.sin(time + a.ph) * 4, y, a.r, 0, TAU); ctx.stroke();
    }
  }
  function drawSand(th, y0, seed) {
    const g = ctx.createLinearGradient(0, y0 - 10, 0, H);
    g.addColorStop(0, th.sand[0]); g.addColorStop(1, th.sand[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-10, H);
    for (let x = -10; x <= VW + 20; x += 16) ctx.lineTo(x, y0 - 4 + 5 * Math.sin(x / 90) + 3 * Math.sin(x / 37));
    ctx.lineTo(VW + 20, H); ctx.closePath(); ctx.fill();
    const tile = 170;
    for (let i = 0; i <= Math.ceil(VW / tile); i++) {
      const R = mulberry32((i * 7919 + (seed || 0) * 104729 + 7) >>> 0), x = i * tile + R() * 120, y = y0 + 8 + R() * 12, k = R();
      if (k < 0.3) { ctx.fillStyle = '#ff8a5c'; star(x, y, 8, 3.5, 5, R() * 3); ctx.fill(); }
      else if (k < 0.55) { ctx.fillStyle = '#fff0e0'; ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, Math.PI, 0); ctx.fill(); }
    }
  }
  function seaweed(x, y, h, time, col, ph, w) {
    ctx.strokeStyle = col; ctx.lineWidth = w || 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 1; k <= 7; k++) ctx.lineTo(x + Math.sin(time * 1.2 + k * 0.6 + ph) * k * 1.6, y - (h * k) / 7);
    ctx.stroke();
  }
  function branchCoral(x, y, col, R, size, up) {
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    const br = (bx, by, len, a, d) => {
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      ctx.lineWidth = (2 + d * 2.4) * size; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
      if (d > 0) { br(ex, ey, len * 0.72, a - 0.5 - R() * 0.25, d - 1); br(ex, ey, len * 0.72, a + 0.5 + R() * 0.25, d - 1); }
      else { ctx.fillStyle = col; circle(ex, ey, 2.6 * size); }
    };
    br(x, y, (16 + R() * 8) * size, up == null ? -Math.PI / 2 : up, 2);
  }
  function fanCoral(x, y, col, R, size) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y - 18 * size, (18 + R() * 6) * size, 20 * size, 0, Math.PI, 0); ctx.lineTo(x + 2 * size, y); ctx.lineTo(x - 2 * size, y); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2 * size;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + k * 5.6 * size, y - 36 * size + Math.abs(k) * 3 * size); ctx.stroke(); }
  }

  // ---------- where the maze goes ----------
  // Square cells as big as fit between the home button's column (19vh + 2vh = 113 units) on the left and a strip of
  // open sea, with the treasure chest, on the right. rim = the rock round the outside of the maze.
  const HOME_COL = 130;
  function layout(W, Hc) {
    const sea = clamp(VW * 0.13, 104, 176), top = 30, bottom = 22, rimK = 0.42;
    const availW = Math.max(100, VW - HOME_COL - sea), availH = H - top - bottom;
    const c = Math.min(availW / (W + 2 * rimK), availH / (Hc + 2 * rimK), 118);
    const rim = rimK * c, mw = W * c, mh = Hc * c;
    const x0 = HOME_COL + (availW - mw - 2 * rim) / 2 + rim, y0 = top + (availH - mh - 2 * rim) / 2 + rim;
    const seaX = x0 + mw + rim;
    return {
      c, rim, x0, y0, mw, mh, W, H: Hc, tunnel: 0.62 * c, seaX,
      chestX: Math.min(seaX + 26 + 62 * clamp(c / 90, 0.6, 0.95), (seaX + VW) / 2), chestY: 540 - 34 * clamp(c / 100, 0.6, 0.9), chestSc: clamp(c / 100, 0.6, 0.9),
    };
  }
  const cellX = (lay, lv, i) => lay.x0 + (lv.cx[i] + 0.5) * lay.c;
  const cellY = (lay, lv, i) => lay.y0 + (lv.cy[i] + 0.5) * lay.c;

  // ---------- the reef: drawn once per level ----------
  // The rock is one lumpy block; the tunnels are cut out of it (so the sea and its light show through), then the
  // rock beside each tunnel is shaded (lit floors, shadowed ceilings) and coral grows on the rock between them.
  function roundRectPath(p, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath();
  }
  function tunnelPath(lv, lay) {
    const p = new Path2D(), c = lay.c, w = lay.tunnel, r = w * 0.32;
    for (let i = 0; i < lv.N; i++) {
      const x = cellX(lay, lv, i), y = cellY(lay, lv, i);
      roundRectPath(p, x - w / 2, y - w / 2, w, w, r);
      if (lv.open[i] & 2 && i !== lv.exit) p.rect(x, y - w / 2, c, w);
      if (lv.open[i] & 4) p.rect(x - w / 2, y, w, c);
    }
    // the way out: through the rim to the open sea, flaring at the mouth
    const ex = cellX(lay, lv, lv.exit), ey = cellY(lay, lv, lv.exit), edge = lay.seaX;
    p.rect(ex, ey - w / 2, edge - ex + 8, w);
    p.moveTo(edge - lay.rim * 0.7, ey - w / 2);
    p.quadraticCurveTo(edge - lay.rim * 0.1, ey - w / 2, edge + 4, ey - w * 0.85);
    p.lineTo(edge + 4, ey + w * 0.85);
    p.quadraticCurveTo(edge - lay.rim * 0.1, ey + w / 2, edge - lay.rim * 0.7, ey + w / 2);
    p.closePath();
    return p;
  }
  function buildReef(lv, lay, th) {
    const cv = document.createElement('canvas');
    cv.width = canvas.width; cv.height = canvas.height;
    const main = ctx;
    ctx = cv.getContext('2d');
    try {
      ctx.setTransform(s, 0, 0, s, 0, 0);
      const R = mulberry32((lv.seed * 2654435761 + 12345) >>> 0), c = lay.c, rim = lay.rim;
      const bx = lay.x0 - rim, by = lay.y0 - rim, bw = lay.mw + 2 * rim, bh = lay.mh + 2 * rim;
      // the block, with lumps all round its edge
      const body = new Path2D();
      roundRectPath(body, bx, by, bw, bh, rim * 1.3);
      // (each lump is its own closed loop: moveTo first, or Path2D joins it to the last one with a stray edge)
      const lump = (x, y) => {
        const rx = (0.18 + R() * 0.14) * c, ry = (0.16 + R() * 0.12) * c, rot = R() * 3;
        body.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
        body.ellipse(x, y, rx, ry, rot, 0, TAU);
        body.closePath();
      };
      for (let x = bx + rim; x < bx + bw - rim; x += c * (0.45 + R() * 0.3)) { lump(x, by + 0.1 * c); lump(x, by + bh - 0.1 * c); }
      for (let y = by + rim; y < by + bh - rim; y += c * (0.45 + R() * 0.3)) { lump(bx + 0.1 * c, y); lump(bx + bw - 0.1 * c, y); }
      const rg = ctx.createLinearGradient(0, by, 0, by + bh);
      rg.addColorStop(0, th.rock[0]); rg.addColorStop(1, th.rock[1]);
      ctx.fillStyle = rg; ctx.fill(body);
      // texture: soft light and dark patches and little pores
      ctx.save(); ctx.clip(body);
      const n = Math.round((bw * bh) / (c * c) * 5);
      for (let k = 0; k < n; k++) {
        const x = bx + R() * bw, y = by + R() * bh, rr = (0.06 + R() * 0.16) * c;
        ctx.fillStyle = R() < 0.55 ? th.rock[2] : th.rock[1]; ctx.globalAlpha = 0.18 + R() * 0.2;
        oval(x, y, rr, rr * (0.6 + R() * 0.4), R() * 3);
      }
      ctx.globalAlpha = 0.25; ctx.fillStyle = 'rgba(40,20,10,0.6)';
      for (let k = 0; k < n * 0.6; k++) circle(bx + R() * bw, by + R() * bh, (0.012 + R() * 0.02) * c);
      ctx.globalAlpha = 1;
      ctx.restore();
      // cut the tunnels out
      const tp = tunnelPath(lv, lay);
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fill(tp); ctx.restore();
      // shade the rock beside the tunnels: a shadow under each ceiling, a lit lip on each floor
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.lineJoin = 'round';
      ctx.translate(0, -0.05 * c); ctx.strokeStyle = 'rgba(0,15,35,0.32)'; ctx.lineWidth = 0.2 * c; ctx.stroke(tp);
      ctx.translate(0, 0.09 * c); ctx.strokeStyle = 'rgba(255,255,240,0.32)'; ctx.lineWidth = 0.09 * c; ctx.stroke(tp);
      ctx.restore();
      // coral growing on the rock between the tunnels (clipped to the rock, so it never narrows a tunnel)
      ctx.save(); ctx.globalCompositeOperation = 'source-atop';
      const tips = th.tip, spots = [];
      for (let j = 0; j <= lv.H; j++) for (let i = 0; i <= lv.W; i++) spots.push([lay.x0 + i * c, lay.y0 + j * c]);
      for (let i = 0; i < lv.N; i++) {
        const x = cellX(lay, lv, i), y = cellY(lay, lv, i);
        if (!(lv.open[i] & 2) && lv.cx[i] < lv.W - 1) spots.push([x + c / 2, y]);
        if (!(lv.open[i] & 4) && lv.cy[i] < lv.H - 1) spots.push([x, y + c / 2]);
      }
      for (const [x, y] of spots) {
        const k = R(), col = tips[Math.floor(R() * tips.length)], sz = c / 70;
        if (k < 0.3) continue;   // bare rock here
        if (k < 0.44) { // tube coral: a few short tubes, dark at the mouth
          for (let q = -1; q <= 1; q++) {
            const tx = x + q * 0.075 * c, th2 = (0.1 + R() * 0.08) * c, tw = 0.055 * c;
            ctx.fillStyle = col; rrect(tx - tw / 2, y - th2 / 2, tw, th2, tw * 0.45); ctx.fill();
            ctx.fillStyle = 'rgba(40,10,30,0.45)'; oval(tx, y - th2 / 2 + tw * 0.25, tw * 0.32, tw * 0.18);
          }
        } else if (k < 0.58) { // a cluster of polyps
          for (let q = 0; q < 4; q++) { ctx.fillStyle = tips[(q + Math.floor(R() * 9)) % tips.length]; circle(x + (R() - 0.5) * 0.24 * c, y + (R() - 0.5) * 0.24 * c, (0.035 + R() * 0.04) * c); }
        } else if (k < 0.68) { // a little starfish
          ctx.fillStyle = col; star(x, y, 0.13 * c, 0.055 * c, 5, R() * 3); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; circle(x, y, 0.025 * c);
        } else if (k < 0.86) { // branch coral
          branchCoral(x, y + 0.12 * c, col, R, sz * 0.75, -Math.PI / 2 + (R() - 0.5) * 0.6);
        } else { // speckles
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          for (let q = 0; q < 5; q++) circle(x + (R() - 0.5) * 0.3 * c, y + (R() - 0.5) * 0.3 * c, 0.018 * c);
        }
      }
      ctx.restore();
      // coral and sea fans growing up off the top of the reef
      const room = clamp((by - 4) / 40, 0, 1);
      for (let x = bx + rim * 0.8; room > 0.3 && x < bx + bw - rim * 0.8; x += c * (0.55 + R() * 0.5)) {
        const col = tips[Math.floor(R() * tips.length)], sz = clamp(c / 90, 0.5, 0.95) * room, k = R();
        if (k < 0.45) fanCoral(x, by + 0.12 * c, col, R, sz * 0.9);
        else if (k < 0.85) branchCoral(x, by + 0.1 * c, col, R, sz);
        else { ctx.fillStyle = col; circle(x, by + 0.02 * c, 0.1 * c); }
      }
      // the way out: a ring of pearls round the mouth
      const ex = lay.seaX, ey = cellY(lay, lv, lv.exit), pr = lay.tunnel * 0.95;
      for (let k = 0; k <= 8; k++) {
        const a = -Math.PI / 2 - 0.25 + (k / 8) * (Math.PI + 0.5);
        drawPearl(ex - 0.22 * c - Math.cos(a) * 0.12 * c, ey + Math.sin(a) * pr, 0.06 * c + 1, 0);
      }
      // a little sea anemone where she starts
      const sx = cellX(lay, lv, lv.start), sy = cellY(lay, lv, lv.start) + lay.tunnel * 0.5;
      ctx.fillStyle = 'rgba(255,140,190,0.9)';
      for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.ellipse(sx + k * 0.06 * c, sy - 0.07 * c, 0.03 * c, 0.09 * c, k * 0.25, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#ff6fb0'; oval(sx, sy - 0.01 * c, 0.18 * c, 0.05 * c);
      // shade inside the tunnels: the water in the reef is a little deeper than outside
      ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = 'rgba(0,25,60,0.2)'; ctx.fill(tp); ctx.restore();
    } finally {
      ctx = main;
    }
    return cv;
  }
  function reefFor(lv, lay, th) {
    const key = lv.seed + ':' + lv.W + 'x' + lv.H + ':' + canvas.width + 'x' + canvas.height + ':' + lay.c.toFixed(3);
    if (!reefCache || reefCache.key !== key) reefCache = { key, cv: buildReef(lv, lay, th) };
    return reefCache.cv;
  }

  // ---------- things in the maze ----------
  // A current: a bright lane with chevrons and bubbles streaming the way it flows.
  function drawCurrent(lv, lay, cur, time) {
    const c = lay.c, w = lay.tunnel, d = cur.dir, dx = [0, 1, 0, -1][d], dy = [-1, 0, 1, 0][d];
    const first = cur.cells[0];
    const x0 = cellX(lay, lv, first) - dx * c * 0.5, y0 = cellY(lay, lv, first) - dy * c * 0.5;
    const len = cur.cells.length * c;
    ctx.save(); ctx.translate(x0, y0); ctx.rotate(Math.atan2(dy, dx));
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(160,240,255,0)'); g.addColorStop(0.15, 'rgba(160,240,255,0.28)'); g.addColorStop(0.85, 'rgba(160,240,255,0.28)'); g.addColorStop(1, 'rgba(160,240,255,0)');
    ctx.fillStyle = g; rrect(0, -w * 0.42, len, w * 0.84, w * 0.3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(2, c * 0.05); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const gap = c * 0.5, ph = (time * c * 1.6) % gap, cw = w * 0.2;
    for (let x = ph - gap; x < len; x += gap) {
      const a = clamp(Math.min(x / (c * 0.35), (len - x) / (c * 0.35)), 0, 1);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(x - cw, -cw * 1.2); ctx.lineTo(x, 0); ctx.lineTo(x - cw, cw * 1.2); ctx.stroke();
    }
    ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, c * 0.018);
    for (let k = 0; k < cur.cells.length * 3; k++) {
      const u = ((time * 0.9 + k * 0.37) % 1), x = u * len, yy = Math.sin(k * 2.1) * w * 0.3;
      ctx.beginPath(); ctx.arc(x, yy, c * (0.02 + (k % 3) * 0.01), 0, TAU); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // A coral gate across a tunnel: pink coral bars and a golden lock with its key's colour. `open` 0..1 plays
  // it opening (the bars sink into the rock); `pulse` makes the lock glow when she has the key.
  function drawGate(lv, lay, g, k, open, time, shake, pulse) {
    if (open >= 1) return;
    const c = lay.c, w = lay.tunnel, ax = cellX(lay, lv, g.a), ay = cellY(lay, lv, g.a), bx2 = cellX(lay, lv, g.b), by2 = cellY(lay, lv, g.b);
    const mx = (ax + bx2) / 2 + Math.sin(time * 50) * shake * c * 0.05, my = (ay + by2) / 2;
    const vertical = g.dir === 1 || g.dir === 3;   // the tunnel runs left-right, so the bars stand up
    ctx.save(); ctx.translate(mx, my); if (!vertical) ctx.rotate(Math.PI / 2);
    const u = smooth(clamp(open, 0, 1)), half = w * 0.55 * (1 - u);
    if (pulse) glow(0, 0, c * 0.75, KEY_GLOW[k], 0.4 + 0.3 * Math.sin(time * 5));
    ctx.lineCap = 'round';
    for (let q = -1; q <= 1; q++) {
      const x = q * c * 0.12, wob = Math.sin(time * 2 + q) * c * 0.01;
      ctx.strokeStyle = KEY_DARK[k]; ctx.lineWidth = c * 0.12;
      ctx.beginPath(); ctx.moveTo(x + wob, -half); ctx.lineTo(x - wob, half); ctx.stroke();
      ctx.strokeStyle = KEY_COLORS[k]; ctx.lineWidth = c * 0.07;
      ctx.beginPath(); ctx.moveTo(x + wob - c * 0.012, -half); ctx.lineTo(x - wob - c * 0.012, half); ctx.stroke();
      ctx.fillStyle = KEY_LIGHT[k];
      if (half > c * 0.05) for (let t = -2; t <= 2; t++) circle(x + c * 0.03 * (t % 2), (t / 2.5) * half, c * 0.02);
    }
    if (u < 0.5) {
      const ls = c * 0.17 * (1 - u * 2);
      ctx.fillStyle = '#ffc21a'; ctx.strokeStyle = '#a86a00'; ctx.lineWidth = c * 0.025;
      rrect(-ls, -ls * 1.1, ls * 2, ls * 2.2, ls * 0.45); ctx.fill(); ctx.stroke();
      ctx.fillStyle = KEY_COLORS[k]; heartPath(0, -ls * 0.35, ls * 0.55); ctx.fill();
      ctx.fillStyle = '#5a3a10'; circle(0, ls * 0.35, ls * 0.22); ctx.fillRect(-ls * 0.08, ls * 0.35, ls * 0.16, ls * 0.45);
    }
    ctx.restore();
  }
  // the light at the way out: warm rays streaming in from the open sea, and a pulsing glow at the mouth
  function drawExitLight(lv, lay, time, k) {
    const c = lay.c, ex = lay.seaX, ey = cellY(lay, lv, lv.exit), w = lay.tunnel;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const a = 0.22 + 0.12 * Math.sin(time * 1.3 + i * 1.7), spread = (i - 2) * w * 0.17;
      const g = ctx.createLinearGradient(ex + c * 1.2, 0, ex - c * 1.3, 0);
      g.addColorStop(0, 'rgba(255,240,170,0)'); g.addColorStop(0.45, `rgba(255,240,170,${a * k})`); g.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(ex + c * 1.2, ey + spread * 2.4 - w * 0.12); ctx.lineTo(ex + c * 1.2, ey + spread * 2.4 + w * 0.12);
      ctx.lineTo(ex - c * 1.3, ey + spread * 0.7 + w * 0.06); ctx.lineTo(ex - c * 1.3, ey + spread * 0.7 - w * 0.06); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    glow(ex, ey, c * (1.15 + 0.1 * Math.sin(time * 2.4)), 'rgba(255,225,120,0.85)', 0.75 * k);
    for (let i = 0; i < 4; i++) {
      const u = (time * 0.35 + i / 4) % 1, x = ex + c * 0.6 - u * c * 1.4, y = ey + Math.sin(time * 2 + i * 2) * w * 0.3;
      ctx.globalAlpha = Math.sin(Math.PI * u) * k;
      ctx.fillStyle = '#fff8c8'; star(x, y, c * 0.06, c * 0.022, 4, time * 2 + i); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // a shimmering trail along the next glide: a faint golden line with little pearls of light every third of a
  // cell, brightening one after another from Isabella outwards. While she should wait (a patrol in the way) it
  // only breathes softly; when it is time to go it sparkles.
  function drawTrail(pts, time, bright, c) {
    if (!pts || pts.length < 2) return;
    const k = 0.35 + 0.65 * bright;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,226,140,${0.1 + 0.12 * k})`; ctx.lineWidth = c * 0.2;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    ctx.restore();
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (let q = 1; q <= 3; q++, n++) {
        const u = q / 3, x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
        const wave = Math.max(0, Math.sin(time * 5 - n * 0.55)), on = bright ? 0.35 + 0.65 * wave : 0.25 + 0.2 * Math.sin(time * 2);
        glow(x, y, c * 0.2, 'rgba(255,236,160,0.9)', on * 0.7);
        ctx.globalAlpha = Math.min(1, 0.4 + on); ctx.fillStyle = '#fffbea';
        circle(x, y, c * (0.035 + 0.025 * on));
      }
    }
    const end = pts[pts.length - 1];
    ctx.globalAlpha = 0.5 + 0.5 * k; ctx.fillStyle = '#fff6c8';
    star(end.x, end.y, c * (0.13 + 0.03 * Math.sin(time * 4)), c * 0.05, 4, time);
    ctx.fill();
    ctx.globalAlpha = 1;
    glow(end.x, end.y, c * 0.45, 'rgba(255,220,120,0.9)', 0.25 + 0.35 * k);
  }
  // a pointing hand that shows a swipe from (x0, y0) toward (x1, y1) (adapted from Bubble Party's tapping hand)
  function drawSwipeHand(x0, y0, x1, y1, time, size) {
    const per = 1.6, u = (time % per) / per, m = smooth(clamp((u - 0.15) / 0.55, 0, 1)), fade = u < 0.1 ? u / 0.1 : u > 0.85 ? (1 - u) / 0.15 : 1;
    const x = lerp(x0, x1, m), y = lerp(y0, y1, m), k = size / 60;
    ctx.save(); ctx.globalAlpha = 0.55 * fade; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6 * k; ctx.lineCap = 'round'; ctx.setLineDash([2 * k, 14 * k]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.95 * fade;
    ctx.translate(x + 6 * k, y + 10 * k); ctx.rotate(-0.42); ctx.scale(k, k);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(20,60,110,0.8)'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    rrect(-17, 26, 36, 34, 12); ctx.fill(); ctx.stroke();
    rrect(-7, -2, 15, 42, 7.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-5, 27, 11, 8);
    ctx.strokeStyle = 'rgba(20,60,110,0.45)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(9, 36); ctx.lineTo(9, 46); ctx.moveTo(14, 37); ctx.lineTo(14, 46); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- dark water ----------
  // A small texture (one pixel per 6 units) laid over the screen and smoothed when scaled up: deep dark where she
  // has not been, half dark where she has (so she can find her way back), clear round her own light, clear over
  // the open sea, and a little light round the things that glow (the way out, keys, patrols).
  const FOG = 6;
  function drawFog(v, lay, lv, time) {
    const f = v.fog, fw = Math.ceil(VW / FOG) + 2, fh = Math.ceil(H / FOG) + 2;
    if (!fogCv || fogCv.width !== fw || fogCv.height !== fh) { fogCv = document.createElement('canvas'); fogCv.width = fw; fogCv.height = fh; fogCtx = fogCv.getContext('2d'); }
    if (!lightSprite) {
      lightSprite = document.createElement('canvas'); lightSprite.width = lightSprite.height = 64;
      const g = lightSprite.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.92)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    const g = fogCtx, c = lay.c / FOG;
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, fw, fh);
    g.fillStyle = 'rgba(3,8,26,0.94)'; g.fillRect(0, 0, fw, fh);
    g.globalCompositeOperation = 'destination-out';
    // the open sea beyond the reef stays bright
    const sx = (lay.seaX + lay.c * 0.1) / FOG, sg = g.createLinearGradient(sx - c * 0.6, 0, sx + c * 0.5, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = sg; g.fillRect(sx - c * 0.6, 0, fw, fh);
    // where she has been
    g.globalAlpha = 0.6;
    for (let i = 0; i < lv.N; i++) if (f.seen[i]) { const r = lay.c * 0.95 / FOG; g.drawImage(lightSprite, (lay.x0 + (lv.cx[i] + 0.5) * lay.c) / FOG - r, (lay.y0 + (lv.cy[i] + 0.5) * lay.c) / FOG - r, 2 * r, 2 * r); }
    g.globalAlpha = 1;
    // her own light, and glimmers round what glows
    const lit = (x, y, r, a) => { g.globalAlpha = a; g.drawImage(lightSprite, x / FOG - r / FOG, y / FOG - r / FOG, (2 * r) / FOG, (2 * r) / FOG); g.globalAlpha = 1; };
    lit(v.isa.x, v.isa.y, f.r * lay.c * (1 + 0.03 * Math.sin(time * 2)), 1);
    lit(cellX(lay, lv, lv.exit) + lay.c * 0.5, cellY(lay, lv, lv.exit), lay.c * 1.3, 0.9);
    for (const k of v.keysOnFloor) lit(k.x, k.y, lay.c * 0.75, 0.7);
    for (const p of v.patrols) lit(p.x, p.y, lay.c * 0.8, 0.55);
    ctx.save(); ctx.globalAlpha = clamp(f.alpha, 0, 1); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCv, 0, 0, fw * FOG, fh * FOG);
    ctx.restore();
  }

  // ---------- particles (from render.js and Shell Match) ----------
  function spawn(p) { if (parts.length < 650) parts.push(p); }
  const clearParticles = () => { parts.length = 0; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(type, x, y, size) {
    const k = size || 1;
    if (type === 'key') for (let i = 0; i < 26; i++) spawn({ t: 'spark', x, y, vx: rnd(-240, 240) * k, vy: rnd(-240, 180) * k, life: 0.9, max: 0.9, c: i % 2 ? '#ffe066' : '#fff', r: rnd(3, 7) * k });
    if (type === 'gate') {
      for (let i = 0; i < 18; i++) spawn({ t: 'bubble', x: x + rnd(-20, 20) * k, y: y + rnd(-25, 25) * k, vx: rnd(-50, 50), vy: rnd(-160, -60), life: 1.2, max: 1.2, r: rnd(3, 9) * k });
      for (let i = 0; i < 16; i++) spawn({ t: 'spark', x, y, vx: rnd(-220, 220) * k, vy: rnd(-220, 160) * k, life: 0.8, max: 0.8, c: i % 3 ? '#ffd1ea' : '#fff6a0', r: rnd(3, 6) * k });
    }
    if (type === 'bonk') for (let i = 0; i < 6; i++) spawn({ t: 'bubble', x: x + rnd(-8, 8), y: y + rnd(-8, 8), vx: rnd(-30, 30), vy: rnd(-90, -40), life: 0.7, max: 0.7, r: rnd(2, 5) * k });
    if (type === 'hit') for (let i = 0; i < 22; i++) spawn({ t: 'bubble', x: x + rnd(-30, 30) * k, y: y + rnd(-25, 25) * k, vx: rnd(-40, 40), vy: rnd(-150, -50), life: 1.3, max: 1.3, r: rnd(3, 10) * k });
    if (type === 'respawn') {
      for (let i = 0; i < 16; i++) spawn({ t: 'spark', x, y, vx: rnd(-180, 180) * k, vy: rnd(-200, 120) * k, life: 0.8, max: 0.8, c: i % 2 ? '#ffd1ea' : '#fff', r: rnd(3, 6) * k });
      for (let i = 0; i < 10; i++) spawn({ t: 'bubble', x: x + rnd(-20, 20) * k, y: y + rnd(-20, 20) * k, vx: rnd(-30, 30), vy: rnd(-120, -40), life: 1, max: 1, r: rnd(2, 6) * k });
    }
    if (type === 'shell') for (let i = 0; i < 18; i++) spawn({ t: 'spark', x, y: y - 10 * k, vx: rnd(-170, 170) * k, vy: rnd(-240, -30) * k, life: 0.9, max: 0.9, c: i % 2 ? '#ffb8e0' : '#fff', r: rnd(3, 6) * k });
    if (type === 'swish') for (let i = 0; i < 3; i++) spawn({ t: 'bubble', x: x + rnd(-6, 6), y: y + rnd(-6, 6), vx: rnd(-20, 20), vy: rnd(-70, -30), life: 0.9, max: 0.9, r: rnd(1.5, 3.5) * k });
    if (type === 'cheer') for (let i = 0; i < 8; i++) spawn({ t: i % 2 ? 'heart' : 'spark', x: x + rnd(-40, 40), y: y + rnd(-30, 10), vx: rnd(-60, 60), vy: rnd(-150, -70), life: 1.1, max: 1.1, c: '#fff6a0', r: rnd(5, 9) });
    if (type === 'notes') for (let i = 0; i < 4; i++) spawn({ t: 'note', x: x + rnd(-24, 24), y: y - 16, vx: rnd(-30, 30), vy: rnd(-95, -60), life: 1.4, max: 1.4, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], r: rnd(0.9, 1.3), ph: Math.random() * 6 });
  }
  // the treasure burst: coins and pearls leap out and bounce on the sand, with confetti
  function fountain(x, y, n, floor) {
    for (let i = 0; i < n; i++) {
      const pearl = i % 3 === 0;
      spawn({ t: pearl ? 'gpearl' : 'gcoin', x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 540, vy: -460 - Math.random() * 520, life: 3.2, max: 3.2, r: pearl ? 8 + Math.random() * 4 : 9 + Math.random() * 5, ph: Math.random() * 6, floor: floor || 528 });
    }
    for (let i = 0; i < n / 2; i++) spawn({ t: 'confetti', x: x + (Math.random() - 0.5) * 80, y: y - 20, vx: (Math.random() - 0.5) * 640, vy: -300 - Math.random() * 500, life: 3, max: 3, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], ph: Math.random() * 6 });
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.t === 'gcoin' || p.t === 'gpearl') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 8;
        if (p.y > p.floor) { p.y = p.floor; p.vy *= -0.45; p.vx *= 0.7; }
      } else if (p.t === 'confetti') {
        p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.5); p.vy = Math.min(p.vy, 120); p.x += p.vx * dt + Math.sin(p.ph) * 40 * dt; p.y += p.vy * dt; p.ph += dt * 6;
      } else if (p.t === 'note') {
        p.x += (p.vx + Math.sin(p.ph + p.life * 6) * 30) * dt; p.y += p.vy * dt;
      } else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-dt * 3); if (p.t !== 'bubble') p.vy *= Math.exp(-dt * 3); }
    }
  }
  function drawNote(x, y, sc, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    oval(0, 0, 5, 3.8, -0.4);
    ctx.beginPath(); ctx.moveTo(4.2, -1); ctx.lineTo(4.2, -17); ctx.quadraticCurveTo(6, -11, 11, -9); ctx.stroke();
    ctx.restore();
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.t === 'spark') { ctx.globalAlpha = a; ctx.fillStyle = p.c; star(p.x, p.y, p.r, p.r * 0.35, 4, p.life * 4); ctx.fill(); }
      else if (p.t === 'heart') { ctx.globalAlpha = a; ctx.fillStyle = '#ff4d8d'; heartPath(p.x, p.y, p.r); ctx.fill(); }
      else if (p.t === 'bubble') { ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); }
      else if (p.t === 'gcoin') { ctx.globalAlpha = Math.min(1, p.life * 2); drawCoin(p.x, p.y, p.ph, p.r); }
      else if (p.t === 'gpearl') { ctx.globalAlpha = Math.min(1, p.life * 2); drawPearl(p.x, p.y, p.r, 0); }
      else if (p.t === 'note') { ctx.globalAlpha = Math.min(1, a * 2); drawNote(p.x, p.y, p.r, p.c); }
      else if (p.t === 'confetti') { ctx.globalAlpha = Math.min(1, p.life); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph); ctx.fillStyle = p.c; ctx.fillRect(-5, -3, 10, 6); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- a frame of play ----------
  // v (from game.js): { lv, lay, items, gateOpen[], gateShake[], cp, isa{ x, y, tilt, flip, scale, swim, happy, alpha, bubble },
  //   patrols[{ x, y, kind, face, wobble, near, ph }], keysOnFloor[{ x, y, k }], hint{ pts, bright } | null,
  //   hand{ x0, y0, x1, y1, size } | null, fog{ seen, r, alpha } | null, chest{ open }, exitK, crown }
  function drawPlay(v, time, dt) {
    const lv = v.lv, lay = v.lay, th = THEMES[lv.theme % THEMES.length], c = lay.c;
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 14);
    drawBubbles(time, time * 14);
    drawSand(th, 524, lv.seed);
    // the open sea to the right: seaweed beside the chest
    const sx = lay.seaX;
    for (let i = 0; i < 3; i++) seaweed(sx + 18 + i * 13, 540, 70 + i * 26, time, i % 2 ? '#3fae6a' : '#2f8f5a', i, 5);
    seaweed(VW - 14, 540, 110, time, '#2f8f5a', 4, 5);
    for (let i = 0; i < 2; i++) seaweed(28 + i * 16, 540, 60 + i * 30, time, i % 2 ? '#3fae6a' : '#2f8f5a', i + 7, 5);
    drawChest(lay.chestX, lay.chestY, v.chest.open, time, lay.chestSc);
    // the reef, then what moves in it
    ctx.drawImage(reefFor(lv, lay, th), 0, 0, canvas.width, canvas.height, 0, 0, VW, H);
    for (const cur of lv.currents) drawCurrent(lv, lay, cur, time);
    drawExitLight(lv, lay, time, v.exitK == null ? 1 : v.exitK);
    lv.shells.forEach((cell, i) => drawShell(cellX(lay, lv, cell), cellY(lay, lv, cell) + lay.tunnel * 0.36, v.shellsOpen[i], time, c / 110));
    lv.gates.forEach((g, k) => drawGate(lv, lay, g, k, v.gateOpen[k], time, v.gateShake[k] || 0, v.items[k] === 1));
    for (const kf of v.keysOnFloor) {
      const y = kf.y + Math.sin(time * 2.4 + kf.k) * c * 0.06;
      glow(kf.x, y, c * 0.66, KEY_GLOW[kf.k], 0.6 + 0.3 * Math.sin(time * 4 + kf.k));
      drawKey(kf.x, y, Math.sin(time * 2 + kf.k) * 0.25 - 0.5, c / 85, KEY_COLORS[kf.k]);
      if (Math.random() < dt * 5) spawn({ t: 'spark', x: kf.x + (Math.random() - 0.5) * c * 0.7, y: y + (Math.random() - 0.5) * c * 0.6, vx: 0, vy: -16, life: 0.6, max: 0.6, c: '#fff8c0', r: c * 0.05 });
    }
    if (v.hint && !lv.dark) drawTrail(v.hint.pts, time, v.hint.bright, c);
    for (const p of v.patrols) {
      if (p.kind === 'puffer') drawPuffer(p.x, p.y, c / 70, time, p);
      else { if (th === THEMES[8] || lv.dark) glow(p.x, p.y, c * 0.8, 'rgba(160,255,250,0.6)', 0.6); drawJelly(p.x, p.y, c / 72, time, th, p); }
    }
    // Isabella: a happy glow when she has a key, and the key she carries bobbing beside her
    const I = v.isa;
    const drawHer = () => {
      if (I.alpha <= 0.02) return;
      if (v.carrying >= 0 || I.party) glow(I.x, I.y, c * (I.party ? 1.1 : 0.75), I.party ? 'rgba(255,220,90,0.55)' : KEY_GLOW[v.carrying], 0.45 * I.alpha);
      drawIsabellaCentered(I.x, I.y, time, { tilt: I.tilt, flip: I.flip, scale: I.scale, swim: I.swim, happy: I.happy, alpha: I.alpha, crown: v.crown });
    };
    if (!I.party) drawHer();
    if (I.bubble > 0) {
      // touched: she floats away inside a big soft bubble
      const b = I.bubble, r = c * (0.45 + 0.1 * Math.sin(time * 6));
      ctx.globalAlpha = Math.min(1, b * 3) * (b > 0.75 ? (1 - b) * 4 : 1);
      ctx.fillStyle = 'rgba(200,240,255,0.25)'; circle(I.bx, I.by, r);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(2, c * 0.04); ctx.beginPath(); ctx.arc(I.bx, I.by, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; circle(I.bx - r * 0.4, I.by - r * 0.45, r * 0.13);
      ctx.globalAlpha = 1;
    }
    drawParts();
    if (I.party) drawHer();
    if (v.fog) drawFog(v, lay, lv, time);
    if (v.fog) {
      // what glows still shows through the dark
      if (v.hint) drawTrail(v.hint.pts, time, v.hint.bright, c);
      glow(cellX(lay, lv, lv.exit) + c * 0.5, cellY(lay, lv, lv.exit), c * 0.9, 'rgba(255,225,120,0.8)', 0.4 + 0.15 * Math.sin(time * 2.4));
      for (const kf of v.keysOnFloor) glow(kf.x, kf.y, c * 0.45, KEY_GLOW[kf.k], 0.45 + 0.25 * Math.sin(time * 4 + kf.k));
      if (I.alpha > 0.02) glow(I.x, I.y, c * 0.5, 'rgba(255,240,210,0.6)', 0.25 * I.alpha);
    }
    if (v.hand) drawSwipeHand(v.hand.x0, v.hand.y0, v.hand.x1, v.hand.y1, time, v.hand.size);
    drawKeySlots(v, time);
    for (const kf of v.flyKeys) { glow(kf.x, kf.y, 40, KEY_GLOW[kf.k], 0.6); drawKey(kf.x, kf.y, -0.5, kf.sc, KEY_COLORS[kf.k]); }
  }
  // the keys she needs, under the home button: grey until found, gold while she carries it, gone once used
  function drawKeySlots(v, time) {
    const lv = v.lv;
    for (let k = 0; k < lv.keys.length; k++) {
      const x = 57, y = 158 + k * 70, st = v.items[k];
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.strokeStyle = st === 2 ? 'rgba(255,255,255,0.6)' : KEY_COLORS[k]; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 28, 0, TAU); ctx.fill(); ctx.stroke();
      if (st === 1 && v.flyKeys.some((kf) => kf.k === k)) continue;
      if (st === 1) { glow(x, y, 46, KEY_GLOW[k], 0.5 + 0.3 * Math.sin(time * 5)); drawKey(x + 3, y, -0.5, 0.78, KEY_COLORS[k]); }
      else if (st === 0) { ctx.globalAlpha = 0.35; drawKey(x + 3, y, -0.5, 0.78, KEY_COLORS[k]); ctx.globalAlpha = 1; }
      else { ctx.strokeStyle = KEY_COLORS[k]; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 11, y + 1); ctx.lineTo(x - 3, y + 9); ctx.lineTo(x + 12, y - 9); ctx.stroke(); }
    }
  }

  // ---------- the level select's backdrop: a reef along the bottom, Isabella swimming past ----------
  function drawMenu(time, dt, o) {
    const th = THEMES[(o && o.theme) || 0];
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 20);
    drawBubbles(time, time * 20);
    drawSand(th, 506, 3);
    const R = mulberry32(99);
    for (let x = -20; x < VW + 40; x += 46 + R() * 40) {
      const col = th.tip[Math.floor(R() * th.tip.length)], k = R();
      ctx.fillStyle = th.rock[R() < 0.5 ? 0 : 1]; oval(x, 520, 40 + R() * 26, 26 + R() * 18);
      if (k < 0.4) fanCoral(x, 500, col, R, 1.2);
      else if (k < 0.8) branchCoral(x, 504, col, R, 1.3);
      else seaweed(x, 520, 90 + R() * 50, time, '#2f8f5a', x, 6);
    }
    drawChest(VW - 92, 518, 0.18 + 0.12 * Math.sin(time * 2), time, 0.7);
    const span = VW - 300, ph = (time * 60) % (2 * span), fwd = ph < span, x = 150 + (fwd ? ph : 2 * span - ph);
    drawIsabella(x, 450 + Math.sin(time * 2) * 7, time, { scale: 0.78, flip: !fwd, swim: 8, crown: o && o.crown });
    drawParts();
  }

  window.MazeArt = {
    init, resize, toWorld, toCss, layout, cellX, cellY, drawPlay, drawMenu, burst, fountain, clearParticles,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get particles() { return parts.length; },
    THEMES, KEY_COLORS, ISA_LEN, H,
  };
})();
