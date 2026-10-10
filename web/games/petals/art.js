/* Petal Patterns: drawing. Everything shared (Isabella the Fairy, skies, trees, flowers, butterflies, coins, the
 * chest, the hint hand) comes from FairyArt (web/fairy/fairy.js); only what belongs to this game is drawn here:
 * the pots and their shelf, the choice plates, the glowing "?" bud, the staircase stones, and a little particle
 * system. All art is code. The world is 540 units tall (the width follows the screen), DPR capped at 2.5.
 * No blur or shadow filters. */
(function () {
  'use strict';
  const F = window.FairyArt, L = window.PetalLogic;
  const TAU = Math.PI * 2, H = F.VH, GROUND = L.GROUND_Y;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const easeOutBack = (u) => { u = clamp(u, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

  const A = { H, VW: 960, scale: 1, dpr: 1, cssW: 960, cssH: 540, GROUND, TRAY_Y: L.TRAY_Y, CARD: L.CARD, canvas: null, ctx: null };
  let fit = null, facade = null;
  A.init = function (canvas) {
    A.canvas = canvas;
    fit = F.setupCanvas(canvas);
    A.ctx = fit.ctx;
    A.resize();
  };
  A.resize = function () {
    const r = fit.resize();
    A.VW = r.VW; A.dpr = r.dpr; A.cssW = r.cssW; A.cssH = r.cssH; A.scale = A.canvas.height / H;
    return r;
  };
  // client (CSS) pixels <-> world units
  A.toWorld = (cx, cy) => { const k = H / A.cssH; return { x: cx * k, y: cy * k }; };
  A.toClient = (x, y) => { const k = A.cssH / H; return { x: x * k, y: y * k }; };
  A.unit = () => A.cssH / H;   // CSS pixels per world unit
  A.begin = function () {
    A.ctx.setTransform(A.scale, 0, 0, A.scale, 0, 0);
  };

  // ---------- flowers with a colour of their own ----------
  // FairyArt.drawFlower gives each kind one fixed colour. A pattern needs every kind in every rainbow colour, so the
  // game draws the flower through a thin wrapper that swaps that kind's own colours (the head, and the darker shades
  // made from it) for the colour asked for. If FairyArt one day takes a colour as an 8th argument, that is used instead.
  const BUD = [157, 179, 143];
  const DEFAULT_COL = ['#ffffff', '#ff5d8f', '#6c63ff', '#ffd633', '#ff4d6d', '#ffa8d4'];
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mapCache = new Map();
  function mapperFor(kind, colour) {
    const key = kind + colour;
    let m = mapCache.get(key);
    if (m) return m;
    const base = hexRgb(DEFAULT_COL[kind]), fresh = hexRgb(colour), seen = new Map();
    // v = a*BUD + b*base (the rest of the weight is black): solve for a, b by least squares, then rebuild with the new colour
    const s11 = BUD[0] * BUD[0] + BUD[1] * BUD[1] + BUD[2] * BUD[2], s22 = base[0] * base[0] + base[1] * base[1] + base[2] * base[2];
    const s12 = BUD[0] * base[0] + BUD[1] * base[1] + BUD[2] * base[2], det = s11 * s22 - s12 * s12;
    m = function (str) {
      let r = seen.get(str);
      if (r !== undefined) return r;
      if (seen.size > 600) seen.clear();   // (the blooming shades come in thousands over a long game; keep the table small)
      r = str;
      let v = null;
      if (str.charAt(0) === '#' && str.length === 7) v = hexRgb(str);
      else if (str.indexOf('rgb(') === 0) { const q = str.match(/\d+/g); if (q && q.length === 3) v = [+q[0], +q[1], +q[2]]; }
      if (v) {
        const t1 = BUD[0] * v[0] + BUD[1] * v[1] + BUD[2] * v[2], t2 = base[0] * v[0] + base[1] * v[1] + base[2] * v[2];
        const a = (t1 * s22 - t2 * s12) / det, b = (t2 * s11 - t1 * s12) / det;
        let res = 0;
        for (let i = 0; i < 3; i++) res = Math.max(res, Math.abs(v[i] - (a * BUD[i] + b * base[i])));
        if (res < 2.6 && a > -0.03 && b > -0.03 && a + b < 1.03 && b > 0.02)
          r = 'rgb(' + [0, 1, 2].map((i) => clamp(Math.round(a * BUD[i] + b * fresh[i]), 0, 255)).join(',') + ')';
      }
      seen.set(str, r);
      return r;
    };
    mapCache.set(key, m);
    return m;
  }
  function makeFacade(ctx) {
    const f = { map: null };
    const proto = Object.getPrototypeOf(ctx);
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name === 'canvas') continue;
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof d.value === 'function') f[name] = d.value.bind(ctx);
      else if (d.get) {
        const tint = name === 'fillStyle' || name === 'strokeStyle';
        Object.defineProperty(f, name, { get: () => ctx[name], set: (v) => { ctx[name] = tint && f.map && typeof v === 'string' ? f.map(v) : v; } });
      }
    }
    return f;
  }
  // x, y: where the stem meets the pot. f: [colour, kind, size]. mul: extra scale. bloom: 0 (bud) .. 1.
  // The six kinds are different heights (60 to 81 units at scale 1), so each is scaled to stand about 100 units tall at
  // mul 1 (a big flower 108, a small one 74): every kind then reads as the same size in a row.
  const KIND_NORM = [100 / 60, 100 / 77, 100 / 60, 100 / 81, 100 / 60, 100 / 68];
  A.KIND_NORM = KIND_NORM;
  A.flower = function (ctx, x, y, f, mul, bloom, time) {
    const sc = L.SIZE_SCALE[f[2]] * KIND_NORM[f[1]] * (mul == null ? 1 : mul), col = L.RAINBOW[f[0]];
    bloom = Math.round(clamp(bloom, 0, 1) * 24) / 24;   // 25 shades of opening: the swapped colours then come from a small, bounded set
    if (F.drawFlower.length >= 8) { F.drawFlower(ctx, x, y, sc, f[1], bloom, time, col); return; }
    if (!facade || facade.__ctx !== ctx) { facade = makeFacade(ctx); facade.__ctx = ctx; }
    facade.map = mapperFor(f[1], col);
    F.drawFlower(facade, x, y, sc, f[1], bloom, time);
    facade.map = null;
  };
  // a flower with a stem, drawn on its own (the choice plates and the flying flower)
  A.FLOWER_H = [46, 54, 50, 62, 50, 56];

  // ---------- the scene ----------
  const theme = (level) => (level <= 10 ? (level - 1) % 4 : 4 + ((level - 11) % 4));
  A.themeOf = theme;
  const TREES = [[0.07, 0, 0.9], [0.31, 2, 0.8], [0.57, 1, 0.9], [0.86, 3, 0.95], [0.97, 0, 0.7]];
  A.drawScene = function (ctx, level, time) {
    const T = F.THEMES[theme(level)], W = A.VW, hz = 318;
    F.drawSky(ctx, W, 340, theme(level), time);
    // clouds drifting
    for (let i = 0; i < 4; i++) {
      const cw = 150 + i * 28, cx = ((time * (5 + i * 2) + i * 330) % (W + 400)) - 200;
      F.drawCloud(ctx, cx, 70 + ((i * 53) % 120), cw, { light: T.cloud[0], shade: T.cloud[1], alpha: 0.85 });
    }
    // the meadow
    const g = ctx.createLinearGradient(0, hz - 10, 0, H);
    g.addColorStop(0, T.ground[0]); g.addColorStop(1, T.ground[1]);
    ctx.fillStyle = g; ctx.fillRect(0, hz - 6, W, H - hz + 6);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, hz - 6, W, 5);
    if (T.farKind === 'clouds') {
      // the Cloud Tops: a bank of soft clouds to stand on instead of trees and grass
      for (let i = 0; i < 9; i++) {
        const cx = (i / 8) * (W + 160) - 120 + Math.sin(time * 0.25 + i) * 6;
        F.drawCloud(ctx, cx, hz + 26 + (i % 2) * 14, 230 + (i % 3) * 40, { light: T.cloud[0], shade: T.cloud[1], alpha: 0.95 });
      }
      for (let i = 0; i < 7; i++) {
        const cx = (i / 6) * (W + 200) - 100 + Math.cos(time * 0.2 + i) * 8;
        F.drawCloud(ctx, cx, H - 8 + (i % 2) * 6, 280 + (i % 3) * 50, { light: T.ground[0], shade: T.ground[1], alpha: 1 });
      }
    } else {
      for (const t of TREES) F.drawTree(ctx, t[0] * W, hz + 4, t[2] * 0.8, t[1], time);
      if (level <= 10 && level % 2 === 0) { F.drawMushroom(ctx, W * 0.17, hz + 24, 0.7, '#ff4d6d'); F.drawMushroom(ctx, W * 0.74, hz + 30, 0.55, '#c86bfa'); }
      F.drawGrass(ctx, 0, hz + 6, W, time, T.night ? '#8e9ae0' : undefined);
      F.drawGrass(ctx, 0, H, W, time * 0.9, T.night ? '#6a76c4' : '#3fae5c');
    }
  };
  A.drawMenuScene = function (ctx, world, time) {
    A.drawScene(ctx, world === 2 ? 15 : 1, time);
  };

  // ---------- pots ----------
  // (x, y): the middle of the rim. Terracotta, a darker rim, a little shine.
  A.pot = function (ctx, x, y, s, glowy, time) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(40,90,40,0.22)'; ctx.beginPath(); ctx.ellipse(0, 50, 36, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c4633a';
    ctx.beginPath(); ctx.moveTo(-28, 8); ctx.lineTo(28, 8); ctx.lineTo(21, 48); ctx.quadraticCurveTo(0, 54, -21, 48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e07d4f';
    ctx.beginPath(); ctx.moveTo(-28, 8); ctx.lineTo(10, 8); ctx.lineTo(5, 50); ctx.quadraticCurveTo(-8, 51, -21, 48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6b3d22'; ctx.beginPath(); ctx.ellipse(0, 4, 30, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8925f'; rrect(ctx, -33, -1, 66, 15, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; rrect(ctx, -28, 1, 30, 4, 2); ctx.fill();
    if (glowy) { // a soft ring of light for the empty pot
      F.drawSparkles(ctx, 0, -20, time, 5, 34, 0.9);
    }
    ctx.restore();
  };
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  A.rrect = rrect;

  // a long plank under a straight row of pots
  A.shelf = function (ctx, x0, x1, y) {
    ctx.fillStyle = '#9b6a3c'; rrect(ctx, x0, y, x1 - x0, 15, 6); ctx.fill();
    ctx.fillStyle = '#b98550'; rrect(ctx, x0, y, x1 - x0, 6, 3); ctx.fill();
    ctx.fillStyle = 'rgba(60,30,10,0.25)'; ctx.fillRect(x0 + 8, y + 12, x1 - x0 - 16, 3);
  };
  // a stone step under a group of the staircase: left, right, its top
  A.step = function (ctx, x0, x1, top) {
    ctx.fillStyle = '#9d94b8'; rrect(ctx, x0, top, x1 - x0, GROUND + 70 - top, 8); ctx.fill();
    ctx.fillStyle = '#c3bbdc'; rrect(ctx, x0, top, x1 - x0, 9, 5); ctx.fill();
    ctx.fillStyle = 'rgba(70,60,110,0.18)'; ctx.fillRect(x0 + 6, top + 14, x1 - x0 - 12, 2);
  };

  // the bud that waits in the empty pot: a closed bud, a soft glow, and a "?" over it
  A.questionBud = function (ctx, x, y, s, time, strength) {
    const k = strength == null ? 1 : strength;
    if (k <= 0.01) return;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.6);
    ctx.save(); ctx.globalAlpha = k;
    F.drawFlower(ctx, x, y + 6, 1.45 * s, 1, 0.02, time);
    const gy = y - 92 * s;
    // a soft pale-gold glow behind the mark (plain alpha, so it shows on light skies too)
    const r = (50 + 7 * pulse) * s, g = ctx.createRadialGradient(x, gy, 2, x, gy, r);
    g.addColorStop(0, 'rgba(255,248,170,0.95)'); g.addColorStop(0.6, 'rgba(255,236,140,0.55)'); g.addColorStop(1, 'rgba(255,236,140,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, gy, r, 0, TAU); ctx.fill();
    F.drawSparkles(ctx, x, gy, time, 6, 40 * s, 0.9);
    ctx.font = '900 ' + Math.round(62 * s) + 'px system-ui, Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 7 * s; ctx.strokeStyle = 'rgba(190,70,150,0.9)'; ctx.strokeText('?', x, gy + 2 * pulse);
    ctx.fillStyle = '#fff'; ctx.fillText('?', x, gy + 2 * pulse);
    ctx.restore();
  };

  // ---------- the choice plates ----------
  // (cx, cy): the middle of the plate; w the side. state: { alpha, shake (0..1), lift (0..1 hovering) }
  A.plate = function (ctx, cx, cy, w, o) {
    o = o || {};
    ctx.save(); ctx.translate(cx, cy);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.scale == null ? 1 : o.scale, o.scale == null ? 1 : o.scale);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    const hw = w / 2;
    ctx.fillStyle = 'rgba(40,90,50,0.25)'; rrect(ctx, -hw + 3, -hw + 9, w, w, 26); ctx.fill();
    ctx.fillStyle = o.ring || '#ffe58a'; rrect(ctx, -hw, -hw, w, w, 26); ctx.fill();
    ctx.fillStyle = '#fffaf0'; rrect(ctx, -hw + 7, -hw + 7, w - 14, w - 14, 20); ctx.fill();
    ctx.fillStyle = 'rgba(190,230,170,0.5)'; rrect(ctx, -hw + 7, hw - 40, w - 14, 33, 18); ctx.fill();
    ctx.restore();
  };

  // ---------- particles ----------
  const parts = [];
  A.partCount = () => parts.length;
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  function spark(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4, rr = i % 2 ? r * 0.28 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  A.burst = function (kind, x, y, n, col) {
    n = n || 12;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = 40 + rnd() * 160;
      if (kind === 'dust') parts.push({ k: 's', x, y, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp * 0.6 - 30, g: 70, life: 0, max: 0.7 + rnd() * 0.6, r: 4 + rnd() * 5, c: col || L.RAINBOW[i % 7], rot: rnd() * 3 });
      else if (kind === 'petals') parts.push({ k: 'p', x, y, vx: Math.cos(a) * sp * 0.7, vy: -60 - rnd() * 120, g: 160, life: 0, max: 1.1 + rnd() * 0.8, r: 5 + rnd() * 4, c: col || L.RAINBOW[(i * 3) % 7], rot: rnd() * 3, vr: (rnd() - 0.5) * 8 });
      else if (kind === 'coin') parts.push({ k: 's', x, y, vx: Math.cos(a) * sp * 0.5, vy: Math.sin(a) * sp * 0.5 - 40, g: 40, life: 0, max: 0.6 + rnd() * 0.5, r: 4 + rnd() * 4, c: i % 2 ? '#fff3a0' : '#ffd23f', rot: rnd() * 3 });
      else if (kind === 'confetti') parts.push({ k: 'p', x: rnd() * A.VW, y: -20 - rnd() * 120, vx: (rnd() - 0.5) * 60, vy: 80 + rnd() * 120, g: 10, life: 0, max: 3 + rnd() * 1.5, r: 5 + rnd() * 4, c: L.RAINBOW[i % 7], rot: rnd() * 3, vr: (rnd() - 0.5) * 9 });
      else if (kind === 'twinkle') parts.push({ k: 's', x: x + (rnd() - 0.5) * 24, y: y + (rnd() - 0.5) * 24, vx: 0, vy: -16, g: 0, life: 0, max: 0.5 + rnd() * 0.3, r: 3 + rnd() * 3, c: col || '#fff8c0', rot: rnd() * 3 });
      else if (kind === 'heart') parts.push({ k: 'h', x: x + (rnd() - 0.5) * 30, y, vx: (rnd() - 0.5) * 30, vy: -50 - rnd() * 40, g: -4, life: 0, max: 1.3, r: 7 + rnd() * 4, c: '#ff7ab8', rot: 0 });
    }
    if (parts.length > 700) parts.splice(0, parts.length - 700);
  };
  A.stepParts = function (dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
  };
  A.drawParts = function (ctx) {
    ctx.save();
    for (const p of parts) {
      const u = p.life / p.max, a = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      ctx.globalAlpha = a; ctx.fillStyle = p.c;
      if (p.k === 's') spark(ctx, p.x, p.y, p.r * (1 - u * 0.5), p.rot + p.life * 2);
      else if (p.k === 'p') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, TAU); ctx.fill(); ctx.restore(); }
      else if (p.k === 'h') { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.r / 8, p.r / 8); ctx.beginPath(); ctx.moveTo(0, 6); ctx.bezierCurveTo(-12, -2, -6, -12, 0, -5); ctx.bezierCurveTo(6, -12, 12, -2, 0, 6); ctx.fill(); ctx.restore(); }
    }
    ctx.restore();
  };

  A.smooth = smooth; A.easeOutBack = easeOutBack; A.clamp = clamp;
  window.PetalArt = A;
})();
