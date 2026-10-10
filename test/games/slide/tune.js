// Picks the seeds in web/games/slide/logic.js (SEEDS), so that the difficulty climbs from each course to the next in every
// mode, level 11 sits above level 10, and in every course Easy < Medium < Hard.
//   node test/games/slide/tune.js            (prints the SEEDS block)
//   node test/games/slide/tune.js --write    (and puts it into logic.js)
// It only uses seeds whose course is passable and whose model child never gets a poof. Changing the seeds changes the
// courses: do it only before verify.js's fingerprints are frozen (it prints the new ones with `verify.js --fp`).
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname, '../../../web/games/slide');
const L = require(path.join(DIR, 'logic.js'));
const { makePilot } = require('./pilot.js');
const P = makePilot(L), P2 = makePilot(L, { react: 0.45, look: 1.5, rate: 4.5 });
const M = require('./measure.js').make(L, P, P2);

const CAND = 40, MARGIN = 3;
const cand = {};   // cand[mode][n] = [{ seed, score }]
for (const mode of L.MODE_IDS) {
  cand[mode] = [];
  for (let n = 1; n <= 20; n++) {
    const list = [];
    for (let seed = 1; seed <= CAND; seed++) {
      const lev = L.build(n, mode, seed);
      const m = M.measure(n, mode, seed);
      const r = m.runs;
      const ok = m.problems.length === 0 && r.child.bumps === 0 && r.laggy.bumps === 0 && r.child.stars === 3 && lev.laneTotal >= 50 && r.child.rails === 0 && r.child.rims === 0 && r.child.slips === 0;
      if (ok) list.push({ seed, score: m.score });
    }
    cand[mode].push(list);
    process.stderr.write(`${mode} ${n}: ${list.length} usable seeds, scores ${list.length ? Math.min(...list.map((c) => c.score)) + '..' + Math.max(...list.map((c) => c.score)) : '-'}\n`);
  }
}
// the natural trend: a straight line through the mean scores within each world
function trend(list, lo, hi) {
  const pts = [];
  for (let n = lo; n <= hi; n++) if (list[n - 1].length) pts.push([n, list[n - 1].reduce((a, c) => a + c.score, 0) / list[n - 1].length]);
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let sxx = 0, sxy = 0; for (const p of pts) { sxx += (p[0] - mx) ** 2; sxy += (p[0] - mx) * (p[1] - my); }
  const k = sxy / sxx; return (n) => my + k * (n - mx);
}
// dynamic programming: the seeds whose scores rise by at least MARGIN each course and stay nearest the trend
function pick(list, target, ceil, floor) {
  const best = [];   // best[n][i] = { cost, prev }
  for (let n = 1; n <= 20; n++) {
    best[n] = list[n - 1].map((c, i) => {
      if (ceil && c.score > ceil[n - 1] - MARGIN) return { cost: Infinity, prev: -1 };
      if (floor && c.score < floor[n - 1] + MARGIN) return { cost: Infinity, prev: -1 };
      const own = Math.abs(c.score - target(n));
      if (n === 1) return { cost: own, prev: -1 };
      let b = Infinity, bp = -1;
      list[n - 2].forEach((p, j) => { if (c.score >= p.score + MARGIN && best[n - 1][j].cost < b) { b = best[n - 1][j].cost; bp = j; } });
      return { cost: b + own, prev: bp };
    });
  }
  let bi = -1, bc = Infinity;
  best[20].forEach((b, i) => { if (b.cost < bc) { bc = b.cost; bi = i; } });
  if (bi < 0) return null;
  const out = [];
  for (let n = 20; n >= 1; n--) { out[n - 1] = list[n - 1][bi]; bi = best[n][bi].prev; }
  return out;
}
const chosen = {};
for (const mode of ['medium', 'easy', 'hard']) {
  const list = cand[mode];
  const t1 = trend(list, 1, 10), t2 = trend(list, 11, 20);
  const target = (n) => (n <= 10 ? t1(n) : t2(n));
  const ceil = mode === 'easy' ? chosen.medium.map((c) => c.score) : null, floor = mode === 'hard' ? chosen.medium.map((c) => c.score) : null;
  const got = pick(list, target, ceil, floor);
  if (!got) { console.error(`no way through the candidates for ${mode}: widen CAND`); process.exit(1); }
  chosen[mode] = got;
}
const block = ['  const SEEDS = {', ...L.MODE_IDS.map((m) => `    ${m}:${m === 'hard' ? '  ' : m === 'easy' ? '  ' : ' '}[${chosen[m].map((c) => c.seed).join(', ')}],`), '  };'].join('\n');
console.log(block);
for (const m of L.MODE_IDS) console.log(m.padEnd(7), chosen[m].map((c) => c.score).join(' '));
if (process.argv.includes('--write')) {
  const f = path.join(DIR, 'logic.js'), src = fs.readFileSync(f, 'utf8');
  const re = /  const SEEDS = \{[\s\S]*?\n  \};/;
  if (!re.test(src)) throw new Error('SEEDS block not found');
  fs.writeFileSync(f, src.replace(re, block));
  console.log('written to web/games/slide/logic.js');
}
