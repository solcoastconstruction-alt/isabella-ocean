/* Rainbow Slide — everything you see. Isabella the Fairy, the skies, clouds, rainbows, trees, waterfalls, coins, the
 * key and the chest are all drawn by the shared window.FairyArt (web/fairy/fairy.js); only what belongs to this game
 * is drawn here: the winding, perspective ribbon (FairyArt's own ribbon has one fixed width, and ours must narrow
 * into the distance), the rainbow arches, the loop-the-loops, the landscape far below, the particles and the
 * progress bar.
 *
 * The view: the screen is 540 units tall. The horizon is at y = HZ. Isabella slides away from us at a fixed place
 * on the screen (ISA_Y); a place `ds` units ahead of her along the ribbon is drawn at scale k = D0 / (D0 + ds), so
 * the ribbon comes toward her out of the distance and grows. How the ribbon winds is its centre line's sideways
 * position at each distance (SlideLogic.centreAt). A loop-the-loop is a circle standing on the ribbon in the
 * forward-and-up plane: everything is first put in her own frame (turned round with her), so the ribbon curls up
 * over her head, and the sky turns behind. The landscape (trees, flowers, waterfalls, or cloud tops) lies far below,
 * on a ground plane ALT units under the ribbon. */
(function () {
  'use strict';
  const L = SlideLogic, F = FairyArt;
  const H = 540, TAU = Math.PI * 2;
  const clamp = L.clamp, lerp = L.lerp, smooth = L.smooth;

  const HZ = 156;               // the horizon (FairyArt's skies put their far hills at 0.92 of their height)
  const SKY_H = HZ / 0.92;
  const D0 = 620;               // from the camera to Isabella
  const GY = 245;               // Isabella is this far below the horizon
  const ISA_Y = HZ + GY;
  const ALT = 520;              // the landscape lies this far below the ribbon
  const FOLLOW = 0.35;          // how much of her sideways slide the camera follows
  const FAR = 2700;             // things appear this far ahead
  const NEARD = -230;           // and leave the bottom of the screen this far behind her
  const RL = L.LOOP_LEN / TAU;  // the radius of a loop
  const ISA_SC = 1.3;           // how big she is drawn
  const RAIN = F.RAINBOW;

  let canvas, ctx, fit, dpr = 1, sc = 1, VW = 1200;
  const parts = [];

  function init(cv) { canvas = cv; fit = F.setupCanvas(cv); ctx = fit.ctx; resize(); }
  function resize() { const r = fit.resize(); VW = r.VW; dpr = r.dpr; sc = canvas.height / H; }
  const toCss = (x, y) => ({ x: (x * sc) / dpr, y: (y * sc) / dpr });
  const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const rrect = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
  function star(x, y, r1, r2, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath();
  }

  // ---------- the view of one frame ----------
  const fr = { lev: null, S: 0, uHer: 0, cS: 0, fS: 0, hS: 0, cp: 1, sp: 0, psi: 0, hw: 300 };
  const _w = { f: 0, h: 0, psi: 0 };
  // where a place `sig` along the ribbon is in the flat-and-up plane the loops stand in: f forward, h up, psi the heading
  function pathPos(lev, sig, out) {
    let sub = 0;
    const loops = lev.loops;
    for (let i = 0; i < loops.length; i++) {
      const lp = loops[i];
      if (sig >= lp.b) { sub += L.LOOP_LEN; continue; }
      if (sig >= lp.a) { const th = (sig - lp.a) / RL; out.f = lp.a - sub + RL * Math.sin(th); out.h = RL * (1 - Math.cos(th)); out.psi = th; return out; }
      break;
    }
    out.f = sig - sub; out.h = 0; out.psi = 0;
    return out;
  }
  function setFrame(lev, S, uHer) {
    fr.lev = lev; fr.S = S; fr.uHer = uHer; fr.hw = lev.hw;
    fr.cS = L.centreAt(lev, S);
    pathPos(lev, S, _w);
    fr.fS = _w.f; fr.hS = _w.h; fr.psi = _w.psi; fr.cp = Math.cos(_w.psi); fr.sp = Math.sin(_w.psi);
  }
  // a place on the ribbon at distance sig, `x` across it -> the screen (o is reused): o.x, o.y, o.k, o.d (its depth)
  function place(sig, x, o) {
    pathPos(fr.lev, sig, _w);
    const df = _w.f - fr.fS, dh = _w.h - fr.hS, fp = df * fr.cp + dh * fr.sp, hp = -df * fr.sp + dh * fr.cp;
    const k = D0 / (D0 + fp);
    o.d = fp; o.k = k;
    o.x = VW / 2 + (L.centreAt(fr.lev, sig) - fr.cS + x - FOLLOW * fr.uHer) * k;
    o.y = HZ + (GY - hp) * k;
    o.vis = fp > -D0 * 0.78 && fp < 9000;
    return o;
  }
  const _a = { x: 0, y: 0, k: 1, d: 0, vis: true }, _b = { x: 0, y: 0, k: 1, d: 0, vis: true };

  // ---------- the backdrop: sky, then the ground far below ----------
  function backdrop(theme, time) {
    const T = F.THEMES[theme], psi = fr.psi;
    ctx.save();
    if (psi) { ctx.translate(VW / 2, ISA_Y); ctx.rotate(psi); ctx.translate(-VW / 2, -ISA_Y); }
    const ext = psi ? 900 : 0;
    // (past the edges the colours simply carry on, so a turning sky never shows a corner)
    const g = ctx.createLinearGradient(0, 0, 0, SKY_H);
    g.addColorStop(0, T.top); g.addColorStop(0.55, T.mid || T.bot); g.addColorStop(1, T.bot);
    ctx.fillStyle = g; ctx.fillRect(-ext, -ext, VW + 2 * ext, SKY_H + ext);
    F.drawSky(ctx, VW, SKY_H, theme, time);
    const gg = ctx.createLinearGradient(0, HZ, 0, H);
    gg.addColorStop(0, T.ground[0]); gg.addColorStop(1, T.ground[1]);
    ctx.fillStyle = gg; ctx.fillRect(-ext, HZ, VW + 2 * ext, H - HZ + ext);
    ctx.restore();
  }
  // the landscape far below: stripes of field sliding past, and a tree, a flower, a waterfall, or a bank of cloud
  // every so often (placed from a hash of where it is, so it is always the same landscape)
  const STEP = 300;
  function landscape(theme, time, alpha, sigs) {
    const T = F.THEMES[theme], S = fr.S, lev = fr.lev, cloudTops = theme >= 4;
    ctx.save(); ctx.globalAlpha = alpha;
    const kOf = (ds) => D0 / (D0 + ds), yOf = (k) => HZ + (GY + ALT) * k;
    // stripes
    ctx.fillStyle = cloudTops ? 'rgba(120,150,230,0.10)' : 'rgba(0,70,30,0.07)';
    for (let j = Math.floor((S + 560) / 500); j * 500 < S + 4600; j++) {
      if (j & 1) continue;
      const y0 = yOf(kOf(j * 500 - S)), y1 = yOf(kOf((j + 1) * 500 - S));
      if (y0 > H + 4 || y1 > H + 4 && y0 > H) continue;
      ctx.fillRect(0, Math.min(y1, y0), VW, Math.abs(y0 - y1) + 0.5);
    }
    // the ribbon's shadow far below: a soft dark band that winds like it does, so it floats high above the land
    if (sigs && sigs.length > 1) {
      ctx.fillStyle = cloudTops ? 'rgba(90,110,200,0.16)' : 'rgba(0,60,40,0.16)';
      const hw = lev.hw, gp = (sg) => { const ds = Math.max(sg - S, -120), k = kOf(ds); return [VW / 2 + (L.centreAt(lev, sg) - fr.cS - FOLLOW * fr.uHer) * k, yOf(k), k]; };
      ctx.beginPath();
      for (let i = 0; i < sigs.length; i++) { const g = gp(sigs[i]); ctx.lineTo(g[0] - hw * g[2] * 0.9, g[1]); }
      for (let i = sigs.length - 1; i >= 0; i--) { const g = gp(sigs[i]); ctx.lineTo(g[0] + hw * g[2] * 0.9, g[1]); }
      ctx.closePath(); ctx.fill();
    }
    const j1 = Math.floor((S + 4300) / STEP), j0 = Math.ceil((S + 560) / STEP);
    for (let j = j1; j >= j0; j--) {
      for (let q = 0; q < 3; q++) {
        const h1 = hash(j, theme * 7 + q * 13), h2 = hash(j + 91, q * 5 + theme), h3 = hash(j * 3 + 7, q + 2);
        const ds = j * STEP + q * 100 + (h3 - 0.5) * 200 - S;
        if (ds < 560) continue;
        const k = kOf(ds), y = yOf(k);
        if (y > H + 160) continue;
        // sideways: out beside the ribbon, or right beneath it
        const off = (h2 < 0.35 ? (h2 * 2 - 0.35) * 600 : (h2 < 0.675 ? -1 : 1) * (380 + h1 * 1700));
        const x = VW / 2 + (L.centreAt(lev, j * STEP) + off - fr.cS - FOLLOW * fr.uHer) * k;
        if (x < -300 * k - 100 || x > VW + 300 * k + 100) continue;
        if (cloudTops) {
          const w = (520 + h1 * 700) * k;
          F.drawCloud(ctx, x - w / 2, y, w, { light: T.cloud[0], shade: T.cloud[1], alpha: 0.95 });
        } else if (h1 < 0.1) {   // a puffy cloud drifting between the land and the ribbon
          const w = (260 + h2 * 300) * k, yc = HZ + (GY + ALT - 230) * k;
          F.drawCloud(ctx, x - w / 2, yc, w, { light: T.cloud[0], shade: T.cloud[1], alpha: 0.92 });
        } else if (h1 < 0.5) F.drawTree(ctx, x, y, (1.2 + h3 * 1.1) * k * 1.8, Math.floor(h2 * 4), time);
        else if (h1 < 0.64) F.drawFlower(ctx, x, y, k * 3.2, Math.floor(h2 * 6), 1, time);
        else if (h1 < 0.74) F.drawMushroom(ctx, x, y, k * 3.4, T.flower[Math.floor(h3 * 4)]);
        else if (h1 < 0.88 && T.glade) F.drawWaterfall(ctx, x, y - 190 * k * 2, 140 * k * 2, 190 * k * 2, time);
        else F.drawGrass(ctx, x - 90 * k, y, 180 * k * 2, time, T.ground[1]);
      }
    }
    ctx.restore();
  }

  // ---------- the ribbon ----------
  // samples of the ribbon at the places in `sigs`, as screen positions of its centre (cx, y, k)
  const samp = [];
  function sampleRibbon(sigs) {
    samp.length = 0;
    for (const sig of sigs) { const p = place(sig, 0, _a); samp.push({ sig, x: p.x, y: p.y, k: p.k, d: p.d, vis: p.vis }); }
  }
  const BANDS = 7;
  function bandX(p, b, hw) { return p.x + (-hw + (2 * hw * b) / BANDS) * p.k; }
  // the whole ribbon in one go (when no loop is in view): one polygon per colour, narrowing into the distance
  function ribbonFlat(hw) {
    const n = samp.length;
    if (n < 2) return;
    ctx.save();
    // its thin underside, so it looks like a slab and not a line
    ctx.fillStyle = 'rgba(88,60,150,0.38)';
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(bandX(samp[i], 0, hw), samp[i].y + 7 * samp[i].k);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(bandX(samp[i], BANDS, hw), samp[i].y + 7 * samp[i].k);
    ctx.closePath(); ctx.fill();
    for (let b = 0; b < BANDS; b++) {
      ctx.fillStyle = RAIN[b]; ctx.beginPath();
      for (let i = 0; i < n; i++) ctx.lineTo(bandX(samp[i], b, hw) - 0.4, samp[i].y);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(bandX(samp[i], b + 1, hw) + 0.4, samp[i].y);
      ctx.closePath(); ctx.fill();
    }
    // a soft shine along it
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(bandX(samp[i], 1.6, hw), samp[i].y);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(bandX(samp[i], 2.1, hw), samp[i].y);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // one slice of the ribbon between two samples (used while a loop is in view, when slices must be drawn far to near)
  function ribbonSlice(i, hw) {
    const a = samp[i], b = samp[i + 1];
    if (!a.vis && !b.vis) return;
    // (each slice is made 7% longer both ways, so no hairline of the sky shows between two of them)
    const e = 0.07, dy = (b.y - a.y) * e, ay = a.y - dy, by = b.y + dy;
    const X = (p, q, o) => { const xa = bandX(a, q, hw), xb = bandX(b, q, hw); return o ? xb + (xb - xa) * e : xa - (xb - xa) * e; };
    for (let q = 0; q < BANDS; q++) {
      ctx.fillStyle = RAIN[q]; ctx.beginPath();
      ctx.moveTo(X(a, q, 0) - 0.4, ay); ctx.lineTo(X(b, q, 1) - 0.4, by); ctx.lineTo(X(b, q + 1, 1) + 0.4, by); ctx.lineTo(X(a, q + 1, 0) + 0.4, ay);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath();
    ctx.moveTo(X(a, 1.6, 0), ay); ctx.lineTo(X(b, 1.6, 1), by); ctx.lineTo(X(b, 2.1, 1), by); ctx.lineTo(X(a, 2.1, 0), ay); ctx.closePath(); ctx.fill();
  }

  // ---------- the things on the ribbon ----------
  function drawArch(a, hit, time) {
    const p = a.p, hw = fr.hw, r = hw * p.k * 1.04, band = r * 0.045;
    ctx.save();
    // (see-through as she goes under it, so it never hides what she is sliding toward)
    ctx.globalAlpha = clamp((p.d + 200) / 800, 0.14, 0.9) * clamp(1.5 - Math.max(0, p.d) / FAR * 1.6, 0, 1);
    // (a flat-footed arch standing on the ribbon's two edges: the semicircle's centre is on the ribbon)
    F.drawRainbow(ctx, p.x, p.y, r, band, { from: Math.PI, to: TAU });
    ctx.globalAlpha = 1;
    // a little pink flag of stars where the arch is a checkpoint, lit once she has passed it
    ctx.fillStyle = hit ? '#fff6b0' : 'rgba(255,255,255,0.8)';
    const s2 = Math.max(3, r * 0.1);
    star(p.x, p.y - r - band * 0.5, s2 * 1.6, s2 * 0.6, 5, -Math.PI / 2 + time * (hit ? 1.5 : 0)); ctx.fill();
    ctx.restore();
  }
  function drawCloudAt(o, run, p, time, clock) {
    const w = (2 * (o.r + o.hx)) / 0.88, wp = w * p.k;
    if (wp < 3) return;
    let squash = 1, wob = 0;
    if (o.hitT != null) { const u = clock - o.hitT; if (u >= 0 && u < 0.9) { wob = Math.sin(u * 24) * (1 - u / 0.9); squash = 1 - 0.18 * Math.max(0, wob); } }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1 + 0.1 * Math.abs(wob), squash * 1.3);   // (taller than the footprint says: a fluffy heap, not a flat sheet)
    // (they bob a little, and the grumpy ones drift)
    const bob = Math.sin(time * 1.6 + o.s * 0.013) * 2.5 * p.k;
    const T = F.THEMES[fr.theme];
    F.drawCloud(ctx, -wp / 2, bob - 4 * p.k, wp, { grumpy: !!o.g, light: T.cloud[0], shade: T.cloud[1] });
    ctx.restore();
  }
  function drawCoinAt(c, x, y, k, time, i) {
    if (k * 14 < 1.5) return;
    F.drawCoin(ctx, x, y - 26 * k, time * 4 + i * 0.7, 14 * k);
  }
  function drawKeyAt(p, time) {
    F.drawKey(ctx, p.x, p.y - 46 * p.k, 1.55 * p.k, time);
    F.drawSparkles(ctx, p.x, p.y - 46 * p.k, time, 5, 30 * p.k, 0.9);
  }
  // the end of the ribbon: a big cloud with the treasure chest on it
  function drawChestAt(p, open, time, v) {
    ctx.save();
    ctx.globalAlpha = clamp((FAR - p.d) / 500, 0, 1);
    const w = 560 * p.k;
    F.drawCloud(ctx, p.x - w / 2, p.y + 18 * p.k, w, { light: '#ffffff', shade: '#d7e8ff' });
    ctx.save(); ctx.translate(p.x, p.y - 4 * p.k); ctx.scale(p.k * 1.25, p.k * 1.25);
    F.drawChest(ctx, 0, 0, open, time);
    ctx.restore();
    ctx.globalAlpha = 1;
    v.chestAt.x = p.x; v.chestAt.y = p.y - 60 * p.k; v.chestAt.k = p.k;
    ctx.restore();
  }

  // ---------- Isabella ----------
  function drawIsabella(v, run, x, y, time) {
    const I = v.isa;
    ctx.save();
    const z = run.z || 0;
    // her shadow on the ribbon when she is above it; the little cloud when she is floating back
    if (run.phase === 'rescue') {
      const cw = 150;
      F.drawCloud(ctx, x - cw / 2, y - z + 16, cw, { light: '#ffffff', shade: '#d7e8ff', alpha: 0.95 });
    }
    const pose = run.phase === 'rescue' ? 'sit' : I.happy ? 'hover' : 'slide';
    const o = { pose, scale: ISA_SC, flip: I.flip < 0, tilt: I.bank * 0.28 + I.wobble, alpha: I.alpha, dust: run.phase === 'play' ? 0.55 : 0, wand: true, happy: true };
    if (I.crown) o.glow = 0.4;
    F.drawFairy(ctx, x, y - z, time, o);
    ctx.restore();
  }

  // ---------- particles ----------
  const MAXP = 380;
  function spawn(p) { if (parts.length < MAXP) parts.push(p); }
  const clearParticles = () => { parts.length = 0; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(type, x, y, size) {
    const k = size || 1;
    if (type === 'poof') {
      for (let i = 0; i < 9; i++) spawn({ t: 'puff', x: x + rnd(-24, 24) * k, y: y + rnd(-18, 8), vx: rnd(-90, 90), vy: rnd(-70, 10), life: 0.8, max: 0.8, r: rnd(10, 22) * k });
      for (let i = 0; i < 6; i++) spawn({ t: 'spark', x, y, vx: rnd(-200, 200), vy: rnd(-240, 20), life: 0.6, max: 0.6, c: RAIN[i], r: rnd(3, 6) });
    }
    if (type === 'coin') for (let i = 0; i < 6; i++) spawn({ t: 'spark', x, y, vx: rnd(-150, 150), vy: rnd(-190, 40), life: 0.5, max: 0.5, c: i % 2 ? '#ffe066' : '#fff', r: rnd(3, 6.5) });
    if (type === 'star') for (let i = 0; i < 16; i++) spawn({ t: 'spark', x, y, vx: rnd(-280, 280), vy: rnd(-320, 80), life: 0.9, max: 0.9, c: RAIN[i % RAIN.length], r: rnd(4, 8) });
    if (type === 'cheer') for (let i = 0; i < 8; i++) spawn({ t: i % 2 ? 'heart' : 'spark', x: x + rnd(-40, 40), y: y + rnd(-30, 10), vx: rnd(-60, 60), vy: rnd(-150, -70), life: 1.1, max: 1.1, c: '#fff6a0', r: rnd(5, 9) });
    if (type === 'spill') spawn({ t: 'gcoin', x, y: y - 20, vx: Math.random() < 0.5 ? rnd(140, 240) : rnd(-240, -140), vy: rnd(-520, -420), life: 1.3, max: 1.3, r: 13, ph: 0, floor: 9999 });
    if (type === 'confetti') for (let i = 0; i < 46; i++) spawn({ t: 'confetti', x: x + rnd(-360, 360), y: y + rnd(-40, 20), vx: rnd(-160, 160), vy: rnd(-420, -120), life: 2.6, max: 2.6, c: RAIN[i % RAIN.length], ph: rnd(0, 6) });
    if (type === 'shower') for (let i = 0; i < 18; i++) spawn({ t: 'spark', x: x + rnd(-VW * 0.4, VW * 0.4), y: rnd(20, 330), vx: rnd(-40, 40), vy: rnd(60, 180), life: 1.1, max: 1.1, c: RAIN[i % RAIN.length], r: rnd(4, 9) });
    if (type === 'arch') for (let i = 0; i < 22; i++) spawn({ t: 'spark', x: x + rnd(-200, 200) * (size || 1), y: y - rnd(0, 220) * (size || 1), vx: rnd(-90, 90), vy: rnd(-90, 60), life: 1.0, max: 1.0, c: RAIN[i % RAIN.length], r: rnd(4, 8) });
  }
  // the treasure burst: coins leap out of the chest and fall back, with confetti
  function fountain(x, y, n, floor) {
    for (let i = 0; i < n; i++) spawn({ t: 'gcoin', x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 520, vy: -430 - Math.random() * 480, life: 3, max: 3, r: 9 + Math.random() * 5, ph: Math.random() * 6, floor });
    for (let i = 0; i < n / 2; i++) spawn({ t: 'confetti', x: x + (Math.random() - 0.5) * 80, y: y - 20, vx: (Math.random() - 0.5) * 640, vy: -300 - Math.random() * 480, life: 3, max: 3, c: RAIN[Math.floor(Math.random() * RAIN.length)], ph: Math.random() * 6 });
  }
  function stepParts(dt, flow) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.t === 'gcoin') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 8;
        if (p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.4; p.vx *= 0.7; }
      } else if (p.t === 'confetti') {
        p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.5); p.vy = Math.min(p.vy, 120); p.x += p.vx * dt + Math.sin(p.ph) * 40 * dt; p.y += p.vy * dt; p.ph += dt * 6;
      } else if (p.t === 'puff') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-dt * 2.5); p.vy *= Math.exp(-dt * 2.5); p.r += dt * 16; }
      else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-dt * 3); p.vy *= Math.exp(-dt * 3); if (flow) p.y += flow * dt * 0.2; }
    }
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.t === 'puff') { ctx.globalAlpha = a * 0.85; ctx.fillStyle = '#ffffff'; circle(p.x, p.y, p.r); }
      else if (p.t === 'spark') { ctx.globalAlpha = a; ctx.fillStyle = p.c; star(p.x, p.y, p.r, p.r * 0.3, 4, p.life * 4); ctx.fill(); }
      else if (p.t === 'heart') { ctx.globalAlpha = a; ctx.fillStyle = '#ff4d8d'; const r = p.r; ctx.beginPath(); ctx.moveTo(p.x, p.y + r * 0.9); ctx.bezierCurveTo(p.x - r * 1.5, p.y - r * 0.1, p.x - r * 0.7, p.y - r * 1.3, p.x, p.y - r * 0.45); ctx.bezierCurveTo(p.x + r * 0.7, p.y - r * 1.3, p.x + r * 1.5, p.y - r * 0.1, p.x, p.y + r * 0.9); ctx.fill(); }
      else if (p.t === 'gcoin') { ctx.globalAlpha = Math.min(1, p.life * 2); F.drawCoin(ctx, p.x, p.y, p.ph, p.r); }
      else if (p.t === 'confetti') { ctx.globalAlpha = Math.min(1, p.life); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph); ctx.fillStyle = p.c; ctx.fillRect(-5, -3, 10, 6); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- one frame of a course ----------
  const list = [];
  let nList = 0;
  function add(t, d, o, i) { const e = list[nList] || (list[nList] = { t: 0, d: 0, o: null, i: 0 }); e.t = t; e.d = d; e.o = o; e.i = i; nList++; }
  function sortList() {   // insertion sort, far first (the list is nearly sorted already)
    for (let i = 1; i < nList; i++) { const e = list[i]; let j = i - 1; while (j >= 0 && list[j].d < e.d) { list[j + 1] = list[j]; j--; } list[j + 1] = e; }
  }
  const lowerBound = (arr, s) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].s < s) lo = m + 1; else hi = m; } return lo; };
  const _p = { x: 0, y: 0, k: 1, d: 0, vis: true };
  const _arch = { p: _p };
  const archP = [];

  // v: { run, n, theme, clock, chestOpen, party, pan, hint, hintT, flash, isa: { bank, wobble, flip, alpha, happy, crown }, isaAt: {x, y}, chestAt: {x, y, k},
  //      archHit: [bool] }
  function drawPlay(v, time, dt) {
    const run = v.run, lev = run.lev, S = run.s, theme = v.theme;
    fr.theme = theme;
    stepParts(dt, run.v);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    setFrame(lev, S, run.x);
    // the places along the ribbon to draw: from a little behind her to the chest's cloud
    const hw = lev.hw, s0 = Math.max(-260, S + (lev.loops.some((lp) => S > lp.a - 100 && S < lp.b + 100) ? -760 : NEARD)), s1 = Math.min(lev.chestS + 160, S + FAR + 700);
    const nearLoop = lev.loops.some((lp) => lp.b > S - 350 && lp.a < S + FAR + 300);
    const sigs = [];
    if (!nearLoop) for (let sg = s0; sg < s1; sg += (sg - S < 700 ? 70 : sg - S < 1500 ? 110 : 170)) sigs.push(sg);
    else { const dense = (sg) => lev.loops.some((lp) => sg > lp.a - 200 && sg < lp.b + 200); for (let sg = s0; sg < s1; sg += dense(sg) ? 56 : 150) sigs.push(sg); }
    sigs.push(s1);
    backdrop(theme, time);
    const fade = 1 - smooth(Math.abs(Math.sin(fr.psi / 2)) * 3);
    if (fade > 0.02) landscape(theme, time, fade, nearLoop ? null : sigs);
    sampleRibbon(sigs);
    if (!nearLoop) ribbonFlat(hw);

    // everything else, far to near
    nList = 0;
    if (nearLoop) {
      for (let i = 0; i < samp.length - 1; i++) {
        let d = (samp[i].d + samp[i + 1].d) / 2;
        if (samp[i + 1].sig >= S - 300 && samp[i].sig <= S + 60) d = Math.max(d, 5);   // (the ribbon she is on, and has just left, lies behind her)
        add(6, d, null, i);
      }
    }
    for (let i = lowerBound(lev.obs, S + NEARD - 120); i < lev.obs.length && lev.obs[i].s < S + FAR + 700; i++) {
      const o = lev.obs[i], p = place(o.s, L.obsX(o, run.t), _p);
      if (!p.vis || p.d > FAR + 400) continue;
      add(0, p.d, o, i);
    }
    for (let i = lowerBound(lev.coins, S + NEARD - 160); i < lev.coins.length && lev.coins[i].s < S + FAR + 700; i++) {
      if (run.got[i]) continue;
      const p = place(run.cs[i], run.cx[i], _p);
      if (!p.vis || p.d > FAR + 400) continue;
      add(1, p.d > -70 && p.d < 1 ? 1 : p.d, lev.coins[i], i);
    }
    for (let i = 0; i < lev.arches.length; i++) { const a = lev.arches[i]; if (a > S + NEARD - 100 && a < S + FAR + 700) { const p = place(a, 0, _p); if (p.vis && p.d < FAR + 400) add(2, p.d, a, i); } }
    if (!run.hasKey || run.phase === 'done') { const k = lev.key; if (k.s > S + NEARD - 100 && k.s < S + FAR + 700 && !run.hasKey) { const p = place(k.s, k.x, _p); if (p.vis && p.d < FAR + 400) add(3, p.d, k, 0); } }
    { const p = place(lev.chestS, 0, _p); if (p.vis && p.d < FAR + 700) add(4, p.d, null, 0); }
    add(5, nearLoop ? -1e6 : -20, null, 0);   // (through a loop she is drawn last: the ribbon curling over her never hides her)
    sortList();

    const I = v.isa;
    for (let a = 0; a < nList; a++) {
      const e = list[a];
      if (e.t === 6) { ribbonSlice(e.i, hw); continue; }
      if (e.t === 0) { const o = e.o, p = place(o.s, L.obsX(o, run.t), _p); drawCloudAt(o, run, p, time, v.clock); }
      else if (e.t === 1) { const c = e.o, p = place(run.cs[e.i], run.cx[e.i], _p); drawCoinAt(c, p.x, p.y, p.k, time, e.i); }
      else if (e.t === 2) { const p = place(e.o, 0, _p); drawArch({ p }, v.archHit && v.archHit[e.i], time); }
      else if (e.t === 3) { const k = e.o, p = place(k.s, k.x, _p); drawKeyAt(p, time); }
      else if (e.t === 4) { const p = place(lev.chestS, 0, _p); drawChestAt(p, v.chestOpen, time, v); }
      else if (!I.hide) {
        const x = VW / 2 + (run.x - FOLLOW * run.x), y = ISA_Y;
        drawIsabella(v, run, x, y, time);
        v.isaAt.x = x; v.isaAt.y = y - (run.z || 0);
      }
    }
    drawParts();
    // the party at the chest: she flies round it
    if (v.party >= 0) {
      const c = v.chestAt, u = (v.party % 2.4) / 2.4, ang = u * TAU;
      const x = c.x + Math.cos(ang) * 150, y = c.y - 40 + Math.sin(ang * 2) * 30 - 60;
      F.drawFairy(ctx, x, y, time, { pose: 'fly', scale: 1.1, flip: Math.sin(ang) > 0, dust: 0.9, happy: true });
    }
    // no key yet: it floats down to her, and on to the chest
    if (v.keyFly >= 0 && v.keyFly < 1) {
      const c = v.chestAt, u = smooth(v.keyFly), kx = lerp(VW / 2, c.x, u), ky = lerp(20, c.y - 50, u) + Math.sin(u * Math.PI) * 40;
      F.drawKey(ctx, kx, ky, 1.5, time); F.drawSparkles(ctx, kx, ky, time, 6, 36, 0.9);
    }
    if (v.flash > 0.01) { ctx.fillStyle = `rgba(255,255,255,${clamp(v.flash, 0, 1) * 0.85})`; ctx.fillRect(0, 0, VW, H); }
    drawProgress(run.progress, lev, time);
    if (v.hint) drawHint(v.hint, v.hintT, time, VW / 2 + (run.x - FOLLOW * run.x));
  }

  // how far along she is: a rainbow bar at the top, little arches where the checkpoints are, the chest at its end
  function drawProgress(u, lev, time) {
    const w = 250, x0 = VW / 2 - w / 2, y = 30;
    ctx.fillStyle = 'rgba(40,60,130,0.22)'; rrect(x0 - 4, y - 9, w + 8, 18, 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.78)'; rrect(x0 - 2, y - 7, w + 4, 14, 7); ctx.fill();
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    RAIN.forEach((c, i) => g.addColorStop(i / (RAIN.length - 1), c));
    ctx.fillStyle = g; rrect(x0, y - 5, Math.max(10, w * u), 10, 5); ctx.fill();
    for (const a of lev.arches) { const ax = x0 + (w * a) / lev.len; ctx.fillStyle = a / lev.len < u ? '#fff6b0' : '#ffffff'; circle(ax, y, 3.2); }
    for (const lp of lev.loops) { const ax = x0 + (w * (lp.a + lp.b) / 2) / lev.len; ctx.strokeStyle = '#c86bfa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ax, y, 4.6, 0, TAU); ctx.stroke(); }
    ctx.save(); ctx.translate(x0 + w + 18, y + 9); ctx.scale(0.26, 0.26);
    F.drawChest(ctx, 0, 0, 0, time);
    ctx.restore();
    const mx = x0 + w * u;
    ctx.fillStyle = '#ffffff'; circle(mx, y, 11);
    ctx.fillStyle = '#6b3a1f'; circle(mx, y, 8.5);
    ctx.fillStyle = '#ffd93d'; star(mx + 4, y - 4, 4, 1.8, 5, 0); ctx.fill();
  }
  // how to play, in pictures: rock the phone (or slide a finger) to steer
  let hand = null;
  function drawHint(kind, ht, time, isaX) {
    const a = clamp(Math.min(ht * 2, 1), 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    if (kind === 'tilt') {
      const rot = Math.sin(time * 2.6) * 0.38;
      ctx.translate(VW / 2, 104); ctx.rotate(rot);
      ctx.fillStyle = 'rgba(40,60,130,0.25)'; rrect(-62, -30, 124, 68, 14); ctx.fill();
      ctx.fillStyle = '#ffffff'; rrect(-62, -34, 124, 68, 14); ctx.fill();
      ctx.fillStyle = '#c86bfa'; rrect(-50, -26, 100, 52, 7); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(13, 12); ctx.lineTo(0, 6); ctx.lineTo(-13, 12); ctx.closePath(); ctx.fill();
      ctx.rotate(-rot);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const q of [-1, 1]) {
        ctx.beginPath(); ctx.arc(0, 0, 92, q > 0 ? -0.5 : Math.PI - 0.35, q > 0 ? 0.35 : Math.PI + 0.5); ctx.stroke();
        const ax = Math.cos(q > 0 ? 0.35 : Math.PI - 0.35) * 92, ay = Math.sin(0.35) * 92;
        ctx.beginPath(); ctx.moveTo(ax - 12, ay - 6); ctx.lineTo(ax, ay + 8); ctx.lineTo(ax + 12, ay - 6); ctx.stroke();
      }
    } else {
      // a finger sliding from side to side below her
      const off = Math.sin(time * 2.4) * 130, x = isaX + off, y = ISA_Y + 70;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash([3, 15]); ctx.beginPath(); ctx.moveTo(isaX - 150, y); ctx.lineTo(isaX + 150, y); ctx.stroke(); ctx.setLineDash([]);
      for (const q of [-1, 1]) { ctx.beginPath(); ctx.moveTo(isaX + q * 160, y - 13); ctx.lineTo(isaX + q * 176, y); ctx.lineTo(isaX + q * 160, y + 13); ctx.stroke(); }
      F.drawHand(ctx, x, y, time, 1);
    }
    ctx.restore();
  }

  // ---------- the level select's backdrop: a sunny sky and Isabella sliding down a rainbow ----------
  const ribbonPts = [];
  function drawMenu(time, dt, world) {
    stepParts(dt, 0);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    const theme = world === 2 ? 4 : 0;
    F.drawSky(ctx, VW, H, theme, time);
    // far clouds drifting by
    for (let i = 0; i < 5; i++) {
      const cw = 220 + hash(i, 3) * 160, x = ((time * (10 + i * 4) + i * 330) % (VW + 500)) - 250, y = 150 + hash(i, 7) * 220;
      F.drawCloud(ctx, x, y, cw, { alpha: 0.85, light: F.THEMES[theme].cloud[0], shade: F.THEMES[theme].cloud[1] });
    }
    // a rainbow ribbon swooping across, and her sliding down it
    ribbonPts.length = 0;
    const n = 36;
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = -80 + u * (VW + 160), y = 120 + 330 * smooth(u) + Math.sin(u * 7 + 0.6) * 22 * (1 - Math.abs(u - 0.5));
      ribbonPts.push({ x, y });
    }
    F.drawRainbowRibbon(ctx, ribbonPts, 62, 0.95);
    const T = 7, u = (time % T) / T, i = Math.min(n - 1, Math.floor(u * n)), f = u * n - i;
    const p0 = ribbonPts[i], p1 = ribbonPts[i + 1];
    const x = lerp(p0.x, p1.x, f), y = lerp(p0.y, p1.y, f), ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    F.drawFairy(ctx, x, y - 8, time, { pose: 'slide', scale: 1.4, tilt: ang * 0.8, dust: 0.7, happy: true });
    drawParts();
  }

  window.SlideArt = {
    init, resize, toCss, drawPlay, drawMenu, burst, fountain, clearParticles, spawn,
    H, HZ, ISA_Y, D0, GY, FOLLOW, FAR, ISA_SC, place, setFrame,
    get VW() { return VW; }, get dpr() { return dpr; }, get scale() { return sc; }, get particles() { return parts.length; },
  };
})();
