// Model players for the Treasure Blocks tests. They only ever look at what a child can see (the well, the sinking
// piece) and only ever do what a finger can do (left, right, turn, drop), so a game they finish is a game that can
// be finished. verify.js runs them against logic.js in Node; browser.js and soak.js use plan() and nextAction() to
// decide which real touch to make next.
'use strict';

// How good a well looks after a piece has settled: low, flat, without covered gaps and without deep narrow shafts
// (few pieces can fill one) is good; a finished row is best.
function score(grid, W, H, cleared) {
  const hs = [];
  let agg = 0, holes = 0, bump = 0, max = 0, shafts = 0;
  for (let x = 0; x < W; x++) {
    let h = 0, seen = false;
    for (let y = 0; y < H; y++) {
      const on = grid[y * W + x];
      if (on && !seen) { seen = true; h = H - y; }
      else if (!on && seen) holes++;
    }
    hs.push(h); agg += h; if (h > max) max = h;
  }
  for (let x = 0; x < W; x++) {
    if (x) bump += Math.abs(hs[x] - hs[x - 1]);
    const side = Math.min(x ? hs[x - 1] : H, x < W - 1 ? hs[x + 1] : H), d = side - hs[x];
    if (d > 1) shafts += (d - 1) * (d - 1);
  }
  return cleared * 0.76 - agg * 0.51 - holes * 0.8 - bump * 0.18 - shafts * 0.25 - (max > H - 4 ? (max - (H - 4)) * 2 : 0);
}

// Every place a piece can settle when dropped straight down from the top: each turn, each column.
// Returns [{ rot, x, y, grid (the well afterwards, full rows gone), cleared }].
function placements(L, grid, W, H, id) {
  const P = L.PIECES[id], out = [];
  const fits = (cells, x, y) => {
    for (const [dx, dy] of cells) { const cx = x + dx, cy = y + dy; if (cx < 0 || cx >= W || cy < 0 || cy >= H || grid[cy * W + cx]) return false; }
    return true;
  };
  for (let rot = 0; rot < 4; rot++) {
    const cells = P.rots[rot], top = Math.min(...cells.map((q) => q[1]));
    for (let x = -P.n; x <= W; x++) {
      let y = -top;
      if (!fits(cells, x, y)) continue;
      while (fits(cells, x, y + 1)) y++;
      const g = Array.from(grid);
      for (const [dx, dy] of cells) g[(y + dy) * W + x + dx] = 1;
      let cleared = 0;
      for (let ry = 0; ry < H; ry++) {
        let n = 0;
        for (let rx = 0; rx < W; rx++) if (g[ry * W + rx]) n++;
        if (n === W) { cleared++; g.copyWithin(W, 0, ry * W); g.fill(0, 0, W); }
      }
      out.push({ rot, x, y, grid: g, cleared });
    }
  }
  return out;
}

// st: { W, H, grid, cur: { id, rot, x, y }, next: { id } (optional) }. Returns the best place to put the sinking
// piece, { rot, x, y, score }, (x, y) being its box corner as in logic.js, or null when there is no piece. It looks
// at the piece and, like a child glancing at the bubble, at the one that comes next.
function plan(L, st) {
  const c = st.cur;
  if (!c) return null;
  const W = st.W, H = st.H;
  const first = placements(L, st.grid, W, H, c.id);
  for (const p of first) p.score = score(p.grid, W, H, p.cleared);
  first.sort((a, b) => b.score - a.score);
  let best = null;
  // the few best places are weighed again with the next piece in mind
  const short = st.next ? first.slice(0, 8) : first;
  for (const p of short) {
    let sc = p.score;
    if (st.next) {
      let b2 = -Infinity;
      for (const q of placements(L, p.grid, W, H, st.next.id)) { const s2 = score(q.grid, W, H, q.cleared); if (s2 > b2) b2 = s2; }
      sc = b2 > -Infinity ? p.cleared * 0.76 + b2 : sc - 50;
    }
    sc -= ((p.rot - c.rot + 4) % 4) * 0.001 + Math.abs(p.x - c.x) * 0.0005;
    if (!best || sc > best.score) best = { rot: p.rot, x: p.x, y: p.y, score: sc, cleared: p.cleared };
  }
  return best;
}

// The next thing a finger should do to get the piece to its target: 'rotate', 'left', 'right' or 'drop'.
function nextAction(cur, target) {
  if (!target) return 'drop';
  if (cur.rot !== target.rot) return 'rotate';
  if (cur.x > target.x) return 'left';
  if (cur.x < target.x) return 'right';
  return 'drop';
}
const stateOf = (g) => ({ W: g.W, H: g.H, grid: g.grid, cur: g.cur, next: g.next });
function act(g, a) {
  if (a === 'rotate') return g.rotate(1);
  if (a === 'left') return g.move(-1);
  if (a === 'right') return g.move(1);
  return g.drop() >= 0;
}

// Plays until the round ends (phase 'goal' or 'over') or `maxPieces` pieces have settled.
// o.think: seconds before the first move on each piece; o.pace: seconds between moves (0 = as fast as it likes);
// o.noDrop: never use drop (let the piece sink by itself); o.sloppy: an rng; with it every piece goes somewhere random.
// Returns { phase, pieces, seconds, maxHeight, waves }.
function autoplay(L, g, o) {
  o = o || {};
  const dt = 1 / 60, think = o.think || 0, pace = o.pace || 0, maxPieces = o.maxPieces || 4000;
  let seconds = 0, maxHeight = 0, target = null, wait = 0, lastPiece = -1, stuck = 0;
  const start = g.pieces;
  while (g.phase !== 'goal' && g.phase !== 'over' && g.pieces - start < maxPieces && seconds < 36000) {
    if (g.phase === 'fall') {
      if (g.pieces !== lastPiece) {
        lastPiece = g.pieces; stuck = 0;
        if (o.sloppy) { const P = L.PIECES[g.cur.id]; target = { rot: Math.floor(o.sloppy() * 4), x: Math.floor(o.sloppy() * (g.W + 1)) - 1 - Math.floor(P.n / 3) }; }
        else target = plan(L, stateOf(g));
        wait = think;
      }
      if (wait <= 0) {
        // as fast as it likes: every move this instant; at a child's pace: one move, then wait
        for (let k = 0; k < 40 && g.phase === 'fall'; k++) {
          let a = nextAction(g.cur, target);
          if (stuck > 3) a = 'drop';
          if (a === 'drop' && o.noDrop) break;
          if (a === 'drop' && g.age < g.M.dropGuard) break;
          if (!act(g, a)) stuck++;
          if (pace > 0) { wait = pace; break; }
        }
      }
    }
    g.tick(dt); seconds += dt; wait -= dt;
    g.events.length = 0;
    const h = g.height();
    if (h > maxHeight) maxHeight = h;
  }
  return { phase: g.phase, pieces: g.pieces - start, seconds, maxHeight, waves: g.waves };
}

module.exports = { score, placements, plan, nextAction, stateOf, act, autoplay };
