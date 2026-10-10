/* Fairy Flight: everything that is drawn. Isabella, the skies, clouds, trees, flowers, coins, keys, chests, bugs and critters
 * come from the shared FairyArt module (web/fairy/fairy.js); this file adds what is only in this game: the scrolling forest
 * made of cached strips, plants standing on toadstools, trees and clouds, the coin row, the hint hand and the sparkles.
 * World is 540 units tall; its width follows the screen. No blur or shadow filters; the sky, the two scenery strips and the
 * ground are drawn once into small canvases and slid past. */
(function () {
  'use strict';
  const F = window.FairyArt, L = window.FlightLogic;
  const TAU = Math.PI * 2, H = 540, GROUND = L.GROUND;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const RAINBOW = F.RAINBOW;
  function hash(a, b, c) {
    let h = (Math.imul((a * 1000) | 0, 374761393) + Math.imul((b * 1000) | 0, 668265263) + Math.imul(((c || 0) * 1000) | 0, 1103515245)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  let canvas, ctx, resizeFn, dpr = 1, s = 1, VW = 1200;
  function init(cv) {
    canvas = cv;
    const c = F.setupCanvas(cv);
    ctx = c.ctx; resizeFn = c.resize;
    resize();
  }
  function resize() {
    const r = resizeFn();
    dpr = r.dpr; VW = r.VW; s = canvas.height / H;
    invalidate();
    return r;
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toClient = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });
  function begin() { ctx.setTransform(s, 0, 0, s, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }

  // ---------- cached pictures ----------
  // Each is a small canvas painted once. cache[key] = { cv, w } (w: its width in world units).
  const cache = {};
  let cacheBytes = 0;
  // keep only the pictures of the forests in use (a mid-range phone should not hold eight skies)
  function keepThemes(a, b) {
    for (const k of Object.keys(cache)) {
      const m = k.match(/^(?:sky|strip|ground)(\d+)/);
      if (m && +m[1] !== a && +m[1] !== b) { cacheBytes -= cache[k].cv.width * cache[k].cv.height * 4; delete cache[k]; }
    }
  }
  function invalidate() { for (const k of Object.keys(cache)) delete cache[k]; cacheBytes = 0; }
  function make(key, wUnits, y0, y1, scaleMul, paint) {
    const c = cache[key];
    if (c) return c;
    const k = s * scaleMul, cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(wUnits * k)); cv.height = Math.max(1, Math.ceil((y1 - y0) * k));
    const g = cv.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, -y0 * k);
    paint(g);
    cacheBytes += cv.width * cv.height * 4;
    return (cache[key] = { cv, w: wUnits, y0, y1 });
  }
  const isCloudTheme = (theme) => theme >= 4;
  function themeOf(theme) { return F.THEMES[((theme % 8) + 8) % 8]; }
  const skyFor = (theme) => make('sky' + theme, VW, 0, H, 1, (g) => F.drawSky(g, VW, H, theme, 0));

  const LW = () => Math.max(1500, Math.ceil(VW + 200));
  // a strip of scenery that repeats every LW units; items near an edge are drawn three times so the join is seamless
  function strip(theme, k) {
    const T = themeOf(theme), lw = LW(), cloudy = isCloudTheme(theme);
    return make('strip' + theme + '_' + k, lw, cloudy ? 80 : 200, 540, 0.6, (g) => {
      const items = (fn) => { for (const off of [-lw, 0, lw]) fn(off); };
      if (!cloudy) {
        if (k === 0) { // far: small, pale trees
          g.globalAlpha = 0.5;
          const n = Math.round(lw / 150);
          for (let i = 0; i < n; i++) {
            const x = (i + hash(i, theme, 1) * 0.8) * (lw / n), sc = 0.38 + hash(i, theme, 2) * 0.28, kind = Math.floor(hash(i, theme, 3) * 4);
            items((o) => F.drawTree(g, x + o, 466, sc, kind, 0));
          }
          g.globalAlpha = 1;
          if (T.glade) F.drawWaterfall(g, lw * 0.55, 230, 40, 236, 0);
        } else { // near: bigger trees and bushes
          const n = Math.round(lw / 210);
          for (let i = 0; i < n; i++) {
            const x = (i + hash(i, theme, 4) * 0.7) * (lw / n), sc = 0.7 + hash(i, theme, 5) * 0.5, kind = Math.floor(hash(i, theme, 6) * 4);
            items((o) => F.drawTree(g, x + o, 474, sc, kind, 0));
          }
          for (let i = 0; i < n * 2; i++) {
            const x = hash(i, theme, 7) * lw, r = 16 + hash(i, theme, 8) * 16;
            items((o) => {
              g.fillStyle = T.ground[1]; g.beginPath(); g.arc(x + o, 478 - r * 0.2, r, Math.PI, TAU); g.arc(x + o + r * 1.1, 480 - r * 0.2, r * 0.75, Math.PI, TAU); g.fill();
              g.fillStyle = T.flower[i % T.flower.length]; g.beginPath(); g.arc(x + o - r * 0.3, 478 - r * 0.8, 3.4, 0, TAU); g.arc(x + o + r * 0.5, 478 - r * 0.5, 2.8, 0, TAU); g.fill();
            });
          }
        }
      } else if (k === 0) { // far: small thin clouds
        const n = Math.round(lw / 190);
        for (let i = 0; i < n; i++) {
          const x = (i + hash(i, theme, 11) * 0.8) * (lw / n), w = 90 + hash(i, theme, 12) * 90, y = 130 + hash(i, theme, 13) * 250;
          items((o) => F.drawCloud(g, x + o, y, w, { light: T.cloud[0], shade: T.cloud[1], alpha: 0.5 }));
        }
      } else { // near: big cloud banks low down
        const n = Math.round(lw / 330);
        for (let i = 0; i < n; i++) {
          const x = (i + hash(i, theme, 14) * 0.6) * (lw / n), w = 250 + hash(i, theme, 15) * 130, y = 440 + hash(i, theme, 16) * 60;
          items((o) => F.drawCloud(g, x + o, y, w, { light: T.cloud[0], shade: T.cloud[1], alpha: 0.9 }));
        }
      }
    });
  }
  // the ground: a band with a wavy edge and tufts, one tile (1200 units) that repeats
  const GT = 1200;
  function groundTile(theme) {
    const T = themeOf(theme), cloudy = isCloudTheme(theme);
    return make('ground' + theme, GT, GROUND - 70, H, 1, (g) => {
      const top = GROUND + 4;
      const gr = g.createLinearGradient(0, top - 6, 0, H);
      gr.addColorStop(0, T.ground[0]); gr.addColorStop(1, T.ground[1]);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= GT; x += 10) g.lineTo(x, top + 5 * Math.sin((x / GT) * TAU * 3) + 3 * Math.sin((x / GT) * TAU * 7 + 1));
      g.lineTo(GT, H); g.closePath(); g.fill();
      if (cloudy) { // fluffy bumps along the edge
        g.fillStyle = T.ground[0];
        for (let i = 0; i < 14; i++) { const x = (i + 0.5) * (GT / 14); g.beginPath(); g.arc(x, top + 4 * Math.sin((x / GT) * TAU * 3), 16 + hash(i, 21) * 12, Math.PI, TAU); g.fill(); }
      } else {
        for (let x = 0; x < GT; x += 46) {
          const w = 26 + hash(x, 22) * 26;
          F.drawGrass(g, x + hash(x, 23) * 20, top + 4 + 5 * Math.sin((x / GT) * TAU * 3), w, 0, hash(x, 24) < 0.5 ? undefined : '#6fd481');
        }
        for (let i = 0; i < 18; i++) {
          const x = hash(i, 25) * GT, y = top + 14 + hash(i, 26) * 40;
          g.fillStyle = T.flower[i % T.flower.length]; g.beginPath(); g.arc(x, y, 3 + hash(i, 27) * 2, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(x, y, 1.4, 0, TAU); g.fill();
        }
      }
    });
  }

  function image(c, x, y, w, alpha) {
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.drawImage(c.cv, x, y == null ? c.y0 : y, w == null ? c.w : w, c.y1 - c.y0);
    if (alpha != null) ctx.globalAlpha = 1;
  }
  function slide(c, scrollUnits, par) {
    const w = c.w, off = ((scrollUnits * par) % w + w) % w;
    for (let x = -off; x < VW; x += w) image(c, x);
  }
  // sky, the two scenery strips and the ground; `scroll` is how far the forest has gone by, in world units
  function drawScene(theme, scroll, time) {
    image(skyFor(theme), 0, 0);
    slide(strip(theme, 0), scroll, 0.12);
    slide(strip(theme, 1), scroll, 0.32);
    slide(groundTile(theme), scroll, 1);
    const T = themeOf(theme);
    if (T.night) for (let i = 0; i < 5; i++) { // a few fireflies close by
      const x = (hash(i, 31) * VW + Math.sin(time * 0.4 + i) * 40 + (scroll * 0.5)) % (VW + 40), y = 250 + hash(i, 32) * 200 + Math.sin(time * 0.9 + i * 2) * 14;
      F.drawFirefly(ctx, x < 0 ? x + VW : x, y, time + i, 1);
    }
  }

  // a soft glow painted additively: a radial gradient, no blur filter
  function glowAt(x, y, r, color, a) {
    if (a <= 0.01) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------- the things on the course ----------
  const CAPS = ['#ff4d6d', '#ff9f43', '#c86bfa', '#4cc9f0', '#ff7ab8'];
  function treeScaleFor(by) { return (GROUND - by) / 140; }
  // A plant at its screen position (q: { x, y: head, by: base }). bloom: 0 (a closed bud) to 1 (open).
  function drawPlant(p, q, bloom, time, theme) {
    const T = themeOf(theme), x = q.x, by = q.by;
    if (x < -220 || x > VW + 220) return;
    if (p.sup === 'ground') F.drawGrass(ctx, x - 22, GROUND + 6, 44, time, undefined);
    else if (p.sup === 'toad') F.drawMushroom(ctx, x, GROUND + 6, p.sz, CAPS[p.id % CAPS.length]);
    else if (p.sup === 'tree') {
      const sc = treeScaleFor(by);
      F.drawTree(ctx, x, GROUND + 6, sc, p.sz, time);
    } else { // cloud, moving cloud
      const w = p.sz, cl = isCloudTheme(theme) ? T.cloud : ['#ffffff', '#cde6fb'];
      F.drawCloud(ctx, x - w * 0.5, by + 0.3 * w, w, { light: cl[0], shade: cl[1] });
    }
    // a few leaves where the stem comes out
    if (p.sup !== 'ground') {
      ctx.fillStyle = '#4fbf6a';
      for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + k * 11, by + 4, 11, 4.5, k * -0.4, 0, TAU); ctx.fill(); }
    }
    // a closed bud glows and twinkles, so it is easy to see from afar
    if (bloom < 0.5) {
      const a = (0.5 - bloom) * 2, pulse = 0.55 + 0.25 * Math.sin(time * 4 + p.id * 1.7);
      glowAt(x, q.y - 4, 46, 'rgba(255,240,150,1)', 0.55 * a * pulse);
      ctx.save(); ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(time * 5 + p.id)); ctx.fillStyle = '#fff6b0'; star4(x + 20, q.y - 26, 5); star4(x - 22, q.y + 6, 3.6); ctx.restore();
    }
    F.drawFlower(ctx, x, p.sup === 'ground' ? GROUND + 4 : by + 4, L.PSC, p.kind, bloom, time);
    if (bloom > 0.02 && bloom < 1) F.drawSparkles(ctx, x, q.y, time, 6, 38, 1 - bloom * 0.5);
  }
  function drawEnemy(e, q, time) {
    if (q.x < -120 || q.x > VW + 120) return;
    if (e.cls === 'critter') F.drawCritter(ctx, q.x, GROUND + 6, time, e.kind, 1.1);
    else F.drawBug(ctx, q.x, q.y, time, e.kind, 1.05);
  }
  function drawKeyObj(x, y, time, scale) {
    F.drawSparkles(ctx, x, y, time, 5, 44, 0.9);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.2 * Math.sin(time * 4);
    const g = ctx.createRadialGradient(x, y, 4, x, y, 50);
    g.addColorStop(0, 'rgba(255,230,120,0.9)'); g.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 50, 0, TAU); ctx.fill();
    ctx.restore();
    F.drawKey(ctx, x, y + Math.sin(time * 2.4) * 4, scale || 1.5, time);
  }
  // the chest, at x, its base on the ground; open 0..1
  function drawChestObj(x, open, time) {
    ctx.save(); ctx.translate(x, GROUND + 14); ctx.scale(1.45, 1.45);
    F.drawChest(ctx, 0, 0, open, time);
    ctx.restore();
  }
  function wandTip(x, y, tilt) { const c = Math.cos(tilt), sn = Math.sin(tilt); return { x: x + 58 * c + 11 * sn, y: y + 58 * sn - 11 * c }; }
  // Isabella. o: { pose, tilt, alpha, happy, dust, glow, flip, scale }
  function drawIsabella(x, y, time, o) {
    o = o || {};
    F.drawFairy(ctx, x, y, time, { pose: o.pose || 'fly', scale: o.scale || 1, tilt: o.tilt || 0, alpha: o.alpha, happy: o.happy, dust: o.dust || 0, glow: o.glow || 0, flip: !!o.flip });
  }
  function drawDizzy(x, y, time, u) {
    ctx.save(); ctx.fillStyle = '#ffd93d'; ctx.globalAlpha = clamp(u * 1.6, 0, 1);
    for (let i = 0; i < 3; i++) {
      const a = time * 7 + (i * TAU) / 3, px = x + Math.cos(a) * 26, py = y + Math.sin(a) * 7;
      ctx.beginPath();
      for (let j = 0; j < 10; j++) { const r = j % 2 ? 3.2 : 8, an = (j * Math.PI) / 5 - Math.PI / 2; ctx.lineTo(px + Math.cos(an) * r, py + Math.sin(an) * r); }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- the coin row ----------
  let coinSprite = null, coinSpriteS = 0;
  function sprite() {
    if (coinSprite && coinSpriteS === s) return coinSprite;
    const cv = document.createElement('canvas'), k = s;
    cv.width = Math.ceil(34 * k); cv.height = Math.ceil(34 * k);
    const g = cv.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0);
    F.drawCoin(g, 17, 17, 0, 13);
    coinSpriteS = s; return (coinSprite = cv);
  }
  function hudLayout(target) {
    const n = Math.max(1, target), sp = Math.min(34, (VW - 360) / n), w = n * sp, x1 = VW - 28, x0 = x1 - w, y = 40;
    return { x0, sp, y, w, keyX: x0 - 42, slots: Array.from({ length: n }, (_, i) => ({ x: x0 + sp * (i + 0.5), y, r: Math.min(13, sp * 0.4) })) };
  }
  // shown: coins in their rings; key: the key is in hand
  function drawHud(target, shown, key, time, pulseAt) {
    const hl = hudLayout(target);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    const px = hl.keyX - 28, pw = hl.x0 + hl.w + 14 - px;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, hl.y - 25, pw, 50, 25) : ctx.rect(px, hl.y - 25, pw, 50); ctx.fill();
    for (let i = 0; i < hl.slots.length; i++) {
      const sl = hl.slots[i];
      if (i < shown) {
        const sc = (pulseAt === i ? 1.25 : 1) * (sl.r / 13);
        ctx.drawImage(sprite(), sl.x - 17 * sc, sl.y - 17 * sc, 34 * sc, 34 * sc);
      } else {
        ctx.strokeStyle = 'rgba(120,70,170,0.45)'; ctx.lineWidth = 2.2; ctx.fillStyle = 'rgba(120,70,170,0.14)';
        ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r, 0, TAU); ctx.fill(); ctx.stroke();
      }
    }
    // the key: dim until she holds it
    if (key) { ctx.save(); F.drawKey(ctx, hl.keyX, hl.y, 0.8, time); ctx.restore(); }
    else {
      ctx.globalAlpha = 0.45;
      ctx.save(); ctx.translate(hl.keyX, hl.y); ctx.scale(0.8, 0.8); ctx.rotate(-0.5);
      ctx.strokeStyle = 'rgba(120,70,170,0.9)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.arc(-16, 0, 11, 0, TAU); ctx.moveTo(-5, 0); ctx.lineTo(25, 0); ctx.moveTo(16, 0); ctx.lineTo(16, 9); ctx.moveTo(24, 0); ctx.lineTo(24, 7); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  // the hint: a hand sliding from where she is to the height of the next bud; u in 0..1 along the slide
  function drawHint(x, y0, y1, u, time) {
    const k = smooth(clamp(u * 1.25, 0, 1)), y = y0 + (y1 - y0) * k;
    ctx.save();
    ctx.globalAlpha = 0.9 * Math.min(1, u * 8) * Math.min(1, (1 - u) * 6 + 0.35);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) { const yy = y0 + (y1 - y0) * (i / 6) * Math.min(1, k * 1.2); ctx.beginPath(); ctx.arc(x, yy, 4.5, 0, TAU); ctx.fill(); }
    ctx.restore();
    F.drawHand(ctx, x, y, time, Math.min(1, u * 8) * Math.min(1, (1 - u) * 6 + 0.3));
  }

  // ---------- sparkles and things that fly ----------
  const parts = [];
  const MAXP = 320;
  const rnd = (a, b) => a + Math.random() * (b - a);
  function add(p) { if (parts.length < MAXP) parts.push(p); }
  function star4(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.28, y - r * 0.28); ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.28, y + r * 0.28);
    ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.28, y + r * 0.28); ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.28, y - r * 0.28); ctx.closePath(); ctx.fill();
  }
  // kinds: 'bloom' (sparkles and petals), 'coin' (a small shower of gold), 'bonk' (stars and puffs), 'twinkle', 'trail', 'confetti', 'land'
  function burst(kind, x, y, n, col) {
    if (kind === 'bloom') {
      for (let i = 0; i < 14; i++) { const a = rnd(0, TAU), v = rnd(50, 150); add({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, g: 60, life: 0, max: rnd(0.6, 1.1), r: rnd(4, 8), c: RAINBOW[i % 7] }); }
      for (let i = 0; i < 6; i++) add({ t: 'petal', x: x + rnd(-14, 14), y: y + rnd(-10, 4), vx: rnd(-40, 40), vy: rnd(-70, -20), g: 90, life: 0, max: rnd(1, 1.6), r: rnd(3, 5), c: col || '#ffc1dd', rot: rnd(0, TAU), vr: rnd(-4, 4) });
    } else if (kind === 'coin') {
      for (let i = 0; i < (n || 8); i++) { const a = rnd(-2.6, -0.5), v = rnd(120, 260); add({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420, life: 0, max: rnd(0.6, 1), r: rnd(4, 7), c: i % 2 ? '#fff3a0' : '#ffd23f' }); }
    } else if (kind === 'bonk') {
      for (let i = 0; i < 9; i++) { const a = rnd(0, TAU), v = rnd(80, 190); add({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 120, life: 0, max: rnd(0.5, 0.9), r: rnd(5, 9), c: i % 3 ? '#ffd93d' : '#ffffff' }); }
      for (let i = 0; i < 5; i++) add({ t: 'puff', x: x + rnd(-14, 14), y: y + rnd(-10, 10), vx: rnd(-30, 30), vy: rnd(-40, -10), g: 0, life: 0, max: rnd(0.5, 0.8), r: rnd(8, 15), c: '#ffffff' });
    } else if (kind === 'twinkle') {
      add({ t: 'spark', x: x + rnd(-n, n), y: y + rnd(-n, n), vx: rnd(-10, 10), vy: rnd(-24, -6), g: 0, life: 0, max: rnd(0.5, 0.9), r: rnd(3, 6), c: col || '#fff8c0' });
    } else if (kind === 'trail') {
      add({ t: 'spark', x, y, vx: rnd(-50, -20), vy: rnd(-10, 14), g: 25, life: 0, max: rnd(0.5, 0.9), r: rnd(2.4, 4.6), c: col || RAINBOW[(Math.random() * 7) | 0] });
    } else if (kind === 'confetti') {
      for (let i = 0; i < 70; i++) add({ t: 'conf', x: rnd(0, VW), y: rnd(-60, -10), vx: rnd(-40, 40), vy: rnd(60, 150), g: 0, life: 0, max: 3.6, r: rnd(4, 7), c: RAINBOW[i % 7], rot: rnd(0, TAU), vr: rnd(-6, 6) });
    } else if (kind === 'land') {
      for (let i = 0; i < 10; i++) add({ t: 'puff', x: x + rnd(-30, 30), y: y + rnd(-4, 4), vx: rnd(-60, 60), vy: rnd(-20, -4), g: 0, life: 0, max: rnd(0.4, 0.8), r: rnd(6, 12), c: '#ffffff' });
    }
  }
  // the dust the wand throws at a bud: sparkles that fly from the wand to the plant
  function sprinkle(x0, y0, x1, y1) {
    for (let i = 0; i < 9; i++) add({ t: 'seek', x0, y0, x1: x1 + rnd(-8, 8), y1: y1 + rnd(-8, 8), life: -i * 0.025, max: rnd(0.28, 0.4), r: rnd(4, 7), c: RAINBOW[i % 7], arc: rnd(-30, 30) });
  }
  // coins fountain out of the chest, fall, and sparkle
  function fountain(x, y, n) {
    for (let i = 0; i < n; i++) add({ t: 'coin', x, y, vx: rnd(-170, 170), vy: rnd(-460, -240), g: 600, life: -i * 0.03, max: rnd(1.3, 1.9), r: rnd(8, 12), c: '#ffd23f', ph: rnd(0, TAU) });
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.life < 0 || p.t === 'seek') continue;
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot != null) p.rot += p.vr * dt;
    }
  }
  function drawParts() {
    ctx.save();
    for (const p of parts) {
      if (p.life < 0) continue;
      const u = p.life / p.max;
      if (p.t === 'spark') { ctx.globalAlpha = 1 - u * u; ctx.fillStyle = p.c; star4(p.x, p.y, p.r * (1 - u * 0.5)); }
      else if (p.t === 'seek') {
        const k = smooth(u), x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k - Math.sin(k * Math.PI) * 40 + p.arc * Math.sin(k * Math.PI);
        ctx.globalAlpha = 1 - u * 0.4; ctx.fillStyle = p.c; star4(x, y, p.r);
      } else if (p.t === 'petal') { ctx.globalAlpha = 1 - u * u; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.6, p.r * 0.8, 0, 0, TAU); ctx.fill(); ctx.restore(); }
      else if (p.t === 'puff') { ctx.globalAlpha = 0.7 * (1 - u); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + u), 0, TAU); ctx.fill(); }
      else if (p.t === 'conf') { ctx.globalAlpha = 1 - u * u * u; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r); ctx.restore(); }
      else if (p.t === 'coin') { ctx.globalAlpha = 1 - Math.max(0, u - 0.7) / 0.3; F.drawCoin(ctx, p.x, p.y, p.ph + p.life * 8, p.r); }
    }
    ctx.restore();
  }

  window.FlightArt = {
    H, GROUND, init, resize, begin, toWorld, toClient, keepThemes,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get canvas() { return canvas; }, get ctx() { return ctx; },
    drawScene, drawPlant, drawEnemy, drawKeyObj, drawChestObj, drawIsabella, drawDizzy, drawHud, hudLayout, drawHint, wandTip,
    burst, sprinkle, fountain, stepParts, drawParts,
    get partCount() { return parts.length; }, clearParts() { parts.length = 0; },
    cacheInfo() { return { keys: Object.keys(cache), bytes: cacheBytes }; },
  };
})();
