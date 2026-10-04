/* Sea Jigsaw: the rules. Pure logic, no DOM: test/games/jigsaw/verify.js runs this same file in Node.
 *
 * Thirty puzzles: ten Easy, ten Medium, ten Hard. Each is one picture (pictures.js) cut into a grid of real
 * jigsaw pieces: every inside edge is one curve with a tab, shared by the two pieces either side of it, so the
 * pieces tile the picture exactly. Pieces are never rotated. A piece let go near its own place snaps home;
 * anywhere else on the board it just stays where it was put. Nothing can be lost and there is no fail state.
 *
 * Finishing always gives the puzzle's base coins. Three bonus coins wait on screen and drift away one at a time
 * as the puzzle goes on; the ones still there at the end are added (the owner asked for "finish faster for more
 * coins": this is the one game where speed earns something, and it is only ever extra). */
(function (root) {
  'use strict';
  const PW = 832, PH = 520;   // the picture and the board, in world units (16:10): 8 x 5 pieces are 104 square, 19vh
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // guide: what the empty board shows (Easy: a faint ghost of the picture; Medium: the piece outlines; Hard: neither).
  // snap: a piece snaps home when it (or the finger) is let go within snap x the smaller side of a piece, kept
  //   between snapMin and snapMax world units.
  // base: coins always given. bonusEach: coins for each bonus coin still on screen at the end (0..3 of them).
  // lead + pace[k] x pieces: the second at which bonus coin k drifts away (the clock starts at the first touch).
  // tray: [columns, rows] of pieces waiting on the right; the rest wait their turn behind them.
  // hintAfter: seconds without a piece going home before the hand shows where one goes.
  // tapHint: a tap on a piece lights its place for a moment.
  const MODES = {
    easy: { id: 'easy', guide: 'ghost', snap: 0.5, snapMin: 60, snapMax: 110, base: 5, bonusEach: 1, lead: 6, pace: [4, 7, 11], tray: [1, 3], hintAfter: 12, tapHint: true },
    medium: { id: 'medium', guide: 'outline', snap: 0.44, snapMin: 46, snapMax: 80, base: 10, bonusEach: 2, lead: 6, pace: [5, 8, 12], tray: [2, 4], hintAfter: 25, tapHint: true },
    hard: { id: 'hard', guide: 'none', snap: 0.4, snapMin: 40, snapMax: 60, base: 15, bonusEach: 3, lead: 10, pace: [7, 11, 16], tray: [2, 4], hintAfter: 45, tapHint: false },
  };
  const MODE_IDS = ['easy', 'medium', 'hard'];
  const PER = 10;        // puzzles in each mode
  const BONUS = 3;       // bonus coins on screen at the start

  // [picture (pictures.js), columns, rows, seed of the cut]
  const TABLE = {
    easy: [
      ['hello', 2, 2, 101], ['turtle', 2, 2, 102], ['crab', 3, 2, 103], ['octopus', 3, 2, 104], ['whale', 3, 2, 105],
      ['chest', 4, 2, 106], ['seahorse', 3, 3, 107], ['dolphin', 3, 3, 108], ['puffer', 4, 3, 109], ['friends', 4, 3, 110],
    ],
    medium: [
      ['garden', 4, 3, 201], ['race', 4, 3, 202], ['octogarden', 5, 3, 203], ['whales', 5, 3, 204], ['parade', 6, 3, 205],
      ['jellies', 6, 3, 206], ['wreck', 5, 4, 207], ['turtles', 5, 4, 208], ['palace', 6, 4, 209], ['treasure', 6, 4, 210],
    ],
    hard: [
      ['party', 6, 4, 301], ['crystal', 6, 4, 302], ['ice', 7, 4, 303], ['sunset', 7, 4, 304], ['moon', 6, 5, 305],
      ['kelp', 6, 5, 306], ['pearls', 8, 4, 307], ['bigchest', 7, 5, 308], ['castle', 7, 5, 309], ['everyone', 8, 5, 310],
    ],
  };
  const PUZZLES = [];
  for (const mode of MODE_IDS) {
    TABLE[mode].forEach(([pic, cols, rows, seed], i) => {
      PUZZLES.push({ id: mode[0] + (i + 1), mode, n: i + 1, pic, cols, rows, pieces: cols * rows, seed, cw: PW / cols, ch: PH / rows });
    });
  }
  const byId = {};
  for (const p of PUZZLES) byId[p.id] = p;
  const puzzle = (mode, n) => byId[mode[0] + n] || null;
  const puzzlesOf = (mode) => PUZZLES.filter((p) => p.mode === mode);

  // ---------- coins ----------
  const snapRadius = (p) => { const M = MODES[p.mode]; return clamp(M.snap * Math.min(p.cw, p.ch), M.snapMin, M.snapMax); };
  // the seconds at which the three bonus coins drift away, first to last
  const bonusTimes = (p) => { const M = MODES[p.mode]; return M.pace.map((s) => M.lead + s * p.pieces); };
  // bonus coins still on screen after t seconds of play
  function bonusLeft(p, t) {
    const T = bonusTimes(p);
    let left = BONUS;
    for (const s of T) if (t >= s) left--;
    return left;
  }
  // what a finish is worth: the base, always, plus bonusEach for every bonus coin kept
  function coinsFor(p, t) {
    const M = MODES[p.mode], bonus = bonusLeft(p, t);
    return { base: M.base, bonus, bonusCoins: bonus * M.bonusEach, total: M.base + bonus * M.bonusEach };
  }

  // ---------- the cut ----------
  // One inside edge: ten points (three cubic curves: p0 C p1 p2 p3 C p4 p5 p6 C p7 p8 p9) running along the edge
  // from (ax, ay) to (bx, by), with a tab that bulges to the side `dir` (+1: to the right of travel in screen
  // terms for a left-to-right edge that means down; for a top-to-bottom edge it means... see `edge` below).
  // m: the smaller side of a piece, which sets the tab's size whatever the length of the edge.
  function edge(ax, ay, bx, by, nx, ny, m, dir, R) {
    const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
    const T = m * (0.092 + R() * 0.012);                 // the tab is about 2.5 T tall and 2.6 T wide
    const j = () => (R() - 0.5) * 2;
    const a = j() * m * 0.035, e = j() * m * 0.035;     // the shoulders rise or dip a little
    const b = j() * Math.min(L * 0.09, m * 0.12);       // the tab sits a little off the middle
    const c = j() * m * 0.025, d = j() * m * 0.035;     // ...leans a little, and is a little taller or shorter
    const mid = L / 2 + b;
    const P = [
      [0, 0], [L * 0.2, a], [mid + d, -T + c], [mid - T, T + c],
      [mid - 2 * T - d, 3 * T + c], [mid + 2 * T - d, 3 * T + c], [mid + T, T + c],
      [mid + d, -T + c], [L * 0.8, e], [L, 0],
    ];
    return P.map(([u, w]) => [r3(ax + ux * u + nx * w * dir), r3(ay + uy * u + ny * w * dir)]);
  }
  // every point of a cut is kept to a thousandth of a unit, corners included, so shared points are the very same numbers
  const r3 = (v) => Math.round(v * 1000) / 1000;
  let lastCut = null;   // the cut of the puzzle in play is kept (and only that one: a cut is quick to make again)
  // The whole cut of a puzzle: the shared edges, and each piece's outline (a closed path, clockwise on screen).
  //   v[c][r]: the edge between pieces (c, r) and (c + 1, r), top to bottom; dir +1 = the tab points right
  //   h[c][r]: the edge between pieces (c, r) and (c, r + 1), left to right; dir +1 = the tab points down
  // A piece: { id, c, r, hx, hy (the middle of its place), sides: { t, r, b, l } (+1 tab, -1 blank, 0 flat),
  //   path: [['M', x, y], ['L', x, y] | ['C', x1, y1, x2, y2, x, y], ...], box: { x0, y0, x1, y1 } }
  function cut(p) {
    if (lastCut && lastCut.id === p.id) return lastCut;
    const { cols, rows, cw, ch } = p, m = Math.min(cw, ch), R = mulberry32(p.seed * 7919 + 13);
    const gx = (c) => r3(c * cw), gy = (r) => r3(r * ch);   // the grid's corners
    const v = [], h = [], vd = [], hd = [];
    for (let c = 0; c < cols - 1; c++) {
      v.push([]); vd.push([]);
      for (let r = 0; r < rows; r++) {
        const dir = R() < 0.5 ? 1 : -1;
        vd[c].push(dir);
        v[c].push(edge(gx(c + 1), gy(r), gx(c + 1), gy(r + 1), 1, 0, m, dir, R));
      }
    }
    for (let c = 0; c < cols; c++) {
      h.push([]); hd.push([]);
      for (let r = 0; r < rows - 1; r++) {
        const dir = R() < 0.5 ? 1 : -1;
        hd[c].push(dir);
        h[c].push(edge(gx(c), gy(r + 1), gx(c + 1), gy(r + 1), 0, 1, m, dir, R));
      }
    }
    const fwd = (path, E) => { path.push(['C', ...E[1], ...E[2], ...E[3]], ['C', ...E[4], ...E[5], ...E[6]], ['C', ...E[7], ...E[8], ...E[9]]); };
    const back = (path, E) => { path.push(['C', ...E[8], ...E[7], ...E[6]], ['C', ...E[5], ...E[4], ...E[3]], ['C', ...E[2], ...E[1], ...E[0]]); };
    const pieces = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = gx(c), y0 = gy(r), x1 = gx(c + 1), y1 = gy(r + 1), path = [['M', x0, y0]];
        const sides = { t: 0, r: 0, b: 0, l: 0 };
        if (r === 0) path.push(['L', x1, y0]); else { fwd(path, h[c][r - 1]); sides.t = -hd[c][r - 1]; }
        if (c === cols - 1) path.push(['L', x1, y1]); else { fwd(path, v[c][r]); sides.r = vd[c][r]; }
        if (r === rows - 1) path.push(['L', x0, y1]); else { back(path, h[c][r]); sides.b = hd[c][r]; }
        if (c === 0) path.push(['L', x0, y0]); else { back(path, v[c - 1][r]); sides.l = -vd[c - 1][r]; }
        const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const [x, y] of outline({ path }, 12)) { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); }
        pieces.push({ id: r * cols + c, c, r, hx: (c + 0.5) * cw, hy: (r + 0.5) * ch, sides, path, box });
      }
    }
    lastCut = { id: p.id, cols, rows, cw, ch, v, h, vd, hd, pieces };
    return lastCut;
  }
  // a piece's outline as a polygon: every curve sampled `steps` times (the first point is not repeated at the end)
  function outline(piece, steps) {
    const pts = [];
    let x = 0, y = 0;
    for (const s of piece.path) {
      if (s[0] === 'M') { x = s[1]; y = s[2]; pts.push([x, y]); }
      else if (s[0] === 'L') { x = s[1]; y = s[2]; pts.push([x, y]); }
      else {
        const [, x1, y1, x2, y2, x3, y3] = s;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps, q = 1 - t;
          pts.push([q * q * q * x + 3 * q * q * t * x1 + 3 * q * t * t * x2 + t * t * t * x3, q * q * q * y + 3 * q * q * t * y1 + 3 * q * t * t * y2 + t * t * t * y3]);
        }
        x = x3; y = y3;
      }
    }
    pts.pop();   // the path closes on its first point
    return pts;
  }
  // the room a waiting piece needs: the biggest outline in this cut, measured from the middle of its place
  function reach(p) {
    const C = cut(p);
    let w = 0, h = 0;
    for (const q of C.pieces) {
      w = Math.max(w, q.hx - q.box.x0, q.box.x1 - q.hx);
      h = Math.max(h, q.hy - q.box.y0, q.box.y1 - q.hy);
    }
    return { w: w * 2, h: h * 2 };
  }

  // ---------- letting go of a piece ----------
  // o: { px, py (the middle of the piece as drawn), fx, fy (the finger), hx, hy (the middle of its place),
  //      snapR, tray: { x0, y0, x1, y1 } }
  // A magnetic snap first: the piece or the finger within snapR of the place sends it home. Otherwise a finger
  // over the tray puts it back there, and anywhere else it stays on the board where it was put.
  function resolveDrop(o) {
    const fx = o.fx == null ? o.px : o.fx, fy = o.fy == null ? o.py : o.fy;
    const d = Math.min(Math.hypot(o.px - o.hx, o.py - o.hy), Math.hypot(fx - o.hx, fy - o.hy));
    if (d <= o.snapR) return 'home';
    const T = o.tray;
    if (T && fx >= T.x0 && fx <= T.x1 && fy >= T.y0 && fy <= T.y1) return 'tray';
    return 'board';
  }
  // a loose piece rests with its middle on the board (so it can never hide under a button or off the screen)
  function clampToBoard(x, y, B) { return { x: clamp(x, B.x0, B.x1), y: clamp(y, B.y0, B.y1) }; }

  // The order the pieces come out of the bag. Easy and Medium: any order (the board shows where each one goes).
  // Hard shows nothing on the board, so its pieces come from the outside in: the frame first (flat sides say where
  // they go), then the ring inside it, and so on, shuffled within each ring. A piece nearly always has neighbours.
  const ring = (p, id) => { const c = id % p.cols, r = Math.floor(id / p.cols); return Math.min(c, r, p.cols - 1 - c, p.rows - 1 - r); };
  function dealOrder(p, ids, rng) {
    const out = ids.slice();
    for (let i = out.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); const s = out[i]; out[i] = out[k]; out[k] = s; }
    if (MODES[p.mode].guide === 'none') {
      const at = new Map(out.map((id, i) => [id, i]));
      out.sort((a, b) => ring(p, a) - ring(p, b) || at.get(a) - at.get(b));
    }
    return out;
  }

  // ---------- one play of one puzzle ----------
  // Every piece is in one of four places: 'bag' (waiting its turn), 'tray' (in a tray slot), 'loose' (lying on
  // the board, not yet in its place) or 'home'. drop() is the only thing that moves one, and it is what a real
  // finger runs (through game.js) and what window.__jigsawDebug.drop() runs.
  class Run {
    // saved: { home: [piece ids], t } from snapshot(): the pieces already home and the seconds played so far;
    // rng: () => [0, 1) for the order the pieces are dealt in
    constructor(p, saved, rng) {
      if (!p || !byId[p.id]) throw new Error('no such puzzle');
      this.p = p; this.M = MODES[p.mode]; this.n = p.pieces;
      this.state = new Array(this.n).fill('bag');
      this.slots = new Array(this.M.tray[0] * this.M.tray[1]).fill(-1);
      this.queue = [];
      this.t = 0; this.started = false; this.homeCount = 0; this.done = false;
      this.drops = 0; this.misses = 0;   // misses: let go on the board away from its place (it just stays there)
      if (saved && typeof saved === 'object') {
        const t = Number(saved.t);
        if (Number.isFinite(t) && t > 0) this.t = Math.min(t, 86400);   // the clock waits for the first touch again
        if (Array.isArray(saved.home)) {
          for (const v of saved.home) {
            const id = Math.floor(Number(v));
            if (id >= 0 && id < this.n && this.state[id] !== 'home') { this.state[id] = 'home'; this.homeCount++; }
          }
        }
        // a save can never hold a finished puzzle (that is recorded as a finish); if one says so, start again
        if (this.homeCount >= this.n) { this.state.fill('bag'); this.homeCount = 0; this.t = 0; }
      }
      const ids = [];
      for (let i = 0; i < this.n; i++) if (this.state[i] === 'bag') ids.push(i);
      this.queue = dealOrder(p, ids, rng || Math.random);
      this.deal();
    }
    // fill every empty tray slot from the front of the queue; returns the pieces dealt, as [id, slot]
    deal() {
      const out = [];
      for (let k = 0; k < this.slots.length && this.queue.length; k++) {
        if (this.slots[k] >= 0) continue;
        const id = this.queue.shift();
        this.slots[k] = id; this.state[id] = 'tray';
        out.push([id, k]);
      }
      return out;
    }
    slotOf(id) { return this.slots.indexOf(id); }
    get waiting() { return this.queue.length; }
    get bonus() { return bonusLeft(this.p, this.t); }
    get coins() { return coinsFor(this.p, this.t); }
    // the clock runs from the first touch of a piece until the last piece is home
    start() { if (!this.done) this.started = true; }
    tick(dt) { if (this.started && !this.done && dt > 0) this.t += dt; }
    snapshot() {
      const home = [];
      for (let i = 0; i < this.n; i++) if (this.state[i] === 'home') home.push(i);
      return { home, t: Math.round(this.t * 10) / 10 };
    }
    // where: 'home' | 'board' | 'tray' (from resolveDrop)
    drop(id, where) {
      if (this.done || !(id >= 0 && id < this.n) || this.state[id] === 'home' || this.state[id] === 'bag') return { type: 'ignored', id };
      this.started = true;
      this.drops++;
      const from = this.state[id], slot = this.slotOf(id);
      if (where === 'home') {
        if (slot >= 0) this.slots[slot] = -1;
        this.state[id] = 'home'; this.homeCount++;
        if (this.homeCount >= this.n) this.done = true;
        return { type: 'home', id, from, done: this.done, dealt: this.deal() };
      }
      if (where === 'tray') {
        if (from === 'tray') return { type: 'back', id, from, slot, dealt: [] };
        const free = this.slots.indexOf(-1);
        if (free >= 0) { this.slots[free] = id; this.state[id] = 'tray'; return { type: 'back', id, from, slot: free, dealt: [] }; }
        this.queue.unshift(id); this.state[id] = 'bag';   // the tray is full: it waits its turn, first in line
        return { type: 'bag', id, from, dealt: [] };
      }
      if (slot >= 0) this.slots[slot] = -1;
      this.state[id] = 'loose'; this.misses++;
      return { type: 'loose', id, from, dealt: this.deal() };
    }
  }

  // ---------- saving ----------
  // v1: { v, mode (last picked), coins (all the coins ever won), solved (finishes, replays included),
  //       easy | medium | hard: { unlocked (1..10), best: [10 x (-1 = not finished yet, else the most bonus coins kept, 0..3)] },
  //       runs: { puzzleId: { home: [piece ids], t } } (puzzles left half done) }
  const freshProg = () => ({ unlocked: 1, best: new Array(PER).fill(-1) });
  const freshSave = () => ({ v: 1, mode: 'easy', coins: 0, solved: 0, easy: freshProg(), medium: freshProg(), hard: freshProg(), runs: {} });
  function migrate(raw) {
    const sv = freshSave();
    let s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return sv; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
    const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
    if (MODE_IDS.includes(s.mode)) sv.mode = s.mode;
    sv.coins = int(s.coins, 0, 1e9) || 0;
    sv.solved = int(s.solved, 0, 1e9) || 0;
    for (const m of MODE_IDS) {
      const src = plain(s[m]) ? s[m] : {}, best = Array.isArray(src.best) ? src.best : [];
      sv[m].best = Array.from({ length: PER }, (_, i) => { const b = typeof best[i] === 'number' ? int(best[i], -1, BONUS) : null; return b == null ? -1 : b; });
      const beaten = sv[m].best.reduce((k, b, i) => (b >= 0 ? i + 1 : k), 0);
      sv[m].unlocked = Math.min(PER, Math.max(int(src.unlocked, 1, PER) || 1, beaten + 1));
    }
    if (plain(s.runs)) {
      for (const key of Object.keys(s.runs)) {
        const p = byId[key];
        if (!p || p.n > sv[p.mode].unlocked || !plain(s.runs[key])) continue;
        const r = new Run(p, s.runs[key], () => 0);
        if (r.homeCount > 0) sv.runs[key] = r.snapshot();
      }
    }
    return sv;
  }
  // a puzzle finished after t seconds: the coins go in, the next puzzle opens, the half-done run is forgotten
  function finish(sv, p, t) {
    const c = coinsFor(p, t), prog = sv[p.mode], first = prog.best[p.n - 1] < 0;
    prog.best[p.n - 1] = Math.max(prog.best[p.n - 1], c.bonus);
    prog.unlocked = Math.min(PER, Math.max(prog.unlocked, p.n + 1));
    sv.coins += c.total; sv.solved++;
    delete sv.runs[p.id];
    return Object.assign({ first }, c);
  }

  const api = { PW, PH, MODES, MODE_IDS, PER, BONUS, TABLE, PUZZLES, puzzle, puzzlesOf, byId, mulberry32,
    snapRadius, bonusTimes, bonusLeft, coinsFor, cut, outline, reach, resolveDrop, clampToBoard, ring, dealOrder, Run, freshSave, migrate, finish };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JigsawLogic = api;
})(typeof self !== 'undefined' ? self : this);
