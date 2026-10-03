// Sea Words: proves the puzzle maker keeps its promises, over thousands of seeds in every mode.
//   node test/games/words/verify.js            (5000 Easy, 5000 Medium and 3000 Hard puzzles, about half a minute)
//   node test/games/words/verify.js --quick    (a tenth as many)
//   node test/games/words/verify.js --show-blocklist   (prints the decoded blocklist and stops)
// Checks:
//   - the word list: no word inside another (either way round), no palindromes, every word fits its modes;
//   - the blocklist: A-Z, 3+ letters, never inside a picture word, and never made only of filler letters;
//   - this file's own scanner (rays from every cell, every direction) agrees with logic.js's line scanner on
//     thousands of random A-Z grids full of rude words, so the two can vouch for each other;
//   - for every seed: the same seed gives the same puzzle; the grid is the mode's size; every word is placed in a
//     direction its mode allows, spelled out along its cells, and found by the game's own drag matcher from
//     either end, also with a wobbly finger; Hard holds all the words; Medium/Hard have their diagonals and
//     backwards words; filler is consonants only; NO rude word in any of the 8 directions; each word appears
//     exactly once and no other picture word appears at all;
//   - different seeds give different puzzles: every grid distinct, every word and direction used, words placed
//     all over;
//   - the drag matcher: a line one letter short or long finds nothing, random lines find exactly what lies under
//     them, a tap finds nothing;
//   - the checks bite: rude words planted into real puzzles, a word written in twice, a wrong letter, are caught.
// Exits non-zero on any failure.
'use strict';
const L = require('../../../web/games/words/logic.js');
const BL = require('../../../web/games/words/blocklist.js');

const QUICK = process.argv.includes('--quick');
if (process.argv.includes('--show-blocklist')) { console.log(BL.join(' ')); process.exit(0); }
const COUNT = { easy: QUICK ? 500 : 5000, medium: QUICK ? 500 : 5000, hard: QUICK ? 300 : 3000 };

// What the game must do, written out here and NOT read from logic.js (so a change there cannot agree with itself).
// Directions: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE (y down).
const WORDS = ['SHELL', 'FISH', 'CRAB', 'STAR', 'TURTLE', 'WHALE', 'OCTOPUS', 'SEAHORSE', 'DOLPHIN', 'PEARL', 'CORAL', 'CHEST', 'COIN', 'KEY'];
const SPEC = {
  // Easy: one picture word of up to 6 letters, left to right or top to bottom, in a 5 x 5 grid (6 x 6 for a 6-letter word)
  easy: { dirs: [0, 2], size: (len) => Math.max(5, len), words: [1, 1], maxLen: 6, cross: false, minDiag: 0, minBack: 0 },
  // Medium: 3 or 4 words in 8 x 8, reading forwards (across, down, and the two diagonals that go left to right), at least one diagonal
  medium: { dirs: [0, 1, 2, 7], size: () => 8, words: [3, 4], maxLen: 8, cross: false, minDiag: 1, minBack: 0 },
  // Hard: all fourteen in 12 x 12, all 8 directions, crossing allowed, at least 3 backwards and 3 diagonal
  hard: { dirs: [0, 1, 2, 3, 4, 5, 6, 7], size: () => 12, words: [14, 14], maxLen: 12, cross: true, minDiag: 3, minBack: 3 },
};

let fails = 0, checks = 0;
const problems = [];
function check(ok, what, detail) {
  checks++;
  if (!ok) { fails++; problems.push(what); }
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
// a failure inside a big loop: remember the first few, then report once
function tally() {
  const t = { n: 0, first: [] };
  t.bad = (msg) => { t.n++; if (t.first.length < 5) t.first.push(msg); };
  return t;
}
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;

// This file's own directions and scanner: rays from every cell in every direction, prefixes looked up in a Set.
// (Deliberately not logic.js's line-and-pattern scanner, so each checks the other.)
const RX = [1, 1, 0, -1, -1, -1, 0, 1], RY = [0, 1, 1, 1, 0, -1, -1, -1];
const FORWARD = new Set([0, 1, 2, 7]);
function rays(grid, set, minLen, maxLen) {
  const H = grid.length, W = grid[0].length, hits = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let d = 0; d < 8; d++) {
        let s = '';
        for (let k = 0; k < maxLen; k++) {
          const cx = x + RX[d] * k, cy = y + RY[d] * k;
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
          s += grid[cy][cx];
          if (s.length >= minLen && set.has(s)) hits.push({ word: s, x, y, d });
        }
      }
    }
  }
  return hits;
}
const BSET = new Set(BL), BMAX = Math.max(...BL.map((w) => w.length));
const VSET = new Set(WORDS), VMAX = Math.max(...WORDS.map((w) => w.length));
const rudeIn = (grid) => rays(grid, BSET, 3, BMAX);
const vocabIn = (grid) => rays(grid, VSET, 3, VMAX);
const rev = (s) => s.split('').reverse().join('');

// ======================================================================== the word list
console.log('\nthe picture words');
{
  const V = L.VOCAB;
  check(V.join() === WORDS.join() && new Set(V).size === 14 && V.every((w) => /^[A-Z]{3,9}$/.test(w)), `the fourteen picture words, as listed here, A-Z, 3 to 9 letters: ${V.join(' ')}`);
  const inside = [];
  for (const a of V) for (const b of V) if (a !== b && (b.includes(a) || rev(b).includes(a))) inside.push(`${a} in ${b}`);
  check(inside.length === 0, 'no word sits inside another, forwards or backwards (so finding one is never mistaken for another)', inside);
  check(V.every((w) => w !== rev(w)), 'no word reads the same backwards');
  const easy = V.filter((w) => w.length <= L.MODES.easy.maxLen);
  check(easy.length >= 8 && V.every((w) => w.length <= L.MODES.medium.size && w.length <= L.MODES.hard.size), `every word fits Medium (8) and Hard (12); ${easy.length} are short enough for Easy`, easy.join(' '));
  check(V.every((w) => /^#[0-9a-f]{6}$/.test(L.COLORS[w])), 'every word has its own highlight colour');
}

// ======================================================================== the blocklist
console.log('\nthe blocklist');
{
  const bad = BL.filter((w) => !/^[A-Z]{3,}$/.test(w));
  check(BL.length >= 120 && bad.length === 0 && new Set(BL).size === BL.length, `${BL.length} blocked words, all A-Z, 3+ letters, no repeats`, bad);
  const clash = [];
  for (const b of BL) for (const w of WORDS) if (w.includes(b) || rev(w).includes(b)) clash.push(`${b} in ${w}`);
  check(clash.length === 0, 'no blocked word is inside a picture word, either way round (or that word could never be placed)', clash);
  check(/^[A-Z]+$/.test(L.FILLER) && !/[AEIOUY]/.test(L.FILLER), `the filler letters are consonants only: ${L.FILLER}`);
  const fillerOnly = BL.filter((w) => w.split('').every((ch) => L.FILLER.includes(ch)));
  check(fillerOnly.length === 0, 'no blocked word can be spelled from filler letters alone: each needs a letter only a picture word can bring', fillerOnly);
}

// ======================================================================== the two scanners agree
console.log('\nthe two scanners agree (random A-Z grids)');
{
  const rng = L.mulberry32(20261003), t = tally();
  let found = 0, grids = 0;
  for (const size of [5, 6, 8, 12]) {
    for (let g = 0; g < 1500; g++) {
      const letters = [];
      // mostly random letters, with rude words written in at random so there is plenty to find
      for (let i = 0; i < size * size; i++) letters.push(String.fromCharCode(65 + Math.floor(rng() * 26)));
      for (let k = 0; k < 3; k++) {
        const w = BL[Math.floor(rng() * BL.length)], d = Math.floor(rng() * 8), x = Math.floor(rng() * size), y = Math.floor(rng() * size);
        const ex = x + RX[d] * (w.length - 1), ey = y + RY[d] * (w.length - 1);
        if (ex < 0 || ey < 0 || ex >= size || ey >= size) continue;
        for (let i = 0; i < w.length; i++) letters[(y + RY[d] * i) * size + x + RX[d] * i] = w[i];
      }
      const grid = Array.from({ length: size }, (_, y) => letters.slice(y * size, y * size + size).join(''));
      grids++;
      // compare the places a blocked word starts, and which way it runs
      const a = new Set(rudeIn(grid).map((h) => `${h.y * size + h.x}:${h.d}`));
      const b = new Set(L.scan(letters, size, size, L.BLOCK_RE).map((h) => {
        const c0 = h.cells[0], c1 = h.cells[1], dx = (c1 % size) - (c0 % size), dy = Math.floor(c1 / size) - Math.floor(c0 / size);
        return `${c0}:${RX.findIndex((v, i) => v === dx && RY[i] === dy)}`;
      }));
      found += a.size;
      const diff = [...a].filter((k) => !b.has(k)).concat([...b].filter((k) => !a.has(k)));
      if (diff.length) t.bad(`${size}x${size} grid ${g}: ${diff.join(',')}`);
    }
  }
  check(t.n === 0 && found > grids, `on ${grids} grids both scanners report exactly the same ${found} blocked words (place and direction)`, t.first);
}

// ======================================================================== thousands of puzzles in every mode
const allStats = {};
for (const mode of ['easy', 'medium', 'hard']) {
  // S: the rules written above; M: the game's own settings, used only to drive its drag matcher (its tolerance)
  const S = SPEC[mode], M = L.MODES[mode], N = COUNT[mode];
  console.log(`\n${mode}: ${N} puzzles`);
  const T = {
    same: tally(), size: tally(), words: tally(), placed: tally(), dirs: tally(), overlap: tally(), filler: tally(),
    rude: tally(), once: tally(), find: tally(), wobble: tally(), short: tally(), mix: tally(),
  };
  const seen = new Set(), dirCount = new Array(8).fill(0), wordCount = {}, startSpots = {}, sizes = {};
  let repairs = 0, restarts = 0, rawHits = 0, wobbleTries = 0, ms = 0, backWords = 0, diagWords = 0;
  const rudeFixed = {};
  const rng = L.mulberry32(77 + mode.length);
  for (let n = 0; n < N; n++) {
    // seeds: 1, 2, 3... and big ones, as crypto.getRandomValues gives the game
    const seed = n < N / 2 ? n + 1 : (Math.floor(rng() * 4294967296) >>> 0);
    const t0 = process.hrtime.bigint();
    const p = L.generate(mode, seed);
    ms += Number(process.hrtime.bigint() - t0) / 1e6;
    const tag = `${mode} seed ${seed}`;
    if (L.describe(L.generate(mode, seed)) !== L.describe(p)) T.same.bad(tag);
    if (seen.has(L.describe(p))) T.same.bad(`${tag} repeats an earlier puzzle`);
    seen.add(L.describe(p));
    repairs += p.stats.repairs; restarts += p.stats.restarts;
    if (p.stats.rude.length) rawHits++;
    for (const w of p.stats.rude) rudeFixed[w] = (rudeFixed[w] || 0) + 1;

    // size
    const W = p.cols, H = p.rows, want = S.size(Math.max(...p.words.map((w) => w.len)));
    sizes[`${W}x${H}`] = (sizes[`${W}x${H}`] || 0) + 1;
    if (W !== want || H !== want || p.grid.length !== H || p.grid.some((r) => r.length !== W || !/^[A-Z]+$/.test(r))) T.size.bad(`${tag}: ${W}x${H}`);
    // which words
    const ws = p.words.map((w) => w.word);
    if (ws.length < S.words[0] || ws.length > S.words[1] || !ws.every((w) => w.length <= S.maxLen)) T.words.bad(`${tag}: ${ws}`);
    if (mode === 'hard' && ws.join() !== WORDS.join()) T.words.bad(`${tag}: ${ws}`);
    if (new Set(ws).size !== ws.length || !ws.every((w) => WORDS.includes(w))) T.words.bad(`${tag}: ${ws}`);
    // each word: allowed direction, cells in a straight line inside the grid, letters spell it
    const owner = new Map();
    let diag = 0, back = 0;
    for (const w of p.words) {
      wordCount[w.word] = (wordCount[w.word] || 0) + 1;
      if (!S.dirs.includes(w.dir)) T.dirs.bad(`${tag}: ${w.word} reads ${w.dirName}`);
      dirCount[w.dir]++;
      if (w.dir % 2) diag++;
      if (!FORWARD.has(w.dir)) back++;
      const spot = `${w.word}@${w.x},${w.y},${w.dir}`;
      startSpots[spot] = (startSpots[spot] || 0) + 1;
      let spelled = '';
      w.cells.forEach(([x, y], i) => {
        if (x !== w.x + RX[w.dir] * i || y !== w.y + RY[w.dir] * i || x < 0 || y < 0 || x >= W || y >= H) T.placed.bad(`${tag}: ${w.word} cell ${i} off its line`);
        else spelled += p.grid[y][x];
        const k = y * W + x;
        if (owner.has(k)) {
          const o = owner.get(k);
          if (!S.cross) T.overlap.bad(`${tag}: ${w.word} and ${o.word} share a cell in ${mode}`);
          else if (o.dir % 4 === w.dir % 4) T.overlap.bad(`${tag}: ${w.word} lies along ${o.word}`);
        } else owner.set(k, w);
      });
      if (spelled !== w.word) T.placed.bad(`${tag}: ${w.word} spells "${spelled}"`);
    }
    backWords += back; diagWords += diag;
    if (diag < S.minDiag || back < S.minBack) T.mix.bad(`${tag}: ${diag} diagonal, ${back} backwards`);
    // filler: every cell not in a word is a filler consonant
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!owner.has(y * W + x) && !L.FILLER.includes(p.grid[y][x])) T.filler.bad(`${tag}: filler ${p.grid[y][x]} at ${x},${y}`);
    // NO rude word, any direction (this file's own scanner)
    const rude = rudeIn(p.grid);
    if (rude.length) T.rude.bad(`${tag}: ${rude.map((h) => `${h.word} at ${h.x},${h.y} ${L.DIR_NAMES[h.d]}`).join('; ')}`);
    // each puzzle word exactly once, where it was placed; no other picture word anywhere
    const hits = vocabIn(p.grid);
    for (const w of p.words) {
      const mine = hits.filter((h) => h.word === w.word);
      if (mine.length !== 1 || mine[0].x !== w.x || mine[0].y !== w.y || mine[0].d !== w.dir) T.once.bad(`${tag}: ${w.word} found ${mine.length} times`);
    }
    const strays = hits.filter((h) => !ws.includes(h.word));
    if (strays.length) T.once.bad(`${tag}: stray ${strays.map((h) => h.word).join(',')}`);

    // found by the game's own matcher, from either end (finger exactly on the centres)
    const none = p.words.map(() => false);
    p.words.forEach((w, i) => {
      const A = { x: w.cells[0][0] + 0.5, y: w.cells[0][1] + 0.5 }, B = { x: w.cells[w.len - 1][0] + 0.5, y: w.cells[w.len - 1][1] + 0.5 };
      if (L.judge(p, L.select(p, A, B, -1, none, M.tol), none) !== i) T.find.bad(`${tag}: ${w.word} not found start to end`);
      if (L.judge(p, L.select(p, B, A, -1, none, M.tol), none) !== i) T.find.bad(`${tag}: ${w.word} not found end to start`);
      // one letter short, or one letter too long, finds nothing
      const S = { x: w.cells[w.len - 2][0] + 0.5, y: w.cells[w.len - 2][1] + 0.5 };
      if (L.judge(p, L.select(p, A, S, -1, none, M.tol), none) !== -1) T.short.bad(`${tag}: ${w.word} found one letter short`);
      const ox = w.cells[w.len - 1][0] + RX[w.dir], oy = w.cells[w.len - 1][1] + RY[w.dir];
      if (ox >= 0 && oy >= 0 && ox < W && oy < H && L.judge(p, L.select(p, A, { x: ox + 0.5, y: oy + 0.5 }, -1, none, M.tol), none) !== -1) T.short.bad(`${tag}: ${w.word} found one letter too long`);
    });
    // a wobbly finger: down near one end, a shaky path, up near the other end (every 5th puzzle, every word)
    if (n % 5 === 0) {
      for (let i = 0; i < p.words.length; i++) {
        const w = p.words[i], flip = rng() < 0.5, c0 = flip ? w.cells[w.len - 1] : w.cells[0], c1 = flip ? w.cells[0] : w.cells[w.len - 1];
        const jit = mode === 'hard' ? 0.38 : 0.32, off = () => { const a = rng() * Math.PI * 2, r = rng() * jit; return [Math.cos(a) * r, Math.sin(a) * r]; };
        const o0 = off(), o1 = off(), a = { x: c0[0] + 0.5 + o0[0], y: c0[1] + 0.5 + o0[1] }, b = { x: c1[0] + 0.5 + o1[0], y: c1[1] + 0.5 + o1[1] };
        const len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        let sel = null, dir = -1;
        const steps = 6 + Math.floor(rng() * 10);
        for (let k = 1; k <= steps; k++) {
          const u = k / steps, wob = k < steps ? Math.sin(u * Math.PI * (2 + rng())) * 0.3 * (rng() < 0.5 ? -1 : 1) : 0;
          sel = L.select(p, a, { x: a.x + (b.x - a.x) * u + nx * wob, y: a.y + (b.y - a.y) * u + ny * wob }, dir, none, M.tol);
          if (sel) dir = sel.dir;
        }
        wobbleTries++;
        if (L.judge(p, sel, none) !== i) T.wobble.bad(`${tag}: ${w.word} missed by a wobbly drag`);
      }
    }
  }
  check(T.same.n === 0, `the same seed gives the same puzzle, every time; all ${N} puzzles different from each other (${seen.size} distinct)`, T.same.first);
  check(T.size.n === 0, `grid size: ${Object.entries(sizes).map(([k, v]) => `${k} x${v}`).join(', ')}${mode === 'easy' ? ' (6x6 only for six-letter words)' : ''}`, T.size.first);
  check(T.words.n === 0, mode === 'hard' ? 'Hard holds all fourteen words, every time' : mode === 'medium' ? 'Medium: 3 or 4 different words of up to 8 letters' : 'Easy: one word of up to 6 letters', T.words.first);
  check(T.placed.n === 0, 'every word is spelled out along a straight line of cells inside the grid', T.placed.first);
  const used = S.dirs.map((d) => `${L.DIR_NAMES[d]} ${dirCount[d]}`).join(', ');
  check(T.dirs.n === 0 && S.dirs.every((d) => dirCount[d] > 0) && dirCount.every((c, d) => S.dirs.includes(d) || c === 0), `words read only the mode's ways, and every one of them gets used: ${used}`, T.dirs.first);
  check(T.mix.n === 0, mode === 'hard' ? `Hard always has 3+ backwards and 3+ diagonal words (on average ${(backWords / N).toFixed(1)} backwards, ${(diagWords / N).toFixed(1)} diagonal)` : mode === 'medium' ? `Medium always has a diagonal word (on average ${(diagWords / N).toFixed(1)})` : 'Easy reads left to right or top to bottom only', T.mix.first);
  check(T.overlap.n === 0, S.cross ? 'Hard: words may cross on a shared letter, never lie along each other' : 'no two words share a cell', T.overlap.first);
  check(T.filler.n === 0, `every letter outside the words is a filler consonant (${L.FILLER})`, T.filler.first);
  check(T.rude.n === 0, `NO rude word anywhere, in any of the 8 directions, in any of the ${N} puzzles (this file's own scanner)`, T.rude.first);
  check(T.once.n === 0, 'each word appears exactly once (where it was placed), and no other picture word appears at all', T.once.first);
  check(T.find.n === 0, "the game's drag matcher finds every word, dragged from either end", T.find.first);
  check(T.wobble.n === 0 && wobbleTries > 0, `${wobbleTries} wobbly drags (down and up up to ${mode === 'hard' ? 0.38 : 0.32} of a cell off the end letters, the path weaving 0.3 of a cell) all find their word`, T.wobble.first);
  check(T.short.n === 0, 'a line one letter short, or one letter too long, finds nothing', T.short.first);
  // variety: words, places, directions
  if (mode === 'easy') {
    const pool = WORDS.filter((w) => w.length <= S.maxLen), share = pool.map((w) => (wordCount[w] || 0) / N);
    check(share.every((s) => s > 0.5 / pool.length), `every Easy word turns up (${pool.map((w) => `${w} ${wordCount[w] || 0}`).join(', ')})`);
  } else {
    check(WORDS.every((w) => (wordCount[w] || 0) > 0), `every word turns up in ${mode}`);
  }
  // each word lands in many of the places it could go: at least half of min(places it fits, times it was used)
  const thin = [];
  let spotsAll = 0;
  for (const w of WORDS) {
    if (!wordCount[w]) continue;
    const SZ = S.size(w.length);
    let fits = 0;
    for (const d of S.dirs) for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) { const ex = x + RX[d] * (w.length - 1), ey = y + RY[d] * (w.length - 1); if (ex >= 0 && ey >= 0 && ex < SZ && ey < SZ) fits++; }
    const got = Object.keys(startSpots).filter((k) => k.startsWith(w + '@')).length;
    spotsAll += got;
    if (got < 0.5 * Math.min(fits, wordCount[w])) thin.push(`${w} ${got}/${fits}`);
  }
  const shellSpots = Object.keys(startSpots).filter((k) => k.startsWith('SHELL@')).length;
  check(thin.length === 0, `words land all over the grid: ${spotsAll} different word/place/direction combinations (SHELL in ${shellSpots} of the places it fits)`, thin);
  const avgMs = ms / N;
  const fixedTop = Object.entries(rudeFixed).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, c]) => `${w[0]}${'*'.repeat(w.length - 1)} ${c}`).join(', ');
  console.log(`        ${pct(rawHits, N)} of puzzles had a blocked word in a first fill (fixed by re-rolling filler: ${repairs} re-rolls, ${restarts} fresh placements); most often ${fixedTop || 'none'}`);
  console.log(`        ${avgMs.toFixed(2)} ms per puzzle`);
  check(avgMs < (mode === 'hard' ? 40 : 10), `fast enough to make on a phone at the start of each puzzle (${avgMs.toFixed(2)} ms here)`);
  allStats[mode] = { n: N, rawHitPct: +((100 * rawHits) / N).toFixed(1), repairs, restarts, ms: +avgMs.toFixed(2) };
}

// ======================================================================== the drag matcher, line by line
console.log('\nthe drag matcher');
{
  const rng = L.mulberry32(4242), t = tally();
  let lines = 0, hits = 0, taps = 0, tapBad = 0;
  for (let n = 0; n < (QUICK ? 200 : 1500); n++) {
    const mode = L.MODE_IDS[n % 3], p = L.generate(mode, 900000 + n), W = p.cols, H = p.rows, none = p.words.map(() => false), M = L.MODES[mode];
    for (let k = 0; k < 40; k++) {
      // a straight line from one cell centre to another, any of the 8 ways, any length that stays in the grid:
      // it finds a word only if it lies exactly on one (either way round)
      // every third line starts on a word's end and heads along it, one letter short, exact, or one letter long
      let x = Math.floor(rng() * W), y = Math.floor(rng() * H), d = Math.floor(rng() * 8), aim = -1;
      if (k % 3 === 0) {
        const w = p.words[Math.floor(rng() * p.words.length)], back = rng() < 0.5, e = back ? w.cells[w.len - 1] : w.cells[0];
        x = e[0]; y = e[1]; d = back ? (w.dir + 4) % 8 : w.dir; aim = w.len - 2 + Math.floor(rng() * 3);
      }
      let roomLeft = 0;
      while (x + RX[d] * (roomLeft + 1) >= 0 && x + RX[d] * (roomLeft + 1) < W && y + RY[d] * (roomLeft + 1) >= 0 && y + RY[d] * (roomLeft + 1) < H) roomLeft++;
      if (!roomLeft) continue;
      const len = aim > 0 ? Math.min(aim, roomLeft) : 1 + Math.floor(rng() * Math.min(8, roomLeft)), ex = x + RX[d] * len, ey = y + RY[d] * len;
      const got = L.judge(p, L.select(p, { x: x + 0.5, y: y + 0.5 }, { x: ex + 0.5, y: ey + 0.5 }, -1, none, M.tol), none);
      const cells = Array.from({ length: len + 1 }, (_, i) => `${x + RX[d] * i},${y + RY[d] * i}`).join(' ');
      let want = -1;
      p.words.forEach((w, i) => {
        const a = w.cells.map((c) => c.join(',')).join(' '), b = w.cells.slice().reverse().map((c) => c.join(',')).join(' ');
        if (cells === a || cells === b) want = i;
      });
      lines++;
      if (want >= 0) hits++;
      if (got !== want) t.bad(`${mode} ${p.seed}: ${x},${y} to ${ex},${ey} found ${got}, expected ${want}`);
    }
    // ...and a line aimed between the 8 ways snaps to the nearest one: whatever it finds lies exactly under the snapped line
    for (let k = 0; k < 10; k++) {
      const a = { x: rng() * W, y: rng() * H }, b = { x: rng() * W, y: rng() * H };
      const sel = L.select(p, a, b, -1, none, M.tol), got = L.judge(p, sel, none);
      if (got >= 0 && sel.magnet < 0 && L.matchCells(p, sel.cells, none) !== got) t.bad(`${mode} ${p.seed}: snapped line found ${got} off its cells`);
      if (sel.cells.length > 1) {
        const ddx = sel.cells[1][0] - sel.cells[0][0], ddy = sel.cells[1][1] - sel.cells[0][1];
        if (Math.abs(ddx) > 1 || Math.abs(ddy) > 1 || sel.cells.some((c, i) => c[0] !== sel.cells[0][0] + ddx * i || c[1] !== sel.cells[0][1] + ddy * i)) t.bad(`${mode} ${p.seed}: a snapped line is not straight`);
      }
    }
    // a tap on a word's first letter finds nothing
    const w = p.words[0], c = w.cells[0];
    taps++;
    if (L.judge(p, L.select(p, { x: c[0] + 0.5, y: c[1] + 0.5 }, { x: c[0] + 0.6, y: c[1] + 0.45 }, -1, none, M.tol), none) !== -1) tapBad++;
  }
  check(t.n === 0 && hits > lines / 20 && hits < lines / 2, `${lines} straight lines between cell centres (a third aimed along words, a letter short, exact or a letter long) find a word exactly when one lies under them (${hits} did), and snapped crooked lines only ever find what lies under them`, t.first);
  check(tapBad === 0, `a tap (no drag) on a word's first letter finds nothing (${taps} taps)`);
  // a found word cannot be found again, and the line through it then finds nothing
  const p = L.generate('easy', 5), w = p.words[0], A = { x: w.cells[0][0] + 0.5, y: w.cells[0][1] + 0.5 }, B = { x: w.cells[w.len - 1][0] + 0.5, y: w.cells[w.len - 1][1] + 0.5 };
  check(L.judge(p, L.select(p, A, B, -1, [true], 0.75), [true]) === -1 && L.judge(p, L.select(p, A, B, -1, [false], 0.75), [true]) === -1,
    'a word already found is not found again (not even by a line drawn before it was found)');
  // a finger that points right and then strays 25 degrees keeps pointing right; at 40 degrees it turns
  const q = L.generate('hard', 11), o = { x: 1.5, y: 5.5 };
  const sel1 = L.select(q, o, { x: 1.5 + 3 * Math.cos(0.43), y: 5.5 + 3 * Math.sin(0.43) }, 0, null, 0.8);
  const sel2 = L.select(q, o, { x: 1.5 + 3 * Math.cos(0.7), y: 5.5 + 3 * Math.sin(0.7) }, 0, null, 0.8);
  check(sel1.dir === 0 && sel2.dir === 1, `a line pointing E stays E when the finger strays 25 degrees (SE beyond 30): ${L.DIR_NAMES[sel1.dir]}, ${L.DIR_NAMES[sel2.dir]}`);
  check(L.select(q, { x: -2, y: 3 }, { x: 4, y: 3 }, -1, null, 0.8) === null && L.select(q, { x: -0.4, y: 3.2 }, { x: 4, y: 3.2 }, -1, null, 0.8).start[0] === 0, 'a touch far outside the grid starts nothing; one just outside starts at the edge letter');
  // the line reaches a letter once the finger is past the middle of the gap before it (rounding, not cutting short)
  const r1 = L.select(q, { x: 0.5, y: 0.5 }, { x: 3.1, y: 0.5 }, -1, null, 0.8), r2 = L.select(q, { x: 0.5, y: 0.5 }, { x: 2.9, y: 0.5 }, -1, null, 0.8);
  const r3 = L.select(q, { x: 0.5, y: 0.5 }, { x: 3.12, y: 3.12 }, -1, null, 0.8);
  check(r1.cells.length === 4 && r2.cells.length === 3 && r3.cells.length === 4, `a finger 2.6 cells along reaches the 4th letter, 2.4 cells along the 3rd, and the same on a diagonal (${r1.cells.length}, ${r2.cells.length}, ${r3.cells.length} letters)`);
  // the magnet: a finger that lands in the NEXT cell (but within reach of the first letter) still finds the word;
  // one that lands a whole cell away does not
  {
    const rngM = L.mulberry32(5150), t2 = tally();
    let rescued = 0, refused = 0;
    for (let n = 0; n < (QUICK ? 150 : 1200); n++) {
      const mode = L.MODE_IDS[n % 3], p = L.generate(mode, 700000 + n), M = L.MODES[mode], none = p.words.map(() => false);
      const w = p.words[Math.floor(rngM() * p.words.length)], A = w.cells[0], B = w.cells[w.len - 1];
      // step off the first letter, against the word's direction or across it, by 0.6 of a cell (into the next cell)
      const side = rngM() < 0.5 ? (w.dir + 4) % 8 : (w.dir + 2) % 8, ux = RX[side] / Math.hypot(RX[side], RY[side]), uy = RY[side] / Math.hypot(RX[side], RY[side]);
      const near = { x: A[0] + 0.5 + ux * 0.6, y: A[1] + 0.5 + uy * 0.6 }, far = { x: A[0] + 0.5 + ux * 1.15, y: A[1] + 0.5 + uy * 1.15 }, end = { x: B[0] + 0.5, y: B[1] + 0.5 };
      const inGrid = (pt) => pt.x >= 0 && pt.y >= 0 && pt.x < p.cols && pt.y < p.rows;
      if (!inGrid(near) || !inGrid(far)) continue;
      if (L.judge(p, L.select(p, near, end, -1, none, M.tol), none) === p.words.indexOf(w)) rescued++; else t2.bad(`${mode} ${p.seed}: ${w.word} not found from 0.6 of a cell off its first letter`);
      // (a different word that really lies under that line may be found: just not this one)
      if (L.judge(p, L.select(p, far, end, -1, none, M.tol), none) !== p.words.indexOf(w)) refused++; else t2.bad(`${mode} ${p.seed}: ${w.word} found from 1.15 cells off its first letter`);
    }
    check(t2.n === 0 && rescued > 50, `a finger landing in the next cell, 0.6 of a cell off a word's first letter, still finds it (${rescued} times); 1.15 cells off, it does not (${refused} times)`, t2.first);
  }
}

// ======================================================================== the checks bite
console.log('\nthe checks bite (deliberate defects)');
{
  const rng = L.mulberry32(99), caughtRays = { n: 0, of: 0 }, caughtLogic = { n: 0, of: 0 };
  // every blocked word, written into a real Hard puzzle at a random place and direction
  for (const bw of BL) {
    for (let tries = 0; tries < 50; tries++) {
      const p = L.generate('hard', 1000 + Math.floor(rng() * 1e6)), W = p.cols, d = Math.floor(rng() * 8), x = Math.floor(rng() * W), y = Math.floor(rng() * W);
      const ex = x + RX[d] * (bw.length - 1), ey = y + RY[d] * (bw.length - 1);
      if (ex < 0 || ey < 0 || ex >= W || ey >= W) continue;
      const rows = p.grid.map((r) => r.split(''));
      for (let i = 0; i < bw.length; i++) rows[y + RY[d] * i][x + RX[d] * i] = bw[i];
      const grid = rows.map((r) => r.join('')), letters = grid.join('').split('');
      caughtRays.of++; caughtLogic.of++;
      if (rudeIn(grid).some((h) => h.word === bw || h.word.includes(bw) || bw.includes(h.word))) caughtRays.n++;
      if (L.problems(letters, W, W, {}).some((h) => h.kind === 'rude')) caughtLogic.n++;
      break;
    }
  }
  check(caughtRays.n === caughtRays.of && caughtRays.of === BL.length, `all ${BL.length} blocked words, planted into real puzzles in random directions, are caught by this file's scanner (${caughtRays.n}/${caughtRays.of})`);
  check(caughtLogic.n === caughtLogic.of && caughtLogic.of === BL.length, `...and by the game's own scanner, which then refuses the grid (${caughtLogic.n}/${caughtLogic.of})`);
  // a picture word written in a second time is caught; a wrong letter in a placed word is caught
  const p = L.generate('medium', 31), W = p.cols, rows = p.grid.map((r) => r.split('')), w = p.words[0];
  let twice = false;
  for (let y = 0; y < W && !twice; y++) {
    for (let x = 0; x + w.len <= W && !twice; x++) {
      if (w.cells.some(([cx, cy]) => cy === y && cx >= x && cx < x + w.len)) continue;
      if (p.words.some((o) => o.cells.some(([cx, cy]) => cy === y && cx >= x && cx < x + w.len))) continue;
      for (let i = 0; i < w.len; i++) rows[y][x + i] = w.word[i];
      twice = true;
    }
  }
  const g2 = rows.map((r) => r.join(''));
  check(twice && vocabIn(g2).filter((h) => h.word === w.word).length === 2, `${w.word} written in a second time is spotted (it would be found in the wrong place)`);
  const r3 = p.grid.map((r) => r.split('')), c = w.cells[1];
  r3[c[1]][c[0]] = r3[c[1]][c[0]] === 'Z' ? 'Q' : 'Z';
  const spelled = w.cells.map(([x, y]) => r3[y][x]).join('');
  check(spelled !== w.word && !vocabIn(r3.map((r) => r.join(''))).some((h) => h.word === w.word), `a wrong letter in ${w.word} ("${spelled}") is spotted: the word is no longer there to find`);
}

console.log(`\n${JSON.stringify(allStats)}`);
console.log(`${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED:\n  - ${problems.join('\n  - ')}` : ''}`);
process.exit(fails ? 1 : 0);
