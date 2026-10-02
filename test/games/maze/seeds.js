// Picks the seed for each Coral Maze level: the first seed (counting up from 1) whose level fits its
// targets. Run it only to re-pick seeds; the chosen ones live in web/games/maze/logic.js and are frozen by
// verify.js. Changing a seed changes a level she may already have stars on, so don't, once shipped.
//   node test/games/maze/seeds.js [maxSeed]
// Targets per level: a difficulty near TARGET (and above the previous level's), fewest moves in PAR,
// solvable and fair (no state she can get into but not out of), and the level's new thing really in play.
'use strict';
const L = require('../../../web/games/maze/logic.js');

const MAX = +process.argv[2] || 4000;
const TARGET = [3, 5, 7, 10.5, 12.5, 14.5, 17, 19, 21.5, 24, 26.5, 29, 31.5, 34, 37, 41, 45, 50, 55, 60];
const TOL = 1.5;
const PAR = [[2, 3], [3, 4], [3, 5], [4, 6], [5, 7], [5, 8], [6, 9], [7, 10], [7, 11], [8, 12], [8, 13], [9, 14], [10, 16], [10, 17], [11, 18], [13, 22], [13, 24], [15, 26], [16, 28], [17, 30]];

// the new thing has to matter: the best way out goes through it
function inPlay(lv, a) {
  const cells = new Set([lv.start]);
  for (const s of a.plan) for (const c of s.cells) cells.add(c);
  for (const k of lv.keys) if (!cells.has(k.cell)) return 'key not on the way';
  for (const p of lv.patrols) if (!p.cells.some((c) => cells.has(c))) return 'patrol not on the way';
  const help = (lv.cfg.currents || []).map((c, i) => [c, lv.currents[i]]).filter(([c]) => c.mode === 'help');
  for (const [, cur] of help) if (!cur.cells.some((c) => cells.has(c))) return 'helping current not ridden';
  return '';
}

let prevD = 0;
const picked = [];
for (let n = 1; n <= L.LEVELS.length; n++) {
  const cfg = L.LEVELS[n - 1];
  let found = null, tried = 0;
  for (let seed = 1; seed <= MAX && !found; seed++) {
    tried++;
    const lv = L.generate(cfg, seed);
    if (!lv.ok) continue;
    if (cfg.h >= 3 && Math.floor(lv.start / lv.W) === Math.floor(lv.exit / lv.W)) continue;   // make her swim up or down too
    const a = L.analyze(lv);
    if (!a.solvable || !a.fair) continue;
    if (a.par < PAR[n - 1][0] || a.par > PAR[n - 1][1]) continue;
    if (Math.abs(a.difficulty - TARGET[n - 1]) > TOL || a.difficulty <= prevD + 0.5) continue;
    if (inPlay(lv, a)) continue;
    found = { n, seed, par: a.par, difficulty: a.difficulty, states: a.states, choices: a.choices, spare: a.spare, waits: a.waits };
  }
  if (!found) { console.log(`level ${n}: nothing in seeds 1..${MAX} fits (target ${TARGET[n - 1]}, par ${PAR[n - 1]})`); process.exitCode = 1; continue; }
  prevD = found.difficulty;
  picked.push(found);
  console.log(`level ${String(n).padStart(2)}: seed ${String(found.seed).padStart(5)}  par ${String(found.par).padStart(2)}  difficulty ${found.difficulty}  (choices ${found.choices}, spare ${found.spare}, waits ${found.waits}, states ${found.states}; tried ${tried})`);
}
console.log('\nseeds: ' + JSON.stringify(picked.map((p) => p.seed)));
console.log('pars:  ' + JSON.stringify(picked.map((p) => p.par)));
