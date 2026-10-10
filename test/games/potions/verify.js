// Potion Colours: the rules, tested in Node with the same web/games/potions/logic.js the game loads.
//   node test/games/potions/verify.js            (no browser; exits non-zero if anything fails)
//   node test/games/potions/verify.js --write    (re-freeze test/games/potions/fingerprints.json after a deliberate change)
// It proves:
//   - the mixing table is symmetric (any order of bottles gives one colour), complete (every set of 1-3 of the five bottles),
//     all 25 colours are far enough apart to tell apart, and the table in the code equals the table in docs/fairy/potions.md;
//   - every round of every level in every mode (60 level tables, 330 rounds) is reachable by EXACTLY ONE unordered set of the
//     bottles on the table, found by a separate brute-force enumerator that reads its colours from the docs, not from the
//     code; the recipe sizes follow each mode's rules; decoys are never needed; no swatch is ambiguous;
//   - the pour / undo / finish / advance rules, the stars, the saves and the help by mode (snap, hint, dots, chest);
//   - difficulty rises through 1-10 and 11-20 in every mode, 11 is above 10, Easy < Medium < Hard;
//   - the levels are frozen by fingerprint (60) and dealt the same every time.
'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
// POTIONS_LOGIC=<path> runs these checks against another copy of logic.js (to prove they catch an injected defect)
const LOGIC = process.env.POTIONS_LOGIC ? path.resolve(process.env.POTIONS_LOGIC) : path.join(ROOT, 'web/games/potions/logic.js');
const L = require(LOGIC);
const DOCS = path.join(ROOT, 'docs/fairy/potions.md');
const FP_FILE = path.join(__dirname, 'fingerprints.json');
const WRITE = process.argv.includes('--write');

let pass = 0, fail = 0;
function check(name, fn) {
  try { const detail = fn(); pass++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e && e.message ? e.message.split('\n').join('\n      ') : e}`); }
}
const sha = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const nonDecreasing = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 1e-9);
const MODES = ['easy', 'medium', 'hard'];
const BOTTLES = ['red', 'yellow', 'blue', 'white', 'black'];
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const dist = (a, b) => { const p = rgb(a), q = rgb(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const MIN_DIST = 50;

// ---------------- the table in the docs: an independent copy of the truth ----------------
const docText = fs.readFileSync(DOCS, 'utf8');
const DOC = {};   // 'blue+red' (sorted names) -> colour
for (const line of docText.split('\n')) {
  const m = line.match(/^\|\s*([a-z]+(?:\s\+\s[a-z]+)*)\s*\|\s*(#[0-9a-f]{6})\s*\|\s*([a-z ]+?)\s*\|$/);
  if (m && m[1] !== 'Bottles') DOC[m[1].split(' + ').sort().join('+')] = m[2];
}
const docColour = (set) => DOC[set.slice().sort().join('+')] || null;

// every non-empty subset of `table` of size <= 3, by bitmask (the verifier's own enumerator)
function subsets(table) {
  const out = [];
  for (let m = 1; m < (1 << table.length); m++) {
    const s = table.filter((_, i) => (m >> i) & 1);
    if (s.length <= 3) out.push(s);
  }
  return out;
}
const waysTo = (table, colour) => subsets(table).filter((s) => docColour(s) === colour);

// ---------------- the mixing table ----------------
check('the docs hold a table of 25 sets (5 single bottles, 10 pairs, 10 triples)', () => {
  const keys = Object.keys(DOC);
  assert.equal(keys.length, 25);
  assert.equal(keys.filter((k) => k.split('+').length === 1).length, 5);
  assert.equal(keys.filter((k) => k.split('+').length === 2).length, 10);
  assert.equal(keys.filter((k) => k.split('+').length === 3).length, 10);
});
check('the table in the code equals the table in the docs, set for set and colour for colour', () => {
  assert.equal(L.TABLE.length, 25);
  for (const e of L.TABLE) assert.equal(docColour(e.set), e.colour, `${e.set.join('+')}: docs say ${docColour(e.set)}, code says ${e.colour}`);
  for (const k of Object.keys(DOC)) assert.equal(L.mixColour(k.split('+')), DOC[k], k);
});
check('the table is complete: every set of one to three of the five bottles has a colour', () => {
  const all = subsets(BOTTLES);
  assert.equal(all.length, 25);
  for (const s of all) assert.ok(/^#[0-9a-f]{6}$/.test(L.mixColour(s) || ''), `no colour for ${s.join('+')}`);
});
check('the table is symmetric: every order of the bottles makes the same colour', () => {
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map((p) => [x].concat(p))));
  let n = 0;
  for (const s of subsets(BOTTLES)) for (const p of perms(s)) { assert.equal(L.mixColour(p), L.mixColour(s), `${p.join('+')} differs from ${s.join('+')}`); n++; }
  return n + ' orders';
});
check('illegal sets make nothing: empty, a repeat, four bottles, an unknown bottle', () => {
  assert.equal(L.mixColour([]), null); assert.equal(L.mixColour(['red', 'red']), null);
  assert.equal(L.mixColour(['red', 'yellow', 'blue', 'white']), null); assert.equal(L.mixColour(['green']), null);
  assert.equal(L.mixColour('red'), null);
});
check('the five bottles are the single-bottle colours: red, yellow, blue, white, black', () => {
  for (const b of BOTTLES) assert.equal(L.BOTTLE_COLOUR[b], L.mixColour([b]));
  assert.deepEqual(L.BOTTLES, BOTTLES);
});
check('the named mixes are right: red+yellow orange, yellow+blue green, red+blue purple, with white pastels, with black darks', () => {
  const names = { 'red+yellow': 'orange', 'yellow+blue': 'green', 'red+blue': 'purple', 'red+white': 'pink', 'blue+white': 'light blue', 'yellow+white': 'pale yellow',
    'red+black': 'maroon', 'blue+black': 'navy', 'yellow+black': 'olive', 'red+yellow+blue': 'brown', 'red+yellow+white': 'peach', 'red+blue+white': 'lavender', 'yellow+blue+white': 'mint' };
  for (const k of Object.keys(names)) assert.equal(L.mixName(k.split('+')), names[k], k);
});
check(`all 25 colours differ by at least ${MIN_DIST} in RGB (a swatch is never ambiguous)`, () => {
  const cols = L.TABLE.map((e) => e.colour);
  assert.equal(new Set(cols).size, 25);
  let min = 1e9, who = '';
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) { const d = dist(cols[i], cols[j]); if (d < min) { min = d; who = `${L.TABLE[i].name}/${L.TABLE[j].name}`; } }
  assert.ok(min >= MIN_DIST, `${who} are only ${min.toFixed(1)} apart`);
  return `closest pair ${who} at ${min.toFixed(1)}`;
});

// ---------------- every round of every level and mode ----------------
const PRIMARIES = ['red', 'yellow', 'blue'];
let roundCount = 0, flowerCount = 0;
function expectedBottles(n, mode) {
  if (n <= 3) return 3;
  if (n <= 6) return 4;
  if (n <= 10) return mode === 'easy' ? 4 : 5;
  return 5;
}
check('60 level tables: 5 rounds in World 1, 6 in World 2, the right number of bottles, in the canonical order', () => {
  for (const m of MODES) for (let n = 1; n <= 20; n++) {
    const rs = L.makeRounds(n, m), cfg = L.levelCfg(n, m);
    assert.equal(rs.length, n <= 10 ? 5 : 6, `${m} ${n}: rounds`);
    assert.equal(cfg.rounds, rs.length);
    assert.equal(rs[0].table.length, expectedBottles(n, m), `${m} ${n}: bottles`);
    for (const rd of rs) { assert.deepEqual(rd.table, BOTTLES.filter((b) => rd.table.includes(b)), `${m} ${n}: order`); roundCount++; flowerCount += rd.flowers.length; }
  }
  return `${roundCount} rounds, ${flowerCount} flowers`;
});
check('every flower of every round is reachable by EXACTLY ONE unordered set of bottles on the table (separate brute-force enumerator)', () => {
  let n = 0;
  for (const m of MODES) for (let lv = 1; lv <= 20; lv++) for (const rd of L.makeRounds(lv, m)) for (const fl of rd.flowers) {
    const ways = waysTo(rd.table, fl.colour);
    assert.equal(ways.length, 1, `${m} ${lv}: ${fl.colour} can be made ${ways.length} ways from ${rd.table.join(',')}: ${ways.map((w) => w.join('+')).join(' | ')}`);
    assert.deepEqual(ways[0].slice().sort(), fl.recipe.slice().sort(), `${m} ${lv}: the recorded recipe is not the way`);
    assert.equal(docColour(fl.recipe), fl.colour, `${m} ${lv}: the flower's colour is not its recipe's colour in the docs`);
    assert.equal(L.mixColour(fl.recipe), fl.colour);
    assert.ok(fl.recipe.every((b) => rd.table.includes(b)), 'recipe uses a bottle that is not on the table');
    n++;
  }
  return n + ' flowers';
});
check('the recipe size follows the mode: Easy two (a single bottle only on levels 1-3), Medium three from 14, Hard three from 11, double rounds only on Hard from 18', () => {
  for (const m of MODES) for (let n = 1; n <= 20; n++) for (const rd of L.makeRounds(n, m)) {
    rd.flowers.forEach((fl, i) => {
      assert.equal(fl.size, fl.recipe.length);
      const tag = `${m} ${n}`;
      if (m === 'easy') { assert.ok(fl.size === 2 || (fl.size === 1 && n <= 3), `${tag}: Easy asked a ${fl.size}-bottle mix`); }
      if (m === 'medium') { assert.ok(fl.size === 2 || (fl.size === 3 && n >= 14), `${tag}: Medium asked a ${fl.size}-bottle mix`); }
      if (m === 'hard') { assert.ok(fl.size === 2 || (fl.size === 3 && n >= 11), `${tag}: Hard asked a ${fl.size}-bottle mix`); }
      if (fl.size === 1) assert.ok(PRIMARIES.includes(fl.recipe[0]), `${tag}: a single bottle that is not a primary`);
    });
    if (rd.flowers.length > 1) { assert.equal(m, 'hard'); assert.ok(n >= 18); assert.equal(rd.flowers.length, 2); }
  }
});
check('levels 1-3 ask only the primaries (Easy) and their mixes; 4-6 bring in white mixes; black appears only from level 7 on Medium/Hard and from level 11 on Easy', () => {
  for (const m of MODES) for (let n = 1; n <= 20; n++) {
    const rs = L.makeRounds(n, m), bots = new Set(rs.flatMap((r) => r.flowers.flatMap((f) => f.recipe)));
    if (n <= 3) assert.ok([...bots].every((b) => PRIMARIES.includes(b)), `${m} ${n}`);
    if (n <= 6) assert.ok(!bots.has('black'), `${m} ${n}: black too early`);
    if (m === 'easy' && n <= 10) assert.ok(!bots.has('black'), `${m} ${n}: Easy keeps four bottles`);
    if (n >= 5 && n <= 6) assert.ok(rs.some((r) => r.flowers.some((f) => f.recipe.includes('white'))), `${m} ${n}: no white mix`);
    if (n === 4) assert.ok(rs.filter((r) => r.flowers[0].recipe.includes('white')).length >= 3, `${m} 4: pastels not introduced`);
    if (m !== 'easy' && n === 7) assert.ok(rs.some((r) => r.flowers.some((f) => f.recipe.includes('black'))), `${m} 7: black not introduced`);
  }
  // Easy levels 1-3 really do include a single bottle, so the first rounds always succeed
  assert.equal(L.makeRounds(1, 'easy')[0].flowers[0].size, 1);
  assert.equal(L.makeRounds(2, 'easy')[0].flowers[0].size, 1);
  assert.ok(PRIMARIES.includes(L.makeRounds(1, 'easy')[0].flowers[0].recipe[0]));
});
check('decoys are never needed: from level 16 at least two bottles of every round are in no recipe of that round, and a decoy is in no way to the colour', () => {
  let n = 0;
  for (const m of MODES) for (let lv = 1; lv <= 20; lv++) {
    const cfg = L.levelCfg(lv, m);
    assert.equal(cfg.decoys, lv >= 16 ? 2 : 0, `${m} ${lv}: designed decoys`);
    for (const rd of L.makeRounds(lv, m)) {
      const used = new Set(rd.flowers.flatMap((f) => f.recipe)), decoys = rd.table.filter((b) => !used.has(b));
      assert.ok(decoys.length >= cfg.decoys, `${m} ${lv}: only ${decoys.length} decoys`);
      if (rd.flowers.length > 1) assert.ok(used.size <= 3, `${m} ${lv}: a double round uses ${used.size} bottles`);
      for (const fl of rd.flowers) for (const w of waysTo(rd.table, fl.colour)) for (const d of decoys) assert.ok(!w.includes(d), `${m} ${lv}: decoy ${d} is needed`);
      n++;
    }
  }
  return n + ' rounds';
});
check(`no swatch is ambiguous: any two colours the table can make in a round are at least ${MIN_DIST} apart, and a double round asks two different colours`, () => {
  let min = 1e9;
  for (const m of MODES) for (let lv = 1; lv <= 20; lv++) for (const rd of L.makeRounds(lv, m)) {
    const avail = subsets(rd.table).map((s) => docColour(s));
    assert.equal(new Set(avail).size, avail.length, `${m} ${lv}: two sets of one table make one colour`);
    for (let i = 0; i < avail.length; i++) for (let j = i + 1; j < avail.length; j++) min = Math.min(min, dist(avail[i], avail[j]));
    if (rd.flowers.length > 1) assert.notEqual(rd.flowers[0].colour, rd.flowers[1].colour);
  }
  assert.ok(min >= MIN_DIST, 'closest ' + min.toFixed(1));
  return `closest ${min.toFixed(1)}`;
});
check('a level never asks the same flower twice in a row, and Easy levels 1-3 start with a bottle on its own (rounds always succeed)', () => {
  for (const m of MODES) for (let lv = 1; lv <= 20; lv++) {
    const rs = L.makeRounds(lv, m);
    for (let i = 1; i < rs.length; i++) assert.notEqual(rs[i].flowers[0].colour, rs[i - 1].flowers[0].colour, `${m} ${lv}: round ${i} repeats`);
  }
});
check('the rounds are dealt the same every time (a fresh copy of the module deals identical levels)', () => {
  delete require.cache[require.resolve(LOGIC)];
  const L2 = require(LOGIC);
  for (const m of MODES) for (let lv = 1; lv <= 20; lv++) assert.equal(sha(L2.makeRounds(lv, m)), sha(L.makeRounds(lv, m)), `${m} ${lv}`);
});
check('different modes and levels get different rounds (not one deal copied around)', () => {
  const s = new Set();
  for (const m of MODES) for (let lv = 4; lv <= 20; lv++) s.add(sha(L.makeRounds(lv, m)));
  assert.equal(s.size, 3 * 17);
});

// ---------------- the pour, undo, finish, advance rules ----------------
const R = (n, m) => new L.Run(n || 3, m || 'easy');
const other = (run, not) => run.table.find((b) => !not.includes(b));
check('a pour is taken once; the same bottle again, a bottle not on the table, and a pour while busy are ignored', () => {
  const r = R(3, 'easy'), rec = r.flower.recipe;
  assert.equal(r.pour(rec[0]).type, 'poured');
  assert.equal(r.pour(rec[0]).type, 'ignored'); assert.equal(r.pour(rec[0]).why, 'already');
  assert.equal(r.pour('white').type, 'ignored'); assert.equal(r.pour('white').why, 'absent');
  assert.equal(r.poured.length, 1);
  assert.equal(r.pour(rec[1]).complete, true);
  assert.equal(r.phase, 'mixing');
  assert.equal(r.pour(other(r, rec)).type, 'ignored');   // the mix is full: nothing more goes in
  assert.equal(r.poured.length, rec.length);
});
check('the mix completes exactly when the recipe size is reached (1, 2 or 3 bottles)', () => {
  const r1 = R(1, 'easy'); assert.equal(r1.flower.recipe.length, 1); assert.equal(r1.pour(r1.flower.recipe[0]).complete, true);
  const r2 = R(3, 'easy'); assert.equal(r2.pour(r2.flower.recipe[0]).complete, false); assert.equal(r2.phase, 'filling');
  const r3 = R(20, 'hard'); let found = null;
  for (let i = 0; i < 6; i++) { if (r3.flower.recipe.length === 3) { found = r3; break; } r3.pour(r3.flower.recipe[0]); r3.pour(r3.flower.recipe[1]); r3.finish(); r3.advance(); }
  assert.ok(found, 'no three-bottle round found');
  const rec = found.flower.recipe;
  assert.equal(found.pour(rec[0]).complete, false); assert.equal(found.pour(rec[1]).complete, false); assert.equal(found.pour(rec[2]).complete, true);
});
check('undo: takes back the last pour and returns its bottle, in the middle of a mix and after the last pour (before finish)', () => {
  const r = R(3, 'easy'), rec = r.flower.recipe;
  assert.equal(r.undo().type, 'ignored');                         // nothing to take back
  r.pour(rec[0]);
  let u = r.undo();
  assert.equal(u.type, 'undone'); assert.equal(u.id, rec[0]); assert.deepEqual(r.poured, []); assert.equal(r.phase, 'filling');
  assert.equal(r.pour(rec[0]).type, 'poured');                    // and the bottle can be poured again
  r.pour(rec[1]);
  assert.equal(r.phase, 'mixing');
  u = r.undo();
  assert.equal(u.type, 'undone'); assert.equal(u.id, rec[1]); assert.equal(r.phase, 'filling'); assert.deepEqual(r.poured, [rec[0]]);
  assert.equal(r.undos, 2);
  // it is the LAST pour that comes back, not the first
  const w = other(r, rec); r.undo(); r.pour(w); r.pour(rec[0]);
  assert.equal(r.undo().id, rec[0]);
});
check('undo after the mix is finished is ignored, and so is a finish that was not asked for', () => {
  const r = R(3, 'easy'), rec = r.flower.recipe;
  assert.equal(r.finish().type, 'ignored');                       // nothing in the cauldron
  r.pour(rec[0]); assert.equal(r.finish().type, 'ignored');       // not the full mix yet
  r.pour(rec[1]);
  const f = r.finish();
  assert.equal(f.type, 'bloom');
  assert.equal(r.undo().type, 'ignored');
  assert.equal(r.finish().type, 'ignored');
  assert.equal(r.pour(rec[0]).type, 'ignored');                   // not until advance()
  assert.equal(r.advance().type, 'advanced');
  assert.equal(r.advance().type, 'ignored');
});
check('a wrong mix: costs a star only; the cauldron empties, the same flower waits, the bottles are all free again', () => {
  const r = R(3, 'easy'), rec = r.flower.recipe, w = other(r, rec);
  r.pour(w); r.pour(rec[0]);
  assert.equal(r.phase, 'mixing');
  const f = r.finish();
  assert.equal(f.type, 'wrong'); assert.equal(f.colour, L.mixColour([w, rec[0]])); assert.notEqual(f.colour, r.flower.colour);
  assert.equal(r.wrongs, 1); assert.equal(r.coins, 0); assert.equal(r.blooms, 0); assert.deepEqual(r.poured, []);
  assert.equal(r.advance().type, 'advanced');
  assert.equal(r.r, 0); assert.equal(r.f, 0); assert.equal(r.flower.colour, L.makeRounds(3, 'easy')[0].flowers[0].colour);
  assert.equal(r.phase, 'filling');
  for (const b of r.table) assert.notEqual(r.pour(b).type, 'ignored', 'a bottle stayed used'), r.undo();
  r.pour(rec[0]); r.pour(rec[1]); assert.equal(r.finish().type, 'bloom');
});
check('a match: the flower blooms in its colour, one coin, and the next flower or round comes up', () => {
  const r = R(3, 'easy'), rec = r.flower.recipe, colour = r.flower.colour;
  r.pour(rec[1]); r.pour(rec[0]);                                 // the other way round: the order does not matter
  const f = r.finish();
  assert.equal(f.type, 'bloom'); assert.equal(f.colour, colour); assert.equal(f.coin, 1); assert.equal(f.roundDone, true); assert.equal(f.levelDone, false);
  assert.equal(r.blooms, 1); assert.equal(r.coins, 1);
  r.advance();
  assert.equal(r.r, 1); assert.equal(r.f, 0); assert.deepEqual(r.poured, []);
});
check('a double round: the second flower appears after the first blooms (same round), then the next round', () => {
  const r = R(20, 'hard');
  let guard = 0;
  while (r.round.flowers.length < 2 && guard++ < 20) { r.pour(r.flower.recipe[0]); for (const b of r.flower.recipe.slice(1)) r.pour(b); r.finish(); r.advance(); }
  assert.equal(r.round.flowers.length, 2);
  const round = r.r;
  for (const b of r.flower.recipe) r.pour(b);
  const f1 = r.finish();
  assert.equal(f1.type, 'bloom'); assert.equal(f1.roundDone, false); r.advance();
  assert.equal(r.r, round); assert.equal(r.f, 1);
  for (const b of r.flower.recipe) r.pour(b);
  const f2 = r.finish();
  assert.equal(f2.roundDone, true); r.advance();
  assert.equal(r.r, round + 1); assert.equal(r.f, 0);
});
check('hints: the first bottle still needed, or the cauldron when a wrong bottle is in it, nothing while busy', () => {
  const r = R(3, 'easy'), rec = r.flower.recipe, w = other(r, rec);
  assert.deepEqual(r.hint(), { kind: 'bottle', id: r.table.find((b) => rec.includes(b)) });
  r.pour(rec[0]);
  assert.deepEqual(r.hint(), { kind: 'bottle', id: rec[1] });
  r.undo(); r.pour(w);
  assert.deepEqual(r.hint(), { kind: 'undo' });
  r.pour(rec[0]); assert.equal(r.hint(), null);                   // mixing
  r.finish(); assert.equal(r.hint(), null);                       // settling
});
check('stars: 3 for no wrong mixes, 2 for one or two, 1 for more; none until the level is done; no time anywhere in the rule', () => {
  assert.equal(L.starsFor(0), 3); assert.equal(L.starsFor(1), 2); assert.equal(L.starsFor(2), 2); assert.equal(L.starsFor(3), 1); assert.equal(L.starsFor(40), 1);
  assert.equal(L.starsFor.length, 1);
  assert.equal(R(3, 'easy').stars, null);
});
// a player who pours the right bottles, and one who always starts wrong
function playLevel(n, mode, wrongsEach) {
  const r = new L.Run(n, mode); let guard = 0;
  while (!r.done && guard++ < 500) {
    const rec = r.flower.recipe;
    for (let k = 0; k < wrongsEach; k++) {
      const wrong = r.table.filter((b) => !rec.includes(b)).slice(0, rec.length);
      if (wrong.length < rec.length) { const mix = wrong.concat(rec.filter((b) => !wrong.includes(b))).slice(0, rec.length); if (L.mixColour(mix) === r.flower.colour) break; for (const b of mix) r.pour(b); } else for (const b of wrong) r.pour(b);
      const res = r.finish(); assert.equal(res.type, 'wrong'); r.advance();
    }
    for (const b of rec) r.pour(b);
    const res = r.finish(); assert.equal(res.type, 'bloom');
    if (!r.done) r.advance();
  }
  return r;
}
check('every level of every mode can be finished with 3 stars by pouring the right bottles; coins and blooms add up', () => {
  for (const m of MODES) for (let n = 1; n <= 20; n++) {
    const r = playLevel(n, m, 0), flowers = L.makeRounds(n, m).reduce((a, rd) => a + rd.flowers.length, 0);
    assert.ok(r.done); assert.equal(r.stars, 3, `${m} ${n}`); assert.equal(r.blooms, flowers); assert.equal(r.coins, flowers); assert.equal(r.wrongs, 0);
  }
});
check('a level can always be finished whatever happens: wrong mixes only cost stars (1 wrong a flower = 1 star)', () => {
  for (const m of MODES) for (const n of [1, 3, 6, 10, 11, 14, 18, 20]) {
    const r = playLevel(n, m, 1), flowers = L.makeRounds(n, m).reduce((a, rd) => a + rd.flowers.length, 0);
    assert.ok(r.done, `${m} ${n}`); assert.equal(r.wrongs, flowers); assert.equal(r.stars, flowers >= 3 ? 1 : 2);
  }
  const r = playLevel(5, 'medium', 2);
  assert.equal(r.wrongs, 10); assert.equal(r.stars, 1);
});
check('exactly two wrong mixes still earn two stars, three earn one', () => {
  for (const [w, st] of [[0, 3], [1, 2], [2, 2], [3, 1]]) {
    const r = new L.Run(4, 'medium'); let wrongs = 0, guard = 0;
    while (!r.done && guard++ < 200) {
      const rec = r.flower.recipe;
      if (wrongs < w) { const bad = r.table.filter((b) => !rec.includes(b)).slice(0, rec.length); for (const b of bad) r.pour(b); r.finish(); r.advance(); wrongs++; }
      for (const b of rec) r.pour(b); r.finish(); if (!r.done) r.advance();
    }
    assert.ok(r.done, 'the level never finished'); assert.equal(r.wrongs, w); assert.equal(r.stars, st);
  }
});

// ---------------- help by mode ----------------
check('help by mode: snap Easy > Medium > Hard, hint 8 / 15 / 25 s, dots only on Easy 1-3, the chest pays more on harder modes', () => {
  assert.ok(L.SNAP.easy > L.SNAP.medium && L.SNAP.medium > L.SNAP.hard);
  assert.deepEqual([L.HINT_S.easy, L.HINT_S.medium, L.HINT_S.hard], [8, 15, 25]);
  for (const m of MODES) for (let n = 1; n <= 20; n++) {
    const c = L.levelCfg(n, m);
    assert.equal(c.snap, L.SNAP[m]); assert.equal(c.hint, L.HINT_S[m]); assert.equal(c.chest, L.CHEST_COINS[m]);
    assert.equal(c.dots, m === 'easy' && n <= 3, `${m} ${n}: dots`);
  }
  assert.ok(L.CHEST_COINS.easy < L.CHEST_COINS.medium && L.CHEST_COINS.medium < L.CHEST_COINS.hard);
});
check('the snap: a bottle let go near the cauldron goes in; how near depends on the mode (Easy catches more than Hard)', () => {
  const c = { x: 600, y: 246, r: 80 };
  for (const m of MODES) {
    const s = L.SNAP[m];
    assert.equal(L.overCauldron(600, 246, c, s), true);
    assert.equal(L.overCauldron(600 + c.r + s - 1, 246, c, s), true);
    assert.equal(L.overCauldron(600 + c.r + s + 1, 246, c, s), false);
    assert.equal(L.overCauldron(600, 246 + c.r + s + 1, c, s), false);
  }
  assert.equal(L.overCauldron(600, 246 + 150, c, L.SNAP.easy), true);
  assert.equal(L.overCauldron(600, 246 + 150, c, L.SNAP.hard), false);
});

// ---------------- difficulty ----------------
const DIFF = {};
for (const m of MODES) { DIFF[m] = []; for (let n = 1; n <= 20; n++) DIFF[m].push(L.difficulty(n, m)); }
const col = (m, k, a, b) => DIFF[m].slice(a - 1, b).map((d) => d[k]);
check('difficulty rises through 1-10 and 11-20 in every mode: bottles, pours a round, mixes available, decoys and flowers a round never fall; the last level is above the first', () => {
  for (const m of MODES) for (const [a, b] of [[1, 10], [11, 20]]) {
    for (const k of ['bottles', 'pours', 'pool', 'decoys', 'flowers', 'score']) assert.ok(nonDecreasing(col(m, k, a, b)), `${m} ${a}-${b}: ${k} falls: ${col(m, k, a, b).join(',')}`);
    assert.ok(DIFF[m][b - 1].score > DIFF[m][a - 1].score, `${m}: level ${b} is not above level ${a}`);
  }
});
check('the steps come where the design says: bottles 3/4/5 at levels 1/4/7, three-bottle mixes, decoys at 16, double rounds at 18', () => {
  const hs = DIFF.hard, md = DIFF.medium, ez = DIFF.easy;
  assert.deepEqual([1, 4, 7].map((n) => md[n - 1].bottles), [3, 4, 5]); assert.deepEqual([1, 4, 7].map((n) => hs[n - 1].bottles), [3, 4, 5]);
  assert.deepEqual([1, 4, 7, 10, 11].map((n) => ez[n - 1].bottles), [3, 4, 4, 4, 5]);
  assert.ok(md[3].score > md[2].score && md[6].score > md[5].score && ez[3].score > ez[2].score);
  assert.equal(hs[10].pours > hs[9].pours, true); assert.equal(md[12].pours, 2); assert.ok(md[13].pours > md[12].pours);
  assert.ok(hs[15].decoys > hs[14].decoys && md[15].decoys > md[14].decoys && ez[15].decoys > ez[14].decoys);
  assert.equal(hs[16].flowers, 1); assert.ok(hs[17].flowers > 1); assert.ok(hs[19].flowers > hs[17].flowers); assert.equal(md[19].flowers, 1);
});
check('level 11 is above level 10 in every mode (World 2 starts a step above the end of World 1)', () => {
  for (const m of MODES) assert.ok(DIFF[m][10].score > DIFF[m][9].score, `${m}: ${DIFF[m][10].score} vs ${DIFF[m][9].score}`);
});
check('Easy < Medium < Hard on every level, and Easy is never harder than Medium in any single feature', () => {
  for (let n = 1; n <= 20; n++) {
    const e = DIFF.easy[n - 1], md = DIFF.medium[n - 1], h = DIFF.hard[n - 1];
    assert.ok(e.score < md.score && md.score < h.score, `level ${n}: ${e.score} ${md.score} ${h.score}`);
    for (const k of ['bottles', 'pours', 'pool', 'decoys', 'flowers']) { assert.ok(e[k] <= md[k] && md[k] <= h[k], `level ${n}: ${k} ${e[k]} ${md[k]} ${h[k]}`); }
  }
  const spread = [1, 10, 11, 20].map((n) => `${n}: ${DIFF.easy[n - 1].score.toFixed(0)}/${DIFF.medium[n - 1].score.toFixed(0)}/${DIFF.hard[n - 1].score.toFixed(0)}`);
  return 'easy/medium/hard scores at levels ' + spread.join(', ');
});
check('Easy is finishable by a very young child: two-bottle mixes at most, a single bottle on levels 1-3, a small table, a big snap', () => {
  for (let n = 1; n <= 20; n++) { const d = DIFF.easy[n - 1]; assert.ok(d.pours <= 2); assert.equal(d.flowers, 1); }
  assert.ok(DIFF.easy.slice(0, 10).every((d) => d.bottles <= 4));
  assert.ok(DIFF.hard[19].pours > 3 && DIFF.hard[19].flowers > 1.5);
});

// ---------------- the save ----------------
check('a fresh save has the fairy shape: v 1, mode, unlocked per mode, 20 stars per mode, coins', () => {
  const s = L.freshSave();
  assert.equal(s.v, 1); assert.equal(s.mode, 'easy'); assert.deepEqual(s.unlocked, { easy: 1, medium: 1, hard: 1 }); assert.equal(s.coins, 0);
  for (const m of MODES) assert.deepEqual(s.stars[m], new Array(20).fill(0));
});
check('finishing a level keeps the best stars, opens the next level of that mode only, and adds the chest coins', () => {
  const s = L.freshSave();
  L.record(s, 'medium', 1, 2, 8);
  assert.equal(s.stars.medium[0], 2); assert.equal(s.unlocked.medium, 2); assert.equal(s.unlocked.easy, 1); assert.equal(s.unlocked.hard, 1); assert.equal(s.coins, 8);
  L.record(s, 'medium', 1, 1, 8);
  assert.equal(s.stars.medium[0], 2);                              // a worse replay does not lower it
  L.record(s, 'medium', 1, 3, 8);
  assert.equal(s.stars.medium[0], 3); assert.equal(s.unlocked.medium, 2); assert.equal(s.coins, 24);
  L.record(s, 'hard', 20, 3, 12); assert.equal(s.unlocked.hard, 20);
});
check('World 2 opens when level 10 of that mode is finished', () => {
  const s = L.freshSave();
  for (let n = 1; n <= 9; n++) L.record(s, 'easy', n, 3, 5);
  assert.equal(L.worldOpen(s, 'easy'), false);
  L.record(s, 'easy', 10, 1, 5);
  assert.equal(L.worldOpen(s, 'easy'), true); assert.equal(L.worldOpen(s, 'hard'), false); assert.equal(s.unlocked.easy, 11);
});
check('a saved game survives a round trip, junk is repaired, and stars never unlock less than was earned', () => {
  const s = L.freshSave(); L.record(s, 'hard', 3, 2, 12); s.mode = 'hard';
  const back = L.migrate(JSON.stringify(s));
  assert.deepEqual(back, s);
  for (const junk of [null, undefined, '', 'not json', '[]', '5', '{"v":9,"mode":"nope","unlocked":{"easy":"x"},"stars":{"easy":[9,-1,"a"]},"coins":-5}']) {
    const b = L.migrate(junk);
    assert.ok(MODES.includes(b.mode)); assert.equal(b.v, 1); assert.ok(b.coins >= 0);
    for (const m of MODES) { assert.equal(b.stars[m].length, 20); assert.ok(b.stars[m].every((v) => v >= 0 && v <= 3)); assert.ok(b.unlocked[m] >= 1 && b.unlocked[m] <= 20); }
  }
  const odd = L.migrate({ mode: 'medium', unlocked: { medium: 1 }, stars: { medium: [3, 2, 0, 1] } });
  assert.equal(odd.unlocked.medium, 5);                            // level 4 was finished, so 5 is open
  assert.deepEqual(odd.stars.medium.slice(0, 4), [3, 2, 0, 1]);
});

// ---------------- frozen by fingerprint ----------------
const fps = {};
for (const m of MODES) { fps[m] = []; for (let n = 1; n <= 20; n++) fps[m].push(sha({ cfg: (({ n: a, mode, world, rounds, bottles, plan, decoys, dots, hint, snap, chest }) => ({ a, mode, world, rounds, bottles, plan, decoys, dots, hint, snap, chest }))(L.levelCfg(n, m)), rounds: L.makeRounds(n, m) })); }
if (WRITE) { fps.table = sha(L.TABLE); fs.writeFileSync(FP_FILE, JSON.stringify(fps, null, 1) + '\n'); console.log('wrote ' + FP_FILE); }
const frozen = fs.existsSync(FP_FILE) ? JSON.parse(fs.readFileSync(FP_FILE, 'utf8')) : null;
check('60 levels are frozen by fingerprint (the settings and every round of every mode and level)', () => {
  assert.ok(frozen, 'no fingerprints.json: run with --write once');
  for (const m of MODES) { assert.equal(frozen[m].length, 20); for (let n = 1; n <= 20; n++) assert.equal(fps[m][n - 1], frozen[m][n - 1], `${m} level ${n} has changed`); }
  return '60 fingerprints';
});
check('the table is frozen too', () => {
  assert.ok(frozen && frozen.table, 'no table fingerprint');
  assert.equal(sha(L.TABLE), frozen.table);
});

// ---------------- the files and the words ----------------
const WEB = path.join(ROOT, 'web/games/potions'), TESTS = __dirname;
check('hub-symbol.svg holds the symbol #i-potions in a 24 x 24 box', () => {
  const svg = fs.readFileSync(path.join(WEB, 'hub-symbol.svg'), 'utf8');
  assert.ok(/<symbol id="i-potions" viewBox="0 0 24 24">/.test(svg)); assert.ok(svg.includes('#ff6fb0') && svg.includes('#ffd23f') && svg.includes('#fff'));
});
check('none of the words the iOS bundle check forbids appear anywhere in the game or its tests (this file included)', () => {
  // the words are split up here so that this file does not contain them either
  const words = ['sol' + 'ana', 'wal' + 'let', 'us' + 'dc', 'jup' + 'iter', '\\bst' + 'ak(e|ed|ing)', 'dev' + 'net', 'main' + 'net', 'block' + 'chain', 'da' + 'pp', 'pages' + '\\.dev', 'mock' + 'pay'];
  const bad = new RegExp(words.join('|'), 'i');
  const hits = [];
  for (const dir of [WEB, TESTS]) for (const f of fs.readdirSync(dir)) { const t = fs.readFileSync(path.join(dir, f), 'utf8'); if (bad.test(t)) hits.push(f); }
  assert.deepEqual(hits, []);
});
check('the page links home to ../../index.html and the game declares window.__back, __pause and __dbg and the save key', () => {
  const g = fs.readFileSync(path.join(WEB, 'game.js'), 'utf8');
  assert.ok(g.includes("HUB = '../../index.html'")); assert.ok(g.includes('window.__back =')); assert.ok(g.includes('window.__pause =')); assert.ok(g.includes('window.__dbg ='));
  assert.ok(g.includes("SAVE_KEY = 'game.potions.save'"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
