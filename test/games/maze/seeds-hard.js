// Picks the seed for each Coral Maze Hard level (HARD_LEVELS in web/games/maze/logic.js): the first seed (counting up
// from 1) whose level fits its targets. As with seeds.js for Easy, run it only to re-pick; the chosen seeds and pars
// live in logic.js and verify.js freezes the levels. Changing a seed changes a level she may have stars on: don't,
// once shipped.
//   node test/games/maze/seeds-hard.js [maxSeed] [fromLevel] [toLevel]
// Targets per level:
//   - fewest moves out near PAR(n): from about 38 at Hard 1 (Easy 20's is 24) up to about 118 at Hard 20;
//   - the model player (kid.js) takes 1-3 minutes at Hard 1 and 5 minutes or more at Hard 20;
//   - difficulty (the Easy metric) above the previous level's by at least STEP, and above Easy 20's for Hard 1;
//     hardness (the extended metric) rising too;
//   - solvable and fair over the full state (no state she can get into but not out of);
//   - everything in it in play: every key on the best way out, every patrol meeting it, every helping current ridden.
'use strict';
const L = require('../../../web/games/maze/logic.js');
const K = require('./kid.js');

const MAX = +process.argv[2] || 1500, FROM = +process.argv[3] || 1, TO = +process.argv[4] || L.HARD_LEVELS.length;
const PAR = (n) => Math.round(38 + (n - 1) * 4.2);
// (Hard 17-20 are the biggest, and their dead ends add difficulty faster than par: a little more room there)
const LO = 0.85, HI = (n) => (n <= 16 ? 1.15 : 1.2), STEP = (n) => (n <= 16 ? 3 : 2.5);
const TIME = (n) => (n === 1 ? [60, 180] : n === L.HARD_LEVELS.length ? [300, 900] : [0, Infinity]);

function inPlay(lv, a) {
  const cells = new Set([lv.start]);
  for (const s of a.plan || a.steps) for (const c of s.cells) cells.add(c);
  for (const k of lv.keys) if (!cells.has(k.cell)) return 'key not on the way';
  for (const p of lv.patrols) if (!p.cells.some((c) => cells.has(c))) return 'patrol not on the way';
  const help = (lv.cfg.currents || []).map((c, i) => [c, lv.currents[i]]).filter(([c]) => c.mode === 'help');
  for (const [, cur] of help) if (!cur.cells.some((c) => cells.has(c))) return 'helping current not ridden';
  return '';
}
// difficulty and hardness as analyze() works them out, but with the cells she can reach found without the patrols
// (cheap); the full analyze() confirms them before a seed is taken
function quick(lv, sol) {
  const ghost = Object.assign({}, lv, { patrols: [] }), ex = L.explore(ghost, { taps: true });
  let choices = 0, cell = lv.start, cameFrom = -1, waits = 0, t = 0;
  const on = new Uint8Array(lv.N + 1), times = new Uint16Array(lv.N + 1), st = L.newState(lv);
  on[lv.start] = 1; times[lv.start] = 1;
  for (const s of sol.steps) {
    while (t < s.at) { L.step(lv, st, -1, -1, null); t++; waits++; }
    for (let d = 0; d < 4; d++) if (d !== s.dir && d !== cameFrom && L.canPass(lv, st, cell, d)) choices++;
    L.glide(lv, st, s.dir, -1, null);
    t += s.ticks;
    for (const c of s.cells) { on[c] = 1; times[c]++; }
    const before = s.cells.length > 1 ? s.cells[s.cells.length - 2] : cell;
    let last = -1;
    for (let d = 0; d < 4; d++) if (lv.nb[before * 4 + d] === st.cell) last = d;
    cameFrom = L.OPP[last >= 0 ? last : s.dir];
    cell = st.cell;
  }
  let onWay = 0, again = 0;
  for (let c = 0; c < lv.N; c++) { onWay += on[c]; if (times[c] > 1) again += times[c] - 1; }
  const spare = Math.max(0, ex.cellsReached - onWay);
  const things = 4 * lv.keys.length + 4 * lv.patrols.length + 3 * lv.currents.length + (lv.dark ? 6 + 6 / lv.dark : 0);
  const difficulty = Math.round((sol.par + 0.8 * choices + 0.15 * spare + things) * 10) / 10;
  const free = L.region(lv, lv.start, lv.gates.map((g) => [g.a, g.b]));
  const order = lv.keys.filter((k) => !free[k.cell]).length, screens = Math.max(0, lv.N / L.SCREEN_CELLS - 1);
  const hardness = Math.round((difficulty + 4 * screens + 3 * order + 0.2 * again + 0.05 * waits) * 10) / 10;
  return { difficulty, hardness };
}

const easy20 = L.analyze(L.build(L.LEVELS.length));
let prev = { difficulty: easy20.difficulty, hardness: easy20.difficulty };
if (FROM > 1) { const a = L.analyze(L.build(FROM - 1, 'hard')); prev = { difficulty: a.difficulty, hardness: a.hardness }; }
const picked = [];
for (let n = FROM; n <= TO; n++) {
  const cfg = L.HARD_LEVELS[n - 1], t0 = Date.now(), why = {};
  const no = (w) => { why[w] = (why[w] || 0) + 1; };
  let found = null;
  for (let seed = 1; seed <= MAX && !found; seed++) {
    const lv = L.generateHard(cfg, seed);
    if (!lv.ok) { no('did not build'); continue; }
    lv.mode = 'hard';
    const sol = L.solve(lv);
    if (!sol) { no('no way out'); continue; }
    if (sol.par < LO * PAR(n)) { no('par too low'); continue; }
    if (sol.par > HI(n) * PAR(n)) { no('par too high'); continue; }
    const kid = K.play(lv);
    if (!kid.won) { no('model stuck'); continue; }
    if (kid.seconds < TIME(n)[0]) { no('model too quick'); continue; }
    if (kid.seconds > TIME(n)[1]) { no('model too slow'); continue; }
    if (inPlay(lv, sol)) { no(inPlay(lv, sol)); continue; }
    const q = quick(lv, sol);
    if (q.difficulty < prev.difficulty + STEP(n)) { no('difficulty not rising'); continue; }
    if (q.hardness < prev.hardness + STEP(n)) { no('hardness not rising'); continue; }
    const a = L.analyze(lv);
    if (!a.fair) { no('unfair'); continue; }
    if (a.difficulty !== q.difficulty || a.hardness !== q.hardness) { no('quick estimate off'); if (a.difficulty < prev.difficulty + STEP(n) || a.hardness < prev.hardness + STEP(n)) continue; }
    found = { n, seed, par: a.par, difficulty: a.difficulty, hardness: a.hardness, kid: kid.seconds, kidGlides: kid.glides, states: a.states };
  }
  if (!found) {
    console.log(`hard ${n}: nothing in seeds 1..${MAX} fits (par ${PAR(n)}, difficulty > ${prev.difficulty + STEP(n)}) ${JSON.stringify(why)}`);
    process.exitCode = 1;
    break;
  }
  prev = found;
  picked.push(found);
  console.log(`hard ${String(n).padStart(2)}: seed ${String(found.seed).padStart(5)}  par ${String(found.par).padStart(3)}  difficulty ${found.difficulty}  hardness ${found.hardness}  model ${found.kid} s (${found.kidGlides} glides; par target ${PAR(n)})  states ${found.states}  (${Date.now() - t0} ms) ${JSON.stringify(why)}`);
}
console.log('\nseeds: ' + JSON.stringify(picked.map((p) => p.seed)));
console.log('pars:  ' + JSON.stringify(picked.map((p) => p.par)));
