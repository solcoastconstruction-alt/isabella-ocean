/* Potion Colours: the rules. Pure logic, no DOM: test/games/potions/verify.js runs this same file in Node.
 * A flower wants a colour (a swatch in its thought bubble). Bottles of paint stand on the table; the child pours
 * one, two or three of them into the cauldron and the colours mix. A match makes the flower bloom in that colour;
 * a wrong mix burps a puff of cloud, empties the cauldron and costs nothing but a star. A pour can be undone
 * until the mix is finished. No timers, nothing to lose.
 *
 * THE MIXING TABLE below is the single source of truth: the swatch, the liquid and the bloom all take their
 * colour from it, so what the child sees in the bubble is exactly what the cauldron makes. docs/fairy/potions.md
 * lists the same table and test/games/potions/verify.js reads that file and compares. */
(function (root) {
  'use strict';
  const BOTTLES = ['red', 'yellow', 'blue', 'white', 'black'];   // the canonical order: tables, keys and shelves follow it
  const MODES = ['easy', 'medium', 'hard'];
  const NLEV = 20;
  const MAX_POUR = 3;          // the cauldron never takes more than three bottles

  // Every set of one, two or three bottles, with its display colour and (for the docs only) a child-friendly name.
  // Order of the bottles inside a set does not matter; the set is always written in BOTTLES order.
  const TABLE = [
    { set: ['red'], colour: '#e53935', name: 'red' },
    { set: ['yellow'], colour: '#ffd600', name: 'yellow' },
    { set: ['blue'], colour: '#1e6ff0', name: 'blue' },
    { set: ['white'], colour: '#ffffff', name: 'white' },
    { set: ['black'], colour: '#2b2b33', name: 'black' },
    { set: ['red', 'yellow'], colour: '#ff8a00', name: 'orange' },
    { set: ['yellow', 'blue'], colour: '#2fb344', name: 'green' },
    { set: ['red', 'blue'], colour: '#8e3fd0', name: 'purple' },
    { set: ['red', 'white'], colour: '#ff9ec4', name: 'pink' },
    { set: ['blue', 'white'], colour: '#8fd3ff', name: 'light blue' },
    { set: ['yellow', 'white'], colour: '#fff3a8', name: 'pale yellow' },
    { set: ['red', 'black'], colour: '#7a1630', name: 'maroon' },
    { set: ['blue', 'black'], colour: '#14246b', name: 'navy' },
    { set: ['yellow', 'black'], colour: '#9a9a10', name: 'olive' },
    { set: ['white', 'black'], colour: '#9a9aa8', name: 'grey' },
    { set: ['red', 'yellow', 'blue'], colour: '#8b5a2b', name: 'brown' },
    { set: ['red', 'yellow', 'white'], colour: '#ffb38a', name: 'peach' },
    { set: ['red', 'blue', 'white'], colour: '#c9a6ff', name: 'lavender' },
    { set: ['yellow', 'blue', 'white'], colour: '#a8f0c8', name: 'mint' },
    { set: ['red', 'yellow', 'black'], colour: '#c2410c', name: 'rust' },
    { set: ['red', 'blue', 'black'], colour: '#6a2c8a', name: 'plum' },
    { set: ['yellow', 'blue', 'black'], colour: '#1f7a3a', name: 'forest green' },
    { set: ['red', 'white', 'black'], colour: '#b5656f', name: 'dusty rose' },
    { set: ['yellow', 'white', 'black'], colour: '#c2b280', name: 'khaki' },
    { set: ['blue', 'white', 'black'], colour: '#5b73b0', name: 'slate blue' },
  ];
  const BY_KEY = {};

  // a set of bottles, in any order, as one canonical text key; null if it is not a legal set
  function mixKey(set) {
    if (!Array.isArray(set) || set.length < 1 || set.length > MAX_POUR) return null;
    const idx = [];
    for (const b of set) {
      const i = BOTTLES.indexOf(b);
      if (i < 0 || idx.includes(i)) return null;
      idx.push(i);
    }
    idx.sort((p, q) => p - q);
    return idx.map((i) => BOTTLES[i]).join('+');
  }
  for (const e of TABLE) BY_KEY[mixKey(e.set)] = e;
  // the colour a set of bottles makes (any order); null for an illegal set
  function mixColour(set) { const e = BY_KEY[mixKey(set)]; return e ? e.colour : null; }
  function mixName(set) { const e = BY_KEY[mixKey(set)]; return e ? e.name : null; }
  const BOTTLE_COLOUR = {};
  for (const b of BOTTLES) BOTTLE_COLOUR[b] = mixColour([b]);

  // Every way to reach `colour` from the bottles on a table: all subsets of one to three of them.
  function recipesFor(table, colour) {
    const out = [], n = table.length;
    for (let m = 1; m < (1 << n); m++) {
      const set = [];
      for (let i = 0; i < n; i++) if (m & (1 << i)) set.push(table[i]);
      if (set.length <= MAX_POUR && mixColour(set) === colour) out.push(set);
    }
    return out;
  }

  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function colourDistance(a, b) { const p = hexRgb(a), q = hexRgb(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- help by mode: how long a quiet spell before the hint hand, how generous the snap, the chest ----
  const HINT_S = { easy: 8, medium: 15, hard: 25 };
  const SNAP = { easy: 105, medium: 70, hard: 49 };      // world units beyond the cauldron's edge where a let-go bottle still snaps in
  const CHEST_COINS = { easy: 5, medium: 8, hard: 12 };

  // ---- the level table ----
  const S = (...ids) => ids.slice().sort((p, q) => BOTTLES.indexOf(p) - BOTTLES.indexOf(q));
  const RY = S('red', 'yellow'), YB = S('yellow', 'blue'), RB = S('red', 'blue');
  const RW = S('red', 'white'), BW = S('blue', 'white'), YW = S('yellow', 'white');
  const RK = S('red', 'black'), BK = S('blue', 'black'), YK = S('yellow', 'black'), WK = S('white', 'black');
  const SECONDARIES = [RY, YB, RB], PASTELS = [RW, BW, YW], DARKS = [RK, BK, YK];
  const ALL2 = [RY, YB, RB, RW, BW, YW, RK, BK, YK, WK];
  const RYB3 = S('red', 'yellow', 'blue');
  const TRIPLES = [RYB3, S('red', 'yellow', 'white'), S('red', 'blue', 'white'), S('yellow', 'blue', 'white'),
    S('red', 'yellow', 'black'), S('red', 'blue', 'black'), S('yellow', 'blue', 'black'),
    S('red', 'white', 'black'), S('yellow', 'white', 'black'), S('blue', 'white', 'black')];
  const LIGHT_TRIPLES = TRIPLES.slice(0, 4);   // the four three-bottle mixes with no black

  const RYB = ['red', 'yellow', 'blue'], RYBW = RYB.concat('white'), ALL5 = BOTTLES.slice();

  function bottlesOf(n, mode) {
    if (n <= 3) return RYB.slice();
    if (n <= 6) return RYBW.slice();
    if (n <= 10) return mode === 'easy' ? RYBW.slice() : ALL5.slice();
    return ALL5.slice();
  }
  // the two-bottle mixes a level may ask for
  function pool2Of(n, mode) {
    if (n === 1) return [RY, YB];
    if (n <= 3) return SECONDARIES.slice();
    if (mode === 'easy' && n <= 10) return n === 4 ? PASTELS.slice() : n === 5 ? PASTELS.concat([RY]) : PASTELS.concat(SECONDARIES);
    if (n === 4) return PASTELS.concat([RY]);
    if (n <= 6) return PASTELS.concat(SECONDARIES);
    if (n === 7) return DARKS.concat(PASTELS);
    if (n === 8) return DARKS.concat(PASTELS, SECONDARIES);
    return ALL2.slice();
  }
  // the three-bottle mixes a level may ask for (none until World 2)
  function pool3Of(n, mode) {
    if (mode === 'easy' || n <= 10) return [];
    if (mode === 'medium') return n < 14 ? [] : n <= 15 ? LIGHT_TRIPLES.slice() : TRIPLES.slice();
    return n <= 12 ? LIGHT_TRIPLES.slice() : TRIPLES.slice();
  }
  // how many rounds hold a three-bottle mix, and how many ask two flowers in a row (the last rounds of a level)
  const THREES = {
    medium: { 14: 1, 15: 1, 16: 2, 17: 2, 18: 2, 19: 3, 20: 3 },
    hard: { 11: 1, 12: 1, 13: 2, 14: 2, 15: 3, 16: 3, 17: 4, 18: 4, 19: 5, 20: 5 },
  };
  const DOUBLES = { hard: { 18: 2, 19: 3, 20: 4 } };
  const SINGLES = { 1: [0, 2], 2: [0], 3: [] };   // Easy levels 1-3: rounds where the flower may want a bottle on its own

  function levelCfg(n, mode) {
    n = Math.floor(n); if (!(n >= 1 && n <= NLEV) || !MODES.includes(mode)) throw new Error('no such level: ' + n + ' ' + mode);
    const world = n <= 10 ? 1 : 2, rounds = world === 1 ? 5 : 6;
    const threes = (THREES[mode] && THREES[mode][n]) || 0, doubles = (DOUBLES[mode] && DOUBLES[mode][n]) || 0;
    const singles = mode === 'easy' && SINGLES[n] ? SINGLES[n] : [];
    const plan = [];
    for (let r = 0; r < rounds; r++) {
      const fromEnd = rounds - 1 - r, three = fromEnd < threes, dbl = fromEnd < doubles;
      if (singles.includes(r)) plan.push([1]);
      else if (dbl) plan.push([three ? 3 : 2, 2]);
      else plan.push([three ? 3 : 2]);
    }
    return {
      n, mode, world, rounds, bottles: bottlesOf(n, mode), plan,
      pool2: pool2Of(n, mode), pool3: pool3Of(n, mode),
      decoys: n >= 16 ? 2 : 0,                       // from level 16 at least two bottles on the table are never needed
      dots: mode === 'easy' && n <= 3,               // Easy 1-3 show the needed colours as dots in the thought bubble
      hint: HINT_S[mode], snap: SNAP[mode], chest: CHEST_COINS[mode],
      flowers: plan.reduce((a, p) => a + p.length, 0),
    };
  }

  // ---- the rounds: dealt from a seed, one recipe a flower, checked to be the ONLY way to that colour ----
  const seedOf = (n, mode) => (0x504f5400 + n * 131 + MODES.indexOf(mode) * 7919) | 0;
  const keyOf = (set) => mixKey(set);
  function poolIncludes(pool, set) { const k = keyOf(set); return pool.some((p) => keyOf(p) === k); }

  function tryRounds(cfg, rng) {
    const prev = cfg.n > 1 ? levelCfg(cfg.n - 1, cfg.mode) : null;
    const pool = { 2: cfg.pool2, 3: cfg.pool3 };
    const fresh = (size, set) => !prev || !poolIncludes(size === 2 ? prev.pool2 : prev.pool3, set);
    const used = {}, rounds = [];
    let lastKey = '';
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    for (let r = 0; r < cfg.rounds; r++) {
      const flowers = [];
      for (let f = 0; f < cfg.plan[r].length; f++) {
        const size = cfg.plan[r][f];
        let rec;
        if (size === 1) {
          const cand = RYB.filter((b) => cfg.bottles.includes(b) && b !== lastKey && !(used[b] >= 2));
          rec = [pick(cand.length ? cand : RYB)];
        } else if (f === 0) {
          const all = pool[size].filter((s) => s.every((b) => cfg.bottles.includes(b)));
          let cand = all.filter((s) => keyOf(s) !== lastKey && !used[keyOf(s)]);
          if (!cand.length) cand = all.filter((s) => keyOf(s) !== lastKey && !(used[keyOf(s)] >= 2));
          if (!cand.length) cand = all.filter((s) => keyOf(s) !== lastKey);
          const fresh0 = cand.filter((s) => fresh(size, s) && !used[keyOf(s)]);
          rec = fresh0.length ? fresh0[0] : pick(cand);
        } else {
          // the second flower of a double round shares a bottle with the first, so the round needs at most three bottles
          const first = flowers[0].recipe;
          const cand = cfg.pool2.filter((s) => keyOf(s) !== keyOf(first) && s.every((b) => cfg.bottles.includes(b))
            && new Set(first.concat(s)).size <= 3 && (first.length < 3 || s.every((b) => first.includes(b))));
          if (!cand.length) return null;
          rec = pick(cand);
        }
        const colour = mixColour(rec);
        const ways = recipesFor(cfg.bottles, colour);
        if (ways.length !== 1 || keyOf(ways[0]) !== keyOf(rec)) return null;     // not reachable by exactly this one recipe: re-roll
        flowers.push({ recipe: rec.slice(), colour, size: rec.length });
        if (f === 0) { lastKey = keyOf(rec); used[lastKey] = (used[lastKey] || 0) + 1; }
      }
      rounds.push({ table: cfg.bottles.slice(), flowers });
    }
    return rounds;
  }
  const roundCache = {};
  function makeRounds(n, mode) {
    const key = n + mode;
    if (roundCache[key]) return roundCache[key];
    const cfg = levelCfg(n, mode);
    for (let attempt = 0; attempt < 200; attempt++) {
      const rounds = tryRounds(cfg, mulberry32(seedOf(n, mode) + attempt * 7919));
      if (rounds) return (roundCache[key] = rounds);
    }
    throw new Error('could not deal rounds for level ' + n + ' ' + mode);
  }

  // How hard a level is, measured from what it really asks (not from the settings), and one number for it.
  function difficulty(n, mode) {
    const cfg = levelCfg(n, mode), rounds = makeRounds(n, mode);
    let sizeSum = 0, flowerSum = 0, minSpare = 9;
    const targets = new Set();
    for (const rd of rounds) {
      const used = new Set();
      for (const fl of rd.flowers) { sizeSum += fl.size; flowerSum++; fl.recipe.forEach((b) => used.add(b)); targets.add(fl.colour); }
      minSpare = Math.min(minSpare, rd.table.length - used.size);
    }
    const d = {
      bottles: cfg.bottles.length, pours: sizeSum / cfg.rounds, pool: cfg.pool2.length + cfg.pool3.length, decoys: cfg.decoys, spare: minSpare, flowers: flowerSum / cfg.rounds,
      rounds: cfg.rounds, targets: targets.size, hint: cfg.hint, snap: cfg.snap, dots: cfg.dots,
    };
    d.score = d.bottles * 10 + d.pours * 25 + d.pool * 1.5 + d.decoys * 12 + (d.flowers - 1) * 40 + d.rounds * 6 + d.hint / 2 - (d.dots ? 5 : 0) - (d.snap / SNAP.medium - 1) * 20;
    return d;
  }

  const starsFor = (wrongs) => (wrongs === 0 ? 3 : wrongs <= 2 ? 2 : 1);

  // is a let-go bottle at (bx, by) near enough to the cauldron c = { x, y, r } to snap in?
  function overCauldron(bx, by, c, snap) { return Math.hypot(bx - c.x, by - c.y) <= c.r + snap; }

  // ---- one play of a level ----
  // phase: 'filling' (taking pours) -> 'mixing' (the last pour is in; a tap on the cauldron can still undo it)
  //        -> finish() -> 'settling' (the game shows the bloom or the burp) -> advance() -> 'filling' again, or 'done'.
  class Run {
    constructor(n, mode) {
      this.n = n; this.mode = mode; this.cfg = levelCfg(n, mode); this.rounds = makeRounds(n, mode);
      this.r = 0; this.f = 0; this.next = null;
      this.poured = []; this.phase = 'filling';
      this.wrongs = 0; this.blooms = 0; this.coins = 0; this.pours = 0; this.undos = 0; this.done = false;
    }
    get round() { return this.rounds[this.r]; }
    get flower() { return this.rounds[this.r].flowers[this.f]; }
    get table() { return this.rounds[this.r].table; }
    get stars() { return this.done ? starsFor(this.wrongs) : null; }
    pour(id) {
      if (this.done || this.phase !== 'filling') return { type: 'ignored', why: 'busy' };
      if (!this.table.includes(id)) return { type: 'ignored', why: 'absent' };
      if (this.poured.includes(id)) return { type: 'ignored', why: 'already' };
      this.poured.push(id); this.pours++;
      const complete = this.poured.length >= this.flower.recipe.length;
      if (complete) this.phase = 'mixing';
      return { type: 'poured', id, complete, colour: mixColour(this.poured) };
    }
    // take back the last pour while the mix is not yet finished; its bottle hops home
    undo() {
      if (this.done || (this.phase !== 'filling' && this.phase !== 'mixing') || !this.poured.length) return { type: 'ignored' };
      const id = this.poured.pop(); this.undos++;
      this.phase = 'filling';
      return { type: 'undone', id };
    }
    // the mix is done: does the cauldron hold the colour the flower asked for?
    finish() {
      if (this.phase !== 'mixing') return { type: 'ignored' };
      const had = this.poured.slice(), colour = mixColour(had);
      this.phase = 'settling';
      if (colour !== this.flower.colour) {
        this.wrongs++; this.poured = []; this.next = { r: this.r, f: this.f };
        return { type: 'wrong', colour, poured: had };
      }
      this.blooms++; this.coins++; this.poured = [];
      const lastFlower = this.f === this.round.flowers.length - 1;
      if (lastFlower && this.r === this.rounds.length - 1) { this.done = true; this.phase = 'done'; return { type: 'bloom', colour, coin: 1, roundDone: true, levelDone: true, stars: this.stars }; }
      this.next = lastFlower ? { r: this.r + 1, f: 0 } : { r: this.r, f: this.f + 1 };
      return { type: 'bloom', colour, coin: 1, roundDone: lastFlower, levelDone: false };
    }
    // after the bloom or the burp has been shown: the next flower (or the same one again)
    advance() {
      if (this.phase !== 'settling' || !this.next) return { type: 'ignored' };
      this.r = this.next.r; this.f = this.next.f; this.next = null; this.poured = []; this.phase = 'filling';
      return { type: 'advanced', r: this.r, f: this.f };
    }
    // what the hint hand should do now: tap a wrong pour's cauldron to take it back, or tap the first bottle still needed
    hint() {
      if (this.done || this.phase !== 'filling') return null;
      const rec = this.flower.recipe;
      if (this.poured.some((b) => !rec.includes(b))) return { kind: 'undo' };
      const id = this.table.find((b) => rec.includes(b) && !this.poured.includes(b));
      return id ? { kind: 'bottle', id } : null;
    }
  }

  // ---- saving: the shape every fairy game shares (docs/FAIRY.md) ----
  const int = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
  function freshSave() {
    const per = (v) => ({ easy: v(), medium: v(), hard: v() });
    return { v: 1, mode: 'easy', unlocked: per(() => 1), stars: per(() => new Array(NLEV).fill(0)), coins: 0, chests: 0, blooms: 0, wrongs: 0 };
  }
  function migrate(raw) {
    const sv = freshSave();
    let s = null;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    if (MODES.includes(s.mode)) sv.mode = s.mode;
    for (const m of MODES) {
      const st = s.stars && Array.isArray(s.stars[m]) ? s.stars[m] : [];
      sv.stars[m] = Array.from({ length: NLEV }, (_, i) => int(st[i], 0, 3, 0));
      const un = int(s.unlocked && s.unlocked[m], 1, NLEV, 1);
      let best = 0;
      sv.stars[m].forEach((v, i) => { if (v > 0) best = i + 1; });
      sv.unlocked[m] = Math.max(un, Math.min(NLEV, best + 1));
    }
    sv.coins = int(s.coins, 0, 1e9, 0); sv.chests = int(s.chests, 0, 1e9, 0);
    sv.blooms = int(s.blooms, 0, 1e9, 0); sv.wrongs = int(s.wrongs, 0, 1e9, 0);
    return sv;
  }
  // a level finished: keep the best stars, open the next level of that mode, add the coins
  function record(sv, mode, n, stars, coins, blooms, wrongs) {
    sv.stars[mode][n - 1] = Math.max(sv.stars[mode][n - 1], stars);
    sv.unlocked[mode] = Math.min(NLEV, Math.max(sv.unlocked[mode], n + 1));
    sv.coins += coins; sv.chests++; sv.blooms += blooms || 0; sv.wrongs += wrongs || 0;
    return sv;
  }
  const worldOpen = (sv, mode) => sv.unlocked[mode] > 10;   // World 2 opens when level 10 of that mode is finished

  const api = {
    BOTTLES, MODES, NLEV, MAX_POUR, TABLE, BOTTLE_COLOUR, HINT_S, SNAP, CHEST_COINS,
    mixKey, mixColour, mixName, recipesFor, colourDistance, levelCfg, makeRounds, difficulty, starsFor, overCauldron,
    Run, freshSave, migrate, record, worldOpen, seedOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PotionLogic = api;
})(typeof self !== 'undefined' ? self : this);
