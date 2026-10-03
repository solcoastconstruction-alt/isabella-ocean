/* Sea Words — everything you see, drawn in code. The house style is copied (never shared) from the other games:
 * the 540-unit-tall world scaled to the screen with the device pixel ratio capped at 2.5, the glow sprite, the sea,
 * Isabella, the gold coin, the key, the treasure chest and the particles from Coral Maze's art.js; the fish, crab,
 * starfish, turtle, whale, octopus and seahorse from Bubble Party's art.js; the dolphin from Shell Match's art.js.
 * The scallop shell, the pearl, the coral, the letter board and the picture cards are new.
 *
 * Speed: the board (its tiles) is painted once per puzzle into its own canvas, each letter once per size into a
 * little sprite, and each picture once per size into a sprite; a frame stamps those and draws only what moves. */
(function () {
  'use strict';
  const H = 540, TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const backOut = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38', GOLD = '#ffcc33', NAVY = '#1d3557';
  const FONT = 'system-ui, Roboto, "Segoe UI", sans-serif';

  // the sea for each screen (colours from the main game's THEMES)
  const THEMES = {
    menu: { top: '#7fe3f0', bot: '#1f8fc0', far: 'rgba(28,118,170,0.55)', sand: ['#f9e4ab', '#e0bd78'], rock: ['#c99f78', '#a07b58'], tip: ['#ff8fab', '#ffd166', '#ff6b6b', '#c77dff'], ray: 0.22 },
    easy: { top: '#86e6f2', bot: '#1f8fc0', far: 'rgba(28,118,170,0.5)', sand: ['#fbe8b4', '#e2c07c'], tip: ['#ff8fab', '#ffd166', '#ff6b6b'], ray: 0.2, board: '#fff8e6' },
    medium: { top: '#62c6f2', bot: '#145ea8', far: 'rgba(15,70,130,0.5)', sand: ['#f3e0b0', '#d7bd86'], tip: ['#ffd166', '#ff8fab', '#8ce99a'], ray: 0.2, board: '#f4fbff' },
    hard: { top: '#a79cf2', bot: '#33307f', far: 'rgba(40,30,100,0.55)', sand: ['#e4d8f2', '#b9a7d6'], tip: ['#ff7ad9', '#7afcff', '#ffd166'], ray: 0.14, board: '#fbf6ff' },
  };

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  const parts = [], amb = [], letterBubbles = [];

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d');
    for (let i = 0; i < 30; i++) amb.push({ x: Math.random() * 2400, y: Math.random() * H, r: 1 + Math.random() * 3, sp: 10 + Math.random() * 30, ph: Math.random() * TAU });
    // letter bubbles drift up the two sides of the picker, clear of its buttons
    const letters = 'SEAWORDSHELLFISHSTAR';
    for (let i = 0; i < 7; i++) letterBubbles.push({ x: i < 3 ? 0.125 + i * 0.045 : 0.79 + (i - 3) * 0.05, y0: Math.random() * 640, sp: 14 + Math.random() * 12, r: 20 + Math.random() * 12, ch: letters[(i * 7) % letters.length], ph: Math.random() * TAU });
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

  // ---------- helpers (from render.js, via Coral Maze) ----------
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
    if (!p) { p = { base: c, dark: shade(c, -0.28), light: shade(c, 0.5), rainbow: false }; palCache.set(c, p); }
    return p;
  }

  // ---------- faces and sea friends (from Bubble Party's art.js) ----------
  function eye(x, y, r, blink) {
    if (blink) { ctx.strokeStyle = '#2a1a2e'; ctx.lineWidth = r * 0.42; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(x, y - r * 0.3, r * 0.8, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); return; }
    ctx.fillStyle = '#2a1a2e'; ctx.beginPath(); ctx.ellipse(x, y, r * 0.82, r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + r * 0.26, y - r * 0.4, r * 0.34, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.24, y + r * 0.36, r * 0.15, 0, TAU); ctx.fill();
  }
  function whiteEye(x, y, r, blink) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (blink) { ctx.strokeStyle = '#2a1a2e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - r * 0.6, y); ctx.lineTo(x + r * 0.6, y); ctx.stroke(); return; }
    ctx.fillStyle = '#2a1a2e'; ctx.beginPath(); ctx.arc(x, y + r * 0.1, r * 0.58, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + r * 0.22, y - r * 0.18, r * 0.22, 0, TAU); ctx.fill();
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
  // each is drawn facing right in a box about 80 units across (signature as in Bubble Party: colour, time, blink, happy, wiggle)
  const CRE = {
    fish(c, t, blink, happy, wig) {
      const p = pal(c), wag = Math.sin(t * (7 + wig * 9)) * (5 + wig * 5);
      ctx.fillStyle = p.dark;
      ctx.beginPath(); ctx.moveTo(-20, 0); ctx.quadraticCurveTo(-34, -4, -45, -21 + wag); ctx.quadraticCurveTo(-38, 0, -45, 21 + wag); ctx.quadraticCurveTo(-34, 4, -20, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-16, -17); ctx.quadraticCurveTo(-4, -38, 14, -19); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.base;
      ctx.beginPath(); ctx.ellipse(0, 0, 31, 24, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-6, 0, 5.5, 22.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(4, 11, 18, 7.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.dark;
      ctx.save(); ctx.translate(-1, 8); ctx.rotate(0.6 + Math.sin(t * 9) * 0.35); ctx.beginPath(); ctx.ellipse(-7, 0, 9, 4.8, 0, 0, TAU); ctx.fill(); ctx.restore();
      eye(15, -6, 7, blink); cheek(9, 8, 4.2); smile(21, 7, 5, happy);
    },
    starfish(c, t, blink, happy, wig) {
      const p = pal(c), rot = -Math.PI / 2 + Math.sin(t * 1.6) * 0.06;
      ctx.fillStyle = p.base; ctx.strokeStyle = p.base; ctx.lineWidth = 11; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 15 : 32 + Math.sin(t * 6 + i) * 3 * wig, a = rot + (i * Math.PI) / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = p.light;
      for (let i = 0; i < 5; i++) { const a = rot + (i * 2 * Math.PI) / 5; for (const d of [22, 30]) { ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, d === 22 ? 2.6 : 2, 0, TAU); ctx.fill(); } }
      eye(-7, -3, 5.5, blink); eye(7, -3, 5.5, blink); cheek(-12, 6, 3.6); cheek(12, 6, 3.6); smile(0, 6, 4.5, happy);
    },
    crab(c, t, blink, happy, wig) {
      const p = pal(c), snap = Math.abs(Math.sin(t * (3 + wig * 9)));
      ctx.strokeStyle = p.dark; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let k = 0; k < 3; k++) for (const d of [-1, 1]) {
        const kx = d * (12 + k * 6), wob = Math.sin(t * (6 + wig * 10) + k + d) * 2.5;
        ctx.beginPath(); ctx.moveTo(kx * 0.8, 10); ctx.lineTo(kx + d * 7, 16 + wob); ctx.lineTo(kx + d * 9, 24); ctx.stroke();
      }
      const lift = happy ? -7 : 0;
      for (const d of [-1, 1]) {
        ctx.strokeStyle = p.dark; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(d * 20, 0); ctx.lineTo(d * 29, -12 + lift); ctx.stroke();
        ctx.save(); ctx.translate(d * 31, -18 + lift); ctx.rotate(d * (0.3 + Math.sin(t * 2) * 0.1));
        ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(0, 0, 10, 8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = p.light; ctx.beginPath(); ctx.moveTo(-2 * d, -3); ctx.lineTo(d * 11, -11 - snap * 5); ctx.lineTo(d * 7, -1); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(0, 6, 26, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(-6, 0, 13, 6, -0.1, 0, TAU); ctx.fill();
      for (const d of [-1, 1]) {
        ctx.strokeStyle = p.dark; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(d * 7, -6); ctx.lineTo(d * 9, -15); ctx.stroke();
        whiteEye(d * 9, -20, 6.5, blink);
      }
      cheek(-14, 9, 3.8); cheek(14, 9, 3.8); smile(0, 9, 5.5, happy);
    },
    turtle(c, t, blink, happy, wig) {
      const p = pal(c), skin = shade(c, 0.42), fl = Math.sin(t * (3 + wig * 8)) * 0.45;
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
      eye(31, -6, 4.8, blink); cheek(26, 3, 3.3); smile(35, 2, 3.8, happy);
    },
    octopus(c, t, blink, happy, wig) {
      const p = pal(c);
      ctx.strokeStyle = p.base; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 8;
      for (let i = 0; i < 6; i++) {
        const bx = -17 + i * 6.8, dir = bx < 0 ? -1 : 1, ph = t * (3 + wig * 7) + i * 1.1;
        ctx.beginPath(); ctx.moveTo(bx, 6);
        for (let k = 1; k <= 5; k++) ctx.lineTo(bx + dir * k * 2.6 + Math.sin(ph + k * 0.8) * 3.4, 6 + k * 6.2);
        ctx.stroke();
      }
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(0, -9, 26, 25, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.light;
      ctx.beginPath(); ctx.arc(-12, -23, 3.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -28, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(15, -18, 3, 0, TAU); ctx.fill();
      eye(-9, -7, 6.4, blink); eye(9, -7, 6.4, blink); cheek(-16, 3, 4); cheek(16, 3, 4); smile(0, 4, 5, happy);
    },
    seahorse(c, t, blink, happy) {
      const p = pal(c);
      ctx.save(); ctx.translate(0, Math.sin(t * 1.6) * 2.5);
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
      eye(6, -24, 5.2, blink); cheek(4, -15, 3.4);
      if (happy) { ctx.fillStyle = '#b8325a'; ctx.beginPath(); ctx.arc(27, -16.5, 2.8, 0, TAU); ctx.fill(); }
      ctx.restore();
    },
    whale(c, t, blink, happy, wig) {
      const p = pal(c), fl = Math.sin(t * (2.4 + wig * 6)) * 0.25;
      ctx.fillStyle = p.base;
      ctx.beginPath(); ctx.moveTo(-18, -8); ctx.quadraticCurveTo(-30, -6, -36, -10); ctx.lineTo(-34, 4); ctx.quadraticCurveTo(-26, 10, -16, 12); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.translate(-36, -4); ctx.rotate(-0.35 + fl);
      ctx.beginPath(); ctx.ellipse(-7, -8, 11, 5.5, 0.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-7, 6, 11, 5.5, -0.55, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(3, 3, 34, 23, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.light; ctx.beginPath(); ctx.ellipse(6, 11, 27, 13, 0, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1.6;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-10 + k * 9, 14 + (k % 2)); ctx.lineTo(0 + k * 9, 21 - (k === 3 ? 3 : 0)); ctx.stroke(); }
      ctx.fillStyle = p.dark; ctx.save(); ctx.translate(2, 15); ctx.rotate(0.6 + Math.sin(t * 3) * 0.3); ctx.beginPath(); ctx.ellipse(-4, 5, 9, 4.5, 0, 0, TAU); ctx.fill(); ctx.restore();
      eye(21, -3, 5.6, blink); cheek(15, 8, 4); smile(27, 7, 5.5, happy);
      ctx.fillStyle = 'rgba(200,240,255,0.95)';
      for (const [dx, dy, r] of [[8, -30, 3.4], [2, -37, 2.6], [14, -37, 2.6], [8, -43, 2.2]]) { ctx.beginPath(); ctx.arc(dx, dy, r, 0, TAU); ctx.fill(); }
    },
    // the dolphin, from Shell Match's art.js, with Bubble Party's eye so all the friends match
    dolphin(c, t, blink, happy) {
      ctx.save(); ctx.rotate(-0.1);
      const col = '#86a3c4', dark = '#5b7aa0';
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.quadraticCurveTo(-32, -2, -38, -12); ctx.quadraticCurveTo(-33, -4, -30, 0); ctx.quadraticCurveTo(-34, 5, -40, 10); ctx.quadraticCurveTo(-30, 8, -22, 4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -11); ctx.quadraticCurveTo(-5, -24, -15, -27); ctx.quadraticCurveTo(-11, -18, -16, -10); ctx.closePath(); ctx.fill();
      const g = ctx.createLinearGradient(0, -12, 0, 12); g.addColorStop(0, '#a4bedb'); g.addColorStop(1, col);
      ctx.fillStyle = g; oval(0, 0, 26, 13);
      oval(25, 4, 10, 4.6, 0.12);
      ctx.fillStyle = '#eef4fb'; oval(8, 6, 17, 5.5, 0.05); oval(25, 6, 8, 2.4, 0.12);
      ctx.fillStyle = dark; oval(0, 9, 7, 3.4, 0.6);
      eye(14, -3, 4.4, blink); cheek(19, 3, 2.6);
      ctx.strokeStyle = '#33506e'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(18, 5.5); ctx.quadraticCurveTo(26, happy ? 11 : 8, 34, 5); ctx.stroke();
      ctx.restore();
    },
  };

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

  // ---------- new pictures: the scallop shell, the pearl, the coral ----------
  function drawScallop(happy) {
    const hx = 0, hy = 30, R = 56, A0 = -2.55, A1 = -0.59, n = 9;
    const fan = () => {
      ctx.beginPath(); ctx.moveTo(hx, hy);
      for (let i = 0; i <= n; i++) {
        const a = A0 + ((A1 - A0) * i) / n, x = hx + Math.cos(a) * R, y = hy + Math.sin(a) * R;
        if (i === 0) ctx.lineTo(x, y);
        else { const am = A0 + ((A1 - A0) * (i - 0.5)) / n; ctx.quadraticCurveTo(hx + Math.cos(am) * R * 1.13, hy + Math.sin(am) * R * 1.13, x, y); }
      }
      ctx.closePath();
    };
    // the two little "ears" at the hinge
    ctx.fillStyle = '#f06aa7';
    ctx.beginPath(); ctx.moveTo(hx - 2, hy - 9); ctx.lineTo(hx - 21, hy - 3); ctx.quadraticCurveTo(hx - 22, hy + 7, hx - 13, hy + 9); ctx.lineTo(hx, hy + 7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx + 2, hy - 9); ctx.lineTo(hx + 21, hy - 3); ctx.quadraticCurveTo(hx + 22, hy + 7, hx + 13, hy + 9); ctx.lineTo(hx, hy + 7); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(0, hy - R, 0, hy);
    g.addColorStop(0, '#ffe0ee'); g.addColorStop(0.55, '#ffa8cf'); g.addColorStop(1, '#ff79b2');
    ctx.fillStyle = g; fan(); ctx.fill();
    ctx.save(); fan(); ctx.clip();
    for (let i = 0; i < n; i++) {
      // each rib: a lighter stripe down its middle, and a darker groove between ribs
      const a = A0 + ((A1 - A0) * (i + 0.5)) / n, b = A0 + ((A1 - A0) * i) / n;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * R * 0.3, hy + Math.sin(a) * R * 0.3); ctx.lineTo(hx + Math.cos(a) * R * 0.9, hy + Math.sin(a) * R * 0.9); ctx.stroke();
      if (i) { ctx.strokeStyle = 'rgba(205,50,120,0.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(b) * R * 1.1, hy + Math.sin(b) * R * 1.1); ctx.stroke(); }
    }
    // growth rings across the ribs
    ctx.strokeStyle = 'rgba(205,50,120,0.22)'; ctx.lineWidth = 1.5;
    for (const k of [0.45, 0.65, 0.84]) { ctx.beginPath(); ctx.arc(hx, hy, R * k, A0 - 0.1, A1 + 0.1); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#e0508f'; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; fan(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; oval(hx - 18, hy - 36, 8, 4, -0.6);
    if (happy) { ctx.fillStyle = '#fff6b0'; star(hx + 24, hy - 44, 7, 2.6, 4, 0.3); ctx.fill(); }
  }
  function drawPearlPic(happy) {
    // an open clam: the lid standing up behind, the bowl in front, a big pearl sitting in it
    ctx.save(); ctx.translate(0, 10);
    ctx.fillStyle = '#ffb8d6';
    ctx.beginPath(); ctx.moveTo(-42, 0); ctx.quadraticCurveTo(-46, -52, 0, -56); ctx.quadraticCurveTo(46, -52, 42, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff7ab0'; ctx.lineWidth = 2.2;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(k * 11, -50 + Math.abs(k) * 5); ctx.stroke(); }
    ctx.fillStyle = '#ffe6f2'; oval(0, -1, 40, 9);
    glow(0, -16, 46, 'rgba(255,235,255,0.95)', happy ? 0.9 : 0.6);
    drawPearl(0, -16, 18, 0);
    ctx.fillStyle = '#ff9ec7';
    ctx.beginPath(); ctx.ellipse(0, 0, 44, 26, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(214,70,140,0.5)'; ctx.lineWidth = 2;
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 44, 26, 0, 0, Math.PI); ctx.clip();
    for (let k = -4; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(k * 3, 34); ctx.lineTo(k * 11, 2); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#ff8fbf';
    for (let k = -4; k <= 4; k++) { const x = k * 9.6; circle(x, 1.5, 3); }
    ctx.restore();
  }
  function drawCoral() {
    // pink branching coral on a little rock; a fixed seed so it always grows the same way
    const R = mulberry32(31);
    ctx.fillStyle = '#b39a85'; oval(0, 40, 36, 10);
    ctx.fillStyle = '#c9b29c'; oval(-6, 37, 22, 6);
    const col = '#ff6f8d', tip = '#ffc2d1';
    ctx.lineCap = 'round';
    const br = (x, y, len, a, d) => {
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      ctx.strokeStyle = col; ctx.lineWidth = 3 + d * 2.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
      if (d > 0) { br(ex, ey, len * 0.74, a - 0.42 - R() * 0.25, d - 1); br(ex, ey, len * 0.74, a + 0.42 + R() * 0.25, d - 1); }
      else { ctx.fillStyle = tip; circle(ex, ey, 3.4); }
    };
    br(0, 36, 26, -Math.PI / 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 7; i++) circle(-20 + R() * 40, -12 + R() * 40, 1.4);
  }

  // ---------- each picture word, drawn in a 100-unit box round (0, 0) ----------
  // k: scale, (cx, cy): the middle of the drawing as drawn, so it sits centred in its box
  const PICS = {
    SHELL: { draw: (t, h) => drawScallop(h), k: 1, cx: 0, cy: 6 },
    FISH: { draw: (t, h) => CRE.fish('#ff8c2e', t, false, h, 0), k: 1.18, cx: -7, cy: -2 },
    CRAB: { draw: (t, h) => CRE.crab('#ff5a4f', t, false, h, 0), k: 1.12, cx: 0, cy: -3 },
    STAR: { draw: (t, h) => CRE.starfish('#ffa53d', t, false, h, 0), k: 1.24, cx: 0, cy: 0 },
    TURTLE: { draw: (t, h) => CRE.turtle('#3fbf7f', t, false, h, 0), k: 1.13, cx: 1, cy: -2 },
    WHALE: { draw: (t, h) => CRE.whale('#4f8ff0', t, false, h, 0), k: 1.05, cx: -8, cy: -6 },
    OCTOPUS: { draw: (t, h) => CRE.octopus('#b86bff', t, false, h, 0), k: 1.2, cx: 0, cy: 2 },
    SEAHORSE: { draw: (t, h) => CRE.seahorse('#1fc2ad', t, false, h, 0), k: 1.1, cx: 0, cy: 2 },
    DOLPHIN: { draw: (t, h) => CRE.dolphin('', t, false, h), k: 1.22, cx: -2, cy: -5 },
    PEARL: { draw: (t, h) => drawPearlPic(h), k: 1, cx: 0, cy: -9 },
    CORAL: { draw: () => drawCoral(), k: 1, cx: 0, cy: 2 },
    CHEST: { draw: (t, h) => { drawChest(0, 16, 0, t, 0.72); if (h) { ctx.fillStyle = '#fffbe0'; star(34, -30, 8, 2.8, 4, 0.3); ctx.fill(); } }, k: 1.05, cx: 0, cy: -2 },
    COIN: { draw: (t, h) => { drawCoin(0, 0, 0, 38); if (h) { ctx.fillStyle = '#fffbe0'; star(26, -28, 9, 3, 4, 0.4); ctx.fill(); } }, k: 1, cx: 0, cy: 0 },
    KEY: { draw: () => drawKey(-4, 2, -0.62, 1.5, '#ff4d8d'), k: 1, cx: 0, cy: 0 },
  };
  function paintPictureAt(word, x, y, size, happy, t) {
    const P = PICS[word];
    if (!P) return;
    ctx.save(); ctx.translate(x, y); ctx.scale((size / 100) * P.k, (size / 100) * P.k); ctx.translate(-P.cx, -P.cy);
    P.draw(t || 0, !!happy);
    ctx.restore();
  }
  // a picture as a sprite, `size` world units square (cached per size)
  const picCache = new Map();
  function pictureSprite(word, size, happy) {
    const px = Math.max(8, Math.round(size * s * 1.15)), key = `${word}|${px}|${happy ? 1 : 0}`;
    let c = picCache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = px;
      const g = c.getContext('2d');
      withCtx(g, () => { ctx.setTransform(px / 115, 0, 0, px / 115, px / 2, px / 2); paintPictureAt(word, 0, 0, 100, happy, 0.4); });
      picCache.set(key, c);
    }
    return c;
  }
  function drawPicture(word, x, y, size, happy, rot, sc) {
    const spr = pictureSprite(word, size, happy), e = size * 1.15 * (sc || 1);
    if (rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(spr, -e / 2, -e / 2, e, e); ctx.restore(); }
    else ctx.drawImage(spr, x - e / 2, y - e / 2, e, e);
  }
  // draw a picture straight into a <canvas> element (the results card)
  function paintPicture(el, word, happy) {
    // the layout size (offsetWidth ignores the card's pop-in scale(0), which getBoundingClientRect would report)
    const w = Math.max(8, Math.round(el.offsetWidth * dpr)), h = Math.max(8, Math.round(el.offsetHeight * dpr));
    el.width = w; el.height = h;
    withCtx(el.getContext('2d'), () => { const k = Math.min(w, h) / 115; ctx.setTransform(k, 0, 0, k, w / 2, h / 2); paintPictureAt(word, 0, 0, 100, happy, 0.4); });
  }
  // how much of each picture's box is painted (the tests check none is blank or spills badly)
  function pictureCheck() {
    const out = {};
    for (const w of Object.keys(PICS)) {
      const c = document.createElement('canvas'); c.width = c.height = 230;
      withCtx(c.getContext('2d'), () => { ctx.setTransform(2, 0, 0, 2, 115, 115); paintPictureAt(w, 0, 0, 100, false, 0.4); });
      const d = c.getContext('2d').getImageData(0, 0, 230, 230).data;
      let on = 0, edge = 0;
      for (let y = 0; y < 230; y++) for (let x = 0; x < 230; x++) if (d[(y * 230 + x) * 4 + 3] > 40) { on++; if (x < 8 || y < 8 || x > 221 || y > 221) edge++; }
      out[w] = { fill: +(on / (230 * 230)).toFixed(3), edge };
    }
    return out;
  }

  // ---------- Isabella (copied from Coral Maze's art.js) ----------
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

  // ---------- where everything goes ----------
  // The board (the letter grid) sits just right of the home column (19vh + 2vh = 113 units), the picture panel to its
  // right; both together centred in what is left. Cells are square, as big as fit (and no bigger than CMAX per mode).
  const HOME_COL = 126, GAP = 22, MARGIN = 14, TOPM = 16, BOTM = 16, PAD = 0.24;
  const CMAX = { easy: 98, medium: 64, hard: 44 };
  function textW(word, size) { ctx.font = `900 ${size}px ${FONT}`; return ctx.measureText(word).width; }
  // the picture panel at scale k: its size and a function that lays its cards out from a top-left corner
  function panelFor(mode, words, k) {
    if (mode === 'easy') {
      const w = 330 * k, P = 196 * k, len = words[0].length, g = 6 * k, tile = Math.min(62 * k, (w - 32 * k - g * (len - 1)) / len), h = 20 * k + P + 18 * k + tile + 22 * k;
      return {
        w, h, place(x, y) {
          const tx = x + (w - len * tile - g * (len - 1)) / 2, ty = y + 20 * k + P + 18 * k;
          return [{ x, y, w, h, big: true, pic: { x: x + w / 2, y: y + 20 * k + P / 2, s: P }, tiles: Array.from({ length: len }, (_, i) => ({ x: tx + i * (tile + g), y: ty, s: tile })) }];
        },
      };
    }
    if (mode === 'medium') {
      const n = words.length, ch = 104 * k, gap = 14 * k, pic = 88 * k, fs = 40 * k, tw = Math.max(...words.map((w) => textW(w, fs)));
      const w = 12 * k + pic + 14 * k + tw + 20 * k, h = n * ch + (n - 1) * gap;
      return {
        w, h, place(x, y) {
          return words.map((_, i) => { const cy = y + i * (ch + gap); return { x, y: cy, w, h: ch, pic: { x: x + 12 * k + pic / 2, y: cy + ch / 2, s: pic }, text: { x: x + 12 * k + pic + 14 * k, y: cy + ch / 2, size: fs } }; });
        },
      };
    }
    // hard: two columns of seven
    const rows = Math.ceil(words.length / 2), ch = Math.min(66, (H - TOPM - BOTM - (rows - 1) * 8) / rows) * Math.max(k, 0.8), gap = 8, pic = 52 * k, fs = 22 * k;
    const cols = [words.slice(0, rows), words.slice(rows)];
    const cw = cols.map((c) => 8 * k + pic + 7 * k + Math.max(...c.map((w) => textW(w, fs))) + 12 * k);
    const w = cw[0] + 10 * k + cw[1], h = rows * ch + (rows - 1) * gap;
    return {
      w, h, place(x, y) {
        return words.map((_, i) => {
          const col = i < rows ? 0 : 1, row = col ? i - rows : i, cx = col ? x + cw[0] + 10 * k : x, cy = y + row * (ch + gap);
          return { x: cx, y: cy, w: cw[col], h: ch, pic: { x: cx + 8 * k + pic / 2, y: cy + ch / 2, s: pic }, text: { x: cx + 8 * k + pic + 7 * k, y: cy + ch / 2, size: fs } };
        });
      },
    };
  }
  function layout(mode, p) {
    const words = p.words.map((w) => w.word), cols = p.cols, rows = p.rows, availH = H - TOPM - BOTM;
    let best = null;
    for (let k = 1; k >= 0.5 - 1e-9; k -= 0.05) {
      const pan = panelFor(mode, words, k);
      const cW = (VW - HOME_COL - GAP - MARGIN - pan.w) / (cols + 2 * PAD), cH = availH / (rows + 2 * PAD);
      const c = Math.min(cW, cH, CMAX[mode]);
      if (!best || c > best.c + 0.01) best = { k, c, pan };
      if (cW >= Math.min(cH, CMAX[mode])) break;
    }
    const { c, pan, k } = best, bw = c * (cols + 2 * PAD), bh = c * (rows + 2 * PAD);
    const total = bw + GAP + pan.w, x0 = HOME_COL + Math.max(0, (VW - MARGIN - HOME_COL - total) / 2);
    const bx = x0, by = TOPM + (availH - bh) / 2, px = bx + bw + GAP, py = (H - pan.h) / 2;
    const cards = pan.place(px, py), chestSc = clamp(pan.w / 330, 0.62, 1);
    const chest = { x: px + pan.w / 2, y: 522, sc: chestSc };
    return {
      mode, c, k, cols, rows, bx, by, bw, bh, gx: bx + PAD * c, gy: by + PAD * c, radius: c * 0.42,
      panel: { x: px, y: py, w: pan.w, h: pan.h }, cards, chest,
      party: { x: Math.max(bx + bw + 60, chest.x - 125 * chestSc), y: 300, sc: clamp(chestSc * 1.05, 0.75, 1.05) },
    };
  }
  const cellX = (lay, x) => lay.gx + (x + 0.5) * lay.c;
  const cellY = (lay, y) => lay.gy + (y + 0.5) * lay.c;

  // ---------- the board: painted once per puzzle ----------
  let board = null;        // { key, cv, x, y, w, h }
  const glyphCache = new Map();
  function clearCaches() { board = null; glyphCache.clear(); picCache.clear(); }
  // a new puzzle (or a new screen size): only its own board, letters and pictures are kept, so memory stays small
  function newPuzzle() { board = null; glyphCache.clear(); picCache.clear(); }
  function buildBoard(lay, th) {
    const m = 16, w = lay.bw + 2 * m, h = lay.bh + 2 * m, cv = document.createElement('canvas');
    cv.width = Math.ceil(w * s); cv.height = Math.ceil(h * s);
    withCtx(cv.getContext('2d'), () => {
      ctx.setTransform(s, 0, 0, s, (m - lay.bx) * s, (m - lay.by) * s);
      const R = lay.c * 0.55;
      ctx.fillStyle = 'rgba(0,30,70,0.22)'; rrect(lay.bx + 3, lay.by + 9, lay.bw, lay.bh, R); ctx.fill();
      const g = ctx.createLinearGradient(0, lay.by, 0, lay.by + lay.bh);
      g.addColorStop(0, th.board); g.addColorStop(1, shade(th.board.length === 7 ? th.board : '#ffffff', -0.06));
      ctx.fillStyle = g; rrect(lay.bx, lay.by, lay.bw, lay.bh, R); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(3, lay.c * 0.07); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,60,0.55)'; ctx.lineWidth = Math.max(1.5, lay.c * 0.03);
      rrect(lay.bx + lay.c * 0.08, lay.by + lay.c * 0.08, lay.bw - lay.c * 0.16, lay.bh - lay.c * 0.16, R * 0.85); ctx.stroke();
      // the tiles
      const c = lay.c, ins = c * 0.06, tr = c * 0.2;
      for (let y = 0; y < lay.rows; y++) {
        for (let x = 0; x < lay.cols; x++) {
          const tx = lay.gx + x * c + ins, ty = lay.gy + y * c + ins, tw = c - 2 * ins;
          ctx.fillStyle = 'rgba(40,90,140,0.16)'; rrect(tx, ty + c * 0.04, tw, tw, tr); ctx.fill();
          const tg = ctx.createLinearGradient(0, ty, 0, ty + tw);
          tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#e3f3ff');
          ctx.fillStyle = tg; rrect(tx, ty, tw, tw, tr); ctx.fill();
        }
      }
    });
    return { cv, x: lay.bx - m, y: lay.by - m, w, h };
  }
  // one letter, painted once per size and style: 'n' navy, 'f' white with a dark rim (on a found word)
  function glyph(ch, style, size) {
    const px = Math.max(8, Math.round(size * s)), key = ch + style + px;
    let g = glyphCache.get(key);
    if (!g) {
      g = document.createElement('canvas'); g.width = g.height = px;
      const x = g.getContext('2d'), fs = px * 0.64;
      x.font = `900 ${fs}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
      const m = x.measureText(ch), asc = m.actualBoundingBoxAscent || fs * 0.72, desc = m.actualBoundingBoxDescent || 0, y = px / 2 + (asc - desc) / 2;
      if (style === 'f') { x.lineJoin = 'round'; x.lineWidth = fs * 0.17; x.strokeStyle = 'rgba(0,40,80,0.6)'; x.strokeText(ch, px / 2, y); x.fillStyle = '#fff'; }
      else x.fillStyle = NAVY;
      x.fillText(ch, px / 2, y);
      glyphCache.set(key, g);
    }
    return g;
  }
  // a rounded bar from one cell to another (a found word, or the line under a finger)
  function capsule(lay, a, b, r, fill, edge, alpha, grow) {
    const x0 = cellX(lay, a[0]), y0 = cellY(lay, a[1]);
    let x1 = cellX(lay, b[0]), y1 = cellY(lay, b[1]);
    if (grow != null && grow < 1) { x1 = lerp(x0, x1, grow); y1 = lerp(y0, y1, grow); }
    ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.lineCap = 'round';
    ctx.strokeStyle = edge; ctx.lineWidth = 2 * r + Math.max(3, r * 0.2);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = fill; ctx.lineWidth = 2 * r;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = r * 0.75;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  // ---------- the picture cards ----------
  function tick(x, y, r, u) {
    const k = backOut(clamp(u, 0, 1));
    if (k <= 0.01) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(0,60,20,0.25)'; circle(0, r * 0.12, r);
    ctx.fillStyle = '#2fb35a'; circle(0, 0, r);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.22; ctx.stroke();
    ctx.lineWidth = r * 0.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.42, r * 0.02); ctx.lineTo(-r * 0.1, r * 0.34); ctx.lineTo(r * 0.45, -r * 0.3); ctx.stroke();
    ctx.restore();
  }
  function drawCards(v, time) {
    const lay = v.lay, words = v.p.words, a = v.panelAlpha;
    if (a <= 0.01) return;
    ctx.save(); ctx.globalAlpha = a;
    lay.cards.forEach((cd, i) => {
      const w = words[i], found = v.found[i], age = v.foundAge[i], hint = v.hint && v.hint.i === i, col = w.color;
      // the card
      const lift = found && age >= 0 && age < 0.5 ? Math.sin((age / 0.5) * Math.PI) * cd.h * 0.05 : 0;
      ctx.fillStyle = 'rgba(0,40,80,0.16)'; rrect(cd.x + 2, cd.y + 5, cd.w, cd.h, Math.min(22, cd.h * 0.3)); ctx.fill();
      ctx.fillStyle = found ? shade(col, 0.72) : 'rgba(255,255,255,0.86)'; rrect(cd.x, cd.y - lift, cd.w, cd.h, Math.min(22, cd.h * 0.3)); ctx.fill();
      ctx.strokeStyle = found ? col : 'rgba(255,255,255,0.95)'; ctx.lineWidth = found ? 3.5 : 3; ctx.stroke();
      // the picture: bobbing gently; hopping and wiggling when found; pulsing when it is the hint's word
      const P = cd.pic, bob = Math.sin(time * 1.7 + i * 0.9) * P.s * 0.025;
      let dy = bob - lift, rot = 0, sc = 1;
      if (found && age >= 0 && age < 0.7) { const u = age / 0.7; dy -= Math.sin(u * Math.PI) * P.s * 0.16; rot = Math.sin(age * 26) * 0.16 * (1 - u); }
      if (hint) { sc = 1 + 0.07 * Math.sin(time * 4.5); glow(P.x, P.y, P.s * 0.85, 'rgba(255,220,90,0.9)', 0.55 + 0.25 * Math.sin(time * 4.5)); }
      drawPicture(w.word, P.x, P.y + dy, P.s, found, rot, sc);
      // the word: letter tiles on the big Easy card, plain letters on the others
      if (cd.tiles) {
        if (hint) {
          // the first letter's tile glows too (behind it, so the letter stays crisp), with a gold ring
          const t0 = cd.tiles[0], pul = 0.5 + 0.5 * Math.sin(time * 4.5);
          glow(t0.x + t0.s / 2, t0.y + t0.s / 2, t0.s * (0.95 + 0.1 * pul), 'rgba(255,214,70,0.95)', 0.5 + 0.35 * pul);
        }
        cd.tiles.forEach((t, k) => {
          let hop = 0;
          if (found && age >= 0) { const u = age - k * 0.06; if (u > 0 && u < 0.35) hop = Math.sin((u / 0.35) * Math.PI) * t.s * 0.25; }
          const tr = t.s * 0.22;
          ctx.fillStyle = 'rgba(40,90,140,0.18)'; rrect(t.x, t.y + t.s * 0.05 - hop, t.s, t.s, tr); ctx.fill();
          ctx.fillStyle = found ? col : '#ffffff'; rrect(t.x, t.y - hop, t.s, t.s, tr); ctx.fill();
          ctx.strokeStyle = found ? shade(col, -0.3) : 'rgba(40,90,140,0.25)'; ctx.lineWidth = 2; ctx.stroke();
          ctx.drawImage(glyph(w.word[k], found ? 'f' : 'n', t.s), t.x, t.y - hop, t.s, t.s);
          if (hint && k === 0) {
            ctx.strokeStyle = `rgba(255,176,0,${0.55 + 0.4 * (0.5 + 0.5 * Math.sin(time * 4.5))})`; ctx.lineWidth = Math.max(2.5, t.s * 0.07);
            rrect(t.x - t.s * 0.08, t.y - t.s * 0.08, t.s * 1.16, t.s * 1.16, tr * 1.3); ctx.stroke();
          }
        });
      } else {
        const T = cd.text;
        ctx.font = `900 ${T.size}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        if (found) { ctx.lineJoin = 'round'; ctx.lineWidth = T.size * 0.2; ctx.strokeStyle = shade(col, -0.35); ctx.strokeText(w.word, T.x, T.y + T.size * 0.04 - lift); ctx.fillStyle = '#fff'; }
        else ctx.fillStyle = NAVY;
        ctx.fillText(w.word, T.x, T.y + T.size * 0.04 - lift);
      }
      if (found) tick(P.x + P.s * 0.36, P.y - P.s * 0.34 - lift, Math.max(5.5, P.s * 0.175), age < 0 ? 1 : (age - 0.2) / 0.35);
    });
    ctx.restore();
  }

  // ---------- a frame of play ----------
  // v (from game.js): { mode, p, lay, found[], foundAge[] (seconds since found, -1 if not), sel { cells, magnet } | null,
  //   selCells (a Set of the cell indices y * cols + x under the finger), cellFound[] (1 where a found word lies),
  //   hop[] (0..1 per cell: how far through its little jump a just-found letter is), fades [{ cells, t }],
  //   hint { i, cell } | null, intro 0..1, panelAlpha, win { t, rise, open, isa } | null, crown }
  function drawPlay(v, time, dt) {
    const lay = v.lay, p = v.p, th = THEMES[v.mode], c = lay.c, r = lay.radius;
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 14);
    drawBubbles(time, time * 14);
    drawSand(th, 526, 3);
    for (let i = 0; i < 2; i++) seaweed(30 + i * 16, 540, 60 + i * 30, time, i % 2 ? '#3fae6a' : '#2f8f5a', i + 7, 5);
    seaweed(VW - 16, 540, 100, time, '#2f8f5a', 4, 5);
    // the board, popping in at the start
    if (!board || board.key !== p.seed + ':' + p.mode + ':' + c.toFixed(3) + ':' + s.toFixed(4)) { board = buildBoard(lay, th); board.key = p.seed + ':' + p.mode + ':' + c.toFixed(3) + ':' + s.toFixed(4); }
    const ib = backOut(clamp(v.intro / 0.6, 0, 1));
    if (ib < 1) {
      const cx = lay.bx + lay.bw / 2, cy = lay.by + lay.bh / 2;
      ctx.save(); ctx.globalAlpha = clamp(v.intro * 3, 0, 1); ctx.translate(cx, cy); ctx.scale(0.85 + 0.15 * ib, 0.85 + 0.15 * ib); ctx.translate(-cx, -cy);
      ctx.drawImage(board.cv, board.x, board.y, board.w, board.h);
      ctx.restore();
    } else ctx.drawImage(board.cv, board.x, board.y, board.w, board.h);
    // found words: a bar in the word's colour, growing from its first letter
    const owner = v.cellFound;
    p.words.forEach((w, i) => {
      if (!v.found[i]) return;
      const age = v.foundAge[i];
      capsule(lay, w.cells[0], w.cells[w.len - 1], r, w.color, shade(w.color, -0.3), 1, age < 0 ? 1 : smooth(clamp(age / 0.25, 0, 1)));
    });
    // lines that found nothing fade away
    for (const f of v.fades) capsule(lay, f.cells[0], f.cells[f.cells.length - 1], r * (1 - 0.15 * f.t / 0.45), 'rgba(255,255,255,0.55)', 'rgba(150,180,210,0.6)', clamp(1 - f.t / 0.45, 0, 1));
    // the hint: the first letter of a word glows
    if (v.hint) {
      const hx = cellX(lay, v.hint.cell[0]), hy = cellY(lay, v.hint.cell[1]), pul = 0.5 + 0.5 * Math.sin(time * 4.5);
      glow(hx, hy, c * (0.95 + 0.12 * pul), 'rgba(255,214,70,0.95)', 0.55 + 0.35 * pul);
    }
    // the line under the finger
    if (v.sel && v.sel.cells.length) {
      const sc = v.sel.cells, mag = v.sel.magnet >= 0;
      // see-through white glass with a sky-blue rim (no word's own colour); a gold rim once it sits on a word
      if (mag) glow((cellX(lay, sc[0][0]) + cellX(lay, sc[sc.length - 1][0])) / 2, (cellY(lay, sc[0][1]) + cellY(lay, sc[sc.length - 1][1])) / 2, c * (sc.length * 0.5 + 0.6), 'rgba(255,240,170,0.6)', 0.35);
      capsule(lay, sc[0], sc[sc.length - 1], r * 1.04, mag ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.62)', mag ? 'rgba(255,176,0,1)' : 'rgba(34,184,230,0.95)', 1);
    }
    // the letters (sprites); found ones white, the ones under the finger a little bigger; hops just after a find
    const W = p.cols, sel = v.sel ? v.selCells : null, intro = v.intro;
    for (let y = 0; y < p.rows; y++) {
      const row = p.grid[y];
      for (let x = 0; x < W; x++) {
        const k = y * W + x, f = owner[k], cx = cellX(lay, x), cy = cellY(lay, y);
        let size = c, dy = 0;
        if (intro < 1) { const u = clamp((intro * 0.9 - (x + y) * 0.012) / 0.35, 0, 1); size *= backOut(u); if (size <= 0.5) continue; }
        if (sel && sel.has(k)) size *= 1.12;
        const hop = v.hop[k];
        if (hop > 0) dy = -Math.sin(hop * Math.PI) * c * 0.22;
        ctx.drawImage(glyph(row[x], f ? 'f' : 'n', c), cx - size / 2, cy - size / 2 + dy, size, size);
      }
    }
    if (v.hint) {
      // a ring round the hinted letter, over it
      const hx = cellX(lay, v.hint.cell[0]), hy = cellY(lay, v.hint.cell[1]), pul = 0.5 + 0.5 * Math.sin(time * 4.5);
      ctx.save(); ctx.globalAlpha = 0.55 + 0.4 * pul; ctx.strokeStyle = '#ffb000'; ctx.lineWidth = Math.max(2.5, c * 0.07);
      ctx.beginPath(); ctx.arc(hx, hy, c * (0.44 + 0.04 * pul), 0, TAU); ctx.stroke(); ctx.restore();
    }
    drawCards(v, time);
    // the celebration: the chest rises out of the sand and bursts open; Isabella swims in and twirls
    if (v.win) {
      const C = lay.chest, wv = v.win;
      drawChest(C.x, H + 90 + (C.y - H - 90) * wv.rise, wv.open, time, C.sc);
      const I = wv.isa;
      if (I) {
        if (I.glow) glow(I.x, I.y, 110 * I.sc, 'rgba(255,220,90,0.55)', 0.45);
        drawIsabella(I.x, I.y, time, { scale: I.sc, flip: I.flip, tilt: I.tilt, swim: 11, happy: true, crown: v.crown });
      }
    }
    drawParts();
  }

  // ---------- the mode picker's backdrop: a reef along the bottom, letter bubbles, Isabella swimming past ----------
  function drawMenu(time, dt, o) {
    const th = THEMES.menu;
    stepParts(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawWater(th, time, time * 20);
    drawBubbles(time, time * 20);
    // big soft bubbles with letters in them, drifting up
    ctx.font = `900 30px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of letterBubbles) {
      const y = (((b.y0 - time * b.sp) % 640) + 640) % 640 - 50, x = b.x * VW + Math.sin(time * 0.6 + b.ph) * 18;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; circle(x, y, b.r);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(x - b.r * 0.4, y - b.r * 0.45, b.r * 0.22, b.r * 0.12, -0.7, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x, y + 1); ctx.scale(b.r / 26, b.r / 26); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(b.ch, 0, 0); ctx.restore();
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
  function burst(type, x, y, size) {
    const k = size || 1;
    if (type === 'found') for (let i = 0; i < 9; i++) spawn({ t: 'spark', x: x + rnd(-8, 8) * k, y: y + rnd(-8, 8) * k, vx: rnd(-160, 160) * k, vy: rnd(-200, 80) * k, life: 0.75, max: 0.75, c: i % 3 ? '#fff6a0' : '#ffffff', r: rnd(3, 6.5) * k });
    if (type === 'tick') {
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; spawn({ t: 'spark', x, y, vx: Math.cos(a) * rnd(110, 200) * k, vy: Math.sin(a) * rnd(110, 200) * k, life: 0.7, max: 0.7, c: i % 2 ? '#fff6a0' : '#b7f5c4', r: rnd(4, 7) * k }); }
      for (let i = 0; i < 3; i++) spawn({ t: 'heart', x: x + rnd(-14, 14), y: y + rnd(-10, 6), vx: rnd(-40, 40), vy: rnd(-130, -80), life: 1, max: 1, r: rnd(6, 9) * k });
    }
    if (type === 'miss') for (let i = 0; i < 5; i++) spawn({ t: 'bubble', x: x + rnd(-10, 10), y: y + rnd(-10, 10), vx: rnd(-20, 20), vy: rnd(-80, -40), life: 0.8, max: 0.8, r: rnd(2, 5) * k });
    if (type === 'puff') for (let i = 0; i < 16; i++) spawn({ t: 'puff', x: x + rnd(-70, 70) * k, y: y + rnd(-8, 8), vx: rnd(-90, 90), vy: rnd(-70, -10), life: 0.9, max: 0.9, r: rnd(8, 16) * k, c: 'rgba(255,240,200,0.8)' });
    if (type === 'cheer') for (let i = 0; i < 8; i++) spawn({ t: i % 2 ? 'heart' : 'spark', x: x + rnd(-40, 40), y: y + rnd(-30, 10), vx: rnd(-60, 60), vy: rnd(-150, -70), life: 1.1, max: 1.1, c: '#fff6a0', r: rnd(5, 9) });
    if (type === 'notes') for (let i = 0; i < 4; i++) spawn({ t: 'note', x: x + rnd(-24, 24), y: y - 16, vx: rnd(-30, 30), vy: rnd(-95, -60), life: 1.4, max: 1.4, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], r: rnd(0.9, 1.3), ph: Math.random() * 6 });
    if (type === 'confetti') for (let i = 0; i < 60; i++) spawn({ t: 'confetti', x: rnd(0, VW), y: rnd(-60, -10), vx: rnd(-40, 40), vy: rnd(40, 120), life: 4, max: 4, c: RAINBOW[i % 7], ph: Math.random() * TAU, fall: true });
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

  window.WordsArt = {
    init, resize, toWorld, toCss, layout, cellX, cellY, newPuzzle, drawPlay, drawMenu, burst, fountain, clearParticles,
    paintPicture, pictureCheck, PICS, THEMES, H,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get particles() { return parts.length; },
    cacheSizes: () => ({ glyphs: glyphCache.size, pictures: picCache.size, glows: Object.keys(glowCache).length, board: board ? 1 : 0 }),
  };
})();
