/* Treasure Blocks — everything you see, drawn in code. The house style is copied (never shared) from the other
 * games: the 540-unit-tall world scaled to the screen with the device pixel ratio capped at 2.5, the glow sprite,
 * the sea, the small swimming Isabella, the gold coin, the key, the treasure chest and the particles from Sea Words'
 * art.js (which took them from Coral Maze and the main game's render.js); the fish, turtle and seahorse from Bubble
 * Party's art.js. New here: the big picture of Isabella behind the well (the same girl: brown hair with a star clip,
 * rainbow tail, purple shell top, pink pearls), the mist over it, the six sea blocks and the well itself.
 *
 * Speed: the picture (clear, and misty) is painted once per round into two canvases, each block look once per size
 * into a little sprite; a frame stamps those and draws only what moves. */
(function () {
  'use strict';
  const L = BlocksLogic;
  const H = 540, TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const backOut = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SKIN = '#f7cdb0', SKIN_SH = '#eab594', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38', HAIR_LO = '#55290f', GOLD = '#ffcc33', NAVY = '#1d3557';
  const FONT = 'system-ui, Roboto, "Segoe UI", sans-serif';

  // the sea for each screen (colours from the main game's THEMES)
  const THEMES = {
    menu: { top: '#7fe3f0', bot: '#1f8fc0', far: 'rgba(28,118,170,0.55)', sand: ['#f9e4ab', '#e0bd78'], rock: ['#c99f78', '#a07b58'], tip: ['#ff8fab', '#ffd166', '#ff6b6b', '#c77dff'], ray: 0.22 },
    easy: { top: '#86e6f2', bot: '#1f8fc0', far: 'rgba(28,118,170,0.5)', sand: ['#fbe8b4', '#e2c07c'], ray: 0.2 },
    medium: { top: '#62c6f2', bot: '#145ea8', far: 'rgba(15,70,130,0.5)', sand: ['#f3e0b0', '#d7bd86'], ray: 0.2 },
    hard: { top: '#a79cf2', bot: '#33307f', far: 'rgba(40,30,100,0.55)', sand: ['#e4d8f2', '#b9a7d6'], ray: 0.14 },
  };

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  const parts = [], amb = [], drifters = [];
  // what the last frame of play really drew (counted where it is drawn; the tests read it)
  const drawn = { stack: 0, piece: 0, ghost: 0, clearRows: 0, mistRows: 0, wave: 0 };

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d');
    for (let i = 0; i < 30; i++) amb.push({ x: Math.random() * 2400, y: Math.random() * H, r: 1 + Math.random() * 3, sp: 10 + Math.random() * 30, ph: Math.random() * TAU });
    // sea blocks sink slowly down the two sides of the picker, clear of its buttons
    for (let i = 0; i < 8; i++) drifters.push({ x: i < 4 ? 0.13 + (i % 2) * 0.05 : 0.82 + (i % 2) * 0.05, y0: Math.random() * 700, sp: 16 + Math.random() * 14, size: 34 + Math.random() * 18, look: 1 + (i % L.STYLES), ph: Math.random() * TAU });
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    s = canvas.height / H; VW = canvas.width / s;
    clearCaches();
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toCss = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });

  // ---------- helpers (from render.js, via Coral Maze and Sea Words) ----------
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
  function rrect(x, y, w, h, r) { w = Math.max(0, w); h = Math.max(0, h); r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function oval(x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fill(); }
  function withCtx(g, fn) { const keep = ctx; ctx = g; try { fn(); } finally { ctx = keep; } }
  const shadeCache = new Map();
  function shade(hex, k) {
    const key = hex + k; let v = shadeCache.get(key);
    if (v) return v;
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    v = `rgb(${r | 0},${g | 0},${b | 0})`; shadeCache.set(key, v); return v;
  }
  const palCache = new Map();
  function pal(c) {
    let p = palCache.get(c);
    if (!p) { p = { base: c, dark: shade(c, -0.28), light: shade(c, 0.5) }; palCache.set(c, p); }
    return p;
  }

  // ---------- faces and sea friends (from Bubble Party's art.js) ----------
  function eye(x, y, r, blink) {
    if (blink) { ctx.strokeStyle = '#2a1a2e'; ctx.lineWidth = r * 0.42; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(x, y - r * 0.3, r * 0.8, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); return; }
    ctx.fillStyle = '#2a1a2e'; ctx.beginPath(); ctx.ellipse(x, y, r * 0.82, r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + r * 0.26, y - r * 0.4, r * 0.34, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.24, y + r * 0.36, r * 0.15, 0, TAU); ctx.fill();
  }
  function cheek(x, y, r) { ctx.fillStyle = 'rgba(255,105,150,0.45)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.68, 0, 0, TAU); ctx.fill(); }
  function smile(x, y, w, open) {
    if (open) {
      ctx.fillStyle = '#b8325a'; ctx.beginPath(); ctx.moveTo(x - w, y - w * 0.25); ctx.quadraticCurveTo(x, y + w * 1.7, x + w, y - w * 0.25); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff8fab'; ctx.beginPath(); ctx.ellipse(x, y + w * 0.42, w * 0.42, w * 0.2, 0, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = '#4a1a2a'; ctx.lineWidth = Math.max(1.8, w * 0.42); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y - w * 0.45, w, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    }
  }
  // each is drawn facing right in a box about 80 units across
  const CRE = {
    fish(c, t, happy) {
      const p = pal(c), wag = Math.sin(t * 7) * 5;
      ctx.fillStyle = p.dark;
      ctx.beginPath(); ctx.moveTo(-20, 0); ctx.quadraticCurveTo(-34, -4, -45, -21 + wag); ctx.quadraticCurveTo(-38, 0, -45, 21 + wag); ctx.quadraticCurveTo(-34, 4, -20, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-16, -17); ctx.quadraticCurveTo(-4, -38, 14, -19); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.base;
      ctx.beginPath(); ctx.ellipse(0, 0, 31, 24, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-6, 0, 5.5, 22.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(4, 11, 18, 7.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.dark;
      ctx.save(); ctx.translate(-1, 8); ctx.rotate(0.6 + Math.sin(t * 9) * 0.35); ctx.beginPath(); ctx.ellipse(-7, 0, 9, 4.8, 0, 0, TAU); ctx.fill(); ctx.restore();
      eye(15, -6, 7, false); cheek(9, 8, 4.2); smile(21, 7, 5, happy);
    },
    turtle(c, t, happy) {
      const p = pal(c), skin = shade(c, 0.42), fl = Math.sin(t * 3) * 0.45;
      ctx.fillStyle = skin;
      ctx.save(); ctx.translate(-18, 12); ctx.rotate(0.5 - fl * 0.5); ctx.beginPath(); ctx.ellipse(-6, 4, 12, 6, 0, 0, TAU); ctx.fill(); ctx.restore();
      ctx.save(); ctx.translate(12, 12); ctx.rotate(0.7 + fl); ctx.beginPath(); ctx.ellipse(4, 8, 15, 6.5, 0, 0, TAU); ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.moveTo(-26, 3); ctx.lineTo(-39, 9); ctx.lineTo(-26, 11); ctx.fill();
      ctx.beginPath(); ctx.arc(29, -3, 12.5, 0, TAU); ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(-2, 5, 29, 27, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.dark; rrect(-33, 2, 62, 9, 4.5); ctx.fill();
      ctx.fillStyle = p.light;
      ctx.beginPath(); ctx.ellipse(-2, -10, 8.5, 6.5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-18, -3, 6.5, 5.5, 0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(14, -3, 6.5, 5.5, -0.4, 0, TAU); ctx.fill();
      eye(31, -6, 4.8, false); cheek(26, 3, 3.3); smile(35, 2, 3.8, happy);
    },
    seahorse(c, t, happy) {
      const p = pal(c);
      ctx.strokeStyle = p.base; ctx.lineCap = 'round'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(-3, 18); ctx.quadraticCurveTo(-9, 37, 4, 39); ctx.quadraticCurveTo(13, 39, 10, 30); ctx.stroke();
      const fl = Math.sin(t * 14) * 3;
      ctx.fillStyle = p.light; ctx.beginPath(); ctx.moveTo(-9, -6); ctx.quadraticCurveTo(-27 + fl, 2, -10, 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(0, 2, 12.5, 20, 0.15, 0, TAU); ctx.fill();
      ctx.strokeStyle = p.light; ctx.lineWidth = 2.2;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(5, -6 + k * 7, 6.5, -0.7, 0.7); ctx.stroke(); }
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.arc(3, -22, 11.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = p.base; ctx.lineWidth = 7.5; ctx.beginPath(); ctx.moveTo(10, -21); ctx.lineTo(25, -17); ctx.stroke();
      ctx.fillStyle = p.dark;
      for (let k = 0; k < 3; k++) {
        const a = -2.25 + k * 0.45;
        ctx.beginPath(); ctx.moveTo(3 + Math.cos(a - 0.22) * 10, -22 + Math.sin(a - 0.22) * 10); ctx.lineTo(3 + Math.cos(a) * 17, -22 + Math.sin(a) * 17); ctx.lineTo(3 + Math.cos(a + 0.22) * 10, -22 + Math.sin(a + 0.22) * 10); ctx.fill();
      }
      eye(6, -24, 5.2, false); cheek(4, -15, 3.4);
      if (happy) { ctx.fillStyle = '#b8325a'; ctx.beginPath(); ctx.arc(27, -16.5, 2.8, 0, TAU); ctx.fill(); }
    },
  };
  function creature(kind, col, x, y, sc, flip, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -sc : sc, sc);
    CRE[kind](col, t || 0.4, true);
    ctx.restore();
  }

  // ---------- coin, pearl, key, chest (from Coral Maze's art.js) ----------
  function drawCoin(x, y, ph, r) {
    r = r || 13;
    const sx = 0.3 + 0.7 * Math.abs(Math.cos(ph));
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
    ctx.fillStyle = '#c98a00'; ctx.beginPath(); ctx.arc(0, r * 0.115, r, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 1, 0, 0, r);
    g.addColorStop(0, '#fff6b0'); g.addColorStop(0.45, '#ffd633'); g.addColorStop(1, '#e8a200');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(180,110,0,0.75)'; ctx.lineWidth = Math.max(1.6, r * 0.12); ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, TAU); ctx.stroke();
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

  // ---------- the small swimming Isabella (copied from Coral Maze's art.js, as in Sea Words) ----------
  function drawIsabella(x, y, time, o) {
    o = o || {};
    ctx.save();
    ctx.translate(x, y); ctx.rotate(o.tilt || 0);
    const sc = o.scale || 0.92; ctx.scale(o.flip ? -sc : sc, sc);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    const sw = time * (o.swim || 7);
    const hw1 = Math.sin(sw * 0.6) * 3, hw2 = Math.sin(sw * 0.6 - 1.2) * 6;
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
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.1;
    for (let i = 1; i < N - 1; i++) {
      const p = pts[i];
      for (const j of i % 2 ? [-0.45, 0.45] : [0]) { ctx.beginPath(); ctx.arc(p.x + 2, p.y + j * p.w, p.w * 0.38, -1.25, 1.25); ctx.stroke(); }
    }
    for (let i = 2; i < N - 1; i += 3) {
      const p = pts[i], tw = 0.5 + 0.5 * Math.sin(time * 5 + i * 1.7);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + tw * 0.6})`;
      star(p.x, p.y - p.w * 0.3, 2.4 * tw + 0.8, 0.8, 4, 0); ctx.fill();
    }
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
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.ellipse(13, -1, 15, 10, -0.08, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff7ab8';
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(4, k * 5.2 + 1, 3.4, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#c86bfa';
    ctx.beginPath(); ctx.ellipse(19, 3, 6.5, 5.5, 0.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f0d4ff'; ctx.lineWidth = 0.9;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(16, 6); ctx.lineTo(19 + k * 2.4, -1.5); ctx.stroke(); }
    const armA = Math.sin(sw * 0.5) * 0.25;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(21, -2);
    if (o.happy) ctx.quadraticCurveTo(30, -20, 40 + armA * 6, -34);
    else ctx.quadraticCurveTo(32, 8 + armA * 10, 45, 6 + armA * 14);
    ctx.stroke();
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(33, -13, 14.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(22, -12, 3, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,150,0.45)';
    ctx.beginPath(); ctx.arc(29, -7.5, 3.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(44, -7.5, 2.8, 0, TAU); ctx.fill();
    const blink = (time % 3.7) < 0.12;
    for (const ex of [32, 41]) {
      if (blink) { ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(ex, -14, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); continue; }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, -14, 3.7, 4.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.arc(ex + 0.9, -13.6, 2.9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1d0f06'; ctx.beginPath(); ctx.arc(ex + 1, -13.5, 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 2, -15.2, 1.1, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a170a'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.ellipse(ex, -14, 3.9, 4.8, 0, -2.6, -0.35); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + 2.6, -17.8); ctx.lineTo(ex + 4.6, -19.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + 3.6, -16.4); ctx.lineTo(ex + 5.6, -17.4); ctx.stroke();
    }
    ctx.strokeStyle = '#d99878'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(37.5, -9.5, 1.3, -0.2, 1.6); ctx.stroke();
    if (o.happy) { ctx.fillStyle = '#c0395a'; ctx.beginPath(); ctx.arc(37, -6, 3.6, 0, Math.PI); ctx.fill(); }
    else { ctx.strokeStyle = '#c0395a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(37, -7.6, 3.3, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = HAIR;
    ctx.beginPath(); ctx.moveTo(19, -9);
    ctx.bezierCurveTo(15, -31, 45, -37, 48.5, -15);
    ctx.bezierCurveTo(46, -20, 43, -19, 41, -23);
    ctx.bezierCurveTo(38, -18.5, 34, -18.5, 31.5, -23.5);
    ctx.bezierCurveTo(29, -19, 25, -18, 23, -21);
    ctx.bezierCurveTo(21.5, -16, 21.5, -12, 19, -9);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(20, -15);
    ctx.bezierCurveTo(14, -4 + hw1 * 0.4, 17, 4, 12, 11 + hw1 * 0.6);
    ctx.bezierCurveTo(21, 5, 24, -4, 25, -13);
    ctx.fill();
    ctx.strokeStyle = HAIR_HI; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(32, -16, 12, -2.6, -1.4); ctx.stroke();
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

  // ---------- the sea (from Coral Maze's art.js) ----------
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
    ctx.beginPath();
    for (const a of amb) {
      const x = ((((a.x - drift * 0.7) % (VW + 40)) + VW + 40) % (VW + 40)) - 20, y = ((((a.y - time * a.sp) % H) + H) % H);
      ctx.moveTo(x + Math.sin(time + a.ph) * 4 + a.r, y); ctx.arc(x + Math.sin(time + a.ph) * 4, y, a.r, 0, TAU);
    }
    ctx.stroke();
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

  // ---------- the six sea blocks, each painted in a 100-unit box ----------
  const LOOKS = [null,
    { name: 'shell', base: '#ff7fb6', light: '#ffc6de', dark: '#d94a8a' },
    { name: 'coral', base: '#ff8552', light: '#ffc9ad', dark: '#d2541f' },
    { name: 'sand', base: '#f7c948', light: '#ffeeb0', dark: '#cf9412' },
    { name: 'bubble', base: '#4cc9f0', light: '#c2f0ff', dark: '#1787b8' },
    { name: 'kelp', base: '#52d08a', light: '#bdf3d2', dark: '#1f9457' },
    { name: 'star', base: '#a98bff', light: '#e0d5ff', dark: '#6f4fd0' },
  ];
  function paintBlock(k) {
    const B = LOOKS[k];
    ctx.fillStyle = B.dark; rrect(3, 6, 94, 91, 22); ctx.fill();
    const g = ctx.createLinearGradient(0, 3, 0, 90);
    g.addColorStop(0, B.light); g.addColorStop(0.42, B.base); g.addColorStop(1, B.base);
    ctx.fillStyle = g; rrect(3, 3, 94, 86, 21); ctx.fill();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (B.name === 'shell') {
      // a scallop: a fan with ribs
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.beginPath(); ctx.moveTo(50, 78);
      for (let i = 0; i <= 5; i++) { const a = Math.PI * (1.14 + 0.72 * i / 5), am = Math.PI * (1.14 + 0.72 * (i - 0.5) / 5); if (i) ctx.quadraticCurveTo(50 + Math.cos(am) * 50, 78 + Math.sin(am) * 50, 50 + Math.cos(a) * 43, 78 + Math.sin(a) * 43); else ctx.lineTo(50 + Math.cos(a) * 43, 78 + Math.sin(a) * 43); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = B.base; ctx.lineWidth = 3.2;
      for (let i = 1; i < 5; i++) { const a = Math.PI * (1.14 + 0.72 * i / 5); ctx.beginPath(); ctx.moveTo(50, 76); ctx.lineTo(50 + Math.cos(a) * 40, 78 + Math.sin(a) * 40); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.82)'; rrect(40, 74, 20, 9, 4); ctx.fill();
    } else if (B.name === 'coral') {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      const br = (x, y, len, a, d) => {
        const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
        ctx.lineWidth = 4.5 + d * 2.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        if (d > 0) { br(ex, ey, len * 0.72, a - 0.55, d - 1); br(ex, ey, len * 0.72, a + 0.55, d - 1); }
      };
      br(50, 82, 22, -Math.PI / 2, 2);
    } else if (B.name === 'sand') {
      // a little sandcastle
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(27, 50, 46, 30);
      for (const x of [27, 45, 63]) ctx.fillRect(x, 39, 10, 13);
      ctx.fillStyle = B.dark; ctx.beginPath(); ctx.arc(50, 80, 8, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(50, 40); ctx.lineTo(50, 21); ctx.stroke();
      ctx.fillStyle = '#ff5c8a'; ctx.beginPath(); ctx.moveTo(51, 20); ctx.lineTo(68, 26); ctx.lineTo(51, 32); ctx.closePath(); ctx.fill();
    } else if (B.name === 'bubble') {
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; circle(48, 54, 25);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(48, 54, 25, 0, TAU); ctx.stroke();
      ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(48, 54, 16, Math.PI * 1.08, Math.PI * 1.45); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(76, 30, 7, 0, TAU); ctx.stroke();
    } else if (B.name === 'kelp') {
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      for (const [x, lean, top] of [[38, -9, 24], [60, 9, 34]]) {
        ctx.beginPath(); ctx.moveTo(x - 5, 84);
        ctx.bezierCurveTo(x - 16, 66, x + lean + 12, 52, x + lean, top);
        ctx.bezierCurveTo(x + lean + 22, 50, x - 2, 68, x + 7, 84);
        ctx.closePath(); ctx.fill();
      }
    } else {
      // a starfish
      ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = 8;
      star(50, 55, 27, 12, 5, -Math.PI / 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = B.base;
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * TAU) / 5; circle(50 + Math.cos(a) * 16, 55 + Math.sin(a) * 16, 2.6); }
      circle(50, 55, 3.2);
    }
    // the shine along the top
    ctx.fillStyle = 'rgba(255,255,255,0.42)'; rrect(12, 8, 76, 12, 6); ctx.fill();
  }
  const blockCache = new Map();
  function blockSprite(look, size) {
    const px = Math.max(6, Math.round(size * s)), key = look + ':' + px;
    let c = blockCache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = px;
      withCtx(c.getContext('2d'), () => { ctx.setTransform(px / 100, 0, 0, px / 100, 0, 0); paintBlock(look); });
      blockCache.set(key, c);
    }
    return c;
  }
  function drawBlock(look, x, y, size) { ctx.drawImage(blockSprite(look, size), x, y, size, size); }

  // ---------- the big picture of Isabella, painted in a box 300 wide and 450 tall ----------
  // Three scenes, one per round in turn: a sunny lagoon, the deep blue, and a violet evening.
  const SCENES = [
    { top: '#a4f2f6', bot: '#1c93cb', far: 'rgba(24,120,176,0.5)', sand: ['#fbe8b4', '#e6c482'], coral: ['#ff8fab', '#ffd166', '#ff6b6b'], weed: '#2f9f6a', ray: 0.3, friend: 'fish' },
    { top: '#86d6fb', bot: '#1657a6', far: 'rgba(14,66,130,0.55)', sand: ['#f3e0b0', '#d7bd86'], coral: ['#ffd166', '#ff8fab', '#8ce99a'], weed: '#2a8f8a', ray: 0.26, friend: 'turtle' },
    { top: '#cdbcfb', bot: '#3a3294', far: 'rgba(44,32,110,0.6)', sand: ['#e9defa', '#bba9dc'], coral: ['#ff7ad9', '#7afcff', '#ffd166'], weed: '#5a62c8', ray: 0.2, friend: 'seahorse' },
  ];
  // her tail: a line from her waist down and round to the left, flicking up at the end
  function tailSpine() {
    const pts = [], segs = [[150, 260, 150, 304, 186, 322, 174, 360], [174, 360, 164, 396, 110, 420, 72, 388]];
    for (let k = 0; k < 2; k++) {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = segs[k];
      for (let i = k ? 1 : 0; i <= 14; i++) {
        const t = i / 14, m = 1 - t;
        pts.push({ x: m * m * m * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3, y: m * m * m * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3 });
      }
    }
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], u = i / (n - 1);
      pts[i].a = Math.atan2(b.y - a.y, b.x - a.x);
      pts[i].w = u < 0.14 ? lerp(26, 30, u / 0.14) : lerp(30, 6.5, Math.pow((u - 0.14) / 0.86, 0.85));
    }
    return pts;
  }
  function paintIsabella(crown) {
    // ---- her hair, flowing out behind her ----
    ctx.fillStyle = HAIR;
    ctx.beginPath();
    ctx.moveTo(150, 58);
    ctx.bezierCurveTo(92, 54, 62, 100, 70, 152);
    ctx.bezierCurveTo(76, 200, 50, 222, 32, 262);
    ctx.bezierCurveTo(24, 286, 32, 304, 46, 312);
    ctx.bezierCurveTo(44, 292, 58, 276, 76, 270);
    ctx.bezierCurveTo(66, 298, 72, 324, 92, 338);
    ctx.bezierCurveTo(88, 310, 100, 286, 120, 268);
    ctx.lineTo(182, 268);
    ctx.bezierCurveTo(204, 288, 228, 292, 250, 280);
    ctx.bezierCurveTo(234, 272, 228, 256, 230, 240);
    ctx.bezierCurveTo(246, 252, 266, 246, 276, 226);
    ctx.bezierCurveTo(254, 226, 238, 206, 232, 176);
    ctx.bezierCurveTo(240, 116, 208, 56, 150, 58);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = HAIR_HI; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (const q of [[84, 160, 82, 208, 56, 232, 42, 272], [96, 190, 96, 228, 78, 250, 84, 300], [222, 170, 228, 210, 244, 228, 262, 232], [214, 196, 216, 236, 228, 262, 240, 274]]) {
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.bezierCurveTo(q[2], q[3], q[4], q[5], q[6], q[7]); ctx.stroke();
    }
    ctx.strokeStyle = HAIR_LO; ctx.lineWidth = 2.4;
    for (const q of [[76, 176, 74, 214, 52, 240, 38, 282], [230, 186, 236, 216, 252, 234, 268, 230]]) {
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.bezierCurveTo(q[2], q[3], q[4], q[5], q[6], q[7]); ctx.stroke();
    }

    // ---- her rainbow tail ----
    const sp = tailSpine(), n = sp.length;
    const tip = sp[n - 1];
    // the fin first, so the tail's end sits on it
    ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(tip.a); ctx.scale(2.5, 2.5);
    const fg = ctx.createLinearGradient(0, 0, 32, 0);
    fg.addColorStop(0, '#c86bfa'); fg.addColorStop(0.5, '#ff6bcb'); fg.addColorStop(1, '#7fdcff');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(-4, 0);
    ctx.bezierCurveTo(8, -6, 18, -22, 32, -27);
    ctx.bezierCurveTo(25, -12, 23, -4, 17, 0);
    ctx.bezierCurveTo(23, 4, 25, 12, 32, 27);
    ctx.bezierCurveTo(18, 22, 8, 6, -4, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    for (const k of [-1, 1]) for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(24 + r * 2, k * (10 + r * 6)); ctx.stroke(); }
    ctx.restore();
    const grad = ctx.createLinearGradient(158, 258, 84, 404);
    RAINBOW.forEach((c, i) => grad.addColorStop(i / (RAINBOW.length - 1), c));
    ctx.fillStyle = grad;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const p = sp[i]; ctx.lineTo(p.x + Math.cos(p.a - Math.PI / 2) * p.w, p.y + Math.sin(p.a - Math.PI / 2) * p.w); }
    for (let i = n - 1; i >= 0; i--) { const p = sp[i]; ctx.lineTo(p.x + Math.cos(p.a + Math.PI / 2) * p.w, p.y + Math.sin(p.a + Math.PI / 2) * p.w); }
    ctx.closePath(); ctx.fill();
    // a soft light down one side, scales, and a few twinkles
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < n - 2; i++) { const p = sp[i]; ctx.lineTo(p.x + Math.cos(p.a + Math.PI / 2) * p.w * 0.62, p.y + Math.sin(p.a + Math.PI / 2) * p.w * 0.62); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    for (let i = 2; i < n - 2; i++) {
      const p = sp[i];
      for (const j of i % 2 ? [-0.5, 0.5] : [-0.95, 0, 0.95]) {
        if (Math.abs(j) > 0.9 && p.w < 16) continue;
        const cx = p.x + Math.cos(p.a + Math.PI / 2) * j * p.w * 0.8, cy = p.y + Math.sin(p.a + Math.PI / 2) * j * p.w * 0.8;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(2.5, p.w * 0.3), p.a - 1.2, p.a + 1.2); ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const i of [4, 9, 15, 21]) { const p = sp[i]; star(p.x + 5, p.y - 3, 5, 1.6, 4, 0.2); ctx.fill(); }

    // ---- her body ----
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.moveTo(140, 180); ctx.lineTo(140, 200);
    ctx.bezierCurveTo(128, 204, 115, 208, 114, 221);
    ctx.bezierCurveTo(116, 240, 124, 252, 124, 266);
    ctx.lineTo(176, 266);
    ctx.bezierCurveTo(176, 252, 184, 240, 186, 221);
    ctx.bezierCurveTo(185, 208, 172, 204, 160, 200);
    ctx.lineTo(160, 180);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = SKIN_SH; oval(150, 193, 11, 4.5);
    // arms: one resting, one waving
    ctx.strokeStyle = SKIN; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(121, 219); ctx.quadraticCurveTo(96, 240, 103, 270); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(179, 219); ctx.quadraticCurveTo(216, 234, 226, 192); ctx.stroke();
    ctx.fillStyle = SKIN; circle(103, 273, 9); circle(227, 186, 10);
    ctx.lineWidth = 5.4;
    for (const [fx, fy] of [[219, 168], [227, 165], [235, 168], [241, 176]]) { ctx.beginPath(); ctx.moveTo(227, 184); ctx.lineTo(fx, fy); ctx.stroke(); }
    // the shell top
    for (const cx of [137, 163]) {
      ctx.fillStyle = '#c86bfa';
      ctx.beginPath(); ctx.moveTo(cx, 250);
      for (let i = 0; i <= 4; i++) { const a = Math.PI * (1.08 + 0.84 * i / 4), am = Math.PI * (1.08 + 0.84 * (i - 0.5) / 4); if (i) ctx.quadraticCurveTo(cx + Math.cos(am) * 19, 250 + Math.sin(am) * 21, cx + Math.cos(a) * 16, 250 + Math.sin(a) * 18); else ctx.lineTo(cx + Math.cos(a) * 16, 250 + Math.sin(a) * 18); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f0d4ff'; ctx.lineWidth = 1.6;
      for (let i = 1; i < 4; i++) { const a = Math.PI * (1.08 + 0.84 * i / 4); ctx.beginPath(); ctx.moveTo(cx, 249); ctx.lineTo(cx + Math.cos(a) * 14, 250 + Math.sin(a) * 16); ctx.stroke(); }
    }
    ctx.strokeStyle = '#c86bfa'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(123, 240); ctx.quadraticCurveTo(117, 228, 121, 214); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(177, 240); ctx.quadraticCurveTo(183, 228, 179, 214); ctx.stroke();
    // pink pearls where the tail begins
    for (let k = 0; k <= 6; k++) {
      const x = 125.5 + k * 8.2, y = 264 + Math.sin((k / 6) * Math.PI) * 4;
      ctx.fillStyle = '#ff7ab8'; circle(x, y, 5.4);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; circle(x - 1.6, y - 1.8, 1.7);
    }

    // ---- her face ----
    ctx.fillStyle = SKIN; oval(96, 142, 8, 11); oval(204, 142, 8, 11);
    ctx.beginPath(); ctx.ellipse(150, 130, 57, 55, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,150,0.42)'; oval(113, 152, 12.5, 9); oval(187, 152, 12.5, 9);
    for (const ex of [127, 173]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, 133, 13, 15.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6b4423'; circle(ex + 1.2, 134.5, 10.6);
      ctx.fillStyle = '#8a5a30'; ctx.beginPath(); ctx.arc(ex + 1.2, 137.5, 7.4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.fill();
      ctx.fillStyle = '#1d0f06'; circle(ex + 1.4, 134.5, 5.6);
      ctx.fillStyle = '#fff'; circle(ex + 5.2, 129.2, 3.9); circle(ex - 2.6, 139.4, 1.8);
      ctx.strokeStyle = '#2a170a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.ellipse(ex, 133, 13.6, 16, 0, -2.75, -0.38); ctx.stroke();
      ctx.lineWidth = 2.2;
      const d = ex < 150 ? -1 : 1;
      ctx.beginPath(); ctx.moveTo(ex + d * 11.5, 123.5); ctx.lineTo(ex + d * 18, 118.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + d * 13.2, 128); ctx.lineTo(ex + d * 20, 125.5); ctx.stroke();
    }
    ctx.strokeStyle = '#d99878'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(150, 149, 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#c0395a';
    ctx.beginPath(); ctx.moveTo(137, 160); ctx.quadraticCurveTo(150, 164, 163, 160); ctx.quadraticCurveTo(160, 177, 150, 177); ctx.quadraticCurveTo(140, 177, 137, 160); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff8fab'; oval(150, 172, 6.5, 3.4);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(141, 161.4); ctx.quadraticCurveTo(150, 164.4, 159, 161.4); ctx.lineTo(158, 164.6); ctx.quadraticCurveTo(150, 167, 142, 164.6); ctx.closePath(); ctx.fill();

    // ---- her fringe, the star clip, and the crown if she has earned it ----
    ctx.fillStyle = HAIR;
    ctx.beginPath();
    ctx.moveTo(91, 142);
    ctx.bezierCurveTo(80, 60, 220, 60, 209, 142);
    ctx.bezierCurveTo(204, 122, 196, 108, 186, 102);
    ctx.bezierCurveTo(180, 116, 164, 120, 153, 98);
    ctx.bezierCurveTo(142, 120, 122, 118, 113, 102);
    ctx.bezierCurveTo(103, 110, 96, 122, 91, 142);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = HAIR_HI; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(150, 130, 47, -2.5, -1.35); ctx.stroke();
    ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(150, 130, 39, -1.1, -0.6); ctx.stroke();
    ctx.fillStyle = '#ffd93d'; ctx.strokeStyle = '#f0a81c'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    star(107, 96, 15, 6.4, 5, -0.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff9f43'; circle(107, 96, 3.6);
    if (crown) {
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#b86e00'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(120, 78); ctx.lineTo(116, 34); ctx.lineTo(134, 56); ctx.lineTo(150, 24);
      ctx.lineTo(166, 56); ctx.lineTo(184, 34); ctx.lineTo(180, 78); ctx.quadraticCurveTo(150, 68, 120, 78); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff4d8d'; circle(116, 34, 4.4); circle(150, 24, 4.8); circle(184, 34, 4.4);
      ctx.fillStyle = '#4cc9f0'; circle(150, 58, 5.4);
      ctx.fillStyle = '#5ad17a'; circle(132, 66, 3.6); ctx.fillStyle = '#c86bfa'; circle(168, 66, 3.6);
    }
  }
  function paintPicture(scene, crown) {
    const S = SCENES[scene % SCENES.length], R = mulberry32(41 + scene * 7);
    let g = ctx.createLinearGradient(0, 0, 0, 450);
    g.addColorStop(0, S.top); g.addColorStop(1, S.bot);
    ctx.fillStyle = g; ctx.fillRect(-60, -10, 420, 470);
    // light from above
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    g = ctx.createLinearGradient(0, 0, 0, 400); g.addColorStop(0, `rgba(255,255,255,${S.ray})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    for (const [x, w, lean] of [[-30, 50, 70], [58, 30, 60], [140, 60, 84], [236, 36, 64]]) { ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x + w, -10); ctx.lineTo(x + w + lean, 410); ctx.lineTo(x + lean - 24, 410); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // the reef far away, and the sand
    ctx.fillStyle = S.far; ctx.beginPath(); ctx.moveTo(-60, 460);
    for (let x = -60; x <= 360; x += 10) ctx.lineTo(x, 356 + 20 * Math.sin(x / 46 + scene * 2) + 9 * Math.sin(x / 17 + 1));
    ctx.lineTo(360, 460); ctx.closePath(); ctx.fill();
    g = ctx.createLinearGradient(0, 408, 0, 452); g.addColorStop(0, S.sand[0]); g.addColorStop(1, S.sand[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-60, 460);
    for (let x = -60; x <= 360; x += 10) ctx.lineTo(x, 422 + 5 * Math.sin(x / 38 + scene) + 3 * Math.sin(x / 15));
    ctx.lineTo(360, 460); ctx.closePath(); ctx.fill();
    // weed and coral in the corners
    seaweed(22, 440, 150, 0.6, S.weed, 1, 7); seaweed(38, 444, 104, 1.4, shade('#3fae6a', 0.1), 2, 6);
    seaweed(282, 442, 128, 2.2, S.weed, 3, 7); seaweed(268, 446, 84, 0.2, shade('#3fae6a', 0.1), 5, 6);
    ctx.fillStyle = shade('#a07b58', scene === 2 ? -0.15 : 0); oval(248, 440, 46, 18); oval(40, 444, 40, 15);
    fanCoral(256, 430, S.coral[0], R, 1.25); branchCoral(226, 432, S.coral[1], R, 1.4); branchCoral(52, 434, S.coral[2], R, 1.3); fanCoral(18, 436, S.coral[1], R, 0.9);
    ctx.fillStyle = '#ff8a5c'; star(196, 436, 9, 4, 5, 0.4); ctx.fill();
    ctx.fillStyle = '#fff0e0'; ctx.beginPath(); ctx.ellipse(112, 440, 8, 6, 0, Math.PI, 0); ctx.fill();
    // a soft light round her, then Isabella herself
    glow(150, 190, 210, 'rgba(255,255,255,0.6)', 0.55);
    // her friends
    if (S.friend === 'fish') { creature('fish', '#ff8c2e', 252, 318, 0.5, true, 0.4); creature('fish', '#ffd23f', 44, 66, 0.36, false, 1.1); creature('fish', '#ff6f91', 262, 84, 0.3, true, 2.0); }
    else if (S.friend === 'turtle') { creature('turtle', '#3fbf7f', 250, 322, 0.58, true, 0.4); creature('fish', '#7fe0ff', 46, 70, 0.34, false, 1.1); }
    else {
      creature('seahorse', '#1fc2ad', 252, 312, 0.74, true, 0.4);
      // little lights in the evening water
      for (let i = 0; i < 9; i++) { const x = 16 + R() * 268, y = 16 + R() * 150; glow(x, y, 9 + R() * 8, 'rgba(255,250,200,0.9)', 0.6); ctx.fillStyle = '#fffbe0'; star(x, y, 3.4, 1.1, 4, R()); ctx.fill(); }
    }
    paintIsabella(crown);
    // bubbles and twinkles in front
    for (let i = 0; i < 16; i++) {
      const x = 10 + R() * 280, y = 20 + R() * 380, r = 2.5 + R() * 5.5;
      if (Math.hypot(x - 150, y - 132) < 70) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; circle(x - r * 0.35, y - r * 0.35, r * 0.24);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [x, y, r] of [[246, 150, 6], [262, 196, 4], [58, 128, 5], [206, 60, 4.5], [70, 236, 4]]) { star(x, y, r, r * 0.3, 4, 0.2); ctx.fill(); }
  }

  // The picture for a round, as two canvases the size of the well: clear, and misty (the same picture blurred and
  // whitened, with soft puffs). A frame draws the clear one where rows have cleared the mist, the misty one elsewhere.
  let picture = null;
  function buildPicture(lay, scene, crown) {
    const pw = Math.max(8, Math.round(lay.w * s)), ph = Math.max(8, Math.round(lay.h * s));
    const clear = document.createElement('canvas'); clear.width = pw; clear.height = ph;
    const k = Math.max(pw / 300, ph / 450);
    withCtx(clear.getContext('2d'), () => { ctx.setTransform(k, 0, 0, k, (pw - 300 * k) / 2, 0); paintPicture(scene, crown); });   // her face is never cropped
    // the mist: the picture made soft by shrinking it in halves and growing it back in doubles (works everywhere)
    const steps = [clear];
    for (let k2 = 0; k2 < 4; k2++) {
      const prev = steps[steps.length - 1], t = document.createElement('canvas');
      t.width = Math.max(2, Math.round(prev.width / 2)); t.height = Math.max(2, Math.round(prev.height / 2));
      const tg = t.getContext('2d'); tg.imageSmoothingEnabled = true; tg.drawImage(prev, 0, 0, t.width, t.height);
      steps.push(t);
    }
    for (let k2 = steps.length - 1; k2 > 1; k2--) {
      const small = steps[k2], big = steps[k2 - 1], bg = big.getContext('2d');
      bg.imageSmoothingEnabled = true; bg.clearRect(0, 0, big.width, big.height); bg.drawImage(small, 0, 0, big.width, big.height);
    }
    const mist = document.createElement('canvas'); mist.width = pw; mist.height = ph;
    withCtx(mist.getContext('2d'), () => {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(steps[1], 0, 0, pw, ph);
      ctx.fillStyle = 'rgba(222,240,252,0.5)'; ctx.fillRect(0, 0, pw, ph);
      const R = mulberry32(7 + scene);
      for (let i = 0; i < 46; i++) {
        const x = R() * pw, y = R() * ph, r = (0.1 + R() * 0.16) * pw;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(255,255,255,${0.2 + R() * 0.16})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    });
    return { clear, mist, pw, ph };
  }

  // ---------- where everything goes ----------
  // The well stands in the middle. Left of it: the row-goal track with the key on top. Right of it: the bubble with
  // the next piece. The round's coins are counted in the top right corner. (The four big buttons are in index.html.)
  const TOPM = 18, CMAX = { easy: 56, medium: 46, hard: 39 };
  function layout(mode, cols, rows, goal) {
    let c = Math.min(CMAX[mode] || 56, (H - 2 * TOPM) / rows, (VW - 660) / cols);
    c = Math.max(8, Math.floor(c * s) / s);   // a whole number of screen pixels, so the blocks sit edge to edge
    const w = c * cols, h = c * rows, x = Math.round(((VW - w) / 2) * s) / s, y = Math.round(((H - h) / 2) * s) / s;
    const slotR = goal > 8 ? 11 : 13;
    return {
      mode, c, cols, rows, goal, x, y, w, h,
      track: { x: x - 46, y0: y + h - 22, y1: y + 88, keyY: y + 34, r: slotR },
      next: { x: x + w + 80, y: y + 66, r: 58 },
      coin: { x: VW - 176, y: 56 },
      chest: { x: Math.max(150, x / 2 + 20), y: 522, sc: 1 },
      party: { x: Math.max(250, x / 2 + 130), y: 318, sc: 1 },
      card: x + w + (VW - x - w) / 2,
    };
  }

  // ---------- caches ----------
  function clearCaches() { picture = null; blockCache.clear(); }
  function newRound() { picture = null; }

  // ---------- the well ----------
  // v (from game.js): { mode, lay, W, H, grid, cur { id, style, rot, x, y } | null, px, py (where the piece is drawn,
  //   in cells, gliding after the real place), pop (0..1 just after it appears), ghostY, next { id, style },
  //   clearing [rows], clearU (0..1 through their sparkle), rowOff[] (cells each row is still above its place, settling),
  //   bands (how many of the picture's bands are clear; a fraction while one is clearing), goal, rowsDone, trackPop
  //   (seconds since the last row), coins, coinPop, flyCoins [{ x, y, r }], wave { u, rows } | null, stackAlpha,
  //   squash [{ cells, t }], scene, crown, hud (0..1), win { rise, open, isa, key } | null, shake }
  function drawWell(v, time) {
    const lay = v.lay, c = lay.c, x0 = lay.x, y0 = lay.y, W = v.W, Hc = v.H;
    // the frame
    ctx.fillStyle = 'rgba(0,30,70,0.25)'; rrect(x0 - 9, y0 - 5, lay.w + 22, lay.h + 20, 20); ctx.fill();
    ctx.fillStyle = '#fff'; rrect(x0 - 11, y0 - 11, lay.w + 22, lay.h + 22, 20); ctx.fill();
    ctx.fillStyle = '#ffd23f'; rrect(x0 - 7, y0 - 7, lay.w + 14, lay.h + 14, 16); ctx.fill();
    ctx.fillStyle = '#fff6c8'; rrect(x0 - 3, y0 - 3, lay.w + 6, lay.h + 6, 12); ctx.fill();
    // the picture: clear above the mist line, misty below; the band that is clearing fades from one to the other
    if (!picture || picture.mode !== v.mode || picture.scene !== v.scene || picture.crown !== !!v.crown || picture.c !== c || picture.s !== s) {
      picture = buildPicture(lay, v.scene, v.crown);
      picture.mode = v.mode; picture.scene = v.scene; picture.crown = !!v.crown; picture.c = c; picture.s = s;
    }
    const P = picture, bandH = lay.h / v.goal, whole = Math.floor(v.bands + 1e-6), frac = v.bands - whole;
    const clearH = Math.min(lay.h, (whole + (frac > 0 ? 1 : 0)) * bandH), cpx = Math.round((clearH / lay.h) * P.ph);
    ctx.save(); rrect(x0, y0, lay.w, lay.h, 9); ctx.clip();
    if (cpx > 0) { ctx.drawImage(P.clear, 0, 0, P.pw, cpx, x0, y0, lay.w, clearH); drawn.clearRows = cpx; }
    if (cpx < P.ph) { ctx.drawImage(P.mist, 0, cpx, P.pw, P.ph - cpx, x0, y0 + clearH, lay.w, lay.h - clearH); drawn.mistRows = P.ph - cpx; }
    if (frac > 0 && whole < v.goal) {
      // the band on its way: mist thinning, with a bright edge sweeping across
      const by = y0 + whole * bandH, spx = Math.round(((whole * bandH) / lay.h) * P.ph), hpx = Math.max(1, Math.round((bandH / lay.h) * P.ph));
      ctx.globalAlpha = 1 - smooth(frac);
      ctx.drawImage(P.mist, 0, spx, P.pw, Math.min(hpx, P.ph - spx), x0, by, lay.w, bandH);
      ctx.globalAlpha = 1;
      const sx = x0 + lay.w * frac * 1.3 - lay.w * 0.15;
      const gr = ctx.createLinearGradient(sx - 50, 0, sx + 50, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.85 * Math.sin(frac * Math.PI)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(sx - 50, by, 100, bandH);
    }
    // faint column guides, so a child can see where a piece will go (they fade away for the celebration)
    if (v.hud > 0.01) { ctx.fillStyle = `rgba(255,255,255,${0.2 * v.hud})`; for (let i = 1; i < W; i++) ctx.fillRect(x0 + i * c - 0.75, y0, 1.5, lay.h); }
    // the stack
    const sa = v.stackAlpha, wave = v.wave, k = wave ? wave.rows : 0, crest = wave ? x0 - 40 + (lay.w + 80) * smooth(clamp((wave.u - 0.08) / 0.62, 0, 1)) : 0;
    const clr = v.clearing, cu = v.clearU;
    for (let y = 0; y < Hc; y++) {
      const off = v.rowOff[y], yy = y0 + (y - off) * c, isClr = clr.length && clr.indexOf(y) >= 0;
      for (let x = 0; x < W; x++) {
        const look = v.grid[y * W + x];
        if (!look) continue;
        const xx = x0 + x * c;
        let a = sa, sz = c;
        if (wave && y >= Hc - k) a *= clamp(1 - (crest - (xx + c / 2)) / (c * 1.2), 0, 1);
        if (isClr) {
          // a full row: it swells and glows, then pops from the middle outwards
          const d = Math.abs(x - (W - 1) / 2) / W, u = clamp((cu - 0.3 - d * 0.5) / 0.4, 0, 1);
          sz = c * (1 + 0.1 * Math.sin(clamp(cu / 0.3, 0, 1) * Math.PI)) * (1 - smooth(u));
          a *= 1 - u * 0.4;
        }
        if (a <= 0.01 || sz <= 0.5) continue;
        if (a < 1) ctx.globalAlpha = a;
        ctx.drawImage(blockSprite(look, c), xx + (c - sz) / 2, yy + (c - sz) / 2, sz, sz);
        drawn.stack++;
        if (isClr && cu < 0.75 && sz > 8) { ctx.globalAlpha = 0.75 * Math.sin(clamp(cu / 0.6, 0, 1) * Math.PI) * a; ctx.fillStyle = '#fff'; rrect(xx + (c - sz) / 2 + 2, yy + (c - sz) / 2 + 2, sz - 4, sz - 4, c * 0.2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    }
    // a piece that has just landed gives a little bounce of light
    for (const q of v.squash) {
      const u = q.t / 0.22;
      ctx.globalAlpha = 0.55 * (1 - u); ctx.fillStyle = '#fff';
      for (const [x, y] of q.cells) { rrect(x0 + x * c + 2, y0 + y * c + 2, c - 4, c - 4, c * 0.2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // where the piece will land: an outline
    const cur = v.cur;
    if (cur) {
      const cells = L.PIECES[cur.id].rots[cur.rot];
      if (v.ghostY != null && v.ghostY > cur.y) {
        const B = LOOKS[cur.style], pulse = 0.5 + 0.5 * Math.sin(time * 5);
        for (const [dx, dy] of cells) {
          const gx = x0 + (cur.x + dx) * c, gy = y0 + (v.ghostY + dy) * c;
          ctx.fillStyle = B.light; ctx.globalAlpha = 0.3 + 0.1 * pulse; rrect(gx + 3, gy + 3, c - 6, c - 6, c * 0.2); ctx.fill();
          ctx.globalAlpha = 0.85 + 0.15 * pulse; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2.2, c * 0.07); ctx.setLineDash([c * 0.2, c * 0.14]); ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          drawn.ghost++;
        }
      }
      // the sinking piece
      const pop = v.pop < 1 ? 0.6 + 0.4 * backOut(v.pop) : 1;
      for (const [dx, dy] of cells) {
        const bx = x0 + (v.px + dx) * c, by = y0 + (v.py + dy) * c, sz = c * pop;
        if (by + c <= y0) continue;
        ctx.drawImage(blockSprite(cur.style, c), bx + (c - sz) / 2, by + (c - sz) / 2, sz, sz);
        drawn.piece++;
      }
    }
    // Easy's wave: blue water with a foamy edge rolls across the bottom rows, left to right, and drains away
    if (wave) {
      const top = y0 + (Hc - k) * c - c * 0.3, a = clamp((1 - wave.u) / 0.22, 0, 1) * clamp(wave.u / 0.08, 0, 1), bottom = y0 + lay.h + 6;
      const edge = (x) => top + Math.sin(x / 24 + time * 9) * 5 - Math.max(0, 1 - (crest - x) / 90) * c * 0.55;
      const g = ctx.createLinearGradient(0, top - c * 0.5, 0, bottom);
      g.addColorStop(0, 'rgba(120,225,255,0.75)'); g.addColorStop(1, 'rgba(28,140,215,0.8)');
      ctx.globalAlpha = a; ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x0 - 6, bottom);
      for (let x = x0 - 6; x < crest; x += 10) ctx.lineTo(x, edge(x));
      ctx.lineTo(crest, edge(crest)); ctx.quadraticCurveTo(crest + c * 0.75, top + c * 0.2, crest + c * 0.35, bottom); ctx.closePath(); ctx.fill();
      drawn.wave = 1;
      // foam: along the top of the water, thick at the rolling front
      ctx.fillStyle = '#fff';
      for (let x = x0 - 6; x < crest; x += 22) circle(x, edge(x) + 1, 6.5 + 2.5 * Math.sin(x * 0.7 + time * 7));
      for (let i = 0; i < 8; i++) { const u = i / 7, fy = lerp(edge(crest) - 4, bottom - 10, u); circle(crest + c * (0.28 + 0.3 * Math.sin(u * Math.PI)) + Math.sin(i * 1.9 + time * 9) * 5, fy, 13 - u * 4 + 3 * Math.sin(i * 2.3 + time * 11)); }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // the gold frame shines when the round is won
    if (v.win && v.win.shine > 0) {
      ctx.save(); ctx.globalAlpha = v.win.shine * (0.6 + 0.4 * Math.sin(time * 6)); ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 6;
      rrect(x0 - 9, y0 - 9, lay.w + 18, lay.h + 18, 18); ctx.stroke(); ctx.restore();
    }
  }

  // the row goal: a string of slots filling up with stars, from the bottom to the key at the top
  function drawTrack(v, time) {
    const T = v.lay.track, n = v.goal, a = v.hud;
    if (a <= 0.01) return;
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(T.x, T.y0); ctx.lineTo(T.x, T.keyY + 30); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const y = lerp(T.y0, T.y1, n > 1 ? i / (n - 1) : 0), on = i < v.rowsDone, r = T.r;
      if (on) {
        const fresh = i >= v.rowsDone - v.lastRows && v.trackPop < 0.6, sc = fresh ? backOut(clamp(v.trackPop / 0.45, 0, 1)) * 1.0 : 1;
        glow(T.x, y, r * 2.6, 'rgba(255,220,90,0.9)', 0.6 * a);
        ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#c77700'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
        star(T.x, y, r * 1.35 * sc, r * 0.62 * sc, 5, -Math.PI / 2); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; circle(T.x, y, r);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(T.x, y, r, 0, TAU); ctx.stroke();
      }
    }
    // the key in its bubble, livelier as the goal comes near
    if (!v.win || !v.win.key) {
      const near = clamp(v.rowsDone / n, 0, 1), bob = Math.sin(time * 2.4) * 2.5;
      glow(T.x, T.keyY + bob, 34 + near * 14, 'rgba(255,220,90,0.9)', (0.25 + 0.5 * near) * a);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; circle(T.x, T.keyY + bob, 27);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(T.x, T.keyY + bob, 27, 0, TAU); ctx.stroke();
      drawKey(T.x + 4, T.keyY + bob, -0.7 + Math.sin(time * 2.4) * 0.08, 0.66);
    }
    ctx.restore();
  }
  // the bubble with the next piece
  function drawNext(v, time) {
    const N = v.lay.next, a = v.hud;
    if (a <= 0.01 || !v.next) return;
    const y = N.y + Math.sin(time * 1.7) * 3;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; circle(N.x, y, N.r);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(N.x, y, N.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; oval(N.x - N.r * 0.42, y - N.r * 0.5, N.r * 0.22, N.r * 0.1, -0.7);
    const cells = L.PIECES[v.next.id].rots[0];
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (const [cx, cy] of cells) { if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, cs = Math.min(30, (N.r * 1.5) / Math.max(w, h + 0.6));
    for (const [cx, cy] of cells) drawBlock(v.next.style, N.x + (cx - x0 - w / 2) * cs, y + (cy - y0 - h / 2) * cs, cs);
    ctx.restore();
  }
  // the round's coins, top right
  function drawCoins(v, time) {
    const C = v.lay.coin, a = v.hud;
    if (a <= 0.01) return;
    const pop = v.coinPop < 0.35 ? 1 + 0.3 * Math.sin((v.coinPop / 0.35) * Math.PI) : 1;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,40,80,0.22)'; rrect(C.x - 36, C.y - 33, 190, 66, 33); ctx.fill();
    drawCoin(C.x, C.y, 0, 25 * pop);
    ctx.font = `900 46px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,40,80,0.75)'; ctx.strokeText(String(v.coins), C.x + 40, C.y + 3);
    ctx.fillStyle = '#fff'; ctx.fillText(String(v.coins), C.x + 40, C.y + 3);
    ctx.restore();
  }

  // ---------- a frame of play ----------
  function drawPlay(v, time, dt) {
    const lay = v.lay, th = THEMES[v.mode];
    drawn.stack = drawn.piece = drawn.ghost = drawn.clearRows = drawn.mistRows = drawn.wave = 0;
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 14);
    drawBubbles(time, time * 14);
    drawSand(th, 526, 3);
    for (let i = 0; i < 2; i++) seaweed(128 + i * 18, 540, 70 + i * 34, time, i % 2 ? '#3fae6a' : '#2f8f5a', i + 7, 5);
    seaweed(VW - 18, 540, 110, time, '#2f8f5a', 4, 5);
    // little fish wander past behind everything
    for (let i = 0; i < 3; i++) {
      const span = VW + 240, sp = 22 + i * 9, dir = i % 2 ? -1 : 1, x = (((time * sp * dir + i * 430) % span) + span) % span - 120, y = 250 + i * 46 + Math.sin(time * 0.8 + i * 2) * 14;
      ctx.globalAlpha = 0.55; creature('fish', ['#ffd23f', '#ff8fab', '#8ce99a'][i], x, y, 0.32, dir < 0, time + i); ctx.globalAlpha = 1;
    }
    if (v.shake) ctx.translate(0, v.shake);
    drawWell(v, time);
    if (v.shake) ctx.translate(0, -v.shake);
    drawTrack(v, time);
    drawNext(v, time);
    drawCoins(v, time);
    for (const f of v.flyCoins) drawCoin(f.x, f.y, time * 9 + f.x, f.r);
    // the hand that shows a first-time player what to do
    if (v.hand) drawHand(v, time);
    // the celebration: the chest rises out of the sand; the key flies to it; it bursts open; Isabella swims in
    if (v.win) {
      const C = lay.chest, wv = v.win;
      drawChest(C.x, H + 90 + (C.y - H - 90) * wv.rise, wv.open, time, C.sc);
      if (wv.key) { glow(wv.key.x, wv.key.y, 46 * wv.key.sc, 'rgba(255,230,120,0.9)', 0.7); drawKey(wv.key.x, wv.key.y, wv.key.rot, wv.key.sc); }
      const I = wv.isa;
      if (I) {
        if (I.glow) glow(I.x, I.y, 110 * I.sc, 'rgba(255,220,90,0.55)', 0.45);
        drawIsabella(I.x, I.y, time, { scale: I.sc, flip: I.flip, tilt: I.tilt, swim: 11, happy: true, crown: v.crown });
      }
    }
    drawParts();
  }
  // a pointing hand sliding sideways across the well and back: "you can move it like this"
  const HAND = typeof Path2D === 'function' ? new Path2D('M9.6 1.8c1.2 0 2.1.9 2.1 2.1v6.3l1.1-.2c.3 0 .5-.1.8-.1l4.6 1.1c1.2.3 2 1.5 1.8 2.8l-.9 6.5c-.2 1.1-1.1 1.9-2.2 1.9H10.5c-.6 0-1.2-.3-1.6-.8L4 15.9c-.7-.8-.6-2 .2-2.7.7-.6 1.8-.6 2.5 0l.8.7V3.9c0-1.2.9-2.1 2.1-2.1z') : null;
  function drawHand(v, time) {
    if (!HAND) return;
    const lay = v.lay, u = (time % 3) / 3, cx = lay.x + lay.w / 2, cy = lay.y + lay.h * 0.6;
    const x = cx + Math.sin(u * TAU) * lay.w * 0.27;
    ctx.save(); ctx.globalAlpha = 0.95 * v.hand;
    // a soft trail under the fingertip, so the sideways slide reads
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - lay.w * 0.27, cy); ctx.lineTo(cx + lay.w * 0.27, cy); ctx.stroke();
    ctx.translate(x - 9.6 * 3.4, cy - 2 * 3.4); ctx.scale(3.4, 3.4);
    ctx.fillStyle = 'rgba(0,40,80,0.3)'; ctx.translate(0.5, 0.9); ctx.fill(HAND); ctx.translate(-0.5, -0.9);
    ctx.fillStyle = '#fff'; ctx.fill(HAND);
    ctx.strokeStyle = '#1d3557'; ctx.lineWidth = 0.75; ctx.lineJoin = 'round'; ctx.stroke(HAND);
    ctx.restore();
  }

  // ---------- the mode picker's backdrop: a reef along the bottom, sea blocks sinking, Isabella swimming past ----------
  function drawMenu(time, dt, o) {
    const th = THEMES.menu;
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 20);
    drawBubbles(time, time * 20);
    for (const b of drifters) {
      const y = (((b.y0 + time * b.sp) % 700) + 700) % 700 - 80, x = b.x * VW + Math.sin(time * 0.5 + b.ph) * 14;
      ctx.save(); ctx.globalAlpha = 0.8; ctx.translate(x, y); ctx.rotate(Math.sin(time * 0.6 + b.ph) * 0.25);
      drawBlock(b.look, -b.size / 2, -b.size / 2, b.size);
      ctx.restore();
    }
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
    drawIsabella(x, 452 + Math.sin(time * 2) * 7, time, { scale: 0.78, flip: !fwd, swim: 8, crown: o && o.crown });
    drawParts();
  }

  // ---------- particles (from Coral Maze's art.js) ----------
  function spawn(p) { if (parts.length < 650) parts.push(p); }
  const clearParticles = () => { parts.length = 0; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(type, x, y, size, col) {
    const k = size || 1;
    if (type === 'row') for (let i = 0; i < 7; i++) spawn({ t: 'spark', x: x + rnd(-10, 10) * k, y: y + rnd(-8, 8) * k, vx: rnd(-170, 170) * k, vy: rnd(-210, 60) * k, life: 0.8, max: 0.8, c: i % 3 ? '#fff6a0' : (col || '#ffffff'), r: rnd(3.5, 7) * k });
    if (type === 'land') for (let i = 0; i < 4; i++) spawn({ t: 'bubble', x: x + rnd(-14, 14) * k, y: y + rnd(-4, 4), vx: rnd(-30, 30), vy: rnd(-70, -30), life: 0.6, max: 0.6, r: rnd(2, 4.5) * k });
    if (type === 'wash') for (let i = 0; i < 6; i++) spawn({ t: 'bubble', x: x + rnd(-16, 16) * k, y: y + rnd(-16, 16) * k, vx: rnd(-20, 60), vy: rnd(-150, -60), life: 1.1, max: 1.1, r: rnd(3, 8) * k });
    if (type === 'mist') for (let i = 0; i < 3; i++) spawn({ t: 'spark', x: x + rnd(-10, 10), y: y + rnd(-size, size), vx: rnd(-30, 60), vy: rnd(-40, 40), life: 0.9, max: 0.9, c: '#ffffff', r: rnd(3, 6) });
    if (type === 'coin') for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; spawn({ t: 'spark', x, y, vx: Math.cos(a) * rnd(90, 170), vy: Math.sin(a) * rnd(90, 170), life: 0.55, max: 0.55, c: i % 2 ? '#fff6a0' : '#ffd23f', r: rnd(3, 6) }); }
    if (type === 'float') for (let i = 0; i < 2; i++) spawn({ t: 'bubble', x: x + rnd(-10, 10) * k, y: y + rnd(-10, 10) * k, vx: rnd(-18, 18), vy: rnd(-120, -50), life: 1.4, max: 1.4, r: rnd(3, 9) * k });
    if (type === 'puff') for (let i = 0; i < 16; i++) spawn({ t: 'puff', x: x + rnd(-70, 70) * k, y: y + rnd(-8, 8), vx: rnd(-90, 90), vy: rnd(-70, -10), life: 0.9, max: 0.9, r: rnd(8, 16) * k, c: 'rgba(255,240,200,0.8)' });
    if (type === 'cheer') for (let i = 0; i < 8; i++) spawn({ t: i % 2 ? 'heart' : 'spark', x: x + rnd(-40, 40), y: y + rnd(-30, 10), vx: rnd(-60, 60), vy: rnd(-150, -70), life: 1.1, max: 1.1, c: '#fff6a0', r: rnd(5, 9) });
    if (type === 'notes') for (let i = 0; i < 4; i++) spawn({ t: 'note', x: x + rnd(-24, 24), y: y - 16, vx: rnd(-30, 30), vy: rnd(-95, -60), life: 1.4, max: 1.4, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], r: rnd(0.9, 1.3), ph: Math.random() * 6 });
    if (type === 'confetti') for (let i = 0; i < 60; i++) spawn({ t: 'confetti', x: rnd(0, VW), y: rnd(-60, -10), vx: rnd(-40, 40), vy: rnd(40, 120), life: 4, max: 4, c: RAINBOW[i % 7], ph: Math.random() * TAU, fall: true });
  }
  // the treasure burst: coins and pearls leap out and bounce on the sand, with confetti (pearls: only pearls, no confetti)
  function fountain(x, y, n, floor, pearls) {
    for (let i = 0; i < n; i++) {
      const pearl = pearls || i % 4 === 3;
      spawn({ t: pearl ? 'gpearl' : 'gcoin', x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 540, vy: -460 - Math.random() * 520, life: 3.2, max: 3.2, r: pearl ? 8 + Math.random() * 4 : 9 + Math.random() * 5, ph: Math.random() * 6, floor: floor || 528 });
    }
    if (!pearls) for (let i = 0; i < n / 2; i++) spawn({ t: 'confetti', x: x + (Math.random() - 0.5) * 80, y: y - 20, vx: (Math.random() - 0.5) * 640, vy: -300 - Math.random() * 500, life: 3, max: 3, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], ph: Math.random() * 6 });
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.t === 'gcoin' || p.t === 'gpearl') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 8;
        if (p.y > p.floor) { p.y = p.floor; p.vy *= -0.45; p.vx *= 0.7; }
      } else if (p.t === 'confetti') {
        if (!p.fall) { p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.5); p.vy = Math.min(p.vy, 120); }
        p.x += p.vx * dt + Math.sin(p.ph) * 40 * dt; p.y += p.vy * dt; p.ph += dt * 6;
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
      else if (p.t === 'puff') { ctx.globalAlpha = a * 0.8; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - a * 0.6), 0, TAU); ctx.fill(); }
      else if (p.t === 'confetti') { ctx.globalAlpha = Math.min(1, p.life); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph); ctx.fillStyle = p.c; ctx.fillRect(-5, -3, 10, 6); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- for the tests ----------
  // how much of the picture is painted, and how different the misty one is (so neither is blank)
  function pictureCheck(scene, crown) {
    const lay = { w: 300, h: 450, c: 50, cols: 6 }, keep = s;
    s = 1;
    const P = buildPicture(lay, scene, crown);
    s = keep;
    const a = P.clear.getContext('2d').getImageData(0, 0, P.pw, P.ph).data, b = P.mist.getContext('2d').getImageData(0, 0, P.pw, P.ph).data;
    let on = 0, diff = 0, skin = 0, hair = 0;
    const cols = new Set();
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] > 200) on++;
      diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (a[i] === 0xf7 && a[i + 1] === 0xcd && a[i + 2] === 0xb0) skin++;
      if (a[i] === 0x6b && a[i + 1] === 0x3a && a[i + 2] === 0x1f) hair++;
      if (i % 64 === 0) cols.add((a[i] >> 4) + ',' + (a[i + 1] >> 4) + ',' + (a[i + 2] >> 4));
    }
    const n = a.length / 4;
    return { painted: +(on / n).toFixed(3), mistDiff: +(diff / n / 3).toFixed(1), skin: +(skin / n).toFixed(4), hair: +(hair / n).toFixed(4), colours: cols.size };
  }
  // one block look painted alone: how much of its box is filled
  function blockCheck() {
    const out = {};
    for (let k = 1; k <= L.STYLES; k++) {
      const c = document.createElement('canvas'); c.width = c.height = 100;
      withCtx(c.getContext('2d'), () => { ctx.setTransform(1, 0, 0, 1, 0, 0); paintBlock(k); });
      const d = c.getContext('2d').getImageData(0, 0, 100, 100).data;
      let on = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 200) on++;
      out[LOOKS[k].name] = +(on / 10000).toFixed(3);
    }
    return out;
  }

  window.BlocksArt = {
    init, resize, toWorld, toCss, layout, newRound, drawPlay, drawMenu, burst, fountain, clearParticles, pictureCheck, blockCheck,
    LOOKS, SCENES, THEMES, H,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get particles() { return parts.length; },
    cacheSizes: () => ({ blocks: blockCache.size, glows: Object.keys(glowCache).length, picture: picture ? 1 : 0 }),
    get drawn() { return Object.assign({}, drawn); },
  };
})();
