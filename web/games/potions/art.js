/* Potion Colours: drawing. Everything is drawn in code on one canvas, in a world 540 units tall (the width follows
 * the screen). Isabella the Fairy, the skies, trees, mushrooms, clouds, coins, butterflies and the chest come from
 * the shared FairyArt (web/fairy/fairy.js); the cauldron, the bottles, the liquid and drips, the flower that can
 * be any colour, the thought bubble and the sparkles are this game's own. No blur or shadow filters, no
 * Math.random in the pictures (variety is a hash of the inputs), motion comes from the `time` passed in. */
(function () {
  'use strict';
  const F = FairyArt, TAU = Math.PI * 2, H = 540;
  let canvas, ctx, fit, dpr = 1, s = 1, VW = 1200;

  // ---------- the canvas ----------
  function init(cv) { canvas = cv; fit = F.setupCanvas(cv); ctx = fit.ctx; resize(); }
  function resize() { const r = fit.resize(); dpr = r.dpr; VW = r.VW; s = canvas.height / H; return r; }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toClient = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });
  function begin() { ctx.setTransform(s, 0, 0, s, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }

  // ---------- small helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbCss = (c, a) => (a == null || a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
  const lerpRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (hex, a) => rgbCss(hexRgb(hex), a);
  const shade = (hex, k) => rgbCss(lerpRgb(hexRgb(hex), k < 0 ? [0, 0, 0] : [255, 255, 255], Math.abs(k)));
  function hash(a, b, c) {
    let h = (Math.imul((a * 1000) | 0, 374761393) + Math.imul((b * 1000) | 0, 668265263) + Math.imul(((c || 0) * 1000) | 0, 1103515245)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
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
    for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.26 : r, a = i * Math.PI / 4 - Math.PI / 2; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  // Sceneries: World 1 (the Meadow) uses themes 0-3, World 2 (the Cloud Tops) 4-7
  const themeFor = (n) => ((n - 1) % 4) + (n > 10 ? 4 : 0);

  // ---------- the layout: where everything stands (world units) ----------
  const GROUND = 392, TABLE_Y = 332, SHELF_Y = 504, BOTTLE_H = 118, BOTTLE_W = 68, FLOWER_SCALE = 1.2;
  function layout(vw, nBottles, nFlowers) {
    const narrow = vw < 900, cx = narrow ? vw * 0.46 : vw * 0.5;
    const cr = 80;
    const lay = {
      VW: vw, cx, ground: GROUND, tableY: TABLE_Y, shelfY: SHELF_Y,
      c: { x: cx, y: 246, r: cr, rimY: 246 - cr * 0.68, hitR: 92 },
      isa: { x: cx - (narrow ? 205 : 235), y: 300, scale: 1.65 },
      flowers: [], bottles: [],
    };
    const fx = cx + (narrow ? 200 : 240), gap = narrow ? 104 : 120;
    for (let i = 0; i < 2; i++) lay.flowers.push({ x: fx + i * gap, y: GROUND, scale: FLOWER_SCALE, bubbleY: 150 });
    const n = Math.max(1, nBottles), sp = Math.min(158, (vw - 90) / n);
    for (let i = 0; i < n; i++) lay.bottles.push({ x: vw / 2 + (i - (n - 1) / 2) * sp, y: SHELF_Y - BOTTLE_H / 2 + 4 });
    lay.bottleSp = sp;
    return lay;
  }

  // ---------- the forest: sky, hills, trees, toadstools, the table, the shelf ----------
  function drawGround(themeIdx, time) {
    const T = F.THEMES[themeIdx];
    const g = ctx.createLinearGradient(0, 360, 0, H);
    g.addColorStop(0, T.ground[0]); g.addColorStop(1, T.ground[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= VW + 24; x += 24) ctx.lineTo(x, GROUND - 6 + Math.sin(x / 150 + themeIdx) * 9 + Math.sin(x / 47 + 1) * 3);
    ctx.lineTo(VW + 24, H); ctx.closePath(); ctx.fill();
  }
  function drawScenery(themeIdx, time, lay) {
    const narrow = VW < 900;
    F.drawSky(ctx, VW, H, themeIdx, time);
    drawGround(themeIdx, time);
    F.drawTree(ctx, narrow ? 54 : 96, GROUND + 4, narrow ? 1.25 : 1.6, (themeIdx + 1) % 4, time);
    F.drawTree(ctx, VW - (narrow ? 44 : 84), GROUND + 6, narrow ? 1.2 : 1.45, (themeIdx + 3) % 4, time);
    // toadstools, daisies and bluebells along the grass (clear of the table and the flowers)
    const T = F.THEMES[themeIdx], fcol = ['#ff4d6d', '#c86bfa', '#ff9f43'];
    const spots = narrow ? [0.2, 0.31, 0.74, 0.93] : [0.17, 0.3, 0.7, 0.84, 0.95, 0.06];
    spots.forEach((u, i) => {
      const x = u * VW;
      if (Math.abs(x - lay.cx) < 190 || lay.flowers.some((f) => Math.abs(x - f.x) < 60)) return;
      if (i % 2) F.drawMushroom(ctx, x, GROUND + 14 + (i % 3) * 5, 0.5 + (i % 3) * 0.12, fcol[i % 3]);
      else F.drawFlower(ctx, x, GROUND + 12 + (i % 3) * 4, 0.72, i % 3, 1, time);
    });
    for (let x = 12; x < VW; x += 66) F.drawGrass(ctx, x, GROUND + 20 + hash(x, 3) * 12, 38, time, T.ground[1]);
  }
  // the toadstool table: a flat red top with white spots on a thick cream stalk
  function drawTable(lay, time) {
    const cx = lay.cx, y = TABLE_Y, rx = 190;
    ctx.save();
    // stalk
    ctx.fillStyle = '#fff1d4';
    ctx.beginPath(); ctx.moveTo(cx - 46, y + 8); ctx.quadraticCurveTo(cx - 34, y + 60, cx - 74, GROUND + 6); ctx.quadraticCurveTo(cx, GROUND + 22, cx + 74, GROUND + 6); ctx.quadraticCurveTo(cx + 34, y + 60, cx + 46, y + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(190,150,110,0.3)';
    ctx.beginPath(); ctx.moveTo(cx + 12, y + 14); ctx.quadraticCurveTo(cx + 24, y + 60, cx + 54, GROUND + 8); ctx.quadraticCurveTo(cx + 66, GROUND + 4, cx + 74, GROUND + 6); ctx.quadraticCurveTo(cx + 34, y + 60, cx + 46, y + 8); ctx.closePath(); ctx.fill();
    // thickness of the top, then the top itself
    ctx.fillStyle = '#c9283f';
    ctx.beginPath(); ctx.ellipse(cx, y + 14, rx, 26, 0, 0, Math.PI); ctx.lineTo(cx - rx, y); ctx.lineTo(cx + rx, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2dfc2'; ctx.beginPath(); ctx.ellipse(cx, y + 11, rx - 14, 18, 0, 0.1, Math.PI - 0.1); ctx.fill();
    const g = ctx.createRadialGradient(cx - 40, y - 10, 10, cx, y, rx);
    g.addColorStop(0, '#ff6b81'); g.addColorStop(1, '#e03a52');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, y, rx, 26, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(120,10,30,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, y, rx, 26, 0, 0.05, Math.PI - 0.05); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const [dx, dy, r] of [[-130, 2, 9], [-86, 14, 7], [-30, 17, 8], [34, 15, 7], [92, 11, 9], [138, 0, 7], [-60, -8, 5], [70, -10, 5], [112, -6, 4], [-110, -9, 4]]) { ctx.beginPath(); ctx.ellipse(cx + dx, y + dy, r * 1.5, r * 0.62, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  // a mossy log along the bottom of the screen: the bottles stand on it
  function drawShelf(time) {
    const y = SHELF_Y;
    ctx.save();
    const g = ctx.createLinearGradient(0, y, 0, y + 60);
    g.addColorStop(0, '#a8703a'); g.addColorStop(1, '#6b4220');
    ctx.fillStyle = g; rrect(-30, y - 2, VW + 60, 70, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,10,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let x = 30; x < VW; x += 120) { ctx.beginPath(); ctx.moveTo(x, y + 22); ctx.quadraticCurveTo(x + 30, y + 16, x + 64, y + 24); ctx.stroke(); }
    ctx.fillStyle = '#6cc070'; rrect(-30, y - 6, VW + 60, 12, 6); ctx.fill();
    ctx.fillStyle = '#8be08a';
    for (let x = 10; x < VW; x += 37) { ctx.beginPath(); ctx.ellipse(x + hash(x, 1) * 12, y - 5, 8 + hash(x, 2) * 5, 3.5, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // ---------- bottles ----------
  function bottlePath() {
    ctx.beginPath();
    ctx.moveTo(-12, -50); ctx.lineTo(-12, -31);
    ctx.bezierCurveTo(-12, -21, -34, -17, -34, 6);
    ctx.lineTo(-34, 38); ctx.quadraticCurveTo(-34, 56, -16, 56);
    ctx.lineTo(16, 56); ctx.quadraticCurveTo(34, 56, 34, 38);
    ctx.lineTo(34, 6); ctx.bezierCurveTo(34, -17, 12, -21, 12, -31);
    ctx.lineTo(12, -50); ctx.closePath();
  }
  // o: { scale=1, rot=0, level=1 (liquid, 0..1), alpha=1, glow=0, id colour }
  function drawBottle(x, y, colourHex, o) {
    o = o || {};
    const sc = o.scale == null ? 1 : o.scale, rot = o.rot || 0, level = o.level == null ? 1 : o.level, al = o.alpha == null ? 1 : o.alpha;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.globalAlpha = al;
    if (o.glow > 0) glow(0, 0, 92, 'rgba(255,240,170,1)', Math.min(1, o.glow) * 0.8);
    // a soft ground shadow is skipped on purpose (no shadow filters); a flat oval under it will do when it stands
    if (o.stand) { ctx.fillStyle = 'rgba(40,20,5,0.22)'; ctx.beginPath(); ctx.ellipse(0, 57, 36, 7, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; bottlePath(); ctx.fill();
    if (level > 0.01) {
      ctx.save(); bottlePath(); ctx.clip();
      const yl = 50 - level * 76, ys = yl * Math.cos(rot);
      ctx.rotate(-rot);
      ctx.fillStyle = css(colourHex); ctx.fillRect(-120, ys, 240, 240);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(-120, ys, 240, 4);   // the liquid's top edge
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(14, ys, 30, 240);          // a little shade on the right
      ctx.restore();
    }
    // glass: outline, shine
    ctx.strokeStyle = 'rgba(25,35,80,0.9)'; ctx.lineWidth = 3.4; ctx.lineJoin = 'round'; bottlePath(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-23, 12); ctx.lineTo(-23, 36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, -46); ctx.lineTo(-8, -34); ctx.stroke();
    // lip and cork
    ctx.fillStyle = '#d7e6f0'; ctx.strokeStyle = 'rgba(25,35,80,0.9)'; ctx.lineWidth = 3; rrect(-16, -55, 32, 8, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c98c4f'; rrect(-11, -68, 22, 15, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,190,0.6)'; ctx.fillRect(-8, -65, 4, 8);
    ctx.restore();
  }
  // the pour stream, from the bottle's mouth (x0, y0) to the cauldron's liquid (x1, y1); u = how far it has run (0..1)
  function drawStream(x0, y0, x1, y1, colourHex, u, time) {
    if (u <= 0.01) return;
    const yy = y0 + (y1 - y0) * Math.min(1, u * 1.4), w = 7 + Math.sin(time * 40) * 0.8;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = css(colourHex); ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.1, (y0 + yy) / 2, x1 + Math.sin(time * 30) * 0.6, yy); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0 - 1, y0); ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.1 - 1, (y0 + yy) / 2, x1 - 1.5, yy); ctx.stroke();
    ctx.restore();
  }
  // a teardrop of potion flying through the air; ang = its direction of travel
  function drawDrop(x, y, colourHex, r, ang, time) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang + Math.PI / 2);
    glow(0, 0, r * 3, css(colourHex), 0.7);
    ctx.fillStyle = css(colourHex);
    ctx.beginPath(); ctx.moveTo(0, -r * 1.7); ctx.bezierCurveTo(r * 1.1, -r * 0.4, r * 1.1, r * 1.0, 0, r * 1.0); ctx.bezierCurveTo(-r * 1.1, r * 1.0, -r * 1.1, -r * 0.4, 0, -r * 1.7); ctx.fill();
    ctx.strokeStyle = 'rgba(25,35,80,0.55)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.ellipse(-r * 0.4, -r * 0.1, r * 0.2, r * 0.45, 0.2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------- the cauldron ----------
  // st: { surface: [r,g,b] (the liquid now), arms: [{ hex, a }] (the colours still swirling in), swirl: angle,
  //       level: 0..1, glow: 0..1, squash: -1..1, hover: 0..1, bubbles: 0..1 }
  function drawCauldron(c, st, time) {
    const x = c.x, y = c.y, r = c.r, rimY = c.rimY;
    const sq = st.squash || 0;
    ctx.save();
    ctx.translate(x, y + r); ctx.scale(1 - sq * 0.05, 1 + sq * 0.08); ctx.translate(-x, -(y + r));
    // glow behind
    if (st.glow > 0) glow(x, rimY - 6, 150, rgbCss(st.surface), 0.55 * st.glow);
    if (st.hover > 0) glow(x, y, 130, 'rgba(255,240,170,1)', 0.35 * st.hover);
    // legs
    ctx.fillStyle = '#2a2542';
    for (const dx of [-0.58, 0, 0.58]) { rrect(x + dx * r - 9, y + r * 0.86, 18, 20 + (dx === 0 ? 0 : 3), 6); ctx.fill(); }
    // handles
    ctx.strokeStyle = '#3b3560'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.arc(x + k * r * 0.88, rimY + 12, 13, 0, TAU); ctx.stroke(); }
    // body: a round pot with its top cut off at the rim
    const sinA = 0.68, a0 = Math.PI + Math.asin(sinA), a1 = -Math.asin(sinA);
    const bg = ctx.createRadialGradient(x - r * 0.35, y - r * 0.2, r * 0.1, x, y, r * 1.05);
    bg.addColorStop(0, '#5a5084'); bg.addColorStop(0.55, '#3a3358'); bg.addColorStop(1, '#1f1a36');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1, true); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.ellipse(x - r * 0.5, y + r * 0.12, r * 0.12, r * 0.42, 0.35, 0, TAU); ctx.fill();
    // a gold star on its belly
    ctx.fillStyle = '#ffd633'; ctx.save(); ctx.translate(x, y + r * 0.28); ctx.rotate(Math.sin(time * 0.8) * 0.06); star4(0, 0, 17); ctx.restore();
    // the rim and the liquid
    const rx = r * 0.84, ry = r * 0.2, ix = rx - 11, iy = ry - 4;
    ctx.fillStyle = '#6a6094'; ctx.beginPath(); ctx.ellipse(x, rimY, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#17132b'; ctx.beginPath(); ctx.ellipse(x, rimY + 1, ix, iy, 0, 0, TAU); ctx.fill();
    const lev = clamp(st.level, 0, 1);
    if (lev > 0.01) {
      const ly = rimY + 2 + (1 - lev) * 5, lx = ix * (0.8 + 0.2 * lev), lyr = iy * (0.8 + 0.2 * lev);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, ly, lx, lyr, 0, 0, TAU); ctx.clip();
      ctx.fillStyle = rgbCss(st.surface); ctx.fillRect(x - lx - 2, ly - lyr - 2, lx * 2 + 4, lyr * 2 + 4);
      // the colours still swirling in
      ctx.lineCap = 'round';
      const arms = st.arms || [];
      arms.forEach((m, k) => {
        if (m.a <= 0.01) return;
        ctx.strokeStyle = css(m.hex, clamp(m.a, 0, 1) * 0.92); ctx.lineWidth = lx * 0.42;
        ctx.beginPath();
        for (let j = 0; j <= 22; j++) {
          const u = j / 22, ang = st.swirl + k * TAU / arms.length + u * 5.2, rr = u * lx * 0.96;
          const px = x + Math.cos(ang) * rr, py = ly + Math.sin(ang) * rr * (lyr / lx);
          if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
      });
      // a pale sheen and a few bubbles
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(x - lx * 0.35, ly - lyr * 0.35, lx * 0.28, lyr * 0.22, -0.1, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      const bub = 0.25 + 0.75 * (st.bubbles || 0);
      for (let i = 0; i < 4; i++) {
        const u = (time * (0.35 + 0.1 * i) + i * 0.27) % 1;
        ctx.globalAlpha = (1 - u) * bub;
        ctx.beginPath(); ctx.arc(x + (hash(i, 5) - 0.5) * lx * 1.3, ly + lyr * 0.35 - u * lyr * 0.9, 2.5 + u * 5 * bub, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
    // the front of the rim, over the liquid
    ctx.strokeStyle = '#8a80b8'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(x, rimY, rx - 2, ry - 1, 0, 0.05, Math.PI - 0.05); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, rimY, rx - 2, ry - 1, 0, Math.PI + 0.3, TAU - 0.3); ctx.stroke();
    ctx.restore();
  }

  // ---------- the flower that can be any colour ----------
  // bloom 0 = a grey closed bud, 1 = open in `hex`. o: { tilt (head bend, radians), wiggle (0..1), appear (0..1) }
  const GREY = [168, 174, 180];
  function drawFlower(x, ground, scale, bloom, hex, time, o) {
    o = o || {};
    const ap = o.appear == null ? 1 : o.appear;
    if (ap <= 0.01) return;
    const b = smooth(bloom), sc = (scale || 1) * smooth(ap) * (1 + 0.04 * Math.sin(b * Math.PI)), hh = 108;
    const tilt = o.tilt || 0, wig = (o.wiggle || 0) * Math.sin(time * 22) * 0.08;
    const sway = Math.sin(time * 1.6 + x * 0.05) * 2.6 * (0.4 + 0.6 * b);
    ctx.save(); ctx.translate(x, ground); ctx.scale(sc, sc); ctx.rotate(wig);
    const stemC = lerpRgb([132, 150, 126], [47, 143, 85], b), leafC = lerpRgb([142, 162, 134], [79, 191, 106], b);
    const hx = sway + tilt * 46, hy = -hh + Math.abs(tilt) * 10;
    ctx.strokeStyle = rgbCss(stemC); ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(sway * 0.3 + tilt * 6, -hh * 0.55, hx, hy); ctx.stroke();
    ctx.fillStyle = rgbCss(leafC);
    for (const k of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sway * 0.1, -hh * 0.2); ctx.quadraticCurveTo(k * 36, -hh * 0.42, k * 34, -hh * 0.2 + 8); ctx.quadraticCurveTo(k * 12, -hh * 0.1, sway * 0.1, -hh * 0.2); ctx.fill();
    }
    ctx.translate(hx, hy); ctx.rotate(tilt * 0.9);
    const col = lerpRgb(GREY, hexRgb(hex), b), colHi = lerpRgb(col, [255, 255, 255], 0.35), colLo = lerpRgb(col, [0, 0, 0], 0.18);
    const n = 10, len = 25, wid = 9.5, rr = 6 + 15 * b;
    // back petals a little darker, then the front ones
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = rgbCss(pass ? col : colLo);
      for (let i = 0; i < n; i++) {
        let a = ((i + (pass ? 0.5 : 0)) / n) * TAU + Math.PI / 2; a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
        const th = -Math.PI / 2 + a * (0.1 + 0.9 * b), k = pass ? 1 : 0.88;
        ctx.beginPath(); ctx.ellipse(Math.cos(th) * rr * k, Math.sin(th) * rr * k, len * k, wid * k * (1 + 0.55 * (1 - b)), th, 0, TAU); ctx.fill();
      }
    }
    ctx.fillStyle = rgbCss(colHi, 0.55);
    for (let i = 0; i < n; i += 2) {
      let a = (i / n) * TAU + Math.PI / 2; a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
      const th = -Math.PI / 2 + a * (0.1 + 0.9 * b);
      ctx.beginPath(); ctx.ellipse(Math.cos(th) * (rr + 6), Math.sin(th) * (rr + 6), len * 0.45, wid * 0.3, th, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = rgbCss(lerpRgb([140, 150, 130], [255, 214, 51], b)); ctx.beginPath(); ctx.arc(0, 0, 8 + 3 * b, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(-2.5, -2.5, 3, 0, TAU); ctx.fill();
    // a happy face once it has bloomed, a sleepy one while it is a bud
    ctx.fillStyle = '#4a2a14';
    if (b > 0.6) { ctx.globalAlpha = (b - 0.6) / 0.4; ctx.beginPath(); ctx.arc(-3.2, -0.6, 1.3, 0, TAU); ctx.arc(3.2, -0.6, 1.3, 0, TAU); ctx.fill(); ctx.strokeStyle = '#4a2a14'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 1, 3, 0.2, Math.PI - 0.2); ctx.stroke(); }
    else { ctx.strokeStyle = '#6a737a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-1.5, 0.8); ctx.moveTo(5, 0); ctx.lineTo(1.5, 0.8); ctx.stroke(); }
    ctx.restore();
  }
  // where a flower's head is, in world units (for the drop to fly to, the hit test and the butterflies)
  function flowerHead(f, scale) { return { x: f.x, y: f.y - 108 * (scale || 1) }; }

  // ---------- the thought bubble with the colour the flower wants ----------
  function drawBubble(x, y, hex, dots, time, o) {
    o = o || {};
    const ap = o.appear == null ? 1 : o.appear;
    if (ap <= 0.01) return;
    const pulse = 1 + (o.pulse || 0) * 0.07 * Math.sin(time * 14), sc = smooth(ap) * pulse;
    const hasDots = dots && dots.length;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    const R = hasDots ? 74 : 66;
    // a cloud of white puffs
    ctx.fillStyle = 'rgba(40,60,110,0.18)';
    const puffs = [[0, 0, R * 0.82], [-R * 0.62, R * 0.1, R * 0.5], [R * 0.62, R * 0.1, R * 0.5], [-R * 0.38, -R * 0.52, R * 0.5], [R * 0.4, -R * 0.52, R * 0.5], [0, R * 0.52, R * 0.5]];
    for (const [px, py, pr] of puffs) { ctx.beginPath(); ctx.arc(px, py + 3, pr, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ffffff';
    for (const [px, py, pr] of puffs) { ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill(); }
    // the tail: two little bubbles down towards the flower
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-6, R + 12, 11, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-16, R + 34, 7, 0, TAU); ctx.fill();
    // the swatch: a big round blob of the colour, with a ring so a pale one still shows against the white
    const sy = hasDots ? -9 : 0, sr = hasDots ? 43 : 48;
    ctx.fillStyle = css(hex); ctx.beginPath(); ctx.arc(0, sy, sr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(40,60,110,0.45)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-sr * 0.38, sy - sr * 0.4, sr * 0.2, sr * 0.11, -0.6, 0, TAU); ctx.fill();
    if (hasDots) {
      const gap = 27, x0 = -((dots.length - 1) * gap) / 2;
      dots.forEach((d, i) => {
        ctx.fillStyle = css(d); ctx.beginPath(); ctx.arc(x0 + i * gap, 52, 10.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(40,60,110,0.55)'; ctx.lineWidth = 2.5; ctx.stroke();
      });
    }
    ctx.restore();
  }

  // ---------- the round progress row and the coin count ----------
  function drawPips(cx, y, pips, time) {
    const gap = 40, x0 = cx - ((pips.length - 1) * gap) / 2;
    ctx.save();
    pips.forEach((p, i) => {
      const x = x0 + i * gap, now = p.state === 'now', r = 15 + (now ? 2 + Math.sin(time * 4) * 1.2 : 0);
      ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, TAU); ctx.fill();
      if (p.state === 'done') {
        const cols = p.cols && p.cols.length ? p.cols : ['#ffd633'];
        cols.forEach((hex, k) => { ctx.fillStyle = css(hex); ctx.beginPath(); ctx.arc(x, y, r, Math.PI * (k / cols.length * 2 - 0.5), Math.PI * ((k + 1) / cols.length * 2 - 0.5)); ctx.lineTo(x, y); ctx.closePath(); ctx.fill(); });
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x - 4, y - 5, 3.5, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = now ? 'rgba(255,214,51,0.95)' : 'rgba(120,150,190,0.45)'; ctx.beginPath(); ctx.arc(x, y, r - 1, 0, TAU); ctx.fill();
        if (now) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; star4(x, y, 8); }
      }
      ctx.strokeStyle = 'rgba(40,60,110,0.5)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    });
    ctx.restore();
  }
  function drawCoinCount(x, y, n, time, pulse) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; rrect(x - 62, y - 25, 124, 50, 25); ctx.fill();
    F.drawCoin(ctx, x - 34, y, time * 2, 17 * (1 + (pulse || 0) * 0.22));
    ctx.fillStyle = '#c77700'; ctx.font = '900 30px system-ui, Roboto, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x - 10, y + 2);
    ctx.restore();
  }

  // ---------- Isabella ----------
  function drawIsabella(x, y, time, o) { F.drawFairy(ctx, x, y, time, o); }
  // where the tip of her wand is, so sparkles can leave from it (hover pose, scale sc, not flipped)
  function wandTip(x, y, sc) { return { x: x + 31 * sc * 0.995 - 2 * sc, y: y - 41 * sc * 0.995 - 2 }; }

  // ---------- sparkles, puffs and splashes ----------
  const parts = [];
  const MAXP = 600;
  const rnd = (a, b) => a + Math.random() * (b - a);
  function add(p) { if (parts.length >= MAXP) parts.shift(); parts.push(p); }
  // kinds: spark (a ring of twinkles), puff (a soft cloud), splash (droplets), confetti, coins (a fountain), hearts, bubbles (rising), zap (sparkles streaming to a target)
  function burst(kind, x, y, hex, n, tx, ty) {
    const col = hex || '#fff6b0';
    if (kind === 'spark') {
      for (let i = 0; i < (n || 14); i++) { const a = rnd(0, TAU), v = rnd(40, 150); add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, g: 90, life: rnd(0.7, 1.2), max: 1.2, c: i % 3 ? col : '#ffffff', sz: rnd(3.5, 7.5), t: 0, ph: rnd(0, TAU) }); }
    } else if (kind === 'puff') {
      for (let i = 0; i < (n || 7); i++) add({ k: 'puff', x: x + rnd(-26, 26), y: y + rnd(-6, 6), vx: rnd(-26, 26), vy: rnd(-78, -38), life: rnd(1.1, 1.7), max: 1.7, c: col, sz: rnd(15, 25), t: 0 });
    } else if (kind === 'splash') {
      for (let i = 0; i < (n || 6); i++) add({ k: 'drop', x, y, vx: rnd(-55, 55), vy: rnd(-95, -35), g: 260, life: rnd(0.35, 0.6), max: 0.6, c: col, sz: rnd(2.2, 4), t: 0 });
    } else if (kind === 'confetti') {
      for (let i = 0; i < (n || 60); i++) add({ k: 'conf', x: rnd(0, VW), y: rnd(-70, -10), vx: rnd(-30, 30), vy: rnd(50, 130), life: 4, max: 4, c: F.RAINBOW[i % 7], sz: rnd(5, 9), t: 0, ph: rnd(0, TAU) });
    } else if (kind === 'coins') {
      for (let i = 0; i < (n || 24); i++) { const a = -Math.PI / 2 + rnd(-0.9, 0.9), v = rnd(220, 470); add({ k: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 620, life: 2.2, max: 2.2, sz: rnd(10, 15), t: 0, ph: rnd(0, TAU) }); }
    } else if (kind === 'hearts') {
      for (let i = 0; i < (n || 5); i++) add({ k: 'heart', x: x + rnd(-24, 24), y, vx: rnd(-14, 14), vy: rnd(-70, -42), life: 1.4, max: 1.4, c: i % 2 ? '#ff6fb0' : '#ff4d6d', sz: rnd(7, 11), t: 0 });
    } else if (kind === 'bubble') {
      for (let i = 0; i < (n || 4); i++) add({ k: 'bub', x: x + rnd(-24, 24), y, vx: rnd(-8, 8), vy: rnd(-60, -35), life: rnd(0.9, 1.4), max: 1.4, c: col, sz: rnd(4, 9), t: 0 });
    } else if (kind === 'zap') {
      for (let i = 0; i < (n || 10); i++) { const d = Math.hypot(tx - x, ty - y) || 1, v = d / rnd(0.5, 0.8); add({ k: 'spark', x, y, vx: ((tx - x) / d) * v + rnd(-30, 30), vy: ((ty - y) / d) * v + rnd(-40, 20), g: 0, life: rnd(0.45, 0.8), max: 0.8, c: i % 2 ? '#fff6b0' : col, sz: rnd(3, 6), t: 0, ph: rnd(0, TAU) }); }
    }
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.g) p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'conf') p.vx += Math.sin(p.t * 3 + p.ph) * 40 * dt;
      if (p.k === 'coin' && p.y > H + 40) parts.splice(i, 1);
    }
  }
  function drawParts() {
    ctx.save();
    for (const p of parts) {
      const u = clamp(p.life / p.max, 0, 1);
      if (p.k === 'spark') { ctx.globalAlpha = Math.min(1, u * 1.6) * (0.55 + 0.45 * Math.sin(p.t * 20 + p.ph)); ctx.fillStyle = p.c; star4(p.x, p.y, p.sz * (0.5 + 0.6 * u)); }
      else if (p.k === 'puff') { ctx.globalAlpha = Math.min(0.62, u * 0.8); ctx.fillStyle = css(p.c); ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (1.5 - u * 0.6), 0, TAU); ctx.fill(); ctx.globalAlpha *= 0.5; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x - p.sz * 0.3, p.y - p.sz * 0.3, p.sz * 0.55 * (1.5 - u * 0.6), 0, TAU); ctx.fill(); }
      else if (p.k === 'drop') { ctx.globalAlpha = Math.min(1, u * 2); ctx.fillStyle = css(p.c); ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, TAU); ctx.fill(); }
      else if (p.k === 'conf') { ctx.globalAlpha = Math.min(1, u * 3); ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t * 3 + p.ph); ctx.fillRect(-p.sz, -p.sz * 0.4, p.sz * 2, p.sz * 0.8); ctx.restore(); }
      else if (p.k === 'coin') { ctx.globalAlpha = 1; F.drawCoin(ctx, p.x, p.y, p.t * 9 + p.ph, p.sz); }
      else if (p.k === 'heart') { ctx.globalAlpha = Math.min(1, u * 2); ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); const r = p.sz; ctx.beginPath(); ctx.moveTo(0, r * 0.9); ctx.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.7, -r * 1.3, 0, -r * 0.45); ctx.bezierCurveTo(r * 0.7, -r * 1.3, r * 1.5, -r * 0.1, 0, r * 0.9); ctx.fill(); ctx.restore(); }
      else if (p.k === 'bub') { ctx.globalAlpha = u * 0.9; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.fillStyle = css(p.c, 0.35); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, TAU); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
  }

  // ---------- the level-select scene: sky, meadow, trees, floating potion bubbles, Isabella flying by ----------
  const menuBubbles = [];
  function drawMenu(world, time, isaX) {
    const th = world === 2 ? 7 : 3;
    F.drawSky(ctx, VW, H, th, time);
    drawGround(th, time);
    F.drawTree(ctx, 70, GROUND + 6, 1.5, 0, time);
    F.drawTree(ctx, VW - 70, GROUND + 6, 1.4, 3, time);
    for (let i = 0; i < 8; i++) {
      const x = (0.1 + 0.8 * hash(i, 7)) * VW;
      if (i % 3) F.drawFlower(ctx, x, GROUND + 18 + (i % 4) * 6, 0.8, i % 6, 1, time); else F.drawMushroom(ctx, x, GROUND + 22, 0.6, ['#ff4d6d', '#c86bfa', '#ff9f43'][i % 3]);
    }
    for (const b of menuBubbles) {
      ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = css(b.c, 0.55); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(b.x - b.r * 0.35, b.y - b.r * 0.38, b.r * 0.22, b.r * 0.12, -0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    F.drawFairy(ctx, isaX, 150 + Math.sin(time * 1.3) * 18, time, { pose: 'fly', scale: 1.5, dust: 0.8, happy: true });
  }
  function stepMenu(dt, colours) {
    if (menuBubbles.length < 7 && Math.random() < dt * 1.1) menuBubbles.push({ x: rnd(40, VW - 40), y: H + 40, r: rnd(18, 34), c: colours[Math.floor(Math.random() * colours.length)], vy: rnd(24, 46), ph: rnd(0, TAU) });
    for (let i = menuBubbles.length - 1; i >= 0; i--) { const b = menuBubbles[i]; b.y -= b.vy * dt; b.x += Math.sin(b.y / 40 + b.ph) * 0.4; if (b.y < -50) menuBubbles.splice(i, 1); }
  }

  window.PotionArt = {
    H, GROUND, TABLE_Y, SHELF_Y, BOTTLE_H, BOTTLE_W, FLOWER_SCALE,
    init, resize, toWorld, toClient, begin, themeFor, layout,
    hexRgb, rgbCss, lerpRgb, css, shade, smooth, clamp, hash, glow, star4,
    drawScenery, drawTable, drawShelf, drawBottle, drawStream, drawDrop, drawCauldron, drawFlower, flowerHead, drawBubble,
    drawPips, drawCoinCount, drawIsabella, wandTip,
    burst, stepParts, drawParts, clearParts() { parts.length = 0; },
    drawMenu, stepMenu,
    get partCount() { return parts.length; }, get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get ctx() { return ctx; }, get canvas() { return canvas; },
    F,
  };
})();
