/* Sea Jigsaw: everything you see while playing. The pictures themselves are painted by pictures.js; this file
 * turns one into a jigsaw (the picture, painted once at the board's size; every piece cut out of it once into its
 * own little image; the board with the pieces already home), and draws the table, the tray, the bonus coins, the
 * key, the treasure chest and the sparkles.
 * House style copied from web/render.js and Bubble Party (never shared, never edited there): a 540-unit-tall world
 * scaled to the screen, the device pixel ratio capped at 2.5, the glow sprite, the stamped gold coin, the particles. */
(function () {
  'use strict';
  const L = JigsawLogic, P = JigsawPictures;
  const H = 540, TAU = Math.PI * 2, PW = L.PW, PH = L.PH;
  const LEFT = 116;        // the column of round buttons down the left edge (19vh = 103 units, and a little air)
  const GAP = 8, EDGE = 4, TRAY_MIN = 200, TRAY_MAX = 300;
  const HUD_H = 82;        // the strip at the top of the tray: the little chest, the bonus coins, the pieces still to come
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const TABLE = {          // the sea behind the board, one colour for each size of puzzle
    easy: { top: '#8fe6dc', bot: '#1a8794', sand: ['#f6e7b6', '#dcc184'], far: 'rgba(20,110,120,0.45)' },
    medium: { top: '#8fd6fa', bot: '#1c62b4', sand: ['#f6e3b4', '#dcc08a'], far: 'rgba(20,70,150,0.45)' },
    hard: { top: '#b0a4f4', bot: '#3a2c92', sand: ['#e2d3f0', '#b8a2d4'], far: 'rgba(50,34,120,0.5)' },
  };

  let canvas, ctx, dpr = 1, s = 1, VW = 1200;
  const backCache = {};
  let coinSpr = null;
  // Every picture this file keeps is made and thrown away here, and counted, so the soak test can see that none leak.
  // (A canvas shrunk to nothing gives its memory back at once; waiting for the garbage collector can take a phone a while.)
  const tally = { made: 0, freed: 0 };
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); tally.made++; return c; }
  function free(c) { if (c && c.width) { c.width = 0; c.height = 0; tally.freed++; } }

  function init(cv) { canvas = cv; ctx = canvas.getContext('2d', { alpha: false }); resize(); }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    s = canvas.height / H; VW = canvas.width / s;
    for (const k of Object.keys(backCache)) { free(backCache[k]); delete backCache[k]; }
    free(coinSpr); coinSpr = null;
  }
  const toWorld = (cx, cy) => ({ x: (cx * dpr) / s, y: (cy * dpr) / s });
  const toClient = (x, y) => ({ x: (x * s) / dpr, y: (y * s) / dpr });
  function begin() { ctx.setTransform(s, 0, 0, s, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  function rrect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function star(x, y, r1, r2, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath();
  }

  // ---------- where everything goes ----------
  // The board sits just right of the button column, as big as fits (832 x 520 on a 20:9 phone, so the smallest
  // pieces are 19vh); the tray takes what is left on the right. On a squarer screen the board shrinks to keep a tray.
  //   k: world units per picture unit on the board; tk: the same for a piece waiting in the tray (smaller)
  function layout(p) {
    const M = L.MODES[p.mode];
    const k = Math.max(0.3, Math.min(1, (VW - LEFT - GAP - TRAY_MIN - EDGE) / PW, (H - 20) / PH));
    const bw = PW * k, bh = PH * k;
    const trayW = clamp(VW - LEFT - GAP - bw - EDGE, 120, TRAY_MAX);
    const off = Math.max(0, (VW - (LEFT + bw + GAP + trayW + EDGE)) / 2);
    const bx = LEFT + off, by = (H - bh) / 2;
    const tray = { x0: bx + bw + GAP, y0: 10, x1: bx + bw + GAP + trayW, y1: H - 10 };
    const [cols, rows] = M.tray, sy0 = tray.y0 + HUD_H, sw = trayW / cols, sh = (tray.y1 - 4 - sy0) / rows, rc = L.reach(p);
    const tk = Math.min((sw - 14) / rc.w, (sh - 12) / rc.h, k);
    const slots = [];
    for (let i = 0; i < cols * rows; i++) slots.push({ x: tray.x0 + ((i % cols) + 0.5) * sw, y: sy0 + (Math.floor(i / cols) + 0.5) * sh, w: sw, h: sh });
    const tcx = (tray.x0 + tray.x1) / 2, cr = Math.min(22, trayW * 0.094);
    const hud = { chest: { x: tray.x0 + trayW * 0.15, y: tray.y0 + 40, sc: Math.min(0.36, trayW * 0.00152) },
      coins: [0, 1, 2].map((i) => ({ x: tray.x0 + trayW * (0.385 + i * 0.235), y: tray.y0 + 30, r: cr })),
      bag: { x: tcx, y: tray.y0 + 66 } };
    return { k, tk, cols, rows, board: { x: bx, y: by, w: bw, h: bh }, tray, slots, hud, tcx,
      // the big chest at the end stands to the right of the tray's middle, so its lid can swing open without covering the picture
      chest: { x: tray.x0 + trayW * 0.61, y: 462, sc: Math.min(1.05, trayW / 226) }, counter: { x: tcx, y: 150 }, isa: { x: tcx, y: 262, sc: Math.min(1.2, trayW / 198) } };
  }

  // ---------- helpers (from render.js and Bubble Party) ----------
  const glowCache = {};
  function glowSprite(color) {
    let c = glowCache[color];
    if (!c) {
      c = mk(128, 128);
      const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowCache[color] = c;
    }
    return c;
  }
  function glow(x, y, r, color, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a == null ? 1 : a;
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  function outlined(text, x, y, size, fill, stroke) {
    ctx.font = `900 ${size}px system-ui, Roboto, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.22; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  // the gold coin, painted once into a sprite and stamped (ph spins it: the coin narrows as it turns edge-on)
  function coinSprite() {
    if (coinSpr) return coinSpr;
    const R = 32, half = Math.ceil((R + 5) * s), c = mk(half * 2, half * 2);
    const g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, half, half);
    P.use(g, () => P.drawCoin(0, 0, 0, R));
    c.R = R; c.e = R + 5;
    return (coinSpr = c);
  }
  function drawCoin(x, y, ph, r, alpha) {
    const c = coinSprite(), sx = 0.3 + 0.7 * Math.abs(Math.cos(ph)), e = c.e * (r / c.R);
    if (alpha != null && alpha < 1) { ctx.globalAlpha = Math.max(0, alpha); ctx.drawImage(c, x - e * sx, y - e, 2 * e * sx, 2 * e); ctx.globalAlpha = 1; return; }
    ctx.drawImage(c, x - e * sx, y - e, 2 * e * sx, 2 * e);
  }

  // ---------- the sea behind the board ----------
  function backdrop(mode) {
    let c = backCache[mode];
    if (!c) {
      const th = TABLE[mode] || TABLE.easy;
      c = mk(canvas.width, canvas.height);
      const g = c.getContext('2d', { alpha: false });
      g.setTransform(s, 0, 0, s, 0, 0);
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, th.top); gr.addColorStop(1, th.bot);
      g.fillStyle = gr; g.fillRect(0, 0, VW, H);
      g.save(); g.globalCompositeOperation = 'lighter';
      const rg = g.createLinearGradient(0, 0, 0, H);
      rg.addColorStop(0, 'rgba(255,255,255,0.16)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      for (let i = 0; i < 7; i++) { const x = -160 + i * (VW / 5.4) + (i % 2) * 40, w = 44 + (i % 3) * 26; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w + 190, H); g.lineTo(x + 130, H); g.closePath(); g.fill(); }
      g.restore();
      g.fillStyle = th.far; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= VW + 20; x += 20) g.lineTo(x, 430 + 26 * Math.sin(x / 170 + 1) + 13 * Math.sin(x / 61 + 2));
      g.lineTo(VW + 20, H); g.closePath(); g.fill();
      const sg = g.createLinearGradient(0, 486, 0, H);
      sg.addColorStop(0, th.sand[0]); sg.addColorStop(1, th.sand[1]);
      g.fillStyle = sg; g.beginPath(); g.moveTo(-10, H + 4);
      for (let x = -10; x <= VW + 22; x += 12) g.lineTo(x, 496 + 5 * Math.sin(x / 95 + 1.3) + 3 * Math.sin(x / 41));
      g.lineTo(VW + 22, H + 4); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(0, 0);
      for (let x = 0; x <= VW + 24; x += 24) g.lineTo(x, 9 + Math.sin(x / 40) * 3);
      g.lineTo(VW + 24, 0); g.closePath(); g.fill();
      backCache[mode] = c;
    }
    return c;
  }
  function drawBackdrop(mode) {
    for (const k of Object.keys(backCache)) if (k !== mode) { free(backCache[k]); delete backCache[k]; }   // one sea at a time
    ctx.drawImage(backdrop(mode), 0, 0, VW, H);
  }
  // the level select: the same sea, with bubbles drifting up behind the pictures
  const amb = [];
  for (let i = 0; i < 26; i++) amb.push({ x: Math.random() * 2400, y: Math.random() * H, r: 2 + Math.random() * 5, sp: 14 + Math.random() * 30, ph: Math.random() * TAU });
  function drawMenu(mode, time) {
    drawBackdrop(mode);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath();
    for (const a of amb) {
      const x = ((a.x + Math.sin(time * 0.5 + a.ph) * 12) % (VW + 40)) - 20, y = ((((a.y - time * a.sp) % (H + 30)) + H + 30) % (H + 30)) - 15;
      ctx.moveTo(x + a.r, y); ctx.arc(x, y, a.r, 0, TAU);
    }
    ctx.stroke();
  }

  // ---------- one puzzle's pictures ----------
  // asset: { id, pic (the picture at the board's size), board (the board: its guide and the pieces already home),
  //          sprites: [{ c, ox, oy, w, h }] (each piece cut out of the picture; ox, oy: its corner from the middle of
  //          the piece's place, in picture units; sh: its soft shadow), qx, qy (pixels per picture unit) }
  let asset = null;
  function release() {
    if (!asset) return;
    free(asset.pic); free(asset.board);
    for (const sp of asset.sprites) { free(sp.c); free(sp.sh); }
    asset = null;
  }
  function tracePath(g, piece) {
    g.beginPath();
    for (const q of piece.path) { if (q[0] === 'M') g.moveTo(q[1], q[2]); else if (q[0] === 'L') g.lineTo(q[1], q[2]); else g.bezierCurveTo(q[1], q[2], q[3], q[4], q[5], q[6]); }
    g.closePath();
  }
  // home: the ids of the pieces already in place
  function prepare(p, lay, home) {
    release();
    const C = L.cut(p), M = L.MODES[p.mode];
    const W = Math.max(8, Math.round(lay.board.w * s)), Hh = Math.max(8, Math.round(lay.board.h * s)), qx = W / PW, qy = Hh / PH;
    const pic = mk(W, Hh);
    P.paint(p.pic, pic.getContext('2d', { alpha: false }), W, Hh);
    const sprites = [];
    for (const piece of C.pieces) {
      const b = piece.box, pad = 2.5;
      const sx = Math.floor((b.x0 - pad) * qx), sy = Math.floor((b.y0 - pad) * qy), ex = Math.ceil((b.x1 + pad) * qx), ey = Math.ceil((b.y1 + pad) * qy);
      const c = mk(ex - sx, ey - sy);
      const g = c.getContext('2d');
      g.setTransform(qx, 0, 0, qy, -sx, -sy);
      tracePath(g, piece);
      g.save(); g.clip();
      g.setTransform(1, 0, 0, 1, -sx, -sy);
      g.drawImage(pic, 0, 0);
      g.restore();
      // the piece's edge: a dark line, and a thin light one just inside it, so a piece reads on any picture
      g.setTransform(qx, 0, 0, qy, -sx, -sy);
      g.lineJoin = 'round';
      tracePath(g, piece);
      g.strokeStyle = 'rgba(8,30,70,0.62)'; g.lineWidth = 2.2; g.stroke();
      g.save(); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 4.4; g.stroke(); g.strokeStyle = 'rgba(8,30,70,0.5)'; g.lineWidth = 1.6; g.stroke(); g.restore();
      // its shadow: the same outline, soft and dark, a third of the size (it is only ever drawn blurred)
      const f = 1 / 3, pd = 8, sh = mk(Math.ceil(c.width * f) + pd * 2, Math.ceil(c.height * f) + pd * 2);
      const sg = sh.getContext('2d');
      sg.shadowColor = 'rgba(0,18,48,0.8)'; sg.shadowBlur = 5; sg.shadowOffsetX = 4000; sg.fillStyle = '#000';
      sg.setTransform(qx * f, 0, 0, qy * f, -sx * f + pd - 4000, -sy * f + pd);
      tracePath(sg, piece); sg.fill();
      sprites.push({ c, sh, sx, sy, ox: sx / qx - piece.hx, oy: sy / qy - piece.hy, w: c.width / qx, h: c.height / qy, sp: pd / (qx * f), sw: sh.width / (qx * f), shh: sh.height / (qy * f) });
    }
    const board = mk(W, Hh);
    asset = { id: p.id, mode: p.mode, pic, board, sprites, qx, qy, W, Hh, cw: p.cw, ch: p.ch, guide: M.guide, cut: C };
    paintBoard(home || []);
    return asset;
  }
  // the board with nothing on it: Easy shows a faint ghost of the picture, Medium the outlines of the pieces, Hard neither
  function paintBoard(home) {
    const a = asset, g = a.board.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    const bg = g.createLinearGradient(0, 0, 0, a.Hh);
    bg.addColorStop(0, '#2c5684'); bg.addColorStop(1, '#17365c');
    g.fillStyle = bg; g.fillRect(0, 0, a.W, a.Hh);
    if (a.guide === 'ghost') { g.globalAlpha = 0.3; g.drawImage(a.pic, 0, 0); g.globalAlpha = 1; }
    if (a.guide !== 'none') {
      g.setTransform(a.qx, 0, 0, a.qy, 0, 0);
      g.strokeStyle = a.guide === 'ghost' ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.55)'; g.lineWidth = a.guide === 'ghost' ? 1.6 : 2; g.lineJoin = 'round';
      for (const piece of a.cut.pieces) { tracePath(g, piece); g.stroke(); }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    for (const id of home) g.drawImage(a.sprites[id].c, a.sprites[id].sx, a.sprites[id].sy);
  }
  // piece `id` has gone home: it becomes part of the board
  function placeHome(id) {
    if (!asset || !asset.sprites[id]) return;
    const g = asset.board.getContext('2d'), sp = asset.sprites[id];
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    g.drawImage(sp.c, sp.sx, sp.sy);
  }
  // the frame, and the board inside it. shine 0..1: the frame glows (the puzzle is done)
  function drawBoard(lay, shine) {
    const B = lay.board;
    ctx.fillStyle = 'rgba(0,30,70,0.28)'; rrect(ctx, B.x - 5, B.y - 2, B.w + 10, B.h + 10, 10); ctx.fill();
    if (shine > 0) glow(B.x + B.w / 2, B.y + B.h / 2, B.w * 0.75, 'rgba(255,240,170,0.7)', 0.6 * shine);
    ctx.fillStyle = shine > 0 ? '#fff6c8' : '#ffffff'; rrect(ctx, B.x - 5, B.y - 5, B.w + 10, B.h + 10, 9); ctx.fill();
    if (asset) ctx.drawImage(asset.board, B.x, B.y, B.w, B.h);
  }
  // the finished picture over the board: a (0..1) fades it in. Used for the peek and to melt the seams at the end.
  function drawPicture(lay, a) {
    if (!asset || a <= 0.004) return;
    const B = lay.board;
    ctx.globalAlpha = Math.min(1, a); ctx.drawImage(asset.pic, B.x, B.y, B.w, B.h); ctx.globalAlpha = 1;
  }
  // o: { alpha, rot, shadow (0..1: how far it floats above the table) }
  function drawPiece(id, x, y, scale, o) {
    if (!asset) return;
    const sp = asset.sprites[id];
    if (!sp || scale <= 0.001) return;
    const sh = o && o.shadow ? o.shadow : 0, al = o && o.alpha != null ? o.alpha : 1;
    if (o && o.rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot); x = 0; y = 0; }
    if (sh > 0) {
      ctx.globalAlpha = al * Math.min(1, 0.5 + sh * 0.25);
      ctx.drawImage(sp.sh, x + (sp.ox - sp.sp + 1.5 + sh * 4) * scale, y + (sp.oy - sp.sp + 2.5 + sh * 7) * scale, sp.sw * scale, sp.shh * scale);
    }
    ctx.globalAlpha = al;
    ctx.drawImage(sp.c, x + sp.ox * scale, y + sp.oy * scale, sp.w * scale, sp.h * scale);
    ctx.globalAlpha = 1;
    if (o && o.rot) ctx.restore();
  }
  // a piece's place lights up: a (0..1) how bright
  function drawPlace(lay, id, a, time) {
    if (!asset || a <= 0.01) return;
    const B = lay.board, piece = asset.cut.pieces[id], pul = 0.75 + 0.25 * Math.sin(time * 7);
    ctx.save(); ctx.translate(B.x, B.y); ctx.scale(lay.k, lay.k);
    tracePath(ctx, piece);
    ctx.fillStyle = `rgba(255,250,200,${(0.3 * a * pul).toFixed(3)})`; ctx.fill();
    ctx.lineJoin = 'round'; ctx.strokeStyle = `rgba(255,255,255,${(0.95 * a).toFixed(3)})`; ctx.lineWidth = 4.5; ctx.stroke();
    ctx.strokeStyle = `rgba(255,210,63,${(0.9 * a * pul).toFixed(3)})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  // ---------- the tray, and the bonus coins above it ----------
  // waiting: pieces still to come; alpha fades the whole tray away when the puzzle is done
  function drawTray(lay, alpha, waiting, time) {
    if (alpha <= 0.01) return;
    const T = lay.tray;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; rrect(ctx, T.x0, T.y0, T.x1 - T.x0, T.y1 - T.y0, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.11)';
    for (const sl of lay.slots) { rrect(ctx, sl.x - sl.w / 2 + 5, sl.y - sl.h / 2 + 4, sl.w - 10, sl.h - 8, 14); ctx.fill(); }
    // the pieces still to come: a row of little dots, one each
    if (waiting > 0) {
      const n = Math.min(waiting, 40), per = Math.min(20, n), sp = Math.min(9.5, (T.x1 - T.x0 - 30) / per), rowsN = Math.ceil(n / per);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / per), inRow = r === rowsN - 1 ? n - r * per : per, x = lay.hud.bag.x + ((i % per) - (inRow - 1) / 2) * sp, y = lay.hud.bag.y + r * 8;
        ctx.moveTo(x + 2.8, y); ctx.arc(x, y, 2.8, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawChest(x, y, open, time, sc) { P.use(ctx, () => P.drawChest(x, y, open, time, sc)); }
  // the little chest and the bonus coins: `left` of them are still here; leaving: [{ i, t }] coins drifting away
  function drawBonus(lay, left, leaving, time, alpha) {
    if (alpha <= 0.01) return;
    const Hd = lay.hud;
    ctx.globalAlpha = alpha;
    P.use(ctx, () => P.drawChest(Hd.chest.x, Hd.chest.y, 0, 0, Hd.chest.sc));
    ctx.globalAlpha = 1;
    for (let i = 0; i < left; i++) {
      const c = Hd.coins[i], bob = Math.sin(time * 2.2 + i * 1.3) * 2;
      drawCoin(c.x, c.y + bob, 0, c.r, alpha);
    }
    // a coin that has had its time floats up like a bubble and is gone
    for (const lv of leaving) {
      const c = Hd.coins[lv.i], u = clamp(lv.t / 1.8, 0, 1);
      drawCoin(c.x + Math.sin(lv.t * 4) * 9 * u + u * 14, c.y - u * u * 70, lv.t * 2.5, c.r * (1 - u * 0.25), (1 - smooth(u)) * alpha);
    }
  }
  function drawKey(x, y, rot, sc, shine) {
    if (shine > 0) glow(x, y, 60 * sc, 'rgba(255,235,140,0.9)', 0.7 * shine);
    P.use(ctx, () => P.drawKey(x, y, rot, sc));
  }
  function drawIsabella(x, y, o) { P.use(ctx, () => P.drawIsabella(x, y, o)); }
  // the coins won, counted above the chest: a coin and a number that pops as it goes up
  function drawCounter(x, y, n, pop, alpha) {
    if (alpha <= 0.01) return;
    const k = 1 + 0.22 * pop, txt = String(n), size = 54 * k, w = 46 + txt.length * 30;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; rrect(ctx, x - w / 2 - 14, y - 34, w + 28, 68, 34); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 4; ctx.stroke();
    drawCoin(x - w / 2 + 20, y, 0, 23 * k, alpha);
    ctx.globalAlpha = alpha;
    outlined(txt, x + 26, y + 2, size, '#ffb300', '#8a4a00');
    ctx.globalAlpha = 1;
  }

  // ---------- the "drag it home" hand ----------
  function hand(x, y, press, alpha) {
    ctx.globalAlpha = 0.95 * alpha;
    ctx.save(); ctx.translate(x + 6, y + 10 + press * 10); ctx.rotate(-0.42);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(20,60,110,0.8)'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    rrect(ctx, -17, 26, 36, 34, 12); ctx.fill(); ctx.stroke();
    rrect(ctx, -7, -2, 15, 42, 7.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-5, 27, 11, 8);
    ctx.strokeStyle = 'rgba(20,60,110,0.45)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(9, 36); ctx.lineTo(9, 46); ctx.moveTo(14, 37); ctx.lineTo(14, 46); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // "Drag it home", shown without words: the piece's place lights up, a dotted path leads there, and a hand presses
  // the piece and carries a see-through copy of it along the path. from: { x, y, scale }; u: 0..1 through one showing.
  function drawDragHint(lay, id, from, u, time) {
    if (!asset) return;
    const B = lay.board, piece = asset.cut.pieces[id];
    const x0 = from.x, y0 = from.y, x1 = B.x + piece.hx * lay.k, y1 = B.y + piece.hy * lay.k;
    const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - 60 - Math.abs(x1 - x0) * 0.08;
    const at = (m) => ({ x: (1 - m) * (1 - m) * x0 + 2 * (1 - m) * m * cx + m * m * x1, y: (1 - m) * (1 - m) * y0 + 2 * (1 - m) * m * cy + m * m * y1 });
    const a = clamp(u / 0.08, 0, 1) * (1 - clamp((u - 0.88) / 0.12, 0, 1));
    drawPlace(lay, id, a, time);
    ctx.globalAlpha = 0.8 * a; ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.setLineDash([1, 15]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // 0-0.2 press, 0.2-0.72 carry, 0.72-0.88 let go at its place, then fade
    const m = smooth(clamp((u - 0.2) / 0.52, 0, 1)), pt = at(m), press = u < 0.2 ? smooth(u / 0.2) : u < 0.74 ? 1 : 1 - smooth(clamp((u - 0.74) / 0.1, 0, 1));
    if (u > 0.14 && u < 0.86) drawPiece(id, pt.x, pt.y, from.scale + (lay.k - from.scale) * m, { alpha: 0.62 * a, shadow: 0.6 });
    if (u >= 0.72 && u < 0.88) {
      const kk = (u - 0.72) / 0.16;
      ctx.globalAlpha = 0.9 * (1 - kk); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x1, y1, 22 + kk * 60, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    hand(pt.x, pt.y, press, a);
  }

  // ---------- particles (from Bubble Party) ----------
  const parts = [];
  function add(p) { if (parts.length < 600) parts.push(p); }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(type, x, y, r, col) {
    if (type === 'snap') {
      // a piece clicks home: a ring and a spray of sparkles round it
      add({ t: 'ring', x, y, r0: r * 0.5, r1: r * 1.25, life: 0.4, max: 0.4, w: 6 });
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + rnd(-0.2, 0.2), sp = rnd(120, 260); add({ t: 'spark', x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7, max: 0.7, c: i % 3 ? '#fff6a0' : '#ffffff', r: rnd(5, 10) }); }
    } else if (type === 'tap') {
      add({ t: 'ring', x, y, r0: r * 0.4, r1: r * 0.9, life: 0.35, max: 0.35, w: 4 });
    } else if (type === 'ripple') {
      add({ t: 'ring', x, y, r0: 6, r1: 46, life: 0.55, max: 0.55, w: 3 });
      for (let i = 0; i < 4; i++) add({ t: 'bub', x: x + rnd(-14, 14), y: y + rnd(-8, 8), vx: rnd(-14, 14), vy: rnd(-110, -60), life: 1, max: 1, r: rnd(2.5, 5) });
    } else if (type === 'twinkle') {
      add({ t: 'spark', x: x + rnd(-r, r), y: y + rnd(-r, r), vx: 0, vy: -20, life: 0.5, max: 0.5, c: col || '#fff8c0', r: rnd(3, 6) });
    } else if (type === 'shine') {
      // the finished picture sparkles all over
      for (let i = 0; i < 26; i++) add({ t: 'spark', x: x + rnd(-r, r), y: y + rnd(-r, r) * 0.62, vx: rnd(-20, 20), vy: rnd(-50, -10), life: rnd(0.6, 1.3), max: 1.3, c: i % 2 ? '#fff6a0' : '#ffffff', r: rnd(6, 13) });
    } else if (type === 'coin') {
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; add({ t: 'spark', x, y, vx: Math.cos(a) * rnd(110, 200), vy: Math.sin(a) * rnd(110, 200), life: 0.5, max: 0.5, c: i % 2 ? '#fff6a0' : '#ffd23f', r: rnd(4, 7) }); }
    } else if (type === 'puff') {
      for (let i = 0; i < 16; i++) add({ t: 'puff', x: x + rnd(-r, r), y: y + rnd(-8, 8), vx: rnd(-90, 90), vy: rnd(-70, -10), life: 0.9, max: 0.9, r: rnd(8, 16), c: col || 'rgba(255,240,200,0.8)' });
    } else if (type === 'hearts') {
      for (let i = 0; i < 6; i++) add({ t: 'heart', x: x + rnd(-30, 30), y: y + rnd(-20, 10), vx: rnd(-50, 50), vy: rnd(-170, -90), life: 1.2, max: 1.2, r: rnd(7, 11) });
    } else if (type === 'confetti') {
      for (let i = 0; i < 70; i++) add({ t: 'confetti', x: rnd(0, VW), y: rnd(-60, -10), vx: rnd(-40, 40), vy: rnd(40, 120), life: 4, max: 4, c: P.RAINBOW[i % 7], ph: Math.random() * TAU });
    }
  }
  // the treasure: gold coins shoot up out of the chest and bounce on the sand, with confetti
  function fountain(x, y, n, floorY) {
    for (let i = 0; i < n; i++) add({ t: 'gcoin', x: x + rnd(-30, 30), y, vx: rnd(-230, 230), vy: rnd(-980, -460), life: 3.2, max: 3.2, r: rnd(9, 14), ph: rnd(0, 6), fy: (floorY || H - 30) + rnd(-14, 14) });
    for (let i = 0; i < n / 2; i++) add({ t: 'confetti', x: x + rnd(-40, 40), y: y - 20, vx: rnd(-300, 300), vy: rnd(-800, -300), life: 3, max: 3, c: P.RAINBOW[Math.floor(Math.random() * 7)], ph: rnd(0, 6), grav: true });
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.t === 'gcoin') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 8;
        if (p.y > p.fy) { p.y = p.fy; p.vy *= -0.45; p.vx *= 0.7; }
        if (p.x < 12) { p.x = 12; p.vx = Math.abs(p.vx) * 0.6; } else if (p.x > VW - 12) { p.x = VW - 12; p.vx = -Math.abs(p.vx) * 0.6; }
      } else if (p.t === 'confetti') {
        if (p.grav) { p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.5); p.vy = Math.min(p.vy, 120); }
        p.ph += dt * 5; p.x += p.vx * dt + Math.sin(p.ph) * 40 * dt; p.y += p.vy * dt;
      } else if (p.t !== 'ring') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-dt * 3);
        if (p.t !== 'bub') p.vy *= Math.exp(-dt * 3);
      }
    }
  }
  function heartPath(x, y, r) {
    ctx.beginPath(); ctx.moveTo(x, y + r * 0.9);
    ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.7, y - r * 1.3, x, y - r * 0.45);
    ctx.bezierCurveTo(x + r * 0.7, y - r * 1.3, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
    ctx.closePath();
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.t === 'spark') { ctx.globalAlpha = a; ctx.fillStyle = p.c; star(p.x, p.y, p.r, p.r * 0.38, 4, p.life * 5); ctx.fill(); }
      else if (p.t === 'ring') { const u = 1 - a; ctx.globalAlpha = a; ctx.strokeStyle = '#fff'; ctx.lineWidth = p.w * a + 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - (1 - u) * (1 - u)), 0, TAU); ctx.stroke(); }
      else if (p.t === 'heart') { ctx.globalAlpha = a; ctx.fillStyle = '#ff4d8d'; heartPath(p.x, p.y, p.r); ctx.fill(); }
      else if (p.t === 'bub') { ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); }
      else if (p.t === 'confetti') { ctx.globalAlpha = Math.min(1, p.life); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph); ctx.fillStyle = p.c; ctx.fillRect(-6, -3.5, 12, 7); ctx.restore(); }
      else if (p.t === 'gcoin') { drawCoin(p.x, p.y, p.ph, p.r, Math.min(1, p.life * 2)); }
      else if (p.t === 'puff') { ctx.globalAlpha = a * 0.8; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - a * 0.6), 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  function clearParts() { parts.length = 0; }

  // ---------- the level select's little pictures ----------
  // each is painted once for its size and kept (thirty small pictures at most)
  const thumbs = new Map();
  function thumb(el, p) {
    const w = Math.max(16, Math.round(el.clientWidth * dpr)), h = Math.max(10, Math.round(el.clientHeight * dpr)), key = `${p.pic}|${w}|${h}`;
    let c = thumbs.get(key);
    if (!c) {
      for (const [k, old] of thumbs) if (k.startsWith(p.pic + '|')) { free(old); thumbs.delete(k); }   // the screen changed size
      c = mk(w, h);
      P.paint(p.pic, c.getContext('2d', { alpha: false }), w, h);
      thumbs.set(key, c);
    }
    el.width = w; el.height = h;
    el.getContext('2d').drawImage(c, 0, 0);
  }

  // ---------- for the tests: is the board really this picture? ----------
  // share: the part of the board that differs from the finished picture (only the seams, once every piece is home);
  // pieces[i]: how far the middle of piece i's place is from the picture there (0 = the piece is home and is the right
  // bit of the picture, in the right place); thumb: the picture as 16 x 10 average colours
  function boardCheck() {
    if (!asset) return null;
    const a = asset, W = a.W, Hh = a.Hh;
    // read from a copy made for reading, so the game's own canvases stay fast ones
    const read = (src) => { const c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0); const d = g.getImageData(0, 0, W, Hh).data; c.width = 0; return d; };
    const b = read(a.board), p = read(a.pic);
    let diff = 0;
    for (let i = 0; i < b.length; i += 4) if (Math.abs(b[i] - p[i]) + Math.abs(b[i + 1] - p[i + 1]) + Math.abs(b[i + 2] - p[i + 2]) > 60) diff++;
    const pieces = a.cut.pieces.map((q) => {
      const x0 = Math.round((q.hx - a.cw * 0.14) * a.qx), x1 = Math.round((q.hx + a.cw * 0.14) * a.qx), y0 = Math.round((q.hy - a.ch * 0.14) * a.qy), y1 = Math.round((q.hy + a.ch * 0.14) * a.qy);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; sum += Math.abs(b[i] - p[i]) + Math.abs(b[i + 1] - p[i + 1]) + Math.abs(b[i + 2] - p[i + 2]); n += 3; }
      return +(sum / n).toFixed(2);
    });
    const thumb = [];
    for (let by = 0; by < 10; by++) for (let bx = 0; bx < 16; bx++) {
      const x0 = Math.floor((bx * W) / 16), x1 = Math.floor(((bx + 1) * W) / 16), y0 = Math.floor((by * Hh) / 10), y1 = Math.floor(((by + 1) * Hh) / 10);
      let r = 0, g = 0, bl = 0, n = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * W + x) * 4; r += p[i]; g += p[i + 1]; bl += p[i + 2]; n++; }
      thumb.push(Math.round(r / n), Math.round(g / n), Math.round(bl / n));
    }
    return { share: diff / (W * Hh), pieces, thumb, size: [W, Hh] };
  }

  window.JigsawArt = {
    H, LEFT, HUD_H, TABLE,
    init, resize, toWorld, toClient, begin, layout,
    get VW() { return VW; }, get scale() { return s; }, get dpr() { return dpr; }, get canvas() { return canvas; },
    get partCount() { return parts.length; }, get assetId() { return asset ? asset.id : null; },
    // how many pictures each cache holds (the soak checks they stay bounded)
    cacheSizes: () => ({ glow: Object.keys(glowCache).length, back: Object.keys(backCache).length, thumbs: thumbs.size, coin: coinSpr ? 1 : 0,
      sprites: asset ? asset.sprites.length : 0, pixels: asset ? asset.sprites.reduce((n, sp) => n + sp.c.width * sp.c.height, asset.W * asset.Hh * 2) : 0,
      made: tally.made, freed: tally.freed, live: tally.made - tally.freed }),
    boardCheck,
    prepare, release, placeHome, drawBackdrop, drawMenu, drawBoard, drawPicture, drawPiece, drawPlace, drawTray, drawBonus, drawChest, drawKey, drawIsabella,
    drawCoin, drawCounter, drawDragHint, glow, burst, fountain, stepParts, drawParts, clearParts, thumb,
    partsOfType: (t) => parts.filter((p) => p.t === t).length,
  };
})();
