/* Rainbow Slide — the rules. Pure logic, no DOM: test/games/slide/verify.js runs this same file in Node.
 *
 * Isabella the Fairy sits and slides away from us down a wide rainbow ribbon. The ribbon is a strip `hw` units
 * to each side of its own centre line, and `len` units long (s, the distance slid). Everything on it is placed in
 * RIBBON coordinates: s along it, x across it (0 is the middle). How the ribbon winds through the sky, and the
 * loop-the-loops, are pictures (art.js draws them from centreAt() and the loops list); the rules never need them,
 * so a bend never pushes her anywhere and steering is always "left" and "right" of the ribbon.
 *
 * She always slides forward at the course's speed; steering moves her across. Every course is built from a seed
 * along a wandering "lane": a line down the ribbon that is always clear. Clouds sit beside the lane, coins sit on
 * it, so the coins show the safe way through. Things that move (a grumpy cloud drifting in from the rim) are pure
 * functions of the course's time t, never cross the lane, and so the verifier can ask "what is at (t, s, x)?".
 *
 * Soft everywhere: a cloud is a "poof" (a wobble, a moment slower, maybe one coin spilled), and she slides on.
 * Easy has invisible rails at the rim; Medium bumps her back from it; Hard lets her slip off, and a little cloud
 * floats her down to the last rainbow arch with her coins. Stars count coins, never time. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

  // ---------- the numbers ----------
  const VU_MAX = 440;       // sideways speed at full steer
  const STEER_K = 9;        // how briskly her sideways speed follows the steering (1/s)
  const BODY = [[14, 20], [-36, 13]];   // her body on the ribbon: [ahead of her middle, radius] (head and shoulders, hips)
  const BODY_R = 20;        // and how wide she is
  const EDGE = 14;          // her middle may go to hw - EDGE (rails on Easy, a bump back on Medium)
  const SLIP_OVER = 10;     // Hard: her middle beyond hw + this is off the ribbon
  const INV = 1.3;          // seconds after a poof when nothing else can poof her
  const POOF_V = 0.5;       // a poof drops her to this share of the course's speed
  const POOF_EASE = 0.7;    // and she picks up again with this time constant (seconds)
  const START_V = 0.5;      // she sets off at this share of the speed, and picks up
  const R_COIN = 46, R_MAG = 100, R_KEY = 66;
  const CHEST_AFTER = 560, STOP_BEFORE = 130;
  const BUCKET = 200;
  const LOOP_LEN = 840;     // the ribbon's length round one loop-the-loop (a circle of radius LOOP_LEN / 2π)
  const LOOP_MARGIN = 550;  // nothing but coins this far each side of a loop
  const ARCH_SECS = 15;     // a rainbow arch (a checkpoint) about every 15 seconds at Medium speed
  const RESCUE_T = 1.9;     // the little cloud takes this long
  const KEY_DELAY = 1.5;    // no key: it floats down to her after this long, and the chest opens
  const NEAR_OPEN = 0.2;    // with the key: the chest bursts open this soon

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- three modes ----------
  const MODE_IDS = ['easy', 'medium', 'hard'];
  const MODES = {
    easy:   { id: 'easy',   idx: 0, speed: 0.8,  width: 1.22, clouds: 0.6, clear: 1.25, gap: 1.35, edge: 'rail', spill: false },
    medium: { id: 'medium', idx: 1, speed: 1,    width: 1,    clouds: 1,   clear: 1,    gap: 1,    edge: 'rim',  spill: true },
    hard:   { id: 'hard',   idx: 2, speed: 1.25, width: 0.84, clouds: 1.4, clear: 0.85, gap: 0.75, edge: 'slip', spill: true },
  };

  // ---------- twenty courses ----------
  // What is new, and where it first appears. Each new thing is the first thing met on its course.
  const NEW = { 1: 'cloud', 2: 'pair', 3: 'wall', 4: 'slalom', 5: 'bend', 6: 'loop', 9: 'grumpy', 13: 'drift', 15: 'narrow', 16: 'drift2', 17: 'loops' };
  const PATTERN_NEW = { 1: 'cloud', 2: 'pair', 3: 'wall', 4: 'slalom', 5: 'bend', 13: 'drift', 16: 'drift2' };
  const LOOPS = [0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2];
  const THEME = [0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 7];
  // Seeds picked by test/games/slide/tune.js so that the difficulty climbs from each course to the next, in every mode.
  const SEEDS = {
    easy:  [2, 9, 3, 14, 2, 11, 16, 8, 4, 2, 1, 2, 36, 15, 2, 11, 9, 1, 2, 18],
    medium: [33, 2, 15, 10, 12, 12, 17, 7, 4, 12, 4, 21, 5, 38, 14, 5, 38, 34, 2, 31],
    hard:  [20, 30, 16, 9, 1, 12, 1, 32, 13, 26, 25, 4, 33, 2, 37, 3, 23, 5, 10, 16],
  };
  const COURSES = [];
  for (let n = 1; n <= 20; n++) {
    const w2 = n > 10, t = w2 ? (n - 11) / 9 : (n - 1) / 9;
    const secs = w2 ? lerp(70, 95, t) : lerp(50, 75, t);
    const speed = Math.round(lerp(250, 330, (n - 1) / 19));
    const kinds = ['coins'];
    for (let k = 1; k <= n; k++) if (PATTERN_NEW[k]) kinds.push(PATTERN_NEW[k]);
    if (n <= 6) kinds.push('trail');
    COURSES.push({
      n, world: w2 ? 2 : 1, theme: THEME[n - 1],
      secs: +secs.toFixed(2), speed,                                           // at Medium
      len: Math.round((secs * speed) / 10) * 10,                                // the finish line
      half: Math.round(n <= 14 ? lerp(290, 262, (n - 1) / 13) : lerp(245, 205, (n - 15) / 5)),   // half the ribbon's width, at Medium
      gap: w2 ? [Math.round(lerp(130, 60, t)), Math.round(lerp(280, 170, t))] : [Math.round(lerp(260, 140, t)), Math.round(lerp(480, 300, t))],
      clear: Math.round(w2 ? lerp(80, 55, t) : lerp(125, 85, t)),             // room between her side and a cloud beside the lane
      wander: +(w2 ? lerp(0.22, 0.32, t) : lerp(0.10, 0.22, t)).toFixed(3),   // how far the lane may move sideways per unit forward
      two: +(w2 ? lerp(0.36, 0.6, t) : lerp(0, 0.3, t)).toFixed(3),            // chance that a lone cloud gets a partner on the other side
      extras: n === 1 ? 0 : +(w2 ? lerp(0.5, 0.9, t) : lerp(0.15, 0.5, t)).toFixed(3),   // chance of a cloud floating well away from the lane
      tempo: +(n < 13 ? 1 : lerp(0.85, 1.15, (n - 13) / 7)).toFixed(3),       // how fast the drifting clouds drift
      slope: +(w2 ? lerp(0.45, 0.7, t) : lerp(0.2, 0.4, t)).toFixed(3),     // how steeply the ribbon winds
      lam: Math.round(w2 ? lerp(3800, 2700, t) : lerp(5400, 4300, t)),         // and how long each bend is
      loops: LOOPS[n - 1],
      feature: NEW[n] || null, kinds,
    });
  }

  // ---------- clouds ----------
  // (r: depth along the ribbon, hx: how far the body reaches either side beyond r) — the footprint is a little smaller than the picture
  const CLOUD = [{ r: 24, hx: 28 }, { r: 28, hx: 44 }, { r: 34, hx: 62 }];
  const obsX = (o, t) => (o.amp ? o.x + o.amp * Math.sin(o.om * t + o.ph) : o.x);
  const halfWidth = (o) => o.r + (o.hx || 0);

  // Does a circle of her body (at bs, bx, radius br) touch cloud o at time t?
  function touches(o, t, bs, bx, br) {
    const ds = bs - o.s;
    let dx = bx - obsX(o, t);
    if (dx < 0) dx = -dx;
    dx -= o.hx || 0;
    if (dx < 0) dx = 0;
    const rr = o.r + br;
    return dx * dx + ds * ds < rr * rr;
  }
  // What she would poof at time t with her middle at (s, x); `inflate` pads her body (for the verifier).
  function hitTest(lev, t, s, x, inflate) {
    const near = lev.buckets[Math.floor(s / BUCKET)];
    if (!near) return null;
    const pad = inflate || 0;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (touches(o, t, s + BODY[0][0], x, BODY[0][1] + pad) || touches(o, t, s + BODY[1][0], x, BODY[1][1] + pad)) return o;
    }
    return null;
  }
  // the clear lane's x at distance s (straight lines between its pins)
  function laneAt(lev, s) {
    const p = lev.pins;
    if (s <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (s <= p[i][0]) { const a = p[i - 1], b = p[i]; return b[0] === a[0] ? b[1] : lerp(a[1], b[1], (s - a[0]) / (b[0] - a[0])); }
    return p[p.length - 1][1];
  }

  // ---------- how the ribbon winds (pictures only) ----------
  // The centre line's sideways position in the sky at distance s: two slow sine bends, calm at the start, at the
  // end and through the loops (which also carry it a little sideways, so a loop's two ends do not lie on top of
  // each other).
  function centreAt(lev, s) {
    const cv = lev.curve;
    let amp = smooth(s / 1800) * (1 - smooth((s - (lev.len - 1500)) / 1300));
    let shift = 0;
    for (const lp of lev.loops) {
      const bump = smooth((s - (lp.a - 1100)) / 900) * (1 - smooth((s - (lp.b + 200)) / 900));
      amp *= 1 - bump;
      shift += lp.dir * 220 * smooth((s - lp.a) / (lp.b - lp.a));
    }
    return amp * (cv.A1 * Math.sin((TAU * s) / cv.l1 + cv.p1) + cv.A2 * Math.sin((TAU * s) / cv.l2 + cv.p2)) + shift;
  }
  // which loop she is in at s (index, and 0..1 round it), or -1
  function loopAt(lev, s) {
    for (let i = 0; i < lev.loops.length; i++) { const lp = lev.loops[i]; if (s >= lp.a && s < lp.b) return i; }
    return -1;
  }

  // ---------- building a course ----------
  function build(n, modeId, seedOverride) {
    const C = COURSES[n - 1], M = MODES[modeId];
    if (!C) throw new Error('no course ' + n);
    if (!M) throw new Error('no mode ' + modeId);
    const seed = seedOverride != null ? seedOverride : SEEDS[modeId][n - 1];
    const R = mulberry32((0x9E3779B1 ^ Math.imul(seed + n * 7919 + M.idx * 104729, 2654435761)) >>> 0);
    const Rk = mulberry32((0x85EBCA6B ^ Math.imul(n * 40503 + 77, 2246822519)) >>> 0);   // the shape of the ribbon: the same in every mode
    const rnd = (a, b) => a + (b - a) * R();
    const len = C.len, hw = Math.round(C.half * M.width), HALF = hw + 30, LANE = Math.round(hw * 0.5);
    const speed = C.speed * M.speed, clearK = C.clear * M.clear;
    const gapA = Math.round(C.gap[0] * M.gap), gapB = Math.round(C.gap[1] * M.gap);
    const two = Math.min(0.85, C.two * (0.5 + 0.5 * M.clouds)), extras = Math.min(0.95, C.extras * M.clouds);

    // the shape of the ribbon, the loops, the arches and the key (the same for every mode)
    const round10 = (v) => Math.round(v / 10) * 10;
    const curve = { A1: (C.slope * C.lam) / TAU, l1: C.lam * (0.9 + 0.2 * Rk()), p1: Rk() * TAU, A2: 0, l2: C.lam * 0.43 * (0.9 + 0.2 * Rk()), p2: Rk() * TAU };
    curve.A2 = 0.14 * curve.A1;
    const loops = [];
    if (C.loops === 1) { const a = round10(len * (0.38 + 0.14 * Rk())); loops.push({ a, b: a + LOOP_LEN, dir: Rk() < 0.5 ? -1 : 1 }); }
    else if (C.loops === 2) {
      const a1 = round10(len * (0.25 + 0.05 * Rk())), a2 = round10(len * (0.58 + 0.06 * Rk()));
      loops.push({ a: a1, b: a1 + LOOP_LEN, dir: Rk() < 0.5 ? -1 : 1 }, { a: a2, b: a2 + LOOP_LEN, dir: Rk() < 0.5 ? -1 : 1 });
    }
    const inLoopZone = (p, pad) => loops.find((lp) => p > lp.a - LOOP_MARGIN - pad && p < lp.b + LOOP_MARGIN + pad);
    let keyS = round10(len * (0.58 + 0.17 * Rk()));
    for (let g = 0; g < 4; g++) { const z = inLoopZone(keyS, 300); if (z) keyS = round10(z.b + LOOP_MARGIN + 300); }
    const arches = [], ARCH = round10(ARCH_SECS * C.speed);
    for (let k = 1; k * ARCH < len - 1900; k++) {
      let p = k * ARCH;
      for (let g = 0; g < 4; g++) {
        const z = inLoopZone(p, 380); if (z) p = z.b + LOOP_MARGIN + 380;
        if (Math.abs(p - keyS) < 700) p = keyS + 700;
      }
      if (p < len - 1900 && (!arches.length || p - arches[arches.length - 1] > 0.75 * ARCH)) arches.push(p);
    }
    // zones the generator keeps clear of clouds: [a, b], and what happens at the start of one
    const zones = [];
    for (const lp of loops) zones.push({ a: lp.a - LOOP_MARGIN, b: lp.b + LOOP_MARGIN, type: 'loop', lp });
    zones.push({ a: keyS - 320, b: keyS + 320, type: 'key' });
    for (const p of arches) zones.push({ a: p - 380, b: p + 380, type: 'arch' });
    zones.sort((a, b) => a.a - b.a);

    const obs = [], coins = [], pins = [[0, 0]], patterns = {};
    let lane = 0, laneS = 0;
    const pin = (s, x) => { lane = x; laneS = s; pins.push([s, x]); };
    // move the lane to a new spot for something whose tight place is at s (dir: -1 or 1 to force a way)
    const shift = (s, dir) => {
      const max = Math.min(C.wander * (s - laneS), 230);
      let d = (dir || (R() < 0.5 ? -1 : 1)) * rnd(0.35, 1) * max;
      if (Math.abs(lane + d) > LANE) d = -d;
      pin(s, clamp(lane + d, -LANE, LANE));
      return lane;
    };
    const hold = (s) => pin(s, lane);
    // coins are placed by their offset from the lane, and get their x once the whole lane is known
    const coin = (s, off, b) => coins.push({ s, off: off || 0, b: b || 0 });
    const line = (s0, s1, k, off) => { for (let i = 0; i < k; i++) coin(k === 1 ? (s0 + s1) / 2 : lerp(s0, s1, i / (k - 1)), off); };
    const setSize = (o, v) => { o.v = v; o.r = CLOUD[v].r; o.hx = CLOUD[v].hx; return o; };
    const grumpyChance = C.n >= 9 ? 0.3 : 0;
    // a cloud: sizes by course (small ones early), sometimes with a cross face from course 9
    const cloud = (vmax) => {
      const cap = vmax != null ? vmax : C.n < 5 ? 1 : C.n < 8 ? 2 : 3;
      const v = Math.min(cap - 1, Math.floor(R() * cap)), g = R() < grumpyChance ? 1 : 0;
      const o = setSize({ k: 'cloud', r: 0, hx: 0, v: 0 }, Math.max(0, v));
      if (g) o.g = 1;
      return o;
    };
    const put = (o, s, x) => { o.s = s; o.x = x; obs.push(o); return o; };
    // put o beside the lane (which is at its tight place, s): its near edge `room` clear of her side
    function beside(o, s, mult, side) {
      let off = 0, sd = side || (R() < 0.5 ? -1 : 1);
      const k = rnd(1, mult || 1.5);
      for (;;) {
        off = halfWidth(o) + BODY_R + clearK * k;
        if (Math.abs(lane + sd * off) <= HALF) break;
        if (Math.abs(lane - sd * off) <= HALF) { sd = -sd; break; }
        if (o.v === 0) break;
        setSize(o, o.v - 1);
      }
      put(o, s, lane + sd * off);
      return sd;
    }
    // sometimes (more on later courses) a second cloud on her other side, making a gateway
    function partner(s, sd) {
      if (R() >= two) return false;
      const o = cloud(2);
      const x = lane - sd * (halfWidth(o) + BODY_R + clearK * rnd(1.05, 1.6));
      if (Math.abs(x) > HALF) return false;
      put(o, s, x);
      return true;
    }
    // five coins past something beside the lane, curving a little away from it
    const arc = (s, sd, bulge) => { for (let i = -2; i <= 2; i++) coin(s + i * 90, -sd * bulge * (1 - (i * i) / 4)); };
    // a drifting cloud: slides in from one rim toward the middle and back, never reaching the lane
    function drifter(s, side, mv) {
      const o = cloud(2); o.g = 1;
      const room = halfWidth(o) + BODY_R + clearK * rnd(0.8, 1.2);   // from the lane to the cloud's middle at its nearest
      let sd = side || (R() < 0.5 ? -1 : 1), amp = rnd(95, 150);
      const fits = (d) => { let a = amp; while (a > 55 && Math.abs(lane + d * (room + a)) + a > HALF + 70) a -= 10; return a; };
      if (Math.abs(lane + sd * (room + fits(sd))) + fits(sd) > HALF + 70) sd = -sd;
      amp = fits(sd);
      const x = lane + sd * (room + amp);
      const vpk = rnd(52, 82) * C.tempo;
      o.amp = Math.round(amp); o.om = +(vpk / amp).toFixed(4); o.ph = +rnd(0, TAU).toFixed(3); o.mv = mv || 1;
      put(o, s, Math.round(x));
      return sd;
    }

    const P = {
      cloud(s0) {
        const s = s0 + 200; shift(s);
        const sd = beside(cloud(), s, 1.5), p = partner(s, sd);
        arc(s, sd, p ? 0 : 18);
        return 420;
      },
      // two clouds to slide between
      pair(s0) {
        const s = s0 + 180; shift(s);
        const a = cloud(2), b = cloud(2);
        for (const [o, sd] of [[a, -1], [b, 1]]) {
          const k = rnd(1, 1.3);
          while (o.v > 0 && Math.abs(lane + sd * (halfWidth(o) + BODY_R + clearK * k)) > HALF) setSize(o, o.v - 1);
          put(o, s, lane + sd * (halfWidth(o) + BODY_R + clearK * k));
        }
        line(s - 150, s + 150, 4, 0);
        return 380;
      },
      // a row of clouds right across, with one way through
      wall(s0) {
        const s = s0 + 220; shift(s);
        for (const sd of [-1, 1]) {
          for (let j = 0, x = lane + sd * (CLOUD[0].r + CLOUD[0].hx + BODY_R + clearK * rnd(1.1, 1.4)); Math.abs(x) <= HALF - 10; x += sd * 100, j++) {
            const o = setSize({ k: 'cloud', r: 0, hx: 0, v: 0 }, 0);
            if (R() < grumpyChance) o.g = 1;
            put(o, s, x);
          }
        }
        line(s - 220, s + 220, 5, 0);
        return 440;
      },
      // three clouds to weave round
      slalom(s0) {
        let dir = R() < 0.5 ? -1 : 1;
        const sep = 400;
        for (let i = 0; i < 3; i++) {
          const s = s0 + 180 + i * sep;
          shift(s, dir);
          const o = cloud(2);
          const x = lane - dir * (halfWidth(o) + BODY_R + clearK * rnd(0.8, 1.1));
          if (Math.abs(x) > HALF) setSize(o, 0);
          put(o, s, lane - dir * (halfWidth(o) + BODY_R + clearK * rnd(0.8, 1.1)));
          coin(s, 0);
          if (i < 2) coin(s + sep / 2, 0);
          dir = -dir;
        }
        return 180 + 2 * sep + 180;
      },
      // two big clouds, one each side, one after the other: an S-bend
      bend(s0) {
        const sd = R() < 0.5 ? -1 : 1;
        let s = s0 + 200; shift(s);
        const a = setSize({ k: 'cloud', r: 0, hx: 0, v: 0 }, 2);
        beside(a, s, 1.3, sd);
        line(s - 150, s + 150, 4, -sd * 12);
        const s2 = s + 560;
        shift(s2, sd);
        const b = setSize({ k: 'cloud', r: 0, hx: 0, v: 0 }, 2);
        beside(b, s2, 1.3, -sd);
        line(s2 - 280, s2 + 150, 5, sd * 12);
        return 200 + 560 + 200;
      },
      // a grumpy cloud drifting in from the rim
      drift(s0, side) {
        const s = s0 + 240; shift(s);
        drifter(s, side, 1);
        line(s - 180, s + 180, 4, 0);
        return 480;
      },
      // two of them, one from each side, one after the other
      drift2(s0) {
        const sd = R() < 0.5 ? -1 : 1;
        P.drift(s0, sd);
        const s2 = s0 + 240 + 620;
        shift(s2);
        drifter(s2, -sd, 1);
        line(s2 - 180, s2 + 180, 4, 0);
        return 240 + 620 + 240;
      },
      // just coins: a gentle wiggle
      coins(s0) {
        shift(s0); hold(s0 + 640);
        const ph = rnd(0, TAU);
        for (let i = 0; i < 9; i++) coin(s0 + i * 80, 45 * Math.sin(ph + i * 0.7));
        return 640;
      },
      // just coins: a long straight line
      trail(s0) {
        shift(s0); hold(s0 + 1000);
        line(s0, s0 + 990, 10, 0);
        return 1000;
      },
    };
    const NOM = { cloud: 440, pair: 400, wall: 460, slalom: 1100, bend: 1060, drift: 520, drift2: 1150, coins: 660, trail: 1020 };
    const ONCE = new Set(['coins', 'trail', 'wall', 'slalom', 'bend', 'drift2']), OPEN = new Set(['coins', 'trail']);

    line(500, 980, 5, 0);   // a friendly first trail, straight ahead
    hold(1100);
    let s = 1400, last = '', first = true, zi = 0;
    const lev = { n, mode: modeId, seed, cfg: C, speed, len, hw, curve, loops, arches, keyS };
    while (s < len - 1500) {
      while (zi < zones.length && zones[zi].b <= s) zi++;
      const z = zones[zi];
      if (z && z.a <= s + 40) {
        // a zone begins here: the lane holds still through it, and what belongs in it is laid
        if (z.type === 'loop') {
          hold(z.lp.a - 60); hold(z.lp.b + 60);
          for (let i = 0; i < 8; i++) coin(z.lp.a + ((i + 0.5) * LOOP_LEN) / 8, 0, 1);
        } else if (z.type === 'key') {
          shift(keyS - 300); hold(keyS + 300);
          lev.key = { s: keyS, x: 0 };
          line(keyS - 420, keyS - 140, 3, 0); line(keyS + 140, keyS + 420, 3, 0);
        } else { hold(z.b); }
        s = Math.max(s, z.b); zi++;
        continue;
      }
      const kinds = C.kinds.filter((k) => (k !== last || !ONCE.has(k)) && !(OPEN.has(k) && OPEN.has(last)));
      let kind;
      if (first && C.feature && PATTERN_NEW[C.n] === C.feature) kind = C.feature;   // the new thing first, on its own
      else {
        const w = kinds.map((k) => (k === PATTERN_NEW[C.n] ? 3 : k === 'coins' || k === 'trail' ? 0.2 : 1));
        let u = R() * w.reduce((a, b) => a + b, 0);
        kind = kinds[0];
        for (let i = 0; i < kinds.length; i++) { u -= w[i]; if (u <= 0) { kind = kinds[i]; break; } }
      }
      if (z && s + NOM[kind] + 120 > z.a) {
        // no room for it before the zone: a run of coins if there is room for that, otherwise straight to the zone
        if (z.a - s > 760 && last !== 'coins') kind = 'coins'; else { s = z.a; continue; }
      }
      first = false;
      const w = P[kind](s);
      patterns[kind] = (patterns[kind] || 0) + 1;
      last = kind;
      s += w + rnd(gapA, gapB);
    }
    if (!lev.key) { shift(keyS - 300); hold(keyS + 300); lev.key = { s: keyS, x: 0 }; }   // (the generator reached the end first: cannot happen with the table, kept for safety)
    hold(len - 500);
    pin(len, lane);
    line(len - 430, len - 70, 4, 0);   // and a last trail up to the finish line
    Object.assign(lev, { pins, obs, coins, patterns });

    // clouds floating well away from the lane, so the sky is not empty (and wandering off has a price)
    const clearOfZones = (q) => !zones.some((zz) => q > zz.a - 150 && q < zz.b + 150);
    for (let q = 1500 + rnd(0, 300); q < len - 700; q += rnd(300, 600)) {
      if (R() >= extras || !clearOfZones(q)) continue;
      const o = cloud(R() < 0.5 ? 2 : 3);
      const hwid = halfWidth(o), need = hwid + BODY_R + clearK + 45;
      for (let tries = 0; tries < 6; tries++) {
        const x = rnd(-(HALF - 30), HALF - 30);
        let ok = true;
        for (let d = -150; d <= 150 && ok; d += 75) if (Math.abs(x - laneAt(lev, q + d)) < need) ok = false;
        for (let i = 0; i < obs.length && ok; i++) {
          const p = obs[i], reach = halfWidth(p) + (p.amp || 0) + hwid + 60;
          if (Math.abs(p.s - q) < 150 + p.r && Math.abs(p.x - x) < reach) ok = false;
        }
        if (ok) { put(o, Math.round(q), Math.round(x)); o.extra = 1; break; }
      }
    }

    // coins: their place on the lane; none inside a cloud
    const XC = hw - EDGE - 4;
    for (const c of coins) c.x = clamp(laneAt(lev, c.s) + c.off, -XC, XC);
    const blocked = (c) => obs.some((o) => !o.amp && Math.abs(o.s - c.s) < o.r + 30 && Math.abs(o.x - c.x) < halfWidth(o) + 30);
    lev.coins = coins.filter((c) => !blocked(c)).map((c) => ({ s: Math.round(c.s), x: Math.round(c.x), b: c.b }));
    lev.coins.sort((a, b) => a.s - b.s);
    lev.key.x = Math.round(laneAt(lev, keyS));
    for (const o of obs) { o.s = Math.round(o.s); o.x = Math.round(o.x); }
    for (const p of pins) { p[0] = Math.round(p[0]); p[1] = Math.round(p[1]); }
    obs.sort((a, b) => a.s - b.s);
    lev.total = lev.coins.length;
    lev.laneTotal = lev.coins.filter((c) => !c.b).length;   // (the coins in a loop are extra: stars count the others)
    lev.chestS = len + CHEST_AFTER; lev.stopS = len + CHEST_AFTER - STOP_BEFORE;

    // buckets for the hit test (she reaches 56 behind her middle and 34 ahead)
    lev.buckets = [];
    for (const o of obs) for (let b = Math.floor((o.s - o.r - 110) / BUCKET); b <= Math.floor((o.s + o.r + 110) / BUCKET); b++) if (b >= 0) (lev.buckets[b] || (lev.buckets[b] = [])).push(o);
    return lev;
  }

  // Everything that makes a course what it is, as one string (the verifier freezes its hash).
  function describe(lev) {
    const f = (v) => (Math.round(v * 1000) / 1000).toString();
    return [
      lev.mode, lev.len, lev.hw, f(lev.speed),
      [lev.curve.A1, lev.curve.l1, lev.curve.p1, lev.curve.A2, lev.curve.l2, lev.curve.p2].map(f).join(','),
      lev.loops.map((l) => [l.a, l.b, l.dir].join(',')).join(';'),
      lev.arches.join(','), lev.key.s + ',' + lev.key.x,
      lev.obs.map((o) => [o.k, o.s, o.x, o.r, o.hx || 0, o.v || 0, o.g || 0, o.amp || 0, f(o.om || 0), f(o.ph || 0), o.mv || 0].join(',')).join(';'),
      lev.coins.map((c) => [c.s, c.x, c.b].join(',')).join(';'),
      lev.pins.map((p) => p.join(',')).join(';'),
    ].join('|');
  }
  // The level table, as one string (frozen too): what each course is meant to be, in every mode.
  function describeTable() {
    return JSON.stringify([COURSES.map((c) => [c.n, c.world, c.theme, c.secs, c.speed, c.len, c.half, c.gap, c.clear, c.wander, c.two, c.extras, c.tempo, c.slope, c.lam, c.loops, c.feature, c.kinds]),
      MODE_IDS.map((m) => [m, MODES[m].speed, MODES[m].width, MODES[m].clouds, MODES[m].clear, MODES[m].gap, MODES[m].edge, MODES[m].spill]), SEEDS]);
  }

  // Stars are the share of the course's lane coins she finished with: 3 for 80%, 2 for half, 1 for reaching the chest. Never time.
  // The coins inside a loop are extra, so a child who never finds a loop's coins can still earn 3 stars.
  function starsFor(got, total) {
    if (total <= 0) return 3;
    const share = got / total;
    return share >= 0.8 ? 3 : share >= 0.5 ? 2 : 1;
  }

  // ---------- one slide down a course ----------
  class Run {
    constructor(n, modeId, seedOverride) {
      this.n = n; this.modeId = modeId || 'medium'; this.M = MODES[this.modeId];
      this.lev = build(n, this.modeId, seedOverride);
      this.vc = this.lev.speed;
      this.ev = [];
      this.start();
    }
    start() {
      const lv = this.lev;
      this.t = 0; this.st = 0; this.phase = 'play';
      this.s = 0; this.x = 0; this.v = this.vc * START_V; this.vx = 0; this.kx = 0; this.z = 0;
      this.inv = 0; this.rt = 0;
      this.bumps = 0; this.spilled = 0; this.rails = 0; this.rims = 0; this.slips = 0; this.restores = 0;
      this.coinCount = 0; this.laneCount = 0; this.bonusCount = 0; this.picked = 0;
      this.got = new Uint8Array(lv.coins.length);
      this.cs = Float32Array.from(lv.coins, (c) => c.s);
      this.cx = Float32Array.from(lv.coins, (c) => c.x);
      this.ci = 0; this.ai = 0; this.cpS = 0; this.cpN = 0; this.loop = -1; this.loops = 0;
      this.hasKey = false; this.hadKey = false; this.opened = false; this.onEdge = false; this.moved = false;
      this.stars = 0;
      this.ev.length = 0;
    }
    emit(type, o) { this.ev.push({ type, s: this.s, x: this.x, o: o || null }); }
    // jump along the course (for the tests: to reach an arch, a loop or the finish without the slide)
    warpTo(s, x) {
      const lv = this.lev;
      this.s = s; if (x != null) this.x = x;
      this.ci = 0; while (this.ci < lv.coins.length && lv.coins[this.ci].s < s - 160) this.ci++;
      this.ai = 0; this.cpS = 0; this.cpN = 0;
      while (this.ai < lv.arches.length && lv.arches[this.ai] <= s) { this.cpS = lv.arches[this.ai]; this.cpN = ++this.ai; }
      this.loop = loopAt(lv, s);
    }
    get progress() { return clamp(this.s / this.lev.len, 0, 1); }
    // how far round her loop she is (0..1), or -1
    get loopP() { if (this.loop < 0) return -1; const lp = this.lev.loops[this.loop]; return (this.s - lp.a) / (lp.b - lp.a); }

    // steer: -1 (hard left) .. 1 (hard right)
    step(dt, steer) {
      this.st += dt;
      const sv = clamp(+steer || 0, -1, 1);
      if (this.phase === 'play') this.stepPlay(dt, sv);
      else if (this.phase === 'rescue') this.stepRescue(dt);
      else if (this.phase === 'finish') this.stepFinish(dt);
      else if (this.phase === 'done') this.stepDone(dt);
    }

    stepPlay(dt, steer) {
      const lv = this.lev, hw = lv.hw;
      this.t += dt;

      // forward: she sets off gently, and after a poof picks up again; she never stops
      this.v += (this.vc - this.v) * (1 - Math.exp(-dt / POOF_EASE));
      if (this.v > this.vc) this.v = this.vc;

      // across the ribbon
      this.vx += (steer * VU_MAX - this.vx) * (1 - Math.exp(-dt * STEER_K));
      this.x += (this.vx + this.kx) * dt;
      this.kx *= Math.exp(-dt * 5);
      this.s += this.v * dt;

      // the rim of the ribbon: rails on Easy, a bump back on Medium, a slip on Hard
      const rim = hw - EDGE, M = this.M;
      if (M.edge === 'rail') {
        if (Math.abs(this.x) > rim) {
          this.x = this.x > 0 ? rim : -rim;
          if (this.vx * this.x > 0) this.vx = 0;
          if (!this.onEdge) { this.onEdge = true; this.rails++; this.emit('rail'); }
        } else this.onEdge = false;
      } else if (M.edge === 'rim') {
        if (Math.abs(this.x) > rim) {
          const side = this.x > 0 ? 1 : -1;
          this.x = side * (rim - 8); this.vx = 0; this.kx = -side * 260;
          this.rims++; this.emit('rim');
        }
      } else if (Math.abs(this.x) > hw + SLIP_OVER) {
        if (this.inv > 0) {
          // (a poof, or the moment of grace after coming back, never makes her fall: it is only a bump back from the rim)
          const side = this.x > 0 ? 1 : -1;
          this.x = side * (rim - 8); this.vx = 0; this.kx = -side * 260;
          this.rims++; this.emit('rim');
        } else {
          this.slips++; this.phase = 'rescue'; this.rt = 0; this.vx = 0; this.kx = 0; this.emit('slip');
          return;
        }
      }

      // loops
      const lp = loopAt(lv, this.s);
      if (lp !== this.loop) {
        if (this.loop >= 0) this.emit('loopEnd', this.loop);
        if (lp >= 0) { this.loops++; this.emit('loop', lp); }
        this.loop = lp;
      }
      // rainbow arches: the last one she passed is where a slip brings her back to
      while (this.ai < lv.arches.length && lv.arches[this.ai] <= this.s) { this.cpS = lv.arches[this.ai]; this.cpN = ++this.ai; this.emit('arch', this.cpS); }

      // a cloud: a poof and a wobble, slower for a moment, perhaps one coin spilled. Then she carries on.
      if (this.inv > 0) this.inv -= dt;
      else {
        const o = hitTest(lv, this.t, this.s, this.x, 0);
        if (o) {
          this.bumps++; this.inv = INV;
          this.v = Math.min(this.v, this.vc * POOF_V);
          const away = this.x >= obsX(o, this.t) ? 1 : -1;
          this.kx = away * 300;
          this.emit('poof', o);
          if (M.spill && this.laneCount > 0) { this.laneCount--; this.coinCount--; this.spilled++; this.emit('spill'); }
        }
      }

      // coins (with a gentle magnet), and the key
      const cs = this.cs, cx = this.cx, got = this.got, N = cs.length;
      while (this.ci < N && lv.coins[this.ci].s < this.s - 160) this.ci++;
      for (let i = this.ci; i < N && lv.coins[i].s < this.s + 160; i++) {
        if (got[i]) continue;
        const ds = this.s - cs[i], dx = this.x - cx[i], d = Math.hypot(ds, dx);
        if (d < R_COIN) this.take(i);
        else if (d < R_MAG) { const m = (380 * dt) / d; cs[i] += ds * m; cx[i] += dx * m; }
      }
      if (!this.hasKey) {
        const k = lv.key, ds = this.s - k.s, dx = this.x - k.x;
        if (ds > -R_KEY * 1.4 && ds < R_KEY * 1.4 && Math.hypot(ds, dx) < R_KEY) { this.hasKey = true; this.emit('key'); }
      }

      if (this.s >= lv.len) {
        this.phase = 'finish'; this.st = 0; this.loop = -1;
        this.stars = starsFor(this.laneCount, lv.laneTotal);
        this.emit('finish');
      }
    }
    take(i) {
      const c = this.lev.coins[i];
      this.got[i] = 1; this.coinCount++; this.picked++;
      if (c.b) this.bonusCount++; else this.laneCount++;
      this.ev.push({ type: 'coin', s: this.cs[i], x: this.cx[i], o: c });
    }

    // Hard, off the rim: down on a little cloud, then back up at the last arch (or the start). Coins kept.
    stepRescue(dt) {
      const lv = this.lev;
      this.t += dt; this.rt += dt;
      const half = RESCUE_T / 2;
      if (this.rt < half) this.z = -150 * smooth(this.rt / half);
      else {
        if (!this.moved) {
          this.moved = true;
          this.s = this.cpS; this.x = laneAt(lv, this.s); this.vx = 0; this.kx = 0;
          this.v = this.vc * START_V; this.loop = -1;
          // (the coins ahead of the arch are in their places again, those already taken stay taken)
          this.ci = 0; while (this.ci < lv.coins.length && lv.coins[this.ci].s < this.s - 160) this.ci++;
          this.emit('restore', { s: this.s });
        }
        this.z = -150 * (1 - smooth((this.rt - half) / half));
      }
      if (this.rt >= RESCUE_T) { this.phase = 'play'; this.z = 0; this.moved = false; this.inv = 1.6; this.restores++; this.emit('back'); }
    }

    // past the line: she glides to the middle and up to the treasure chest by herself
    stepFinish(dt) {
      const lv = this.lev;
      this.t += dt;
      this.x += (0 - this.x) * (1 - Math.exp(-dt * 2.2));
      this.vx *= Math.exp(-dt * 6);
      const rem = lv.stopS - this.s, want = clamp(rem * 2.5, 40, this.vc * 1.1);
      this.v += (Math.min(this.v, want) - this.v) * (1 - Math.exp(-dt * 6));
      if (this.v > want) this.v = Math.max(want, this.v - 500 * dt);
      this.s += this.v * dt;
      if (this.s >= lv.stopS - 2) { this.s = lv.stopS; this.v = 0; this.phase = 'done'; this.st = 0; this.hadKey = this.hasKey; this.emit('chest', { hasKey: this.hasKey }); }
    }
    // at the chest: with the key it bursts open at once; without, the key floats down to her and it opens anyway
    stepDone(dt) {
      this.t += dt;
      if (!this.opened && this.st >= (this.hasKey ? NEAR_OPEN : KEY_DELAY)) {
        this.opened = true;
        if (!this.hasKey) { this.hasKey = true; this.emit('keyfloat'); }
        this.emit('open', { withKey: this.hadKey });
      }
    }
  }

  // ---------- steering by leaning the phone ----------
  // (the same model as Splash Dash's: see web/games/dash/logic.js and test/games/slide/phone.js)
  // The sensors give the direction of "up" in the phone's own axes (x toward the right edge of the phone
  // held upright, y toward its top edge, z out of the screen): on Android, flat on a table with the screen
  // up reads (0, 0, +9.8). The screen may be turned either way round (screen.orientation.angle is 90 or
  // 270 in landscape), so first turn the vector into the SCREEN's axes. Then the lean is how far the
  // screen's right-pointing axis dips below level: 0 held level, positive with the right side down (steer
  // right), whether the phone is upright like a steering wheel or lying nearly flat in a lap.
  // What to expect: LEFT side of the screen down steers LEFT, right side down steers right, like a steering wheel.
  // Should a real phone ever steer the wrong way, TILT.SIGN is the one constant to flip.
  const TILT = {
    SIGN: 1,           // 1: left side down steers left. -1 mirrors the steering.
    DEAD: 2.5,         // degrees of lean that still mean "straight"
    FULL: 20,          // degrees of lean for full steer
    TAU: 0.12,         // low-pass time constant, seconds
    MIN_G: 3,          // ignore a sample shorter than this (m/s^2): free fall or nonsense
    MIN_SAMPLES: 6,    // tilt takes over only after this many real samples...
    MIN_CHANGES: 3,    // ...of which this many differed from the one before (a real sensor is never still)
    STALE_MS: 700,     // and stops steering when the samples stop
    WILD: 55,          // a lean beyond this many degrees for more than WILD_S seconds is not steering: it is a child
    WILD_S: 1.2,       // lying on her side, or the phone propped on its edge. Tilt then lets go until it is held level again.
  };
  const normAngle = (a) => { a = Math.round((Number(a) || 0) / 90) * 90; return ((a % 360) + 360) % 360; };
  // the device-axes vector in the screen's axes (x right, y up, z out), for the screen turned `angle` degrees
  function toScreen(ax, ay, az, angle, out) {
    out = out || [0, 0, 0];
    const a = normAngle(angle);
    if (a === 90) { out[0] = -ay; out[1] = ax; }
    else if (a === 180) { out[0] = -ax; out[1] = -ay; }
    else if (a === 270) { out[0] = ay; out[1] = -ax; }
    else { out[0] = ax; out[1] = ay; }
    out[2] = az;
    return out;
  }
  // Which way round is the screen? Normally just what the browser reports. But if the picture is landscape and
  // the report says "not turned" (0 or 180), that is either a tablet (whose natural way up IS landscape: "up"
  // lies along its y axis) or a report that cannot be trusted; "up" lying along the x axis settles it. `guess`
  // is the last answer worked out that way, kept for when the phone is lying too flat to tell.
  function screenAngleFor(reported, landscape, ax, ay, guess) {
    const a = normAngle(reported);
    if (!landscape || a === 90 || a === 270) return a;
    if (Math.abs(ax) > 6 && Math.abs(ay) < 4) return ax > 0 ? 90 : 270;
    return guess === 90 || guess === 270 ? guess : a;
  }
  const _v = [0, 0, 0];
  // degrees of lean, positive = right side of the screen down. NaN if the vector is no use.
  function leanDeg(ax, ay, az, angle) {
    toScreen(ax, ay, az, angle, _v);
    const g = Math.hypot(_v[0], _v[1], _v[2]);
    if (!(g > TILT.MIN_G)) return NaN;
    return TILT.SIGN * (Math.asin(clamp(-_v[0] / g, -1, 1)) * 180) / Math.PI;
  }
  // lean in degrees -> steer in -1..1: a dead zone, then straight-line up to full steer
  function steerFromLean(deg) {
    const a = Math.abs(deg);
    if (!(a > TILT.DEAD)) return 0;
    return Math.sign(deg) * Math.min(1, (a - TILT.DEAD) / (TILT.FULL - TILT.DEAD));
  }
  // deviceorientation's beta and gamma (degrees) as the same "up" vector, in m/s^2
  function gravityFromOrientation(beta, gamma, out) {
    out = out || [0, 0, 0];
    const b = (beta * Math.PI) / 180, g = (gamma * Math.PI) / 180;
    out[0] = -Math.cos(b) * Math.sin(g) * 9.81; out[1] = Math.sin(b) * 9.81; out[2] = Math.cos(b) * Math.cos(g) * 9.81;
    return out;
  }
  // The filter: feed it every sensor sample; read .value (the steer) while .live(now).
  class Tilt {
    constructor() { this.reset(); }
    reset() {
      this.samples = 0; this.changes = 0; this.value = 0; this.lean = 0; this.raw = 0; this.lastT = -1e9; this.wild = 0; this.off = false;
      this.ax = 0; this.ay = 0; this.az = 0; this.angle = 0; this.src = '';
    }
    push(ax, ay, az, angle, tMs, src) {
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)) return false;
      const lean = leanDeg(ax, ay, az, angle);
      if (Number.isNaN(lean)) return false;
      if (this.samples > 0 && (Math.abs(ax - this.ax) > 1e-4 || Math.abs(ay - this.ay) > 1e-4 || Math.abs(az - this.az) > 1e-4)) this.changes++;
      const dt = this.samples > 0 ? clamp((tMs - this.lastT) / 1000, 0, 0.25) : 1e9;
      // on its side for a while: let go (and take hold again once it has been nearer level for half a second or so)
      const dw = this.samples > 0 ? dt : 0;
      if (Math.abs(lean) > TILT.WILD) this.wild = Math.min(TILT.WILD_S, this.wild + dw);
      else if (Math.abs(lean) < TILT.WILD - 15) this.wild = Math.max(0, this.wild - 2 * dw);
      if (this.wild >= TILT.WILD_S) this.off = true; else if (this.wild <= 0) this.off = false;
      this.raw = this.off ? 0 : steerFromLean(lean);
      this.value += (this.raw - this.value) * (1 - Math.exp(-dt / TILT.TAU));
      this.lean = lean;
      this.ax = ax; this.ay = ay; this.az = az; this.angle = normAngle(angle); this.src = src || '';
      this.lastT = tMs; this.samples++;
      return true;
    }
    live(nowMs) { return !this.off && this.samples >= TILT.MIN_SAMPLES && this.changes >= TILT.MIN_CHANGES && nowMs - this.lastT < TILT.STALE_MS; }
  }

  const api = {
    VU_MAX, STEER_K, BODY, BODY_R, EDGE, SLIP_OVER, INV, POOF_V, START_V, R_COIN, R_MAG, R_KEY, CHEST_AFTER, STOP_BEFORE, BUCKET,
    LOOP_LEN, LOOP_MARGIN, ARCH_SECS, RESCUE_T, KEY_DELAY, NEAR_OPEN, TAU,
    MODE_IDS, MODES, NEW, PATTERN_NEW, COURSES, NLEV: COURSES.length, SEEDS, CLOUD,
    mulberry32, clamp, lerp, smooth, build, describe, describeTable, obsX, halfWidth, touches, hitTest, laneAt, centreAt, loopAt, starsFor, Run,
    TILT, normAngle, screenAngleFor, toScreen, leanDeg, steerFromLean, gravityFromOrientation, Tilt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlideLogic = api;
})(typeof self !== 'undefined' ? self : this);
