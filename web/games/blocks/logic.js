/* Treasure Blocks — the rules. Pure logic, no DOM: test/games/blocks/verify.js runs this same file in Node.
 *
 * Sea blocks sink into a well that has a picture of Isabella behind it. Slide and turn each piece as it sinks;
 * a row filled from wall to wall sparkles away, everything above it settles down, and it pays a gold coin (more
 * for several rows at once). Each round has a row goal: reach it and a key opens the treasure chest.
 *
 * Kind by design:
 *   - Easy never ends: when the blocks reach the top a wave washes the bottom rows away and play goes on.
 *   - Medium and Hard end a round when the well is full, with no penalty: every coin earned is kept.
 *   - A piece that has landed waits a moment before it settles, so a slow finger can still slide it.
 *
 * Every game is new: the pieces come from a seed through a fair "bag" (each bag holds every piece of the mode,
 * shuffled), so nothing is ever missing for long. The same seed always deals the same game, which is how the
 * tests replay one; the game itself asks for a fresh random seed every time.
 *
 * The well: cell (x, y), x across from the left wall, y down from the top. grid[y * W + x] is 0 when empty, or the
 * block's look (1..STYLES). A piece lives in a square box n cells across whose top-left corner is (x, y); a turn
 * turns the box a quarter turn clockwise, so four turns always bring a piece back exactly where it was. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- the pieces
  // '#' is a block. Small pieces of 1 to 3 blocks, the 4-block shapes, and three 5-block shapes for Hard.
  // Every piece appears lying down, at most two rows tall, so "the blocks have reached the top" means just that.
  const SHAPES = {
    pebble: ['#'],
    twin: ['##', '..'],
    reed: ['...', '###', '...'],
    nook: ['#.', '##'],
    plank: ['....', '####', '....', '....'],
    crate: ['##', '##'],
    anchor: ['.#.', '###', '...'],
    hookL: ['..#', '###', '...'],
    hookR: ['#..', '###', '...'],
    waveL: ['.##', '##.', '...'],
    waveR: ['##.', '.##', '...'],
    cup: ['#.#', '###', '...'],
    flag: ['###', '##.', '...'],
    oar: ['....', '####', '#...', '....'],
  };
  const PIECE_IDS = Object.keys(SHAPES);
  const STYLES = 6;   // the looks a piece can have: shell, coral, sand, bubble, kelp, star (art.js draws them)

  function buildPiece(id) {
    const rowsOf = SHAPES[id], n = rowsOf.length;
    let cells = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (rowsOf[y][x] === '#') cells.push([x, y]);
    const rots = [];
    for (let r = 0; r < 4; r++) {
      rots.push(cells.map((c) => c.slice()));
      cells = cells.map(([x, y]) => [n - 1 - y, x]);   // a quarter turn clockwise (y is down)
    }
    // how many of the four turns look different (a crate: 1; a plank: 2; a hook: 4)
    const key = (cs) => { const mx = Math.min(...cs.map((c) => c[0])), my = Math.min(...cs.map((c) => c[1])); return cs.map(([x, y]) => (x - mx) + ',' + (y - my)).sort().join(' '); };
    return { id, n, size: rots[0].length, rots, distinct: new Set(rots.map(key)).size, top: Math.min(...rots[0].map((c) => c[1])) };
  }
  const PIECES = {};
  for (const id of PIECE_IDS) PIECES[id] = buildPiece(id);

  // A turn that does not fit where it is tries these nudges in order: sideways first, then up off the floor,
  // then down, then two sideways (the long plank against a wall).
  const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1], [-2, 0], [2, 0]];

  // ---------------------------------------------------------------- the three modes
  // cols x rows: the well. goal: rows to finish a round. speed: seconds a piece takes to sink one cell at the
  // start; accel: how much quicker per row cleared; fastest: the quickest it ever gets. lockDelay: seconds a
  // landed piece can still be slid before it settles. dropGuard: seconds after a piece appears before "drop"
  // works (so a double tap does not throw the next piece down too). wave: Easy only, the rows a wave washes away
  // when the blocks reach the top (0 = the round ends instead). bag: how many of each piece are in one bag.
  const MODES = {
    easy: { id: 'easy', cols: 6, rows: 9, goal: 6, speed: 1.0, accel: 0, fastest: 1.0, lockDelay: 0.9, dropGuard: 0.35, wave: 4,
      bag: { pebble: 2, twin: 3, reed: 2, nook: 3 } },
    medium: { id: 'medium', cols: 7, rows: 11, goal: 8, speed: 0.7, accel: 0, fastest: 0.7, lockDelay: 0.6, dropGuard: 0.2, wave: 0,
      bag: { pebble: 1, twin: 1, reed: 1, nook: 2, crate: 1, plank: 1, anchor: 1, hookL: 1, hookR: 1, waveL: 1, waveR: 1 } },
    hard: { id: 'hard', cols: 8, rows: 13, goal: 10, speed: 0.6, accel: 0.015, fastest: 0.22, lockDelay: 0.45, dropGuard: 0.12, wave: 0,
      bag: { pebble: 1, reed: 1, nook: 1, crate: 1, plank: 1, anchor: 1, hookL: 1, hookR: 1, waveL: 1, waveR: 1, cup: 1, flag: 1, oar: 1 } },
  };
  const MODE_IDS = ['easy', 'medium', 'hard'];
  const CLEAR_T = 0.55;    // a full row sparkles this long before it goes
  const REST_T = 0.16;     // a breath between one piece settling and the next appearing
  const WAVE_T = 1.3;      // Easy's wave takes this long to wash through
  const MAX_RESETS = 8;    // a landed piece can be slid or turned this many times before it settles anyway

  // Coins for rows cleared by one piece: one each, and a bonus for several at once.
  const BONUS = [0, 0, 1, 2, 4, 6];
  const coinsFor = (n) => (n <= 0 ? 0 : n + BONUS[Math.min(n, BONUS.length - 1)]);

  // ---------------------------------------------------------------- seeded randomness
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngFor = (seed) => mulberry32((0x9E3779B1 ^ Math.imul(seed >>> 0, 2654435761)) >>> 0);
  function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // a brand-new seed for a brand-new game
  function freshSeed() {
    try { const a = new Uint32Array(1); (root.crypto || globalThis.crypto).getRandomValues(a); return a[0]; } catch (e) { return (Math.random() * 4294967296) >>> 0; }
  }

  // The fair bag: every piece of the mode, as many times as the mode says, shuffled; when it runs out, a new one.
  // The same piece never comes three times running, not even across two bags.
  class Bag {
    constructor(counts, rng) {
      this.pool = [];
      for (const id of Object.keys(counts)) for (let k = 0; k < counts[id]; k++) this.pool.push(id);
      this.size = this.pool.length;
      this.rng = rng; this.queue = []; this.at = 0; this.last = null; this.prev = null;
    }
    refill() {
      let a = null;
      for (let tries = 0; tries < 60; tries++) {
        a = shuffle(this.pool, this.rng);
        let ok = true, p2 = this.prev, p1 = this.last;
        for (let i = 0; i < a.length && ok; i++) { if (a[i] === p1 && a[i] === p2) ok = false; p2 = p1; p1 = a[i]; }
        if (ok) break;
      }
      this.queue = a; this.at = 0;
    }
    next() {
      if (this.at >= this.queue.length) this.refill();
      const id = this.queue[this.at++];
      this.prev = this.last; this.last = id;
      return id;
    }
  }

  // ---------------------------------------------------------------- one game
  const NO_EVENTS = Object.freeze([]);   // what takeEvents() hands back when nothing happened (so a quiet frame makes no garbage)
  class Game {
    constructor(modeId, seed) {
      const M = MODES[modeId];
      if (!M) throw new Error('unknown mode ' + modeId);
      this.mode = modeId; this.M = M; this.W = M.cols; this.H = M.rows; this.goal = M.goal;
      this.seed = (seed == null ? freshSeed() : seed) >>> 0;
      this.bag = new Bag(M.bag, rngFor(this.seed));
      this.styleRng = rngFor((this.seed ^ 0x5bd1e995) >>> 0);
      this.lastStyle = 0;
      this.grid = new Uint8Array(this.W * this.H);
      this.cur = null;              // the sinking piece: { id, style, rot, x, y }
      this.next = this.deal();      // the one after it: { id, style }
      this.phase = 'rest';          // fall | clear | rest | wave | goal | over
      this.timer = 0;
      this.round = 1;               // rounds in this game (each ends at the row goal; "keep going" starts the next)
      this.rowsDone = 0;            // rows cleared this round
      this.rowsAll = 0;             // rows cleared this game
      this.coins = 0;               // coins earned this game
      this.roundCoins = 0;          // coins earned this round (what the chest gives)
      this.pieces = 0;              // pieces settled
      this.waves = 0;               // Easy: waves so far
      this.clearing = [];           // the full rows that are sparkling (phase 'clear')
      this.fallT = 0; this.restT = 0; this.resets = 0; this.age = 0;
      this.events = [];
      this.spawn();
    }
    emit(e) { if (this.events.length < 256) this.events.push(e); }
    takeEvents() { if (!this.events.length) return NO_EVENTS; const e = this.events; this.events = []; return e; }

    deal() {
      let style = 1 + Math.floor(this.styleRng() * STYLES);
      if (style === this.lastStyle) style = 1 + (style % STYLES);   // never the same look twice running
      this.lastStyle = style;
      return { id: this.bag.next(), style };
    }
    // seconds a piece takes to sink one cell right now
    interval() { return Math.max(this.M.fastest, this.M.speed - this.M.accel * this.rowsAll); }

    fits(id, rot, x, y) {
      const cells = PIECES[id].rots[rot], W = this.W, H = this.H, g = this.grid;
      for (let i = 0; i < cells.length; i++) {
        const cx = x + cells[i][0], cy = y + cells[i][1];
        if (cx < 0 || cx >= W || cy < 0 || cy >= H || g[cy * W + cx]) return false;
      }
      return true;
    }
    // the well's cells under the sinking piece (or under it at another place)
    cells(x, y, rot) {
      const c = this.cur;
      if (!c) return [];
      const px = x == null ? c.x : x, py = y == null ? c.y : y;
      return PIECES[c.id].rots[rot == null ? c.rot : rot].map(([dx, dy]) => [px + dx, py + dy]);
    }
    get resting() { const c = this.cur; return !!c && !this.fits(c.id, c.rot, c.x, c.y + 1); }
    // where the piece would land if dropped now (the ghost outline)
    ghostY() {
      const c = this.cur;
      if (!c) return null;
      let y = c.y;
      while (this.fits(c.id, c.rot, c.x, y + 1)) y++;
      return y;
    }

    spawn() {
      const nx = this.next, P = PIECES[nx.id];
      const x = Math.floor((this.W - P.n) / 2), y = -P.top;
      if (!this.fits(nx.id, 0, x, y)) {
        // the blocks have reached the top
        this.cur = null;
        if (this.M.wave > 0) { this.phase = 'wave'; this.timer = WAVE_T; this.waves++; this.emit({ type: 'wave', rows: this.M.wave }); }
        else { this.phase = 'over'; this.emit({ type: 'over', coins: this.roundCoins, rows: this.rowsDone }); }
        return false;
      }
      this.cur = { id: nx.id, style: nx.style, rot: 0, x, y };
      this.next = this.deal();
      this.phase = 'fall'; this.fallT = 0; this.restT = 0; this.resets = 0; this.age = 0;
      this.emit({ type: 'spawn', id: nx.id });
      return true;
    }
    touched() { if (this.resting && this.resets < MAX_RESETS) { this.restT = 0; this.resets++; } }

    // ---- what a finger can do ----
    move(dx) {
      const c = this.cur;
      if (this.phase !== 'fall' || !c || !this.fits(c.id, c.rot, c.x + dx, c.y)) return false;
      c.x += dx;
      this.touched();
      return true;
    }
    rotate(dir) {
      const c = this.cur;
      if (this.phase !== 'fall' || !c) return false;
      const r = (c.rot + (dir < 0 ? 3 : 1)) % 4;
      for (let i = 0; i < KICKS.length; i++) {
        const kx = KICKS[i][0], ky = KICKS[i][1];
        if (this.fits(c.id, r, c.x + kx, c.y + ky)) { c.rot = r; c.x += kx; c.y += ky; this.touched(); return true; }
      }
      return false;
    }
    stepDown() {
      const c = this.cur;
      if (this.phase !== 'fall' || !c || !this.fits(c.id, c.rot, c.x, c.y + 1)) return false;
      c.y++; this.fallT = 0;
      return true;
    }
    // straight down and settled at once. Returns how far it fell, or -1 if it is too soon (or nothing is sinking).
    drop() {
      const c = this.cur;
      if (this.phase !== 'fall' || !c || this.age < this.M.dropGuard) return -1;
      const y = this.ghostY(), d = y - c.y;
      c.y = y;
      this.lock(d);
      return d;
    }

    // the piece settles: it becomes part of the stack; any full row starts to sparkle and pays its coins
    lock(dropped) {
      const c = this.cur, W = this.W, H = this.H, g = this.grid, cells = this.cells();
      for (const [x, y] of cells) g[y * W + x] = c.style;
      this.pieces++;
      this.cur = null;
      this.emit({ type: 'lock', cells, style: c.style, dropped: dropped || 0 });
      const full = [];
      for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = 0; x < W; x++) if (g[y * W + x]) n++;
        if (n === W) full.push(y);
      }
      if (full.length) {
        const n = full.length, pay = coinsFor(n);
        this.coins += pay; this.roundCoins += pay; this.rowsDone += n; this.rowsAll += n;
        this.clearing = full; this.phase = 'clear'; this.timer = CLEAR_T;
        this.emit({ type: 'rows', rows: full.slice(), n, coins: pay, bonus: pay - n, rowsDone: this.rowsDone, goal: this.goal });
      } else { this.phase = 'rest'; this.timer = REST_T; }
    }
    // the sparkling rows go, and everything above them settles down
    collapse() {
      const W = this.W, H = this.H, g = this.grid, gone = this.clearing;
      let to = H - 1;
      for (let y = H - 1; y >= 0; y--) {
        if (gone.indexOf(y) >= 0) continue;
        if (to !== y) for (let x = 0; x < W; x++) g[to * W + x] = g[y * W + x];
        to--;
      }
      for (; to >= 0; to--) for (let x = 0; x < W; x++) g[to * W + x] = 0;
      this.clearing = [];
    }
    // Easy's wave: the bottom rows wash away and the rest settles down
    wash() {
      const W = this.W, H = this.H, g = this.grid, k = this.M.wave;
      g.copyWithin(k * W, 0, (H - k) * W);
      g.fill(0, 0, k * W);
      this.emit({ type: 'washed', rows: k });
    }
    // after the chest: the same well, a new round and a new row goal
    keepGoing() {
      if (this.phase !== 'goal') return false;
      this.round++; this.rowsDone = 0; this.roundCoins = 0;
      this.phase = 'rest'; this.timer = REST_T;
      this.emit({ type: 'round', round: this.round });
      return true;
    }

    // ---- time ----
    tick(dt) {
      if (!(dt > 0)) return;
      const ph = this.phase;
      if (ph === 'fall') {
        const c = this.cur, iv = this.interval();
        this.age += dt; this.fallT += dt;
        while (this.fallT >= iv) {
          this.fallT -= iv;
          if (this.fits(c.id, c.rot, c.x, c.y + 1)) c.y++;
          else { this.fallT = 0; break; }
        }
        if (this.fits(c.id, c.rot, c.x, c.y + 1)) this.restT = 0;
        else { this.restT += dt; if (this.restT >= this.M.lockDelay) this.lock(0); }
      } else if (ph === 'clear') {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.emit({ type: 'settled', rows: this.clearing.slice() });
          this.collapse();
          if (this.rowsDone >= this.goal) { this.phase = 'goal'; this.emit({ type: 'goal', round: this.round, coins: this.roundCoins }); }
          else { this.phase = 'rest'; this.timer = REST_T; }
        }
      } else if (ph === 'rest') {
        this.timer -= dt;
        if (this.timer <= 0) this.spawn();
      } else if (ph === 'wave') {
        this.timer -= dt;
        if (this.timer <= 0) { this.wash(); this.spawn(); }
      }
    }

    // how high the stack stands (rows from the floor), and a string that pins the whole game down
    height() {
      const W = this.W, g = this.grid;
      for (let i = 0; i < g.length; i++) if (g[i]) return this.H - Math.floor(i / W);
      return 0;
    }
    describe() {
      const c = this.cur;
      return [this.mode, this.seed, this.phase, this.round, this.rowsDone, this.rowsAll, this.coins, this.pieces, this.waves,
        c ? `${c.id}@${c.x},${c.y},${c.rot},${c.style}` : '-', `${this.next.id},${this.next.style}`, Array.from(this.grid).join('')].join('|');
    }
  }

  // ---------------------------------------------------------------- saving
  // { v, coins (all the coins ever earned here), rows (all the rows ever cleared), games (games started),
  //   keys: { mode: rounds finished }, best: { mode: most rows in one game }, last: the mode played last }
  const freshSave = () => ({ v: 1, coins: 0, rows: 0, games: 0, keys: { easy: 0, medium: 0, hard: 0 }, best: { easy: 0, medium: 0, hard: 0 }, last: 'easy' });
  function migrate(raw) {
    const sv = freshSave();
    let s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return sv; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    const n = (v) => { const k = Math.floor(Number(v)); return Number.isFinite(k) ? Math.min(1e9, Math.max(0, k)) : 0; };
    sv.coins = n(s.coins); sv.rows = n(s.rows); sv.games = n(s.games);
    for (const m of MODE_IDS) {
      if (s.keys && typeof s.keys === 'object') sv.keys[m] = n(s.keys[m]);
      if (s.best && typeof s.best === 'object') sv.best[m] = n(s.best[m]);
    }
    if (MODE_IDS.indexOf(s.last) >= 0) sv.last = s.last;
    return sv;
  }
  // rows cleared by one piece: the coins go straight into the save, so leaving in the middle loses nothing
  function bankRows(save, mode, n, rowsAll) {
    const pay = coinsFor(n);
    save.coins += pay; save.rows += n;
    if (rowsAll > save.best[mode]) save.best[mode] = rowsAll;
    return pay;
  }
  function bankKey(save, mode) { save.keys[mode]++; return save.keys[mode]; }

  const api = {
    SHAPES, PIECE_IDS, PIECES, STYLES, KICKS, MODES, MODE_IDS, CLEAR_T, REST_T, WAVE_T, MAX_RESETS, BONUS, coinsFor,
    mulberry32, rngFor, shuffle, freshSeed, Bag, Game, freshSave, migrate, bankRows, bankKey,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlocksLogic = api;
})(typeof self !== 'undefined' ? self : this);
