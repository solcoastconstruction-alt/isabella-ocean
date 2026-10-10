/* Fairy Flight: the rules. Pure logic, no DOM: test/games/flight/verify.js runs this same file in Node.
 * The forest scrolls from right to left at the level's speed. Isabella the Fairy flies on the left third of the
 * screen and eases toward the finger's height (and a little toward its x). Closed flower buds stand on the
 * ground, on toadstools, on tree branches and on clouds; when she passes within the dust radius of one, her
 * wand sprinkles dust and it blooms, and every plant brought to life pays one gold coin. Grumpy ground
 * critters trundle along and grumpy sky bugs fly in patterns: touching one is a bonk (a wobble and a 1.5 s
 * shield; on Medium and Hard one coin drifts away, never below 0; on Easy nothing is lost). A golden key
 * hangs mid-course. The course ends at the treasure chest: with the key it bursts open with coins; without
 * it the key floats over to her anyway. Nothing can be failed.
 *
 * Everything on the course is a pure function of the time t, so a test can read the whole course ahead.
 * Courses are generated from seeds and frozen by fingerprint (test/games/flight/fingerprints.json). */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const VH = 540;
  const GROUND = 470;                        // the ground line plants and critters stand on
  const MODES = ['easy', 'medium', 'hard'];
  const NLEV = 20, PER_PAGE = 10;

  // ---- Isabella ----
  const PX_NOM = 270, PX_LO = 214, PX_HI = 326;   // her x when left alone, and the band the finger may move her within
  const Y_MIN = 72, Y_MAX = 432, Y_REST = 252;    // the heights she flies between, and the middle she drifts toward
  const FOLLOW_Y = 8, VY_MAX = 560;               // she closes the gap to the finger's height at this rate (per second), never faster than VY_MAX
  const FOLLOW_X = 5, VX_MAX = 260;
  const REST_FOLLOW = 0.9, REST_VMAX = 60;        // no finger: a gentle drift to the middle height
  const R_I = 20;                                 // her body, for bonks
  const SHIELD = 1.5;                             // seconds after a bonk when nothing can bonk her
  const KICK_T = 0.35;                            // the bump pushes her away this long
  const KEY_R = 54;                               // a golden key is collected within this
  const CHEST_COINS = 10;
  const CHEST_SX = 600;                           // where the chest stops, on the screen
  const LAND_X = 430, LAND_Y = 440;               // where she lands beside the chest (her waist)
  const DECEL = 1.2;                              // the scroll eases to a stop over this long
  const KEY_FLOAT_AT = 0.9, OPEN_KEY = 1.3, OPEN_NOKEY = 2.5;   // seconds after the scroll stops
  const BLOOM_T = 0.5;

  // ---- the things on the course ----
  const FLOWER_H = [46, 54, 50, 62, 50, 56];  // FairyArt's flower heights (stem tip above the base) at scale 1
  const PSC = 1.6;                            // plants are drawn bigger than that, so a bud is easy to see
  const CRITTER_R = 30, CRITTER_Y = GROUND - 24, BUG_R = 24;
  const CRITTER_VE = [10, 24, 16];            // snail, hedgehog, toad: how fast they trundle toward her (units a second)
  const X_FIRST = 520;                        // the first plant
  const TAIL = 640;                           // the last plant is this far before the chest
  const CLEAR_END = 760;                      // no enemy this close to the chest

  // ---- the modes ----
  // speed: the scroll. dust: how near a bud she must pass. extra: enemies added (share of Medium's). slow: critters' pace.
  // bug: bugs' pace (their pattern speed). loss: a bonk costs a coin. Easy keeps every other enemy.
  const MODE = {
    easy:   { speed: 0.8,  dust: 118, extra: 0,   slow: 0.7, bug: 0.8, loss: false },
    medium: { speed: 1,    dust: 86,  extra: 0,   slow: 1,   bug: 1,   loss: true },
    hard:   { speed: 1.25, dust: 62,  extra: 0.5, slow: 1,   bug: 1.3, loss: true },
  };

  // ---- the twenty levels ----
  // theme: FairyArt.THEMES index (0-3 the Meadow, 4-7 the Cloud Tops). secs: how long the course takes at Medium speed.
  // speed: scroll, units a second. plants: buds on the course. tiers: what they stand on (weights). moving: share of cloud plants
  // that bob. critters / pairs (two critters together) / bugs: the enemies at Medium. patterns: how bugs fly. seed: the course.
  const T1 = { ground: 3, toad: 2 };
  const T3 = { ground: 3, toad: 2, tree: 2 };
  const T7 = { ground: 3, toad: 2, tree: 2, cloud: 3 };
  const LEVELS = [
    { n: 1,  world: 1, theme: 0, secs: 40, speed: 100, plants: 6,  tiers: T1, moving: 0,   critters: 0,  pairs: 0, bugs: 0,  patterns: [], seed: 2000 },
    { n: 2,  world: 1, theme: 0, secs: 42, speed: 104, plants: 7,  tiers: T1, moving: 0,   critters: 0,  pairs: 0, bugs: 0,  patterns: [], seed: 3000 },
    { n: 3,  world: 1, theme: 0, secs: 44, speed: 108, plants: 8,  tiers: T3, moving: 0,   critters: 2,  pairs: 0, bugs: 0,  patterns: [], seed: 4000 },
    { n: 4,  world: 1, theme: 1, secs: 46, speed: 112, plants: 9,  tiers: T3, moving: 0,   critters: 2,  pairs: 0, bugs: 0,  patterns: [], seed: 5000 },
    { n: 5,  world: 1, theme: 1, secs: 48, speed: 116, plants: 10, tiers: T3, moving: 0,   critters: 3,  pairs: 0, bugs: 1,  patterns: ['straight'], seed: 6000 },
    { n: 6,  world: 1, theme: 2, secs: 50, speed: 120, plants: 11, tiers: T3, moving: 0,   critters: 3,  pairs: 0, bugs: 2,  patterns: ['straight'], seed: 7000 },
    { n: 7,  world: 1, theme: 2, secs: 52, speed: 125, plants: 12, tiers: T7, moving: 0,   critters: 4,  pairs: 0, bugs: 3,  patterns: ['straight', 'sine'], seed: 8000 },
    { n: 8,  world: 1, theme: 2, secs: 55, speed: 130, plants: 13, tiers: T7, moving: 0,   critters: 5,  pairs: 0, bugs: 3,  patterns: ['straight', 'sine'], seed: 9000 },
    { n: 9,  world: 1, theme: 3, secs: 57, speed: 135, plants: 14, tiers: T7, moving: 0,   critters: 5,  pairs: 0, bugs: 4,  patterns: ['straight', 'sine', 'circle'], seed: 10000 },
    { n: 10, world: 1, theme: 3, secs: 60, speed: 140, plants: 15, tiers: T7, moving: 0,   critters: 5,  pairs: 0, bugs: 5,  patterns: ['straight', 'sine', 'circle'], seed: 11000 },
    { n: 11, world: 2, theme: 4, secs: 55, speed: 145, plants: 14, tiers: T7, moving: 0,   critters: 6,  pairs: 1, bugs: 6,  patterns: ['straight', 'sine', 'circle'], seed: 12000 },
    { n: 12, world: 2, theme: 4, secs: 57, speed: 150, plants: 15, tiers: T7, moving: 0,   critters: 6,  pairs: 1, bugs: 7,  patterns: ['straight', 'sine', 'circle'], seed: 13000 },
    { n: 13, world: 2, theme: 4, secs: 59, speed: 155, plants: 16, tiers: T7, moving: 0,   critters: 7,  pairs: 2, bugs: 8,  patterns: ['straight', 'sine', 'circle', 'weave'], seed: 14000 },
    { n: 14, world: 2, theme: 5, secs: 61, speed: 160, plants: 17, tiers: T7, moving: 0,   critters: 7,  pairs: 2, bugs: 9,  patterns: ['straight', 'sine', 'circle', 'weave'], seed: 15001 },
    { n: 15, world: 2, theme: 5, secs: 64, speed: 165, plants: 18, tiers: T7, moving: 0.4, critters: 8,  pairs: 2, bugs: 10, patterns: ['sine', 'circle', 'weave'], seed: 16003 },
    { n: 16, world: 2, theme: 5, secs: 67, speed: 170, plants: 19, tiers: T7, moving: 0.4, critters: 8,  pairs: 3, bugs: 11, patterns: ['sine', 'circle', 'weave'], seed: 17004 },
    { n: 17, world: 2, theme: 6, secs: 70, speed: 175, plants: 20, tiers: T7, moving: 0.6, critters: 9,  pairs: 3, bugs: 12, patterns: ['sine', 'circle', 'weave'], seed: 18000 },
    { n: 18, world: 2, theme: 6, secs: 73, speed: 180, plants: 21, tiers: T7, moving: 0.6, critters: 9,  pairs: 3, bugs: 13, patterns: ['sine', 'circle', 'weave'], seed: 19000 },
    { n: 19, world: 2, theme: 7, secs: 76, speed: 185, plants: 22, tiers: T7, moving: 0.8, critters: 10, pairs: 4, bugs: 14, patterns: ['sine', 'circle', 'weave'], seed: 20001 },
    { n: 20, world: 2, theme: 7, secs: 80, speed: 190, plants: 24, tiers: T7, moving: 0.8, critters: 10, pairs: 4, bugs: 16, patterns: ['sine', 'circle', 'weave'], seed: 21003 },
  ];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const r1 = (v) => Math.round(v * 10) / 10;

  // ---- building a course ----
  // The base course is the Medium one. Plants and the key are the same in every mode; the modes change the pace, the dust
  // radius and which enemies come (Easy keeps every other one and slows them; Hard adds half as many again and speeds the bugs).
  const baseCache = {};
  function baseOf(level) {
    if (baseCache[level]) return baseCache[level];
    const cfg = LEVELS[level - 1], rng = mulberry32(cfg.seed * 7919 + 13), tough = (level - 1) / 19;
    const xEnd = Math.round(cfg.secs * cfg.speed + (CHEST_SX - PX_NOM));
    const xLast = xEnd - TAIL, n = cfg.plants, step = (xLast - X_FIRST) / (n - 1);

    // plants: spread along the course, standing on different things at different heights
    const weights = Object.entries(cfg.tiers);
    const pickTier = (a, b) => {
      for (let k = 0; k < 20; k++) {
        let tot = 0; for (const w of weights) tot += w[1];
        let u = rng() * tot, name = weights[0][0];
        for (const w of weights) { if ((u -= w[1]) <= 0) { name = w[0]; break; } }
        if (!(name === a && name === b)) return name;   // never three of one kind in a row
      }
      return weights[0][0];
    };
    const plants = [];
    let prevX = -1e9;
    for (let i = 0; i < n; i++) {
      let x = X_FIRST + step * i + (i === 0 || i === n - 1 ? 0 : (rng() - 0.5) * step * 0.3);
      x = Math.round(Math.max(x, prevX + step * 0.6)); prevX = x;
      const tier = pickTier(plants.length > 1 ? plants[plants.length - 2].tier : '', plants.length ? plants[plants.length - 1].tier : '');
      const kind = Math.floor(rng() * 6);
      let by = GROUND, sz = 0, amp = 0, om = 0, ph = 0, sup = tier;
      if (tier === 'toad') { sz = r1(1 + rng() * 1.3); by = Math.round(GROUND - 54 * sz); }
      else if (tier === 'tree') { sz = [0, 2, 3][Math.floor(rng() * 3)]; by = Math.round((level > 10 ? 215 : 245) + rng() * (level > 10 ? 120 : 95)); }
      else if (tier === 'cloud') {
        sz = Math.round(170 + rng() * 60); by = Math.round((level > 10 ? 150 : 180) + rng() * (level > 10 ? 175 : 120));
        if (rng() < cfg.moving) { sup = 'mcloud'; amp = Math.round(28 + rng() * 32); om = r1(0.9 + rng() * 0.5); ph = r1(rng() * TAU); }
      }
      let hy = Math.round(by - FLOWER_H[kind] * PSC);
      if (tier === 'cloud') {   // a cloud can float anywhere in the sky, so the plant's head is kept inside it, and the cloud follows
        hy = sup === 'mcloud' ? clamp(hy, 94 + amp, 414 - amp) : Math.max(100, hy);
        by = Math.round(hy + FLOWER_H[kind] * PSC);
      } else hy = Math.max(96, hy);
      plants.push({ id: i, x, kind, sup, tier, sz, by, hy, amp, om, ph });
    }

    // the key: halfway along, between two plants
    const m = Math.max(0, Math.floor(n / 2) - 1);
    const kx = Math.round((plants[m].x + plants[m + 1].x) / 2);
    const ky = Math.round(clamp((plants[m].hy + plants[m + 1].hy) / 2 + (rng() - 0.5) * 60, 140, 330));
    const key = { x: kx, y: ky };

    // where the natural line through the plants runs, for placing bugs across it
    const pathY = (x) => {
      if (x <= plants[0].x) return plants[0].hy;
      for (let i = 1; i < n; i++) if (x <= plants[i].x) { const a = plants[i - 1], b = plants[i], u = (x - a.x) / (b.x - a.x); return a.hy + (b.hy - a.hy) * u; }
      return plants[n - 1].hy;
    };
    // one enemy at x, made with the random stream rr
    const makeEnemy = (rr, cls, x) => {
      if (cls === 'critter') {
        const kinds = level < 4 ? [0] : level < 6 ? [0, 1] : [0, 1, 2], kind = kinds[Math.floor(rr() * kinds.length)];
        return { cls, kind, pat: 'walk', x: Math.round(x), y: CRITTER_Y, r: CRITTER_R, ve: r1(CRITTER_VE[kind] * (0.8 + rr() * 0.4)), amp: 0, om: 0, ph: 0, ax: 0 };
      }
      const pat = cfg.patterns[Math.floor(rr() * cfg.patterns.length)], kind = Math.floor(rr() * 3);
      let y = clamp(pathY(x) + (rr() * 2 - 1) * 70, 120, 390), ve = 0, amp = 0, om = 0, ph = r1(rr() * TAU), ax = 0;
      if (pat === 'straight') ve = r1(40 + rr() * 30 * (0.5 + tough));
      else if (pat === 'sine') { amp = Math.round(45 + tough * 35 + rr() * 20); om = r1(1.5 + rr() * 0.7); ve = r1(20 + rr() * 20); y = clamp(y, 100 + amp, 400 - amp); }
      else if (pat === 'circle') { amp = Math.round(46 + tough * 20 + rr() * 14); om = r1(0.9 + rr() * 0.4); y = clamp(y, 100 + amp, 400 - amp); }
      else { amp = Math.round(76 + tough * 36 + rr() * 14); om = r1(2.4 + rr() * 0.8); ve = r1(25 + rr() * 20); ax = 26; y = clamp(y, 100 + amp, 400 - amp); }
      return { cls, kind, pat, x: Math.round(x), y: Math.round(y), r: BUG_R, ve, amp, om, ph, ax };
    };
    const awayFromKey = (e) => { if (Math.abs(e.x - kx) < 300) e.x = Math.round(e.x >= kx ? kx + 300 : kx - 300); };

    // enemies at Medium: critters (some in pairs) and bugs, one after another along the middle of the course
    const units = [];
    for (let i = 0; i < cfg.pairs; i++) units.push('pair');
    for (let i = 0; i < cfg.critters - 2 * cfg.pairs; i++) units.push('critter');
    for (let i = 0; i < cfg.bugs; i++) units.push('bug');
    for (let i = units.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = units[i]; units[i] = units[j]; units[j] = t; }
    const ex0 = 1150, ex1 = xEnd - CLEAR_END, span = (ex1 - ex0) / Math.max(1, units.length);
    const enemies = [];
    units.forEach((u, i) => {
      const x = ex0 + span * (i + 0.5) + (rng() - 0.5) * span * 0.45;
      if (u === 'pair') { enemies.push(makeEnemy(rng, 'critter', x)); enemies.push(makeEnemy(rng, 'critter', x + 150 + rng() * 40)); }
      else enemies.push(makeEnemy(rng, u, x));
    });
    enemies.forEach(awayFromKey);
    enemies.sort((a, b) => a.x - b.x);
    enemies.forEach((e, i) => { e.id = i; });

    // what Hard adds: half as many again (two critters where Medium has none), dropped into the biggest gaps
    const rng2 = mulberry32(cfg.seed * 104729 + 7), extras = [];
    const nExtra = enemies.length === 0 ? 2 : Math.ceil(enemies.length * MODE.hard.extra);
    const spots = enemies.map((e) => e.x).concat([ex0 - 300, ex1 + 200]);
    for (let k = 0; k < nExtra; k++) {
      const pts = spots.slice().sort((a, b) => a - b);
      let bi = 1, bg = -1;
      for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > bg) { bg = pts[i] - pts[i - 1]; bi = i; }
      const x = pts[bi - 1] + bg * (0.4 + rng2() * 0.2);
      const cls = cfg.bugs === 0 ? 'critter' : rng2() * (cfg.critters + cfg.bugs) < cfg.critters ? 'critter' : 'bug';
      const e = makeEnemy(rng2, cls, x);
      awayFromKey(e);
      spots.push(e.x);
      extras.push(e);
    }
    extras.sort((a, b) => a.x - b.x);
    extras.forEach((e, i) => { e.id = 100 + i; });

    return (baseCache[level] = { cfg, xEnd, plants, key, enemies, extras });
  }

  const courseCache = {};
  function buildCourse(level, mode) {
    level = clamp(Math.floor(level) || 1, 1, NLEV);
    if (!MODE[mode]) mode = 'medium';
    const ck = level + mode;
    if (courseCache[ck]) return courseCache[ck];
    const b = baseOf(level), M = MODE[mode], cfg = b.cfg, v = cfg.speed * M.speed;
    let list;
    if (mode === 'easy') list = b.enemies.filter((e, i) => i % 2 === 0);
    else if (mode === 'hard') list = b.enemies.concat(b.extras).sort((p, q) => p.x - q.x);
    else list = b.enemies.slice();
    const enemies = list.map((e) => {
      const bug = e.cls === 'bug';
      return Object.assign({}, e, { ve: r1(e.ve * (bug ? M.bug : M.slow)), om: r1(e.om * (bug ? M.bug : 1)), tm: e.x / v });
    });
    const sTotal = b.xEnd - (CHEST_SX - PX_NOM), tb = sTotal / v - DECEL / 2;
    const course = {
      level, mode, theme: cfg.theme, world: cfg.world, v, xEnd: b.xEnd, sTotal, tb, tStop: tb + DECEL,
      dust: M.dust, loss: M.loss, key: b.key,
      plants: b.plants.map((p) => Object.assign({}, p, { tm: p.x / v })),
      enemies,
    };
    return (courseCache[ck] = course);
  }

  // ---- where things are at time t (screen x and y, in world units) ----
  function scrollAt(c, t) {
    if (t <= c.tb) return c.v * t;
    const u = Math.min(t - c.tb, DECEL);
    return c.v * c.tb + c.v * u - (c.v * u * u) / (2 * DECEL);
  }
  const sx = (c, x, t) => PX_NOM + x - scrollAt(c, t);
  function plantAt(c, p, t) {
    const o = p.amp ? p.amp * Math.sin(p.om * (t - p.tm) + p.ph) : 0;
    return { x: sx(c, p.x, t), y: p.hy + o, by: p.by + o };
  }
  function enemyAt(c, e, t) {
    const tau = t - e.tm;
    if (e.cls === 'critter' || e.pat === 'straight') return { x: sx(c, e.x, t) - e.ve * tau, y: e.y };
    if (e.pat === 'sine') return { x: sx(c, e.x, t) - e.ve * tau, y: e.y + e.amp * Math.sin(e.om * tau + e.ph) };
    if (e.pat === 'circle') return { x: sx(c, e.x, t) + e.amp * Math.cos(e.om * tau + e.ph), y: e.y + e.amp * Math.sin(e.om * tau + e.ph) };
    return { x: sx(c, e.x, t) - e.ve * tau + e.ax * Math.sin(e.om * 0.5 * tau), y: e.y + e.amp * Math.sin(e.om * tau + e.ph) };   // weave
  }
  const keyAt = (c, t) => ({ x: sx(c, c.key.x, t), y: c.key.y });
  const chestAt = (c, t) => sx(c, c.xEnd, t);

  // one axis of the easing: she closes the gap at rate k a second, never faster than vmax
  function ease(p, aim, dt, k, vmax) {
    const lim = vmax * dt;
    return p + clamp((aim - p) * (1 - Math.exp(-k * dt)), -lim, lim);
  }
  // 3 stars when every plant bloomed, 2 for two thirds or more, 1 for finishing. Never about speed.
  function starsFor(bloomed, total) { return bloomed >= total ? 3 : bloomed * 3 >= total * 2 ? 2 : 1; }

  // One play of one level in one mode. step() moves everything on; what happened goes onto `out`:
  // { type: 'bloom' | 'key' | 'bonk' | 'land' | 'keyFloat' | 'chest', ... }.
  class Run {
    constructor(level, mode, o) {
      o = o || {};
      this.c = buildCourse(level, mode);
      this.level = this.c.level; this.mode = this.c.mode; this.M = MODE[this.c.mode];
      this.t = 0;
      this.x = PX_NOM; this.y = Y_REST; this.vy = 0;
      this.coins = 0;          // coins earned this run (what a bonk can take from)
      this.bloomAt = new Array(this.c.plants.length).fill(-1);   // when each plant started to bloom, or -1
      this.bloomed = 0;
      this.keyGot = false; this.keyAt = -1;
      this.bonks = 0; this.shield = 0; this.kick = 0; this.kx = 0; this.ky = 0;
      this.coinsLost = 0;
      this.phase = 'fly';      // fly | land | done
      this.landed = false; this.keyFloat = false; this.opened = false; this.openAt = -1;
      this.done = false; this.stars = 0; this.chestCoins = 0;
      this.paused = false;     // the scroll stops (a test hook)
      this.noEnemies = !!o.noEnemies;
    }
    get total() { return this.c.plants.length; }
    get scroll() { return scrollAt(this.c, this.t); }
    // Move on by dt seconds. finger: { x, y } in world units, or null while no finger is down.
    step(dt, finger, out) {
      if (!(dt > 0)) return;
      const c = this.c;
      let aimX, aimY, kY = FOLLOW_Y, vY = VY_MAX, kX = FOLLOW_X, vX = VX_MAX;
      if (this.phase === 'fly') {
        if (finger) { aimY = clamp(finger.y, Y_MIN, Y_MAX); aimX = finger.x == null ? PX_NOM : clamp(finger.x, PX_LO, PX_HI); }
        else { aimY = Y_REST; aimX = PX_NOM; kY = REST_FOLLOW; vY = REST_VMAX; kX = REST_FOLLOW; vX = REST_VMAX; }
      } else {
        aimX = LAND_X; aimY = LAND_Y; kY = 3; vY = 260; kX = 3; vX = 260;   // she flies down to the chest and lands beside it
      }
      const y0 = this.y;
      this.y = ease(this.y, aimY, dt, kY, vY);
      this.x = ease(this.x, aimX, dt, kX, vX);
      if (this.kick > 0) {
        const k = Math.min(dt, this.kick);
        this.y = clamp(this.y + this.ky * k, Y_MIN, Y_MAX); this.x = clamp(this.x + this.kx * k, PX_LO - 30, PX_HI);
        this.kick -= k;
      }
      this.vy = (this.y - y0) / dt;
      if (!this.paused) this.t += dt;
      if (this.shield > 0) this.shield = Math.max(0, this.shield - dt);
      const t = this.t;

      if (this.phase === 'fly') {
        const R = this.M.dust;
        for (let i = 0; i < c.plants.length; i++) {
          if (this.bloomAt[i] >= 0) continue;
          const p = c.plants[i], q = plantAt(c, p, t), dx = q.x - this.x;
          if (dx > R + 2 || dx < -R - 2) continue;
          const dy = q.y - this.y;
          if (dx * dx + dy * dy <= R * R) {
            this.bloomAt[i] = t; this.bloomed++; this.coins++;
            if (out) out.push({ type: 'bloom', plant: p, index: i, coins: this.coins, bloomed: this.bloomed, x: q.x, y: q.y });
          }
        }
        if (!this.keyGot) {
          const k = keyAt(c, t), dx = k.x - this.x, dy = k.y - this.y;
          if (dx * dx + dy * dy <= KEY_R * KEY_R) { this.keyGot = true; this.keyAt = t; if (out) out.push({ type: 'key', x: k.x, y: k.y }); }
        }
        if (this.shield <= 0 && !this.noEnemies) {
          for (let i = 0; i < c.enemies.length; i++) {
            const e = c.enemies[i], q = enemyAt(c, e, t), rr = e.r + R_I, dx = q.x - this.x;
            if (dx > rr || dx < -rr) continue;
            const dy = q.y - this.y;
            if (dx * dx + dy * dy < rr * rr) {
              this.bonks++; this.shield = SHIELD; this.kick = KICK_T;
              this.kx = (this.x >= q.x ? 1 : -1) * 120; this.ky = (this.y >= q.y ? 1 : -1) * 240;
              const lost = this.M.loss && this.coins > 0;
              if (lost) { this.coins--; this.coinsLost++; }
              if (out) out.push({ type: 'bonk', enemy: e, coinLost: lost, coins: this.coins, x: q.x, y: q.y });
              break;
            }
          }
        }
        if (t >= c.tStop) { this.phase = 'land'; if (out) out.push({ type: 'land' }); }
      } else if (this.phase === 'land') {
        const since = t - c.tStop;
        if (!this.landed && Math.abs(this.y - LAND_Y) < 6 && Math.abs(this.x - LAND_X) < 6) this.landed = true;
        if (!this.keyGot && !this.keyFloat && since >= KEY_FLOAT_AT) { this.keyFloat = true; this.keyGot = true; this.keyAt = t; if (out) out.push({ type: 'keyFloat' }); }
        const need = this.keyGot && !this.keyFloat ? OPEN_KEY : OPEN_NOKEY;
        if (!this.opened && since >= need) {
          this.opened = true; this.openAt = t; this.coins += CHEST_COINS; this.chestCoins = CHEST_COINS;
          this.done = true; this.phase = 'done'; this.stars = starsFor(this.bloomed, this.total);
          if (out) out.push({ type: 'chest', coins: this.coins, stars: this.stars });
        }
      } else {
        this.landed = true;
      }
    }
  }

  // ---- saving ----
  // { v, mode, unlocked: { easy, medium, hard }, stars: { easy: [20], medium: [20], hard: [20] }, coins, plants, chests, bonks }
  const freshSave = () => ({ v: 1, mode: 'medium', unlocked: { easy: 1, medium: 1, hard: 1 },
    stars: { easy: new Array(NLEV).fill(0), medium: new Array(NLEV).fill(0), hard: new Array(NLEV).fill(0) }, coins: 0, plants: 0, chests: 0, bonks: 0 });
  function migrate(raw) {
    const sv = freshSave();
    let s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return sv; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
    const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
    if (MODES.includes(s.mode)) sv.mode = s.mode;
    sv.coins = int(s.coins, 0, 1e9) || 0; sv.plants = int(s.plants, 0, 1e9) || 0; sv.chests = int(s.chests, 0, 1e9) || 0; sv.bonks = int(s.bonks, 0, 1e9) || 0;
    for (const m of MODES) {
      const st = plain(s.stars) && Array.isArray(s.stars[m]) ? s.stars[m] : [];
      sv.stars[m] = Array.from({ length: NLEV }, (_, i) => int(st[i], 0, 3) || 0);
      const beaten = sv.stars[m].reduce((a, v, i) => (v > 0 ? i + 1 : a), 0);
      const un = plain(s.unlocked) ? int(s.unlocked[m], 1, NLEV) : null;
      sv.unlocked[m] = Math.min(NLEV, Math.max(un || 1, beaten + 1));
    }
    return sv;
  }

  const api = { VH, GROUND, MODES, MODE, NLEV, PER_PAGE, LEVELS, PX_NOM, PX_LO, PX_HI, Y_MIN, Y_MAX, Y_REST, FOLLOW_Y, VY_MAX, FOLLOW_X, VX_MAX,
    REST_FOLLOW, REST_VMAX, R_I, SHIELD, KICK_T, KEY_R, CHEST_COINS, CHEST_SX, LAND_X, LAND_Y, DECEL, KEY_FLOAT_AT, OPEN_KEY, OPEN_NOKEY, BLOOM_T,
    FLOWER_H, PSC, CRITTER_R, CRITTER_Y, BUG_R, CRITTER_VE, X_FIRST, TAIL, CLEAR_END,
    mulberry32, buildCourse, scrollAt, plantAt, enemyAt, keyAt, chestAt, ease, starsFor, Run, freshSave, migrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlightLogic = api;
})(typeof self !== 'undefined' ? self : this);
