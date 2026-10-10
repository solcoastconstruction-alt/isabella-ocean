/* Isabella the Mermaid — everything you see. All art is drawn in code. */
(function () {
  'use strict';
  const C = IsabellaCore;
  const { H, SAND, TAU, START_X } = C;
  const clamp = C.clamp, smooth = C.smooth;

  const THEMES = [
    { top: '#7fe3f0', bot: '#1f8fc0', far: 'rgba(28,118,170,0.55)', sand: ['#f9e4ab', '#e0bd78'], rock: ['#c99f78', '#a07b58', '#e2c29f'], tip: ['#ff8fab', '#ffd166', '#ff6b6b'], decor: 'coral', ray: 0.22, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#5fd0e0', bot: '#1777a8', far: 'rgba(25,100,150,0.55)', sand: ['#f6d9a8', '#d9b47a'], rock: ['#d99191', '#b06666', '#f0b8b8'], tip: ['#ff5d8f', '#ff9e6d', '#c77dff', '#ffd166'], decor: 'coral', ray: 0.2, jelly: ['#e0c3ff', '#a66bff'] },
    { top: '#5ccfb0', bot: '#0f6b5e', far: 'rgba(10,80,70,0.55)', sand: ['#e8d9a0', '#c4b06e'], rock: ['#7e9a76', '#5c7656', '#a5c09a'], tip: ['#b8f27c', '#ffd166', '#7cf2c8'], decor: 'kelp', ray: 0.18, jelly: ['#ffd0f0', '#ff8ad0'] },
    { top: '#62c6f2', bot: '#145ea8', far: 'rgba(15,70,130,0.5)', sand: ['#f3e0b0', '#d7bd86'], rock: ['#a7b0bd', '#7d8796', '#c9d0da'], tip: ['#ffd166', '#ff8fab', '#8ce99a'], decor: 'grass', ray: 0.2, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#4fb0c0', bot: '#0b4660', far: 'rgba(8,48,66,0.6)', sand: ['#d9c79a', '#b29f70'], rock: ['#8d735f', '#6b5545', '#b0957d'], tip: ['#ffb347', '#ff6b6b', '#8ce99a'], decor: 'ship', ray: 0.15, jelly: ['#ffe0a8', '#ffab4a'] },
    { top: '#8b7ee0', bot: '#2a2370', far: 'rgba(40,30,100,0.6)', sand: ['#d7c6e8', '#a996c4'], rock: ['#7a6aa8', '#5a4c85', '#a596d0'], tip: ['#ff7ad9', '#7afcff', '#ffd166'], decor: 'coral', ray: 0.12, jelly: ['#b8fff6', '#4de8d6'] },
    { top: '#86e0f5', bot: '#1f4f94', far: 'rgba(30,70,140,0.55)', sand: ['#e4f1fb', '#b8d3ea'], rock: ['#a9c6e8', '#7d9cc4', '#dcecff'], tip: ['#c2f0ff', '#ffffff', '#b9a7ff'], decor: 'crystal', ray: 0.2, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#f4a76a', bot: '#6d2747', far: 'rgba(90,30,50,0.6)', sand: ['#7a6262', '#4a3a3e'], rock: ['#5b3d3d', '#3d2828', '#8a5a50'], tip: ['#ff7b3a', '#ffd166', '#ff3d6e'], decor: 'vents', ray: 0.1, jelly: ['#fff1a8', '#ffc94a'] },
    { top: '#1d3d70', bot: '#050d26', far: 'rgba(10,25,60,0.7)', sand: ['#2a3550', '#1a2238'], rock: ['#2c4266', '#1d2d48', '#3f5e8c'], tip: ['#5cf2ff', '#ff5cf0', '#9dff5c'], decor: 'glow', ray: 0.05, jelly: ['#a8fff9', '#3de0ff'], glow: true },
    { top: '#9feaf8', bot: '#5b78e0', far: 'rgba(130,140,230,0.45)', sand: ['#fbe7f3', '#e7c4dd'], rock: ['#d9bdf2', '#b394d6', '#f1e0ff'], tip: ['#ff8fab', '#ffd166', '#8ce99a', '#7ad7ff', '#c77dff'], decor: 'palace', ray: 0.22, jelly: ['#ffc2ec', '#ff7ac8'] },
    // world 2
    { top: '#b4f3ee', bot: '#2b9fb8', far: 'rgba(40,140,170,0.5)', sand: ['#fff6e0', '#ecd5ab'], rock: ['#e8dccb', '#c7b5a0', '#fff6ea'], tip: ['#ffd1e8', '#ffffff', '#bff4ff'], decor: 'pearl', ray: 0.22, jelly: ['#ffd6f5', '#ff8fd8'] },
    { top: '#9ff0c8', bot: '#16846f', far: 'rgba(20,110,90,0.5)', sand: ['#efe6b0', '#d1c27c'], rock: ['#8fb38a', '#6a8f66', '#b9d8b3'], tip: ['#ffe066', '#ff9ec7', '#b8f27c'], decor: 'seahorse', ray: 0.2, jelly: ['#e0c3ff', '#a66bff'] },
    { top: '#8fe1ff', bot: '#2168b8', far: 'rgba(30,90,160,0.5)', sand: ['#ffd9a0', '#f0b874'], rock: ['#e0a982', '#bd8460', '#f3c9a8'], tip: ['#ff7b5c', '#ffd166', '#ff5d8f'], decor: 'starfish', ray: 0.22, jelly: ['#ffc2ec', '#ff7ac8'] },
    { top: '#4f86d6', bot: '#0e2a63', far: 'rgba(15,40,100,0.6)', sand: ['#c9d4e8', '#9aa9c8'], rock: ['#6c7fa8', '#4f6189', '#93a6cf'], tip: ['#9ad8ff', '#ffd166', '#c9a7ff'], decor: 'whale', ray: 0.12, jelly: ['#b8fff6', '#4de8d6'] },
    { top: '#5ec2b5', bot: '#0d4f5a', far: 'rgba(10,60,70,0.6)', sand: ['#e6d39e', '#bfa66c'], rock: ['#7d6553', '#5a4636', '#a68b74'], tip: ['#ffcc33', '#ff6b6b', '#8ce99a'], decor: 'ship', ray: 0.16, jelly: ['#ffe0a8', '#ffab4a'] },
    { top: '#2c3f8f', bot: '#0a1238', far: 'rgba(20,30,80,0.65)', sand: ['#4a5480', '#2e365c'], rock: ['#3c4a80', '#28325c', '#5a6aa8'], tip: ['#c8b6ff', '#7afcff', '#ff9ef0'], decor: 'moon', ray: 0.08, jelly: ['#e6d6ff', '#a78bfa'], glow: true, moon: true },
    { top: '#d4f6ff', bot: '#5aa0d8', far: 'rgba(120,170,220,0.5)', sand: ['#ffffff', '#d7ebf7'], rock: ['#cfe6f7', '#a3c4e0', '#ffffff'], tip: ['#bfefff', '#ffffff', '#d6c8ff'], decor: 'ice', ray: 0.24, jelly: ['#e8fbff', '#8fd8ff'] },
    { top: '#ff9a6b', bot: '#5a1530', far: 'rgba(100,20,40,0.6)', sand: ['#5e4446', '#3b2a2e'], rock: ['#4a2a2a', '#2e1a1a', '#7a4040'], tip: ['#ff5a1f', '#ffd166', '#ff2e63'], decor: 'vents', ray: 0.08, jelly: ['#fff1a8', '#ffc94a'] },
    { top: '#7d9a9e', bot: '#1f3439', far: 'rgba(30,50,55,0.65)', sand: ['#a8a58f', '#7b7866'], rock: ['#56656a', '#3d4a4e', '#7c8d92'], tip: ['#c6ff8a', '#ffe066', '#9ad8ff'], decor: 'storm', ray: 0.06, jelly: ['#d6ffe0', '#7de8a0'], storm: true },
    { top: '#c9a4ff', bot: '#3b1d7a', far: 'rgba(70,40,140,0.55)', sand: ['#ffe8a3', '#e8c56a'], rock: ['#b48be8', '#8a63c4', '#d9bfff'], tip: ['#ffd23f', '#ff8fd8', '#ffffff'], decor: 'castle', ray: 0.2, jelly: ['#ffd6f5', '#ff8fd8'] },
  ];
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38', GOLD = '#ffcc33';

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  let crown = false; // earned by finishing the last level
  const parts = [];
  let shake = 0, flash = 0;
  const amb = [];

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d');
    for (let i = 0; i < 40; i++) amb.push({ x: Math.random() * 2000, y: Math.random() * H, r: 1 + Math.random() * 3, sp: 10 + Math.random() * 30, ph: Math.random() * TAU });
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    s = canvas.height / H; VW = canvas.width / s;
  }
  function toWorld(clientX, clientY) { return { x: (clientX * dpr) / s, y: (clientY * dpr) / s }; }

  // ---------- helpers ----------
  const rngAt = (i, salt) => C.mulberry32((i * 7919 + salt * 104729) >>> 0);
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
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a == null ? 1 : a;
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
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function outlined(text, x, y, size, fill, stroke, align) {
    ctx.font = `900 ${size}px system-ui, Roboto, sans-serif`; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.22; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  // ---------- Isabella ----------
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

  // ---------- world pieces ----------
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
  function drawKey(x, y, time, sc) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(time * 2) * 0.25 - 0.5); ctx.scale(sc || 1, sc || 1);
    ctx.fillStyle = '#e8a200'; ctx.strokeStyle = '#a86a00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-16, 0, 12, 0, TAU); ctx.arc(-16, 0, 5.5, 0, TAU, true); ctx.fill('evenodd'); ctx.stroke();
    rrect(-5, -4, 32, 8, 3); ctx.fill(); ctx.stroke();
    ctx.fillRect(16, 3, 5, 9); ctx.strokeRect(16, 3, 5, 9);
    ctx.fillRect(23, 3, 4, 6); ctx.strokeRect(23, 3, 4, 6);
    ctx.fillStyle = 'rgba(255,250,200,0.9)';
    ctx.beginPath(); ctx.arc(-20, -5, 2.6, 0, TAU); ctx.fill();
    ctx.fillRect(-2, -2.5, 20, 2);
    // a heart gem in the bow
    ctx.fillStyle = '#ff4d8d'; heartPath(-16, 0, 3.4); ctx.fill();
    ctx.restore();
  }
  function drawChest(x, y, open, time, shakeX) {
    ctx.save(); ctx.translate(x + (shakeX || 0), y);
    if (open > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const bg = ctx.createLinearGradient(0, -20, 0, -320);
      bg.addColorStop(0, `rgba(255,230,120,${0.55 * open})`); bg.addColorStop(1, 'rgba(255,230,120,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(-50, -20); ctx.lineTo(50, -20); ctx.lineTo(120, -330); ctx.lineTo(-120, -330); ctx.closePath(); ctx.fill();
      ctx.restore();
      glow(0, -30, 140, 'rgba(255,220,90,0.8)', open);
    }
    // base box
    ctx.fillStyle = '#8b4a1c'; rrect(-60, -34, 120, 62, 8); ctx.fill();
    ctx.fillStyle = '#a65d27'; rrect(-56, -30, 112, 54, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(80,35,10,0.5)'; ctx.lineWidth = 2;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(-56, k * 14 - 3); ctx.lineTo(56, k * 14 - 3); ctx.stroke(); }
    ctx.fillStyle = GOLD;
    rrect(-62, -36, 12, 66, 3); ctx.fill(); rrect(50, -36, 12, 66, 3); ctx.fill();
    ctx.fillRect(-60, -36, 120, 7);
    // treasure inside when open
    if (open > 0.1) {
      for (let i = 0; i < 9; i++) drawCoin(-40 + i * 10, -38 - Math.sin(i * 1.3) * 5, time * 2 + i, 9);
    }
    // lid (hinged at the back)
    ctx.save(); ctx.translate(-60, -36); ctx.rotate(-open * 1.9);
    ctx.fillStyle = '#8b4a1c';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(120, 0); ctx.quadraticCurveTo(122, -38, 60, -42); ctx.quadraticCurveTo(-2, -38, 0, 0); ctx.fill();
    ctx.fillStyle = '#b8652b';
    ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(115, -3); ctx.quadraticCurveTo(116, -34, 60, -37); ctx.quadraticCurveTo(4, -34, 5, -3); ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.fillRect(-2, -6, 12, 8); ctx.fillRect(110, -6, 12, 8);
    ctx.beginPath(); ctx.moveTo(54, 0); ctx.lineTo(66, 0); ctx.lineTo(66, -41); ctx.lineTo(54, -41); ctx.fill();
    ctx.restore();
    // lock plate
    if (open < 0.05) {
      ctx.fillStyle = GOLD; rrect(-13, -40, 26, 28, 5); ctx.fill();
      ctx.fillStyle = '#5a3a10'; ctx.beginPath(); ctx.arc(0, -29, 4, 0, TAU); ctx.fill(); ctx.fillRect(-2, -29, 4, 10);
    }
    ctx.restore();
  }
  function drawShell(x, y, open, time) {
    ctx.save(); ctx.translate(x, y);
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
  function drawRock(o, th, top) {
    ctx.save();
    if (top) { ctx.translate(0, SAND); ctx.scale(1, -1); }
    const R = rngAt(Math.round(o.x), 3), w = o.w, x0 = o.x - w / 2, x1 = o.x + w / 2, ty = SAND - o.h;
    ctx.fillStyle = th.rock[0];
    ctx.beginPath();
    ctx.moveTo(x0 - 8, SAND + 60);
    for (let k = 1; k <= 4; k++) ctx.lineTo(x0 + (R() - 0.5) * 8, SAND - (o.h - 22) * (k / 4));
    ctx.quadraticCurveTo(x0 + 2, ty - 4, o.x, ty - 6);
    ctx.quadraticCurveTo(x1 - 2, ty - 4, x1 + (R() - 0.5) * 6, ty + 22);
    for (let k = 3; k >= 0; k--) ctx.lineTo(x1 + (R() - 0.5) * 8, SAND - (o.h - 22) * (k / 4));
    ctx.lineTo(x1 + 8, SAND + 60);
    ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = th.rock[1]; ctx.fillRect(o.x + w * 0.15, ty - 10, w, o.h + 80);
    ctx.fillStyle = th.rock[2];
    for (let k = 0; k < 5; k++) { ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(x0 + 10 + R() * (w - 20), ty + 20 + R() * (o.h - 30), 5 + R() * 6, 3 + R() * 4, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
    // coral tuft on the tip
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = th.tip[Math.floor(R() * th.tip.length)];
      ctx.beginPath(); ctx.arc(x0 + 12 + R() * (w - 24), ty - 2 + R() * 6, 6 + R() * 6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawUrchin(o, time) {
    ctx.save(); ctx.translate(o.x, o.y);
    ctx.strokeStyle = '#3a1460'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU + time * 0.4, l = o.r + 9 + Math.sin(time * 4 + k) * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * o.r * 0.6, Math.sin(a) * o.r * 0.6); ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l); ctx.stroke(); }
    const g = ctx.createRadialGradient(-6, -7, 2, 0, 0, o.r);
    g.addColorStop(0, '#9d5cd6'); g.addColorStop(1, '#4a1a7a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, o.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-6, -3, 4.5, 0, TAU); ctx.arc(6, -3, 4.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a0a2a'; ctx.beginPath(); ctx.arc(-5, -2, 2.3, 0, TAU); ctx.arc(7, -2, 2.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#1a0a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-11, -10); ctx.lineTo(-2, -7); ctx.moveTo(11, -10); ctx.lineTo(2, -7); ctx.stroke();
    ctx.restore();
  }
  function drawJelly(o, t, th, time) {
    const y = C.jellyY(o, t), x = o.x;
    if (th.glow) glow(x, y, 60, 'rgba(120,255,250,0.5)', 0.8);
    ctx.save(); ctx.translate(x, y);
    const pulse = 1 + Math.sin(time * 4 + o.ph) * 0.06;
    ctx.strokeStyle = th.jelly[1]; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.globalAlpha = 0.85;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(k * 7, 8);
      for (let j = 1; j <= 6; j++) ctx.lineTo(k * 7 + Math.sin(time * 5 + j * 0.9 + k) * 3.5, 8 + j * 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.92;
    const g = ctx.createRadialGradient(-6, -12, 2, 0, -4, 30);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, th.jelly[0]); g.addColorStop(1, th.jelly[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-26 * pulse, 8);
    ctx.bezierCurveTo(-28 * pulse, -30, 28 * pulse, -30, 26 * pulse, 8);
    for (let k = 4; k >= -4; k--) ctx.quadraticCurveTo((k + 0.5) * 6 * pulse, 13, k * 6 * pulse, 8);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3a1030'; ctx.beginPath(); ctx.arc(-7, -4, 2.6, 0, TAU); ctx.arc(7, -4, 2.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3a1030'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0.2, Math.PI - 0.2); ctx.stroke();
    // zap sparks
    if (Math.sin(time * 7 + o.ph * 3) > 0.7) {
      ctx.strokeStyle = '#fff59a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(22, -14); ctx.lineTo(30, -18); ctx.lineTo(27, -11); ctx.lineTo(35, -14); ctx.stroke();
    }
    ctx.restore();
  }
  function drawPuffer(o, t, time) {
    const r = C.pufferR(o, t), puff = (r - 18) / 28;
    ctx.save(); ctx.translate(o.x, o.y + Math.sin(time * 2 + o.ph * 6) * 3);
    ctx.strokeStyle = '#c47a00'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; const l = r + 2 + puff * 10; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85); ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l); ctx.stroke(); }
    ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.moveTo(r * 0.8, 0); ctx.lineTo(r + 14, -10); ctx.lineTo(r + 14, 10); ctx.closePath(); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r);
    g.addColorStop(0, '#fff3a0'); g.addColorStop(0.6, '#ffc93a'); g.addColorStop(1, '#f29a00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(0, r * 0.35, r * 0.6, r * 0.4, 0, 0, TAU); ctx.fill();
    for (const ex of [-r * 0.45, -r * 0.05]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, -r * 0.25, 4 + r * 0.08, 0, TAU); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(ex - 1, -r * 0.22, 2 + r * 0.04, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#c0395a'; ctx.beginPath(); ctx.ellipse(-r * 0.62, r * 0.12, 2.5 + puff * 2, 2 + puff * 3, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawCrab(o, t, time) {
    const x = C.crabX(o, t), y = SAND - 18, snap = Math.abs(Math.sin(time * 6));
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = '#c23a2b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) for (const d of [-1, 1]) {
      const kx = d * (10 + k * 7), wob = Math.sin(time * 14 + k + d) * 3;
      ctx.beginPath(); ctx.moveTo(kx * 0.7, 6); ctx.lineTo(kx + d * 6, 12 + wob * 0.3); ctx.lineTo(kx + d * 8, 20); ctx.stroke();
    }
    for (const d of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(d * 18, -2); ctx.lineTo(d * 28, -16); ctx.stroke();
      ctx.save(); ctx.translate(d * 30, -20); ctx.fillStyle = '#e8503f';
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff7a64'; ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(d * 12, -8 - snap * 4); ctx.lineTo(d * 6, -1); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#e8503f'; ctx.beginPath(); ctx.ellipse(0, 4, 24, 15, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff7a64'; ctx.beginPath(); ctx.ellipse(-5, -1, 12, 6, 0, 0, TAU); ctx.fill();
    for (const d of [-1, 1]) {
      ctx.strokeStyle = '#c23a2b'; ctx.beginPath(); ctx.moveTo(d * 6, -8); ctx.lineTo(d * 8, -18); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(d * 8, -20, 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(d * 8 + 1, -20, 2.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawEel(o, t, time) {
    ctx.fillStyle = 'rgba(20,10,10,0.75)'; ctx.beginPath(); ctx.ellipse(o.x, SAND + 3, 22, 7, 0, 0, TAU); ctx.fill();
    if (C.eelWarn(o, t)) {
      const b = Math.sin(time * 18) > 0 ? 1 : 0.4;
      glow(o.x, SAND - 2, 26, 'rgba(255,240,80,0.8)', b);
      ctx.fillStyle = `rgba(255,240,90,${b})`; ctx.beginPath(); ctx.arc(o.x - 6, SAND - 1, 2.5, 0, TAU); ctx.arc(o.x + 6, SAND - 1, 2.5, 0, TAU); ctx.fill();
    }
    const p = C.eelPts(o, t);
    if (p.length < 2) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 24; ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
    ctx.strokeStyle = '#8fd16a'; ctx.lineWidth = 12; ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q[0] + 4, q[1]) : ctx.moveTo(q[0] + 4, q[1]))); ctx.stroke();
    ctx.fillStyle = '#2f6e2b';
    for (let i = 1; i < p.length - 1; i += 2) { ctx.beginPath(); ctx.arc(p[i][0] - 5, p[i][1], 2.5, 0, TAU); ctx.fill(); }
    const h = p[p.length - 1];
    ctx.save(); ctx.translate(h[0], h[1]);
    ctx.fillStyle = '#3f8f3a'; ctx.beginPath(); ctx.ellipse(0, -4, 16, 19, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8fd16a'; ctx.beginPath(); ctx.ellipse(5, -2, 8, 13, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-4, -10, 5, 0, TAU); ctx.arc(7, -10, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-3, -10, 2.5, 0, TAU); ctx.arc(8, -10, 2.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5a1020'; ctx.beginPath(); ctx.ellipse(2, 3, 5, 3 + Math.abs(Math.sin(time * 8)) * 2, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawFish(o, t, cam, time) {
    const x = C.fishX(o, t);
    if (t >= o.t0 - 1.2 && x > cam + VW + 20) {
      // warning bubble on the right edge
      const p = 0.75 + 0.25 * Math.sin(time * 14), wx = cam + VW - 46;
      ctx.save(); ctx.translate(wx, o.y); ctx.scale(p, p);
      ctx.fillStyle = 'rgba(255,60,80,0.9)'; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke();
      outlined('!', 0, 2, 34, '#fff', 'rgba(150,0,30,0.6)');
      ctx.restore();
      return;
    }
    if (x < cam - 120 || x > cam + VW + 120) return;
    ctx.save(); ctx.translate(x, o.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(70, k * 12); ctx.lineTo(110 + Math.random() * 20, k * 12); ctx.stroke(); }
    const wag = Math.sin(time * 16) * 6;
    ctx.fillStyle = '#2f6fd6'; ctx.beginPath(); ctx.moveTo(34, 0); ctx.lineTo(62, -22 + wag); ctx.lineTo(56, 0); ctx.lineTo(62, 22 + wag); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(0, -26, 0, 26); g.addColorStop(0, '#4f8ff0'); g.addColorStop(1, '#a8d4ff');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(4, 0, 42, 26, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2f6fd6'; ctx.beginPath(); ctx.moveTo(-4, -24); ctx.lineTo(18, -40); ctx.lineTo(24, -22); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-20, -7, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-22, -6, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#123a80'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-30, -18); ctx.lineTo(-12, -14); ctx.stroke();
    ctx.fillStyle = '#123a80'; ctx.beginPath(); ctx.ellipse(-38, 6, 5, 4, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawMgate(o, t, th) {
    // a rock gate whose gap slides: draw full-height rocks and slide them, so they move rather than stretch
    const gy = C.mgateY(o, t), hTop = gy - o.g / 2, hBot = SAND - (gy + o.g / 2);
    const maxTop = o.y0 + o.amp - o.g / 2, maxBot = SAND - (o.y0 - o.amp + o.g / 2);
    ctx.save(); ctx.translate(0, hTop - maxTop); drawRock({ x: o.x, w: o.w, h: maxTop }, th, true); ctx.restore();
    ctx.save(); ctx.translate(0, maxBot - hBot); drawRock({ x: o.x, w: o.w, h: maxBot }, th, false); ctx.restore();
    // chevrons in the gap show which way it is sliding
    const dir = Math.cos(o.om * t + o.ph) * o.om >= 0 ? 1 : -1;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const k of [-1, 1]) {
      const cy = gy + k * 16;
      ctx.beginPath(); ctx.moveTo(o.x - 12, cy - dir * 6); ctx.lineTo(o.x, cy + dir * 6); ctx.lineTo(o.x + 12, cy - dir * 6); ctx.stroke();
    }
  }
  function drawWheel(o, t, time) {
    const pts = C.wheelPts(o, t), a = o.om * t + o.ph;
    ctx.strokeStyle = 'rgba(120,70,150,0.6)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (let arm = 0; arm < o.arms; arm++) {
      const ang = a + (arm * TAU) / o.arms;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(ang) * o.L, o.y + Math.sin(ang) * o.L); ctx.stroke();
    }
    for (let i = 1; i < pts.length; i++) drawUrchin({ x: pts[i][0], y: pts[i][1], r: 16 }, time + i);
    ctx.fillStyle = '#ff9ec7'; ctx.beginPath(); ctx.arc(o.x, o.y, 19, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#d6337a'; ctx.lineWidth = 2.5; ctx.beginPath();
    for (let k = 0; k < 40; k++) { const r = 2 + k * 0.4, an = a * 2 + k * 0.45; ctx.lineTo(o.x + Math.cos(an) * r, o.y + Math.sin(an) * r); }
    ctx.stroke();
  }
  function anchorShape(x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = '#4b5563'; ctx.fillStyle = '#4b5563'; ctx.lineCap = 'round';
    ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(0, 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-22, -34); ctx.lineTo(22, -34); ctx.stroke();
    ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, -6, 26, 0.25, Math.PI - 0.25); ctx.stroke();
    for (const d of [-1, 1]) {
      const ax = d * 26 * Math.cos(0.25), ay = -6 + 26 * Math.sin(0.25);
      ctx.beginPath(); ctx.moveTo(ax, ay - 2); ctx.lineTo(ax + d * 11, ay - 13); ctx.lineTo(ax - d * 3, ay - 14); ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -52, 7, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2, -40); ctx.lineTo(-2, 10); ctx.stroke();
    ctx.restore();
  }
  function drawAnchorHazard(o, t, time) {
    const y = C.anchorY(o, t);
    if (y < -40) {
      // peeking and jiggling at the top edge: it is about to come down
      if (C.anchorWarn(o, t)) anchorShape(o.x + Math.sin(time * 40) * 2, -14);
      return;
    }
    ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 4; ctx.setLineDash([9, 6]);
    ctx.beginPath(); ctx.moveTo(o.x, -10); ctx.lineTo(o.x, y - 58); ctx.stroke(); ctx.setLineDash([]);
    anchorShape(o.x, y);
  }
  function drawCurrent(o, time) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(o.x, 0, o.w, SAND);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const cx = o.x + 30 + (k / 8) * (o.w - 60);
      const base = (((time * o.f * o.dir + k * 97) % 470) + 470) % 470;
      for (let j = 0; j < 2; j++) {
        const yy = 40 + ((base + j * 235) % 470);
        ctx.beginPath(); ctx.moveTo(cx - 9, yy - o.dir * 8); ctx.lineTo(cx, yy); ctx.lineTo(cx + 9, yy - o.dir * 8); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawHeartPickup(h, time) {
    const y = h.y + Math.sin(time * 2.5 + h.x) * 8;
    glow(h.x, y, 50, 'rgba(255,120,170,0.6)', 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(h.x, y, 26, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff3d6e'; heartPath(h.x, y + 2, 13); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(h.x - 10, y - 10, 4, 0, TAU); ctx.fill();
  }

  // ---------- scenery ----------
  function drawBackground(th, cam, time, n) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.top); g.addColorStop(1, th.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, H);
    if (th.moon) {
      // the moon, wobbling through the surface
      glow(VW * 0.72, 30, 280, 'rgba(200,215,255,0.5)', 0.8);
      ctx.fillStyle = 'rgba(240,244,255,0.6)';
      ctx.beginPath(); ctx.ellipse(VW * 0.72, 34, 48 + Math.sin(time * 1.3) * 3, 44 - Math.sin(time * 1.3) * 3, 0, 0, TAU); ctx.fill();
    }
    // light rays
    if (th.ray > 0.06) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const rg = ctx.createLinearGradient(0, 0, 0, H);
      rg.addColorStop(0, `rgba(255,255,255,${th.ray})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      for (let i = 0; i < 6; i++) {
        const span = VW + 500, x = ((((i * 260 - cam * 0.08 + Math.sin(time * 0.3 + i) * 40) % span) + span) % span) - 250;
        const w = 40 + (i % 3) * 25;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w + 180, H); ctx.lineTo(x + 120, H); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // surface shimmer
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(0, 0);
    for (let x = 0; x <= VW + 20; x += 20) ctx.lineTo(x, 12 + Math.sin((x + cam * 0.3) / 40 + time * 2) * 4);
    ctx.lineTo(VW, 0); ctx.closePath(); ctx.fill();
    // far hills
    const fc = cam * 0.2;
    ctx.fillStyle = th.far;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= VW + 20; x += 20) { const u = x + fc; ctx.lineTo(x, 380 + 35 * Math.sin(u / 160) + 18 * Math.sin(u / 57 + 1)); }
    ctx.lineTo(VW, H); ctx.closePath(); ctx.fill();
    if (th.decor === 'palace') drawPalace(fc, ['#ffd6ec', '#d9d0ff', '#cff5ff', '#fff2c4'], RAINBOW);
    if (th.decor === 'ice') drawPalace(fc, ['#ffffff', '#e3f6ff', '#cfe9ff', '#eef4ff'], ['#bfe6ff', '#ffffff', '#d6c8ff']);
    if (th.decor === 'castle') drawPalace(fc, ['#e8d6ff', '#d3bdf7', '#f4e6ff', '#fff2c4'], ['#ffd23f', '#ff8fd8', '#ffd23f', '#ffffff']);
    if (th.decor === 'ship') drawWreck(fc, th);
    if (th.decor === 'whale') drawWhales(fc, time);
    if (th.storm) {
      // a gentle far-off lightning flicker every few seconds
      const ph = time % 9;
      if (ph < 0.07 || (ph > 0.15 && ph < 0.2)) { ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(0, 0, VW, H); }
    }
    // mid decor
    drawMidDecor(th, cam * 0.55, time);
    // ambient bubbles / plankton
    for (const a of amb) {
      const x = ((((a.x - cam * 0.7) % (VW + 40)) + VW + 40) % (VW + 40)) - 20;
      const y = ((((a.y - time * a.sp) % H) + H) % H);
      if (th.glow) { glow(x, y, a.r * 5, 'rgba(120,255,240,0.7)', 0.6); continue; }
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x + Math.sin(time + a.ph) * 4, y, a.r, 0, TAU); ctx.stroke();
    }
  }
  function drawPalace(fc, cols, roofs) {
    const tile = 1400;
    for (let i = Math.floor(fc / tile) - 1; i <= Math.floor((fc + VW) / tile) + 1; i++) {
      const R = rngAt(i, 9), bx = i * tile + 300 + R() * 500 - fc;
      for (let k = 0; k < 5; k++) {
        const tx = bx + k * 46, th2 = 120 + (k === 2 ? 90 : R() * 60);
        ctx.fillStyle = cols[k % 4]; ctx.globalAlpha = 0.55;
        ctx.fillRect(tx, 420 - th2, 36, th2 + 40);
        ctx.fillStyle = roofs[(k * 2 + i) % roofs.length];
        ctx.beginPath(); ctx.moveTo(tx - 6, 420 - th2); ctx.lineTo(tx + 18, 420 - th2 - 50); ctx.lineTo(tx + 42, 420 - th2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  function drawWreck(fc, th) {
    const tile = 1600;
    for (let i = Math.floor(fc / tile) - 1; i <= Math.floor((fc + VW) / tile) + 1; i++) {
      const R = rngAt(i, 11), bx = i * tile + 200 + R() * 600 - fc;
      ctx.fillStyle = 'rgba(30,40,40,0.45)';
      ctx.beginPath(); ctx.moveTo(bx, 430); ctx.lineTo(bx + 320, 400); ctx.lineTo(bx + 290, 470); ctx.lineTo(bx + 30, 480); ctx.closePath(); ctx.fill();
      ctx.fillRect(bx + 150, 230, 10, 190);
      ctx.beginPath(); ctx.moveTo(bx + 160, 250); ctx.lineTo(bx + 240, 300); ctx.lineTo(bx + 160, 330); ctx.fill();
    }
  }
  function drawWhales(fc, time) {
    const tile = 1500;
    for (let i = Math.floor(fc / tile) - 1; i <= Math.floor((fc + VW) / tile) + 1; i++) {
      const R = rngAt(i, 13), bx = i * tile + 200 + R() * 700 - fc + Math.sin(time * 0.15 + i) * 40, by = 140 + R() * 120, sc = 0.8 + R() * 0.5;
      ctx.save(); ctx.translate(bx, by); ctx.scale(sc, sc);
      ctx.fillStyle = 'rgba(20,45,100,0.45)';
      ctx.beginPath(); ctx.ellipse(0, 0, 150, 42, 0, 0, TAU); ctx.fill();
      const f = Math.sin(time * 0.8 + i) * 10;
      ctx.beginPath(); ctx.moveTo(-140, 0); ctx.quadraticCurveTo(-180, -10 + f, -215, -35 + f); ctx.quadraticCurveTo(-195, f, -215, 30 + f); ctx.quadraticCurveTo(-180, 10 + f, -140, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(20, 30, 40, 10, 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(200,220,255,0.35)'; ctx.beginPath(); ctx.arc(110, 4, 5, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  function drawMidDecor(th, mc, time) {
    const tile = 240;
    for (let i = Math.floor(mc / tile) - 1; i <= Math.floor((mc + VW) / tile) + 1; i++) {
      const R = rngAt(i, 5), x = i * tile + R() * 160 - mc, kind = R();
      ctx.globalAlpha = 0.7;
      switch (th.decor) {
        case 'coral': kind < 0.5 ? branchCoral(x, 470, th.tip[Math.floor(R() * th.tip.length)], R) : fanCoral(x, 470, th.tip[Math.floor(R() * th.tip.length)], R); break;
        case 'kelp': kelp(x, 480, 240 + R() * 160, time, i, '#2f8f5a'); kelp(x + 50, 480, 180 + R() * 120, time, i + 3, '#3fae6a'); break;
        case 'grass': grass(x, 485, time, '#3e9f6a', R); if (kind < 0.25) turtle(x + 60, 160 + R() * 120, time + i); break;
        case 'ship': kind < 0.5 ? barrel(x, 470) : anchor(x, 470); grass(x + 80, 485, time, '#4a7f5a', R); break;
        case 'crystal': crystals(x, 480, R, ['#c2f0ff', '#e0d4ff', '#ffffff']); break;
        case 'vents': vent(x, 480, time, i); break;
        case 'glow': glowPlant(x, 480, time, i, th.tip[Math.floor(R() * th.tip.length)], R); break;
        case 'palace': kind < 0.5 ? branchCoral(x, 470, RAINBOW[i % RAINBOW.length], R) : fanCoral(x, 470, RAINBOW[(i + 3) % RAINBOW.length], R); break;
        case 'pearl': kind < 0.45 ? clam(x, 478, time, i) : branchCoral(x, 470, th.tip[Math.floor(R() * th.tip.length)], R); break;
        case 'seahorse': grass(x, 485, time, '#3fae7a', R); if (kind < 0.45) seahorse(x + 70, 230 + R() * 140, time + i, th.tip[i % th.tip.length]); break;
        case 'starfish': kind < 0.5 ? fanCoral(x, 470, th.tip[Math.floor(R() * th.tip.length)], R) : rockStar(x, 470, R, th.tip[Math.floor(R() * th.tip.length)]); break;
        case 'whale': kelp(x, 480, 200 + R() * 150, time, i, '#2a6f8f'); break;
        case 'moon': glowPlant(x, 480, time, i, th.tip[Math.floor(R() * th.tip.length)], R); break;
        case 'ice': crystals(x, 480, R, ['#ffffff', '#d9f2ff', '#c8d8ff']); break;
        case 'storm': kelp(x, 480, 230 + R() * 160, time * 1.7, i, '#3d5f55'); break;
        case 'castle': kind < 0.4 ? coinPile(x, 486, time) : branchCoral(x, 470, th.tip[Math.floor(R() * th.tip.length)], R); break;
      }
      ctx.globalAlpha = 1;
    }
  }
  function clam(x, y, time, i) {
    const open = 0.35 + 0.25 * Math.sin(time * 0.8 + i);
    ctx.fillStyle = '#d9b8e8'; ctx.beginPath(); ctx.ellipse(x, y, 34, 12, 0, 0, Math.PI); ctx.fill();
    glow(x, y - 10, 34, 'rgba(255,255,255,0.8)', 0.6);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y - 8, 9, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(x - 32, y); ctx.rotate(-open); ctx.fillStyle = '#ead0f5';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(32, -44, 64, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(160,110,190,0.6)'; ctx.lineWidth = 1.5;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(32, -2); ctx.lineTo(32 + k * 9, -22 + Math.abs(k) * 4); ctx.stroke(); }
    ctx.restore();
  }
  function seahorse(x, y, time, col) {
    ctx.save(); ctx.translate(x, y + Math.sin(time * 1.5) * 10);
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 22, 0.15, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -26, 10, 0, TAU); ctx.fill();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(10, -26); ctx.lineTo(24, -22); ctx.stroke();
    ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-2, 18); ctx.quadraticCurveTo(-6, 38, 6, 40); ctx.quadraticCurveTo(14, 40, 10, 32); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(-12, -2, 6, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(6, -28, 2.2, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function rockStar(x, y, R, col) {
    ctx.fillStyle = 'rgba(160,110,80,0.6)'; ctx.beginPath(); ctx.ellipse(x, y + 10, 48, 26, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = col; star(x + (R() - 0.5) * 30, y - 6, 20, 8, 5, R() * 3); ctx.fill();
  }
  function coinPile(x, y, time) {
    ctx.fillStyle = '#e8a200'; ctx.beginPath(); ctx.ellipse(x, y, 46, 18, 0, Math.PI, 0); ctx.fill();
    for (let k = 0; k < 6; k++) drawCoin(x - 30 + k * 12, y - 10 - (k % 2) * 8, time * 2 + k, 8);
  }
  function branchCoral(x, y, col, R) {
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    const br = (bx, by, len, a, d) => {
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      ctx.lineWidth = 3 + d * 3; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
      if (d > 0) { br(ex, ey, len * 0.75, a - 0.5 - R() * 0.2, d - 1); br(ex, ey, len * 0.75, a + 0.5 + R() * 0.2, d - 1); }
    };
    br(x, y, 40 + R() * 20, -Math.PI / 2, 3);
  }
  function fanCoral(x, y, col, R) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y - 40, 40 + R() * 15, 45, 0, Math.PI, 0); ctx.lineTo(x + 5, y); ctx.lineTo(x - 5, y); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + k * 13, y - 80 + Math.abs(k) * 6); ctx.stroke(); }
  }
  function kelp(x, y, h, time, i, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 1; k <= 8; k++) ctx.lineTo(x + Math.sin(time * 1.2 + k * 0.6 + i) * k * 2.2, y - (h * k) / 8);
    ctx.stroke();
    ctx.fillStyle = col;
    for (let k = 2; k <= 8; k += 2) { const lx = x + Math.sin(time * 1.2 + k * 0.6 + i) * k * 2.2, ly = y - (h * k) / 8; ctx.beginPath(); ctx.ellipse(lx + (k % 4 ? 10 : -10), ly, 12, 5, k % 4 ? 0.5 : -0.5, 0, TAU); ctx.fill(); }
  }
  function grass(x, y, time, col, R) {
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) { const h = 40 + R() * 50, bx = x + k * 7; ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx + Math.sin(time * 1.5 + k) * 10, y - h * 0.6, bx + Math.sin(time * 1.5 + k + 1) * 14, y - h); ctx.stroke(); }
  }
  function turtle(x, y, time) {
    ctx.save(); ctx.translate(x + Math.sin(time * 0.4) * 20, y);
    ctx.fillStyle = 'rgba(40,110,80,0.6)';
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 20, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(38, -3, 10, 0, TAU); ctx.fill();
    const f = Math.sin(time * 3) * 0.4;
    ctx.save(); ctx.rotate(f); ctx.beginPath(); ctx.ellipse(10, 18, 18, 6, 0.6, 0, TAU); ctx.fill(); ctx.restore();
    ctx.restore();
  }
  function barrel(x, y) {
    ctx.fillStyle = 'rgba(110,70,40,0.75)'; rrect(x - 22, y - 46, 44, 50, 10); ctx.fill();
    ctx.fillStyle = 'rgba(60,40,25,0.7)'; ctx.fillRect(x - 22, y - 36, 44, 5); ctx.fillRect(x - 22, y - 14, 44, 5);
  }
  function anchor(x, y) {
    ctx.strokeStyle = 'rgba(60,60,70,0.75)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - 90); ctx.lineTo(x, y); ctx.moveTo(x - 20, y - 70); ctx.lineTo(x + 20, y - 70); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 30, 30, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 98, 8, 0, TAU); ctx.stroke();
  }
  function crystals(x, y, R, cols) {
    for (let k = 0; k < 4; k++) {
      const h = 40 + R() * 70, w = 12 + R() * 10, a = (R() - 0.5) * 0.6, bx = x + k * 16;
      ctx.save(); ctx.translate(bx, y); ctx.rotate(a);
      ctx.fillStyle = cols[k % cols.length];
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h); ctx.lineTo(0, -h - w); ctx.lineTo(w / 2, -h); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-w / 2 + 2, -h, 3, h);
      ctx.restore();
    }
  }
  function vent(x, y, time, i) {
    ctx.fillStyle = 'rgba(50,30,30,0.85)';
    ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 10, y - 90); ctx.lineTo(x + 10, y - 90); ctx.lineTo(x + 26, y); ctx.fill();
    glow(x, y - 92, 30, 'rgba(255,120,40,0.9)', 0.8);
    for (let k = 0; k < 5; k++) {
      const p = (time * 0.5 + k / 5 + i * 0.13) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - p)})`;
      ctx.beginPath(); ctx.arc(x + Math.sin(p * 9 + k) * 10, y - 95 - p * 280, 3 + p * 6, 0, TAU); ctx.fill();
    }
  }
  function glowPlant(x, y, time, i, col, R) {
    for (let k = 0; k < 3; k++) {
      const h = 60 + R() * 90, bx = x + k * 22, sway = Math.sin(time * 1.3 + i + k) * 8;
      ctx.strokeStyle = 'rgba(80,120,160,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx, y - h / 2, bx + sway, y - h); ctx.stroke();
      glow(bx + sway, y - h, 22, col, 0.6 + 0.4 * Math.sin(time * 2 + k + i));
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx + sway, y - h, 5, 0, TAU); ctx.fill();
    }
  }
  function drawSand(th, cam, time) {
    const g = ctx.createLinearGradient(0, SAND - 10, 0, H);
    g.addColorStop(0, th.sand[0]); g.addColorStop(1, th.sand[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-10, H);
    for (let x = -10; x <= VW + 20; x += 16) { const u = x + cam; ctx.lineTo(x, SAND - 4 + 5 * Math.sin(u / 90) + 3 * Math.sin(u / 37)); }
    ctx.lineTo(VW + 20, H); ctx.closePath(); ctx.fill();
    const tile = 170;
    for (let i = Math.floor(cam / tile) - 1; i <= Math.floor((cam + VW) / tile) + 1; i++) {
      const R = rngAt(i, 7), x = i * tile + R() * 120 - cam, y = SAND + 14 + R() * 18, k = R();
      if (k < 0.3) { ctx.fillStyle = '#ff8a5c'; star(x, y, 9, 4, 5, R() * 3); ctx.fill(); }
      else if (k < 0.55) { ctx.fillStyle = '#fff0e0'; ctx.beginPath(); ctx.ellipse(x, y, 8, 6, 0, Math.PI, 0); ctx.fill(); }
      else if (k < 0.8) { ctx.fillStyle = 'rgba(0,0,0,0.15)'; for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.ellipse(x + j * 9, y + (j % 2) * 3, 5, 3.5, 0, 0, TAU); ctx.fill(); } }
    }
  }

  // ---------- particles ----------
  function spawn(p) { if (parts.length < 700) parts.push(p); }
  function burst(type, x, y) {
    const rnd = (a, b) => a + Math.random() * (b - a);
    if (type === 'coin') for (let i = 0; i < 7; i++) spawn({ t: 'spark', x, y, vx: rnd(-140, 140), vy: rnd(-160, 60), life: 0.45, max: 0.45, c: '#fff6a0', r: rnd(3, 6) });
    if (type === 'key') for (let i = 0; i < 30; i++) spawn({ t: 'spark', x, y, vx: rnd(-260, 260), vy: rnd(-260, 200), life: 0.9, max: 0.9, c: i % 2 ? '#ffe066' : '#fff', r: rnd(4, 8) });
    if (type === 'hit') { shake = 0.3; for (let i = 0; i < 8; i++) spawn({ t: 'spark', x, y, vx: rnd(-200, 200), vy: rnd(-200, 200), life: 0.5, max: 0.5, c: '#ffffff', r: rnd(4, 7) }); }
    if (type === 'heart') for (let i = 0; i < 8; i++) spawn({ t: 'heart', x: x + rnd(-20, 20), y, vx: rnd(-40, 40), vy: rnd(-160, -80), life: 1, max: 1, r: rnd(6, 10) });
    if (type === 'checkpoint') for (let i = 0; i < 24; i++) spawn({ t: 'spark', x, y: y - 20, vx: rnd(-200, 200), vy: rnd(-300, -40), life: 1, max: 1, c: i % 2 ? '#ffb8e0' : '#fff', r: rnd(3, 7) });
    if (type === 'lost' || type === 'respawn') { for (let i = 0; i < 26; i++) spawn({ t: 'bubble', x: x + rnd(-40, 40), y: y + rnd(-30, 30), vx: rnd(-30, 30), vy: rnd(-160, -60), life: 1.4, max: 1.4, r: rnd(4, 12) }); if (type === 'respawn') flash = 0.5; }
    if (type === 'keyback') for (let i = 0; i < 14; i++) spawn({ t: 'bubble', x: x + rnd(-30, 30), y: y + rnd(-30, 30), vx: rnd(-20, 20), vy: rnd(-90, -30), life: 1, max: 1, r: rnd(3, 9) });
    if (type === 'locked') shake = 0.25;
  }
  function fountain(x, y, n) {
    for (let i = 0; i < n; i++) spawn({ t: 'gcoin', x: x + (Math.random() - 0.5) * 60, y, vx: (Math.random() - 0.5) * 520, vy: -480 - Math.random() * 520, life: 3.2, max: 3.2, r: 9 + Math.random() * 5, ph: Math.random() * 6 });
    for (let i = 0; i < n / 2; i++) spawn({ t: 'confetti', x: x + (Math.random() - 0.5) * 80, y: y - 20, vx: (Math.random() - 0.5) * 600, vy: -300 - Math.random() * 500, life: 3, max: 3, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], ph: Math.random() * 6 });
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.t === 'gcoin') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 8;
        if (p.y > SAND + 8) { p.y = SAND + 8; p.vy *= -0.45; p.vx *= 0.7; }
      } else if (p.t === 'confetti') {
        p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.5); p.vy = Math.min(p.vy, 120); p.x += p.vx * dt + Math.sin(p.ph) * 40 * dt; p.y += p.vy * dt; p.ph += dt * 6;
      } else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-dt * 3); if (p.t !== 'bubble') p.vy *= Math.exp(-dt * 3); }
    }
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.t === 'spark') { ctx.globalAlpha = a; ctx.fillStyle = p.c; star(p.x, p.y, p.r, p.r * 0.35, 4, p.life * 4); ctx.fill(); }
      else if (p.t === 'heart') { ctx.globalAlpha = a; ctx.fillStyle = '#ff4d8d'; heartPath(p.x, p.y, p.r); ctx.fill(); }
      else if (p.t === 'bubble') { ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); }
      else if (p.t === 'gcoin') { ctx.globalAlpha = Math.min(1, p.life * 2); drawCoin(p.x, p.y, p.ph, p.r); }
      else if (p.t === 'confetti') { ctx.globalAlpha = Math.min(1, p.life); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph); ctx.fillStyle = p.c; ctx.fillRect(-5, -3, 10, 6); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- frames ----------
  let tailBubbleT = 0;
  function drawGame(g, dt, time, extra) {
    const th = THEMES[(g.n - 1) % THEMES.length], cam = g.cam, t = g.t;
    stepParts(dt);
    if (shake > 0) shake -= dt;
    const sh = shake > 0 ? Math.sin(time * 90) * 6 * (shake / 0.3) : 0;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawBackground(th, cam, time, g.n);
    ctx.setTransform(s, 0, 0, s, -cam * s + sh * s, 0);

    const lv = g.lev, L = cam - 150, Rr = cam + VW + 150;
    lv.cps.forEach((c, i) => { if (c.x > L && c.x < Rr) drawShell(c.x, SAND - 4, g.cp >= i, time); });
    for (const o of lv.obs) if (o.k === 'current' && o.x1 > L && o.x0 < Rr) drawCurrent(o, time);
    ctx.setTransform(s, 0, 0, s, sh * s, 0);
    drawSand(th, cam, time);
    ctx.setTransform(s, 0, 0, s, -cam * s + sh * s, 0);

    for (let i = 0; i < lv.coins.length; i++) {
      if (g.got[i]) continue;
      const x = g.cx[i]; if (x < L || x > Rr) continue;
      drawCoin(x, g.cy[i] + Math.sin(time * 2 + i) * 3, time * 3 + i * 0.4);
    }
    lv.hearts.forEach((h, i) => { if (!g.heartGot[i] && h.x > L && h.x < Rr) drawHeartPickup(h, time); });
    if (!g.hasKey && g.keyX > L && g.keyX < Rr) {
      const ky = g.keyY + Math.sin(time * 2.4) * 6;
      glow(g.keyX, ky, 70, 'rgba(255,220,80,0.9)', 0.7 + 0.3 * Math.sin(time * 4));
      drawKey(g.keyX, ky, time, 1.25);
      if (Math.random() < dt * 8) spawn({ t: 'spark', x: g.keyX + (Math.random() - 0.5) * 60, y: ky + (Math.random() - 0.5) * 60, vx: 0, vy: -20, life: 0.6, max: 0.6, c: '#fff8c0', r: 4 });
    }
    for (const o of lv.obs) {
      if (o.k === 'fish') { drawFish(o, t, cam, time); continue; }
      if (o.k === 'current' || o.x1 < L || o.x0 > Rr) continue;
      if (o.k === 'rock') drawRock(o, th, o.top);
      else if (o.k === 'urchin') drawUrchin(o, time);
      else if (o.k === 'jelly') drawJelly(o, t, th, time);
      else if (o.k === 'puffer') drawPuffer(o, t, time);
      else if (o.k === 'crab') drawCrab(o, t, time);
      else if (o.k === 'eel') drawEel(o, t, time);
      else if (o.k === 'mgate') drawMgate(o, t, th);
      else if (o.k === 'wheel') drawWheel(o, t, time);
      else if (o.k === 'anchor') drawAnchorHazard(o, t, time);
    }
    // treasure chest
    if (lv.chestX > L && lv.chestX < Rr + 200) {
      const open = g.state === 'win' ? smooth(clamp((g.st - 0.25) / 0.6, 0, 1)) : 0;
      if (g.state !== 'win' && g.hasKey) glow(lv.chestX, SAND - 30, 110, 'rgba(255,220,90,0.7)', 0.5 + 0.3 * Math.sin(time * 4));
      drawChest(lv.chestX, SAND - 4, open, time, extra && extra.lockedShake ? Math.sin(time * 60) * 4 : 0);
    }

    // Isabella
    const wx = cam + g.sx;
    let opts = { tilt: clamp(g.vy / 900, -0.45, 0.45), swim: 6 + Math.min(6, Math.hypot(g.vx, g.vy) / 60) };
    if (g.state === 'lost') opts = { tilt: g.st * 9, scale: 0.92 * Math.max(0.2, 1 - g.st * 0.5), alpha: Math.max(0, 1 - g.st * 0.6) };
    if (g.state === 'win') opts = { tilt: g.st < 2.2 ? Math.sin(g.st * 5) * 0.3 : 0, happy: true, swim: 10 };
    opts.crown = crown;
    if (g.inv > 0 && g.state === 'play' && Math.floor(time * 12) % 2 === 0) opts.alpha = 0.35;
    if (g.hasKey && g.state === 'play') glow(wx + 10, g.y, 50, 'rgba(255,220,90,0.5)', 0.5);
    drawIsabella(wx, g.y + (g.state === 'win' ? Math.sin(time * 4) * 10 : 0), time, opts);
    if (g.hasKey && g.state === 'play') drawKey(wx + 6, g.y + 26, time, 0.6);
    tailBubbleT -= dt;
    if (tailBubbleT < 0 && g.state === 'play') { tailBubbleT = 0.28; spawn({ t: 'bubble', x: wx + 40, y: g.y - 20, vx: 10, vy: -70, life: 1.1, max: 1.1, r: 2 + Math.random() * 3 }); }
    drawParts();

    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (g.state === 'win') {
      const k = clamp(g.st / 0.4, 0, 1), bounce = 1 + Math.sin(time * 6) * 0.05;
      ctx.save(); ctx.translate(VW / 2, 150); ctx.scale(k * bounce, k * bounce);
      const msg = g.n === C.LEVELS.length ? 'QUEEN OF THE SEA!' : 'TREASURE!';
      ctx.font = '900 92px system-ui, Roboto, sans-serif';
      const fit = Math.min(92, (92 * VW * 0.9) / ctx.measureText(msg).width);
      outlined(msg, 0, 0, fit, '#ffe066', '#b35c00');
      ctx.restore();
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, VW, H); flash -= dt; }
    if (g.state === 'lost') { ctx.fillStyle = `rgba(255,255,255,${clamp(g.st - 0.8, 0, 0.8)})`; ctx.fillRect(0, 0, VW, H); }
  }

  function drawHUD(g, time, showHand) {
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const m = Math.max(48, VW * 0.045), y = 42;
    for (let i = 0; i < 3; i++) {
      const x = m + i * 46, full = i < g.hearts;
      ctx.fillStyle = full ? '#ff3d6e' : 'rgba(255,255,255,0.3)';
      ctx.strokeStyle = full ? '#fff' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
      heartPath(x, y + 2, 15); ctx.fill(); ctx.stroke();
    }
    // key slot
    const kx = m + 165;
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(kx, y, 25, 0, TAU); ctx.fill(); ctx.stroke();
    if (g.hasKey) { glow(kx, y, 40, 'rgba(255,220,90,0.9)', 0.6 + 0.3 * Math.sin(time * 5)); drawKey(kx, y, 0, 0.75); }
    else { ctx.globalAlpha = 0.35; drawKey(kx, y, 0, 0.75); ctx.globalAlpha = 1; }
    // coins
    drawCoin(kx + 55, y, time * 2, 15);
    outlined(String(g.coinCount), kx + 78, y + 2, 32, '#fff', 'rgba(0,40,80,0.7)', 'left');
    // progress: Isabella -> chest
    const pw = Math.min(330, VW * 0.28), px = VW / 2 - pw / 2 + 40, py = 34;
    ctx.fillStyle = 'rgba(0,30,60,0.3)'; rrect(px, py, pw, 14, 7); ctx.fill();
    ctx.fillStyle = '#ffe066'; rrect(px, py, Math.max(14, pw * g.progress), 14, 7); ctx.fill();
    for (const c of g.lev.cps) { const cx = px + pw * (c.x / g.lev.chestX); ctx.fillStyle = '#ff9ec7'; ctx.beginPath(); ctx.arc(cx, py + 7, 7, 0, TAU); ctx.fill(); }
    ctx.save(); ctx.translate(px + pw + 26, py + 8); ctx.scale(0.28, 0.28); drawChest(0, 20, 0, time, 0); ctx.restore();
    ctx.save(); ctx.translate(px + pw * g.progress, py + 7);
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = HAIR; ctx.beginPath(); ctx.arc(0, -2, 11, Math.PI, 0); ctx.fill();
    ctx.restore();
    // "drag your finger" hand for first-timers
    if (showHand) {
      const hx = START_X + 120, hy = 270 + Math.sin(time * 2.2) * 110;
      ctx.globalAlpha = 0.9;
      ctx.font = '64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u{1F446}', hx, hy + 40);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 4; ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.moveTo(hx, 160); ctx.lineTo(hx, 380); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // title / menu background: Isabella swimming through the shallows
  function drawAttract(time, dt, n) {
    const th = THEMES[(n || 1) - 1];
    const cam = time * 70;
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawBackground(th, cam, time, 1);
    drawSand(th, cam, time);
    for (let i = 0; i < 6; i++) {
      const x = ((((i * 230 - time * 70) % (VW + 200)) + VW + 200) % (VW + 200)) - 100;
      drawCoin(x, 120 + Math.sin(i * 1.7 + time) * 40 + (i % 2) * 260, time * 3 + i);
    }
    const ix = VW * 0.24 + Math.sin(time * 0.6) * 60, iy = 330 + Math.sin(time * 1.1) * 40;
    drawIsabella(ix, iy, time, { scale: 1.7, tilt: Math.cos(time * 1.1) * 0.12, swim: 7, crown });
    drawChest(VW - 130, SAND - 4, 0.25 + 0.15 * Math.sin(time * 2), time, 0);
    drawParts();
  }

  // title / menu background for the Fairy world: a Meadow sky and hills, trees along the ground, grass and
  // flowers, a few clouds drifting, and Isabella the Fairy flying across from left to right (looping) with a
  // dust trail. Drawn through FairyArt (web/fairy/fairy.js); no blur or shadow filters, so a frame is cheap.
  // She keeps to one lane clear of the title's buttons: the upper band of the screen, above the row of game
  // buttons; on squarer screens (16:10 or less, where that band is crowded) the lower band, over the meadow.
  const fairyGround = (x) => 452 + 14 * Math.sin(x / 150) + 8 * Math.sin(x / 53 + 1);
  const fairyHash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
  function drawFairyAttract(time, dt) {
    const F = window.FairyArt;
    if (!F) { ctx.setTransform(s, 0, 0, s, 0, 0); ctx.fillStyle = '#8fd8ff'; ctx.fillRect(0, 0, VW, H); return; }
    const T = F.THEMES[3];                               // Sunny meadow
    ctx.setTransform(s, 0, 0, s, 0, 0);
    F.drawSky(ctx, VW, H, T, time);
    // clouds drifting right, slow, each at its own speed
    for (let i = 0; i < 4; i++) {
      const w = [230, 170, 270, 150][i], span = VW + 2 * w, sp = [7, 11, 5, 14][i];
      const x = ((((i * 0.37 * span + time * sp) % span) + span) % span) - w;
      F.drawCloud(ctx, x, [150, 96, 200, 62][i], w, { light: T.cloud[0], shade: T.cloud[1] });
    }
    // the near hill, then trees, flowers and grass standing on it
    const g = ctx.createLinearGradient(0, 410, 0, H);
    g.addColorStop(0, T.ground[0]); g.addColorStop(1, T.ground[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= VW + 20; x += 20) ctx.lineTo(x, fairyGround(x));
    ctx.lineTo(VW + 20, H); ctx.closePath(); ctx.fill();
    for (let i = 0, n = Math.ceil(VW / 215) + 1; i < n; i++) {
      const x = 40 + i * 215 + fairyHash(i, 1) * 60;
      F.drawTree(ctx, x, fairyGround(x) + 4, 0.85 + fairyHash(i, 2) * 0.3, i % 4, time);
    }
    for (let i = 0, n = Math.ceil(VW / 150) + 1; i < n; i++) {
      const x = 60 + i * 150 + fairyHash(i, 3) * 70, y = fairyGround(x) + 22 + fairyHash(i, 4) * 30;
      if (i % 5 === 2) F.drawMushroom(ctx, x, y, 0.5, i % 2 ? '#ff4d6d' : '#c86bfa');
      else F.drawFlower(ctx, x, y, 0.9, i, 1, time);
    }
    for (let x = -10; x < VW + 40; x += 70) F.drawGrass(ctx, x, fairyGround(x) + 36 + fairyHash(x, 5) * 14, 64, time);
    // Isabella the Fairy
    const lowLane = VW / H <= 1.6, sc = lowLane ? 1.25 : 1.3, span = VW + 340, speed = 85;
    const lane = (t) => ({ x: (((t * speed) % span) + span) % span - 170, y: (lowLane ? 478 : 70) + Math.sin(t * 1.3) * 16 });
    const now = lane(time), cycle = Math.floor((time * speed) / span), trail = [];
    for (let k = 1; k <= 12; k++) {
      const age = k * 0.1, past = lane(time - age);
      if (Math.floor(((time - age) * speed) / span) !== cycle) break;        // before she looped round: no trail from the far edge
      trail.push({ x: past.x - 26 * sc, y: past.y + 10 * sc, age });
    }
    F.drawDust(ctx, trail, time);
    F.drawFairy(ctx, now.x, now.y, time, { pose: 'fly', scale: sc, dust: 0.7 });
    // a slow sparkle or two in the air
    F.drawSparkles(ctx, VW * 0.2, lowLane ? 330 : 250, time * 0.5, 3, 40, 0.8);
    F.drawSparkles(ctx, VW * 0.86, lowLane ? 300 : 360, time * 0.5 + 3, 3, 40, 0.8);
  }

  window.IsabellaRender = {
    init, resize, toWorld, drawGame, drawHUD, drawAttract, drawFairyAttract, burst, fountain,
    get VW() { return VW; },
    setCrown(v) { crown = !!v; },
    THEMES, RAINBOW,
  };
})();
