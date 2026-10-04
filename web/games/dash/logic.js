/* Splash Dash — the rules. Pure logic, no DOM: test/games/dash/verify.js runs this same file in Node.
 *
 * Isabella swims along the top of the sea, away from us. The course is a strip of water 800 units wide
 * (x from -HALF to +HALF) and `len` units long (s, the distance swum). She always swims forward: slowly on
 * her own, faster and faster while the speed button is held, easing back when it is let go. Leaning the
 * phone (or a finger) steers her left and right.
 *
 * Every course is built from a seed along a wandering "lane": a line down the course that is always clear.
 * Obstacles sit beside the lane, coins sit on it, so the coins show the safe way through. Things that move
 * (drifting boats, the gap in a wave) are pure functions of the course's time t, so the verifier can ask
 * "what is at (t, s, x)?" for any moment without playing the course.
 *
 * A bump is gentle: a splash, a wobble, she drops to slow speed and may spill one coin. Nothing ends a
 * course but the finish line, and the stars count coins, never time. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;

  // ---------- the numbers ----------
  const HALF = 400;        // the float lines along both sides of the course
  const XMAX = 350;        // as far as her middle goes
  const LANE = 270;        // as far as the clear lane wanders
  const V_SLOW = 240;      // she swims this fast on her own (units a second)
  const V_MAX = 480;       // the fastest the speed button takes her
  const RAMP_UP = 2.4;     // seconds from slow to fastest with the button held
  const EASE_DOWN = 0.7;   // letting go: the extra speed fades with this time constant (seconds)
  const V_KELP = 150;      // kelp slows her to this
  const KELP_EASE = 0.2;
  const V_BUMP = 170;      // a bump drops her to this (then she picks up to slow again); she never stops
  const VX_MAX = 420;      // sideways speed at full steer
  const STEER_K = 9;       // how briskly her sideways speed follows the steering (1/s)
  const V_LEAP = 380;      // a wave ramp taken at least this fast throws her into the air
  const AIR_T = 0.95;      // seconds in the air
  const AIR_H = 110;       // how high
  const INV = 1.3;         // seconds after a bump when nothing else can bump her
  const R_COIN = 46;       // she collects a coin this close
  const R_MAG = 100;       // and coins drift toward her from this far
  const R_AIR = 66;        // coins in the air, while she is in the air
  const BODY = [[14, 20], [-40, 13]];   // her body on the water: [ahead of her middle, radius] (head and shoulders, hips)
  const BODY_R = 20;
  const CHEST_AFTER = 620; // the treasure chest floats this far past the finish line
  const STOP_BEFORE = 150; // and she stops this far short of it
  const BUCKET = 200;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- twenty courses ----------
  // What is new, and where it first appears. Each new thing is the first thing met on its course.
  const NEW = { 1: 'rock', 2: 'ramp', 3: 'kelp', 4: 'gate', 5: 'log', 6: 'buoys', 7: 'boat', 9: 'gull', 11: 'drift', 13: 'slalom', 14: 'wave', 16: 'logs', 17: 'cross' };
  // Seeds picked by test/games/dash/tune.js so that the difficulty climbs from each course to the next.
  const SEEDS = [5, 12, 6, 4, 15, 1, 3, 15, 20, 10, 7, 9, 20, 18, 8, 8, 5, 12, 5, 4];
  const COURSES = [];
  for (let n = 1; n <= 20; n++) {
    const u = (n - 1) / 19;
    const kinds = ['coins'];
    for (let k = 1; k <= n; k++) if (NEW[k]) kinds.push(NEW[k]);
    if (n <= 6) kinds.push('trail');
    COURSES.push({
      n, seed: SEEDS[n - 1], theme: Math.floor((n - 1) / 4),
      len: 17500 + 200 * (n - 1),                                   // the finish line
      gap: [Math.round(lerp(220, 40, u)), Math.round(lerp(420, 160, u))],    // clear water between one thing and the next
      clear: Math.round(lerp(115, 55, u)),                          // room between her side and whatever is beside the lane
      wander: +lerp(0.10, 0.30, u).toFixed(3),                      // how far the lane may move sideways per unit forward
      two: +lerp(0, 0.5, u).toFixed(3),                             // chance that a lone obstacle gets a partner on the other side
      extras: n === 1 ? 0 : +lerp(0.15, 0.85, u).toFixed(3),        // chance of something floating well away from the lane
      tempo: +(n < 11 ? 1 : lerp(0.85, 1.2, (n - 11) / 9)).toFixed(3),   // how fast the moving things move
      feature: NEW[n] || null, kinds,
    });
  }

  // ---------- where things are (pure functions of t) ----------
  // a drifting boat slides from side to side; the gap in a wave line slides too
  const obsX = (o, t) => (o.amp ? o.x + o.amp * Math.sin(o.om * t + o.ph) : o.x);
  const halfWidth = (o) => o.r + (o.hx || 0);

  // Does a circle of her body (at bs, bx, radius br) touch obstacle o at time t? Footprints are a little
  // smaller than the pictures (kind to a 6-year-old).
  function touches(o, t, bs, bx, br) {
    const ds = bs - o.s;
    if (o.k === 'wave') {
      if (ds > o.r + br || ds < -(o.r + br)) return false;
      const dx = bx - obsX(o, t);
      return (dx < 0 ? -dx : dx) + (br - BODY_R) > o.gap / 2 - 4;
    }
    let dx = bx - obsX(o, t);
    if (dx < 0) dx = -dx;
    dx -= o.hx || 0;
    if (dx < 0) dx = 0;
    const rr = o.r + br;
    return dx * dx + ds * ds < rr * rr;
  }
  // What she would bump at time t with her middle at (s, x); `inflate` pads her body (for the verifier).
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
  function kelpAt(lev, s, x) {
    const near = lev.kelpBuckets[Math.floor(s / BUCKET)];
    if (!near) return null;
    for (let i = 0; i < near.length; i++) {
      const k = near[i], a = (x - k.x) / k.rx, b = (s - k.s) / k.rs;
      if (a * a + b * b < 1) return k;
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

  // ---------- building a course ----------
  function build(n, seedOverride) {
    const C = COURSES[n - 1];
    if (!C) throw new Error('no course ' + n);
    const seed = seedOverride != null ? seedOverride : C.seed;
    const R = mulberry32((0x9E3779B1 ^ Math.imul(seed + n * 7919, 2654435761)) >>> 0);
    const rnd = (a, b) => a + (b - a) * R();
    const obs = [], coins = [], kelp = [], ramps = [], pins = [[0, 0]], patterns = {};
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
    const coin = (s, off) => coins.push({ s, off: off || 0, air: 0, h: 0 });
    const line = (s0, s1, k, off) => { for (let i = 0; i < k; i++) coin(k === 1 ? (s0 + s1) / 2 : lerp(s0, s1, i / (k - 1)), off); };
    const ROCK_R = [36, 44, 50];
    const make = {
      rock: () => { const v = Math.floor(R() * 3); return { k: 'rock', r: ROCK_R[v], hx: 0, v }; },
      buoy: () => ({ k: 'buoy', r: 24, hx: 0, v: Math.floor(R() * 2) }),
      boat: () => ({ k: 'boat', r: 32, hx: 62, v: Math.floor(R() * 3) }),
      gull: () => ({ k: 'gull', r: 36, hx: 14, v: 0 }),
    };
    const put = (o, s, x) => { o.s = s; o.x = x; obs.push(o); return o; };
    // put o beside the lane (which is at its tight place, s): its near edge `room` clear of her side
    function beside(o, s, mult, side) {
      const off = halfWidth(o) + BODY_R + C.clear * rnd(1, mult || 1.5);
      let sd = side || (R() < 0.5 ? -1 : 1);
      if (Math.abs(lane + sd * off) > HALF - 20) sd = -sd;
      put(o, s, lane + sd * off);
      return sd;
    }
    // sometimes (more on later courses) a second thing on her other side, making a gateway
    function partner(s, sd) {
      if (R() >= C.two) return false;
      const o = R() < 0.5 || n < 4 ? make.rock() : make.buoy();
      const x = lane - sd * (halfWidth(o) + BODY_R + C.clear * rnd(1.05, 1.6));
      if (Math.abs(x) > HALF - 20) return false;
      put(o, s, x);
      return true;
    }
    // five coins past something beside the lane, curving a little away from it
    const arc = (s, sd, bulge) => { for (let i = -2; i <= 2; i++) coin(s + i * 90, -sd * bulge * (1 - (i * i) / 4)); };

    const P = {
      rock(s0) {
        const s = s0 + 200; shift(s);
        const sd = beside(make.rock(), s, 1.5), two = partner(s, sd);
        arc(s, sd, two ? 0 : 18);
        return 400;
      },
      // two buoys (later, sometimes rocks) to swim between
      gate(s0) {
        const s = s0 + 180; shift(s);
        const mk = n >= 8 && R() < 0.4 ? make.rock : make.buoy;
        for (const sd of [-1, 1]) { const o = mk(); put(o, s, lane + sd * (halfWidth(o) + BODY_R + C.clear * rnd(1, 1.3))); }
        line(s - 150, s + 150, 4, 0);
        return 360;
      },
      // a line of buoys right across, with one way through
      buoys(s0) {
        const s = s0 + 220; shift(s);
        for (const sd of [-1, 1]) {
          for (let x = lane + sd * (24 + BODY_R + C.clear * rnd(1.1, 1.4)); Math.abs(x) <= HALF - 24; x += sd * 100) put(make.buoy(), s, x);
        }
        line(s - 220, s + 220, 5, 0);
        return 440;
      },
      // driftwood: a long log lying across one side
      log(s0, side) {
        const s = s0 + 200; shift(s);
        let sd = side || (R() < 0.5 ? -1 : 1);
        const inner = BODY_R + C.clear * rnd(1, 1.4), r = 20;
        let hx = rnd(70, 135);
        if (Math.abs(lane + sd * (inner + 2 * r + 2 * hx)) > HALF + 40) { if (!side) sd = -sd; hx = Math.min(hx, Math.max(40, (HALF + 40 - Math.abs(lane + sd * (inner + 2 * r))) / 2)); }
        put({ k: 'log', r, hx: Math.round(hx), v: Math.floor(R() * 2) }, s, lane + sd * (inner + r + hx));
        line(s - 150, s + 150, 4, -sd * 12);
        return 400;
      },
      // two logs, one from each side: an S-bend
      logs(s0) {
        const sd = R() < 0.5 ? -1 : 1;
        P.log(s0, sd);
        const s2 = s0 + 200 + 560;
        shift(s2, sd);
        const inner = BODY_R + C.clear * rnd(1, 1.3), r = 20, hx = Math.round(rnd(80, 130));
        put({ k: 'log', r, hx, v: Math.floor(R() * 2) }, s2, lane - sd * (inner + r + hx));
        line(s2 - 280, s2 + 150, 5, sd * 12);
        return 200 + 560 + 200;
      },
      // three buoys to weave round
      slalom(s0) {
        let dir = R() < 0.5 ? -1 : 1;
        const sep = 400;
        for (let i = 0; i < 3; i++) {
          const s = s0 + 180 + i * sep;
          shift(s, dir);
          const o = make.buoy();
          put(o, s, lane - dir * (halfWidth(o) + BODY_R + C.clear * rnd(0.8, 1.1)));
          coin(s, 0);
          if (i < 2) coin(s + sep / 2, 0);
          dir = -dir;
        }
        return 180 + 2 * sep + 180;
      },
      // a patch of floating kelp that slows her (no bump)
      kelp(s0) {
        const s = s0 + 220; shift(s);
        const rx = Math.round(rnd(110, 150)), rs = 90;
        let sd = R() < 0.5 ? -1 : 1;
        const off = rx + BODY_R + C.clear * 0.6 * rnd(1, 1.4);
        if (Math.abs(lane + sd * off) > HALF - 20) sd = -sd;
        kelp.push({ s, x: lane + sd * off, rx, rs, v: Math.floor(R() * 2) });
        if (n >= 10 && R() < 0.5) {
          const rx2 = Math.round(rnd(100, 130)), x2 = lane - sd * (rx2 + BODY_R + C.clear * 0.7 * rnd(1, 1.4));
          if (Math.abs(x2) <= HALF - 20) kelp.push({ s: s + 40, x: x2, rx: rx2, rs: 80, v: Math.floor(R() * 2) });
        }
        line(s - 180, s + 180, 4, 0);
        return 440;
      },
      // a little sailing boat at anchor
      boat(s0) {
        const s = s0 + 220; shift(s);
        const sd = beside(make.boat(), s, 1.5), two = partner(s, sd);
        arc(s, sd, two ? 0 : 18);
        return 440;
      },
      // a seagull dozing on a raft, with coins curling round it
      gull(s0) {
        const s = s0 + 220; shift(s);
        const o = make.gull(), sd = beside(o, s, 1.4), D = Math.abs(o.x - lane);
        for (let i = -2; i <= 2; i++) { const a = (i * 25 * Math.PI) / 180; coin(s + D * Math.sin(a), sd * D * (1 - Math.cos(a))); }
        return 440;
      },
      // a boat that drifts from side to side, never across the lane
      drift(s0) {
        const s = s0 + 240; shift(s);
        const o = make.boat(), hw = halfWidth(o);
        let amp = rnd(110, 170), sd = R() < 0.5 ? -1 : 1;
        const room = hw + BODY_R + C.clear * rnd(0.8, 1.2);   // from the lane to the boat's middle at its nearest
        if (Math.abs(lane + sd * (room + amp)) + amp > HALF + 80) sd = -sd;
        while (amp > 60 && Math.abs(lane + sd * (room + amp)) + amp > HALF + 80) amp -= 10;
        const x = lane + sd * (room + amp);
        const vpk = rnd(55, 85) * C.tempo;
        o.amp = Math.round(amp); o.om = +(vpk / amp).toFixed(4); o.ph = +rnd(0, TAU).toFixed(3); o.mv = 1;
        put(o, s, Math.round(x));
        line(s - 180, s + 180, 4, 0);
        return 480;
      },
      // a boat that drifts right across the lane: wait for it, or go round
      cross(s0) {
        const s = s0 + 420; shift(s);
        const o = make.boat();
        const amp = rnd(200, 250), vpk = rnd(45, 65) * C.tempo;
        o.amp = Math.round(amp); o.om = +(vpk / amp).toFixed(4); o.ph = +rnd(0, TAU).toFixed(3); o.mv = 2;
        put(o, s, Math.round(clamp(lane + rnd(-60, 60), -150, 150)));
        line(s - 420, s - 260, 3, 0);
        line(s + 260, s + 420, 3, 0);
        return 840;
      },
      // a line of waves right across with a gap that sways from side to side; the lane is always inside the gap
      wave(s0) {
        const s = s0 + 260; shift(s);
        const gap = Math.round(2 * (BODY_R + C.clear) + 150), amp = Math.round(gap / 2 - BODY_R - C.clear * 0.5);
        const vpk = rnd(45, 70) * C.tempo;
        obs.push({ k: 'wave', s, x: Math.round(lane), r: 14, hx: 0, gap, amp, om: +(vpk / amp).toFixed(4), ph: +rnd(0, TAU).toFixed(3), v: 0, mv: 3 });
        line(s - 260, s - 100, 3, 0);
        line(s + 100, s + 260, 3, 0);
        return 520;
      },
      // a wave ramp: a straight run of coins up to it, and coins in the air beyond for whoever comes fast
      ramp(s0) {
        shift(s0);
        const rs = s0 + 560;
        hold(rs + 760);
        ramps.push({ s: rs, x: lane, hx: 150 });
        line(s0 + 40, s0 + 480, 5, 0);
        for (let i = 0; i < 5; i++) {
          const ds = 70 + i * 62, u = ds / 408;
          coins.push({ s: rs + ds, off: 0, air: 1, h: Math.round(AIR_H * 4 * u * (1 - u)) });
        }
        return 560 + 760;
      },
      // just coins: a gentle wiggle
      coins(s0) {
        shift(s0); hold(s0 + 640);
        const ph = rnd(0, TAU);
        for (let i = 0; i < 9; i++) coin(s0 + i * 80, 55 * Math.sin(ph + i * 0.7));
        return 640;
      },
      // just coins: a long straight line, for going fast
      trail(s0) {
        shift(s0); hold(s0 + 1000);
        line(s0, s0 + 990, 10, 0);
        return 1000;
      },
    };

    const ONCE = new Set(['coins', 'trail', 'ramp', 'buoys', 'slalom', 'wave', 'logs', 'cross']), OPEN = new Set(['coins', 'trail', 'ramp']);
    line(500, 980, 5, 0);   // a friendly first trail, straight ahead
    hold(1100);
    let s = 1400, last = '', first = true;
    while (s < C.len - 1500) {
      // (the big set pieces never come twice running, nor do two stretches of open water; at most three ramps a course)
      const kinds = C.kinds.filter((k) => (k !== last || !ONCE.has(k)) && !(OPEN.has(k) && OPEN.has(last)) && (k !== 'ramp' || (s < C.len - 2000 && ramps.length < 3)));
      let kind;
      if (first && C.feature) kind = C.feature;   // the new thing first, on its own
      else {
        const w = kinds.map((k) => (k === C.feature ? (k === 'ramp' ? 1.6 : 3) : k === 'coins' || k === 'trail' ? 0.2 : k === 'ramp' ? 0.7 : 1));
        let u = R() * w.reduce((a, b) => a + b, 0);
        kind = kinds[0];
        for (let i = 0; i < kinds.length; i++) { u -= w[i]; if (u <= 0) { kind = kinds[i]; break; } }
      }
      first = false;
      const w = P[kind](s);
      patterns[kind] = (patterns[kind] || 0) + 1;
      last = kind;
      s += w + rnd(C.gap[0], C.gap[1]);
    }
    hold(C.len - 500);
    pin(C.len, lane);
    line(C.len - 430, C.len - 70, 4, 0);   // and a last trail up to the finish line

    const lev = { n, seed, cfg: C, len: C.len, chestS: C.len + CHEST_AFTER, stopS: C.len + CHEST_AFTER - STOP_BEFORE, pins, obs, coins, kelp, ramps, patterns };

    // things floating well away from the lane, so the sea is not empty (and wandering off has a price)
    const inRamp = (q) => ramps.some((r) => q > r.s - 320 && q < r.s + 800);
    for (let q = 1500 + rnd(0, 300); q < C.len - 700; q += rnd(300, 600)) {
      if (R() >= C.extras || inRamp(q)) continue;
      const o = R() < 0.55 || n < 4 ? make.rock() : R() < 0.6 || n < 7 ? make.buoy() : R() < 0.6 || n < 9 ? make.boat() : make.gull();
      const hw = halfWidth(o), need = hw + BODY_R + C.clear + 45;
      for (let tries = 0; tries < 6; tries++) {
        const x = rnd(-(HALF - 40), HALF - 40);
        let ok = true;
        for (let d = -150; d <= 150 && ok; d += 75) if (Math.abs(x - laneAt(lev, q + d)) < need) ok = false;
        for (let i = 0; i < obs.length && ok; i++) {
          const p = obs[i];
          if (p.k === 'wave') { if (Math.abs(p.s - q) < 160) ok = false; continue; }
          const reach = halfWidth(p) + (p.amp || 0) + hw + 60;
          if (Math.abs(p.s - q) < 150 && Math.abs(p.x - x) < reach) ok = false;
        }
        for (let i = 0; i < kelp.length && ok; i++) if (Math.abs(kelp[i].s - q) < 190 && Math.abs(kelp[i].x - x) < kelp[i].rx + hw + 30) ok = false;
        if (ok) { put(o, Math.round(q), Math.round(x)); o.extra = 1; break; }
      }
    }

    // coins: their place on the lane; none inside anything that stays put, or in the kelp
    for (const c of coins) c.x = clamp(laneAt(lev, c.s) + c.off, -(XMAX - 5), XMAX - 5);
    const blocked = (c) => obs.some((o) => !o.amp && o.k !== 'wave' && Math.abs(o.s - c.s) < o.r + 30 && Math.abs(o.x - c.x) < halfWidth(o) + 30)
      || kelp.some((k) => ((c.x - k.x) / (k.rx + 20)) ** 2 + ((c.s - k.s) / (k.rs + 20)) ** 2 < 1);
    lev.coins = coins.filter((c) => c.air || !blocked(c)).map((c) => ({ s: Math.round(c.s), x: Math.round(c.x), air: c.air, h: c.h }));
    lev.coins.sort((a, b) => a.s - b.s);
    for (const o of obs) { o.s = Math.round(o.s); o.x = Math.round(o.x); }
    for (const k of kelp) { k.s = Math.round(k.s); k.x = Math.round(k.x); }
    for (const r of ramps) { r.s = Math.round(r.s); r.x = Math.round(r.x); }
    for (const p of pins) { p[0] = Math.round(p[0]); p[1] = Math.round(p[1]); }
    obs.sort((a, b) => a.s - b.s);
    kelp.sort((a, b) => a.s - b.s);
    lev.total = lev.coins.length;
    lev.groundTotal = lev.coins.filter((c) => !c.air).length;

    // buckets for the hit test (she reaches 53 behind her middle and 34 ahead)
    lev.buckets = [];
    for (const o of obs) for (let b = Math.floor((o.s - o.r - 110) / BUCKET); b <= Math.floor((o.s + o.r + 110) / BUCKET); b++) if (b >= 0) (lev.buckets[b] || (lev.buckets[b] = [])).push(o);
    lev.kelpBuckets = [];
    for (const k of kelp) for (let b = Math.floor((k.s - k.rs - 10) / BUCKET); b <= Math.floor((k.s + k.rs + 10) / BUCKET); b++) if (b >= 0) (lev.kelpBuckets[b] || (lev.kelpBuckets[b] = [])).push(k);
    return lev;
  }

  // Everything that makes a course what it is, as one string (the verifier freezes its hash).
  function describe(lev) {
    const f = (v) => (Math.round(v * 1000) / 1000).toString();
    return [
      lev.len,
      lev.obs.map((o) => [o.k, o.s, o.x, o.r, o.hx || 0, o.v || 0, o.amp || 0, f(o.om || 0), f(o.ph || 0), o.gap || 0, o.mv || 0].join(',')).join(';'),
      lev.coins.map((c) => [c.s, c.x, c.air, c.h].join(',')).join(';'),
      lev.kelp.map((k) => [k.s, k.x, k.rx, k.rs, k.v].join(',')).join(';'),
      lev.ramps.map((r) => [r.s, r.x, r.hx].join(',')).join(';'),
      lev.pins.map((p) => p.join(',')).join(';'),
    ].join('|');
  }

  // Stars are the share of the course's coins she finished with: 3 for 80%, 2 for half, 1 for finishing. Never time.
  // The share is counted against the coins on the water (`total`): the coins in the air above a wave ramp are
  // extra, so a child who never uses the speed button can still earn 3 stars, and one who leaps has some to spare.
  function starsFor(got, total) {
    if (total <= 0) return 3;
    const share = got / total;
    return share >= 0.8 ? 3 : share >= 0.5 ? 2 : 1;
  }

  // ---------- one swim down a course ----------
  class Run {
    constructor(n, seedOverride) {
      this.n = n;
      this.lev = build(n, seedOverride);
      this.ev = [];
      this.start();
    }
    start() {
      const lv = this.lev;
      this.t = 0; this.st = 0; this.phase = 'play';
      this.s = 0; this.x = 0; this.v = V_SLOW; this.vx = 0; this.kx = 0; this.z = 0;
      this.inv = 0; this.air = 0; this.inKelp = false;
      this.bumps = 0; this.leaps = 0; this.spilled = 0; this.coinCount = 0; this.picked = 0;
      this.got = new Uint8Array(lv.coins.length);
      this.cs = Float32Array.from(lv.coins, (c) => c.s);
      this.cx = Float32Array.from(lv.coins, (c) => c.x);
      this.ci = 0; this.ri = 0;
      this.stars = 0;
      this.ev.length = 0;
    }
    emit(type, o) { this.ev.push({ type, s: this.s, x: this.x, o: o || null }); }
    get progress() { return clamp(this.s / this.lev.len, 0, 1); }
    // how far the speed button has taken her: 0 at slow, 1 at fastest
    get boost() { return clamp((this.v - V_SLOW) / (V_MAX - V_SLOW), 0, 1); }

    // steer: -1 (hard left) .. 1 (hard right); boost: is the speed button held?
    step(dt, steer, boost) {
      this.st += dt;
      if (this.phase === 'play') this.stepPlay(dt, clamp(+steer || 0, -1, 1), !!boost);
      else if (this.phase === 'finish') this.stepFinish(dt);
    }

    stepPlay(dt, steer, boost) {
      const lv = this.lev;
      this.t += dt;

      // forward speed: she never stops
      const kelp = this.air <= 0 && !!kelpAt(lv, this.s, this.x);
      if (kelp && !this.inKelp) this.emit('kelp');
      this.inKelp = kelp;
      const up = (V_MAX - V_SLOW) / RAMP_UP;
      if (this.air > 0) { /* she keeps her speed in the air */ }
      else if (kelp) this.v += (V_KELP - this.v) * (1 - Math.exp(-dt / KELP_EASE));
      else if (boost) this.v = Math.min(V_MAX, this.v + up * dt);
      else if (this.v > V_SLOW) this.v = V_SLOW + (this.v - V_SLOW) * Math.exp(-dt / EASE_DOWN);
      else this.v = Math.min(V_SLOW, this.v + up * 1.5 * dt);

      // sideways
      this.vx += (steer * VX_MAX - this.vx) * (1 - Math.exp(-dt * STEER_K));
      this.x += (this.vx + this.kx) * dt;
      this.kx *= Math.exp(-dt * 5);
      if (this.x > XMAX) { this.x = XMAX; if (this.vx > 0) this.vx = 0; }
      else if (this.x < -XMAX) { this.x = -XMAX; if (this.vx < 0) this.vx = 0; }
      this.s += this.v * dt;

      // in the air
      if (this.air > 0) {
        this.air -= dt;
        if (this.air <= 0) { this.air = 0; this.z = 0; this.emit('land'); }
        else { const u = 1 - this.air / AIR_T; this.z = 4 * AIR_H * u * (1 - u); }
      }
      // wave ramps: fast enough, and she leaps
      while (this.ri < lv.ramps.length && lv.ramps[this.ri].s <= this.s) {
        const rp = lv.ramps[this.ri++];
        if (this.air > 0 || Math.abs(this.x - rp.x) >= rp.hx) continue;
        if (this.v >= V_LEAP) { this.air = AIR_T; this.leaps++; this.emit('leap'); }
        else this.emit('bob');
      }

      // a bump: a splash and a wobble, down to slow speed, perhaps one coin spilled. Then she carries on.
      if (this.inv > 0) this.inv -= dt;
      else if (this.air <= 0) {
        const o = hitTest(lv, this.t, this.s, this.x, 0);
        if (o) {
          this.bumps++; this.inv = INV;
          this.v = Math.min(this.v, V_BUMP);
          const away = this.x >= obsX(o, this.t) ? 1 : -1;
          this.kx = (o.k === 'wave' ? -away : away) * 320;   // off a rock; back toward the gap in a wave
          this.emit('bump', o);
          if (this.coinCount > 0) { this.coinCount--; this.spilled++; this.emit('spill'); }
        }
      }

      // coins (with a gentle magnet)
      const cs = this.cs, cx = this.cx, got = this.got, N = cs.length;
      while (this.ci < N && lv.coins[this.ci].s < this.s - 160) this.ci++;
      for (let i = this.ci; i < N && lv.coins[i].s < this.s + 160; i++) {
        if (got[i]) continue;
        const ds = this.s - cs[i], dx = this.x - cx[i];
        if (lv.coins[i].air) {
          if (this.air > 0 && ds > -R_AIR && ds < R_AIR && dx > -R_AIR && dx < R_AIR) this.take(i);
          continue;
        }
        if (this.z > 40) continue;
        const d = Math.hypot(ds, dx);
        if (d < R_COIN) this.take(i);
        else if (d < R_MAG) { const m = (380 * dt) / d; cs[i] += ds * m; cx[i] += dx * m; }
      }

      if (this.s >= lv.len) {
        this.phase = 'finish'; this.st = 0; this.air = 0; this.z = 0;
        this.stars = starsFor(this.coinCount, lv.groundTotal);
        this.emit('finish');
      }
    }
    take(i) { this.got[i] = 1; this.coinCount++; this.picked++; this.ev.push({ type: 'coin', s: this.cs[i], x: this.cx[i], o: this.lev.coins[i] }); }

    // past the line: she glides to the middle and up to the treasure chest by herself
    stepFinish(dt) {
      const lv = this.lev;
      this.t += dt;
      this.x += (0 - this.x) * (1 - Math.exp(-dt * 2.2));
      this.vx *= Math.exp(-dt * 6);
      const rem = lv.stopS - this.s, want = clamp(rem * 2.5, 40, V_SLOW * 1.1);
      this.v += (Math.min(this.v, want) - this.v) * (1 - Math.exp(-dt * 6));
      if (this.v > want) this.v = Math.max(want, this.v - 500 * dt);
      this.s += this.v * dt;
      if (this.s >= lv.stopS - 2) { this.s = lv.stopS; this.v = 0; this.phase = 'done'; this.st = 0; this.emit('chest'); }
    }
  }

  // ---------- steering by leaning the phone ----------
  // The sensors give the direction of "up" in the phone's own axes (x toward the right edge of the phone
  // held upright, y toward its top edge, z out of the screen): on Android, flat on a table with the screen
  // up reads (0, 0, +9.8). The screen may be turned either way round (screen.orientation.angle is 90 or
  // 270 in landscape), so first turn the vector into the SCREEN's axes. Then the lean is how far the
  // screen's right-pointing axis dips below level: 0 held level, positive with the right side down (steer
  // right), whether the phone is upright like a steering wheel or lying nearly flat in a lap.
  // Checked on the Seeker (flat on a desk, screen up, it reads [0, 0, 9.9]): the sign convention is the one above.
  // What to expect: LEFT side of the screen down steers LEFT, right side down steers right, like a steering wheel.
  // In landscape with screen.orientation.angle 90 the left side going down makes accelerationIncludingGravity.y
  // negative; with angle 270 (the phone the other way round) it makes y positive. Should a real phone ever steer the
  // wrong way, TILT.SIGN is the one constant to flip.
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
    HALF, XMAX, LANE, V_SLOW, V_MAX, RAMP_UP, EASE_DOWN, V_KELP, V_BUMP, VX_MAX, STEER_K, V_LEAP, AIR_T, AIR_H, INV, R_COIN, R_MAG, R_AIR,
    BODY, BODY_R, CHEST_AFTER, STOP_BEFORE, TAU, NEW, COURSES, NLEV: COURSES.length,
    mulberry32, clamp, lerp, build, describe, obsX, halfWidth, touches, hitTest, kelpAt, laneAt, starsFor, Run,
    TILT, normAngle, screenAngleFor, toScreen, leanDeg, steerFromLean, gravityFromOrientation, Tilt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DashLogic = api;
})(typeof self !== 'undefined' ? self : this);
