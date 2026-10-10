// Fairy Flight: the proof. Runs the rules in web/games/flight/logic.js in Node.
//   node test/games/flight/verify.js                      everything (a few seconds)
//   node test/games/flight/verify.js --write-fingerprints  freeze the table and the 60 courses as they are now (a deliberate act)
//   FLIGHT_LOGIC=<file>                                    run it against another copy of logic.js (defects.js does this)
// What it shows:
//   - the level table is what it should be (two worlds, what comes in when) and frozen by sha1; every one of the 60 courses
//     (20 levels x Easy, Medium, Hard) is frozen by sha1 too, so no course can drift
//   - the modes scale the same course: speed x0.8 / x1 / x1.25, dust radius wide / medium / tight, enemies half / all / half again
//     and bugs slower / as designed / faster, no coin loss on Easy
//   - in every course, in every mode, a sweep over (time, height) at 60 % of her vertical speed finds a way that brings every
//     plant to life and takes the key without touching an enemy; the sweep is shown to bite (it fails at no speed)
//   - a model child who sees 1.5 s ahead and reacts late finishes every course, never bonks on Easy and gets 3 stars there;
//     a very young child with no finger at all, or one at a single height, finishes too (nothing can be failed)
//   - difficulty by a fixed cost function (enemy density x speed / gap, plus the plants' demands) rises 1 -> 10 and 11 -> 20, 11 is
//     above 10, and Easy < Medium < Hard on every level
//   - the rules: bloom radius, one coin a plant, bonks (shield, coin floor at 0, none lost on Easy), stars, the key, the chest, the
//     easing, the save
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { sweep } = require('./sweep');
const M = require('./models');

const ROOT = path.resolve(__dirname, '../../..');
const LOGIC = path.resolve(process.env.FLIGHT_LOGIC || path.join(ROOT, 'web/games/flight/logic.js'));
const L = require(LOGIC);
const FP_FILE = path.join(__dirname, 'fingerprints.json');
const WRITE = process.argv.includes('--write-fingerprints');
const NOFREEZE = !!process.env.FLIGHT_NOFREEZE;   // defects.js: skip the two frozen checks, to show the other checks catch a defect on their own

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null && detail !== '' ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}
const sha1 = (v) => crypto.createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : x))).digest('hex');
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);
const MODES = L.MODES, N = L.NLEV;

// ---------------------------------------------------------------- 1. the level table
const T = L.LEVELS;
check('there are 20 levels, numbered 1 to 20', T.length === N && T.every((c, i) => c.n === i + 1));
check('levels 1-10 are World 1 (themes 0-3), levels 11-20 World 2 (themes 4-7), themes never go back',
  T.every((c, i) => c.world === (i < 10 ? 1 : 2) && (i < 10 ? c.theme <= 3 : c.theme >= 4 && c.theme <= 7)) && T.every((c, i) => i === 0 || c.theme >= T[i - 1].theme));
check('World 1 courses run 40 s rising to 60 s; World 2 55 s rising to 80 s (at Medium speed)',
  T[0].secs === 40 && T[9].secs === 60 && T[10].secs === 55 && T[19].secs === 80 && T.every((c, i) => i === 0 || i === 10 || c.secs >= T[i - 1].secs));
check('scroll speed rises through each world and World 2 starts faster than World 1 ended',
  T.every((c, i) => i === 0 || i === 10 || c.speed > T[i - 1].speed) && T[10].speed > T[9].speed);
check('plants per course rise through each world (6 to 15, then 14 to 24)', T.every((c, i) => i === 0 || i === 10 || c.plants > T[i - 1].plants) && T[0].plants === 6 && T[9].plants === 15 && T[10].plants === 14 && T[19].plants === 24);
check('critters from level 3, bugs from level 5', T.every((c) => (c.n >= 3) === (c.critters > 0) && (c.n >= 5) === (c.bugs > 0)));
check('plants on clouds from level 7; moving clouds from level 15', T.every((c) => (c.n >= 7) === !!c.tiers.cloud && (c.n >= 15) === (c.moving > 0)));
check('two critters together (pairs) only in World 2; bugs that weave from level 13', T.every((c) => (c.world === 2) === (c.pairs > 0) && c.patterns.includes('weave') === (c.n >= 13)));
check('the enemy counts never fall within a world', T.every((c, i) => i === 0 || i === 10 || c.critters + c.bugs >= T[i - 1].critters + T[i - 1].bugs));
check('the modes are as designed (speed, dust, pace, coin loss)',
  near(L.MODE.easy.speed, 0.8) && near(L.MODE.medium.speed, 1) && near(L.MODE.hard.speed, 1.25)
  && L.MODE.easy.dust > L.MODE.medium.dust && L.MODE.medium.dust > L.MODE.hard.dust
  && L.MODE.easy.slow < 1 && L.MODE.easy.bug < 1 && L.MODE.hard.bug > 1 && L.MODE.easy.loss === false && L.MODE.medium.loss === true && L.MODE.hard.loss === true && L.MODE.hard.extra > 0);

// ---------------------------------------------------------------- 2. frozen: the table and the 60 courses
const tableHash = sha1({ T, MODE: L.MODE, consts: [L.GROUND, L.PX_NOM, L.Y_MIN, L.Y_MAX, L.VY_MAX, L.FOLLOW_Y, L.KEY_R, L.PSC, L.CRITTER_R, L.BUG_R, L.CHEST_SX, L.X_FIRST, L.TAIL, L.CLEAR_END] });
const courseHash = {};
for (let n = 1; n <= N; n++) for (const m of MODES) courseHash[m + n] = sha1(L.buildCourse(n, m));
if (WRITE) {
  fs.writeFileSync(FP_FILE, JSON.stringify({ table: tableHash, courses: courseHash }, null, 1) + '\n');
  console.log(`wrote ${FP_FILE}: the table and ${Object.keys(courseHash).length} courses`);
}
const FP = JSON.parse(fs.readFileSync(FP_FILE, 'utf8'));
if (!NOFREEZE) check('the level table is frozen (sha1)', FP.table === tableHash, FP.table === tableHash ? tableHash.slice(0, 12) : `now ${tableHash.slice(0, 12)}, frozen ${String(FP.table).slice(0, 12)}`);
const drift = Object.keys(courseHash).filter((k) => FP.courses[k] !== courseHash[k]);
if (!NOFREEZE) check(`all ${N * MODES.length} courses are frozen (sha1), none has drifted`, drift.length === 0 && Object.keys(FP.courses).length === N * MODES.length, drift.slice(0, 6).join(' '));
{
  // the same course twice, and a fresh run of the generator, give the same bytes (nothing depends on a clock or Math.random)
  const keep = Math.random; let calls = 0; Math.random = () => { calls++; return 0.5; };
  let same = true;
  try { for (let n = 1; n <= N; n += 3) for (const m of MODES) { delete require.cache[LOGIC]; const L2 = require(LOGIC); if (sha1(L2.buildCourse(n, m)) !== courseHash[m + n]) same = false; } } finally { Math.random = keep; }
  check('a course is a pure function of its level and mode (a fresh load builds the same bytes; no Math.random is used)', same && calls === 0, `${calls} random calls`);
}

// ---------------------------------------------------------------- 3. the courses, every mode
const course = (n, m) => L.buildCourse(n, m);
{
  let bad = [];
  for (let n = 1; n <= N; n++) for (const m of MODES) {
    const c = course(n, m), cfg = T[n - 1];
    if (c.plants.length !== cfg.plants) bad.push(`${m}${n}: plants ${c.plants.length}`);
    for (let i = 1; i < c.plants.length; i++) if (c.plants[i].x - c.plants[i - 1].x < 200) bad.push(`${m}${n}: plants ${i - 1},${i} too close`);
    for (const p of c.plants) {
      if (p.hy < 90 || p.hy > 420) bad.push(`${m}${n}: plant ${p.id} head at ${p.hy}`);
      if (p.amp && (p.hy - p.amp < 80 || p.hy + p.amp > 432)) bad.push(`${m}${n}: moving plant ${p.id} leaves the sky`);
      if (p.x < L.X_FIRST - 1 || p.x > c.xEnd - L.TAIL + 1) bad.push(`${m}${n}: plant ${p.id} out of the course`);
    }
    if (c.key.x < c.plants[0].x || c.key.x > c.plants[c.plants.length - 1].x || c.key.y < 130 || c.key.y > 340) bad.push(`${m}${n}: key out of place`);
    for (const e of c.enemies) {
      if (e.x > c.xEnd - L.CLEAR_END + 1) bad.push(`${m}${n}: enemy ${e.id} too near the chest`);
      if (Math.abs(e.x - c.key.x) < 299) bad.push(`${m}${n}: enemy ${e.id} on the key`);
      if (e.cls === 'bug' && (e.y - e.amp < 90 || e.y + e.amp > 410)) bad.push(`${m}${n}: bug ${e.id} flies out of the sky`);
      if (e.cls === 'bug' && !cfg.patterns.includes(e.pat)) bad.push(`${m}${n}: bug ${e.id} flies a pattern (${e.pat}) the level does not have`);
      if (e.cls === 'critter' && e.y !== L.CRITTER_Y) bad.push(`${m}${n}: critter ${e.id} off the ground`);
    }
    if (n < 3 && m !== 'hard' && c.enemies.length) bad.push(`${m}${n}: enemies before level 3`);
    if (n >= 3 && !c.enemies.some((e) => e.cls === 'critter')) bad.push(`${m}${n}: no critter`);
    if (n >= 5 && m !== 'easy' && !c.enemies.some((e) => e.cls === 'bug')) bad.push(`${m}${n}: no bug`);
    if (n < 5 && c.enemies.some((e) => e.cls === 'bug')) bad.push(`${m}${n}: a bug before level 5`);
    if (!c.plants.some((p) => p.sup === 'cloud' || p.sup === 'mcloud') === (n >= 7) && m === 'medium') bad.push(`${m}${n}: cloud plants wrong`);
    if ((n >= 15) !== c.plants.some((p) => p.sup === 'mcloud') && m === 'medium' && n >= 15) bad.push(`${m}${n}: no moving cloud`);
    if (n < 15 && c.plants.some((p) => p.sup === 'mcloud')) bad.push(`${m}${n}: a moving cloud before level 15`);
    if (n >= 11 && m === 'medium' && !c.enemies.some((e, i, a) => e.cls === 'critter' && a[i + 1] && a[i + 1].cls === 'critter' && a[i + 1].x - e.x < 260)) bad.push(`${m}${n}: no two critters together`);
    if (n < 11 && c.enemies.some((e, i, a) => e.cls === 'critter' && a[i + 1] && a[i + 1].cls === 'critter' && a[i + 1].x - e.x < 260 && m === 'medium')) bad.push(`${m}${n}: two critters together in World 1`);
    const secs = c.tStop;
    const want = cfg.secs / L.MODE[m].speed + 0.6;
    if (Math.abs(secs - want) > 1.2) bad.push(`${m}${n}: ${secs.toFixed(1)} s, want about ${want.toFixed(1)}`);
  }
  check('every one of the 60 courses is well formed (plants, key, enemies, patterns, what comes in when, length)', bad.length === 0, bad.slice(0, 6));
}
{
  let bad = [];
  for (let n = 1; n <= N; n++) {
    const e = course(n, 'easy'), md = course(n, 'medium'), h = course(n, 'hard');
    if (!near(e.v, T[n - 1].speed * 0.8, 1e-6) || !near(md.v, T[n - 1].speed, 1e-6) || !near(h.v, T[n - 1].speed * 1.25, 1e-6)) bad.push(`${n}: speed`);
    if (!(e.dust > md.dust && md.dust > h.dust)) bad.push(`${n}: dust`);
    if (JSON.stringify(e.plants.map((p) => [p.x, p.hy, p.kind, p.sup, p.by])) !== JSON.stringify(md.plants.map((p) => [p.x, p.hy, p.kind, p.sup, p.by])) ||
        JSON.stringify(h.plants.map((p) => [p.x, p.hy, p.kind, p.sup, p.by])) !== JSON.stringify(md.plants.map((p) => [p.x, p.hy, p.kind, p.sup, p.by]))) bad.push(`${n}: the plants differ between modes`);
    if (JSON.stringify(e.key) !== JSON.stringify(md.key) || JSON.stringify(h.key) !== JSON.stringify(md.key)) bad.push(`${n}: the key differs`);
    if (e.enemies.length !== Math.ceil(md.enemies.length / 2)) bad.push(`${n}: Easy has ${e.enemies.length} enemies, Medium ${md.enemies.length}`);
    if (h.enemies.length < md.enemies.length + Math.ceil(md.enemies.length * 0.5) || h.enemies.length <= md.enemies.length) bad.push(`${n}: Hard has ${h.enemies.length}, Medium ${md.enemies.length}`);
    if (e.loss !== false || md.loss !== true || h.loss !== true) bad.push(`${n}: coin loss`);
    // every Medium enemy is also in Hard, unchanged except for the bugs' pace; Easy's are a subset, slowed
    for (const en of md.enemies) {
      const he = h.enemies.find((q) => q.id === en.id), ee = e.enemies.find((q) => q.id === en.id);
      if (!he || he.x !== en.x || he.y !== en.y || he.kind !== en.kind) bad.push(`${n}: enemy ${en.id} not in Hard as designed`);
      if (he && he.cls === 'bug' && !(he.om >= en.om && he.ve > en.ve - 1e-9 && (en.ve === 0 || he.ve > en.ve))) bad.push(`${n}: Hard bug ${en.id} not faster`);
      if (ee && ee.cls === 'bug' && !(ee.om <= en.om && (en.ve === 0 || ee.ve < en.ve))) bad.push(`${n}: Easy bug ${en.id} not slower`);
      if (ee && ee.cls === 'critter' && !(ee.ve < en.ve)) bad.push(`${n}: Easy critter ${en.id} not slower`);
    }
  }
  check('the modes scale the same course: speed, dust, the same plants and key, Easy half the enemies and slower, Hard more and its bugs faster', bad.length === 0, bad.slice(0, 6));
}

// ---------------------------------------------------------------- 4. the sweep: a perfect way through every course
{
  const fails = [], slots = [];
  for (const m of MODES) for (let n = 1; n <= N; n++) {
    const r = sweep(L, course(n, m), { speed: 0.6 });
    slots.push(r.slots);
    if (!r.ok) fails.push(`${m}${n}${r.failedAt ? ' @' + r.failedAt.toFixed(1) + 's' : ''}${r.reason ? ' ' + r.reason : ''}`);
  }
  check('every one of the 60 courses has a way, at 60% of her vertical speed, that blooms every plant and takes the key without touching an enemy', fails.length === 0, fails.slice(0, 8));
  check('only a few buds are ever in reach at once (the sweep stays small)', Math.max.apply(null, slots) <= 3, `most ${Math.max.apply(null, slots)}`);
  // it bites: at no vertical speed no course can be done; and a plant out of reach fails it
  let ok0 = 0;
  for (const m of MODES) for (let n = 1; n <= N; n++) if (sweep(L, course(n, m), { speed: 0 }).ok) ok0++;
  check('the sweep bites: with no vertical movement at all not one of the 60 courses can be done', ok0 === 0, `${ok0} passed`);
  const c0 = course(7, 'hard'), hacked = Object.assign({}, c0, { plants: c0.plants.map((p, i) => (i === 4 ? Object.assign({}, p, { hy: p.hy - 400 }) : p)) });
  check('the sweep bites: a plant placed out of reach fails a course that otherwise passes', sweep(L, c0, { speed: 0.6 }).ok && !sweep(L, hacked, { speed: 0.6 }).ok);
  const hacked2 = Object.assign({}, c0, { enemies: c0.enemies.concat([{ id: 77, cls: 'bug', kind: 0, pat: 'straight', x: c0.plants[3].x, y: 250, r: 400, ve: 0, amp: 0, om: 0, ph: 0, ax: 0, tm: c0.plants[3].x / c0.v }]) });
  check('the sweep bites: a wall of enemies across the sky fails it', !sweep(L, hacked2, { speed: 0.6 }).ok);
  // room to spare: at a third of her speed the easiest modes still have a way
  let tight = [];
  for (const m of ['easy', 'medium']) for (let n = 1; n <= N; n++) if (!sweep(L, course(n, m), { speed: 0.35 }).ok) tight.push(m + n);
  check('Easy and Medium have room to spare: a way exists even at 35% of her vertical speed', tight.length === 0, tight);
}

// ---------------------------------------------------------------- 5. model players, through the real Run.step
const results = {};
{
  const notDone = [], easyBonks = [], easyStars = [], lowStars = [], bonksBy = { easy: 0, medium: 0, hard: 0 };
  for (const m of MODES) for (let n = 1; n <= N; n++) {
    const run = new L.Run(n, m), r = M.playRun(L, run, M.child(L));
    results[m + n] = r;
    if (!r.done) notDone.push(m + n);
    bonksBy[m] += r.bonks;
    if (m === 'easy' && r.bonks > 0) easyBonks.push(`${m}${n}: ${r.bonks}`);
    if (m === 'easy' && r.stars !== 3) easyStars.push(`${n}: ${r.bloomed}/${r.total}`);
    if (r.stars < 2) lowStars.push(`${m}${n}: ${r.bloomed}/${r.total}`);
  }
  check('a model child who sees only 1.5 s ahead and reacts late finishes all 60 courses (the chest opens)', notDone.length === 0, notDone);
  check('in Easy that child never bonks, on any of the 20 courses', easyBonks.length === 0, easyBonks);
  check('in Easy that child brings every plant to life: 3 stars on all 20', easyStars.length === 0, easyStars);
  check('on Medium and Hard it still gets at least 2 stars everywhere', lowStars.length === 0, lowStars);
  check('bonks grow with the mode for that child (Easy < Medium < Hard in total)', bonksBy.easy < bonksBy.medium && bonksBy.medium < bonksBy.hard, bonksBy);
  // a very young child: no finger at all, or one resting at a single height. Nothing can be failed.
  const young = [];
  for (const m of MODES) for (let n = 1; n <= N; n++) for (const pl of [M.idle(), M.still(L.Y_MAX), M.still(L.Y_MIN)]) {
    const r = M.playRun(L, new L.Run(n, m), pl);
    if (!r.done || r.stars < 1 || r.coins < L.CHEST_COINS) young.push(`${pl.name} ${m}${n}`);
  }
  check('a very young child (no finger, or one finger left at the top or the bottom) reaches the chest on all 60 courses and gets a star', young.length === 0, young.slice(0, 5));
  // Easy is gentle for the idle child too: nothing is ever lost
  let lost = 0;
  for (let n = 1; n <= N; n++) { const r = M.playRun(L, new L.Run(n, 'easy'), M.still(L.Y_MAX)); lost += r.coinsLost; }
  check('on Easy no coin is ever lost, even to a child who flies into everything', lost === 0, lost);
}

// ---------------------------------------------------------------- 6. difficulty by a fixed cost function
// cost = (enemies per second) x (their speed relative to her view, /100) / (mean gap between enemies in seconds) x 10
//      + (plants per second) x (scroll speed /100) x (Medium's dust radius / this mode's) x 3
function cost(c) {
  const Tm = c.tStop, n = c.enemies.length, tms = c.enemies.map((e) => e.tm).sort((a, b) => a - b);
  let gapMean = Tm, rel = c.v / 100;
  if (n) {
    gapMean = tms.map((t, i) => Math.max(0.5, t - (i ? tms[i - 1] : 0))).reduce((a, b) => a + b, 0) / n;
    rel = c.enemies.reduce((a, e) => a + (c.v + e.ve) / 100, 0) / n;
  }
  const enemyTerm = n ? ((n / Tm) * rel) / gapMean * 10 : 0;
  const plantTerm = (c.plants.length / Tm) * (c.v / 100) * (L.MODE.medium.dust / c.dust) * 3;
  return enemyTerm + plantTerm;
}
const COST = {};
for (const m of MODES) { COST[m] = []; for (let n = 1; n <= N; n++) COST[m].push(cost(course(n, m))); }
for (const m of MODES) {
  const up1 = COST[m].slice(0, 10).every((v, i, a) => i === 0 || v > a[i - 1]), up2 = COST[m].slice(10).every((v, i, a) => i === 0 || v > a[i - 1]);
  check(`${m}: difficulty rises level by level, 1 to 10 and 11 to 20, and level 11 is above level 10`, up1 && up2 && COST[m][10] > COST[m][9],
    COST[m].map((v) => v.toFixed(2)).join(' '));
}
check('Easy < Medium < Hard on every level', COST.easy.every((v, i) => v < COST.medium[i] && COST.medium[i] < COST.hard[i]));
check('Hard of every level is harder than Medium of the same level by a clear margin (x1.5)', COST.hard.every((v, i) => v > COST.medium[i] * 1.5));
check('Easy 20 is gentler than Medium 10 (a 3-year-old can reach the end of the second world)', COST.easy[19] < COST.medium[9]);

// ---------------------------------------------------------------- 7. the rules
const flat = { x: L.PX_NOM, y: 0 };
function bloomAt(mode, dist) {
  const run = new L.Run(1, mode), p = run.c.plants[0];
  run.t = p.tm;
  const q = L.plantAt(run.c, p, run.t);
  run.x = L.PX_NOM; run.y = q.y + dist <= L.Y_MAX ? q.y + dist : q.y - dist;
  const out = [];
  run.step(1e-4, { x: L.PX_NOM, y: run.y }, out);
  return { out, run };
}
for (const m of MODES) {
  const R = L.MODE[m].dust;
  check(`${m}: a bud blooms within ${R} units of her and not beyond`, bloomAt(m, R - 2).out.some((e) => e.type === 'bloom') && !bloomAt(m, R + 2).out.some((e) => e.type === 'bloom'));
}
{
  const { run } = bloomAt('medium', 20);
  check('a bloom pays exactly one coin and is counted once', run.coins === 1 && run.bloomed === 1);
  const out = [];
  for (let i = 0; i < 30; i++) run.step(1 / 60, { x: L.PX_NOM, y: run.y }, out);
  check('staying beside a bloomed plant pays nothing more', run.coins === 1 && out.filter((e) => e.type === 'bloom').length === 0);
  check('a bloom takes about half a second', L.BLOOM_T >= 0.4 && L.BLOOM_T <= 0.6, L.BLOOM_T);
}
function ghostRun(mode, level, coins, kindOf) {
  const run = new L.Run(level || 3, mode);
  run.coins = coins == null ? 2 : coins;
  const g = Object.assign({ id: 999, cls: 'bug', kind: 0, pat: 'straight', x: 0, y: 0, r: L.BUG_R, ve: -run.c.v, amp: 0, om: 0, ph: 0, ax: 0, tm: 0 }, kindOf || {});
  run.t = 3; run.x = L.PX_NOM; run.y = 250; run.vy = 0;
  g.x = (run.x - L.PX_NOM) + L.scrollAt(run.c, run.t) + 0; g.y = g.cls === 'critter' ? L.CRITTER_Y : 250; g.tm = run.t;
  run.c = Object.assign({}, run.c, { enemies: [g] });
  return { run, g };
}
{
  const out = [];
  let { run } = ghostRun('medium', 3, 2); run.step(0.02, { x: 270, y: 250 }, out);
  check('Medium: touching an enemy is a bonk with a 1.5 s shield that costs one coin', out.some((e) => e.type === 'bonk' && e.coinLost) && run.coins === 1 && run.bonks === 1 && near(run.shield, L.SHIELD, 0.05) && L.SHIELD === 1.5, { coins: run.coins, shield: run.shield });
  ({ run } = ghostRun('medium', 3, 0)); run.step(0.02, { x: 270, y: 250 }, []);
  check('a bonk never takes a coin below 0', run.coins === 0 && run.bonks === 1 && run.coinsLost === 0);
  ({ run } = ghostRun('hard', 3, 1)); run.step(0.02, { x: 270, y: 250 }, []);
  check('Hard: a bonk costs a coin too', run.coins === 0 && run.coinsLost === 1);
  ({ run } = ghostRun('easy', 3, 5)); run.step(0.02, { x: 270, y: 250 }, []);
  check('Easy: a bonk costs nothing', run.coins === 5 && run.bonks === 1 && run.coinsLost === 0);
  // the shield: a stationary enemy on her bonks once, not again until 1.5 s are over
  ({ run } = ghostRun('medium', 3, 9));
  const hold = (s) => { for (let i = 0; i < s * 20; i++) { run.x = 270; run.y = 250; run.kick = 0; run.step(0.05, { x: 270, y: 250 }, []); } };
  hold(1.3);
  check('while the shield lasts nothing more can bonk her', run.bonks === 1 && run.coins === 8, run.bonks);
  hold(0.5);
  check('when the shield ends an enemy still on her can bonk again', run.bonks === 2 && run.coins === 7, run.bonks);
  // critters and bugs on the real courses really bonk
  const c3 = L.buildCourse(3, 'medium'), cr = c3.enemies[0];
  const touch = (c, e, dy) => { const r = new L.Run(c.level, c.mode); r.t = e.tm; const q = L.enemyAt(c, e, r.t); r.x = 270; r.y = q.y + dy; r.step(1e-4, { x: 270, y: r.y }, []); return r.bonks; };
  check('a ground critter bonks her when she flies into it (and not when she passes above it)', touch(c3, cr, -40) === 1 && touch(c3, cr, -62) === 0, [touch(c3, cr, -40), touch(c3, cr, -62)]);
  const c5 = L.buildCourse(5, 'medium'), bg = c5.enemies.find((e) => e.cls === 'bug');
  check('a sky bug bonks her when she flies into it (and not at a distance)', touch(c5, bg, 36) === 1 && touch(c5, bg, 56) === 0, [touch(c5, bg, 36), touch(c5, bg, 56)]);
}
{
  const bug = L.buildCourse(9, 'medium').enemies.filter((e) => e.cls === 'bug');
  const pats = {};
  for (const lv of [5, 7, 9, 13, 20]) for (const e of L.buildCourse(lv, 'medium').enemies) if (e.cls === 'bug') pats[e.pat] = 1;
  check('bugs fly straight, in a sine wave, in a slow circle and (later) weave', ['straight', 'sine', 'circle', 'weave'].every((k) => pats[k]), Object.keys(pats));
  // the patterns are pure functions of the time: a circle returns after one turn, a sine wave after one period
  const c = L.buildCourse(9, 'medium'), circ = c.enemies.find((e) => e.pat === 'circle'), sine = c.enemies.find((e) => e.pat === 'sine');
  if (circ) { const per = TAU2() / circ.om, a = L.enemyAt(c, circ, circ.tm + 1), b = L.enemyAt(c, circ, circ.tm + 1 + per); check('a circling bug comes round to the same place after one turn (relative to the scroll)', near(a.x + L.scrollAt(c, circ.tm + 1), b.x + L.scrollAt(c, circ.tm + 1 + per), 1e-6) && near(a.y, b.y, 1e-6)); }
  else check('a circling bug exists on level 9', false);
  if (sine) { const per = TAU2() / sine.om, a = L.enemyAt(c, sine, sine.tm + 1), b = L.enemyAt(c, sine, sine.tm + 1 + per); check('a sine bug repeats its height after one period', near(a.y, b.y, 1e-6)); }
  else check('a sine bug exists on level 9', false);
  void bug;
}
function TAU2() { return Math.PI * 2; }
{
  check('stars: every plant 3, two thirds or more 2, otherwise 1 (never for speed)',
    [[6, 6, 3], [6, 4, 2], [6, 3, 1], [15, 15, 3], [15, 10, 2], [15, 9, 1], [24, 24, 3], [24, 16, 2], [24, 15, 1], [7, 5, 2], [7, 4, 1], [7, 0, 1], [15, 14, 2], [24, 23, 2], [10, 9, 2], [20, 19, 2]].every(([tot, got, st]) => L.starsFor(got, tot) === st));
  // key and chest: with the key in hand the chest opens 1.3 s after the scroll stops; without it the key floats over after 0.9 s and the chest opens at 2.5 s
  function ending(withKey, bloomedN) {
    const run = new L.Run(1, 'medium'), c = run.c, out = [];
    run.t = c.tStop - 0.5; run.bloomed = bloomedN == null ? run.total : bloomedN; run.coins = run.bloomed;
    if (withKey) { run.keyGot = true; run.keyAt = 5; }
    run.noEnemies = true;
    let n = 0;
    while (!run.done && n++ < 2000) run.step(1 / 60, null, out);
    return { run, out, c };
  }
  let e = ending(true);
  check('with the key the chest opens 1.3 s after the scroll stops, and pays 10 coins', e.run.done && near(e.run.openAt - e.c.tStop, 1.3, 0.05) && e.run.coins === e.run.total + 10 && e.out.filter((x) => x.type === 'chest').length === 1 && !e.out.some((x) => x.type === 'keyFloat'), { at: e.run.openAt - e.c.tStop, coins: e.run.coins });
  e = ending(false);
  check('without the key she lands beside the chest, the key floats over after 0.9 s anyway, and the chest opens', e.run.done && e.run.keyGot && e.run.keyFloat && near(e.out.length ? e.run.openAt - e.c.tStop : 0, 2.5, 0.05) && e.out.some((x) => x.type === 'keyFloat') && e.run.coins === e.run.total + 10, { at: e.run.openAt - e.c.tStop });
  check('she lands beside the chest', e.run.landed && near(e.run.x, L.LAND_X, 8) && near(e.run.y, L.LAND_Y, 8), { x: e.run.x, y: e.run.y });
  check('the chest pays the same whatever she did (10 coins), and 3 stars come from every plant, 2 from two thirds, 1 for finishing',
    ending(false, 6).run.stars === 3 && ending(false, 4).run.stars === 2 && ending(false, 3).run.stars === 1 && ending(true, 0).run.stars === 1 && ending(true, 0).run.coins >= 10 && ending(false, 0).run.coins === 10);
  // the key itself, picked up by flying through it
  const run = new L.Run(1, 'medium'), c = run.c;
  run.t = c.key.x / c.v; run.x = L.PX_NOM; run.y = c.key.y + L.KEY_R - 3;
  const out = [];
  run.step(1e-4, { x: L.PX_NOM, y: run.y }, out);
  const near2 = run.keyGot;
  const run2 = new L.Run(1, 'medium'); run2.t = c.key.x / c.v; run2.x = L.PX_NOM; run2.y = c.key.y + L.KEY_R + 12 > L.Y_MAX ? c.key.y - L.KEY_R - 12 : c.key.y + L.KEY_R + 12;
  run2.step(1e-4, { x: L.PX_NOM, y: run2.y }, []);
  check('the golden key is collected by flying through it (and not from further away)', near2 && !run2.keyGot);
}
{
  // the easing: she follows the finger's height, never faster than her top speed, stays in the sky, and drifts to the middle alone
  const run = new L.Run(1, 'medium');
  let maxV = 0, y0 = run.y;
  for (let i = 0; i < 90; i++) { run.step(1 / 60, { x: 270, y: 9999 }, []); maxV = Math.max(maxV, Math.abs(run.y - y0) * 60); y0 = run.y; }
  check('she flies toward the finger, never faster than her top speed, and stops at the bottom of the sky', maxV <= L.VY_MAX * 1.001 && near(run.y, L.Y_MAX, 1.5) && maxV > L.VY_MAX * 0.5, { maxV: Math.round(maxV), y: run.y });
  for (let i = 0; i < 120; i++) run.step(1 / 60, { x: 270, y: -9999 }, []);
  check('and stops at the top of the sky', near(run.y, L.Y_MIN, 1.5), run.y);
  const r2 = new L.Run(1, 'medium'); r2.y = 420;
  let mono = true, prev = r2.y, vmax = 0;
  for (let i = 0; i < 60 * 12; i++) { r2.step(1 / 60, null, []); if (r2.y > prev + 1e-9) mono = false; vmax = Math.max(vmax, (prev - r2.y) * 60); prev = r2.y; }
  check('with no finger she drifts gently toward the middle height (slowly, and stays there)', mono && near(r2.y, L.Y_REST, 3) && vmax <= L.REST_VMAX * 1.001, { y: Math.round(r2.y), vmax: Math.round(vmax) });
  const r3 = new L.Run(1, 'medium');
  for (let i = 0; i < 180; i++) r3.step(1 / 60, { x: 5000, y: 250 }, []);
  const hi = r3.x;
  for (let i = 0; i < 180; i++) r3.step(1 / 60, { x: -5000, y: 250 }, []);
  check('the finger moves her a little sideways, within a band of the left third of the screen', near(hi, L.PX_HI, 1) && near(r3.x, L.PX_LO, 1) && L.PX_HI < 400, { hi, lo: r3.x });
  const r4 = new L.Run(5, 'hard');
  for (let i = 0; i < 600; i++) r4.step(1 / 60, null, []);
  check('the forest scrolls at the level\'s speed: Hard is 1.25 times Medium, Easy 0.8', near(r4.scroll, L.buildCourse(5, 'hard').v * 10, 1e-6) && near(L.buildCourse(5, 'hard').v / L.buildCourse(5, 'medium').v, 1.25, 1e-9) && near(L.buildCourse(5, 'easy').v / L.buildCourse(5, 'medium').v, 0.8, 1e-9));
  const c = L.buildCourse(8, 'medium');
  check('the scroll eases to a stop with the chest at the right place (x = 600)', near(L.chestAt(c, c.tStop), L.CHEST_SX, 1e-6) && near(L.chestAt(c, c.tStop + 5), L.CHEST_SX, 1e-6) && L.scrollAt(c, c.tb + L.DECEL / 2) < c.v * (c.tb + L.DECEL / 2));
}
{
  // the save
  const fresh = L.freshSave();
  check('a fresh save is { v:1, mode, unlocked per mode, stars per mode, coins ... } with 20 stars a mode',
    fresh.v === 1 && fresh.mode === 'medium' && MODES.every((m) => fresh.unlocked[m] === 1 && fresh.stars[m].length === 20 && fresh.stars[m].every((x) => x === 0)) && fresh.coins === 0);
  const m1 = L.migrate(JSON.stringify({ v: 1, mode: 'hard', unlocked: { easy: 4, medium: 99, hard: -3 }, stars: { easy: [3, 2, 1, 0], medium: [0, 0, 2, 3, 0, 0], hard: [] }, coins: 77, plants: 12, chests: 3, bonks: 1 }));
  check('a saved game is read back: the mode, the unlocked levels (at least one past the last starred level, at most 20), the stars (0-3) and the coins',
    m1.mode === 'hard' && m1.unlocked.easy === 4 && m1.unlocked.medium === 20 && m1.unlocked.hard === 1 && m1.stars.easy.slice(0, 4).join() === '3,2,1,0' && m1.unlocked.medium === 20 && m1.coins === 77 && m1.plants === 12 && m1.chests === 3 && m1.bonks === 1, m1.unlocked);
  const m2 = L.migrate({ mode: 'sideways', unlocked: 'x', stars: { easy: [9, -4, 'q'] }, coins: -5 });
  check('rubbish in the save is made safe', m2.mode === 'medium' && m2.coins === 0 && m2.stars.easy.slice(0, 3).join() === '3,0,0' && m2.stars.easy.every((x) => x >= 0 && x <= 3) && m2.unlocked.easy === 2, m2.stars.easy.slice(0, 4));
  check('a save that is not JSON, or not an object, gives a fresh one', JSON.stringify(L.migrate('{nope')) === JSON.stringify(fresh) && JSON.stringify(L.migrate(null)) === JSON.stringify(fresh) && JSON.stringify(L.migrate('[1,2]')) === JSON.stringify(fresh));
  const m3 = L.migrate({ stars: { medium: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] } });
  check('World 2 opens when level 10 of that mode is finished, in that mode only', m3.unlocked.medium === 11 && m3.unlocked.easy === 1 && m3.unlocked.hard === 1);
  check('the modes keep separate stars and unlocks', (() => { const s = L.migrate({ stars: { easy: [1], hard: [3, 3] } }); return s.unlocked.easy === 2 && s.unlocked.hard === 3 && s.unlocked.medium === 1; })());
}

// ---------------------------------------------------------------- the table of results, for reading
console.log('\nlevel  theme  secs  speed(E/M/H)    plants  enemies(E/M/H)  cost(E/M/H)             child bonks(E/M/H)');
for (let n = 1; n <= N; n++) {
  const cE = course(n, 'easy'), cM = course(n, 'medium'), cH = course(n, 'hard'), cfg = T[n - 1];
  console.log(`${String(n).padStart(3)}    ${cfg.theme}      ${String(cfg.secs).padStart(2)}    ${[cE.v, cM.v, cH.v].map((v) => String(Math.round(v)).padStart(3)).join('/')}         ${String(cfg.plants).padStart(2)}      ${[cE, cM, cH].map((c) => String(c.enemies.length).padStart(2)).join('/')}           ${MODES.map((m) => COST[m][n - 1].toFixed(2).padStart(5)).join('/')}           ${MODES.map((m) => results[m + n] ? results[m + n].bonks : '-').join('/')}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
