// Sea Catch: the rules and the level table, tested in Node with the same web/games/catch/logic.js the game loads.
//   node test/games/catch/verify.js          (no browser; exits non-zero if anything fails; about 40 s)
// It proves, level by level:
//   - the table is sane and rising, and frozen by fingerprint (so a level cannot drift unnoticed);
//   - the plan of what falls is fair: grumps leave a gap, a friend never arrives glued to a grump;
//   - a sweep over (time, place) finds a bonk-free path at a third of Isabella's speed, and every friend can be
//     caught on such a path: a grump can always be avoided, even while a friend is falling;
//   - model players through the real Run.step(): a modest one (0.5 s reaction, a slow finger, sloppy aim) wins
//     every level with all three stars; a weaker one still wins; one that only dodges is never bonked; and a very
//     young one who goes for everything, grumps too, still reaches every chest (a level cannot be failed);
//   - the coin maths never goes below 0, stars, and saves round-trip.
// The browser checks are browser.js (real touch, screenshots) and soak.js (long random play).
'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// CATCH_LOGIC=<path> runs these checks against another copy of logic.js (to prove they catch an injected defect)
const LOGIC = process.env.CATCH_LOGIC ? path.resolve(process.env.CATCH_LOGIC) : path.join(__dirname, '../../../web/games/catch/logic.js');
const L = require(LOGIC);
const M = require('./models.js');
const QUICK = process.argv.includes('--quick');   // fewer seeds (about 8 s)

let pass = 0, fail = 0;
function check(name, fn) {
  try { const detail = fn(); pass++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e && e.message ? e.message.split('\n').join('\n      ') : e}`); }
}
const LV = L.LEVELS, col = (k) => LV.map((l) => l[k]);
const nonDecreasing = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]);
const nonIncreasing = (a) => a.every((v, i) => i === 0 || v <= a[i - 1]);
const rising = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
const med = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
const sha = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const FALL = L.CATCH_Y - L.SPAWN_Y;
const WIDTHS = [1200, 960, 1320];   // the Seeker and 20:9 phones, a 16:9 phone, a very long phone
const hsl = (hex) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
};
// n friends into the shell on run `r` (any of the level's friends, in turn)
function catchN(r, n) { const ks = r.cfg.kinds.map((k) => k[0]); let res; for (let i = 0; i < n; i++) res = r.apply({ kind: ks[i % ks.length], grumpy: false, gold: false }); return res; }
const GRUMP = (kind) => ({ kind: kind || 'urchin', grumpy: true, gold: false });
const GOLD = (kind) => ({ kind: kind || 'fish', grumpy: false, gold: true });

// ---------------- the level table ----------------
check('ten levels', () => { assert.equal(LV.length, 10); assert.equal(L.NLEV, 10); });
check('coin goals rise from 2 to 10, never falling, never jumping by more than 2', () => {
  const c = col('coins');
  assert.equal(c[0], 2); assert.equal(c[9], 10); assert.ok(nonDecreasing(c), c.join(','));
  c.forEach((v, i) => { if (i) assert.ok(v - c[i - 1] <= 2, `level ${i + 1}: ${c[i - 1]} -> ${v}`); });
  return c.join(', ');
});
check('fall speed rises every level, gently (at most 12 units/s a level): about 5 s to the shell on level 1, 2.3 s on level 10', () => {
  const s = col('speed');
  assert.ok(rising(s), s.join(','));
  s.forEach((v, i) => { if (i) assert.ok(v - s[i - 1] <= 12, `level ${i + 1} jumps ${v - s[i - 1]}`); });
  const t1 = FALL / s[0], t10 = FALL / s[9];
  assert.ok(t1 > 4.5 && t1 < 5.5, `level 1 falls in ${t1.toFixed(2)} s`); assert.ok(t10 > 2.1 && t10 < 2.6, `level 10 falls in ${t10.toFixed(2)} s`);
  return s.join(', ') + ` units/s; ${t1.toFixed(1)} s .. ${t10.toFixed(1)} s`;
});
check('things in the water at once never decrease (2 .. 5); new things never come slower', () => {
  const n = col('atOnce');
  assert.equal(n[0], 2); assert.equal(n[9], 5); assert.ok(nonDecreasing(n), n.join(','));
  assert.ok(nonIncreasing(LV.map((l) => l.every[0])) && nonIncreasing(LV.map((l) => l.every[1])));
  for (const l of LV) assert.ok(l.every[0] > 0.3 && l.every[0] < l.every[1]);
  return 'at once ' + n.join(',') + '; every ' + LV.map((l) => ((l.every[0] + l.every[1]) / 2).toFixed(2)).join(',') + ' s';
});
check('grumpy share: none on levels 1-2, starts at level 3, rises, and stays a minority', () => {
  const g = col('grumpy');
  assert.equal(g[0], 0); assert.equal(g[1], 0); assert.ok(g[2] > 0, 'level 3 has grumps');
  assert.ok(nonDecreasing(g), g.join(',')); assert.ok(g[9] > g[2]); assert.ok(g.every((v) => v <= 0.35));
  LV.forEach((l, i) => { assert.equal(l.grumps.length > 0, l.grumpy > 0, `level ${i + 1}`); assert.equal(l.maxGrumps > 0, l.grumpy > 0); });
  assert.ok(nonDecreasing(col('maxGrumps')));
  return g.join(', ');
});
check('more kinds as the levels go: friends 3 -> 7, grumps 0 -> 5, never fewer than the level before; each grump kind stays once it has come', () => {
  const f = LV.map((l) => l.kinds.length), g = LV.map((l) => l.grumps.length);
  assert.equal(f[0], 3); assert.equal(f[9], 7); assert.ok(nonDecreasing(f), f.join(','));
  assert.equal(g[9], L.GRUMPS.length); assert.ok(nonDecreasing(g), g.join(','));
  LV.forEach((l, i) => { if (i) for (const k of LV[i - 1].grumps) assert.ok(l.grumps.includes(k), `level ${i + 1} drops ${k}`); });
  return `friends ${f.join(',')}; grumps ${g.join(',')}`;
});
check('every friend is a different cute creature in a bright colour; grumps are dull; nothing but the golden one is gold', () => {
  LV.forEach((l, i) => {
    const ks = l.kinds.map((k) => k[0]);
    assert.equal(new Set(ks).size, ks.length, `level ${i + 1} repeats a creature`);
    for (const [k, c] of l.kinds) {
      assert.ok(L.FRIENDS.includes(k), k);
      if (c === 'rainbow') continue;
      assert.ok(/^#[0-9a-f]{6}$/i.test(c), c);
      const q = hsl(c);
      assert.ok(q.s >= 0.45 && q.l >= 0.45, `level ${i + 1} ${k} ${c} is not bright (s ${q.s.toFixed(2)}, l ${q.l.toFixed(2)})`);
      assert.ok(q.h < 36 || q.h > 62, `level ${i + 1} ${k} ${c} could be taken for the golden one (hue ${q.h.toFixed(0)})`);
      assert.ok(q.h < 255 || q.h > 300, `level ${i + 1} ${k} ${c} is purple like the urchin (hue ${q.h.toFixed(0)})`);
    }
    for (const k of l.grumps) { assert.ok(L.GRUMPS.includes(k), k); assert.ok(!ks.includes(k)); }
    assert.ok(l.scene >= 0 && l.scene < 5);
  });
  for (const k of L.GRUMPS) { assert.ok(!L.FRIENDS.includes(k)); const q = hsl(L.GRUMP_COL[k]); assert.ok(q.s < 0.65, `${k} is too bright (s ${q.s.toFixed(2)})`); }
  const g = hsl(L.GOLD_COL); assert.ok(g.h > 40 && g.h < 55 && g.s > 0.9);
});
check('sideways drift from level 5 and zig-zags from level 7, never before, never less than the level before', () => {
  const d = col('drift'), z = col('zig'), m = col('moving');
  for (let i = 0; i < 4; i++) { assert.equal(d[i], 0); assert.equal(z[i], 0); assert.equal(m[i], 0); }
  assert.ok(d[4] > 0); assert.ok(z.slice(0, 6).every((v) => v === 0)); assert.ok(z[6] > 0);
  assert.ok(nonDecreasing(d) && nonDecreasing(z) && nonDecreasing(m), `${d} / ${z} / ${m}`);
  assert.ok(z[9] <= 60 && d[9] <= 40 && m[9] <= 1, 'gentle');
  return `drift ${d.join(',')}; zig ${z.join(',')}`;
});
check('the golden friend is rare on every level (a chance of 3-6% per friend)', () => {
  const g = col('gold');
  for (const v of g) assert.ok(v >= 0.03 && v <= 0.06, String(v));
  return g.join(', ');
});
check('the five seas are all used, twice each, and the level-10 sea is the palace', () => {
  const sc = col('scene');
  for (let s = 0; s < 5; s++) assert.equal(sc.filter((v) => v === s).length, 2, `sea ${s}`);
  assert.equal(sc[9], 4);
});
check('every friend and every grump has a drawing in art.js', () => {
  const src = fs.readFileSync(path.join(path.dirname(LOGIC), 'art.js'), 'utf8');
  const missing = L.FRIENDS.concat(L.GRUMPS).filter((k) => !new RegExp(`\\n\\s+${k}\\(c, t, blink`).test(src));
  assert.deepEqual(missing, []);
  return `${L.FRIENDS.length} friends, ${L.GRUMPS.length} grumps`;
});
check('friends are easier to catch than grumps: the friend zone is wider and taller than the grump zone', () => {
  const f = L.FRIEND_ZONE, g = L.GRUMP_ZONE;
  assert.ok(f.hw >= g.hw + 30 && f.up > g.up && f.down > g.down, JSON.stringify({ f, g }));
  assert.ok(f.hw <= L.R + 58, 'a friend only counts when its bubble really overlaps the shell');
  assert.ok(g.hw <= 58, 'a grump only counts when its middle is over the shell');
  return `friend +-${f.hw}, grump +-${g.hw}`;
});

// ---------------- frozen: the table, the constants, and what falls for a fixed seed ----------------
const TABLE_FP = 'f777ef85778f';
const PLAN_FP = ['39a1ca508fd6', '841ecca8c591', '0f8ed388d1b1', '766b88148fe5', '15b63942b2bb', 'c57a98df3ef3', '2e4c1f7039f7', '9335203a179c', '1fd37f5846e7', '0705e1137e7d'];
const round = (v) => Math.round(v * 1000) / 1000;
const planPrint = (n) => sha(M.plan(L, n, 1200, 4242 + n, 60).items.map((it) => [it.kind, it.gold ? 1 : 0, round(it.t0), round(it.x0), round(it.vy), round(it.vx), round(it.amp), round(it.om), round(it.ph)]));
check('fingerprints: the level table and the constants are the frozen ones', () => {
  const fp = sha([LV, L.TRAY, L.FRIENDS, L.GRUMPS, L.GRUMP_COL, L.GOLD_COL, L.SPAWN_Y, L.CATCH_Y, L.LAND_Y, L.R, L.EDGE, L.PX_MIN, L.HOME_X, L.HOME_Y, L.FRIEND_ZONE, L.GRUMP_ZONE,
    L.FOLLOW, L.VMAX, L.SHIELD, L.MERCY, L.CALM, L.GOLD_GAP, L.GOLD_FIRST, L.T_GG, L.GAP_GG, L.T_FG, L.Y_FG, L.SEP_FG, L.Y_FF, L.SEP_FF]);
  assert.equal(fp, TABLE_FP, `the table or a constant CHANGED (fingerprint ${fp}, frozen ${TABLE_FP})`);
  return fp;
});
check('fingerprints: the first minute of every level, from a fixed seed, is the frozen one (and the same twice)', () => {
  const now = LV.map((_, i) => planPrint(i + 1));
  LV.forEach((_, i) => assert.equal(planPrint(i + 1), now[i], `level ${i + 1} is not deterministic`));
  assert.deepEqual(now, PLAN_FP, 'what falls CHANGED:\n' + JSON.stringify(now));
  return now.join(' ');
});

// ---------------- what falls: the plan ----------------
check('the plan: measured grumpy share follows the table, never two grumps in a row, every friend comes, never the same friend twice running', () => {
  const out = [];
  LV.forEach((cfg, i) => {
    const items = M.plan(L, i + 1, 1200, 99 + i, 900).items, kinds = new Set(cfg.kinds.map((k) => k[0])), seen = new Set();
    let grumps = 0, prev = null, lastFriend = '';
    items.forEach((it, k) => {
      if (it.grumpy) { grumps++; assert.ok(cfg.grumps.includes(it.kind), it.kind); assert.ok(!(prev && prev.grumpy), `level ${i + 1}: two grumps in a row`); assert.ok(k >= 2, 'the first two things are friends'); }
      else { assert.ok(kinds.has(it.kind), it.kind); assert.notEqual(it.kind, lastFriend, `level ${i + 1}: the same friend twice running`); lastFriend = it.kind; seen.add(it.kind); }
      prev = it;
    });
    assert.equal(seen.size, kinds.size, `level ${i + 1}: every friend comes`);
    const share = grumps / items.length;
    assert.ok(share <= cfg.grumpy + 0.02 && share >= cfg.grumpy * 0.6 - 0.001, `level ${i + 1}: measured ${share.toFixed(3)} against ${cfg.grumpy}`);
    out.push(share);
  });
  for (let i = 3; i < 10; i++) assert.ok(out[i] >= out[i - 1] - 0.015, `measured share falls at level ${i + 1}`);
  return 'measured ' + out.map((v) => v.toFixed(2)).join(', ');
});
check('the plan: never more in the water than the level allows, never more grumps than it allows, and things per second rises level by level', () => {
  const rate = [];
  LV.forEach((cfg, i) => {
    const items = M.plan(L, i + 1, 1200, 7 + i, 600).items;
    let most = 0, mostG = 0;
    for (let t = 0; t < 600; t += 0.05) {
      let n = 0, g = 0;
      for (const it of items) if (it.t0 <= t && it.tOut > t) { n++; if (it.grumpy) g++; }
      if (n > most) most = n; if (g > mostG) mostG = g;
    }
    assert.ok(most <= cfg.atOnce, `level ${i + 1}: ${most} at once`); assert.ok(most >= cfg.atOnce - 1, `level ${i + 1}: only ever ${most} at once`);
    assert.ok(mostG <= cfg.maxGrumps, `level ${i + 1}: ${mostG} grumps at once`);
    rate.push(items.length / 600);
  });
  assert.ok(rising(rate), rate.map((v) => v.toFixed(2)).join(','));
  return rate.map((v) => v.toFixed(2)).join(', ') + ' a second';
});
check('the plan: the golden friend is rare (under 6% of friends), 20 s apart at least, and never at the very start', () => {
  const out = [];
  LV.forEach((cfg, i) => {
    const items = M.plan(L, i + 1, 1200, 31 + i, 900).items, golds = items.filter((it) => it.gold), friends = items.filter((it) => !it.grumpy);
    assert.ok(golds.length >= 5, `level ${i + 1}: only ${golds.length} golden friends in 15 minutes`);
    assert.ok(golds.length / friends.length < 0.06, `level ${i + 1}: ${golds.length} of ${friends.length}`);
    golds.forEach((g, k) => { assert.ok(g.t0 >= L.GOLD_FIRST); assert.ok(!g.grumpy); if (k) assert.ok(g.t0 - golds[k - 1].t0 >= L.GOLD_GAP - 1e-9, `level ${i + 1}: two golden friends ${(g.t0 - golds[k - 1].t0).toFixed(1)} s apart`); });
    out.push((900 / golds.length).toFixed(0));
  });
  return 'one every ' + out.join(', ') + ' s';
});
check('the plan is fair on every screen width: things stay on screen, clear of the home button, grumps leave a gap, a friend never arrives glued to a grump', () => {
  let pairs = 0, postponed = 0, things = 0;
  for (const vw of WIDTHS) LV.forEach((cfg, i) => {
    for (let seed = 1; seed <= (QUICK ? 2 : 5); seed++) {
      const p = M.plan(L, i + 1, vw, seed * 131 + i, 300), items = p.items;
      postponed += p.postponed; things += items.length;
      for (const it of items) {
        // the whole fall, sampled finely
        for (let t = it.t0; ; t += 0.05) {
          const x = L.itemX(it, t), y = L.itemY(it, t);
          if (y > L.LAND_Y) break;
          assert.ok(x >= L.EDGE - 31 && x <= vw - L.EDGE + 31, `level ${i + 1} width ${vw}: ${it.kind} at x ${x.toFixed(0)}`);
          assert.ok(!(y < L.HOME_Y - 12 && x < L.HOME_X - 6), `level ${i + 1}: ${it.kind} starts behind the home button (x ${x.toFixed(0)}, y ${y.toFixed(0)})`);
        }
        assert.ok(Math.abs(L.itemX(it, it.tc) - it.xc) < 1e-6 && Math.abs(L.itemY(it, it.tc) - L.CATCH_Y) < 1e-6, 'tc and xc are where it crosses the shell line');
        assert.ok(it.xc >= L.EDGE && it.xc <= vw - L.EDGE);
      }
      // every pair, measured from the paths themselves (not from the spawner's notes)
      for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length && items[b].t0 < items[a].tOut + 3; b++) {
        const p1 = items[a], p2 = items[b], dt = Math.abs(p1.tc - p2.tc), dx = Math.abs(L.itemX(p1, p1.tc) - L.itemX(p2, p2.tc));
        pairs++;
        if (p1.grumpy && p2.grumpy) assert.ok(dt >= L.T_GG || dx >= L.GAP_GG, `level ${i + 1}: two grumps ${dt.toFixed(2)} s and ${dx.toFixed(0)} apart`);
        else if (p1.grumpy !== p2.grumpy) assert.ok((dt >= L.T_FG && dt * cfg.speed >= L.Y_FG) || dx >= L.SEP_FG, `level ${i + 1}: a friend ${dt.toFixed(2)} s (${(dt * cfg.speed).toFixed(0)} units of height) and ${dx.toFixed(0)} sideways from a grump`);
        else assert.ok(dt * cfg.speed >= L.Y_FF || dx >= L.SEP_FF, `level ${i + 1}: two friends on top of one another (${(dt * cfg.speed).toFixed(0)} of height, ${dx.toFixed(0)} sideways)`);
      }
    }
  });
  assert.ok(postponed / things < 0.02, `${postponed} of ${things} had to wait for a fair place`);
  assert.ok(L.GAP_GG >= 2 * L.GRUMP_ZONE.hw + 100 && L.SEP_FG >= L.GRUMP_ZONE.hw + 60, 'the gaps are wider than the grump zone, with room to spare');
  assert.ok(L.SEP_FG >= L.R + 62 + 10 && L.Y_FG >= L.R + 62 + 10 && L.Y_FF >= 2 * L.R && L.SEP_FF >= 2 * L.R, 'a friend never hides behind a grump or another friend as it arrives');
  return `${pairs} pairs over widths ${WIDTHS.join(', ')}; ${postponed} of ${things} waited a moment for a fair place`;
});

// ---------------- the sweep: a grump can always be avoided, even while a friend is falling ----------------
const SWEEP = { speed: 0.3 * L.VMAX, margin: 12, friendMargin: 20, seconds: 240 };
check(`sweep over (time, place) at ${SWEEP.speed} units/s (30% of her speed), ${SWEEP.margin} units clear of every grump: a bonk-free path always exists, and every friend can be caught on one`, () => {
  let friends = 0, grumps = 0, plans = 0, narrow = Infinity;
  for (const vw of WIDTHS.slice(0, 2)) LV.forEach((cfg, i) => {
    for (let seed = 1; seed <= (QUICK ? 2 : 6); seed++) {
      const items = M.plan(L, i + 1, vw, seed * 977 + i, SWEEP.seconds).items, r = M.sweep(L, items, vw, SWEEP);
      assert.equal(r.trappedAt, null, `level ${i + 1} width ${vw} seed ${seed}: no safe place at ${r.trappedAt} s`);
      assert.deepEqual(r.poisoned, [], `level ${i + 1} width ${vw} seed ${seed}: friends that cannot be caught without a bonk`);
      friends += r.friends; grumps += r.grumps; plans++; narrow = Math.min(narrow, r.narrowest);
    }
  });
  assert.ok(grumps > 1000 && friends > 5000);
  assert.ok(narrow >= 300, `the safe water once shrank to ${narrow} units`);
  return `${plans} plans of ${SWEEP.seconds} s: ${grumps} grumps never trap her, all ${friends} friends catchable bonk-free; the reachable safe water is never under ${narrow} units wide`;
});
check('the sweep bites: with two grumps side by side and no gap, it reports the trap', () => {
  const wall = [];
  for (let x = 60; x <= 1140; x += 80) wall.push({ grumpy: true, t0: 0, x0: x, vy: 100, vx: 0, amp: 0, om: 0, ph: 0, sph: 0, tc: (L.CATCH_Y - L.SPAWN_Y) / 100, xc: x });
  const r = M.sweep(L, wall, 1200, Object.assign({}, SWEEP, { seconds: 10 }));
  assert.ok(r.trappedAt != null, 'a wall of grumps was not noticed');
  const glued = [{ grumpy: true, t0: 0, x0: 600, vy: 100, vx: 0, amp: 0, om: 0, ph: 0, sph: 0, tc: FALL / 100, xc: 600 },
    { grumpy: true, t0: 0, x0: 520, vy: 100, vx: 0, amp: 0, om: 0, ph: 0, sph: 0, tc: FALL / 100, xc: 520 }, { grumpy: true, t0: 0, x0: 680, vy: 100, vx: 0, amp: 0, om: 0, ph: 0, sph: 0, tc: FALL / 100, xc: 680 },
    { id: 9, kind: 'fish', grumpy: false, t0: 0, x0: 600, vy: 100, vx: 0, amp: 0, om: 0, ph: 0, sph: 0, tc: FALL / 100, xc: 600 }];
  const r2 = M.sweep(L, glued, 1200, Object.assign({}, SWEEP, { seconds: 10 }));
  assert.equal(r2.trappedAt, null); assert.equal(r2.poisoned.length, 1, 'a friend hidden among grumps was not noticed');
  return `wall trapped at ${r.trappedAt.toFixed(2)} s; the hidden friend was flagged`;
});

// ---------------- the rules ----------------
check('a friend in the shell is counted: the tray reads 1', () => {
  const r = new L.Run(1), res = r.apply({ kind: 'turtle', grumpy: false, gold: false });
  assert.equal(res.type, 'catch'); assert.equal(res.slot, 0); assert.equal(r.count, 1); assert.deepEqual(r.tray, ['turtle']);
  assert.equal(r.catches, 1); assert.equal(r.coins, 0); assert.equal(res.coin, false);
});
check('ten friends make a gold coin and empty the tray', () => {
  const r = new L.Run(2), results = [];
  for (let i = 0; i < 10; i++) results.push(r.apply({ kind: i % 2 ? 'fish' : 'crab', grumpy: false, gold: false }));
  assert.deepEqual(results.map((x) => x.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(results.map((x) => x.coin), [false, false, false, false, false, false, false, false, false, true]);
  assert.equal(r.coins, 1); assert.equal(r.count, 0); assert.equal(r.trays, 1);
  const next = r.apply({ kind: 'fish', grumpy: false, gold: false });
  assert.equal(next.slot, 0); assert.equal(next.batch, 1); assert.equal(r.count, 1);
});
check('the golden friend is a whole coin by itself, and the tray is left as it was', () => {
  const r = new L.Run(4); catchN(r, 7);
  const res = r.apply(GOLD('whale'));
  assert.equal(res.type, 'gold'); assert.equal(res.coin, true); assert.equal(r.coins, 1); assert.equal(r.count, 7); assert.equal(r.golds, 1); assert.equal(r.catches, 7);
  catchN(r, 3); assert.equal(r.coins, 2); assert.equal(r.count, 0);
});
check('a grump in the shell costs one coin, and never goes below zero', () => {
  const r = new L.Run(4);
  catchN(r, 23);   // 2 coins, 3 in the tray
  assert.equal(r.coins, 2); assert.equal(r.count, 3);
  let res = r.apply(GRUMP());
  assert.equal(res.type, 'bonk'); assert.equal(res.coinLost, true); assert.equal(r.coins, 1);
  res = r.apply(GRUMP('boot')); assert.equal(res.coinLost, true); assert.equal(r.coins, 0);
  for (const k of L.GRUMPS) { res = r.apply(GRUMP(k)); assert.equal(res.type, 'bonk'); assert.equal(res.coinLost, false); assert.equal(r.coins, 0); }
  assert.equal(r.count, 3, 'the tray is not touched'); assert.equal(r.bonks, 2 + L.GRUMPS.length);
  return `coins 2 -> 1 -> 0 -> 0 ..., bonks ${r.bonks}`;
});
check('reaching the coin goal brings the chest, and nothing changes after it', () => {
  const r = new L.Run(1);
  const r19 = catchN(r, 19);
  assert.equal(r19.chest, false); assert.equal(r.done, false); assert.equal(r.coins, 1);
  const r20 = catchN(r, 1);
  assert.equal(r20.type, 'catch'); assert.equal(r20.coin, true); assert.equal(r20.chest, true); assert.equal(r.done, true); assert.equal(r.coins, 2);
  const snap = JSON.stringify(r.snapshot());
  assert.equal(catchN(r, 1).type, 'ignored'); assert.equal(r.apply(GRUMP()).type, 'ignored'); assert.equal(r.apply(GOLD()).type, 'ignored');
  assert.equal(JSON.stringify(r.snapshot()), snap);
  const g = new L.Run(1); catchN(g, 10); assert.equal(g.apply(GOLD()).chest, true, 'a golden friend can be the last coin');
});
check('every level\'s chest comes after exactly coins x 10 friends (with no golden friend and no grump)', () => {
  LV.forEach((cfg, i) => {
    const r = new L.Run(i + 1);
    let n = 0, res;
    do { res = catchN(r, 1); n++; } while (!res.chest && n < 1000);
    assert.equal(n, cfg.coins * 10, `level ${i + 1}`);
  });
  return LV.map((c) => c.coins * 10).join(', ') + ' friends';
});
check('after a lost coin the level can still be finished (coins are earned back)', () => {
  const r = new L.Run(4);   // 4 coins
  catchN(r, 10); r.apply(GRUMP()); assert.equal(r.coins, 0);
  let n = 0, res;
  do { res = catchN(r, 1); n++; } while (!res.chest && n < 1000);
  assert.equal(n, 40); assert.equal(r.stars, 2);
});
check('stars: 3 with no grump caught, 2 with one or two, 1 with more (never about speed)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(L.starsFor), [3, 2, 2, 1, 1, 1]);
  const r = new L.Run(1); catchN(r, 20); assert.equal(r.stars, 3);
});
check('random play, 300 levels with a wild finger: coins never below 0 or above the goal, the tray always 0-9, and the sums always add up', () => {
  let steps = 0, bonks = 0, lowest = 0, lostAtZero = 0;
  for (let k = 0; k < (QUICK ? 60 : 300); k++) {
    const level = 1 + (k % 10), rng = L.mulberry32(5000 + k), r = new L.Run(level, null, { vw: WIDTHS[k % 3], seed: k + 1 }), out = [];
    let finger = 600, lost = 0, earned = 0, target = finger;
    while (!r.done && r.t < 240) {
      if (rng() < 0.03) target = rng() * r.vw;
      finger += Math.max(-25, Math.min(25, target - finger));
      out.length = 0;
      r.step(1 / 60, rng() < 0.1 ? null : finger, out);
      steps++;
      for (const e of out) {
        if (e.type === 'bonk') { bonks++; if (e.coinLost) lost++; else lostAtZero++; }
        if ((e.type === 'catch' || e.type === 'gold') && e.coin) earned++;
        if (e.type === 'ignored') assert.fail('something was caught after the chest');
      }
      assert.ok(r.coins >= 0, `coins ${r.coins}`); assert.ok(r.coins <= r.target); assert.ok(r.tray.length >= 0 && r.tray.length < L.TRAY);
      assert.equal(r.coins, earned - lost, 'coins = coins earned - coins lost');
      assert.equal(earned, r.trays + r.golds); assert.equal(r.catches, r.trays * L.TRAY + r.tray.length);
      assert.ok(r.px >= L.PX_MIN - 1e-9 && r.px <= r.vw - L.PX_MIN + 1e-9 && Math.abs(r.vel) <= L.VMAX + 1e-6);
      if (r.coins < lowest) lowest = r.coins;
    }
  }
  assert.ok(bonks > 100 && lostAtZero > 20, `the wild finger was bonked ${bonks} times, ${lostAtZero} of them with no coin to lose`);
  return `${steps} steps, ${bonks} bonks (${lostAtZero} at 0 coins), lowest coins ever ${lowest}`;
});

// ---------------- catching, in the water ----------------
// a level with nothing falling by itself, the shell parked at x
function still(level, x) { const r = new L.Run(level, null, { vw: 1200, seed: 3 }); r.paused = true; r.px = r.aim = x; return r; }
function fallOut(r, finger) { const out = []; for (let i = 0; i < 60 * 12 && r.items.length; i++) r.step(1 / 60, finger == null ? null : finger, out); return out.map((e) => e.type); }
check('a friend falling onto the shell is caught; one that lands 100 units to the side is missed, and missing costs nothing', () => {
  const r = still(3, 600);
  r.addItem({ kind: 'turtle', x: 600 }); assert.deepEqual(fallOut(r), ['catch']); assert.equal(r.count, 1);
  r.addItem({ kind: 'turtle', x: 600 + L.FRIEND_ZONE.hw - 4 }); assert.deepEqual(fallOut(r), ['catch'], 'the edge of the zone still counts');
  const before = JSON.stringify([r.snapshot(), r.catches, r.golds, r.done]);
  r.addItem({ kind: 'fish', x: 700 }); r.addItem({ kind: 'fish', x: 300, gold: true });
  assert.deepEqual(fallOut(r).sort(), ['gone', 'gone', 'miss', 'miss']);
  assert.equal(JSON.stringify([r.snapshot(), r.catches, r.golds, r.done]), before, 'a miss changed something');
  assert.equal(r.misses, 2);
});
check('a grump only bonks when it lands in the shell: 60 units to the side it sinks past, and nothing is lost', () => {
  const r = still(3, 600); catchN(r, 10);
  r.addItem({ kind: 'urchin', x: 660 }); assert.deepEqual(fallOut(r), ['gone']); assert.equal(r.coins, 1); assert.equal(r.bonks, 0);
  r.addItem({ kind: 'urchin', x: 600 + L.GRUMP_ZONE.hw - 4 }); assert.deepEqual(fallOut(r), ['bonk']); assert.equal(r.coins, 0); assert.equal(r.bonks, 1);
});
check('sliding sideways into something at the shell\'s height counts too (a friend is caught, a grump bonks)', () => {
  let r = still(3, 300);
  const f = r.addItem({ kind: 'fish', x: 600, y: L.CATCH_Y + 20, still: true });
  const out = []; for (let i = 0; i < 90; i++) r.step(1 / 60, 600, out);
  assert.deepEqual(out.map((e) => e.type), ['catch']); assert.ok(f.x === 600);
  r = still(3, 300); r.addItem({ kind: 'eel', x: 600, y: L.CATCH_Y, still: true });
  const out2 = []; for (let i = 0; i < 90; i++) r.step(1 / 60, 600, out2);
  assert.deepEqual(out2.map((e) => e.type), ['bonk']);
});
check('after a bonk she is dizzy for a moment: a second grump straight after cannot bonk her, and the next few things are friends', () => {
  const r = still(8, 600); catchN(r, 20);
  r.addItem({ kind: 'urchin', x: 600, y: L.CATCH_Y - 60 }); r.addItem({ kind: 'shark', x: 600, y: L.CATCH_Y - 140 });
  const types = fallOut(r);
  assert.deepEqual(types, ['bonk', 'gone']); assert.equal(r.bonks, 1); assert.equal(r.coins, 1);
  assert.equal(r.spawner.mercy, L.MERCY);
  r.paused = false;
  const out = []; while (out.filter((e) => e.type === 'spawn').length < L.MERCY) r.step(1 / 60, 1100, out);
  assert.ok(out.filter((e) => e.type === 'spawn').every((e) => !e.item.grumpy), 'a grump came straight after a bonk');
  r.shield = 0; r.paused = true; r.items.length = 0; r.px = r.aim = 600;
  r.addItem({ kind: 'urchin', x: 600, y: L.CATCH_Y - 60 }); assert.deepEqual(fallOut(r), ['bonk'], 'once the dizziness has passed a grump bonks again');
});
check('grumps come less often the more she is bonked (share / (1 + bonks / 2)), so nobody is stuck', () => {
  const shares = [0, 2, 6, 12].map((b) => {
    const sp = new L.Spawner(10, 1200, 77); let n = 0, g = 0;
    for (let t = 0; t < 600; t += 1 / 60) { let it; while ((it = sp.next(t, b))) { n++; if (it.grumpy) g++; } }
    return g / n;
  });
  assert.ok(shares[0] > 0.2 && shares[1] < shares[0] * 0.65 && shares[2] < shares[0] * 0.4 && shares[3] < shares[0] * 0.25, shares.join(','));
  return 'level 10 share after 0, 2, 6, 12 bonks: ' + shares.map((v) => v.toFixed(3)).join(', ');
});
check('Isabella eases toward the finger: straight there, never past it, never faster than her top speed, never off the screen', () => {
  const r = new L.Run(1, null, { vw: 1200, seed: 1 }); r.paused = true;
  let last = r.px, top = 0, t90 = null, tThere = null, near = null;
  for (let i = 0; i < 180; i++) {
    r.step(1 / 60, 1100, null);
    assert.ok(r.px >= last - 1e-9 && r.px <= 1100 + 1e-9, 'she went backwards or past the finger');
    top = Math.max(top, (r.px - last) * 60);
    if (near == null && 1100 - r.px < 20) near = (r.px - last) * 60;   // her speed as she arrives
    last = r.px;
    if (t90 == null && r.px >= 600 + 0.9 * 500) t90 = (i + 1) / 60;
    if (tThere == null && Math.abs(r.px - 1100) < 4) tThere = (i + 1) / 60;
  }
  assert.ok(top <= L.VMAX + 1e-6, `top speed ${top}`);
  assert.ok(t90 > 0.15 && t90 < 0.6, `90% of the way in ${t90} s (an ease, not a jump and not a crawl)`); assert.ok(tThere < 1.2);
  assert.ok(near < 400, `she arrives at ${near.toFixed(0)} units/s: she should slow down as she gets there`);
  for (let i = 0; i < 120; i++) r.step(1 / 60, null, null);
  assert.ok(Math.abs(r.px - 1100) < 0.5, 'with the finger lifted she stays where it was');
  for (let i = 0; i < 240; i++) r.step(1 / 60, -500, null);
  assert.ok(Math.abs(r.px - L.PX_MIN) < 0.5, 'a finger off the left edge parks her at the left limit');
  for (let i = 0; i < 240; i++) r.step(1 / 60, 99999, null);
  assert.ok(Math.abs(r.px - (1200 - L.PX_MIN)) < 0.5);
  // every place something can land is within her reach
  assert.ok(L.EDGE - L.PX_MIN <= L.FRIEND_ZONE.hw - 40, 'a friend at the very edge is still well inside the shell');
  return `90% of a 500-unit move in ${t90.toFixed(2)} s, there in ${tThere.toFixed(2)} s, top speed ${top.toFixed(0)}, arriving at ${near.toFixed(0)}`;
});
check('big steps (a slow frame) change nothing: a friend is still caught and a grump still bonks at 20 steps a second', () => {
  const r = still(10, 600);
  r.addItem({ kind: 'fish', x: 620 }); r.addItem({ kind: 'can', x: 590, y: -200 });
  const out = []; for (let i = 0; i < 200 && r.items.length; i++) r.step(0.05, null, out);
  assert.deepEqual(out.map((e) => e.type), ['catch', 'bonk']);
});

// ---------------- model players ----------------
const SEEDS = QUICK ? 6 : 30;
const MODEST = { mode: 'catch', reaction: 0.5, speed: 650, aim: 20, lapse: 0.05 };    // half a second to notice, a finger crossing the screen in ~2 s, 5% not noticed
const WEAK = { mode: 'catch', reaction: 0.8, speed: 380, aim: 32, lapse: 0.25 };      // slower in every way, a quarter of the friends not noticed
const YOUNGEST = { mode: 'all', reaction: 0.6, speed: 450, aim: 30, lapse: 0.2 };     // goes for whatever is nearest the shell, grump or not
const plays = (player, maxT) => LV.map((_, i) => Array.from({ length: SEEDS }, (_, s) => M.play(L, i + 1, { seed: (i + 1) * 1000 + s + 1, vw: WIDTHS[s % 3], player, maxT })));
const rate = (r) => (r.catches + r.golds) / Math.max(1, r.friends + r.goldsSeen);
let modest = null;
check(`a modest player (0.5 s reaction, finger at ${MODEST.speed} units/s, aim off by up to ${MODEST.aim}) wins every level on every seed, with three stars, in under two and a half minutes`, () => {
  modest = plays(MODEST, 600);
  const out = [];
  modest.forEach((rs, i) => {
    assert.ok(rs.every((r) => r.done), `level ${i + 1}: not finished on ${rs.filter((r) => !r.done).length} of ${SEEDS} seeds`);
    const t = rs.map((r) => r.t), worst = Math.max(...t), stars3 = rs.filter((r) => r.stars === 3).length;
    assert.ok(worst < 150, `level ${i + 1}: took ${worst.toFixed(0)} s`);
    assert.ok(stars3 >= Math.ceil(SEEDS * 0.9), `level ${i + 1}: three stars on only ${stars3} of ${SEEDS}`);
    assert.ok(med(rs.map(rate)) >= 0.7, `level ${i + 1}: caught only ${(med(rs.map(rate)) * 100).toFixed(0)}%`);
    assert.ok(rs.every((r) => r.minCoins === 0));
    out.push(`${med(t).toFixed(0)}s/${(med(rs.map(rate)) * 100).toFixed(0)}%`);
  });
  return 'median time / friends caught: ' + out.join(' ');
});
check('difficulty rises: the modest player catches a smaller share of the friends on level 10 than on level 1, and never a much bigger share than the level before', () => {
  const r = modest.map((rs) => med(rs.map(rate)));
  assert.ok(r[9] <= r[0] - 0.1, `level 1 ${r[0].toFixed(2)}, level 10 ${r[9].toFixed(2)}`);
  for (let i = 1; i < 10; i++) assert.ok(r[i] <= r[i - 1] + (QUICK ? 0.08 : 0.04), `level ${i + 1} is easier than level ${i}: ${r[i].toFixed(2)} after ${r[i - 1].toFixed(2)}`);
  return r.map((v) => (v * 100).toFixed(0) + '%').join(', ');
});
check('margin: a weaker player (0.8 s reaction, finger at 380 units/s, a quarter of the friends not noticed) still wins every level on every seed', () => {
  const out = [];
  plays(WEAK, 600).forEach((rs, i) => {
    assert.ok(rs.every((r) => r.done), `level ${i + 1}: not finished on ${rs.filter((r) => !r.done).length} of ${SEEDS} seeds`);
    const worst = Math.max(...rs.map((r) => r.t));
    assert.ok(worst < 240, `level ${i + 1}: took ${worst.toFixed(0)} s`);
    assert.ok(rs.filter((r) => r.stars >= 2).length >= Math.ceil(SEEDS * 0.9), `level ${i + 1}: under two stars too often`);
    out.push(`${med(rs.map((r) => r.t)).toFixed(0)}s/${(med(rs.map(rate)) * 100).toFixed(0)}%`);
  });
  return 'median time / friends caught: ' + out.join(' ');
});
check('nobody can fail: a very young player who goes for everything, grumps too, still reaches every chest on every seed', () => {
  const out = [];
  plays(YOUNGEST, 900).forEach((rs, i) => {
    assert.ok(rs.every((r) => r.done), `level ${i + 1}: not finished on ${rs.filter((r) => !r.done).length} of ${SEEDS} seeds`);
    const worst = Math.max(...rs.map((r) => r.t));
    assert.ok(worst < 480, `level ${i + 1}: took ${worst.toFixed(0)} s`);
    if (LV[i].grumpy > 0) assert.ok(med(rs.map((r) => r.bonks)) >= 1, `level ${i + 1}: this player should be bonked`);
    out.push(`${med(rs.map((r) => r.t)).toFixed(0)}s/${med(rs.map((r) => r.bonks))}`);
  });
  return 'median time / bonks: ' + out.join(' ');
});
check('a player who only dodges (0.5 s reaction, the same slow finger) is never bonked: four minutes on every level with grumps, every seed', () => {
  let grumps = 0;
  LV.forEach((cfg, i) => {
    if (!cfg.grumpy) return;
    for (let s = 1; s <= (QUICK ? 4 : 20); s++) {
      const run = new L.Run(i + 1, null, { vw: WIDTHS[s % 3], seed: (i + 1) * 500 + s }), pl = M.makePlayer(L, { mode: 'avoid', seed: s, reaction: 0.5, speed: 650 }), out = [];
      run.target = 1e9;
      while (run.t < 240) { out.length = 0; run.step(1 / 60, pl.act(run, 1 / 60), out); for (const e of out) if (e.type === 'spawn' && e.item.grumpy) grumps++; }
      assert.equal(run.bonks, 0, `level ${i + 1} seed ${s}: bonked ${run.bonks} times`);
    }
  });
  assert.ok(grumps > 1000);
  return `${grumps} grumps dodged`;
});
check('the models bite: a player who never moves away is bonked, and one with the screen switched off never finishes', () => {
  const sit = new L.Run(10, null, { vw: 1200, seed: 5 }); sit.target = 1e9;
  for (let i = 0; i < 60 * 240; i++) sit.step(1 / 60, 600, null);
  assert.ok(sit.bonks >= 3, `sitting still on level 10 was bonked only ${sit.bonks} times in four minutes`);
  const blind = M.play(L, 5, { seed: 9, player: { mode: 'avoid' }, maxT: 120 });
  assert.equal(blind.done, false);
  return `sitting still: ${sit.bonks} bonks`;
});

// ---------------- saving ----------------
check('a fresh save: level 1 open, no stars, nothing half played', () => {
  const sv = L.freshSave();
  assert.equal(sv.unlocked, 1); assert.deepEqual(sv.stars, new Array(10).fill(0)); assert.deepEqual(sv.runs, {});
  assert.deepEqual(L.migrate(null), sv); assert.deepEqual(L.migrate(JSON.stringify(sv)), sv);
});
check('broken or odd saves never throw: they start fresh', () => {
  const fresh = L.freshSave();
  for (const raw of [null, undefined, '', 'not json', 'null', '[]', '42', '"x"', '{', '{"v":1,"unlocked":"x","stars":"no","runs":[]}', '{"v":"1"}']) {
    const sv = L.migrate(raw);
    assert.equal(sv.unlocked, 1, String(raw)); assert.deepEqual(sv.stars, fresh.stars); assert.deepEqual(sv.runs, {});
  }
  const odd = L.migrate('{"v":1,"total":-5,"coins":"lots","golds":2.7}');
  assert.equal(odd.total, 0); assert.equal(odd.coins, 0); assert.equal(odd.golds, 2);
});
check('a save round-trips, and unlocked always covers every level with stars', () => {
  const sv = L.freshSave();
  sv.unlocked = 3; sv.stars[0] = 3; sv.stars[1] = 2; sv.total = 99; sv.coins = 9; sv.golds = 4; sv.chests = 2; sv.runs[3] = { coins: 1, tray: ['turtle', 'fish'], bonks: 1 };
  assert.deepEqual(L.migrate(JSON.stringify(sv)), sv);
  const a = L.migrate(JSON.stringify({ v: 1, unlocked: 1, stars: [3, 0, 0, 2, 0, 0, 0, 0, 0, 0] }));
  assert.equal(a.unlocked, 5);
  const b = L.migrate(JSON.stringify({ v: 1, unlocked: 99, stars: [9, -1, 2.5, 3, 3, 3, 3, 3, 3, 3, 3, 3] }));
  assert.equal(b.unlocked, 10); assert.deepEqual(b.stars, [3, 0, 2, 3, 3, 3, 3, 3, 3, 3]);
});
check('a half-played level is saved and resumed; bad pieces of it are dropped', () => {
  const r = new L.Run(3); catchN(r, 12); r.apply(GRUMP());   // a coin, then two in the tray; the bonk takes the coin
  const snap = r.snapshot();
  assert.deepEqual(snap, { coins: 0, tray: ['fish', 'starfish'], bonks: 1 });
  const again = new L.Run(3, snap);
  assert.equal(again.coins, 0); assert.deepEqual(again.tray, ['fish', 'starfish']); assert.equal(again.bonks, 1); assert.equal(again.stars, 2);
  catchN(again, 8); assert.equal(again.coins, 1, 'the resumed tray fills to a coin');
  const sv = L.migrate(JSON.stringify({ v: 1, unlocked: 3, stars: [3, 3], runs: { 3: { coins: 2, tray: ['turtle', 'dragon', 'urchin', 'fish'], bonks: 2 }, 7: { coins: 1 }, x: {}, 2: { coins: 99, tray: [] } } }));
  assert.deepEqual(sv.runs, { 3: { coins: 2, tray: ['turtle', 'fish'], bonks: 2 } }, JSON.stringify(sv.runs));
});

console.log(`\n${pass}/${pass + fail} rule checks passed`);
process.exit(fail ? 1 : 0);
