// Picks a layout (seed) for each world-2 level: always passable, its featured obstacle shows up
// often, and its difficulty lands on a target so every level is a step harder than the last.
// One sweep per screen position computes the widest path: at each moment, the best clearance
// she could still have (slack) — no binary search needed.   usage: node test/tune.js [from] [to] [seeds]
const C = require('../web/core.js');
const [from = 11, to = 20, SEEDS = 60] = process.argv.slice(2).map(Number);
const DT = 1 / 60, CELL = 4, CAP = 60;
const ys = []; for (let y = C.TOP; y <= C.FLOOR; y += CELL) ys.push(y);
const _c = [], _r = [];
function clearance(lev, t, px, py) {
  const body = C.bodyCircles(px, py, 0);
  let best = CAP;
  const check = (o) => {
    _c.length = 0; _r.length = 0; C.shapes(o, t, _c, _r);
    for (const b of body) {
      for (const s of _c) { const d = Math.hypot(b[0] - s[0], b[1] - s[1]) - b[2] - s[2]; if (d < best) best = d; }
      for (const s of _r) { const qx = C.clamp(b[0], s[0], s[2]), qy = C.clamp(b[1], s[1], s[3]); const d = Math.hypot(b[0] - qx, b[1] - qy) - b[2]; if (d < best) best = d; }
    }
  };
  for (const o of lev.buckets[Math.floor(px / 200)] || []) check(o);
  for (const o of lev.fish) if (Math.abs(C.fishX(o, t) - px) < 200) check(o);
  return best;
}
function widest(lev, sx) {
  const speed = lev.cfg.speed, steps = Math.ceil((lev.len + 400 - sx) / speed / DT);
  let val = Float32Array.from(ys, (y) => clearance(lev, 0, sx, y));
  let minOpen = Infinity, tight = 0;
  for (let s = 1; s <= steps; s++) {
    const t = s * DT, px = speed * t + sx, next = new Float32Array(ys.length);
    let open = 0;
    for (let i = 0; i < ys.length; i++) {
      const prev = Math.max(val[i], i > 0 ? val[i - 1] : -1e9, i < ys.length - 1 ? val[i + 1] : -1e9);
      next[i] = Math.min(prev, clearance(lev, t, px, ys[i]));
      if (next[i] > 0) open++;
    }
    minOpen = Math.min(minOpen, open); if (open * CELL < 160) tight++;
    val = next;
  }
  return { slack: Math.max(...val), narrow: minOpen * CELL, tight: (100 * tight) / steps };
}
const TARGET = { 11: 52, 12: 48, 13: 44, 14: 40, 15: 36, 16: 32, 17: 28, 18: 24, 19: 19, 20: 14 };
const out = {};
for (let n = from; n <= to; n++) {
  const feat = C.LEVELS[n - 1].feature, rows = [];
  for (let k = 0; k < SEEDS; k++) {
    const seed = k === 0 ? n : 1000 + n * 100 + k;
    const lev = C.buildLevel(n, seed);
    const fc = lev.patterns[feat] || 0;
    const a = widest(lev, 210), b = widest(lev, 520), sl = Math.min(a.slack, b.slack);
    rows.push({ seed, sl: +sl.toFixed(1), s210: +a.slack.toFixed(1), s520: +b.slack.toFixed(1), tight: +Math.max(a.tight, b.tight).toFixed(1), narrow: Math.min(a.narrow, b.narrow), feat: fc, obs: lev.obs.length });
  }
  const ok = rows.filter((r) => r.sl >= 8 && r.feat >= 3);
  ok.sort((p, q) => Math.abs(p.sl - TARGET[n]) - Math.abs(q.sl - TARGET[n]) || q.tight - p.tight);
  out[n] = ok[0];
  console.log(`L${n} target ${TARGET[n]}: ${ok.length}/${rows.length} usable; best`, JSON.stringify(ok.slice(0, 3)));
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([n, r]) => [n, r && r.seed]))));
