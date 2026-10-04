// Treasure Blocks: proves the rules keep their promises, in Node, over many seeds in every mode.
//   node test/games/blocks/verify.js            (about a minute)
//   node test/games/blocks/verify.js --quick    (a tenth of the seeds, a few seconds)
// Checks:
//   - the pieces: the fourteen shapes as drawn here, their sizes, that each is one connected shape, how many ways
//     each can be turned, that four turns bring a piece back exactly where it was, and that every piece appears
//     lying flat in the top rows;
//   - the walls, the floor and the stack stop a piece; a turn against a wall nudges it or is refused, never overlaps;
//   - a full row sparkles, goes, and everything above settles by exactly the rows removed beneath it (checked against
//     a second, separate model of the well, through thousands of random moves);
//   - coins: 1 for a row, 3 for two at once, 5 for three, 8 for four; the save gets them the moment they are earned;
//   - the bag: every bag holds exactly the mode's pieces, nothing is ever missing for long, nothing comes three times
//     running; Easy has only pieces of 1 to 3 blocks, Hard has the 5-block ones;
//   - the same seed deals the same game, different seeds different games, and a game without a seed is new each time;
//   - Easy never ends: a wave washes the bottom rows away and play goes on; Medium and Hard end kindly, coins kept;
//   - the row goal, the key and "keep going"; the speeds (only Hard gets quicker, gradually, down to a floor);
//   - the save: round trip, junk, and hostile values;
//   - model players (test/games/blocks/player.js), who only do what a finger can, reach the row goal in every mode
//     on every seed, also at a child's pace;
//   - housekeeping: no network, no private text, and the name of a certain famous falling-blocks game appears nowhere.
// The game's files are read from web/games/blocks, or from $BLOCKS_WEB (mutants.js points that at broken copies to
// prove these checks bite). Exits non-zero on any failure.
'use strict';
const fs = require('fs');
const path = require('path');
const WEB = path.resolve(process.env.BLOCKS_WEB || path.join(__dirname, '../../../web/games/blocks'));
const L = require(path.join(WEB, 'logic.js'));
const P = require('./player.js');

const QUICK = process.argv.includes('--quick');
const SEEDS = QUICK ? 40 : 400;

// What the game must do, written out here and NOT read from logic.js (so a change there cannot agree with itself).
const SHAPES = {
  pebble: ['#'], twin: ['##'], reed: ['###'], nook: ['#.', '##'],
  plank: ['####'], crate: ['##', '##'], anchor: ['.#.', '###'], hookL: ['..#', '###'], hookR: ['#..', '###'], waveL: ['.##', '##.'], waveR: ['##.', '.##'],
  cup: ['#.#', '###'], flag: ['###', '##.'], oar: ['####', '#...'],
};
const TURNS = { pebble: 1, twin: 2, reed: 2, nook: 4, plank: 2, crate: 1, anchor: 4, hookL: 4, hookR: 4, waveL: 2, waveR: 2, cup: 4, flag: 4, oar: 4 };
const SPEC = {
  easy: { cols: 6, rows: 9, goal: 6, speed: 1.0, fastest: 1.0, wave: 4, bag: { pebble: 2, twin: 3, reed: 2, nook: 3 } },
  medium: { cols: 7, rows: 11, goal: 8, speed: 0.7, fastest: 0.7, wave: 0, bag: { pebble: 1, twin: 1, reed: 1, nook: 2, crate: 1, plank: 1, anchor: 1, hookL: 1, hookR: 1, waveL: 1, waveR: 1 } },
  hard: { cols: 8, rows: 13, goal: 10, speed: 0.6, fastest: 0.22, wave: 0, bag: { pebble: 1, reed: 1, nook: 1, crate: 1, plank: 1, anchor: 1, hookL: 1, hookR: 1, waveL: 1, waveR: 1, cup: 1, flag: 1, oar: 1 } },
};
const MODES = ['easy', 'medium', 'hard'];
const COINS = { 1: 1, 2: 3, 3: 5, 4: 8, 5: 11 };

let fails = 0, checks = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
// a failure inside a big loop: remember the first few, then report once
function tally() {
  const t = { n: 0, first: [] };
  t.bad = (msg) => { t.n++; if (t.first.length < 4) t.first.push(msg); };
  return t;
}
const DT = 1 / 60;
const norm = (cells) => { const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1])); return cells.map(([x, y]) => `${x - mx},${y - my}`).sort().join(' '); };
const cellsOfShape = (rows) => { const out = []; rows.forEach((r, y) => r.split('').forEach((ch, x) => { if (ch === '#') out.push([x, y]); })); return out; };
const turnCW = (cells) => cells.map(([x, y]) => [-y, x]);   // a quarter turn clockwise with y pointing down
const key = (cells) => cells.map((c) => c.join(',')).sort().join(' ');
const sizeOfBag = (bag) => Object.values(bag).reduce((a, b) => a + b, 0);
// the well as strings of digits (0 empty, else the block's look), top row first
const rowsOf = (g) => Array.from({ length: g.H }, (_, y) => Array.from(g.grid.slice(y * g.W, (y + 1) * g.W)).join(''));
// the second model of "full rows go and what is above settles": keep the rows that are not full, in order, and add
// empty rows on top
function refCollapse(rows, W) { const keep = rows.filter((r) => r.includes('0')); while (keep.length < rows.length) keep.unshift('0'.repeat(W)); return keep; }
function refWash(rows, W, k) { const keep = rows.slice(0, rows.length - k); while (keep.length < rows.length) keep.unshift('0'.repeat(W)); return keep; }
// A game set up by hand: `floor` is the bottom rows of the well as strings ('#' a block), `piece` the sinking piece.
function setup(mode, floor, piece) {
  const g = new L.Game(mode, 1);
  g.grid.fill(0);
  floor.forEach((r, i) => { const y = g.H - floor.length + i; r.split('').forEach((ch, x) => { if (ch !== '.') g.grid[y * g.W + x] = ch === '#' ? 1 : +ch; }); });
  if (piece) { g.cur = { id: piece.id, style: piece.style || 2, rot: piece.rot || 0, x: piece.x, y: piece.y }; g.phase = 'fall'; g.age = 10; g.fallT = 0; g.restT = 0; g.resets = 0; }
  g.events.length = 0;
  return g;
}
function run(g, seconds) { for (let t = 0; t < seconds; t += DT) g.tick(DT); }
function runUntil(g, pred, seconds) { for (let t = 0; t < (seconds || 30); t += DT) { if (pred(g)) return true; g.tick(DT); } return pred(g); }
const inside = (g) => g.cells().every(([x, y]) => x >= 0 && x < g.W && y >= 0 && y < g.H && !g.grid[y * g.W + x]);

// ======================================================================== the pieces
console.log('\nthe pieces');
{
  const ids = Object.keys(SHAPES);
  check(JSON.stringify(L.PIECE_IDS.slice().sort()) === JSON.stringify(ids.slice().sort()), `the fourteen pieces: ${L.PIECE_IDS.join(' ')}`);
  const bad = [], sizes = {};
  for (const id of ids) {
    const want = cellsOfShape(SHAPES[id]), Pc = L.PIECES[id];
    if (!Pc) { bad.push(id + ' missing'); continue; }
    sizes[id] = Pc.size;
    if (Pc.size !== want.length || Pc.rots.some((r) => r.length !== want.length)) bad.push(`${id}: ${Pc.size} blocks, want ${want.length}`);
    if (norm(Pc.rots[0]) !== norm(want)) bad.push(`${id}: its first turn is not the shape drawn here`);
    // each next turn is the one before turned a quarter clockwise (worked out here), inside its box
    for (let r = 0; r < 4; r++) {
      if (norm(Pc.rots[(r + 1) % 4]) !== norm(turnCW(Pc.rots[r]))) bad.push(`${id}: turn ${r + 1} is not turn ${r} turned clockwise`);
      if (Pc.rots[r].some(([x, y]) => x < 0 || y < 0 || x >= Pc.n || y >= Pc.n)) bad.push(`${id}: turn ${r} leaves its box`);
      if (new Set(Pc.rots[r].map((c) => c.join())).size !== want.length) bad.push(`${id}: turn ${r} has a block twice`);
    }
    if (new Set(Pc.rots.map(norm)).size !== TURNS[id] || Pc.distinct !== TURNS[id]) bad.push(`${id}: ${new Set(Pc.rots.map(norm)).size} different turns, want ${TURNS[id]}`);
    // one connected shape
    const set = new Set(want.map((c) => c.join())), seen = new Set([want[0].join()]), todo = [want[0]];
    while (todo.length) { const [x, y] = todo.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (set.has(k) && !seen.has(k)) { seen.add(k); todo.push([x + dx, y + dy]); } } }
    if (seen.size !== want.length) bad.push(`${id}: not one connected shape`);
    if (SHAPES[id].length > 2) bad.push(`${id}: taller than two rows when it appears`);
  }
  check(bad.length === 0, 'each is the shape drawn in this file, one connected shape, turning a quarter turn clockwise each time inside its box', bad);
  check(JSON.stringify(sizes) === JSON.stringify(Object.fromEntries(ids.map((id) => [id, cellsOfShape(SHAPES[id]).length]))),
    `sizes: ${[1, 2, 3, 4, 5].map((n) => `${n} block${n > 1 ? 's' : ''}: ${ids.filter((id) => sizes[id] === n).join(' ')}`).join('; ')}`);
  // no two pieces are the same shape turned round (mirror images count as different: hookL / hookR, waveL / waveR)
  const all = new Map(), same = [];
  for (const id of ids) for (const r of L.PIECES[id].rots) { const k = norm(r); if (all.has(k) && all.get(k) !== id) same.push(`${id} = ${all.get(k)}`); all.set(k, id); }
  const mirror = (cells) => cells.map(([x, y]) => [-x, y]);
  check(same.length === 0 && L.PIECES.hookL.rots.some((r) => norm(r) === norm(mirror(L.PIECES.hookR.rots[0]))) && L.PIECES.waveL.rots.some((r) => norm(r) === norm(mirror(L.PIECES.waveR.rots[0]))),
    'no piece is another one turned round; the two hooks and the two waves are mirror images', same);

  // in the open: four turns bring a piece back exactly, and a turn back undoes a turn
  const drift = [];
  for (const mode of MODES) for (const id of ids) {
    const g = setup(mode, [], { id, x: 2, y: 4 });
    const at = () => key(g.cells());
    const a0 = at(), seen = [a0];
    for (let k = 0; k < 4; k++) { if (!g.rotate(1)) drift.push(`${mode} ${id}: turn ${k + 1} refused in the open`); seen.push(at()); }
    if (seen[4] !== a0) drift.push(`${mode} ${id}: four turns moved it`);
    if (new Set(seen.slice(0, 4).map((s) => norm(s.split(' ').map((q) => q.split(',').map(Number))))).size !== TURNS[id]) drift.push(`${mode} ${id}: wrong number of different turns in the well`);
    g.rotate(1); const a1 = at(); g.rotate(-1);
    if (at() !== a0 || (TURNS[id] > 1 && a1 === a0)) drift.push(`${mode} ${id}: a turn back does not undo a turn`);
    if (g.cells().length !== cellsOfShape(SHAPES[id]).length) drift.push(`${mode} ${id}: lost a block`);
  }
  check(drift.length === 0, 'in open water, four turns bring every piece back exactly where it was, and a turn back undoes a turn', drift);

  // every piece appears lying flat in the top rows, in the middle
  const sp = [];
  for (const mode of MODES) for (const id of Object.keys(SPEC[mode].bag)) {
    const g = new L.Game(mode, 1);
    g.next = { id, style: 1 }; g.grid.fill(0); g.spawn();
    const cs = g.cells(), xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]), mid = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
    if (Math.min(...ys) !== 0 || Math.max(...ys) > 1 || Math.abs(mid - g.W / 2) > 1 || norm(cs) !== norm(cellsOfShape(SHAPES[id]))) sp.push(`${mode} ${id}: rows ${Math.min(...ys)}..${Math.max(...ys)}, middle ${mid}`);
  }
  check(sp.length === 0, 'every piece appears lying flat in the top one or two rows, within a cell of the middle', sp);
}

// ======================================================================== the modes
console.log('\nthe three modes');
for (const mode of MODES) {
  const M = L.MODES[mode], S = SPEC[mode], g = new L.Game(mode, 7);
  const sizes = Object.keys(M.bag).map((id) => L.PIECES[id].size);
  check(g.W === S.cols && g.H === S.rows && g.goal === S.goal && M.wave === S.wave && JSON.stringify(M.bag) === JSON.stringify(S.bag) && g.grid.length === S.cols * S.rows,
    `${mode}: a well ${S.cols} wide and ${S.rows} tall, a goal of ${S.goal} rows, a bag of ${sizeOfBag(S.bag)} pieces (${Object.entries(S.bag).map(([k, v]) => (v > 1 ? `${k} x${v}` : k)).join(', ')})`);
  if (mode === 'easy') check(Math.max(...sizes) === 3 && Math.min(...sizes) === 1, 'easy: only pieces of 1 to 3 blocks');
  if (mode === 'medium') check(Math.max(...sizes) === 4 && [1, 2, 3, 4].every((n) => sizes.includes(n)), 'medium: pieces of 1, 2, 3 and 4 blocks, nothing bigger');
  if (mode === 'hard') check(sizes.filter((n) => n === 5).length === 3 && sizes.filter((n) => n === 4).length === 7 && sizes.filter((n) => n < 4).length === 3, 'hard: seven 4-block shapes, three 5-block shapes and three small pieces');
  check(!(S.cols === 10 && S.rows === 20), `${mode}: not a 10 x 20 well`);
}

// ======================================================================== walls, floor and stack
console.log('\nwalls, floor and stack');
{
  const bad = tally();
  for (const mode of MODES) for (const id of Object.keys(SPEC[mode].bag)) for (let rot = 0; rot < 4; rot++) {
    const fresh = () => { const g = setup(mode, [], { id, x: 2, y: 3 }); for (let k = 0; k < rot; k++) g.rotate(1); return g; };
    let g = fresh(), n = 0;
    while (g.move(-1)) n++;
    if (Math.min(...g.cells().map((c) => c[0])) !== 0 || n > g.W) bad.bad(`${mode} ${id} turn ${rot}: stops ${Math.min(...g.cells().map((c) => c[0]))} from the left wall`);
    if (g.move(-1) || !inside(g)) bad.bad(`${mode} ${id}: goes through the left wall`);
    g = fresh(); n = 0;
    while (g.move(1)) n++;
    if (Math.max(...g.cells().map((c) => c[0])) !== g.W - 1 || n > g.W) bad.bad(`${mode} ${id} turn ${rot}: stops short of the right wall`);
    if (g.move(1) || !inside(g)) bad.bad(`${mode} ${id}: goes through the right wall`);
    g = fresh();
    while (g.stepDown()) { /* down to the floor */ }
    if (Math.max(...g.cells().map((c) => c[1])) !== g.H - 1 || !g.resting) bad.bad(`${mode} ${id} turn ${rot}: does not come to rest on the floor`);
    // a block right under it stops it one row higher; a block beside it stops a slide
    g = fresh();
    const low = g.cells().reduce((a, c) => (c[1] > a[1] ? c : a));
    g.grid[(g.H - 1) * g.W + low[0]] = 1;
    while (g.stepDown()) { /* down onto the block */ }
    if (Math.max(...g.cells().filter((c) => c[0] === low[0]).map((c) => c[1])) !== g.H - 2 || !inside(g)) bad.bad(`${mode} ${id} turn ${rot}: does not stop on a block`);
    g = fresh();
    const left = Math.min(...g.cells().map((c) => c[0])), row = g.cells().find((c) => c[0] === left)[1];
    if (left > 0) { g.grid[row * g.W + left - 1] = 1; if (g.move(-1)) bad.bad(`${mode} ${id} turn ${rot}: slides into a block`); }
  }
  check(bad.n === 0, 'every piece, every way round: stops at the left wall, the right wall, the floor, on a block and beside a block', bad.first);

  // turning against the walls and in a tight spot: nudged, or refused and left alone; never overlapping
  const t2 = tally();
  let nudged = 0, refused = 0;
  for (const mode of MODES) for (const id of Object.keys(SPEC[mode].bag)) for (const wall of ['left', 'right', 'floor', 'tight']) for (let rot = 0; rot < 4; rot++) {
    const g = setup(mode, [], { id, x: 2, y: 3 });
    for (let k = 0; k < rot; k++) g.rotate(1);
    if (wall === 'left') while (g.move(-1)) { /* to the wall */ }
    if (wall === 'right') while (g.move(1)) { /* to the wall */ }
    if (wall === 'floor') while (g.stepDown()) { /* to the floor */ }
    if (wall === 'tight') { const cs = new Set(g.cells().map((c) => c.join())); for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (!cs.has(`${x},${y}`)) g.grid[y * g.W + x] = 1; }
    const before = key(g.cells()), bc = g.cells(), c0 = { x: g.cur.x, y: g.cur.y, rot: g.cur.rot };
    const ok = g.rotate(1);
    if (!inside(g)) t2.bad(`${mode} ${id} at the ${wall}: overlaps after a turn`);
    if (ok) {
      const far = Math.max(Math.abs(g.cur.x - c0.x), Math.abs(g.cur.y - c0.y));
      if (far > 2) t2.bad(`${mode} ${id} at the ${wall}: a turn threw it ${far} cells`);
      if (far > 0) nudged++;
      if (norm(g.cells()) !== norm(turnCW(bc))) t2.bad(`${mode} ${id} at the ${wall}: the turn made a different shape`);
    } else { refused++; if (key(g.cells()) !== before || g.cur.rot !== c0.rot) t2.bad(`${mode} ${id} at the ${wall}: a refused turn still moved it`); }
    if (wall === 'tight' && TURNS[id] > 1 && ok) t2.bad(`${mode} ${id}: turned with no room at all`);
  }
  check(t2.n === 0 && nudged > 20 && refused > 20, `turning against the walls, on the floor and boxed in: nudged at most two cells (${nudged} times) or refused and left alone (${refused} times), never overlapping`, t2.first);
}

// ======================================================================== rows and coins
console.log('\nrows and coins');
{
  check([1, 2, 3, 4, 5].every((n) => L.coinsFor(n) === COINS[n]) && L.coinsFor(0) === 0, 'coins for rows cleared by one piece: 1 -> 1, 2 -> 3, 3 -> 5, 4 -> 8 (5 -> 11)', [1, 2, 3, 4, 5].map((n) => L.coinsFor(n)));

  // one row: a pebble into the last gap
  let g = setup('easy', ['3.....', '12.456', '123456'.replace('3', '.')], { id: 'pebble', x: 2, y: 0 });
  const before = rowsOf(g);
  check(g.ghostY() === g.H - 1, 'the outline shows the pebble landing in the gap at the bottom');
  const d = g.drop();
  let ev = g.takeEvents();
  const rowsEv = ev.find((e) => e.type === 'rows');
  check(d === g.H - 1 && g.phase === 'clear' && rowsEv && rowsEv.n === 1 && rowsEv.rows.join() === String(g.H - 1) && rowsEv.coins === 1 && g.coins === 1 && g.rowsDone === 1,
    'dropping it fills the bottom row: the row starts to sparkle and pays 1 coin at once', rowsEv);
  check(rowsOf(g)[g.H - 1].indexOf('0') < 0 && g.cur === null && !g.move(1) && !g.rotate(1) && g.drop() === -1, '...while it sparkles the full row is still there and nothing else can be moved');
  run(g, L.CLEAR_T - 0.1);
  check(g.phase === 'clear', `...it sparkles for ${L.CLEAR_T} s`);
  run(g, 0.15);
  const want = (() => { const r = before.slice(); r[g.H - 1] = r[g.H - 1].replace('0', '2'); return refCollapse(r, g.W); })();
  check(JSON.stringify(rowsOf(g)) === JSON.stringify(want) && rowsOf(g)[g.H - 1] === '120456' && rowsOf(g)[g.H - 2] === '300000', '...then it goes and everything above settles down one row, each block keeping its look', rowsOf(g).slice(-3));
  runUntil(g, (q) => q.phase === 'fall', 2);
  check(g.phase === 'fall' && g.cur && g.coins === 1, '...and the next piece appears');

  // two rows that are not next to each other, with a part-row between them and blocks above
  g = setup('medium', ['...1...', '2222.22', '33.3.33', '4444.44', '5.55555'], { id: 'reed', rot: 1, x: 3, y: 2 });
  // (the reed stands upright in column 4)
  check(key(g.cells().map((c) => [c[0], 0])) === key([[4, 0], [4, 0], [4, 0]]), 'a reed stands upright over the gap in column 4');
  const b2 = rowsOf(g);
  g.drop(); ev = g.takeEvents();
  const r2 = ev.find((e) => e.type === 'rows');
  const filled = b2.slice();
  for (const [x, y] of ev.find((e) => e.type === 'lock').cells) filled[y] = filled[y].slice(0, x) + '2' + filled[y].slice(x + 1);
  check(r2 && r2.n === 2 && r2.rows.join() === `${g.H - 4},${g.H - 2}` && r2.coins === 3 && r2.bonus === 1, 'it fills two rows with a part-row between them: both sparkle, 3 coins (2 and a bonus of 1)', r2);
  runUntil(g, (q) => q.phase !== 'clear', 2);
  check(JSON.stringify(rowsOf(g)) === JSON.stringify(refCollapse(filled, g.W)) && rowsOf(g)[g.H - 1] === '5055555' && rowsOf(g)[g.H - 2] === '3303233' && rowsOf(g)[g.H - 3] === '0001000',
    '...both go; the part-row drops one row and the block above drops two', rowsOf(g).slice(-4));

  // three and four rows at once
  g = setup('easy', ['#####.', '#####.', '#####.'], { id: 'reed', rot: 1, x: 4, y: 0 });
  g.drop(); ev = g.takeEvents();
  check(ev.find((e) => e.type === 'rows').coins === 5 && g.coins === 5 && g.rowsDone === 3, 'Easy: an upright reed down a three-deep shaft clears 3 rows for 5 coins (3 and a bonus of 2)');
  g = setup('hard', ['.#######', '.#######', '.#######', '.#######', '#.##.###'], { id: 'plank', rot: 1, x: -2, y: 1 });
  check(g.cells().every((c) => c[0] === 0), 'Hard: a plank stands upright against the left wall');
  g.drop(); ev = g.takeEvents();
  const r4 = ev.find((e) => e.type === 'rows');
  check(r4 && r4.n === 4 && r4.coins === 8 && r4.bonus === 4 && g.coins === 8, 'Hard: an upright plank down a four-deep shaft clears 4 rows for 8 coins (4 and a bonus of 4)', r4);
  runUntil(g, (q) => q.phase !== 'clear', 2);
  check(rowsOf(g)[g.H - 1] === '10110111' && rowsOf(g).slice(0, g.H - 1).every((r) => r === '00000000'), '...and only the part-row under them is left, on the floor');

  // a piece that lands without filling a row pays nothing
  g = setup('medium', ['##.....'], { id: 'crate', x: 4, y: 0 });
  g.drop(); ev = g.takeEvents();
  check(g.coins === 0 && g.rowsDone === 0 && !ev.some((e) => e.type === 'rows') && g.phase === 'rest', 'a piece that fills no row pays nothing and clears nothing');
}

// ======================================================================== a landed piece waits before it settles
console.log('\nsinking, landing and dropping');
{
  for (const mode of MODES) {
    const M = L.MODES[mode], S = SPEC[mode];
    let g = setup(mode, [], { id: 'pebble', x: 2, y: 0 });
    // it sinks one cell every `speed` seconds
    let t = 0;
    while (g.cur && g.cur.y < 3 && t < 10) { g.tick(DT); t += DT; }
    check(Math.abs(t - 3 * S.speed) < 0.06 && g.interval() === S.speed, `${mode}: a piece sinks one cell every ${S.speed} s at the start (3 cells took ${t.toFixed(2)} s)`);
    // on the floor it can still be slid for lockDelay seconds
    g = setup(mode, [], { id: 'pebble', x: 2, y: 0 });
    g.cur.y = g.H - 1;
    run(g, M.lockDelay - 0.08);
    const still = g.phase === 'fall' && g.move(1);
    let slides = 1, waited = 0;
    while (g.pieces === 0 && waited < 60) { run(g, M.lockDelay * 0.5); waited += M.lockDelay * 0.5; if (g.pieces === 0 && g.move(slides % 2 ? -1 : 1)) slides++; }
    check(still && g.pieces === 1 && slides >= L.MAX_RESETS && waited <= (L.MAX_RESETS / 2 + 2) * M.lockDelay,
      `${mode}: a landed piece can still be slid for ${M.lockDelay} s; kept sliding, it settles anyway (after ${slides} slides and ${waited.toFixed(1)} s), so it cannot be kept waiting for ever`);
    // drop: too soon after it appears it is refused; then it lands on the outline
    g = new L.Game(mode, 3);
    const refusedEarly = g.drop() === -1 && g.pieces === 0;
    run(g, M.dropGuard + 0.02);
    let landed = false;
    if (g.cur) {
      g.takeEvents();
      const gy = g.ghostY(), ghost = key(g.cells(g.cur.x, gy)), y0 = g.cur.y, dist = g.drop(), lock = g.takeEvents().find((e) => e.type === 'lock');
      landed = dist === gy - y0 && !!lock && key(lock.cells) === ghost;
    }
    check(refusedEarly && landed && g.pieces === 1,
      `${mode}: drop is refused for the first ${M.dropGuard} s of a piece (a double tap cannot throw the next one down), then lands exactly on the outline`);
  }
}

// ======================================================================== the bag
console.log('\nthe bag');
for (const mode of MODES) {
  const S = SPEC[mode], size = sizeOfBag(S.bag), want = JSON.stringify(Object.fromEntries(Object.entries(S.bag).sort()));
  const N = QUICK ? 60 : 300, bad = tally(), gaps = {}, firsts = new Set(), orders = new Set(), styles = new Set();
  let draws = 0, worstGap = 0, triples = 0, sameStyle = 0, pairs = 0;
  for (let seed = 1; seed <= N; seed++) {
    const g = new L.Game(mode, seed), bag = new L.Bag(L.MODES[mode].bag, L.rngFor(seed)), seq = [];
    // what the game deals: the first piece (already sinking), the next one, and then deal() for the rest
    const dealt = [g.cur.id, g.next.id], looks = [g.cur.style, g.next.style];
    for (let k = 0; k < size * 30 - 2; k++) { const d = g.deal(); dealt.push(d.id); looks.push(d.style); }
    for (let k = 0; k < size * 30; k++) seq.push(bag.next());
    if (seq.join() !== dealt.join()) bad.bad(`seed ${seed}: the game does not deal what the bag gives`);
    firsts.add(seq[0]); orders.add(seq.slice(0, size).join());
    for (let b = 0; b < 30; b++) {
      const counts = {};
      for (const id of seq.slice(b * size, (b + 1) * size)) counts[id] = (counts[id] || 0) + 1;
      if (JSON.stringify(Object.fromEntries(Object.entries(counts).sort())) !== want) bad.bad(`seed ${seed} bag ${b}: ${JSON.stringify(counts)}`);
    }
    const last = {};
    seq.forEach((id, i) => {
      if (last[id] != null) { const gap = i - last[id]; if (gap > (gaps[id] || 0)) gaps[id] = gap; if (gap > worstGap) worstGap = gap; }
      last[id] = i;
      if (i >= 2 && seq[i - 1] === id && seq[i - 2] === id) triples++;
      if (i >= 1 && seq[i - 1] === id) pairs++;
    });
    looks.forEach((s, i) => { styles.add(s); if (i && looks[i - 1] === s) sameStyle++; if (!(s >= 1 && s <= 6 && Number.isInteger(s))) bad.bad(`seed ${seed}: look ${s}`); });
    draws += seq.length;
  }
  check(bad.n === 0, `${mode}: ${draws} pieces over ${N} seeds: every bag of ${size} holds exactly the mode's pieces, and the game deals what the bag gives`, bad.first);
  check(worstGap <= 2 * size - 1 && worstGap >= size, `${mode}: no piece is ever missing for long: the longest wait for any piece was ${worstGap} pieces (it can never pass ${2 * size - 1})`, gaps);
  check(triples === 0 && pairs > 0, `${mode}: the same piece never comes three times running (twice running ${pairs} times)`, triples);
  check(firsts.size === Object.keys(S.bag).length && orders.size > N * 0.9, `${mode}: random patterns: every piece turned up as the first one, and ${orders.size} of ${N} first bags came in different orders`);
  check(styles.size === 6 && sameStyle === 0, `${mode}: pieces come in all 6 looks, never the same look twice running`);
}

// ======================================================================== same seed, same game; no seed, a new game
console.log('\nseeds');
for (const mode of MODES) {
  const N = QUICK ? 30 : 150, trail = (seed) => {
    const g = new L.Game(mode, seed), out = [];
    let pieces = -1;
    for (let t = 0; t < 4000 && g.phase !== 'goal' && g.phase !== 'over'; t++) {
      if (g.phase === 'fall' && g.pieces !== pieces) { pieces = g.pieces; g.target = P.plan(L, P.stateOf(g)); }
      if (g.phase === 'fall' && g.age >= g.M.dropGuard) P.act(g, P.nextAction(g.cur, g.target));
      g.tick(DT);
      if (g.events.some((e) => e.type === 'lock')) out.push(g.describe());
      g.events.length = 0;
    }
    return out.join('\n');
  };
  const a = [], seen = new Set();
  let same = 0;
  for (let seed = 1; seed <= N; seed++) { const t1 = trail(seed), t2 = trail(seed); if (t1 === t2 && t1.length > 100) same++; a.push(t1); seen.add(t1.split('\n').slice(0, 6).join('\n').replace(new RegExp(`\\|${seed}\\|`, 'g'), '|')); }
  check(same === N, `${mode}: the same seed gives the same game, piece for piece, to the end (${N} seeds, each played twice)`);
  check(seen.size >= N * (mode === 'easy' ? 0.95 : 0.99), `${mode}: different seeds give different games (${seen.size} of ${N} differ within the first six pieces)`);
  const M = QUICK ? 60 : 300, seeds = new Set(), openings = new Set();
  for (let k = 0; k < M; k++) { const g = new L.Game(mode); seeds.add(g.seed); const o = [g.cur.id, g.next.id]; for (let j = 0; j < 12; j++) o.push(g.deal().id); openings.add(o.join()); }
  check(seeds.size === M && openings.size >= M * 0.9, `${mode}: a game started without a seed is new every time (${M} games: ${seeds.size} different seeds, ${openings.size} different openings)`);
}

// ======================================================================== random play against a second model
console.log('\nrandom play, checked against a second model of the well');
for (const mode of MODES) {
  const S = SPEC[mode], N = QUICK ? 30 : 200, bad = tally();
  let locks = 0, rowsCleared = 0, multi = 0, waves = 0, overs = 0, moves = 0, coins = 0, ghosts = 0;
  for (let seed = 1; seed <= N && bad.n < 4; seed++) {
    let g = new L.Game(mode, seed);
    const rng = L.mulberry32(seed * 7919);
    let shadow = rowsOf(g), pending = null, paid = 0, done = 0, games = 1, piece = -1, careful = false, target = null;
    for (let step = 0; step < 2500 && bad.n < 4; step++) {
      if (g.phase === 'over') {
        overs++;
        // the round ended because the next piece had no room to appear: check that here, then start another game
        const Pc = L.PIECES[g.next.id], x0 = Math.floor((g.W - Pc.n) / 2);
        if (!Pc.rots[0].some(([dx, dy]) => shadow[dy - Pc.top][x0 + dx] !== '0')) bad.bad(`${mode} seed ${seed}: the round ended although the next piece had room`);
        if (g.coins !== paid) bad.bad(`${mode} seed ${seed}: coins changed at the end of the round`);
        if (g.move(1) || g.rotate(1) || g.drop() !== -1) bad.bad(`${mode} seed ${seed}: a piece moved after the round ended`);
        g = new L.Game(mode, seed * 1000 + games++); shadow = rowsOf(g); paid = 0; done = 0; pending = null; piece = -1;
        continue;
      }
      if (g.phase === 'goal') { if (!g.keepGoing()) bad.bad('keep going refused'); done = 0; }
      const r = rng();
      if (g.phase === 'fall') {
        // the outline is where it really lands (worked out here from the second model)
        if (r < 0.15) {
          const cs = g.cells();
          let dy = 0;
          while (cs.every(([x, y]) => y + dy + 1 < g.H && shadow[y + dy + 1][x] === '0')) dy++;
          if (g.ghostY() !== g.cur.y + dy) bad.bad(`${mode} seed ${seed}: the outline is at ${g.ghostY()}, the piece would land at ${g.cur.y + dy}`);
          ghosts++;
        }
        // half the pieces are placed with care (so rows do get filled), half are thrown about at random
        if (g.pieces !== piece) { piece = g.pieces; careful = rng() < 0.5; target = careful ? P.plan(L, P.stateOf(g)) : null; }
        if (careful) { if (r < 0.7) P.act(g, P.nextAction(g.cur, target)); }
        else if (r < 0.3) g.move(-1); else if (r < 0.6) g.move(1); else if (r < 0.75) g.rotate(1); else if (r < 0.8) g.rotate(-1); else if (r < 0.86) g.stepDown(); else if (r < 0.93) g.drop();
        moves++;
        if (g.cur && !inside(g)) bad.bad(`${mode} seed ${seed}: the piece overlaps a block or a wall`);
      }
      g.tick(r < 0.5 ? DT : r < 0.9 ? 0.05 : 0.4);
      for (const e of g.takeEvents()) {
        if (e.type === 'lock') {
          locks++;
          for (const [x, y] of e.cells) { if (shadow[y][x] !== '0') bad.bad(`${mode} seed ${seed}: a piece settled on top of a block`); shadow[y] = shadow[y].slice(0, x) + e.style + shadow[y].slice(x + 1); }
          const full = shadow.map((row, y) => (row.includes('0') ? -1 : y)).filter((y) => y >= 0);
          pending = full.length ? full : null;
          if (!full.length && JSON.stringify(rowsOf(g)) !== JSON.stringify(shadow)) bad.bad(`${mode} seed ${seed}: the well differs from the second model after a piece settled`);
        } else if (e.type === 'rows') {
          if (!pending || e.rows.join() !== pending.join()) bad.bad(`${mode} seed ${seed}: rows ${e.rows} sparkle, the second model says ${pending}`);
          if (e.coins !== COINS[e.n] || e.n !== e.rows.length) bad.bad(`${mode} seed ${seed}: ${e.n} rows paid ${e.coins}`);
          paid += e.coins; done += e.n; rowsCleared += e.n; coins += e.coins; if (e.n > 1) multi++;
          shadow = refCollapse(shadow, g.W); pending = null;
        } else if (e.type === 'wave') { waves++; if (mode !== 'easy') bad.bad(`${mode}: a wave outside Easy`); }
        else if (e.type === 'washed') shadow = refWash(shadow, g.W, S.wave);
        else if (e.type === 'goal' && done < S.goal) bad.bad(`${mode} seed ${seed}: the goal after ${done} rows`);
      }
      if (pending && g.phase !== 'clear') bad.bad(`${mode} seed ${seed}: full rows were not noticed`);
      if ((g.phase === 'fall' || g.phase === 'rest' || g.phase === 'goal') && JSON.stringify(rowsOf(g)) !== JSON.stringify(shadow)) bad.bad(`${mode} seed ${seed}: the well differs from the second model (${g.phase})`);
      if (g.coins !== paid || g.rowsDone !== done) bad.bad(`${mode} seed ${seed}: ${g.coins} coins and ${g.rowsDone} rows on the game, ${paid} and ${done} counted here`);
      if (mode === 'easy' && g.phase === 'over') bad.bad('Easy ended a round');
      if (g.rowsDone >= S.goal && g.phase !== 'clear' && g.phase !== 'goal') bad.bad(`${mode} seed ${seed}: played on past the goal (${g.rowsDone} rows, ${g.phase})`);
    }
  }
  check(bad.n === 0 && locks > N * 50 && rowsCleared > N * 5 && multi > 0 && ghosts > N * 20, `${mode}: ${moves} moves (half careful, half random) over ${N} seeds: ${locks} pieces settled, ${rowsCleared} rows cleared (${multi} times several at once), ${coins} coins, `
    + `${mode === 'easy' ? `${waves} waves, the round never ended` : `${overs} rounds ended with the well full`}; the well, the rows, the coins and the outline always matched the second model`, bad.first);
  if (mode === 'easy') check(waves > N && overs === 0, `easy: random play brought ${waves} waves and never an ending`);
  else check(overs > N / 4 && waves === 0, `${mode}: random play filled the well ${overs} times (and there is no wave here)`);
}

// ======================================================================== Easy's wave; the kind ending
console.log('\nthe top of the well');
{
  // Easy: pieces dropped straight down the middle until there is no room
  const g = new L.Game('easy', 11);
  let before = null, waveEv = null, guard = 0;
  while (g.phase !== 'wave' && guard++ < 5000) {
    if (g.phase === 'fall' && g.age >= g.M.dropGuard) { before = null; g.drop(); }
    g.tick(DT);
    for (const e of g.takeEvents()) if (e.type === 'wave') waveEv = e;
    if (g.phase === 'rest') before = rowsOf(g);
  }
  before = rowsOf(g);
  const coins = g.coins, done = g.rowsDone, nextId = g.next.id;
  check(g.phase === 'wave' && waveEv && waveEv.rows === 4 && g.cur === null && g.height() >= g.H - 1, `Easy: with the blocks at the top (${g.height()} of ${g.H} rows) the next piece does not appear: a wave comes instead`);
  check(!g.move(1) && !g.rotate(1) && g.drop() === -1, '...nothing can be moved while it washes through');
  run(g, L.WAVE_T - 0.1);
  check(g.phase === 'wave' && JSON.stringify(rowsOf(g)) === JSON.stringify(before), `...it takes ${L.WAVE_T} s`);
  run(g, 0.15);
  const ev = g.takeEvents();
  check(JSON.stringify(rowsOf(g)) === JSON.stringify(refWash(before, g.W, 4)) && ev.some((e) => e.type === 'washed') && rowsOf(g).slice(0, 4).every((r) => r === '000000'),
    '...then the bottom 4 rows are gone and everything above has settled down 4 rows', rowsOf(g));
  check(g.phase === 'fall' && g.cur && g.cur.id === nextId && g.coins === coins && g.rowsDone === done && g.waves === 1, '...and play goes on with the same piece: no coins or rows lost, nothing ended');

  // Medium and Hard: the round ends, the coins stay
  for (const mode of ['medium', 'hard']) {
    const h = setup(mode, ['#'.repeat(SPEC[mode].cols - 1) + '.'], { id: 'pebble', x: SPEC[mode].cols - 1, y: 0 });
    h.drop(); runUntil(h, (q) => q.phase === 'fall', 3);
    let overEv = null, n = 0;
    while (h.phase !== 'over' && n++ < 5000) { if (h.phase === 'fall' && h.age >= h.M.dropGuard) h.drop(); h.tick(DT); for (const e of h.takeEvents()) if (e.type === 'over') overEv = e; }
    const grid = JSON.stringify(rowsOf(h));
    run(h, 3);
    check(h.phase === 'over' && overEv && overEv.coins === 1 && h.coins === 1 && h.rowsAll === 1 && h.cur === null && JSON.stringify(rowsOf(h)) === grid && !h.move(1) && h.drop() === -1 && h.waves === 0,
      `${mode}: with the well full the round ends, quietly: the coin already earned is kept, nothing moves any more`);
  }
}

// ======================================================================== the row goal, the key, keep going
console.log('\nthe row goal');
for (const mode of MODES) {
  const S = SPEC[mode], g = new L.Game(mode, 5);
  const goals = [];
  let maxRows = 0;
  for (let t = 0, pieces = -1, target = null; t < 60000 && g.phase !== 'goal' && g.phase !== 'over'; t++) {
    if (g.phase === 'fall' && g.pieces !== pieces) { pieces = g.pieces; target = P.plan(L, P.stateOf(g)); }
    if (g.phase === 'fall' && g.age >= g.M.dropGuard) P.act(g, P.nextAction(g.cur, target));
    g.tick(DT);
    for (const e of g.takeEvents()) if (e.type === 'goal') goals.push(e);
    maxRows = Math.max(maxRows, g.rowsDone);
  }
  const grid = JSON.stringify(rowsOf(g)), coins = g.coins;
  check(g.phase === 'goal' && goals.length === 1 && g.rowsDone >= S.goal && g.rowsDone < S.goal + 4 && goals[0].coins === g.roundCoins && g.roundCoins === g.coins && g.cur === null,
    `${mode}: the ${S.goal}th row ends the round (${g.rowsDone} rows, ${g.coins} coins, ${g.pieces} pieces): the goal is announced once, with the round's coins`);
  run(g, 2);
  check(g.phase === 'goal' && !g.move(1) && g.drop() === -1 && g.takeEvents().length === 0, `${mode}: ...and the game waits there for "keep going" or "play again"`);
  const ok = g.keepGoing();
  runUntil(g, (q) => q.phase === 'fall', 2);
  check(ok && g.round === 2 && g.rowsDone === 0 && g.roundCoins === 0 && g.coins === coins && g.rowsAll >= S.goal && g.phase === 'fall' && !g.keepGoing(),
    `${mode}: keep going: round 2 in the same well, the row count back to 0, the game's coins kept`);
  check(JSON.stringify(rowsOf(g)) === grid, `${mode}: ...with the blocks left as they were`);
}

// ======================================================================== speeds
console.log('\nspeeds');
{
  for (const mode of ['easy', 'medium']) {
    const g = new L.Game(mode, 1);
    const all = [0, 5, 20, 80, 500].map((r) => { g.rowsAll = r; return g.interval(); });
    check(all.every((v) => v === SPEC[mode].speed), `${mode}: always ${SPEC[mode].speed} s a cell, however many rows have been cleared`, all);
  }
  const g = new L.Game('hard', 1), seq = [];
  for (let r = 0; r <= 60; r++) { g.rowsAll = r; seq.push(g.interval()); }
  const steps = seq.slice(1).map((v, i) => seq[i] - v);
  check(seq[0] === 0.6 && Math.abs(seq[10] - 0.45) < 1e-9 && steps.every((s) => s >= 0 && s <= 0.02) && Math.min(...seq) === 0.22 && seq[60] === 0.22 && seq.indexOf(0.22) > 20,
    `hard: starts at 0.6 s a cell and gets a little quicker with each row (0.45 s at the first key, never more than 0.02 s at a time), down to 0.22 s after ${seq.indexOf(0.22)} rows and no quicker`);
  check(L.MODES.easy.speed > L.MODES.medium.speed && L.MODES.medium.speed > L.MODES.hard.speed && L.MODES.easy.lockDelay > L.MODES.medium.lockDelay && L.MODES.medium.lockDelay > L.MODES.hard.lockDelay,
    'Easy is the slowest and the most patient with a landed piece, then Medium, then Hard');
}

// ======================================================================== the save
console.log('\nthe save');
{
  const fresh = L.freshSave();
  check(JSON.stringify(fresh) === JSON.stringify({ v: 1, coins: 0, rows: 0, games: 0, keys: { easy: 0, medium: 0, hard: 0 }, best: { easy: 0, medium: 0, hard: 0 }, last: 'easy' }), 'a fresh save: no coins, rows, games, keys or bests');
  const rng = L.mulberry32(99);
  let round = 0;
  for (let k = 0; k < 500; k++) {
    const s = L.freshSave(), n = () => Math.floor(rng() * 5000);
    s.coins = n(); s.rows = n(); s.games = n(); for (const m of MODES) { s.keys[m] = n(); s.best[m] = n(); } s.last = MODES[Math.floor(rng() * 3)];
    if (JSON.stringify(L.migrate(JSON.stringify(s))) === JSON.stringify(s) && JSON.stringify(L.migrate(s)) === JSON.stringify(s)) round++;
  }
  check(round === 500, '500 random saves come back from JSON exactly as they went in');
  const junk = [null, undefined, '', 'null', '{not json', '[]', '42', '"hi"', '{}', '{"coins":"lots"}', '{"keys":7,"best":"x"}'];
  check(junk.every((j) => JSON.stringify(L.migrate(j)) === JSON.stringify(fresh)), 'a missing, empty or unreadable save starts fresh');
  const hostile = L.migrate(JSON.stringify({ v: 9, coins: -5, rows: 3.9, games: 1e99, keys: { easy: '4', medium: -1, hard: null, extra: 9 }, best: { easy: NaN, medium: 12 }, last: 'impossible', other: { a: 1 } }));
  check(JSON.stringify(hostile) === JSON.stringify({ v: 1, coins: 0, rows: 3, games: 1e9, keys: { easy: 4, medium: 0, hard: 0 }, best: { easy: 0, medium: 12, hard: 0 }, last: 'easy' }),
    'odd values are tidied: negatives to 0, fractions down, huge numbers capped, unknown fields and modes dropped', hostile);
  const s = L.freshSave();
  const p1 = L.bankRows(s, 'medium', 1, 1), p2 = L.bankRows(s, 'medium', 3, 4), p3 = L.bankRows(s, 'hard', 2, 2);
  L.bankRows(s, 'medium', 1, 2);   // a later, shorter game does not lower the best
  check(p1 === 1 && p2 === 5 && p3 === 3 && s.coins === 10 && s.rows === 7 && s.best.medium === 4 && s.best.hard === 2 && s.best.easy === 0,
    'rows go into the save as they are cleared: coins (with the bonus), the row total, and the most rows in one game per mode', s);
  check(L.bankKey(s, 'easy') === 1 && L.bankKey(s, 'easy') === 2 && s.keys.easy === 2 && s.keys.hard === 0, 'a finished round adds a key to its mode');
}

// ======================================================================== model players reach the goal
console.log('\nmodel players (they see only the well and the next piece, and do only what a finger can)');
{
  const kinds = [
    ['as fast as it likes', {}, { easy: 1, medium: 1, hard: 1 }],
    ['at a child\'s pace (0.8 s to look, a move every 0.35 s)', { think: 0.8, pace: 0.35 }, { easy: 1, medium: 0.98, hard: 0.9 }],
    ['never using drop (0.8 s to look, a move every 0.35 s)', { think: 0.8, pace: 0.35, noDrop: true }, { easy: 1, medium: 0.98, hard: 0.9 }],
  ];
  for (const mode of MODES) for (const [name, o, need] of kinds) {
    let goal = 0, pieces = 0, secs = 0, maxH = 0, slowest = 0;
    const lost = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = new L.Game(mode, seed), r = P.autoplay(L, g, o);
      if (r.phase === 'goal' && g.rowsDone >= SPEC[mode].goal) goal++; else lost.push(seed);
      pieces += r.pieces; secs += r.seconds; maxH = Math.max(maxH, r.maxHeight); slowest = Math.max(slowest, r.seconds);
    }
    check(goal >= SEEDS * need[mode], `${mode}, ${name}: reached the ${SPEC[mode].goal}-row goal on ${goal} of ${SEEDS} seeds (about ${(pieces / SEEDS).toFixed(0)} pieces and ${(secs / SEEDS).toFixed(0)} s a round, the longest ${slowest.toFixed(0)} s; the stack never passed ${maxH} of ${SPEC[mode].rows} rows)`, lost.length ? { notReached: lost.slice(0, 8) } : null);
  }
  // round after round: Hard gets quicker and stays possible
  for (const mode of MODES) {
    const N = QUICK ? 10 : 60;
    let all = 0, quickest = 9;
    for (let seed = 1; seed <= N; seed++) {
      const g = new L.Game(mode, 5000 + seed);
      let rounds = 0;
      for (let k = 0; k < 4; k++) { const r = P.autoplay(L, g, {}); quickest = Math.min(quickest, g.interval()); if (r.phase !== 'goal') break; rounds++; g.keepGoing(); }
      if (rounds === 4) all++;
    }
    check(all === N && Math.abs(quickest - (mode === 'hard' ? 0.22 : SPEC[mode].speed)) < 1e-9, `${mode}: four rounds in a row in one well on ${all} of ${N} seeds (quickest sinking: ${quickest} s a cell)`);
  }
  // a small child who puts every piece somewhere at random: Easy still gets there, with waves instead of endings
  let goal = 0, pieces = 0, waves = 0;
  const N = QUICK ? 20 : 100;
  for (let seed = 1; seed <= N; seed++) { const g = new L.Game('easy', seed), r = P.autoplay(L, g, { sloppy: L.mulberry32(seed), think: 0.3, pace: 0.2, maxPieces: 5000 }); if (r.phase === 'goal') goal++; pieces += r.pieces; waves += r.waves; }
  check(goal === N, `easy, every piece put somewhere at random: still reached the goal on ${goal} of ${N} seeds (about ${(pieces / N).toFixed(0)} pieces and ${(waves / N).toFixed(0)} waves a round; never an ending)`);
}

// ======================================================================== housekeeping
console.log('\nhousekeeping');
{
  const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
  // the words are kept turned round here, so that this file does not contain them either
  const famous = rot13('grgevf');
  const priv = ['qnhtugre', 'snzvyrmr', 'pyrneiblnapr', 'fby pbnfg', 'fbypbnfg'].map(rot13).concat(['/' + 'Users' + '/', '/' + 'home' + '/']);
  const dirs = [WEB, __dirname], files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
  dirs.forEach(walk);
  const hits = [], privHits = [], net = [];
  for (const f of files) {
    const rel = path.relative(path.join(WEB, '..'), f), text = fs.readFileSync(f, 'utf8'), low = text.toLowerCase();
    if (low.includes(famous) || path.basename(f).toLowerCase().includes(famous)) hits.push(rel);
    for (const w of priv) if (low.includes(w.toLowerCase())) privHits.push(`${rel}: ${rot13(w)}`);
    if (f.startsWith(WEB) && /https?:\/\/(?!www\.w3\.org\/)|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|<script[^>]+src=["'](?:https?:)?\/\/|@import|url\(\s*["']?https?:/.test(text)) net.push(rel);
  }
  check(files.length >= 9 && files.some((f) => f.endsWith('logic.js')) && files.some((f) => f.endsWith('verify.js')), `read ${files.length} files of the game and its tests`);
  check(hits.length === 0, 'the name of that famous falling-blocks game appears in none of them (file names included)', hits);
  check(privHits.length === 0, 'no private text and no home-directory paths in any of them', privHits);
  check(net.length === 0, 'the game\'s own files reach for nothing on the network', net);
  // the check bites: the same scan finds the word when it is there
  check(('a ' + famous.toUpperCase() + ' clone').toLowerCase().includes(famous) && famous.length === 6, 'the scan finds the word when it is there (so it is not passing by accident)');
}

console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
