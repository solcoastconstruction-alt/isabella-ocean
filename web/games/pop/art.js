/* Isabella's Bubble Party — everything you see. All art is drawn in code.
 * House style copied from web/render.js (never shared, never edited there): a 540-unit-tall world
 * scaled to the screen, DPR capped at 2.5, outlined text, the glow sprite, and Isabella herself. */
(function () {
  'use strict';
  const H = 540, TAU = Math.PI * 2;
  const FLOOR = 438;   // top of the seabed ridge: bubbles rise out from behind it
  const SEAT = 474;    // a friend in the aquarium sits with its centre here
  const PEBBLE = 521;  // the counting numerals under the friends
  const FTOP = FLOOR - 18;
  const INSIDE = 0.0162; // a friend inside a bubble of radius r is drawn at scale r * INSIDE
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  // one colour per counting number, 1..10
  const NUMCOL = ['#ff4d6d', '#ff8a1f', '#e8a800', '#2fb35a', '#1c9ad6', '#6c63ff', '#b552f0', '#ff4f9a', '#00a99d', '#ff6a2b'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38';
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

  // Five seas. Every ten friends the sea changes: new colours, new creatures, a new key for the music.
  const SCENES = [
    { id: 'shallows', top: '#86e6f2', bot: '#1f8fc0', far: 'rgba(28,118,170,0.5)', sand: ['#fbe8b4', '#e2c07c'],
      tip: ['#ff8fab', '#ffd166', '#ff6b6b', '#ffa94d'], decor: 'coral', ray: 0.2, key: 0,
      kinds: [['fish', '#ff8c2e'], ['starfish', '#ff6f91'], ['crab', '#ff5a4f'], ['turtle', '#3fbf7f'], ['seahorse', '#ffc23a']] },
    { id: 'garden', top: '#a8e6ff', bot: '#3a6fd0', far: 'rgba(60,80,170,0.45)', sand: ['#ffe6f1', '#efbcd4'],
      tip: ['#ff5d8f', '#c77dff', '#ff9e6d', '#ffd166'], decor: 'fans', ray: 0.18, key: 2,
      kinds: [['octopus', '#b86bff'], ['puffer', '#ffc93a'], ['jelly', '#ff7ac8'], ['fish', '#3d8bff'], ['starfish', '#ffa53d']] },
    { id: 'kelp', top: '#86e3c4', bot: '#0f6b5e', far: 'rgba(10,80,70,0.5)', sand: ['#eee2a8', '#c8b26e'],
      tip: ['#b8f27c', '#ffd166', '#7cf2c8'], decor: 'kelp', ray: 0.18, key: 5,
      kinds: [['turtle', '#5fb84a'], ['whale', '#4f8ff0'], ['seahorse', '#ff9e3d'], ['crab', '#ff7043'], ['fish', '#ffd23f']] },
    { id: 'glow', top: '#2a4c86', bot: '#070f2c', far: 'rgba(14,28,70,0.7)', sand: ['#34416a', '#1c2444'],
      tip: ['#5cf2ff', '#ff5cf0', '#9dff5c'], decor: 'glow', ray: 0.05, glow: true, key: -3,
      kinds: [['jelly', '#6ff5ff'], ['angler', '#8f86ff'], ['octopus', '#ff7ad9'], ['starfish', '#ffe066'], ['fish', '#6dff9c']] },
    { id: 'palace', top: '#b9f0ff', bot: '#6a7fe6', far: 'rgba(130,140,230,0.45)', sand: ['#fdeaf6', '#e9c6df'],
      tip: RAINBOW, decor: 'palace', ray: 0.22, key: 7,
      kinds: [['whale', '#ff8fc0'], ['puffer', '#6fd3ff'], ['octopus', '#ff8f6b'], ['seahorse', '#b77dff'], ['fish', 'rainbow']] },
  ];

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  let fade = 1; // multiplies glows while a sea is fading in or out
  const amb = [];
  const backCache = {}, floorCache = {}, glassCache = {};

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
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toClient = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });
  function begin() { ctx.setTransform(s, 0, 0, s, 0, 0); ctx.globalAlpha = 1; }
  // keep big cached pictures only for the seas on screen (phones have little memory)
  function keepScenes(a, b) {
    for (const c of [backCache, floorCache]) for (const k of Object.keys(c)) if (+k !== a && +k !== b) delete c[k];
  }

  // ---------- the aquarium's ten places ----------
  const slotSpacing = () => Math.min(112, (VW - 70) / 10);
  const slotX = (i) => VW / 2 + (i - 4.5) * slotSpacing();
  const friendScale = () => clamp(slotSpacing() * 0.0112, 0.45, 0.78);

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
    puffer(c, t, blink, happy, wig) {
      const p = pal(c), r = 25 + wig * 5 + Math.sin(t * 2.2);
      ctx.strokeStyle = p.dark; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU + 0.1, l = r + 4 + wig * 4; ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l); }
      ctx.stroke();
      const wag = Math.sin(t * 8) * 4;
      ctx.fillStyle = p.dark; ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r - 13, -10 + wag); ctx.lineTo(-r - 13, 10 + wag); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(2, r * 0.38, r * 0.62, r * 0.38, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.dark; ctx.save(); ctx.translate(-5, 5); ctx.rotate(0.5 + Math.sin(t * 9) * 0.35); ctx.beginPath(); ctx.ellipse(-5, 0, 7, 4.2, 0, 0, TAU); ctx.fill(); ctx.restore();
      eye(r * 0.12, -r * 0.24, 5.6, blink); eye(r * 0.56, -r * 0.26, 5, blink);
      cheek(r * 0.16, r * 0.16, 3.6);
      ctx.fillStyle = '#c0395a'; ctx.beginPath(); ctx.ellipse(r * 0.8, r * 0.14, 2.6 + wig * 1.6, 3 + wig * 2.2, 0, 0, TAU); ctx.fill();
    },
    jelly(c, t, blink, happy, wig) {
      const p = pal(c), pulse = 1 + Math.sin(t * 3.2) * 0.05 + wig * 0.06;
      ctx.strokeStyle = p.light; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) { ctx.moveTo(k * 7, 8); for (let j = 1; j <= 5; j++) ctx.lineTo(k * 7 + Math.sin(t * 4 + j * 0.9 + k) * 3.4, 8 + j * 6.4); }
      ctx.stroke();
      ctx.fillStyle = p.base;
      ctx.beginPath(); ctx.moveTo(-27 * pulse, 8); ctx.bezierCurveTo(-29 * pulse, -38, 29 * pulse, -38, 27 * pulse, 8);
      for (let k = 4; k >= -4; k--) ctx.quadraticCurveTo((k + 0.5) * 6.2 * pulse, 13, k * 6.2 * pulse, 8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(-11, -16, 8, 5, -0.5, 0, TAU); ctx.fill();
      eye(-8, -7, 5.2, blink); eye(8, -7, 5.2, blink); cheek(-14, 1, 3.4); cheek(14, 1, 3.4); smile(0, 0, 4, happy);
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
    angler(c, t, blink, happy) {
      const p = pal(c), bob = Math.sin(t * 2) * 2;
      ctx.strokeStyle = p.dark; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(4, -22); ctx.quadraticCurveTo(8, -46, 26 + bob, -40); ctx.stroke();
      glow(26 + bob, -40, 22, 'rgba(255,240,140,0.9)', 0.75 + 0.25 * Math.sin(t * 4));
      ctx.fillStyle = '#fff7a8'; ctx.beginPath(); ctx.arc(26 + bob, -40, 5, 0, TAU); ctx.fill();
      const wag = Math.sin(t * 7) * 4;
      ctx.fillStyle = p.dark; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-38, -13 + wag); ctx.lineTo(-38, 13 + wag); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(-2, 11, 16, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.dark; ctx.save(); ctx.translate(-4, 6); ctx.rotate(0.5 + Math.sin(t * 6) * 0.3); ctx.beginPath(); ctx.ellipse(-6, 0, 8, 4, 0, 0, TAU); ctx.fill(); ctx.restore();
      eye(9, -7, 7.4, blink); cheek(4, 8, 4);
      if (happy) smile(16, 6, 7, true);
      else { ctx.strokeStyle = '#3a1030'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(14, 0, 9, 0.2 * Math.PI, 0.62 * Math.PI); ctx.stroke(); }
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

  // ---------- bubbles ----------
  // The glass is painted once per size into a sprite (crisp at this screen's scale), then stamped.
  function glassSprite(R) {
    let c = glassCache[R];
    if (!c) {
      const half = Math.ceil((R + 6) * s);
      c = document.createElement('canvas'); c.width = c.height = half * 2;
      const g = c.getContext('2d');
      g.setTransform(s, 0, 0, s, half, half);
      let lg = g.createLinearGradient(-R, -R, R, R);
      lg.addColorStop(0, 'rgba(255,185,240,0.2)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.03)'); lg.addColorStop(1, 'rgba(140,230,255,0.24)');
      g.fillStyle = lg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      const rg = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
      rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.8, 'rgba(255,255,255,0.08)'); rg.addColorStop(1, 'rgba(255,255,255,0.5)');
      g.fillStyle = rg; g.fill();
      const lw = Math.max(2.4, R * 0.042);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = lw; g.beginPath(); g.arc(0, 0, R - lw / 2, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.save(); g.translate(-R * 0.42, -R * 0.45); g.rotate(-0.8); g.beginPath(); g.ellipse(0, 0, R * 0.25, R * 0.12, 0, 0, TAU); g.fill(); g.restore();
      g.beginPath(); g.arc(-R * 0.1, -R * 0.68, R * 0.05, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = R * 0.055; g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, R * 0.77, 0.14 * Math.PI, 0.42 * Math.PI); g.stroke();
      c.R = R; c.half = half;
      glassCache[R] = c;
    }
    return c;
  }
  // b: { x, y, r, kind, col, special: null|'rainbow'|'giant'|'small', grow 0..1, ph, seed, flip, inner }
  function drawBubble(b, time, glowy) {
    const g = b.grow < 1 ? easeOutBack(b.grow) : 1, r = b.r * g;
    if (r < 1) return;
    const wob = Math.sin(time * 3.2 + b.ph) * 0.03;
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.special === 'rainbow') glow(0, 0, r * 1.55, 'rgba(255,236,170,0.75)', 0.5 + 0.2 * Math.sin(time * 3));
    if (b.special === 'giant') glow(0, 0, r * 1.3, 'rgba(200,245,255,0.6)', 0.35);
    if (b.inner) {
      const n = b.inner.length;
      b.inner.forEach((q, i) => {
        const a = time * 0.55 + (i * TAU) / n;
        drawCreature(q.kind, q.col, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.32, (r / 104) * 0.6, time, { seed: q.seed, glow: glowy, flip: Math.cos(a + Math.PI / 2) < 0 });
      });
    } else {
      const cr = b.keep ? b.r : r; // keep: the glass grows around a friend who stays the same size
      drawCreature(b.kind, b.col, 0, Math.sin(time * 1.7 + b.ph) * cr * 0.05, cr * INSIDE, time, { seed: b.seed, rot: Math.sin(time * 1.1 + b.ph) * 0.12, glow: glowy, flip: b.flip });
    }
    ctx.scale(1 + wob, 1 - wob);
    const spr = glassSprite(b.special === 'giant' ? 108 : 70), k = r / spr.R, e = (spr.R + 6) * k;
    ctx.drawImage(spr, -e, -e, e * 2, e * 2);
    if (b.special === 'rainbow') {
      let grad;
      if (ctx.createConicGradient) { grad = ctx.createConicGradient(time * 1.3, 0, 0); RAINBOW.forEach((c, i) => grad.addColorStop(i / RAINBOW.length, c)); grad.addColorStop(1, RAINBOW[0]); }
      else { grad = ctx.createLinearGradient(-r, -r, r, r); RAINBOW.forEach((c, i) => grad.addColorStop(i / (RAINBOW.length - 1), c)); }
      ctx.strokeStyle = grad; ctx.lineWidth = r * 0.1; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.93, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        const a = time * 0.9 + (i * TAU) / 4, tw = 0.5 + 0.5 * Math.sin(time * 5 + i * 1.7);
        ctx.fillStyle = `rgba(255,255,255,${0.5 + tw * 0.5})`; star(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12, 5 + tw * 4, 2, 4, 0); ctx.fill();
      }
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
    for (let x = 0; x <= VW + 20; x += 20) ctx.lineTo(x, 360 + 32 * Math.sin(x / 170 + idx * 1.7) + 16 * Math.sin(x / 61 + 1 + idx));
    ctx.lineTo(VW + 20, H); ctx.closePath(); ctx.fill();
    const tile = 200;
    for (let i = 0; i * tile < VW + tile; i++) {
      const R = rngAt(i, 5 + idx * 13), x = i * tile + 30 + R() * 140, k = R(), tip = () => sc.tip[Math.floor(R() * sc.tip.length)];
      ctx.globalAlpha = 0.72;
      if (sc.decor === 'coral') { if (k < 0.5) branchCoral(x, 458, tip(), R); else fanCoral(x, 458, tip(), R); }
      else if (sc.decor === 'fans') { fanCoral(x, 458, tip(), R); if (k < 0.45) branchCoral(x + 70, 458, tip(), R); }
      else if (sc.decor === 'kelp') grass(x, 458, 0, '#2f8f5a', R);
      else if (sc.decor === 'palace') { if (k < 0.5) branchCoral(x, 458, RAINBOW[i % 7], R); else fanCoral(x, 458, RAINBOW[(i + 3) % 7], R); }
      else if (sc.decor === 'glow') { ctx.fillStyle = '#16244a'; ctx.beginPath(); ctx.ellipse(x, 456, 50 + R() * 40, 34 + R() * 26, 0, Math.PI, 0); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
  }
  function drawPalace(cols, roofs) {
    const tile = 1400;
    for (let i = -1; i <= Math.floor(VW / tile) + 1; i++) {
      const R = rngAt(i + 2, 9), bx = i * tile + 300 + R() * 500;
      for (let k = 0; k < 5; k++) {
        const tx = bx + k * 46, th2 = 120 + (k === 2 ? 90 : R() * 60);
        ctx.fillStyle = cols[k % 4]; ctx.globalAlpha = 0.55;
        ctx.fillRect(tx, 420 - th2, 36, th2 + 40);
        ctx.fillStyle = roofs[(((k * 2 + i) % roofs.length) + roofs.length) % roofs.length];
        ctx.beginPath(); ctx.moveTo(tx - 6, 420 - th2); ctx.lineTo(tx + 18, 420 - th2 - 50); ctx.lineTo(tx + 42, 420 - th2); ctx.fill();
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
    if (sc.decor === 'kelp') for (let i = 0; i < 9; i++) { const R = rngAt(i, 31); kelp((i + 0.3 + R() * 0.5) * (VW / 8.6), 462, 200 + R() * 170, time, i, i % 2 ? '#2f8f5a' : '#3fae6a'); }
    if (sc.decor === 'glow') for (let i = 0; i < 7; i++) { const R = rngAt(i, 37); glowPlant((i + 0.2 + R() * 0.6) * (VW / 6.6), 458, time, i, sc.tip[i % sc.tip.length], R); }
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
    for (let i = 0; i < VW / 34; i++) {
      const x = R() * VW, y = FLOOR + 18 + R() * 96, k = R();
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
  // the ten places: a dashed ring waits where a friend will sit, a numeral sits under each
  // next: the place the next friend will take; its ring breathes gently
  function drawSlots(filled, time, alpha, next) {
    const sp = slotSpacing(), rr = Math.min(32, sp * 0.36);
    ctx.globalAlpha = alpha;
    ctx.setLineDash([7, 7]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    const a0 = time * 0.25;
    for (let i = 0; i < 10; i++) if (!filled[i] && i !== next) { const x = slotX(i); ctx.moveTo(x + rr * Math.cos(a0), SEAT + rr * Math.sin(a0)); ctx.arc(x, SEAT, rr, a0, a0 + TAU); }
    ctx.stroke();
    if (next >= 0 && next < 10 && !filled[next]) {
      const pul = 0.5 + 0.5 * Math.sin(time * 3.2), r2 = rr * (1 + 0.07 * pul);
      ctx.lineWidth = 3.5 + pul * 1.5; ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pul})`;
      ctx.beginPath(); ctx.arc(slotX(next), SEAT, r2, a0, a0 + TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,30,60,0.12)'; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const x = slotX(i); ctx.moveTo(x + sp * 0.3, SEAT + 30); ctx.ellipse(x, SEAT + 30, sp * 0.3, 5, 0, 0, TAU); }
    ctx.fill();
    for (let i = 0; i < 10; i++) {
      const x = slotX(i);
      if (filled[i]) outlined(String(i + 1), x, PEBBLE, 25, '#fff', NUMCOL[i]);
      else outlined(String(i + 1), x, PEBBLE, 22, 'rgba(255,255,255,0.6)', 'rgba(0,40,80,0.22)');
    }
    ctx.globalAlpha = 1;
  }
  // a glass front over the aquarium row
  function drawTank(alpha) {
    const sp = slotSpacing(), x0 = slotX(0) - sp / 2 - 6, x1 = slotX(9) + sp / 2 + 6, y0 = FLOOR - 8, y1 = H - 3;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; rrect(x0, y0, x1 - x0, y1 - y0, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0 + 24, y0 + 12); ctx.lineTo(x0 + 80, y0 + 12); ctx.moveTo(x1 - 14, y0 + 22); ctx.lineTo(x1 - 14, y0 + 52); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------- Isabella (copied from render.js; adds a waving arm) ----------
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
    // arm: reaching forward, or up and waving hello
    const armA = Math.sin(sw * 0.5) * 0.25;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(21, -2);
    let hx = 45, hy = 6 + armA * 14;
    if (o.wave != null) { const wv = Math.sin(o.wave); hx = 37 + wv * 8; hy = -37 + Math.abs(wv) * 3; ctx.quadraticCurveTo(29, -18, hx, hy); }
    else if (o.happy) { hx = 40 + armA * 6; hy = -34; ctx.quadraticCurveTo(30, -20, hx, hy); }
    else ctx.quadraticCurveTo(32, 8 + armA * 10, hx, hy);
    ctx.stroke();
    if (o.wave != null) { ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(hx, hy - 1, 4.2, 0, TAU); ctx.fill(); }

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
    if (o.happy) {
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
  function drawHand(x, y, time) {
    const press = (Math.sin(time * 4.5) + 1) / 2;
    for (let k = 0; k < 2; k++) {
      const u = (time * 0.9 + k * 0.5) % 1;
      ctx.globalAlpha = 0.8 * (1 - u); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 18 + u * 46, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
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

  // held upright, the sea would be too narrow: dim it and show a phone turning sideways (no words)
  function drawRotate(time) {
    ctx.fillStyle = 'rgba(0,30,60,0.6)'; ctx.fillRect(0, 0, VW, H);
    const cx = VW / 2, cy = H / 2 - 6, R = Math.min(118, VW * 0.4), u = (time % 2.6) / 2.6;
    const turn = u < 0.85 ? smooth(clamp((u - 0.25) / 0.4, 0, 1)) * (Math.PI / 2) : 0;
    ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#ffd23f'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    const a0 = -Math.PI * 0.82, a1 = -Math.PI * 0.4;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
    const ex = cx + Math.cos(a1) * R, ey = cy + Math.sin(a1) * R, tx = -Math.sin(a1), ty = Math.cos(a1);
    ctx.beginPath(); ctx.moveTo(ex + tx * 20, ey + ty * 20); ctx.lineTo(ex - ty * 15 - tx * 4, ey + tx * 15 - ty * 4); ctx.lineTo(ex + ty * 15 - tx * 4, ey - tx * 15 - ty * 4); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(turn); const k = R / 118; ctx.scale(k, k); // turns the way the arrow points
    ctx.fillStyle = '#ffffff'; rrect(-40, -74, 80, 148, 16); ctx.fill();
    ctx.fillStyle = '#4cc9f0'; rrect(-32, -60, 64, 112, 8); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -6, 17, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-6, -12, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 63, 5, 0, TAU); ctx.fill();
    ctx.restore();
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
    }
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.t === 'note') {
        const k = Math.exp(-dt * 2.2);
        p.vx *= k; p.vy = p.vy * k - 40 * dt; p.x += p.vx * dt + Math.sin(p.ph + p.life * 5) * 22 * dt; p.y += p.vy * dt;
      } else if (p.t === 'confetti') {
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
    }
    ctx.globalAlpha = 1;
  }

  window.PopArt = {
    H, FLOOR, SEAT, PEBBLE, SCENES, RAINBOW, NUMCOL, KINDS, INSIDE,
    init, resize, toWorld, toClient, begin, keepScenes,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get canvas() { return canvas; },
    get partCount() { return parts.length; },
    slotX, slotSpacing, friendScale,
    drawBackdrop, drawFloor, drawSlots, drawTank, drawBubble, drawCreature, drawIsabella, drawNumeral, drawHand, drawRotate,
    burst, stepParts, drawParts, partsOfType: (t) => parts.filter((p) => p.t === t).length,
  };
})();
