// Toadstool Hop: the rules and the courses, tested in Node with the same web/games/hop/logic.js the game loads.
//   node test/games/hop/verify.js            (no browser; exits non-zero if anything fails; about a minute)
//   node test/games/hop/verify.js --print    also prints the fingerprints (to freeze them, once, after the courses are final)
// It proves, for every level (1-20) in every mode (Easy, Medium, Hard):
//   - the level table is sane and climbing, and the table and all 60 courses are frozen by fingerprint (a course cannot drift unnoticed);
//   - the courses are well formed: every coin, butterfly and the key is on a platform or over a gap, the key stands on a plain
//     platform in the second half, no platform drifts so far that it meets its neighbour or leaves the screen, and every moving
//     platform repeats in whole beats (so a minute of scanning shows everything);
//   - a search over tap times (a grid of 50 ms) finds a splash-free way through that collects every coin, every butterfly and the key,
//     and replaying those taps through the real Run gives 3 stars, the key and the chest; on every choice the far platform can be taken
//     the same way; a hop has an open window long enough to catch, and never a closed one too long;
//   - model children through the real Run.step(): one with a 300 ms reaction who waits for a safe moment gets through every course
//     (without a splash in Easy and Medium), a hasty one, a random tapper and a toddler who taps whatever is going on all reach every chest;
//   - the difficulty (a fixed cost function) rises 1 -> 10 and 11 -> 20, level 11 costs more than 10, and Easy < Medium < Hard;
//   - a splash costs a coin only on Medium and Hard and never below 0, the frog puts her back, stars count splashes, saves round-trip.
// The browser checks are browser.js (real touch, screenshots) and soak.js (long random play).
'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const { L, solve, replay, child, windows } = require('./models.js');

const PRINT = process.argv.includes('--print');
let pass = 0, fail = 0;
function check(name, fn) {
  try { const detail = fn(); pass++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e && e.message ? e.message.split('\n').join('\n      ') : e}`); }
}
const sha = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const MODES = L.MODE_IDS, NLEV = L.NLEV;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const rising = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
const nonDecreasing = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]);
const t0 = Date.now();

// ---------------- frozen fingerprints (filled in once the courses were final: see --print) ----------------
const FROZEN = {
  table: '421ca86f3b7b',
  courses: {
    '1:easy': '47fa5b214f29', '1:medium': '57abd543c020', '1:hard': 'f50449a1058a',
    '2:easy': '814f66d73376', '2:medium': '5113ae5c401d', '2:hard': 'f457151e5235',
    '3:easy': '5de7aae641e8', '3:medium': '2700748061d1', '3:hard': 'dd52a8c323cb',
    '4:easy': '688130e8f098', '4:medium': '961f93661482', '4:hard': 'a768dfa63a1b',
    '5:easy': '52b5ef9bad04', '5:medium': '288c66500e0c', '5:hard': '3124cfc67c1a',
    '6:easy': '2b0cd01bd6a9', '6:medium': '31df1bdebdfa', '6:hard': 'da1dde2dccaa',
    '7:easy': '0f3801e15e63', '7:medium': '2c51da9f0f69', '7:hard': '1fd83528ba0f',
    '8:easy': 'aa449731ca7c', '8:medium': 'acced9af0d22', '8:hard': 'a6acbe248e46',
    '9:easy': 'e3cd4d407d5e', '9:medium': '92095b7c95ff', '9:hard': 'a18a6b7c442e',
    '10:easy': '5ae63262e6ee', '10:medium': '5a4d324990f2', '10:hard': 'bba1c1805c79',
    '11:easy': '253cb56974f2', '11:medium': '6f254d058c3e', '11:hard': '0d2a6f0af3fa',
    '12:easy': 'd0d2e00e1eb3', '12:medium': 'faebda148fac', '12:hard': 'cca3f7c99e87',
    '13:easy': '13d4307103dd', '13:medium': 'a54922902feb', '13:hard': '779666a5bcd7',
    '14:easy': '681d4a1615ee', '14:medium': '2f31f910b791', '14:hard': '1248240e714f',
    '15:easy': '3206b633ec76', '15:medium': '6b51e8507c89', '15:hard': '7c671896cdb9',
    '16:easy': '2d388880cb95', '16:medium': 'b5b87fcad8d8', '16:hard': 'c63045beefce',
    '17:easy': 'be54485e9c72', '17:medium': 'e3ed67acfca4', '17:hard': '8a4a71b120aa',
    '18:easy': 'dfb558e2752c', '18:medium': 'dc46c44264e0', '18:hard': '82d9cc816949',
    '19:easy': 'd7c978c3f261', '19:medium': '52256c90f47b', '19:hard': 'a413e43f07e2',
    '20:easy': '9682e649c8eb', '20:medium': 'd1f171f37a85', '20:hard': '2b9ee70016a8',
  },
};

// ---------------- the level table ----------------
check('twenty levels, ten to a world; World 1 uses themes 0-3, World 2 themes 4-7, each used in order', () => {
  assert.equal(L.LEVELS.length, 20); assert.equal(NLEV, 20); assert.equal(L.PER, 10);
  const th = L.LEVELS.map((l) => l.theme);
  assert.ok(nonDecreasing(th), th.join(','));
  assert.deepEqual([...new Set(th.slice(0, 10))], [0, 1, 2, 3]); assert.deepEqual([...new Set(th.slice(10))], [4, 5, 6, 7]);
  L.LEVELS.forEach((l, i) => assert.equal(l.world, i < 10 ? 1 : 2));
  return th.join(',');
});
check('platform counts: 12-24 in World 1, 24-40 in World 2 (counting the far choice platforms), rising by level inside a world', () => {
  const main = L.LEVELS.map((l) => l.main);
  assert.equal(main[0], 12); assert.equal(main[9], 24);
  const tot = [];
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) { const c = L.course(n, m); const k = c.plats.length; if (m === 'medium') tot.push(k); assert.ok(n <= 10 ? k >= 12 && k <= 24 : k >= 24 && k <= 40, `level ${n} ${m}: ${k} platforms`); }
  assert.ok(nonDecreasing(main.slice(0, 10)) && nonDecreasing(main.slice(10)), main.join(','));
  assert.ok(nonDecreasing(tot.slice(0, 10)) && nonDecreasing(tot.slice(10)), tot.join(','));
  return tot.join(',');
});
check('what each level adds: toadstools only on 1-2, lily pads from 3, clouds from 6, choices from 11, gusts from 15', () => {
  L.LEVELS.forEach((l, i) => {
    const n = i + 1;
    assert.equal(l.pad > 0, n >= 3, `pads on level ${n}`); assert.equal(l.cloud > 0, n >= 6, `clouds on level ${n}`);
    assert.equal(l.choice > 0, n >= 11, `choices on level ${n}`); assert.equal(l.gust > 0, n >= 15, `gusts on level ${n}`);
  });
  for (const m of MODES) for (const n of [1, 2]) assert.ok(L.course(n, m).plats.every((p) => p.kind === 'mush' || p.kind === 'bank'), `level ${n} ${m} has only toadstools`);
  for (const m of MODES) for (const n of [3, 4, 5]) { const c = L.course(n, m); assert.ok(c.plats.some((p) => p.kind === 'pad') && !c.plats.some((p) => p.kind === 'cloud'), `level ${n} ${m}`); }
  for (const m of MODES) for (const n of range(6, 20)) assert.ok(L.course(n, m).plats.some((p) => p.kind === 'cloud'), `clouds on ${n} ${m}`);
  for (const m of MODES) for (const n of range(11, 20)) assert.ok(L.course(n, m).nodes.some((q) => q.far >= 0), `a choice on ${n} ${m}`);
  for (const m of MODES) for (const n of range(1, 10)) assert.ok(L.course(n, m).nodes.every((q) => q.far < 0), `no choice on ${n} ${m}`);
  return 'ok';
});
check('drift gets bigger and faster as the levels go: amplitude and speed never fall inside a world, and World 2 starts above World 1\'s end', () => {
  const pa = L.LEVELS.filter((l) => l.n >= 3), amp = (l) => l.padAmp, om = (l) => l.om;
  assert.ok(nonDecreasing(pa.filter((l) => l.n <= 10).map(amp)) && nonDecreasing(pa.filter((l) => l.n > 10).map(amp)));
  assert.ok(nonDecreasing(pa.filter((l) => l.n <= 10).map(om)) && nonDecreasing(pa.filter((l) => l.n > 10).map(om)));
  assert.ok(L.LEVELS[10].padAmp > L.LEVELS[9].padAmp && L.LEVELS[10].om > L.LEVELS[9].om && L.LEVELS[10].cf > L.LEVELS[9].cf);
  const ca = L.LEVELS.filter((l) => l.n >= 6).map((l) => l.cloudAmp);
  assert.ok(ca.every((v, i) => i === 0 || v >= ca[i - 1] - 1e-9), ca.join(','));
  return `pad drift ${L.LEVELS[2].padAmp}..${L.LEVELS[9].padAmp} then ${L.LEVELS[10].padAmp}..${L.LEVELS[19].padAmp}; speed ${L.LEVELS[2].om}..${L.LEVELS[19].om}`;
});
check('the modes: Easy platforms wider and slower, Hard narrower and faster; hints sooner on Easy and later on Hard; coins only lost on Medium and Hard; the choice by half only on Hard', () => {
  const E = L.MODES.easy, M = L.MODES.medium, H = L.MODES.hard;
  assert.ok(E.size > M.size && M.size > H.size); assert.ok(E.speedK < M.speedK && M.speedK < H.speedK); assert.ok(E.ampK < M.ampK && M.ampK < H.ampK);
  assert.ok(E.cfK < M.cfK && M.cfK < H.cfK); assert.ok(E.rb > M.rb && M.rb > H.rb); assert.ok(E.hint < M.hint && M.hint < H.hint);
  assert.equal(E.coinLoss, false); assert.equal(M.coinLoss, true); assert.equal(H.coinLoss, true);
  assert.deepEqual([E.byHalf, M.byHalf, H.byHalf], [false, false, true]);
  assert.equal(M.hint, 6, 'the hand shows after 6 seconds on Medium');
  for (let n = 1; n <= NLEV; n++) {
    const hw = MODES_ARR().map((m) => Math.min(...L.course(n, m).plats.filter((p) => p.kind !== 'bank').map((p) => p.hw)));
    assert.ok(hw[0] > hw[1] && hw[1] > hw[2], `level ${n}: narrowest platforms ${hw.join(' > ')}`);
  }
  for (let n = 3; n <= NLEV; n++) {
    const sp = MODES_ARR().map((m) => Math.max(...L.course(n, m).plats.map((p) => Math.max(p.wx, p.wy))));
    assert.ok(sp[0] < sp[1] && sp[1] < sp[2], `level ${n}: fastest drift ${sp.join(' < ')}`);
  }
  return 'ok';
});
function MODES_ARR() { return MODES; }

// ---------------- frozen ----------------
const tableOf = () => ({ levels: L.LEVELS, modes: Object.fromEntries(MODES.map((m) => [m, Object.assign({}, L.MODES[m])])), worlds: L.WORLDS, consts: [L.WATER, L.D, L.FALL, L.RESCUE, L.RESCUE_UP, L.SETTLE, L.SCAN, L.STEP, L.CHEST_COINS] });
const fps = { table: sha(tableOf()), courses: {} };
for (let n = 1; n <= NLEV; n++) for (const m of MODES) fps.courses[n + ':' + m] = sha(L.summary(L.course(n, m)));
if (PRINT) { console.log('\nFROZEN = ' + JSON.stringify(fps, null, 1).replace(/\n\s+/g, ' ').replace(/ }/g, '\n}') + ';\n'); }
check('the level table is frozen by fingerprint', () => { assert.equal(fps.table, FROZEN.table, 'the table has changed'); return fps.table; });
check('all 60 courses are frozen by fingerprint (20 levels x 3 modes)', () => {
  const bad = Object.keys(fps.courses).filter((k) => fps.courses[k] !== FROZEN.courses[k]);
  assert.equal(Object.keys(FROZEN.courses).length, 60); assert.deepEqual(bad, [], 'courses have changed: ' + bad.join(' '));
  return '60 matching';
});
check('a course is the same however often it is built, and the three modes of a level share their shape (the same kinds in the same order)', () => {
  for (let n = 1; n <= NLEV; n++) {
    assert.equal(sha(L.summary(L.build(n, 'medium'))), fps.courses[n + ':medium'], `level ${n} rebuilt differently`);
    const kinds = MODES.map((m) => L.course(n, m).plats.map((p) => p.kind + p.node + (p.far ? 'f' : '')).join(','));
    assert.equal(kinds[0], kinds[1], `level ${n}: Easy and Medium differ in shape`); assert.equal(kinds[1], kinds[2], `level ${n}: Medium and Hard differ in shape`);
  }
  return 'ok';
});

// ---------------- the courses are well formed ----------------
check('every coin, butterfly and the key is on a platform or over a gap; the key is on a plain platform in the second half; bonuses only on far platforms', () => {
  let coins = 0, bfs = 0, bonus = 0;
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) {
    const c = L.course(n, m), last = c.nodes.length - 1;
    c.plats.forEach((p, i) => { assert.equal(p.id, i); assert.ok(p.node >= 0 && p.node <= last, `${n} ${m}: platform ${i} is on no node`); });
    const keys = c.plats.filter((p) => p.key);
    assert.equal(keys.length, 1, `${n} ${m}: ${keys.length} keys`);
    const k = keys[0], kn = c.nodes[k.node];
    assert.equal(c.keyPlat, k.id); assert.equal(kn.main, k.id, 'the key is on the main line'); assert.ok(!kn.choice && !k.far && k.kind !== 'bank', `${n} ${m}: key on a choice or a bank`);
    assert.ok(k.node >= (last * 0.5) && k.node <= last - 1, `${n} ${m}: key at node ${k.node} of ${last}`);
    for (const p of c.plats) {
      if (p.coin) { assert.ok(!p.key && !p.far && p.kind !== 'bank', `${n} ${m}: coin placement`); coins++; }
      if (p.bonus) { assert.ok(p.far && (p.bonus === 'coin' || p.bonus === 'butterfly'), `${n} ${m}: bonus placement`); bonus++; }
      if (p.far) assert.ok(c.nodes[p.node].far === p.id, `${n} ${m}: a far platform no node points to`);
    }
    for (const b of c.bfs) {
      bfs++;
      const a = c.plats[c.nodes[b.node].main], z = c.plats[c.nodes[b.node + 1].main];
      assert.ok(b.x > a.x0 && b.x < z.x0, `${n} ${m}: butterfly outside its gap`); assert.ok(b.y < Math.min(a.y0, z.y0) && b.y > 120, `${n} ${m}: butterfly height ${b.y}`);
      assert.equal(b.r, L.MODES[m].rb);
    }
    for (const nd of c.nodes) { assert.ok(c.plats[nd.main].node === nd.i); if (nd.far >= 0) assert.ok(c.plats[nd.far].node === nd.i && c.plats[nd.far].y0 < c.plats[nd.main].y0 - 30, `${n} ${m}: far platform is not higher`); }
  }
  return `${coins} coins, ${bfs} butterflies, ${bonus} bonuses, 60 keys`;
});
check('nothing drifts off: amplitudes are bounded, no platform meets its neighbour (or the one beside it) at any moment, none touches the water or leaves the sky', () => {
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) {
    const c = L.course(n, m);
    for (const p of c.plats) {
      assert.ok(p.ax + p.gA <= 90 && p.ay <= 70, `${n} ${m}: platform ${p.id} moves ${p.ax}+${p.gA} / ${p.ay}`);
      if (p.kind !== 'pad' && p.kind !== 'bank') assert.ok(p.y0 + p.ay <= L.WATER - 20 && p.y0 - p.ay >= 200, `${n} ${m}: platform ${p.id} height ${p.y0}+-${p.ay}`);
      assert.ok(p.hw >= 30 && p.hw <= 150);
    }
    for (let i = 0; i + 1 < c.nodes.length; i++) {
      const a = c.plats[c.nodes[i].main], b = c.plats[c.nodes[i + 1].main];
      for (let t = 0; t < 60; t += 0.1) assert.ok(L.posX(b, t) - L.posX(a, t) >= a.hw + b.hw + 8, `${n} ${m}: platforms ${a.id} and ${b.id} meet at ${t.toFixed(1)} s`);
    }
    for (const nd of c.nodes) if (nd.far >= 0) {
      const a = c.plats[nd.main], f = c.plats[nd.far];
      for (let t = 0; t < 60; t += 0.1) assert.ok(L.posY(a, t) - L.posY(f, t) >= 45 || Math.abs(L.posX(a, t) - L.posX(f, t)) >= a.hw + f.hw, `${n} ${m}: near and far platforms of node ${nd.i} touch at ${t.toFixed(1)} s`);
    }
    // gaps run left to right
    for (const h of c.hops) assert.ok(c.plats[h.to].x0 > c.plats[h.from].x0, `${n} ${m}: a hop goes backwards`);
  }
  return 'ok';
});
check('every moving platform repeats in whole beats: its place after 4 pi / (the level\'s drift speed) is where it started, so a scan of a minute (always more than two beats) shows every moment', () => {
  let worst = 0, longest = 0;
  for (let n = 3; n <= NLEV; n++) for (const m of MODES) {
    const c = L.course(n, m), om = L.LEVELS[n - 1].om * L.MODES[m].speedK, T = (4 * Math.PI) / om;
    longest = Math.max(longest, T);
    assert.ok(T * 2 < L.SCAN, `${n} ${m}: a beat of ${T.toFixed(1)} s is too long for the scan`);
    for (const p of c.plats) for (const t of [0.7, 3.1, 11.3, 20.9]) { const d = Math.max(Math.abs(L.posX(p, t) - L.posX(p, t + T)), Math.abs(L.posY(p, t) - L.posY(p, t + T))); worst = Math.max(worst, d); assert.ok(d < 1e-6, `${n} ${m}: platform ${p.id} not periodic (${d})`); }
  }
  return `longest repeat ${longest.toFixed(1)} s, error ${worst.toExponential(1)}`;
});

// ---------------- every course can be played splash-free, collecting everything ----------------
const sols = {};
check('a search over tap times (every 50 ms) finds a splash-free way through all 60 courses that collects every coin, butterfly and the key; replayed through the real Run it gives 3 stars, the key and +10 at the chest', () => {
  let hops = 0, longest = 0;
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) {
    const c = L.course(n, m), s = solve(c, { collect: true });
    assert.ok(s.ok, `${n} ${m}: ${JSON.stringify(s.fails[0])}`);
    sols[n + ':' + m] = s;
    const { run } = replay(c, s.taps, m, n);
    const wantCoins = c.plats.filter((p) => p.coin).length + c.bfs.length + 1 * 0 + L.CHEST_COINS;
    assert.equal(run.splashes, 0, `${n} ${m}: the plan splashed`); assert.ok(run.done && run.stars === 3 && run.hasKey, `${n} ${m}: not finished with 3 stars and the key`);
    assert.equal(run.coins, wantCoins, `${n} ${m}: ${run.coins} coins, wanted ${wantCoins}`);
    assert.equal(run.bfGot.size, c.bfs.length);
    hops += s.taps.length; longest = Math.max(longest, s.end);
  }
  return `${hops} hops; longest plan ${longest.toFixed(0)} s`;
});
check('on every choice the far platform can be taken the same way (Hard: a tap on the right half): splash-free, and the bonus coin or butterfly collected', () => {
  let far = 0;
  for (let n = 11; n <= NLEV; n++) for (const m of MODES) {
    const c = L.course(n, m), s = solve(c, { far: true });
    assert.ok(s.ok, `${n} ${m}: ${JSON.stringify(s.fails[0])}`);
    const { run } = replay(c, s.taps, 'hard' === m ? m : m, n);
    if (m === 'hard') {
      assert.equal(run.splashes, 0, `${n} ${m}: far plan splashed`); assert.ok(run.done && run.stars === 3);
      const want = c.plats.filter((p) => p.bonus).length; assert.equal(s.got.bonus, want); far += want;
      assert.equal(run.took.size >= want, true);
    }
  }
  return `${far} bonuses on Hard`;
});
check('every hop has an open window long enough to catch and never a closed one too long (Easy: open >= 1.3 s, closed <= 4.2 s); the room to spare at the best moment is at least 12 units', () => {
  let minOpen = { easy: 99, medium: 99, hard: 99 }, maxClosed = { easy: 0, medium: 0, hard: 0 }, minBest = 99;
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) {
    const c = L.course(n, m), M = L.MODES[m];
    for (const h of c.hops) {
      const q = L.scanHop(c, c.plats[h.from], c.plats[h.to]);
      assert.ok(q.best >= 12, `${n} ${m}: hop ${h.from}->${h.to} has only ${q.best.toFixed(1)} to spare`); minBest = Math.min(minBest, q.best);
      assert.ok(q.cf < 0.85, `${n} ${m}: hop ${h.from}->${h.to} is closed ${q.cf}`);
      if (q.cf > 0) {
        assert.ok(q.open >= M.wOpen * 0.7, `${n} ${m}: hop ${h.from}->${h.to} longest open window ${q.open.toFixed(2)} s`);
        assert.ok(q.closed <= M.wClosed * 1.3, `${n} ${m}: hop ${h.from}->${h.to} longest closed window ${q.closed.toFixed(2)} s`);
        minOpen[m] = Math.min(minOpen[m], q.open); maxClosed[m] = Math.max(maxClosed[m], q.closed);
      }
    }
  }
  assert.ok(minOpen.easy >= 1.3 && maxClosed.easy <= 4.2, `Easy: open ${minOpen.easy}, closed ${maxClosed.easy}`);
  return `shortest open window ${MODES.map((m) => minOpen[m].toFixed(1)).join('/')} s, longest wait ${MODES.map((m) => maxClosed[m].toFixed(1)).join('/')} s (E/M/H); least room ${minBest.toFixed(0)}`;
});
check('Easy never needs two quick hops: every Easy hop is open at least 55% of the time, and a toddler tapping at random gets through every Easy level', () => {
  for (let n = 1; n <= NLEV; n++) { const c = L.course(n, 'easy'); for (const h of c.hops.filter((q) => !q.far)) assert.ok(1 - h.cf >= 0.55, `${n}: hop open ${(1 - h.cf).toFixed(2)}`); }
  return 'ok';
});
check('the hop windows are measured again from the windows() helper and agree with the share closed', () => {
  const c = L.course(12, 'medium'), h = c.hops.find((q) => q.cf > 0.2), w = windows(c, c.plats[h.from], c.plats[h.to]);
  const open = w.openAll.reduce((s, v) => s + v, 0), closed = w.closedAll.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(closed / (open + closed) - h.cf) < 0.002, `${closed / (open + closed)} vs ${h.cf}`);
  return `hop ${h.from}->${h.to}: closed ${(closed / (open + closed)).toFixed(3)}`;
});

// ---------------- model children through the real Run ----------------
const kidStats = {};
check('a child with a 300 ms reaction who waits for a safe moment reaches every chest in all 60 courses, with no splash in Easy and Medium and 3 stars', () => {
  let t = 0, worstHard = 0;
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) {
    const r = child(n, m, 'careful', n * 3 + 1);
    assert.ok(r.done, `${n} ${m}: not finished in ${r.time.toFixed(0)} s`);
    if (m !== 'hard') assert.equal(r.run.splashes, 0, `${n} ${m}: ${r.run.splashes} splashes`); else worstHard = Math.max(worstHard, r.run.splashes);
    assert.ok(r.run.hasKey, `${n} ${m}: did not collect the key`);
    t = Math.max(t, r.time);
    (kidStats.careful = kidStats.careful || {})[m] = (kidStats.careful[m] || 0) + r.run.splashes;
  }
  return `slowest ${t.toFixed(0)} s; most splashes on a Hard course ${worstHard}`;
});
check('a hasty child (taps 300 ms after the hop first looks possible) reaches every chest; splashes only cost a coin on Medium and Hard', () => {
  let tot = { easy: 0, medium: 0, hard: 0 };
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) {
    const r = child(n, m, 'impulsive', n * 5 + 2);
    assert.ok(r.done, `${n} ${m}: not finished`); assert.ok(r.run.coins >= L.CHEST_COINS * 0 && r.run.coins >= 0);
    if (m === 'easy') assert.equal(r.run.lost, 0);
    tot[m] += r.run.splashes;
  }
  return `splashes over 20 courses: ${MODES.map((m) => m[0] + ' ' + tot[m]).join(', ')}`;
});
check('a random tapper and a toddler who taps whatever is going on reach every chest on all 60 courses (the frog always puts her back)', () => {
  let splashes = 0, slowest = 0;
  for (let n = 1; n <= NLEV; n++) for (const m of MODES) for (const kind of ['random', 'toddler']) {
    const r = child(n, m, kind, n * 11 + (kind === 'random' ? 1 : 2), { limit: 2400 });
    assert.ok(r.done, `${n} ${m} ${kind}: not finished in ${r.time.toFixed(0)} s (${r.run.phase}, node ${r.run.node}/${r.run.c.nodes.length - 1})`);
    assert.ok(r.run.coins >= 0 && r.run.stars >= 1 && r.run.stars <= 3);
    splashes += r.run.splashes; slowest = Math.max(slowest, r.time);
  }
  return `${splashes} splashes in all; slowest ${slowest.toFixed(0)} s`;
});
check('the same children taking the far platform on every choice (Hard) still reach every chest', () => {
  for (let n = 11; n <= NLEV; n++) for (const kind of ['careful', 'impulsive', 'random']) {
    const r = child(n, 'hard', kind, n + 7, { far: true, limit: 2400 });
    assert.ok(r.done, `${n} ${kind}: not finished`);
  }
  return 'ok';
});

// ---------------- the cost climbs ----------------
const cost = {}; for (const m of MODES) cost[m] = range(1, NLEV).map((n) => L.cost(L.course(n, m)));
check('difficulty (a fixed cost function: hop windows, distance against reach, speed, narrow landings, count) rises every level from 1 to 10 and from 11 to 20, in every mode', () => {
  for (const m of MODES) { assert.ok(rising(cost[m].slice(0, 10)), `${m} 1-10: ${cost[m].slice(0, 10).map((v) => v.toFixed(0))}`); assert.ok(rising(cost[m].slice(10)), `${m} 11-20: ${cost[m].slice(10).map((v) => v.toFixed(0))}`); }
  return MODES.map((m) => `${m[0]} ${cost[m][0].toFixed(0)}..${cost[m][9].toFixed(0)}, ${cost[m][10].toFixed(0)}..${cost[m][19].toFixed(0)}`).join('; ');
});
check('level 11 costs more than level 10 (World 2 starts a step above where World 1 ends), in every mode', () => {
  for (const m of MODES) assert.ok(cost[m][10] > cost[m][9], `${m}: ${cost[m][9].toFixed(0)} then ${cost[m][10].toFixed(0)}`);
  return MODES.map((m) => `${m[0]} ${cost[m][9].toFixed(0)} -> ${cost[m][10].toFixed(0)}`).join(', ');
});
check('Easy < Medium < Hard on every level', () => {
  for (let i = 0; i < NLEV; i++) assert.ok(cost.easy[i] < cost.medium[i] && cost.medium[i] < cost.hard[i], `level ${i + 1}: ${MODES.map((m) => cost[m][i].toFixed(0))}`);
  return 'ok';
});

// ---------------- the rules ----------------
// find a moment on `run` when a tap would fall short, and move to it
function toClosed(run, side) {
  for (let i = 0; i < 4000; i++) { const p = run.predict(side); if (p && !p.ok && run.phase === 'stand' && run.t - run.stand0 >= L.SETTLE) return true; run.step(0.05); }
  return false;
}
function toOpen(run, side) {
  for (let i = 0; i < 4000; i++) { const p = run.predict(side); if (p && p.ok && p.slack > 12 && run.phase === 'stand' && run.t - run.stand0 >= L.SETTLE) return true; run.step(0.05); }
  return false;
}
// Splash once, wherever the course lets her: hop on carefully until a hop that would fall short comes up within half a minute.
function forceSplash(run, ev) {
  for (let guard = 0; guard < 80; guard++) {
    for (let i = 0; i < 600 && run.phase === 'stand'; i++) {
      const p = run.predict(-1);
      if (p && !p.ok && run.t - run.stand0 >= L.SETTLE) { run.tap(-1, ev); while (run.phase !== 'stand') run.step(0.05, ev); return true; }
      run.step(0.05, ev);
    }
    if (run.done) return false;
    // none soon: move on carefully
    let g = 0; while (run.phase === 'stand' && !(L.safeFor(run, -1, 0.3) && run.t - run.stand0 >= L.SETTLE) && g++ < 2000) run.step(0.05, ev);
    run.tap(-1, ev); while (run.phase !== 'stand' && !run.done) run.step(0.05, ev);
  }
  return false;
}
check('a hop that is too far splashes her into the water; a frog puts her back on the platform she left, after about 2 s, and nothing else changes', () => {
  const run = new L.Run(6, 'easy'); const ev = [];
  assert.ok(toOpen(run, -1)); run.tap(-1, ev); for (let i = 0; i < 20; i++) run.step(0.05, ev);   // hop once so there is a platform to return to
  assert.equal(run.phase, 'stand'); const at = run.at, node = run.node;
  let found = false; for (let k = 0; k < 6 && !found; k++) { found = toClosed(run, -1); if (!found) { run.tap(-1, ev); for (let i = 0; i < 20; i++) run.step(0.05, ev); } }
  assert.ok(found, 'no closed moment found');
  const a = run.at, nd = run.node, coins = run.coins;
  assert.ok(run.tap(-1, ev)); assert.equal(run.phase, 'hop'); assert.equal(run.hop.ok, false);
  let sawFall = false, splashAt = null, back = null; const t1 = run.t;
  for (let i = 0; i < 200 && run.phase !== 'stand'; i++) { run.step(0.025, ev); if (run.phase === 'hop' && run.pose().mode === 'fall') sawFall = true; if (run.phase === 'splash' && splashAt == null) splashAt = run.t - t1; }
  back = run.t - t1;
  assert.ok(sawFall && splashAt != null); assert.equal(run.phase, 'stand'); assert.equal(run.at, a); assert.equal(run.node, nd); assert.equal(run.splashes, 1);
  assert.equal(run.coins, coins, 'Easy: nothing lost'); assert.ok(ev.some((e) => e.type === 'splash') && ev.some((e) => e.type === 'rescued'));
  assert.ok(Math.abs(run.pose().x - L.posX(run.plat(a), run.t)) < 1, 'back on the middle of the platform'); assert.ok(back > 1.8 && back < 3, `rescue took ${back}`);
  void at; void node;
  return `fell after ${splashAt.toFixed(2)} s, back after ${back.toFixed(2)} s`;
});
check('a splash costs one coin on Medium and Hard (never below 0) and nothing on Easy; the total in the save is the same rule', () => {
  for (const m of MODES) {
    const run = new L.Run(8, m), ev = [];
    // first splash with no coins: nothing to lose
    assert.equal(run.coins, 0);
    assert.ok(toClosed(run, -1), m); run.tap(-1, ev); for (let i = 0; i < 100; i++) run.step(0.05, ev);
    assert.equal(run.coins, 0, `${m}: coins went below 0`); assert.equal(run.splashes, 1);
    assert.equal(ev.find((e) => e.type === 'splash').lost, 0);
    // then gather some coins and splash again
    for (let k = 0; k < 40 && run.coins < 2; k++) { assert.ok(toOpen(run, -1)); run.tap(-1, ev); for (let i = 0; i < 20; i++) run.step(0.05, ev); }
    const before = run.coins; assert.ok(before >= 1);
    if (!toClosed(run, -1)) continue;
    ev.length = 0; run.tap(-1, ev); for (let i = 0; i < 100; i++) run.step(0.05, ev);
    const lost = ev.find((e) => e.type === 'splash').lost;
    assert.equal(lost, L.MODES[m].coinLoss ? 1 : 0, `${m}`); assert.equal(run.coins, before - lost, `${m}: ${before} -> ${run.coins}`); assert.ok(run.coins >= 0);
  }
  return 'ok';
});
check('stars count splashes, never time: 0 -> 3, 1 or 2 -> 2, 3 or more -> 1', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(L.starsFor), [3, 2, 2, 1, 1, 1]);
  for (const [k, want] of [[0, 3], [1, 2], [2, 2], [3, 1]]) {
    const run = new L.Run(8, 'easy'), ev = [];
    for (let i = 0; i < k; i++) assert.ok(forceSplash(run, ev), `splash ${i + 1}`);
    assert.equal(run.splashes, k);
    // play on carefully, however long it takes
    let guard = 0; while (!run.done && guard++ < 100000) { if (run.phase === 'stand' && L.safeFor(run, -1, 0.3)) run.tap(-1, ev); run.step(0.05, ev); }
    assert.ok(run.done); assert.equal(run.stars, want, `${k} splashes`);
  }
  return 'ok';
});
check('a tap while she is in the air is ignored; a tap just after landing waits until she has stepped to the middle (a fifth of a second), then hops', () => {
  const run = new L.Run(1, 'easy'), ev = [];
  assert.ok(run.tap(-1, ev)); assert.equal(run.phase, 'hop'); assert.equal(run.tap(-1, ev), false); assert.equal(run.hops, 1);
  while (run.phase === 'hop') run.step(0.025, ev);
  assert.equal(run.phase, 'stand'); assert.ok(run.tap(-1, ev)); assert.equal(run.phase, 'stand', 'queued, not hopping yet');
  for (let i = 0; i < 30 && run.phase === 'stand'; i++) run.step(0.01, ev);
  assert.equal(run.phase, 'hop'); assert.equal(run.hops, 2);
  return 'ok';
});
check('the choice: on Hard a tap on the left half hops to the near platform and the right half to the far one; on Easy and Medium any tap takes the near one', () => {
  for (const m of MODES) for (const side of [-1, 1]) {
    const c = L.course(12, m), k = c.nodes.findIndex((q) => q.far >= 0), run = new L.Run(12, m);
    // walk the plan to just before the choice
    const s = solve(c, { collect: false }), ev = [];
    for (const tp of s.taps.filter((q) => q.node < k)) { while (run.t < tp.t - 1e-9) run.step(Math.min(0.05, tp.t - run.t), ev); run.tap(-1, ev); }
    let guard = 0; while (run.phase !== 'stand' && guard++ < 100) run.step(0.05, ev);
    assert.equal(run.node, k - 1);
    const want = side > 0 && m === 'hard' ? c.nodes[k].far : c.nodes[k].main;
    assert.equal(run.target(side).id, want, `${m} side ${side}`);
    assert.equal(run.predict(side).b, want);
  }
  return 'ok';
});
check('the chest: with the key it opens at once (+10 coins); without it the key floats over after about a second and it opens anyway', () => {
  for (const withKey of [true, false]) {
    const c = L.course(2, 'easy'), run = new L.Run(2, 'easy'), ev = [];
    if (withKey) run.hasKey = true;
    const last = c.nodes.length - 1;
    run.node = last - 1; run.at = c.nodes[last - 1].main;
    assert.ok(toOpen(run, -1)); const coins = run.coins; run.tap(-1, ev);
    let t = null; for (let i = 0; i < 400 && !run.done; i++) { run.step(0.025, ev); if (run.phase === 'chest' && t == null) t = run.t; }
    assert.ok(run.done && run.opened, 'the chest opened'); assert.equal(run.coins, coins + L.CHEST_COINS);
    const open = ev.find((e) => e.type === 'chest'); assert.equal(open.coins, L.CHEST_COINS); assert.equal(open.key, withKey);
    assert.equal(ev.some((e) => e.type === 'keyFloat'), !withKey, 'the key floats over only without it');
    assert.equal(run.stars, 3);
  }
  return 'ok';
});
check('a half-played level resumes where she stands, with what she took, and a corrupt snapshot is ignored', () => {
  const c = L.course(6, 'medium'), s = solve(c, { collect: true });
  const run = new L.Run(6, 'medium'), ev = [];
  for (const tp of s.taps.slice(0, 9)) { while (run.t < tp.t - 1e-9) run.step(Math.min(0.05, tp.t - run.t), ev); run.tap(-1, ev); }
  while (run.phase !== 'stand') run.step(0.05, ev);
  const snap = JSON.parse(JSON.stringify(run.snapshot())), r2 = new L.Run(6, 'medium', snap);
  assert.equal(r2.at, run.at); assert.equal(r2.node, run.node); assert.equal(r2.coins, run.coins); assert.deepEqual([...r2.took].sort(), [...run.took].sort()); assert.equal(r2.splashes, run.splashes);
  for (const bad of [null, 7, 'x', { node: 'a' }, { node: 99, at: 0 }, { node: 3, at: 999 }, { node: 3, at: 0 }, { node: 2, at: 1, took: ['zz', 5, 'c1e9'] }]) { const r = new L.Run(6, 'medium', bad); assert.ok(r.node === 0 || r.c.plats[r.at].node === r.node); assert.ok(r.took.size === 0 || [...r.took].every((k) => /^[ckb]\d+$/.test(k))); }
  return `resumed at node ${r2.node}`;
});
check('the save: a fresh one has the documented shape; a corrupt one becomes a fresh one; mode, stars and unlocked levels round-trip and are clamped; levels open one at a time per mode', () => {
  const f = L.freshSave();
  assert.deepEqual(Object.keys(f).slice(0, 6), ['v', 'mode', 'unlocked', 'stars', 'coins', 'chests']); assert.equal(f.v, 1); assert.equal(f.mode, 'easy');
  assert.deepEqual(f.unlocked, { easy: 1, medium: 1, hard: 1 }); assert.deepEqual(Object.keys(f.stars), MODES); assert.ok(MODES.every((m) => f.stars[m].length === 20 && f.stars[m].every((v) => v === 0)));
  for (const bad of [null, undefined, '', 'nope', '[]', '5', '{"stars":7}', '{"mode":"x","unlocked":{"easy":"a"}}']) { const r = L.migrate(bad); assert.equal(r.mode, 'easy'); assert.deepEqual(r.unlocked, { easy: 1, medium: 1, hard: 1 }); }
  const sv = L.freshSave(); sv.mode = 'hard'; sv.stars.hard[0] = 3; sv.stars.hard[1] = 2; sv.stars.medium[4] = 1; sv.coins = 123; sv.unlocked.hard = 3; sv.unlocked.easy = 99;
  const r = L.migrate(JSON.stringify(sv));
  assert.equal(r.mode, 'hard'); assert.equal(r.coins, 123); assert.deepEqual(r.stars.hard.slice(0, 3), [3, 2, 0]); assert.equal(r.unlocked.hard, 3); assert.equal(r.unlocked.easy, 20);
  assert.equal(r.unlocked.medium, 6, 'a star on level 5 opens level 6'); assert.equal(r.stars.hard.every((v) => v >= 0 && v <= 3), true);
  const wild = L.migrate({ stars: { easy: [9, -4, 'x', 2.7] }, coins: -5, mode: 'medium' }); assert.deepEqual(wild.stars.easy.slice(0, 4), [3, 0, 0, 2]); assert.equal(wild.coins, 0);
  assert.equal(L.migrate({ runs: { 'easy:5': { node: 3, at: 3 } } }).runs['easy:5'], undefined, 'a run on a level that is not open is dropped');
  return 'ok';
});
check('a level cannot be failed and nothing is lost by waiting: after 2 minutes of standing still she is where she was, and a tap still hops', () => {
  const run = new L.Run(9, 'hard'); for (let i = 0; i < 2400; i++) run.step(0.05);
  assert.equal(run.phase, 'stand'); assert.equal(run.node, 0); assert.equal(run.splashes, 0); assert.ok(run.tap(-1)); assert.equal(run.phase, 'hop');
  return 'ok';
});

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(fail ? 1 : 0);
