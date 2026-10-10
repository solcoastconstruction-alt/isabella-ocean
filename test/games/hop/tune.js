// Toadstool Hop: choose the seeds. For each level in turn, try seeds 1..N and keep the first one whose three courses
//   - can all be played splash-free, collecting every coin, butterfly and the key (and the far platforms too),
//   - keep to the window rules (a hop has an open window long enough, and never a closed one too long), and
//   - cost more than the level before in every mode, and Easy < Medium < Hard,
// with the smallest rise (over the three modes) in cost over the level before, so the climb is gentle: at least 4.5% a level in World 1,
// 2.5% in World 2, and level 11 at least 6% above level 10. Courses must also have the variety their level promises (pads, clouds,
// choices), keep their shape (nothing meets, the far platform is above the near one) and stay inside the platform counts.
//   node test/games/hop/tune.js [tries=60] [--fix=s1,s2,...]   prints SEEDS = [...] to paste into web/games/hop/logic.js
//   (--fix carries on from seeds already chosen for the first levels; a full search takes about 20 minutes)
'use strict';
const { L, solve, windows } = require('./models');

const SEED_TRIES = +(process.argv[2] || 60);
const FIX = ((process.argv.find((a) => a.startsWith('--fix=')) || '').slice(6).split(',').filter(Boolean)).map(Number);   // seeds already chosen for the first levels (to carry on from there)
const RISE = 1.045;        // each level costs at least this much more than the one before (in each mode)
const GAP = 1.07;          // Medium costs at least this much more than Easy, and Hard than Medium
const JUMP = 1.06;         // level 11 costs at least this much more than level 10

// the course has the variety its level promises (so the cheapest seed is not simply the emptiest one)
function varied(c, n) {
  const cfg = L.LEVELS[n - 1], count = (k) => c.plats.filter((p) => p.kind === k && !p.far).length, main = c.nodes.length - 2;
  if (count('pad') < Math.round(0.6 * cfg.pad * main) || (n >= 3 && count('pad') < 2)) return false;
  if (count('cloud') < Math.round(0.6 * cfg.cloud * main) || (n >= 6 && count('cloud') < 2)) return false;
  if (n >= 11 && c.nodes.filter((q) => q.far >= 0).length < Math.max(2, Math.round(0.6 * cfg.choice * (main - 5)))) return false;
  if (n >= 3 && count('mush') < 1) return false;
  return c.bfs.length >= (n >= 3 ? 2 : 1);
}
// the shape rules verify.js checks (a seed that breaks them is no use): heights, no meeting, far above near
function shaped(c) {
  for (const p of c.plats) {
    if (p.ax + p.gA > 90 || p.ay > 70) return false;
    if (p.kind !== 'pad' && p.kind !== 'bank' && (p.y0 + p.ay > L.WATER - 20 || p.y0 - p.ay < 200)) return false;
  }
  for (let i = 0; i + 1 < c.nodes.length; i++) {
    const a = c.plats[c.nodes[i].main], b = c.plats[c.nodes[i + 1].main];
    for (let t = 0; t < 60; t += 0.1) if (L.posX(b, t) - L.posX(a, t) < a.hw + b.hw + 8) return false;
  }
  for (const nd of c.nodes) if (nd.far >= 0) {
    const a = c.plats[nd.main], f = c.plats[nd.far];
    if (a.y0 - f.y0 <= 30) return false;
    for (let t = 0; t < 60; t += 0.1) if (!(L.posY(a, t) - L.posY(f, t) >= 45 || Math.abs(L.posX(a, t) - L.posX(f, t)) >= a.hw + f.hw)) return false;
  }
  return c.hops.every((h) => c.plats[h.to].x0 > c.plats[h.from].x0);
}
function valid(n) {
  for (const m of L.MODE_IDS) {
    const c = L.build(n, m);
    if (!varied(c, n) || !shaped(c)) return false;
    if (!solve(c, { collect: true }).ok || !solve(c, { far: true }).ok) return false;
    const M = L.MODES[m];
    for (const h of c.hops) {
      const q = L.scanHop(c, c.plats[h.from], c.plats[h.to]);
      if (q.cf > 0 && (q.open < M.wOpen * 0.7 || q.closed > M.wClosed * 1.3)) return false;
      if (!h.far && q.cf > Math.max(0.2, L.LEVELS[n - 1].cf * M.cfK + 0.2)) return false;   // the gap found its closed share
      if (q.best < 12) return false;
      if (q.cf > 0.85) return false;
    }
  }
  return true;
}

const seeds = [], costs = [], totals = [];
for (let n = 1; n <= L.NLEV; n++) {
  let best = null;
  const why = {}, no = (k) => { why[k] = (why[k] || 0) + 1; };
  for (let s = FIX[n - 1] || 1; s <= (FIX[n - 1] || SEED_TRIES); s++) {
    L.LEVELS[n - 1].seed = s;
    const cs = L.MODE_IDS.map((m) => L.cost(L.build(n, m)));
    const prev = costs[n - 2];
    if (!(cs[0] * GAP <= cs[1] && cs[1] * GAP <= cs[2])) { no('modes too close'); continue; }
    if (prev) {
      const k = n === 11 ? JUMP : n > 11 ? 1.025 : RISE;   // World 2 climbs a little more gently from level to level (but never falls)
      if (!cs.every((v, i) => v >= prev[i] * k)) { no('cost does not rise'); continue; }
    }
    const tot = L.build(n, 'medium').plats.length;
    if (n <= 10 ? tot > 24 : (tot < 24 || tot > 40)) { no('platform count out of range'); continue; }
    if (totals.length && tot < totals[totals.length - 1] && n !== 11) { no('fewer platforms than the level before'); continue; }
    if (!valid(n)) { no('not valid (variety, shape, solvable, windows)'); continue; }
    const rise = prev ? Math.max(...cs.map((v, i) => v / prev[i])) : cs[1];
    if (!best || rise < best.rise) best = { s, cs, rise, tot };
  }
  if (!best) { console.log(`level ${n}: no seed in 1..${SEED_TRIES} works`, why); process.exit(1); }
  seeds.push(best.s); costs.push(best.cs); totals.push(best.tot);
  L.LEVELS[n - 1].seed = best.s;
  console.log(`level ${n}: seed ${best.s}  cost ${best.cs.map((v) => v.toFixed(0)).join(' / ')}  platforms ${best.tot}`);
}
console.log('\nSEEDS = [' + seeds.join(', ') + '];');
void windows;
