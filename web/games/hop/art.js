/* Toadstool Hop: everything you see that is specific to this game. Isabella the Fairy, the skies, clouds, lily pads, toadstools,
 * coins, keys, butterflies and the chest all come from the shared FairyArt module (web/fairy/fairy.js); this file adds the
 * waterfall-glade backdrop that scrolls, the river, the platforms as they stand over it, the frog, the splash and the particles.
 * World = 540 units tall. Nothing here uses a shadow or blur filter or a random number in a draw call (particles take theirs from
 * the game when they are made). */
(function () {
  'use strict';
  const F = window.FairyArt;
  const H = F.VH, TAU = Math.PI * 2;
  const WATER = 458;          // the top of a lily pad (must match logic.js)
  const RIVER = 424;          // where the river starts at the far bank
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

  let canvas = null, ctx = null, fit = null, VW = 960, scale = 1, dpr = 1;
  function init(cv) {
    canvas = cv;
    const s = F.setupCanvas(cv);
    ctx = s.ctx; fit = s.resize;
    resize();
  }
  function resize() { const r = fit(); VW = r.VW; dpr = r.dpr; scale = canvas.height / H; art.VW = VW; art.dpr = dpr; art.scale = scale; return r; }
  function begin() { ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / scale, y: (cy * dpr) / scale });   // a screen point in world units (screen space, not camera space)
  const toClient = (x, y) => ({ x: (x * scale) / dpr, y: (y * scale) / dpr });

  function glow(x, y, r, col, a) {
    if (a <= 0.003 || r <= 0.5) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function star4(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.28 : r, a = (i * Math.PI) / 4 - Math.PI / 2; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const hash = (a, b) => { let h = (Math.imul((a * 1000) | 0, 374761393) + Math.imul((b * 1000) | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

  // ---------- the river colours for each of the eight skies ----------
  const RIV = [['#a6e0f5', '#4bb0e0'], ['#8fd7f0', '#35a2d6'], ['#88e6dc', '#2cb0bd'], ['#78d2f7', '#2f93dc'], ['#a4dcff', '#4fa9f2'], ['#ffc08a', '#d2649c'], ['#4658bd', '#202a7a'], ['#aee4ff', '#62b0f7']];
  const CAPS = ['#ff4d6d', '#c86bfa', '#ff9f43', '#4cc9f0', '#ff7ab8', '#ffd93d'];

  // ---------- the backdrop: sky, clouds, a cliff with a waterfall, trees on the far bank, the river ----------
  // cam: the world x at the left edge of the screen. Every layer is a pure function of (cam, time).
  function layer(k, period, cam, fn) {
    const off = cam * k, i0 = Math.floor(off / period) - 1, i1 = Math.floor((off + VW) / period) + 1;
    for (let i = i0; i <= i1; i++) fn(i, i * period - off);
  }
  function drawScene(theme, cam, time, o) {
    o = o || {};
    const T = F.THEMES[theme % 8];
    F.drawSky(ctx, VW, H, theme, time);
    // clouds far away, drifting
    layer(0.12, 520, cam, (i, sx) => {
      const w = 150 + hash(i, 1) * 110, y = 70 + hash(i, 2) * 140;
      F.drawCloud(ctx, sx + hash(i, 3) * 200 + time * 4, y, w, { light: T.cloud[0], shade: T.cloud[1], alpha: 0.85 });
    });
    // cliffs with waterfalls
    layer(0.3, 1250, cam, (i, sx) => {
      const x = sx + 260 + hash(i, 4) * 300, w = 100 + hash(i, 5) * 40, topY = 120 + hash(i, 6) * 60, cw = w + 120;
      ctx.fillStyle = T.night ? '#4f5a96' : '#8794ae';
      ctx.beginPath(); ctx.moveTo(x - cw / 2 - 40, RIVER + 6); ctx.quadraticCurveTo(x - cw / 2, topY + 10, x - cw / 2 + 36, topY - 6); ctx.lineTo(x + cw / 2 - 36, topY - 6);
      ctx.quadraticCurveTo(x + cw / 2, topY + 10, x + cw / 2 + 40, RIVER + 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.night ? '#3d4780' : '#6f7c97'; ctx.beginPath(); ctx.moveTo(x + cw * 0.12, RIVER + 6); ctx.quadraticCurveTo(x + cw * 0.3, topY + 60, x + cw / 2 - 36, topY - 6); ctx.lineTo(x + cw / 2 - 36, topY - 6);
      ctx.quadraticCurveTo(x + cw / 2, topY + 10, x + cw / 2 + 40, RIVER + 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.ground[1]; rrect(x - cw / 2 + 10, topY - 16, cw - 20, 24, 12); ctx.fill();
      ctx.fillStyle = T.ground[0]; rrect(x - cw / 2 + 16, topY - 18, cw - 32, 12, 6); ctx.fill();
      F.drawTree(ctx, x - cw / 2 + 40, topY - 8, 0.55, i + 1, time);
      F.drawTree(ctx, x + cw / 2 - 44, topY - 8, 0.5, i + 2, time);
      F.drawWaterfall(ctx, x, topY - 6, w, RIVER - topY + 4, time);
    });
    // the far bank: a strip of grass with trees, bluebells and toadstools
    const bg = ctx.createLinearGradient(0, RIVER - 24, 0, RIVER + 8);
    bg.addColorStop(0, T.ground[0]); bg.addColorStop(1, T.ground[1]);
    ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(0, RIVER + 8); ctx.lineTo(0, RIVER - 14);
    for (let x = 0; x <= VW + 40; x += 40) ctx.lineTo(x, RIVER - 18 - Math.sin((x + cam * 0.55) * 0.021) * 6);
    ctx.lineTo(VW, RIVER + 8); ctx.closePath(); ctx.fill();
    layer(0.55, 210, cam, (i, sx) => {
      const x = sx + hash(i, 7) * 100, kind = Math.floor(hash(i, 8) * 4), sc = 0.7 + hash(i, 9) * 0.35;
      F.drawTree(ctx, x, RIVER - 6, sc, kind, time);
      if (hash(i, 10) < 0.6) F.drawFlower(ctx, x + 70, RIVER - 4, 0.55 + hash(i, 11) * 0.3, Math.floor(hash(i, 12) * 5), 1, time);
      if (hash(i, 13) < 0.3) F.drawMushroom(ctx, x + 108, RIVER - 2, 0.42, CAPS[Math.floor(hash(i, 14) * 6)]);
    });
    // the river
    const rv = RIV[theme % 8], wg = ctx.createLinearGradient(0, RIVER, 0, H);
    wg.addColorStop(0, rv[0]); wg.addColorStop(1, rv[1]);
    ctx.fillStyle = wg; ctx.fillRect(0, RIVER, VW, H - RIVER);
    ctx.save();
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 2;
    for (let r = 0; r < 7; r++) {
      const y = RIVER + 14 + r * 15 + (r % 2) * 5, sp = 0.85 + r * 0.045, ph = time * (r % 2 ? 0.6 : -0.5);
      ctx.beginPath();
      for (let x = -20; x <= VW + 20; x += 18) { const wx = x + cam * sp; ctx.lineTo(x, y + Math.sin(wx * 0.034 + ph + r) * 2.4); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 18; i++) {
      const wx = (hash(i, 15) * 1800 + time * 6 * (1 + hash(i, 16))) % 1800, x = ((wx - cam * 0.9) % 1800 + 1800) % 1800 - 100, y = RIVER + 10 + hash(i, 17) * 100;
      if (x < -20 || x > VW + 20) continue;
      const tw = Math.max(0, Math.sin(time * (1.5 + hash(i, 18)) + i * 2));
      ctx.globalAlpha = 0.25 + 0.6 * tw; star4(x, y, 2 + 2.6 * tw);
    }
    ctx.restore();
    if (T.night) { // fireflies low over the river
      for (let i = 0; i < 8; i++) {
        const x = (((hash(i, 19) * 1400 + Math.sin(time * 0.4 + i) * 30 - cam * 0.8) % 1400) + 1400) % 1400 - 100, y = 300 + hash(i, 20) * 110 + Math.sin(time * 0.7 + i * 2) * 10;
        if (x > -30 && x < VW + 30) F.drawFirefly(ctx, x, y, time + i, 0.9);
      }
    }
  }
  // the front of the water, drawn over the feet of stems so they look planted in it
  function drawWaterFront(theme, cam, time) {
    const rv = RIV[theme % 8];
    ctx.save(); ctx.translate(cam, 0);   // called inside the world transform: the water covers the whole screen
    const g = ctx.createLinearGradient(0, WATER + 10, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(0.4, rv[0] + 'aa'); g.addColorStop(1, rv[1] + 'dd');
    ctx.fillStyle = g; ctx.fillRect(0, WATER + 10, VW, H - WATER - 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let r = 0; r < 3; r++) {
      const y = WATER + 22 + r * 20;
      ctx.beginPath();
      for (let x = -20; x <= VW + 20; x += 18) ctx.lineTo(x, y + Math.sin((x + cam) * 0.03 + time * (r % 2 ? 0.8 : -0.7) + r * 2) * 2.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- the platforms ----------
  // p: a platform from the course. (x, y): where its standing surface is right now. sq: a squash from a landing (0..1).
  function drawStem(x, top, sc, bottom) {
    const w = 9 * sc, y1 = Math.max(bottom, top + 4);
    ctx.fillStyle = '#fff4dd'; ctx.beginPath(); ctx.moveTo(x - w, top); ctx.quadraticCurveTo(x - w * 1.1, (top + y1) / 2, x - w * 1.35, y1); ctx.lineTo(x + w * 1.35, y1); ctx.quadraticCurveTo(x + w * 1.1, (top + y1) / 2, x + w, top); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(190,150,110,0.3)'; ctx.beginPath(); ctx.moveTo(x + w * 0.2, top); ctx.lineTo(x + w, top); ctx.quadraticCurveTo(x + w * 1.1, (top + y1) / 2, x + w * 1.35, y1); ctx.lineTo(x + w * 0.5, y1); ctx.quadraticCurveTo(x + w * 0.7, (top + y1) / 2, x + w * 0.2, top); ctx.fill();
  }
  function ripple(x, y, rw, time, seed) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.6;
    for (let k = 0; k < 2; k++) {
      const u = (time * 0.45 + k * 0.5 + seed * 0.13) % 1;
      ctx.globalAlpha = (1 - u) * 0.8; ctx.beginPath(); ctx.ellipse(x, y, rw * (0.7 + u * 0.55), rw * 0.16 * (0.8 + u * 0.5), 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  function drawPlatform(p, x, y, T, time, o) {
    o = o || {};
    const sq = o.sq || 0, bounce = Math.sin(clamp(sq, 0, 1) * Math.PI) * 0.1;
    if (p.kind === 'mush') {
      const s = p.sz, g = y + 53 * s;
      ripple(x, Math.max(g + 8, WATER + 12), p.hw * 1.1, time, p.id);
      drawStem(x, g - 4, s, WATER + 26);
      ctx.save(); ctx.translate(x, g); ctx.scale(1 + bounce * 0.7, 1 - bounce); ctx.translate(-x, -g);
      F.drawMushroom(ctx, x, g, s, CAPS[p.pal % 6]);
      ctx.restore();
    } else if (p.kind === 'pad') {
      ripple(x, y + 6, p.hw, time, p.id);
      ctx.save(); ctx.translate(x, y + 2); ctx.scale(1 + bounce * 0.5, 1 - bounce * 0.5); ctx.translate(-x, -y - 2);
      F.drawLilyPad(ctx, x, y + 2, p.hw, { time: time + p.id, flower: p.pal % 3 === 0 });
      ctx.restore();
    } else if (p.kind === 'cloud') {
      const w = p.sz;
      ctx.save(); ctx.translate(x, y); ctx.scale(1 + bounce * 0.4, 1 - bounce * 0.9); ctx.translate(-x, -y);
      F.drawCloud(ctx, x - w / 2, y + 0.115 * w, w, { light: T.cloud[0], shade: T.cloud[1] });
      ctx.restore();
    } else { // a mossy bank
      drawBank(p, x, y, T, time, sq);
    }
    if (o.glow > 0) glow(x, y - 4, p.hw * 1.15, 'rgba(255,236,150,1)', 0.5 * o.glow);
  }
  function drawBank(p, x, y, T, time, sq) {
    const hw = p.hw, top = y, bot = WATER + 28;
    void sq;
    ctx.fillStyle = '#9b6a3a'; ctx.beginPath(); ctx.moveTo(x - hw - 10, bot); ctx.bezierCurveTo(x - hw, top + 30, x - hw * 0.9, top + 6, x - hw * 0.7, top + 4); ctx.lineTo(x + hw * 0.7, top + 4);
    ctx.bezierCurveTo(x + hw * 0.9, top + 6, x + hw, top + 30, x + hw + 10, bot); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7d5128'; ctx.beginPath(); ctx.moveTo(x + hw * 0.1, bot); ctx.bezierCurveTo(x + hw * 0.2, top + 40, x + hw * 0.6, top + 20, x + hw * 0.7, top + 4); ctx.lineTo(x + hw * 0.7, top + 4);
    ctx.bezierCurveTo(x + hw * 0.9, top + 6, x + hw, top + 30, x + hw + 10, bot); ctx.closePath(); ctx.fill();
    const gg = ctx.createLinearGradient(0, top - 6, 0, top + 16);
    gg.addColorStop(0, T.ground[0]); gg.addColorStop(1, T.ground[1]);
    ctx.fillStyle = gg; rrect(x - hw * 0.86, top - 3, hw * 1.72, 20, 10); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x - hw * 0.74, top + 8, hw * 0.2, 11, 0, 0, TAU); ctx.ellipse(x + hw * 0.74, top + 8, hw * 0.2, 11, 0, 0, TAU); ctx.fill();
    F.drawGrass(ctx, x - hw * 0.8, top + 1, hw * 1.6, time, T.ground[1]);
    for (let i = 0; i < 3; i++) F.drawFlower(ctx, x - hw * 0.62 + i * hw * 0.5 + (p.id % 2) * 10, top + 3, 0.5, (i + p.id) % 5, 1, time);
    ripple(x - hw * 0.5, bot + 4, hw * 0.55, time, 1); ripple(x + hw * 0.6, bot + 6, hw * 0.5, time, 2);
  }

  // ---------- items ----------
  const BFCOL = ['#ff8fc0', '#7bd5ff', '#ffd633', '#c86bfa', '#5ad17a'];
  function drawCoin(x, y, time, r) { F.drawCoin(ctx, x, y, time * 4 + x * 0.02, r || 14); }
  function drawKey(x, y, time, sc) { glow(x, y, 34, 'rgba(255,230,120,1)', 0.45); F.drawKey(ctx, x, y, sc || 1, time); }
  function drawButterfly(x, y, time, i, sc) { glow(x, y, 30, 'rgba(255,255,255,1)', 0.25); F.drawButterfly(ctx, x, y, time + i, BFCOL[i % 5], sc || 1.3); }

  // ---------- Isabella ----------
  // pose from the rules: { x, y, mode } with (x, y) = her feet. fly/fall/hover draw by the waist.
  const SC = 1.3, FOOT = F.FOOT * SC;
  function drawIsabella(pose, time, o) {
    o = o || {};
    const m = pose.mode;
    let tilt = o.tilt || 0, y = pose.y, name = m;
    if (m === 'fly') { y = pose.y - FOOT * 0.9; tilt = -0.18 * Math.cos((pose.u == null ? 0.5 : pose.u) * Math.PI); }
    else if (m === 'fall') { y = pose.y - FOOT; name = 'fall'; }
    F.drawFairy(ctx, pose.x, y, time, { pose: name, scale: SC, tilt: pose.face < 0 ? -tilt : tilt, flip: pose.face < 0, dust: o.dust || 0, happy: o.happy, alpha: o.alpha });
  }
  function drawDizzy(x, y, time, a) {
    ctx.save(); ctx.globalAlpha = a == null ? 1 : a;
    const cols = ['#ffd93d', '#ff7ab8', '#4cc9f0'];
    for (let i = 0; i < 3; i++) {
      const ang = time * 4.5 + (i * TAU) / 3;
      ctx.fillStyle = cols[i]; star4(x + Math.cos(ang) * 24, y + Math.sin(ang) * 7, 5.4);
    }
    ctx.restore();
  }

  // ---------- the frog: round, green, grinning, with a little pink flower on its head ----------
  // (x, y): where it meets the water. pop: 0 hidden .. 1 fully up. squat: 0..1 crouching to launch. happy: a bigger smile.
  function drawFrog(x, y, time, o) {
    o = o || {};
    const pop = smooth(o.pop == null ? 1 : o.pop), sq = clamp(o.squat || 0, 0, 1);
    if (pop <= 0.02) return;
    const bob = Math.sin(time * 5) * 1.6;
    ctx.save(); ctx.translate(x, y + (1 - pop) * 44 + bob);
    ctx.beginPath(); ctx.rect(-80, -120, 160, 120 - (1 - pop) * 0 + 0); ctx.clip();
    ctx.scale(1 + sq * 0.14, 1 - sq * 0.22);
    // body
    ctx.fillStyle = '#4fb650'; ctx.beginPath(); ctx.ellipse(0, -18, 40, 30, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7fd36f'; ctx.beginPath(); ctx.ellipse(0, -9, 29, 19, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(-16, -36, 11, 5, -0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3f9d44'; for (const s of [[18, -33, 3.6], [28, -22, 3], [8, -40, 2.8], [-24, -28, 3]]) { ctx.beginPath(); ctx.arc(s[0], s[1], s[2], 0, TAU); ctx.fill(); }
    // eyes
    const blink = (time % 3.6) < 0.1;
    for (const k of [-1, 1]) {
      const ex = k * 20;
      ctx.fillStyle = '#4fb650'; ctx.beginPath(); ctx.arc(ex, -44, 13, 0, TAU); ctx.fill();
      if (blink) { ctx.strokeStyle = '#2a170a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ex, -44, 8, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke(); continue; }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, -44, 10, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a170a'; ctx.beginPath(); ctx.arc(ex + (o.look || 0) * 2 - k * 1, -43, 5.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + (o.look || 0) * 2 - k * 1 + 1.8, -45.5, 1.8, 0, TAU); ctx.fill();
    }
    // smile and cheeks
    ctx.strokeStyle = '#2f6b32'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -22, o.happy ? 19 : 15, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
    ctx.fillStyle = 'rgba(255,120,150,0.45)'; ctx.beginPath(); ctx.arc(-30, -24, 5.5, 0, TAU); ctx.arc(30, -24, 5.5, 0, TAU); ctx.fill();
    // front hands on the water
    ctx.fillStyle = '#5ec35c'; for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(k * 36, -3, 11, 6, k * 0.25, 0, TAU); ctx.fill(); }
    // a little flower on its head
    ctx.save(); ctx.translate(0, -60);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#ffb3d6' : '#ff8fc0'; ctx.beginPath(); ctx.ellipse(Math.cos(i * 1.2566 - 1.5) * 6, Math.sin(i * 1.2566 - 1.5) * 6, 4.4, 3, i * 1.2566 - 1.5, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ffd633'; ctx.beginPath(); ctx.arc(0, 0, 2.8, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
    // the water line in front of it
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.ellipse(x, y + 2, 46, 7, 0, 0, TAU); ctx.stroke(); ctx.restore();
  }

  // ---------- the treasure chest, sat on the end bank ----------
  function drawChest(x, y, open, time) {
    ctx.save(); ctx.translate(x, y); ctx.scale(0.8, 0.8);
    F.drawChest(ctx, 0, 0, open, time);
    ctx.restore();
  }

  // ---------- particles: drops, ripples, sparkles, coins ----------
  const parts = [];
  const MAXP = 360;
  function burst(kind, x, y, n, rnd, col) {
    const R = rnd || Math.random;
    n = n || 12;
    if (kind === 'splash') {
      parts.push({ k: 'ring', x, y: WATER + 8, t: 0, life: 1.0, r: 18 }); parts.push({ k: 'ring', x, y: WATER + 8, t: -0.18, life: 1.1, r: 12 });
      for (let i = 0; i < n; i++) parts.push({ k: 'drop', x: x + (R() - 0.5) * 24, y: WATER + 4, vx: (R() - 0.5) * 170, vy: -170 - R() * 170, t: 0, life: 0.9 + R() * 0.4, r: 2.6 + R() * 3, col: R() < 0.5 ? '#ffffff' : '#bfeaff' });
    } else if (kind === 'sparkle') {
      for (let i = 0; i < n; i++) { const a = R() * TAU, s = 40 + R() * 110; parts.push({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, t: 0, life: 0.6 + R() * 0.5, r: 3 + R() * 3.5, col: col || F.RAINBOW[Math.floor(R() * 7)] }); }
    } else if (kind === 'coin') {
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (R() - 0.5) * 2.2, s = 90 + R() * 150; parts.push({ k: 'coin', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 1.0 + R() * 0.5, r: 8 + R() * 3, ph: R() * 6 }); }
    } else if (kind === 'land') {
      for (let i = 0; i < n; i++) { const a = Math.PI + R() * Math.PI, s = 30 + R() * 70; parts.push({ k: 'spark', x: x + (R() - 0.5) * 30, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, t: 0, life: 0.45 + R() * 0.3, r: 2.4 + R() * 2.4, col: col || '#fff6b0' }); }
    }
    while (parts.length > MAXP) parts.shift();
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.t += dt;
      if (q.t < 0) continue;
      if (q.k === 'drop') { q.vy += 520 * dt; q.x += q.vx * dt; q.y += q.vy * dt; if (q.y > WATER + 6 && q.vy > 0) q.t = q.life; }
      else if (q.k === 'spark') { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 60 * dt; }
      else if (q.k === 'coin') { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 520 * dt; }
      if (q.t >= q.life) parts.splice(i, 1);
    }
  }
  function drawParts() {
    ctx.save();
    for (const q of parts) {
      if (q.t < 0) continue;
      const u = clamp(q.t / q.life, 0, 1);
      if (q.k === 'ring') { ctx.globalAlpha = (1 - u) * 0.9; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.ellipse(q.x, q.y, q.r + u * 70, (q.r + u * 70) * 0.2, 0, 0, TAU); ctx.stroke(); }
      else if (q.k === 'drop') { ctx.globalAlpha = 1 - u * u; ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill(); }
      else if (q.k === 'spark') { ctx.globalAlpha = 1 - u; ctx.fillStyle = q.col; star4(q.x, q.y, q.r * (1 - u * 0.4)); }
      else if (q.k === 'coin') { ctx.globalAlpha = 1 - u * u; F.drawCoin(ctx, q.x, q.y, q.ph + q.t * 9, q.r); }
    }
    ctx.restore();
  }
  function clearParts() { parts.length = 0; }

  // ---------- the progress trail along the top: one dot a platform, a chest at the end ----------
  function drawTrail(nodes, at, hasKey, time) {
    const w = Math.min(VW * 0.42, 520), x0 = VW / 2 - w / 2, y = 24, n = nodes;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
    ctx.strokeStyle = '#ffd633'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w * (at / (n - 1)), y); ctx.stroke();
    for (let i = 0; i < n; i++) { const x = x0 + w * (i / (n - 1)); ctx.fillStyle = i <= at ? '#ffd633' : 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(x, y, i === n - 1 ? 0 : 3.4, 0, TAU); ctx.fill(); }
    ctx.restore();
    // the chest at the end, and her marker
    ctx.save(); ctx.translate(x0 + w + 4, y + 3); ctx.scale(0.17, 0.17); F.drawChest(ctx, 0, 0, 0, time); ctx.restore();
    const mx = x0 + w * (at / (n - 1));
    ctx.save(); ctx.translate(mx, y - 3); ctx.fillStyle = '#ff7ab8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; star4(0, 0, 4); ctx.restore();
    if (hasKey) { ctx.save(); ctx.translate(x0 - 20, y + 1); ctx.scale(0.5, 0.5); F.drawKey(ctx, 0, 0, 1, time); ctx.restore(); }
  }

  function drawHand(x, y, time, a) { F.drawHand(ctx, x, y, time, a); }
  // a soft halo ring where a tap is wanted (the cue on the next platform)
  function drawCue(x, y, hw, time, a) {
    if (a <= 0) return;
    glow(x, y - 6, hw * 1.25, 'rgba(255,240,160,1)', 0.55 * a);
    ctx.save(); ctx.globalAlpha = a * (0.55 + 0.35 * Math.sin(time * 6)); ctx.strokeStyle = '#fff3a0'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.ellipse(x, y + 2, hw * 0.95, 9, 0, 0, TAU); ctx.stroke(); ctx.restore();
  }
  // a dotted hop arc toward a platform (shown on the Hard choice gaps, so the two ways are clear)
  function drawGuide(x0, y0, x1, y1, time, col, a) {
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = col;
    const hh = 44 + 0.17 * Math.abs(x1 - x0);
    for (let i = 1; i < 12; i++) { const u = i / 12 + ((time * 0.5) % 1) / 12; const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u - 4 * hh * u * (1 - u); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function cacheSizes() { return { parts: parts.length }; }

  const art = {
    H, WATER, RIVER, FOOT, SC, CAPS, VW, dpr, scale,
    init, resize, begin, toWorld, toClient, glow, drawScene, drawWaterFront, drawPlatform, drawCoin, drawKey, drawButterfly, drawIsabella, drawDizzy, drawFrog, drawChest,
    burst, stepParts, drawParts, clearParts, drawTrail, drawHand, drawCue, drawGuide, cacheSizes,
    get ctx() { return ctx; }, get partCount() { return parts.length; },
  };
  window.HopArt = art;
})();
