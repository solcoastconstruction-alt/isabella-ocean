/* Firefly Numbers: everything you see. All art is drawn in code, through the shared FairyArt module
 * (web/fairy/fairy.js): Isabella the Fairy, the skies, trees, flowers, fireflies, coins, the hand and the chest.
 * What is drawn here is the game's own: the glass jar with its cork, the label (numerals AND dots), the coin row,
 * the garden of flowers, the tap-zone rings and the number pops.
 * World 540 units tall, DPR capped at 2.5 (FairyArt.setupCanvas). No blur or shadow filters. */
(function () {
  'use strict';
  const F = window.FairyArt, LG = window.FireflyLogic;
  const H = 540, TAU = Math.PI * 2, ZONE = LG.ZONE;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const easeOutBack = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  const FONT = 'system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';
  const GROUP_COL = ['#e8590c', '#1c7ed6', '#2f9e44'];   // one colour per group on the label, numeral and dots alike
  const GLASS = 'rgba(214,238,255,0.20)';

  let canvas, ctx, resizeFn, dpr = 1, s = 1, VW = 1200, lay = LG.layout(1200);
  let bg = null, ringSpr = null;
  const FLOWER_KIND = [1, 3, 0, 2, 5, 4];   // the order the garden's flowers come in

  function init(cv) {
    canvas = cv;
    const c = F.setupCanvas(cv);
    ctx = c.ctx; resizeFn = c.resize;
    resize();
  }
  function resize() {
    const r = resizeFn();
    dpr = r.dpr; VW = r.VW; s = canvas.height / H;
    lay = LG.layout(VW);
    bg = null; ringSpr = null;
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toClient = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });
  function begin() { ctx.setTransform(s, 0, 0, s, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }

  // ---------- the glade (cached: it is redrawn eight times a second, which is enough for twinkling stars) ----------
  const TINT = [0.45, 0.5, 0.5, 0.42, 0.42, 0.3, 0.0, 0.42];   // dusk over the daytime skies, so the glowing fireflies show
  function renderBackdrop(theme, time) {
    if (!bg) { bg = { cv: document.createElement('canvas'), theme: -1, q: -1 }; bg.ctx = bg.cv.getContext('2d', { alpha: false }); }
    if (bg.cv.width !== canvas.width || bg.cv.height !== canvas.height) { bg.cv.width = canvas.width; bg.cv.height = canvas.height; bg.theme = -1; }
    const c = bg.ctx, T = F.THEMES[theme];
    c.setTransform(s, 0, 0, s, 0, 0);
    F.drawSky(c, VW, H, theme, time);
    // trees and mushrooms along the ground, behind the fireflies
    const kinds = [0, 1, 3, 2, 0, 1, 3, 2, 0];
    for (let i = 0; i < 9; i++) {
      const x = lay.colW + 40 + ((VW - lay.colW) * (i + 0.5)) / 9 + Math.sin(i * 7.3) * 30;
      if (i % 2 === 0) F.drawTree(c, x, 512, 0.7 + 0.18 * Math.abs(Math.sin(i * 2.1)), kinds[i], time);
    }
    // the ground
    const g = c.createLinearGradient(0, 500, 0, H);
    g.addColorStop(0, T.ground[0]); g.addColorStop(1, T.ground[1]);
    c.fillStyle = g; c.fillRect(0, 506, VW, H - 506);
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(0, 506, VW, 3);
    for (let x = 0; x < VW; x += 150) F.drawGrass(c, x, 512, 150, time, T.night ? '#6a74c8' : undefined);
    for (let i = 0; i < 6; i++) F.drawMushroom(c, lay.colW + 110 + i * ((VW - lay.colW - 200) / 5) + Math.sin(i * 3.7) * 20, 528 + (i % 2) * 4, 0.34, T.flower[i % 4]);
    c.globalAlpha = TINT[theme] || 0;
    c.fillStyle = '#12104a'; c.fillRect(0, 0, VW, H);
    c.globalAlpha = 1;
    bg.theme = theme; bg.q = Math.floor(time * 8);
  }
  function drawBackdrop(theme, time) {
    if (!bg || bg.theme !== theme || bg.q !== Math.floor(time * 8)) renderBackdrop(theme, time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg.cv, 0, 0);
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  // ---------- text ----------
  function drawNumeral(txt, x, y, size, color, alpha, outline) {
    if (alpha != null && alpha <= 0.01) return;
    ctx.save();
    if (alpha != null) ctx.globalAlpha *= alpha;
    ctx.font = '900 ' + size + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.14);
    ctx.strokeStyle = outline || 'rgba(255,255,255,0.95)'; ctx.strokeText(String(txt), x, y);
    ctx.fillStyle = color; ctx.fillText(String(txt), x, y);
    ctx.restore();
  }
  function drawSign(kind, x, y, size, color) {   // + and - drawn as shapes, never as text
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = size * 0.3;
    const h = size * 0.3;
    for (const pass of [0, 1]) {
      if (pass) { ctx.strokeStyle = color; ctx.lineWidth = size * 0.17; }
      ctx.beginPath(); ctx.moveTo(x - h, y); ctx.lineTo(x + h, y);
      if (kind === 'plus') { ctx.moveTo(x, y - h); ctx.lineTo(x, y + h); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Isabella and her jar ----------
  function drawHost(time, happy, bounce) {
    F.drawFairy(ctx, Math.round(lay.colW * 0.27), 290 - (bounce || 0), time, { pose: 'hover', scale: 1.45, wand: false, happy: !!happy, glow: happy ? 0.5 : 0.15 });
  }
  // The jar. j: { count (fireflies shown inside), full (0..1 glow), cork (null, or 0..1 how far the cork has dropped), hic (0..1 hiccup),
  // wob (0..1 a shake for a tap that does nothing), pop (0..1 the numeral just changed), numeral, time, dx, dy }
  function drawJar(j) {
    const J = lay.jar, R = J.r, time = j.time, hic = j.hic || 0, wob = j.wob || 0;
    ctx.save();
    ctx.translate(J.x + (j.dx || 0), J.y + (j.dy || 0));
    if (j.scale != null && j.scale !== 1) ctx.scale(Math.max(0.001, j.scale), Math.max(0.001, j.scale));
    if (hic > 0) { ctx.translate(Math.sin(hic * 26) * 5 * hic, -Math.abs(Math.sin(hic * 11)) * 9 * hic); ctx.scale(1 + 0.05 * Math.sin(hic * 22) * hic, 1 - 0.05 * Math.sin(hic * 22) * hic); }
    if (wob > 0) ctx.rotate(Math.sin(wob * 30) * 0.06 * wob);
    if (j.full > 0) {
      F.drawSparkles(ctx, 0, -10, time, 10, R * 1.5, j.full);
    }
    const lit = clamp((j.count || 0) / 6, 0, 1);
    glowDisc(0, 6, R * (1.25 + 0.5 * (j.full || 0)), 'rgba(255,240,140,1)', 0.12 + 0.28 * lit + 0.4 * (j.full || 0));
    // the glass
    ctx.beginPath();
    const w = 34, ny = 6 - Math.sqrt(R * R - w * w), a0 = Math.atan2(ny - 6, -w), a1 = Math.atan2(ny - 6, w);
    ctx.moveTo(-w, -R - 16); ctx.lineTo(-w, ny); ctx.arc(0, 6, R, a0, a1 - TAU, true); ctx.lineTo(w, -R - 16); ctx.closePath();
    ctx.fillStyle = GLASS; ctx.fill();
    // the count behind the fireflies
    if (j.numeral != null && j.numeral > 0) {
      const k = 1 + 0.38 * Math.max(0, 1 - (j.pop == null ? 1 : j.pop)) * 1.0;
      drawNumeral(j.numeral, 0, 8, 92 * k, 'rgba(255,255,255,0.9)', 0.55, 'rgba(40,50,120,0.5)');
    }
    // the fireflies inside
    const n = Math.min(j.count || 0, LG.JAR_MAX + 2);
    for (let i = 0; i < n; i++) {
      const rr = R * 0.6 * Math.sqrt((i + 0.6) / 10), an = i * 2.399 + 0.6;
      const x = Math.cos(an) * rr + Math.sin(time * 1.3 + i * 1.7) * 5, y = 12 + Math.sin(an) * rr * 0.9 + Math.cos(time * 1.1 + i * 2.3) * 5;
      ctx.save(); ctx.translate(x, y); ctx.scale(Math.cos(an) > 0 ? -1.55 : 1.55, 1.55);
      F.drawFirefly(ctx, 0, 0, time + i * 0.37, 1);
      ctx.restore();
    }
    // glass edge and shine
    ctx.beginPath(); ctx.moveTo(-w, -R - 16); ctx.lineTo(-w, ny); ctx.arc(0, 6, R, a0, a1 - TAU, true); ctx.lineTo(w, -R - 16);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 6, R - 12, Math.PI * 0.82, Math.PI * 1.22); ctx.stroke();
    ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(0, 6, R - 12, Math.PI * 1.3, Math.PI * 1.36); ctx.stroke();
    // the rim
    ctx.fillStyle = 'rgba(236,246,255,0.95)'; ctx.strokeStyle = 'rgba(120,150,190,0.9)'; ctx.lineWidth = 2.5;
    rr(-w - 9, -R - 28, 2 * w + 18, 14, 6); ctx.fill(); ctx.stroke();
    // the cork drops in
    if (j.cork != null) {
      const u = clamp(j.cork, 0, 1), drop = easeOutBack(u), cy = -R - 36 + (1 - drop) * -78, rot = (1 - u) * 0.5;
      ctx.save(); ctx.translate(0, cy); ctx.rotate(rot);
      ctx.fillStyle = '#c98f52'; ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-31, -13); ctx.lineTo(31, -13); ctx.lineTo(26, 17); ctx.lineTo(-26, 17); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(110,70,30,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-16, -9); ctx.lineTo(-14, 12); ctx.moveTo(4, -10); ctx.lineTo(5, 13); ctx.moveTo(18, -9); ctx.lineTo(16, 12); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function glowDisc(x, y, r, color, a) {
    if (a <= 0.004) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  }
  const mouth = () => ({ x: lay.jar.x, y: lay.jar.y - lay.jar.r - 28 });
  const plaqueRect = () => ({ x: 18, y: 366, w: lay.colW - 70, h: 100 });

  // ---------- the label: numerals on top, dots underneath ----------
  // round: a round from logic.js; inJar: fireflies in the jar now; pops: { dotIndex: seconds since it lit }; slide: 0..1 how far the label has arrived
  function drawPlaque(round, inJar, time, pops, slide) {
    const P = plaqueRect(), J = lay.jar, lm = LG.labelModel(round), dots = LG.dotStates(round, inJar);
    const sl = slide == null ? 1 : slide;
    ctx.save();
    ctx.translate(0, (1 - smooth(sl)) * 160); ctx.globalAlpha = clamp(sl * 1.6, 0, 1);
    // two strings from the jar's neck to the sign
    ctx.strokeStyle = 'rgba(255,240,200,0.85)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(J.x - 30, J.y + 60); ctx.lineTo(P.x + 36, P.y + 4); ctx.moveTo(J.x + 30, J.y + 60); ctx.lineTo(P.x + P.w - 36, P.y + 4); ctx.stroke();
    ctx.fillStyle = '#f9ecc6'; ctx.strokeStyle = '#a2702e'; ctx.lineWidth = 4.5;
    rr(P.x, P.y, P.w, P.h, 16); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(160,110,50,0.25)'; ctx.lineWidth = 2; rr(P.x + 6, P.y + 6, P.w - 12, P.h - 12, 11); ctx.stroke();
    const W = P.w - 26, cx = P.x + P.w / 2;
    // numerals
    let size = lm.numerals.length <= 3 ? 58 : 46, items = lm.numerals.map((t) => (t.t === 'num' ? { w: String(t.v).length * 0.62, t } : { w: 0.74, t }));
    const gap = 0.22, tot = () => items.reduce((a, it) => a + it.w + gap, -gap) * size;
    if (tot() > W) size = Math.floor(size * W / tot());
    let x = cx - tot() / 2, grp = 0;
    const ny = P.y + 37;
    for (const it of items) {
      const w = it.w * size;
      if (it.t.t === 'num') { drawNumeral(it.t.v, x + w / 2, ny, size, GROUP_COL[lm.numerals.length === 1 ? 0 : Math.min(grp, 2)]); grp++; }
      else drawSign(it.t.v, x + w / 2, ny, size, '#6a4a1c');
      x += w + gap * size;
    }
    // dots
    const nGroups = lm.dots.filter((d) => d.t === 'dots').length, nOps = lm.dots.length - nGroups;
    const N = lm.total, opW = 26, gp = 7;
    const step = Math.min(31, (W - nOps * opW - (nGroups - 1) * 0 - nOps * gp) / N), dr = step * 0.4;
    let dx = cx - (N * step + nOps * (opW + gp)) / 2, di = 0, g2 = 0;
    const dy = P.y + 78;
    for (const d of lm.dots) {
      if (d.t === 'op') { drawSign(d.v, dx + (opW + gp) / 2, dy, 20, '#6a4a1c'); dx += opW + gp; continue; }
      const col = GROUP_COL[nGroups === 1 ? 0 : Math.min(g2, 2)];
      for (let i = 0; i < d.n; i++, di++) {
        const st = dots[di], px = dx + step * (i + 0.5);
        const age = pops && pops[di] != null ? pops[di] : 9;
        const k = st.lit ? 1 + 0.45 * Math.max(0, 1 - age / 0.35) : 1;
        ctx.save(); ctx.translate(px, dy); ctx.scale(k, k);
        if (st.lit) {
          glowDisc(0, 0, dr * 2.6, 'rgba(255,238,110,1)', 0.5);
          ctx.fillStyle = '#ffe94a'; ctx.strokeStyle = '#d99100'; ctx.lineWidth = 2.6;
        } else { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.strokeStyle = col; ctx.lineWidth = 2.8; }
        ctx.beginPath(); ctx.arc(0, 0, dr, 0, TAU); ctx.fill(); ctx.stroke();
        if (st.crossed) {   // a take-away: this one is being taken out
          ctx.strokeStyle = '#d6244a'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(-dr * 0.95, -dr * 0.95); ctx.lineTo(dr * 0.95, dr * 0.95); ctx.moveTo(dr * 0.95, -dr * 0.95); ctx.lineTo(-dr * 0.95, dr * 0.95); ctx.stroke();
        }
        ctx.restore();
      }
      dx += d.n * step; g2++;
    }
    ctx.restore();
  }

  // ---------- fireflies on the field ----------
  function ringSprite() {
    if (ringSpr) return ringSpr;
    const n = Math.ceil((ZONE + 3) * 2 * s), c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d'), m = n / 2, g = x.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,244,150,0.07)'); g.addColorStop(0.80, 'rgba(255,244,150,0.09)'); g.addColorStop(0.9, 'rgba(255,248,170,0.55)');
    g.addColorStop(0.95, 'rgba(255,248,170,0.22)'); g.addColorStop(1, 'rgba(255,248,170,0)');
    x.fillStyle = g; x.fillRect(0, 0, n, n);
    ringSpr = { cv: c, n };
    return ringSpr;
  }
  // a firefly of the swarm: its soft tap-zone ring (the size of the whole zone) and the firefly itself
  function drawFly(f, time, o) {
    o = o || {};
    const a = (o.alpha == null ? 1 : o.alpha) * smooth(f.age / 0.6);
    if (a <= 0.01) return;
    const sp = ringSprite(), pulse = 0.7 + 0.3 * Math.sin(time * 2.1 + f.seed);
    ctx.save();
    ctx.globalAlpha = a * pulse * (o.ring == null ? 1 : o.ring);
    ctx.drawImage(sp.cv, f.x - ZONE - 3, f.y - ZONE - 3, (ZONE + 3) * 2, (ZONE + 3) * 2);
    ctx.globalAlpha = a;
    ctx.translate(f.x + (o.dx || 0), f.y + Math.sin(time * 3.1 + f.seed) * 3 + (o.dy || 0));
    if (o.rot) ctx.rotate(o.rot);
    const flip = Math.cos(f.a) > 0 ? -1 : 1, sc = (o.scale || 2.1);
    ctx.scale(flip * sc, sc);
    F.drawFirefly(ctx, 0, 0, time + f.seed, o.glow == null ? 1 : o.glow);
    ctx.restore();
  }
  // a loose firefly (flying to or from the jar, no ring)
  function drawLoose(x, y, time, o) {
    o = o || {};
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot);
    ctx.scale((o.flip ? -1 : 1) * (o.scale || 2.1), o.scale || 2.1);
    F.drawFirefly(ctx, 0, 0, time + (o.seed || 0), o.glow == null ? 1 : o.glow);
    ctx.restore();
  }

  // ---------- coin row, flowers ----------
  // the coins sit to the right of the home button in the top corner of the left column
  function coinRowPos(n, i) {
    const x0 = 140, avail = lay.colW - 12 - x0, step = Math.min(40, n > 1 ? avail / (n - 1) : 40), r = Math.min(15, step * 0.42);
    return { x: x0 + i * step, y: 38, r };
  }
  function drawCoinRow(n, filled, time, flash) {
    for (let i = 0; i < n; i++) {
      const p = coinRowPos(n, i);
      if (i < filled) {
        glowDisc(p.x, p.y, p.r * 2, 'rgba(255,220,90,0.8)', 0.4 + (i === filled - 1 && flash ? flash * 0.4 : 0));
        F.drawCoin(ctx, p.x, p.y, time * 3 + i, p.r);
      } else {
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2.6; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); ctx.restore();
      }
    }
  }
  const flowerSpot = () => ({ x: lay.colW - 18, y: 508 });
  function gardenSpot(i) { return { x: 34 + i * 33, y: 532 }; }
  // the flower beside the jar blooms as the jar fills; finished flowers stand in a row along the grass
  function drawFlowers(bloom, kindIdx, garden, time, move) {
    const sp = flowerSpot();
    for (let i = 0; i < garden.length; i++) {
      const g = gardenSpot(i);
      F.drawFlower(ctx, g.x, g.y, 0.5, garden[i], 1, time);
    }
    if (move != null && move >= 0) {   // the big flower walks to its place in the row
      const u = smooth(move), g = gardenSpot(garden.length);
      F.drawFlower(ctx, sp.x + (g.x - sp.x) * u, sp.y + (g.y - sp.y) * u, 1.1 + (0.5 - 1.1) * u, FLOWER_KIND[kindIdx % 6], 1, time);
    } else {
      F.drawFlower(ctx, sp.x, sp.y, 1.1, FLOWER_KIND[kindIdx % 6], bloom, time);
    }
  }

  // ---------- sparkles and coins in flight ----------
  function drawParts(parts, time) {
    for (const p of parts) {
      const u = clamp(p.t / p.life, 0, 1);
      if (p.kind === 'coin') { ctx.save(); ctx.globalAlpha = 1 - smooth((u - 0.8) / 0.2); F.drawCoin(ctx, p.x, p.y, p.t * 8 + p.ph, p.r); ctx.restore(); continue; }
      ctx.save(); ctx.globalAlpha = (1 - u) * (p.a == null ? 1 : p.a);
      ctx.fillStyle = p.col || '#fff6b0';
      const r = p.r * (1 - 0.5 * u) * (0.7 + 0.3 * Math.sin(time * 14 + p.ph));
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const rad = i % 2 ? r * 0.26 : r, an = (i * Math.PI) / 4 + p.rot; ctx.lineTo(p.x + Math.cos(an) * rad, p.y + Math.sin(an) * rad); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  // the level-end card behind the chest: coins in a spray come from the game's particles; the chest is FairyArt's
  function drawChest(x, y, open, time) { F.drawChest(ctx, x, y, open, time); }
  function drawHand(x, y, time, alpha) { F.drawHand(ctx, x, y, time, alpha); }
  function drawCoin(x, y, ph, r) { F.drawCoin(ctx, x, y, ph, r); }
  function glow(x, y, r, color, a) { glowDisc(x, y, r, color, a); }
  function cacheSizes() { return { backdrop: bg ? 1 : 0, ring: ringSpr ? 1 : 0 }; }

  window.FireflyArt = {
    H, GROUP_COL, init, resize, begin, toWorld, toClient,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get lay() { return lay; }, get ctx() { return ctx; },
    drawBackdrop, drawNumeral, drawHost, drawJar, drawPlaque, drawFly, drawLoose, drawCoinRow, coinRowPos, drawFlowers, flowerSpot, gardenSpot,
    drawParts, drawChest, drawHand, drawCoin, glow, mouth, plaqueRect, cacheSizes,
  };
})();
