// Picks the seed for each Splash Dash course (the SEEDS table in web/games/dash/logic.js).
//   node test/games/dash/tune.js [seedsPerCourse=24]
// For every course it builds candidates from seeds 1..N, keeps the ones that pass everything verify.js asks of a
// course (a clean line at both speeds whenever she arrives, every coin on one, the model child never bumping at
// any pace, the layout rules), and then chooses one seed per course so that the difficulty score climbs steadily
// from course 1 to course 20. Prints the table to paste into logic.js. (Slow: a few minutes.)
'use strict';
const V = require('./verify.js');
const { L } = V;
const N = +(process.argv[2] || 24);

const cand = [];
for (let n = 1; n <= L.NLEV; n++) {
  const list = [];
  for (let seed = 1; seed <= N; seed++) {
    const m = V.measure(n, seed), lev = m.lev, C = L.COURSES[n - 1];
    const air = (lev.total - lev.groundTotal) / lev.total;
    const ok = m.problems.length === 0 && air <= 0.2 && lev.coins.length >= 60 && (!C.feature || (lev.patterns[C.feature] || 0) >= 2)
      && m.runs.half.secs >= V.TIMES.typical[0] && m.runs.half.secs <= V.TIMES.typical[1];
    if (ok) list.push({ seed, score: m.score, open: m.open, tight: m.tight, work: m.work, rate: m.rate, room: m.room, movers: m.movers });
  }
  list.sort((a, b) => a.score - b.score);
  cand.push(list);
  console.log(`course ${String(n).padStart(2)}: ${list.length}/${N} seeds pass; scores ${list.map((c) => c.score).join(' ')}`);
}
// a steady climb: the straight line from the median of course 1 to the median of course 20, then the candidate
// nearest the line that is still above the course before
const med = (l) => l[Math.floor(l.length / 2)].score;
const lo = med(cand[0]), hi = med(cand[L.NLEV - 1]);
let prev = -Infinity;
const pick = [];
for (let n = 1; n <= L.NLEV; n++) {
  const target = lo + ((hi - lo) * (n - 1)) / (L.NLEV - 1);
  const ok = cand[n - 1].filter((c) => c.score > prev);
  if (!ok.length) { console.log(`course ${n}: no passing seed scores above ${prev}`); process.exit(1); }
  ok.sort((a, b) => Math.abs(a.score - target) - Math.abs(b.score - target));
  pick.push(ok[0]); prev = ok[0].score;
}
console.log('\n  const SEEDS = [' + pick.map((p) => p.seed).join(', ') + '];');
console.log('scores: ' + pick.map((p) => p.score).join(' '));
