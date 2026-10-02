// Proves every level can be finished, and measures how tight each one is.
// Sweeps level time t with Isabella at a fixed screen x and asks: is there ALWAYS
// a y she could have swum to (at 60% of her top speed) without touching anything?
// "slack"  = how many extra units of body padding the level still allows (bigger = easier).
// "narrow" = the thinnest band of reachable water at any moment.
// "tight%" = share of the level where the reachable band is under 160 units (bigger = harder).
// Then plays each level with an autopilot through the real Game.step() to the chest.
const C = require('../web/core.js');
const crypto = require('crypto');

const DT = 1 / 60, CELL = 4;
const ys = []; for (let y = C.TOP; y <= C.FLOOR; y += CELL) ys.push(y);

// Levels 1-10 as she first played them (1 Oct 2026). They must never change under her stars.
const WORLD1 = ['97ae87b6c186', 'ea3e7bf050aa', '3d88d5c1d90a', 'b445a78a0a22', 'a44fc4ebba05', 'a4d18b6ae98f', '93ba0449a85f', 'a829122dfce6', '23f3debb8df4', 'd102c9403d3e'];
const fingerprint = (l) => crypto.createHash('sha1').update(JSON.stringify([l.obs, l.coins, l.hearts, l.key, l.cps, l.chestX])).digest('hex').slice(0, 12);

function sweep(lev, sx, inflate, keepPath) {
  const speed = lev.cfg.speed, T = (lev.len + 400 - sx) / speed;
  const steps = Math.ceil(T / DT), maxMove = Math.max(1, Math.floor((C.SWIM * 0.6 * DT) / CELL));
  let reach = ys.map((y) => !C.hitTest(lev, 0, sx, y, inflate));
  const parents = keepPath ? [] : null;
  let minOpen = Infinity, minAt = 0, tight = 0;
  for (let s = 1; s <= steps; s++) {
    const t = s * DT, px = speed * t + sx;
    const next = new Array(ys.length).fill(false), par = keepPath ? new Int16Array(ys.length).fill(-1) : null;
    let open = 0;
    for (let i = 0; i < ys.length; i++) {
      let from = -1;
      for (let j = Math.max(0, i - maxMove); j <= Math.min(ys.length - 1, i + maxMove); j++) if (reach[j]) { from = j; if (j === i) break; }
      if (from < 0) continue;
      if (C.hitTest(lev, t, px, ys[i], inflate)) continue;
      next[i] = true; open++; if (par) par[i] = from;
    }
    if (par) parents.push(par);
    if (open < minOpen) { minOpen = open; minAt = px; }
    if (open * CELL < 160) tight++;
    if (!open) return { ok: false, failAt: px, t };
    reach = next;
  }
  let path = null;
  if (keepPath) {
    // prefer ending near the middle, then walk parents back
    let i = reach.reduce((b, v, k) => (v && (b < 0 || Math.abs(ys[k] - 270) < Math.abs(ys[b] - 270)) ? k : b), -1);
    path = new Array(parents.length + 1);
    for (let s = parents.length - 1; s >= 0; s--) { path[s + 1] = ys[i]; i = parents[s][i]; }
    path[0] = ys[i];
  }
  return { ok: true, minOpen, minAt, tight: tight / steps, path };
}

function slack(lev, sx) {
  let lo = 0, hi = 80;
  if (!sweep(lev, sx, 0).ok) return -1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sweep(lev, sx, m).ok) lo = m; else hi = m; }
  return lo;
}

// Drive the real Game along a planned path (padding 8 so steering lag never clips anything).
function drive(g, plan, untilFn, maxSecs) {
  let frames = 0;
  while (!untilFn(g) && frames < 60 * maxSecs) {
    const s = Math.min(plan.path.length - 1, Math.round(g.t / DT) + 6);
    const stopped = g.cam >= g.camStop - 1;
    const target = !stopped ? { x: C.START_X, y: plan.path[s] }
      : !g.hasKey ? { x: g.keyX - g.cam, y: g.keyY } : { x: g.lev.chestX - g.cam, y: C.SAND - 60 };
    g.step(DT, target);
    frames++;
  }
  return frames;
}
function autopilot(n) {
  const g = new C.Game(n, 1200);
  const plan = sweep(g.lev, C.START_X, 8, true);
  if (!plan.ok) return { ok: false, why: 'no padded path' };
  const frames = drive(g, plan, (q) => q.state === 'win', 400);
  return { ok: g.state === 'win', bumps: g.bumps, respawns: g.respawns, coins: `${g.coinCount}/${g.lev.coins.length}`, secs: (frames * DT).toFixed(1) };
}

let fail = 0;
const N = C.LEVELS.length;
for (let n = 1; n <= 10; n++) {
  const fp = fingerprint(C.buildLevel(n));
  if (fp !== WORLD1[n - 1]) { fail++; console.log(`LEVEL ${n} CHANGED (${fp} != ${WORLD1[n - 1]}) — her world-1 levels must stay as she learned them`); }
}
console.log('lvl name               speed   len  secs  obst coins slack@210 slack@520 narrow tight%  autopilot');
for (let n = 1; n <= N; n++) {
  const lev = C.buildLevel(n);
  const kinds = {}; for (const o of lev.obs) kinds[o.k] = (kinds[o.k] || 0) + 1;
  const s1 = slack(lev, 210), s2 = slack(lev, 520), base = sweep(lev, 210, 0);
  const ap = autopilot(n);
  if (s1 < 6 || s2 < 6 || !ap.ok) fail++;
  console.log(
    String(n).padStart(3), lev.cfg.name.padEnd(17), String(lev.cfg.speed).padStart(6), String(lev.len).padStart(6),
    String(Math.round(lev.len / lev.cfg.speed)).padStart(5), String(lev.obs.length).padStart(5), String(lev.coins.length).padStart(5),
    String(s1).padStart(9), String(s2).padStart(9), String(base.ok ? base.minOpen * CELL : -1).padStart(6),
    (base.ok ? (base.tight * 100).toFixed(1) : '-').padStart(6),
    ap.ok ? ` WIN ${ap.secs}s bumps=${ap.bumps} coins=${ap.coins}` : ` FAIL ${ap.why || ''}`,
  );
  console.log('      ', JSON.stringify(kinds));
}

// The "missed key" path: never touch the key, and it must keep coming back until the chest.
for (const n of [1, 13]) {
  const g = new C.Game(n, 1200); let backs = 0, frames = 0;
  const plan = sweep(g.lev, C.START_X, 8, true);
  if (!plan.ok) { fail++; console.log(`missed-key path, level ${n}: no padded path`); continue; }
  while (g.state !== 'win' && frames < 60 * 200) {
    const s = Math.min(plan.path.length - 1, Math.round(g.t / DT) + 6);
    const stopped = g.cam >= g.camStop - 1;
    const target = !stopped ? { x: C.START_X, y: plan.path[s] }
      : !g.hasKey ? { x: g.keyX - g.cam, y: g.keyY } : { x: g.lev.chestX - g.cam, y: C.SAND - 60 };
    // steer AWAY from the key until the camera stops, to force the key-return path
    if (!g.hasKey && !stopped && Math.abs(g.keyY - target.y) < 140) target.y = g.keyY < 270 ? 460 : 80;
    g.inv = 1; // ignore bumps here; this test is about the key
    g.step(DT, target);
    for (const e of g.ev) if (e.type === 'keyback') backs++;
    g.ev.length = 0; frames++;
  }
  const ok = g.state === 'win' && backs > 0;
  if (!ok) fail++;
  console.log(`missed-key path, level ${n}: ${ok ? 'OK' : 'FAIL'} (key came back ${backs}x, state=${g.state}, hasKey=${g.hasKey})`);
}

// Losing all hearts restarts at the LAST checkpoint passed, with 3 hearts, somewhere safe.
for (const [n, wantCp] of [[2, 1], [13, 2], [20, 2]]) {
  const g = new C.Game(n, 1200);
  const plan = sweep(g.lev, C.START_X, 8, true);
  if (!plan.ok) { fail++; console.log(`checkpoint respawn, level ${n}: no padded path`); continue; }
  drive(g, plan, (q) => q.cp >= wantCp, 200);
  g.hearts = 1; g.inv = 0;
  let frames = 0;
  while (g.state === 'play' && frames < 60 * 60) { g.step(DT, { x: C.START_X, y: g.y }); frames++; }
  const lost = g.state === 'lost', cpT = g.snap.t, cpIdx = g.cp;
  for (let i = 0; i < 200 && g.respawns === 0; i++) g.step(DT, null);
  const ok = lost && cpIdx === wantCp && g.state === 'play' && g.hearts === 3 && Math.abs(g.t - cpT) < 0.01 && g.respawns === 1
    && !C.hitTest(g.lev, g.t, g.wx, g.y, 0);
  if (!ok) fail++;
  console.log(`checkpoint respawn, level ${n}: ${ok ? 'OK' : 'FAIL'} (lost=${lost} cp=${cpIdx}/${g.lev.cps.length} state=${g.state} hearts=${g.hearts} t=${g.t.toFixed(2)} cpT=${cpT.toFixed(2)})`);
}
console.log(fail ? `\n${fail} FAILURE(S)` : `\nALL ${N} LEVELS PASS`);
process.exit(fail ? 1 : 0);
