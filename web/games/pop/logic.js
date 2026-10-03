/* Bubble Party: the rules. Pure logic, no DOM: test/games/pop/verify.js runs this same file in Node.
 * Bubbles carry sea creatures up the screen. Drag a bubble down onto the sand and drop it on the icon
 * of the creature inside to save it. Ten saved make a gold coin; enough coins and the treasure chest
 * appears. Grumpy creatures must not be saved: dropping one on the sand costs a coin (never below 0).
 * A cute creature dropped anywhere else simply bounces back up. No timers and nothing else to lose. */
(function (root) {
  'use strict';
  const TRAY = 10;   // saved creatures per gold coin
  const CUTE = ['fish', 'starfish', 'crab', 'turtle', 'seahorse', 'whale', 'puffer', 'octopus', 'jelly', 'angler'];
  const GRUMPS = ['urchin', 'eel', 'shark'];
  const GRUMP_COL = { urchin: '#8a55d6', eel: '#78a83a', shark: '#8796a8' };

  // Ten levels. coins: gold coins to reach the chest (each coin = 10 saved). kinds: the creature icons on
  // the sand, in the level's sea colours. speed: how fast bubbles rise (world units a second; the screen
  // is 540 tall). bubbles: most bubbles on screen at once. every: seconds between new bubbles.
  // grumpy: the chance that a new bubble carries a grumpy creature; maxGrumps: most grumps on screen at once.
  const LEVELS = [
    { scene: 0, coins: 3, speed: 32, bubbles: 3, every: [1.6, 2.4], grumpy: 0, maxGrumps: 0, grumps: [],
      kinds: [['fish', '#ff8c2e'], ['turtle', '#3fbf7f']] },
    { scene: 1, coins: 3, speed: 34, bubbles: 3, every: [1.5, 2.3], grumpy: 0, maxGrumps: 0, grumps: [],
      kinds: [['octopus', '#b86bff'], ['puffer', '#ffc93a']] },
    { scene: 2, coins: 4, speed: 36, bubbles: 3, every: [1.5, 2.2], grumpy: 0.12, maxGrumps: 1, grumps: ['urchin'],
      kinds: [['turtle', '#5fb84a'], ['whale', '#4f8ff0'], ['crab', '#ff7043']] },
    { scene: 3, coins: 5, speed: 38, bubbles: 4, every: [1.4, 2.1], grumpy: 0.15, maxGrumps: 1, grumps: ['urchin'],
      kinds: [['jelly', '#6ff5ff'], ['angler', '#8f86ff'], ['starfish', '#ffe066']] },
    { scene: 4, coins: 5, speed: 41, bubbles: 4, every: [1.3, 2.0], grumpy: 0.18, maxGrumps: 2, grumps: ['urchin', 'eel'],
      kinds: [['whale', '#ff8fc0'], ['octopus', '#ff8f6b'], ['seahorse', '#b77dff'], ['fish', 'rainbow']] },
    { scene: 0, coins: 6, speed: 44, bubbles: 4, every: [1.3, 1.9], grumpy: 0.20, maxGrumps: 2, grumps: ['urchin', 'eel'],
      kinds: [['fish', '#ff8c2e'], ['starfish', '#ff6f91'], ['crab', '#ff5a4f'], ['turtle', '#3fbf7f']] },
    { scene: 1, coins: 7, speed: 47, bubbles: 5, every: [1.2, 1.8], grumpy: 0.22, maxGrumps: 2, grumps: ['urchin', 'eel', 'shark'],
      kinds: [['octopus', '#b86bff'], ['puffer', '#ffc93a'], ['jelly', '#ff7ac8'], ['fish', '#3d8bff'], ['starfish', '#ffa53d']] },
    { scene: 2, coins: 8, speed: 50, bubbles: 5, every: [1.1, 1.7], grumpy: 0.25, maxGrumps: 2, grumps: ['urchin', 'eel', 'shark'],
      kinds: [['turtle', '#5fb84a'], ['whale', '#4f8ff0'], ['seahorse', '#ff9e3d'], ['crab', '#ff7043'], ['fish', '#ffd23f']] },
    { scene: 3, coins: 9, speed: 53, bubbles: 5, every: [1.0, 1.6], grumpy: 0.27, maxGrumps: 2, grumps: ['urchin', 'eel', 'shark'],
      kinds: [['jelly', '#6ff5ff'], ['angler', '#8f86ff'], ['octopus', '#ff7ad9'], ['starfish', '#ffe066'], ['fish', '#6dff9c'], ['seahorse', '#ffb86b']] },
    { scene: 4, coins: 10, speed: 56, bubbles: 6, every: [1.0, 1.5], grumpy: 0.30, maxGrumps: 2, grumps: ['urchin', 'eel', 'shark'],
      kinds: [['whale', '#ff8fc0'], ['puffer', '#6fd3ff'], ['octopus', '#ff8f6b'], ['seahorse', '#b77dff'], ['fish', 'rainbow'], ['turtle', '#5fd3a0'], ['crab', '#ff6b8a']] },
  ];
  const NLEV = LEVELS.length;

  const isGrumpy = (kind) => GRUMPS.includes(kind);
  function colourOf(level, kind) {
    if (isGrumpy(kind)) return GRUMP_COL[kind];
    const k = LEVELS[level - 1].kinds.find((q) => q[0] === kind);
    return k ? k[1] : '#ff8c2e';
  }

  // 3 stars with no grumpy creature dropped on the sand, 2 stars for one or two, else 1. Never about speed.
  function starsFor(grumpDrops) { return grumpDrops <= 0 ? 3 : grumpDrops <= 2 ? 2 : 1; }

  // One play of one level. drop() is the only thing that changes it, and it is what a real finger
  // runs (through game.js) and what window.__popDebug.drop() runs.
  class Run {
    constructor(level, saved) {
      const cfg = LEVELS[level - 1];
      if (!cfg) throw new Error('no level ' + level);
      this.level = level; this.cfg = cfg; this.target = cfg.coins;
      this.coins = 0;        // gold coins earned so far
      this.tray = [];        // the creatures counted toward the next coin (0..9 of them)
      this.trays = 0;        // trays completed this run (only ever goes up; numbers the batches of ten)
      this.grumpDrops = 0;   // grumpy creatures dropped on the sand
      this.saves = 0;        // creatures saved this run
      this.done = false;     // the chest has been reached
      const kinds = cfg.kinds.map((k) => k[0]);
      if (saved && typeof saved === 'object') {
        const c = Math.floor(Number(saved.coins));
        if (c > 0 && c < this.target) this.coins = c;
        if (Array.isArray(saved.tray)) this.tray = saved.tray.filter((k) => kinds.includes(k)).slice(0, TRAY - 1);
        const g = Math.floor(Number(saved.grumps));
        if (g > 0) this.grumpDrops = Math.min(g, 999);
        this.trays = this.coins;
      }
    }
    get count() { return this.tray.length; }
    get stars() { return starsFor(this.grumpDrops); }
    isIcon(kind) { return this.cfg.kinds.some((k) => k[0] === kind); }
    snapshot() { return { coins: this.coins, tray: this.tray.slice(), grumps: this.grumpDrops }; }
    // kind: the creature in the dropped bubble.
    // where: the icon it was dropped on (a kind), 'sand' (on the sand but not on an icon), or null (let go in the water).
    drop(kind, where) {
      if (this.done) return { type: 'ignored', kind, where };
      const onSand = where != null;
      if (isGrumpy(kind)) {
        if (!onSand) return { type: 'float', kind, where, grumpy: true };
        this.grumpDrops++;
        const coinLost = this.coins > 0;
        if (coinLost) this.coins--;
        return { type: 'grump', kind, where, grumpy: true, coinLost, coins: this.coins, count: this.tray.length };
      }
      if (where !== kind || !this.isIcon(kind)) return { type: onSand ? 'wrong' : 'float', kind, where, grumpy: false };
      this.saves++;
      this.tray.push(kind);
      const res = { type: 'saved', kind, where, grumpy: false, slot: this.tray.length - 1, batch: this.trays, coin: false, chest: false };
      if (this.tray.length >= TRAY) {
        this.tray = []; this.trays++; this.coins++; res.coin = true;
        if (this.coins >= this.target) { this.done = true; res.chest = true; }
      }
      res.coins = this.coins; res.count = this.tray.length;
      return res;
    }
  }

  // Where a released bubble lands. A magnetic snap first: if the bubble or the finger is within `snap`
  // of its own icon's edge, it goes home. Otherwise: the icon it covers (if any), the bare sand, or the water.
  // o: { kind, bx, by, br (the bubble), fx, fy (the finger), icons: [{ kind, x, y, r }], floor, snap }
  function resolveDrop(o) {
    const fx = o.fx == null ? o.bx : o.fx, fy = o.fy == null ? o.by : o.fy;
    const near = (ic) => Math.min(Math.hypot(o.bx - ic.x, o.by - ic.y), Math.hypot(fx - ic.x, fy - ic.y));
    const home = o.icons.find((ic) => ic.kind === o.kind);
    if (home && near(home) <= home.r + o.snap) return home.kind;
    let best = null, bd = Infinity;
    for (const ic of o.icons) {
      const d = near(ic);
      if (d <= ic.r + o.br * 0.45 && d < bd) { bd = d; best = ic; }
    }
    if (best) return best.kind;
    if (o.by >= o.floor + 8 || fy >= o.floor + 30) return 'sand';
    return null;
  }

  // Which creature the next bubble carries. rng: () => [0, 1).
  // st: { grumpsOnScreen, lastWasGrumpy, lastKind }. Grumps never come twice in a row and never crowd the sea.
  function pickSpawn(cfg, st, rng) {
    if (cfg.grumpy > 0 && !st.lastWasGrumpy && st.grumpsOnScreen < cfg.maxGrumps && rng() < cfg.grumpy) {
      return { kind: cfg.grumps[Math.floor(rng() * cfg.grumps.length)], grumpy: true };
    }
    const ks = cfg.kinds;
    let i = Math.floor(rng() * ks.length);
    if (ks.length > 1 && ks[i][0] === st.lastKind) i = (i + 1 + Math.floor(rng() * (ks.length - 1))) % ks.length;
    return { kind: ks[i][0], grumpy: false };
  }

  // ---- saving ----
  // v2: { v, unlocked, stars[10], runs: { level: { coins, tray, grumps } }, total, kinds, coins, chests, parties }
  // v1 (the tap-to-pop game, on real phones): { v: 1, scene, aquarium, total, kinds, filled }. Its lifetime
  // totals are kept; level progress starts at level 1 unlocked.
  const freshSave = () => ({ v: 2, unlocked: 1, stars: new Array(NLEV).fill(0), runs: {}, total: 0, kinds: {}, coins: 0, chests: 0, parties: 0 });
  function migrate(raw) {
    const sv = freshSave();
    let s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return sv; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
    const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
    const total = int(s.total, 0, 1e9);
    if (total != null) sv.total = total;
    if (plain(s.kinds)) for (const k of Object.keys(s.kinds)) if (CUTE.includes(k)) { const n = int(s.kinds[k], 0, 1e9); if (n != null) sv.kinds[k] = n; }
    if (!(Number(s.v) >= 2)) {
      sv.parties = int(s.filled, 0, 1e9) || 0;   // the old game's "ten friends" parties
      return sv;
    }
    sv.parties = int(s.parties, 0, 1e9) || 0;
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
        if (r.coins || r.tray.length || r.grumpDrops) sv.runs[n] = r.snapshot();
      }
    }
    return sv;
  }

  const api = { TRAY, CUTE, GRUMPS, GRUMP_COL, LEVELS, NLEV, isGrumpy, colourOf, starsFor, Run, resolveDrop, pickSpawn, freshSave, migrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PopLogic = api;
})(typeof self !== 'undefined' ? self : this);
