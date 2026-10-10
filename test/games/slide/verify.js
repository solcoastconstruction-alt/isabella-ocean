// Rainbow Slide: proves all twenty courses in all three modes, the rules and the tilt maths. No browser.
//   node test/games/slide/verify.js             (everything; about a minute)
//   node test/games/slide/verify.js --fp        (only print the table's and the courses' fingerprints)
//   SLIDE_DIR=<a copy of web/games/slide> node test/games/slide/verify.js     (verify a copy: defects.js uses this)
//
// For each of the 20 courses in each of the 3 modes (60 in all):
//   - frozen: built from its seed it is exactly the course whose hash is below (and the same built twice); the level
//     table (what each course is meant to be, and the three modes' scalings) is frozen too;
//   - laid out fairly: clear sky at the start and before the finish, everything on the ribbon, every coin where she can
//     slide, the key on the lane in the second half, no cloud near a loop-the-loop or a rainbow arch, loops where the
//     table says, the new thing the first thing met;
//   - a clean line exists: a sweep over (distance, position across the ribbon) at the course's speed finds a way from the
//     start to the finish line that touches no cloud with 8 units to spare, never needs more than 60% of her sideways
//     speed, and keeps off the rim. Where clouds drift, the sweep is repeated with the clock started at 17 different
//     moments and at 70% speed, and again from every rainbow arch she might be floated back to;
//   - every coin and the key are on such a line, so 3 stars are always reachable;
//   - a model child (pilot.js: sees only 2 s ahead, reacts 0.3 s late, turns the steering at a limited rate) slides it
//     through the real Run.step() without a poof, takes 3 stars, never touches the rail on Easy and never meets the
//     rim in any mode; a slower child (reacts 0.45 s late, sees 1.5 s ahead) does the same;
//   - the difficulty score (one fixed cost function) rises from each course to the next in each mode, level 11 sits above
//     level 10, and in every course Easy < Medium < Hard;
//   - nothing can fail: sliding straight ahead with eyes shut reaches the chest in every mode, so does random steering on
//     Easy and Medium (Hard may slip off the rim, and is floated back).
// Then the rules (the rim, rails, a slip and the checkpoint, a poof, loops, the key and the chest, stars, the modes) and
// the tilt maths (both landscape ways round, the dead zone, the filter, "only real, changing data"), checked against a
// separate model of the phone.
'use strict';
const crypto = require('crypto');
const path = require('path');
const t00 = Date.now();
const DIR = path.resolve(process.env.SLIDE_DIR || path.join(__dirname, '../../../web/games/slide'));
const L = require(path.join(DIR, 'logic.js'));
const { makePilot } = require('./pilot.js');
const P = makePilot(L), P2 = makePilot(L, { react: 0.45, look: 1.5, rate: 4.5 });
const M = require('./measure.js').make(L, P, P2);

// Frozen 10 Oct 2026. Changing a course changes stars a child may already have earned on it: don't.
const FROZEN_TABLE = 'dd7ef08b9af4';
const FROZEN = {
  easy: [
    '9e81ed9b224b', 'cdfb216d01b2', '9ff0ca9508eb', '45f10b8827b6', '7dccc950cff1',
    '6343e27ff228', 'a517ecd193c6', 'f8f8cdeb26b4', 'c0085d1ceab4', 'bce7c5547a14',
    '0251599be3cb', 'b9827d72bda4', '453fecbcf974', '92ea1de95461', 'b73893826112',
    '2611aaac0c8e', '0ef9851ae8b7', '6a49782e1b49', 'b55d2fb46f30', '7e2d10f0fdfd',
  ],
  medium: [
    '6e1f25fea410', 'e0df0289db12', '07bdad333ad4', '4cb13dc138bf', 'd39113dae473',
    '4411c6a17673', '1f2bac573434', '5aaef15587f0', '9ae2e33d35fa', 'f5036e45eb70',
    '9f0f1306c1ba', 'f27a30ca999e', '28c470fd46c3', '24893ce8d944', '16e3ff4eac62',
    'c34aaf1c9ceb', '33be9826d1d7', '50aa8dbdb8af', '19a21a808371', 'ab6f62991a37',
  ],
  hard: [
    'e2f071e1a37d', '3c093ea80055', '79527f623013', 'cc09f93c605d', '08d87ad4948c',
    '393edb2a1479', 'c96d2ad1c777', '44d03176ddea', '4b9f999e7a3a', 'f02fbbd49ad0',
    'f9d2191581c6', '6123fa2ad274', 'ad551ce579b7', '38c53379364c', 'e61d40ea60ff',
    'df72e7ade76d', '6cab1197c768', '5774e173811b', '751cdb60186f', '5c332bcdd3db',
  ],
};
// The stated ranges, in seconds from the start to the finish line at Medium speed (World 1, World 2).
const TIMES = { 1: [50, 75], 2: [70, 95] };

const fingerprint = (lv) => crypto.createHash('sha1').update(L.describe(lv)).digest('hex').slice(0, 12);
const tableHash = () => crypto.createHash('sha1').update(L.describeTable()).digest('hex').slice(0, 12);
if (process.argv.includes('--fp')) {
  console.log(`const FROZEN_TABLE = '${tableHash()}';`);
  console.log('const FROZEN = {');
  for (const mode of L.MODE_IDS) {
    const fp = [];
    for (let n = 1; n <= L.NLEV; n++) fp.push(fingerprint(L.build(n, mode)));
    console.log(`  ${mode}: [`);
    for (let i = 0; i < fp.length; i += 5) console.log('    ' + fp.slice(i, i + 5).map((f) => `'${f}'`).join(', ') + ',');
    console.log('  ],');
  }
  console.log('};');
  process.exit(0);
}

let fails = 0, checks = 0;
const problems = [];
function check(ok, what, detail) {
  checks++;
  if (!ok) { fails++; problems.push(what + (detail != null ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
  return ok;
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
const DT = 1 / 60;

// ================= the level table =================
check(tableHash() === FROZEN_TABLE, 'the level table is the frozen table (what each course is meant to be, the modes, the seeds)', `${tableHash()} != ${FROZEN_TABLE}`);
check(L.NLEV === 20 && L.COURSES.length === 20 && L.MODE_IDS.join() === 'easy,medium,hard', 'twenty courses and three modes');
{
  const C = L.COURSES;
  check(C.slice(0, 10).every((c) => c.world === 1 && c.theme <= 3) && C.slice(10).every((c) => c.world === 2 && c.theme >= 4 && c.theme <= 7), 'World 1 (courses 1–10) uses backdrops 0–3, World 2 (11–20) uses 4–7');
  check(new Set(C.slice(0, 10).map((c) => c.theme)).size === 4 && new Set(C.slice(10).map((c) => c.theme)).size === 4, 'every backdrop is used', C.map((c) => c.theme));
  check(C.every((c, i) => i === 0 || c.theme >= C[i - 1].theme), 'the backdrops come in order');
  check(C.slice(0, 10).every((c) => c.secs >= 50 && c.secs <= 75 && Math.abs(c.len / c.speed - c.secs) < 0.8) && C.slice(10).every((c) => c.secs >= 70 && c.secs <= 95 && Math.abs(c.len / c.speed - c.secs) < 0.8), 'World 1 takes 50–75 s at Medium speed, World 2 70–95 s');
  check(C.every((c, i) => i === 0 || i === 10 || c.secs > C[i - 1].secs), 'within each world the courses get longer');
  check(C.every((c, i) => i === 0 || c.speed >= C[i - 1].speed), 'and the slide gets no slower');
  check(C.slice(0, 5).every((c) => c.loops === 0) && C[5].loops === 1 && C.slice(0, 5).concat(C.slice(5)).every((c, i) => (i < 16 ? c.loops <= 1 : c.loops === 2)), 'the first loop is on course 6, two loops from course 17 on', C.map((c) => c.loops));
  check(C.slice(10).every((c, i) => i < 4 || c.half < 270) && C[14].half < C[13].half - 10 && C.slice(0, 14).every((c) => c.half >= 262), 'the ribbon narrows from course 15');
  check(C.slice(0, 12).every((c) => !c.kinds.includes('drift')) && C[12].kinds.includes('drift') && C[12].feature === 'drift', 'grumpy clouds that drift arrive on course 13');
  check(C.slice(0, 8).every((c) => !c.kinds.includes('slalom') || c.n >= 4) && C[3].feature === 'slalom' && C[4].feature === 'bend', 'slaloms and bends arrive on courses 4 and 5');
  check(C[10].gap[1] < C[9].gap[1] + 1 && C[10].clear < C[9].clear && C[10].two > C[9].two, 'World 2 starts a step tighter than World 1 ends (smaller gaps, less room, more pairs)', { g10: C[9].gap, g11: C[10].gap });
  check(C.every((c, i) => i === 0 || i === 10 || (c.clear <= C[i - 1].clear && c.two >= C[i - 1].two && c.wander >= C[i - 1].wander)), 'within each world the room shrinks and the lane wanders more');
  const Mo = L.MODES;
  check(near(Mo.easy.speed, 0.8) && near(Mo.medium.speed, 1) && near(Mo.hard.speed, 1.25), 'speeds: Easy ×0.8, Medium as designed, Hard ×1.25');
  check(Mo.easy.width > 1 && Mo.medium.width === 1 && Mo.hard.width < 1, 'the ribbon is wider on Easy, narrower on Hard');
  check(Mo.easy.clouds < 1 && Mo.hard.clouds > 1 && Mo.easy.spill === false && Mo.medium.spill === true && Mo.hard.spill === true, 'fewer clouds on Easy, more on Hard, no spilled coin on Easy');
  check(Mo.easy.edge === 'rail' && Mo.medium.edge === 'rim' && Mo.hard.edge === 'slip', 'the rim: rails on Easy, a bump back on Medium, a slip on Hard');
}

// ================= the courses =================
console.log('mode   crs   len  secs  hw  cloudsE  coins(+loop) arch loops key% | open% tight% narrow | child laggy random | stars rails/rims/slips | work score');
let easyDrift = 0;
const scores = { easy: [], medium: [], hard: [] }, table = [], cloudCount = { easy: 0, medium: 0, hard: 0 };
for (const mode of L.MODE_IDS) {
  for (let n = 1; n <= L.NLEV; n++) {
    const C = L.COURSES[n - 1], lev = L.build(n, mode), again = L.build(n, mode), tag = `${mode} course ${n}`;
    const fp = fingerprint(lev);
    check(fp === FROZEN[mode][n - 1], `${tag} is the frozen course`, `${fp} != ${FROZEN[mode][n - 1]}`);
    check(L.describe(lev) === L.describe(again), `${tag} builds the same twice`);
    // laid out fairly
    const firstObs = lev.obs.length ? lev.obs[0].s : Infinity;
    check(firstObs >= 1400, `${tag}: clear sky for the first 1400 units`, firstObs);
    check(lev.obs.every((o) => o.s <= lev.len - 500) && lev.arches.every((a) => a <= lev.len - 1800), `${tag}: clear sky before the finish line`);
    check(lev.obs.every((o) => Math.abs(o.x) + (o.amp || 0) <= lev.hw + 100), `${tag}: every cloud floats over the ribbon`);
    check(lev.coins.every((c) => Math.abs(c.x) <= lev.hw - L.EDGE && c.s > 300 && c.s < lev.len), `${tag}: every coin is where she can slide`);
    check(lev.laneTotal >= 50, `${tag}: at least 50 coins`, lev.laneTotal);
    check(lev.total - lev.laneTotal === 8 * C.loops && lev.loops.length === C.loops, `${tag}: ${C.loops} loop(s), eight extra coins in each`, { loops: lev.loops.length, extra: lev.total - lev.laneTotal });
    check(lev.loops.every((lp) => lp.a > 2500 && lp.b < lev.len - 2500 && lp.b - lp.a === L.LOOP_LEN), `${tag}: loops sit well inside the course`);
    check(lev.loops.every((lp) => !lev.obs.some((o) => o.s + o.r > lp.a - L.LOOP_MARGIN + 60 && o.s - o.r < lp.b + L.LOOP_MARGIN - 60)), `${tag}: no cloud in or near a loop-the-loop`);
    check(lev.loops.every((lp) => lev.coins.filter((c) => c.b && c.s >= lp.a && c.s < lp.b).length === 8), `${tag}: the loops' coins are inside them`);
    check(lev.key.s > lev.len * 0.5 && lev.key.s < lev.len * 0.85 && lev.key.x === Math.round(L.laneAt(lev, lev.key.s)), `${tag}: the key hangs on the lane in the second half`, lev.key);
    check(lev.obs.every((o) => Math.abs(o.s - lev.key.s) > 400), `${tag}: no cloud near the key`);
    const spacing = L.ARCH_SECS * C.speed;
    check(lev.arches.length >= 2 && lev.arches.every((a, i) => a - (i ? lev.arches[i - 1] : 0) > spacing * 0.7 && a - (i ? lev.arches[i - 1] : 0) < spacing * 1.7 + L.LOOP_LEN + 1500), `${tag}: a rainbow arch about every ${L.ARCH_SECS} s of Medium speed`, lev.arches);
    check(lev.arches.every((a) => !lev.obs.some((o) => Math.abs(o.s - a) < 330 + o.r) && !lev.loops.some((lp) => a > lp.a - L.LOOP_MARGIN && a < lp.b + L.LOOP_MARGIN)), `${tag}: nothing near an arch (so she is floated back to clear sky)`);
    const allowed = new Set(['coins', 'trail']);
    for (let k = 1; k <= n; k++) if (L.PATTERN_NEW[k]) allowed.add(L.PATTERN_NEW[k]);
    check(Object.keys(lev.patterns).every((k) => allowed.has(k)), `${tag}: nothing appears before its course`, Object.keys(lev.patterns));
    if (L.PATTERN_NEW[n]) check((lev.patterns[C.feature] || 0) >= 1, `${tag}: its new thing (${C.feature}) appears`, lev.patterns);
    if (n < 13) check(!lev.obs.some((o) => o.amp), `${tag}: nothing drifts before course 13`);
    else if (n === 13 || mode !== 'easy') check(lev.obs.some((o) => o.amp && o.g), `${tag}: grumpy clouds drift across the ribbon`);   // (Easy has fewer groups of clouds, so a later course may have none)
    if (n >= 13 && mode === 'easy') easyDrift += lev.obs.some((o) => o.amp) ? 1 : 0;
    check(n >= 9 || !lev.obs.some((o) => o.g), `${tag}: no grumpy faces before course 9`);
    check(near(lev.speed, C.speed * L.MODES[mode].speed) && lev.hw === Math.round(C.half * L.MODES[mode].width) && lev.len === C.len, `${tag}: the mode scales speed and width, and the course is as long`);
    cloudCount[mode] += Object.values(lev.patterns).reduce((a, b) => a + b, 0);
    // the shape of the ribbon (and the loops, arches and key) are the same in every mode
    if (mode !== 'medium') { const med = L.build(n, 'medium'); check(JSON.stringify([lev.curve, lev.loops, lev.arches, lev.key.s]) === JSON.stringify([med.curve, med.loops, med.arches, med.key.s]), `${tag}: winds, loops, arches and key are the Medium course's`); }
    // the ribbon's windings: gentle in World 1, tighter bends in World 2
    let maxSlope = 0;
    for (let s = 0; s < lev.len; s += 20) maxSlope = Math.max(maxSlope, Math.abs(L.centreAt(lev, s + 20) - L.centreAt(lev, s)) / 20);
    check(maxSlope < (n <= 10 ? 0.6 : 1.1) && maxSlope > (n <= 10 ? 0.1 : 0.3), `${tag}: the ribbon winds ${maxSlope.toFixed(2)} (gentle in World 1, steeper in World 2)`);

    const m = M.measure(n, mode);
    for (const p of m.problems) check(false, `${tag}: ${p}`);
    check(m.problems.length === 0, `${tag}: a clean line at the course's speed, every coin and the key on one, and from every arch`);
    const r = m.runs;
    check(r.child.done && r.child.bumps === 0 && r.child.stars === 3 && r.child.hasKey, `${tag}: the model child slides it without a poof, takes the key and 3 stars (${r.child.laneCoins}/${lev.laneTotal})`, { poofs: r.child.poofs.slice(0, 3), stars: r.child.stars });
    check(r.laggy.done && r.laggy.bumps === 0 && r.laggy.stars === 3, `${tag}: so does a slower child (poofs ${r.laggy.bumps}, stars ${r.laggy.stars})`, r.laggy.poofs.slice(0, 3));
    check(r.child.rails === 0 && r.child.rims === 0 && r.child.slips === 0 && r.laggy.rails === 0 && r.laggy.rims === 0 && r.laggy.slips === 0, `${tag}: neither child ever meets the rim or the rail`, { rails: r.child.rails, rims: r.child.rims, slips: r.child.slips });
    check(r.random.done || mode === 'hard', `${tag}: random steering still reaches the chest (Hard may slip off the rim, and is floated back)`, { slips: r.random.slips });
    const secs = r.child.secs;
    check(near(secs, lev.len / lev.speed, 3), `${tag}: ${secs.toFixed(1)}s from start to the line at ${Math.round(lev.speed)} units a second`);
    scores[mode][n - 1] = m.score;

    // nothing can fail: eyes shut, straight ahead
    const blind = new L.Run(n, mode);
    let frames = 0, minV = Infinity, lastS = 0, monotone = true;
    while (blind.phase !== 'done' && frames < 60 * 400) { blind.step(DT, 0); if (blind.phase === 'play') { minV = Math.min(minV, blind.v); if (blind.s < lastS) monotone = false; lastS = blind.s; } blind.ev.length = 0; frames++; }
    check(blind.phase === 'done' && blind.stars >= 1 && blind.slips === 0 && minV >= blind.vc * L.START_V - 1 && monotone, `${tag}: sliding straight ahead with eyes shut still reaches the chest (${blind.bumps} poofs, ${blind.stars} star), never slower than ${Math.round(minV)}`);
    if (mode !== 'hard') {
      const wild = new L.Run(n, mode), rng = L.mulberry32(900 + n);
      let st = 0, wt = 0; frames = 0;
      while (wild.phase !== 'done' && frames < 60 * 600) { wt -= DT; if (wt <= 0) { st = rng() * 2 - 1; wt = 0.2 + rng() * 1.2; } wild.step(DT, st); wild.ev.length = 0; frames++; }
      check(wild.phase === 'done' && wild.stars >= 1 && Math.abs(wild.x) <= wild.lev.hw && wild.slips === 0, `${tag}: wild random steering still reaches the chest`, { poofs: wild.bumps });
    }
    table.push({ mode, n, secs });
    console.log(
      mode.padEnd(6), String(n).padStart(3), String(lev.len).padStart(6), secs.toFixed(0).padStart(5), String(lev.hw).padStart(4), String(lev.obs.length).padStart(7),
      `${lev.laneTotal}+${lev.total - lev.laneTotal}`.padStart(11), String(lev.arches.length).padStart(4), String(lev.loops.length).padStart(5), String(Math.round((lev.key.s / lev.len) * 100)).padStart(4), '|',
      (m.open * 100).toFixed(1).padStart(5), (m.tight * 100).toFixed(1).padStart(6), String(m.narrow).padStart(6), '|',
      `${r.child.bumps}/${r.laggy.bumps}/${r.random.bumps}`.padStart(9), '|', `${r.child.stars}${r.laggy.stars}`.padStart(5), `${r.child.rails}/${r.child.rims}/${r.child.slips}`.padStart(8), '|', m.work.toFixed(1).padStart(5), String(m.score).padStart(5),
    );
  }
}
// the difficulty rises through the courses in every mode, level 11 above level 10, and Easy < Medium < Hard in every course
for (const mode of L.MODE_IDS) {
  for (let n = 2; n <= L.NLEV; n++) check(scores[mode][n - 1] > scores[mode][n - 2], `${mode}: course ${n} is harder than course ${n - 1} (score ${scores[mode][n - 1]} > ${scores[mode][n - 2]})`);
  check(scores[mode][10] > scores[mode][9], `${mode}: course 11 (World 2) is harder than course 10 (${scores[mode][10]} > ${scores[mode][9]})`);
  check(scores[mode].slice(10).every((s) => s > scores[mode][0]) && scores[mode][19] > scores[mode][9], `${mode}: World 2 is harder than anything early in World 1`);
}
for (let n = 1; n <= L.NLEV; n++) check(scores.easy[n - 1] < scores.medium[n - 1] && scores.medium[n - 1] < scores.hard[n - 1], `course ${n}: Easy < Medium < Hard (${scores.easy[n - 1]} < ${scores.medium[n - 1]} < ${scores.hard[n - 1]})`);
check(easyDrift >= 5, 'on Easy most of courses 13–20 still have drifting clouds', easyDrift);
check(cloudCount.easy < cloudCount.medium && cloudCount.medium < cloudCount.hard, 'fewer groups of clouds on Easy and more on Hard, over the twenty courses', cloudCount);

// ================= the rules =================
{
  const open = (r) => { r.lev.buckets = []; return r; };                       // open sky: nothing to poof
  const evs = (r, n, steer) => { const out = []; for (let i = 0; i < n; i++) { r.step(DT, steer); out.push(...r.ev.map((e) => e.type)); r.ev.length = 0; } return out; };

  // ---- setting off, steering ----
  {
    const r = open(new L.Run(1, 'medium'));
    check(r.phase === 'play' && near(r.v, r.vc * L.START_V) && r.s === 0 && r.x === 0, 'she sets off gently (half the course speed) from the middle of the ribbon');
    let prev = 0, mono = true;
    for (let i = 0; i < 60 * 4; i++) { r.step(DT, 0); if (r.v < prev - 1e-9) mono = false; prev = r.v; }
    check(mono && near(r.v, r.vc, r.vc * 0.02) && r.vx === 0 && r.x === 0, 'she picks up to the course speed and holds it, and straight ahead stays in the middle', { v: r.v, vc: r.vc });
    const a = open(new L.Run(1, 'easy')), b = open(new L.Run(1, 'easy'));
    evs(a, 18, 1); evs(b, 18, -1);
    const want = L.VU_MAX * (0.3 - (1 - Math.exp(-L.STEER_K * 0.3)) / L.STEER_K);
    check(near(a.x, want, 6) && near(b.x, -want, 6), `full steer for 0.3 s moves her ${want.toFixed(0)} units across, right for +1 and left for -1 (and the same either way)`, [a.x, b.x]);
    const c = open(new L.Run(1, 'easy'));
    evs(c, 12, 1); const x1 = c.x; evs(c, 60, 0);
    check(c.x > x1 && c.x < x1 + 90 && near(c.vx, 0, 1), 'letting go, she glides a little on and stops (no steering, no sideways speed)', { x1, x: c.x, vx: c.vx });
    check(L.starsFor(0, 0) === 3, 'a course with no coins to count is 3 stars');
  }

  // ---- the rim ----
  {
    const e = open(new L.Run(10, 'easy')), rim = e.lev.hw - L.EDGE;
    let seen = [], maxX = 0;
    for (let i = 0; i < 60 * 4; i++) { e.step(DT, 1); seen.push(...e.ev.map((q) => q.type)); e.ev.length = 0; maxX = Math.max(maxX, Math.abs(e.x)); }
    check(near(e.x, rim, 1e-9) && maxX <= rim + 1e-9 && e.phase === 'play' && e.slips === 0 && e.rims === 0, `Easy: invisible rails hold her at ${rim} units, she cannot leave the ribbon on the right`, { x: e.x, rim });
    check(e.rails === 1 && seen.filter((t) => t === 'rail').length === 1 && e.vx === 0, 'Easy: pressing on the rail is one soft "rail" (not a stream of them) and no sideways speed is left');
    const e2 = open(new L.Run(10, 'easy'));
    evs(e2, 60 * 4, -1);
    check(near(e2.x, -rim, 1e-9) && e2.phase === 'play', 'Easy: and on the left');
    evs(e2, 30, 1); evs(e2, 60 * 4, -1);
    check(e2.rails === 2, 'Easy: leaving the rail and coming back is a new touch');

    const m = open(new L.Run(10, 'medium')), mrim = m.lev.hw - L.EDGE;
    let mseen = [], mmax = 0, back = true;
    for (let i = 0; i < 60 * 4; i++) { m.step(DT, 1); mseen.push(...m.ev.map((q) => q.type)); m.ev.length = 0; mmax = Math.max(mmax, Math.abs(m.x)); if (m.phase !== 'play') back = false; }
    check(back && mmax <= mrim + 1e-9 && m.rims >= 2 && mseen.includes('rim') && m.slips === 0, `Medium: at the rim she is bumped back (${m.rims} times in 4 s of pushing), never past ${mrim} units, and never falls`, { mmax, rims: m.rims });
    const m2 = open(new L.Run(10, 'medium'));
    let kick = 0; for (let i = 0; i < 60 * 3 && !m2.rims; i++) m2.step(DT, 1);
    kick = m2.kx; m2.step(DT, 0);
    check(m2.rims === 1 && kick < 0 && m2.x < m2.lev.hw - L.EDGE && m2.vx === 0, 'Medium: the bump throws her back toward the middle (not the rim) with her sideways speed gone', { kick, x: m2.x });
  }

  // ---- a slip (Hard) and the checkpoint ----
  {
    const h = open(new L.Run(10, 'hard')), lev = h.lev;
    check(lev.arches.length >= 3, 'course 10 has rainbow arches to be floated back to', lev.arches);
    // before any arch: back to near the start
    let t = 0, seen = [];
    while (h.phase === 'play' && t++ < 60 * 8) { h.step(DT, 1); seen.push(...h.ev.map((q) => q.type)); h.ev.length = 0; }
    check(h.phase === 'rescue' && seen.includes('slip') && h.slips === 1 && Math.abs(h.x) > lev.hw + L.SLIP_OVER - 1, 'Hard: pushed past the rim, she slips off', { phase: h.phase, x: h.x });
    const s0 = h.s; seen = []; let zmin = 0;
    for (let i = 0; i < 60 * (L.RESCUE_T + 0.5) && h.phase === 'rescue'; i++) { h.step(DT, 1); zmin = Math.min(zmin, h.z); seen.push(...h.ev.map((q) => q.type)); h.ev.length = 0; }
    check(h.phase === 'play' && seen.includes('restore') && seen.includes('back') && h.restores === 1 && zmin < -100 && h.z === 0 && h.inv > 1, 'Hard: she floats down on a little cloud and back up, and slides on with a moment of grace', { phase: h.phase, zmin, inv: h.inv });
    check(near(h.s, 0, 1) && near(h.x, 0, 1) && h.s < s0 + 1, 'Hard: with no arch passed yet, she is brought back to the start of the ribbon, onto the clear lane', { s: h.s, was: s0 });

    // after an arch: back to that arch, coins kept, the key kept
    const h2 = open(new L.Run(10, 'hard')), a0 = lev.arches[0], a1 = h2.lev.arches[1];
    h2.warpTo(a0 - 300, L.laneAt(h2.lev, a0 - 300));
    for (let i = 0; i < 60 * 40 && h2.s < a1 + 400; i++) { h2.step(DT, 0); h2.ev.length = 0; h2.x = L.laneAt(h2.lev, h2.s); }
    check(h2.cpS === a1 && h2.cpN === 2, 'passing an arch makes it the checkpoint (the latest one she has passed)', { cpS: h2.cpS, a1 });
    const c0 = h2.laneCount, p0 = h2.picked; h2.hasKey = true;
    h2.x = h2.lev.hw - 20;
    let ev2 = [];
    for (let i = 0; i < 60 * 8 && h2.phase !== 'rescue'; i++) { h2.step(DT, 1); ev2.push(...h2.ev.map((q) => q.type)); h2.ev.length = 0; }
    for (let i = 0; i < 60 * (L.RESCUE_T + 0.5) && h2.phase === 'rescue'; i++) { h2.step(DT, 0); ev2.push(...h2.ev.map((q) => q.type)); h2.ev.length = 0; }
    check(h2.phase === 'play' && near(h2.s, a1, 1) && near(h2.x, L.laneAt(h2.lev, a1), 1), 'Hard: a slip brings her back to the last arch she passed, onto the lane there', { s: h2.s, a1, x: h2.x });
    check(h2.laneCount === c0 && h2.picked === p0 && h2.hasKey && h2.spilled === 0, `Hard: her coins (${c0}) and the key are kept`, { laneCount: h2.laneCount, c0 });
    check(!!ev2.length && h2.ci >= 0 && h2.lev.coins[h2.ci] && h2.lev.coins[h2.ci].s >= a1 - 160 - 1 && (h2.ci === 0 || h2.lev.coins[h2.ci - 1].s < a1 - 160), 'and the coins ahead of the arch are looked at again from there', { ci: h2.ci });
    // she can still finish: a long steady slide from the checkpoint
    let fr = 0; while (h2.phase !== 'done' && fr++ < 60 * 300) { h2.step(DT, 0); h2.ev.length = 0; }
    check(h2.phase === 'done' && h2.slips === 1, 'and slides on to the chest');
    // sliding off the rim in the loops or anywhere else is the same; and Medium and Easy never slip
    for (const mode of ['easy', 'medium']) { const q = open(new L.Run(10, mode)); evs(q, 60 * 20, 1); check(q.slips === 0 && q.phase === 'play', `${mode}: nothing ever makes her slip`); }
  }

  // ---- a poof ----
  {
    for (const mode of L.MODE_IDS) {
      const r = new L.Run(1, mode), o = r.lev.obs.find((q) => q.s > 1500 && r.lev.obs.filter((w) => w !== q && Math.abs(w.s - q.s) < 700).length === 0);
      r.lev.coins = []; r.got = new Uint8Array(0); r.cs = new Float32Array(0); r.cx = new Float32Array(0);   // (no coins to pick up on the way: only the ones she already has)
      r.warpTo(o.s - 260, o.x); r.v = r.vc; r.laneCount = 4; r.coinCount = 4;
      const seen = []; let vMin = Infinity, vAtPoof = null, ok = true;
      for (let i = 0; i < 60 * 3.4; i++) { r.step(DT, 0); for (const q of r.ev) { seen.push(q.type); if (q.type === 'poof') vAtPoof = r.v; } r.ev.length = 0; if (vAtPoof != null) vMin = Math.min(vMin, r.v); if (r.phase !== 'play') ok = false; }
      check(r.bumps === 1 && seen.filter((t) => t === 'poof').length === 1 && vAtPoof <= r.vc * L.POOF_V + 1 && vMin > r.vc * 0.3, `${mode}: a cloud is one soft poof, down to ${Math.round(vAtPoof)} (half speed) and never stopped`, { bumps: r.bumps, vAtPoof, vMin });
      check(near(r.v, r.vc, r.vc * 0.03) && ok, `${mode}: and she is back to the course speed a few seconds later`, { v: r.v });
      check(mode === 'easy' ? r.spilled === 0 && !seen.includes('spill') && r.laneCount === 4 : r.spilled === 1 && seen.filter((t) => t === 'spill').length === 1 && r.laneCount === 3, `${mode}: ${mode === 'easy' ? 'no coin is spilled' : 'one coin is spilled, not more'}`, { spilled: r.spilled, laneCount: r.laneCount });
    }
    const r = new L.Run(1, 'medium'), o = r.lev.obs.find((q) => q.s > 1500 && r.lev.obs.filter((w) => w !== q && Math.abs(w.s - q.s) < 700).length === 0);
    r.warpTo(o.s - 100, o.x); r.v = r.vc; r.laneCount = 0; r.coinCount = 0;
    evs(r, 60 * 2, 0);
    check(r.bumps >= 1 && r.laneCount === 0 && r.coinCount === 0 && r.spilled === 0, 'with no coins to spill, a poof spills nothing (the count never goes below 0)');
    // a cloud that moves is the same: its place is a function of the course's time
    const lev = L.build(13, 'medium'), d = lev.obs.find((q) => q.amp);
    check(d && d.g === 1 && near(L.obsX(d, 0), d.x + d.amp * Math.sin(d.ph), 1e-9) && !near(L.obsX(d, 1.7), L.obsX(d, 0), 1e-3), 'a drifting cloud is grumpy and its place depends only on the course clock');
    check(lev.obs.filter((q) => q.amp).every((q) => { for (let t = 0; t < 30; t += 0.25) { const x = L.obsX(q, t); for (let s = q.s - 80; s <= q.s + 80; s += 20) if (Math.abs(L.laneAt(lev, s) - x) < L.halfWidth(q) + L.BODY_R + 8) return false; } return true; }), 'a drifting cloud never reaches the lane, at any moment');
  }

  // ---- loops ----
  {
    const lev = L.build(6, 'medium'), lp = lev.loops[0];
    const r = new L.Run(6, 'medium');
    r.warpTo(lp.a - 80, L.laneAt(lev, lp.a - 80)); r.v = r.vc;
    const seen = []; let poofs = 0, maxP = -1, inside = 0;
    while (r.s < lp.b + 100) { r.x = L.laneAt(lev, r.s); r.step(DT, 0); for (const q of r.ev) seen.push(q.type); r.ev.length = 0; if (r.loop >= 0) { inside++; maxP = Math.max(maxP, r.loopP); } }
    check(seen.filter((t) => t === 'loop').length === 1 && seen.filter((t) => t === 'loopEnd').length === 1 && seen.indexOf('loop') < seen.indexOf('loopEnd') && r.loops === 1, 'a loop is entered once and left once');
    check(maxP > 0.95 && maxP < 1 && inside > 60, `loopP runs 0..1 round the loop (reached ${maxP.toFixed(3)}) over ${inside} frames`);
    check(r.bonusCount === 8 && r.bumps === 0 && r.laneCount <= lev.laneTotal, 'a loop has no clouds and gives eight extra coins to whoever follows the lane', { bonus: r.bonusCount, bumps: r.bumps });
    check(L.starsFor(lev.laneTotal * 0.8, lev.laneTotal) === 3 && L.starsFor(lev.laneTotal * 0.8 - 1, lev.laneTotal) === 2, 'stars count the lane coins; the loop coins are extra');
    const none = new L.Run(6, 'medium'); none.warpTo(lev.len - 40, 0); none.laneCount = Math.ceil(lev.laneTotal * 0.8); none.bonusCount = 0;
    for (let i = 0; i < 60 * 2 && none.phase === 'play'; i++) { none.step(DT, 0); none.ev.length = 0; }
    check(none.phase !== 'play' && none.stars === 3, '80% of the lane coins is 3 stars even if every loop coin was missed', { stars: none.stars });
    check(lev.loops.every((q, i) => L.loopAt(lev, q.a) === i && L.loopAt(lev, q.a - 1) === -1 && L.loopAt(lev, q.b - 1) === i && L.loopAt(lev, q.b) === -1), 'loopAt tells where a loop is');
    // the ribbon winds, but is calm at the start, the end and through loops (which carry it sideways)
    check(near(L.centreAt(lev, 0), 0, 1e-9) && near(L.centreAt(lev, lev.len), L.centreAt(lev, lev.len + 800), 1e-6), 'the ribbon starts in the middle and ends straight');
    check(Math.abs(L.centreAt(lev, lp.b + 600) - L.centreAt(lev, lp.a - 600)) > 150, 'a loop carries the ribbon sideways, so its two ends are not on top of each other');
  }

  // ---- the key and the chest ----
  {
    const lev = L.build(5, 'medium'), k = lev.key;
    const a = new L.Run(5, 'medium'); a.warpTo(k.s - 300, k.x); a.v = a.vc;
    const seen = []; for (let i = 0; i < 60 * 3; i++) { a.step(DT, 0); for (const q of a.ev) seen.push(q.type); a.ev.length = 0; if (a.s > k.s + 100) break; }
    check(a.hasKey && seen.filter((t) => t === 'key').length === 1, 'sliding along the lane through the key takes it (once)');
    const b = new L.Run(5, 'medium'); b.warpTo(k.s - 300, k.x > 0 ? k.x - 200 : k.x + 200); b.v = b.vc; b.lev.buckets = [];
    for (let i = 0; i < 60 * 3 && b.s < k.s + 150; i++) { b.step(DT, 0); b.ev.length = 0; }
    check(!b.hasKey, 'slide past it at 200 units to one side and it is missed');
    // the chest, with and without the key
    for (const withKey of [true, false]) {
      const r = new L.Run(5, 'medium'); r.warpTo(lev.len - 60, 0); r.hasKey = withKey; r.ci = r.cs.length;
      const seen = []; let tOpen = null, fr = 0;
      while (!r.opened && fr++ < 60 * 40) { r.step(DT, 0); for (const q of r.ev) { seen.push(q.type); if (q.type === 'open') tOpen = r.st; } r.ev.length = 0; }
      check(r.opened && r.phase === 'done' && seen.indexOf('finish') < seen.indexOf('chest') && seen.indexOf('chest') < seen.indexOf('open') && near(r.s, lev.stopS, 1) && Math.abs(r.x) < 12, `the finish: she glides to the middle and stops at the chest, which opens (${withKey ? 'with' : 'without'} the key)`, { s: r.s, stopS: lev.stopS, seen });
      check(withKey ? tOpen < 0.5 && !seen.includes('keyfloat') : near(tOpen, L.KEY_DELAY, 0.05) && seen.includes('keyfloat') && r.hasKey, withKey ? 'with the key the chest bursts open at once' : `without the key, the key floats down to her and the chest opens anyway after ${L.KEY_DELAY} s`, { tOpen, seen });
      const o = r.ev.length; void o;
      check(r.stars >= 1, 'the chest is always reached: at least 1 star');
    }
  }

  // ---- coins and stars ----
  {
    check(L.starsFor(80, 100) === 3 && L.starsFor(79, 100) === 2 && L.starsFor(50, 100) === 2 && L.starsFor(49, 100) === 1 && L.starsFor(0, 100) === 1 && L.starsFor(130, 100) === 3, 'stars: 3 for 80% of the coins, 2 for half, 1 for reaching the chest');
    const e = P.slide(2, 'easy', 'child', 1), h = P.slide(2, 'hard', 'child', 1);
    check(e.stars === 3 && h.stars === 3 && e.secs > h.secs * 1.4, 'stars do not depend on time: the same 3 stars at Easy speed and at Hard speed', { easy: e.secs, hard: h.secs });
    const r = new L.Run(1, 'medium');
    let cev = 0;
    while (r.s < 1100) { r.step(DT, 0); cev += r.ev.filter((q) => q.type === 'coin').length; r.ev.length = 0; }
    check(r.laneCount === 5 && cev === 5 && r.picked === 5, 'the first trail of five coins is collected by sliding straight', r.laneCount);
    const m = new L.Run(1, 'medium'); m.warpTo(2000, m.lev.coins.find((c) => c.s > 2000).x);
    check(m.ci > 0 && m.lev.coins[m.ci].s >= 2000 - 160, 'warping along the course finds the coins ahead');
  }

  // ---- the modes scale the same course ----
  {
    for (const n of [1, 10, 11, 20]) {
      const e = L.build(n, 'easy'), m = L.build(n, 'medium'), h = L.build(n, 'hard');
      check(near(e.speed / m.speed, 0.8, 1e-9) && near(h.speed / m.speed, 1.25, 1e-9), `course ${n}: Easy slides at 0.8 and Hard at 1.25 times Medium's speed`);
      check(e.hw > m.hw && m.hw > h.hw && e.len === m.len && m.len === h.len, `course ${n}: the ribbon is widest on Easy and narrowest on Hard, and equally long`, [e.hw, m.hw, h.hw]);
      const pat = (lv) => Object.values(lv.patterns).reduce((a, b) => a + b, 0);
      check(pat(e) <= pat(m) + 2 && pat(e) <= pat(h), `course ${n}: cloud groups: Easy ${pat(e)}, Medium ${pat(m)}, Hard ${pat(h)} (Easy fewest)`);
      const room = (lv) => lv.obs.filter((q) => !q.extra && !q.amp).reduce((a, q, _, arr) => a + (Math.abs(q.x - L.laneAt(lv, q.s)) - L.halfWidth(q)) / arr.length, 0);
      check(room(e) > room(m) && room(m) > room(h), `course ${n}: the room beside the lane shrinks from Easy to Hard`, [room(e), room(m), room(h)].map(Math.round));
    }
    const a = L.build(7, 'medium'), b = L.build(7, 'medium', 99);
    check(L.describe(a) !== L.describe(b), 'a different seed is a different course');
  }
}

// ================= the tilt maths (the same model, and the same checks, as Splash Dash's) =================
{
  // A separate model of the phone (phone.js): what the sensors read for a phone held this way.
  const { pose, rad } = require('./phone.js');
  const steerOf = (angle, lean, back) => { const g = pose(angle, lean, back); return L.steerFromLean(L.leanDeg(g[0], g[1], g[2], angle)); };
  // sanity of the model itself
  let g = pose(0, 0, 0);
  check(near(g[0], 0, 1e-9) && near(g[1], 9.81, 1e-9) && near(g[2], 0, 1e-9), 'phone model: upright portrait reads (0, 9.8, 0)', g);
  g = pose(0, 0, 90);
  check(near(g[0], 0, 1e-9) && near(g[1], 0, 1e-9) && near(g[2], 9.81, 1e-9), 'phone model: flat on a table reads (0, 0, 9.8)', g);
  g = pose(90, 0, 0);
  check(near(g[0], 9.81, 1e-9) && near(g[1], 0, 1e-9), 'phone model: landscape, top edge to the left, reads (+9.8, 0, 0)', g);
  g = pose(270, 0, 0);
  check(near(g[0], -9.81, 1e-9) && near(g[1], 0, 1e-9), 'phone model: landscape the other way round reads (-9.8, 0, 0)', g);

  const T = L.TILT;
  for (const angle of [90, 270]) {
    const way = angle === 90 ? 'landscape (angle 90)' : 'landscape the other way round (angle 270)';
    check(steerOf(angle, 0, 0) === 0 && steerOf(angle, 0, 40) === 0, `${way}: held level steers straight`);
    check(near(steerOf(angle, T.FULL, 0), 1, 1e-9) && near(steerOf(angle, -T.FULL, 0), -1, 1e-9), `${way}: leaning ${T.FULL}° right gives full right steer (+1), left gives -1`, [steerOf(angle, T.FULL, 0), steerOf(angle, -T.FULL, 0)]);
    check(near(steerOf(angle, 35, 0), 1, 1e-9) && near(steerOf(angle, -60, 0), -1, 1e-9), `${way}: leaning further stays at full steer`);
    const half = (T.FULL + T.DEAD) / 2;
    check(near(steerOf(angle, half, 0), 0.5, 1e-9) && near(steerOf(angle, -half, 0), -0.5, 1e-9), `${way}: ${half}° is half steer, with the right sign`, steerOf(angle, half, 0));
    check(near(steerOf(angle, 10, 0), (10 - T.DEAD) / (T.FULL - T.DEAD), 1e-9), `${way}: 10° gives ${((10 - T.DEAD) / (T.FULL - T.DEAD)).toFixed(3)}`, steerOf(angle, 10, 0));
    check(steerOf(angle, T.DEAD - 0.5, 0) === 0 && steerOf(angle, -(T.DEAD - 0.5), 0) === 0 && steerOf(angle, T.DEAD + 0.5, 0) > 0 && steerOf(angle, -(T.DEAD + 0.5), 0) < 0, `${way}: inside the ${T.DEAD}° dead zone is straight; just outside it steers`);
    // tipped back in the hands, or nearly flat in a lap: the same sign, and what the lean truly is
    for (const back of [30, 45, 80]) {
      const want = L.steerFromLean((Math.asin(Math.cos(rad(back)) * Math.sin(rad(15))) * 180) / Math.PI);
      check(near(steerOf(angle, 15, back), want, 1e-9) && near(steerOf(angle, -15, back), -want, 1e-9) && steerOf(angle, 25, back) >= steerOf(angle, 15, back),
        `${way}: tipped back ${back}°, a 15° lean steers the same way (${want.toFixed(2)}), and more lean never steers less`, steerOf(angle, 15, back));
    }
    // flat on its back and rocked side to side (right edge down by 12 degrees): about the screen's up axis
    {
      const up = pose(angle, 0, 90, 12), st = L.steerFromLean(L.leanDeg(up[0], up[1], up[2], angle));
      check(near(st, (12 - T.DEAD) / (T.FULL - T.DEAD), 1e-9) && near(up[2], 9.81 * Math.cos(rad(12)), 1e-9), `${way}: lying flat and rocked 12° to the right steers right`, { st, up });
      const up2 = pose(angle, 0, 90, -12);
      check(near(L.steerFromLean(L.leanDeg(up2[0], up2[1], up2[2], angle)), -st, 1e-9), `${way}: and rocked to the left steers left`);
    }
    // deviceorientation's angles describe the same pose and give the same steer
    for (const [lean, back] of [[15, 0], [-12, 30], [8, 60], [-20, 10]]) {
      const up = pose(angle, lean, back), beta = (Math.asin(up[1] / 9.81) * 180) / Math.PI, gamma = (Math.atan2(-up[0], up[2]) * 180) / Math.PI;
      const g2 = L.gravityFromOrientation(beta, gamma);
      // (gamma only runs -90..90 on a phone; past that beta flips. The vector is what matters, so compare vectors.)
      const same = near(g2[0], up[0], 1e-6) && near(g2[1], up[1], 1e-6) && near(g2[2], up[2], 1e-6);
      const viaOrientation = L.steerFromLean(L.leanDeg(g2[0], g2[1], g2[2], angle));
      check(same && near(viaOrientation, steerOf(angle, lean, back), 1e-6), `${way}: deviceorientation's beta/gamma for lean ${lean}°, back ${back}° give the same up-vector and the same steer`, { up, g2 });
    }
  }
  // Which way: LEFT side down steers LEFT, whichever way round the phone is, and it shows in the raw reading's y
  for (const [angle, ySign] of [[90, -1], [270, 1]]) {
    const leftDown = pose(angle, -12, 35), rightDown = pose(angle, 12, 35);
    check(Math.sign(leftDown[1]) === ySign && steerOf(angle, -12, 35) < -0.2 && Math.sign(rightDown[1]) === -ySign && steerOf(angle, 12, 35) > 0.2,
      `angle ${angle}: left side down reads y ${ySign < 0 ? '<' : '>'} 0 and steers LEFT; right side down steers right`, { leftDown, steer: steerOf(angle, -12, 35) });
  }
  // the Seeker lying flat on a desk reads [0, 0, 9.9] (measured on the phone): straight ahead, either way round
  check(L.steerFromLean(L.leanDeg(0, 0, 9.9, 90)) === 0 && L.steerFromLean(L.leanDeg(0, 0, 9.9, 270)) === 0 && near(L.leanDeg(0, 0, 9.9, 90), 0, 1e-9), 'the reading measured on the Seeker flat on a desk, [0, 0, 9.9], steers straight ahead');
  // a wrongly reported angle: a landscape picture with "angle 0" while up lies along the phone's x axis
  check(L.screenAngleFor(0, true, 9.5, 1.0, null) === 90 && L.screenAngleFor(0, true, -9.5, 1.0, null) === 270 && L.screenAngleFor(180, true, 9.5, 0.5, null) === 90, 'a landscape picture reported as "not turned" is put right from the up-vector (x up: angle 90; x down: 270)');
  check(L.screenAngleFor(0, true, 0.3, 9.6, null) === 0 && L.screenAngleFor(0, true, 0.1, 0.2, null) === 0 && L.screenAngleFor(0, true, 0.1, 0.2, 270) === 270, 'a tablet (up along y) keeps angle 0; lying flat keeps the last answer worked out');
  check(L.screenAngleFor(90, true, -9.5, 0, 270) === 90 && L.screenAngleFor(270, true, 9.5, 0, 90) === 270 && L.screenAngleFor(0, false, 9.5, 0, 90) === 0, 'a reported 90 or 270 is always believed, and portrait is left alone');
  // gravityFromOrientation against the specification's own examples
  let o = L.gravityFromOrientation(0, 0);
  check(near(o[0], 0, 1e-9) && near(o[1], 0, 1e-9) && near(o[2], 9.81, 1e-9), 'orientation (beta 0, gamma 0) is flat: (0, 0, 9.8)');
  o = L.gravityFromOrientation(90, 0);
  check(near(o[0], 0, 1e-9) && near(o[1], 9.81, 1e-9) && near(o[2], 0, 1e-6), 'orientation (beta 90) is upright portrait: (0, 9.8, 0)');
  o = L.gravityFromOrientation(0, -90);
  check(near(o[0], 9.81, 1e-9) && near(o[1], 0, 1e-9), 'orientation (gamma -90) is landscape with the top edge to the left: (+9.8, 0, 0)');
  o = L.gravityFromOrientation(20, -90);
  check(near(L.leanDeg(o[0], o[1], o[2], 90), 20, 1e-6), 'orientation (beta 20, gamma -90) in landscape is a 20° lean to the right', L.leanDeg(o[0], o[1], o[2], 90));
  // portrait and upside-down still make sense (not used by the app, which is always landscape)
  check(near(L.leanDeg(-Math.sin(rad(10)) * 9.81, Math.cos(rad(10)) * 9.81, 0, 0), 10, 1e-6) && near(L.leanDeg(Math.sin(rad(10)) * 9.81, -Math.cos(rad(10)) * 9.81, 0, 180), 10, 1e-6), 'portrait (angle 0) and upside-down (180) lean the right way too');
  check(L.normAngle(-90) === 270 && L.normAngle(450) === 90 && L.normAngle(88) === 90 && L.normAngle(undefined) === 0, 'screen angles are normalised (-90 is 270)');
  check(Number.isNaN(L.leanDeg(0, 0, 0, 90)) && Number.isNaN(L.leanDeg(0.5, 0.5, 0.5, 90)), 'a vector far too short (free fall, or no data) is rejected');

  // the filter
  const up90 = (lean) => pose(90, lean, 20);
  let f = new L.Tilt();
  check(!f.live(0) && f.value === 0, 'the filter starts idle');
  check(f.push(null, null, null, 90, 0) === false && f.push(NaN, 1, 1, 90, 0) === false && f.push(undefined, 0, 9.8, 90, 0) === false && f.samples === 0, 'null or missing sensor values are ignored');
  // constant data (an emulator, or a desktop browser's single event): never live
  for (let i = 0; i < 100; i++) f.push(9.81, 0, 0, 90, i * 16);
  check(!f.live(100 * 16) && f.samples === 100 && f.changes === 0, 'a hundred identical samples do not make tilt live (not real data)');
  // real, changing data: live after the 6th sample
  f = new L.Tilt();
  const noisy = (lean, i) => { const u = up90(lean); return [u[0] + 0.01 * Math.sin(i * 1.7), u[1] + 0.01 * Math.cos(i * 2.3), u[2] + 0.01 * Math.sin(i * 0.9)]; };
  let liveAt = -1;
  for (let i = 0; i < 12; i++) { const u = noisy(0, i); f.push(u[0], u[1], u[2], 90, i * 16); if (liveAt < 0 && f.live(i * 16)) liveAt = i + 1; }
  check(liveAt === T.MIN_SAMPLES, `changing data makes tilt live at the ${T.MIN_SAMPLES}th sample`, liveAt);
  check(Math.abs(f.value) < 0.01, 'held level (with sensor noise) the steer stays at 0', f.value);
  // a step to a 20-degree lean: 63% after one time constant, nearly all after four
  let t = 11 * 16, at = null;
  const t1 = t;
  for (let i = 0; i < 60; i++) { const u = noisy(25, i); t += 16; f.push(u[0], u[1], u[2], 90, t); if (at == null && t - t1 >= T.TAU * 1000) at = f.value; }
  check(near(at, 1 - Math.exp(-1), 0.06), `the low-pass filter: ${Math.round((1 - Math.exp(-1)) * 100)}% of a sudden lean after ${T.TAU}s`, at);
  check(f.value > 0.99, 'and all of it soon after', f.value);
  check(f.lean > 20 && f.angle === 90 && f.samples === 72, 'the filter keeps the last readings for the debug readout', { lean: f.lean, samples: f.samples });
  check(f.live(t) && f.live(t + T.STALE_MS - 1) && !f.live(t + T.STALE_MS + 1), `tilt stops steering ${T.STALE_MS}ms after the samples stop`);
  // browsers round what they hand to a page to 0.1 m/s^2. Lying still on a desk every sample is then the same (so
  // tilt stays idle, and there is nothing to steer anyway); in a hand it jitters and tilt goes live at once.
  const r1 = (v) => Math.round(v * 10) / 10;
  f = new L.Tilt();
  for (let i = 0; i < 120; i++) f.push(0, 0, 9.9, 90, i * 16);
  check(!f.live(120 * 16) && f.value === 0, 'flat and still on a desk (the rounded readings never change): tilt stays idle, steer 0');
  f = new L.Tilt();
  let liveAfter = -1;
  for (let i = 0; i < 40; i++) { const u = pose(90, 9 + 2 * Math.sin(i * 0.9), 30 + 3 * Math.sin(i * 0.5)); f.push(r1(u[0]), r1(u[1]), r1(u[2]), 90, i * 16); if (liveAfter < 0 && f.live(i * 16)) liveAfter = i + 1; }
  check(liveAfter > 0 && liveAfter <= 12 && f.value > 0.2, `held in a hand, readings rounded to 0.1 still change: tilt is live after ${liveAfter} samples (${(liveAfter * 16)}ms)`, { liveAfter, value: f.value });
  // lying on her side (the screen's right edge straight down): that is not steering. Tilt lets go, and takes hold
  // again when the phone is held level; a quick hard swerve is still steering.
  f = new L.Tilt();
  t = 0;
  const feed = (lean, back, secs) => { for (let i = 0; i < secs * 60; i++) { const u = pose(90, lean + 0.4 * Math.sin(i), back); t += 16.667; f.push(u[0], u[1], u[2], 90, t); } };
  feed(10, 30, 0.5);
  const wasLive = f.live(t);
  feed(60, 0, 0.6);
  const swerve = f.live(t) && f.value > 0.95;
  feed(0, 30, 1);
  feed(85, 0, 2);
  const onSide = { live: f.live(t), off: f.off, value: f.value };
  feed(85, 0, 3);
  const still = f.live(t);
  feed(0, 30, 0.3);
  const tooSoon = f.live(t);
  feed(8, 30, 0.7);
  check(wasLive && swerve, 'a hard swerve (60° for half a second) is still steering', { wasLive, swerve });
  check(!onSide.live && onSide.off && Math.abs(onSide.value) < 0.02 && !still, `on its side (85° for over ${T.WILD_S}s): tilt lets go and she swims straight`, onSide);
  check(!tooSoon && f.live(t) && !f.off && f.value > 0.2, 'held level again for a moment, tilt takes hold again', { tooSoon, live: f.live(t), value: f.value });
  // jitter is smoothed: +-3 degrees of shake about a 10-degree lean moves the steer much less than raw
  f = new L.Tilt();
  let lo = Infinity, hi = -Infinity, rlo = Infinity, rhi = -Infinity;
  for (let i = 0; i < 200; i++) { const u = up90(10 + (i % 2 ? 3 : -3)); f.push(u[0], u[1], u[2], 90, i * 16); if (i > 50) { lo = Math.min(lo, f.value); hi = Math.max(hi, f.value); rlo = Math.min(rlo, f.raw); rhi = Math.max(rhi, f.raw); } }
  check(hi - lo < 0.25 * (rhi - rlo), 'shaky hands are smoothed (the filtered steer moves under a quarter as much as the raw one)', { filtered: hi - lo, raw: rhi - rlo });
  // the same lean, the other way round: the same steer
  const fa = new L.Tilt(), fb = new L.Tilt();
  for (let i = 0; i < 40; i++) { const a = pose(90, 12, 25), b = pose(270, 12, 25); fa.push(a[0] + i * 1e-3, a[1], a[2], 90, i * 16); fb.push(b[0] + i * 1e-3, b[1], b[2], 270, i * 16); }
  check(near(fa.value, fb.value, 0.01) && fa.value > 0.4, 'the same lean steers the same, whichever way round the phone is held', [fa.value, fb.value]);
  check(T.FULL >= 20 && T.FULL <= 25 && T.DEAD > 0 && T.DEAD <= 4 && T.SIGN === 1, 'full steer at 20–25° of lean, a small dead zone', T);
}

console.log('');
const secs = (mode) => table.filter((r) => r.mode === mode).map((r) => r.secs);
console.log('times (s): ' + L.MODE_IDS.map((m) => `${m} ${Math.min(...secs(m)).toFixed(0)}–${Math.max(...secs(m)).toFixed(0)}`).join(', '));
console.log('difficulty score, courses 1/10/11/20: ' + L.MODE_IDS.map((m) => `${m} ${scores[m][0]}/${scores[m][9]}/${scores[m][10]}/${scores[m][19]}`).join(', '));
if (problems.length) { console.log(''); for (const p of problems) console.log('  FAIL ' + p); }
console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''} (${((Date.now() - t00) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
