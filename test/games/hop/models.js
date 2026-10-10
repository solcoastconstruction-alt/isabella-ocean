// Toadstool Hop: the solver and the model children, shared by verify.js, soak.js and defects.js.
// Everything here uses the game's own web/games/hop/logic.js (or the copy HOP_LOGIC points at).
'use strict';
const path = require('path');
const L = require(process.env.HOP_LOGIC ? path.resolve(process.env.HOP_LOGIC) : path.join(__dirname, '../../../web/games/hop/logic.js'));

const STEP = L.STEP, D = L.D, SETTLE = L.SETTLE;
const HORIZON = 60;   // she never needs to wait longer than this for one hop

// A splash-free way through a course, found by an earliest-arrival search. Waiting on a platform costs nothing and she rides
// it, so standing on a platform at time t means she can stand there at any later time: the earliest arrival is all that matters.
// Taps are tried on a grid of 50 ms. opts.far: take the far platform of every choice (to prove the bonus ones can be reached).
// opts.margin: how much room the reach must have (1 unit keeps a replay safe from rounding).
function solve(c, opts) {
  opts = opts || {};
  const margin = opts.margin == null ? 1 : opts.margin;
  const taps = [], got = { coins: 0, bonus: 0, bf: 0, key: false };
  let t = 0, at = c.plats[c.nodes[0].main];
  const fails = [];
  for (let k = 0; k + 1 < c.nodes.length; k++) {
    const nd = c.nodes[k + 1];
    const b = c.plats[opts.far && nd.far >= 0 ? nd.far : nd.main];
    const bfs = (opts.far && nd.far >= 0) || !opts.collect ? [] : c.bfs.filter((f) => f.node === k).map((f) => ({ f, i: c.bfs.indexOf(f) }));
    let found = null;
    for (let tt = Math.round((t + SETTLE) / STEP) * STEP; tt < t + SETTLE + HORIZON; tt = Math.round((tt + STEP) / STEP) * STEP) {
      const h = L.hopEval(c, at, b, tt);
      if (!h.ok || h.slack < margin) continue;
      if (bfs.length && !bfs.every((q) => L.arcNear(h, q.f.x, q.f.y) <= q.f.r - margin)) continue;
      found = { tt, h }; break;
    }
    if (!found) { fails.push({ node: k + 1, from: at.id, to: b.id, why: bfs.length ? 'no tap reaches it and passes the butterfly' : 'no tap reaches it' }); return { ok: false, fails, taps, got, end: t }; }
    taps.push({ t: found.tt, side: opts.far && nd.far >= 0 ? 1 : -1, node: k + 1 });
    t = found.tt + D; at = b;
    if (b.coin) got.coins++;
    if (b.bonus) got.bonus++;
    if (b.key) got.key = true;
    got.bf += bfs.length;
  }
  return { ok: true, fails, taps, got, end: t };
}

// Replay taps through the real Run: step in 50 ms ticks and tap at the planned times.
function replay(c, taps, mode, n) {
  const run = new L.Run(n, mode), events = [];
  for (const tp of taps) {
    while (run.t < tp.t - 1e-9) run.step(Math.min(STEP, tp.t - run.t), events);
    run.tap(tp.side, events);
  }
  let guard = 0;
  while (!run.done && guard++ < 4000) run.step(STEP, events);
  return { run, events };
}

// Run a model child through the real game rules until the chest opens. kind: 'careful' | 'impulsive' | 'random' | 'toddler'
// careful: waits until a tap would work for the next 0.3 s, then taps 0.3 s later (a 300 ms reaction).
// impulsive: waits until a tap would work right now, then taps 0.3 s later (so it can splash).
// random: taps at random moments a second or two apart. toddler: taps every 1.5-4 s whatever is going on.
function child(n, mode, kind, seed, o) {
  o = o || {};
  const run = new L.Run(n, mode), events = [];
  const R = L.mulberry32(seed || 1);
  const dt = 1 / 30, react = o.react == null ? 0.3 : o.react, limit = o.limit || 1500;
  let pending = null, nextRandom = 0.5 + R() * 2, taps = 0;
  const side = () => (o.far ? 1 : -1);
  while (!run.done && run.t < limit) {
    if (run.phase === 'stand') {
      if (pending == null) {
        if (kind === 'careful' && L.safeFor(run, side(), react)) pending = run.t + react;
        else if (kind === 'impulsive') { const p = run.predict(side()); if (p && p.ok) pending = run.t + react; }
        else if ((kind === 'random' || kind === 'toddler') && run.t >= nextRandom) {
          pending = run.t + 0.05; nextRandom = run.t + (kind === 'random' ? 0.4 + R() * 2.2 : 1.5 + R() * 2.5);
        }
      }
      if (pending != null && run.t >= pending - 1e-9) {
        pending = null;
        if (run.tap(side(), events)) taps++;
      }
    } else pending = null;
    run.step(dt, events);
  }
  return { run, events, taps, done: run.done, time: run.t };
}

// the open windows of a hop a -> b: the length of every run of taps that work (over a minute, every 50 ms) and of every run that does not
function windows(c, a, b) {
  const open = [], closed = [];
  let cur = null, len = 0;
  const flush = () => { if (cur !== null) (cur ? open : closed).push(len * STEP); };
  for (let tt = 0; tt < L.SCAN; tt += STEP) {
    const ok = L.hopEval(c, a, b, tt).ok;
    if (ok === cur) len++; else { flush(); cur = ok; len = 1; }
  }
  flush();
  // runs touching the ends of the minute are cut short, so leave them out of the extremes
  return { open: open.slice(1, -1), closed: closed.slice(1, -1), openAll: open, closedAll: closed };
}

module.exports = { L, solve, replay, child, windows, HORIZON };
