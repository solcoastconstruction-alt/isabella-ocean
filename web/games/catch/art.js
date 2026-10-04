/* Sea Catch: everything you see. All art is drawn in code.
 * House style copied from web/games/pop/art.js and web/render.js (never shared, never edited there): a
 * 540-unit-tall world scaled to the screen, DPR capped at 2.5, outlined text, the glow sprite, the gold
 * coin and the treasure chest, the sea friends and the grumps, and Isabella herself (here with a big
 * shell on her head to catch things in). */
(function () {
  'use strict';
  const H = 540, TAU = Math.PI * 2;
  const FLOOR = 446;     // top of the sand ridge: Isabella swims just above it
  const TRAY_Y = 494;    // the counting tray: ten little places along the sand
  const TRAY_NUM = 527;  // ...with a numeral under each
  const FTOP = FLOOR - 18;
  const INSIDE = 0.0162; // a friend inside a bubble of radius r is drawn at scale r * INSIDE
  const ISA_Y = 404, ISA_SC = 1.3;   // where Isabella swims, and how big
  const SHELL_DX = 33 * ISA_SC;      // the shell sits on her head, this far ahead of her middle
  const SHELL_Y = 334;               // the shell's mouth (logic.js CATCH_Y)
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  // one colour per counting number, 1..10
  const NUMCOL = ['#ff4d6d', '#ff8a1f', '#e8a800', '#2fb35a', '#1c9ad6', '#6c63ff', '#b552f0', '#ff4f9a', '#00a99d', '#ff6a2b'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38', GOLD = '#ffcc33';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const easeOutBack = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngAt = (i, salt) => mulberry32((i * 7919 + salt * 104729) >>> 0);

  // Five seas, used as level themes: their colours, decorations and a key for the music.
  const SCENES = [
    { id: 'shallows', top: '#86e6f2', bot: '#1f8fc0', far: 'rgba(28,118,170,0.5)', sand: ['#fbe8b4', '#e2c07c'],
      tip: ['#ff8fab', '#ffd166', '#ff6b6b', '#ffa94d'], decor: 'coral', ray: 0.2, key: 0 },
    { id: 'garden', top: '#a8e6ff', bot: '#3a6fd0', far: 'rgba(60,80,170,0.45)', sand: ['#ffe6f1', '#efbcd4'],
      tip: ['#ff5d8f', '#c77dff', '#ff9e6d', '#ffd166'], decor: 'fans', ray: 0.18, key: 2 },
    { id: 'kelp', top: '#86e3c4', bot: '#0f6b5e', far: 'rgba(10,80,70,0.5)', sand: ['#eee2a8', '#c8b26e'],
      tip: ['#b8f27c', '#ffd166', '#7cf2c8'], decor: 'kelp', ray: 0.18, key: 5 },
    { id: 'glow', top: '#2a4c86', bot: '#070f2c', far: 'rgba(14,28,70,0.7)', sand: ['#34416a', '#1c2444'],
      tip: ['#5cf2ff', '#ff5cf0', '#9dff5c'], decor: 'glow', ray: 0.05, glow: true, key: -3 },
    { id: 'palace', top: '#b9f0ff', bot: '#6a7fe6', far: 'rgba(130,140,230,0.45)', sand: ['#fdeaf6', '#e9c6df'],
      tip: RAINBOW, decor: 'palace', ray: 0.22, key: 7 },
  ];

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  let fade = 1; // multiplies glows while a sea is fading in or out
  const amb = [];
  const backCache = {}, floorCache = {}, glassCache = {};
  let coinSpr = null;

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d', { alpha: false });
    for (let i = 0; i < 34; i++) amb.push({ x: Math.random() * 2400, y: Math.random() * H, r: 1.2 + Math.random() * 3, sp: 12 + Math.random() * 26, ph: Math.random() * TAU });
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    s = canvas.height / H; VW = canvas.width / s;
    for (const c of [backCache, floorCache, glassCache]) for (const k of Object.keys(c)) delete c[k];
    coinSpr = null;
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toClient = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });
  function begin() { ctx.setTransform(s, 0, 0, s, 0, 0); ctx.globalAlpha = 1; }
  // keep big cached pictures only for the seas on screen (phones have little memory)
  function keepScenes(a, b) {
    for (const c of [backCache, floorCache]) for (const k of Object.keys(c)) if (+k !== a && +k !== b) delete c[k];
  }

  // ---------- the counting tray's ten places, and the coin row at the top ----------
  const traySpacing = () => Math.min(66, (VW - 150) / 10);
  const trayX = (i) => VW / 2 + (i - 4.5) * traySpacing();
  const miniScale = () => clamp(traySpacing() * 0.0068, 0.3, 0.45);
  // the coins still to earn sit in a row of empty rings ending in a little chest (top right, clear of the home button)
  function hudLayout(target) {
    const r = 17, sp = 41, w = target * sp + 84, x1 = VW - 22, x0 = Math.max(126, x1 - w), y = 42;
    const step = Math.min(sp, (x1 - x0 - 84) / Math.max(1, target));
    const slots = [];
    for (let i = 0; i < target; i++) slots.push({ x: x0 + 26 + i * step, y, r });
    return { x0, x1, y, h: 56, slots, chest: { x: x1 - 40, y: y + 9 } };
  }

  // ---------- helpers (from render.js) ----------
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
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (a == null ? 1 : a) * fade;
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
    if (!p) {
      p = c === 'rainbow' ? { base: '#ffd93d', dark: '#8a63ff', light: '#fff6c0', rainbow: true } : { base: c, dark: shade(c, -0.28), light: shade(c, 0.5), rainbow: false };
      palCache.set(c, p);
    }
    return p;
  }
  const glowColCache = new Map();
  function glowFor(c) {
    let v = glowColCache.get(c);
    if (!v) {
      if (c === 'rainbow') v = 'rgba(255,240,170,0.8)';
      else { const n = parseInt(c.slice(1), 16); v = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0.8)`; }
      glowColCache.set(c, v);
    }
    return v;
  }

  // ---------- faces: big shiny eyes, rosy cheeks, smiles ----------
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
  // ---------- grumpy faces: cartoon cross, never scary ----------
  // a grumpy eye: a heavy lid (in the creature's own colour) slants down toward `dir` (+1: the right side lower)
  function grumpEye(x, y, r, dir, lid, blink) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.08, 0, 0, TAU); ctx.fill();
    if (blink) {
      ctx.strokeStyle = '#2a1a2e'; ctx.lineWidth = r * 0.36; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - r * 0.8, y + r * 0.15); ctx.lineTo(x + r * 0.8, y + r * 0.15); ctx.stroke(); return;
    }
    // a sideways look (forward, the way the creature faces)
    ctx.fillStyle = '#2a1a2e'; ctx.beginPath(); ctx.arc(x + r * 0.22, y + r * 0.3, r * 0.52, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + r * 0.38, y + r * 0.1, r * 0.16, 0, TAU); ctx.fill();
    ctx.fillStyle = lid;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.08, r * 1.16, dir * 0.38, Math.PI * 1.03, Math.PI * 1.97); ctx.closePath(); ctx.fill();
  }
  function grumpBrow(x, y, w, dir, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w * 0.36; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - w * 0.5, y - dir * w * 0.2); ctx.lineTo(x + w * 0.5, y + dir * w * 0.2); ctx.stroke();
  }
  function frown(x, y, w) {
    ctx.strokeStyle = '#3a1030'; ctx.lineWidth = Math.max(2, w * 0.42); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y + w * 0.9, w, 1.22 * Math.PI, 1.78 * Math.PI); ctx.stroke();
  }
  function rainbowFill(x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    RAINBOW.forEach((c, i) => g.addColorStop(i / (RAINBOW.length - 1), c));
    return g;
  }

  // ---------- sea friends: each is drawn facing right inside a box about 80 units across ----------
  const CRE = {
    fish(c, t, blink, happy, wig) {
      const p = pal(c), wag = Math.sin(t * (7 + wig * 9)) * (5 + wig * 5);
      ctx.fillStyle = p.rainbow ? '#c86bfa' : p.dark;
      ctx.beginPath(); ctx.moveTo(-20, 0); ctx.quadraticCurveTo(-34, -4, -45, -21 + wag); ctx.quadraticCurveTo(-38, 0, -45, 21 + wag); ctx.quadraticCurveTo(-34, 4, -20, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-16, -17); ctx.quadraticCurveTo(-4, -38, 14, -19); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.rainbow ? rainbowFill(-30, -24, 30, 24) : p.base;
      ctx.beginPath(); ctx.ellipse(0, 0, 31, 24, 0, 0, TAU); ctx.fill();
      if (!p.rainbow) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-6, 0, 5.5, 22.4, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(4, 11, 18, 7.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.rainbow ? '#ff6bcb' : p.dark;
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
      if (happy || Math.sin(t * 0.9) > 0.75) {
        ctx.fillStyle = 'rgba(200,240,255,0.95)';
        for (const [dx, dy, r] of [[8, -30, 3.4], [2, -37, 2.6], [14, -37, 2.6], [8, -43, 2.2]]) { ctx.beginPath(); ctx.arc(dx + Math.sin(t * 6 + dx) * 1.5, dy + Math.sin(t * 5) * 1.5, r, 0, TAU); ctx.fill(); }
      }
    },

    // ---- the grumpy ones (logic.js GRUMPS). Cross, not scary, and nothing like the friends:
    // heavy lids, low brows and a frown, never cheeks or a smile, in dull colours; each sits on a dark
    // spiky badge (drawItem), where a friend floats in a round shiny bubble. ----
    // a sea urchin: a purple ball of blunt spines
    urchin(c, t, blink, happy, wig) {
      const p = pal(c), R = 20 + Math.sin(t * 2.3) * 0.8 + wig * 1.5, tips = [];
      ctx.strokeStyle = p.dark; ctx.lineCap = 'round'; ctx.lineWidth = 5.4;
      ctx.beginPath();
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * TAU + 0.1 + Math.sin(t * 2.6 + k) * 0.04, len = R + 13 + (k % 2 ? 0 : 6) + wig * 4;
        ctx.moveTo(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        tips.push(Math.cos(a) * len, Math.sin(a) * len);
      }
      ctx.stroke();
      ctx.fillStyle = p.light; ctx.beginPath();
      for (let k = 0; k < tips.length; k += 2) { ctx.moveTo(tips[k] + 2.6, tips[k + 1]); ctx.arc(tips[k], tips[k + 1], 2.6, 0, TAU); }
      ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(-7, -10, 8, 4.5, -0.5, 0, TAU); ctx.fill();
      grumpEye(-7.5, -2, 6, 1, p.base, blink); grumpEye(7.5, -2, 6, -1, p.base, blink);
      grumpBrow(-7.5, -10.5, 10, 1, '#2a1030'); grumpBrow(7.5, -10.5, 10, -1, '#2a1030');
      frown(0, 10, 5);
    },
    // a moray eel: a wavy olive body, a cross brow and a sulky underbite with two little teeth
    eel(c, t, blink, happy, wig) {
      const p = pal(c), w1 = Math.sin(t * 3.4) * (3 + wig * 4), w2 = Math.sin(t * 3.4 + 1.7) * (3 + wig * 4);
      const body = () => { ctx.beginPath(); ctx.moveTo(-41, 10 + w2); ctx.bezierCurveTo(-30, -14 + w1, -12, 26 - w2, 9, 2); };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = p.dark; ctx.lineWidth = 18; body(); ctx.stroke();
      ctx.strokeStyle = p.base; ctx.lineWidth = 13; body(); ctx.stroke();
      ctx.save(); ctx.translate(0, 3); ctx.strokeStyle = p.light; ctx.lineWidth = 3.5; body(); ctx.stroke(); ctx.restore();
      ctx.fillStyle = p.dark; ctx.beginPath(); ctx.ellipse(21, -1, 19, 15, -0.12, 0, TAU); ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(21, -1, 17, 13, -0.12, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,120,0.75)';
      for (const [sx, sy, sr] of [[-31, 2, 2.3], [-21, 5, 2], [-10, 12, 2.4], [1, 9, 2], [13, -9, 2], [19, -12, 1.6]]) { ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#5a1f2e'; ctx.beginPath(); ctx.moveTo(24, 6); ctx.quadraticCurveTo(32, 2.5, 39, 4.5); ctx.quadraticCurveTo(33, 11, 24, 6); ctx.fill();
      ctx.fillStyle = '#fff';
      for (const tx of [29, 34]) { ctx.beginPath(); ctx.moveTo(tx - 2, 6.6); ctx.lineTo(tx, 2.8); ctx.lineTo(tx + 2, 6.2); ctx.closePath(); ctx.fill(); }
      grumpEye(25, -6, 5.4, 1, p.base, blink); grumpBrow(25, -13.5, 11, 1, '#22300e');
    },
    // a little grey shark: chubby and frowning, with a row of small blunt teeth
    shark(c, t, blink, happy, wig) {
      const p = pal(c), wag = Math.sin(t * (6 + wig * 8)) * (4 + wig * 3);
      ctx.fillStyle = p.dark;
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-44, -19 + wag); ctx.quadraticCurveTo(-37, 0, -43, 17 + wag); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-9, -17); ctx.quadraticCurveTo(-3, -38, 10, -37); ctx.quadraticCurveTo(5, -27, 9, -16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(2, 0, 32, 21, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#eef2f7'; ctx.beginPath(); ctx.ellipse(6, 6, 25, 12, 0.06, 0.05, Math.PI - 0.05); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = p.dark; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(-8 + k * 4.5, 0, 6, -0.7, 0.7); ctx.stroke(); }
      ctx.fillStyle = p.dark; ctx.save(); ctx.translate(-1, 13); ctx.rotate(0.7 + Math.sin(t * 5) * 0.2); ctx.beginPath(); ctx.ellipse(-4, 3, 10, 4.5, 0, 0, TAU); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff';
      for (const [tx, ty] of [[19, 7.7], [23, 6.8], [27, 7.2]]) { ctx.beginPath(); ctx.moveTo(tx - 2.2, ty); ctx.lineTo(tx, ty + 3.4); ctx.lineTo(tx + 2.2, ty); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = '#3a1a2a'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(15, 10); ctx.quadraticCurveTo(23, 4, 31, 9); ctx.stroke();
      grumpEye(20, -7, 5.6, 1, p.base, blink); grumpBrow(20, -14.5, 11, 1, '#1e2836');
    },
    // an old boot: brown and floppy, with a patch, loose laces and a sulky face
    boot(c, t, blink, happy, wig) {
      const p = pal(c), flop = Math.sin(t * (2.6 + wig * 6)) * 1.6;
      ctx.fillStyle = '#3d2a1c'; rrect(-25, 19, 62, 8, 3.5); ctx.fill();
      ctx.fillStyle = p.base;
      ctx.beginPath(); ctx.moveTo(-21, -31); ctx.lineTo(7, -31); ctx.lineTo(9, -3);
      ctx.quadraticCurveTo(33, -2, 37, 12); ctx.quadraticCurveTo(38, 20, 32, 20); ctx.lineTo(-24, 20);
      ctx.quadraticCurveTo(-27, -4, -21, -31); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.dark;
      ctx.beginPath(); ctx.moveTo(22, 2 + flop); ctx.quadraticCurveTo(35, 4 + flop, 37, 12); ctx.quadraticCurveTo(38, 20, 32, 20); ctx.lineTo(20, 20); ctx.closePath(); ctx.fill();
      rrect(-25, -36, 36, 10, 4.5); ctx.fill();
      ctx.fillStyle = p.light; rrect(-20, 4, 13, 11, 2.5); ctx.fill();
      ctx.strokeStyle = '#3d2a1c'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [ax, ay, bx, by] of [[-18, 6, -15, 6], [-12, 6, -9, 6], [-18, 13, -15, 13], [-12, 13, -9, 13]]) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke();
      ctx.strokeStyle = '#f1e2c4'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(7, -22); ctx.lineTo(14, -25 + flop); ctx.moveTo(8, -14); ctx.lineTo(16, -15 - flop); ctx.stroke();
      grumpEye(-13, -15, 5.4, 1, p.base, blink); grumpEye(-1, -15, 5.4, -1, p.base, blink);
      grumpBrow(-13, -22.5, 9.5, 1, '#2e1c10'); grumpBrow(-1, -22.5, 9.5, -1, '#2e1c10');
      frown(-7, -5, 4.6);
    },
    // an empty tin can: grey and dented, its lid bent back, with a cross face on the label
    can(c, t, blink, happy, wig) {
      const p = pal(c);
      ctx.save(); ctx.rotate(-0.16 + Math.sin(t * (2.2 + wig * 6)) * 0.05);
      ctx.fillStyle = p.light; ctx.strokeStyle = p.dark; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.ellipse(19, -37, 15, 5.5, -0.75, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = p.base; rrect(-21, -27, 42, 54, 6); ctx.fill();
      ctx.fillStyle = '#56687c'; ctx.fillRect(-21, -14, 42, 29);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(-15, -27, 6, 54);
      ctx.fillStyle = '#39465a'; ctx.beginPath(); ctx.ellipse(0, -27, 21, 6.5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = p.light; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.ellipse(0, -27, 21, 6.5, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = p.dark; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-21, 20); ctx.lineTo(21, 20); ctx.moveTo(9, 22); ctx.quadraticCurveTo(15, 16, 13, 8); ctx.stroke();
      grumpEye(-7, -3, 5.4, 1, '#56687c', blink); grumpEye(7, -3, 5.4, -1, '#56687c', blink);
      grumpBrow(-7, -10.5, 9.5, 1, '#1e2836'); grumpBrow(7, -10.5, 9.5, -1, '#1e2836');
      frown(0, 8, 4.6);
      ctx.restore();
    },
  };
  const KINDS = Object.keys(CRE);

  // o: { flip, wig (0..1 happy wiggle), happy, seed, rot, alpha, glow }
  function drawCreature(kind, col, x, y, sc, time, o) {
    const f = CRE[kind];
    if (!f) return;
    o = o || {};
    const wig = o.wig || 0, seed = o.seed || 0, t = time + seed;
    ctx.save(); ctx.translate(x, y);
    ctx.rotate((o.rot || 0) + Math.sin(t * 21) * 0.3 * wig);
    const sq = 1 + Math.sin(t * 21 + 1.2) * 0.09 * wig;
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.glow) glow(0, 0, 66 * sc, glowFor(col), 0.5);
    ctx.scale((o.flip ? -sc : sc) * sq, sc / sq);
    f(col, t, ((t * 1.37) % 4.1) < 0.13, wig > 0.25 || !!o.happy, wig);
    ctx.restore();
  }

  // ---------- what falls: friends in round shiny bubbles, grumps on dark spiky badges ----------
  // Both are painted once into sprites (crisp at this screen's scale), then stamped.
  // A friend's glass is clear with a white rim; the golden friend's glass is gold.
  function glassSprite(R, gold) {
    const key = R + (gold ? 'au' : '');
    let c = glassCache[key];
    if (!c) {
      const half = Math.ceil((R + 6) * s);
      c = document.createElement('canvas'); c.width = c.height = half * 2;
      const g = c.getContext('2d');
      g.setTransform(s, 0, 0, s, half, half);
      const lg = g.createLinearGradient(-R, -R, R, R);
      if (gold) { lg.addColorStop(0, 'rgba(255,236,150,0.42)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.08)'); lg.addColorStop(1, 'rgba(255,200,60,0.4)'); }
      else { lg.addColorStop(0, 'rgba(255,185,240,0.2)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.03)'); lg.addColorStop(1, 'rgba(140,230,255,0.24)'); }
      g.fillStyle = lg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      const rg = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
      rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.8, 'rgba(255,255,255,0.08)'); rg.addColorStop(1, gold ? 'rgba(255,225,120,0.6)' : 'rgba(255,255,255,0.5)');
      g.fillStyle = rg; g.fill();
      const lw = Math.max(2.4, R * (gold ? 0.07 : 0.05));
      g.strokeStyle = gold ? 'rgba(255,205,60,0.98)' : 'rgba(255,255,255,0.9)'; g.lineWidth = lw; g.beginPath(); g.arc(0, 0, R - lw / 2, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.save(); g.translate(-R * 0.42, -R * 0.45); g.rotate(-0.8); g.beginPath(); g.ellipse(0, 0, R * 0.25, R * 0.12, 0, 0, TAU); g.fill(); g.restore();
      g.beginPath(); g.arc(-R * 0.1, -R * 0.68, R * 0.05, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = R * 0.055; g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, R * 0.77, 0.14 * Math.PI, 0.42 * Math.PI); g.stroke();
      c.R = R; c.half = half;
      glassCache[key] = c;
    }
    return c;
  }
  // The grumps' badge: a dark, jagged burst with an angry red edge. Nothing a friend comes in looks like it.
  const BADGE_R = 62;
  function badgeSprite() {
    let c = glassCache.badge;
    if (!c) {
      const R = BADGE_R, half = Math.ceil((R + 6) * s);
      c = document.createElement('canvas'); c.width = c.height = half * 2;
      const g = c.getContext('2d');
      g.setTransform(s, 0, 0, s, half, half);
      const jag = (r1, r2) => { g.beginPath(); for (let i = 0; i < 28; i++) { const r = i % 2 ? r2 : r1, a = -Math.PI / 2 + (i * Math.PI) / 14; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); };
      const rg = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
      rg.addColorStop(0, 'rgba(70,44,112,0.9)'); rg.addColorStop(1, 'rgba(38,20,66,0.94)');
      g.lineJoin = 'round';
      jag(R, R * 0.8); g.fillStyle = rg; g.fill();
      g.strokeStyle = '#ff5468'; g.lineWidth = 4.2; g.stroke();
      jag(R * 0.84, R * 0.68); g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2; g.stroke();
      c.R = R; c.half = half;
      glassCache.badge = c;
    }
    return c;
  }
  // gold rays turning slowly behind the golden friend
  function rays(r, time) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,225,110,0.5)'; ctx.rotate(time * 0.7);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a - 0.12) * r, Math.sin(a - 0.12) * r); ctx.lineTo(Math.cos(a + 0.12) * r, Math.sin(a + 0.12) * r); }
    ctx.fill(); ctx.restore();
  }
  // it: { x, y, r, kind, col, grumpy, gold, grow 0..1, seed, flip }. Friends float down in bubbles, bobbing;
  // grumps come down on their badges, rocking crossly.
  function drawItem(it, time, glowy, alpha) {
    const g = it.grow < 1 ? easeOutBack(it.grow) : 1, r = it.r * g, ph = it.seed || 0;
    if (r < 1) return;
    ctx.save(); ctx.translate(it.x, it.y);
    if (alpha != null) ctx.globalAlpha = alpha;
    if (it.grumpy) {
      const spr = badgeSprite(), k = (g * 1.0) * (1 + Math.sin(time * 5 + ph) * 0.025), e = (spr.R + 6) * k;
      ctx.save(); ctx.rotate(Math.sin(time * 1.3 + ph) * 0.1);
      ctx.drawImage(spr, -e, -e, e * 2, e * 2);
      ctx.restore();
      drawCreature(it.kind, it.col, 0, 0, 0.98 * g, time, { seed: ph, rot: Math.sin(time * 2.1 + ph) * 0.1, flip: it.flip, alpha });
    } else {
      if (it.gold) { glow(0, 0, r * 2.1, 'rgba(255,215,90,0.85)', 0.6 + 0.2 * Math.sin(time * 5)); rays(r * 1.75, time); }
      drawCreature(it.kind, it.col, 0, Math.sin(time * 1.7 + ph) * r * 0.05, r * INSIDE, time,
        { seed: ph, rot: Math.sin(time * 1.1 + ph) * 0.12, glow: glowy || it.gold, flip: it.flip, happy: !!it.happy, wig: it.happy ? 0.3 : 0, alpha });
      const wob = Math.sin(time * 3.2 + ph) * 0.03;
      ctx.scale(1 + wob, 1 - wob);
      const spr = glassSprite(70, it.gold), k = r / spr.R, e = (spr.R + 6) * k;
      ctx.drawImage(spr, -e, -e, e * 2, e * 2);
    }
    ctx.restore();
  }

  // ---------- the sea behind everything ----------
  function backdrop(idx) {
    let c = backCache[idx];
    if (!c) {
      c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext('2d', { alpha: false });
      g.setTransform(s, 0, 0, s, 0, 0);
      withCtx(g, () => paintBackdrop(SCENES[idx], idx));
      backCache[idx] = c;
    }
    return c;
  }
  function withCtx(g, fn) { const keep = ctx; ctx = g; try { fn(); } finally { ctx = keep; } }
  function paintBackdrop(sc, idx) {
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, sc.top); gr.addColorStop(1, sc.bot);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, VW, H);
    if (sc.decor === 'palace') drawPalace(['#ffd6ec', '#d9d0ff', '#cff5ff', '#fff2c4'], RAINBOW);
    if (sc.decor === 'glow') { const R = rngAt(idx, 23); for (let i = 0; i < 30; i++) glow(R() * VW, 40 + R() * 300, 4 + R() * 9, 'rgba(160,220,255,0.8)', 0.5); }
    ctx.fillStyle = sc.far; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= VW + 20; x += 20) ctx.lineTo(x, FLOOR - 66 + 26 * Math.sin(x / 170 + idx * 1.7) + 13 * Math.sin(x / 61 + 1 + idx));
    ctx.lineTo(VW + 20, H); ctx.closePath(); ctx.fill();
    const tile = 200, base = FLOOR + 20;
    for (let i = 0; i * tile < VW + tile; i++) {
      const R = rngAt(i, 5 + idx * 13), x = i * tile + 30 + R() * 140, k = R(), tip = () => sc.tip[Math.floor(R() * sc.tip.length)];
      ctx.globalAlpha = 0.72;
      if (sc.decor === 'coral') { if (k < 0.5) branchCoral(x, base, tip(), R); else fanCoral(x, base, tip(), R); }
      else if (sc.decor === 'fans') { fanCoral(x, base, tip(), R); if (k < 0.45) branchCoral(x + 70, base, tip(), R); }
      else if (sc.decor === 'kelp') grass(x, base, 0, '#2f8f5a', R);
      else if (sc.decor === 'palace') { if (k < 0.5) branchCoral(x, base, RAINBOW[i % 7], R); else fanCoral(x, base, RAINBOW[(i + 3) % 7], R); }
      else if (sc.decor === 'glow') { ctx.fillStyle = '#16244a'; ctx.beginPath(); ctx.ellipse(x, base - 2, 50 + R() * 40, 34 + R() * 26, 0, Math.PI, 0); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
  }
  function drawPalace(cols, roofs) {
    const tile = 1400, base = FLOOR - 10;
    for (let i = -1; i <= Math.floor(VW / tile) + 1; i++) {
      const R = rngAt(i + 2, 9), bx = i * tile + 300 + R() * 500;
      for (let k = 0; k < 5; k++) {
        const tx = bx + k * 46, th2 = 100 + (k === 2 ? 80 : R() * 50);
        ctx.fillStyle = cols[k % 4]; ctx.globalAlpha = 0.55;
        ctx.fillRect(tx, base - th2, 36, th2 + 40);
        ctx.fillStyle = roofs[(((k * 2 + i) % roofs.length) + roofs.length) % roofs.length];
        ctx.beginPath(); ctx.moveTo(tx - 6, base - th2); ctx.lineTo(tx + 18, base - th2 - 46); ctx.lineTo(tx + 42, base - th2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
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
  function glowPlant(x, y, time, i, col, R) {
    for (let k = 0; k < 3; k++) {
      const h = 60 + R() * 90, bx = x + k * 22, sway = Math.sin(time * 1.3 + i + k) * 8;
      ctx.strokeStyle = 'rgba(80,120,160,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx, y - h / 2, bx + sway, y - h); ctx.stroke();
      glow(bx + sway, y - h, 22, col, 0.6 + 0.4 * Math.sin(time * 2 + k + i));
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx + sway, y - h, 5, 0, TAU); ctx.fill();
    }
  }
  const rayGrad = {};
  function drawBackdrop(idx, time, alpha) {
    const sc = SCENES[idx];
    fade = alpha; ctx.globalAlpha = alpha;
    ctx.drawImage(backdrop(idx), 0, 0, VW, H);
    if (sc.decor === 'kelp') for (let i = 0; i < 9; i++) { const R = rngAt(i, 31); kelp((i + 0.3 + R() * 0.5) * (VW / 8.6), FLOOR + 24, 150 + R() * 140, time, i, i % 2 ? '#2f8f5a' : '#3fae6a'); }
    if (sc.decor === 'glow') for (let i = 0; i < 7; i++) { const R = rngAt(i, 37); glowPlant((i + 0.2 + R() * 0.6) * (VW / 6.6), FLOOR + 20, time, i, sc.tip[i % sc.tip.length], R); }
    if (sc.ray > 0.06) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      let rg = rayGrad[idx];
      if (!rg) { rg = ctx.createLinearGradient(0, 0, 0, H); rg.addColorStop(0, `rgba(255,255,255,${sc.ray})`); rg.addColorStop(1, 'rgba(255,255,255,0)'); rayGrad[idx] = rg; }
      ctx.fillStyle = rg;
      for (let i = 0; i < 6; i++) {
        const span = VW + 500, x = ((((i * 260 + time * 8 + Math.sin(time * 0.3 + i) * 40) % span) + span) % span) - 250, w = 40 + (i % 3) * 25;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w + 180, H); ctx.lineTo(x + 120, H); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.moveTo(0, 0);
    for (let x = 0; x <= VW + 24; x += 24) ctx.lineTo(x, 12 + Math.sin(x / 40 + time * 1.6) * 4);
    ctx.lineTo(VW + 24, 0); ctx.closePath(); ctx.fill();
    // little bubbles and specks drifting up
    if (sc.glow) {
      for (const a of amb) { const p = ambPos(a, time); glow(p.x, p.y, a.r * 5, 'rgba(120,255,240,0.7)', 0.6); }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const a of amb) { const p = ambPos(a, time); ctx.moveTo(p.x + a.r, p.y); ctx.arc(p.x, p.y, a.r, 0, TAU); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; fade = 1;
  }
  function ambPos(a, time) {
    const x = ((((a.x + Math.sin(time * 0.5 + a.ph) * 10) % (VW + 40)) + VW + 40) % (VW + 40)) - 20;
    return { x, y: (((a.y - time * a.sp) % FLOOR) + FLOOR) % FLOOR };
  }

  // ---------- the seabed in front: the aquarium floor ----------
  const floorEdge = (x) => FLOOR + 5 * Math.sin(x / 95 + 1.3) + 3 * Math.sin(x / 41);
  function floorCanvas(idx) {
    let c = floorCache[idx];
    if (!c) {
      c = document.createElement('canvas'); c.width = canvas.width; c.height = Math.ceil((H - FTOP) * s);
      const g = c.getContext('2d');
      g.setTransform(s, 0, 0, s, 0, -FTOP * s);
      withCtx(g, () => paintFloor(SCENES[idx], idx));
      floorCache[idx] = c;
    }
    return c;
  }
  function paintFloor(sc, idx) {
    const gr = ctx.createLinearGradient(0, FLOOR - 8, 0, H);
    gr.addColorStop(0, sc.sand[0]); gr.addColorStop(1, sc.sand[1]);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(-10, H + 4);
    for (let x = -10; x <= VW + 22; x += 12) ctx.lineTo(x, floorEdge(x));
    ctx.lineTo(VW + 22, H + 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.38)'; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = -10; x <= VW + 22; x += 12) ctx.lineTo(x, floorEdge(x) + 2);
    ctx.stroke();
    const R = rngAt(idx + 3, 17);
    for (let i = 0; i < VW / 22; i++) {
      const x = R() * VW, y = FLOOR + 18 + R() * (H - FLOOR - 22), k = R();
      if (sc.glow) { glow(x, y, 6 + R() * 6, 'rgba(120,255,240,0.7)', 0.5); continue; }
      if (k < 0.18) { ctx.fillStyle = sc.tip[Math.floor(R() * sc.tip.length)]; ctx.globalAlpha = 0.55; star(x, y, 8, 3.6, 5, R() * 3); ctx.fill(); ctx.globalAlpha = 1; }
      else if (k < 0.4) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, Math.PI, 0); ctx.fill(); }
      else { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.beginPath(); ctx.ellipse(x, y, 3 + R() * 4, 2 + R() * 2.5, 0, 0, TAU); ctx.fill(); }
    }
  }
  function drawFloor(idx, alpha) {
    const c = floorCanvas(idx);
    ctx.globalAlpha = alpha; ctx.drawImage(c, 0, FTOP, VW, c.height / s); ctx.globalAlpha = 1;
  }
  // ---------- the counting tray: ten places along the bottom, a numeral under each ----------
  // filled[i]: a friend sits in place i (game.js draws the friends). next: the place the next friend takes; its ring breathes.
  function drawTray(filled, time, next, alpha) {
    const sp = traySpacing(), rr = Math.min(21, sp * 0.33), x0 = trayX(0) - sp * 0.62, x1 = trayX(9) + sp * 0.62, y0 = TRAY_Y - 29;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; rrect(x0, y0, x1 - x0, H - 4 - y0, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.setLineDash([6, 6]); ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    const a0 = time * 0.25;
    for (let i = 0; i < 10; i++) if (!filled[i] && i !== next) { const x = trayX(i); ctx.moveTo(x + rr * Math.cos(a0), TRAY_Y + rr * Math.sin(a0)); ctx.arc(x, TRAY_Y, rr, a0, a0 + TAU); }
    ctx.stroke();
    if (next >= 0 && next < 10 && !filled[next]) {
      const pul = 0.5 + 0.5 * Math.sin(time * 3.2);
      ctx.lineWidth = 3 + pul * 1.5; ctx.strokeStyle = `rgba(255,255,255,${0.65 + 0.35 * pul})`;
      ctx.beginPath(); ctx.arc(trayX(next), TRAY_Y, rr * (1 + 0.08 * pul), a0, a0 + TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let i = 0; i < 10; i++) {
      const x = trayX(i);
      if (filled[i]) outlined(String(i + 1), x, TRAY_NUM, 21, '#fff', NUMCOL[i]);
      else outlined(String(i + 1), x, TRAY_NUM, 19, 'rgba(255,255,255,0.7)', 'rgba(0,40,80,0.25)');
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the coin row: a ring for every coin this level needs, ending in the chest they open ----------
  // filled: coins sitting in their rings. o: { pulse: the chest glows and bobs because the last coin is close }
  function drawHud(target, filled, time, o) {
    const L = hudLayout(target), pulse = o && o.pulse;
    ctx.fillStyle = 'rgba(0,40,80,0.12)'; rrect(L.x0, L.y - L.h / 2 + 4, L.x1 - L.x0, L.h, L.h / 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.62)'; rrect(L.x0, L.y - L.h / 2, L.x1 - L.x0, L.h, L.h / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.setLineDash([5, 5]); ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(150,95,0,0.45)'; ctx.fillStyle = 'rgba(255,240,180,0.35)';
    for (let i = Math.max(0, filled); i < target; i++) { const sl = L.slots[i]; ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r, 0, TAU); ctx.fill(); ctx.stroke(); }
    ctx.setLineDash([]);
    const n = Math.min(filled, target);
    for (let i = 0; i < n; i++) {
      const sl = L.slots[i];
      drawCoin(sl.x, sl.y, 0, sl.r);
    }
    const c = L.chest, bob = pulse ? Math.abs(Math.sin(time * 4)) * 4 : 0;
    if (pulse) glow(c.x, c.y - 10, 46, 'rgba(255,220,90,0.8)', 0.5 + 0.3 * Math.sin(time * 4));
    drawChest(c.x, c.y - bob, 0, time, 0.33);
  }

  // ---------- the gold coin (from render.js), painted once into a sprite and stamped ----------
  function coinSprite() {
    if (coinSpr) return coinSpr;
    const R = 32, half = Math.ceil((R + 5) * s), c = document.createElement('canvas');
    c.width = c.height = half * 2;
    const g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, half, half);
    withCtx(g, () => {
      const k = R / 13;
      ctx.fillStyle = '#c98a00'; ctx.beginPath(); ctx.arc(0, 1.5 * k, R, 0, TAU); ctx.fill();
      const gr = ctx.createRadialGradient(-R * 0.35, -R * 0.4, 1, 0, 0, R);
      gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.45, '#ffd633'); gr.addColorStop(1, '#e8a200');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(180,110,0,0.75)'; ctx.lineWidth = 1.6 * k; ctx.beginPath(); ctx.arc(0, 0, R * 0.66, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(200,125,0,0.8)'; star(0, 0, R * 0.38, R * 0.17, 5, -Math.PI / 2); ctx.fill();
    });
    c.R = R; c.e = R + 5;
    return (coinSpr = c);
  }
  // ph spins it (the coin narrows as it turns edge-on); rot tilts it; alpha fades it
  function drawCoin(x, y, ph, r, rot, alpha) {
    const c = coinSprite(), sx = 0.3 + 0.7 * Math.abs(Math.cos(ph)), e = c.e * (r / c.R);
    if (rot || alpha != null) {
      ctx.save(); ctx.translate(x, y);
      if (rot) ctx.rotate(rot);
      if (alpha != null) ctx.globalAlpha = alpha;
      ctx.drawImage(c, -e * sx, -e, 2 * e * sx, 2 * e);
      ctx.restore();
      return;
    }
    ctx.drawImage(c, x - e * sx, y - e, 2 * e * sx, 2 * e);
  }

  // ---------- the treasure chest (from render.js): open 0..1 swings the lid and lets the light out ----------
  function drawChest(x, y, open, time, sc) {
    ctx.save(); ctx.translate(x, y);
    if (sc && sc !== 1) ctx.scale(sc, sc);
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

  // ---------- Isabella (copied from render.js; adds a waving arm, an arm that holds the shell up, a turn and a dizzy face) ----------
  // o: { scale, flip, turn (-1..1: facing left..right, squeezing through 0 as she turns round), tilt, swim, happy, wave, carry, dizzy, alpha }
  function drawIsabella(x, y, time, o) {
    o = o || {};
    ctx.save();
    ctx.translate(x, y); ctx.rotate(o.tilt || 0);
    const sc = o.scale || 0.92;
    let fx = o.turn != null ? o.turn : o.flip ? -1 : 1;
    if (Math.abs(fx) < 0.1) fx = fx < 0 ? -0.1 : 0.1;
    ctx.scale(sc * fx, sc);
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
    // arm: reaching forward, up and waving hello, or up holding the shell on her head
    const armA = Math.sin(sw * 0.5) * 0.25;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(21, -2);
    let hx = 45, hy = 6 + armA * 14;
    if (o.carry) { hx = 44; hy = -31; ctx.quadraticCurveTo(51, -12, hx, hy); }
    else if (o.wave != null) { const wv = Math.sin(o.wave); hx = 37 + wv * 8; hy = -37 + Math.abs(wv) * 3; ctx.quadraticCurveTo(29, -18, hx, hy); }
    else if (o.happy) { hx = 40 + armA * 6; hy = -34; ctx.quadraticCurveTo(30, -20, hx, hy); }
    else ctx.quadraticCurveTo(32, 8 + armA * 10, hx, hy);
    ctx.stroke();
    if (o.wave != null || o.carry) { ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(hx, hy - 1, 4.2, 0, TAU); ctx.fill(); }

    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(33, -13, 14.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(22, -12, 3, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,150,0.45)';
    ctx.beginPath(); ctx.arc(29, -7.5, 3.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(44, -7.5, 2.8, 0, TAU); ctx.fill();
    const blink = (time % 3.7) < 0.12 || !!o.dizzy;
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
    if (o.dizzy) {
      ctx.fillStyle = '#c0395a'; ctx.beginPath(); ctx.ellipse(37, -5.4, 2.2, 2.8, 0, 0, TAU); ctx.fill();
    } else if (o.happy) {
      ctx.fillStyle = '#c0395a'; ctx.beginPath(); ctx.arc(37, -6, 3.6, 0, Math.PI); ctx.fill();
    } else {
      ctx.strokeStyle = '#c0395a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(37, -7.6, 3.3, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke();
    }
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
    ctx.restore();
  }

  // ---------- numerals and the "tap here" hand ----------
  function drawNumeral(n, x, y, size, col, alpha) {
    if (alpha <= 0.01 || size < 2) return;
    glow(x, y, size * 0.95, 'rgba(255,255,255,0.7)', 0.5 * alpha);
    ctx.globalAlpha = alpha;
    outlined(String(n), x, y + size * 0.07, size, 'rgba(0,40,80,0.28)', 'rgba(0,40,80,0.28)');
    outlined(String(n), x, y, size, '#ffffff', col);
    ctx.globalAlpha = 1;
  }
  // a pointing hand; press 0..1 pushes it down a little
  function hand(x, y, press, alpha) {
    ctx.globalAlpha = 0.95 * alpha;
    ctx.save(); ctx.translate(x + 6, y + 10 + press * 10); ctx.rotate(-0.42);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(20,60,110,0.8)'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    rrect(-17, 26, 36, 34, 12); ctx.fill(); ctx.stroke();
    rrect(-7, -2, 15, 42, 7.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-5, 27, 11, 8);
    ctx.strokeStyle = 'rgba(20,60,110,0.45)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(9, 36); ctx.lineTo(9, 46); ctx.moveTo(14, 37); ctx.lineTo(14, 46); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // "Slide your finger", shown without words: a dotted track along the sand from under Isabella to under the
  // falling friend, a hand that presses and slides along it, a dotted line down from the friend and a ring on
  // the shell's line where it will land. u: 0..1 through one showing.
  function drawSlideHint(x0, x1, fx, fy, u, time) {
    const y = FLOOR + 6, fadeIn = clamp(u / 0.08, 0, 1), fadeOut = 1 - clamp((u - 0.86) / 0.14, 0, 1), a = fadeIn * fadeOut;
    if (a <= 0.01) return;
    ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.setLineDash([1, 15]);
    ctx.globalAlpha = 0.85 * a; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    if (fy + 62 < SHELL_Y - 30) { ctx.globalAlpha = 0.6 * a; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(fx, fy + 62); ctx.lineTo(x1, SHELL_Y - 24); ctx.stroke(); }
    ctx.setLineDash([]);
    const pul = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.globalAlpha = (0.6 + 0.35 * pul) * a; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.ellipse(x1, SHELL_Y, 62 + pul * 5, 15 + pul * 2, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    // 0-0.2 press, 0.2-0.7 slide, then lift and fade
    const m = smooth(clamp((u - 0.2) / 0.5, 0, 1)), press = u < 0.2 ? smooth(u / 0.2) : u < 0.74 ? 1 : 1 - smooth(clamp((u - 0.74) / 0.1, 0, 1));
    hand(x0 + (x1 - x0) * m, y - 4, press, a);
  }

  // ---------- the shell on Isabella's head: a pink scallop bowl that things fall into ----------
  // Drawn in two halves, so a friend that has just landed sits inside it: shellBack, the friend, shellFront.
  const SHELL_HW = 58, SHELL_D = 31, SHELL_RY = 12;
  function shellBack(x, y, tilt, lit) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt || 0);
    if (lit > 0.01) glow(0, -6, 104, 'rgba(255,250,190,0.8)', 0.6 * lit);
    ctx.fillStyle = '#a8326c'; ctx.beginPath(); ctx.ellipse(0, 0, SHELL_HW, SHELL_RY, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d95f9d'; ctx.beginPath(); ctx.ellipse(0, -1, SHELL_HW - 5, SHELL_RY - 3, 0, Math.PI, 0); ctx.fill();
    ctx.restore();
  }
  function shellFront(x, y, tilt, bump) {
    const hw = SHELL_HW, d = SHELL_D * (1 + (bump || 0) * 0.12), ry = SHELL_RY;
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt || 0);
    ctx.fillStyle = '#ff86bd';
    ctx.beginPath(); ctx.moveTo(-hw, 0);
    ctx.bezierCurveTo(-hw * 0.96, d * 0.92, -hw * 0.42, d, 0, d);
    ctx.bezierCurveTo(hw * 0.42, d, hw * 0.96, d * 0.92, hw, 0);
    ctx.ellipse(0, 0, hw, ry, 0, 0, Math.PI);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(170,40,110,0.2)';
    ctx.beginPath(); ctx.moveTo(-hw * 0.8, d * 0.62); ctx.bezierCurveTo(-hw * 0.4, d * 1.0, hw * 0.4, d * 1.0, hw * 0.8, d * 0.62);
    ctx.bezierCurveTo(hw * 0.4, d * 0.86, -hw * 0.4, d * 0.86, -hw * 0.8, d * 0.62); ctx.fill();
    // the scallop's ridges fan out from the hinge, and its edge is a row of little bumps
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = -3; k <= 3; k++) { const a = Math.PI / 2 - k * 0.37; ctx.moveTo(k * 2.5, d - 3); ctx.lineTo(Math.cos(a) * hw * 0.93, Math.sin(a) * ry + 3); }
    ctx.stroke();
    ctx.fillStyle = '#ffd3e9';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = ((i + 0.5) / 8) * Math.PI, bx = Math.cos(a) * hw * 0.97, by = Math.sin(a) * ry; ctx.moveTo(bx + 8.4, by); ctx.arc(bx, by, 8.4, 0, Math.PI); }
    ctx.fill();
    ctx.fillStyle = '#ff6fb0'; ctx.beginPath(); ctx.ellipse(0, d + 1.5, 9, 4.5, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // after a bonk: little stars go round her head for a moment
  function drawDizzy(x, y, time, a) {
    if (a <= 0.01) return;
    ctx.globalAlpha = Math.min(1, a * 2);
    for (let i = 0; i < 3; i++) {
      const ang = time * 6 + (i * TAU) / 3;
      ctx.fillStyle = i === 1 ? '#ffffff' : '#ffe066';
      star(x + Math.cos(ang) * 54, y + Math.sin(ang) * 13, 10, 4.4, 5, time * 3 + i); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- particles ----------
  const parts = [];
  function add(p) { if (parts.length < 600) parts.push(p); }
  function burst(type, x, y, r, col) {
    const rnd = (a, b) => a + Math.random() * (b - a);
    if (type === 'pop') {
      add({ t: 'ring', x, y, r0: r * 0.9, r1: r * 1.45, life: 0.32, max: 0.32, w: 6 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + rnd(-0.2, 0.2), sp = rnd(160, 300);
        add({ t: 'drop', x: x + Math.cos(a) * r * 0.85, y: y + Math.sin(a) * r * 0.85, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.42, max: 0.42, r: rnd(3, 6) });
      }
      const pastel = ['#fff6a0', '#ffd1ea', '#c9f3ff', '#ffffff'];
      for (let i = 0; i < 7; i++) add({ t: 'spark', x: x + rnd(-r, r) * 0.6, y: y + rnd(-r, r) * 0.6, vx: rnd(-120, 120), vy: rnd(-160, 40), life: 0.65, max: 0.65, c: pastel[i % 4], r: rnd(5, 9) });
    } else if (type === 'notes') {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU, sp = rnd(170, 280);
        add({ t: 'note', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 1.8, max: 1.8, c: RAINBOW[i % 7], r: rnd(17, 25), rot: rnd(-0.4, 0.4), ph: Math.random() * TAU, dbl: i % 3 === 0 });
      }
    } else if (type === 'hearts') {
      for (let i = 0; i < 7; i++) add({ t: 'heart', x: x + rnd(-30, 30), y: y + rnd(-20, 10), vx: rnd(-50, 50), vy: rnd(-170, -90), life: 1.2, max: 1.2, r: rnd(7, 11) });
    } else if (type === 'ripple') {
      add({ t: 'ring', x, y, r0: 6, r1: 46, life: 0.55, max: 0.55, w: 3 });
      add({ t: 'ring', x, y, r0: 2, r1: 26, life: 0.45, max: 0.45, w: 2 });
      for (let i = 0; i < 4; i++) add({ t: 'bub', x: x + rnd(-14, 14), y: y + rnd(-8, 8), vx: rnd(-14, 14), vy: rnd(-110, -60), life: 1, max: 1, r: rnd(2.5, 5) });
    } else if (type === 'land') {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; add({ t: 'spark', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.6, vx: Math.cos(a) * 90, vy: Math.sin(a) * 60 - 50, life: 0.6, max: 0.6, c: i % 2 ? '#fff' : col || '#ffe066', r: rnd(4, 7) }); }
    } else if (type === 'confetti') {
      for (let i = 0; i < 70; i++) add({ t: 'confetti', x: rnd(0, VW), y: rnd(-60, -10), vx: rnd(-40, 40), vy: rnd(40, 120), life: 4, max: 4, c: RAINBOW[i % 7], ph: Math.random() * TAU });
    } else if (type === 'trail') {
      add({ t: 'bub', x, y, vx: rnd(-10, 10), vy: rnd(-80, -50), life: 1, max: 1, r: rnd(2, 4.5) });
    } else if (type === 'twinkle') {
      add({ t: 'spark', x: x + rnd(-r, r), y: y + rnd(-r, r), vx: 0, vy: -20, life: 0.5, max: 0.5, c: col || '#fff8c0', r: rnd(3, 6) });
    } else if (type === 'coin') {
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; add({ t: 'spark', x, y, vx: Math.cos(a) * rnd(120, 220), vy: Math.sin(a) * rnd(120, 220), life: 0.6, max: 0.6, c: i % 2 ? '#fff6a0' : '#ffd23f', r: rnd(4, 7) }); }
    } else if (type === 'puff') {
      // a soft cloud of sand, e.g. where the chest pushes up out of the seabed
      for (let i = 0; i < 16; i++) add({ t: 'puff', x: x + rnd(-r, r), y: y + rnd(-8, 8), vx: rnd(-90, 90), vy: rnd(-70, -10), life: 0.9, max: 0.9, r: rnd(8, 16), c: col || 'rgba(255,240,200,0.8)' });
    } else if (type === 'bonk') {
      // a gentle bump: a few soft stars and a ring, nothing sharp
      add({ t: 'ring', x, y, r0: 18, r1: 70, life: 0.4, max: 0.4, w: 5 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + rnd(-0.3, 0.3); add({ t: 'spark', x, y, vx: Math.cos(a) * rnd(140, 220), vy: Math.sin(a) * rnd(140, 220) - 40, life: 0.55, max: 0.55, c: i % 2 ? '#ffe066' : '#ffffff', r: rnd(6, 9) }); }
    } else if (type === 'huff') {
      // a grumpy huff: little clouds puffed from a cross creature's head
      for (let i = 0; i < 3; i++) add({ t: 'puff', x: x + rnd(-10, 10), y: y + rnd(-6, 6), vx: rnd(-40, 40), vy: rnd(-90, -50), life: 0.7, max: 0.7, r: rnd(5, 9), c: 'rgba(235,225,255,0.9)' });
    }
  }
  // the treasure: gold coins shoot up out of the chest and bounce on the sand, with confetti
  function fountain(x, y, n, floorY) {
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) add({ t: 'gcoin', x: x + rnd(-30, 30), y, vx: rnd(-260, 260), vy: rnd(-1000, -480), life: 3.2, max: 3.2, r: rnd(9, 14), ph: rnd(0, 6), fy: (floorY || H - 30) + rnd(-14, 14) });
    for (let i = 0; i < n / 2; i++) add({ t: 'confetti', x: x + rnd(-40, 40), y: y - 20, vx: rnd(-300, 300), vy: rnd(-800, -300), life: 3, max: 3, c: RAINBOW[Math.floor(Math.random() * RAINBOW.length)], ph: rnd(0, 6), grav: true });
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.t === 'note') {
        const k = Math.exp(-dt * 2.2);
        p.vx *= k; p.vy = p.vy * k - 40 * dt; p.x += p.vx * dt + Math.sin(p.ph + p.life * 5) * 22 * dt; p.y += p.vy * dt;
      } else if (p.t === 'gcoin') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 8;
        if (p.y > p.fy) { p.y = p.fy; p.vy *= -0.45; p.vx *= 0.7; }
      } else if (p.t === 'confetti') {
        if (p.grav) { p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.5); p.vy = Math.min(p.vy, 120); }
        p.ph += dt * 5; p.x += p.vx * dt + Math.sin(p.ph) * 40 * dt; p.y += p.vy * dt;
      } else if (p.t !== 'ring') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-dt * 3);
        if (p.t !== 'bub') p.vy *= Math.exp(-dt * 3);
      }
    }
  }
  function noteShape(x, y, size, rot, col, dbl) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); const k = size / 20; ctx.scale(k, k);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? col : '#fff'; ctx.fillStyle = pass ? col : '#fff';
      const grow = pass ? 0 : 2.4;
      ctx.lineWidth = 3.2 + grow * 2;
      ctx.beginPath(); ctx.ellipse(-5, 9, 6.5 + grow, 4.8 + grow, -0.45, 0, TAU); ctx.fill();
      if (dbl) {
        ctx.beginPath(); ctx.ellipse(11, 5, 6.5 + grow, 4.8 + grow, -0.45, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(1, -14); ctx.lineTo(17, -18); ctx.lineTo(17, 4); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(1, -14); ctx.quadraticCurveTo(12, -10, 10, 0); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.t === 'spark') { ctx.globalAlpha = a; ctx.fillStyle = p.c; star(p.x, p.y, p.r, p.r * 0.38, 4, p.life * 5); ctx.fill(); }
      else if (p.t === 'drop') { ctx.globalAlpha = a; ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + a * 0.5), 0, TAU); ctx.fill(); }
      else if (p.t === 'ring') { const u = 1 - a; ctx.globalAlpha = a; ctx.strokeStyle = '#fff'; ctx.lineWidth = p.w * a + 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - (1 - u) * (1 - u)), 0, TAU); ctx.stroke(); }
      else if (p.t === 'heart') { ctx.globalAlpha = a; ctx.fillStyle = '#ff4d8d'; heartPath(p.x, p.y, p.r); ctx.fill(); }
      else if (p.t === 'bub') { ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); }
      else if (p.t === 'note') { ctx.globalAlpha = Math.min(1, p.life * 1.4); noteShape(p.x, p.y, p.r, p.rot + Math.sin(p.life * 6) * 0.2, p.c, p.dbl); }
      else if (p.t === 'confetti') { ctx.globalAlpha = Math.min(1, p.life); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph); ctx.fillStyle = p.c; ctx.fillRect(-6, -3.5, 12, 7); ctx.restore(); }
      else if (p.t === 'gcoin') { ctx.globalAlpha = Math.min(1, p.life * 2); drawCoin(p.x, p.y, p.ph, p.r); }
      else if (p.t === 'puff') { ctx.globalAlpha = a * 0.8; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - a * 0.6), 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  window.CatchArt = {
    H, FLOOR, TRAY_Y, TRAY_NUM, SCENES, RAINBOW, NUMCOL, KINDS, INSIDE, ISA_Y, ISA_SC, SHELL_DX, SHELL_Y, SHELL_HW, BADGE_R,
    init, resize, toWorld, toClient, begin, keepScenes,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get canvas() { return canvas; },
    get partCount() { return parts.length; },
    // how many pictures each cache holds (the soak checks they stay bounded: one glow per colour, two seas at most)
    cacheSizes: () => ({ glow: Object.keys(glowCache).length, back: Object.keys(backCache).length, floor: Object.keys(floorCache).length,
      glass: Object.keys(glassCache).length, coin: coinSpr ? 1 : 0, shade: shadeCache.size, pal: palCache.size }),
    traySpacing, trayX, miniScale, hudLayout,
    drawBackdrop, drawFloor, drawTray, drawHud, drawCoin, drawChest, drawItem, drawCreature, drawIsabella, drawNumeral, drawSlideHint,
    shellBack, shellFront, drawDizzy, glow,
    burst, fountain, stepParts, drawParts, partsOfType: (t) => parts.filter((p) => p.t === t).length,
  };
})();
