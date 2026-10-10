/* The Fairy world: everything shared that you see. All art is drawn in code.
 * window.FairyArt: Isabella the Fairy (the mermaid's twin), the skies, clouds, rainbows, trees, flowers,
 * coins, keys, chests and the friendly (and grumpy) creatures. Six games draw through this one file so
 * they look like one world (docs/FAIRY.md).
 *
 * House rules: every draw function takes a ctx ALREADY transformed to the game's world (540 units tall,
 * the game decides the width), draws at (x, y) in world units and leaves ctx state as it found it.
 * No canvases, no animation loops, no shadows or blur filters, no Math.random: variety comes from a
 * hash of the inputs and motion from the `time` (seconds) you pass in.
 *
 * Where (x, y) is on each thing:
 *   drawFairy  fly/hover/fall: her waist.  stand: the ground under her feet.  sit/slide: the surface she
 *              sits on.  (FairyArt.FOOT is how far below her waist the soles are, at scale 1.)
 *   tree, mushroom, flower, grass, critter: the ground line.   cloud: its left end, on its flat base.
 *   waterfall: x = centre, y = top.   chest: the middle of its base.   bug, butterfly, firefly, coin,
 *   key, hand: their centre (the hand: its fingertip).   lily pad: its centre on the water.
 * Bugs and critters face LEFT (towards the fairy); a negative scale flips them. */
(function () {
  'use strict';
  const TAU = Math.PI * 2, H = 540;
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const PAL = {
    skin: '#f7cdb0', hair: '#6b3a1f', hairHi: '#9a5f38',
    wing: ['rgba(255,77,109,0.62)', 'rgba(255,159,67,0.62)', 'rgba(255,217,61,0.62)', 'rgba(90,209,122,0.62)', 'rgba(76,201,240,0.62)', 'rgba(108,99,255,0.62)', 'rgba(200,107,250,0.62)'],
    leaf: '#4fbf6a', leafDark: '#2f8f55', leafLight: '#8be08a', trunk: '#8b5a2b', trunkDark: '#6b4220', trunkLight: '#b07a43',
    skyTop: '#6ec8ff', skyBot: '#d6f3ff', sky: '#8fd8ff', cloud: '#ffffff', cloudShade: '#cfe6ff',
    pink: '#ff7ab8', purple: '#c86bfa', ink: '#2a170a',
    gold1: '#fff6b0', gold2: '#ffd633', gold3: '#e8a200', goldDark: '#a86a00', chest: '#ffcc33',
  };
  // Eight scene palettes: 0-3 the Meadow (World 1), 4-7 the Cloud Tops (World 2).
  const THEMES = [
    { name: 'Dawn meadow', top: '#f7a9d0', mid: '#ffcfd8', bot: '#fff0cf', far: 'rgba(176,120,190,0.55)', farKind: 'hills', ground: ['#a4e48f', '#5fb872'], sun: '#fff1b0', sunY: 0.62, cloud: ['#fff7fb', '#f6c9df'], flower: ['#ff8fc0', '#ffd1e6', '#ffffff', '#ffb35c'], night: false },
    { name: 'Bluebell wood', top: '#8ccdf2', mid: '#bde8ea', bot: '#e3f6df', far: 'rgba(40,130,110,0.6)', farKind: 'trees', ground: ['#7fd586', '#3f9f6a'], sun: '#fff7c0', sunY: 0.2, cloud: ['#ffffff', '#cfe3f6'], flower: ['#6c63ff', '#8d84ff', '#c86bfa', '#ffffff'], night: false },
    { name: 'Waterfall glade', top: '#a9e8d6', mid: '#d2f4dc', bot: '#f0fbd8', far: 'rgba(50,150,110,0.6)', farKind: 'trees', ground: ['#92e68e', '#46b26b'], sun: '#fffbc4', sunY: 0.16, cloud: ['#ffffff', '#d3f0e6'], flower: ['#ffffff', '#ff8fc0', '#ffd633', '#4cc9f0'], night: false, glade: true },
    { name: 'Sunny meadow', top: '#5ec2ff', mid: '#9ddcff', bot: '#e0f6ff', far: 'rgba(90,190,110,0.6)', farKind: 'hills', ground: ['#aeea6c', '#5fc157'], sun: '#fff6a0', sunY: 0.17, cloud: ['#ffffff', '#cde6fb'], flower: ['#ffd633', '#ff4d6d', '#ffffff', '#ff9f43'], night: false },
    { name: 'Blue sky', top: '#3fa9ff', mid: '#82cdff', bot: '#cdeeff', far: 'rgba(255,255,255,0.6)', farKind: 'clouds', ground: ['#ffffff', '#cfe6ff'], sun: '#fff6a0', sunY: 0.16, cloud: ['#ffffff', '#cde4fb'], flower: ['#ff8fc0', '#ffd633', '#ffffff', '#4cc9f0'], night: false },
    { name: 'Sunset gold', top: '#e86aa2', mid: '#ff9f6e', bot: '#ffe08a', far: 'rgba(255,170,120,0.7)', farKind: 'clouds', ground: ['#fff0d0', '#ffc898'], sun: '#fff3b0', sunY: 0.56, cloud: ['#fff2d6', '#ffb88a'], flower: ['#ffd633', '#ff8fc0', '#ff9f43', '#ffffff'], night: false },
    { name: 'Moonlit night', top: '#141a4f', mid: '#2f3482', bot: '#6b62b8', far: 'rgba(90,100,185,0.7)', farKind: 'clouds', ground: ['#cfd8ff', '#8e9ae0'], sun: '#fff8d6', sunY: 0.2, cloud: ['#c9d3ff', '#7f8ad4'], flower: ['#fff8d6', '#9ad8ff', '#d6c8ff', '#ffd633'], night: true },
    { name: 'Rainbow sky', top: '#74d3ff', mid: '#c9e6ff', bot: '#ffe6f6', far: 'rgba(255,190,225,0.6)', farKind: 'clouds', ground: ['#ffffff', '#e0d4ff'], sun: '#fff9c4', sunY: 0.15, cloud: ['#ffffff', '#f1d9ff'], flower: ['#ff4d6d', '#ffd93d', '#4cc9f0', '#c86bfa'], night: false, rainbow: true },
  ];

  // ---------- small helpers (no state, no randomness) ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function hash(a, b, c) {
    let h = (Math.imul((a * 1000) | 0, 374761393) + Math.imul((b * 1000) | 0, 668265263) + Math.imul(((c || 0) * 1000) | 0, 1103515245)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rgb(c) {
    if (c.charAt(0) !== '#') { const m = c.match(/\d+/g); return [+m[0], +m[1], +m[2]]; }
    const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) { const A = rgb(a), B = rgb(b); return 'rgb(' + ((A[0] + (B[0] - A[0]) * t) | 0) + ',' + ((A[1] + (B[1] - A[1]) * t) | 0) + ',' + ((A[2] + (B[2] - A[2]) * t) | 0) + ')'; }
  function rgba(c, a) { const A = rgb(c); return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')'; }
  function star(ctx, x, y, r1, r2, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath();
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function heartPath(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.9);
    ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.7, y - r * 1.3, x, y - r * 0.45);
    ctx.bezierCurveTo(x + r * 0.7, y - r * 1.3, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
    ctx.closePath();
  }
  // a soft glow with no sprite and no blur: a radial gradient painted additively
  function glow(ctx, x, y, r, color, a) {
    if (a <= 0.003 || r <= 0.5) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // a 4-point twinkle
  function sparkle(ctx, x, y, r) { star(ctx, x, y, r, r * 0.26, 4, 0); ctx.fill(); }
  function themeOf(t) { return typeof t === 'number' ? THEMES[((t % THEMES.length) + THEMES.length) % THEMES.length] : (t || THEMES[0]); }

  // a cartoon cross face: two eyes, brows leaning in, a small frown, rosy cheeks. (x, y) = between the eyes.
  function grumpyFace(ctx, x, y, s, time, o) {
    o = o || {};
    const lk = o.look == null ? -0.9 : o.look, sep = (o.sep || 6) * s, er = (o.eye || 3.4) * s, blink = (time % 4.1) < 0.1;
    ctx.save(); ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(255,110,140,0.4)';
    ctx.beginPath(); ctx.arc(x - sep * 1.55, y + er * 1.5, er * 0.8, 0, TAU); ctx.arc(x + sep * 1.55, y + er * 1.5, er * 0.8, 0, TAU); ctx.fill();
    for (const k of [-1, 1]) {
      const ex = x + k * sep;
      if (blink) { ctx.strokeStyle = '#2a170a'; ctx.lineWidth = 1.3 * s; ctx.beginPath(); ctx.moveTo(ex - er * 0.8, y); ctx.lineTo(ex + er * 0.8, y); ctx.stroke(); }
      else {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, y, er, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a170a'; ctx.beginPath(); ctx.arc(ex + lk * s * 0.7, y + er * 0.12, er * 0.58, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + lk * s * 0.7 + er * 0.2, y - er * 0.18, er * 0.2, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 1.7 * s;
      ctx.beginPath(); ctx.moveTo(ex + k * er * 1.15, y - er * 1.75); ctx.lineTo(ex - k * er * 0.9, y - er * 0.95); ctx.stroke();
    }
    ctx.strokeStyle = '#a8324f'; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.arc(x, y + er * 4.3, er * 1.35, 1.2 * Math.PI, 1.8 * Math.PI); ctx.stroke();
    ctx.restore();
  }
  function happyDots(ctx, x, y, s) { // small friendly eyes for the butterfly and firefly
    ctx.fillStyle = '#2a170a'; ctx.beginPath(); ctx.arc(x - 1.6 * s, y, 0.9 * s, 0, TAU); ctx.arc(x + 1.6 * s, y, 0.9 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a170a'; ctx.lineWidth = 0.7 * s; ctx.beginPath(); ctx.arc(x, y + 0.6 * s, 1.5 * s, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  }

  // ---------- wings ----------
  // One wing, drawn from its root at (0,0) out along +x, rainbow-tinted and see-through.
  function wing(ctx, L, W, alpha) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(L * 0.08, -W * 1.05, L * 0.8, -W * 1.35, L, -W * 0.15);
    ctx.bezierCurveTo(L * 1.02, W * 0.55, L * 0.5, W * 0.7, 0, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.38 * alpha) + ')'; ctx.fill();
    const g = ctx.createLinearGradient(0, 0, L, 0);
    for (let i = 0; i < 7; i++) g.addColorStop(i / 6, PAL.wing[i]);
    ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(L * 0.1, -W * 0.05); ctx.lineTo(L * 0.86, -W * 0.38);
    ctx.moveTo(L * 0.12, 0); ctx.lineTo(L * 0.72, -W * 0.85);
    ctx.moveTo(L * 0.12, 0); ctx.lineTo(L * 0.8, W * 0.32); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(L * 0.62, -W * 0.5, L * 0.07, W * 0.14, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // Two pairs of wings (a near and a far pair, an upper and a lower in each), rooted at the origin and
  // streaming back (-x). o: { freq=10 (beats per second * 2pi), amp=0.45, spread=1, alpha=1, scale=1 }
  function drawWings(ctx, time, o) {
    o = o || {};
    const freq = o.freq == null ? 10 : o.freq, amp = o.amp == null ? 0.45 : o.amp, sp = o.spread == null ? 1 : o.spread;
    const al = o.alpha == null ? 1 : o.alpha, sc = o.scale == null ? 1 : o.scale;
    const ph = Math.sin(time * freq), ph2 = Math.sin(time * freq - 0.55);
    ctx.save(); ctx.scale(sc, sc);
    // far pair first (higher, a little smaller, fainter) so the near pair reads in front
    const pairs = [
      { up: -1.78 - 0.1 * sp, lo: 2.2, ph: ph2, k: 0.86, a: 0.62 },
      { up: -2.3, lo: 2.62, ph: ph, k: 1, a: 1 },
    ];
    for (const p of pairs) {
      const flap = p.ph * amp, squash = 0.82 + 0.18 * Math.abs(p.ph);
      ctx.save(); ctx.rotate(p.up + flap * 0.9); ctx.scale(p.k * squash, p.k); wing(ctx, 50, 21, al * p.a); ctx.restore();
      ctx.save(); ctx.rotate(p.lo - flap * 0.55); ctx.scale(p.k * (0.9 + 0.1 * squash), -p.k); wing(ctx, 35, 16, al * p.a); ctx.restore();
    }
    ctx.restore();
  }

  // ---------- Isabella the Fairy ----------
  const STAND_FOOT = 26, SIT_SEAT = 14;
  // body frame: waist at (0,0), +x forward, +y down. legs: [far, near], each { kx, ky, fx, fy } knee and ankle.
  const POSES = {
    fly: (t) => ({ dy: 0, bob: Math.sin(t * 5.3) * 1.6, lean: 0.95, headRot: -0.5, hairAng: Math.PI - 0.12, hairLen: 46, wing: { freq: 26, amp: 0.55 }, wrot: -0.45,
      armF: { x: 19, y: -28, b: 3 }, armB: { x: -14, y: -13, b: 4 }, wa: -1.35,
      legs: [{ kx: -3, ky: 19, fx: -10, fy: 24 }, { kx: 2, ky: 19, fx: -4 + Math.sin(t * 5) * 2, fy: 26 }], toe: 'point', lift: 0.1, sway: -4, dir: [-1, 0.3] }),
    hover: (t) => ({ dy: 0, bob: Math.sin(t * 2.2) * 3, lean: 0.1, headRot: -0.04, hairAng: Math.PI / 2 + 0.55, hairLen: 36, wing: { freq: 11, amp: 0.4 }, wrot: 0,
      armF: { x: 17, y: -19, b: 3 }, armB: { x: -13, y: -7, b: 3 }, wa: -1.0,
      legs: [{ kx: -3, ky: 19, fx: -5 + Math.sin(t * 2.2) * 2, fy: 25 }, { kx: 2.5, ky: 19, fx: 5 - Math.sin(t * 2.2) * 2, fy: 25 }], toe: 'flat', lift: 0.15, sway: -1, dir: [-0.25, 1] }),
    stand: (t) => ({ dy: -STAND_FOOT, bob: 0, lean: 0, headRot: 0, hairAng: Math.PI / 2 + 0.4, hairLen: 34, wing: { freq: 3.2, amp: 0.16 }, wrot: 0,
      armF: { x: 15, y: -17, b: 3 }, armB: { x: -7, y: 3, b: 2 }, wa: -1.05,
      legs: [{ kx: -3, ky: 19, fx: -4, fy: 24 }, { kx: 3, ky: 19, fx: 5, fy: 24 }], toe: 'flat', lift: 0, sway: 0, dir: [-0.2, 1] }),
    sit: (t) => ({ dy: -SIT_SEAT, bob: 0, lean: 0, headRot: 0, hairAng: Math.PI / 2 + 0.35, hairLen: 32, wing: { freq: 3.2, amp: 0.16 }, wrot: 0,
      armF: { x: 15, y: -16, b: 3 }, armB: { x: -9, y: 5, b: 2 }, wa: -1.05,
      legs: [{ kx: 14, ky: 11, fx: 25, fy: 10 }, { kx: 15, ky: 13, fx: 26, fy: 13 }], toe: 'up', lift: 0, sway: 0, dir: [-0.2, 1] }),
    slide: (t) => ({ dy: -SIT_SEAT, bob: Math.sin(t * 4) * 0.8, lean: -0.22, headRot: 0.12, hairAng: Math.PI + 0.12, hairLen: 46, wing: { freq: 9, amp: 0.3 }, wrot: 0.2,
      armF: { x: 15, y: -27, b: -3 }, armB: { x: -4, y: -28, b: 3 }, wa: -1.2,
      legs: [{ kx: 14, ky: 9, fx: 26, fy: 4 }, { kx: 15, ky: 11, fx: 27, fy: 8 }], toe: 'up', lift: 0.4, sway: -3, dir: [-1, -0.1] }),
    fall: (t) => ({ dy: 0, bob: Math.sin(t * 9) * 1.4, lean: -0.12, headRot: 0.1, hairAng: -Math.PI / 2 - 0.35, hairLen: 38, wing: { freq: 24, amp: 0.3 }, wrot: 0.1,
      armF: { x: 12, y: -30, b: -4 }, armB: { x: -9, y: -29, b: 4 }, wa: -1.3,
      legs: [{ kx: -6, ky: 17, fx: -9, fy: 24 }, { kx: 7, ky: 17, fx: 11, fy: 22 }], toe: 'flat', lift: 1, sway: 0, dir: [0, -1] }),
  };

  function limb(ctx, x0, y0, x1, y1, b, w) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx - (dy / L) * b, my + (dx / L) * b, x1, y1); ctx.stroke();
  }
  function slipper(ctx, fx, fy, ang) {
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(ang);
    ctx.fillStyle = '#c86bfa'; ctx.strokeStyle = '#8f45c0'; ctx.lineWidth = 1; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-3, -2.6); ctx.quadraticCurveTo(3, -3.6, 6, -2); ctx.quadraticCurveTo(10, -1.8, 10.5, -4.4);
    ctx.quadraticCurveTo(10.8, 0.6, 6, 2.6); ctx.quadraticCurveTo(0, 3.4, -3, 2.6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd93d'; ctx.beginPath(); ctx.arc(1, 0, 1.1, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function daisy(ctx, x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(190,150,170,0.7)'; ctx.lineWidth = 0.6;
    for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate((i * TAU) / 8); ctx.beginPath(); ctx.ellipse(r * 0.62, 0, r * 0.5, r * 0.26, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = '#ffd633'; ctx.beginPath(); ctx.arc(0, 0, r * 0.33, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.arc(-r * 0.08, -r * 0.08, r * 0.13, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // The head, face and front hair: the mermaid's own drawing, with the daisy where the starfish clip was.
  // Drawn so the middle of her head is the origin (the mermaid's head sits at (33,-13)).
  function head(ctx, time, happy, hw) {
    ctx.save(); ctx.translate(-33, 13);
    ctx.fillStyle = PAL.skin;
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
    if (happy) { ctx.fillStyle = '#c0395a'; ctx.beginPath(); ctx.arc(37, -6, 3.6, 0, Math.PI); ctx.fill(); }
    else { ctx.strokeStyle = '#c0395a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(37, -7.6, 3.3, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke(); }
    // hair front: crown + fringe
    ctx.fillStyle = PAL.hair;
    ctx.beginPath(); ctx.moveTo(19, -9);
    ctx.bezierCurveTo(15, -31, 45, -37, 48.5, -15);
    ctx.bezierCurveTo(46, -20, 43, -19, 41, -23);
    ctx.bezierCurveTo(38, -18.5, 34, -18.5, 31.5, -23.5);
    ctx.bezierCurveTo(29, -19, 25, -18, 23, -21);
    ctx.bezierCurveTo(21.5, -16, 21.5, -12, 19, -9);
    ctx.fill();
    // the side lock over her shoulder
    ctx.beginPath(); ctx.moveTo(20, -15);
    ctx.bezierCurveTo(14, -4 + hw * 0.4, 17, 4, 12, 11 + hw * 0.6);
    ctx.bezierCurveTo(21, 5, 24, -4, 25, -13);
    ctx.fill();
    ctx.strokeStyle = PAL.hairHi; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(32, -16, 12, -2.6, -1.4); ctx.stroke();
    // the daisy in her hair
    daisy(ctx, 25, -27, 6.4, time * 0.3);
    ctx.restore();
  }
  // the long hair behind her: two flowing locks streaming along `ang` (screen angle in the head's own frame)
  function lock(ctx, time, rx, ry, ang, len, wmax, flow, ph) {
    const N = 10, ca = Math.cos(ang), sa = Math.sin(ang), pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, w = Math.sin(time * 4.2 - u * 3.4 + ph) * (0.8 + u * 5.5 * flow);
      pts.push({ x: rx + ca * len * u - sa * w, y: ry + sa * len * u + ca * w, w: wmax * Math.pow(1 - u, 0.8) + 0.8 });
    }
    ctx.fillStyle = PAL.hair;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) ctx.lineTo(pts[i].x - sa * pts[i].w, pts[i].y + ca * pts[i].w);
    for (let i = N; i >= 0; i--) ctx.lineTo(pts[i].x + sa * pts[i].w, pts[i].y - ca * pts[i].w);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.hairHi; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < N - 2; i++) ctx.lineTo(pts[i].x - sa * pts[i].w * 0.35, pts[i].y + ca * pts[i].w * 0.35);
    ctx.stroke();
  }
  function hairBack(ctx, time, ang, len, flow) {
    if (flow > 0.8) { // streaming: three slim locks that wave
      lock(ctx, time, -6, -8, ang - 0.2, len * 0.85, 5.2, flow, 0);
      lock(ctx, time, -7, -3, ang, len, 6.4, flow, 1.7);
      lock(ctx, time, -6, 3, ang + 0.22, len * 0.72, 5, flow, 3.3);
    } else {
      lock(ctx, time, -6, -7, ang, len, 8.5, flow, 0);
      lock(ctx, time, -7, 1, ang + 0.1, len * 0.8, 7, flow, 1.6);
    }
  }
  function skirt(ctx, lift, sway, time) {
    const N = 7, wt = 6.8, wb = 17.5, hem = 15;
    const top = (i) => -wt + (2 * wt * i) / N;
    const bx = (i) => -wb + (2 * wb * i) / N + sway;
    const by = (i) => hem - lift * 7 * Math.abs((2 * i) / N - 1) + Math.sin(time * 3 + i) * 0.5 * (lift + 0.3);
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = RAINBOW[i]; ctx.strokeStyle = RAINBOW[i]; ctx.lineWidth = 0.7; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(top(i), 0); ctx.lineTo(top(i + 1), 0); ctx.lineTo(bx(i + 1), by(i + 1));
      ctx.quadraticCurveTo((bx(i) + bx(i + 1)) / 2, (by(i) + by(i + 1)) / 2 + 3.4, bx(i), by(i));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < N; i++) { ctx.moveTo(bx(i), by(i)); ctx.quadraticCurveTo((bx(i) + bx(i + 1)) / 2, (by(i) + by(i + 1)) / 2 + 3.4, bx(i + 1), by(i + 1)); }
    ctx.stroke();
  }
  function drawFairy(ctx, x, y, time, o) {
    o = o || {};
    const sc = o.scale == null ? 1 : o.scale, pose = POSES[o.pose] ? o.pose : 'fly', P = POSES[pose](time);
    const wand = o.wand !== false, hw = Math.sin(time * 3.6) * 3;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(o.tilt || 0); ctx.scale(o.flip ? -sc : sc, sc);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.glow > 0) { glow(ctx, 0, -10 + P.dy, 62, 'rgba(255,236,150,1)', clamp(o.glow, 0, 1) * 0.75); }
    ctx.translate(0, P.dy + P.bob);
    ctx.rotate(P.lean);
    const hx = 2, hy = -21, hr = P.headRot;
    const withHead = (fn) => { ctx.save(); ctx.translate(hx, hy); ctx.rotate(hr); fn(); ctx.restore(); };
    // wings, behind everything
    ctx.save(); ctx.translate(-2, -8); ctx.rotate(P.wrot); drawWings(ctx, time, { freq: P.wing.freq, amp: P.wing.amp }); ctx.restore();
    // long hair, then the far arm
    withHead(() => { ctx.translate(0, 0); hairBack(ctx, time, P.hairAng - P.lean - hr, P.hairLen, pose === 'stand' || pose === 'sit' ? 0.5 : 1); });
    ctx.strokeStyle = PAL.skin; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    limb(ctx, -1, -8, P.armB.x, P.armB.y, P.armB.b, 5);
    ctx.fillStyle = PAL.skin; ctx.beginPath(); ctx.arc(P.armB.x, P.armB.y, 2.8, 0, TAU); ctx.fill();
    // legs and slippers
    for (let k = 0; k < 2; k++) {
      const L = P.legs[k], hipx = k ? 2.5 : -2.5;
      ctx.strokeStyle = PAL.skin; ctx.lineWidth = 4.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(hipx, 11); ctx.lineTo(L.kx, L.ky); ctx.lineTo(L.fx, L.fy); ctx.stroke();
      const shin = Math.atan2(L.fy - L.ky, L.fx - L.kx);
      const ang = P.toe === 'point' ? shin : P.toe === 'up' ? -0.5 : 0.05;
      slipper(ctx, L.fx, L.fy + (P.toe === 'point' ? 0 : 1), ang);
    }
    // dress: skirt then bodice
    skirt(ctx, P.lift, P.sway, time);
    const bg = ctx.createLinearGradient(-6, 0, 7, 0);
    for (let i = 0; i < 7; i++) bg.addColorStop(i / 6, RAINBOW[i]);
    ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(-6.5, 1.5); ctx.quadraticCurveTo(-8, -9, -3.5, -10.5); ctx.lineTo(4.5, -10.5); ctx.quadraticCurveTo(8.5, -9, 7, 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(-7, -1.2, 14.6, 2.4);
    ctx.fillStyle = PAL.gold2; star(ctx, 0.5, 0, 2.8, 1.2, 5, -Math.PI / 2 + time * 0.4); ctx.fill();
    // neck, then the head
    ctx.fillStyle = PAL.skin; ctx.fillRect(-1.5, -14, 7, 7);
    withHead(() => head(ctx, time, o.happy == null ? (pose === 'slide' || pose === 'fall') : !!o.happy, hw));
    // near arm, wand and fairy dust
    const A = P.armF, tipx = A.x + Math.cos(P.wa) * 26, tipy = A.y + Math.sin(P.wa) * 26;
    if (o.dust > 0) {
      const n = Math.ceil(9 * o.dust), ca = Math.cos(-P.lean), sa = Math.sin(-P.lean);
      const dx = P.dir[0] * ca - P.dir[1] * sa, dy = P.dir[0] * sa + P.dir[1] * ca, dl = Math.hypot(dx, dy) || 1;
      for (let i = 0; i < n; i++) {
        const u = (time * 0.9 + i / n) % 1, wob = Math.sin(i * 2.1 + time * 3) * 5 * u;
        ctx.fillStyle = mix(RAINBOW[i % 7], '#ffffff', 0.3); ctx.globalAlpha = (o.alpha == null ? 1 : o.alpha) * (1 - u) * Math.min(1, o.dust + 0.2);
        sparkle(ctx, tipx + (dx / dl) * u * 54 - (dy / dl) * wob, tipy + (dy / dl) * u * 54 + (dx / dl) * wob, (4.6 + hash(i, 7) * 3.2) * (1 - u * 0.55) * (0.75 + 0.25 * Math.sin(time * 9 + i)));
      }
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    }
    if (wand) {
      ctx.strokeStyle = '#e8a200'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(tipx, tipy); ctx.stroke();
      ctx.strokeStyle = '#fff6b0'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(tipx, tipy); ctx.stroke();
      glow(ctx, tipx, tipy, 13, 'rgba(255,236,150,1)', 0.55 + 0.25 * Math.sin(time * 6));
      ctx.fillStyle = PAL.gold2; ctx.strokeStyle = '#c98a00'; ctx.lineWidth = 0.9; ctx.lineJoin = 'round';
      star(ctx, tipx, tipy, 6.4, 2.9, 5, -Math.PI / 2 + time * 0.8); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = PAL.skin; ctx.lineCap = 'round'; limb(ctx, 1, -8, A.x, A.y, A.b, 5);
    ctx.fillStyle = PAL.skin; ctx.beginPath(); ctx.arc(A.x, A.y, 3.1, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------- sparkles and dust ----------
  function drawSparkles(ctx, x, y, time, n, r, alpha) {
    const a0 = alpha == null ? 1 : alpha;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const px = x + (hash(x, y, i) * 2 - 1) * r, py = y + (hash(y, x, i + 50) * 2 - 1) * r;
      const rate = 2 + hash(i, x, y) * 3, ph = hash(x, i, y) * TAU, tw = Math.max(0, Math.sin(time * rate + ph));
      ctx.globalAlpha = a0 * (0.25 + 0.75 * tw);
      ctx.fillStyle = i % 3 === 0 ? PAL.gold1 : i % 3 === 1 ? '#ffffff' : '#ffe9a8';
      sparkle(ctx, px, py, (2.4 + hash(i, y, x) * 3.4) * (0.4 + 0.8 * tw));
    }
    ctx.restore();
  }
  // pts: [{ x, y, age }], age in seconds (about 0..1.2; older dust is smaller and fainter)
  function drawDust(ctx, pts, time) {
    ctx.save();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], u = clamp((p.age || 0) / 1.2, 0, 1), tw = 0.6 + 0.4 * Math.sin(time * 10 + i * 1.7);
      ctx.globalAlpha = (1 - u) * 0.95;
      ctx.fillStyle = mix(RAINBOW[(i * 3) % 7], '#ffffff', 0.3);
      sparkle(ctx, p.x + Math.sin(i * 2.3 + time * 2) * 2 * u, p.y + u * 9, (4.2 + hash(i, 3) * 4) * (1 - u * 0.5) * tw);
      if (i % 3 === 0) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x + 3, p.y + 3 + u * 6, 1 * (1 - u), 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }

  // ---------- skies ----------
  function drawSky(ctx, w, h, themeArg, time) {
    const T = themeOf(themeArg), ti = THEMES.indexOf(T);
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, T.top); g.addColorStop(0.55, T.mid || T.bot); g.addColorStop(1, T.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const sx = w * 0.78, sy = h * T.sunY;
    if (T.night) {
      for (let i = 0; i < 46; i++) {
        const stx = hash(i, 1) * w, sty = hash(i, 2) * h * 0.62, tw = 0.5 + 0.5 * Math.sin(time * (1 + hash(i, 3) * 2) + i);
        ctx.globalAlpha = 0.35 + 0.6 * tw; ctx.fillStyle = '#fff'; sparkle(ctx, stx, sty, 1.2 + hash(i, 4) * 2.2 * tw);
      }
      ctx.globalAlpha = 1;
      glow(ctx, sx, sy, 120, 'rgba(210,220,255,1)', 0.5);
      ctx.fillStyle = T.sun; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(190,190,225,0.5)';
      for (const c of [[-10, -8, 7], [9, 6, 9], [-4, 14, 4.5], [12, -14, 4]]) { ctx.beginPath(); ctx.arc(sx + c[0], sy + c[1], c[2], 0, TAU); ctx.fill(); }
    } else {
      glow(ctx, sx, sy, T.sunY > 0.4 ? 230 : 150, 'rgba(255,240,170,1)', T.sunY > 0.4 ? 0.8 : 0.6);
      ctx.fillStyle = T.sun; ctx.beginPath(); ctx.arc(sx, sy, T.sunY > 0.4 ? 54 : 34, 0, TAU); ctx.fill();
    }
    if (T.rainbow) { drawRainbow(ctx, w * 0.42, h * 0.98, h * 0.82, h * 0.045, { alpha: 0.5 }); }
    // far things on the horizon
    ctx.fillStyle = T.far;
    const base = h * 0.92;
    if (T.farKind === 'clouds') {
      for (let i = 0; i < 12; i++) {
        const cx = (i / 11) * (w + 80) - 40, rr = 38 + hash(i, 5, ti) * 34;
        ctx.beginPath(); ctx.arc(cx, base - 4 + Math.sin(time * 0.3 + i) * 2, rr, Math.PI, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + rr * 0.8, base + 8, rr * 0.7, Math.PI, TAU); ctx.fill();
      }
      ctx.fillRect(0, base, w, h - base);
    } else {
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let i = 0; i <= 24; i++) { const px = (i / 24) * w; ctx.lineTo(px, base - 36 - Math.sin(i * 0.7 + ti) * 26 - Math.sin(i * 1.9) * 9); }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      if (T.farKind === 'trees') {
        for (let i = 0; i < 16; i++) {
          const px = (i / 15) * w + (hash(i, 8) - 0.5) * 30, th = 70 + hash(i, 9) * 60, py = base - 12 - Math.sin(i * 0.7 + ti) * 14;
          ctx.fillRect(px - 3, py - th * 0.3, 6, th * 0.4);
          if (i % 2) { ctx.beginPath(); ctx.moveTo(px, py - th); ctx.lineTo(px + 24, py - th * 0.2); ctx.lineTo(px - 24, py - th * 0.2); ctx.closePath(); ctx.fill(); }
          else { ctx.beginPath(); ctx.arc(px, py - th * 0.6, th * 0.34, 0, TAU); ctx.fill(); }
        }
      }
    }
    if (T.night) { // fireflies drifting low over the horizon
      for (let i = 0; i < 12; i++) {
        const fx = (hash(i, 11) * w + Math.sin(time * 0.5 + i) * 24) % w, fy = h * (0.55 + hash(i, 12) * 0.35) + Math.sin(time * 0.8 + i * 2) * 10;
        glow(ctx, fx, fy, 12, 'rgba(230,255,120,1)', 0.35 + 0.65 * Math.max(0, Math.sin(time * 1.6 + i * 1.3)));
      }
    }
    ctx.restore();
  }

  function drawCloud(ctx, x, y, w, o) {
    o = o || {};
    const light = o.light || '#ffffff', shade = o.shade || PAL.cloudShade;
    const C = [[0.2, -0.08, 0.15], [0.4, -0.2, 0.2], [0.62, -0.17, 0.18], [0.82, -0.07, 0.14]];
    ctx.save(); ctx.translate(x, y);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    const body = (dy) => {
      ctx.beginPath();
      rrect(ctx, w * 0.06, -w * 0.13 + dy, w * 0.88, w * 0.17, w * 0.085);
      for (const c of C) { ctx.moveTo(w * c[0] + w * c[2], c[1] * w + dy); ctx.arc(w * c[0], c[1] * w + dy, w * c[2], 0, TAU); }
      ctx.fill();
    };
    ctx.fillStyle = shade; body(w * 0.04);
    ctx.fillStyle = light; body(0);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(w * 0.34, -w * 0.28, w * 0.07, w * 0.03, -0.5, 0, TAU); ctx.fill();
    if (o.grumpy) grumpyFace(ctx, w * 0.5, -w * 0.07, w / 62, 1, { sep: 7.5, eye: 4 });
    ctx.restore();
  }

  // ---------- rainbows ----------
  function drawRainbow(ctx, cx, cy, r, band, o) {
    o = o || {};
    const a0 = o.from == null ? Math.PI : o.from, a1 = o.to == null ? TAU : o.to;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha = o.alpha;
    ctx.lineCap = 'butt';
    for (let i = 0; i < 7; i++) {
      const rr = r - band * (i + 0.5);
      if (rr <= 0) break;
      ctx.strokeStyle = RAINBOW[i]; ctx.lineWidth = band + 0.8;
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.stroke();
    }
    ctx.restore();
  }
  function drawRainbowRibbon(ctx, pts, width, alpha) {
    const n = pts.length;
    if (n < 2) return;
    const nx = [], ny = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      nx.push(-dy / L); ny.push(dx / L);
    }
    ctx.save(); if (alpha != null) ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    for (let i = 0; i < 7; i++) {
      const o0 = ((i - 3.5) / 7) * width - 0.4, o1 = ((i - 2.5) / 7) * width + 0.4;
      ctx.fillStyle = RAINBOW[i]; ctx.beginPath();
      for (let k = 0; k < n; k++) ctx.lineTo(pts[k].x + nx[k] * o0, pts[k].y + ny[k] * o0);
      for (let k = n - 1; k >= 0; k--) ctx.lineTo(pts[k].x + nx[k] * o1, pts[k].y + ny[k] * o1);
      ctx.closePath(); ctx.fill();
    }
    // a soft shine along the middle
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(1, width * 0.08); ctx.lineCap = 'round'; ctx.beginPath();
    for (let k = 0; k < n; k++) ctx.lineTo(pts[k].x + nx[k] * width * -0.18, pts[k].y + ny[k] * width * -0.18);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- water, trees, mushrooms, flowers, grass ----------
  function drawWaterfall(ctx, x, y, w, h, time) {
    ctx.save(); ctx.translate(x, y);
    // rock lip
    ctx.fillStyle = '#9aa4b8'; rrect(ctx, -w * 0.62, -10, w * 1.24, 22, 9); ctx.fill();
    ctx.fillStyle = '#c3cbdb'; rrect(ctx, -w * 0.56, -10, w * 1.12, 9, 5); ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#a8e8ff'); g.addColorStop(1, '#55bff0');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w / 2, 4);
    for (let i = 0; i <= 8; i++) ctx.lineTo(-w / 2 - Math.sin(i * 1.3 + time) * 2, 4 + ((h - 8) * i) / 8);
    ctx.lineTo(w / 2, h); for (let i = 8; i >= 0; i--) ctx.lineTo(w / 2 + Math.sin(i * 1.1 + time * 1.2) * 2, 4 + ((h - 8) * i) / 8);
    ctx.closePath(); ctx.fill();
    // falling streaks
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const sx = -w * 0.42 + (i / 8) * w * 0.84, sp = 0.5 + hash(i, 1) * 0.7, ph = (time * sp + hash(i, 2)) % 1, len = h * (0.16 + hash(i, 3) * 0.2);
      const y0 = ph * (h + len) - len;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.45 + 0.35 * hash(i, 4)) + ')'; ctx.lineWidth = 2 + hash(i, 5) * 2.4;
      ctx.beginPath(); ctx.moveTo(sx, clamp(y0, 6, h - 6)); ctx.lineTo(sx, clamp(y0 + len, 6, h - 6)); ctx.stroke();
    }
    // foam and mist at the foot
    for (let i = 0; i < 8; i++) {
      const fx = -w * 0.62 + (i / 7) * w * 1.24, r = w * 0.12 + 5 + Math.sin(time * 3 + i * 1.7) * 2.5;
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(fx, h - 2 + Math.sin(time * 2.4 + i) * 2, r, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 4; i++) { const u = (time * 0.4 + i / 4) % 1; ctx.beginPath(); ctx.arc(Math.sin(i * 2.7) * w * 0.4, h - 10 - u * 36, 7 + u * 9, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function drawTree(ctx, x, y, scale, kind, time) {
    kind = ((kind | 0) % 4 + 4) % 4;
    const sc = scale == null ? 1 : scale, sw = Math.sin(time * 1.2 + x * 0.013) * 2.2;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    const trunk = (hh, ww) => {
      ctx.fillStyle = PAL.trunk; ctx.beginPath(); ctx.moveTo(-ww, 0); ctx.quadraticCurveTo(-ww * 0.5, -hh * 0.5, -ww * 0.55 + sw * 0.15, -hh); ctx.lineTo(ww * 0.55 + sw * 0.15, -hh); ctx.quadraticCurveTo(ww * 0.5, -hh * 0.5, ww, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.trunkDark; ctx.beginPath(); ctx.moveTo(ww * 0.15, 0); ctx.quadraticCurveTo(ww * 0.25, -hh * 0.5, ww * 0.2, -hh); ctx.lineTo(ww * 0.55, -hh); ctx.quadraticCurveTo(ww * 0.5, -hh * 0.5, ww, 0); ctx.closePath(); ctx.fill();
    };
    const puff = (px, py, r, c, hi) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px + sw, py, r, 0, TAU); ctx.fill();
      ctx.fillStyle = hi; ctx.beginPath(); ctx.arc(px + sw - r * 0.28, py - r * 0.3, r * 0.55, 0, TAU); ctx.fill();
    };
    if (kind === 0) {
      trunk(60, 11);
      const d = '#3fae5c', m = PAL.leaf, hi = '#6fd481';
      puff(-30, -78, 30, d, m); puff(32, -80, 30, d, m); puff(0, -108, 38, m, hi); puff(-6, -78, 36, m, hi);
    } else if (kind === 1) {
      trunk(34, 9);
      for (let i = 0; i < 4; i++) {
        const ly = -26 - i * 30, ww = 52 - i * 10 + (i === 3 ? 0 : 0), s2 = sw * (0.4 + i * 0.25);
        ctx.fillStyle = i % 2 ? '#3a9e5f' : '#2f8f55';
        ctx.beginPath(); ctx.moveTo(-ww + s2 * 0.2, ly); ctx.quadraticCurveTo(-ww * 0.3, ly - 20, s2 + 1, ly - 52); ctx.quadraticCurveTo(ww * 0.3, ly - 20, ww + s2 * 0.2, ly); ctx.quadraticCurveTo(0, ly + 9, -ww + s2 * 0.2, ly); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.moveTo(-ww * 0.7 + s2 * 0.2, ly - 3); ctx.quadraticCurveTo(-ww * 0.25, ly - 18, s2, ly - 48); ctx.quadraticCurveTo(-ww * 0.2, ly - 12, -ww * 0.7 + s2 * 0.2, ly - 3); ctx.fill();
      }
    } else if (kind === 2) {
      trunk(70, 11);
      puff(0, -96, 44, '#4fbf6a', '#7ddc8a');
      ctx.lineCap = 'round';
      for (let i = 0; i < 11; i++) {
        const sx2 = -48 + i * 9.6, len = 52 + hash(i, 6) * 26, sy2 = -98 + Math.abs(i - 5) * 4.5, bend = Math.sin(time * 1.5 + i * 0.8) * 5;
        ctx.strokeStyle = i % 2 ? '#3fae5c' : '#5bcb78'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(sx2 + sw * 0.5, sy2); ctx.quadraticCurveTo(sx2 + bend * 0.4, sy2 + len * 0.55, sx2 + bend, sy2 + len); ctx.stroke();
      }
    } else {
      trunk(60, 10);
      const d = '#ff9fcb', m = '#ffc1dd', hi = '#ffe6f1';
      puff(-32, -78, 28, d, m); puff(32, -80, 28, d, m); puff(0, -106, 36, m, hi); puff(-4, -76, 34, m, hi);
      for (let i = 0; i < 5; i++) { // blossom falling
        const u = (time * 0.25 + i / 5) % 1;
        ctx.fillStyle = 'rgba(255,200,225,' + (1 - u) + ')';
        ctx.beginPath(); ctx.ellipse(-50 + i * 24 + Math.sin(time + i * 2) * 8, -60 + u * 64, 3.2, 2, time + i, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawMushroom(ctx, x, y, scale, colour) {
    const sc = scale == null ? 1 : scale, c = colour || '#ff4d6d';
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.fillStyle = '#fff4dd'; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.quadraticCurveTo(-6, -16, -8, -26); ctx.lineTo(8, -26); ctx.quadraticCurveTo(6, -16, 9, 0); ctx.quadraticCurveTo(0, 5, -9, 0); ctx.fill();
    ctx.fillStyle = 'rgba(190,150,110,0.3)'; ctx.beginPath(); ctx.moveTo(2, -26); ctx.lineTo(8, -26); ctx.quadraticCurveTo(6, -16, 9, 0); ctx.quadraticCurveTo(5, 3, 3, 1); ctx.quadraticCurveTo(5, -14, 2, -26); ctx.fill();
    ctx.fillStyle = '#f2dfc2'; ctx.beginPath(); ctx.ellipse(0, -26, 30, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-34, -27); ctx.bezierCurveTo(-34, -62, 34, -62, 34, -27); ctx.quadraticCurveTo(0, -17, -34, -27); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(-14, -48, 11, 5, -0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    for (const s of [[-18, -38, 5.5], [3, -48, 6.5], [20, -38, 5], [-3, -34, 3.4]]) { ctx.beginPath(); ctx.ellipse(s[0], s[1], s[2], s[2] * 0.8, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  const BUD = '#9db38f';
  // the head of each flower. o = openness 0..1, c = its colour, in a frame where the stem tip is the origin
  function petalsRing(ctx, n, o, rr, len, wid, col) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      let a = (i / n) * TAU + Math.PI / 2; a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; // -pi..pi, 0 = pointing right
      const th = -Math.PI / 2 + a * o;
      ctx.beginPath(); ctx.ellipse(Math.cos(th) * rr, Math.sin(th) * rr, len, wid, th, 0, TAU); ctx.fill();
    }
  }
  const FLOWERS = [
    (ctx, o, c, t) => { // daisy
      ctx.fillStyle = PAL.leafDark; ctx.beginPath(); ctx.arc(0, 1, 5, 0, TAU); ctx.fill();
      petalsRing(ctx, 11, o, 7 * (0.35 + 0.65 * o), 6.5, 2.7 + o * 0.4, c);
      ctx.fillStyle = mix('#8fa384', PAL.gold2, o); ctx.beginPath(); ctx.arc(0, 0, 3.4 + o * 0.6, 0, TAU); ctx.fill();
    },
    (ctx, o, c) => { // tulip
      const L = (s) => { ctx.save(); ctx.rotate(s * 0.42 * o); ctx.beginPath(); ctx.moveTo(0, 3); ctx.bezierCurveTo(-9 * (s ? 1 : 0.6), 0, -7, -17, s * 1.5, -19 - o * 2); ctx.bezierCurveTo(6, -14, 8, -1, 0, 3); ctx.fill(); ctx.restore(); };
      ctx.fillStyle = mix(c, '#000000', 0.15); L(-1); L(1);
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, 3); ctx.bezierCurveTo(-9, 0, -6, -16, 0, -21 - o * 2); ctx.bezierCurveTo(6, -16, 9, 0, 0, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(-2.5, -9, 1.8, 6, 0.15, 0, TAU); ctx.fill();
    },
    (ctx, o, c, t) => { // bluebell: a bent stem with bells
      ctx.strokeStyle = PAL.leafDark; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.quadraticCurveTo(0, -10, 12, -9); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const bx = 1 + i * 5.2, by = -3 - i * 2.2 + 4 + Math.sin(t * 2 + i) * 0.6, s = 0.55 + 0.45 * o;
        ctx.save(); ctx.translate(bx + 1, by + (i === 2 ? 0 : 0)); ctx.scale(s, s);
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-2.5, 0); ctx.bezierCurveTo(-3.5, 6, -4, 8, -7.5 * (0.5 + 0.5 * o), 13); ctx.quadraticCurveTo(0, 16, 7.5 * (0.5 + 0.5 * o), 13); ctx.bezierCurveTo(4, 8, 3.5, 6, 2.5, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-1.2, 6, 0.9, 4, 0.1, 0, TAU); ctx.fill();
        ctx.restore();
      }
    },
    (ctx, o, c) => { // sunflower
      ctx.save(); ctx.scale(1.25, 1.25);
      petalsRing(ctx, 14, o, 8 * (0.35 + 0.65 * o), 7.4, 2.5, mix('#c8c27a', '#ffb800', o));
      petalsRing(ctx, 14, o, 6 * (0.35 + 0.65 * o), 6.2, 2.3, c);
      ctx.fillStyle = mix('#7a8a6a', '#7a4a1e', o); ctx.beginPath(); ctx.arc(0, 0, 5 + o * 0.8, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(40,20,5,0.5)';
      for (const d of [[-2, -1.5], [2, -2], [0, 1.6], [-2.8, 2], [3, 2]]) { ctx.beginPath(); ctx.arc(d[0], d[1], 0.8, 0, TAU); ctx.fill(); }
      ctx.restore();
    },
    (ctx, o, c) => { // rose
      const r = 3.6 + 5.4 * o;
      ctx.fillStyle = PAL.leafDark; ctx.beginPath(); ctx.arc(0, 2, 4.2 + o, 0, TAU); ctx.fill();
      ctx.fillStyle = mix(c, '#000000', 0.2); ctx.beginPath(); ctx.arc(0, -1, r, 0, TAU); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -1.4, r * 0.82, 0, TAU); ctx.fill();
      ctx.strokeStyle = mix(c, '#000000', 0.3); ctx.lineWidth = 1; ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0.4, -1.4, r * (0.62 - k * 0.2), 0.4 + k, 4 + k); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(0, -1.4, r * 0.82, 3.6, 4.5); ctx.stroke();
    },
    (ctx, o, c) => { // lily
      petalsRing(ctx, 6, o, 3 * o, 10.5 * (0.55 + 0.45 * o), 3.7, mix(BUD, c, o));
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        let a = (i / 6) * TAU + Math.PI / 2; a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; const th = -Math.PI / 2 + a * o;
        ctx.beginPath(); ctx.moveTo(Math.cos(th) * 3, Math.sin(th) * 3); ctx.lineTo(Math.cos(th) * 12 * (0.55 + 0.45 * o), Math.sin(th) * 12 * (0.55 + 0.45 * o)); ctx.stroke();
      }
      ctx.fillStyle = PAL.gold3; for (const a of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.arc(Math.sin(a) * 4 * o, -Math.cos(a) * 4 * o - 1, 1.3, 0, TAU); ctx.fill(); }
    },
  ];
  const FLOWER_COL = ['#ffffff', '#ff5d8f', '#6c63ff', '#ffd633', '#ff4d6d', '#ffa8d4'];
  const FLOWER_H = [46, 54, 50, 62, 50, 56];
  function drawFlower(ctx, x, y, scale, kind, bloom, time) {
    kind = ((kind | 0) % 6 + 6) % 6;
    const sc = scale == null ? 1 : scale, b = smooth(bloom == null ? 1 : bloom), hh = FLOWER_H[kind];
    const sx = Math.sin(time * 1.6 + x * 0.05) * 2.4 * (0.4 + 0.6 * b);
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.strokeStyle = mix('#7a9a6a', PAL.leafDark, b); ctx.lineWidth = kind === 3 ? 4 : 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(sx * 0.2, -hh * 0.5, sx, -hh); ctx.stroke();
    ctx.fillStyle = mix('#8fab80', PAL.leaf, b);
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 0.1, -hh * 0.22); ctx.quadraticCurveTo(k * 15, -hh * 0.36, k * 14, -hh * 0.2 + 3); ctx.quadraticCurveTo(k * 5, -hh * 0.1, sx * 0.1, -hh * 0.22); ctx.fill(); }
    ctx.translate(sx, -hh);
    FLOWERS[kind](ctx, b, mix(BUD, FLOWER_COL[kind], b), time);
    ctx.restore();
  }

  function drawGrass(ctx, x, y, w, time, colour) {
    const c = colour || PAL.leaf;
    ctx.save(); ctx.translate(x, y);
    const n = Math.max(2, Math.round(w / 7));
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? c : mix(c.charAt(0) === '#' ? c : PAL.leaf, '#000000', 0.18);
      for (let i = 0; i < n; i++) {
        const bx = (i + 0.5 + (pass ? 0.35 : 0)) * (w / n), hh = 9 + hash(i, pass, x) * 15, sw = Math.sin(time * 1.8 + i * 0.7 + x * 0.02) * 2.4 + (hash(i, 4) - 0.5) * 5;
        ctx.beginPath(); ctx.moveTo(bx - 2.6, 0); ctx.quadraticCurveTo(bx - 1 + sw * 0.4, -hh * 0.6, bx + sw, -hh); ctx.quadraticCurveTo(bx + 1 + sw * 0.4, -hh * 0.55, bx + 2.6, 0); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawLilyPad(ctx, x, y, r, o) {
    o = o || {};
    const t = o.time || 0, bob = Math.sin(t * 1.7 + x * 0.03) * 1.5, ry = r * 0.46;
    ctx.save(); ctx.translate(x, y + bob);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(0, ry * 0.2, r * 1.12, ry * 1.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.leafDark; ctx.beginPath(); ctx.ellipse(0, ry * 0.18, r, ry, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = o.colour || '#5fce78';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.ellipse(0, 0, r, ry, 0, 0.12, TAU - 0.12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(30,120,70,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = 0.9 + i * 0.9; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * ry * 0.85); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(-r * 0.3, -ry * 0.35, r * 0.28, ry * 0.2, 0, 0, TAU); ctx.fill();
    if (o.flower) {
      ctx.translate(r * 0.1, -ry * 0.2);
      for (const k of [-1, 1]) { ctx.fillStyle = '#ff9ec7'; ctx.beginPath(); ctx.ellipse(k * 6, -3, 4, 8, k * 0.7, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#ffc1dd'; ctx.beginPath(); ctx.ellipse(0, -5, 4.4, 9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = PAL.gold2; ctx.beginPath(); ctx.arc(0, -1.5, 2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- treasure ----------
  function drawCoin(ctx, x, y, ph, r) {
    r = r || 13;
    const sx = 0.3 + 0.7 * Math.abs(Math.cos(ph));
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
    ctx.fillStyle = '#c98a00'; ctx.beginPath(); ctx.arc(0, 1.5, r, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 1, 0, 0, r);
    g.addColorStop(0, PAL.gold1); g.addColorStop(0.45, PAL.gold2); g.addColorStop(1, PAL.gold3);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(180,110,0,0.75)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(200,125,0,0.8)'; star(ctx, 0, 0, r * 0.38, r * 0.17, 5, -Math.PI / 2); ctx.fill();
    ctx.restore();
  }
  function drawKey(ctx, x, y, scale, time) {
    const sc = scale == null ? 1 : scale;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(time * 2) * 0.25 - 0.5); ctx.scale(sc, sc);
    ctx.fillStyle = PAL.gold3; ctx.strokeStyle = PAL.goldDark; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(-16, 0, 12, 0, TAU); ctx.arc(-16, 0, 5.5, 0, TAU, true); ctx.fill('evenodd'); ctx.stroke();
    rrect(ctx, -5, -4, 32, 8, 3); ctx.fill(); ctx.stroke();
    ctx.fillRect(16, 3, 5, 9); ctx.strokeRect(16, 3, 5, 9);
    ctx.fillRect(23, 3, 4, 6); ctx.strokeRect(23, 3, 4, 6);
    ctx.fillStyle = 'rgba(255,250,200,0.9)'; ctx.beginPath(); ctx.arc(-20, -5, 2.6, 0, TAU); ctx.fill();
    ctx.fillRect(-2, -2.5, 20, 2);
    ctx.fillStyle = '#ff4d8d'; heartPath(ctx, -16, 0, 3.4); ctx.fill();
    ctx.restore();
  }
  function drawChest(ctx, x, y, open, time) {
    open = clamp(open || 0, 0, 1);
    const GOLD = PAL.chest;
    ctx.save(); ctx.translate(x, y);
    if (open > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const bg = ctx.createLinearGradient(0, -20, 0, -320);
      bg.addColorStop(0, 'rgba(255,230,120,' + (0.55 * open) + ')'); bg.addColorStop(1, 'rgba(255,230,120,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(-50, -20); ctx.lineTo(50, -20); ctx.lineTo(120, -330); ctx.lineTo(-120, -330); ctx.closePath(); ctx.fill();
      ctx.restore();
      glow(ctx, 0, -30, 140, 'rgba(255,220,90,0.8)', open);
    }
    ctx.fillStyle = '#8b4a1c'; rrect(ctx, -60, -34, 120, 62, 8); ctx.fill();
    ctx.fillStyle = '#a65d27'; rrect(ctx, -56, -30, 112, 54, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(80,35,10,0.5)'; ctx.lineWidth = 2;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(-56, k * 14 - 3); ctx.lineTo(56, k * 14 - 3); ctx.stroke(); }
    ctx.fillStyle = GOLD;
    rrect(ctx, -62, -36, 12, 66, 3); ctx.fill(); rrect(ctx, 50, -36, 12, 66, 3); ctx.fill();
    ctx.fillRect(-60, -36, 120, 7);
    if (open > 0.1) for (let i = 0; i < 9; i++) drawCoin(ctx, -40 + i * 10, -38 - Math.sin(i * 1.3) * 5, time * 2 + i, 9);
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
      ctx.fillStyle = GOLD; rrect(ctx, -13, -40, 26, 28, 5); ctx.fill();
      ctx.fillStyle = '#5a3a10'; ctx.beginPath(); ctx.arc(0, -29, 4, 0, TAU); ctx.fill(); ctx.fillRect(-2, -29, 4, 10);
    }
    if (open > 0.3) drawSparkles(ctx, 0, -70 - open * 20, time, 8, 60, open);
    ctx.restore();
  }

  // ---------- creatures ----------
  function drawButterfly(ctx, x, y, time, colour, scale) {
    const c = colour || '#ff8fc0', sc = scale == null ? 1 : scale;
    const f = 0.28 + 0.72 * Math.abs(Math.sin(time * 7 + x * 0.05));
    ctx.save(); ctx.translate(x, y + Math.sin(time * 3 + x * 0.05) * 2); ctx.scale(sc, sc);
    for (const k of [-1, 1]) {
      ctx.save(); ctx.scale(k * f, 1);
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(1, -2); ctx.bezierCurveTo(8, -20, 24, -17, 22, -6); ctx.bezierCurveTo(21, 0, 8, 2, 1, 0); ctx.fill();
      ctx.fillStyle = mix(c.charAt(0) === '#' ? c : '#ff8fc0', '#ffffff', 0.35); ctx.beginPath(); ctx.moveTo(1, 0); ctx.bezierCurveTo(12, 1, 19, 6, 15, 13); ctx.bezierCurveTo(10, 16, 3, 9, 1, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(14, -9, 3, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(10, 8, 2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(1, -2); ctx.bezierCurveTo(8, -20, 24, -17, 22, -6); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#6b3a1f'; ctx.beginPath(); ctx.ellipse(0, 0, 2.2, 8.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5a35'; ctx.beginPath(); ctx.arc(0, -8, 3, 0, TAU); ctx.fill();
    happyDots(ctx, 0, -8.4, 0.9);
    ctx.strokeStyle = '#6b3a1f'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-1, -10); ctx.quadraticCurveTo(-4, -16, -7, -15); ctx.moveTo(1, -10); ctx.quadraticCurveTo(4, -16, 7, -15); ctx.stroke();
    ctx.restore();
  }
  function bugWings(ctx, time, w, h, ox, oy) {
    const f = Math.sin(time * 34) * 0.35;
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
    for (const k of [0, 1]) {
      ctx.save(); ctx.translate(ox - k * 4, oy); ctx.rotate(-0.9 - k * 0.55 + f * (k ? -1 : 1));
      ctx.beginPath(); ctx.ellipse(w / 2, 0, w / 2, h / 2, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  function drawBug(ctx, x, y, time, kind, scale) {
    kind = ((kind | 0) % 3 + 3) % 3;
    const sc = scale == null ? 1 : scale, hov = Math.sin(time * 4 + x * 0.04) * 2.5;
    ctx.save(); ctx.translate(x, y + hov); ctx.scale(sc, Math.abs(sc)); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 0) { // round beetle
      bugWings(ctx, time, 22, 11, 2, -13);
      ctx.strokeStyle = '#2d2766'; ctx.lineWidth = 2;
      for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(k * 7, 11); ctx.lineTo(k * 9 + 1, 17); ctx.stroke(); }
      ctx.fillStyle = '#5b4bd1'; ctx.beginPath(); ctx.ellipse(5, 0, 20, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(8, -9, 9, 4, -0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a2f99'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(8, -16.5); ctx.lineTo(8, 16.5); ctx.stroke();
      ctx.fillStyle = '#ffb347'; for (const s of [[16, -6], [16, 7], [0, 6], [-1, -7]]) { ctx.beginPath(); ctx.arc(s[0], s[1], 3.4, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#33297a'; ctx.beginPath(); ctx.arc(-17, 2, 11, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#33297a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-20, -8); ctx.quadraticCurveTo(-24, -17, -29, -15); ctx.moveTo(-14, -8); ctx.quadraticCurveTo(-14, -18, -18, -20); ctx.stroke();
      grumpyFace(ctx, -17, 0, 0.82, time, { sep: 5.6, eye: 3.4 });
    } else if (kind === 1) { // stripy wasp
      bugWings(ctx, time, 24, 11, 4, -10);
      ctx.fillStyle = '#ffd633'; ctx.beginPath(); ctx.ellipse(5, 2, 22, 13, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3d2b12';
      for (const sx of [-2, 9, 20]) { ctx.beginPath(); ctx.ellipse(sx, 2, 3, 11.2 - Math.abs(sx - 9) * 0.1, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(2, -6, 9, 3, -0.1, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe36a'; ctx.beginPath(); ctx.arc(-16, 2, 11.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3d2b12'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-19, -8); ctx.quadraticCurveTo(-23, -16, -28, -14); ctx.moveTo(-13, -8); ctx.quadraticCurveTo(-13, -17, -17, -19); ctx.stroke();
      grumpyFace(ctx, -16, 0, 0.85, time, { sep: 5.8, eye: 3.4 });
    } else { // moth
      const f = 0.45 + 0.55 * Math.abs(Math.sin(time * 9 + x * 0.04));
      for (const k of [0, 1]) {
        ctx.save(); ctx.scale(1, k ? -1 : 1);
        ctx.fillStyle = '#b79bd9'; ctx.beginPath(); ctx.moveTo(0, -2); ctx.bezierCurveTo(8 - 18 * f * 0, -28 * f - 2, 28, -32 * f, 26, -8 * f); ctx.bezierCurveTo(24, 0, 8, 2, 0, 0); ctx.fill();
        ctx.fillStyle = '#d9c8ee'; ctx.beginPath(); ctx.arc(17, -12 * f, 6.5 * Math.min(1, f + 0.3), 0, TAU); ctx.fill();
        ctx.fillStyle = '#6b4a9a'; ctx.beginPath(); ctx.arc(17, -12 * f, 3.2 * Math.min(1, f + 0.3), 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#8a6a5a'; ctx.beginPath(); ctx.ellipse(8, 0, 14, 6.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e6d4c8'; ctx.beginPath(); ctx.arc(-6, 0, 9.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8a6a5a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-8, -8); ctx.quadraticCurveTo(-9, -16, -15, -17); ctx.moveTo(-3, -8); ctx.quadraticCurveTo(0, -16, -5, -20); ctx.stroke();
      grumpyFace(ctx, -6, -1, 0.7, time, { sep: 4.8, eye: 3.2 });
    }
    ctx.restore();
  }
  function drawCritter(ctx, x, y, time, kind, scale) {
    kind = ((kind | 0) % 3 + 3) % 3;
    const sc = scale == null ? 1 : scale;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, Math.abs(sc)); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 0) { // snail
      const sq = Math.sin(time * 3) * 1.6;
      ctx.fillStyle = '#d9c98a'; ctx.beginPath(); ctx.moveTo(-24 - sq, -2); ctx.bezierCurveTo(-30, -8, -26, -22, -20, -26); ctx.bezierCurveTo(-14, -12, 0, -6, 34 + sq, -4);
      ctx.quadraticCurveTo(38 + sq, 0, 30 + sq, 0); ctx.lineTo(-22 - sq, 0); ctx.quadraticCurveTo(-27, 0, -24 - sq, -2); ctx.fill();
      ctx.fillStyle = '#e9deaa'; ctx.beginPath(); ctx.ellipse(-3, -3, 20, 3, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#d9c98a'; ctx.lineWidth = 2.6; const w = Math.sin(time * 4) * 2;
      ctx.beginPath(); ctx.moveTo(-23, -21); ctx.lineTo(-27 + w, -33); ctx.moveTo(-18, -22); ctx.lineTo(-18 + w, -34); ctx.stroke();
      ctx.fillStyle = '#fff'; for (const e of [[-27 + w, -34], [-18 + w, -35]]) { ctx.beginPath(); ctx.arc(e[0], e[1], 3.2, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#2a170a'; ctx.beginPath(); ctx.arc(-28 + w, -34, 1.6, 0, TAU); ctx.arc(-19 + w, -35, 1.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-31 + w, -38.5); ctx.lineTo(-25 + w, -37); ctx.moveTo(-15 + w, -39); ctx.lineTo(-21 + w, -37); ctx.stroke();
      ctx.strokeStyle = '#a8324f'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(-24, -12, 3, 1.2 * Math.PI, 1.8 * Math.PI); ctx.stroke();
      ctx.fillStyle = '#c98a4a'; ctx.beginPath(); ctx.arc(12, -20, 19, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8b06a'; ctx.beginPath(); ctx.arc(10, -22, 13.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#a8692f'; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let a = 0; a < 11; a += 0.2) { const r = 1.1 * a + 1; ctx.lineTo(10 + Math.cos(a) * r, -22 + Math.sin(a) * r); } ctx.stroke();
    } else if (kind === 1) { // hedgehog
      ctx.fillStyle = '#5b3d2a';
      for (let i = 0; i < 17; i++) {
        const a = Math.PI + (i / 16) * Math.PI * 0.98 + 0.05, cx = 6 + Math.cos(a) * 22, cy = -17 + Math.sin(a) * 19, j = Math.sin(time * 2 + i) * 0.04;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a + j); ctx.beginPath(); ctx.moveTo(0, -4.5); ctx.lineTo(11, 0); ctx.lineTo(0, 4.5); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = '#7a5238'; ctx.beginPath(); ctx.ellipse(6, -14, 21, 15, 0, Math.PI, TAU); ctx.lineTo(27, -12); ctx.quadraticCurveTo(10, 3, -14, -8); ctx.fill();
      ctx.fillStyle = '#e9c9a0'; ctx.beginPath(); ctx.moveTo(-8, -26); ctx.quadraticCurveTo(-30, -16, -34, -8); ctx.quadraticCurveTo(-30, 0, -14, 0); ctx.quadraticCurveTo(8, 2, 8, -14); ctx.quadraticCurveTo(2, -26, -8, -26); ctx.fill();
      ctx.fillStyle = '#2a170a'; ctx.beginPath(); ctx.arc(-34, -9, 3.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e9c9a0'; for (const fx of [-12, 10]) { ctx.beginPath(); ctx.ellipse(fx, 0, 6, 3.6, 0, 0, TAU); ctx.fill(); }
      grumpyFace(ctx, -14, -16, 0.78, time, { sep: 5.5, eye: 3.4 });
    } else { // toad
      const puff = Math.sin(time * 2.4) * 1.2;
      ctx.fillStyle = '#6aa84f'; ctx.beginPath(); ctx.ellipse(0, -14 - puff * 0.3, 27 + puff, 15 + puff * 0.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#b6d98a'; ctx.beginPath(); ctx.ellipse(-4, -8, 17, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4f8a3c'; for (const s of [[10, -23, 2.6], [18, -16, 2.2], [3, -27, 2], [20, -8, 2.2]]) { ctx.beginPath(); ctx.arc(s[0], s[1], s[2], 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#6aa84f'; for (const f of [[-14, 0], [14, 0]]) { ctx.beginPath(); ctx.ellipse(f[0], f[1] - 1, 8, 3.4, 0, 0, TAU); ctx.fill(); }
      for (const ex of [-16, -3]) {
        ctx.fillStyle = '#6aa84f'; ctx.beginPath(); ctx.arc(ex, -27, 7.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - 0.4, -27, 5.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a170a'; ctx.beginPath(); ctx.arc(ex - 1.6, -26.6, 2.7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - 2.4, -28, 0.9, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6aa84f'; ctx.beginPath(); ctx.moveTo(ex - 7.4, -27); ctx.arc(ex, -27, 7.4, Math.PI, TAU * 0.98); ctx.fill();
      }
      ctx.strokeStyle = '#2f5a24'; ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(-23, -35); ctx.lineTo(-13, -31.5); ctx.moveTo(4, -35); ctx.lineTo(-6, -31.5); ctx.stroke();
      ctx.strokeStyle = '#2f5a24'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-24, -11); ctx.quadraticCurveTo(-10, -18, 4, -11); ctx.stroke();
      ctx.fillStyle = 'rgba(255,110,140,0.4)'; ctx.beginPath(); ctx.arc(-25, -17, 3, 0, TAU); ctx.arc(8, -17, 3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawFirefly(ctx, x, y, time, gl) {
    const g = gl == null ? 1 : gl, pulse = 0.55 + 0.45 * Math.sin(time * 3 + x * 0.07), f = Math.sin(time * 40) * 0.3;
    ctx.save(); ctx.translate(x, y);
    glow(ctx, 3, 3, 24 * (0.6 + 0.4 * g), 'rgba(230,255,110,1)', clamp(g, 0, 1) * pulse);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (const k of [0, 1]) { ctx.save(); ctx.translate(2, -3); ctx.rotate(-0.9 - k * 0.5 + f); ctx.beginPath(); ctx.ellipse(5, 0, 5.5, 2.4, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = '#5a3a28'; ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 3.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff48a'; ctx.beginPath(); ctx.ellipse(5.6, 1.2, 4.6, 3.4, 0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fffde0'; ctx.beginPath(); ctx.arc(6.5, 0.6, 2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5a3a'; ctx.beginPath(); ctx.arc(-5.6, -0.4, 3, 0, TAU); ctx.fill();
    happyDots(ctx, -6, -0.8, 0.8);
    ctx.restore();
  }
  function drawHand(ctx, x, y, time, alpha) {
    const a = alpha == null ? 1 : alpha;
    if (a <= 0.01) return;
    const tap = Math.max(0, Math.sin(time * 5)) * 7;
    ctx.save(); ctx.globalAlpha = 0.96 * a;
    ctx.translate(x + 6, y + 10 + tap); ctx.rotate(-0.42);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(20,60,110,0.8)'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    rrect(ctx, -17, 26, 36, 34, 12); ctx.fill(); ctx.stroke();
    rrect(ctx, -7, -2, 15, 42, 7.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-5, 27, 11, 8);
    ctx.strokeStyle = 'rgba(20,60,110,0.45)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(9, 36); ctx.lineTo(9, 46); ctx.moveTo(14, 37); ctx.lineTo(14, 46); ctx.stroke();
    ctx.restore();
  }

  // ---------- the house canvas fit ----------
  function setupCanvas(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    function resize() {
      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2.5);
      const cssW = (typeof window !== 'undefined' && window.innerWidth) || 960, cssH = (typeof window !== 'undefined' && window.innerHeight) || 540;
      canvas.width = Math.max(1, Math.round(cssW * dpr)); canvas.height = Math.max(1, Math.round(cssH * dpr));
      const s = canvas.height / H;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      return { VW: canvas.width / s, VH: H, dpr, cssW, cssH };
    }
    return { ctx, resize };
  }

  window.FairyArt = {
    RAINBOW, PAL, THEMES, VH: H, FOOT: STAND_FOOT, SEAT: SIT_SEAT,
    drawFairy, drawWings, drawSparkles, drawDust, drawSky, drawCloud, drawRainbow, drawRainbowRibbon, drawWaterfall,
    drawTree, drawMushroom, drawFlower, drawGrass, drawLilyPad, drawCoin, drawKey, drawChest, drawButterfly,
    drawBug, drawCritter, drawFirefly, drawHand, setupCanvas,
  };
})();
