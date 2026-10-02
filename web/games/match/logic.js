/* Shell Match — the rules. Pure logic, no DOM: test/games/match/logic.test.js runs this same file in Node.
 * A board is dealt from a seed, so a seed always gives the same shells in the same places. */
(function (root) {
  'use strict';

  // Six levels. `peek`: seconds every shell stays open at the start so she can look.
  // `swaps`: how many pairs of closed shells then slide into each other's places while she watches.
  const LEVELS = [
    { pairs: 2, peek: 2.4, swaps: 0, theme: 0 },
    { pairs: 3, peek: 2.6, swaps: 0, theme: 1 },
    { pairs: 4, peek: 2.8, swaps: 0, theme: 2 },
    { pairs: 6, peek: 3.2, swaps: 1, theme: 3 },
    { pairs: 8, peek: 3.6, swaps: 2, theme: 4 },
    { pairs: 10, peek: 4.0, swaps: 2, theme: 5 },
  ];
  // Ten creatures, each its own colour and shape.
  const CREATURES = ['crab', 'clownfish', 'puffer', 'turtle', 'seahorse', 'whale', 'octopus', 'jelly', 'starfish', 'dolphin'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngFor = (seed) => mulberry32((0x9E3779B1 ^ Math.imul(seed >>> 0, 2654435761)) >>> 0);
  function shuffled(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Swaps for the start-of-level shuffle: each moves two shells holding different creatures,
  // and no shell moves twice, so every move is one she can follow.
  function planSwaps(order, count, rng) {
    const used = new Set(), out = [];
    for (let tries = 0; out.length < count && tries < 500; tries++) {
      const a = Math.floor(rng() * order.length), b = Math.floor(rng() * order.length);
      if (a === b || used.has(a) || used.has(b) || order[a] === order[b]) continue;
      used.add(a); used.add(b); out.push(a < b ? [a, b] : [b, a]);
    }
    return out;
  }

  // Which creatures, where, and which swaps: all from the seed.
  function deal(level, seed) {
    const L = LEVELS[level - 1];
    if (!L) throw new Error('no level ' + level);
    const rng = rngFor(seed);
    const kinds = shuffled(CREATURES, rng).slice(0, L.pairs);
    const deck = [];
    for (const k of kinds) deck.push(k, k);
    const order = shuffled(deck, rng);
    return { kinds, order, swaps: planSwaps(order, L.swaps, rng) };
  }

  // 3 stars: at most half as many mismatches as pairs. 2 stars: at most one per pair. Otherwise 1.
  function starsFor(pairs, mismatches) {
    if (mismatches * 2 <= pairs) return 3;
    if (mismatches <= pairs) return 2;
    return 1;
  }

  class Board {
    constructor(level, seed) {
      const d = deal(level, seed);
      this.level = level; this.seed = seed >>> 0; this.pairs = LEVELS[level - 1].pairs;
      this.kinds = d.kinds; this.swaps = d.swaps; this.swapped = 0;
      this.cards = d.order.map((kind, id) => ({ id, kind, state: 'down' })); // cards[position]
      this.open = [];            // positions face up and not yet matched (0, 1 or 2)
      this.mismatches = 0; this.matches = 0; this.moves = 0;
      this.phase = 'intro';      // intro (peek + shuffle) -> play -> done
    }
    // The next start-of-level swap: the two shells trade places. Returns [a, b], or null when none are left.
    swapNext() {
      const s = this.swaps[this.swapped];
      if (!s) return null;
      const [a, b] = s, t = this.cards[a];
      this.cards[a] = this.cards[b]; this.cards[b] = t; this.swapped++;
      return s;
    }
    begin() { while (this.swapNext()); if (this.phase === 'intro') this.phase = 'play'; }
    get busy() { return this.open.length >= 2; }
    // Open the shell at `pos`. While two are open, every other tap is ignored until settle().
    tap(pos) {
      if (this.phase !== 'play') return { type: 'ignored', why: 'phase' };
      if (this.busy) return { type: 'ignored', why: 'busy' };
      const c = this.cards[pos];
      if (!c) return { type: 'ignored', why: 'none' };
      if (c.state === 'matched') return { type: 'ignored', why: 'matched' };
      if (c.state === 'up') return { type: 'ignored', why: 'open' };
      c.state = 'up'; this.open.push(pos);
      if (this.open.length === 1) return { type: 'open', pos };
      this.moves++;
      const [a, b] = this.open;
      if (this.cards[a].kind === this.cards[b].kind) return { type: 'match', a, b, kind: c.kind };
      this.mismatches++;
      return { type: 'mismatch', a, b };
    }
    // After the beat: a matching pair stays open for good, a non-matching pair closes.
    settle() {
      if (this.open.length < 2) return null;
      const [a, b] = this.open; this.open = [];
      const A = this.cards[a], B = this.cards[b];
      if (A.kind === B.kind) {
        A.state = B.state = 'matched'; this.matches++;
        if (this.matches === this.pairs) { this.phase = 'done'; return { type: 'win', a, b, stars: this.stars }; }
        return { type: 'matched', a, b };
      }
      A.state = B.state = 'down';
      return { type: 'closed', a, b };
    }
    get stars() { return starsFor(this.pairs, this.mismatches); }
  }

  // ---- where the shells go on screen (world units: the screen is 540 tall, VW wide) ----
  // The home button's touch area is 19vh square, 2vh in from the corner: 113.4 units.
  const WORLD_H = 540, HOME = 114;
  function grids(n) { const out = []; for (let c = 1; c <= n; c++) if (n % c === 0) out.push([c, n / c]); return out; }
  // The left column holds the home button, Isabella and the pearl tray: wide when the screen can spare it,
  // narrow (just the home button's width) when the shells need the room. The biggest shells win, but the
  // wide column gets a 10% head start while its shells stay at least 19vh, so Isabella shows when she can.
  // Near-ties (within 3%) go to the squarer grid, which is easier to remember.
  const COMFY = 0.19 * WORLD_H;
  function layout(n, VW, opt) {
    const o = Object.assign({ H: WORLD_H, margin: 14, gap: 6, cap: 190, wideCol: 240, narrowCol: HOME + 8 }, opt);
    const all = [];
    for (const col of [o.wideCol, o.narrowCol]) {
      const x0 = col + 4, x1 = VW - o.margin, y0 = o.margin, y1 = o.H - o.margin;
      const W = x1 - x0, Hh = y1 - y0;
      if (W <= 20) continue;
      for (const [c, r] of grids(n)) {
        const cw = W / c, ch = Hh / r, target = Math.min(cw, ch) - o.gap, score = Math.min(target, o.cap), wide = col === o.wideCol;
        all.push({ col, wide, c, r, cw, ch, x0, y0, W, Hh, target, score, adj: score * (wide && target >= COMFY ? 1.1 : 1), shape: Math.abs(Math.log(c / r / 1.5)) });
      }
    }
    const top = Math.max(...all.map((a) => a.adj));
    const pick = all.filter((a) => a.adj >= top * 0.97).sort((p, q) => (p.shape - q.shape) || (q.adj - p.adj))[0];
    const cellH = Math.min(pick.ch, o.cap + o.gap), cellW = Math.min(pick.cw, (o.cap + o.gap) * 1.3);
    const bx = pick.x0 + (pick.W - cellW * pick.c) / 2, by = pick.y0 + (pick.Hh - cellH * pick.r) / 2;
    const cells = [];
    for (let i = 0; i < n; i++) {
      const cx = i % pick.c, cy = Math.floor(i / pick.c);
      cells.push({ x: bx + cx * cellW + o.gap / 2, y: by + cy * cellH + o.gap / 2, w: cellW - o.gap, h: cellH - o.gap, col: cx, row: cy });
    }
    return {
      cols: pick.c, rows: pick.r, col: pick.col, wide: !!pick.wide, cellW, cellH,
      target: Math.min(cellW, cellH) - o.gap, cells,
      board: { x: bx, y: by, w: cellW * pick.c, h: cellH * pick.r },
    };
  }
  function cellAt(lay, x, y) {
    for (let i = 0; i < lay.cells.length; i++) {
      const c = lay.cells[i];
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return i;
    }
    return -1;
  }

  const api = { LEVELS, CREATURES, WORLD_H, HOME, mulberry32, rngFor, shuffled, deal, planSwaps, starsFor, Board, grids, layout, cellAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MatchLogic = api;
})(typeof self !== 'undefined' ? self : this);
