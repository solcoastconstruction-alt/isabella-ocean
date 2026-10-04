/* Splash Dash — everything you see, drawn in code. Isabella seen from the side (the level select and the
 * party at the chest), the coin, the pearl, the chest and the particles are copied from the main game's
 * web/render.js by way of Coral Maze's art.js (both untouched). Everything else is new: the sea seen from just
 * behind and above her, the sky, Isabella from behind, and everything that floats.
 *
 * The view: the screen is 540 units tall. The horizon is at y = HZ. Isabella swims away from us at a fixed
 * place on the screen (ISA_Y); a thing `ds` units ahead of her is drawn at scale k = D0 / (D0 + ds), so the
 * course comes toward her out of the distance and grows. Rocks, buoys and boats stand up out of the water as
 * pictures (drawn once into small off-screen canvases); the water itself is drawn each frame. */
(function () {
  'use strict';
  const L = DashLogic;
  const H = 540, TAU = Math.PI * 2;
  const clamp = L.clamp, lerp = L.lerp;
  const smooth = (u) => u * u * (3 - 2 * u);

  const HZ = 150;        // the horizon
  const D0 = 620;        // from the camera to Isabella
  const GY = 245;        // Isabella is this far below the horizon
  const ISA_Y = HZ + GY;
  const ISA_SC = 1;      // how big she is drawn
  const FOLLOW = 0.3;    // how much of her sideways swim the camera follows
  const FAR = 2700;      // things appear this far ahead
  const NEARDS = -175;   // and leave the bottom of the screen this far behind her

  // Five looks, four courses each: a sunny bay, a green lagoon, sunset, a pink dusk, moonlight.
  const THEMES = [
    { top: '#8fd8ff', bot: '#2a8fd6', sky: ['#49aef2', '#c9efff'], sea: ['#1c7fc4', '#2fa9dc', '#55d6e6'], sun: { x: 0.74, y: 58, r: 32, c: '#fff6b0', g: 'rgba(255,244,170,0.9)' }, cloud: 1, isle: ['#74c58e', '#4f9f74'], wave: '255,255,255', stars: 0 },
    { top: '#b4f6e4', bot: '#17a595', sky: ['#2fbfe6', '#dafcf0'], sea: ['#0f9a96', '#25c3ac', '#84efcf'], sun: { x: 0.3, y: 50, r: 30, c: '#fffbe0', g: 'rgba(255,255,200,0.9)' }, cloud: 0.9, isle: ['#58c070', '#2f8f5a'], wave: '240,255,250', stars: 0 },
    { top: '#ffd28f', bot: '#e0603f', sky: ['#f76b4f', '#ffd596'], sea: ['#a8456e', '#e0705f', '#ffb27c'], sun: { x: 0.5, y: 112, r: 46, c: '#fff0b8', g: 'rgba(255,200,120,0.95)' }, cloud: 0.75, isle: ['#8a4a6a', '#6a3458'], wave: '255,236,210', stars: 0 },
    { top: '#ffc0e0', bot: '#6a55d0', sky: ['#5f50c8', '#ffb4d6'], sea: ['#4640a8', '#7a66d8', '#b79cf5'], sun: { x: 0.68, y: 96, r: 34, c: '#fff0f8', g: 'rgba(255,190,230,0.9)' }, cloud: 0.7, isle: ['#6a56b8', '#4a3a94'], wave: '255,230,250', stars: 0.4 },
    { top: '#5d86e0', bot: '#101f5c', sky: ['#081238', '#2c4c9c'], sea: ['#0b1f58', '#1a4696', '#3a7fc8'], sun: { x: 0.24, y: 56, r: 28, c: '#f4f8ff', g: 'rgba(200,220,255,0.8)', moon: 1 }, cloud: 0.22, isle: ['#1c2f6c', '#12204e'], wave: '200,225,255', stars: 1 },
  ];
  const themeOf = (n) => THEMES[Math.floor((n - 1) / 4) % THEMES.length];
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38', GOLD = '#ffcc33';

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  const parts = [];
  let bg = null, bgKey = '';
  const _p = { x: 0, y: 0, k: 1 };
  let cam = 0;

  function init(cv) { canvas = cv; ctx = canvas.getContext('2d'); resize(); }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    s = canvas.height / H; VW = canvas.width / s;
    bg = null; bgKey = '';
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toCss = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });
  // a place on the water, `ds` ahead of her and x across the course -> the screen (_p is reused)
  function proj(ds, x) {
    const k = D0 / (D0 + ds);
    _p.k = k; _p.x = VW / 2 + (x - cam) * k; _p.y = HZ + GY * k;
    return _p;
  }

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

  // ---------- Isabella from the side (copied from render.js) ----------
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

  // ---------- coin, pearl, chest (from render.js / Shell Match) ----------
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

  function drawNote(x, y, sc, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    oval(0, 0, 5, 3.8, -0.4);
    ctx.beginPath(); ctx.moveTo(4.2, -1); ctx.lineTo(4.2, -17); ctx.quadraticCurveTo(6, -11, 11, -9); ctx.stroke();
    ctx.restore();
  }

  // ---------- pictures drawn once ----------
  const SPR = 2;   // sprite pixels per world unit
  function makeSprite(w, h, ax, ay, fn) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * SPR); cv.height = Math.ceil(h * SPR);
    const g = cv.getContext('2d'), keep = ctx;
    g.scale(SPR, SPR); g.translate(ax, ay);
    ctx = g;
    try { fn(); } finally { ctx = keep; }
    return { cv, w, h, ax, ay };
  }
  const sprites = {};
  const sprite = (name, make) => sprites[name] || (sprites[name] = make());
  // draw a sprite with its anchor (the middle of its waterline) at (x, y), at scale k, leaning by rot
  function blit(sp, x, y, k, rot) {
    if (rot) {
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.drawImage(sp.cv, -sp.ax * k, -sp.ay * k, sp.w * k, sp.h * k);
      ctx.rotate(-rot); ctx.translate(-x, -y);
    } else ctx.drawImage(sp.cv, x - sp.ax * k, y - sp.ay * k, sp.w * k, sp.h * k);
  }
  // where something meets the water: a soft shadow and a ring of foam
  function waterline(w) {
    ctx.fillStyle = 'rgba(8,40,80,0.25)'; oval(5, 9, w + 8, (w + 8) * 0.26);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; oval(0, 3, w + 3, (w + 3) * 0.24);
  }
  function scallops(w) {
    ctx.fillStyle = '#ffffff';
    for (let i = -3; i <= 3; i++) circle((i * w) / 3.3, 4 + Math.abs(i) * 0.4, 7.5 - Math.abs(i));
  }

  function paintRock(r, v) {
    const w = r + 12;
    waterline(w);
    const g = ctx.createLinearGradient(0, -r * 1.4, 0, 6);
    g.addColorStop(0, '#d2c8b8'); g.addColorStop(0.55, '#a1968a'); g.addColorStop(1, '#6f665c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-w, 3);
    ctx.bezierCurveTo(-w - 4, -r * 0.7, -r * 0.75, -r * 1.25, -r * 0.2, -r * 1.3);
    ctx.bezierCurveTo(r * 0.25, -r * 1.42, r * 0.6, -r * 1.0, r * 0.72, -r * 0.8);
    ctx.bezierCurveTo(w + 2, -r * 0.7, w + 4, -r * 0.2, w, 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.beginPath(); ctx.moveTo(-r * 0.78, -r * 0.5);
    ctx.bezierCurveTo(-r * 0.62, -r * 1.08, -r * 0.1, -r * 1.22, r * 0.18, -r * 1.16);
    ctx.bezierCurveTo(-r * 0.1, -r * 0.9, -r * 0.3, -r * 0.6, -r * 0.78, -r * 0.5); ctx.fill();
    ctx.fillStyle = '#867b70';
    ctx.beginPath(); ctx.moveTo(r * 0.12, 4);
    ctx.bezierCurveTo(r * 0.1, -r * 0.5, r * 0.55, -r * 0.72, r * 0.82, -r * 0.45);
    ctx.bezierCurveTo(w + 7, -r * 0.3, w + 7, 0, w + 2, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; oval(r * 0.62, -r * 0.42, r * 0.22, r * 0.1, -0.3);
    ctx.strokeStyle = 'rgba(60,50,45,0.45)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.32, -r * 0.98); ctx.lineTo(-r * 0.16, -r * 0.62); ctx.lineTo(-r * 0.36, -r * 0.36); ctx.stroke();
    ctx.fillStyle = '#86c860'; oval(-r * 0.22, -r * 1.27, r * 0.36, r * 0.1, -0.08);
    ctx.fillStyle = '#6aad4c'; oval(r * 0.3, -r * 1.16, r * 0.2, r * 0.07, 0.5);
    if (v === 1) {   // a starfish sunning itself
      ctx.fillStyle = '#ff8a5c'; star(-r * 0.42, -r * 0.3, r * 0.26, r * 0.12, 5, 0.3); ctx.fill();
      ctx.fillStyle = '#ffc2a0'; circle(-r * 0.42, -r * 0.3, r * 0.06);
    } else if (v === 2) {   // a little crab
      const cx = r * 0.5, cy = -r * 0.86;
      ctx.strokeStyle = '#e0503c'; ctx.lineWidth = 2.4;
      for (const q of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + q * 7, cy); ctx.lineTo(cx + q * 14, cy - 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + q * 6, cy + 3); ctx.lineTo(cx + q * 13, cy + 6); ctx.stroke(); }
      ctx.fillStyle = '#ff6b4f'; oval(cx, cy, 9, 6.5);
      circle(cx - 14, cy - 9, 3.6); circle(cx + 14, cy - 9, 3.6);
      ctx.fillStyle = '#fff'; circle(cx - 3, cy - 6, 2.4); circle(cx + 3, cy - 6, 2.4);
      ctx.fillStyle = '#20100c'; circle(cx - 3, cy - 6, 1.1); circle(cx + 3, cy - 6, 1.1);
    }
    scallops(w);
  }
  function paintBuoy(v, small) {
    const col = v ? ['#ff9f1c', '#c96a00'] : ['#ff4d5e', '#b8233a'];
    waterline(26);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(-21, -2); ctx.lineTo(-10, -62); ctx.quadraticCurveTo(0, -68, 10, -62); ctx.lineTo(21, -2); ctx.closePath(); ctx.clip();
    ctx.fillStyle = col[0]; ctx.fillRect(-24, -70, 48, 72);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-24, -46, 48, 17);
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(5, -70, 20, 72);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-13, -70, 6, 72);
    ctx.restore();
    ctx.fillStyle = col[1]; oval(0, -3, 25, 8.5);
    ctx.fillStyle = col[0]; oval(0, -6, 22, 6.5);
    ctx.fillStyle = '#5a4a3a'; ctx.fillRect(-1.5, -80, 3, 16);
    if (!small) glow(0, -84, 22, 'rgba(255,240,140,0.9)', 0.7);
    ctx.fillStyle = '#ffe680'; circle(0, -84, 7.5);
    ctx.fillStyle = '#fffbe0'; circle(-2, -86, 3);
    scallops(22);
  }
  function paintBoat(v, moving) {
    const hull = [['#ef5a45', '#b23a2c'], ['#3f8fe8', '#2a61a8'], ['#f6b93b', '#c98a16']][v % 3];
    waterline(98);
    ctx.fillStyle = '#7a5230'; ctx.fillRect(-4, -156, 5.5, 130);
    // sails
    const sail = (ax, ay, bx, by, cx, cy, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill(); };
    ctx.save();
    ctx.beginPath(); ctx.moveTo(3, -150); ctx.quadraticCurveTo(62, -92, 82, -40); ctx.lineTo(3, -40); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#fffdf4'; ctx.fillRect(0, -152, 90, 116);
    if (moving) { RAINBOW.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, -134 + i * 13.5, 90, 13.5); }); }
    else { ctx.fillStyle = hull[0]; ctx.fillRect(0, -84, 90, 14); }
    ctx.fillStyle = 'rgba(0,40,80,0.08)'; ctx.fillRect(0, -152, 16, 116);
    ctx.restore();
    sail(-9, -138, -9, -44, -60, -44, moving ? '#ffe9f4' : '#f1ede0');
    ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.moveTo(1, -156); ctx.lineTo(moving ? 30 : 22, -150); ctx.lineTo(1, -144); ctx.closePath(); ctx.fill();
    // hull
    ctx.fillStyle = hull[0];
    ctx.beginPath(); ctx.moveTo(-94, -32); ctx.lineTo(94, -32); ctx.quadraticCurveTo(86, 2, 58, 4); ctx.lineTo(-62, 4); ctx.quadraticCurveTo(-86, 2, -94, -32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = hull[1];
    ctx.beginPath(); ctx.moveTo(-86, -10); ctx.lineTo(87, -10); ctx.quadraticCurveTo(80, 3, 58, 4); ctx.lineTo(-62, 4); ctx.quadraticCurveTo(-80, 3, -86, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-93, -32, 186, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; for (const x of [-44, -8, 28]) circle(x, -17, 5);
    ctx.fillStyle = 'rgba(40,80,120,0.6)'; for (const x of [-44, -8, 28]) circle(x, -17, 3);
    scallops(90);
  }
  function paintGull(awake) {
    waterline(60);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#a9743f' : '#c08a52'; rrect(-60, -15 + i * 4.6, 120, 6.5, 3); ctx.fill(); }
    ctx.fillStyle = '#7a5230'; ctx.fillRect(-42, -17, 5, 21); ctx.fillRect(38, -17, 5, 21);
    // the gull
    ctx.fillStyle = '#ff9f43'; ctx.fillRect(-6, -19, 3, 6); ctx.fillRect(4, -19, 3, 6);
    if (awake) {
      ctx.fillStyle = '#b4bfcc';
      ctx.beginPath(); ctx.moveTo(-12, -40); ctx.quadraticCurveTo(-44, -66, -40, -84); ctx.quadraticCurveTo(-22, -66, -2, -48); ctx.fill();
      ctx.beginPath(); ctx.moveTo(14, -40); ctx.quadraticCurveTo(46, -66, 42, -84); ctx.quadraticCurveTo(24, -66, 4, -48); ctx.fill();
    }
    ctx.fillStyle = '#5a6675'; ctx.beginPath(); ctx.moveTo(20, -40); ctx.lineTo(38, -46); ctx.lineTo(34, -34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; oval(0, -36, 25, 19);
    if (!awake) { ctx.fillStyle = '#b4bfcc'; oval(5, -36, 17, 11, 0.15); ctx.strokeStyle = '#93a0b0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(5, -38, 11, 0.4, 2.4); ctx.stroke(); }
    const hx = awake ? -17 : -15, hy = awake ? -60 : -52;
    ctx.fillStyle = '#ffffff'; circle(hx, hy, 12.5);
    ctx.fillStyle = '#ffa53a';
    if (awake) { ctx.beginPath(); ctx.moveTo(hx - 10, hy - 3); ctx.lineTo(hx - 26, hy - 7); ctx.lineTo(hx - 12, hy + 1); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(hx - 11, hy + 2); ctx.lineTo(hx - 23, hy + 7); ctx.lineTo(hx - 9, hy + 5); ctx.closePath(); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(hx - 10, hy - 2); ctx.lineTo(hx - 25, hy + 3); ctx.lineTo(hx - 10, hy + 5); ctx.closePath(); ctx.fill(); }
    if (awake) { ctx.fillStyle = '#fff'; circle(hx - 3, hy - 3, 4.6); ctx.fillStyle = '#1d2a3a'; circle(hx - 4, hy - 3, 2.3); ctx.strokeStyle = '#1d2a3a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(hx - 9, hy - 10); ctx.lineTo(hx + 1, hy - 9); ctx.stroke(); }
    else { ctx.strokeStyle = '#1d2a3a'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(hx - 3, hy - 3, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,140,160,0.5)'; circle(hx - 1, hy + 4, 2.6);
    scallops(54);
  }
  function paintKelp(v) {
    const R = mulberry32(77 + v * 131);
    ctx.fillStyle = 'rgba(16,84,60,0.5)'; oval(0, 0, 132, 53);
    ctx.fillStyle = 'rgba(30,120,80,0.45)'; oval(-6, -3, 112, 42);
    const cols = ['#2f8f5a', '#3fae6a', '#57c27a', '#237a4c'];
    for (let i = 0; i < 34; i++) {
      const a = R() * TAU, d = Math.sqrt(R()), x = Math.cos(a) * d * 112, y = Math.sin(a) * d * 40;
      ctx.fillStyle = cols[i % 4];
      oval(x, y, 20 + R() * 16, 4.5 + R() * 3, (R() - 0.5) * 1.6);
      if (i % 4 === 0) { ctx.fillStyle = '#c3e06a'; circle(x + 8, y - 2, 3.6); ctx.fillStyle = 'rgba(255,255,255,0.7)'; circle(x + 7, y - 3.2, 1.2); }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 132, 53, 0, 0.2, 2.9); ctx.stroke();
  }
  function paintRamp() {
    ctx.fillStyle = 'rgba(8,40,80,0.2)'; oval(0, 8, 172, 16);
    const g = ctx.createLinearGradient(0, -58, 0, 6);
    g.addColorStop(0, '#f2ffff'); g.addColorStop(0.35, '#8fecf0'); g.addColorStop(1, '#2fb3da');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-168, 5); ctx.bezierCurveTo(-112, 3, -76, -56, 0, -58); ctx.bezierCurveTo(76, -56, 112, 3, 168, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-104, -22); ctx.bezierCurveTo(-70, -52, -40, -57, 0, -58); ctx.bezierCurveTo(40, -57, 70, -52, 104, -22); ctx.stroke();
    // three arrows up the face: this way, and fast
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 7.5;
    for (const [x, y] of [[-58, -12], [0, -20], [58, -12]]) { ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x, y - 16); ctx.lineTo(x + 15, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 5.5;
    for (const [x, y] of [[-58, 0], [0, -8], [58, 0]]) { ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x, y - 12); ctx.lineTo(x + 12, y); ctx.stroke(); }
    ctx.fillStyle = '#fff6a0'; star(-118, -30, 8, 3, 4, 0); ctx.fill(); star(122, -34, 7, 2.6, 4, 0.4); ctx.fill();
    ctx.fillStyle = '#ffffff'; for (let i = -6; i <= 6; i++) circle(i * 25, 5 + Math.abs(i) * 0.3, 7 - Math.abs(i) * 0.5);
  }
  function paintWave() {
    ctx.fillStyle = 'rgba(8,40,80,0.2)'; oval(0, 8, 52, 8);
    const g = ctx.createLinearGradient(0, -30, 0, 6);
    g.addColorStop(0, '#d9fbff'); g.addColorStop(0.5, '#6fd3ee'); g.addColorStop(1, '#2b9bd0');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-50, 6); ctx.quadraticCurveTo(-42, -24, -10, -29); ctx.quadraticCurveTo(22, -32, 30, -12); ctx.quadraticCurveTo(34, -2, 50, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-40, -14); ctx.quadraticCurveTo(-28, -28, -8, -29); ctx.quadraticCurveTo(20, -31, 28, -14); ctx.stroke();
    ctx.fillStyle = '#ffffff'; circle(26, -10, 8); circle(14, -6, 5); circle(-22, -30, 3); circle(4, -36, 2.4);
    for (let i = -2; i <= 2; i++) circle(i * 20, 6, 7);
  }
  function paintIslet() {
    ctx.fillStyle = 'rgba(8,40,80,0.22)'; oval(4, 12, 150, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; oval(0, 6, 146, 24);
    ctx.fillStyle = '#e8c884'; oval(0, 0, 136, 24);
    ctx.fillStyle = '#f9e4ab'; oval(-4, -5, 118, 17);
    // a palm
    ctx.strokeStyle = '#9a6a3a'; ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(88, -8); ctx.quadraticCurveTo(98, -80, 70, -136); ctx.stroke();
    ctx.strokeStyle = 'rgba(70,40,20,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) { const u = i / 7, x = lerp(88, 72, u * u) + 8 * Math.sin(u * 3), y = lerp(-12, -128, u); ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y - 2); ctx.stroke(); }
    for (const [a, len, c] of [[-2.7, 70, '#2f9f5a'], [-2.0, 62, '#3fb86a'], [-1.2, 64, '#2f9f5a'], [-0.4, 72, '#3fb86a'], [0.3, 60, '#2a8f50'], [2.9, 58, '#2a8f50']]) {
      const ex = 70 + Math.cos(a) * len, ey = -136 + Math.sin(a) * len * 0.75 + 16;
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(70, -138);
      ctx.quadraticCurveTo(70 + Math.cos(a) * len * 0.55, -136 + Math.sin(a) * len * 0.75 - 22, ex, ey);
      ctx.quadraticCurveTo(70 + Math.cos(a) * len * 0.45, -136 + Math.sin(a) * len * 0.6 + 2, 70, -132); ctx.fill();
    }
    ctx.fillStyle = '#8a5a2a'; circle(66, -132, 6); circle(75, -130, 6);
    ctx.fillStyle = '#ff8fab'; star(-96, -2, 8, 3.6, 5, 0.3); ctx.fill();
    ctx.fillStyle = '#ffd1ea'; oval(104, 2, 7, 4.5, 0.4);
  }
  function paintCloud() {
    ctx.fillStyle = '#ffffff';
    oval(0, 0, 70, 20); circle(-34, -10, 22); circle(-4, -22, 28); circle(30, -12, 22); circle(54, -2, 14); circle(-58, -2, 13);
    ctx.fillStyle = 'rgba(190,220,245,0.5)'; oval(4, 8, 62, 10);
  }
  function paintIsle(cols, palms) {
    ctx.fillStyle = cols[1]; ctx.beginPath(); ctx.moveTo(-150, 0); ctx.quadraticCurveTo(-90, -44, -30, -18); ctx.quadraticCurveTo(40, -62, 150, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = cols[0]; ctx.beginPath(); ctx.moveTo(-120, 0); ctx.quadraticCurveTo(-70, -30, -20, -10); ctx.quadraticCurveTo(30, -44, 110, 0); ctx.closePath(); ctx.fill();
    if (palms) {
      for (const [x, h] of [[-62, 34], [44, 44], [72, 30]]) {
        ctx.strokeStyle = cols[1]; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, -8); ctx.quadraticCurveTo(x + 4, -h * 0.6, x - 2, -h - 8); ctx.stroke();
        ctx.fillStyle = cols[1]; for (let a = 0; a < 5; a++) oval(x - 2 + Math.cos(a * 1.3 + 0.4) * 9, -h - 8 + Math.sin(a * 1.3 + 0.4) * 4, 10, 3, a * 1.3 + 0.4);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; oval(0, 1, 150, 3);
  }

  const SP = {
    rock: (v) => sprite('rock' + v, () => { const r = [36, 44, 50][v]; return makeSprite(2 * r + 60, r * 1.5 + 34, r + 30, r * 1.5 + 12, () => paintRock(r, v)); }),
    buoy: (v) => sprite('buoy' + v, () => makeSprite(80, 126, 40, 104, () => paintBuoy(v))),
    boat: (v, mv) => sprite('boat' + v + (mv ? 'm' : ''), () => makeSprite(240, 196, 120, 168, () => paintBoat(v, mv))),
    gull: (awake) => sprite('gull' + (awake ? 'a' : ''), () => makeSprite(150, 126, 75, 98, () => paintGull(awake))),
    kelp: (v) => sprite('kelp' + v, () => makeSprite(280, 124, 140, 62, () => paintKelp(v))),
    ramp: () => sprite('ramp', () => makeSprite(380, 96, 190, 70, paintRamp)),
    wave: () => sprite('wave', () => makeSprite(116, 66, 58, 44, paintWave)),
    islet: () => sprite('islet', () => makeSprite(330, 222, 160, 180, paintIslet)),
    cloud: () => sprite('cloud', () => makeSprite(180, 84, 90, 54, paintCloud)),
    isle: (t) => sprite('isle' + t, () => makeSprite(320, 76, 160, 70, () => paintIsle(THEMES[t].isle, t < 2))),
    coin: (f) => sprite('coin' + f, () => makeSprite(34, 36, 17, 17, () => drawCoin(0, 0, (f / 8) * Math.PI, 14))),
  };
  // (build them all at the start of a course, so no frame of play has to)
  function warm(t) {
    for (let v = 0; v < 3; v++) { SP.rock(v); SP.boat(v, 0); SP.boat(v, 1); }
    SP.buoy(0); SP.buoy(1); SP.gull(false); SP.gull(true); SP.kelp(0); SP.kelp(1); SP.ramp(); SP.wave(); SP.islet(); SP.cloud(); SP.isle(t);
    for (let f = 0; f < 8; f++) SP.coin(f);
  }

  // ---------- the sky and the sea ----------
  function background(t) {
    const key = t + ':' + canvas.width + 'x' + canvas.height;
    if (bg && bgKey === key) return bg;
    const th = THEMES[t];
    bg = document.createElement('canvas'); bg.width = canvas.width; bg.height = canvas.height; bgKey = key;
    const g = bg.getContext('2d'), keep = ctx;
    ctx = g; g.setTransform(s, 0, 0, s, 0, 0);
    let gr = g.createLinearGradient(0, 0, 0, HZ + 4);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(1, th.sky[1]);
    g.fillStyle = gr; g.fillRect(0, 0, VW, HZ + 4);
    if (th.stars) {
      const R = mulberry32(4242);
      for (let i = 0; i < 70; i++) { const x = R() * VW, y = R() * (HZ - 20), r = 0.8 + R() * 1.6; g.fillStyle = `rgba(255,255,255,${(0.35 + R() * 0.6) * th.stars})`; if (i % 9 === 0) { star(x, y, r * 2.6, r * 0.9, 4, 0); g.fill(); } else circle(x, y, r); }
    }
    const sx = VW * th.sun.x, sy = th.sun.y;
    glow(sx, sy, th.sun.r * 4.2, th.sun.g, 0.55);
    glow(sx, sy, th.sun.r * 2.2, th.sun.g, 0.8);
    g.fillStyle = th.sun.c; circle(sx, sy, th.sun.r);
    if (th.sun.moon) { g.fillStyle = 'rgba(160,185,230,0.5)'; circle(sx - 9, sy - 6, 6); circle(sx + 8, sy + 7, 4.5); circle(sx + 10, sy - 10, 3); }
    gr = g.createLinearGradient(0, HZ, 0, H);
    gr.addColorStop(0, th.sea[0]); gr.addColorStop(0.32, th.sea[1]); gr.addColorStop(1, th.sea[2]);
    g.fillStyle = gr; g.fillRect(0, HZ, VW, H - HZ);
    // the light of the sun (or moon) lying on the water
    g.save(); g.globalCompositeOperation = 'lighter';
    gr = g.createLinearGradient(0, HZ, 0, HZ + 250);
    gr.addColorStop(0, th.sun.g); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.07; g.fillStyle = gr;
    for (const w of [0.7, 1.0, 1.35, 1.75]) { g.beginPath(); g.moveTo(sx - th.sun.r * 1.1 * w, HZ); g.lineTo(sx + th.sun.r * 1.1 * w, HZ); g.lineTo(sx + th.sun.r * 4 * w, HZ + 250); g.lineTo(sx - th.sun.r * 4 * w, HZ + 250); g.closePath(); g.fill(); }
    g.restore();
    // haze where the sea meets the sky
    gr = g.createLinearGradient(0, HZ - 10, 0, HZ + 26);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.4, `rgba(255,255,255,${th.stars === 1 ? 0.14 : 0.42})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, HZ - 10, VW, 36);
    ctx = keep;
    return bg;
  }
  const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const CLOUDS = [[0.08, 36, 1.0, 7], [0.34, 70, 0.62, 4], [0.58, 28, 0.8, 6], [0.82, 84, 0.55, 3.5], [0.97, 44, 0.9, 5]];
  function drawSky(t, time) {
    const th = THEMES[t];
    ctx.drawImage(background(t), 0, 0, canvas.width, canvas.height, 0, 0, VW, H);
    const cl = SP.cloud(), span = VW + 260;
    ctx.globalAlpha = th.cloud;
    for (const c of CLOUDS) { const x = ((c[0] * span + time * c[3] - cam * 0.02) % span + span) % span - 130; blit(cl, x, c[1], c[2], 0); }
    ctx.globalAlpha = 1;
    const isle = SP.isle(t);
    blit(isle, VW * 0.16 - cam * 0.05, HZ + 2, 0.62, 0);
    blit(isle, VW * 0.9 - cam * 0.05, HZ + 2, 0.42, 0);
    // glitter under the sun
    const sx = VW * th.sun.x;
    ctx.fillStyle = `rgba(${th.wave},0.85)`;
    for (let i = 0; i < 16; i++) {
      const u = hash(i, 3), tw = Math.sin(time * (2.2 + hash(i, 5) * 3) + i * 1.9);
      if (tw < 0.2) continue;
      const y = HZ + 5 + u * u * 150, w = (5 + 26 * u) * tw;
      ctx.fillRect(sx + (hash(i, 9) - 0.5) * (30 + u * 200) - w / 2, y, w, 1.6 + u * 2.4);
    }
  }
  // the moving water: rows of little waves coming toward her, and the float lines down both sides of the course
  const ROWS = 150;
  function drawWater(t, dist, time) {
    const th = THEMES[t];
    ctx.strokeStyle = `rgb(${th.wave})`; ctx.lineCap = 'round';
    const first = Math.ceil((dist + NEARDS) / ROWS);
    for (let q = first; q * ROWS < dist + FAR; q++) {
      const ds = q * ROWS - dist, k = D0 / (D0 + ds), y = HZ + GY * k;
      ctx.globalAlpha = clamp(0.1 + k * 0.42, 0, 0.5) * clamp((FAR - ds) / 500, 0, 1);
      ctx.lineWidth = 1 + 3.2 * k;
      ctx.beginPath();
      for (let m = 0; m < 9; m++) {
        const wx = (hash(q, m) - 0.5) * 2600, x = VW / 2 + (wx - cam) * k;
        if (x < -60 || x > VW + 60) continue;
        const w = (22 + 30 * hash(q, m + 20)) * k, bob = Math.sin(time * 1.6 + q + m) * 2.5 * k;
        ctx.moveTo(x - w, y + bob); ctx.quadraticCurveTo(x, y + bob - 7 * k, x + w, y + bob);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // the ropes with their floats
    for (const side of [-1, 1]) {
      const a = proj(NEARDS, side * L.HALF), ax = a.x, ay = a.y, b = proj(FAR, side * L.HALF);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const F = 140, f0 = Math.ceil((dist + NEARDS) / F);
    for (let q = f0; q * F < dist + FAR; q++) {
      const ds = q * F - dist;
      ctx.globalAlpha = clamp((FAR - ds) / 500, 0, 1);
      for (const side of [-1, 1]) {
        const p = proj(ds, side * L.HALF), bob = Math.sin(time * 2 + q * 1.3) * 2 * p.k;
        if (p.x < -30 || p.x > VW + 30) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; oval(p.x, p.y + 2 * p.k, 13 * p.k, 4 * p.k);
        ctx.fillStyle = q % 2 ? '#ff5d73' : '#ffffff'; circle(p.x, p.y - 5 * p.k + bob, 9 * p.k);
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; circle(p.x - 3 * p.k, p.y - 8 * p.k + bob, 3 * p.k);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Isabella from behind ----------
  const TAIL_N = 12, tail = [];
  for (let i = 0; i <= TAIL_N; i++) tail.push({ x: 0, y: 0, w: 0 });
  let tailGrad = null, flukeGrad = null;
  // o: { bank (-1..1), wobble (radians), ph (swim phase), fast (0..1), alpha, happy, crown }
  function drawIsaBack(x, y, k, time, o) {
    const sw = o.ph, fast = o.fast || 0;
    ctx.save();
    ctx.translate(x, y); ctx.rotate((o.bank || 0) * 0.3 + (o.wobble || 0)); ctx.scale(k * ISA_SC, k * ISA_SC);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (!tailGrad) {
      tailGrad = ctx.createLinearGradient(0, 8, 0, 100);
      RAINBOW.forEach((c, i) => tailGrad.addColorStop(i / (RAINBOW.length - 1), c));
      flukeGrad = ctx.createLinearGradient(0, -4, 0, 32);
      flukeGrad.addColorStop(0, '#c86bfa'); flukeGrad.addColorStop(0.5, '#ff6bcb'); flukeGrad.addColorStop(1, '#7fdcff');
    }
    // tail
    for (let i = 0; i <= TAIL_N; i++) {
      const u = i / TAIL_N, p = tail[i];
      p.x = Math.sin(sw - u * 2.6) * (1.5 + u * u * 13) - (o.bank || 0) * u * u * 20; p.y = 12 + u * 86; p.w = 15 * (1 - 0.74 * u);
    }
    // fin (under the tail's end)
    const tip = tail[TAIL_N], prev = tail[TAIL_N - 1], flap = Math.sin(sw - 2.9);
    ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(-Math.atan2(tip.x - prev.x, tip.y - prev.y)); ctx.scale(1, 0.85 + 0.28 * flap);
    ctx.fillStyle = flukeGrad;
    ctx.beginPath(); ctx.moveTo(0, -5);
    ctx.bezierCurveTo(-8, 6, -24, 12, -36, 32); ctx.bezierCurveTo(-21, 27, -8, 23, 0, 14);
    ctx.bezierCurveTo(8, 23, 21, 27, 36, 32); ctx.bezierCurveTo(24, 12, 8, 6, 0, -5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let r = 0; r < 3; r++) { ctx.moveTo(-2, 4); ctx.lineTo(-14 - r * 8, 16 + r * 5); ctx.moveTo(2, 4); ctx.lineTo(14 + r * 8, 16 + r * 5); }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = tailGrad;
    ctx.beginPath(); ctx.moveTo(tail[0].x - tail[0].w, tail[0].y - 5);
    for (let i = 0; i <= TAIL_N; i++) ctx.lineTo(tail[i].x - tail[i].w, tail[i].y);
    for (let i = TAIL_N; i >= 0; i--) ctx.lineTo(tail[i].x + tail[i].w, tail[i].y);
    ctx.lineTo(tail[0].x + tail[0].w, tail[0].y - 5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 1; i < TAIL_N - 1; i++) {
      const p = tail[i], r = p.w * 0.4;
      if (i % 2) { ctx.moveTo(p.x - p.w * 0.45 + r, p.y - 2); ctx.arc(p.x - p.w * 0.45, p.y - 2, r, 0, Math.PI); ctx.moveTo(p.x + p.w * 0.45 + r, p.y - 2); ctx.arc(p.x + p.w * 0.45, p.y - 2, r, 0, Math.PI); }
      else { ctx.moveTo(p.x + r, p.y - 2); ctx.arc(p.x, p.y - 2, r, 0, Math.PI); }
    }
    ctx.stroke();
    for (let i = 2; i < TAIL_N - 1; i += 3) {
      const p = tail[i], tw = 0.5 + 0.5 * Math.sin(time * 5 + i * 1.7);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + tw * 0.6})`;
      star(p.x - p.w * 0.3, p.y, 2.6 * tw + 0.8, 0.8, 4, 0); ctx.fill();
    }
    // arms: a slow breast-stroke; stretched out in front when she is going fast, up in the air when she is happy
    const cyc = (1 - Math.cos(sw * 0.5)) / 2;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 6.5; ctx.lineCap = 'round';
    for (let q = -1; q <= 1; q += 2) {
      let hx, hy;
      if (o.happy) { hx = q * (30 + 4 * Math.sin(time * 9)); hy = -62 + 3 * Math.sin(time * 9 + q); }
      else {
        const th = lerp(lerp(-1.4, 0.45, cyc), -1.5, fast), reach = lerp(40, 46, fast);
        hx = q * (15 + reach * Math.cos(th) * lerp(1, 0.35, fast)); hy = -14 + reach * Math.sin(th);
      }
      ctx.beginPath(); ctx.moveTo(q * 14, -13); ctx.quadraticCurveTo(q * 14 + (hx - q * 14) * 0.5 + q * 7, -13 + (hy + 13) * 0.5, hx, hy); ctx.stroke();
    }
    // back, shell-top strap, waistband
    ctx.fillStyle = SKIN; oval(0, -4, 16, 18);
    ctx.strokeStyle = '#c86bfa'; ctx.lineWidth = 5.5;
    ctx.beginPath(); ctx.moveTo(-14.5, -9); ctx.quadraticCurveTo(0, -4, 14.5, -9); ctx.stroke();
    ctx.fillStyle = '#ff7ab8';
    for (let i = -2; i <= 2; i++) circle(i * 5.4, 11, 3.7);
    // hair, streaming back over her shoulders
    const h1 = Math.sin(sw * 0.6) * 3 - (o.bank || 0) * 5, h2 = Math.sin(sw * 0.6 - 1.2) * 5 - (o.bank || 0) * 9;
    ctx.fillStyle = HAIR;
    ctx.beginPath(); ctx.moveTo(-15, -32);
    ctx.bezierCurveTo(-22, -14, -18 + h1, 4, -14 + h2, 21);
    ctx.quadraticCurveTo(-9 + h2, 11, -6 + h2, 27);
    ctx.quadraticCurveTo(-1 + h2, 13, 3 + h2, 31);
    ctx.quadraticCurveTo(7 + h2, 13, 12 + h2, 23);
    ctx.bezierCurveTo(18 + h1, 4, 22, -14, 15, -32);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = HAIR_HI; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-8, -20); ctx.bezierCurveTo(-11, -6, -9 + h1, 6, -7 + h2, 17); ctx.moveTo(6, -20); ctx.bezierCurveTo(9, -6, 9 + h1, 6, 6 + h2, 18); ctx.stroke();
    // head
    ctx.fillStyle = SKIN; oval(-15, -30, 3, 4.2); oval(15, -30, 3, 4.2);
    ctx.fillStyle = HAIR; circle(0, -31, 15.8);
    ctx.strokeStyle = HAIR_HI; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, -31, 11, -2.7, -1.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.quadraticCurveTo(1.5, -38, 0, -30); ctx.stroke();
    ctx.fillStyle = '#ffd93d'; star(10, -39, 6, 2.6, 5, time * 0.5); ctx.fill();
    ctx.fillStyle = '#ff9f43'; circle(10, -39, 1.5);
    if (o.crown) {
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#b86e00'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-11, -42); ctx.lineTo(-10, -55); ctx.lineTo(-5, -48); ctx.lineTo(0, -58); ctx.lineTo(5, -48); ctx.lineTo(10, -55); ctx.lineTo(11, -42); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff4d8d'; circle(-10, -55, 1.9); circle(0, -58, 1.9); circle(10, -55, 1.9);
      ctx.fillStyle = '#4cc9f0'; circle(0, -46, 2.2);
    }
    ctx.restore();
  }

  // ---------- particles ----------
  const MAXP = 420;
  function spawn(p) { if (parts.length < MAXP) parts.push(p); }
  const clearParticles = () => { parts.length = 0; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(type, x, y, size) {
    const k = size || 1;
    if (type === 'splash') {
      for (let i = 0; i < 20; i++) spawn({ t: 'drop', x: x + rnd(-14, 14) * k, y: y + rnd(-4, 6), vx: rnd(-230, 230) * k, vy: rnd(-460, -160) * k, life: 0.8, max: 0.8, r: rnd(3, 7) * k });
      spawn({ t: 'ring', x, y: y + 6, life: 0.6, max: 0.6, r: 26 * k });
    }
    if (type === 'plop') {
      for (let i = 0; i < 7; i++) spawn({ t: 'drop', x: x + rnd(-8, 8), y, vx: rnd(-110, 110) * k, vy: rnd(-260, -110) * k, life: 0.55, max: 0.55, r: rnd(2, 4.5) * k });
      spawn({ t: 'ring', x, y: y + 4, life: 0.45, max: 0.45, r: 14 * k });
    }
    if (type === 'coin') for (let i = 0; i < 6; i++) spawn({ t: 'spark', x, y, vx: rnd(-150, 150), vy: rnd(-190, 40), life: 0.5, max: 0.5, c: i % 2 ? '#ffe066' : '#fff', r: rnd(3, 6.5) });
    if (type === 'leaf') for (let i = 0; i < 8; i++) spawn({ t: 'leaf', x: x + rnd(-20, 20), y: y + rnd(-6, 8), vx: rnd(-120, 120), vy: rnd(-220, -80), life: 0.8, max: 0.8, r: rnd(5, 9), ph: rnd(0, 6) });
    if (type === 'star') for (let i = 0; i < 14; i++) spawn({ t: 'spark', x, y, vx: rnd(-260, 260), vy: rnd(-300, 80), life: 0.8, max: 0.8, c: RAINBOW[i % RAINBOW.length], r: rnd(4, 8) });
    if (type === 'cheer') for (let i = 0; i < 8; i++) spawn({ t: i % 2 ? 'heart' : 'spark', x: x + rnd(-40, 40), y: y + rnd(-30, 10), vx: rnd(-60, 60), vy: rnd(-150, -70), life: 1.1, max: 1.1, c: '#fff6a0', r: rnd(5, 9) });
    if (type === 'notes') for (let i = 0; i < 4; i++) spawn({ t: 'note', x: x + rnd(-24, 24), y: y - 16, vx: rnd(-30, 30), vy: rnd(-95, -60), life: 1.4, max: 1.4, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], r: rnd(0.9, 1.3), ph: Math.random() * 6 });
    if (type === 'spill') spawn({ t: 'gcoin', x, y: y - 20, vx: rnd(-1, 1) > 0 ? rnd(140, 240) : rnd(-240, -140), vy: rnd(-520, -420), life: 1.3, max: 1.3, r: 13, ph: 0, floor: 9999 });
    if (type === 'confetti') for (let i = 0; i < 46; i++) spawn({ t: 'confetti', x: x + rnd(-360, 360), y: y + rnd(-40, 20), vx: rnd(-160, 160), vy: rnd(-420, -120), life: 2.6, max: 2.6, c: RAINBOW[i % RAINBOW.length], ph: rnd(0, 6) });
  }
  // the treasure burst: coins and pearls leap out of the chest and splash back, with confetti
  function fountain(x, y, n, floor) {
    for (let i = 0; i < n; i++) {
      const pearl = i % 3 === 0;
      spawn({ t: pearl ? 'gpearl' : 'gcoin', x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 520, vy: -430 - Math.random() * 480, life: 3, max: 3, r: pearl ? 8 + Math.random() * 4 : 9 + Math.random() * 5, ph: Math.random() * 6, floor });
    }
    for (let i = 0; i < n / 2; i++) spawn({ t: 'confetti', x: x + (Math.random() - 0.5) * 80, y: y - 20, vx: (Math.random() - 0.5) * 640, vy: -300 - Math.random() * 480, life: 3, max: 3, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], ph: Math.random() * 6 });
  }
  // flow: how fast the water under her is sliding down the screen (things lying on it go with it)
  function stepParts(dt, flow) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.t === 'gcoin' || p.t === 'gpearl') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 8;
        if (p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.4; p.vx *= 0.7; }
      } else if (p.t === 'confetti') {
        p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.5); p.vy = Math.min(p.vy, 120); p.x += p.vx * dt + Math.sin(p.ph) * 40 * dt; p.y += p.vy * dt; p.ph += dt * 6;
      } else if (p.t === 'note') { p.x += (p.vx + Math.sin(p.ph + p.life * 6) * 30) * dt; p.y += p.vy * dt; }
      else if (p.t === 'drop' || p.t === 'leaf') { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.ph != null) p.ph += dt * 9; }
      else if (p.t === 'ring' || p.t === 'foam') { p.y += flow * dt; if (p.vx) p.x += p.vx * dt; }
      else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-dt * 3); p.vy *= Math.exp(-dt * 3); }
    }
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.t === 'drop') { ctx.globalAlpha = Math.min(1, a * 2); ctx.fillStyle = '#ffffff'; circle(p.x, p.y, p.r); }
      else if (p.t === 'ring') { ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * (2.4 - 1.4 * a), p.r * (2.4 - 1.4 * a) * 0.32, 0, 0, TAU); ctx.stroke(); }
      else if (p.t === 'foam') { ctx.globalAlpha = a * 0.55; ctx.fillStyle = p.c || '#ffffff'; oval(p.x, p.y, p.r * (1.6 - 0.6 * a), p.r * (1.6 - 0.6 * a) * 0.4); }
      else if (p.t === 'spark') { ctx.globalAlpha = a; ctx.fillStyle = p.c; star(p.x, p.y, p.r, p.r * 0.35, 4, p.life * 4); ctx.fill(); }
      else if (p.t === 'leaf') { ctx.globalAlpha = Math.min(1, a * 2); ctx.fillStyle = '#3fae6a'; oval(p.x, p.y, p.r, p.r * 0.35, p.ph); }
      else if (p.t === 'heart') { ctx.globalAlpha = a; ctx.fillStyle = '#ff4d8d'; heartPath(p.x, p.y, p.r); ctx.fill(); }
      else if (p.t === 'gcoin') { ctx.globalAlpha = Math.min(1, p.life * 2); drawCoin(p.x, p.y, p.ph, p.r); }
      else if (p.t === 'gpearl') { ctx.globalAlpha = Math.min(1, p.life * 2); drawPearl(p.x, p.y, p.r, 0); }
      else if (p.t === 'note') { ctx.globalAlpha = Math.min(1, a * 2); drawNote(p.x, p.y, p.r, p.c); }
      else if (p.t === 'confetti') { ctx.globalAlpha = Math.min(1, p.life); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph); ctx.fillStyle = p.c; ctx.fillRect(-5, -3, 10, 6); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- things on the course ----------
  function drawLog(x, y, k, o, rot) {
    const hl = o.hx + 22;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(8,40,80,0.25)'; oval(5, 9, hl + 10, 11);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; oval(0, 4, hl + 8, 10);
    ctx.fillStyle = '#7d4f2c'; rrect(-hl, -22, 2 * hl, 28, 13); ctx.fill();
    ctx.fillStyle = '#a06a3c'; rrect(-hl + 3, -22, 2 * hl - 6, 15, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; rrect(-hl + 12, -20, 2 * hl - 30, 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(60,34,16,0.5)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let q = -hl + 24; q < hl - 24; q += 34) { ctx.moveTo(q, -9 + ((q / 34) & 1) * 4); ctx.lineTo(q + 16, -9 + ((q / 34) & 1) * 4); }
    ctx.stroke();
    ctx.fillStyle = '#e0b888'; oval(hl - 7, -8, 7, 13);
    ctx.strokeStyle = '#b98a58'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(hl - 7, -8, 3.6, 7.5, 0, 0, TAU); ctx.stroke();
    if (o.v) {   // a twig with a leaf
      ctx.strokeStyle = '#7d4f2c'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-hl * 0.4, -20); ctx.lineTo(-hl * 0.4 - 8, -38); ctx.stroke();
      ctx.fillStyle = '#57c27a'; oval(-hl * 0.4 - 15, -42, 10, 5, -0.5);
    }
    ctx.fillStyle = '#ffffff'; for (let q = -hl + 10; q <= hl - 10; q += 22) circle(q, 6, 5.5);
    ctx.restore();
  }
  function drawZ(x, y, r, a) {
    ctx.globalAlpha = a; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, r * 0.3); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function drawObstacle(o, ds, t, time) {
    const fade = clamp((FAR - ds) / 500, 0, 1);
    if (o.k === 'wave') {
      const gx = L.obsX(o, t), tile = SP.wave(), w = 96;
      ctx.globalAlpha = fade;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0, x = gx + side * (o.gap / 2 + 44); Math.abs(x) < L.HALF + 330; x += side * w, i++) {
          const p = proj(ds, x);
          if (p.x < -80 || p.x > VW + 80) continue;
          blit(tile, p.x, p.y + Math.sin(time * 3 + x * 0.02) * 3 * p.k, p.k * (side < 0 ? 1 : 1), 0);
        }
        const p = proj(ds, gx + side * (o.gap / 2 + 6));   // a little marker buoy at each side of the way through
        blit(SP.buoy(1), p.x, p.y, p.k * 0.62, Math.sin(time * 2.2 + side) * 0.08);
      }
      ctx.globalAlpha = 1;
      return;
    }
    const p = proj(ds, L.obsX(o, t));
    if (p.x < -260 * p.k || p.x > VW + 260 * p.k) return;
    const shake = o.hitT ? Math.max(0, 1 - (time - o.hitT) / 0.9) : 0;
    const rot = Math.sin(time * 1.7 + o.s * 0.01) * 0.035 + Math.sin(time * 17) * 0.16 * shake;
    const y = p.y + Math.sin(time * 2.1 + o.s * 0.013) * 2.5 * p.k;
    if (fade < 1) ctx.globalAlpha = fade;
    if (o.k === 'rock') blit(SP.rock(o.v), p.x, p.y, p.k, Math.sin(time * 17) * 0.05 * shake);
    else if (o.k === 'buoy') blit(SP.buoy(o.v), p.x, y, p.k, rot * 2.2);
    else if (o.k === 'log') drawLog(p.x, y, p.k, o, rot * 0.5);
    else if (o.k === 'boat') {
      blit(SP.boat(o.v, o.mv ? 1 : 0), p.x, y, p.k, rot);
      if (o.amp) {   // a moving boat pushes a little wave before it
        const dir = Math.cos(o.om * t + o.ph) >= 0 ? 1 : -1;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < 3; i++) circle(p.x + dir * (98 + i * 9) * p.k, p.y + (2 - i * 3) * p.k, (7 - i * 1.6) * p.k);
      }
    } else if (o.k === 'gull') {
      const awake = shake > 0;
      blit(SP.gull(awake), p.x, y, p.k, rot);
      if (!awake && ds < 1700) for (let i = 0; i < 3; i++) { const u = (time * 0.45 + i / 3) % 1; drawZ(p.x + (20 + u * 26) * p.k, y - (66 + u * 46) * p.k, (3 + u * 5) * p.k, (1 - u) * 0.9 * fade); }
    }
    ctx.globalAlpha = 1;
  }
  function drawKelp(kp, ds, time) {
    const p = proj(ds, kp.x), sp = SP.kelp(kp.v), wx = (kp.rx / 130) * p.k, wy = (kp.rs / 90) * p.k * (GY / D0) * 1.7;
    if (p.x < -300 * p.k || p.x > VW + 300 * p.k) return;
    ctx.globalAlpha = clamp((FAR - ds) / 500, 0, 1);
    const sway = Math.sin(time * 1.3 + kp.s) * 3 * p.k;
    ctx.drawImage(sp.cv, p.x - sp.ax * wx + sway, p.y - sp.ay * wy, sp.w * wx, sp.h * wy);
    ctx.globalAlpha = 1;
  }
  function drawRamp(rp, ds, time) {
    const p = proj(ds, rp.x);
    ctx.globalAlpha = clamp((FAR - ds) / 500, 0, 1);
    blit(SP.ramp(), p.x, p.y, p.k * (1 + 0.03 * Math.sin(time * 4)), 0);
    ctx.globalAlpha = 1;
  }
  function drawCoinAt(c, i, ds, x, time) {
    const p = proj(ds, x), k = p.k;
    if (p.x < -30 || p.x > VW + 30) return;
    const fade = clamp((FAR - ds) / 500, 0, 1), up = (22 + c.h + Math.sin(time * 3 + i) * 3) * k;
    ctx.globalAlpha = 0.22 * fade; ctx.fillStyle = '#062a50'; oval(p.x, p.y + 2 * k, (c.air ? 9 : 11) * k, 3.4 * k);
    ctx.globalAlpha = fade;
    if (c.air) { glow(p.x, p.y - up, 30 * k, 'rgba(255,240,150,0.9)', 0.5 * fade); ctx.globalAlpha = fade; }
    const f = Math.floor((((time * 0.9 + i * 0.13) % 1) + 1) % 1 * 16);
    blit(SP.coin(f < 8 ? f : 15 - f), p.x, p.y - up, k * 1.25, 0);
    ctx.globalAlpha = 1;
  }
  function drawFinish(ds, time) {
    const a = proj(ds, -330), ax = a.x, y = a.y, k = a.k, bx = proj(ds, 330).x;
    ctx.globalAlpha = clamp((FAR - ds) / 500, 0, 1);
    const top = y - 210 * k, bh = 44 * k;
    for (const x of [ax, bx]) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; oval(x, y + 3 * k, 24 * k, 7 * k);
      for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#ff5d8f'; ctx.fillRect(x - 7 * k, y - (i + 1) * 30 * k, 14 * k, 30 * k + 0.5); }
      ctx.fillStyle = '#ffd23f'; circle(x, top - 4 * k, 11 * k);
    }
    const n = 22, cw = (bx - ax) / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#ffffff' : '#ff5d8f'; ctx.fillRect(ax + i * cw, top + j * bh / 2 + Math.sin(time * 3 + i * 0.6) * 2 * k, cw + 0.5, bh / 2 + 0.5); }
    ctx.fillStyle = '#ffd23f'; star((ax + bx) / 2, top + bh / 2, 30 * k, 13 * k, 5, -Math.PI / 2); ctx.fill();
    ctx.strokeStyle = '#c77700'; ctx.lineWidth = 2.5 * k; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // the list of what to draw this frame, far to near (entries are reused)
  const list = [];
  let nList = 0;
  // (key: what it is sorted by. Usually ds itself; a coin she is about to take sorts just behind her.)
  function add(ds, t, o, i, key) {
    let e = list[nList];
    if (!e) { e = { ds: 0, key: 0, t: 0, o: null, i: 0 }; list.push(e); }
    e.ds = ds; e.key = key == null ? ds : key; e.t = t; e.o = o; e.i = i; nList++;
  }
  function sortList() {   // insertion sort, far first (the list is nearly sorted already)
    for (let a = 1; a < nList; a++) {
      const e = list[a];
      let b = a - 1;
      while (b >= 0 && list[b].key < e.key) { list[b + 1] = list[b]; b--; }
      list[b + 1] = e;
    }
  }
  let oi = 0, ki = 0, ri = 0, ci = 0;
  const resetView = () => { oi = ki = ri = ci = 0; cam = 0; };

  // ---------- a frame of play ----------
  // v (from game.js): { run, n, isa{ bank, wobble, ph, fast, alpha, happy, hide }, chestOpen, party (seconds since
  //   the chest opened, or -1), pan (0..1: the camera slides left at the finish), crown, hint ('tilt' | 'touch' | ''),
  //   hintT, flow }
  function drawPlay(v, time, dt) {
    const run = v.run, lev = run.lev, t = Math.floor((v.n - 1) / 4) % THEMES.length, S = run.s;
    cam = run.x * FOLLOW - 250 * v.pan;
    stepParts(dt, v.flow);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawSky(t, time);
    drawWater(t, S, time);

    // kelp lies flat on the water, under everything
    while (ki < lev.kelp.length && lev.kelp[ki].s < S + NEARDS - 100) ki++;
    for (let i = ki; i < lev.kelp.length && lev.kelp[i].s < S + FAR; i++) drawKelp(lev.kelp[i], lev.kelp[i].s - S, time);

    nList = 0;
    while (oi < lev.obs.length && lev.obs[oi].s < S + NEARDS) oi++;
    for (let i = oi; i < lev.obs.length && lev.obs[i].s < S + FAR; i++) add(lev.obs[i].s - S, 0, lev.obs[i], i);
    while (ri < lev.ramps.length && lev.ramps[ri].s < S + NEARDS) ri++;
    for (let i = ri; i < lev.ramps.length && lev.ramps[i].s < S + FAR; i++) add(lev.ramps[i].s - S, 2, lev.ramps[i], i);
    while (ci < lev.coins.length && lev.coins[ci].s < S + NEARDS - 100) ci++;
    // (a coin she is about to take is drawn behind her, not across her back)
    for (let i = ci; i < lev.coins.length && lev.coins[i].s < S + FAR; i++) if (!run.got[i]) { const ds = run.cs[i] - S; add(ds, 1, lev.coins[i], i, ds > -70 && ds < 1 ? 1 : ds); }
    if (lev.len - S < FAR) add(lev.len - S, 3, null, 0);
    if (lev.chestS - S < FAR) add(lev.chestS - S, 4, null, 0);
    add(0, 5, null, 0);
    sortList();

    const I = v.isa;
    for (let a = 0; a < nList; a++) {
      const e = list[a];
      if (e.ds < NEARDS) continue;
      if (e.t === 0) drawObstacle(e.o, e.ds, run.t, time);
      else if (e.t === 1) drawCoinAt(e.o, e.i, e.ds, run.cx[e.i], time);
      else if (e.t === 2) drawRamp(e.o, e.ds, time);
      else if (e.t === 3) drawFinish(e.ds, time);
      else if (e.t === 4) {
        const p = proj(e.ds, 0), px = p.x, py = p.y, pk = p.k;
        ctx.globalAlpha = clamp((FAR - e.ds) / 500, 0, 1);
        blit(SP.islet(), px, py, pk, 0);
        drawChest(px - 14 * pk, py - 34 * pk, v.chestOpen, time, pk * 1.15);
        ctx.globalAlpha = 1;
        v.chestAt.x = px - 14 * pk; v.chestAt.y = py - 70 * pk; v.chestAt.k = pk;
      } else if (!I.hide) {
        // Isabella: foam where she breaks the water, her shadow when she is in the air, then her
        const x = VW / 2 + (run.x - cam), z = run.z;
        if (z > 2) { ctx.fillStyle = `rgba(6,42,80,${0.25 - z / 900})`; oval(x, ISA_Y + 20, 30 - z * 0.08, 10 - z * 0.03); }
        else {
          ctx.fillStyle = 'rgba(255,255,255,0.55)'; oval(x, ISA_Y + 2, 31, 11);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 5 + 4 * I.fast; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - 20, ISA_Y + 22); ctx.quadraticCurveTo(x - 30 - 14 * I.fast, ISA_Y + 70, x - 54 - 36 * I.fast - I.bank * 30, ISA_Y + 132);
          ctx.moveTo(x + 20, ISA_Y + 22); ctx.quadraticCurveTo(x + 30 + 14 * I.fast, ISA_Y + 70, x + 54 + 36 * I.fast - I.bank * 30, ISA_Y + 132);
          ctx.stroke();
        }
        drawIsaBack(x, ISA_Y - z, 1 + z / 700, time, I);
        v.isaAt.x = x; v.isaAt.y = ISA_Y - z;
      }
    }
    drawParts();
    // the party at the chest: she leaps over it like a dolphin, this way and that
    if (v.party >= 0) {
      const c = v.chestAt, u = (v.party % 1.5) / 1.5, dir = Math.floor(v.party / 1.5) % 2 ? -1 : 1;
      const x = c.x + dir * (-170 + 340 * u), y = c.y + 40 - 200 * 4 * u * (1 - u);
      const ang = Math.atan2(-200 * 4 * (1 - 2 * u), 340);
      glow(x, y, 90, 'rgba(255,220,90,0.55)', 0.5);
      drawIsabella(x, y, time, { tilt: dir > 0 ? ang : -ang, flip: dir < 0, scale: 0.9, swim: 11, happy: true, crown: v.crown });
    }
    drawProgress(run.progress, time);
    if (v.hint) drawHint(v.hint, v.hintT, time, VW / 2 + (run.x - cam));
  }

  // how far along she is: a little bar at the top, with the chest at its end
  function drawProgress(u, time) {
    const w = 250, x0 = VW / 2 - w / 2, y = 30;
    ctx.fillStyle = 'rgba(0,40,80,0.22)'; rrect(x0 - 4, y - 9, w + 8, 18, 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; rrect(x0 - 2, y - 7, w + 4, 14, 7); ctx.fill();
    ctx.fillStyle = '#ff7ab8'; rrect(x0, y - 5, Math.max(10, w * u), 10, 5); ctx.fill();
    ctx.save(); ctx.translate(x0 + w + 16, y + 9); ctx.scale(0.26, 0.26);
    drawChest(0, 0, 0, time, 1);
    ctx.restore();
    const mx = x0 + w * u;
    ctx.fillStyle = '#ffffff'; circle(mx, y, 11);
    ctx.fillStyle = HAIR; circle(mx, y, 8.5);
    ctx.fillStyle = '#ffd93d'; star(mx + 4, y - 4, 4, 1.8, 5, 0); ctx.fill();
  }
  // how to play, in pictures: rock the phone (or slide a finger) to steer
  let hand = null;
  function drawHint(kind, ht, time, isaX) {
    const a = clamp(Math.min(ht * 2, 1), 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    if (kind === 'tilt') {
      const rot = Math.sin(time * 2.6) * 0.38;
      ctx.translate(VW / 2, 104); ctx.rotate(rot);
      ctx.fillStyle = 'rgba(0,40,80,0.25)'; rrect(-62, -30, 124, 68, 14); ctx.fill();
      ctx.fillStyle = '#ffffff'; rrect(-62, -34, 124, 68, 14); ctx.fill();
      ctx.fillStyle = '#4cc9f0'; rrect(-50, -26, 100, 52, 7); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(13, 12); ctx.lineTo(0, 6); ctx.lineTo(-13, 12); ctx.closePath(); ctx.fill();
      ctx.rotate(-rot);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const q of [-1, 1]) {
        ctx.beginPath(); ctx.arc(0, 0, 92, q > 0 ? -0.5 : Math.PI - 0.35, q > 0 ? 0.35 : Math.PI + 0.5); ctx.stroke();
        const ax = Math.cos(q > 0 ? 0.35 : Math.PI - 0.35) * 92, ay = Math.sin(0.35) * 92;
        ctx.beginPath(); ctx.moveTo(ax - 12, ay - 6); ctx.lineTo(ax, ay + 8); ctx.lineTo(ax + 12, ay - 6); ctx.stroke();
      }
    } else {
      // a finger sliding from side to side below her (the pointing hand is the hub's, web/index.html's i-hand)
      const off = Math.sin(time * 2.4) * 120, x = isaX + off, y = ISA_Y + 62;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash([3, 15]); ctx.beginPath(); ctx.moveTo(isaX - 140, y); ctx.lineTo(isaX + 140, y); ctx.stroke(); ctx.setLineDash([]);
      for (const q of [-1, 1]) { ctx.beginPath(); ctx.moveTo(isaX + q * 150, y - 13); ctx.lineTo(isaX + q * 166, y); ctx.lineTo(isaX + q * 150, y + 13); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; circle(x, y, 26);
      if (!hand) hand = new Path2D('M9.6 1.8c1.2 0 2.1.9 2.1 2.1v6.3l1.1-.2c.3 0 .5-.1.8-.1l4.6 1.1c1.2.3 2 1.5 1.8 2.8l-.9 6.5c-.2 1.1-1.1 1.9-2.2 1.9H10.5c-.6 0-1.2-.3-1.6-.8L4 15.9c-.7-.8-.6-2 .2-2.7.7-.6 1.8-.6 2.5 0l.8.7V3.9c0-1.2.9-2.1 2.1-2.1z');
      ctx.translate(x - 9.6 * 3.4, y - 3 * 3.4); ctx.scale(3.4, 3.4);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(0,50,95,0.6)'; ctx.lineWidth = 0.9;
      ctx.fill(hand); ctx.stroke(hand);
    }
    ctx.restore();
  }

  // ---------- the level select's backdrop: a sunny sea, and Isabella leaping along it ----------
  function drawMenu(time, dt, o) {
    stepParts(dt, 0);
    cam = 0;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawSky(0, time);
    drawWater(0, time * 70, time);
    const span = VW + 500, T = 5.2, u = (time % T) / T, x = -250 + span * u;
    const hop = (((x / 300) % 1) + 1) % 1, y = 470 - 150 * 4 * hop * (1 - hop);
    const ang = Math.atan2(-150 * 4 * (1 - 2 * hop), 300);
    drawIsabella(x, y, time, { tilt: ang, scale: 1.0, swim: 9, happy: false, crown: o && o.crown });
    if (hop < 0.06 || hop > 0.94) { if (Math.random() < dt * 30) burst('plop', x, 478, 1); }
    drawParts();
  }

  window.DashArt = {
    init, resize, toWorld, toCss, drawPlay, drawMenu, burst, fountain, clearParticles, resetView, warm, spawn, themeOf, proj,
    THEMES, H, HZ, ISA_Y, D0, GY, FOLLOW, FAR,
    get VW() { return VW; }, get dpr() { return dpr; }, get scale() { return s; }, get particles() { return parts.length; }, get cam() { return cam; },
  };
})();
