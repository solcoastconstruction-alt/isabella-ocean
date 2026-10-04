// Sea Catch: model players and a planner, for verify.js. They play through the real Run.step() in logic.js.
// A model sees a falling thing only `reaction` seconds after it appears, moves its finger at a limited speed,
// and aims a little off. Isabella then eases toward the finger exactly as she does on the phone.
'use strict';

// what a model does: 'catch' (go for friends, keep clear of grumps), 'avoid' (only keep clear of grumps),
// 'all' (a very young player: goes for whatever is nearest the shell, grump or not)
function makePlayer(L, o) {
  const P = Object.assign({ mode: 'catch', reaction: 0.5, speed: 650, aim: 20, lapse: 0, seed: 1, margin: 34 }, o);
  const rng = L.mulberry32(P.seed >>> 0 || 1), notes = new Map();
  let finger = null;
  const note = (it) => {
    let n = notes.get(it.id);
    if (!n) { n = { err: (rng() * 2 - 1) * P.aim, skip: rng() < P.lapse }; notes.set(it.id, n); if (notes.size > 400) notes.delete(notes.keys().next().value); }
    return n;
  };
  // the grump's x while it passes the shell's height (it may be sliding or zig-zagging)
  const span = (g) => {
    const z = L.GRUMP_ZONE, a = g.tc - z.up / g.vy, b = g.tc + z.down / g.vy;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k <= 4; k++) { const x = L.itemX(g, a + ((b - a) * k) / 4); if (x < lo) lo = x; if (x > hi) hi = x; }
    return { lo: lo - z.hw - P.margin, hi: hi + z.hw + P.margin, tin: a, tout: b };
  };
  return {
    params: P,
    // the finger's x for this step
    act(run, dt) {
      const t = run.t, lo = L.PX_MIN, hi = run.vw - L.PX_MIN;
      if (finger == null) finger = run.px;
      const seen = run.items.filter((it) => !it.past && it.t0 <= t - P.reaction);
      const dangers = P.mode === 'all' ? [] : seen.filter((it) => it.grumpy).map(span).filter((s) => s.tin - t < 1.6);
      const safe = (x) => dangers.every((s) => x < s.lo || x > s.hi);
      // the nearest safe place to x
      const nearestSafe = (x) => {
        if (safe(x)) return x;
        for (let d = 8; d < run.vw; d += 8) {
          if (x - d >= lo && safe(x - d)) return x - d;
          if (x + d <= hi && safe(x + d)) return x + d;
        }
        return x;
      };
      let goal = null;
      if (P.mode !== 'avoid') {
        const wanted = seen.filter((it) => (P.mode === 'all' || !it.grumpy) && !note(it).skip).sort((a, b) => a.tc - b.tc);
        for (const f of wanted) {
          const z = L.zoneOf(f), left = f.tc + (z.down * 0.4) / f.vy - t;
          let x = Math.min(hi, Math.max(lo, f.xc + note(f).err));
          if (!safe(x)) {
            // catch it from the side away from the grump, if the shell still reaches
            const alt = nearestSafe(x);
            if (Math.abs(alt - f.xc) > z.hw - 22) continue;
            x = alt;
          }
          if (Math.abs(x - run.px) - (z.hw - 30) > P.speed * Math.max(0, left - 0.1)) continue;   // too far to get there
          goal = x; break;
        }
      }
      if (goal == null) goal = nearestSafe(finger);
      // never swim through a grump that is at the shell's height (or about to be): wait on this side of it
      for (const s of dangers) {
        if (s.tin - t > 0.5) continue;
        const from = run.px;
        if (from <= s.lo && goal > s.lo) goal = Math.max(lo, s.lo - 4);
        else if (from >= s.hi && goal < s.hi) goal = Math.min(hi, s.hi + 4);
        else if (from > s.lo && from < s.hi) goal = from - s.lo < s.hi - from && s.lo - 4 >= lo ? s.lo - 4 : Math.min(hi, s.hi + 4);
      }
      const step = P.speed * dt;
      finger += Math.max(-step, Math.min(step, goal - finger));
      return finger;
    },
  };
}

// Play one level to its chest (or until `maxT` seconds). Returns what happened.
function play(L, level, o) {
  const vw = o.vw || 1200, run = new L.Run(level, null, { vw, seed: o.seed }), player = makePlayer(L, Object.assign({ seed: o.seed * 7 + 3 }, o.player));
  const dt = 1 / 60, out = [], maxT = o.maxT || 600;
  let friends = 0, grumps = 0, golds = 0, minCoins = 0, lost = 0;
  while (!run.done && run.t < maxT) {
    out.length = 0;
    run.step(dt, player.act(run, dt), out);
    for (const e of out) {
      if (e.type === 'spawn') { if (e.item.grumpy) grumps++; else if (e.item.gold) golds++; else friends++; }
      if (e.type === 'bonk' && e.coinLost) lost++;
    }
    if (run.coins < minCoins) minCoins = run.coins;
  }
  return { done: run.done, t: run.t, coins: run.coins, catches: run.catches, golds: run.golds, bonks: run.bonks, misses: run.misses, stars: run.stars,
    friends, grumps, goldsSeen: golds, lost, minCoins, postponed: run.spawner.postponed };
}

// The whole plan of a level for `seconds`: everything that will fall, with nobody playing (no bonks).
function plan(L, level, vw, seed, seconds) {
  const sp = new L.Spawner(level, vw, seed), items = [];
  for (let t = 0; t <= seconds; t += 1 / 60) { let it; while ((it = sp.next(t, 0))) items.push(it); }
  return { items, postponed: sp.postponed };
}

// A sweep over (time, place): where could the shell be at each moment without ever having been bonked, moving
// at most `speed` units a second and keeping `margin` clear of every grump? And which friends can be caught on
// such a path (with a bonk-free way on afterwards)? Places are cells `cell` units wide.
function sweep(L, items, vw, o) {
  const speed = o.speed, margin = o.margin, cell = o.cell || 4, dt = 1 / 30, T = o.seconds;
  const lo = L.PX_MIN, n = Math.floor((vw - 2 * L.PX_MIN) / cell) + 1, steps = Math.ceil(T / dt), reach = Math.max(1, Math.floor((speed * dt) / cell));
  const xOf = (c) => lo + c * cell;
  const grumps = items.filter((it) => it.grumpy), friends = items.filter((it) => !it.grumpy);
  const gz = L.GRUMP_ZONE, fz = L.FRIEND_ZONE;
  // danger[k]: the cells a grump could bonk at time k * dt
  const blocked = (k) => {
    const t = k * dt, b = new Uint8Array(n);
    for (const g of grumps) {
      const dy = L.itemY(g, t) - L.CATCH_Y;
      if (dy < -gz.up - margin || dy > gz.down + margin) continue;
      const x = L.itemX(g, t), a = Math.max(0, Math.ceil((x - gz.hw - margin - lo) / cell)), z = Math.min(n - 1, Math.floor((x + gz.hw + margin - lo) / cell));
      for (let c = a; c <= z; c++) b[c] = 1;
    }
    return b;
  };
  const dilate = (src, block) => {
    const dst = new Uint8Array(n);
    let last = -1e9;
    for (let c = 0; c < n; c++) { if (src[c]) last = c; if (c - last <= reach) dst[c] = 1; }
    last = 1e9;
    for (let c = n - 1; c >= 0; c--) { if (src[c]) last = c; if (last - c <= reach) dst[c] = 1; }
    for (let c = 0; c < n; c++) if (block[c]) dst[c] = 0;
    return dst;
  };
  const B = [], F = [];
  for (let k = 0; k <= steps; k++) B.push(blocked(k));
  let cur = new Uint8Array(n); cur[Math.floor(n / 2)] = 1;   // she starts in the middle
  let trappedAt = null, narrowest = n;
  for (let k = 0; k <= steps; k++) {
    if (k > 0) cur = dilate(cur, B[k]);
    F.push(cur);
    let free = 0; for (let c = 0; c < n; c++) free += cur[c];
    if (k > 30 && free < narrowest) narrowest = free;
    if (!free && trappedAt == null) trappedAt = k * dt;
  }
  // backwards: the cells from which a bonk-free way on exists
  const V = new Array(steps + 1);
  let v = new Uint8Array(n).fill(1);
  for (let c = 0; c < n; c++) if (B[steps][c]) v[c] = 0;
  V[steps] = v;
  for (let k = steps - 1; k >= 0; k--) { v = dilate(v, B[k]); V[k] = v; }
  // each friend: is there a moment in its catch window when a reachable, bonk-free cell holds the shell under it?
  let clean = 0, checked = 0;
  const poisoned = [];
  for (const f of friends) {
    const a = f.tc - fz.up / f.vy, b = f.tc + fz.down / f.vy;
    if (b > T - 1 || a < 1) continue;   // only friends that fall wholly inside the sweep
    checked++;
    let ok = false;
    for (let k = Math.ceil(a / dt); k <= Math.floor(b / dt) && !ok; k++) {
      const x = L.itemX(f, k * dt), c0 = Math.max(0, Math.ceil((x - (fz.hw - o.friendMargin) - lo) / cell)), c1 = Math.min(n - 1, Math.floor((x + (fz.hw - o.friendMargin) - lo) / cell));
      for (let c = c0; c <= c1; c++) if (F[k][c] && V[k][c]) { ok = true; break; }
    }
    if (ok) clean++; else poisoned.push({ id: f.id, kind: f.kind, tc: +f.tc.toFixed(2), xc: Math.round(f.xc) });
  }
  return { trappedAt, narrowest: narrowest * cell, friends: checked, clean, poisoned, grumps: grumps.length, xOf };
}

module.exports = { makePlayer, play, plan, sweep };
