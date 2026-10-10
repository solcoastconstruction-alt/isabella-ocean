// The measuring stick for Rainbow Slide's courses, shared by verify.js and tune.js (no browser).
//   sweep(): is there a clean line down the ribbon? A sweep over (distance, sideways position) at the course's
//            speed, never needing more than 60% of her sideways speed, touching nothing with `pad` to spare and
//            never closer to the rim than the rail.
//   measure(): everything about one course in one mode: the sweeps (at several moments of the course's clock where
//            clouds drift, and from every rainbow arch she might be floated back to), the coins and the key on a
//            clean line, the model child's slide, and the difficulty score.
'use strict';
const DS = 8, CELL = 4;
const PHASES = []; for (let t0 = 0; t0 <= 24; t0 += 1.5) PHASES.push(t0);

function make(L, P, P2) {
  const geom = (lev) => {
    const XC = lev.hw - L.EDGE - 4, NX = Math.floor((2 * XC) / CELL) + 1;
    return { XC, NX, xOf: (j) => -XC + j * CELL, jOf: (x) => Math.max(0, Math.min(NX - 1, Math.round((x + XC) / CELL))) };
  };
  // One pass down the ribbon at constant speed v, starting at distance s0 (from the lane there), with the course's
  // clock at tc when she starts. Returns { ok, failAt, open (mean share of the width she could be in), tight (share
  // of the course where that is under 300 units), narrow (the least width), F, B (forward / backward reachability, if keep) }.
  function sweep(lev, v, tc, pad, keep, s0) {
    const g = geom(lev), NX = g.NX, k0 = Math.floor((s0 || 0) / DS), steps = Math.ceil(lev.len / DS);
    const m = Math.floor((0.6 * L.VU_MAX * (DS / v)) / CELL);
    const blk = new Uint8Array((steps + 1) * NX), F = new Uint8Array((steps + 1) * NX);
    for (let k = k0; k <= steps; k++) {
      const s = k * DS, t = tc + ((k - k0) * DS) / v, list = lev.buckets[Math.floor(s / 200)];
      if (!list) continue;
      for (const o of list) {
        if (Math.abs(o.s - s) > o.r + 60 + pad) continue;
        const ox = L.obsX(o, t), w = L.halfWidth(o) + L.BODY_R + pad + CELL, ja = g.jOf(ox - w), jb = g.jOf(ox + w);
        for (let j = ja; j <= jb; j++) {
          if (blk[k * NX + j]) continue;
          const x = g.xOf(j);
          if (L.touches(o, t, s + L.BODY[0][0], x, L.BODY[0][1] + pad) || L.touches(o, t, s + L.BODY[1][0], x, L.BODY[1][1] + pad)) blk[k * NX + j] = 1;
        }
      }
    }
    const jl = g.jOf(s0 ? L.laneAt(lev, s0) : 0);
    let seeded = 0;
    for (let j = jl - 2; j <= jl + 2; j++) if (j >= 0 && j < NX && !blk[k0 * NX + j]) { F[k0 * NX + j] = 1; seeded++; }
    if (!seeded) return { ok: false, failAt: s0 || 0, t: tc };
    let sum = 0, tight = 0, narrow = Infinity, narrowAt = 0, counted = 0;
    for (let k = k0 + 1; k <= steps; k++) {
      const base = k * NX, prev = base - NX;
      let open = 0;
      for (let j = 0; j < NX; j++) {
        if (blk[base + j]) continue;
        let from = false;
        for (let q = Math.max(0, j - m); q <= Math.min(NX - 1, j + m) && !from; q++) if (F[prev + q]) from = true;
        if (from) { F[base + j] = 1; open++; }
      }
      if (!open) return { ok: false, failAt: k * DS, t: tc + ((k - k0) * DS) / v };
      if (k * DS < 1400) continue;   // (she starts in the middle of clear sky: measure from where the course begins)
      counted++; sum += open / NX;
      if (open * CELL < 300) tight++;
      if (open * CELL < narrow) { narrow = open * CELL; narrowAt = k * DS; }
    }
    const res = { ok: true, open: counted ? sum / counted : 1, tight: counted ? tight / counted : 0, narrow, narrowAt, steps, m, NX, k0 };
    if (keep) {
      const B = new Uint8Array((steps + 1) * NX);
      for (let j = 0; j < NX; j++) if (!blk[steps * NX + j]) B[steps * NX + j] = 1;
      for (let k = steps - 1; k >= k0; k--) {
        const base = k * NX, next = base + NX;
        for (let j = 0; j < NX; j++) {
          if (blk[base + j]) continue;
          for (let q = Math.max(0, j - m); q <= Math.min(NX - 1, j + m); q++) if (B[next + q]) { B[base + j] = 1; break; }
        }
      }
      res.F = F; res.B = B;
    }
    return res;
  }
  // Is this point (a coin, the key) on a clean line (reachable from the start, and the finish reachable from it)?
  function onLine(lev, sw, c) {
    const g = geom(lev), k = Math.max(0, Math.min(sw.steps, Math.round(c.s / DS)));
    for (let j = g.jOf(c.x - 30); j <= g.jOf(c.x + 30); j++) if (sw.F[k * sw.NX + j] && sw.B[k * sw.NX + j]) return true;
    return false;
  }
  // how much room she has beside the clouds along the lane: from the lane to the near edge of each, on average
  function roomOf(lev) {
    let sum = 0, cnt = 0;
    for (const o of lev.obs) {
      if (o.extra) continue;
      const d = Math.abs(o.x - L.laneAt(lev, o.s)) - L.halfWidth(o) - (o.amp || 0);
      if (d > 260) continue;   // (the far end of a row of clouds: not beside her)
      sum += Math.max(0, d); cnt++;
    }
    return cnt ? sum / cnt : 200;
  }
  // Difficulty: one number per course and mode. How much of the width is closed to her, how much of the course is
  // tight, how hard the model child has to work the steering, how often a cloud is beside her and how close it sits,
  // the clouds that move, the speed she slides at (how little time there is to think) and how narrow the ribbon is.
  function difficulty(m) {
    return Math.round(150 * (1 - m.open) + 100 * m.tight + 1.2 * m.work + 4 * m.rate + 2 * m.movers + 0.5 * (200 - m.room) + 0.25 * m.speed + 0.15 * (600 - 2 * m.hw));
  }

  function measure(n, modeId, seed) {
    const lev = L.build(n, modeId, seed), out = { n, modeId, lev, problems: [] };
    const bad = (w, d) => out.problems.push(w + (d != null ? ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)) : ''));
    const movers = lev.obs.filter((o) => o.amp);
    out.movers = movers.length;
    const v = lev.speed, phases = movers.length ? PHASES : [0], speeds = movers.length ? [v, v * 0.7] : [v];
    const pts = lev.coins.concat([lev.key]);
    // a clean line at the course's speed (and, where clouds drift, a slower one), whenever she arrives; and every coin and the key on one
    for (const vv of speeds) {
      for (const tc of phases) {
        const sw = sweep(lev, vv, tc, 8, true, 0);
        if (!sw.ok) { bad(`no clean line at speed ${Math.round(vv)} (clock +${tc}s): blocked at ${sw.failAt}`); continue; }
        if (vv === v && tc === 0) { out.open = sw.open; out.tight = sw.tight; out.narrow = sw.narrow; out.narrowAt = sw.narrowAt; }
        const lost = pts.filter((c) => !onLine(lev, sw, c));
        if (lost.length) bad(`${lost.length} coin(s) or the key not on a clean line at speed ${Math.round(vv)} (clock +${tc}s)`, lost.slice(0, 3));
      }
    }
    // from every rainbow arch: floated back there at any moment, a clean line still runs on to the end
    for (const a of lev.arches) {
      for (const tc of phases) {
        const sw = sweep(lev, v, tc, 8, false, a);
        if (!sw.ok) bad(`no clean line from the arch at ${a} (clock +${tc}s): blocked at ${sw.failAt}`);
      }
    }
    // the model child, through the real Run.step()
    const r = {};
    r.child = P.slide(n, modeId, 'child', 1, seed);
    r.laggy = P2.slide(n, modeId, 'child', 2, seed);   // a slower child: reacts later, looks less far ahead, turns the steering more slowly
    r.random = P.slide(n, modeId, 'random', 3, seed);
    out.runs = r;
    out.room = roomOf(lev);
    out.work = r.child.travel / (r.child.total || 1);
    out.rate = (lev.obs.filter((o) => !o.extra).length / lev.len) * 1000;
    out.speed = v; out.hw = lev.hw;
    out.score = difficulty(out);
    return out;
  }
  return { sweep, onLine, roomOf, difficulty, measure, geom, DS, CELL, PHASES };
}
module.exports = { make, DS, CELL, PHASES };
