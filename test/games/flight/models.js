// Players made of code, for verify.js, browser.js and soak.js. They only ever do what a finger can: put the finger at a height.
//
//   child(L, opts)  A model child. Sees only `look` seconds ahead (1.5 s), decides every `every` seconds and reacts late: the
//                   finger starts moving `late` seconds after the decision. It picks the height that avoids the most trouble in
//                   what it can see and, past that, reaches the most buds. It runs through the real Run.step().
//   idle(L)         A very young child: the finger is never down, or rests at one height. Nothing can be failed, so the chest comes.
//   playRun(L, run, player, opts)  Play a Run to its end with that player; returns what happened.
'use strict';

const DT = 1 / 30;

function child(L, o) {
  o = o || {};
  const look = o.look == null ? 1.5 : o.look, every = o.every == null ? 0.3 : o.every, late = o.late == null ? 0.35 : o.late;
  const grid = [];
  for (let y = L.Y_MIN; y <= L.Y_MAX + 0.1; y += 18) grid.push(y);
  let aim = L.Y_REST, queue = [], nextDecide = 0;
  const st = { decisions: 0 };
  function decide(run) {
    const c = run.c, t0 = run.t, R = run.M.dust * 0.88;
    // what can be seen: the enemies and buds that come within reach of her column during the look-ahead
    const seeE = [], seeP = [];
    for (const e of c.enemies) {
      const q0 = L.enemyAt(c, e, t0);
      if (q0.x < L.PX_NOM - 300 || q0.x > L.PX_NOM + (c.v + e.ve + 120) * look + 400) continue;
      seeE.push(e);
    }
    for (let i = 0; i < c.plants.length; i++) if (run.bloomAt[i] < 0) {
      const p = c.plants[i], q0 = L.plantAt(c, p, t0), q1 = L.plantAt(c, p, t0 + look);
      if (Math.min(q0.x, q1.x) > L.PX_NOM + R + 5 || Math.max(q0.x, q1.x) < L.PX_NOM - R - 5) continue;
      seeP.push(p);
    }
    const seeKey = !run.keyGot;
    let best = null;
    for (const yc of grid) {
      let y = run.y, danger = 0, gain = 0;
      const got = new Set();
      let keyHit = false;
      for (let t = DT; t <= look + 1e-9; t += DT * 2) {
        const tt = t0 + t;
        // her height: still following the old aim until the new one takes hold
        y = L.ease(y, t < late ? aim : yc, DT * 2, L.FOLLOW_Y, L.VY_MAX);
        if (run.shield - t <= 0) for (const e of seeE) {
          const q = L.enemyAt(c, e, tt), dx = q.x - L.PX_NOM, dy = q.y - y, rr = e.r + L.R_I + 8;
          if (dx * dx + dy * dy < rr * rr) danger++;
        }
        for (const p of seeP) {
          if (got.has(p.id)) continue;
          const q = L.plantAt(c, p, tt), dx = q.x - L.PX_NOM, dy = q.y - y;
          if (dx * dx + dy * dy <= R * R) got.add(p.id);
        }
        if (seeKey && !keyHit) { const k = L.keyAt(c, tt), dx = k.x - L.PX_NOM, dy = k.y - y; if (dx * dx + dy * dy <= (L.KEY_R - 8) * (L.KEY_R - 8)) keyHit = true; }
      }
      gain = got.size + (keyHit ? 1 : 0);
      const score = -danger * 1000 + gain * 10 - Math.abs(yc - run.y) * 0.02;
      if (!best || score > best.score) best = { score, y: yc };
    }
    st.decisions++;
    return best ? best.y : aim;
  }
  return {
    name: 'child',
    stats: st,
    // the finger's height now (the Run's own clock decides when to look and when the new aim takes hold)
    finger(run) {
      if (run.phase !== 'fly') return { x: L.PX_NOM, y: aim };
      if (run.t >= nextDecide) { queue.push({ y: decide(run), at: run.t + late }); nextDecide = run.t + every; }
      while (queue.length && run.t >= queue[0].at) aim = queue.shift().y;
      return { x: L.PX_NOM, y: aim };
    },
  };
}

// no finger at all
function idle() { return { name: 'idle', finger() { return null; } }; }
// a finger left at one height
function still(y) { return { name: 'still@' + y, finger() { return { x: 270, y }; } }; }

function playRun(L, run, player, o) {
  o = o || {};
  const dt = o.dt || DT, out = [], max = o.maxSeconds || 400;
  let guard = 0;
  while (!run.done && run.t < max && guard++ < max / dt + 10) run.step(dt, player.finger(run), out);
  const bloom = out.filter((e) => e.type === 'bloom').length;
  return { done: run.done, t: run.t, bonks: run.bonks, bloomed: run.bloomed, bloomEvents: bloom, total: run.total, stars: run.stars, coins: run.coins, coinsLost: run.coinsLost, keyGot: run.keyGot, keyFloat: run.keyFloat, events: out };
}

module.exports = { child, idle, still, playRun, DT };
