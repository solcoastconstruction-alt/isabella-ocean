// Sea Jigsaw: the rules, the cuts and the pictures, tested in Node with the same web/games/jigsaw/logic.js and
// pictures.js the game loads.
//   node test/games/jigsaw/verify.js            (no browser; exits non-zero if anything fails)
//   node test/games/jigsaw/verify.js --update   (after a deliberate change to a cut, a picture or the table:
//                                                rewrite fingerprints.json, then read its diff before committing)
// What it proves:
//   - the table: thirty puzzles, ten a mode, thirty different pictures, piece counts rising, no piece under 19vh
//   - every cut: the pieces tile the picture exactly, every tab meets its blank, every piece has exactly one home
//   - the coins: the base is always given, the bonus only ever adds, and it drains at the right seconds
//   - the rules of a play (tray, bag, board, home), and that random play can never lose a piece
//   - saving: round trip, repair of a damaged save, finishing
//   - fingerprints: the table, all thirty cuts and all thirty pictures are frozen, so none can drift unnoticed
// The browser checks are test/games/jigsaw/browser.js (play, real touch, screenshots) and soak.js (long random play).
'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// JIGSAW_DIR=<dir> runs these checks against another copy of the game (to prove they catch an injected defect)
const DIR = process.env.JIGSAW_DIR ? path.resolve(process.env.JIGSAW_DIR) : path.resolve(__dirname, '../../../web/games/jigsaw');
const L = require(path.join(DIR, 'logic.js'));
const P = require(path.join(DIR, 'pictures.js'));
const FP_FILE = path.join(__dirname, 'fingerprints.json');
const UPDATE = process.argv.includes('--update');

let pass = 0, fail = 0;
function check(name, fn) {
  try { const detail = fn(); pass++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e && e.message ? e.message.split('\n').slice(0, 6).join('\n      ') : e}`); }
}
const sha = (v) => crypto.createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const nonDecreasing = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]);
const PZ = L.PUZZLES, VH19 = 0.19 * 540;   // 19vh in world units (the world is 540 tall)

// ---------------- the table ----------------
check('thirty puzzles: ten Easy, ten Medium, ten Hard, numbered 1 to 10, each with its own id', () => {
  assert.equal(PZ.length, 30); assert.equal(L.PER, 10); assert.deepEqual(L.MODE_IDS, ['easy', 'medium', 'hard']);
  for (const m of L.MODE_IDS) { const ps = L.puzzlesOf(m); assert.equal(ps.length, 10, m); assert.deepEqual(ps.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); }
  assert.equal(new Set(PZ.map((p) => p.id)).size, 30);
  for (const p of PZ) { assert.equal(L.puzzle(p.mode, p.n), p); assert.equal(L.byId[p.id], p); assert.equal(p.pieces, p.cols * p.rows); }
  assert.equal(L.puzzle('easy', 11), null); assert.equal(L.puzzle('easy', 0), null);
});
check('thirty different pictures, and every one is painted by pictures.js (none missing, none unused)', () => {
  const pics = PZ.map((p) => p.pic);
  assert.equal(new Set(pics).size, 30, 'a picture is used twice');
  assert.deepEqual(pics.filter((id) => !P.IDS.includes(id)), [], 'no painter');
  assert.deepEqual(P.IDS.filter((id) => !pics.includes(id)), [], 'painted but never used');
  return pics.join(' ');
});
check('piece counts rise through each mode: Easy 4 to 12, Medium 12 to 24, Hard 24 to 40, each mode starting where the last ended', () => {
  const n = {}; for (const m of L.MODE_IDS) { n[m] = L.puzzlesOf(m).map((p) => p.pieces); assert.ok(nonDecreasing(n[m]), `${m}: ${n[m]}`); assert.ok(n[m][9] > n[m][0], m); }
  assert.equal(n.easy[0], 4); assert.equal(n.easy[9], 12); assert.equal(n.medium[0], 12); assert.equal(n.medium[9], 24); assert.equal(n.hard[0], 24); assert.equal(n.hard[9], 40);
  assert.ok(n.medium[0] >= n.easy[9] && n.hard[0] >= n.medium[9]);
  for (const m of L.MODE_IDS) n[m].forEach((v, i) => { if (i) assert.ok(v - n[m][i - 1] <= 5, `${m} ${i + 1} jumps by ${v - n[m][i - 1]}`); });
  return L.MODE_IDS.map((m) => `${m} ${n[m].join(',')}`).join(' | ');
});
check('no piece is smaller than 19vh either way, even at 40 pieces (the board is 832 x 520 of a 540-tall screen)', () => {
  assert.equal(L.PW, 832); assert.equal(L.PH, 520);
  let min = Infinity;
  for (const p of PZ) { assert.ok(Math.abs(p.cw * p.cols - L.PW) < 1e-9 && Math.abs(p.ch * p.rows - L.PH) < 1e-9); min = Math.min(min, p.cw, p.ch); assert.ok(Math.min(p.cw, p.ch) >= VH19, `${p.id}: ${p.cw.toFixed(1)} x ${p.ch.toFixed(1)}`); }
  for (const p of PZ) { const ratio = p.cw / p.ch; assert.ok(ratio > 0.62 && ratio < 1.65, `${p.id} pieces are too long and thin: ${ratio.toFixed(2)}`); }
  return `smallest side ${min.toFixed(1)} units = ${((min / 540) * 100).toFixed(2)}vh`;
});
check('every cut has its own seed', () => { assert.equal(new Set(PZ.map((p) => p.seed)).size, 30); });
check('the modes: Easy shows a ghost, Medium outlines, Hard neither; snapping gets tighter; hints come later', () => {
  const M = L.MODES;
  assert.equal(M.easy.guide, 'ghost'); assert.equal(M.medium.guide, 'outline'); assert.equal(M.hard.guide, 'none');
  assert.ok(M.easy.snap >= M.medium.snap && M.medium.snap >= M.hard.snap);
  assert.ok(M.easy.hintAfter < M.medium.hintAfter && M.medium.hintAfter < M.hard.hintAfter);
  assert.ok(M.easy.tapHint && M.medium.tapHint && !M.hard.tapHint);
  for (const m of L.MODE_IDS) { const [c, r] = M[m].tray; assert.ok(c * r >= 3 && c * r <= 8, `${m} tray`); }
});

// ---------------- geometry helpers ----------------
const polyArea = (o) => { let a = 0; for (let i = 0; i < o.length; i++) { const p = o[i], q = o[(i + 1) % o.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function inside(x, y, o) {
  let c = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const xi = o[i][0], yi = o[i][1], xj = o[j][0], yj = o[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function segsCross(a, b, c, d) {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]), d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]), d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// a piece's four sides (top, right, bottom, left), each as its list of points along the path
function sidesOf(piece) {
  const out = [], pts = [];
  let cur = [piece.path[0][1], piece.path[0][2]];
  const segs = piece.path.slice(1), order = ['t', 'r', 'b', 'l'];
  let i = 0;
  for (const side of order) {
    const flat = piece.sides[side] === 0, take = flat ? 1 : 3, side0 = [cur.slice()];
    for (let k = 0; k < take; k++) {
      const s = segs[i++];
      assert.equal(s[0], flat ? 'L' : 'C', `piece ${piece.id} side ${side}`);
      for (let v = 1; v < s.length; v += 2) side0.push([s[v], s[v + 1]]);
      cur = [s[s.length - 2], s[s.length - 1]];
    }
    out.push({ side, pts: side0, flat });
  }
  assert.equal(i, segs.length, `piece ${piece.id} has extra path segments`);
  return out;
}
const key = (pts) => pts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');

// ---------------- every cut ----------------
const CUTS = new Map(PZ.map((p) => [p.id, L.cut(p)]));
check('each cut has one piece for every square of its grid, and each piece is a closed outline that goes round its four corners in turn', () => {
  for (const p of PZ) {
    const C = CUTS.get(p.id);
    assert.equal(C.pieces.length, p.pieces, p.id);
    C.pieces.forEach((q, i) => {
      assert.equal(q.id, i); assert.equal(q.id, q.r * p.cols + q.c);
      assert.equal(q.path[0][0], 'M');
      const last = q.path[q.path.length - 1];
      assert.ok(Math.abs(last[last.length - 2] - q.path[0][1]) < 1e-9 && Math.abs(last[last.length - 1] - q.path[0][2]) < 1e-9, `${p.id} piece ${i} is not closed`);
      for (const s of q.path) for (const v of s.slice(1)) assert.ok(Number.isFinite(v), `${p.id} piece ${i} has a bad number`);
      // top-left -> top-right -> bottom-right -> bottom-left -> top-left: each side must end on the next corner
      const r3 = (v) => Math.round(v * 1000) / 1000, x0 = r3(q.c * p.cw), y0 = r3(q.r * p.ch), x1 = r3((q.c + 1) * p.cw), y1 = r3((q.r + 1) * p.ch);
      const ends = sidesOf(q).map((s) => s.pts[s.pts.length - 1]);
      assert.deepEqual(ends, [[x1, y0], [x1, y1], [x0, y1], [x0, y0]], `${p.id} piece ${i} does not go round its corners in turn`);
    });
  }
});
check('every inside edge is one curve shared by exactly two pieces, walked opposite ways; every outside edge is straight and on the border', () => {
  let shared = 0, border = 0;
  for (const p of PZ) {
    const C = CUTS.get(p.id), seen = new Map();
    for (const q of C.pieces) {
      for (const s of sidesOf(q)) {
        if (s.flat) {
          border++;
          const [a, b] = s.pts;
          const onBorder = (a[0] === b[0] && (a[0] === 0 || a[0] === L.PW)) || (a[1] === b[1] && (a[1] === 0 || a[1] === L.PH));
          assert.ok(onBorder, `${p.id} piece ${q.id} side ${s.side}: a flat side inside the picture`);
          continue;
        }
        const fwd = key(s.pts), rev = key(s.pts.slice().reverse());
        if (seen.has(rev)) { assert.equal(seen.get(rev), 1, 'used three times'); seen.set(rev, 2); shared++; }
        else { assert.ok(!seen.has(fwd), `${p.id}: two pieces walk an edge the same way`); seen.set(fwd, 1); }
      }
    }
    for (const [k, n] of seen) assert.equal(n, 2, `${p.id}: an inside edge belongs to only one piece (${k.slice(0, 40)}...)`);
    assert.equal(seen.size, (p.cols - 1) * p.rows + p.cols * (p.rows - 1), `${p.id}: number of inside edges`);
  }
  return `${shared} shared edges, ${border} border sides`;
});
check('every tab meets its blank: neighbours always have one of each, flat sides only on the border, and the curve bulges the way it says', () => {
  let tabs = 0;
  for (const p of PZ) {
    const C = CUTS.get(p.id), at = (c, r) => C.pieces[r * p.cols + c], m = Math.min(p.cw, p.ch);
    for (const q of C.pieces) {
      assert.equal(q.sides.t === 0, q.r === 0, `${p.id} ${q.id} top`); assert.equal(q.sides.b === 0, q.r === p.rows - 1, `${p.id} ${q.id} bottom`);
      assert.equal(q.sides.l === 0, q.c === 0, `${p.id} ${q.id} left`); assert.equal(q.sides.r === 0, q.c === p.cols - 1, `${p.id} ${q.id} right`);
      for (const v of Object.values(q.sides)) assert.ok(v === 0 || v === 1 || v === -1);
      if (q.c < p.cols - 1) { const n = at(q.c + 1, q.r); assert.equal(q.sides.r + n.sides.l, 0, `${p.id}: pieces ${q.id} and ${n.id} do not fit`); assert.notEqual(q.sides.r, 0); tabs++; }
      if (q.r < p.rows - 1) { const n = at(q.c, q.r + 1); assert.equal(q.sides.b + n.sides.t, 0, `${p.id}: pieces ${q.id} and ${n.id} do not fit`); assert.notEqual(q.sides.b, 0); tabs++; }
      // the shape itself: a tab reaches out past the piece's square by about a quarter of its smaller side, a blank does not
      const reachOut = { t: q.r * p.ch - q.box.y0, b: q.box.y1 - (q.r + 1) * p.ch, l: q.c * p.cw - q.box.x0, r: q.box.x1 - (q.c + 1) * p.cw };
      for (const s of ['t', 'r', 'b', 'l']) {
        if (q.sides[s] === 1) assert.ok(reachOut[s] > 0.17 * m && reachOut[s] < 0.32 * m, `${p.id} piece ${q.id} side ${s}: tab reaches ${reachOut[s].toFixed(1)} of ${m.toFixed(0)}`);
        else assert.ok(reachOut[s] < 0.07 * m, `${p.id} piece ${q.id} side ${s}: sticks out ${reachOut[s].toFixed(1)} but is not a tab`);
      }
    }
  }
  return `${tabs} tab-and-blank pairs`;
});
check('the pieces tile the picture exactly: their areas add up to the picture, and every sampled point lies in exactly one piece', () => {
  let worst = 0, points = 0;
  for (const p of PZ) {
    const C = CUTS.get(p.id), outs = C.pieces.map((q) => L.outline(q, 16));
    let area = 0;
    outs.forEach((o, i) => {
      const a = polyArea(o);
      assert.ok(a > 0, `${p.id} piece ${i} is drawn anticlockwise or empty`);
      assert.ok(a > 0.55 * p.cw * p.ch && a < 1.5 * p.cw * p.ch, `${p.id} piece ${i} has area ${a.toFixed(0)} for a ${(p.cw * p.ch).toFixed(0)} square`);
      area += a;
    });
    worst = Math.max(worst, Math.abs(area - L.PW * L.PH));
    assert.ok(Math.abs(area - L.PW * L.PH) < 0.05, `${p.id}: the pieces cover ${area.toFixed(3)}, the picture is ${L.PW * L.PH}`);
    for (let y = 3.37; y < L.PH; y += 7.9) {
      for (let x = 2.71; x < L.PW; x += 7.9) {
        let n = 0;
        for (let i = 0; i < outs.length; i++) { const b = C.pieces[i].box; if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue; if (inside(x, y, outs[i])) n++; }
        assert.equal(n, 1, `${p.id}: the point (${x.toFixed(1)}, ${y.toFixed(1)}) is in ${n} pieces`);
        points++;
      }
    }
  }
  return `${points} points checked; total areas within ${worst.toFixed(4)} square units`;
});
check('no piece crosses itself (tabs and blanks never run into each other), and no piece is stretched past a neighbour', () => {
  let segs = 0;
  for (const p of PZ) {
    const C = CUTS.get(p.id), m = Math.min(p.cw, p.ch);
    for (const q of C.pieces) {
      const o = L.outline(q, 12), n = o.length;
      for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        assert.ok(!segsCross(o[i], o[(i + 1) % n], o[j], o[(j + 1) % n]), `${p.id} piece ${q.id} crosses itself`);
        segs++;
      }
      assert.ok(q.box.x1 - q.box.x0 <= p.cw + 0.62 * m && q.box.y1 - q.box.y0 <= p.ch + 0.62 * m, `${p.id} piece ${q.id} is too big`);
    }
    const rc = L.reach(p);
    assert.ok(rc.w >= p.cw && rc.w <= p.cw + 0.64 * m && rc.h >= p.ch && rc.h <= p.ch + 0.64 * m, `${p.id} reach ${rc.w.toFixed(0)} x ${rc.h.toFixed(0)}`);
  }
  return `${segs} pairs of outline segments`;
});
check('every piece has exactly one home: its own square, inside its own outline and nobody else\'s; no two pieces are the same shape', () => {
  for (const p of PZ) {
    const C = CUTS.get(p.id), outs = C.pieces.map((q) => L.outline(q, 16)), homes = new Set(), shapes = new Set();
    C.pieces.forEach((q, i) => {
      assert.ok(Math.abs(q.hx - (q.c + 0.5) * p.cw) < 1e-9 && Math.abs(q.hy - (q.r + 0.5) * p.ch) < 1e-9, `${p.id} piece ${i} home`);
      homes.add(q.hx.toFixed(3) + ',' + q.hy.toFixed(3));
      const inN = outs.reduce((n, o) => n + (inside(q.hx, q.hy, o) ? 1 : 0), 0);
      assert.equal(inN, 1, `${p.id}: the middle of piece ${i}'s place is inside ${inN} pieces`);
      assert.ok(inside(q.hx, q.hy, outs[i]), `${p.id}: piece ${i} does not cover its own place`);
      shapes.add(outs[i].map((v) => (v[0] - q.hx).toFixed(1) + ',' + (v[1] - q.hy).toFixed(1)).join(' '));
    });
    assert.equal(homes.size, p.pieces, `${p.id}: two pieces share a home`);
    assert.equal(shapes.size, p.pieces, `${p.id}: two pieces have the very same shape`);
  }
});
check('a cut is the same every time it is made (seeded, nothing random)', () => {
  const file = path.join(DIR, 'logic.js');
  delete require.cache[require.resolve(file)];
  const L2 = require(file);
  for (const p of PZ) assert.equal(sha(L2.cut(L2.byId[p.id]).pieces.map((q) => q.path)), sha(CUTS.get(p.id).pieces.map((q) => q.path)), p.id);
  assert.equal(L.cut(PZ[0]), L.cut(PZ[0]), 'cut() should hand back the same object');
});

// ---------------- coins and the bonus ----------------
check('coins: the base is always given (5 Easy, 10 Medium, 15 Hard) and each bonus coin kept adds 1, 2 or 3', () => {
  const M = L.MODES;
  assert.deepEqual([M.easy.base, M.medium.base, M.hard.base], [5, 10, 15]);
  assert.deepEqual([M.easy.bonusEach, M.medium.bonusEach, M.hard.bonusEach], [1, 2, 3]);
  assert.equal(L.BONUS, 3);
  for (const p of PZ) {
    const Mo = M[p.mode], fast = L.coinsFor(p, 0), slow = L.coinsFor(p, 1e9);
    assert.deepEqual(fast, { base: Mo.base, bonus: 3, bonusCoins: 3 * Mo.bonusEach, total: Mo.base + 3 * Mo.bonusEach }, p.id);
    assert.deepEqual(slow, { base: Mo.base, bonus: 0, bonusCoins: 0, total: Mo.base }, `${p.id}: the slowest finish still gets the base`);
    assert.ok(slow.total > 0); assert.ok(fast.bonusCoins < fast.base, 'the bonus is only ever extra: less than the base');
  }
  return 'Easy 5-8, Medium 10-16, Hard 15-24';
});
check('the three bonus coins drift away one at a time, at lead + pace x pieces seconds, and never come back', () => {
  for (const p of PZ) {
    const M = L.MODES[p.mode], T = L.bonusTimes(p);
    assert.deepEqual(T, M.pace.map((s) => M.lead + s * p.pieces), p.id);
    assert.ok(T[0] < T[1] && T[1] < T[2], p.id); assert.ok(T[0] >= 20, `${p.id}: the first coin goes after only ${T[0]} s`);
    assert.equal(L.bonusLeft(p, 0), 3); assert.equal(L.bonusLeft(p, T[0] - 0.01), 3); assert.equal(L.bonusLeft(p, T[0]), 2);
    assert.equal(L.bonusLeft(p, T[1] - 0.01), 2); assert.equal(L.bonusLeft(p, T[1]), 1); assert.equal(L.bonusLeft(p, T[2] - 0.01), 1); assert.equal(L.bonusLeft(p, T[2]), 0);
    assert.equal(L.bonusLeft(p, 1e9), 0);
    let prev = 3;
    for (let t = 0; t <= T[2] + 5; t += 0.5) { const b = L.bonusLeft(p, t), c = L.coinsFor(p, t); assert.ok(b <= prev && b >= 0, `${p.id} at ${t}`); assert.equal(c.total, M.base + b * M.bonusEach); prev = b; }
  }
  for (const m of L.MODE_IDS) for (let k = 0; k < 3; k++) assert.ok(nonDecreasing(L.puzzlesOf(m).map((p) => L.bonusTimes(p)[k])), `${m}: bigger puzzles get more time`);
  return `easy 1: ${L.bonusTimes(PZ[0]).join('/')} s, hard 10: ${L.bonusTimes(PZ[29]).join('/')} s`;
});
check('a magnetic snap: at least 40 units, never more than half a piece, bigger for bigger pieces, tighter in harder modes', () => {
  for (const p of PZ) {
    const r = L.snapRadius(p), M = L.MODES[p.mode];
    assert.ok(r >= 40 && r >= M.snapMin && r <= M.snapMax, `${p.id}: ${r}`);
    assert.ok(r <= 0.5 * Math.min(p.cw, p.ch) + 1e-9, `${p.id}: a piece could snap from another piece's place`);
  }
  assert.ok(L.snapRadius(L.puzzle('easy', 9)) > L.snapRadius(L.puzzle('medium', 1)), 'same grid: Easy snaps from further than Medium');
  return `${L.snapRadius(PZ[0])} units on easy 1, ${L.snapRadius(PZ[29]).toFixed(1)} on hard 10`;
});
check('letting go: within the snap of its place a piece goes home (by the piece or by the finger); over the tray it goes back; else it stays on the board', () => {
  const tray = { x0: 960, y0: 10, x1: 1196, y1: 530 }, base = { hx: 400, hy: 300, snapR: 50, tray };
  assert.equal(L.resolveDrop({ ...base, px: 400, py: 300, fx: 400, fy: 300 }), 'home');
  assert.equal(L.resolveDrop({ ...base, px: 449, py: 300, fx: 700, fy: 100 }), 'home', 'the piece is close');
  assert.equal(L.resolveDrop({ ...base, px: 700, py: 100, fx: 400, fy: 349 }), 'home', 'the finger is close');
  assert.equal(L.resolveDrop({ ...base, px: 451, py: 300, fx: 451, fy: 300 }), 'board', 'just outside');
  assert.equal(L.resolveDrop({ ...base, px: 990, py: 200, fx: 1000, fy: 200 }), 'tray');
  assert.equal(L.resolveDrop({ ...base, px: 990, py: 200, fx: 940, fy: 200 }), 'board', 'the finger is not over the tray');
  assert.equal(L.resolveDrop({ ...base, hx: 940, hy: 200, px: 970, py: 200, fx: 970, fy: 200 }), 'home', 'home wins over the tray');
  assert.equal(L.resolveDrop({ ...base, px: 100, py: 100 }), 'board', 'no finger given: the piece stands in for it');
  assert.deepEqual(L.clampToBoard(-50, 900, { x0: 116, y0: 10, x1: 948, y1: 530 }), { x: 116, y: 530 });
  assert.deepEqual(L.clampToBoard(300, 200, { x0: 116, y0: 10, x1: 948, y1: 530 }), { x: 300, y: 200 });
});

// ---------------- one play ----------------
// every piece is in exactly one place, and the tray, the bag and the counts agree
function consistent(run, where) {
  const n = run.n, seen = new Array(n).fill(0);
  run.slots.forEach((id, k) => { if (id >= 0) { seen[id]++; assert.equal(run.state[id], 'tray', `${where}: slot ${k}`); } });
  for (const id of run.queue) { seen[id]++; assert.equal(run.state[id], 'bag', `${where}: queue`); }
  let home = 0, loose = 0;
  for (let i = 0; i < n; i++) {
    if (run.state[i] === 'home') { home++; assert.equal(seen[i], 0, where); }
    else if (run.state[i] === 'loose') { loose++; assert.equal(seen[i], 0, where); }
    else assert.equal(seen[i], 1, `${where}: piece ${i} (${run.state[i]}) is in ${seen[i]} places`);
  }
  assert.equal(home, run.homeCount, where);
  assert.equal(home + loose + run.queue.length + run.slots.filter((v) => v >= 0).length, n, `${where}: a piece is lost`);
  assert.equal(run.done, home === n, where);
  if (run.queue.length) assert.ok(run.slots.every((v) => v >= 0), `${where}: a tray slot is empty while pieces wait`);
}
check('a new play: the tray is full (3 on Easy, 8 on Medium and Hard, or every piece if fewer), the rest wait, the clock has not started', () => {
  for (const p of PZ) {
    const run = new L.Run(p, null, mulberry32(p.seed)), [c, r] = L.MODES[p.mode].tray, slots = c * r;
    assert.equal(run.slots.length, slots);
    assert.equal(run.slots.filter((v) => v >= 0).length, Math.min(slots, p.pieces), p.id);
    assert.equal(run.waiting, Math.max(0, p.pieces - slots));
    assert.equal(run.homeCount, 0); assert.equal(run.done, false); assert.equal(run.started, false); assert.equal(run.t, 0); assert.equal(run.bonus, 3);
    run.tick(5); assert.equal(run.t, 0, 'the clock only runs once a piece has been touched');
    consistent(run, p.id);
  }
  assert.deepEqual(L.MODES.easy.tray, [1, 3]); assert.deepEqual(L.MODES.hard.tray, [2, 4]);
});
check('a piece dropped home leaves the tray, the next piece takes its slot, and the last one finishes the puzzle', () => {
  for (const p of PZ) {
    const run = new L.Run(p, null, mulberry32(7));
    let dealt = 0;
    for (let k = 0; k < p.pieces; k++) {
      const slot = run.slots.findIndex((v) => v >= 0), id = run.slots[slot], waiting = run.waiting;
      const res = run.drop(id, 'home');
      assert.equal(res.type, 'home'); assert.equal(res.from, 'tray'); assert.equal(run.state[id], 'home');
      if (waiting) { assert.equal(res.dealt.length, 1); assert.equal(res.dealt[0][1], slot, 'the new piece takes the freed slot'); dealt++; } else assert.equal(res.dealt.length, 0);
      assert.equal(res.done, k === p.pieces - 1);
      consistent(run, `${p.id} after ${k + 1}`);
    }
    assert.ok(run.done); assert.equal(run.homeCount, p.pieces);
    assert.equal(dealt, Math.max(0, p.pieces - run.slots.length));
    assert.equal(run.drop(0, 'home').type, 'ignored', 'nothing moves once it is finished');
    const t = run.t; run.tick(3); assert.equal(run.t, t, 'the clock stops at the last piece');
  }
});
check('a wrong drop just stays on the board (no penalty, nothing lost), and can go home, back to the tray or to the front of the bag later', () => {
  const p = L.puzzle('medium', 5), run = new L.Run(p, null, mulberry32(3));
  const a = run.slots[0], b = run.slots[1], waiting = run.waiting;
  let res = run.drop(a, 'board');
  assert.equal(res.type, 'loose'); assert.equal(run.state[a], 'loose'); assert.equal(run.homeCount, 0); assert.equal(run.misses, 1);
  assert.equal(res.dealt.length, 1); assert.equal(res.dealt[0][1], 0); assert.equal(run.waiting, waiting - 1);
  consistent(run, 'loose');
  res = run.drop(a, 'board'); assert.equal(res.type, 'loose'); assert.equal(res.dealt.length, 0, 'moving a loose piece deals nothing');
  res = run.drop(b, 'tray'); assert.equal(res.type, 'back'); assert.equal(res.slot, 1); assert.equal(run.state[b], 'tray'); assert.equal(run.slots[1], b);
  // the tray is full: a loose piece put back waits first in line
  res = run.drop(a, 'tray'); assert.equal(res.type, 'bag'); assert.equal(run.state[a], 'bag'); assert.equal(run.queue[0], a);
  consistent(run, 'bag');
  res = run.drop(b, 'home'); assert.equal(res.type, 'home'); assert.deepEqual(res.dealt, [[a, 1]], 'and it is the next piece dealt');
  // with a free slot (nothing waiting), a loose piece put back takes it
  const q = L.puzzle('easy', 1), r2 = new L.Run(q, null, mulberry32(1));
  r2.drop(r2.slots[0], 'home');             // the fourth piece is dealt
  const c = r2.slots[0]; r2.drop(c, 'board'); assert.equal(r2.slots[0], -1);
  res = r2.drop(c, 'tray'); assert.equal(res.type, 'back'); assert.equal(res.slot, 0); assert.equal(r2.state[c], 'tray');
  res = r2.drop(c, 'home'); assert.equal(res.from, 'tray');
  consistent(r2, 'easy 1');
  // pieces that are not in play cannot be dropped
  assert.equal(run.drop(run.queue[0], 'home').type, 'ignored'); assert.equal(run.drop(999, 'home').type, 'ignored'); assert.equal(run.drop(-1, 'home').type, 'ignored');
});
check('the clock: starts at the first touch, runs while playing, stops at the end; the bonus follows it', () => {
  const p = L.puzzle('easy', 1), run = new L.Run(p, null, mulberry32(1)), T = L.bonusTimes(p);
  run.tick(100); assert.equal(run.t, 0);
  run.start(); run.tick(T[0] - 1); assert.equal(run.bonus, 3); run.tick(1.5); assert.equal(run.bonus, 2);
  run.tick(-5); run.tick(NaN); assert.ok(Math.abs(run.t - (T[0] + 0.5)) < 1e-9, 'time never runs backwards');
  for (let i = 0; i < 4; i++) run.drop(run.slots.find((v) => v >= 0), 'home');
  assert.ok(run.done); assert.deepEqual(run.coins, { base: 5, bonus: 2, bonusCoins: 2, total: 7 });
  const r2 = new L.Run(p, null, mulberry32(1)); r2.drop(r2.slots[0], 'board'); assert.ok(r2.started, 'a drop starts the clock too');
});
check('random play can never lose or double a piece, and every puzzle can still be finished afterwards', () => {
  let drops = 0;
  for (const p of PZ) {
    const R = mulberry32(p.seed * 31), run = new L.Run(p, null, R);
    for (let k = 0; k < 400 && !run.done; k++) {
      const movable = []; for (let i = 0; i < p.pieces; i++) if (run.state[i] === 'tray' || run.state[i] === 'loose') movable.push(i);
      const id = movable[Math.floor(R() * movable.length)], w = R();
      run.drop(id, w < 0.25 ? 'home' : w < 0.7 ? 'board' : 'tray');
      run.tick(R() * 3); drops++;
      consistent(run, `${p.id} drop ${k}`);
    }
    for (let guard = 0; guard < 500 && !run.done; guard++) {
      const id = run.state.findIndex((s) => s === 'tray' || s === 'loose');
      assert.ok(id >= 0, `${p.id}: pieces are waiting but none can be picked up`);
      run.drop(id, 'home');
    }
    assert.ok(run.done, `${p.id} could not be finished`); consistent(run, `${p.id} end`);
  }
  return `${drops} random drops`;
});
check('the order pieces are dealt: any order on Easy and Medium; on Hard from the outside in (the frame first)', () => {
  for (const p of PZ) {
    const ids = Array.from({ length: p.pieces }, (_, i) => i), a = L.dealOrder(p, ids, mulberry32(5)), b = L.dealOrder(p, ids, mulberry32(5)), c = L.dealOrder(p, ids, mulberry32(6));
    assert.deepEqual(a.slice().sort((x, y) => x - y), ids, `${p.id}: not every piece is dealt`);
    assert.deepEqual(a, b); if (p.pieces > 4) assert.notDeepEqual(a, c, `${p.id}: the order never changes`);
    assert.deepEqual(ids, Array.from({ length: p.pieces }, (_, i) => i), 'the list handed in is left alone');
    const rings = a.map((id) => L.ring(p, id));
    if (p.mode === 'hard') { assert.ok(nonDecreasing(rings), `${p.id}: ${rings}`); assert.equal(rings[0], 0); }
  }
  const p = L.puzzle('hard', 10);
  assert.equal(L.ring(p, 0), 0); assert.equal(L.ring(p, 9), 1); assert.equal(L.ring(p, 8 * 2 + 3), 2); assert.equal(L.ring(p, 39), 0);
  const firstTray = new L.Run(p, null, mulberry32(9)).slots;
  assert.ok(firstTray.every((id) => L.ring(p, id) === 0), 'the first tray of Hard 10 is all frame pieces');
});
check('a half-done puzzle is kept: the pieces at home and the clock come back, the others go back in the bag', () => {
  const p = L.puzzle('hard', 3), run = new L.Run(p, null, mulberry32(2));
  run.start();
  for (let k = 0; k < 9; k++) run.drop(run.slots.find((v) => v >= 0), 'home');
  run.drop(run.slots.find((v) => v >= 0), 'board');
  run.tick(123.44);
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.equal(snap.home.length, 9); assert.equal(snap.t, 123.4);
  const back = new L.Run(p, snap, mulberry32(8));
  assert.equal(back.homeCount, 9); assert.equal(back.t, 123.4); assert.deepEqual(back.snapshot(), snap);
  assert.equal(back.started, false); back.tick(30); assert.equal(back.t, 123.4, 'the clock waits for the first touch again');
  back.start(); back.tick(1); assert.equal(back.t, 124.4);
  for (const id of snap.home) assert.equal(back.state[id], 'home');
  consistent(back, 'resumed');
  assert.equal(back.bonus, L.bonusLeft(p, 124.4));
  // damaged or impossible saves start the puzzle again rather than break it
  for (const bad of [{ home: 'x' }, { home: [-1, 99, 2.5, 'a', null] }, { home: Array.from({ length: p.pieces }, (_, i) => i), t: 50 }, { t: -4 }, { t: 'soon' }, 7, 'x']) {
    const r = new L.Run(p, bad, mulberry32(1)); consistent(r, 'bad save ' + JSON.stringify(bad).slice(0, 30));
    assert.ok(r.homeCount < p.pieces, 'a save can never hold a finished puzzle'); assert.ok(r.t >= 0);
  }
  assert.equal(new L.Run(p, { home: [3, 3, 3], t: 2 }, mulberry32(1)).homeCount, 1, 'a piece listed twice counts once');
});

// ---------------- saving ----------------
check('a fresh save: Easy, Medium and Hard each start with puzzle 1 open and nothing finished', () => {
  const sv = L.freshSave();
  assert.deepEqual(sv, { v: 1, mode: 'easy', coins: 0, solved: 0, easy: { unlocked: 1, best: new Array(10).fill(-1) }, medium: { unlocked: 1, best: new Array(10).fill(-1) }, hard: { unlocked: 1, best: new Array(10).fill(-1) }, runs: {} });
  for (const raw of [null, undefined, '', '{', 'null', '[]', '[1,2]', 42, 'true', '"x"']) assert.deepEqual(L.migrate(raw), sv, `migrate(${JSON.stringify(raw)})`);
});
check('finishing: the coins go in, the next puzzle opens, the best bonus is kept, replays count too', () => {
  const sv = L.freshSave(), p = L.puzzle('medium', 1), T = L.bonusTimes(p);
  let res = L.finish(sv, p, T[1] + 1);
  assert.deepEqual(res, { first: true, base: 10, bonus: 1, bonusCoins: 2, total: 12 });
  assert.equal(sv.coins, 12); assert.equal(sv.solved, 1); assert.equal(sv.medium.unlocked, 2); assert.equal(sv.medium.best[0], 1); assert.equal(sv.easy.unlocked, 1);
  res = L.finish(sv, p, 1e6);
  assert.equal(res.first, false); assert.equal(res.total, 10); assert.equal(sv.coins, 22); assert.equal(sv.medium.best[0], 1, 'a slower replay never lowers the best');
  res = L.finish(sv, p, 1);
  assert.equal(sv.medium.best[0], 3); assert.equal(sv.coins, 38); assert.equal(sv.solved, 3); assert.equal(sv.medium.unlocked, 2);
  const last = L.puzzle('hard', 10); sv.hard.unlocked = 10; sv.runs[last.id] = { home: [1], t: 3 };
  L.finish(sv, last, 0);
  assert.equal(sv.hard.unlocked, 10, 'nothing past puzzle 10'); assert.equal(sv.hard.best[9], 3); assert.equal(sv.runs[last.id], undefined, 'the half-done run is forgotten');
});
check('a save survives the round trip to a string and back, half-done puzzles included', () => {
  const sv = L.freshSave();
  L.finish(sv, L.puzzle('easy', 1), 3); L.finish(sv, L.puzzle('easy', 2), 500); L.finish(sv, L.puzzle('hard', 1), 200);
  sv.mode = 'hard';
  const run = new L.Run(L.puzzle('easy', 3), null, mulberry32(4));
  run.start(); run.drop(run.slots[0], 'home'); run.drop(run.slots[1], 'home'); run.tick(17.26);
  sv.runs.e3 = run.snapshot();
  const back = L.migrate(JSON.stringify(sv));
  assert.deepEqual(back, sv);
  assert.deepEqual(L.migrate(back), sv, 'an object works as well as a string');
  assert.deepEqual(L.migrate(JSON.stringify(L.migrate(JSON.stringify(back)))), sv, 'and it is stable');
  assert.equal(back.coins, 8 + 5 + 21); assert.equal(back.easy.unlocked, 3); assert.equal(back.runs.e3.home.length, 2); assert.equal(back.runs.e3.t, 17.3);
});
check('a damaged save is repaired, never trusted: counts clamped, impossible runs dropped, a finished puzzle always opens the next', () => {
  const sv = L.migrate(JSON.stringify({ v: 1, mode: 'silly', coins: -5, solved: 'many', easy: { unlocked: 99, best: [5, -3, 'x', 2, null, 3.9] }, medium: { unlocked: 0, best: [-1, -1, -1, 2] }, hard: 'gone',
    runs: { e1: { home: [0, 1], t: 9 }, m9: { home: [1], t: 4 }, zz: { home: [1] }, e2: 'no', e3: { home: [], t: 30 }, e4: { home: [0, 1, 2, 3, 4, 5], t: 5 } } }));
  assert.equal(sv.mode, 'easy'); assert.equal(sv.coins, 0); assert.equal(sv.solved, 0);
  assert.deepEqual(sv.easy.best, [3, -1, -1, 2, -1, 3, -1, -1, -1, -1]); assert.equal(sv.easy.unlocked, 10);
  assert.equal(sv.medium.unlocked, 5, 'puzzle 4 was finished, so 5 is open'); assert.deepEqual(sv.hard, { unlocked: 1, best: new Array(10).fill(-1) });
  assert.deepEqual(Object.keys(sv.runs), ['e1'], 'only a real, unlocked, half-done puzzle is kept');
  assert.deepEqual(sv.runs.e1, { home: [0, 1], t: 9 });
  assert.equal(L.migrate({ coins: 1e12 }).coins, 1e9);
});

// ---------------- the pictures ----------------
// A stand-in for a canvas context that writes down everything it is asked to draw (numbers rounded to a hundredth):
// the list is a picture's fingerprint, and a painter that draws nothing, loses a save() or works out a NaN is caught.
function recorder() {
  const log = []; const st = { depth: 0, minDepth: 0, bad: 0, calls: 0, fills: 0 };
  const fmt = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : (st.bad++, 'BAD')) : v && v.sig ? v.sig() : String(v));
  const gradient = (kind, args) => { const stops = []; return { addColorStop(o, c) { stops.push(fmt(o) + ':' + c); }, sig: () => `${kind}(${args.map(fmt)})[${stops}]` }; };
  const own = {
    createLinearGradient: (...a) => gradient('linear', a), createRadialGradient: (...a) => gradient('radial', a),
    save() { st.depth++; log.push('save'); }, restore() { st.depth--; st.minDepth = Math.min(st.minDepth, st.depth); log.push('restore'); },
  };
  const g = new Proxy(own, {
    get(t, k) { if (k in t) return t[k]; return (...args) => { st.calls++; if (k === 'fill' || k === 'stroke' || k === 'fillRect') st.fills++; log.push(k + '(' + args.map(fmt).join(',') + ')'); }; },
    set(t, k, v) { log.push(k + '=' + fmt(v)); return true; },
  });
  return { g, log, st };
}
const PRINTS = {};
check('every picture paints (thousands of shapes each), balances its save() and restore(), and never works out a bad number', () => {
  let least = Infinity, most = 0;
  for (const id of P.IDS) {
    const r = recorder();
    P.paint(id, r.g, L.PW, L.PH);
    assert.equal(r.st.bad, 0, `${id}: ${r.st.bad} bad numbers (NaN or infinite)`);
    assert.equal(r.st.depth, 0, `${id}: save() and restore() do not balance`); assert.ok(r.st.minDepth >= 0, `${id}: a restore() too many`);
    assert.ok(r.st.fills >= 250, `${id} paints only ${r.st.fills} shapes`);
    least = Math.min(least, r.st.fills); most = Math.max(most, r.st.fills);
    const r2 = recorder(); P.paint(id, r2.g, L.PW, L.PH);
    assert.equal(sha(r2.log.join('\n')), sha(r.log.join('\n')), `${id} paints differently the second time`);
    PRINTS[id] = sha(r.log.join('\n'));
  }
  assert.equal(new Set(Object.values(PRINTS)).size, 30, 'two pictures are the same');
  assert.throws(() => P.paint('nope', recorder().g, 10, 10));
  return `${least} to ${most} shapes a picture`;
});
check('a picture is painted to fit: half the size is the same drawing, scaled', () => {
  const a = recorder(), b = recorder();
  P.paint('hello', a.g, L.PW, L.PH); P.paint('hello', b.g, L.PW / 2, L.PH / 2);
  assert.equal(a.log.length, b.log.length);
  assert.ok(b.log.includes('scale(0.5,0.5)') && a.log.includes('scale(1,1)'));
  assert.equal(a.log.filter((l, i) => l !== b.log[i]).length, 2, 'only the clip and the scale differ');
});

// ---------------- frozen ----------------
const NOW = {
  table: sha({ TABLE: L.TABLE, MODES: L.MODES, PW: L.PW, PH: L.PH, BONUS: L.BONUS }),
  cuts: Object.fromEntries(PZ.map((p) => [p.id, sha({ v: CUTS.get(p.id).v, h: CUTS.get(p.id).h })])),
  pictures: Object.fromEntries(PZ.map((p) => [p.id + ' ' + p.pic, PRINTS[p.pic]])),
};
if (UPDATE) {
  fs.writeFileSync(FP_FILE, JSON.stringify(NOW, null, 2) + '\n');
  console.log(`\nfingerprints.json rewritten (${Object.keys(NOW.cuts).length} cuts, ${Object.keys(NOW.pictures).length} pictures). Read its diff before committing.`);
}
const FROZEN = fs.existsSync(FP_FILE) ? JSON.parse(fs.readFileSync(FP_FILE, 'utf8')) : { table: '', cuts: {}, pictures: {} };
check('frozen: the puzzle table and the modes (sizes, coins, bonus times) are byte-for-byte what was signed off', () => {
  assert.equal(NOW.table, FROZEN.table, 'the table or a mode changed: if that was meant, run verify.js --update and read the diff');
});
check('frozen: all thirty cuts are exactly the cuts that were signed off', () => {
  assert.equal(Object.keys(FROZEN.cuts).length, 30);
  const changed = PZ.filter((p) => NOW.cuts[p.id] !== FROZEN.cuts[p.id]).map((p) => p.id);
  assert.deepEqual(changed, [], 'these cuts changed (verify.js --update if that was meant)');
});
check('frozen: all thirty pictures are exactly the pictures that were signed off (every shape, colour and position)', () => {
  assert.equal(Object.keys(FROZEN.pictures).length, 30);
  const changed = Object.keys(NOW.pictures).filter((k) => NOW.pictures[k] !== FROZEN.pictures[k]);
  assert.deepEqual(changed, [], 'these pictures changed (verify.js --update if that was meant)');
});

// ---------------- the contract ----------------
check('the game keeps to the bundle\'s contract: its own save key, the hub two folders up, no network, nothing private in the source', () => {
  const files = fs.readdirSync(DIR).filter((f) => /\.(js|html|svg)$/.test(f));
  for (const f of ['index.html', 'logic.js', 'pictures.js', 'art.js', 'sound.js', 'game.js', 'hub-symbol.svg']) assert.ok(files.includes(f), `${f} is missing`);
  const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]));
  assert.ok(src['game.js'].includes("'game.jigsaw.save'")); assert.ok(src['game.js'].includes("'isabella.save'"));
  assert.ok(/window\.__back = \(\) => \{[^}]*location\.href = '\.\.\/\.\.\/index\.html'; return true; \}/.test(src['game.js']), 'window.__back');
  assert.ok(src['game.js'].includes('window.IsabellaStore.set') && src['game.js'].includes('localStorage.setItem'));
  assert.ok(/Math\.min\(window\.devicePixelRatio \|\| 1, 2\.5\)/.test(src['art.js']), 'the device pixel ratio is capped at 2.5');
  const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
  // words that must never be published (kept here in rot13 so this file can be published too), and anything that reaches the network
  const banned = ['qnhtugre', 'snzvyrmr', 'pyrneiblnapr', 'fby ?pbnfg'].map(rot13).concat(['/' + 'Users' + '/', '/' + 'home' + '/', 'https?:' + '//(?!www\\.w3\\.org)', 'XMLHttpRequest', '\\bfetch\\(', 'WebSocket', 'importScripts', '<script[^>]+src="(?!(logic|pictures|art|sound|game)\\.js")']);
  const tests = fs.readdirSync(__dirname).filter((f) => /\.(js|html|json)$/.test(f)).map((f) => [f, fs.readFileSync(path.join(__dirname, f), 'utf8')]);
  for (const [f, text] of Object.entries(src).concat(tests.slice(0, 0))) for (const b of banned) assert.ok(!new RegExp(b, 'i').test(text), `${f} contains /${b}/`);
  for (const [f, text] of tests) for (const b of banned.slice(0, 6)) assert.ok(!new RegExp(b, 'i').test(text), `test file ${f} contains /${b}/`);
  return `${files.length} game files, ${tests.length} test files`;
});

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` (${fail} FAILED)` : ''}`);
process.exit(fail ? 1 : 0);
