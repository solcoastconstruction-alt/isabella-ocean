// Picks the seeds in the level table of web/games/flight/logic.js. A seed is good for a level when, in every mode, the
// sweep finds a way through even at a modest share of Isabella's vertical speed (so there is room to spare), and the model
// child never bonks on Easy. Prints the first good seed for each level (and how many were tried).
//   node test/games/flight/tune.js [firstSeed=1000] [tries=300] [level ...]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { sweep } = require('./sweep');
const M = require('./models');

const FILE = path.resolve(__dirname, '../../../web/games/flight/logic.js');
const SRC = fs.readFileSync(FILE, 'utf8');
function load(seeds) {
  let src = SRC;
  for (const [n, s] of Object.entries(seeds)) src = src.replace(new RegExp(`(\\{ n: ${n},[^\\n]*seed: )\\d+`), `$1${s}`);
  const m = { exports: {} };
  new vm.Script(`(function (module, exports) { ${src}\n})`).runInThisContext()(m, m.exports);
  return m.exports;
}
const first = +(process.argv[2] || 1000), tries = +(process.argv[3] || 300);
const only = process.argv.slice(4).map(Number);
const levels = only.length ? only : Array.from({ length: 20 }, (_, i) => i + 1);
const SLACK = { easy: 0.4, medium: 0.4, hard: 0.45 };
const chosen = {};
for (const n of levels) {
  let found = null, k = 0;
  for (; k < tries && !found; k++) {
    const seed = first + n * 1000 + k, L = load({ [n]: seed });
    let ok = true;
    for (const mode of L.MODES) {
      const c = L.buildCourse(n, mode);
      if (!sweep(L, c, { speed: SLACK[mode] }).ok) { ok = false; break; }
    }
    if (!ok) continue;
    const easy = M.playRun(L, new L.Run(n, 'easy'), M.child(L));
    if (!easy.done || easy.bonks > 0 || easy.bloomed < easy.total) continue;
    found = seed;
  }
  chosen[n] = found;
  console.log(`level ${n}: seed ${found} (${k} tried)`);
}
console.log(JSON.stringify(chosen));
