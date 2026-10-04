/* Sea Catch: the rules. Pure logic, no DOM: test/games/catch/verify.js runs this same file in Node.
 * Sea friends drift down in bubbles. Isabella swims left and right near the sand, a big shell on her
 * head, easing toward the finger's x. A friend that lands in the shell is counted in the tray; ten make
 * a gold coin, and a rare golden friend is a whole coin by itself. Grumpy things (an urchin, an eel, a
 * shark, an old boot, a tin can) must be dodged: one in the shell is a gentle bonk that costs a coin
 * (never below 0). A friend that is missed costs nothing. Enough coins and the treasure chest comes.
 * No timers, no lives, and a level cannot be failed: grumps come less often the more she bumps. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const TRAY = 10;   // friends caught per gold coin
  const FRIENDS = ['fish', 'turtle', 'starfish', 'crab', 'seahorse', 'octopus', 'whale'];
  const GRUMPS = ['urchin', 'eel', 'shark', 'boot', 'can'];
  const GRUMP_COL = { urchin: '#8a55d6', eel: '#78a83a', shark: '#8796a8', boot: '#8a5a33', can: '#93a2b3' };
  const GOLD_COL = '#ffc928';

  // The world is 540 units tall and about 1200 wide (the screen's shape decides the width).
  const SPAWN_Y = -62;   // things appear just above the top of the screen...
  const CATCH_Y = 334;   // ...and fall to the mouth of the shell on Isabella's head...
  const LAND_Y = 516;    // ...or on past it, down behind the sand
  const R = 52;          // a friend's bubble (104 across: 19% of the screen's height)
  const EDGE = 84;       // nothing falls nearer than this to the sides of the screen
  const PX_MIN = 70;     // Isabella's shell stays this far inside the sides
  const HOME_X = 186, HOME_Y = 128;   // nothing starts its fall behind the home button (top left); game.js widens it if the button sits further in
  // What counts as "in the shell", measured from the shell's mouth to the thing's middle. Friends are
  // easy to catch (a wide, tall zone); a grump only counts when it truly lands in the shell.
  const FRIEND_ZONE = { hw: 84, up: 36, down: 44 };
  const GRUMP_ZONE = { hw: 48, up: 24, down: 24 };
  const FOLLOW = 9;      // she closes the gap to the finger at this rate (per second)...
  const VMAX = 1500;     // ...and never swims faster than this (units a second)
  const SHIELD = 1.5;    // after a bonk she is dizzy this long, and no other grump can bonk her
  const MERCY = 3;       // after a bonk the next few things are all friends
  const CALM = 0.5;      // every bonk makes grumps rarer: share / (1 + CALM * bonks)
  const GOLD_GAP = 20, GOLD_FIRST = 6;   // golden friends: seconds apart at least, and none at the very start
  // Fair spacing, checked whenever something new appears (tc: the time it reaches the shell's height, xc: where).
  const T_GG = 1.1, GAP_GG = 250;   // two grumps within T_GG seconds of each other leave a gap to stand in
  const T_FG = 0.7, Y_FG = 150, SEP_FG = 130;   // a friend and a grump arriving within T_FG seconds, or within Y_FG units
                                    // of height, are well apart sideways: the friend can be caught without the grump
  const Y_FF = 2 * R + 6, SEP_FF = 110;   // friends less than a bubble apart in height do not overlap sideways

  // Ten levels. coins: gold coins to reach the chest. speed: how fast things fall (units a second; the fall
  // to the shell is 396 units). atOnce: most things in the water at once. every: seconds between new ones.
  // grumpy: the chance that a new thing is a grump; maxGrumps: most grumps in the water at once.
  // drift: sideways slide (units a second, at most); zig: zig-zag width (units either side, at most);
  // moving: the share of things that drift or zig-zag. gold: the chance that a new friend is the golden one.
  const LEVELS = [
    { scene: 0, coins: 2, speed: 78, atOnce: 2, every: [2.1, 2.8], grumpy: 0, maxGrumps: 0, grumps: [], drift: 0, zig: 0, moving: 0, gold: 0.06,
      kinds: [['fish', '#ff8c2e'], ['turtle', '#3fbf7f'], ['starfish', '#ff6f91']] },
    { scene: 1, coins: 3, speed: 86, atOnce: 2, every: [1.9, 2.5], grumpy: 0, maxGrumps: 0, grumps: [], drift: 0, zig: 0, moving: 0, gold: 0.06,
      kinds: [['crab', '#ff5a4f'], ['octopus', '#ff8fc0'], ['fish', '#3d8bff']] },
    { scene: 2, coins: 4, speed: 95, atOnce: 3, every: [1.15, 1.6], grumpy: 0.12, maxGrumps: 1, grumps: ['urchin'], drift: 0, zig: 0, moving: 0, gold: 0.05,
      kinds: [['turtle', '#3fbf7f'], ['seahorse', '#ff9e3d'], ['fish', '#ff8c2e'], ['starfish', '#ff6f91']] },
    { scene: 3, coins: 4, speed: 104, atOnce: 3, every: [1.05, 1.45], grumpy: 0.15, maxGrumps: 1, grumps: ['urchin', 'boot'], drift: 0, zig: 0, moving: 0, gold: 0.05,
      kinds: [['whale', '#5aa9ff'], ['crab', '#ff7043'], ['octopus', '#ff8fc0'], ['starfish', '#ff9e3d']] },
    { scene: 4, coins: 5, speed: 114, atOnce: 3, every: [1.0, 1.35], grumpy: 0.18, maxGrumps: 1, grumps: ['urchin', 'boot', 'eel'], drift: 18, zig: 0, moving: 0.5, gold: 0.045,
      kinds: [['fish', 'rainbow'], ['turtle', '#5fd3a0'], ['seahorse', '#ff8fc0'], ['crab', '#ff5a4f'], ['whale', '#5aa9ff']] },
    { scene: 0, coins: 5, speed: 124, atOnce: 4, every: [0.7, 0.95], grumpy: 0.20, maxGrumps: 2, grumps: ['urchin', 'boot', 'eel'], drift: 26, zig: 0, moving: 0.6, gold: 0.04,
      kinds: [['fish', '#ff8c2e'], ['starfish', '#ff6f91'], ['octopus', '#ff8f6b'], ['turtle', '#3fbf7f'], ['seahorse', '#4fc3f7']] },
    { scene: 1, coins: 6, speed: 135, atOnce: 4, every: [0.62, 0.86], grumpy: 0.22, maxGrumps: 2, grumps: ['urchin', 'boot', 'eel', 'can'], drift: 30, zig: 24, moving: 0.6, gold: 0.04,
      kinds: [['crab', '#ff5a4f'], ['whale', '#ff8fc0'], ['fish', '#3d8bff'], ['starfish', '#ff9e3d'], ['octopus', '#ff8fc0'], ['turtle', '#5fd3a0']] },
    { scene: 2, coins: 7, speed: 146, atOnce: 4, every: [0.58, 0.8], grumpy: 0.25, maxGrumps: 2, grumps: ['urchin', 'boot', 'eel', 'can', 'shark'], drift: 30, zig: 34, moving: 0.7, gold: 0.035,
      kinds: [['seahorse', '#ff9e3d'], ['turtle', '#3fbf7f'], ['fish', '#ff8c2e'], ['crab', '#ff7043'], ['whale', '#5aa9ff'], ['starfish', '#ff6f91']] },
    { scene: 3, coins: 8, speed: 158, atOnce: 5, every: [0.44, 0.6], grumpy: 0.27, maxGrumps: 2, grumps: ['urchin', 'boot', 'eel', 'can', 'shark'], drift: 34, zig: 42, moving: 0.8, gold: 0.03,
      kinds: [['octopus', '#ff7ad9'], ['fish', '#6dff9c'], ['starfish', '#ff9e3d'], ['seahorse', '#6ff5ff'], ['crab', '#ff5a4f'], ['whale', '#5aa9ff'], ['turtle', '#5fd3a0']] },
    { scene: 4, coins: 10, speed: 170, atOnce: 5, every: [0.4, 0.56], grumpy: 0.30, maxGrumps: 3, grumps: ['urchin', 'boot', 'eel', 'can', 'shark'], drift: 36, zig: 50, moving: 0.9, gold: 0.03,
      kinds: [['fish', 'rainbow'], ['whale', '#ff8fc0'], ['octopus', '#ff8f6b'], ['seahorse', '#4fc3f7'], ['turtle', '#5fd3a0'], ['crab', '#ff6b8a'], ['starfish', '#ff6f91']] },
  ];
  const NLEV = LEVELS.length;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const isGrumpy = (kind) => GRUMPS.includes(kind);
  function colourOf(level, kind, gold) {
    if (gold) return GOLD_COL;
    if (isGrumpy(kind)) return GRUMP_COL[kind];
    const k = LEVELS[level - 1].kinds.find((q) => q[0] === kind);
    return k ? k[1] : '#ff8c2e';
  }
  // 3 stars with no grump in the shell, 2 stars for one or two, else 1. Never about speed.
  function starsFor(bonks) { return bonks <= 0 ? 3 : bonks <= 2 ? 2 : 1; }

  // ---- where a falling thing is: a pure function of the time, so it can be known ahead ----
  // it: { t0 (when it appeared), x0, vy, vx, amp, om, ph, sph (= sin ph) }
  function itemX(it, t) {
    const a = t - it.t0;
    return it.x0 + it.vx * a + (it.amp ? it.amp * (Math.sin(it.om * a + it.ph) - it.sph) : 0);
  }
  function itemY(it, t) { return SPAWN_Y + it.vy * (t - it.t0); }
  const zoneOf = (it) => (it.grumpy ? GRUMP_ZONE : FRIEND_ZONE);
  // is the thing in the shell, with the shell's middle at px?
  function inShell(it, x, y, px) {
    const z = zoneOf(it), dy = y - CATCH_Y;
    return dy >= -z.up && dy <= z.down && Math.abs(x - px) <= z.hw;
  }

  // ---- what falls, and when. The plan depends only on the level, the screen's width, the seed and the
  // bonks so far, never on how well she is doing, so a test can read the whole plan ahead of time. ----
  class Spawner {
    constructor(level, vw, seed) {
      this.cfg = LEVELS[level - 1]; this.level = level; this.vw = vw; this.homeX = HOME_X;
      this.rng = mulberry32((seed >>> 0) || 1);
      this.nextAt = -1.2;    // the first friend is already on its way down when the level opens
      this.n = 0; this.nextId = 1;
      this.sched = [];       // things still above the shell (and a moment after)
      this.lastGrumpy = false; this.lastKind = ''; this.lastGold = -1e9; this.mercy = 0;
      this.tFG = Math.max(T_FG, Y_FG / this.cfg.speed); this.tFF = Y_FF / this.cfg.speed;   // the spacing rules, in seconds at this level's speed
      this.postponed = 0;
    }
    liveAt(t, grumpyOnly) {
      let n = 0;
      for (const e of this.sched) if (e.tOut > t && (!grumpyOnly || e.grumpy)) n++;
      return n;
    }
    // The next thing to appear by time `now`, or null. Call until it returns null.
    next(now, bonks) {
      if (now < this.nextAt) return null;
      const t0 = this.nextAt, cfg = this.cfg, rng = this.rng;
      for (let i = this.sched.length - 1; i >= 0; i--) if (this.sched[i].tOut < t0 - 2) this.sched.splice(i, 1);
      if (this.liveAt(t0) >= cfg.atOnce) { this.nextAt = t0 + 0.1; return null; }
      const it = this.make(t0, bonks || 0);
      if (!it) { this.nextAt = t0 + 0.15; this.postponed++; return null; }
      this.nextAt = t0 + cfg.every[0] + (cfg.every[1] - cfg.every[0]) * rng();
      return it;
    }
    make(t0, bonks) {
      const cfg = this.cfg, rng = this.rng;
      let cls = 'friend';
      const share = cfg.grumpy / (1 + CALM * bonks);
      if (share > 0 && this.n >= 2 && this.mercy <= 0 && !this.lastGrumpy && this.liveAt(t0, true) < cfg.maxGrumps && rng() < share) cls = 'grump';
      else if (cfg.gold > 0 && t0 >= GOLD_FIRST && t0 - this.lastGold >= GOLD_GAP && rng() < cfg.gold) cls = 'gold';
      let it = this.place(t0, cls === 'grump');
      if (!it && cls === 'grump') { cls = 'friend'; it = this.place(t0, false); }   // no fair spot for a grump: a friend instead
      if (!it) return null;
      if (cls === 'grump') {
        it.kind = cfg.grumps[Math.floor(rng() * cfg.grumps.length)];
      } else {
        const ks = cfg.kinds;
        let i = Math.floor(rng() * ks.length);
        if (ks.length > 1 && ks[i][0] === this.lastKind) i = (i + 1 + Math.floor(rng() * (ks.length - 1))) % ks.length;
        it.kind = ks[i][0]; this.lastKind = it.kind;
        if (cls === 'gold') { it.gold = true; this.lastGold = t0; }
      }
      it.col = colourOf(this.level, it.kind, it.gold);
      it.id = this.nextId++;
      this.lastGrumpy = it.grumpy;
      if (this.mercy > 0) this.mercy--;
      this.n++;
      this.sched.push(it);
      return it;
    }
    // a path for a new thing that is fair to everything already falling, or null
    place(t0, grumpy) {
      const cfg = this.cfg, rng = this.rng, vw = this.vw;
      for (let k = 0; k < 24; k++) {
        const vy = cfg.speed * (0.93 + 0.14 * rng()), ac = (CATCH_Y - SPAWN_Y) / vy, calm = k >= 12 ? 0.5 : 1;
        let vx = 0, amp = 0, om = 0, ph = 0;
        if (cfg.drift > 0 && rng() < cfg.moving) vx = (rng() * 2 - 1) * cfg.drift * calm;
        if (cfg.zig > 0 && rng() < cfg.moving) { amp = cfg.zig * (0.6 + 0.4 * rng()) * calm; om = 1.5 + 0.8 * rng(); ph = rng() * TAU; }
        const xc = EDGE + rng() * (vw - 2 * EDGE), sph = Math.sin(ph);
        const x0 = xc - vx * ac - (amp ? amp * (Math.sin(om * ac + ph) - sph) : 0);
        const z = grumpy ? GRUMP_ZONE : FRIEND_ZONE;
        const it = { id: 0, kind: '', col: '', grumpy, gold: false, t0, x0, vy, vx, amp, om, ph, sph, r: R,
          tc: t0 + ac, xc, tOut: t0 + (CATCH_Y + z.down - SPAWN_Y) / vy, x: x0, y: SPAWN_Y, past: false };
        if (this.fits(it)) return it;
      }
      return null;
    }
    fits(it) {
      const vw = this.vw, aLand = (LAND_Y - SPAWN_Y) / it.vy, aHome = (HOME_Y - SPAWN_Y) / it.vy;
      // the whole fall stays on the screen...
      for (let j = 0; j <= 24; j++) {
        const x = itemX(it, it.t0 + (aLand * j) / 24);
        if (x < EDGE - 20 || x > vw - EDGE + 20) return false;
      }
      // ...and the top of it is clear of the home button
      for (let j = 0; j <= 10; j++) if (itemX(it, it.t0 + (aHome * j) / 10) < this.homeX) return false;
      for (const e of this.sched) {
        const dt = Math.abs(it.tc - e.tc), dx = Math.abs(it.xc - e.xc);
        if (it.grumpy && e.grumpy) { if (dt < T_GG && dx < GAP_GG) return false; }
        else if (it.grumpy !== e.grumpy) { if (dt < this.tFG && dx < SEP_FG) return false; }
        else if (dt < this.tFF && dx < SEP_FF) return false;
        // and it never appears on top of something that has only just appeared
        if (itemY(e, it.t0) < SPAWN_Y + 2 * R + 12 && Math.abs(it.x0 - itemX(e, it.t0)) < 2 * R + 8) return false;
      }
      return true;
    }
  }

  // One play of one level: the coins and the tray (what is saved), and the water (Isabella and what is falling).
  // step() moves everything on; apply() is the one place the rules change the coins, and it is what a real
  // catch runs and what window.__catchDebug.catchItem() runs.
  class Run {
    constructor(level, saved, o) {
      const cfg = LEVELS[level - 1];
      if (!cfg) throw new Error('no level ' + level);
      o = o || {};
      this.level = level; this.cfg = cfg; this.target = cfg.coins;
      this.coins = 0;      // gold coins earned so far
      this.tray = [];      // the friends counted toward the next coin (0..9 of them)
      this.trays = 0;      // trays completed this run (only ever goes up; numbers the batches of ten)
      this.bonks = 0;      // grumps caught
      this.catches = 0;    // friends caught this run
      this.golds = 0;      // golden friends caught this run
      this.misses = 0;     // friends that got past (nothing is lost)
      this.done = false;   // the chest has been reached
      const kinds = cfg.kinds.map((k) => k[0]);
      if (saved && typeof saved === 'object') {
        const c = Math.floor(Number(saved.coins));
        if (c > 0 && c < this.target) this.coins = c;
        if (Array.isArray(saved.tray)) this.tray = saved.tray.filter((k) => kinds.includes(k)).slice(0, TRAY - 1);
        const b = Math.floor(Number(saved.bonks));
        if (b > 0) this.bonks = Math.min(b, 999);
        this.trays = this.coins;
      }
      this.vw = o.vw > 0 ? o.vw : 1200;
      this.t = 0;
      this.px = this.vw / 2; this.aim = this.px; this.vel = 0;   // the shell's middle, where the finger wants it, and its speed
      this.shield = 0;     // seconds of dizziness left
      this.items = [];     // what is falling
      this.spawner = new Spawner(level, this.vw, o.seed == null ? 1 : o.seed);
      this.paused = false; // no new things (a test hook)
    }
    get count() { return this.tray.length; }
    get stars() { return starsFor(this.bonks); }
    snapshot() { return { coins: this.coins, tray: this.tray.slice(), bonks: this.bonks }; }
    setWidth(vw) { this.vw = vw; this.spawner.vw = vw; this.px = clamp(this.px, PX_MIN, vw - PX_MIN); this.aim = clamp(this.aim, PX_MIN, vw - PX_MIN); }

    // Move on by dt seconds. finger: the finger's x (world units), or null while no finger is down.
    // What happened is pushed onto `out`: { type: 'spawn' | 'catch' | 'gold' | 'bonk' | 'miss' | 'gone', item, ... }.
    step(dt, finger, out) {
      if (finger != null) this.aim = clamp(finger, PX_MIN, this.vw - PX_MIN);
      const lim = VMAX * dt, d = clamp((this.aim - this.px) * (1 - Math.exp(-FOLLOW * dt)), -lim, lim);
      this.px += d; this.vel = dt > 0 ? d / dt : 0;
      this.t += dt;
      if (this.shield > 0) this.shield = Math.max(0, this.shield - dt);
      if (!this.done && !this.paused) {
        let it;
        while ((it = this.spawner.next(this.t, this.bonks))) { this.items.push(it); if (out) out.push({ type: 'spawn', item: it }); }
      }
      const items = this.items, t = this.t;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!it.still) { it.x = itemX(it, t); it.y = itemY(it, t); }
        if (!it.past && !this.done) {
          if (it.y - CATCH_Y > zoneOf(it).down) {
            it.past = true;
            if (!it.grumpy) { this.misses++; if (out) out.push({ type: 'miss', item: it }); }
          } else if (inShell(it, it.x, it.y, this.px) && !(it.grumpy && this.shield > 0)) {
            items.splice(i, 1);
            const res = this.apply(it);
            if (out) out.push(res);
            continue;
          }
        }
        if (it.y > LAND_Y) { items.splice(i, 1); if (out) out.push({ type: 'gone', item: it }); }
      }
    }
    // Put one thing in the water by hand (the tests and window.__catchDebug.spawn): it falls straight down at x,
    // already at height y. o: { kind, x, y, gold, still (it hangs where it is) }
    addItem(o) {
      const cfg = this.cfg, kind = o.kind || cfg.kinds[0][0], grumpy = isGrumpy(kind), gold = !!o.gold && !grumpy;
      const vy = cfg.speed, y = o.y == null ? SPAWN_Y : o.y, t0 = this.t - (y - SPAWN_Y) / vy, z = grumpy ? GRUMP_ZONE : FRIEND_ZONE;
      const it = { id: this.spawner.nextId++, kind, col: colourOf(this.level, kind, gold), grumpy, gold, t0, x0: o.x, vy, vx: 0, amp: 0, om: 0, ph: 0, sph: 0, r: R,
        tc: t0 + (CATCH_Y - SPAWN_Y) / vy, xc: o.x, tOut: t0 + (CATCH_Y + z.down - SPAWN_Y) / vy, x: o.x, y, past: false, still: !!o.still };
      this.items.push(it);
      return it;
    }
    // The thing has landed in the shell.
    apply(it) {
      if (this.done) return { type: 'ignored', item: it };
      if (it.grumpy) {
        this.bonks++; this.shield = SHIELD; this.spawner.mercy = MERCY;
        const coinLost = this.coins > 0;
        if (coinLost) this.coins--;
        return { type: 'bonk', item: it, coinLost, coins: this.coins, count: this.tray.length };
      }
      if (it.gold) {
        this.golds++; this.coins++;
        const res = { type: 'gold', item: it, coin: true, chest: false, coins: this.coins, count: this.tray.length };
        if (this.coins >= this.target) { this.done = true; res.chest = true; }
        return res;
      }
      this.catches++;
      this.tray.push(it.kind);
      const res = { type: 'catch', item: it, slot: this.tray.length - 1, batch: this.trays, coin: false, chest: false };
      if (this.tray.length >= TRAY) {
        this.tray = []; this.trays++; this.coins++; res.coin = true;
        if (this.coins >= this.target) { this.done = true; res.chest = true; }
      }
      res.coins = this.coins; res.count = this.tray.length;
      return res;
    }
  }

  // ---- saving ----
  // { v, unlocked, stars[10], runs: { level: { coins, tray, bonks } }, total, golds, coins, chests }
  const freshSave = () => ({ v: 1, unlocked: 1, stars: new Array(NLEV).fill(0), runs: {}, total: 0, golds: 0, coins: 0, chests: 0 });
  function migrate(raw) {
    const sv = freshSave();
    let s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return sv; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
    const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
    sv.total = int(s.total, 0, 1e9) || 0;
    sv.golds = int(s.golds, 0, 1e9) || 0;
    sv.coins = int(s.coins, 0, 1e9) || 0;
    sv.chests = int(s.chests, 0, 1e9) || 0;
    const stars = Array.isArray(s.stars) ? s.stars : [];
    sv.stars = Array.from({ length: NLEV }, (_, i) => int(stars[i], 0, 3) || 0);
    const beaten = sv.stars.reduce((m, st, i) => (st > 0 ? i + 1 : m), 0);
    sv.unlocked = Math.min(NLEV, Math.max(int(s.unlocked, 1, NLEV) || 1, beaten + 1));
    if (plain(s.runs)) {
      for (const key of Object.keys(s.runs)) {
        const n = int(key, 1, NLEV);
        if (n == null || String(n) !== key || n > sv.unlocked) continue;
        const r = new Run(n, s.runs[key]);
        if (r.coins || r.tray.length || r.bonks) sv.runs[n] = r.snapshot();
      }
    }
    return sv;
  }

  const api = { TRAY, FRIENDS, GRUMPS, GRUMP_COL, GOLD_COL, LEVELS, NLEV,
    SPAWN_Y, CATCH_Y, LAND_Y, R, EDGE, PX_MIN, HOME_X, HOME_Y, FRIEND_ZONE, GRUMP_ZONE, FOLLOW, VMAX, SHIELD, MERCY, CALM,
    GOLD_GAP, GOLD_FIRST, T_GG, GAP_GG, T_FG, Y_FG, SEP_FG, Y_FF, SEP_FF,
    mulberry32, isGrumpy, colourOf, starsFor, itemX, itemY, zoneOf, inShell, Spawner, Run, freshSave, migrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatchLogic = api;
})(typeof self !== 'undefined' ? self : this);
