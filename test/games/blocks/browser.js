// Treasure Blocks in headless Chrome at the Seeker's landscape sizes (915x412 and 800x360 CSS px, DPR 2.625, touch).
//   node test/games/blocks/browser.js [outDir] [chromeProfileDir]
//   (defaults: .local/shots and .local/chrome-blocks in the repo; DevTools port 9484)
// At each size, from a fresh save, every step with real fingers through Input.dispatchTouchEvent:
//   the picker (three picture-only sizes, 19vh+ targets, nothing overlapping) -> Easy: the hint hand for a first-time
//   player; each of the four buttons (left, right, turn, drop) and a held button that keeps sliding; the gestures
//   (drag sideways, tap to turn, pull down to drop; a sloppy diagonal drag slides, an upward flick does nothing); the
//   outline where the piece will land; a round played with the buttons: a full row sparkles, pays a coin into the save
//   at once and clears a band of mist from the picture; the row goal brings the key, the chest and the results card;
//   "keep going" starts round 2 in the same well; pieces dropped down the middle reach the top and a wave washes the
//   bottom rows away, play going on -> Medium: a tall stack, then a whole round played with gestures only -> Hard: a
//   tall stack, a row, then the well filled to the top: the round ends kindly, the chest still opens, the coins are
//   kept, "play again" starts afresh -> the save survives a reload -> the home button goes to ../../index.html.
// Then, at 915x412: seeds through the test hook; the picture and the six block looks really drawn; mute shared with
// isabella.save (only its `muted` field, never an unreadable save); window.IsabellaStore; held upright; Android
// back; the frame rate. No console errors or exceptions anywhere.
// $BLOCKS_ROOT serves another copy of the repo, $BLOCKS_SIZES=915x412 runs one size only and $BLOCKS_BAIL=1 stops at
// the first failure (mutants.js uses all three to prove, quickly, that these checks bite).
'use strict';
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');
const PL = require('./player.js');

const REPO = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.env.BLOCKS_ROOT || REPO);
const L = require(path.join(ROOT, 'web/games/blocks/logic.js'));
const OUT = path.resolve(process.argv[2] || path.join(REPO, '.local/shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(REPO, '.local/chrome-blocks'));
const PORT = 9484, DPR = 2.625;
const GAME = '/web/games/blocks/index.html';
const COINS = { 1: 1, 2: 3, 3: 5, 4: 8 };
const SIZES = (process.env.BLOCKS_SIZES || '915x412,800x360').split(',').map((v) => v.split('x').map(Number));
const SKIN = [247, 205, 176], HAIR = [107, 58, 31];   // Isabella's skin and hair, as the main game paints them

let fails = 0, checks = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok && process.env.BLOCKS_BAIL) throw new Error('stopping at the first failure (BLOCKS_BAIL)');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(ROOT);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  let page;
  try {
    page = await openPage(PORT);
    const P = page;
    const st = () => P.eval('__blocksDebug.state');
    const shot = async (name) => { await P.frames(2); const f = await P.shot(path.join(OUT, name + '.png')); console.log(`        shot ${path.relative(REPO, f)}`); };
    const rectOf = (sel) => P.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.5 }; })()`);
    const tapEl = async (sel) => { const r = await rectOf(sel); await P.tap(r.x + r.w / 2, r.y + r.h / 2); await P.frames(1); };
    const savedRaw = () => P.eval(`localStorage.getItem('game.blocks.save')`);
    const saved = async () => { let v = null; try { v = JSON.parse((await savedRaw()) || 'null'); } catch (e) { /* unreadable */ } v = v && typeof v === 'object' ? v : {}; v.keys = v.keys || {}; v.best = v.best || {}; return v; };
    const gridStr = (s) => s.grid.map((v) => (v ? '#' : '.')).join('');
    const waitPhase = (list, ms) => P.waitFor(`${JSON.stringify(list)}.includes(__blocksDebug.state.phase)`, ms || 6000, 'phase ' + list.join(' / '));
    const waitFall = () => waitPhase(['fall', 'goal', 'over'], 8000);
    const canDrop = () => P.waitFor('(() => { const s = __blocksDebug.state; return s.phase !== "fall" || s.age >= s.dropGuard + 0.03; })()', 3000, 'the drop guard');
    // the middle of the well, a little below the middle (clear of the sinking piece's starting place), in CSS px
    const wellPoint = async () => { const s = await st(), w = s.layout.well; return { x: (w.left + w.right) / 2, y: w.top + (w.bottom - w.top) * 0.62, cell: s.cell.px }; };
    // real fingers on the well
    async function dragSide(cells, o) {
      o = o || {};
      const p = await wellPoint(), dx = cells * p.cell + Math.sign(cells) * p.cell * 0.12, n = Math.max(4, Math.abs(cells) * 3), pts = [];
      for (let k = 0; k <= n; k++) pts.push({ x: p.x + (dx * k) / n, y: p.y + (o.drift || 0) * p.cell * (k / n) + Math.sin(k * 1.3) * 2 });
      await P.drag(pts, 14, o.beforeEnd);
      await P.frames(2);
    }
    async function tapWell() { const p = await wellPoint(); await P.tap(p.x + 7, p.y - 5); await P.frames(2); }
    async function pullDown(cells) { const p = await wellPoint(), pts = []; for (let k = 0; k <= 6; k++) pts.push({ x: p.x + Math.sin(k) * 3, y: p.y + (cells * p.cell * k) / 6 }); await P.drag(pts, 14); await P.frames(2); }
    // put the sinking piece where `target` says, with real touches, looking at the state after every touch
    async function place(target, via) {
      for (let k = 0; k < 16; k++) {
        const s = await st();
        if (s.phase !== 'fall' || !s.cur) return false;
        const a = PL.nextAction(s.cur, target);
        if (a === 'drop') break;
        if (via === 'buttons') await tapEl(a === 'rotate' ? '#padTurn' : a === 'left' ? '#padLeft' : '#padRight');
        else if (a === 'rotate') await tapWell();
        else await dragSide(target.x - s.cur.x);
        const s2 = await st();
        if (s2.cur && s.cur && s2.pieces === s.pieces && s2.cur.x === s.cur.x && s2.cur.rot === s.cur.rot) break;   // it would not go: just drop it
      }
      await canDrop();
      if ((await st()).phase !== 'fall') return false;
      if (via === 'buttons') await tapEl('#padDrop'); else await pullDown(2.4);
      return true;
    }
    const planFor = (s) => PL.plan(L, { W: s.W, H: s.H, grid: s.grid, cur: s.cur, next: s.next });
    // play with the model player and real touches until `until(state)` is true or the round ends
    async function playUntil(via, until, maxPieces) {
      for (let n = 0; n < (maxPieces || 80); n++) {
        await waitFall();
        const s = await st();
        if (s.phase !== 'fall' || (until && until(s))) return s;
        await place(planFor(s), typeof via === 'function' ? via(n) : via);
        const s2 = await st();
        if (until && until(s2)) return s2;
      }
      return st();
    }
    // a careless start: pieces thrown about with real button taps until the stack is `rows` high
    async function pile(rows, seed) {
      const rng = L.mulberry32(seed);
      for (let n = 0; n < 60; n++) {
        await waitFall();
        const s = await st();
        if (s.phase !== 'fall' || s.height >= rows) return s;
        const turns = Math.floor(rng() * 3), mv = Math.floor(rng() * (s.W + 1)) - Math.floor(s.W / 2);
        for (let k = 0; k < turns; k++) await tapEl('#padTurn');
        for (let k = 0; k < Math.abs(mv); k++) await tapEl(mv < 0 ? '#padLeft' : '#padRight');
        await canDrop();
        await tapEl('#padDrop');
      }
      return st();
    }
    // the colours of the top band of the picture (the first to clear), left and right of where pieces appear
    const bandSample = () => P.eval(`(() => { const s = __blocksDebug.state, w = s.layout.well, c = document.getElementById('c'), k = c.width / innerWidth, g = c.getContext('2d'), out = [], bandH = (w.bottom - w.top) / s.goal;
      for (let j = 0; j < 6; j++) for (let i = 0; i < 24; i++) { const fx = (i + 0.5) / 24; if (fx > 0.3 && fx < 0.7) continue; const d = g.getImageData(Math.round((w.left + (w.right - w.left) * fx) * k), Math.round((w.top + (bandH * (j + 0.5)) / 6) * k), 1, 1).data; out.push(d[0], d[1], d[2]); }
      return out; })()`);
    // the colour of the canvas at a point of the well (cell x, y)
    // (a little up and left of the cell's middle: on a block that is its plain colour, clear of the picture on it)
    const pixelAt = (x, y) => P.eval(`(() => { const p = __blocksDebug.cellCss(${x - 0.3}, ${y - 0.15}), c = document.getElementById('c'), k = c.width / innerWidth, d = c.getContext('2d').getImageData(Math.round(p.x * k), Math.round(p.y * k), 3, 3).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } return [r / 9, g / 9, b / 9]; })()`);

    // the colour of a point of Easy's picture, given where it is in the picture's own 300 x 450 drawing
    const pictureAt = (dx, dy) => P.eval(`(() => { const p = __blocksDebug.cellCss(${dx / 50 - 0.5}, ${dy / 50 - 0.5}), c = document.getElementById('c'), k = c.width / innerWidth, d = c.getContext('2d').getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data; return [d[0], d[1], d[2]]; })()`);
    const near = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 10;

    for (const [W, H] of SIZES) {
      const tag = `${W}x${H}`, vh = H / 100;
      console.log(`\n${tag} CSS px at DPR ${DPR} (DevTools port ${PORT})`);
      await P.viewport(W, H, DPR);
      await P.goto(base + GAME);
      await P.eval('localStorage.clear()');
      await P.goto(base + GAME + '?seed=5');
      await sleep(600);
      let s = await st();
      check(s.screen === 'modes' && JSON.stringify(s.save) === JSON.stringify({ v: 1, coins: 0, rows: 0, games: 0, keys: { easy: 0, medium: 0, hard: 0 }, best: { easy: 0, medium: 0, hard: 0 }, last: 'easy' }), `${tag}: opens on the picker with a fresh save`);
      check(s.dpr === 2.5, `${tag}: canvas DPR capped at 2.5 (device ${DPR})`, s.dpr);
      const sizes = {};
      for (const sel of ['#mode-easy', '#mode-medium', '#mode-hard', '#homeBtn', '#soundBtn']) { const r = await rectOf(sel); sizes[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(sizes).every((v) => v >= 19), `${tag}: the three size buttons, home and sound are at least 19vh`, sizes);
      const ov = await P.eval(`(() => { const ids = ['title', 'mode-easy', 'mode-medium', 'mode-hard', 'cnt-easy', 'cnt-medium', 'cnt-hard', 'homeBtn', 'soundBtn'], r = ids.map((i) => (i.startsWith('cnt') ? document.getElementById(i).parentElement : document.getElementById(i)).getBoundingClientRect());
        r.push(document.querySelector('#modes .pill').getBoundingClientRect()); ids.push('pill');
        const out = []; for (let i = 0; i < r.length; i++) { const a = r[i];
          if (a.width < 5 || a.left < 0 || a.top < 0 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) out.push(ids[i] + ' off screen');
          for (let j = i + 1; j < r.length; j++) { const b = r[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(ids[i] + '/' + ids[j]); } }
        return out; })()`);
      check(ov.length === 0, `${tag}: title, size buttons, key counters, coin count, home and sound do not overlap or leave the screen`, ov);
      check((await P.eval(`document.getElementById('modes').innerText.replace(/\\s+/g, ' ').trim()`)) === 'Treasure Blocks 0 0 0 0', `${tag}: the picker shows no words for children to read (just the title and numbers)`);
      check((await rectOf('#padLeft')).vis === false && (await rectOf('#modesBtn')).vis === false, `${tag}: the play buttons are not on the picker`);
      await shot(`${tag}-01-picker`);

      // ================= Easy: the layout =================
      await tapEl('#mode-easy');
      await sleep(250);
      s = await st();
      check(s.screen === 'play' && s.mode === 'easy' && s.W === 6 && s.H === 9 && s.goal === 6 && s.seed === 5 && s.phase === 'fall', `${tag}: a tap on the small one starts Easy: a well 6 wide and 9 tall, 6 rows to the key`);
      check(s.cell.vh >= 8, `${tag}: Easy's cells are big: ${s.cell.vh}vh each (${s.cell.px} px); the brief asks for at least 8vh`);
      const pads = {};
      for (const sel of ['#padLeft', '#padRight', '#padDrop', '#padTurn', '#homeBtn', '#modesBtn']) { const r = await rectOf(sel); pads[sel] = { vh: +(Math.min(r.w, r.h) / vh).toFixed(1), r }; }
      check(Object.values(pads).every((p) => p.vh >= 19 && p.r.vis), `${tag}: left, right, drop and turn are big picture buttons (${pads['#padLeft'].vh}vh); home and sizes 19vh`, Object.fromEntries(Object.entries(pads).map(([k, v]) => [k, v.vh])));
      const boxes = Object.fromEntries(Object.entries(pads).map(([k, v]) => [k, { left: v.r.x, top: v.r.y, right: v.r.x + v.r.w, bottom: v.r.y + v.r.h }]));
      Object.assign(boxes, { frame: s.layout.frame, track: s.layout.track, next: s.layout.next, coin: s.layout.coin });
      const names = Object.keys(boxes), clash = [];
      for (let i = 0; i < names.length; i++) {
        const a = boxes[names[i]];
        if (a.left < -0.5 || a.top < -0.5 || a.right > W + 0.5 || a.bottom > H + 0.5) clash.push(names[i] + ' off screen');
        for (let j = i + 1; j < names.length; j++) { const b = boxes[names[j]]; if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) clash.push(names[i] + '/' + names[j]); }
      }
      check(clash.length === 0, `${tag}: the well, the row track, the next-piece bubble, the coin count and all six buttons are on screen and clear of each other`, clash);
      check(boxes['#padLeft'].right <= boxes.frame.left && boxes['#padRight'].right <= boxes.frame.left && boxes['#padDrop'].left >= boxes.frame.right && boxes['#padTurn'].left >= boxes.frame.right && Math.abs((boxes.frame.left + boxes.frame.right) / 2 - W / 2) < 2,
        `${tag}: the well stands in the middle, with left and right on its left and drop and turn on its right`);
      // a first-time player is shown a hand sliding across the well, until the first touch
      await sleep(2300);
      s = await st();
      check(s.hand > 0.8 && s.pieces === 0, `${tag}: a first-time player sees a hand sliding across the well`, s.hand);
      check(s.drawn.piece === s.cur.cells.length && s.drawn.ghost === s.cur.cells.length && s.drawn.stack === 0 && s.drawn.mistRows > 100 && s.drawn.clearRows === 0,
        `${tag}: the frame drew the sinking piece (${s.drawn.piece} blocks), the outline where it will land (${s.drawn.ghost}), and the picture all misty`, s.drawn);
      await shot(`${tag}-02-easy-start`);

      // ================= the four buttons =================
      s = await st();
      const x0 = s.cur.x, id0 = s.cur.id;
      await tapEl('#padRight');
      s = await st();
      check(s.cur.x === x0 + 1 && s.counters.slides === 1, `${tag}: the right button slides the piece one column right (${id0}: ${x0} -> ${s.cur.x})`);
      await sleep(500);
      check((await st()).hand < 0.2, `${tag}: ...and the hint hand goes away at the first touch`);
      await tapEl('#padLeft'); await tapEl('#padLeft');
      s = await st();
      check(s.cur.x === x0 - 1, `${tag}: the left button slides it left (two taps: ${x0 + 1} -> ${s.cur.x})`);
      const rot0 = s.cur.rot, cells0 = JSON.stringify(s.cur.cells);
      await tapEl('#padTurn');
      s = await st();
      check(s.cur.rot === (rot0 + 1) % 4 && JSON.stringify(s.cur.cells) !== cells0 && s.counters.turns === 1, `${tag}: the turn button turns it a quarter turn`);
      // hold the right button: it keeps sliding, to the wall
      const rr = await rectOf('#padRight'), xb = s.cur.x;
      await P.hold(rr.x + rr.w / 2, rr.y + rr.h / 2, 1100);
      await P.frames(2);
      s = await st();
      const rightmost = Math.max(...s.cur.cells.map((c) => c[0]));
      check(s.cur.x >= xb + 3 && rightmost === s.W - 1 && s.counters.holds >= 3, `${tag}: a held right button keeps sliding it, as far as the wall (${xb} -> ${s.cur.x}, ${s.counters.holds} repeats)`);
      await sleep(250);
      const afterHold = (await st()).cur.x;
      check(afterHold === s.cur.x, `${tag}: ...and stops when the finger lifts`);
      // the outline, and drop
      s = await st();
      const ghost = s.cur.cells.map(([x, y]) => [x, y + s.ghostY - s.cur.y]);
      check(s.ghostY > s.cur.y && ghost.every(([x, y]) => y < s.H && !s.grid[y * s.W + x]) && ghost.some(([, y]) => y === s.H - 1), `${tag}: the outline shows it landing on the floor (rows ${[...new Set(ghost.map((c) => c[1]))].join(', ')})`);
      await tapEl('#padDrop');
      s = await st();
      check(s.pieces === 1 && ghost.every(([x, y]) => s.grid[y * s.W + x]) && s.grid.filter(Boolean).length === ghost.length && s.counters.drops === 1, `${tag}: the drop button sends it straight down onto the outline`);
      await P.frames(2);
      check((await st()).drawn.stack === ghost.length, `${tag}: ...and the frame draws those ${ghost.length} blocks on the floor`);

      // ================= fingers on the well =================
      await waitFall();
      s = await st();
      const g0 = s.cur.x;
      await dragSide(-2);
      s = await st();
      check(s.cur.x === g0 - 2 && s.counters.drags === 1 && s.pieces === 1, `${tag}: a drag two cells to the left slides the piece two columns left (${g0} -> ${s.cur.x})`);
      let mid = null;
      await dragSide(3, { beforeEnd: async () => { await P.frames(2); mid = await st(); } });
      s = await st();
      check(mid && mid.cur.x === g0 + 1 && mid.dragging && s.cur.x === g0 + 1, `${tag}: a drag three cells to the right slides it three columns right, following the finger before it lifts`);
      await dragSide(-1, { drift: 1.3 });
      s = await st();
      check(!!s.cur && s.cur.x === g0 && s.pieces === 1, `${tag}: a sloppy drag (one cell left while drifting more than a cell down) still slides it, and does not drop it`);
      await waitFall();
      s = await st();
      const gr = s.cur.rot;
      await tapWell();
      s = await st();
      check(s.cur.rot === (gr + 1) % 4 && s.counters.taps === 1, `${tag}: a tap on the well turns it`);
      // an upward flick does nothing
      { const p = await wellPoint(); await P.drag([0, 1, 2, 3, 4].map((k) => ({ x: p.x, y: p.y - k * p.cell * 0.5 })), 14); await P.frames(2); }
      const up = await st();
      check(up.cur.x === s.cur.x && up.cur.rot === s.cur.rot && up.pieces === 1, `${tag}: an upward flick does nothing`);
      // a touch on the sea beside the well does nothing either
      await P.tap(up.layout.frame.right + up.cell.px * 2.2, 40 * vh);
      await P.frames(2);
      check((await st()).cur.rot === up.cur.rot, `${tag}: a tap on the sea, away from the well, does nothing`);
      const gy = up.ghostY, gcells = up.cur.cells.map(([x, y]) => [x, y + gy - up.cur.y]);
      await canDrop();
      await pullDown(2.4);
      s = await st();
      check(s.pieces === 2 && gcells.every(([x, y]) => s.grid[y * s.W + x]) && s.counters.swipes === 1, `${tag}: a pull down on the well drops the piece onto its outline`);

      // ================= a full row: coins, the mist =================
      // (seed 4: a game that leaves blocks standing when the goal is reached, which "keep going" must keep)
      await P.goto(base + GAME + '?seed=4');
      await sleep(400);
      await tapEl('#mode-easy');
      await sleep(200);
      check((await st()).seed === 4 && (await st()).hand === 0, `${tag}: a second game shows no hint hand`);
      const before = await bandSample();
      s = await playUntil('buttons', (q) => q.phase === 'clear' || q.rowsDone > 0);
      const n1 = s.clearing.length || s.rowsDone;
      check(s.rowsDone === n1 && n1 >= 1 && s.coins === COINS[n1] && s.save.coins === COINS[n1] && s.save.rows === n1 && s.save.best.easy === n1,
        `${tag}: played with the buttons, a row fills from wall to wall: ${n1} row${n1 > 1 ? 's' : ''}, ${COINS[n1]} coin${COINS[n1] > 1 ? 's' : ''}, in the save at once`, { rows: s.rowsDone, coins: s.coins, save: s.save.coins });
      check(JSON.parse((await savedRaw()) || '{}').coins === COINS[n1], `${tag}: ...written to game.blocks.save in localStorage`);
      check(s.phase === 'clear' && s.clearing.every((y) => s.grid.slice(y * s.W, (y + 1) * s.W).every(Boolean)), `${tag}: ...the full row is still there, sparkling`, s.clearing);
      await sleep(230);
      await shot(`${tag}-03-easy-row-clearing`);
      await P.waitFor('__blocksDebug.state.bands > 0.25 && __blocksDebug.state.bands < 0.9', 3000, 'the mist starting to clear');
      await shot(`${tag}-04-easy-picture-clearing`);
      await P.waitFor(`__blocksDebug.state.bands === ${Math.min(6, n1)} && __blocksDebug.state.flying === 0`, 5000, 'the band to clear and the coins to land');
      await sleep(1000);
      s = await st();
      const filled = (q) => q.grid.filter(Boolean).length;
      check(s.coinsShown === COINS[n1] && s.bands === n1 && s.drawn.clearRows > 0 && Math.abs(s.drawn.clearRows / (s.drawn.clearRows + s.drawn.mistRows) - n1 / 6) < 0.01,
        `${tag}: the coins fly up to the counter (${s.coinsShown}) and ${n1} band${n1 > 1 ? 's' : ''} of mist clear from the top of the picture (${n1} sixth${n1 > 1 ? 's' : ''} of it drawn clear)`, s.drawn);
      const after = await bandSample(), diffs = [];
      for (let i = 0; i < before.length; i += 3) diffs.push((Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2])) / 3);
      const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length, sharp = diffs.filter((d) => d > 25).length;
      check(meanDiff > 4 && sharp >= 2, `${tag}: ...the picture really shows clearer there: ${diffs.length} points of the top band changed colour by ${meanDiff.toFixed(1)} of 255 on average, ${sharp} of them (the little fish, her hair) by more than 25`);
      const rowsNow = Array.from({ length: s.H }, (_, y) => s.grid.slice(y * s.W, (y + 1) * s.W).filter(Boolean).length), firstRow = rowsNow.findIndex((k) => k > 0);
      check(s.clearing.length === 0 && rowsNow.every((k) => k < s.W) && (firstRow < 0 || rowsNow.slice(firstRow).every((k) => k > 0)), `${tag}: the row is gone and what was above has settled onto what was below (no full row, no empty row under blocks)`, rowsNow);

      // ================= the row goal: the key and the chest =================
      s = await playUntil((n) => (n % 2 ? 'buttons' : 'gestures'), (q) => q.phase === 'goal', 60);
      check(s.phase === 'goal' && s.rowsDone >= 6 && s.win === 'goal' && s.save.keys.easy === 1 && s.save.coins === s.coins && s.waves === 0, `${tag}: Easy's goal, 6 rows, reached with real touches (buttons and gestures in turn): ${s.rowsDone} rows, ${s.coins} coins, ${s.pieces} pieces; a key in the save`);
      const coinsRound1 = s.coins, gridAtGoal = gridStr(s), sceneAtGoal = s.scene, blocksAtGoal = s.grid.filter(Boolean).length;
      check(blocksAtGoal >= 4, `${tag}: ...with ${blocksAtGoal} blocks still standing in the well`);
      await sleep(400);
      await P.waitFor('__blocksDebug.state.bands === 6', 3000, 'the last band of mist to clear');
      check((await rectOf('#padLeft')).vis === false && (await st()).bands === 6, `${tag}: the play buttons step aside and the whole picture is clear`);
      await P.waitFor('__blocksDebug.state.winT > 2.2', 5000, 'the chest to open');
      s = await st();
      check(s.particles > 40 && s.stackAlpha < 0.3, `${tag}: the key has flown to the chest and it bursts with coins; the blocks fade so the picture shows`, { particles: s.particles, stackAlpha: s.stackAlpha });
      await shot(`${tag}-05-easy-chest`);
      await P.waitFor('__blocksDebug.state.screen === "results"', 6000, 'the results card');
      await sleep(1000);
      const res = {};
      for (const sel of ['#resAgain', '#resGo']) { const r = await rectOf(sel); res[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      const card = await rectOf('#resCard'), keyR = await rectOf('#resKey');
      s = await st();
      // the whole picture is clear, and it is Isabella: her skin and her brown hair are where she was drawn
      let skin = 0, hair = 0;
      for (let k = 0; k < 6 && (skin < 2 || hair < 2); k++) {
        skin = [await pictureAt(150, 141), await pictureAt(150, 215)].filter((c) => near(c, SKIN)).length;
        hair = [await pictureAt(150, 70), await pictureAt(79, 150)].filter((c) => near(c, HAIR)).length;
        await sleep(120);
      }
      check(skin === 2 && hair === 2 && s.drawn.mistRows === 0 && s.drawn.ghost === 0 && s.drawn.piece === 0, `${tag}: the picture is drawn clear from top to bottom, and it is Isabella: her skin and brown hair, pixel for pixel, where her face, chest and hair are`, { skin, hair, drawn: s.drawn });
      check(Object.values(res).every((v) => v >= 19) && card.x >= s.layout.frame.right && card.x + card.w <= W && card.y >= 0 && card.y + card.h <= H, `${tag}: the results card sits right of the picture, on screen, with "play again" and "keep going" at least 19vh`, res);
      check((await P.eval(`document.getElementById('resCoins').textContent`)) === String(coinsRound1) && keyR.vis && keyR.w > 10 * vh && (await P.eval(`document.getElementById('resBest').textContent`)) === String(s.rowsAll), `${tag}: it shows the ${coinsRound1} coins earned, the key, and the most rows in one game`);
      check((await P.eval(`document.getElementById('resCard').innerText.replace(/[\\s\\d]/g, '')`)) === '', `${tag}: ...with no words to read`);
      await shot(`${tag}-06-easy-results`);
      await tapEl('#resGo');
      await waitFall();
      s = await st();
      check(s.screen === 'play' && s.round === 2 && s.rowsDone === 0 && s.roundCoins === 0 && s.coins === coinsRound1 && gridStr(s) === gridAtGoal && s.grid.filter(Boolean).length === blocksAtGoal && s.scene !== sceneAtGoal && s.bands === 0 && (await rectOf('#padLeft')).vis,
        `${tag}: "keep going": round 2 in the same well with its ${blocksAtGoal} blocks as they were, a new misty picture, the buttons back`);

      // ================= Easy never ends: the wave =================
      for (let n = 0; n < 40; n++) {
        await waitPhase(['fall', 'wave'], 8000);
        s = await st();
        if (s.phase === 'wave') break;
        if (s.height >= 7 && n > 0 && !pads.tall) { pads.tall = true; await shot(`${tag}-07-easy-tall`); }
        await canDrop();
        await tapEl('#padDrop');
      }
      const hBefore = s.height, blocksBefore = filled(s), coinsBefore = s.coins;
      check(s.phase === 'wave' && hBefore >= s.H - 1 && s.win === null && s.screen === 'play', `${tag}: pieces dropped down the middle reach the top (${hBefore} of ${s.H} rows): no ending, a wave comes`);
      await P.waitFor('__blocksDebug.state.wave > 0.42', 3000, 'the wave to roll in');
      check((await st()).drawn.wave === 1, `${tag}: ...the frame draws the wave rolling across`);
      await shot(`${tag}-08-easy-wave`);
      await waitPhase(['fall'], 5000);
      await sleep(500);
      s = await st();
      check(s.phase === 'fall' && s.height === hBefore - 4 && filled(s) < blocksBefore && s.waves === 1 && s.coins === coinsBefore && s.screen === 'play' && s.win === null && s.cur,
        `${tag}: ...it washes the bottom 4 rows away (${hBefore} rows -> ${s.height}) and play goes on, coins untouched`);
      await tapEl('#padLeft');
      check((await st()).cur.x === s.cur.x - 1, `${tag}: ...and the buttons work straight away`);
      await tapEl('#modesBtn');
      s = await st();
      check(s.screen === 'modes' && (await P.eval(`document.getElementById('cnt-easy').textContent`)) === '1' && (await P.eval(`document.getElementById('coinCount').textContent`)) === String(s.save.coins) && s.save.coins >= coinsRound1,
        `${tag}: the sizes button goes back to the picker: 1 key under the small well, ${s.save.coins} coins`);

      // ================= Medium: a tall stack, then a whole round with gestures only =================
      await P.goto(base + GAME + '?seed=5');
      await sleep(400);
      await tapEl('#mode-medium');
      await sleep(250);
      s = await st();
      check(s.mode === 'medium' && s.W === 7 && s.H === 11 && s.goal === 8 && s.cell.vh >= 7.5 && Math.abs(s.interval - 0.7) < 1e-9, `${tag}: Medium: a well 7 wide and 11 tall, 8 rows to the key, cells ${s.cell.vh}vh, a cell every 0.7 s`);
      s = await pile(7, 21);
      check(s.phase === 'fall' && s.height >= 7, `${tag}: Medium, thrown about carelessly: a stack ${s.height} rows tall`);
      await sleep(350);
      await shot(`${tag}-09-medium-tall`);
      await tapEl('#modesBtn'); await tapEl('#mode-medium');
      const slidesBefore = (await st()).counters;
      s = await playUntil('gestures', (q) => q.phase === 'clear', 40);
      if (s.phase === 'clear') { await sleep(90); await shot(`${tag}-10-medium-row-clearing`); }
      s = await playUntil('gestures', (q) => q.phase === 'goal', 70);
      const cnt = s.counters;
      check(s.phase === 'goal' && s.rowsDone >= 8 && s.save.keys.medium === 1 && cnt.drags > slidesBefore.drags + 5 && cnt.swipes > slidesBefore.swipes + 10 && cnt.taps > slidesBefore.taps,
        `${tag}: a whole Medium round with gestures only (drags, taps, pulls): ${s.rowsDone} rows, ${s.coins} coins, ${s.pieces} pieces`, { drags: cnt.drags - slidesBefore.drags, taps: cnt.taps - slidesBefore.taps, pulls: cnt.swipes - slidesBefore.swipes });
      await P.waitFor('__blocksDebug.state.winT > 2.3', 5000, 'the chest to open');
      await shot(`${tag}-11-medium-chest`);
      await P.waitFor('__blocksDebug.state.screen === "results"', 6000, 'the results card');
      await tapEl('#modesBtn');

      // ================= Hard: a tall stack, a row, then the well fills: the kind ending =================
      await tapEl('#mode-hard');
      await sleep(250);
      s = await st();
      check(s.mode === 'hard' && s.W === 8 && s.H === 13 && s.goal === 10 && s.cell.vh >= 6.5 && Math.abs(s.interval - 0.6) < 1e-9, `${tag}: Hard: a well 8 wide and 13 tall, 10 rows to the key, cells ${s.cell.vh}vh, a cell every 0.6 s to begin with`);
      await P.eval('__blocksDebug.resetPerf()');
      const perfT0 = Date.now();
      s = await playUntil('buttons', (q) => q.phase === 'clear', 40);
      const hardRows = s.clearing.length;
      check(s.phase === 'clear' && hardRows >= 1 && s.coins === COINS[hardRows], `${tag}: Hard, played with the buttons: ${hardRows} row${hardRows > 1 ? 's' : ''} filled, ${s.coins} coin${s.coins > 1 ? 's' : ''}`);
      await sleep(230);
      await waitFall();
      s = await st();
      check(s.interval < 0.6 && s.interval >= 0.6 - 0.015 * s.rowsAll - 1e-9, `${tag}: ...and it sinks a little quicker now (${s.interval.toFixed(3)} s a cell after ${s.rowsAll} row${s.rowsAll > 1 ? 's' : ''})`);
      await sleep(Math.max(0, 2500 - (Date.now() - perfT0)));
      const perf = await P.eval('__blocksDebug.perf()');
      console.log(`        frame stats, Hard with real touches (headless, ${Math.round(W * 2.5)}x${Math.round(H * 2.5)} canvas): ${JSON.stringify(perf, (kk, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`);
      check(perf.fps > 50 && perf.drawP95Ms < 10, `${tag}: Hard draws at over 50 fps with p95 draw time under 10 ms`, { fps: +perf.fps.toFixed(1), p95: +perf.drawP95Ms.toFixed(2) });
      s = await pile(9, 33);
      await sleep(350);
      if (s.phase === 'fall') await shot(`${tag}-12-hard-tall`);
      check(s.phase === 'fall' && s.height >= 9, `${tag}: Hard, thrown about carelessly: a stack ${s.height} rows tall`);
      const hardCoins = s.coins, hardRowsAll = s.rowsAll, savedBefore = s.save.coins;
      for (let n = 0; n < 40; n++) {
        await waitPhase(['fall', 'over', 'clear', 'rest'], 8000);
        s = await st();
        if (s.phase === 'over') break;
        if (s.phase !== 'fall') { await sleep(60); continue; }
        await canDrop();
        await tapEl('#padDrop');
      }
      check(s.phase === 'over' && s.win === 'over' && s.screen === 'play' && s.save.coins === savedBefore + (s.coins - hardCoins) && s.save.keys.hard === 0,
        `${tag}: the well fills to the top: the round ends, with every coin kept (${s.coins} this game) and no key`);
      await sleep(350);
      check((await rectOf('#padLeft')).vis === false, `${tag}: the play buttons step aside`);
      await P.waitFor('__blocksDebug.state.winT > 2.9', 6000, 'the chest to open');
      s = await st();
      check(s.particles > 5 && s.stackAlpha < 0.5, `${tag}: the blocks drift away as bubbles and the chest opens all the same`, { particles: s.particles });
      await shot(`${tag}-13-hard-full-chest`);
      await P.waitFor('__blocksDebug.state.screen === "results"', 6000, 'the results card');
      await sleep(900);
      const again = await rectOf('#resAgain'), go = await rectOf('#resGo'), key2 = await rectOf('#resKey');
      check(again.vis && Math.min(again.w, again.h) / vh >= 19 && !go.vis && !key2.vis && (await P.eval(`document.getElementById('resCoins').textContent`)) === String(s.roundCoins) && (await P.eval(`document.getElementById('resBest').textContent`)) === String(Math.max(hardRowsAll, s.rowsAll)),
        `${tag}: the card shows the coins earned and one big "play again" (no key, no scolding)`);
      await shot(`${tag}-14-hard-results`);
      await tapEl('#resAgain');
      await waitFall();
      await sleep(450);
      s = await st();
      check(s.screen === 'play' && s.mode === 'hard' && s.pieces === 0 && s.coins === 0 && filled(s) === 0 && s.round === 1 && (await rectOf('#padLeft')).vis && s.save.games >= 5, `${tag}: "play again" starts a fresh Hard game`,
        { screen: s.screen, pieces: s.pieces, coins: s.coins, blocks: filled(s), round: s.round, games: s.save.games });

      // ================= progress survives a reload =================
      const sv = await saved();
      await P.goto(base + GAME);
      await sleep(500);
      s = await st();
      const shown = await P.eval(`['easy', 'medium', 'hard'].map((m) => document.getElementById('cnt-' + m).textContent).join() + '|' + document.getElementById('coinCount').textContent`);
      check(s.screen === 'modes' && JSON.stringify(s.save) === JSON.stringify(sv) && sv.keys.easy === 1 && sv.keys.medium === 1 && sv.keys.hard === 0 && sv.coins > 14 && sv.best.medium >= 8 && sv.last === 'hard' && shown === `1,1,0|${sv.coins}`,
        `${tag}: after a reload the picker still shows 1 / 1 / 0 keys and ${sv.coins} coins (best rows ${sv.best.easy} / ${sv.best.medium} / ${sv.best.hard})`, shown);
      check((await P.eval(`document.querySelector('.mode.last').id`)) === 'mode-hard', `${tag}: ...and the size played last bobs`);
      await shot(`${tag}-15-picker-after`);
      check(s.fixedSeed === null && (await P.eval(`(() => { const a = __blocksDebug.start('easy'), b = __blocksDebug.start('easy'); return a !== b; })()`)), `${tag}: without ?seed= every game deals a fresh random seed`);

      // ================= home =================
      await P.goto(base + GAME);
      await sleep(300);
      await tapEl('#mode-easy');
      await sleep(300);
      await tapEl('#homeBtn');
      await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button to reach the hub');
      check((await P.eval(`!!document.getElementById('playBtn')`)), `${tag}: the home button (mid-game) goes to ../../index.html (the hub)`);
    }

    // ================= seeds, through the test hook =================
    console.log('\nthe test hook, the picture and the blocks (915x412)');
    await P.viewport(915, 412, DPR);
    await P.goto(base + GAME);
    await sleep(400);
    const dealt = (mode, seed) => P.eval(`(() => { const D = __blocksDebug; D.start(${JSON.stringify(mode)}${seed == null ? '' : ', ' + seed}); const out = [D.state.seed]; for (let i = 0; i < 5; i++) { const s = D.state; out.push(s.cur.id + s.cur.style); D.advance(s.dropGuard + 0.05); D.act('drop'); D.advance(0.3); } return out.join(' '); })()`);
    const a1 = await dealt('hard', 777), a2 = await dealt('hard', 777), a3 = await dealt('hard', 778), f1 = await dealt('hard'), f2 = await dealt('hard');
    check(a1 === a2 && a1 !== a3 && f1.split(' ')[0] !== f2.split(' ')[0], `start(mode, seed) replays a game exactly; without a seed every game is new (${a1.split(' ').slice(1, 5).join(' ')} ...)`);
    const node = new L.Game('hard', 777);
    check(a1.split(' ')[1] === node.cur.id + node.cur.style && a1.split(' ')[2] === node.next.id + node.next.style, 'the page deals what logic.js deals in Node for the same seed');
    const acted = await P.eval(`(() => { const D = __blocksDebug; D.start('easy', 3); const x = D.state.cur.x; const r = [D.act('left'), D.state.cur.x - x, D.act('right'), D.act('turn'), D.act('nonsense')]; D.advance(0.5); r.push(D.act('drop'), D.state.pieces); return r; })()`);
    check(JSON.stringify(acted) === JSON.stringify([true, -1, true, true, false, true, 1]), '__blocksDebug.act runs the same handlers as the buttons', acted);
    // the pictures and the blocks are really painted
    const pics = await P.eval('__blocksDebug.pictures()');
    check(pics.length === 4 && pics.every((p) => p.painted > 0.999 && p.mistDiff > 12 && p.skin > 0.02 && p.hair > 0.04 && p.colours > 60), `the three pictures of Isabella (and one with her crown) fill the well; her skin and brown hair are in each; the misty one differs (by ${pics.map((p) => p.mistDiff).join(', ')} of 255 on average)`, pics);
    const blocks = await P.eval('__blocksDebug.blocks()');
    check(Object.keys(blocks).join() === 'shell,coral,sand,bubble,kelp,star' && Object.values(blocks).every((v) => v > 0.8), 'the six sea blocks (shell, coral, sand, bubble, kelp, star) are each painted, filling their cell', blocks);
    // a piece is where the state says it is: the canvas shows a block there and not one cell to the side
    await P.eval(`__blocksDebug.start('easy', 3); __blocksDebug.advance(1.3)`);
    await P.frames(3);
    let s = await st();
    const onPiece = await pixelAt(s.cur.cells[0][0], s.cur.cells[0][1]);
    await P.eval(`__blocksDebug.reveal(0)`);
    const free = [0, 1, 2, 3, 4, 5].find((x) => !s.cur.cells.some((c) => c[0] === x));
    const offPiece = await pixelAt(free, s.cur.cells[0][1]);
    check(Math.hypot(...onPiece.map((v, k) => v - offPiece[k])) > 40, 'the sinking piece is drawn where the rules say it is (its cell is coloured, the empty cell beside it is misty picture)', { onPiece: onPiece.map(Math.round), offPiece: offPiece.map(Math.round) });

    // ================= sound: shared with the main game's save, carefully =================
    console.log('\nthe mute switch (shared with isabella.save)');
    const herSave = JSON.stringify({ unlocked: 20, stars: new Array(20).fill(3), gold: 5271, muted: false, played: true, crown: true });
    await P.eval(`localStorage.setItem('isabella.save', ${JSON.stringify(herSave)})`);
    await P.goto(base + GAME);
    await sleep(400);
    check((await st()).crown === true, 'Isabella wears her crown when the main game says she earned it');
    await P.eval(`__blocksDebug.start('easy', 3); __blocksDebug.reveal(6); __blocksDebug.advance(1)`);
    await shot('crown-picture');
    await tapEl('#modesBtn');
    await tapEl('#soundBtn');
    await sleep(150);
    const main = JSON.parse(await P.eval(`localStorage.getItem('isabella.save')`));
    check(main.muted === true && (await st()).muted === true && JSON.stringify(Object.assign({}, main, { muted: false })) === herSave && (await P.eval(`document.querySelector('#soundBtn use').getAttribute('href')`)) === '#i-mute',
      'the sound switch mutes and writes muted:true into isabella.save, every other field untouched');
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === herSave && (await st()).muted === false, 'switching back leaves isabella.save byte-for-byte as it was');
    await P.eval(`localStorage.setItem('isabella.save', '{not json')`);
    await P.goto(base + GAME);
    await sleep(300);
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === '{not json' && (await st()).muted === true, 'an unreadable isabella.save is never overwritten (the switch still mutes this visit)');
    await P.eval(`localStorage.removeItem('isabella.save')`);

    // ================= inside the Android app: window.IsabellaStore =================
    console.log('\nwith window.IsabellaStore (as in the Android app)');
    const lsBefore = await savedRaw();
    const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__fakeStore = { 'isabella.save': JSON.stringify({ muted: true, unlocked: 3 }), 'game.blocks.save': JSON.stringify({ v: 1, coins: 40, rows: 31, games: 9, keys: { easy: 4, medium: 2, hard: 0 }, best: { easy: 9, medium: 11, hard: 3 }, last: 'medium' }) };
               window.IsabellaStore = { get: (k) => (k in window.__fakeStore ? window.__fakeStore[k] : null), set: (k, v) => { window.__fakeStore[k] = String(v); } };`,
    });
    await P.goto(base + GAME + '?seed=5');
    await sleep(300);
    s = await st();
    check(s.muted === true && s.save.keys.easy === 4 && s.save.coins === 40 && (await P.eval(`document.getElementById('cnt-easy').textContent`)) === '4' && (await P.eval(`document.getElementById('coinCount').textContent`)) === '40', 'progress and mute come from IsabellaStore, not localStorage', { muted: s.muted, keys: s.save.keys });
    await tapEl('#mode-easy');
    s = await playUntil('buttons', (q) => q.rowsDone > 0, 30);
    const fake = JSON.parse(await P.eval(`window.__fakeStore['game.blocks.save']`));
    check(fake.coins === 40 + s.coins && fake.rows === 31 + s.rowsDone && fake.keys.easy === 4 && fake.games === 10 && fake.last === 'easy' && (await savedRaw()) === lsBefore, 'the save is written to IsabellaStore under game.blocks.save; localStorage left alone', fake);
    check((await st()).gain === 0 && JSON.parse(await P.eval(`window.__fakeStore['isabella.save']`)).unlocked === 3, 'muted for real: master gain 0 once sound has started; isabella.save untouched');
    await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    // held upright, the page asks to turn the phone
    await P.goto(base + GAME);
    await sleep(300);
    await P.viewport(412, 915, DPR);
    await sleep(200);
    check((await P.eval(`getComputedStyle(document.getElementById('rotate')).display`)) === 'flex', 'portrait shows the turn-the-phone picture');
    await P.viewport(915, 412, DPR);

    // Android back: straight to the hub, from the middle of a game
    await P.eval(`__blocksDebug.start('hard')`);
    await sleep(500);
    const backed = await P.eval('window.__back()');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the back button to reach the hub');
    check(backed === true, 'window.__back() returns true and goes to ../../index.html');

    console.log('');
    check(page.errors.length === 0, 'no console errors, exceptions or failed loads on any page', page.errors);
  } catch (e) {
    fails++;
    console.log('  FAIL ' + (e.stack || e));
    if (page) console.log('  page errors: ' + JSON.stringify(page.errors));
    if (page) try { await page.shot(path.join(OUT, 'zz-failure.png')); } catch (e2) { /* ignore */ }
  } finally {
    if (page) page.close();
    await chrome.close();
    await srv.close();
  }
  console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}. Screenshots in ${path.relative(REPO, OUT) || OUT}`);
  process.exit(fails ? 1 : 0);
})();
