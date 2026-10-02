// Shell Match rules, tested in Node with the same file the game loads.   usage: node --test test/games/match/logic.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../../web/games/match/logic.js');

const kindsOf = (cards) => cards.map((c) => (typeof c === 'string' ? c : c.kind));
function countKinds(list) { const m = {}; for (const k of list) m[k] = (m[k] || 0) + 1; return m; }

test('the six levels are 2, 3, 4, 6, 8 and 10 pairs, and only the bigger ones shuffle', () => {
  assert.deepEqual(M.LEVELS.map((l) => l.pairs), [2, 3, 4, 6, 8, 10]);
  assert.deepEqual(M.LEVELS.map((l) => l.swaps), [0, 0, 0, 1, 2, 2]);
  assert.equal(new Set(M.CREATURES).size, 10, 'ten different creatures, enough for 10 pairs');
});

test('shuffle is deterministic: the same seed deals the same board', () => {
  for (let level = 1; level <= 6; level++) {
    for (const seed of [0, 1, 42, 1234, 0xffffffff, 987654321]) {
      assert.deepEqual(M.deal(level, seed), M.deal(level, seed));
      assert.deepEqual(kindsOf(new M.Board(level, seed).cards), M.deal(level, seed).order);
    }
  }
  // seeds are taken as unsigned 32-bit numbers
  assert.deepEqual(M.deal(6, -1), M.deal(6, 0xffffffff));
});

test('shuffle is pinned: these seeds always deal exactly these boards', () => {
  // If this fails, the shuffle changed: a seed in a bug report would no longer reproduce the board.
  assert.equal(M.deal(1, 1).order.join(','), PINNED.l1s1);
  assert.equal(M.deal(6, 1234).order.join(','), PINNED.l6s1234);
  assert.deepEqual(M.deal(6, 1234).swaps, PINNED.l6s1234swaps);
});
const PINNED = {
  l1s1: 'turtle,starfish,turtle,starfish',
  l6s1234: 'whale,seahorse,starfish,turtle,whale,crab,puffer,dolphin,jelly,jelly,octopus,dolphin,clownfish,seahorse,crab,clownfish,turtle,octopus,starfish,puffer',
  l6s1234swaps: [[5, 10], [8, 13]],
};

test('different seeds give different boards', () => {
  for (let level = 1; level <= 6; level++) {
    const seen = new Set();
    for (let seed = 0; seed < 200; seed++) seen.add(M.deal(level, seed).order.join(','));
    assert.ok(seen.size > (level === 1 ? 60 : 190), `level ${level}: only ${seen.size} distinct boards in 200 seeds`);
  }
});

test('every pair is present: each creature exactly twice, before and after the start-of-level swaps', () => {
  for (let level = 1; level <= 6; level++) {
    const L = M.LEVELS[level - 1];
    for (let seed = 0; seed < 500; seed++) {
      const b = new M.Board(level, seed * 2654435761);
      assert.equal(b.cards.length, 2 * L.pairs);
      assert.equal(b.kinds.length, L.pairs);
      assert.equal(new Set(b.kinds).size, L.pairs, 'no creature used for two pairs');
      for (const k of b.kinds) assert.ok(M.CREATURES.includes(k), k);
      const before = countKinds(kindsOf(b.cards));
      assert.deepEqual(Object.keys(before).sort(), b.kinds.slice().sort());
      for (const k of b.kinds) assert.equal(before[k], 2, `${k} appears ${before[k]} times (level ${level}, seed ${seed})`);
      assert.deepEqual(new Set(b.cards.map((c) => c.id)).size, b.cards.length, 'every shell has its own id');
      // the swaps: as many as the level says, each moving two shells with different creatures, no shell twice
      assert.equal(b.swaps.length, L.swaps);
      const used = new Set();
      for (const [x, y] of b.swaps) {
        assert.ok(x !== y && !used.has(x) && !used.has(y));
        used.add(x); used.add(y);
        assert.notEqual(b.cards[x].kind, b.cards[y].kind, 'a swap that moves nothing visible');
      }
      const ids = b.cards.map((c) => c.id);
      b.begin();
      assert.deepEqual(countKinds(kindsOf(b.cards)), before, 'swaps keep every pair');
      for (const [x, y] of b.swaps) { assert.equal(b.cards[x].id, ids[y]); assert.equal(b.cards[y].id, ids[x]); }
    }
  }
});

test('star thresholds: 3 stars at mismatches <= pairs/2, 2 stars at <= pairs, else 1', () => {
  const table = {
    2: [3, 3, 2, 1, 1],
    3: [3, 3, 2, 2, 1, 1],
    4: [3, 3, 3, 2, 2, 1],
    6: [3, 3, 3, 3, 2, 2, 2, 1],
    8: [3, 3, 3, 3, 3, 2, 2, 2, 2, 1],
    10: [3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1],
  };
  for (const [pairs, want] of Object.entries(table)) {
    want.forEach((stars, mismatches) => assert.equal(M.starsFor(+pairs, mismatches), stars, `pairs ${pairs}, mismatches ${mismatches}`));
  }
  for (let pairs = 1; pairs <= 12; pairs++) {
    for (let m = 0; m <= 40; m++) {
      const want = m <= pairs / 2 ? 3 : m <= pairs ? 2 : 1;
      assert.equal(M.starsFor(pairs, m), want);
    }
  }
});

test('the board: open, match, mismatch, and extra taps ignored while two shells are open', () => {
  const b = new M.Board(3, 7);
  assert.deepEqual(b.tap(0), { type: 'ignored', why: 'phase' }, 'no taps during the peek and shuffle');
  b.begin();
  assert.equal(b.phase, 'play');
  const pos = (k, not) => b.cards.findIndex((c, i) => c.kind === k && i !== not);
  const k0 = b.cards[0].kind, twin = pos(k0, 0), other = b.cards.findIndex((c) => c.kind !== k0);

  // a mismatch
  assert.deepEqual(b.tap(0), { type: 'open', pos: 0 });
  assert.deepEqual(b.tap(0), { type: 'ignored', why: 'open' }, 'the same shell twice is not a move');
  const third = b.cards.findIndex((c, i) => i !== 0 && i !== other);
  assert.equal(b.tap(other).type, 'mismatch');
  assert.equal(b.mismatches, 1); assert.equal(b.moves, 1); assert.ok(b.busy);
  assert.deepEqual(b.tap(third), { type: 'ignored', why: 'busy' }, 'a third shell stays shut while two are open');
  assert.equal(b.cards[third].state, 'down');
  assert.deepEqual(b.settle(), { type: 'closed', a: 0, b: other });
  assert.equal(b.cards[0].state, 'down'); assert.equal(b.cards[other].state, 'down'); assert.ok(!b.busy);
  assert.equal(b.settle(), null, 'nothing to settle');

  // a match
  b.tap(twin);
  const r = b.tap(0);
  assert.equal(r.type, 'match'); assert.equal(r.kind, k0);
  assert.deepEqual(b.tap(third), { type: 'ignored', why: 'busy' });
  assert.equal(b.settle().type, 'matched');
  assert.equal(b.cards[0].state, 'matched'); assert.equal(b.cards[twin].state, 'matched');
  assert.deepEqual(b.tap(0), { type: 'ignored', why: 'matched' });
  assert.deepEqual(b.tap(99), { type: 'ignored', why: 'none' });
  assert.equal(b.mismatches, 1); assert.equal(b.matches, 1); assert.equal(b.moves, 2);

  // finish: the last pair wins with the stars for 1 mismatch in 3 pairs
  let last;
  for (const k of b.kinds) {
    const [a, c] = b.cards.map((x, i) => (x.kind === k && x.state === 'down' ? i : -1)).filter((i) => i >= 0);
    if (a == null) continue;
    b.tap(a); b.tap(c); last = b.settle();
  }
  assert.deepEqual(last.type, 'win');
  assert.equal(last.stars, 3); assert.equal(b.phase, 'done'); assert.equal(b.stars, 3);
  assert.deepEqual(b.tap(0), { type: 'ignored', why: 'phase' });
});

// Plays a board by reading where everything is. `miss` deliberate mismatches first, then perfectly.
function solve(b, miss) {
  b.begin();
  for (let i = 0; i < miss; i++) {
    const down = b.cards.map((c, p) => (c.state === 'down' ? p : -1)).filter((p) => p >= 0);
    const a = down[0], c = down.find((p) => b.cards[p].kind !== b.cards[a].kind);
    assert.equal(b.tap(a).type, 'open'); assert.equal(b.tap(c).type, 'mismatch'); assert.equal(b.settle().type, 'closed');
  }
  let res = null;
  while (b.phase === 'play') {
    const a = b.cards.findIndex((c) => c.state === 'down');
    const c = b.cards.findIndex((x, p) => p !== a && x.kind === b.cards[a].kind);
    b.tap(a); assert.equal(b.tap(c).type, 'match'); res = b.settle();
  }
  return res;
}

test('a perfect player gets 3 stars on every level; deliberate mismatches cost stars', () => {
  for (let level = 1; level <= 6; level++) {
    const pairs = M.LEVELS[level - 1].pairs;
    for (let seed = 0; seed < 50; seed++) {
      const res = solve(new M.Board(level, seed), 0);
      assert.equal(res.type, 'win'); assert.equal(res.stars, 3);
    }
    for (let miss = 0; miss <= pairs + 2; miss++) {
      const b = new M.Board(level, 1000 + miss), res = solve(b, miss);
      assert.equal(b.mismatches, miss);
      assert.equal(res.stars, M.starsFor(pairs, miss), `level ${level} with ${miss} mismatches`);
    }
  }
});

// ---- layout: big shells that fit the screen and stay clear of the home button ----
const VIEWS = { seeker: [1335, 600], tablet: [1024, 768], hd: [1920, 1080], phone: [2340, 1080], wxga: [1280, 800], wide: [800, 360] };
test('layout: every shell on screen, none overlapping, none under the home button, every centre maps back', () => {
  for (const [name, [w, h]] of Object.entries(VIEWS)) {
    const VW = (M.WORLD_H * w) / h;
    for (let level = 1; level <= 6; level++) {
      const n = M.LEVELS[level - 1].pairs * 2, lay = M.layout(n, VW);
      assert.equal(lay.cells.length, n);
      assert.equal(lay.cols * lay.rows, n);
      lay.cells.forEach((c, i) => {
        assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= VW + 1e-6 && c.y + c.h <= M.WORLD_H + 1e-6, `${name} L${level} cell ${i} off screen`);
        assert.ok(c.x >= M.HOME || c.y >= M.HOME, `${name} L${level} cell ${i} under the home button`);
        assert.equal(M.cellAt(lay, c.x + c.w / 2, c.y + c.h / 2), i);
        for (let j = 0; j < i; j++) {
          const d = lay.cells[j];
          assert.ok(c.x >= d.x + d.w || d.x >= c.x + c.w || c.y >= d.y + d.h || d.y >= c.y + c.h, `${name} L${level} cells ${i},${j} overlap`);
        }
      });
      assert.equal(M.cellAt(lay, 2, 2), -1, 'the corner is not a shell');
    }
  }
});

test('layout: targets at least 19vh on the Seeker and at 1024x768 (all levels), at least 15vh at 10 pairs everywhere', () => {
  const vh = (lay) => (lay.target / M.WORLD_H) * 100, report = [];
  for (const [name, [w, h]] of Object.entries(VIEWS)) {
    const VW = (M.WORLD_H * w) / h, row = [];
    for (let level = 1; level <= 6; level++) {
      const lay = M.layout(M.LEVELS[level - 1].pairs * 2, VW), t = vh(lay);
      row.push(`${lay.cols}x${lay.rows} ${t.toFixed(1)}`);
      if (name === 'seeker' || name === 'tablet') assert.ok(t >= 19, `${name} level ${level}: ${t.toFixed(1)}vh`);
      assert.ok(t >= 15, `${name} level ${level}: ${t.toFixed(1)}vh`);
    }
    report.push(`${name.padEnd(7)} ${w}x${h}: ${row.join(' | ')}`);
  }
  console.log('target size per level (grid, vh):\n  ' + report.join('\n  '));
});
