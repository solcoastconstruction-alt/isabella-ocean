/* Shell Match — everything you see, drawn in code. Isabella, the coin, the glow, the sea and the particles
 * are copied from the main game's web/render.js (which stays untouched); the clams and creatures are new.
 * The world is 540 units tall and scaled to the screen, like the main game. */
(function () {
  'use strict';
  const H = 540, TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const backOut = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };

  // Level looks, copied from the main game's THEMES (levels 1, 2, 3, 4, 11 and 10).
  const THEMES = [
    { top: '#7fe3f0', bot: '#1f8fc0', far: 'rgba(28,118,170,0.55)', sand: ['#f9e4ab', '#e0bd78'], rock: ['#c99f78', '#a07b58', '#e2c29f'], tip: ['#ff8fab', '#ffd166', '#ff6b6b'], ray: 0.22 },
    { top: '#5fd0e0', bot: '#1777a8', far: 'rgba(25,100,150,0.55)', sand: ['#f6d9a8', '#d9b47a'], rock: ['#d99191', '#b06666', '#f0b8b8'], tip: ['#ff5d8f', '#ff9e6d', '#c77dff', '#ffd166'], ray: 0.2 },
    { top: '#5ccfb0', bot: '#0f6b5e', far: 'rgba(10,80,70,0.55)', sand: ['#e8d9a0', '#c4b06e'], rock: ['#7e9a76', '#5c7656', '#a5c09a'], tip: ['#b8f27c', '#ffd166', '#7cf2c8'], ray: 0.18 },
    { top: '#62c6f2', bot: '#145ea8', far: 'rgba(15,70,130,0.5)', sand: ['#f3e0b0', '#d7bd86'], rock: ['#a7b0bd', '#7d8796', '#c9d0da'], tip: ['#ffd166', '#ff8fab', '#8ce99a'], ray: 0.2 },
    { top: '#b4f3ee', bot: '#2b9fb8', far: 'rgba(40,140,170,0.5)', sand: ['#fff6e0', '#ecd5ab'], rock: ['#e8dccb', '#c7b5a0', '#fff6ea'], tip: ['#ffd1e8', '#ffffff', '#bff4ff'], ray: 0.22 },
    { top: '#9feaf8', bot: '#5b78e0', far: 'rgba(130,140,230,0.45)', sand: ['#fbe7f3', '#e7c4dd'], rock: ['#d9bdf2', '#b394d6', '#f1e0ff'], tip: ['#ff8fab', '#ffd166', '#8ce99a', '#7ad7ff', '#c77dff'], ray: 0.22 },
  ];
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38';

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  const parts = [], amb = [];

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d');
    for (let i = 0; i < 34; i++) amb.push({ x: Math.random() * 2400, y: Math.random() * H, r: 1 + Math.random() * 3, sp: 10 + Math.random() * 30, ph: Math.random() * TAU });
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    s = canvas.height / H; VW = canvas.width / s;
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
  const rngAt = (i, salt) => mulberry32((i * 7919 + salt * 104729) >>> 0);
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

  // ---------- coin (from render.js) and pearl ----------
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

  // ---------- creatures: each drawn around (0,0), about 70 wide, face in the top half ----------
  function eye(x, y, r, look) {
    ctx.fillStyle = '#fff'; oval(x, y, r, r * 1.15);
    ctx.fillStyle = '#1d1030'; circle(x + r * 0.18 + (look || 0), y + r * 0.12, r * 0.62);
    ctx.fillStyle = '#fff'; circle(x + r * 0.4, y - r * 0.28, r * 0.25);
  }
  function smile(x, y, w, open) {
    if (open) { ctx.fillStyle = '#b8325a'; ctx.beginPath(); ctx.arc(x, y - w * 0.2, w, 0, Math.PI); ctx.fill(); return; }
    ctx.strokeStyle = '#5a1a32'; ctx.lineWidth = Math.max(1.4, w * 0.4); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y - w * 0.45, w, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  }
  function cheek(x, y, r) { ctx.fillStyle = 'rgba(255,105,150,0.45)'; circle(x, y, r); }
  function lgrad(x0, y0, x1, y1, a, b) { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  function rgrad(x, y, r, a, b) { const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, a); g.addColorStop(1, b); return g; }

  const CREATURE = {
    crab(t, j) {
      const snap = Math.abs(Math.sin(t * (j ? 14 : 4)));
      ctx.lineCap = 'round';
      for (const d of [-1, 1]) {
        ctx.strokeStyle = '#c23a2b'; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.moveTo(d * 15, 6); ctx.quadraticCurveTo(d * 27, 4, d * 27, -6); ctx.stroke();
        ctx.save(); ctx.translate(d * 28, -13); ctx.rotate(d * 0.25);
        ctx.fillStyle = '#ef4b3c'; oval(0, 0, 9, 7.5);
        ctx.fillStyle = '#ff7a64'; ctx.beginPath(); ctx.moveTo(-d * 2, -3); ctx.lineTo(d * 4, -13 - snap * 5); ctx.lineTo(d * 8, -4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = rgrad(0, 8, 24, '#ff8f75', '#d8392a'); oval(0, 9, 23, 15);
      ctx.strokeStyle = '#c23a2b'; ctx.lineWidth = 3.2;
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * 6, -1); ctx.lineTo(d * 8, -11); ctx.stroke(); }
      eye(-8, -15, 5.5); eye(8, -15, 5.5);
      cheek(-13, 9, 3.4); cheek(13, 9, 3.4);
      smile(0, 10, 4.5, j);
    },
    clownfish(t, j) {
      const wag = Math.sin(t * (j ? 16 : 7)) * 4;
      ctx.fillStyle = '#ff8a1f';
      ctx.beginPath(); ctx.moveTo(-19, 0); ctx.lineTo(-36, -13 + wag); ctx.quadraticCurveTo(-30, 0, -36, 13 + wag); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-2, -26, 10, -13); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, 0, 26, 16, 0, 0, TAU);
      ctx.fillStyle = lgrad(0, -16, 0, 16, '#ffb05a', '#ff7a12'); ctx.fill(); ctx.clip();
      for (const [sx, w] of [[9, 7], [-7, 7], [-21, 5]]) { ctx.fillStyle = '#222'; ctx.fillRect(sx - w / 2 - 1.6, -20, w + 3.2, 40); ctx.fillStyle = '#fff'; ctx.fillRect(sx - w / 2, -20, w, 40); }
      ctx.restore();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(0, 0, 26, 16, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ff9f43'; ctx.save(); ctx.translate(2, 7); ctx.rotate(0.6 + Math.sin(t * 6) * 0.3); oval(0, 4, 4, 7); ctx.restore();
      eye(16, -4, 5.2);
      smile(21, 5, 3.4, j);
    },
    puffer(t, j) {
      const r = 19 + (j ? Math.abs(Math.sin(t * 9)) * 3 : 0);
      ctx.strokeStyle = '#c47a00'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85); ctx.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6)); ctx.stroke(); }
      ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r - 13, -10 + Math.sin(t * 8) * 3); ctx.lineTo(-r - 13, 10 - Math.sin(t * 8) * 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgrad(0, 0, r, '#fff3a0', '#f29a00'); circle(0, 0, r);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; oval(0, r * 0.38, r * 0.6, r * 0.38);
      eye(r * 0.05, -r * 0.28, 5); eye(r * 0.5, -r * 0.28, 5);
      ctx.fillStyle = '#c0395a'; oval(r * 0.66, r * 0.16, 2.6, j ? 3.4 : 2.2);
      cheek(-r * 0.25, r * 0.12, 3); cheek(r * 0.8, -r * 0.02, 2.4);
      ctx.fillStyle = '#ffcf5a'; ctx.save(); ctx.translate(-r * 0.2, r * 0.3); ctx.rotate(Math.sin(t * 10) * 0.4); oval(-4, 0, 6, 3.5); ctx.restore();
    },
    turtle(t, j) {
      const bob = Math.sin(t * (j ? 10 : 2.5)) * 2;
      ctx.fillStyle = '#7cc96a'; oval(-19, 13, 10, 5, -0.5); oval(16, 14, 10, 5, 0.5);
      ctx.fillStyle = '#8fd16a'; oval(14, -1 + bob, 9, 6, -0.3); circle(24, -6 + bob, 10.5);
      eye(26, -9 + bob, 4.4); cheek(31, -2 + bob, 2.6); smile(28, -1 + bob, 3, j);
      ctx.fillStyle = lgrad(0, -16, 0, 12, '#62c771', '#2f8f4a');
      ctx.beginPath(); ctx.ellipse(-4, 9, 25, 24, 0, Math.PI, TAU); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#256f3a'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6, x = -4 + Math.cos(a) * 8, y = -3 + Math.sin(a) * 7; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.stroke();
      for (const [x0, y0, x1, y1] of [[-11, -1, -24, 4], [3, -1, 16, 4], [-8, -9, -14, -14], [0, -9, 5, -14], [-4, 4, -4, 9]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      ctx.fillStyle = '#d6ec7a'; rrect(-30, 6, 52, 6, 3); ctx.fill();
    },
    seahorse(t, j) {
      ctx.save(); ctx.rotate(Math.sin(t * (j ? 9 : 2)) * (j ? 0.18 : 0.07));
      const col = '#1fc2ad', dark = '#11907e', light = '#a4f2e4';
      ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-3, 14); ctx.quadraticCurveTo(-9, 29, 2, 30); ctx.quadraticCurveTo(11, 30, 7, 22); ctx.stroke();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.quadraticCurveTo(-25, 2, -11, 13); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(17,144,126,0.6)'; ctx.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-10, 0 + k * 3); ctx.lineTo(-18 + k, -1 + k * 4); ctx.stroke(); }
      ctx.fillStyle = col; oval(-2, 4, 11, 16, 0.12);
      ctx.fillStyle = light; oval(3, 6, 5.5, 12, 0.15);
      ctx.strokeStyle = dark; ctx.lineWidth = 1.2;
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(-1, 6 + k * 4); ctx.lineTo(8, 5 + k * 4); ctx.stroke(); }
      ctx.fillStyle = col;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-6 + k * 3.5, -23 - (k % 2)); ctx.lineTo(-4 + k * 3.5, -31 + k); ctx.lineTo(-1 + k * 3.5, -23); ctx.fill(); }
      circle(2, -16, 10);
      ctx.beginPath(); ctx.moveTo(7, -21); ctx.lineTo(22, -18); ctx.quadraticCurveTo(26, -14.5, 22, -11); ctx.lineTo(7, -10); ctx.closePath(); ctx.fill();
      eye(3, -18, 4.8); cheek(7, -11, 2.6);
      ctx.restore();
    },
    whale(t, j) {
      const f = Math.sin(t * (j ? 12 : 3)) * 4;
      ctx.fillStyle = '#3a6fd8';
      ctx.beginPath(); ctx.moveTo(-18, 2); ctx.quadraticCurveTo(-30, -2, -32, -12 + f);
      ctx.quadraticCurveTo(-40, -20 + f, -44, -14 + f); ctx.quadraticCurveTo(-36, -8 + f, -34, -6 + f);
      ctx.quadraticCurveTo(-30, -16 + f, -22, -22 + f); ctx.quadraticCurveTo(-24, -10 + f, -28, -4); ctx.quadraticCurveTo(-24, 6, -16, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lgrad(0, -14, 0, 20, '#6a9cf5', '#2f5fc4'); oval(2, 4, 28, 18);
      ctx.save(); ctx.beginPath(); ctx.ellipse(2, 4, 28, 18, 0, 0, TAU); ctx.clip();
      ctx.fillStyle = '#d6e6ff'; oval(8, 18, 24, 10);
      ctx.strokeStyle = 'rgba(120,150,210,0.7)'; ctx.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-8 + k * 2, 11 + k * 2.5); ctx.lineTo(26, 9 + k * 2.5); ctx.stroke(); }
      ctx.restore();
      eye(14, -2, 4.6); cheek(20, 5, 2.8);
      ctx.strokeStyle = '#1d3f8a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(12, 8); ctx.quadraticCurveTo(22, 12, 29, 4); ctx.stroke();
      const p = (t * (j ? 2.4 : 1.1)) % 1;
      ctx.fillStyle = '#c4ecff';
      for (let i = -1; i <= 1; i++) { const x = 8 + i * 9 * p, y = -18 - 16 * Math.sin(Math.PI * p) + (i ? 4 * p : 0); ctx.globalAlpha = 1 - p * 0.6; circle(x, y, 3 - p); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#c4ecff'; oval(8, -17, 2.5, 4);
    },
    octopus(t, j) {
      const sp = j ? 12 : 4;
      ctx.lineCap = 'round'; ctx.strokeStyle = '#9b5de5';
      for (let k = 0; k < 4; k++) {
        const bx = -9 + k * 6, d = bx < 0 ? -1 : 1, w = Math.sin(t * sp + k) * 4;
        ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(bx, 6); ctx.quadraticCurveTo(bx + d * 4 + w, 18, bx + d * 10, 22 + w * 0.4); ctx.stroke();
      }
      for (const d of [-1, 1]) {
        const w = Math.sin(t * sp + d) * 6;
        ctx.lineWidth = 6.5; ctx.beginPath(); ctx.moveTo(d * 12, 2); ctx.quadraticCurveTo(d * 26, 8, d * 27, -6 + w * 0.5); ctx.quadraticCurveTo(d * 28, -16 + w, d * 21 + w * 0.3, -18 + w); ctx.stroke();
        ctx.fillStyle = '#e6d4ff'; for (let q = 0; q < 3; q++) circle(d * (22 + q * 1.6), 4 - q * 7 + w * q * 0.2, 1.3);
      }
      ctx.fillStyle = rgrad(0, -6, 19, '#c99bff', '#7a3fd0'); oval(0, -6, 18, 17);
      ctx.fillStyle = 'rgba(230,212,255,0.7)'; circle(-9, -16, 2.6); circle(7, -18, 2); circle(11, -11, 1.6);
      eye(-6, -5, 5); eye(6, -5, 5);
      cheek(-12, 2, 3); cheek(12, 2, 3);
      smile(0, 4, 3.6, j);
    },
    jelly(t, j) {
      const pulse = 1 + Math.sin(t * (j ? 12 : 4)) * 0.07;
      ctx.strokeStyle = '#ff7ac8'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.globalAlpha = 0.85;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath(); ctx.moveTo(k * 7, 6);
        for (let q = 1; q <= 5; q++) ctx.lineTo(k * 7 + Math.sin(t * 5 + q * 0.9 + k) * 3.5, 6 + q * 5);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.95;
      const g = ctx.createRadialGradient(-6, -14, 2, 0, -6, 30);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#ffc2ec'); g.addColorStop(1, '#ff7ac8');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-26 * pulse, 6);
      ctx.bezierCurveTo(-28 * pulse, -34, 28 * pulse, -34, 26 * pulse, 6);
      for (let k = 4; k >= -4; k--) ctx.quadraticCurveTo((k + 0.5) * 6 * pulse, 11, k * 6 * pulse, 6);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; oval(-11, -16, 5, 3, -0.5);
      eye(-7, -6, 4.4); eye(7, -6, 4.4);
      cheek(-13, 0, 2.8); cheek(13, 0, 2.8);
      smile(0, 2, 3.2, j);
    },
    starfish(t, j) {
      const rot = -Math.PI / 2 + Math.sin(t * (j ? 10 : 1.5)) * (j ? 0.25 : 0.08);
      ctx.lineJoin = 'round';
      star(0, 2, 27, 12, 5, rot);
      ctx.fillStyle = rgrad(0, 2, 27, '#ffc29a', '#ff6f3c'); ctx.fill();
      ctx.strokeStyle = '#ff6f3c'; ctx.lineWidth = 5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,215,0.85)';
      for (let k = 0; k < 5; k++) { const a = rot + (k * TAU) / 5; for (const d of [14, 21]) circle(Math.cos(a) * d, 2 + Math.sin(a) * d, d === 14 ? 1.9 : 1.4); }
      eye(-5.5, -1, 4.2); eye(5.5, -1, 4.2);
      cheek(-9, 6, 2.4); cheek(9, 6, 2.4);
      smile(0, 7, 3, j);
    },
    dolphin(t, j) {
      ctx.save(); ctx.rotate(-0.1 + Math.sin(t * (j ? 10 : 2.2)) * (j ? 0.14 : 0.05));
      const col = '#86a3c4', dark = '#5b7aa0';
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.quadraticCurveTo(-32, -2, -38, -12); ctx.quadraticCurveTo(-33, -4, -30, 0); ctx.quadraticCurveTo(-34, 5, -40, 10); ctx.quadraticCurveTo(-30, 8, -22, 4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -11); ctx.quadraticCurveTo(-5, -24, -15, -27); ctx.quadraticCurveTo(-11, -18, -16, -10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lgrad(0, -12, 0, 12, '#a4bedb', col); oval(0, 0, 26, 13);
      oval(25, 4, 10, 4.6, 0.12);
      ctx.fillStyle = '#eef4fb'; oval(8, 6, 17, 5.5, 0.05); oval(25, 6, 8, 2.4, 0.12);
      ctx.fillStyle = dark; oval(0, 9, 7, 3.4, 0.6);
      eye(14, -3, 4.2); cheek(19, 3, 2.4);
      ctx.strokeStyle = '#33506e'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(18, 5.5); ctx.quadraticCurveTo(26, 8, 34, 5); ctx.stroke();
      ctx.restore();
    },
  };
  function drawCreature(kind, t, jig) { const f = CREATURE[kind]; if (f) { ctx.save(); f(t, jig); ctx.restore(); } }

  // ---------- the clam ----------
  // Drawn around its cell centre in a 100 x 100 box. The lid hinges along y = HINGE at the back and
  // swings up and over; k is how far its front edge sits below the hinge (1 shut, below 0 standing open).
  const HINGE = -10;
  function lidOuterPath(k) {
    // the lid seen from outside: a scalloped dome from the hinge down to the front lip
    ctx.beginPath();
    const n = 9;
    ctx.moveTo(-50, HINGE);
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI - (i / n) * Math.PI, a1 = Math.PI - ((i + 1) / n) * Math.PI, am = (a0 + a1) / 2;
      ctx.quadraticCurveTo(Math.cos(am) * 56, HINGE + Math.sin(am) * 36 * k, Math.cos(a1) * 50, HINGE + Math.sin(a1) * 32 * k);
    }
    ctx.ellipse(0, HINGE, 50, Math.max(0.01, 14 * k), 0, 0, Math.PI, true);
    ctx.closePath();
  }
  function drawClam(c, time) {
    const sc = c.scale * (c.appear == null ? 1 : backOut(clamp(c.appear, 0, 1)));
    if (sc <= 0.01) return;
    const o = c.open, k = 1 - o * 2.15;           // 1 shut ... -1.15 wide open
    ctx.save();
    ctx.translate(c.x, c.y - (c.lift || 0) * 14);
    if (c.wiggle) ctx.rotate(Math.sin(time * 34) * 0.07 * c.wiggle);
    ctx.scale(sc, sc);

    // glow behind: soft white for the open one she is looking for a partner to, gold once matched
    if (c.selected) glow(0, -4, 72, 'rgba(255,255,255,0.85)', 0.55 + 0.25 * Math.sin(time * 5));
    if (c.matched) glow(0, -6, 66, 'rgba(255,214,90,0.75)', 0.35 + 0.15 * Math.sin(time * 2 + c.x));
    if (c.lift) glow(0, 0, 70, 'rgba(180,240,255,0.9)', c.lift * 0.6);

    // shadow on the sand
    ctx.fillStyle = 'rgba(0,30,50,0.22)'; oval(0, 37, 48 - (c.lift || 0) * 8, 7);

    if (k < 0) {
      // lid standing open behind: we see its pearly inside
      ctx.save(); ctx.translate(0, HINGE); ctx.scale(1, -k);
      ctx.beginPath(); ctx.moveTo(-50, 0);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a0 = Math.PI + (i / n) * Math.PI, a1 = Math.PI + ((i + 1) / n) * Math.PI, am = (a0 + a1) / 2;
        ctx.quadraticCurveTo(Math.cos(am) * 56, Math.sin(am) * 36, Math.cos(a1) * 50, Math.sin(a1) * 32);
      }
      ctx.closePath();
      const ig = ctx.createLinearGradient(0, -32, 0, 0);
      ig.addColorStop(0, c.matched ? '#fff1c4' : '#ffe6f2'); ig.addColorStop(1, c.matched ? '#ffd27a' : '#f6b8d6');
      ctx.fillStyle = ig; ctx.fill();
      ctx.strokeStyle = c.matched ? '#f0b640' : '#ff8fbf'; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.4;
      for (let i = 1; i < 9; i++) { const a = Math.PI + (i / 9) * Math.PI; ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(Math.cos(a) * 42, Math.sin(a) * 26); ctx.stroke(); }
      ctx.restore();
    }

    // the bowl (bottom shell)
    ctx.fillStyle = lgrad(0, 0, 0, 36, '#ffa9cf', '#e8689f');
    ctx.beginPath(); ctx.ellipse(0, 1, 48, 35, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 1, 48, 35, 0, 0, Math.PI); ctx.clip();
    ctx.strokeStyle = 'rgba(190,60,120,0.45)'; ctx.lineWidth = 2;
    for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 3, 46); ctx.lineTo(i * 12, 4); ctx.stroke(); }
    ctx.restore();

    if (o > 0.02) {
      // the pearly inside, the creature sitting in it, then the front lip over the creature's feet
      ctx.fillStyle = c.matched ? rgrad(0, 1, 46, '#fffbe6', '#f7d98c') : rgrad(0, 1, 46, '#ffffff', '#f1c4dc');
      oval(0, 1, 46, 11);
      const rise = smooth(clamp((o - 0.2) / 0.65, 0, 1));
      if (rise > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(-80, -150, 160, 151); ctx.ellipse(0, 1, 46, 11, 0, 0, TAU); ctx.clip();
        const d = c.dance >= 0 ? c.dance : -1, p = c.poke >= 0 ? c.poke : -1;
        let dy = -13 + (1 - rise) * 32, rot = 0, sx = 1, sy = 1;
        if (d >= 0 && d < 1.3) {
          const u = d / 1.3, e = 1 - u * 0.4;
          dy -= Math.abs(Math.sin(u * Math.PI * 3)) * 15 * e;
          rot = Math.sin(u * Math.PI * 6) * 0.28 * e;
          sx = 1 + Math.sin(u * Math.PI * 6) * 0.08 * e; sy = 2 - sx;
        } else if (c.party) {
          const u = time * 1.6 + c.x * 0.01;
          dy -= Math.abs(Math.sin(u * Math.PI)) * 10;
          rot = Math.sin(u * Math.PI * 2) * 0.2;
        } else { dy += Math.sin(time * 2 + c.x * 0.05) * 1.5; }
        if (p >= 0 && p < 0.6) { const u = p / 0.6; sx *= 1 + Math.sin(u * Math.PI * 4) * 0.12 * (1 - u); sy = 2 - sx; dy -= Math.sin(u * Math.PI) * 6; }
        ctx.translate(0, dy); ctx.rotate(rot); ctx.scale(sx * 0.95, sy * 0.95);
        drawCreature(c.kind, time + c.x * 0.013, (d >= 0 && d < 1.3) || !!c.party);
        ctx.restore();
      }
      ctx.strokeStyle = c.matched ? '#ffe9a8' : '#ffd3e8'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.ellipse(0, 1, 46, 11, 0, 0.05, Math.PI - 0.05); ctx.stroke();
    }
    // the bowl's scalloped lip
    ctx.fillStyle = '#ff8fbf';
    for (let i = -4; i <= 4; i++) { const x = i * 10.5, y = 1 + 11 * Math.sqrt(Math.max(0, 1 - (x * x) / 2116)); circle(x, y + 1.5, 3.2); }

    if (k >= 0) {
      // lid shut or just lifting: we see its ridged outside
      lidOuterPath(k);
      ctx.fillStyle = lgrad(0, HINGE - 14 * k, 0, HINGE + 34 * k, '#ffd6e8', '#ff86ba'); ctx.fill();
      ctx.strokeStyle = '#ef6aa6'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); lidOuterPath(k); ctx.clip();
      ctx.strokeStyle = 'rgba(214,70,140,0.42)'; ctx.lineWidth = 2.4;
      for (let i = 1; i < 9; i++) { const a = Math.PI - (i / 9) * Math.PI; ctx.beginPath(); ctx.moveTo(0, HINGE - 12 * k); ctx.lineTo(Math.cos(a) * 54, HINGE + Math.sin(a) * 36 * k); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; oval(-16, HINGE + 2 * k, 13, 5 * k + 0.5, -0.3);
      ctx.restore();
      if (k < 0.97) { ctx.fillStyle = 'rgba(80,10,50,0.35)'; oval(0, HINGE + 30 * k + 3, 40 * (1 - k * 0.3), 3 * (1 - k)); }
    }
    ctx.restore();
  }

  // ---------- the sea ----------
  function drawWater(th, time, drift) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.top); g.addColorStop(1, th.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, H);
    // light rays
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
    // surface shimmer
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(0, 0);
    for (let x = 0; x <= VW + 20; x += 20) ctx.lineTo(x, 12 + Math.sin((x + drift * 0.3) / 40 + time * 2) * 4);
    ctx.lineTo(VW, 0); ctx.closePath(); ctx.fill();
    // far hills
    ctx.fillStyle = th.far;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= VW + 20; x += 20) { const u = x + drift * 0.2; ctx.lineTo(x, 400 + 35 * Math.sin(u / 160) + 18 * Math.sin(u / 57 + 1)); }
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
  function drawSandFloor(th, y0, time, seed) {
    const g = ctx.createLinearGradient(0, y0 - 10, 0, H);
    g.addColorStop(0, th.sand[0]); g.addColorStop(1, th.sand[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-10, H);
    for (let x = -10; x <= VW + 20; x += 16) ctx.lineTo(x, y0 - 4 + 5 * Math.sin(x / 90) + 3 * Math.sin(x / 37));
    ctx.lineTo(VW + 20, H); ctx.closePath(); ctx.fill();
    const tile = 170;
    for (let i = 0; i <= Math.ceil(VW / tile); i++) {
      const R = rngAt(i, 7 + (seed || 0)), x = i * tile + R() * 120, y = y0 + 12 + R() * 18, k = R();
      if (k < 0.3) { ctx.fillStyle = '#ff8a5c'; star(x, y, 9, 4, 5, R() * 3); ctx.fill(); }
      else if (k < 0.55) { ctx.fillStyle = '#fff0e0'; ctx.beginPath(); ctx.ellipse(x, y, 8, 6, 0, Math.PI, 0); ctx.fill(); }
      else if (k < 0.8) { ctx.fillStyle = 'rgba(0,0,0,0.15)'; for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.ellipse(x + j * 9, y + (j % 2) * 3, 5, 3.5, 0, 0, TAU); ctx.fill(); } }
    }
  }
  // A sandy rock shelf under each row of shells.
  function drawLedge(th, x0, x1, y, h, i) {
    const R = rngAt(i, 21);
    ctx.fillStyle = th.rock[1]; rrect(x0, y - 2, x1 - x0, h + 4, h * 0.6); ctx.fill();
    ctx.fillStyle = th.rock[0]; rrect(x0 + 3, y - 2, x1 - x0 - 6, h * 0.8, h * 0.45); ctx.fill();
    ctx.fillStyle = th.sand[0]; rrect(x0 - 2, y - 6, x1 - x0 + 4, h * 0.55, h * 0.3); ctx.fill();
    ctx.fillStyle = th.rock[2]; ctx.globalAlpha = 0.5;
    for (let k = 0; k < (x1 - x0) / 60; k++) oval(x0 + 14 + R() * (x1 - x0 - 28), y + h * 0.55 + R() * h * 0.3, 4 + R() * 5, 2 + R() * 2);
    ctx.globalAlpha = 1;
    for (const ex of [x0 + 6, x1 - 6]) for (let k = 0; k < 3; k++) { ctx.fillStyle = th.tip[Math.floor(R() * th.tip.length)]; circle(ex + (R() - 0.5) * 18, y - 6 + R() * 6, 4 + R() * 4); }
  }
  function seaweed(x, y, h, time, col, ph) {
    ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 1; k <= 7; k++) ctx.lineTo(x + Math.sin(time * 1.2 + k * 0.6 + ph) * k * 1.8, y - (h * k) / 7);
    ctx.stroke();
  }

  // ---------- particles (from render.js, plus pearls and music notes) ----------
  function spawn(p) { if (parts.length < 700) parts.push(p); }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(type, x, y) {
    if (type === 'spark') for (let i = 0; i < 12; i++) spawn({ t: 'spark', x, y, vx: rnd(-170, 170), vy: rnd(-190, 80), life: 0.6, max: 0.6, c: i % 2 ? '#fff6a0' : '#fff', r: rnd(3, 7) });
    if (type === 'match') {
      for (let i = 0; i < 14; i++) spawn({ t: 'spark', x, y, vx: rnd(-220, 220), vy: rnd(-240, 60), life: 0.8, max: 0.8, c: i % 3 ? '#ffe066' : '#fff', r: rnd(4, 8) });
      for (let i = 0; i < 3; i++) spawn({ t: 'note', x: x + rnd(-20, 20), y: y - 20, vx: rnd(-30, 30), vy: rnd(-90, -60), life: 1.3, max: 1.3, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], r: rnd(0.9, 1.3), ph: Math.random() * 6 });
    }
    if (type === 'bubbles') for (let i = 0; i < 10; i++) spawn({ t: 'bubble', x: x + rnd(-30, 30), y: y + rnd(-10, 10), vx: rnd(-20, 20), vy: rnd(-110, -50), life: 1, max: 1, r: rnd(2, 6) });
    if (type === 'pearl') for (let i = 0; i < 10; i++) spawn({ t: 'spark', x, y, vx: rnd(-120, 120), vy: rnd(-120, 120), life: 0.5, max: 0.5, c: i % 2 ? '#ffe9fb' : '#fff', r: rnd(2.5, 5) });
    if (type === 'cheer') for (let i = 0; i < 6; i++) spawn({ t: i % 2 ? 'heart' : 'spark', x: x + rnd(-40, 40), y: y + rnd(-30, 10), vx: rnd(-50, 50), vy: rnd(-140, -70), life: 1, max: 1, c: '#fff6a0', r: rnd(5, 9) });
  }
  // the treasure burst: coins and pearls leap out and bounce on the sand, with confetti
  function fountain(x, y, n, floor) {
    for (let i = 0; i < n; i++) {
      const pearl = i % 3 === 0;
      spawn({ t: pearl ? 'gpearl' : 'gcoin', x: x + (Math.random() - 0.5) * 60, y, vx: (Math.random() - 0.5) * 560, vy: -460 - Math.random() * 520, life: 3.2, max: 3.2, r: pearl ? 8 + Math.random() * 4 : 9 + Math.random() * 5, ph: Math.random() * 6, floor: floor || 515 });
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

  // ---------- frames ----------
  function drawTray(tray, time) {
    if (!tray || !tray.slots.length) return;
    const b = tray.box;
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; rrect(b.x, b.y, b.w, b.h, Math.min(24, b.h / 2)); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.5; ctx.stroke();
    for (const sl of tray.slots) {
      if (sl.filled) drawPearl(sl.x, sl.y, sl.r * (1 + 0.25 * sl.pop), 0.25 + 0.6 * sl.pop + 0.1 * Math.sin(time * 3 + sl.x));
      else { ctx.fillStyle = 'rgba(0,40,80,0.18)'; circle(sl.x, sl.y, sl.r * 0.8); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r * 0.8, 0, TAU); ctx.stroke(); }
    }
  }
  // a pointing hand whose fingertip taps at (x, y)
  function drawHand(x, y, size, time) {
    const by = y - Math.abs(Math.sin(time * 3.2)) * size * 0.35;
    ctx.save(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; // colour emoji take their alpha from the fill colour
    ctx.font = `${Math.round(size)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F446}', x + size * 0.08, by + size * 0.48);
    ctx.restore();
  }

  function drawPlay(v, time, dt) {
    const th = THEMES[v.theme % THEMES.length];
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 18);
    drawBubbles(time, time * 18);
    const lay = v.layout, bd = lay.board;
    // seaweed waving at the board's sides, then the sea floor
    for (let i = 0; i < 3; i++) seaweed(bd.x - 18 - i * 14, 540, 120 + i * 40, time, i % 2 ? '#3fae6a' : '#2f8f5a', i);
    for (let i = 0; i < 3; i++) seaweed(bd.x + bd.w + 18 + i * 14, 540, 110 + i * 46, time, i % 2 ? '#3fae6a' : '#2f8f5a', i + 3);
    drawSandFloor(th, 520, time, v.theme);
    // a shelf under each row of shells
    for (let r = 0; r < lay.rows; r++) {
      const sc = v.shells[0] ? v.shells[0].scale : 1, y = lay.board.y + (r + 0.5) * lay.cellH + 34 * sc;
      drawLedge(th, bd.x - 10, bd.x + bd.w + 10, y, Math.max(10, lay.cellH * 0.1), r);
    }
    // shells, back row first; ones on the move go on top
    for (const c of v.shells) if (!c.moving) drawClam(c, time);
    for (const c of v.shells) if (c.moving) drawClam(c, time);
    if (v.isabella) {
      const I = v.isabella;
      if (I.happy) glow(I.x + 10 * I.scale, I.y, 70 * I.scale, 'rgba(255,230,150,0.6)', 0.5);
      drawIsabella(I.x, I.y, time, I);
    }
    drawTray(v.tray, time);
    for (const f of v.flying) drawPearl(f.x, f.y, f.r, 0.8);
    drawParts();
    if (v.hand) drawHand(v.hand.x, v.hand.y, v.hand.size, time);
  }

  // level-select backdrop: the shallows, with Isabella swimming and two clams on the sand
  function drawMenu(time, dt, m) {
    const th = THEMES[0];
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 22);
    drawBubbles(time, time * 22);
    for (let i = 0; i < 4; i++) seaweed(30 + i * 22, 540, 110 + (i % 2) * 70, time, i % 2 ? '#3fae6a' : '#2f8f5a', i);
    for (let i = 0; i < 4; i++) seaweed(VW - 30 - i * 22, 540, 120 + (i % 2) * 60, time, i % 2 ? '#3fae6a' : '#2f8f5a', i + 5);
    drawSandFloor(th, 492, time, 0);
    const side = (VW - m.gridW) / 2;
    const clamOpen = (ph) => clamp(0.5 + 0.9 * Math.sin(time * 0.9 + ph), 0, 1);
    if (side > 300) {
      drawClam({ x: side / 2, y: 452, scale: 1.25, open: clamOpen(0), kind: 'starfish' }, time);
      drawClam({ x: VW - side / 2, y: 452, scale: 1.25, open: clamOpen(2.2), kind: 'whale' }, time);
      const ix = side * 0.5 + Math.sin(time * 0.6) * 30, iy = 250 + Math.sin(time * 1.1) * 26;
      drawIsabella(ix, iy, time, { scale: Math.min(1.7, side / 200), tilt: Math.cos(time * 1.1) * 0.1, swim: 7 });
    } else {
      drawClam({ x: 70, y: 486, scale: 0.75, open: clamOpen(0), kind: 'starfish' }, time);
      drawClam({ x: VW - 70, y: 486, scale: 0.75, open: clamOpen(2.2), kind: 'whale' }, time);
      // she swims across the bottom, turning at each end
      const span = VW - 260, ph = (time * 70) % (2 * span), fwd = ph < span, x = 130 + (fwd ? ph : 2 * span - ph);
      drawIsabella(x, 472 + Math.sin(time * 2) * 6, time, { scale: 0.85, flip: !fwd, swim: 8 });
    }
    drawParts();
  }

  // a big sheet of every creature and every shell state, for looking at the art (test/games/match/sheet.html)
  function drawSheet(time, kinds) {
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(THEMES[0], time, 0);
    kinds.forEach((k, i) => {
      const x = 110 + (i % 5) * 210, y = 130 + Math.floor(i / 5) * 160;
      ctx.save(); ctx.translate(x, y); ctx.scale(1.6, 1.6); drawCreature(k, time, false); ctx.restore();
    });
    const opens = [0, 0.15, 0.35, 0.6, 1];
    opens.forEach((o, i) => drawClam({ x: 110 + i * 210, y: 450, scale: 1.2, open: o, kind: 'octopus', selected: i === 4 }, time));
  }

  window.MatchArt = {
    init, resize, toWorld, toCss, drawPlay, drawMenu, drawSheet, burst, fountain, drawCreature,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; },
    THEMES, H,
  };
})();
