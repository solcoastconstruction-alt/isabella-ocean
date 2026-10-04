/* Sea Jigsaw: the thirty pictures, and the friends, corals and treasure they are made of. All art is drawn in code.
 * Everything here paints onto whatever 2D context it is given and touches nothing else (no DOM, no canvas of its
 * own), so test/games/jigsaw/verify.js can run every painter in Node against a recording context and freeze it.
 * Isabella, the sea friends, the coin, the key and the chest are copied from web/render.js, Bubble Party and
 * Sea Words (never shared, never edited there), so Isabella looks like Isabella.
 *
 * A picture is PW x PH (832 x 520, the same units as the board). A jigsaw piece of flat blue water would be
 * impossible for a child, so every picture has something to see across the whole frame: currents and light in
 * the water, bubbles, little fish, a reef, a seabed with shells. test/games/jigsaw/browser.js measures that. */
(function (root) {
  'use strict';
  const PW = 832, PH = 520, TAU = Math.PI * 2;
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SKIN = '#f7cdb0', HAIR = '#6b3a1f', HAIR_HI = '#9a5f38', GOLD = '#ffcc33';
  let ctx = null;
  function withCtx(g, fn) { const keep = ctx; ctx = g; try { return fn(); } finally { ctx = keep; } }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- small shapes ----------
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
  // a soft light: the colour at the middle fading to nothing (added to what is already there)
  function glow(x, y, r, color, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a == null ? 1 : a;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
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
  function rainbowFill(x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    RAINBOW.forEach((c, i) => g.addColorStop(i / (RAINBOW.length - 1), c));
    return g;
  }

  // ---------- faces (from Bubble Party) ----------
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

  // ---------- sea friends (from Bubble Party; the dolphin from Sea Words): each faces right in a box about 80 across ----------
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
      ctx.fillStyle = 'rgba(200,240,255,0.95)';
      for (const [dx, dy, r] of [[8, -30, 3.4], [2, -37, 2.6], [14, -37, 2.6], [8, -43, 2.2]]) { ctx.beginPath(); ctx.arc(dx, dy, r, 0, TAU); ctx.fill(); }
    },
    angler(c, t, blink, happy) {
      const p = pal(c), bob = Math.sin(t * 2) * 2;
      ctx.strokeStyle = p.dark; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(4, -22); ctx.quadraticCurveTo(8, -46, 26 + bob, -40); ctx.stroke();
      glow(26 + bob, -40, 22, 'rgba(255,240,140,0.9)', 0.9);
      ctx.fillStyle = '#fff7a8'; ctx.beginPath(); ctx.arc(26 + bob, -40, 5, 0, TAU); ctx.fill();
      const wag = Math.sin(t * 7) * 4;
      ctx.fillStyle = p.dark; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-38, -13 + wag); ctx.lineTo(-38, 13 + wag); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.base; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(-2, 11, 16, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.dark; ctx.save(); ctx.translate(-4, 6); ctx.rotate(0.5 + Math.sin(t * 6) * 0.3); ctx.beginPath(); ctx.ellipse(-6, 0, 8, 4, 0, 0, TAU); ctx.fill(); ctx.restore();
      eye(9, -7, 7.4, blink); cheek(4, 8, 4);
      smile(16, 6, 7, true);
    },
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
  // Drawn big, a friend's body is one flat colour: these add the freckles, scales and shell plates that give a
  // jigsaw piece of it something to go by. Each is in the friend's own coordinates, clear of its face.
  const MARKS = {
    fish(c) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.4;
      for (const [x, y] of [[-16, -8], [-16, 6], [-24, -1], [2, -12], [3, 3]]) { ctx.beginPath(); ctx.arc(x, y, 5, -1.1, 1.1); ctx.stroke(); }
    },
    turtle(c) {
      ctx.strokeStyle = pal(c).dark; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-10, -18.5); ctx.lineTo(-11, -3); ctx.moveTo(7, -18.5); ctx.lineTo(7, -4); ctx.moveTo(-25, -9); ctx.lineTo(-11, -12); ctx.moveTo(7, -12); ctx.lineTo(22, -8); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; oval(-12, -15, 6, 2.6, -0.5);
    },
    octopus(c) {
      const p = pal(c);
      ctx.fillStyle = p.light;
      for (const [x, y, r] of [[-19, -14, 2.2], [20, -8, 2.2], [-3, -31, 1.8], [11, -30, 1.6], [-21, -3, 1.6]]) circle(x, y, r);
      ctx.fillStyle = p.dark;
      for (const [x, y] of [[-19, 18], [-11, 26], [-4, 32], [5, 32], [12, 26], [20, 18]]) circle(x, y, 1.6);
    },
    crab(c) {
      const p = pal(c);
      ctx.fillStyle = p.dark;
      for (const [x, y, r] of [[-17, 14, 1.7], [-9, 18, 1.5], [0, 20, 1.5], [9, 18, 1.5], [17, 14, 1.7]]) circle(x, y, r);
      ctx.fillStyle = p.light; circle(15, 0, 2); circle(19, 5, 1.4);
    },
    whale(c) {
      const p = pal(c);
      ctx.fillStyle = p.light;
      for (const [x, y, r] of [[-12, -9, 2.4], [-3, -14, 1.8], [-19, -2, 1.7], [6, -15, 1.5]]) circle(x, y, r);
      ctx.strokeStyle = p.dark; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-4, 6, 22, 3.5, 4.4); ctx.stroke();
    },
    puffer(c) {
      const p = pal(c);
      ctx.fillStyle = p.dark;
      for (const [x, y, r] of [[-12, -12, 2.2], [-4, -18, 1.8], [-17, -3, 1.8], [6, -19, 1.6], [-9, -4, 1.5]]) circle(x, y, r);
    },
    seahorse(c) {
      const p = pal(c);
      ctx.fillStyle = p.dark;
      for (const [x, y] of [[-6, -4], [-7, 4], [-5, 12]]) circle(x, y, 1.6);
    },
    dolphin() {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-2, 8, 20, 4.2, 5.2); ctx.stroke();
    },
    jelly(c) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (const [x, y, r] of [[8, -22, 2.4], [16, -12, 1.8], [-2, -26, 1.6], [-18, -4, 1.6]]) circle(x, y, r);
    },
    starfish() {},
    angler() {},
  };
  // o: { flip, rot, t (the pose), happy (default yes), blink (eyes shut), plain (no extra marks) }
  function creature(kind, col, x, y, sc, o) {
    const f = CRE[kind];
    if (!f) return;
    o = o || {};
    ctx.save(); ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.flip ? -sc : sc, sc);
    f(col, o.t == null ? 0.4 : o.t, !!o.blink, o.happy !== false, 0);
    if (sc >= 1.7 && !o.plain && MARKS[kind]) MARKS[kind](col);
    ctx.restore();
  }

  // ---------- coin, pearl, key, chest, gems ----------
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
  function drawPearl(x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#fbeaf6'); g.addColorStop(1, '#d6b2d6');
    ctx.fillStyle = g; circle(x, y, r);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; circle(x - r * 0.38, y - r * 0.4, r * 0.24);
  }
  // the golden key with a heart gem in its bow (Coral Maze's and Sea Words' key)
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
  // open 0..1 swings the lid back and lets the light out (from render.js)
  function drawChest(x, y, open, time, sc, beam) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc || 1, sc || 1);
    if (open > 0 && beam !== false) {
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
  function gem(x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.25); ctx.lineTo(x - r * 0.55, y - r * 0.8); ctx.lineTo(x + r * 0.55, y - r * 0.8); ctx.lineTo(x + r, y - r * 0.25); ctx.lineTo(x, y + r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(x - r * 0.55, y - r * 0.8); ctx.lineTo(x - r * 0.2, y - r * 0.25); ctx.lineTo(x - r, y - r * 0.25); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.25); ctx.lineTo(x + r, y - r * 0.25); ctx.moveTo(x - r * 0.2, y - r * 0.25); ctx.lineTo(x, y + r); ctx.lineTo(x + r * 0.2, y - r * 0.25); ctx.stroke();
  }
  function sparkle(x, y, r, col) { ctx.fillStyle = col || '#fffbe0'; star(x, y, r, r * 0.3, 4, 0); ctx.fill(); }
  function heart(x, y, r, col) { ctx.fillStyle = col || '#ff4d8d'; heartPath(x, y, r); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.6)'; oval(x - r * 0.4, y - r * 0.35, r * 0.22, r * 0.14, -0.6); }
  // an open clam with a pearl (from render.js)
  function clam(x, y, sc, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.fillStyle = col || '#ffb8d6';
    ctx.beginPath(); ctx.moveTo(-34, -2); ctx.quadraticCurveTo(-40, -44, 0, -48); ctx.quadraticCurveTo(40, -44, 34, -2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(190,60,130,0.45)'; ctx.lineWidth = 2;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(k * 9.5, -43 + Math.abs(k) * 4); ctx.stroke(); }
    ctx.fillStyle = '#ffe6f2'; oval(0, -2, 32, 8);
    drawPearl(0, -13, 13);
    ctx.fillStyle = shade(col || '#ffb8d6', -0.12);
    ctx.beginPath(); ctx.ellipse(0, -1, 36, 20, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let k = -3; k <= 3; k++) circle(k * 9, 1, 2.4);
    ctx.restore();
  }
  // a scallop shell lying on the sand (Sea Words' shell, simpler)
  function scallop(x, y, sc, col, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(sc, sc);
    const n = 7, R = 26, A0 = -2.6, A1 = -0.54;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(0, 6);
    for (let i = 0; i <= n; i++) {
      const a = A0 + ((A1 - A0) * i) / n, px = Math.cos(a) * R, py = Math.sin(a) * R;
      if (i === 0) ctx.lineTo(px, py);
      else { const am = A0 + ((A1 - A0) * (i - 0.5)) / n; ctx.quadraticCurveTo(Math.cos(am) * R * 1.14, Math.sin(am) * R * 1.14, px, py); }
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) { const a = A0 + ((A1 - A0) * (i + 0.5)) / n; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 7, 4 + Math.sin(a) * 7); ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); ctx.stroke(); }
    ctx.restore();
  }

  // ---------- Isabella (from render.js, with Bubble Party's waving arm) ----------
  // o: { scale, flip, tilt, t (the pose), happy, wave (a number: the arm is up, waving), crown, sleep (eyes shut),
  //      item (a function that draws what she is holding, at her hand) }
  function drawIsabella(x, y, o) {
    o = o || {};
    const time = o.t == null ? 0.3 : o.t;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(o.tilt || 0);
    const sc = o.scale || 1; ctx.scale(o.flip ? -sc : sc, sc);
    const sw = time * 7;
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
      ctx.fillStyle = `rgba(255,255,255,${(0.35 + tw * 0.6).toFixed(3)})`;
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
    // arm: reaching forward, up and happy, or up and waving hello
    const armA = Math.sin(sw * 0.5) * 0.25;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(21, -2);
    let hx = 45, hy = 6 + armA * 14;
    if (o.wave != null) { const wv = Math.sin(o.wave); hx = 37 + wv * 8; hy = -37 + Math.abs(wv) * 3; ctx.quadraticCurveTo(29, -18, hx, hy); }
    else if (o.happy && !o.item) { hx = 40 + armA * 6; hy = -34; ctx.quadraticCurveTo(30, -20, hx, hy); }
    else ctx.quadraticCurveTo(32, 8 + armA * 10, hx, hy);
    ctx.stroke();
    if (o.wave != null) { ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(hx, hy - 1, 4.2, 0, TAU); ctx.fill(); }
    if (o.item) { ctx.save(); ctx.translate(hx, hy); o.item(); ctx.restore(); ctx.fillStyle = SKIN; circle(hx, hy, 3.6); }

    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(33, -13, 14.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(22, -12, 3, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,150,0.45)';
    ctx.beginPath(); ctx.arc(29, -7.5, 3.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(44, -7.5, 2.8, 0, TAU); ctx.fill();
    for (const ex of [32, 41]) {
      if (o.sleep) { ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(ex, -14, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); continue; }
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

  // ---------- the sea ----------
  // th: { top, bot (the water, surface to deep), far (hills), sand: [top, bottom], tips: [reef colours], ray (how
  //       strong the shafts of light are), lit / dim (the two colours of the currents) }
  const T = (top, bot, far, sand, tips, ray, more) => Object.assign({ top, bot, far, sand, tips, ray, lit: 'rgba(255,255,255,0.15)', dim: 'rgba(0,30,90,0.13)' }, more || {});
  function water(th) {
    const g = ctx.createLinearGradient(0, 0, 0, PH);
    g.addColorStop(0, th.top); if (th.mid) g.addColorStop(0.5, th.mid); g.addColorStop(1, th.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, PW, PH);
  }
  // ribbons of lighter and darker water with wavy edges, from top to bottom: the sea is never one flat blue
  function currents(th, seed, n) {
    const R = mulberry32(seed);
    n = n || 7;
    for (let i = 0; i < n; i++) {
      const y = 34 + ((i + R() * 0.5) * (PH - 70)) / n, amp = 7 + R() * 9, wl = 70 + R() * 90, ph = R() * TAU, thick = 16 + R() * 18;
      ctx.fillStyle = i % 2 ? th.dim : th.lit;
      ctx.beginPath();
      for (let x = -16; x <= PW + 16; x += 16) { const yy = y + Math.sin(x / wl + ph) * amp; if (x === -16) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      for (let x = PW + 16; x >= -16; x -= 16) ctx.lineTo(x, y + thick + Math.sin(x / (wl * 0.7) + ph + 1.3) * amp * 0.8);
      ctx.closePath(); ctx.fill();
    }
  }
  function rays(a, seed, n) {
    const R = mulberry32(seed);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 0, 0, PH);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    for (let i = 0; i < n; i++) {
      const x = -120 + ((i + R() * 0.7) * (PW + 120)) / n, w = 28 + R() * 46, lean = 100 + R() * 70;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w + lean + 30, PH); ctx.lineTo(x + lean, PH); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  // the surface seen from below: a bright wavy band along the top with glints
  function surface(seed, col) {
    const R = mulberry32(seed), ph = R() * TAU;
    ctx.fillStyle = col || 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.moveTo(-10, 0);
    for (let x = -10; x <= PW + 16; x += 16) ctx.lineTo(x, 15 + Math.sin(x / 38 + ph) * 5 + Math.sin(x / 13 + ph * 2) * 2);
    ctx.lineTo(PW + 16, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) { const x = (i + R()) * (PW / 9), y = 27 + R() * 12, w = 16 + R() * 22; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w / 2, y - 5, x + w, y); ctx.stroke(); }
  }
  function hills(col, y, amp, seed) {
    const R = mulberry32(seed), p1 = R() * TAU, p2 = R() * TAU;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-10, PH);
    for (let x = -10; x <= PW + 20; x += 20) ctx.lineTo(x, y + amp * Math.sin(x / 150 + p1) + amp * 0.5 * Math.sin(x / 53 + p2));
    ctx.lineTo(PW + 20, PH); ctx.closePath(); ctx.fill();
  }
  const sandEdge = (x, y0, ph) => y0 + 6 * Math.sin(x / 95 + ph) + 3 * Math.sin(x / 41 + ph * 2);
  // the seabed: a wavy ridge, ripples, pebbles, shells and little stars, spread so no patch of sand is bare
  function sand(th, y0, seed, o) {
    o = o || {};
    const R = mulberry32(seed), ph = R() * TAU;
    const g = ctx.createLinearGradient(0, y0 - 8, 0, PH);
    g.addColorStop(0, th.sand[0]); g.addColorStop(1, th.sand[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-10, PH + 4);
    for (let x = -10; x <= PW + 14; x += 12) ctx.lineTo(x, sandEdge(x, y0, ph));
    ctx.lineTo(PW + 14, PH + 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = -10; x <= PW + 14; x += 12) ctx.lineTo(x, sandEdge(x, y0, ph) + 2);
    ctx.stroke();
    const dark = o.dark || 'rgba(120,70,20,0.2)', cw = 58, rowsN = Math.max(1, Math.round((PH - y0 - 16) / 34));
    for (let j = 0; j < rowsN; j++) {
      for (let i = 0; i * cw < PW + cw; i++) {
        const x = (i + 0.15 + R() * 0.7) * cw - (j % 2) * 20, y = y0 + 22 + ((j + 0.2 + R() * 0.6) * (PH - y0 - 26)) / rowsN, k = R();
        if (y > PH - 6) continue;
        if (k < 0.3) {
          ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.quadraticCurveTo(x, y - 6 - R() * 3, x + 16, y); ctx.stroke();
        } else if (k < 0.5) {
          ctx.fillStyle = dark; oval(x, y, 4 + R() * 5, 3 + R() * 2.5); oval(x + 11, y + 3, 3, 2.2);
        } else if (k < 0.68) {
          scallop(x, y + 7, 0.5 + R() * 0.22, o.shell || '#ffc4a8', (R() - 0.5) * 0.9);
        } else if (k < 0.84) {
          ctx.fillStyle = th.tips[Math.floor(R() * th.tips.length)]; star(x, y, 9, 4, 5, R() * 3); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.6)'; circle(x, y, 1.8);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.55)'; circle(x, y, 2.2); circle(x + 8, y - 4, 1.5); circle(x - 6, y + 4, 1.6);
        }
      }
    }
  }
  function bubble(x, y, r, a) {
    a = a == null ? 1 : a;
    ctx.fillStyle = `rgba(255,255,255,${(0.16 * a).toFixed(3)})`; circle(x, y, r);
    ctx.strokeStyle = `rgba(255,255,255,${(0.8 * a).toFixed(3)})`; ctx.lineWidth = Math.max(1.3, r * 0.18); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${(0.9 * a).toFixed(3)})`; circle(x - r * 0.36, y - r * 0.38, Math.max(1, r * 0.22));
  }
  // a little chain of bubbles rising from (x, y)
  function bubbles(x, y, n, R, sc) {
    sc = sc || 1;
    for (let i = 0; i < n; i++) bubble(x + (R() - 0.5) * 22 * sc + Math.sin(i * 1.7) * 6 * sc, y - i * (15 + R() * 6) * sc, (3.5 + i * 1.6 + R() * 2) * sc);
  }
  const inAny = (x, y, av, pad) => av.some((e) => { const dx = (x - e.x) / (e.rx + (pad || 0)), dy = (y - e.y) / (e.ry + (pad || 0)); return dx * dx + dy * dy < 1; });
  // Something small in every patch of open water: a jittered grid over the picture, skipping the places `av`
  // (ellipses: { x, y, rx, ry }) where the picture's subjects are. kinds: what to scatter, picked in turn.
  function scatter(seed, av, o) {
    const R = mulberry32(seed), cell = o.cell || 104, y1 = o.y1 == null ? PH : o.y1, y0 = o.y0 || 0, kinds = o.kinds, cols = o.cols || ['#ffffff'];
    let n = 0;
    for (let gy = 0; gy * cell < y1 - y0; gy++) {
      for (let gx = 0; gx * cell < PW; gx++) {
        const x = (gx + 0.2 + R() * 0.6) * cell, y = y0 + (gy + 0.25 + R() * 0.5) * cell, kind = kinds[n % kinds.length], col = cols[Math.floor(R() * cols.length)], r1 = R(), r2 = R();
        n++;
        if (y > y1 - 8 || inAny(x, y, av, o.pad == null ? 14 : o.pad)) continue;
        if (kind === 'bubbles') bubbles(x, y + 16, 2 + Math.floor(r1 * 3), R, 0.9 + r2 * 0.5);
        else if (kind === 'fish') creature('fish', col, x, y, 0.36 + r1 * 0.16, { flip: r2 < 0.5, t: r1 * 5, plain: true });
        else if (kind === 'spark') { sparkle(x, y, 7 + r1 * 6, col); sparkle(x + 18, y + 12, 4, col); }
        else if (kind === 'glow') { glow(x, y, 26 + r1 * 14, col, 0.8); ctx.fillStyle = '#ffffff'; circle(x, y, 2.6); glow(x + 22, y - 16, 14, col, 0.7); circle(x + 22, y - 16, 1.6); }
        else if (kind === 'heart') heart(x, y, 7 + r1 * 4, col);
        else if (kind === 'star') { ctx.fillStyle = col; star(x, y, 8 + r1 * 4, 3.6 + r1 * 1.6, 5, r2 * 3); ctx.fill(); }
        else if (kind === 'coin') drawCoin(x, y, r1 * 3, 9 + r2 * 4);
        else if (kind === 'jelly') creature('jelly', col, x, y, 0.4 + r1 * 0.15, { t: r2 * 4, plain: true });
        else if (kind === 'snow') { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round'; for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3 + r1; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 8, y - Math.sin(a) * 8); ctx.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8); ctx.stroke(); } }
      }
    }
  }

  // ---------- the reef ----------
  function branchCoral(x, y, col, R, size) {
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    const br = (bx, by, len, a, d) => {
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      ctx.lineWidth = (3 + d * 3) * size; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
      if (d > 0) { br(ex, ey, len * 0.75, a - 0.5 - R() * 0.2, d - 1); br(ex, ey, len * 0.75, a + 0.5 + R() * 0.2, d - 1); }
      else { ctx.fillStyle = shade(col, 0.45); circle(ex, ey, 3.2 * size); }
    };
    br(x, y, (34 + R() * 18) * size, -Math.PI / 2, 3);
  }
  function fanCoral(x, y, col, R, size) {
    const w = (38 + R() * 14) * size, h = 44 * size;
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y - h * 0.9, w, h, 0, Math.PI, 0); ctx.lineTo(x + 5 * size, y); ctx.lineTo(x - 5 * size, y); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.8 * size;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + k * w * 0.3, y - h * 1.8 + Math.abs(k) * 6 * size); ctx.stroke(); }
    ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = 1.4 * size;
    for (const k of [0.55, 0.8]) { ctx.beginPath(); ctx.ellipse(x, y - h * 0.9, w * k, h * k, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }
  }
  function tubeCoral(x, y, col, R, size) {
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const w = (11 + R() * 6) * size, h = (26 + R() * 38) * size, bx = x + (i - (n - 1) / 2) * 13 * size;
      ctx.fillStyle = col; rrect(bx - w / 2, y - h, w, h + 6, w / 2); ctx.fill();
      ctx.fillStyle = shade(col, -0.38); oval(bx, y - h + w * 0.34, w * 0.32, w * 0.2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; rrect(bx - w * 0.32, y - h + w * 0.8, w * 0.18, h * 0.55, w * 0.09); ctx.fill();
    }
  }
  function anemone(x, y, col, R, size) {
    ctx.fillStyle = shade(col, -0.25); ctx.beginPath(); ctx.ellipse(x, y, 22 * size, 13 * size, 0, Math.PI, 0); ctx.fill();
    ctx.lineCap = 'round';
    for (let k = -4; k <= 4; k++) {
      const len = (26 + R() * 16) * size, ex = x + k * 7.5 * size + (R() - 0.5) * 6 * size, ey = y - 8 * size - len * (1 - Math.abs(k) * 0.07);
      ctx.strokeStyle = col; ctx.lineWidth = 5.5 * size;
      ctx.beginPath(); ctx.moveTo(x + k * 4 * size, y - 7 * size); ctx.quadraticCurveTo(x + k * 5 * size, y - len * 0.6, ex, ey); ctx.stroke();
      ctx.fillStyle = shade(col, 0.55); circle(ex, ey, 3.2 * size);
    }
  }
  function brainCoral(x, y, col, R, size) {
    const r = (26 + R() * 10) * size;
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, r * 1.25, r, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = shade(col, -0.28); ctx.lineWidth = 2.4 * size; ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const rr = r * (0.28 + k * 0.2);
      ctx.beginPath();
      for (let a = Math.PI * 1.06; a <= Math.PI * 1.94; a += 0.16) { const w = 1 + Math.sin(a * 9 + k) * 0.09; ctx.lineTo(x + Math.cos(a) * rr * 1.25 * w, y + Math.sin(a) * rr * w); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; oval(x - r * 0.5, y - r * 0.62, r * 0.3, r * 0.14, -0.5);
  }
  function rock(x, y, col, R, size) {
    const w = (44 + R() * 22) * size, h = (30 + R() * 16) * size;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - w, y + 4);
    ctx.quadraticCurveTo(x - w * 0.95, y - h * 0.9, x - w * 0.3, y - h); ctx.quadraticCurveTo(x + w * 0.2, y - h * 1.25, x + w * 0.6, y - h * 0.7); ctx.quadraticCurveTo(x + w * 1.05, y - h * 0.4, x + w, y + 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; oval(x - w * 0.3, y - h * 0.72, w * 0.32, h * 0.14, -0.25);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; oval(x + w * 0.3, y - h * 0.3, w * 0.16, h * 0.12); oval(x - w * 0.45, y - h * 0.22, w * 0.1, h * 0.09); oval(x + w * 0.05, y - h * 0.55, w * 0.08, h * 0.07);
  }
  function kelp(x, y, h, ph, col, w) {
    const n = Math.max(5, Math.round(h / 38));
    const px = (k) => x + Math.sin(ph + k * 0.8) * (5 + k * 1.5), py = (k) => y - (h * k) / n;
    ctx.strokeStyle = col; ctx.lineWidth = w || 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); for (let k = 1; k <= n; k++) ctx.lineTo(px(k), py(k)); ctx.stroke();
    ctx.fillStyle = col;
    for (let k = 1; k <= n; k++) { const s = k % 2 ? 1 : -1; ctx.save(); ctx.translate(px(k), py(k)); ctx.rotate(s * 0.5 - 0.1); ctx.beginPath(); ctx.ellipse(s * 15, 0, 16, 6, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x - 1.5, y); for (let k = 1; k <= n; k++) ctx.lineTo(px(k) - 1.5, py(k)); ctx.stroke();
  }
  function grass(x, y, col, R, size) {
    ctx.strokeStyle = col; ctx.lineWidth = 5 * size; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) { const h = (36 + R() * 50) * size, bx = x + (k - 2.5) * 8 * size, lean = (R() - 0.5) * 30 * size; ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx + lean * 0.3, y - h * 0.6, bx + lean, y - h); ctx.stroke(); }
  }
  function crystals(x, y, R, cols, size, down) {
    for (let k = 0; k < 4; k++) {
      const h = (36 + R() * 62) * size, w = (14 + R() * 10) * size, a = (R() - 0.5) * 0.7, bx = x + (k - 1.5) * 17 * size, c = cols[k % cols.length];
      ctx.save(); ctx.translate(bx, y); ctx.rotate(down ? Math.PI + a : a);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(-w / 2, 4); ctx.lineTo(-w / 2, -h); ctx.lineTo(0, -h - w * 0.9); ctx.lineTo(w / 2, -h); ctx.lineTo(w / 2, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(-w / 2, 4); ctx.lineTo(-w / 2, -h); ctx.lineTo(0, -h - w * 0.9); ctx.lineTo(-w * 0.12, -h); ctx.lineTo(-w * 0.12, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(40,60,140,0.18)'; ctx.beginPath(); ctx.moveTo(w * 0.2, 4); ctx.lineTo(w * 0.2, -h); ctx.lineTo(0, -h - w * 0.9); ctx.lineTo(w / 2, -h); ctx.lineTo(w / 2, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  function vent(x, y, size, R) {
    ctx.fillStyle = '#3a2226';
    ctx.beginPath(); ctx.moveTo(x - 30 * size, y + 4); ctx.lineTo(x - 12 * size, y - 88 * size); ctx.lineTo(x + 12 * size, y - 88 * size); ctx.lineTo(x + 30 * size, y + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(x - 22 * size, y + 4); ctx.lineTo(x - 9 * size, y - 84 * size); ctx.lineTo(x - 3 * size, y - 84 * size); ctx.lineTo(x - 10 * size, y + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff7b3a'; oval(x, y - 88 * size, 12 * size, 4.5 * size);
    glow(x, y - 92 * size, 46 * size, 'rgba(255,140,50,0.9)', 0.9);
    for (let k = 0; k < 5; k++) { ctx.fillStyle = `rgba(255,236,220,${(0.6 - k * 0.09).toFixed(2)})`; circle(x + Math.sin(k * 1.9 + R() * 2) * (8 + k * 3) * size, y - (104 + k * 30) * size, (7 + k * 4) * size); }
  }
  function glowPlant(x, y, col, R, size) {
    for (let k = 0; k < 3; k++) {
      const h = (56 + R() * 84) * size, bx = x + (k - 1) * 22 * size, sway = (R() - 0.5) * 26 * size;
      ctx.strokeStyle = 'rgba(120,170,220,0.85)'; ctx.lineWidth = 3.4 * size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx, y - h / 2, bx + sway, y - h); ctx.stroke();
      glow(bx + sway, y - h, 30 * size, col, 0.9);
      ctx.fillStyle = col; circle(bx + sway, y - h, 6.5 * size);
      ctx.fillStyle = '#ffffff'; circle(bx + sway - 2 * size, y - h - 2 * size, 2.2 * size);
    }
  }
  function barrel(x, y, size) {
    ctx.fillStyle = '#8a5a34'; rrect(x - 24 * size, y - 54 * size, 48 * size, 58 * size, 12 * size); ctx.fill();
    ctx.fillStyle = '#5c3a22'; ctx.fillRect(x - 24 * size, y - 42 * size, 48 * size, 6 * size); ctx.fillRect(x - 24 * size, y - 16 * size, 48 * size, 6 * size);
    ctx.strokeStyle = 'rgba(40,20,10,0.35)'; ctx.lineWidth = 1.6 * size;
    for (const k of [-10, 0, 10]) { ctx.beginPath(); ctx.moveTo(x + k * size, y - 52 * size); ctx.lineTo(x + k * size, y + 2 * size); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; rrect(x - 19 * size, y - 50 * size, 7 * size, 50 * size, 3 * size); ctx.fill();
  }
  function anchor(x, y, size, col) {
    ctx.strokeStyle = col || '#54606e'; ctx.lineWidth = 9 * size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - 96 * size); ctx.lineTo(x, y); ctx.moveTo(x - 22 * size, y - 76 * size); ctx.lineTo(x + 22 * size, y - 76 * size); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 34 * size, 34 * size, 0.15, Math.PI - 0.15); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 106 * size, 9 * size, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2.5 * size;
    ctx.beginPath(); ctx.moveTo(x - 2.5 * size, y - 92 * size); ctx.lineTo(x - 2.5 * size, y - 8 * size); ctx.stroke();
  }
  function coinPile(x, y, size, R) {
    ctx.fillStyle = '#e8a200'; ctx.beginPath(); ctx.ellipse(x, y, 46 * size, 20 * size, 0, Math.PI, 0); ctx.fill();
    for (let k = 0; k < 9; k++) drawCoin(x - 34 * size + k * 8.5 * size, y - 6 * size - (k % 3) * 7 * size - R() * 4 * size, R() * 3, 9 * size);
  }
  // a row of towers with pointed roofs, windows and flags. list: [[dx, width, height], ...]
  function towers(x, base, list, cols, roofs, o) {
    o = o || {};
    list.forEach(([dx, w, h], k) => {
      const tx = x + dx, c = cols[k % cols.length], rf = roofs[k % roofs.length];
      ctx.fillStyle = c; ctx.fillRect(tx - w / 2, base - h, w, h + 30);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(tx - w / 2, base - h, w * 0.22, h + 30);
      ctx.fillStyle = 'rgba(60,40,120,0.14)'; ctx.fillRect(tx + w * 0.28, base - h, w * 0.22, h + 30);
      ctx.fillStyle = shade(c, -0.18);
      for (let b = 0; b < 3; b++) ctx.fillRect(tx - w / 2 + (b * w) / 2.6, base - h - 7, w / 4.4, 9);
      ctx.fillStyle = rf; ctx.beginPath(); ctx.moveTo(tx - w / 2 - 7, base - h - 6); ctx.lineTo(tx, base - h - 6 - w * 1.25); ctx.lineTo(tx + w / 2 + 7, base - h - 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.moveTo(tx - w / 2 - 7, base - h - 6); ctx.lineTo(tx, base - h - 6 - w * 1.25); ctx.lineTo(tx - w * 0.12, base - h - 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = o.pole || '#8a6a30'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(tx, base - h - 6 - w * 1.25); ctx.lineTo(tx, base - h - 26 - w * 1.25); ctx.stroke();
      ctx.fillStyle = roofs[(k + 2) % roofs.length]; ctx.beginPath(); ctx.moveTo(tx, base - h - 26 - w * 1.25); ctx.lineTo(tx + 17, base - h - 20 - w * 1.25); ctx.lineTo(tx, base - h - 14 - w * 1.25); ctx.closePath(); ctx.fill();
      ctx.fillStyle = o.win || '#5a4fa8';
      for (let wy = base - h + 22; wy < base - 16; wy += 44) { rrect(tx - w * 0.17, wy, w * 0.34, 22, w * 0.17); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,240,150,0.9)';
      for (let wy = base - h + 22; wy < base - 16; wy += 44) { rrect(tx - w * 0.09, wy + 5, w * 0.18, 13, w * 0.09); ctx.fill(); }
    });
  }
  function archDoor(x, base, w, h, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - w / 2, base + 10); ctx.lineTo(x - w / 2, base - h + w / 2); ctx.arc(x, base - h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, base + 10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, base + 10); ctx.lineTo(x, base - h); ctx.stroke();
    ctx.fillStyle = GOLD; circle(x - 6, base - h * 0.4, 3); circle(x + 6, base - h * 0.4, 3);
  }
  // a string of little flags across the top
  function bunting(y, sag, seed) {
    const R = mulberry32(seed), n = 15;
    const at = (u) => ({ x: -10 + u * (PW + 20), y: y + Math.sin(u * Math.PI) * sag + Math.sin(u * 9) * 4 });
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const p = at(i / 40); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const a = at((i + 0.15) / n), b = at((i + 0.85) / n), c = RAINBOW[i % 7];
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo((a.x + b.x) / 2 + (R() - 0.5) * 6, (a.y + b.y) / 2 + 44); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; circle((a.x + b.x) / 2, (a.y + b.y) / 2 + 15, 4.5);
    }
  }
  function moon(x, y, r) {
    glow(x, y, r * 3.2, 'rgba(210,225,255,0.6)', 1);
    ctx.fillStyle = '#f4f6ff'; circle(x, y, r);
    ctx.fillStyle = 'rgba(160,175,225,0.55)'; circle(x - r * 0.3, y - r * 0.25, r * 0.2); circle(x + r * 0.34, y + r * 0.1, r * 0.26); circle(x - r * 0.1, y + r * 0.5, r * 0.14); circle(x + r * 0.15, y - r * 0.55, r * 0.11);
  }
  // a reef along the seabed: one thing every `step` units, picked in turn from kinds
  function reef(th, y, seed, o) {
    o = o || {};
    const R = mulberry32(seed), step = o.step || 84, size = o.size || 1, kinds = o.kinds || ['branch', 'fan', 'tube', 'anemone'];
    let n = Math.floor(R() * kinds.length);
    ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    for (let x = step * 0.3; x < PW + step * 0.3; x += step) {
      const px = x + (R() - 0.5) * step * 0.5, py = y + (R() - 0.5) * 10, col = th.tips[Math.floor(R() * th.tips.length)], kind = kinds[n++ % kinds.length], s = size * (0.85 + R() * 0.4);
      if (o.skip && o.skip.some(([a, b]) => px > a && px < b)) { R(); continue; }
      if (kind === 'branch') branchCoral(px, py, col, R, s);
      else if (kind === 'fan') fanCoral(px, py, col, R, s);
      else if (kind === 'tube') tubeCoral(px, py, col, R, s);
      else if (kind === 'anemone') anemone(px, py, col, R, s);
      else if (kind === 'brain') brainCoral(px, py, col, R, s);
      else if (kind === 'rock') rock(px, py, o.rock || '#b0957d', R, s);
      else if (kind === 'grass') grass(px, py, o.green || '#3e9f6a', R, s);
      else if (kind === 'kelp') kelp(px, py, (150 + R() * 130) * s, R() * 6, o.green || '#2f8f5a', 7 * s);
      else if (kind === 'crystal') crystals(px, py, R, th.tips, s);
      else if (kind === 'glow') glowPlant(px, py, col, R, s);
    }
    ctx.restore();
  }
  // the whole backdrop in one go: water, currents, shafts of light, the surface, far hills
  function sea(th, seed, o) {
    o = o || {};
    water(th);
    currents(th, seed, o.currents);
    if (th.ray > 0.05) rays(th.ray, seed + 1, o.rays || 6);
    if (o.surface !== false) surface(seed + 2, th.surf);
    if (o.hills !== false) hills(th.far, o.hillY || 340, 30, seed + 3);
  }

  // ---------- the thirty pictures ----------
  const TH = {
    hello: T('#8feaf4', '#1f8fc0', 'rgba(28,118,170,0.5)', ['#fbe8b4', '#e2c07c'], ['#ff8fab', '#ffd166', '#ff6b6b', '#ffa94d'], 0.2),
    turtle: T('#7ad0f8', '#145ea8', 'rgba(15,70,130,0.5)', ['#f3e0b0', '#d7bd86'], ['#ffd166', '#ff8fab', '#8ce99a'], 0.18),
    crab: T('#a6ecff', '#2c7fd0', 'rgba(30,90,160,0.45)', ['#ffdfa8', '#f0b468'], ['#ff7b5c', '#ffd166', '#ff5d8f'], 0.2),
    octopus: T('#b4ecff', '#3a6fd0', 'rgba(60,80,170,0.45)', ['#ffe6f1', '#efbcd4'], ['#ff5d8f', '#c77dff', '#ff9e6d', '#ffd166'], 0.18),
    whale: T('#5a92e0', '#0e2a63', 'rgba(15,40,100,0.6)', ['#c9d4e8', '#9aa9c8'], ['#9ad8ff', '#ffd166', '#c9a7ff'], 0.12),
    chest: T('#56bccb', '#0b4660', 'rgba(8,48,66,0.6)', ['#d9c79a', '#b29f70'], ['#ffb347', '#ff6b6b', '#8ce99a'], 0.14),
    seahorse: T('#a8f2cc', '#16846f', 'rgba(20,110,90,0.5)', ['#efe6b0', '#d1c27c'], ['#ffe066', '#ff9ec7', '#b8f27c'], 0.18),
    dolphin: T('#d2f8ff', '#2a9fd8', 'rgba(40,140,200,0.4)', ['#fff2c8', '#ecd59a'], ['#ff8fab', '#ffd166', '#7ad7ff'], 0.3),
    puffer: T('#cdbcff', '#5346b8', 'rgba(70,50,150,0.5)', ['#ffe2c0', '#e8b98c'], ['#ff7ad9', '#7afcff', '#ffd166'], 0.14),
    friends: T('#bff6f0', '#2b9fb8', 'rgba(40,140,170,0.45)', ['#fff6e0', '#ecd5ab'], ['#ffd1e8', '#ffffff', '#bff4ff', '#ff9ec7'], 0.2),
    garden: T('#9af2e2', '#168a9a', 'rgba(20,110,120,0.45)', ['#fde7c2', '#e6c08a'], ['#ff5d8f', '#ff9e6d', '#c77dff', '#ffd166', '#5ad17a'], 0.18),
    race: T('#86ccff', '#1a4fa8', 'rgba(20,60,140,0.5)', ['#f6e3b4', '#dcc08a'], ['#ffd166', '#ff8fab', '#8ce99a'], 0.2),
    octogarden: T('#9a8ee8', '#2a2370', 'rgba(40,30,100,0.6)', ['#d7c6e8', '#a996c4'], ['#ff7ad9', '#7afcff', '#ffd166'], 0.1),
    whales: T('#30509f', '#070f34', 'rgba(14,28,80,0.7)', ['#465a90', '#283866'], ['#9ad8ff', '#c8b6ff', '#7afcff'], 0, { lit: 'rgba(170,200,255,0.13)', dim: 'rgba(0,0,30,0.2)' }),
    parade: T('#ffd0e0', '#c2528e', 'rgba(170,60,120,0.4)', ['#fff0d0', '#f0cfa0'], ['#ffffff', '#ffe066', '#7ad7ff', '#b8f27c'], 0.2, { dim: 'rgba(120,20,80,0.13)' }),
    jellies: T('#1f4078', '#040b24', 'rgba(14,28,70,0.7)', ['#34416a', '#1c2444'], ['#5cf2ff', '#ff5cf0', '#9dff5c'], 0, { lit: 'rgba(120,200,255,0.12)', dim: 'rgba(0,0,20,0.25)' }),
    wreck: T('#66c8ba', '#0d4f5a', 'rgba(10,60,70,0.6)', ['#e6d39e', '#bfa66c'], ['#ffcc33', '#ff6b6b', '#8ce99a'], 0.14),
    turtles: T('#b0f4de', '#1a8f8a', 'rgba(20,120,110,0.45)', ['#f2ecc0', '#d6c88c'], ['#ff9ec7', '#ffe066', '#ffffff'], 0.2),
    palace: T('#a8eefa', '#5b78e0', 'rgba(130,140,230,0.45)', ['#fdeaf6', '#e9c6df'], RAINBOW, 0.2),
    treasure: T('#ffe9a8', '#c56a2a', 'rgba(150,70,20,0.45)', ['#b98454', '#8a5a34'], ['#ffd23f', '#ff8fd8', '#ffffff', '#7ad7ff'], 0.22, { dim: 'rgba(120,50,0,0.14)' }),
    party: T('#90ecf6', '#2f7fd0', 'rgba(40,110,190,0.45)', ['#ffdcc0', '#f0b48c'], RAINBOW, 0.16),
    crystal: T('#8ee4f8', '#1f4f94', 'rgba(30,70,140,0.5)', ['#e4f1fb', '#b8d3ea'], ['#c2f0ff', '#ffffff', '#b9a7ff', '#ffb8e8'], 0.14),
    ice: T('#cdf3ff', '#5aa4dc', 'rgba(120,170,220,0.5)', ['#ffffff', '#d7ebf7'], ['#bfefff', '#ffffff', '#d6c8ff'], 0.22, { dim: 'rgba(40,90,170,0.13)' }),
    sunset: T('#f8b074', '#6d2747', 'rgba(90,30,50,0.6)', ['#7a6262', '#4a3a3e'], ['#ff7b3a', '#ffd166', '#ff3d6e'], 0.1, { dim: 'rgba(80,0,40,0.15)' }),
    moon: T('#7256c8', '#170c44', 'rgba(40,24,100,0.65)', ['#5a4f98', '#3a3070'], ['#c8b6ff', '#7afcff', '#ff9ef0'], 0, { lit: 'rgba(220,200,255,0.13)', dim: 'rgba(10,0,40,0.22)' }),
    kelp: T('#90e8c8', '#0f6b5e', 'rgba(10,80,70,0.5)', ['#eee2a8', '#c8b26e'], ['#b8f27c', '#ffd166', '#7cf2c8'], 0.2),
    pearls: T('#d0fff2', '#3ab0a8', 'rgba(50,150,150,0.4)', ['#fffaf0', '#ecdcc8'], ['#ffd1e8', '#ffffff', '#ffe9a8', '#c9a7ff'], 0.2),
    bigchest: T('#8aa6aa', '#1f3439', 'rgba(30,50,55,0.6)', ['#b0ac94', '#7b7866'], ['#c6ff8a', '#ffe066', '#9ad8ff'], 0.1),
    castle: T('#d0acff', '#3b1d7a', 'rgba(70,40,140,0.5)', ['#ffe8a3', '#e8c56a'], ['#ffd23f', '#ff8fd8', '#ffffff'], 0.18),
    everyone: T('#ffd9ee', '#6f86e6', 'rgba(140,130,230,0.4)', ['#fff0d8', '#f2cfa8'], RAINBOW, 0.2, { mid: '#bfe6ff' }),
  };
  const E = (x, y, rx, ry) => ({ x, y, rx, ry });   // where a subject is, so the scatter leaves it clear

  const PICS = {
    // ===== Easy: one big friend, with something different in every corner =====
    hello() {
      const th = TH.hello;
      sea(th, 11);
      reef(th, 412, 12, { size: 0.9, alpha: 0.75, step: 74, kinds: ['fan', 'branch', 'tube'] });
      sand(th, 418, 13);
      reef(th, 500, 14, { size: 1.25, step: 150, kinds: ['anemone', 'brain', 'branch', 'tube'] });
      creature('fish', '#ff8c2e', 132, 96, 1.25, { t: 1 });
      creature('fish', '#ffd23f', 248, 58, 0.85, { t: 2 });
      creature('crab', '#ff5a4f', 640, 462, 1.1, { t: 1.2 });
      creature('starfish', '#ff6f91', 250, 470, 0.9, { rot: 0.3 });
      drawIsabella(446, 238, { scale: 4.1, tilt: -0.1, wave: 1.2, happy: true });
      scatter(15, [E(350, 250, 330, 150), E(132, 96, 70, 50), E(248, 58, 50, 36)], { y1: 400, kinds: ['bubbles', 'heart', 'bubbles', 'spark'], cols: ['#ff7ab8', '#fff6a0', '#ffffff'] });
    },
    turtle() {
      const th = TH.turtle;
      sea(th, 21);
      reef(th, 420, 22, { size: 1, alpha: 0.8, step: 66, kinds: ['grass', 'rock', 'grass', 'fan'], rock: '#8fa0b4', green: '#3e9f6a' });
      sand(th, 424, 23);
      reef(th, 510, 24, { size: 1.2, step: 120, kinds: ['grass', 'anemone', 'grass', 'brain'], green: '#4fbf7a' });
      creature('jelly', '#ff9ec7', 120, 110, 1.2, { t: 2 });
      creature('fish', '#ffd23f', 700, 96, 1.1, { flip: true, t: 3 });
      creature('fish', '#ff8c2e', 760, 330, 0.8, { flip: true, t: 1 });
      creature('starfish', '#ffa53d', 96, 468, 0.95, { rot: -0.2 });
      creature('turtle', '#3fbf7f', 404, 262, 4.5, { rot: -0.08, t: 0.2 });
      scatter(25, [E(404, 250, 250, 170), E(120, 110, 60, 60), E(700, 96, 60, 44)], { y1: 404, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#fff6a0', '#ffffff'] });
    },
    crab() {
      const th = TH.crab;
      sea(th, 31, { hillY: 250 });
      reef(th, 286, 32, { size: 1.1, alpha: 0.8, step: 92, kinds: ['rock', 'branch', 'fan', 'tube'], rock: '#c99f78', skip: [[300, 540]] });
      sand(th, 290, 33);
      creature('fish', '#3d8bff', 120, 86, 1.05, { t: 1 });
      creature('fish', '#ff6f91', 236, 150, 0.75, { t: 2.4 });
      creature('seahorse', '#b77dff', 716, 130, 1.25, { flip: true });
      clam(706, 468, 1.3, '#ffb8d6');
      creature('starfish', '#ff6f91', 120, 420, 1.3, { rot: 0.25 });
      scallop(250, 486, 1.2, '#ffe9a8', -0.3);
      creature('crab', '#ff5a4f', 416, 318, 4.3, { t: 0.5 });
      scatter(35, [E(416, 300, 220, 150), E(120, 86, 60, 44), E(716, 130, 50, 70)], { y1: 270, kinds: ['bubbles', 'bubbles', 'spark'], cols: ['#ffffff', '#fff6a0'] });
    },
    octopus() {
      const th = TH.octopus;
      sea(th, 41);
      reef(th, 420, 42, { size: 1.15, alpha: 0.85, step: 78, kinds: ['fan', 'tube', 'fan', 'branch'] });
      sand(th, 424, 43, { dark: 'rgba(150,60,110,0.18)', shell: '#ffffff' });
      reef(th, 512, 44, { size: 1.2, step: 170, kinds: ['anemone', 'brain'] });
      creature('fish', '#ff8c2e', 110, 120, 1.2, { t: 1.4 });
      creature('fish', '#ffd23f', 96, 300, 0.8, { t: 2.2 });
      creature('seahorse', '#ffc23a', 724, 236, 1.5, { flip: true });
      creature('starfish', '#ffa53d', 712, 462, 1.05, { rot: 0.2 });
      creature('puffer', '#6fd3ff', 706, 84, 0.85, { flip: true, plain: true });
      creature('octopus', '#b86bff', 408, 262, 4.5, { t: 0.7 });
      scatter(45, [E(408, 262, 190, 200), E(110, 120, 60, 44), E(724, 236, 50, 70), E(706, 84, 44, 40)], { y1: 404, kinds: ['bubbles', 'heart', 'bubbles'], cols: ['#ff7ab8', '#ffffff'] });
    },
    whale() {
      const th = TH.whale;
      sea(th, 51, { rays: 5 });
      reef(th, 440, 52, { size: 0.9, alpha: 0.85, step: 60, kinds: ['kelp', 'rock', 'kelp', 'grass'], green: '#2a7f9f', rock: '#6c7fa8' });
      sand(th, 444, 53, { dark: 'rgba(20,40,100,0.2)' });
      creature('whale', '#4f8ff0', 400, 232, 5.6, { t: 0.4 });
      for (const [x, y, s, c, t] of [[96, 372, 0.7, '#ffd23f', 1], [176, 404, 0.6, '#ffd23f', 2], [250, 380, 0.55, '#ffd23f', 3], [690, 392, 0.75, '#ff8fc0', 1.5], [770, 360, 0.6, '#ff8fc0', 2.6]]) creature('fish', c, x, y, s, { t, plain: true });
      creature('starfish', '#ffe066', 470, 484, 0.85, { rot: 0.4 });
      creature('jelly', '#c9a7ff', 742, 84, 0.9, { t: 1 });
      scatter(55, [E(390, 215, 300, 170), E(742, 84, 44, 50)], { y1: 420, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#bfe6ff', '#ffffff'] });
    },
    chest() {
      const th = TH.chest;
      sea(th, 61, { rays: 5 });
      reef(th, 404, 62, { size: 1, alpha: 0.8, step: 70, kinds: ['kelp', 'grass', 'branch', 'grass'], green: '#3d8a66', skip: [[280, 560]] });
      sand(th, 408, 63);
      anchor(96, 470, 1.25);
      barrel(726, 450, 1.35);
      drawChest(420, 400, 1, 0.6, 2.5);
      for (const [x, y, r, ph] of [[300, 196, 20, 0.2], [362, 110, 17, 1], [470, 80, 22, 0.1], [546, 170, 18, 0.7], [420, 176, 15, 1.3], [236, 300, 16, 0.4], [600, 290, 17, 0.9], [330, 474, 18, 0.3], [520, 486, 16, 1.1], [600, 452, 14, 0.2]]) drawCoin(x, y, ph, r);
      drawKey(676, 96, -0.45, 2.1);
      gem(70, 150, 20, '#ff4d8d'); gem(232, 436, 17, '#4cc9f0'); gem(636, 384, 15, '#5ad17a');
      creature('fish', '#ffd23f', 724, 262, 1.1, { flip: true, t: 1 });
      creature('fish', '#ff8c2e', 96, 250, 0.8, { t: 2 });
      creature('crab', '#ff7043', 604, 486, 0.9, { t: 1 });
      scatter(65, [E(420, 300, 220, 240), E(676, 96, 100, 60), E(724, 262, 60, 44), E(96, 250, 50, 36), E(70, 150, 30, 30)], { y1: 392, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#fff6a0', '#ffffff'] });
    },
    seahorse() {
      const th = TH.seahorse;
      sea(th, 71);
      for (const [x, h, ph, c] of [[40, 330, 0.5, '#2f8f5a'], [118, 250, 2, '#3fae6a'], [706, 300, 1, '#3fae6a'], [790, 360, 3, '#2f8f5a'], [208, 170, 4, '#2f8f5a'], [628, 190, 2.5, '#2f8f5a']]) kelp(x, 436, h, ph, c, 8);
      sand(th, 430, 73);
      reef(th, 512, 74, { size: 1.15, step: 132, kinds: ['anemone', 'tube', 'brain', 'grass'], green: '#4fbf7a' });
      creature('fish', '#ff8c2e', 176, 86, 0.9, { t: 1 });
      creature('fish', '#ff6f91', 650, 96, 1, { flip: true, t: 2.2 });
      creature('crab', '#ff7043', 150, 470, 0.9, { t: 0.4 });
      scallop(676, 476, 1.1, '#ffd1e8', 0.3);
      creature('seahorse', '#ff9e3d', 416, 238, 5, { t: 0.3 });
      scatter(75, [E(416, 240, 170, 220), E(176, 86, 50, 40), E(650, 96, 50, 40)], { y1: 410, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#fff6a0', '#ffffff'] });
    },
    dolphin() {
      const th = TH.dolphin;
      sea(th, 81, { rays: 8, hillY: 400 });
      // the sun, wobbling through the surface
      glow(660, 20, 240, 'rgba(255,250,200,0.7)', 1);
      ctx.fillStyle = 'rgba(255,253,225,0.95)'; oval(660, 24, 54, 40);
      reef(th, 452, 82, { size: 0.85, alpha: 0.85, step: 62, kinds: ['fan', 'branch', 'tube', 'anemone'] });
      sand(th, 456, 83);
      creature('dolphin', '', 400, 240, 6.6, { rot: -0.24, t: 0.2 });
      creature('dolphin', '', 150, 396, 2, { rot: -0.1, plain: true });
      for (const [x, y, s, c, t] of [[640, 380, 0.8, '#ff8c2e', 1], [716, 344, 0.7, '#ff8c2e', 2], [770, 400, 0.65, '#ff8c2e', 3], [112, 120, 0.8, '#ff6f91', 1], [196, 76, 0.65, '#ff6f91', 2.4]]) creature('fish', c, x, y, s, { t, flip: x > 400, plain: true });
      scatter(85, [E(400, 240, 270, 150), E(150, 396, 90, 50), E(660, 24, 70, 50)], { y1: 440, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#fff6a0', '#ffffff'] });
    },
    puffer() {
      const th = TH.puffer;
      sea(th, 91);
      reef(th, 410, 92, { size: 1, alpha: 0.8, step: 72, kinds: ['tube', 'fan', 'branch', 'anemone'] });
      sand(th, 414, 93);
      rock(640, 430, '#8a78c0', mulberry32(94), 2.1);
      creature('starfish', '#ffa53d', 640, 340, 2.3, { rot: 0.15 });
      creature('crab', '#ff5a4f', 150, 462, 1.15, { t: 0.9 });
      creature('fish', '#5ad17a', 690, 96, 1, { flip: true, t: 1.3 });
      creature('fish', '#ff6f91', 110, 80, 0.85, { t: 2.3 });
      creature('seahorse', '#7afcff', 96, 268, 1.1, {});
      creature('jelly', '#ff9ec7', 520, 92, 0.95, { t: 1.5 });
      creature('puffer', '#ffc93a', 330, 230, 4.3, { t: 0.5 });
      scatter(95, [E(520, 92, 44, 50), E(330, 230, 180, 160), E(640, 340, 110, 100), E(690, 96, 50, 40), E(110, 80, 50, 40), E(96, 268, 40, 60)], { y1: 396, kinds: ['bubbles', 'star', 'bubbles'], cols: ['#fff6a0', '#ffffff'] });
    },
    friends() {
      const th = TH.friends;
      sea(th, 111);
      reef(th, 420, 112, { size: 0.9, alpha: 0.8, step: 70, kinds: ['branch', 'fan', 'tube'] });
      sand(th, 424, 113, { shell: '#ffd1e8' });
      clam(110, 474, 1.15, '#d9b8e8'); clam(700, 486, 1, '#ffb8d6');
      creature('starfish', '#ff9ec7', 420, 480, 0.9, { rot: 0.3 });
      drawIsabella(330, 170, { scale: 2.9, tilt: 0.08, happy: true });
      creature('turtle', '#3fbf7f', 560, 318, 2.9, { rot: -0.1, t: 0.2 });
      heart(450, 250, 17, '#ff4d8d'); heart(486, 200, 11, '#ff8fb8'); heart(506, 150, 7, '#ffb8d6');
      creature('fish', '#ffd23f', 120, 330, 0.95, { t: 1.2 });
      creature('fish', '#ff8c2e', 730, 96, 0.9, { flip: true, t: 2 });
      creature('jelly', '#c9a7ff', 96, 90, 0.8, { t: 1 });
      scatter(115, [E(280, 170, 250, 110), E(560, 318, 150, 100), E(120, 330, 50, 40), E(730, 96, 50, 40), E(96, 90, 40, 46), E(470, 200, 50, 70)], { y1: 404, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#ffffff', '#ffe9a8'] });
    },

    // ===== Medium: two or three friends and a place =====
    garden() {
      const th = TH.garden;
      sea(th, 121);
      reef(th, 360, 122, { size: 1.5, alpha: 0.7, step: 96, kinds: ['fan', 'branch', 'tube', 'branch'] });
      reef(th, 424, 126, { size: 1.2, alpha: 0.9, step: 70, kinds: ['tube', 'anemone', 'brain', 'fan'] });
      sand(th, 430, 123);
      reef(th, 516, 124, { size: 1.3, step: 104, kinds: ['anemone', 'brain', 'tube', 'branch'] });
      const F = [[120, 110, 1.3, '#ff8c2e', 1, 0], [300, 70, 1, '#3d8bff', 2, 1], [470, 140, 1.4, 'rainbow', 0.5, 0], [660, 80, 1.1, '#ff6f91', 3, 1], [750, 210, 1.2, '#ffd23f', 1.7, 1], [220, 220, 1.05, '#5ad17a', 2.5, 0], [560, 260, 0.9, '#b86bff', 0.8, 0], [96, 300, 0.8, '#ffd23f', 3.2, 0]];
      for (const [x, y, s, c, t, fl] of F) creature('fish', c, x, y, s, { t, flip: !!fl, plain: s < 1.2 });
      creature('starfish', '#ff6f91', 380, 470, 1, { rot: 0.3 }); creature('starfish', '#ffa53d', 700, 480, 0.8, { rot: -0.4 });
      scatter(125, F.map(([x, y, s]) => E(x, y, 50 * s, 34 * s)), { y1: 330, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#ffffff', '#fff6a0'] });
    },
    race() {
      const th = TH.race;
      sea(th, 131, { rays: 7 });
      reef(th, 430, 132, { size: 0.95, alpha: 0.8, step: 64, kinds: ['grass', 'fan', 'grass', 'branch'], green: '#3e9f6a' });
      sand(th, 434, 133);
      // their wakes: streaks and bubbles behind the racers
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (const [x, y, w] of [[40, 120, 110], [70, 160, 80], [30, 196, 120], [50, 300, 100], [90, 336, 70], [30, 372, 110]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); }
      drawIsabella(470, 160, { scale: 2.8, tilt: -0.05, happy: true });
      creature('dolphin', '', 440, 336, 4.4, { rot: -0.03, t: 0.2 });
      // the winning post: a striped pole with a flag
      ctx.fillStyle = '#ffffff'; rrect(762, 60, 14, 380, 7); ctx.fill();
      ctx.fillStyle = '#ff4d6d'; for (let y = 76; y < 430; y += 46) ctx.fillRect(762, y, 14, 22);
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(762, 62); ctx.lineTo(690, 86); ctx.lineTo(762, 112); ctx.closePath(); ctx.fill();
      sparkle(726, 86, 9, '#ffffff');
      creature('fish', '#ffd23f', 664, 250, 0.8, { flip: true, t: 1 });
      creature('crab', '#ff5a4f', 676, 480, 0.95, { t: 0.2 });
      creature('starfish', '#ff6f91', 180, 484, 0.9, { rot: 0.2 });
      scatter(135, [E(420, 160, 250, 96), E(430, 330, 210, 96), E(740, 240, 70, 200)], { y1: 420, kinds: ['bubbles', 'bubbles', 'spark'], cols: ['#ffffff', '#fff6a0'] });
    },
    octogarden() {
      const th = TH.octogarden;
      sea(th, 141);
      reef(th, 412, 142, { size: 1.15, alpha: 0.85, step: 76, kinds: ['anemone', 'tube', 'fan', 'brain'] });
      sand(th, 416, 143, { dark: 'rgba(60,30,120,0.22)' });
      reef(th, 514, 144, { size: 1.1, step: 150, kinds: ['tube', 'anemone'] });
      creature('octopus', '#ff8f6b', 300, 220, 3.1, { t: 0.3 });
      creature('crab', '#ff5a4f', 596, 400, 2.3, { t: 0.5 });
      clam(140, 470, 1.2, '#ffb8d6'); clam(742, 480, 0.95, '#d9b8e8');
      creature('seahorse', '#ffe066', 640, 150, 1.6, { flip: true });
      creature('fish', '#7afcff', 96, 96, 1, { t: 1 }); creature('fish', '#ff7ad9', 520, 70, 0.85, { flip: true, t: 2 });
      creature('starfish', '#ffe066', 420, 474, 1, { rot: 0.2 });
      creature('jelly', '#7afcff', 760, 300, 0.8, { t: 2 });
      scatter(145, [E(300, 230, 150, 150), E(596, 380, 120, 80), E(640, 150, 60, 86), E(96, 96, 50, 40), E(520, 70, 46, 36), E(760, 300, 40, 50)], { y1: 398, kinds: ['bubbles', 'glow', 'bubbles'], cols: ['rgba(255,150,240,0.8)', 'rgba(130,250,255,0.8)'] });
    },
    whales() {
      const th = TH.whales;
      sea(th, 151, { surface: false, hillY: 380 });
      moon(650, 70, 46);
      // moonlight on the surface
      ctx.fillStyle = 'rgba(220,230,255,0.22)'; ctx.beginPath(); ctx.moveTo(-10, 0);
      for (let x = -10; x <= PW + 16; x += 16) ctx.lineTo(x, 14 + Math.sin(x / 34) * 5);
      ctx.lineTo(PW + 16, 0); ctx.closePath(); ctx.fill();
      reef(th, 440, 152, { size: 1, step: 72, kinds: ['glow', 'kelp', 'glow', 'rock'], green: '#28508a', rock: '#3c4a80' });
      sand(th, 444, 153, { dark: 'rgba(0,0,30,0.3)', shell: '#aab8e8' });
      creature('whale', '#5f86e0', 330, 200, 4.4, { t: 0.4 });
      creature('whale', '#ff8fc0', 610, 330, 2.1, { t: 1.4, flip: true });
      creature('jelly', '#7afcff', 96, 96, 0.9, { t: 1 });
      creature('starfish', '#ffe066', 220, 480, 0.9, { rot: 0.3 });
      scatter(155, [E(320, 190, 240, 130), E(610, 320, 110, 76), E(650, 70, 70, 60), E(96, 96, 44, 50)], { y1: 424, kinds: ['glow', 'spark', 'bubbles'], cols: ['rgba(160,220,255,0.8)', '#fff6c0'] });
    },
    parade() {
      const th = TH.parade;
      sea(th, 161);
      for (const [x, h, ph] of [[150, 300, 1], [416, 330, 3], [690, 290, 5], [20, 220, 2], [812, 240, 4]]) kelp(x, 432, h, ph, '#b0407a', 8);
      sand(th, 428, 163, { dark: 'rgba(150,60,90,0.18)' });
      reef(th, 512, 164, { size: 1.05, step: 110, kinds: ['anemone', 'tube', 'brain'] });
      const S = [[96, 250, '#ff9e3d', 0.2], [286, 210, '#7afcff', 1.2], [548, 246, '#b77dff', 2.2], [760, 206, '#5ad17a', 3.2]];
      for (const [x, y, c, t] of S) creature('seahorse', c, x, y, 2.6, { t });
      // each carries a little flag on a pole
      S.forEach(([x, y], i) => { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 40, y - 30); ctx.lineTo(x + 40, y - 150); ctx.stroke(); ctx.fillStyle = RAINBOW[(i * 2) % 7]; ctx.beginPath(); ctx.moveTo(x + 40, y - 150); ctx.lineTo(x + 84, y - 132); ctx.lineTo(x + 40, y - 114); ctx.closePath(); ctx.fill(); });
      creature('crab', '#ff5a4f', 416, 468, 1, { t: 0.5 });
      creature('fish', '#ffe066', 420, 80, 0.9, { t: 1 }); creature('fish', '#ffffff', 196, 60, 0.7, { t: 2 }); creature('fish', '#7ad7ff', 650, 400, 0.8, { flip: true, t: 3 });
      scatter(165, S.map(([x, y]) => E(x + 14, y - 30, 80, 150)).concat([E(420, 80, 46, 36)]), { y1: 410, kinds: ['bubbles', 'heart', 'bubbles', 'spark'], cols: ['#ffffff', '#fff6a0'] });
    },
    jellies() {
      const th = TH.jellies;
      sea(th, 171, { surface: false, hillY: 400 });
      reef(th, 446, 172, { size: 1.1, step: 66, kinds: ['glow', 'glow', 'rock'], rock: '#16244a' });
      sand(th, 450, 173, { dark: 'rgba(0,0,20,0.35)', shell: '#8fa0d8' });
      const J = [[110, 150, 2, '#6ff5ff', 0.2], [280, 290, 1.5, '#ff7ac8', 1.2], [420, 130, 2.3, '#9dff5c', 2], [590, 300, 1.6, '#ffd36f', 3], [720, 150, 2, '#c9a7ff', 4], [200, 60, 0.9, '#ff9ef0', 5]];
      for (const [x, y, s, c] of J) glow(x, y - 6 * s, 86 * s, c === '#6ff5ff' ? 'rgba(110,245,255,0.5)' : c === '#ff7ac8' ? 'rgba(255,120,200,0.5)' : c === '#9dff5c' ? 'rgba(157,255,92,0.45)' : c === '#ffd36f' ? 'rgba(255,211,111,0.5)' : 'rgba(201,167,255,0.5)', 0.9);
      for (const [x, y, s, c, t] of J) creature('jelly', c, x, y, s, { t });
      creature('angler', '#8f86ff', 430, 380, 1.3, { t: 0.4 });
      creature('fish', '#6dff9c', 760, 380, 0.75, { flip: true, t: 1 });
      scatter(175, J.map(([x, y, s]) => E(x, y + 8 * s, 34 * s, 44 * s)).concat([E(430, 372, 60, 60)]), { y1: 430, kinds: ['glow', 'spark', 'glow'], cols: ['rgba(120,255,240,0.8)', 'rgba(255,130,240,0.7)', '#d8ffff'], cell: 96 });
    },
    wreck() {
      const th = TH.wreck;
      sea(th, 181, { rays: 5 });
      reef(th, 420, 182, { size: 0.9, alpha: 0.8, step: 58, kinds: ['kelp', 'grass', 'grass'], green: '#3d8a66' });
      sand(th, 424, 183);
      // the hull, lying a little on its side
      ctx.save(); ctx.translate(410, 300); ctx.rotate(-0.07);
      ctx.fillStyle = '#6d4a30'; ctx.beginPath(); ctx.moveTo(-290, -40); ctx.lineTo(270, -62); ctx.quadraticCurveTo(250, 80, 170, 130); ctx.lineTo(-200, 136); ctx.quadraticCurveTo(-270, 70, -290, -40); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,10,0.4)'; ctx.lineWidth = 3;
      for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(-270 + k * 6, -12 + k * 30); ctx.lineTo(250 - k * 14, -32 + k * 30); ctx.stroke(); }
      ctx.fillStyle = '#8a5f3e'; ctx.beginPath(); ctx.moveTo(-296, -40); ctx.lineTo(276, -62); ctx.lineTo(274, -40); ctx.lineTo(-292, -18); ctx.closePath(); ctx.fill();
      // a hole in the planks, with a chest in the dark inside
      ctx.fillStyle = '#20140c'; ctx.beginPath(); ctx.moveTo(-60, 20); ctx.lineTo(-20, 0); ctx.lineTo(40, 14); ctx.lineTo(60, 60); ctx.lineTo(20, 100); ctx.lineTo(-50, 90); ctx.closePath(); ctx.fill();
      drawChest(0, 70, 0, 0, 0.62);
      for (const [x, y, c] of [[-190, 30, '#ffd23f'], [150, 14, '#ff8c2e']]) {
        ctx.fillStyle = '#ffcc33'; circle(x, y, 27); ctx.fillStyle = '#16303a'; circle(x, y, 20);
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.clip(); creature('fish', c, x - 3, y + 2, 0.5, { plain: true }); ctx.restore();
      }
      // the mast, the crow's nest and what is left of the sail
      ctx.fillStyle = '#5c3d28'; ctx.fillRect(-60, -268, 16, 236);
      ctx.fillStyle = '#8a5f3e'; rrect(-86, -252, 68, 22, 6); ctx.fill();
      ctx.fillStyle = '#f2e8d0'; ctx.beginPath(); ctx.moveTo(-44, -224); ctx.lineTo(96, -196); ctx.lineTo(70, -150); ctx.lineTo(104, -110); ctx.lineTo(-44, -84); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff6b6b'; ctx.fillRect(-10, -180, 36, 26); ctx.fillStyle = '#4cc9f0'; ctx.fillRect(30, -140, 26, 22);
      ctx.strokeStyle = 'rgba(120,90,50,0.5)'; ctx.lineWidth = 2; for (const y of [-196, -150, -110]) { ctx.beginPath(); ctx.moveTo(-44, y); ctx.lineTo(80, y + 10); ctx.stroke(); }
      ctx.restore();
      barrel(730, 466, 1.2); anchor(96, 476, 1.05);
      creature('octopus', '#b86bff', 690, 190, 1.5, { t: 0.5 });
      creature('fish', '#ff6f91', 110, 130, 1, { t: 1 }); creature('fish', '#ffd23f', 200, 220, 0.75, { t: 2 }); creature('fish', '#7ad7ff', 600, 80, 0.85, { flip: true, t: 3 });
      creature('crab', '#ff7043', 560, 484, 0.9, { t: 0.4 });
      creature('starfish', '#ffa53d', 250, 486, 0.8, { rot: 0.2 });
      scatter(185, [E(410, 300, 320, 150), E(380, 130, 120, 140), E(690, 190, 70, 76), E(110, 130, 50, 40)], { y1: 404, kinds: ['bubbles', 'bubbles', 'spark'], cols: ['#ffffff', '#fff6a0'] });
    },
    turtles() {
      const th = TH.turtles;
      sea(th, 191);
      reef(th, 426, 192, { size: 1.2, alpha: 0.9, step: 46, kinds: ['grass', 'grass', 'grass', 'fan'], green: '#3e9f6a' });
      sand(th, 430, 193);
      reef(th, 514, 194, { size: 1.25, step: 96, kinds: ['grass', 'anemone', 'grass'], green: '#57c27e' });
      creature('turtle', '#3fbf7f', 300, 200, 3.1, { rot: -0.1, t: 0.2 });
      creature('turtle', '#5fd3a0', 620, 300, 1.7, { rot: -0.05, t: 1.1 });
      creature('turtle', '#8fdc6a', 150, 350, 1.2, { rot: 0.08, t: 2 });
      creature('turtle', '#5fb84a', 720, 130, 1.1, { rot: -0.2, t: 3, flip: true });
      creature('jelly', '#ff9ec7', 560, 96, 1, { t: 1 });
      creature('fish', '#ffd23f', 96, 100, 0.85, { t: 1 }); creature('fish', '#ff8c2e', 470, 380, 0.75, { t: 2.2 }); creature('fish', '#ff6f91', 80, 232, 0.8, { t: 3 });
      creature('starfish', '#ff9ec7', 420, 482, 0.9, { rot: 0.4 });
      creature('crab', '#ff7043', 716, 478, 0.9, { t: 1 });
      scatter(195, [E(300, 196, 170, 110), E(620, 296, 96, 62), E(150, 348, 70, 46), E(720, 130, 66, 44), E(560, 96, 44, 50), E(96, 100, 46, 36), E(80, 232, 44, 34)], { y1: 410, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#ffffff', '#fff6a0'] });
    },
    palace() {
      const th = TH.palace;
      sea(th, 201, { hillY: 380 });
      towers(416, 420, [[-230, 60, 150], [-150, 70, 230], [-60, 76, 180], [30, 90, 300], [128, 76, 200], [212, 66, 250], [290, 56, 140]], ['#ffd6ec', '#d9d0ff', '#cff5ff', '#fff2c4'], RAINBOW);
      ctx.fillStyle = '#f6dcff'; ctx.fillRect(160, 330, 560, 100);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; for (let x = 172; x < 710; x += 44) { rrect(x, 344, 26, 30, 13); ctx.fill(); }
      ctx.fillStyle = shade('#f6dcff', -0.14); for (let x = 160; x < 720; x += 40) ctx.fillRect(x, 318, 24, 14);
      archDoor(446, 424, 84, 110, '#b46cf0');
      sand(th, 426, 203, { dark: 'rgba(150,70,130,0.18)' });
      reef(th, 508, 204, { size: 1.05, step: 82, kinds: ['branch', 'fan', 'tube', 'anemone'], skip: [[380, 520]] });
      drawIsabella(170, 210, { scale: 1.9, tilt: -0.12, wave: 1, happy: true });
      creature('fish', 'rainbow', 700, 110, 1.2, { flip: true, t: 1 });
      creature('fish', 'rainbow', 96, 80, 0.8, { t: 2 });
      creature('seahorse', '#ff8fab', 760, 300, 1.2, { flip: true });
      creature('starfish', '#ffd93d', 300, 480, 0.9, { rot: 0.2 }); creature('crab', '#ff6b8a', 620, 484, 0.85, { t: 0.5 });
      scatter(205, [E(150, 205, 170, 80), E(450, 260, 300, 200), E(700, 110, 60, 44), E(760, 300, 44, 60)], { y1: 404, kinds: ['bubbles', 'heart', 'spark'], cols: ['#ff7ab8', '#ffffff', '#fff6a0'] });
    },
    treasure() {
      const th = TH.treasure;
      sea(th, 211, { hillY: 330 });
      reef(th, 400, 212, { size: 1.1, alpha: 0.85, step: 80, kinds: ['rock', 'crystal', 'rock', 'tube'], rock: '#9a643a' });
      sand(th, 404, 213, { dark: 'rgba(60,20,0,0.25)', shell: '#ffe9c0' });
      drawChest(590, 420, 1, 0.5, 1.9);
      const R = mulberry32(214);
      coinPile(330, 488, 1.3, R); coinPile(760, 492, 1, R);
      for (const [x, y, r, ph] of [[520, 250, 14, 0.3], [600, 190, 17, 1], [676, 240, 13, 0.6], [560, 140, 12, 0.2], [650, 120, 15, 1.2], [724, 170, 11, 0.8], [470, 330, 12, 0.5], [730, 330, 13, 0.1]]) drawCoin(x, y, ph, r);
      gem(470, 470, 16, '#ff4d8d'); gem(540, 496, 13, '#4cc9f0'); gem(690, 460, 14, '#5ad17a');
      drawIsabella(250, 240, { scale: 2.7, tilt: 0.06, happy: true, item: () => drawKey(20, -6, -0.9, 0.62) });
      creature('crab', '#ff5a4f', 150, 440, 1.5, { t: 0.4 });
      creature('fish', '#7ad7ff', 110, 96, 1, { t: 1 }); creature('fish', '#ff8fd8', 420, 70, 0.8, { flip: true, t: 2 });
      creature('seahorse', '#ffffff', 772, 96, 1, { flip: true });
      scatter(215, [E(210, 240, 230, 100), E(600, 300, 170, 220), E(150, 430, 80, 56), E(110, 96, 50, 40)], { y1: 392, kinds: ['spark', 'bubbles', 'spark'], cols: ['#ffffff', '#fff6a0'] });
    },

    // ===== Hard: a whole scene, something in every piece =====
    party() {
      const th = TH.party;
      sea(th, 221, { hillY: 372 });
      bunting(46, 40, 222);
      reef(th, 424, 223, { size: 1, alpha: 0.85, step: 60, kinds: ['tube', 'fan', 'branch', 'anemone', 'brain'] });
      sand(th, 428, 224);
      const G = [['turtle', '#3fbf7f', 130, 190, 1.7, 0], ['octopus', '#b86bff', 330, 230, 1.6, 0], ['puffer', '#ffc93a', 520, 170, 1.4, 1], ['whale', '#ff8fc0', 700, 250, 1.5, 1], ['seahorse', '#1fc2ad', 240, 350, 1.3, 0], ['dolphin', '', 470, 340, 2.1, 0], ['jelly', '#6ff5ff', 640, 120, 0.9, 0], ['crab', '#ff5a4f', 150, 468, 1.3, 0], ['starfish', '#ffa53d', 420, 472, 1.1, 0], ['crab', '#ff6b8a', 700, 474, 1.1, 0], ['fish', '#3d8bff', 96, 322, 0.9, 0], ['fish', 'rainbow', 600, 394, 0.9, 1], ['fish', '#ff8c2e', 380, 120, 0.8, 0], ['fish', '#5ad17a', 770, 372, 0.75, 1]];
      G.forEach(([k, c, x, y, s, fl], i) => creature(k, c, x, y, s, { flip: !!fl, t: i * 0.7 }));
      // party hats on the big four
      [[168, 142, 0.2], [330, 152, 0], [518, 118, -0.1], [692, 196, 0.1]].forEach(([x, y, r], i) => { ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.fillStyle = RAINBOW[(i * 2 + 1) % 7]; ctx.beginPath(); ctx.moveTo(-17, 8); ctx.lineTo(0, -34); ctx.lineTo(17, 8); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#ffffff'; circle(0, -34, 6); ctx.fillRect(-17, 2, 34, 6); ctx.restore(); });
      scatter(225, G.map(([, , x, y, s]) => E(x, y, 48 * s, 40 * s)), { y0: 80, y1: 412, kinds: ['star', 'bubbles', 'heart', 'spark'], cols: RAINBOW, cell: 92, pad: 6 });
    },
    crystal() {
      const th = TH.crystal;
      sea(th, 231, { surface: false, hillY: 380 });
      // the roof of the cave, with crystals hanging from it
      ctx.fillStyle = '#27407c'; ctx.beginPath(); ctx.moveTo(-10, -4);
      for (let x = -10; x <= PW + 20; x += 20) ctx.lineTo(x, 34 + 16 * Math.sin(x / 70) + 10 * Math.sin(x / 23));
      ctx.lineTo(PW + 20, -4); ctx.closePath(); ctx.fill();
      const R = mulberry32(232), cols = ['#c2f0ff', '#e0d4ff', '#ffffff', '#ffb8e8', '#9ad8ff'];
      for (let x = 50; x < PW; x += 104) crystals(x + (R() - 0.5) * 30, 36, R, cols, 0.8 + R() * 0.5, true);
      for (let x = 30; x < PW; x += 92) crystals(x + (R() - 0.5) * 30, 432, R, cols, 0.9 + R() * 0.7);
      sand(th, 428, 233, { dark: 'rgba(40,70,150,0.2)', shell: '#ffffff' });
      for (let x = 90; x < PW; x += 150) crystals(x + (R() - 0.5) * 40, 516, R, cols, 0.7);
      drawIsabella(300, 230, { scale: 2.2, tilt: -0.06, happy: true });
      creature('seahorse', '#ffb8e8', 600, 250, 2.2, { flip: true });
      gem(470, 180, 22, '#ff4d8d'); gem(700, 150, 17, '#5ad17a'); gem(110, 320, 18, '#ffd23f'); gem(520, 360, 15, '#4cc9f0'); gem(760, 340, 16, '#c86bfa'); gem(96, 150, 14, '#4cc9f0');
      creature('fish', '#ffffff', 420, 330, 0.8, { t: 1 }); creature('fish', '#b9a7ff', 150, 232, 0.7, { t: 2, flip: true }); creature('fish', '#ffd166', 710, 400, 0.7, { flip: true, t: 3 });
      scatter(235, [E(270, 228, 200, 86), E(600, 250, 80, 110), E(470, 180, 30, 30), E(700, 150, 26, 26), E(110, 320, 26, 26)], { y0: 90, y1: 400, kinds: ['spark', 'bubbles', 'spark'], cols: ['#ffffff', '#e0d4ff', '#c2f0ff'], cell: 96 });
    },
    ice() {
      const th = TH.ice;
      sea(th, 241, { surface: false, hillY: 390 });
      // ice floating on the surface, seen from below
      const R = mulberry32(242);
      for (let x = -20; x < PW; x += 130) {
        const w = 96 + R() * 60, d = 34 + R() * 40, x0 = x + R() * 30;
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(x0, -4); ctx.lineTo(x0 + w, -4); ctx.lineTo(x0 + w * 0.86, d * 0.6); ctx.lineTo(x0 + w * 0.55, d); ctx.lineTo(x0 + w * 0.2, d * 0.7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(120,180,235,0.5)'; ctx.beginPath(); ctx.moveTo(x0 + w * 0.55, d); ctx.lineTo(x0 + w * 0.86, d * 0.6); ctx.lineTo(x0 + w, -4); ctx.lineTo(x0 + w * 0.6, -4); ctx.closePath(); ctx.fill();
      }
      towers(600, 424, [[-110, 56, 150], [-40, 66, 230], [40, 60, 180], [110, 50, 120]], ['#ffffff', '#e3f6ff', '#cfe9ff', '#eef4ff'], ['#9ad0ff', '#c8b8ff', '#7fc4f0'], { win: '#5a90d0', pole: '#7a9ac0' });
      archDoor(602, 428, 60, 80, '#7fb0e8');
      reef(th, 430, 243, { size: 1, alpha: 0.95, step: 88, kinds: ['crystal', 'rock', 'crystal'], rock: '#cfe6f7', skip: [[470, 730]] });
      sand(th, 432, 244, { dark: 'rgba(60,110,180,0.2)', shell: '#d6c8ff' });
      creature('whale', '#9fc8f0', 250, 190, 3, { t: 0.4 });
      creature('dolphin', '', 330, 356, 2.6, { rot: -0.08, t: 0.2 });
      creature('fish', '#7fc4f0', 96, 330, 0.85, { t: 1 }); creature('fish', '#d6c8ff', 500, 110, 0.8, { flip: true, t: 2 }); creature('fish', '#ff9ec7', 770, 300, 0.75, { flip: true, t: 3 });
      creature('starfish', '#ff9ec7', 150, 478, 0.95, { rot: 0.2 }); creature('crab', '#ff8fa8', 420, 482, 0.9, { t: 0.5 });
      creature('jelly', '#d6c8ff', 730, 110, 0.8, { t: 1 }); creature('fish', '#ff9ec7', 150, 84, 0.8, { t: 2.4 });
      scatter(245, [E(150, 84, 44, 34), E(240, 180, 180, 96), E(330, 352, 110, 60), E(600, 300, 150, 190), E(730, 110, 40, 46), E(500, 110, 44, 34)], { y0: 60, y1: 410, kinds: ['snow', 'bubbles', 'spark'], cols: ['#ffffff', '#3f8fd8', '#7a6fe0'], cell: 92 });
    },
    sunset() {
      const th = TH.sunset;
      sea(th, 251, { hillY: 360 });
      // the setting sun, big and low, through the water
      glow(200, 60, 300, 'rgba(255,220,140,0.7)', 1);
      ctx.fillStyle = 'rgba(255,236,170,0.92)'; circle(200, 66, 56);
      ctx.strokeStyle = 'rgba(255,190,110,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(200, 66, 40, 0, TAU); ctx.stroke();
      creature('fish', '#ff8c2e', 196, 64, 0.62, { t: 1.2, plain: true });
      const R = mulberry32(252);
      for (const [x, s] of [[100, 1.2], [300, 0.9], [520, 1.35], [720, 1]]) vent(x, 436, s, R);
      reef(th, 430, 253, { size: 1, alpha: 0.95, step: 104, kinds: ['rock', 'tube', 'rock', 'branch'], rock: '#5b3d3d', skip: [[60, 140], [270, 330], [480, 560], [690, 750]] });
      sand(th, 434, 254, { dark: 'rgba(0,0,0,0.3)', shell: '#ffb88a' });
      creature('puffer', '#ffc93a', 400, 200, 2.3, { t: 0.5 });
      creature('crab', '#ff5a4f', 620, 380, 1.9, { t: 0.4 });
      creature('fish', '#ffd23f', 640, 110, 1.1, { flip: true, t: 1 }); creature('fish', '#ff8c2e', 750, 200, 0.9, { flip: true, t: 2 }); creature('fish', '#ffe066', 200, 250, 0.9, { t: 3 }); creature('fish', '#ff6f91', 96, 350, 0.75, { t: 1.5 });
      creature('octopus', '#ff8f6b', 216, 380, 1.3, { t: 0.2 });
      creature('starfish', '#ffd166', 400, 478, 1, { rot: 0.2 }); creature('starfish', '#ff7b3a', 760, 480, 0.8, { rot: -0.3 });
      creature('seahorse', '#ffe066', 800, 96, 0.9, { flip: true }); creature('fish', '#ff6f91', 330, 66, 0.85, { t: 2.2 }); creature('jelly', '#ffd166', 520, 70, 0.7, { t: 1 });
      scatter(255, [E(330, 66, 46, 36), E(520, 70, 34, 40), E(400, 200, 100, 90), E(620, 372, 96, 62), E(216, 380, 64, 70), E(200, 66, 70, 66), E(640, 110, 56, 40)], { y0: 60, y1: 410, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#ffe9a8', '#ffffff'], cell: 92 });
    },
    moon() {
      const th = TH.moon;
      sea(th, 261, { surface: false, hillY: 380 });
      moon(160, 96, 62);
      // the stars, seen up through the water
      const R = mulberry32(262);
      for (let i = 0; i < 16; i++) sparkle(260 + R() * 560, 20 + R() * 90, 4 + R() * 6, '#fff6c0');
      reef(th, 440, 263, { size: 1.05, step: 70, kinds: ['glow', 'anemone', 'glow', 'tube'] });
      sand(th, 444, 264, { dark: 'rgba(10,0,40,0.3)', shell: '#c8b6ff' });
      // Isabella asleep in a big open shell
      ctx.fillStyle = '#c9a7ff'; ctx.beginPath(); ctx.moveTo(280, 380); ctx.quadraticCurveTo(290, 220, 470, 210); ctx.quadraticCurveTo(650, 220, 660, 380); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 4; for (let k = -4; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(470, 380); ctx.lineTo(470 + k * 42, 232 + Math.abs(k) * 14); ctx.stroke(); }
      ctx.fillStyle = '#e9dcff'; oval(470, 384, 196, 40);
      drawIsabella(460, 356, { scale: 2.3, tilt: 0.04, sleep: true });
      ctx.fillStyle = '#a983f0'; ctx.beginPath(); ctx.ellipse(470, 388, 204, 56, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; for (let k = -6; k <= 6; k++) circle(470 + k * 30, 396, 6);
      // little sleepy zigzags drifting up from her
      ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [x, y, s] of [[590, 250, 13], [622, 212, 9.5], [646, 184, 7]]) { ctx.lineWidth = s * 0.34; ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.lineTo(x + s, y + s); ctx.stroke(); }
      creature('jelly', '#7afcff', 720, 290, 1.2, { t: 1 }); creature('jelly', '#ff9ef0', 110, 300, 1, { t: 2 });
      creature('angler', '#8f86ff', 700, 130, 1.1, { flip: true, t: 0.4 });
      creature('starfish', '#ffe066', 180, 480, 0.95, { rot: 0.2 }); creature('crab', '#ff7ac8', 730, 482, 0.9, { blink: true });
      creature('fish', '#c8b6ff', 380, 150, 0.8, { blink: true, t: 1 }); creature('seahorse', '#7afcff', 230, 220, 1.1, { blink: true }); creature('jelly', '#ff9ef0', 486, 62, 0.75, { t: 2.2 }); creature('fish', '#7afcff', 330, 60, 0.6, { blink: true, t: 2 });
      scatter(265, [E(470, 320, 220, 130), E(160, 96, 96, 90), E(720, 290, 50, 60), E(110, 300, 44, 54), E(700, 130, 60, 60), E(230, 220, 40, 60), E(486, 62, 34, 40)], { y0: 110, y1: 424, kinds: ['glow', 'bubbles', 'spark'], cols: ['rgba(200,170,255,0.8)', 'rgba(130,250,255,0.7)', '#fff6c0'], cell: 92 });
    },
    kelp() {
      const th = TH.kelp;
      sea(th, 271, { hillY: 400 });
      const R = mulberry32(272);
      for (let i = 0; i < 9; i++) kelp(30 + i * 96 + R() * 30, 446, 300 + R() * 170, R() * 6, i % 2 ? '#2f8f5a' : '#3fae6a', 9);
      sand(th, 440, 273);
      creature('turtle', '#5fb84a', 220, 150, 1.9, { rot: -0.1, t: 0.2 });
      creature('turtle', '#3fbf7f', 610, 330, 1.6, { flip: true, rot: 0.08, t: 1.2 });
      creature('seahorse', '#ff9e3d', 440, 230, 1.7, { t: 0.4 });
      creature('seahorse', '#ff8fab', 740, 150, 1.3, { flip: true, t: 1.4 });
      creature('fish', '#ffd23f', 110, 320, 1, { t: 1 }); creature('fish', '#ff8c2e', 330, 360, 0.9, { t: 2 }); creature('fish', '#ff6f91', 560, 100, 0.9, { flip: true, t: 3 }); creature('fish', '#7ad7ff', 400, 60, 0.75, { t: 1.6 }); creature('fish', '#ffd23f', 770, 400, 0.7, { flip: true, t: 2.6 });
      creature('crab', '#ff7043', 150, 480, 1, { t: 0.5 }); creature('starfish', '#ffd166', 430, 484, 0.9, { rot: 0.2 }); creature('octopus', '#b86bff', 716, 470, 0.9, { t: 0.4 });
      for (let i = 0; i < 6; i++) kelp(80 + i * 140 + R() * 40, 530, 150 + R() * 90, R() * 6, '#57c27e', 8);
      scatter(275, [E(220, 150, 100, 66), E(610, 330, 90, 60), E(440, 230, 60, 90), E(740, 150, 50, 70)], { y0: 40, y1: 420, kinds: ['bubbles', 'spark', 'bubbles'], cols: ['#fff6a0', '#ffffff'], cell: 96 });
    },
    pearls() {
      const th = TH.pearls;
      sea(th, 281, { hillY: 350 });
      reef(th, 396, 282, { size: 0.95, alpha: 0.85, step: 70, kinds: ['branch', 'fan', 'tube', 'branch'] });
      sand(th, 400, 283, { dark: 'rgba(150,110,60,0.18)', shell: '#ffd1e8' });
      const C = [[96, 440, 1.2, '#ffb8d6'], [250, 486, 1, '#d9b8e8'], [400, 446, 1.35, '#ffd1a8'], [560, 490, 1, '#b8e0ff'], [700, 448, 1.2, '#ffb8d6'], [800, 500, 0.8, '#d9b8e8']];
      for (const [x, y, s, c] of C) clam(x, y, s, c);
      // strings of pearls looping from the top
      const R = mulberry32(284);
      for (const [x0, x1, sag] of [[-10, 300, 90], [240, 560, 70], [520, 842, 100]]) for (let i = 0; i <= 14; i++) { const u = i / 14; drawPearl(x0 + (x1 - x0) * u, 30 + Math.sin(u * Math.PI) * sag, 8 + (i % 3) * 1.5); }
      creature('dolphin', '', 300, 230, 3.2, { rot: -0.12, t: 0.2 });
      creature('seahorse', '#ff8fd8', 620, 250, 1.8, { flip: true });
      creature('starfish', '#ff9ec7', 166, 500, 0.8, { rot: 0.2 }); creature('starfish', '#ffe9a8', 480, 500, 0.75, { rot: -0.3 }); creature('crab', '#ff8fa8', 640, 500, 0.8, { t: 0.4 });
      creature('fish', '#c9a7ff', 110, 250, 0.9, { t: 1 }); creature('fish', '#ffd1e8', 500, 330, 0.8, { flip: true, t: 2 }); creature('fish', '#ffe9a8', 760, 170, 0.85, { flip: true, t: 3 }); creature('jelly', '#ffd1e8', 470, 150, 0.8, { t: 1 }); creature('fish', '#ffffff', 740, 350, 0.7, { flip: true, t: 0.6 });
      for (let i = 0; i < 9; i++) drawPearl(60 + i * 90 + R() * 30, 300 + R() * 80, 5 + R() * 4);
      scatter(285, [E(300, 226, 140, 76), E(620, 250, 66, 90), E(110, 250, 46, 36), E(470, 150, 40, 46)], { y0: 100, y1: 384, kinds: ['bubbles', 'spark', 'heart'], cols: ['#ffffff', '#ff9ec7', '#ffe9a8'], cell: 92 });
    },
    bigchest() {
      const th = TH.bigchest;
      sea(th, 291, { hillY: 340 });
      reef(th, 410, 292, { size: 1, alpha: 0.85, step: 66, kinds: ['kelp', 'rock', 'grass', 'branch'], green: '#4a7f5a', rock: '#56656a', skip: [[250, 590]] });
      sand(th, 414, 293, { dark: 'rgba(20,30,30,0.25)' });
      drawChest(420, 420, 1, 0.3, 2.9);
      const R = mulberry32(294);
      // a fountain of coins out of the chest, right across the top of the picture
      for (let i = 0; i < 46; i++) { const a = -Math.PI / 2 + (R() - 0.5) * 2.5, d = 70 + R() * 330; drawCoin(420 + Math.cos(a) * d * 1.15, 300 + Math.sin(a) * d * 0.8, R() * 3, 9 + R() * 9); }
      gem(250, 110, 20, '#ff4d8d'); gem(596, 96, 18, '#4cc9f0'); gem(420, 60, 22, '#5ad17a'); gem(700, 250, 16, '#c86bfa'); gem(130, 250, 16, '#ffd23f'); gem(330, 470, 15, '#4cc9f0'); gem(540, 482, 14, '#ff4d8d');
      coinPile(180, 492, 1.1, R); coinPile(680, 494, 1.2, R);
      drawKey(130, 380, 0.4, 1.4);
      creature('crab', '#ff5a4f', 720, 400, 1.4, { t: 0.4 });
      creature('octopus', '#b86bff', 766, 276, 1.15, { t: 0.5 });
      creature('turtle', '#3fbf7f', 720, 140, 1.4, { flip: true, t: 0.2 });
      creature('fish', '#ffd23f', 250, 330, 0.9, { t: 1 }); creature('fish', '#ff8c2e', 600, 330, 0.8, { flip: true, t: 2 }); creature('seahorse', '#ff9e3d', 60, 300, 0.9, {});
      creature('starfish', '#ffe066', 440, 496, 0.8, { rot: 0.2 });
      scatter(295, [E(420, 330, 150, 130), E(720, 392, 72, 50), E(766, 276, 60, 62), E(720, 140, 76, 50)], { y0: 20, y1: 400, kinds: ['spark', 'bubbles', 'spark'], cols: ['#fff6a0', '#ffffff'], cell: 110, pad: 0 });
    },
    castle() {
      const th = TH.castle;
      sea(th, 301, { hillY: 380 });
      // a rainbow over the castle
      ctx.save(); ctx.globalAlpha = 0.6; ctx.lineWidth = 9;
      RAINBOW.forEach((c, i) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(560, 330, 330 - i * 9, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); });
      ctx.restore();
      towers(520, 424, [[-200, 60, 190], [-126, 74, 260], [-40, 60, 170], [40, 96, 330], [136, 66, 220], [208, 58, 160]], ['#e8d6ff', '#d3bdf7', '#f4e6ff', '#fff2c4'], ['#ffd23f', '#ff8fd8', '#ffd23f', '#ffffff'], { win: '#7a3fc0' });
      ctx.fillStyle = '#ead6ff'; ctx.fillRect(300, 340, 450, 96);
      ctx.fillStyle = shade('#ead6ff', -0.16); for (let x = 300; x < 750; x += 38) ctx.fillRect(x, 326, 22, 16);
      ctx.fillStyle = 'rgba(122,63,192,0.5)'; for (let x = 318; x < 740; x += 60) { rrect(x, 356, 24, 30, 12); ctx.fill(); }
      archDoor(560, 430, 78, 100, '#7a3fc0');
      const R = mulberry32(302);
      reef(th, 432, 303, { size: 1, alpha: 0.95, step: 80, kinds: ['branch', 'tube', 'fan'], skip: [[300, 760]] });
      sand(th, 430, 304, { dark: 'rgba(150,90,0,0.2)' });
      coinPile(120, 492, 1.1, R); coinPile(780, 496, 0.9, R);
      drawIsabella(200, 220, { scale: 2.2, tilt: -0.1, wave: 1.1, happy: true, crown: true });
      creature('seahorse', '#ffd23f', 96, 380, 1.3, {});
      creature('fish', '#ff8fd8', 330, 96, 1, { t: 1 }); creature('fish', '#ffffff', 80, 100, 0.8, { t: 2 }); creature('seahorse', '#ff8fd8', 186, 70, 0.75, { t: 1 }); creature('fish', '#ffd23f', 790, 250, 0.8, { flip: true, t: 3 }); creature('dolphin', '', 250, 400, 1.6, { rot: -0.1 });
      creature('starfish', '#ff8fd8', 250, 486, 0.9, { rot: 0.2 }); creature('crab', '#ff5a4f', 440, 488, 0.9, { t: 0.4 }); creature('jelly', '#ffffff', 790, 96, 0.8, { t: 1 });
      scatter(305, [E(190, 215, 190, 90), E(540, 250, 250, 220), E(96, 380, 50, 70), E(250, 400, 80, 44), E(330, 96, 50, 40)], { y0: 30, y1: 414, kinds: ['spark', 'bubbles', 'heart', 'coin'], cols: ['#ffd23f', '#ffffff', '#ff8fd8'], cell: 92 });
    },
    everyone() {
      const th = TH.everyone;
      sea(th, 311, { hillY: 372 });
      // a big rainbow behind everyone
      ctx.save(); ctx.globalAlpha = 0.7; ctx.lineWidth = 15;
      RAINBOW.forEach((c, i) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(416, 400, 392 - i * 15, Math.PI * 1.02, Math.PI * 1.98); ctx.stroke(); });
      ctx.restore();
      reef(th, 424, 312, { size: 1, alpha: 0.9, step: 58, kinds: ['tube', 'branch', 'anemone', 'fan', 'brain'] });
      sand(th, 428, 313);
      drawChest(730, 448, 1, 0.4, 0.95, false);
      const G = [['whale', '#4f8ff0', 150, 110, 1.6, 0], ['dolphin', '', 660, 96, 2.3, 1], ['turtle', '#3fbf7f', 120, 290, 1.6, 0], ['octopus', '#b86bff', 700, 290, 1.5, 0], ['seahorse', '#ff9e3d', 290, 360, 1.3, 0], ['puffer', '#ffc93a', 560, 370, 1.2, 1], ['jelly', '#ff7ac8', 420, 76, 1, 0], ['crab', '#ff5a4f', 180, 470, 1.25, 0], ['starfish', '#ffa53d', 420, 474, 1.1, 0], ['fish', '#ff8c2e', 300, 150, 0.9, 0], ['fish', 'rainbow', 540, 160, 0.9, 1], ['fish', '#3d8bff', 60, 400, 0.75, 0], ['fish', '#5ad17a', 790, 190, 0.75, 1], ['starfish', '#ff6f91', 590, 482, 0.8, 0], ['angler', '#8f86ff', 430, 390, 0.85, 0]];
      G.forEach(([k, c, x, y, s, fl], i) => creature(k, c, x, y, s, { flip: !!fl, t: 0.3 + i * 0.6 }));
      drawIsabella(410, 250, { scale: 2.3, tilt: -0.06, wave: 1.2, happy: true, crown: true });
      heart(388, 152, 13, '#ff4d8d'); sparkle(352, 176, 9, '#ffffff'); heart(300, 250, 9, '#ff8fb8');
      scatter(315, G.map(([, , x, y, s]) => E(x, y, 46 * s, 38 * s)).concat([E(370, 250, 200, 90), E(730, 430, 70, 60)]), { y0: 20, y1: 412, kinds: ['heart', 'bubbles', 'star', 'spark'], cols: RAINBOW, cell: 88, pad: 4 });
    },
  };
  const IDS = Object.keys(PICS);

  // paint picture `id` onto g, filling a w x h rectangle at (0, 0) of g's current coordinates
  function paint(id, g, w, h) {
    const f = PICS[id];
    if (!f) throw new Error('no picture ' + id);
    withCtx(g, () => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.scale(w / PW, h / PH);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([]); ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
      f();
      ctx.restore();
    });
  }
  // the pieces the game itself needs, drawn onto g at g's current transform
  const use = (g, fn) => withCtx(g, fn);

  const api = { PW, PH, IDS, RAINBOW, paint, use,
    creature, drawIsabella, drawCoin, drawKey, drawChest, drawPearl, gem, heart, sparkle, star, rrect, glow, bubble };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JigsawPictures = api;
})(typeof self !== 'undefined' ? self : this);
