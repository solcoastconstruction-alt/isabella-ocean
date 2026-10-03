// Coral Maze: a rough model of a quick young player, to estimate how long a level takes her. Not a proof of anything;
// verify.js prints its estimates next to each level.
//
// She knows only what she has seen: the screenful of maze round her (about 14 x 6 tunnels at the Hard size; the
// whole maze in Easy, where it fits the screen), or in dark water only the tunnels her light has reached (plus
// what glows: keys, the way out). She never swims into a dead end she can see. At every rest she picks a target:
// the way out if she knows a way there; else the gate of a key she carries; else a key she has seen; else the
// nearest edge of the unknown, leaning toward the right (the way out is always on the right). She swims there
// glide by glide on the tunnels she knows (a locked gate is a wall; a current is one-way), looking again after
// every glide. Before a glide she waits, if she must, until the patrols are out of her way.
//
// time = glides x (KNOW when she knows where she is going, LOOK when she is exploring) + ticks swum or waited x
//        the tick (0.13-0.21 s, from the tunnel size, as game.js does)
'use strict';
const L = require('../../../web/games/maze/logic.js');

const KNOW = 1.0;      // seconds to swipe, per glide, on a way she knows
const LOOK = 2.0;      // ...and while exploring: looking round the screen, choosing
const LEAN = 0.6;      // how much she prefers unexplored places further right (cells of detour per column)

function play(lv, opts) {
  opts = opts || {};
  const W = lv.W, H = lv.H, N = lv.N, hard = lv.mode === 'hard';
  const VX = opts.vx || (hard ? 7 : W), VY = opts.vy || (hard ? 3 : H);   // half a screen of tunnels each way
  const known = new Uint8Array(N), st = L.newState(lv);
  const cellC = hard ? L.HARD_CELL : Math.min(913 / (W + 0.84), 488 / (H + 0.84), 118);
  const tick = Math.min(0.21, Math.max(0.13, cellC / 470));
  let glides = 0, ticks = 0, waited = 0, touches = 0, dodges = 0, trace = null, think = 0, exploring = 0;
  const been = new Map();
  const look = (cell) => {
    const x = cell % W, y = Math.floor(cell / W);
    if (lv.dark) {
      const r = lv.dark - 0.35;
      for (let i = 0; i < N; i++) if ((i % W - x) ** 2 + (Math.floor(i / W) - y) ** 2 <= r * r) known[i] = 1;
      return;
    }
    const x0 = Math.max(0, Math.min(x - VX, W - 2 * VX - 1)), y0 = Math.max(0, Math.min(y - VY, H - 2 * VY - 1));
    for (let yy = Math.max(0, y0); yy <= Math.min(H - 1, y0 + 2 * VY); yy++) for (let xx = Math.max(0, x0); xx <= Math.min(W - 1, x0 + 2 * VX); xx++) known[yy * W + xx] = 1;
  };
  // what glows shows from anywhere on her screen, even in the dark
  const onScreen = (cell) => { const dx = Math.abs(cell % W - st.cell % W), dy = Math.abs(Math.floor(cell / W) - Math.floor(st.cell / W)); return dx <= VX + 1 && dy <= VY + 1; };
  const glowSeen = new Uint8Array(N);
  const lookGlow = () => {
    for (const k of lv.keys) if (onScreen(k.cell)) glowSeen[k.cell] = 1;
    if (onScreen(lv.exit)) glowSeen[lv.exit] = 1;
  };
  // the tunnels she knows, from where she is: cells by distance, and the first direction to each
  const route = () => {
    const dist = new Int32Array(N + 1).fill(-1), first = new Int8Array(N + 1).fill(-1), q = [st.cell];
    dist[st.cell] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (c === N) continue;
      const forced = lv.cur[c];
      for (let d = 0; d < 4; d++) {
        if (forced >= 0 && c !== st.cell && d !== forced) continue;
        if (!L.canPass(lv, st, c, d)) continue;
        const m = lv.nx[c * 4 + d];
        if (m < N && !known[m] && !glowSeen[m]) continue;
        if (dist[m] >= 0) continue;
        dist[m] = dist[c] + 1; first[m] = c === st.cell ? d : first[c]; q.push(m);
      }
    }
    return { dist, first };
  };
  const target = (r) => {
    if (r.dist[N] >= 0) return N;
    for (let k = 0; k < lv.keys.length; k++) {
      if (st.items[k] !== L.HELD) continue;
      const g = lv.gates[k];
      for (const c of [g.a, g.b]) if (r.dist[c] >= 0) { const other = c === g.a ? g.b : g.a; if (r.dist[other] < 0 || r.dist[other] > r.dist[c]) return { through: k, cell: c, other }; }
    }
    let best = -1, bs = Infinity;
    for (let k = 0; k < lv.keys.length; k++) {
      const c = lv.keys[k].cell;
      if (st.items[k] === L.FLOOR && r.dist[c] >= 0 && r.dist[c] < bs) { bs = r.dist[c]; best = c; }
    }
    if (best >= 0) return best;
    for (let c = 0; c < N; c++) {
      if (r.dist[c] < 0) continue;
      let frontier = false;
      for (let d = 0; d < 4 && !frontier; d++) { if (!(lv.open[c] & (1 << d))) continue; const m = lv.nx[c * 4 + d]; if (m < N && !known[m]) frontier = true; }
      if (!frontier) continue;
      const score = r.dist[c] - LEAN * (c % W);
      if (score < bs) { bs = score; best = c; }
    }
    return best;
  };
  look(st.cell); lookGlow();
  const glideCells = { ticks: 0, cells: [] };
  for (let guard = 0; guard < (opts.maxGlides || 5000) && !st.won; guard++) {
    const r = route();
    let t = target(r), dir = -1;
    if (t === -1) return { stuck: true, reason: 'nowhere to go', cell: st.cell, items: Array.from(st.items), glides, seconds: Infinity };
    if (typeof t === 'object') {
      if (st.cell === t.cell) dir = L.OPP.findIndex((_, d) => L.canPass(lv, st, st.cell, d) && lv.nx[st.cell * 4 + d] === t.other);
      else dir = r.first[t.cell];
    } else dir = r.first[t];
    if (dir < 0) return { stuck: true, reason: 'no first move', cell: st.cell, items: Array.from(st.items), glides, seconds: Infinity };
    // back here again with nothing new learnt (a patrol or a current keeps undoing her plan)? she works it out, as
    // the solver does (or as the hint would show her): its next glide, at its time
    let known_ = 0;
    for (let c = 0; c < N; c++) known_ += known[c];
    const here = st.cell + ':' + Array.from(st.items).join('') + ':' + known_;
    const again = (been.get(here) || 0) + 1;
    been.set(here, again);
    let figured = again > 2;
    // wait for the patrols to be out of her way (up to two of their round trips); if that never comes (one
    // keeps turning back in front of her), she works out the dodge in the same way
    if (lv.patrols.length && !figured) {
      const most = 2 * Math.max(...lv.patrols.map((p) => 2 * p.maxP));
      let safe = false;
      for (let w = 0; w <= most && !safe; w++) {
        const g = L.cloneState(lv, st);
        if (L.glide(lv, g, dir, -1, null) !== 1) { safe = true; break; }
        if (w < most) { L.step(lv, st, -1, -1, null); waited++; }
      }
      if (!safe) figured = true;
    }
    if (figured) {
      const sol = L.solve(lv, st, 0);
      if (!sol || !sol.steps.length) return { stuck: true, reason: 'no way out from here', cell: st.cell, items: Array.from(st.items), glides, seconds: Infinity };
      for (let w = 0; w < sol.steps[0].at; w++) { L.step(lv, st, -1, -1, null); waited++; }
      dir = sol.steps[0].dir;
      dodges++;
    }
    glideCells.ticks = 0; glideCells.cells.length = 0;
    if (opts.trace) (trace || (trace = [])).push(`${st.cell}:${L.DIRS[dir][0]}>${typeof t === 'object' ? 'g' + t.through : t}`);
    const res = L.glide(lv, st, dir, -1, glideCells);
    const looking = t !== N && typeof t !== 'object' && lv.keyAt[t] < 0;
    glides++; ticks += glideCells.ticks; think += looking ? LOOK : KNOW; if (looking) exploring++;
    if (res === 1) touches++;
    for (const c of glideCells.cells) if (c < N) look(c);
    look(st.cell); lookGlow();
  }
  return { won: st.won, trace, glides, ticks, waited, touches, dodges, exploring, seconds: Math.round(think + (ticks + waited) * tick) };
}

module.exports = { play, KNOW, LOOK };
