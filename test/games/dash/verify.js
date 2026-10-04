// Splash Dash: proves all twenty courses, the rules and the tilt maths. No browser.
//   node test/games/dash/verify.js             (everything; about a minute)
//   node test/games/dash/verify.js --fp        (only print the courses' fingerprints)
//   DASH_DIR=<a copy of web/games/dash> node test/games/dash/verify.js     (verify a copy: mutate.js uses this)
//
// For each of the 20 courses:
//   - frozen: built from its seed it is exactly the course whose hash is below (and the same built twice);
//   - laid out fairly: clear water at the start and before the finish, everything on the course, nothing new
//     before its course, and the new thing is the first thing met;
//   - a clean line exists: a sweep over (distance, sideways position), at slow speed and at full boost, finds a
//     way from the start to the finish line that touches nothing with 8 units to spare and never needs more
//     than 57% of her sideways speed. Where things move, the sweep is repeated with the clock started at 17
//     different moments, so it holds whenever she arrives;
//   - every coin is on such a line (forward from the start AND onward to the finish), at both speeds; every
//     coin in the air sits over clear water beyond a ramp that is itself on a clean line;
//   - a model child (pilot.js: sees only 2 s ahead at top speed, reacts 0.3 s late, turns the steering at a
//     limited rate) swims it through the real Run.step() without one bump: at slow speed, at full boost, with
//     the button held half the time, as a careful child would hold it, and with the button pressed at random;
//   - the times at slow, at full boost and at a typical mix are inside the stated ranges;
//   - the difficulty score rises from each course to the next;
//   - nothing can fail: steering straight ahead with eyes shut still reaches the chest, and she never stops.
// Then the rules (speed button, bumps, kelp, ramps, coins, stars) and the tilt maths (both landscape ways
// round, the dead zone, the filter, "only real, changing data"), checked against a separate model of the phone.
'use strict';
const crypto = require('crypto');
const path = require('path');
const DIR = path.resolve(process.env.DASH_DIR || path.join(__dirname, '../../../web/games/dash'));
const L = require(path.join(DIR, 'logic.js'));
const { makePilot } = require('./pilot.js');
const P = makePilot(L);

// Frozen 3 Oct 2026. Changing a course changes stars a child may already have earned on it: don't.
const FROZEN = [
  'fa72028ce076', 'bead90e0fc1b', '1c2b99c36473', 'cb8c2669d741', 'e48a5eeb46af',
  'af02331bb18a', '90e718bbf6af', '8e83c3203857', 'cca0f06587c9', 'b53d053f86f5',
  '90f9af4f2954', '6eb0bd6afea0', '945908081b96', '43e7428d058e', 'bd6ad43ee278',
  '9948ceead692', '4e03a9cb6d30', '8ec23282f32e', 'ce77e2e85710', 'c2ebb0752159',
];
// The stated ranges, in seconds from the start to the finish line.
const TIMES = { slow: [70, 92], boost: [35, 47], typical: [50, 70] };

const fingerprint = (lv) => crypto.createHash('sha1').update(L.describe(lv)).digest('hex').slice(0, 12);
if (process.argv.includes('--fp')) {
  const fp = [];
  for (let n = 1; n <= L.NLEV; n++) fp.push(fingerprint(L.build(n)));
  for (let i = 0; i < fp.length; i += 5) console.log('  ' + fp.slice(i, i + 5).map((f) => `'${f}'`).join(', ') + ',');
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

// ---------- the sweep: is there always a clean line? ----------
const DS = 8, CELL = 4, NX = Math.floor((2 * L.XMAX) / CELL) + 1;
const xOf = (j) => -L.XMAX + j * CELL;
const jOf = (x) => Math.max(0, Math.min(NX - 1, Math.round((x + L.XMAX) / CELL)));
// One pass over the course at constant speed v, with the course's clock at t0 when she starts.
// Returns { ok, failAt, open (mean share of the width she could be in), tight (share of the course where that
// is under 300 units), narrow (the least width), F, B (forward / backward reachability, if keep) }.
function sweep(lev, v, t0, pad, keep) {
  const steps = Math.ceil(lev.len / DS), m = Math.floor((0.6 * L.VX_MAX * (DS / v)) / CELL);
  const blk = new Uint8Array((steps + 1) * NX), F = new Uint8Array((steps + 1) * NX);
  for (let k = 0; k <= steps; k++) {
    const s = k * DS, t = t0 + s / v, list = lev.buckets[Math.floor(s / 200)];
    if (!list) continue;
    for (const o of list) {
      if (Math.abs(o.s - s) > o.r + 60 + pad) continue;
      let ja = 0, jb = NX - 1;
      if (o.k !== 'wave') { const ox = L.obsX(o, t), w = L.halfWidth(o) + L.BODY_R + pad + CELL; ja = jOf(ox - w); jb = jOf(ox + w); }
      for (let j = ja; j <= jb; j++) {
        if (blk[k * NX + j]) continue;
        const x = xOf(j);
        if (L.touches(o, t, s + L.BODY[0][0], x, L.BODY[0][1] + pad) || L.touches(o, t, s + L.BODY[1][0], x, L.BODY[1][1] + pad)) blk[k * NX + j] = 1;
      }
    }
  }
  const j0 = jOf(0);
  for (let j = j0 - 2; j <= j0 + 2; j++) F[j] = 1;
  let sum = 0, tight = 0, narrow = Infinity, narrowAt = 0, counted = 0;
  for (let k = 1; k <= steps; k++) {
    const base = k * NX, prev = base - NX;
    let open = 0, run = 0;
    for (let j = 0; j < NX; j++) {
      if (blk[base + j]) continue;
      let from = false;
      for (let q = Math.max(0, j - m); q <= Math.min(NX - 1, j + m) && !from; q++) if (F[prev + q]) from = true;
      if (from) { F[base + j] = 1; open++; }
    }
    if (!open) return { ok: false, failAt: k * DS, t: t0 + (k * DS) / v };
    void run;
    if (k * DS < 1400) continue;   // (she starts in the middle of clear water: measure from where the course begins)
    counted++; sum += open / NX;
    if (open * CELL < 300) tight++;
    if (open * CELL < narrow) { narrow = open * CELL; narrowAt = k * DS; }
  }
  const res = { ok: true, open: sum / counted, tight: tight / counted, narrow, narrowAt, steps, m };
  if (keep) {
    const B = new Uint8Array((steps + 1) * NX);
    for (let j = 0; j < NX; j++) if (!blk[steps * NX + j]) B[steps * NX + j] = 1;
    for (let k = steps - 1; k >= 0; k--) {
      const base = k * NX, next = base + NX;
      for (let j = 0; j < NX; j++) {
        if (blk[base + j]) continue;
        for (let q = Math.max(0, j - m); q <= Math.min(NX - 1, j + m); q++) if (B[next + q]) { B[base + j] = 1; break; }
      }
    }
    res.F = F; res.B = B;
  }
  return res;
}
// Is this coin on a clean line (reachable from the start, and the finish reachable from it)?
function coinOnLine(sw, c) {
  const k = Math.max(0, Math.min(sw.steps, Math.round(c.s / DS)));
  for (let j = jOf(c.x - 30); j <= jOf(c.x + 30); j++) if (sw.F[k * NX + j] && sw.B[k * NX + j]) return true;
  return false;
}
const PHASES = []; for (let t0 = 0; t0 <= 24; t0 += 1.5) PHASES.push(t0);

// ---------- difficulty: one number per course ----------
// How much of the width is closed to her (at full boost), how much of the course is tight, how hard the model
// child has to work the steering, how often something is beside her and how close it sits, and the things that
// move, the ramps to line up for and the kelp to steer round.
function difficulty(m) {
  return Math.round(150 * (1 - m.open) + 100 * m.tight + 0.2 * m.work + 5 * m.rate + 1.5 * m.movers + 0.5 * (200 - m.room) + 4 * m.ramps + m.kelp);
}
// how much room she has beside the things along the lane: from the lane to the near edge of each, on average
function roomOf(lev) {
  let sum = 0, cnt = 0;
  for (const o of lev.obs) {
    if (o.extra) continue;
    const d = o.k === 'wave' ? o.gap / 2 - o.amp : Math.abs(o.x - L.laneAt(lev, o.s)) - L.halfWidth(o) - (o.mv === 1 ? o.amp : 0);
    if (o.mv === 2) { sum += 0; cnt++; continue; }
    if (d > 260) continue;   // (the far end of a line of buoys: not beside her)
    sum += Math.max(0, d); cnt++;
  }
  return cnt ? sum / cnt : 200;
}

function measure(n, seed) {
  const lev = L.build(n, seed), out = { n, lev, problems: [] };
  const bad = (w, d) => out.problems.push(w + (d != null ? ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)) : ''));
  const movers = lev.obs.filter((o) => o.amp);
  out.movers = movers.length;
  const phases = movers.length ? PHASES : [0];
  // a clean line at both speeds, whenever she arrives; and every coin on one
  for (const [name, v] of [['slow', L.V_SLOW], ['boost', L.V_MAX]]) {
    for (const t0 of phases) {
      const sw = sweep(lev, v, t0, 8, true);
      if (!sw.ok) { bad(`no clean line at ${name} speed (clock +${t0}s): blocked at ${sw.failAt}`); continue; }
      if (name === 'boost' && t0 === 0) { out.open = sw.open; out.tight = sw.tight; out.narrow = sw.narrow; out.narrowAt = sw.narrowAt; }
      const lost = lev.coins.filter((c) => !c.air && !coinOnLine(sw, c));
      if (lost.length) bad(`${lost.length} coin(s) not on a clean line at ${name} speed (clock +${t0}s)`, lost.slice(0, 3));
      if (name === 'boost') for (const r of lev.ramps) if (!coinOnLine(sw, { s: r.s, x: r.x })) bad(`the ramp at ${r.s} is not on a clean line (clock +${t0}s)`);
    }
  }
  // coins in the air: over their ramp, and nothing to land on
  for (const c of lev.coins.filter((q) => q.air)) {
    const r = lev.ramps.find((q) => c.s > q.s && c.s < q.s + 400);
    if (!r || Math.abs(c.x - r.x) > 40) bad(`a coin in the air at ${c.s} has no ramp under it`);
  }
  for (const r of lev.ramps) {
    const inWay = lev.obs.filter((o) => o.s > r.s - 200 && o.s < r.s + 700);
    if (inWay.length) bad(`something floats where she lands after the ramp at ${r.s}`, inWay.map((o) => [o.k, o.s, o.x]));
  }
  // the model child, through the real Run.step()
  const runs = { slow: P.swim(n, 'slow', 1, seed), boost: P.swim(n, 'boost', 1, seed), typical: P.swim(n, 'typical', 1, seed), half: P.swim(n, 'half', 1, seed), random1: P.swim(n, 'random', 11, seed), random2: P.swim(n, 'random', 23, seed) };
  out.runs = runs;
  for (const [name, r] of Object.entries(runs)) {
    if (!r.done) bad(`the model child did not finish (${name})`);
    if (r.bumps) bad(`the model child bumped ${r.bumps}x (${name})`, r.bumped.slice(0, 3));
  }
  if (runs.slow.coins < 0.95 * lev.groundTotal || runs.slow.stars !== 3) bad(`at slow speed the model child got ${runs.slow.coins}/${lev.groundTotal} coins (${runs.slow.stars} stars)`);
  if (runs.boost.coins < 0.95 * lev.total) bad(`at full boost the model child got ${runs.boost.coins}/${lev.total} coins`);
  if (runs.boost.leaps !== lev.ramps.length) bad(`at full boost the model child leapt ${runs.boost.leaps} of ${lev.ramps.length} ramps`);
  out.work = (runs.boost.travel / lev.len) * 1000;
  out.rate = (lev.obs.length / lev.len) * 1000;
  out.room = roomOf(lev);
  out.score = difficulty({ open: out.open == null ? 1 : out.open, tight: out.tight || 0, work: out.work, rate: out.rate, movers: out.movers, room: out.room, ramps: lev.ramps.length, kelp: lev.kelp.length });
  return out;
}
module.exports = { L, P, sweep, measure, difficulty, fingerprint, coinOnLine, PHASES, TIMES };
if (require.main !== module) return;

// ================= the courses =================
const t00 = Date.now();
console.log(`Splash Dash — ${L.NLEV} courses (logic: ${path.relative(process.cwd(), path.join(DIR, 'logic.js'))})`);
console.log(`speed: slow ${L.V_SLOW}, fastest ${L.V_MAX} units/s (${L.RAMP_UP}s to get there, easing back with a ${L.EASE_DOWN}s time constant); sideways ${L.VX_MAX} units/s at full steer; course ${2 * L.HALF} wide`);
console.log(`model child: sees ${P.LOOK} units ahead (${(P.LOOK / L.V_MAX).toFixed(1)}s at top speed), reacts ${P.REACT}s late, turns the steering at most ${P.RATE}/s, plans with ${Math.round(0.57 * 100)}% of her sideways speed\n`);
console.log('crs  len  new      obst coins(+air) kelp ramps movers | open% tight% narrow |  slow  boost  half  careful | bumps | work score');
let prevScore = -1;
const table = [];
for (let n = 1; n <= L.NLEV; n++) {
  const C = L.COURSES[n - 1], lev = L.build(n), again = L.build(n);
  const fp = fingerprint(lev);
  check(fp === FROZEN[n - 1], `course ${n} is the frozen course`, `${fp} != ${FROZEN[n - 1]}`);
  check(L.describe(lev) === L.describe(again), `course ${n} builds the same twice`);
  // laid out fairly
  const firstObs = lev.obs.length ? lev.obs[0].s : Infinity, firstKelp = lev.kelp.length ? lev.kelp[0].s : Infinity;
  check(Math.min(firstObs, firstKelp) >= 1400, `course ${n}: clear water for the first 1400 units`, Math.min(firstObs, firstKelp));
  check(lev.obs.every((o) => o.s <= lev.len - 500) && lev.kelp.every((k) => k.s <= lev.len - 500) && lev.ramps.every((r) => r.s <= lev.len - 700), `course ${n}: clear water before the finish line`);
  check(lev.obs.every((o) => Math.abs(o.x) + (o.k === 'wave' ? 0 : o.amp || 0) <= L.HALF + 100) && lev.kelp.every((k) => Math.abs(k.x) <= L.HALF), `course ${n}: everything floats on the course`);
  check(lev.coins.every((c) => Math.abs(c.x) <= L.XMAX && c.s > 300 && c.s < lev.len), `course ${n}: every coin is where she can swim`);
  check(lev.coins.length >= 60, `course ${n}: at least 60 coins`, lev.coins.length);
  const allowed = new Set(['coins', 'trail']);
  for (let k = 1; k <= n; k++) if (L.NEW[k]) allowed.add(L.NEW[k]);
  check(Object.keys(lev.patterns).every((k) => allowed.has(k)), `course ${n}: nothing appears before its course`, Object.keys(lev.patterns));
  if (C.feature) check((lev.patterns[C.feature] || 0) >= 2, `course ${n}: its new thing (${C.feature}) appears at least twice`, lev.patterns);
  const airShare = (lev.total - lev.groundTotal) / lev.total;
  check(airShare <= 0.2, `course ${n}: coins in the air are at most a fifth of the coins`, airShare);

  const m = measure(n);
  for (const p of m.problems) check(false, `course ${n}: ${p}`);
  check(m.problems.length === 0, `course ${n}: a clean line at both speeds, every coin on one, and the model child never bumps`);
  const r = m.runs;
  check(r.slow.secs >= TIMES.slow[0] && r.slow.secs <= TIMES.slow[1], `course ${n}: ${r.slow.secs.toFixed(1)}s at slow speed (stated ${TIMES.slow.join('–')}s)`);
  check(r.boost.secs >= TIMES.boost[0] && r.boost.secs <= TIMES.boost[1], `course ${n}: ${r.boost.secs.toFixed(1)}s at full boost (stated ${TIMES.boost.join('–')}s)`);
  check(r.half.secs >= TIMES.typical[0] && r.half.secs <= TIMES.typical[1], `course ${n}: ${r.half.secs.toFixed(1)}s at a typical mix (stated ${TIMES.typical.join('–')}s)`);
  check(r.typical.secs >= r.boost.secs - 0.01 && r.typical.secs <= r.slow.secs + 0.01, `course ${n}: a careful child's time lies between full boost and slow`, r.typical.secs);
  check(m.score > prevScore, `course ${n}: harder than course ${n - 1} (score ${m.score} > ${prevScore})`);
  prevScore = m.score;

  // nothing can fail: eyes shut, straight ahead, never touching the button
  const blind = new L.Run(n);
  let frames = 0, minV = Infinity;
  while (blind.phase !== 'done' && frames < 60 * 300) { blind.step(1 / 60, 0, false); if (blind.phase === 'play') minV = Math.min(minV, blind.v); blind.ev.length = 0; frames++; }
  check(blind.phase === 'done' && blind.stars >= 1 && minV >= L.V_KELP - 1, `course ${n}: steering straight ahead with no button still reaches the chest (${blind.bumps} bumps, ${blind.stars} star), never slower than ${Math.round(minV)}`);
  // and a wild child: random hard steering, random button
  const wild = new L.Run(n), rng = L.mulberry32(900 + n);
  let st = 0, bo = false, wt = 0; frames = 0; minV = Infinity;
  while (wild.phase !== 'done' && frames < 60 * 300) {
    wt -= 1 / 60; if (wt <= 0) { st = rng() * 2 - 1; bo = rng() < 0.5; wt = 0.2 + rng() * 1.2; }
    wild.step(1 / 60, st, bo); if (wild.phase === 'play') minV = Math.min(minV, wild.v); wild.ev.length = 0; frames++;
  }
  check(wild.phase === 'done' && wild.stars >= 1 && minV >= L.V_KELP - 1 && wild.coinCount >= 0 && Math.abs(wild.x) <= L.XMAX, `course ${n}: wild random play still reaches the chest`, { bumps: wild.bumps, minV });

  table.push({ n, len: lev.len, score: m.score, slow: r.slow.secs, boost: r.boost.secs, half: r.half.secs, careful: r.typical.secs });
  console.log(
    String(n).padStart(3), String(lev.len).padStart(6), ' ' + (C.feature || '-').padEnd(8), String(lev.obs.length).padStart(4), `${lev.groundTotal}+${lev.total - lev.groundTotal}`.padStart(9),
    String(lev.kelp.length).padStart(5), String(lev.ramps.length).padStart(5), String(m.movers).padStart(6), '|',
    (m.open * 100).toFixed(1).padStart(5), (m.tight * 100).toFixed(1).padStart(6), String(m.narrow).padStart(6), '|',
    r.slow.secs.toFixed(1).padStart(5), r.boost.secs.toFixed(1).padStart(6), r.half.secs.toFixed(1).padStart(5), r.typical.secs.toFixed(1).padStart(7), ' |',
    `${r.slow.bumps}/${r.boost.bumps}/${r.half.bumps}/${r.typical.bumps}/${r.random1.bumps}/${r.random2.bumps}`.padStart(11), '|', m.work.toFixed(0).padStart(4), String(m.score).padStart(5),
    `  blind: ${blind.bumps} bumps, ${blind.stars}★`,
  );
}

// ================= the rules =================
{
  const DT = 1 / 60;
  const open = (r) => { r.lev.buckets = []; r.lev.kelpBuckets = []; return r; };   // open water: nothing to bump
  const run = open(new L.Run(1));
  check(run.v === L.V_SLOW && run.phase === 'play', 'she starts at slow speed');
  // the speed button: a steady ramp to the top, then easing back
  let t = 0, v1 = 0;
  while (run.v < L.V_MAX - 0.01 && t < 10) { run.step(DT, 0, true); t += DT; if (Math.abs(t - L.RAMP_UP / 2) < DT / 2) v1 = run.v; }
  check(near(t, L.RAMP_UP, 0.05), `holding the speed button reaches top speed in ${L.RAMP_UP}s (gradually)`, t);
  check(near(v1, (L.V_SLOW + L.V_MAX) / 2, 3), 'half-way through the ramp she is at half the extra speed', v1);
  for (let i = 0; i < 30; i++) run.step(DT, 0, true);
  check(run.v === L.V_MAX, 'held longer, she stays at top speed (never more)', run.v);
  run.step(DT, 0, false);
  check(run.v < L.V_MAX && run.v > L.V_MAX - 10, 'letting go starts easing back at once, without a jolt', run.v);
  t = DT; let vTau = 0;
  while (run.v > L.V_SLOW + 0.05 * (L.V_MAX - L.V_SLOW) && t < 10) { run.step(DT, 0, false); t += DT; if (Math.abs(t - L.EASE_DOWN) < DT / 2) vTau = run.v; }
  check(near(vTau, L.V_SLOW + (L.V_MAX - L.V_SLOW) / Math.E, 4), `after ${L.EASE_DOWN}s she has lost 63% of the extra speed`, vTau);
  check(near(t, 3 * L.EASE_DOWN, 0.1), 'and is back within 5% of slow in about 2 seconds', t);
  for (let i = 0; i < 600; i++) run.step(DT, 0, false);
  check(near(run.v, L.V_SLOW, 0.5), 'left alone she settles at slow speed: she never stops', run.v);

  // steering: full steer reaches the sideways speed, and the float lines hold her in
  const r2 = open(new L.Run(1));
  for (let i = 0; i < 40; i++) r2.step(DT, 1, false);
  check(r2.vx > 0.95 * L.VX_MAX && r2.x > 0, 'full right steer takes her right at her sideways speed', r2.vx);
  for (let i = 0; i < 200; i++) r2.step(DT, 1, false);
  check(r2.x === L.XMAX, 'she cannot leave the course on the right', r2.x);
  for (let i = 0; i < 300; i++) r2.step(DT, -1, false);
  check(r2.x === -L.XMAX, 'nor on the left', r2.x);
  const r3 = open(new L.Run(1));
  for (let i = 0; i < 60; i++) r3.step(DT, 0, false);
  check(r3.x === 0 && r3.vx === 0, 'no steer: straight ahead');

  // a bump: find the first rock of course 1 and swim into it
  const r4 = new L.Run(1), rock = r4.lev.obs[0];
  const ev = [];
  while (r4.bumps === 0 && r4.s < rock.s + 200) {
    const want = r4.s > rock.s - 500 ? Math.max(-1, Math.min(1, (rock.x - r4.x) / 40)) : 0;
    r4.step(DT, want, r4.s > rock.s - 700);
    ev.push(...r4.ev.map((e) => e.type)); r4.ev.length = 0;
  }
  check(r4.bumps === 1 && ev.includes('bump'), 'swimming into a rock is a bump', { bumps: r4.bumps, s: r4.s, rock: [rock.s, rock.x] });
  check(r4.v <= L.V_BUMP + 0.01 && r4.v > 0, 'a bump drops her to slow speed (she does not stop)', r4.v);
  check(r4.spilled === 1 && ev.includes('spill') && r4.coinCount === r4.picked - 1, 'and spills one coin', { spilled: r4.spilled, coins: r4.coinCount, picked: r4.picked });
  check(r4.inv > 0, 'then nothing can bump her for a moment');
  let b2 = r4.bumps;
  for (let i = 0; i < 70; i++) { r4.step(DT, 0, false); }
  check(r4.bumps === b2 && r4.phase === 'play', 'she swims on through, with no second bump from the same rock');
  open(r4);
  for (let i = 0; i < 200; i++) r4.step(DT, 0, false);
  check(near(r4.v, L.V_SLOW, 1), 'and picks her slow speed up again', r4.v);
  const r5 = new L.Run(1);
  r5.s = rock.s - 200; r5.x = rock.x; r5.coinCount = 0; r5.ci = 0;
  r5.cs.fill(-9999);   // no coins about
  while (r5.bumps === 0 && r5.s < rock.s + 200) r5.step(DT, 0, false);
  check(r5.bumps === 1 && r5.coinCount === 0 && r5.spilled === 0, 'a bump with no coins spills nothing (never below 0)', { coins: r5.coinCount });

  // kelp slows her without a bump
  const courseWith = (what) => +Object.keys(L.NEW).find((n) => L.NEW[n] === what);
  const r6 = new L.Run(courseWith('kelp')), k = r6.lev.kelp[0];
  r6.s = k.s - 200; r6.x = k.x; r6.v = L.V_MAX;
  let kev = [], minV = Infinity;
  while (r6.s < k.s + k.rs + 20) { r6.step(DT, 0, true); kev.push(...r6.ev.map((e) => e.type)); r6.ev.length = 0; minV = Math.min(minV, r6.v); }
  check(kev.includes('kelp') && !kev.includes('bump') && minV < L.V_KELP + 30 && minV >= L.V_KELP - 1, 'kelp slows her (even with the button held) and never bumps', { minV });
  open(r6);
  for (let i = 0; i < 240; i++) r6.step(DT, 0, true);
  check(r6.v > L.V_SLOW, 'out of the kelp she speeds up again');

  // ramps: fast, she leaps and can take the coins in the air; slow, she only bobs over
  const RC = courseWith('ramp');
  const r7 = new L.Run(RC), rp = r7.lev.ramps[0], air = r7.lev.coins.map((c, i) => (c.air && c.s > rp.s && c.s < rp.s + 400 ? i : -1)).filter((i) => i >= 0);
  r7.s = rp.s - 100; r7.x = rp.x; r7.v = L.V_MAX; r7.ri = 0; r7.ci = 0;
  let rev = [], maxZ = 0;
  for (let i = 0; i < 90; i++) { r7.step(DT, 0, true); rev.push(...r7.ev.map((e) => e.type)); r7.ev.length = 0; maxZ = Math.max(maxZ, r7.z); }
  check(rev.includes('leap') && rev.includes('land') && near(maxZ, L.AIR_H, 2), 'a ramp taken fast throws her into the air and she lands again', { maxZ });
  check(air.length === 5 && air.every((i) => r7.got[i]), 'in the air she takes all five coins above the ramp', air.map((i) => r7.got[i]));
  const r8 = new L.Run(RC);
  r8.s = rp.s - 100; r8.x = rp.x; r8.ri = 0; r8.ci = 0;
  rev = [];
  for (let i = 0; i < 150; i++) { r8.step(DT, 0, false); rev.push(...r8.ev.map((e) => e.type)); r8.ev.length = 0; }
  check(rev.includes('bob') && !rev.includes('leap') && air.every((i) => !r8.got[i]) && r8.z === 0, 'taken slowly she only bobs over it, and the coins in the air stay there');
  const r9 = new L.Run(RC);
  r9.s = rp.s - 100; r9.x = rp.x > 0 ? rp.x - rp.hx - 30 : rp.x + rp.hx + 30; r9.v = L.V_MAX; r9.ri = 0;
  rev = [];
  for (let i = 0; i < 40; i++) { r9.step(DT, 0, true); rev.push(...r9.ev.map((e) => e.type)); r9.ev.length = 0; }
  check(!rev.includes('leap') && !rev.includes('bob'), 'beside the ramp nothing happens');

  // coins and stars
  check(L.starsFor(80, 100) === 3 && L.starsFor(79, 100) === 2 && L.starsFor(50, 100) === 2 && L.starsFor(49, 100) === 1 && L.starsFor(0, 100) === 1 && L.starsFor(130, 100) === 3, 'stars: 3 for 80% of the coins, 2 for half, 1 for finishing');
  const a = P.swim(1, 'slow', 1), b = P.swim(1, 'boost', 1);
  check(a.stars === 3 && b.stars === 3 && a.secs > b.secs * 1.8, 'stars do not depend on time: the same 3 stars slow or fast', { slow: a.secs, boost: b.secs });
  const r10 = new L.Run(1);
  let cev = 0;
  while (r10.s < 1100) { r10.step(DT, 0, false); cev += r10.ev.filter((e) => e.type === 'coin').length; r10.ev.length = 0; }
  check(r10.coinCount === 5 && cev === 5, 'the first trail of five coins is collected by swimming straight', r10.coinCount);

  // the finish: past the line she glides to the chest by herself
  const r11 = new L.Run(1);
  r11.s = r11.lev.len - 50; r11.x = 200; r11.ci = r11.cs.length;
  let fev = [];
  for (let i = 0; i < 60 * 12 && r11.phase !== 'done'; i++) { r11.step(DT, 1, true); fev.push(...r11.ev.map((e) => e.type)); r11.ev.length = 0; }
  check(fev.includes('finish') && fev.includes('chest') && r11.phase === 'done' && near(r11.s, r11.lev.stopS, 1) && Math.abs(r11.x) < 12 && r11.stars >= 1, 'past the finish line she glides to the middle and stops at the treasure chest', { s: r11.s, x: r11.x, stopS: r11.lev.stopS });
}

// ================= the tilt maths =================
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
console.log('times (s): slow ' + Math.min(...table.map((r) => r.slow)).toFixed(1) + '–' + Math.max(...table.map((r) => r.slow)).toFixed(1)
  + ', full boost ' + Math.min(...table.map((r) => r.boost)).toFixed(1) + '–' + Math.max(...table.map((r) => r.boost)).toFixed(1)
  + ', button held half the time ' + Math.min(...table.map((r) => r.half)).toFixed(1) + '–' + Math.max(...table.map((r) => r.half)).toFixed(1)
  + ', a careful child ' + Math.min(...table.map((r) => r.careful)).toFixed(1) + '–' + Math.max(...table.map((r) => r.careful)).toFixed(1));
if (problems.length) { console.log(''); for (const p of problems) console.log('  FAIL ' + p); }
console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''} (${((Date.now() - t00) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
