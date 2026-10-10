// Firefly Numbers: the rules, in Node. Every round of every level of every mode, the label model, the jar's rules,
// the swarm's spacing rule, the frozen fingerprints, and difficulty rising.
//   node test/games/fireflies/verify.js            (about 20 s)
//   node test/games/fireflies/verify.js --update   rewrite fingerprints.json (only when a level is changed ON PURPOSE)
//   FIREFLIES_LOGIC=<path to a copy of logic.js> runs it against another copy (defects.js does this)
// Exits 1 on any failed check.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');

const ROOT = path.resolve(__dirname, '../../..');
const LOGIC = process.env.FIREFLIES_LOGIC || path.join(ROOT, 'web/games/fireflies/logic.js');
const FP_FILE = path.join(__dirname, 'fingerprints.json');
const L = require(LOGIC);
const { MODES, NLEV } = L;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null && detail !== '' ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const plans = {}, rounds = {};
const all = [];
for (const m of MODES) { plans[m] = []; rounds[m] = []; for (let n = 1; n <= NLEV; n++) { plans[m].push(L.planOf(m, n)); rounds[m].push(L.roundsOf(m, n)); all.push([m, n]); } }

// ---------- 1. the table ----------
check('three modes, twenty levels each: 60 plans', MODES.join() === 'easy,medium,hard' && NLEV === 20 && all.length === 60);
{
  const bad = [];
  for (const [m, n] of all) {
    const p = plans[m][n - 1], rs = rounds[m][n - 1];
    if (rs.length !== p.jars || p.mix.length !== p.jars) bad.push(`${m} ${n} jars`);
  }
  check('every level has as many rounds (jars) as its plan says', bad.length === 0, bad.slice(0, 4));
}
{
  // the brief's jar counts: World 1 Easy 3-5, Medium 4-6, Hard 5-7; World 2 Hard 6-8 (Easy 5-6 and Medium 6-7 are this game's choice)
  const want = { easy: [[3, 5], [5, 6]], medium: [[4, 6], [6, 7]], hard: [[5, 7], [6, 8]] };
  const bad = [];
  for (const [m, n] of all) { const j = plans[m][n - 1].jars, [lo, hi] = want[m][n <= 10 ? 0 : 1]; if (j < lo || j > hi) bad.push(`${m} ${n}: ${j}`); }
  check('jars per level are in the brief\'s ranges (World 1: 3-5 / 4-6 / 5-7, World 2 Hard 6-8)', bad.length === 0, bad.slice(0, 5));
}
check('Easy level 1 targets 1-3, Easy level 10 targets 1-6', plans.easy[0].lo === 1 && plans.easy[0].hi === 3 && plans.easy[9].hi === 6);
check('Medium level 1 targets 1-5, Medium level 10 targets 1-10', plans.medium[0].lo === 1 && plans.medium[0].hi === 5 && plans.medium[9].hi === 10);
check('Hard World 1: singles from 2 up to 10 (levels 1-5), then sums to 10 from level 6',
  plans.hard.slice(0, 5).every((p) => p.lo >= 2 && p.hi <= 10 && /^c+$/.test(p.mix)) && plans.hard[4].hi === 10 && plans.hard.slice(5, 10).every((p) => p.hi === 10 && /a/.test(p.mix)));
check('Easy World 2: single numbers up to 10, never a sum', plans.easy.slice(10).every((p) => /^c+$/.test(p.mix)) && plans.easy[19].hi === 10);
check('Medium World 2: sums to 10 from level 11, sums of three groups only from level 16', plans.medium.slice(10, 20).every((p) => p.hi === 10 && /a/.test(p.mix)) && plans.medium.slice(0, 15).every((p) => !/b/.test(p.mix)) && plans.medium.slice(15).every((p) => /b/.test(p.mix)));
check('take-aways only on Hard and only from level 16', MODES.every((m) => plans[m].every((p, i) => (p.mix.includes('t') ? m === 'hard' && i + 1 >= 16 : true))) && plans.hard.slice(15).every((p) => /t/.test(p.mix)));
check('Hard sums of three groups: not before level 13; none on Easy or in Medium World 1', plans.hard.slice(0, 12).every((p) => !/b/.test(p.mix)) && plans.easy.every((p) => !/[ab]/.test(p.mix)) && plans.easy.every((p) => !/t/.test(p.mix)));
check('backdrops: World 1 uses themes 1, 2 and 6; World 2 uses themes 4-7 (and level 7-10 / 16-18 are moonlit)', plans.easy.slice(0, 10).every((p) => [1, 2, 6].includes(p.theme)) && plans.easy.slice(10).every((p) => p.theme >= 4 && p.theme <= 7) && [7, 8, 9, 10, 16, 17, 18].every((n) => plans.easy[n - 1].theme === 6));

// ---------- 2. every round of every level ----------
{
  const bad = [], seen = { c: 0, a: 0, b: 0, t: 0 };
  for (const [m, n] of all) {
    const p = plans[m][n - 1], rs = rounds[m][n - 1];
    rs.forEach((r, i) => {
      const tag = `${m} ${n} jar ${i + 1}`;
      seen[r.k]++;
      if (r.k !== p.mix[i]) bad.push(tag + ' kind');
      if (!r.parts.every((v) => Number.isInteger(v) && v >= 1)) bad.push(tag + ' parts');
      if (r.total < p.lo || r.total > p.hi || r.total > L.JAR_MAX || r.target > L.JAR_MAX) bad.push(tag + ' outside the level\'s range');
      if (r.k === 'c' && (r.parts.length !== 1 || r.target !== r.parts[0] || r.total !== r.target)) bad.push(tag + ' count');
      if ((r.k === 'a' && r.parts.length !== 2) || (r.k === 'b' && r.parts.length !== 3)) bad.push(tag + ' groups');
      if ((r.k === 'a' || r.k === 'b') && (r.target !== sum(r.parts) || r.total !== r.target)) bad.push(tag + ' sum');
      if (r.k === 't') {
        if (r.parts.length !== 2 || r.parts[0] !== r.total || r.parts[1] !== r.away || r.target !== r.total - r.away) bad.push(tag + ' take-away numbers');
        if (r.target < 1 || r.away < 1 || r.away >= r.total) bad.push(tag + ' take-away goes to ' + r.target);
      }
      if (i && JSON.stringify(rs[i - 1]) === JSON.stringify(r)) bad.push(tag + ' same jar twice running');
    });
    if (Math.max(...rs.map((r) => r.total)) !== p.hi) bad.push(`${m} ${n} never reaches its biggest number`);
  }
  check('every round: kind as planned, whole positive numbers, total within the level\'s range, sums and take-aways add up, no repeats', bad.length === 0, bad.slice(0, 5));
  check('all four kinds of round occur across the 60 levels', Object.values(seen).every((v) => v >= 8), seen);
}
{
  // the jar is never asked to hold more than ten or go below one; the numbers on the label are the numbers in the round
  let worstLow = 99, worstHigh = 0;
  for (const [m, n] of all) for (const r of rounds[m][n - 1]) { worstLow = Math.min(worstLow, r.target); worstHigh = Math.max(worstHigh, r.total); }
  check('no jar ever has to hold fewer than 1 or more than 10', worstLow >= 1 && worstHigh <= 10, { worstLow, worstHigh });
}
{
  // enough fireflies on screen to reach every jar (and few enough to fit): count > the most any jar needs, 8..14 at once
  const bad = [];
  for (const [m, n] of all) {
    const p = plans[m][n - 1], need = Math.max(...rounds[m][n - 1].map((r) => (r.k === 't' ? 0 : r.target)));
    if (p.count < 8 || p.count > 14 || p.count <= need) bad.push(`${m} ${n}: ${p.count} fireflies, a jar needs ${need}`);
    const f = L.fit(1199, p);
    if (f.count !== p.count || f.sep !== p.sep) bad.push(`${m} ${n} does not fit the Seeker's screen (${f.count}/${p.count})`);
  }
  check('8 to 14 fireflies at once, always more than any jar needs, and all fit the 915x412 screen', bad.length === 0, bad.slice(0, 4));
  const narrow = [];
  for (const [m, n] of all) for (const vw of [720, 800, 960]) { const f = L.fit(vw, plans[m][n - 1]); if (f.sep < L.MIN_SEP || f.count < 5 || f.count > plans[m][n - 1].count) narrow.push(`${m} ${n} @${vw}`); }
  check('squarer screens (iPad 720, 800, 960 wide): fewer fireflies, never a closer limit than a tap zone', narrow.length === 0, narrow.slice(0, 4));
}
{
  // a new level always starts with all its fireflies, whatever the seed (a crowded field must still fill)
  const bad = [];
  for (const [m, n] of all) for (let seed = 1; seed <= 40; seed++) {
    const p = plans[m][n - 1], f = L.fit(1199, p), sw = new L.Swarm({ rng: L.mulberry32(seed * 7919), field: L.layout(1199).field, count: f.count, sep: f.sep, speed: p.speed });
    if (sw.flies.length !== f.count || sw.minGap() < f.sep) bad.push(`${m} ${n} seed ${seed}: ${sw.flies.length}/${f.count}`);
  }
  check('every level starts with all its fireflies, spaced, for 40 different seeds each (2,400 starts)', bad.length === 0, bad.slice(0, 4));
}
check('a tap zone is at least 19vh: 2 x ZONE / 540 >= 19%', (2 * L.ZONE * 100) / 540 >= 19, ((2 * L.ZONE * 100) / 540).toFixed(2) + 'vh');
check('two tap zones never overlap: the closest allowed pass is 2 x ZONE, and every level\'s limit is at least that', L.MIN_SEP === 2 * L.ZONE && all.every(([m, n]) => plans[m][n - 1].sep >= L.MIN_SEP));

// ---------- 3. the label model: the exact rows ----------
const num = (v) => ({ t: 'num', v }), plus = { t: 'op', v: 'plus' }, minus = { t: 'op', v: 'minus' }, dots = (n, crossed) => ({ t: 'dots', n, crossed: crossed || 0 });
const R = (k, parts, target, total, away) => Object.assign({ k, parts, total: total == null ? target : total, target }, away != null ? { away } : {});
const LABELS = [
  [R('c', [1], 1), { numerals: [num(1)], dots: [dots(1)], total: 1, target: 1 }],
  [R('c', [3], 3), { numerals: [num(3)], dots: [dots(3)], total: 3, target: 3 }],
  [R('c', [10], 10), { numerals: [num(10)], dots: [dots(10)], total: 10, target: 10 }],
  [R('a', [3, 2], 5), { numerals: [num(3), plus, num(2)], dots: [dots(3), plus, dots(2)], total: 5, target: 5 }],
  [R('a', [9, 1], 10), { numerals: [num(9), plus, num(1)], dots: [dots(9), plus, dots(1)], total: 10, target: 10 }],
  [R('b', [2, 3, 4], 9), { numerals: [num(2), plus, num(3), plus, num(4)], dots: [dots(2), plus, dots(3), plus, dots(4)], total: 9, target: 9 }],
  [R('b', [1, 1, 1], 3), { numerals: [num(1), plus, num(1), plus, num(1)], dots: [dots(1), plus, dots(1), plus, dots(1)], total: 3, target: 3 }],
  [R('t', [7, 3], 4, 7, 3), { numerals: [num(7), minus, num(3)], dots: [dots(7, 3)], total: 7, target: 4 }],
  [R('t', [10, 2], 8, 10, 2), { numerals: [num(10), minus, num(2)], dots: [dots(10, 2)], total: 10, target: 8 }],
  [R('t', [3, 1], 2, 3, 1), { numerals: [num(3), minus, num(1)], dots: [dots(3, 1)], total: 3, target: 2 }],
];
{
  const bad = [];
  LABELS.forEach(([r, want], i) => { try { assert.deepStrictEqual(L.labelModel(r), want); } catch (e) { bad.push(`row ${i + 1}: got ${JSON.stringify(L.labelModel(r))}`); } });
  check(`label model: ${LABELS.length} rounds give exactly the expected numerals and dots rows`, bad.length === 0, bad.slice(0, 2));
}
{
  // lit dots, left to right across the groups; for a take-away the crossed dots dim as fireflies leave
  const lit = (r, n) => L.dotStates(r, n).map((d) => (d.lit ? 'o' : '.')).join('');
  const crossed = (r) => L.dotStates(r, r.total).map((d) => (d.crossed ? 'x' : '-')).join('');
  check('dots light one at a time across the groups: 3 + 2 with four in the jar', lit(R('a', [3, 2], 5), 4) === 'oooo.' && lit(R('a', [3, 2], 5), 0) === '.....' && lit(R('a', [3, 2], 5), 5) === 'ooooo');
  check('take-away 7 - 3: the last three dots are crossed; seven in the jar lights all, four leaves the crossed ones dim', crossed(R('t', [7, 3], 4, 7, 3)) === '----xxx' && lit(R('t', [7, 3], 4, 7, 3), 7) === 'ooooooo' && lit(R('t', [7, 3], 4, 7, 3), 4) === 'oooo...');
  const bad = [];
  for (const [m, n] of all) for (const r of rounds[m][n - 1]) {
    const lm = L.labelModel(r), ds = L.dotStates(r, r.target), nums = lm.numerals.filter((t) => t.t === 'num').map((t) => t.v), dg = lm.dots.filter((t) => t.t === 'dots');
    const tag = `${m} ${n} ${L.describe(r)}`;
    if (JSON.stringify(nums) !== JSON.stringify(r.parts)) bad.push(tag + ' numerals differ from the parts');
    if (JSON.stringify(dg.map((d) => d.n)) !== JSON.stringify(r.k === 't' ? [r.parts[0]] : r.parts)) bad.push(tag + ' dot groups differ from the numerals');
    if (ds.length !== lm.total || lm.total !== r.total) bad.push(tag + ' dots differ from the total');
    if (ds.filter((d) => d.lit).length !== Math.min(r.target, r.total)) bad.push(tag + ' lit dots at the target');
    if (r.k !== 't' && ds.some((d) => d.crossed)) bad.push(tag + ' a crossed dot in a sum');
    if (r.k === 't' && ds.filter((d) => d.crossed).length !== r.away) bad.push(tag + ' crossed dots differ from the number taken away');
    const ops = lm.numerals.filter((t) => t.t === 'op').map((t) => t.v);
    if (ops.length !== (r.k === 't' ? 1 : r.parts.length - 1) || ops.some((o) => o !== (r.k === 't' ? 'minus' : 'plus'))) bad.push(tag + ' signs');
    if (lm.dots.filter((t) => t.t === 'op').length !== (r.k === 't' ? 0 : ops.length)) bad.push(tag + ' signs between the dots');
  }
  check('all 60 levels: numerals = the round\'s numbers, dots = the numerals, signs match the kind, lit dots = the target', bad.length === 0, bad.slice(0, 4));
}

// ---------- 4. the jar's rules ----------
{
  const r = new L.Run('easy', 1), want = r.target;
  const out = [];
  for (let i = 0; i < want; i++) out.push(r.catchFly());
  check('counting: each tap adds exactly one, the last one fills the jar', out.every((o, i) => o.type === 'catch' && o.n === i + 1 && o.full === (i === want - 1)) && r.inJar === want && r.phase === 'full', out.map((o) => o.n));
  const over = r.catchFly(), over2 = r.catchFly();
  check('overfill: one more tap changes nothing but the count of overfills', over.type === 'overfill' && over2.type === 'overfill' && r.inJar === want && r.overfills === 2 && r.phase === 'full' && r.caught === want);
  check('a jar full of its number takes no tap on the jar either (a fill round just ignores it)', r.tapJar().type === 'jar' && r.inJar === want);
}
{
  const r = new L.Run('hard', 20);   // starts with a 'b' (sum of three)
  const a = r.advance();
  check('advance() before the jar is full does nothing', a.type === 'ignored' && r.ri === 0);
  const rr = new L.Run('easy', 1);
  for (let i = 0; i < rr.target; i++) rr.catchFly();
  const adv = rr.advance();
  check('advance() after a full jar moves to the next jar, empty, with its own target', adv.type === 'jar' && rr.ri === 1 && rr.inJar === 0 && rr.phase === 'fill' && rr.capped === 1);
}
{
  // a take-away: starts full, taps on the jar let fireflies out, outside fireflies only shake, never below the target
  const r = new L.Run('hard', 16); r.goto(3);   // 'aabtaba': jar 4 is a take-away
  const t = r.round, log = [];
  check('hard 16 jar 4 is a take-away that starts with the jar full', t.k === 't' && r.inJar === t.total && r.takeAway);
  const shake = r.catchFly();
  check('take-away: a tap on an outside firefly is only a shake (no count, no overfill)', shake.type === 'shake' && r.inJar === t.total && r.overfills === 0 && r.caught === 0);
  for (let i = 0; i < t.away; i++) log.push(r.tapJar());
  check('take-away: letting fireflies out stops exactly at the label\'s answer', r.inJar === t.target && log.every((o, i) => o.type === 'release' && o.full === (i === t.away - 1)) && r.phase === 'full', { start: t.total, away: t.away, left: r.inJar });
  const more = r.tapJar(), more2 = r.catchFly();
  check('take-away: one more tap on the jar is an overfill and the count never goes below the answer; outside taps still only shake', more.type === 'overfill' && r.inJar === t.target && r.inJar >= 1 && r.overfills === 1 && more2.type === 'shake' && r.overfills === 1);
  let bad = 0;
  for (let i = 0; i < 50; i++) { r.tapJar(); if (r.inJar < 1) bad++; }
  check('take-away: fifty taps in a row never take the jar below one', bad === 0 && r.inJar === t.target);
}
{
  check('stars: 0 overfills = 3, 1 or 2 = 2, more = 1 (never about speed)', L.starsFor(0) === 3 && L.starsFor(1) === 2 && L.starsFor(2) === 2 && L.starsFor(3) === 1 && L.starsFor(40) === 1);
  // model players through the real Run on all 60 levels
  const bad = [], tally = { perfect: 0, over: 0, idle: 0 };
  for (const [m, n] of all) {
    // a perfect player: exactly the right taps
    const r = new L.Run(m, n);
    let taps = 0, last = null;
    while (!r.done) {
      const rd = r.round;
      if (r.takeAway) { while (r.inJar > rd.target) { r.tapJar(); taps++; } } else { while (r.inJar < rd.target) { r.catchFly(); taps++; } }
      if (r.phase !== 'full') bad.push(`${m} ${n} perfect player: jar ${r.ri + 1} not full`);
      last = r.advance();
    }
    const needTaps = sum(rounds[m][n - 1].map((q) => (q.k === 't' ? q.away : q.target)));
    if (last.type !== 'level' || last.stars !== 3 || r.overfills !== 0 || taps !== needTaps || last.coins !== r.rounds.length + L.CHEST_COINS) bad.push(`${m} ${n} perfect player: ${JSON.stringify(last)} taps ${taps}/${needTaps}`);
    else tally.perfect++;
    // one tap too many on every jar
    const o = new L.Run(m, n);
    while (!o.done) { const rd = o.round; if (o.takeAway) { while (o.inJar > rd.target) o.tapJar(); o.tapJar(); } else { while (o.inJar < rd.target) o.catchFly(); o.catchFly(); } o.advance(); }
    if (o.overfills !== o.rounds.length || o.finalStars !== L.starsFor(o.rounds.length)) bad.push(`${m} ${n} over-tapper: ${o.overfills} overfills, ${o.finalStars} stars`); else tally.over++;
    // a player who only taps outside fireflies in a take-away, or never taps: nothing moves, nothing breaks
    const q = new L.Run(m, n), before = JSON.stringify([q.inJar, q.ri, q.overfills]);
    if (q.takeAway) { for (let i = 0; i < 20; i++) q.catchFly(); } else { for (let i = 0; i < 20; i++) q.tapJar(); }
    if (JSON.stringify([q.inJar, q.ri, q.overfills]) !== before) bad.push(`${m} ${n} wrong-kind taps changed something`); else tally.idle++;
  }
  check('all 60 levels: a perfect player takes exactly the needed taps and earns 3 stars, a chest and its coins', bad.filter((b) => /perfect/.test(b)).length === 0 && tally.perfect === 60, bad.filter((b) => /perfect/.test(b)).slice(0, 3));
  check('all 60 levels: tapping once too often on every jar costs stars (never more than to 1) and nothing else', bad.filter((b) => /over-tapper/.test(b)).length === 0 && tally.over === 60);
  check('all 60 levels: taps of the wrong kind (jar in a fill round, outside fireflies in a take-away) change nothing', bad.filter((b) => /wrong-kind/.test(b)).length === 0 && tally.idle === 60);
  const d = new L.Run('easy', 1); while (!d.done) { while (d.inJar < d.target) d.catchFly(); d.advance(); }
  check('after the last jar every tap is ignored', d.catchFly().type === 'ignored' && d.tapJar().type === 'ignored' && d.advance().type === 'ignored' && d.done);
}

// ---------- 5. the save ----------
{
  const f = L.freshSave();
  check('fresh save has the FAIRY.md shape', JSON.stringify(Object.keys(f).slice(0, 5)) === JSON.stringify(['v', 'mode', 'unlocked', 'stars', 'coins']) && f.v === 1 && f.mode === 'easy' && JSON.stringify(f.unlocked) === '{"easy":1,"medium":1,"hard":1}' && JSON.stringify(f.stars) === '{"easy":[],"medium":[],"hard":[]}' && f.coins === 0);
  check('junk in, a fresh save out; an unknown mode name is ignored', ['', 'nope', '[]', '17', 'null', '{"v":'].every((j) => JSON.stringify(L.migrate(j)) === JSON.stringify(f)) && L.migrate({ mode: 'banana' }).mode === 'easy');
  const odd = L.migrate({ mode: 'hard', unlocked: { easy: 99, medium: -4, hard: 'x' }, stars: { easy: [3, 2, 9, -1, 1], medium: 'no', hard: [0, 0, 2] }, coins: 12.9, jars: -5, extra: 1 });
  check('a damaged save is repaired: values clamped, a beaten level keeps the next one open', odd.mode === 'hard' && odd.unlocked.easy === 20 && odd.unlocked.medium === 1 && odd.unlocked.hard === 4 && JSON.stringify(odd.stars.easy) === '[3,2,3,0,1]' && odd.stars.medium.length === 0 && odd.coins === 12 && odd.jars === 0 && !('extra' in odd), odd);
  const keep = L.migrate(JSON.stringify(Object.assign(L.freshSave(), { mode: 'medium', coins: 40, stars: { easy: [3, 3, 2], medium: [1], hard: [] }, unlocked: { easy: 4, medium: 2, hard: 1 } })));
  check('a good save round-trips', keep.mode === 'medium' && keep.coins === 40 && keep.unlocked.easy === 4 && JSON.stringify(keep.stars.easy) === '[3,3,2]');
  check('World 2 opens per mode only when level 10 of that mode is finished (unlocked 11)', L.migrate({ stars: { easy: new Array(10).fill(1) } }).unlocked.easy === 11 && L.migrate({ stars: { easy: new Array(10).fill(1) } }).unlocked.medium === 1);
}

// ---------- 6. the swarm: the spacing rule, over long simulated play ----------
function simulate(mode, level, vw, seconds, o) {
  o = o || {};
  const p = L.planOf(mode, level), fit = L.fit(vw, p), lay = L.layout(vw);
  const sw = new L.Swarm({ rng: L.mulberry32(o.seed || 11), field: lay.field, count: fit.count, sep: fit.sep, speed: p.speed });
  const dt = 1 / 20, steps = Math.round(seconds / dt);
  let minGap = Infinity, outside = 0, over = 0, ambiguous = 0, nnSum = 0, nnN = 0, dist = 0, distN = 0, short = 0;
  let prev = new Map(sw.flies.map((f) => [f.id, [f.x, f.y]]));
  let rngC = L.mulberry32(99);
  for (let i = 0; i < steps; i++) {
    sw.step(dt);
    if (i % 14 === 0 && sw.flies.length) sw.remove(sw.flies[Math.floor(rngC() * sw.flies.length)]);   // a catch every 0.7 s: the replacements must respect the spacing too
    if (i % 200 === 0 && sw.flies.length > 3) { sw.remove(sw.flies[0]); sw.remove(sw.flies[1]); sw.remove(sw.flies[2]); }
    const g = sw.minGap();
    if (g < minGap) minGap = g;
    if (sw.flies.length > sw.want) over++;
    for (const f of sw.flies) {
      if (f.x < lay.field.x0 - 1e-6 || f.x > lay.field.x1 + 1e-6 || f.y < lay.field.y0 - 1e-6 || f.y > lay.field.y1 + 1e-6) outside++;
      const q = prev.get(f.id);
      if (q) { dist += Math.hypot(f.x - q[0], f.y - q[1]); distN++; }
    }
    prev = new Map(sw.flies.map((f) => [f.id, [f.x, f.y]]));
    if (i % 20 === 0) for (const f of sw.flies) { let nn = Infinity; for (const h of sw.flies) if (h !== f) nn = Math.min(nn, Math.hypot(f.x - h.x, f.y - h.y)); if (nn < Infinity) { nnSum += nn; nnN++; } }
    // two zones overlapping would make a tap ambiguous: check the point midway between any two nearest flies picks at most one
    if (i % 40 === 0 && sw.flies.length >= 2) { const a = sw.flies[0], b = sw.flies[1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; let n = 0; for (const f of sw.flies) if (Math.hypot(f.x - mx, f.y - my) <= L.ZONE) n++; if (n > 1) ambiguous++; }
    if (sw.flies.length < sw.want - 4 && i > 100) short++;
  }
  for (let i = 0; i < 100; i++) sw.step(dt);   // quiet: every replacement has arrived
  return { want: sw.want, sep: sw.sep, minGap, outside, over, ambiguous, mean: nnN ? nnSum / nnN : 0, speed: distN ? (dist / distN) / dt : 0, refilled: sw.flies.length === sw.want, short, settled: sw.minGap() };
}
const SAMPLE = [1, 5, 10, 11, 15, 20];
const sims = {};
{
  const bad = [], t0 = Date.now();
  for (const m of MODES) for (const n of SAMPLE) {
    const s = sims[m + n] = simulate(m, n, 1199, 2000);
    if (s.minGap < s.sep - 1e-6 || s.minGap < L.MIN_SEP - 1e-6) bad.push(`${m} ${n}: closest ${s.minGap.toFixed(3)} < ${s.sep}`);
    if (s.outside) bad.push(`${m} ${n}: ${s.outside} outside the field`);
    if (s.over) bad.push(`${m} ${n}: more fireflies than wanted`);
    if (s.ambiguous) bad.push(`${m} ${n}: a tap could mean two fireflies`);
    if (!s.refilled || s.settled < s.sep - 1e-6) bad.push(`${m} ${n}: the replacements did not all arrive`);
  }
  check(`spacing: 2,000 simulated seconds on ${MODES.length * SAMPLE.length} levels (levels ${SAMPLE.join(', ')} of each mode) with a firefly caught every 0.7 s: never closer than the level's limit, never off the field, never ambiguous, always refilled`, bad.length === 0, bad.slice(0, 5) .concat(`${((Date.now() - t0) / 1000).toFixed(1)} s`));
  const narrow = [];
  for (const [m, n, vw] of [['easy', 20, 720], ['hard', 20, 720], ['hard', 20, 800], ['medium', 20, 960], ['easy', 1, 720]]) {
    const s = simulate(m, n, vw, 600, { seed: 3 });
    if (s.minGap < L.MIN_SEP - 1e-6 || s.minGap < s.sep - 1e-6 || s.outside) narrow.push(`${m} ${n} @${vw}: ${s.minGap.toFixed(2)}`);
  }
  check('spacing holds on squarer screens too (720, 800, 960 wide)', narrow.length === 0, narrow);
}
{
  const a = simulate('hard', 12, 1199, 120, { seed: 5 }), b = simulate('hard', 12, 1199, 120, { seed: 5 });
  check('the same seed makes the same drift (a play can be replayed)', JSON.stringify(a) === JSON.stringify(b));
  // pick: the nearest free firefly inside its zone, never a busy one
  const lay = L.layout(1199), sw = new L.Swarm({ rng: L.mulberry32(2), field: lay.field, count: 10, sep: 120, speed: 30 });
  const f = sw.flies[0], g = sw.pick(f.x + 10, f.y - 8);
  f.busy = true;
  const none = sw.pick(f.x + 10, f.y - 8);
  check('a tap picks the firefly it lands in; a busy one (flying back from an overfill) cannot be picked; empty space picks nothing', g === f && none === null && sw.pick(f.x + L.ZONE * 2, f.y + L.ZONE * 2) !== f && sw.pick(5, 5) === null);
  f.busy = false;
  const n0 = sw.flies.length; sw.remove(sw.flies[0]);
  let t = 0; while (sw.flies.length < n0 && t < 5) { sw.step(0.1); t += 0.1; }
  check('a caught firefly is replaced after a moment, never sooner than the pause', sw.flies.length === n0 && t >= L.RESPAWN - 0.15 && t <= 3, t.toFixed(2) + ' s');
}

// ---------- 7. difficulty rises ----------
const KW = { c: 0, a: 1, b: 2, t: 2 };
function metrics(m, n) {
  const p = plans[m][n - 1], rs = rounds[m][n - 1], hi = Math.max(...rs.map((r) => r.total)), kind = sum(rs.map((r) => KW[r.k])) / rs.length;
  return { hi, jars: rs.length, kind, speed: p.speed, count: p.count, sep: p.sep, score: hi * 2 + rs.length * 1.5 + kind * 5 + p.speed * 0.12 + p.count * 0.3 + (150 - p.sep) * 0.06 };
}
{
  const M = {};
  for (const m of MODES) M[m] = Array.from({ length: NLEV }, (_, i) => metrics(m, i + 1));
  const nondec = (arr, key, a, b) => { for (let i = a; i < b; i++) if (M[arr][i + 1][key] < M[arr][i][key]) return false; return true; };
  const bad = [];
  for (const m of MODES) {
    for (const key of ['hi', 'jars', 'kind', 'speed', 'count', 'score']) {
      if (!nondec(m, key, 0, 9)) bad.push(`${m} ${key} falls inside levels 1-10`);
      if (!nondec(m, key, 10, 19)) bad.push(`${m} ${key} falls inside levels 11-20`);
    }
    if (!(M[m][9].score > M[m][0].score && M[m][19].score > M[m][10].score)) bad.push(`${m}: level 10 is not harder than 1, or 20 than 11`);
    if (!(M[m][10].score > M[m][9].score)) bad.push(`${m}: level 11 is not harder than level 10`);
    for (let i = 0; i < NLEV - 1; i++) if (!(M[m][i + 1].speed > M[m][i].speed)) bad.push(`${m}: drift speed does not rise from ${i + 1} to ${i + 2}`);
    for (let i = 0; i < NLEV - 1; i++) if (!(M[m][i + 1].sep <= M[m][i].sep)) bad.push(`${m}: the closest pass grows from ${i + 1} to ${i + 2}`);
    if (!(M[m][9].hi > M[m][0].hi || m === 'hard')) bad.push(`${m}: level 10's biggest number is not above level 1's`);
  }
  check('difficulty rises within World 1 (1 to 10) and World 2 (11 to 20) in every mode: biggest number, jars, kinds of jar, firefly count, drift speed, composite', bad.length === 0, bad.slice(0, 5));
  check('World 2 starts above where World 1 ends (level 11 harder than level 10) in every mode', MODES.every((m) => M[m][10].score > M[m][9].score && M[m][10].speed > M[m][9].speed));
  const order = [];
  for (let n = 0; n < NLEV; n++) if (!(M.easy[n].score < M.medium[n].score && M.medium[n].score < M.hard[n].score)) order.push(n + 1);
  check('Easy < Medium < Hard at every level number (composite)', order.length === 0, order);
  const ord2 = [];
  for (let n = 0; n < NLEV; n++) if (!(M.easy[n].speed < M.medium[n].speed && M.medium[n].speed < M.hard[n].speed && M.easy[n].sep > M.medium[n].sep && M.medium[n].sep > M.hard[n].sep && M.easy[n].hi <= M.medium[n].hi && M.medium[n].hi <= M.hard[n].hi)) ord2.push(n + 1);
  check('Easy < Medium < Hard at every level number: speed up, passes closer, biggest number not smaller', ord2.length === 0, ord2);
  check('Hard 20 is clearly the top: the hardest score, the fastest drift, the closest passes, three kinds of jar',
    M.hard[19].score === Math.max(...MODES.flatMap((m) => M[m].map((x) => x.score))) && M.hard[19].speed === Math.max(...MODES.flatMap((m) => M[m].map((x) => x.speed))) && M.hard[19].sep === L.MIN_SEP && /a/.test(plans.hard[19].mix) && /b/.test(plans.hard[19].mix) && /t/.test(plans.hard[19].mix));
  check('Easy 1 is the gentlest: the slowest drift, the widest berth, the fewest jars', M.easy[0].speed === Math.min(...MODES.flatMap((m) => M[m].map((x) => x.speed))) && M.easy[0].sep === Math.max(...MODES.flatMap((m) => M[m].map((x) => x.sep))) && M.easy[0].jars === 3);
  // measured in the simulation (not just the table): fireflies really do drift faster and pass closer as levels and modes rise
  const sp = (k) => sims[k].speed, mean = (k) => sims[k].mean;
  check('simulated drift: fireflies really move faster at Hard 20 than Easy 1, and faster at level 20 than 1 in every mode', sp('hard20') > sp('easy1') * 1.5 && MODES.every((m) => sp(m + 20) > sp(m + 1)) && sp('easy1') < sp('medium1') && sp('medium1') < sp('hard1'),
    { easy1: +sp('easy1').toFixed(1), medium1: +sp('medium1').toFixed(1), hard1: +sp('hard1').toFixed(1), hard20: +sp('hard20').toFixed(1) });
  check('simulated passes: neighbours sit closer at Hard 20 than at Easy 1 (more fireflies, tighter limit)', mean('hard20') < mean('easy1') && sims.hard20.sep < sims.easy1.sep, { easy1: +mean('easy1').toFixed(0), hard20: +mean('hard20').toFixed(0) });
}
check('hints: Easy sooner than Medium sooner than Hard, none sooner than 5 s', L.HINT_AFTER.easy < L.HINT_AFTER.medium && L.HINT_AFTER.medium < L.HINT_AFTER.hard && L.HINT_AFTER.easy >= 5 && all.every(([m, n]) => plans[m][n - 1].hint === L.HINT_AFTER[m]));

// ---------- 8. the screen ----------
{
  const bad = [];
  for (const vw of [720, 800, 960, 1199, 1300]) {
    const lay = L.layout(vw), f = lay.field, J = lay.jar;
    if (f.x0 - L.ZONE < lay.colW) bad.push(`${vw}: a tap zone reaches into the jar's column`);
    if (f.x1 + L.ZONE > vw || f.y0 - L.ZONE < 0 || f.y1 + L.ZONE > 540) bad.push(`${vw}: a tap zone can leave the screen`);
    if (!(f.x1 > f.x0 + 150 && f.y1 > f.y0 + 200)) bad.push(`${vw}: field too small`);
    if (J.x + J.r + 26 > f.x0 - L.ZONE + 2 || J.x - J.r < 0) bad.push(`${vw}: jar overlaps the field`);
  }
  check('layout: tap zones stay on screen and clear of the jar column at every width from 720 to 1300', bad.length === 0, bad);
}

// ---------- 9. frozen fingerprints ----------
{
  const fp = {};
  for (const m of MODES) fp[m] = Array.from({ length: NLEV }, (_, i) => crypto.createHash('sha1').update(L.canon(m, i + 1)).digest('hex').slice(0, 16));
  if (process.argv.includes('--update')) { fs.writeFileSync(FP_FILE, JSON.stringify(fp, null, 1) + '\n'); console.log('fingerprints.json rewritten'); }
  let frozen = null;
  try { frozen = JSON.parse(fs.readFileSync(FP_FILE, 'utf8')); } catch (e) { /* reported below */ }
  const diff = [];
  for (const m of MODES) for (let i = 0; i < NLEV; i++) if (!frozen || !frozen[m] || frozen[m][i] !== fp[m][i]) diff.push(`${m} ${i + 1}`);
  check('60 fingerprints: every level (plan and rounds) is exactly as frozen', frozen && diff.length === 0, diff.slice(0, 8));
  check('the 60 fingerprints are all different', new Set(MODES.flatMap((m) => fp[m])).size === 60);
}

// ---------- 10. words that must never appear ----------
{
  const re = new RegExp([['sol', 'ana'], ['wal', 'let'], ['us', 'dc'], ['jup', 'iter'], ['\\bst', 'ak(e|ed|ing)'], ['dev', 'net'], ['main', 'net'], ['block', 'chain'], ['d', 'app'], ['pages\\.', 'dev'], ['mock', 'pay']].map((p) => p.join('')).join('|'), 'i');
  const hits = [];
  for (const dir of [path.join(ROOT, 'web/games/fireflies'), __dirname]) for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => { if (re.test(line)) hits.push(`${path.relative(ROOT, full)}:${i + 1}`); });
  }
  check('no forbidden wording (money, accounts, chains) anywhere in the game or its tests', hits.length === 0, hits.slice(0, 5));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
