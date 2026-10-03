// Bubble Party: the rules and the level table, tested in Node with the same web/games/pop/logic.js the game loads.
//   node test/games/pop/verify.js          (no browser; exits non-zero if anything fails)
// The browser checks are test/games/pop/browser.js (play, touch, screenshots) and soak.js (long random play).
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
// POP_LOGIC=<path> runs these checks against another copy of logic.js (to prove they catch an injected defect)
const L = require(process.env.POP_LOGIC ? path.resolve(process.env.POP_LOGIC) : '../../../web/games/pop/logic.js');

// A real save from the old tap-to-pop game (v1), written by its own code: git 2fb835c web/games/pop, played in
// headless Chrome (ten friends, a party, a new sea, four more friends) and read back from localStorage.
const V1_SAVE = '{"v":1,"scene":1,"aquarium":[{"k":"jelly","c":"#ff7ac8"},{"k":"puffer","c":"#ffc93a"},{"k":"jelly","c":"#ff7ac8"},{"k":"jelly","c":"#ff7ac8"}],"total":14,"kinds":{"crab":3,"turtle":2,"fish":2,"seahorse":2,"starfish":1,"jelly":3,"puffer":1},"filled":1}';

let pass = 0, fail = 0;
function check(name, fn) {
  try { const detail = fn(); pass++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e && e.message ? e.message.split('\n').join('\n      ') : e}`); }
}
const LV = L.LEVELS, col = (k) => LV.map((l) => l[k]);
const nonDecreasing = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]);
const nonIncreasing = (a) => a.every((v, i) => i === 0 || v <= a[i - 1]);
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// n correct drops on level `run` (any of its icons, in turn)
function saveN(run, n) { const ks = run.cfg.kinds.map((k) => k[0]); let res; for (let i = 0; i < n; i++) res = run.drop(ks[i % ks.length], ks[i % ks.length]); return res; }

// ---------------- the level table ----------------
check('ten levels', () => { assert.equal(LV.length, 10); assert.equal(L.NLEV, 10); });
check('coin targets ramp from 3 (30 creatures) to 10 (100 creatures), a step of 0 or 1 each level', () => {
  const c = col('coins');
  assert.equal(c[0], 3); assert.equal(c[9], 10);
  c.forEach((v, i) => { if (i) assert.ok(v - c[i - 1] === 0 || v - c[i - 1] === 1, `level ${i + 1}: ${c[i - 1]} -> ${v}`); });
  return c.join(', ');
});
check('creature icons: 2 on level 1, 6-7 on level 10, never fewer than the level before', () => {
  const n = LV.map((l) => l.kinds.length);
  assert.equal(n[0], 2); assert.ok(n[9] >= 6 && n[9] <= 7, `level 10 has ${n[9]}`); assert.ok(nonDecreasing(n), n.join(','));
  return n.join(', ');
});
check('bubble speed never decreases and rises overall (gently: at most 4 units/s a level)', () => {
  const s = col('speed');
  assert.ok(nonDecreasing(s), s.join(',')); assert.ok(s[9] > s[0]);
  s.forEach((v, i) => { if (i) assert.ok(v - s[i - 1] <= 4, `level ${i + 1} jumps ${v - s[i - 1]}`); });
  return s.join(', ');
});
check('bubbles on screen never decrease; new bubbles never come slower', () => {
  assert.ok(nonDecreasing(col('bubbles')), col('bubbles').join(','));
  assert.ok(nonIncreasing(LV.map((l) => l.every[0])) && nonIncreasing(LV.map((l) => l.every[1])));
  for (const l of LV) assert.ok(l.every[0] > 0 && l.every[0] < l.every[1]);
  return 'bubbles ' + col('bubbles').join(',');
});
check('grumpy share: none on levels 1-2, starts at level 3, rises, and stays a minority', () => {
  const g = col('grumpy');
  assert.equal(g[0], 0); assert.equal(g[1], 0); assert.ok(g[2] > 0, 'level 3 has grumps');
  assert.ok(nonDecreasing(g), g.join(',')); assert.ok(g[9] > g[2]); assert.ok(g.every((v) => v <= 0.35));
  LV.forEach((l, i) => { assert.equal(l.grumps.length > 0, l.grumpy > 0, `level ${i + 1}`); assert.equal(l.maxGrumps > 0, l.grumpy > 0); });
  return g.join(', ');
});
check('every icon is a different cute creature with a real colour; grumps are never icons', () => {
  LV.forEach((l, i) => {
    const ks = l.kinds.map((k) => k[0]);
    assert.equal(new Set(ks).size, ks.length, `level ${i + 1} repeats a creature`);
    for (const [k, c] of l.kinds) { assert.ok(L.CUTE.includes(k), k); assert.ok(/^#[0-9a-f]{6}$/i.test(c) || c === 'rainbow', c); }
    for (const k of l.grumps) { assert.ok(L.GRUMPS.includes(k), k); assert.ok(!ks.includes(k)); }
    assert.ok(l.scene >= 0 && l.scene < 5);
  });
  for (const k of L.GRUMPS) assert.ok(!L.CUTE.includes(k));
});
check('the five seas are all used, twice each, and the level-10 sea is the palace', () => {
  const sc = col('scene');
  for (let s = 0; s < 5; s++) assert.equal(sc.filter((v) => v === s).length, 2, `sea ${s}`);
  assert.equal(sc[9], 4);
});
check('every creature (friends and grumps) has a drawing in art.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../web/games/pop/art.js'), 'utf8');
  const missing = L.CUTE.concat(L.GRUMPS).filter((k) => !new RegExp(`\\n\\s+${k}\\(c, t, blink`).test(src));
  assert.deepEqual(missing, []);
  return `${L.CUTE.length} friends, ${L.GRUMPS.length} grumps`;
});
check('spawning: measured grumpy share follows the table, never two grumps in a row, kinds all belong to the level', () => {
  const out = [];
  LV.forEach((cfg, i) => {
    const rng = mulberry32(1234 + i);
    let st = { grumpsOnScreen: 0, lastWasGrumpy: false, lastKind: '' }, grumps = 0, prevGrumpy = false, repeats = 0;
    const N = 20000, kinds = new Set(cfg.kinds.map((k) => k[0])), seen = new Set();
    for (let n = 0; n < N; n++) {
      const p = L.pickSpawn(cfg, st, rng);
      if (p.grumpy) { grumps++; assert.ok(!prevGrumpy, `level ${i + 1}: two grumps in a row`); assert.ok(cfg.grumps.includes(p.kind)); }
      else { assert.ok(kinds.has(p.kind), p.kind); if (cfg.kinds.length > 1 && p.kind === st.lastKind) repeats++; seen.add(p.kind); }
      prevGrumpy = p.grumpy;
      st = { grumpsOnScreen: 0, lastWasGrumpy: p.grumpy, lastKind: p.grumpy ? st.lastKind : p.kind };
    }
    assert.equal(repeats, 0, `level ${i + 1}: the same friend twice running`);
    assert.equal(seen.size, kinds.size, `level ${i + 1}: every friend comes`);
    out.push(grumps / N);
  });
  assert.equal(out[0], 0); assert.equal(out[1], 0); assert.ok(out[2] > 0.05);
  for (let i = 3; i < 10; i++) assert.ok(out[i] >= out[i - 1] - 0.01, `measured share falls at level ${i + 1}`);
  // a full sea of grumps blocks more
  const cfg = LV[9];
  for (let n = 0; n < 2000; n++) assert.equal(L.pickSpawn(cfg, { grumpsOnScreen: cfg.maxGrumps, lastWasGrumpy: false, lastKind: '' }, Math.random).grumpy, false);
  return 'measured ' + out.map((v) => v.toFixed(2)).join(', ');
});

// ---------------- the rules ----------------
check('a correct drop saves the creature: the tray counts 1', () => {
  const r = new L.Run(1), res = r.drop('turtle', 'turtle');
  assert.equal(res.type, 'saved'); assert.equal(res.slot, 0); assert.equal(r.count, 1); assert.deepEqual(r.tray, ['turtle']);
  assert.equal(r.saves, 1); assert.equal(r.coins, 0); assert.equal(res.coin, false);
});
check('ten correct drops make a gold coin and empty the tray', () => {
  const r = new L.Run(1), results = [];
  for (let i = 0; i < 10; i++) results.push(r.drop(i % 2 ? 'fish' : 'turtle', i % 2 ? 'fish' : 'turtle'));
  assert.deepEqual(results.map((x) => x.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(results.map((x) => x.coin), [false, false, false, false, false, false, false, false, false, true]);
  assert.equal(r.coins, 1); assert.equal(r.count, 0); assert.equal(r.trays, 1);
  const next = r.drop('fish', 'fish');
  assert.equal(next.slot, 0); assert.equal(next.batch, 1); assert.equal(r.count, 1);
});
check('a cute creature dropped on the wrong icon, the bare sand or in the water changes nothing', () => {
  const r = new L.Run(3); saveN(r, 13);
  const before = JSON.stringify({ s: r.snapshot(), saves: r.saves, trays: r.trays, done: r.done });
  assert.equal(r.drop('turtle', 'whale').type, 'wrong');
  assert.equal(r.drop('turtle', 'crab').type, 'wrong');
  assert.equal(r.drop('turtle', 'sand').type, 'wrong');
  assert.equal(r.drop('turtle', null).type, 'float');
  assert.equal(r.drop('crab', 'turtle').type, 'wrong');
  assert.equal(JSON.stringify({ s: r.snapshot(), saves: r.saves, trays: r.trays, done: r.done }), before);
  return before;
});
check('a grumpy creature dropped on the sand costs one coin, and never goes below zero', () => {
  const r = new L.Run(3);
  saveN(r, 23);   // 2 coins, 3 in the tray
  assert.equal(r.coins, 2); assert.equal(r.count, 3);
  let res = r.drop('urchin', 'turtle');
  assert.equal(res.type, 'grump'); assert.equal(res.coinLost, true); assert.equal(r.coins, 1);
  res = r.drop('urchin', 'sand'); assert.equal(res.coinLost, true); assert.equal(r.coins, 0);
  res = r.drop('urchin', 'whale'); assert.equal(res.type, 'grump'); assert.equal(res.coinLost, false); assert.equal(r.coins, 0);
  assert.equal(r.count, 3, 'the tray is not touched'); assert.equal(r.grumpDrops, 3);
  assert.equal(r.drop('urchin', null).type, 'float'); assert.equal(r.grumpDrops, 3, 'let go in the water: nothing');
  return `coins 2 -> 1 -> 0 -> 0, grump drops ${r.grumpDrops}`;
});
check('reaching the coin target brings the chest (level 1: the 30th save), and nothing changes after it', () => {
  const r = new L.Run(1);
  const r29 = saveN(r, 29);
  assert.equal(r29.chest, false); assert.equal(r.done, false); assert.equal(r.coins, 2);
  const r30 = r.drop('fish', 'fish');
  assert.equal(r30.type, 'saved'); assert.equal(r30.coin, true); assert.equal(r30.chest, true); assert.equal(r.done, true); assert.equal(r.coins, 3);
  const snap = JSON.stringify(r.snapshot());
  assert.equal(r.drop('fish', 'fish').type, 'ignored'); assert.equal(r.drop('urchin', 'sand').type, 'ignored');
  assert.equal(JSON.stringify(r.snapshot()), snap);
});
check('every level\'s chest comes after exactly coins x 10 saves', () => {
  LV.forEach((cfg, i) => {
    const r = new L.Run(i + 1);
    let n = 0, res;
    do { res = saveN(r, 1); n++; } while (!res.chest && n < 1000);
    assert.equal(n, cfg.coins * 10, `level ${i + 1}`);
  });
  return LV.map((c) => c.coins * 10).join(', ') + ' saves';
});
check('a grumpy drop after a lost coin still lets the level be finished (coins are earned back)', () => {
  const r = new L.Run(4);   // 5 coins
  saveN(r, 10); r.drop('urchin', 'sand'); assert.equal(r.coins, 0);
  let n = 0, res;
  do { res = saveN(r, 1); n++; } while (!res.chest && n < 1000);
  assert.equal(n, 50); assert.equal(r.stars, 2);
});
check('stars: 3 with no grumpy drops, 2 with one or two, 1 with more (never about speed)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(L.starsFor), [3, 2, 2, 1, 1, 1]);
  const r = new L.Run(1); saveN(r, 30); assert.equal(r.stars, 3);
});

// ---------------- where a released bubble lands (the magnetic snap) ----------------
const ICONS = [{ kind: 'fish', x: 440, y: 400, r: 54 }, { kind: 'turtle', x: 760, y: 400, r: 54 }];
const drop = (kind, bx, by, fx, fy) => L.resolveDrop({ kind, bx, by, br: 63, fx, fy, icons: ICONS, floor: 342, snap: 64 });
check('a bubble let go on or near its own icon goes home (snap reaches 118 units from the centre)', () => {
  assert.equal(drop('fish', 440, 400), 'fish');
  assert.equal(drop('fish', 440 + 110, 400 - 20), 'fish');
  assert.equal(drop('fish', 440, 400 - 115), 'fish', 'from just above, still in the water');
  assert.equal(drop('fish', 440 + 150, 300, 440 + 60, 380), 'fish', 'the finger is close enough even if the bubble is not');
});
check('its own icon wins over a neighbour it also touches (icons 160 apart, as on level 10)', () => {
  const close = [{ kind: 'fish', x: 440, y: 400, r: 54 }, { kind: 'turtle', x: 600, y: 400, r: 54 }];
  const at = (kind, bx) => L.resolveDrop({ kind, bx, by: 400, br: 63, icons: close, floor: 342, snap: 64 });
  // 90 from the fish and 70 from the turtle: it covers the turtle, but a fish still goes home to the fish
  assert.equal(at('fish', 530), 'fish');
  assert.equal(at('turtle', 530), 'turtle');
  assert.equal(at('crab', 530), 'turtle', 'a creature with no icon here lands on the icon it covers most');
});
check('elsewhere: another icon it covers, the bare sand, or the water', () => {
  assert.equal(drop('fish', 760, 400), 'turtle');
  assert.equal(drop('fish', 1100, 450), 'sand');
  assert.equal(drop('fish', 1100, 300), null);
  assert.equal(drop('fish', 1100, 330, 1100, 380), 'sand', 'finger on the sand');
  assert.equal(drop('urchin', 760, 410), 'turtle', 'a grump has no icon of its own: over one is on the sand');
  assert.equal(drop('urchin', 600, 250), null);
});

// ---------------- saving ----------------
check('the real v1 save migrates: lifetime totals kept, level 1 unlocked, no stars, no runs', () => {
  const sv = L.migrate(V1_SAVE);
  assert.equal(sv.v, 2); assert.equal(sv.unlocked, 1); assert.deepEqual(sv.stars, new Array(10).fill(0)); assert.deepEqual(sv.runs, {});
  assert.equal(sv.total, 14); assert.deepEqual(sv.kinds, { crab: 3, turtle: 2, fish: 2, seahorse: 2, starfish: 1, jelly: 3, puffer: 1 }); assert.equal(sv.parties, 1);
  assert.equal(sv.aquarium, undefined); assert.equal(sv.scene, undefined);
  assert.deepEqual(L.migrate(JSON.stringify(sv)), sv, 'and it is stable once migrated');
  return JSON.stringify(sv);
});
check('broken or odd saves never throw: they start fresh', () => {
  const fresh = L.freshSave();
  for (const raw of [null, undefined, '', 'not json', 'null', '[]', '42', '"x"', '{', '{"v":2,"unlocked":"x","stars":"no","runs":[]}', '{"v":"1"}']) {
    const sv = L.migrate(raw);
    assert.equal(sv.unlocked, 1, String(raw)); assert.deepEqual(sv.stars, fresh.stars); assert.deepEqual(sv.runs, {});
  }
  const odd = L.migrate('{"v":1,"total":-5,"kinds":{"fish":"lots","dragon":4,"crab":2.7}}');
  assert.equal(odd.total, 0); assert.deepEqual(odd.kinds, { crab: 2 });
});
check('a v2 save round-trips, and unlocked always covers every level with stars', () => {
  const sv = L.freshSave();
  sv.unlocked = 3; sv.stars[0] = 3; sv.stars[1] = 2; sv.total = 99; sv.coins = 9; sv.chests = 2; sv.runs[3] = { coins: 1, tray: ['turtle', 'crab'], grumps: 1 };
  assert.deepEqual(L.migrate(JSON.stringify(sv)), sv);
  const a = L.migrate(JSON.stringify({ v: 2, unlocked: 1, stars: [3, 0, 0, 2, 0, 0, 0, 0, 0, 0] }));
  assert.equal(a.unlocked, 5);
  const b = L.migrate(JSON.stringify({ v: 2, unlocked: 99, stars: [9, -1, 2.5, 3, 3, 3, 3, 3, 3, 3, 3, 3] }));
  assert.equal(b.unlocked, 10); assert.deepEqual(b.stars, [3, 0, 2, 3, 3, 3, 3, 3, 3, 3]);
  const c = L.migrate(JSON.stringify({ v: 3, unlocked: 4, stars: [1, 1, 1] }));
  assert.equal(c.unlocked, 4, 'a newer version is read as far as it goes');
});
check('a half-played level is saved and resumed; bad pieces of it are dropped', () => {
  const r = new L.Run(3); saveN(r, 12); r.drop('urchin', 'sand');   // saves turtle, whale, crab, ... : a coin, then whale and crab in the tray
  const snap = r.snapshot();
  assert.deepEqual(snap, { coins: 0, tray: ['whale', 'crab'], grumps: 1 });
  const again = new L.Run(3, snap);
  assert.equal(again.coins, 0); assert.deepEqual(again.tray, ['whale', 'crab']); assert.equal(again.grumpDrops, 1);
  saveN(again, 8); assert.equal(again.coins, 1, 'the resumed tray fills to a coin');
  const sv = L.migrate(JSON.stringify({ v: 2, unlocked: 3, stars: [3, 3], runs: { 3: { coins: 2, tray: ['turtle', 'dragon', 'urchin', 'crab'], grumps: 2 }, 7: { coins: 1 }, x: {}, 2: { coins: 99, tray: [] } } }));
  assert.deepEqual(sv.runs, { 3: { coins: 2, tray: ['turtle', 'crab'], grumps: 2 } }, JSON.stringify(sv.runs));
});

console.log(`\n${pass}/${pass + fail} rule checks passed`);
process.exit(fail ? 1 : 0);
