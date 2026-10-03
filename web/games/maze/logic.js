/* Coral Maze — the rules. Pure logic, no DOM: test/games/maze/verify.js runs this same file in Node.
 *
 * Each level is a grid of cells carved into a maze from its own fixed seed with a seeded PRNG, so a level
 * never changes between runs; test/games/maze/verify.js freezes every level with a fingerprint.
 *
 * Time runs in ticks. Isabella swims one cell per tick; a patrolling jellyfish or pufferfish swims one cell
 * every P ticks. step() moves the world one tick, and the game and the solver both use it, so the solver's
 * proof that a level can be escaped holds in the game exactly.
 *
 * A swipe makes her glide until the next turn or junction (or a wall). A key opens the coral gate of its own
 * colour; a current carries her one way and cannot be swum against; a patrol that touches her while she swims
 * sends her gently back to her last shell (or the start). While she rests, a patrol turns back before it
 * reaches her, so keeping still is always safe. */
(function (root) {
  'use strict';

  const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], OPP = [2, 3, 0, 1];
  const DIRS = ['up', 'right', 'down', 'left'];
  const P = 4;           // ticks a patrol takes to swim one cell (Isabella takes one)
  const HIT = 0.6;       // Isabella and a patrol touch when their centres come this close (in cells)
  const SHY = 0.95;      // ...and a patrol never swims closer than this to her while she rests
  const FLOOR = 0, HELD = 1, OPEN = 2;   // each key/gate pair: key lying in the maze, key held, gate open
  const BIG = 65536;     // solver cost of one move, in ticks: fewest moves first, then the quickest way

  // The twenty levels, two pages of ten. w x h cells; `bias` shapes the maze (1 = long winding tunnels,
  // lower = more short side branches); `loops` = extra openings that make a second way round.
  // New things arrive one at a time, each first in a gentle level: a key lying on the way to its gate (4),
  // a jellyfish in a side tunnel (7), a current that helps (11), dark water with a wide light (17).
  // `theme` = which of the main game's twenty sea colourings it wears (art.js); `dark` = how far her light reaches.
  // `seed` was picked by test/games/maze/seeds.js (the first seed whose level met that level's targets);
  // `par` is the fewest moves out, found by the solver and checked by test/games/maze/verify.js.
  const LEVELS = [
    { w: 4, h: 2, bias: 1, loops: 0, theme: 0, seed: 1, par: 3 },
    { w: 5, h: 2, bias: 0.8, loops: 0, theme: 1, seed: 1, par: 3 },
    { w: 5, h: 3, bias: 0.75, loops: 0, theme: 2, seed: 3, par: 4 },
    { w: 6, h: 3, bias: 0.75, loops: 0, theme: 3, keys: [{ gate: [0.45, 0.85], key: 'path' }], seed: 4, par: 5 },
    { w: 6, h: 4, bias: 0.7, loops: 1, theme: 10, seed: 43, par: 7 },
    { w: 6, h: 4, bias: 0.7, loops: 0, theme: 11, keys: [{ gate: [0.45, 0.85], key: 'branch', depth: 1 }], seed: 144, par: 6 },
    { w: 7, h: 4, bias: 0.75, loops: 0, theme: 6, patrols: [{ mode: 'side', len: 3, kind: 'jelly' }], seed: 15, par: 7 },
    { w: 8, h: 4, bias: 0.65, loops: 1, theme: 12, seed: 5, par: 9 },
    { w: 8, h: 4, bias: 0.7, loops: 1, theme: 4, patrols: [{ mode: 'path', len: 3, kind: 'puffer' }], seed: 47, par: 11 },
    { w: 8, h: 4, bias: 0.65, loops: 1, theme: 9, keys: [{ gate: [0.5, 0.85], key: 'branch', depth: 1 }], patrols: [{ mode: 'side', len: 3, kind: 'jelly' }], seed: 23, par: 8 },
    { w: 9, h: 5, bias: 0.7, loops: 1, theme: 13, currents: [{ mode: 'help', len: 3 }], seed: 23, par: 12 },
    { w: 9, h: 5, bias: 0.65, loops: 2, theme: 14, currents: [{ mode: 'help', len: 3 }, { mode: 'decoy', len: 3 }], seed: 20, par: 13 },
    { w: 9, h: 5, bias: 0.65, loops: 2, theme: 5, keys: [{ gate: [0.45, 0.85], key: 'branch', depth: 2 }], currents: [{ mode: 'against', len: 2 }], seed: 52, par: 16 },
    { w: 10, h: 5, bias: 0.6, loops: 2, theme: 16, patrols: [{ mode: 'cross', len: 3, kind: 'jelly' }, { mode: 'path', len: 4, kind: 'puffer' }], seed: 26, par: 14 },
    { w: 10, h: 5, bias: 0.6, loops: 2, theme: 7, currents: [{ mode: 'against', len: 3 }, { mode: 'decoy', len: 3 }], patrols: [{ mode: 'path', len: 4, kind: 'jelly' }], seed: 53, par: 14 },
    { w: 10, h: 6, bias: 0.6, loops: 2, theme: 18, keys: [{ gate: [0.25, 0.5], key: 'branch', depth: 2 }, { gate: [0.6, 0.9], key: 'behind', depth: 1 }], currents: [{ mode: 'decoy', len: 3 }], seed: 153, par: 16 },
    { w: 11, h: 5, bias: 0.65, loops: 2, theme: 8, dark: 3.2, keys: [{ gate: [0.45, 0.85], key: 'branch', depth: 2 }], seed: 7, par: 22 },
    { w: 11, h: 6, bias: 0.6, loops: 2, theme: 15, dark: 2.9, keys: [{ gate: [0.45, 0.85], key: 'branch', depth: 2 }], patrols: [{ mode: 'path', len: 4, kind: 'jelly' }], seed: 7, par: 19 },
    { w: 12, h: 6, bias: 0.6, loops: 3, theme: 17, dark: 2.7, keys: [{ gate: [0.4, 0.85], key: 'branch', depth: 3 }], currents: [{ mode: 'against', len: 3 }, { mode: 'decoy', len: 3 }], seed: 39, par: 22 },
    { w: 12, h: 6, bias: 0.55, loops: 3, theme: 19, dark: 2.5, keys: [{ gate: [0.4, 0.8], key: 'branch', depth: 3 }], currents: [{ mode: 'against', len: 3 }], patrols: [{ mode: 'path', len: 4, kind: 'puffer' }], seed: 15, par: 24 },
  ];

  // Hard: twenty more levels, much bigger than the screen (the view follows her), built by generateHard().
  //   chain   keys she must fetch in order: key 0 lies free in a long dead end; gate k shuts the only way into a
  //           pocket of the maze where key k+1 lies; the last gate stands on the way out, near its end
  //           (`last` = where along the way, `pocket` = how many cells a pocket may have, `depth` = how far off the
  //           way key 0 lies)
  //   currents as in Easy, plus 'loop': a one-way stretch on a ring of tunnels, so the ring goes round one way only
  // `seed` and `par` were picked by test/games/maze/seeds-hard.js and are checked by test/games/maze/verify.js.
  const C1 = (n, pocket) => ({ n, last: [0.72, 0.95], pocket: pocket || [5, 30], depth: 3 });
  const HARD_LEVELS = [
    { w: 20, h: 9, bias: 0.6, loops: 4, theme: 0, chain: C1(1), currents: [{ mode: 'loop', len: 3 }], seed: 1, par: 42 },
    { w: 21, h: 9, bias: 0.6, loops: 4, theme: 2, chain: C1(1), currents: [{ mode: 'loop', len: 3 }], patrols: [{ mode: 'side', len: 3, kind: 'jelly' }], seed: 6, par: 41 },
    { w: 21, h: 10, bias: 0.6, loops: 5, theme: 3, chain: C1(2, [5, 20]), currents: [{ mode: 'help', len: 3 }], seed: 66, par: 49 },
    { w: 22, h: 10, bias: 0.6, loops: 6, theme: 10, chain: C1(1), currents: [{ mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }], patrols: [{ mode: 'path', len: 3, kind: 'puffer' }], seed: 2, par: 56 },
    { w: 22, h: 10, bias: 0.6, loops: 5, theme: 11, chain: C1(2, [5, 22]), currents: [{ mode: 'loop', len: 3 }], patrols: [{ mode: 'cross', len: 3, kind: 'jelly' }], seed: 24, par: 63 },
    { w: 23, h: 10, bias: 0.6, loops: 6, theme: 6, chain: C1(2, [5, 24]), currents: [{ mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }], seed: 97, par: 64 },
    { w: 23, h: 11, bias: 0.6, loops: 6, theme: 12, chain: C1(3, [5, 18]), currents: [{ mode: 'help', len: 3 }], seed: 13, par: 72 },
    { w: 24, h: 11, bias: 0.6, loops: 6, theme: 4, chain: C1(2, [5, 26]), currents: [{ mode: 'loop', len: 3 }], patrols: [{ mode: 'path', len: 4, kind: 'puffer' }], seed: 24, par: 66 },
    { w: 24, h: 11, bias: 0.6, loops: 7, theme: 9, chain: C1(3, [5, 20]), currents: [{ mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }], seed: 77, par: 80 },
    { w: 25, h: 11, bias: 0.6, loops: 7, theme: 13, chain: C1(3, [5, 22]), currents: [{ mode: 'loop', len: 3 }], patrols: [{ mode: 'cross', len: 3, kind: 'jelly' }], seed: 11, par: 77 },
    { w: 25, h: 12, bias: 0.6, loops: 7, theme: 14, chain: C1(2, [5, 28]), currents: [{ mode: 'loop', len: 3 }, { mode: 'help', len: 3 }], patrols: [{ mode: 'path', len: 3, kind: 'jelly' }, { mode: 'cross', len: 3, kind: 'puffer' }], seed: 19, par: 82 },
    { w: 26, h: 12, bias: 0.6, loops: 8, theme: 5, chain: C1(3, [5, 24]), currents: [{ mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }, { mode: 'loop', len: 3 }], seed: 17, par: 95 },
    { w: 26, h: 12, bias: 0.6, loops: 8, theme: 16, chain: C1(3, [5, 24]), currents: [{ mode: 'loop', len: 3 }, { mode: 'against', len: 3, ring: true }], patrols: [{ mode: 'path', len: 4, kind: 'puffer' }], seed: 65, par: 98 },
    { w: 24, h: 11, bias: 0.6, loops: 6, theme: 7, dark: 3.2, chain: C1(2, [5, 24]), currents: [{ mode: 'loop', len: 3 }], seed: 321, par: 106 },
    { w: 25, h: 11, bias: 0.6, loops: 7, theme: 18, dark: 3.0, chain: C1(3, [5, 20]), currents: [{ mode: 'loop', len: 3 }], patrols: [{ mode: 'cross', len: 3, kind: 'jelly' }], seed: 239, par: 107 },
    { w: 26, h: 12, bias: 0.6, loops: 7, theme: 8, dark: 3.0, chain: C1(3, [5, 24]), currents: [{ mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }], seed: 517, par: 115 },
    { w: 27, h: 12, bias: 0.6, loops: 8, theme: 15, dark: 2.9, chain: C1(3, [5, 24]), currents: [{ mode: 'loop', len: 3 }, { mode: 'help', len: 3 }], patrols: [{ mode: 'path', len: 3, kind: 'jelly' }], seed: 65, par: 126 },
    { w: 28, h: 12, bias: 0.6, loops: 8, theme: 17, dark: 2.8, chain: C1(3, [5, 26]), currents: [{ mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }], patrols: [{ mode: 'cross', len: 3, kind: 'puffer' }, { mode: 'path', len: 3, kind: 'jelly' }], seed: 86, par: 122 },
    { w: 28, h: 13, bias: 0.6, loops: 9, theme: 1, dark: 2.7, chain: C1(3, [5, 28]), currents: [{ mode: 'loop', len: 3 }, { mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }], patrols: [{ mode: 'path', len: 4, kind: 'puffer' }], seed: 28, par: 131 },
    { w: 29, h: 13, bias: 0.6, loops: 9, theme: 19, dark: 2.6, chain: C1(3, [6, 30]), currents: [{ mode: 'against', len: 3, ring: true }, { mode: 'loop', len: 3 }, { mode: 'loop', len: 3 }], patrols: [{ mode: 'path', len: 3, kind: 'puffer' }, { mode: 'cross', len: 3, kind: 'jelly' }], seed: 136, par: 138 },
  ];

  // ---------------------------------------------------------------- randomness (as in Shell Match)
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngFor = (seed) => mulberry32((0x9E3779B1 ^ Math.imul(seed >>> 0, 2654435761)) >>> 0);
  const pick = (list, rng) => list[Math.floor(rng() * list.length)];
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ---------------------------------------------------------------- the maze
  // nb[i*4+d] = the cell next to i in direction d, or -1 at the edge of the grid
  function neighbours(W, H) {
    const nb = new Int16Array(W * H * 4).fill(-1);
    for (let i = 0; i < W * H; i++) {
      for (let d = 0; d < 4; d++) {
        const x = (i % W) + DX[d], y = Math.floor(i / W) + DY[d];
        if (x >= 0 && x < W && y >= 0 && y < H) nb[i * 4 + d] = y * W + x;
      }
    }
    return nb;
  }
  // A "growing tree" maze: always growing from the newest cell gives long winding tunnels (bias 1),
  // growing from a random one gives lots of short side branches (bias 0).
  function carve(W, H, nb, rng, bias) {
    const N = W * H, open = new Uint8Array(N), seen = new Uint8Array(N), list = [];
    const first = Math.floor(rng() * N);
    seen[first] = 1; list.push(first);
    const opts = [];
    while (list.length) {
      const idx = rng() < bias ? list.length - 1 : Math.floor(rng() * list.length), c = list[idx];
      opts.length = 0;
      for (let d = 0; d < 4; d++) { const m = nb[c * 4 + d]; if (m >= 0 && !seen[m]) opts.push(d); }
      if (!opts.length) { list.splice(idx, 1); continue; }
      const d = pick(opts, rng), m = nb[c * 4 + d];
      open[c] |= 1 << d; open[m] |= 1 << OPP[d]; seen[m] = 1; list.push(m);
    }
    return open;
  }
  // Is the 2x2 block with top-left cell a open all round (a little room, not a maze)?
  function roomAt(W, H, open, ax, ay) {
    if (ax < 0 || ay < 0 || ax >= W - 1 || ay >= H - 1) return false;
    const a = ay * W + ax;
    return (open[a] & 6) === 6 && (open[a + W + 1] & 9) === 9;
  }
  // Open `count` more walls (each makes a loop), never one that would make a 2x2 room.
  function addLoops(W, H, nb, open, rng, count) {
    const walls = [];
    for (let i = 0; i < W * H; i++) for (const d of [RIGHT, DOWN]) if (nb[i * 4 + d] >= 0 && !(open[i] & (1 << d))) walls.push(i * 4 + d);
    shuffle(walls, rng);
    let added = 0;
    for (const w of walls) {
      if (added >= count) break;
      const i = w >> 2, d = w & 3, m = nb[w], x = i % W, y = Math.floor(i / W);
      open[i] |= 1 << d; open[m] |= 1 << OPP[d];
      const room = d === RIGHT ? roomAt(W, H, open, x, y - 1) || roomAt(W, H, open, x, y) : roomAt(W, H, open, x - 1, y) || roomAt(W, H, open, x, y);
      if (room) { open[i] &= ~(1 << d); open[m] &= ~(1 << OPP[d]); continue; }
      added++;
    }
  }
  // Shortest list of cells from a to b through open walls (the edge cut, if given, is closed), or null.
  function cellPath(lv, a, b, cut) {
    const N = lv.N, prev = new Int16Array(N).fill(-1), q = [a];
    prev[a] = a;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (c === b) break;
      for (let d = 0; d < 4; d++) {
        if (!(lv.open[c] & (1 << d))) continue;
        const m = lv.nb[c * 4 + d];
        if (m < 0 || prev[m] >= 0) continue;
        if (cut && ((cut[0] === c && cut[1] === m) || (cut[0] === m && cut[1] === c))) continue;
        prev[m] = c; q.push(m);
      }
    }
    if (prev[b] < 0) return null;
    const out = [b];
    for (let c = b; c !== a; c = prev[c]) out.push(prev[c]);
    return out.reverse();
  }
  // Cells reachable from a without crossing any of the given edges ([[a, b], ...]).
  function region(lv, a, cuts) {
    const N = lv.N, seen = new Uint8Array(N), q = [a];
    seen[a] = 1;
    const cut = (c, m) => cuts.some((e) => (e[0] === c && e[1] === m) || (e[0] === m && e[1] === c));
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      for (let d = 0; d < 4; d++) {
        if (!(lv.open[c] & (1 << d))) continue;
        const m = lv.nb[c * 4 + d];
        if (m < 0 || seen[m] || cut(c, m)) continue;
        seen[m] = 1; q.push(m);
      }
    }
    return seen;
  }
  const dirBetween = (lv, a, b) => { for (let d = 0; d < 4; d++) if (lv.nb[a * 4 + d] === b) return d; return -1; };
  const degree = (o) => (o & 1) + ((o >> 1) & 1) + ((o >> 2) & 1) + ((o >> 3) & 1);

  // ---------------------------------------------------------------- placing things in the maze
  function fail(lv, why) { lv.ok = false; lv.why = lv.why || why; }
  // A coral gate on a tunnel the way out cannot avoid, and its key somewhere she can reach before it:
  // 'path' = lying on the way to the gate; 'branch' = up a side tunnel at least `depth` cells off the way;
  // 'behind' = behind the previous gate (open that one first).
  function placeKey(lv, spec, rng, used) {
    const path = lv.path, k = lv.keys.length;
    const lo = Math.max(1, Math.floor(path.length * spec.gate[0])), hi = Math.min(path.length - 3, Math.ceil(path.length * spec.gate[1]));
    const prevGate = k > 0 ? lv.gates[k - 1] : null, prevIdx = prevGate ? path.indexOf(prevGate.b) : 0;
    const cands = [];
    for (let i = Math.max(lo, prevIdx + 2); i <= hi; i++) {
      const a = path[i], b = path[i + 1];
      if (used[a] || used[b]) continue;
      if (cellPath(lv, lv.start, lv.exit, [a, b])) continue;   // there is a way round: not a real gate
      cands.push(i);
    }
    if (!cands.length) return fail(lv, 'no spot for gate ' + k);
    const gi = pick(cands, rng), a = path[gi], b = path[gi + 1];
    // where the key may lie: before every gate; for 'behind', past the previous gate but before this one
    const behind = spec.key === 'behind' && prevGate;
    const allShut = region(lv, lv.start, lv.gates.map((g) => [g.a, g.b]).concat([[a, b]]));
    const reach = behind ? region(lv, lv.start, lv.gates.filter((g) => g !== prevGate).map((g) => [g.a, g.b]).concat([[a, b]])) : allShut;
    const allowed = (c) => reach[c] && !(behind && allShut[c]);
    const onPath = new Uint8Array(lv.N);
    for (const c of path) onPath[c] = 1;
    let cells = [];
    if (spec.key === 'path') {
      for (let i = Math.max(1, prevIdx + 1); i < gi - 1; i++) if (!used[path[i]] && allowed(path[i])) cells.push(path[i]);
      cells = cells.slice(Math.floor(cells.length / 3));   // not right at the start
    } else {
      // how far each reachable cell is from the way out
      const dist = new Int16Array(lv.N).fill(-1), q = [];
      for (const c of path) if (reach[c]) { dist[c] = 0; q.push(c); }
      for (let qi = 0; qi < q.length; qi++) {
        const c = q[qi];
        for (let d = 0; d < 4; d++) {
          if (!(lv.open[c] & (1 << d))) continue;
          const m = lv.nb[c * 4 + d];
          if (m < 0 || dist[m] >= 0 || !reach[m] || (c === a && m === b) || (c === b && m === a)) continue;
          dist[m] = dist[c] + 1; q.push(m);
        }
      }
      const pool = [];
      for (let c = 0; c < lv.N; c++) if (allowed(c) && !used[c] && !onPath[c] && dist[c] >= (spec.depth || 1)) pool.push(c);
      const ends = pool.filter((c) => degree(lv.open[c]) === 1);
      cells = ends.length ? ends : pool;
    }
    if (!cells.length) return fail(lv, 'no spot for key ' + k);
    const key = pick(cells, rng);
    used[a] = used[b] = used[key] = 1;
    lv.gates.push({ a, b, dir: dirBetween(lv, a, b) });
    lv.keys.push({ cell: key });
  }
  // Straight runs of `len` connected cells: [[cells...], axis direction].
  function runs(lv, len, dirs) {
    const out = [];
    for (let c = 0; c < lv.N; c++) {
      for (const d of dirs) {
        const cells = [c];
        let x = c;
        for (let k = 1; k < len; k++) {
          if (!(lv.open[x] & (1 << d))) break;
          x = lv.nb[x * 4 + d];
          cells.push(x);
        }
        if (cells.length === len) out.push({ cells, d });
      }
    }
    return out;
  }
  const gateOn = (lv, a, b) => lv.gates.some((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a));
  // A one-way current: a straight run that carries Isabella along and cannot be swum against.
  // 'help' = along the way out, in the direction she needs; 'against' = on the way out but flowing the
  // wrong way (find the way round); 'decoy' = off the way out.
  function placeCurrent(lv, spec, rng, used) {
    const len = spec.len || 3, pos = new Int16Array(lv.N).fill(-1);
    lv.path.forEach((c, i) => { pos[c] = i; });
    const cands = [];
    for (const r of runs(lv, len, [UP, RIGHT, DOWN, LEFT])) {
      const last = r.cells[len - 1];
      if (!(lv.open[last] & (1 << r.d))) continue;
      const after = lv.nb[last * 4 + r.d], before = lv.nb[r.cells[0] * 4 + OPP[r.d]];
      const all = r.cells.concat([after]);
      if (all.some((c) => used[c] || c === lv.start || c === lv.exit)) continue;
      if (before >= 0 && (lv.open[r.cells[0]] & (1 << OPP[r.d])) && used[before] === 2) continue;   // no current running into another
      let bad = false;
      for (let k = 0; k < all.length - 1; k++) if (gateOn(lv, all[k], all[k + 1])) bad = true;
      if (bad) continue;
      const onPath = r.cells.filter((c) => pos[c] >= 0).length;
      const forward = r.cells.every((c, k) => k === 0 || pos[c] === pos[r.cells[k - 1]] + 1) && pos[after] === pos[last] + 1;
      const backward = r.cells.every((c, k) => k === 0 || pos[c] === pos[r.cells[k - 1]] - 1) && pos[r.cells[0]] >= 0;
      if (spec.mode === 'help' && !(onPath === len && forward)) continue;
      if (spec.mode === 'against' && !(onPath === len && backward)) continue;
      if (spec.mode === 'decoy' && (onPath > 0 || pos[after] >= 0)) continue;
      if (spec.mode === 'loop' || spec.ring) {
        // on a ring of tunnels (no stretch of it is the only way between two parts of the maze), so she can always
        // get round the other way ('loop' anywhere; 'against' with `ring`, Hard only, always has a way round)
        const br = lv.bridges || (lv.bridges = bridges(lv));
        if (all.some((x, k) => k < all.length - 1 && br[x * 4 + r.d])) continue;
      }
      cands.push({ cells: r.cells, dir: r.d, after });
    }
    if (!cands.length) return fail(lv, 'no spot for a ' + spec.mode + ' current');
    const c = pick(cands, rng);
    for (const x of c.cells) used[x] = 2;
    used[c.after] = used[c.after] || 1;
    lv.currents.push({ cells: c.cells, dir: c.dir });
  }
  // A patrolling jellyfish or pufferfish on a straight lane of `len` cells, swimming end to end.
  // 'side' = in a side tunnel, coming out onto the way and going back in; 'cross' = across the way out;
  // 'path' = along the way out.
  function placePatrol(lv, spec, rng, used) {
    const len = spec.len || 3, pos = new Int16Array(lv.N).fill(-1);
    lv.path.forEach((c, i) => { pos[c] = i; });
    const cands = [];
    for (const r of runs(lv, len, [RIGHT, DOWN])) {
      if (r.cells.some((c) => used[c])) continue;
      const on = r.cells.map((c) => pos[c] >= 0);
      const n = on.filter(Boolean).length;
      if (!n) continue;
      if (spec.mode === 'side') {
        if (n !== 1 || !(on[0] || on[len - 1])) continue;
        const far = on[0] ? r.cells[len - 1] : r.cells[0], out = on[0] ? r.d : OPP[r.d];
        if (lv.open[far] & (1 << out)) continue;   // the side tunnel ends here: a little cave for it
      }
      if (spec.mode === 'cross' && (n !== 1 || on[0] || on[len - 1])) continue;
      if (spec.mode === 'path' && n < 2) continue;
      cands.push(r);
    }
    if (!cands.length) return fail(lv, 'no spot for a ' + spec.mode + ' patrol');
    const r = pick(cands, rng), maxP = (len - 1) * P;
    let p0, s0;
    if (spec.mode === 'side') { const atStart = pos[r.cells[0]] >= 0; p0 = atStart ? maxP : 0; s0 = atStart ? -1 : 1; }
    else { p0 = Math.floor(rng() * len) * P; s0 = p0 === 0 ? 1 : p0 === maxP ? -1 : rng() < 0.5 ? -1 : 1; }
    for (const c of r.cells) used[c] = 1;
    lv.patrols.push({ cells: r.cells, axis: r.d, p0, s0, maxP, kind: spec.kind || 'jelly' });
  }
  // A shell a little before each patrol on the way out: touched, it is where she comes back to.
  function placeShells(lv, used) {
    const lane = new Uint8Array(lv.N);
    for (const p of lv.patrols) for (const c of p.cells) lane[c] = 1;
    const firsts = lv.patrols.map((p) => Math.min(...p.cells.map((c) => { const i = lv.path.indexOf(c); return i < 0 ? 1e9 : i; }))).sort((a, b) => a - b);
    for (const f of firsts) {
      for (let i = f - 2; i >= Math.max(2, f - 4); i--) {
        const c = lv.path[i];
        if (used[c] || lane[c] || lv.shells.includes(c)) continue;
        if (lv.shells.length && lv.path.indexOf(lv.shells[lv.shells.length - 1]) >= i) break;
        lv.shells.push(c); used[c] = 1;
        break;
      }
    }
  }

  // Every tunnel that is the only way between two parts of the maze (a "bridge": shut it and the maze falls in two).
  // Returns flags by cell * 4 + direction, both ways round. (Tarjan's bridge search, without recursion.)
  function bridges(lv) {
    const N = lv.N, disc = new Int32Array(N).fill(-1), low = new Int32Array(N), up = new Int32Array(N).fill(-1);
    const next = new Uint8Array(N), out = new Uint8Array(N * 4), stack = [];
    let t = 0;
    for (let s = 0; s < N; s++) {
      if (disc[s] >= 0) continue;
      disc[s] = low[s] = t++; stack.push(s);
      while (stack.length) {
        const c = stack[stack.length - 1];
        if (next[c] < 4) {
          const d = next[c]++;
          if (!(lv.open[c] & (1 << d))) continue;
          const m = lv.nb[c * 4 + d];
          if (m < 0) continue;
          if (up[c] >= 0 && m === up[c] >> 2 && d === OPP[up[c] & 3]) continue;   // the tunnel she came in by
          if (disc[m] < 0) { disc[m] = low[m] = t++; up[m] = c * 4 + d; stack.push(m); }
          else if (disc[m] < low[c]) low[c] = disc[m];
        } else {
          stack.pop();
          const e = up[c];
          if (e < 0) continue;
          const p = e >> 2;
          if (low[c] < low[p]) low[p] = low[c];
          if (low[c] > disc[p]) { out[e] = 1; out[c * 4 + OPP[e & 3]] = 1; }
        }
      }
    }
    return out;
  }
  // Hard: keys fetched in order (see HARD_LEVELS). Built from the way out backwards: the last gate on a bridge near
  // the end of the way; then, inside what she can reach with it shut, a pocket (cut off by one bridge, holding
  // nothing else) for the key that opens it, shut by the gate before; and so on, until key 0, which lies free.
  function placeChain(lv, spec, rng, used) {
    const n = spec.n, path = lv.path, br = lv.bridges || (lv.bridges = bridges(lv));
    const lo = Math.max(2, Math.floor(path.length * spec.last[0])), hi = Math.min(path.length - 3, Math.ceil(path.length * spec.last[1]));
    const lastAt = [];
    for (let i = lo; i <= hi; i++) {
      const a = path[i], b = path[i + 1];
      if (!used[a] && !used[b] && br[a * 4 + dirBetween(lv, a, b)]) lastAt.push(i);
    }
    if (!lastAt.length) return fail(lv, 'no spot for the last gate');
    const gi = pick(lastAt, rng), gates = new Array(n), keyCells = new Array(n);
    gates[n - 1] = [path[gi], path[gi + 1]];
    used[path[gi]] = used[path[gi + 1]] = 1;
    const onPath = new Uint8Array(lv.N);
    for (const c of path) onPath[c] = 1;
    // the farthest cell of a region from cell b (a dead end if it can be), and how far
    const deepest = (inside, b) => {
      const dist = new Int16Array(lv.N).fill(-1), q = [b];
      dist[b] = 0;
      let best = b;
      for (let qi = 0; qi < q.length; qi++) {
        const c = q[qi];
        if (dist[c] > dist[best] || (dist[c] === dist[best] && degree(lv.open[c]) === 1 && degree(lv.open[best]) !== 1)) best = c;
        for (let d = 0; d < 4; d++) {
          if (!(lv.open[c] & (1 << d))) continue;
          const m = lv.nb[c * 4 + d];
          if (m < 0 || dist[m] >= 0 || !inside[m]) continue;
          dist[m] = dist[c] + 1; q.push(m);
        }
      }
      return { cell: best, dist: dist[best] };
    };
    for (let k = n - 2; k >= 0; k--) {
      const shut = gates.slice(k + 1);
      const reach = region(lv, lv.start, shut), cands = [];
      for (let a = 0; a < lv.N; a++) {
        if (!reach[a] || used[a]) continue;
        for (let d = 0; d < 4; d++) {
          if (!(lv.open[a] & (1 << d)) || !br[a * 4 + d]) continue;
          const b = lv.nb[a * 4 + d];
          if (b < 0 || !reach[b] || used[b] || onPath[b]) continue;
          const pocket = region(lv, b, shut.concat([[a, b]]));
          if (pocket[lv.start]) continue;
          let size = 0, clash = false;
          for (let c = 0; c < lv.N; c++) if (pocket[c]) { size++; if (used[c]) clash = true; }
          if (clash || size < spec.pocket[0] || size > spec.pocket[1]) continue;
          const far = deepest(pocket, b);
          if (far.dist < (spec.keyDepth || 2)) continue;
          cands.push({ a, b, key: far.cell });
        }
      }
      if (!cands.length) return fail(lv, 'no pocket for key ' + (k + 1));
      const c = pick(cands, rng);
      gates[k] = [c.a, c.b]; keyCells[k + 1] = c.key;
      used[c.a] = used[c.b] = used[c.key] = 1;
    }
    // key 0: in a dead end at least `depth` cells off the way, reachable with every gate shut
    const reach = region(lv, lv.start, gates), dist = new Int16Array(lv.N).fill(-1), q = [];
    for (const c of path) if (reach[c]) { dist[c] = 0; q.push(c); }
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      for (let d = 0; d < 4; d++) {
        if (!(lv.open[c] & (1 << d))) continue;
        const m = lv.nb[c * 4 + d];
        if (m < 0 || dist[m] >= 0 || !reach[m] || gates.some((g) => (g[0] === c && g[1] === m) || (g[0] === m && g[1] === c))) continue;
        dist[m] = dist[c] + 1; q.push(m);
      }
    }
    const pool = [];
    for (let c = 0; c < lv.N; c++) if (reach[c] && !used[c] && dist[c] >= (spec.depth || 2) && degree(lv.open[c]) === 1) pool.push(c);
    if (!pool.length) return fail(lv, 'no spot for key 0');
    keyCells[0] = pick(pool, rng);
    used[keyCells[0]] = 1;
    for (let k = 0; k < n; k++) {
      const [a, b] = gates[k];
      lv.gates.push({ a, b, dir: dirBetween(lv, a, b) });
      lv.keys.push({ cell: keyCells[k] });
    }
  }

  // Lookup tables used every tick.
  function finish(lv) {
    const { W, N } = lv;
    lv.open[lv.exit] |= 1 << RIGHT;
    lv.nx = Int16Array.from(lv.nb);
    lv.nx[lv.exit * 4 + RIGHT] = N;              // the exit's right side opens onto the sea (cell N)
    lv.cx = new Float64Array(N + 1); lv.cy = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) { lv.cx[i] = i % W; lv.cy[i] = Math.floor(i / W); }
    lv.cx[N] = W; lv.cy[N] = lv.cy[lv.exit];
    lv.keyAt = new Int8Array(N).fill(-1);
    lv.keys.forEach((k, i) => { lv.keyAt[k.cell] = i; });
    lv.gateAt = new Int8Array(N * 4).fill(-1);
    lv.gates.forEach((g, i) => { lv.gateAt[g.a * 4 + g.dir] = i; lv.gateAt[g.b * 4 + OPP[g.dir]] = i; });
    lv.cur = new Int8Array(N).fill(-1);
    for (const c of lv.currents) for (const x of c.cells) lv.cur[x] = c.dir;
    lv.shellAt = new Int8Array(N).fill(-1);
    lv.shells.forEach((c, i) => { lv.shellAt[c] = i; });
    for (const p of lv.patrols) { p.x0 = lv.cx[p.cells[0]]; p.y0 = lv.cy[p.cells[0]]; p.dx = DX[p.axis]; p.dy = DY[p.axis]; }
  }

  // Build a level from its settings and a seed. lv.ok is false (with lv.why) if something did not fit;
  // the seeds in LEVELS all fit (test/games/maze/verify.js).
  function generate(cfg, seed) {
    const W = cfg.w, H = cfg.h, N = W * H, rng = rngFor(seed >>> 0);
    const nb = neighbours(W, H);
    const open = carve(W, H, nb, rng, cfg.bias);
    if (cfg.loops) addLoops(W, H, nb, open, rng, cfg.loops);
    const sy = Math.floor(rng() * H), ey = Math.floor(rng() * H);
    const lv = {
      cfg, seed: seed >>> 0, W, H, N, nb, open, start: sy * W, exit: ey * W + W - 1, path: null,
      keys: [], gates: [], currents: [], patrols: [], shells: [], dark: cfg.dark || 0, theme: cfg.theme || 0, ok: true, why: '',
    };
    lv.path = cellPath(lv, lv.start, lv.exit);
    const used = new Uint8Array(N);
    used[lv.start] = used[lv.exit] = 1;
    for (const k of cfg.keys || []) placeKey(lv, k, rng, used);
    for (const c of cfg.currents || []) placeCurrent(lv, c, rng, used);
    for (const p of cfg.patrols || []) placePatrol(lv, p, rng, used);
    if (lv.patrols.length) placeShells(lv, used);
    finish(lv);
    return lv;
  }
  // A Hard level: the same pieces, bigger, with keys fetched in order (placeChain) and one-way rings ('loop' currents).
  // Its own stream of random numbers, so no Easy level can change because of it.
  function generateHard(cfg, seed) {
    const W = cfg.w, H = cfg.h, N = W * H, rng = rngFor(((seed >>> 0) ^ 0x51ED270B) >>> 0);
    const nb = neighbours(W, H);
    const open = carve(W, H, nb, rng, cfg.bias);
    if (cfg.loops) addLoops(W, H, nb, open, rng, cfg.loops);
    // she starts on the left; the way out is on the right, a good way up or down from her
    const sy = Math.floor(rng() * H), rows = [];
    for (let y = 0; y < H; y++) if (Math.abs(y - sy) >= Math.ceil(H / 3)) rows.push(y);
    const ey = pick(rows, rng);
    const lv = {
      cfg, seed: seed >>> 0, W, H, N, nb, open, start: sy * W, exit: ey * W + W - 1, path: null, mode: 'hard',
      keys: [], gates: [], currents: [], patrols: [], shells: [], dark: cfg.dark || 0, theme: cfg.theme || 0, ok: true, why: '',
    };
    lv.path = cellPath(lv, lv.start, lv.exit);
    const used = new Uint8Array(N);
    used[lv.start] = used[lv.exit] = 1;
    if (cfg.chain) placeChain(lv, cfg.chain, rng, used);
    for (const c of cfg.currents || []) if (lv.ok) placeCurrent(lv, c, rng, used);
    for (const p of cfg.patrols || []) if (lv.ok) placePatrol(lv, p, rng, used);
    if (lv.ok && lv.patrols.length) placeShells(lv, used);
    finish(lv);
    return lv;
  }
  const MODES = ['easy', 'hard'];
  const levelsOf = (mode) => (mode === 'hard' ? HARD_LEVELS : LEVELS);
  function build(n, mode) {
    const hard = mode === 'hard', cfg = (hard ? HARD_LEVELS : LEVELS)[n - 1];
    if (!cfg) throw new Error('no ' + (hard ? 'hard ' : '') + 'level ' + n);
    const lv = hard ? generateHard(cfg, cfg.seed) : generate(cfg, cfg.seed);
    lv.n = n; lv.par = cfg.par; lv.mode = hard ? 'hard' : 'easy';
    return lv;
  }
  // Everything that makes up a level, for its fingerprint (test/games/maze/verify.js). (A Hard level says so too.)
  function describe(lv) {
    const parts = [lv.W, lv.H, Array.from(lv.open), lv.start, lv.exit, lv.keys.map((k) => k.cell), lv.gates.map((g) => [g.a, g.b]),
      lv.currents.map((c) => [c.cells, c.dir]), lv.patrols.map((p) => [p.cells, p.p0, p.s0, p.kind]), lv.shells, lv.dark];
    if (lv.mode === 'hard') parts.push('hard');
    return JSON.stringify(parts);
  }

  // ---------------------------------------------------------------- one tick
  function newState(lv) {
    return {
      cell: lv.start, moving: -1, carried: false, stopAt: -1, won: false, cp: -1,
      items: new Int8Array(lv.keys.length), pp: Int16Array.from(lv.patrols.map((p) => p.p0)), ps: Int8Array.from(lv.patrols.map((p) => p.s0)),
    };
  }
  function copyState(dst, src) {
    dst.cell = src.cell; dst.moving = src.moving; dst.carried = src.carried; dst.stopAt = src.stopAt; dst.won = src.won; dst.cp = src.cp;
    dst.items.set(src.items); dst.pp.set(src.pp); dst.ps.set(src.ps);
    return dst;
  }
  const cloneState = (lv, src) => copyState(newState(lv), src);

  // Can she swim from cell x in direction d? Not into a wall, a gate whose key she has not found, or a current
  // flowing the other way. (A gate whose key she holds opens as she arrives.)
  function canPass(lv, st, x, d) {
    if (!(lv.open[x] & (1 << d))) return false;
    const g = lv.gateAt[x * 4 + d];
    if (g >= 0 && st.items[g] === FLOOR) return false;
    const y = lv.nx[x * 4 + d];
    return !(y < lv.N && lv.cur[y] === OPP[d]);
  }
  // Why not? 'wall' | 'gate' | 'current' (for the bump she makes).
  function blockedBy(lv, st, x, d) {
    if (!(lv.open[x] & (1 << d))) return 'wall';
    const g = lv.gateAt[x * 4 + d];
    if (g >= 0 && st.items[g] === FLOOR) return 'gate';
    return 'current';
  }
  // A glide stops where she has a choice (a side tunnel) or cannot go on. Never just inside the exit.
  function shouldStop(lv, st, x, d) {
    if (x === lv.exit && d === RIGHT) return false;
    if (!canPass(lv, st, x, d)) return true;
    const o = lv.open[x];
    return !!(o & (1 << ((d + 1) & 3)) || o & (1 << ((d + 3) & 3)));
  }
  // Earliest moment u in [0, 1] when two points moving in straight lines come closer than HIT, or -1.
  function touch(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
    const dx = ax0 - bx0, dy = ay0 - by0, vx = ax1 - ax0 - (bx1 - bx0), vy = ay1 - ay0 - (by1 - by0);
    const c = dx * dx + dy * dy - HIT * HIT;
    if (c < 0) return 0;
    const a = vx * vx + vy * vy;
    if (a === 0) return -1;
    const b = 2 * (dx * vx + dy * vy), disc = b * b - 4 * a * c;
    if (disc <= 0) return -1;
    const u = (-b - Math.sqrt(disc)) / (2 * a);
    return u >= 0 && u <= 1 ? u : -1;
  }
  const patrolX = (p, q) => p.x0 + (p.dx * q) / P;
  const patrolY = (p, q) => p.y0 + (p.dy * q) / P;

  // Move the world one tick. `input` (0-3, or -1) starts a glide if she is resting; `tapTo` (a cell, or -1)
  // makes that glide stop at that cell instead of at the next turn. Returns 0, 1 if a patrol touched her
  // (she is back at her shell, resting) or 2 when she reaches the open sea. `out`, when given, is filled
  // with what happened, for the drawing and the sounds.
  function step(lv, st, input, tapTo, out) {
    const from = st.cell;
    let bonk = -1, started = false;
    if (st.moving < 0 && input >= 0 && !st.won) {
      if (canPass(lv, st, from, input)) { st.moving = input; st.carried = false; st.stopAt = tapTo >= 0 ? tapTo : -1; started = true; } else bonk = input;
    }
    const d = st.moving, resting = d < 0;
    let to = from, gate = -1;
    if (!resting) {
      const g = lv.gateAt[from * 4 + d];
      if (g >= 0 && st.items[g] === HELD) { st.items[g] = OPEN; gate = g; }
      to = lv.nx[from * 4 + d];
    }
    const ax0 = lv.cx[from], ay0 = lv.cy[from], ax1 = lv.cx[to], ay1 = lv.cy[to];
    let hit = -1, hitU = 2, shy = 0;
    for (let j = 0; j < lv.patrols.length; j++) {
      const pt = lv.patrols[j], p = st.pp[j];
      let s = st.ps[j], np = p + s;
      if (np < 0 || np > pt.maxP) { s = -s; np = p + s; }
      if (resting) {
        const qx = patrolX(pt, np) - ax0, qy = patrolY(pt, np) - ay0;
        if (qx * qx + qy * qy < SHY * SHY) { s = -s; np = p + s; if (np < 0 || np > pt.maxP) np = p; shy |= 1 << j; }
      } else {
        const u = touch(ax0, ay0, ax1, ay1, patrolX(pt, p), patrolY(pt, p), patrolX(pt, np), patrolY(pt, np));
        if (u >= 0 && u < hitU) { hit = j; hitU = u; }
      }
      st.pp[j] = np; st.ps[j] = s;
    }
    if (out) {
      out.from = from; out.to = to; out.dir = d; out.started = started; out.bonk = bonk; out.gate = gate; out.shy = shy;
      out.hit = hit; out.hitU = hit >= 0 ? hitU : 0; out.key = -1; out.shell = -1; out.swept = false; out.stopped = false; out.won = false;
    }
    if (hit >= 0) {
      st.cell = st.cp >= 0 ? lv.shells[st.cp] : lv.start;
      st.moving = -1; st.carried = false; st.stopAt = -1;
      return 1;
    }
    st.cell = to;
    if (to === lv.N) { st.moving = -1; st.carried = false; st.stopAt = -1; st.won = true; if (out) out.won = true; return 2; }
    const k = lv.keyAt[to];
    if (k >= 0 && st.items[k] === FLOOR) { st.items[k] = HELD; if (out) out.key = k; }
    const sh = lv.shellAt[to];
    if (sh >= 0 && st.cp !== sh) { st.cp = sh; if (out) out.shell = sh; }
    if (!resting) {
      const c = lv.cur[to];
      if (c >= 0) { if (out && !st.carried) out.swept = true; st.moving = c; st.carried = true; st.stopAt = -1; }
      else if (st.carried) { st.moving = -1; st.carried = false; }
      else if (st.stopAt >= 0) { if (to === st.stopAt || !canPass(lv, st, to, d)) { st.moving = -1; st.stopAt = -1; } }
      else if (shouldStop(lv, st, to, d)) st.moving = -1;
      if (out) out.stopped = st.moving < 0;
    }
    return 0;
  }
  // From rest: glide in direction d (to tapTo, if given) until she rests again, is touched or gets out.
  // Returns 0 / 1 / 2 as step() does; adds the ticks taken to res.ticks and each cell entered to res.cells.
  function glide(lv, st, d, tapTo, res) {
    let r = step(lv, st, d, tapTo, null), ticks = 1;
    if (res && res.cells && r !== 1) res.cells.push(st.cell);
    while (r === 0 && st.moving >= 0) {
      r = step(lv, st, -1, -1, null); ticks++;
      if (res && res.cells && r !== 1) res.cells.push(st.cell);
    }
    if (res) res.ticks = (res.ticks || 0) + ticks;
    return r;
  }
  // The cells a tap can send her to, straight along direction d (past side tunnels, not into a current).
  function tapRun(lv, st, x, d) {
    const out = [];
    for (let c = x; ;) {
      if (!(lv.open[c] & (1 << d))) break;
      const g = lv.gateAt[c * 4 + d];
      if (g >= 0 && st.items[g] === FLOOR) break;
      const y = lv.nx[c * 4 + d];
      if (y === lv.N) { out.push(y); break; }
      if (lv.cur[y] >= 0) break;
      out.push(y); c = y;
    }
    return out;
  }

  // ---------------------------------------------------------------- the solver
  // Resting states packed into one number: the cell, each key/gate pair, the last shell, each patrol.
  function codec(lv) {
    const N = lv.N, K = lv.keys.length, S = lv.shells.length, pats = lv.patrols, rad = pats.map((p) => (p.maxP + 1) * 2);
    return {
      enc(st) {
        let v = 0;
        for (let j = pats.length - 1; j >= 0; j--) v = v * rad[j] + st.pp[j] * 2 + (st.ps[j] > 0 ? 1 : 0);
        v = v * (S + 1) + st.cp + 1;
        for (let k = K - 1; k >= 0; k--) v = v * 3 + st.items[k];
        return v * N + st.cell;
      },
      dec(v, st) {
        st.cell = v % N; v = Math.floor(v / N);
        for (let k = 0; k < K; k++) { st.items[k] = v % 3; v = Math.floor(v / 3); }
        st.cp = (v % (S + 1)) - 1; v = Math.floor(v / (S + 1));
        for (let j = 0; j < pats.length; j++) { const q = v % rad[j]; v = Math.floor(v / rad[j]); st.pp[j] = q >> 1; st.ps[j] = q & 1 ? 1 : -1; }
        st.moving = -1; st.carried = false; st.stopAt = -1; st.won = false;
        return st;
      },
    };
  }
  // a small binary heap of (priority, value)
  function Heap() { this.p = []; this.v = []; }
  Heap.prototype.push = function (p, v) {
    const P_ = this.p, V = this.v;
    let i = P_.length;
    P_.push(p); V.push(v);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (P_[j] <= p) break;
      P_[i] = P_[j]; V[i] = V[j]; i = j;
    }
    P_[i] = p; V[i] = v;
  };
  Heap.prototype.pop = function () {
    const P_ = this.p, V = this.v, top = [P_[0], V[0]], lp = P_.pop(), lv = V.pop(), n = P_.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && P_[c + 1] < P_[c]) c++;
        if (P_[c] >= lp) break;
        P_[i] = P_[c]; V[i] = V[c]; i = c;
      }
      P_[i] = lp; V[i] = lv;
    }
    return top;
  };
  Object.defineProperty(Heap.prototype, 'size', { get() { return this.p.length; } });

  // A lower bound on what is left, for searching the big Hard levels quickly (A*): from each (cell, keys and gates),
  // the fewest glides out and then the fewest ticks, with the patrols left out, in the solver's own units
  // (BIG per glide + 1 per tick). A Hard way out is never touched by a patrol (see solve), so each of its glides ends
  // just where it would with no patrols at all, and waiting only adds ticks: so this never overestimates, and no move
  // lowers it by more than the move costs (the search stays exact). Worked out for every cell and every way the keys
  // can be (not only those the glides from the start reach), since a tap can leave her anywhere.
  function bound(lv) {
    if (!lv._bound) boundJob(lv).step(Infinity);
    return lv._bound;
  }
  const clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // The same, a little at a time (for the game's hint): step(until) works until performance.now() passes `until`,
  // and returns true once lv._bound is ready.
  function boundJob(lv) {
    if (lv._bound) return { step: () => true };
    const N = lv.N, K = lv.keys.length, I = Math.pow(3, K);
    const ghost = Object.assign({}, lv, { patrols: [] }), g = newState(ghost), res = { ticks: 0 };
    const ic = (items) => { let v = 0; for (let k = K - 1; k >= 0; k--) v = v * 3 + items[k]; return v; };
    const node = (cell, items) => ic(items) * N + cell;
    const total = I * N, INF = BIG * (1 << 30);
    const eFrom = new IntList(), eTo = new IntList(), eCost = new IntList(), WIN = -1, items = new Int8Array(K);
    let v = 0, dist = null, head = null, nxt = null, heap = null;
    return {
      step(until) {
        if (lv._bound) return true;
        // every glide from every (cell, keys and gates), with no patrols
        for (; v < total; v++) {
          if (until !== Infinity && (v & 63) === 63 && clockNow() > until) return false;
          const cell = v % N;
          let x = Math.floor(v / N);
          for (let k = 0; k < K; k++) { items[k] = x % 3; x = Math.floor(x / 3); }
          for (let d = 0; d < 4; d++) {
            g.cell = cell; g.items.set(items); g.cp = -1; g.moving = -1; g.carried = false; g.stopAt = -1; g.won = false;
            if (!canPass(ghost, g, cell, d)) continue;
            res.ticks = 0;
            const r = glide(ghost, g, d, -1, res);
            eFrom.push(v); eTo.push(r === 2 ? WIN : node(g.cell, g.items)); eCost.push(res.ticks);
          }
        }
        // cheapest way out from each, walking the moves backwards from the sea (Dijkstra)
        if (!heap) {
          dist = new Float64Array(total).fill(INF); head = new Int32Array(total).fill(-1); nxt = new Int32Array(eFrom.n); heap = new Heap();
          for (let e = 0; e < eFrom.n; e++) {
            const f = eFrom.a[e], t = eTo.a[e], c = BIG + eCost.a[e];
            if (t === WIN) { if (c < dist[f]) { dist[f] = c; heap.push(c, f); } continue; }
            nxt[e] = head[t]; head[t] = e;
          }
        }
        for (let n = 0; heap.size; n++) {
          if (until !== Infinity && (n & 255) === 255 && clockNow() > until) return false;
          const [c, t] = heap.pop();
          if (c > dist[t]) continue;
          for (let e = head[t]; e >= 0; e = nxt[e]) { const f = eFrom.a[e], c2 = c + BIG + eCost.a[e]; if (c2 < dist[f]) { dist[f] = c2; heap.push(c2, f); } }
        }
        const d2 = dist;
        lv._bound = { dist: d2, INF, of: (st) => d2[node(st.cell, st.items)] };
        return true;
      },
    };
  }

  // Fewest moves (glides) out from a resting state, and among those the quickest. Waiting is free (a move is
  // a swipe). Returns { par, ticks, steps: [{ dir, at, ticks, cells }] } with `at` the tick (counted from st0's
  // tick, `t0`) at which each glide must start, or null if there is no way out.
  // Easy levels are searched cheapest-first (Dijkstra); Hard ones are far bigger, so their search is steered by
  // bound() (A*), which finds a way out just as short, and just as quick, much sooner.
  // In Hard the way out is also one no patrol ever touches: a touch sends her back to her shell, which the search
  // could otherwise use as a shortcut, and a hint must never say "swim into the jellyfish".
  function solve(lv, st0, t0, opts) {
    const s = search(lv, st0, t0, opts);
    s.step(Infinity);
    return s.result;
  }
  // The same search, a little at a time (the game's hint in a big Hard level runs over several frames, so nothing
  // stutters): step(pops, until) works through at most `pops` states, or until performance.now() passes `until`,
  // and returns true once the search is over; then .result is what solve() returns. (Make lv's bound first, with
  // boundJob, if that too should not hold up a frame.)
  function search(lv, st0, t0, opts) {
    opts = opts || {};
    const C = codec(lv), start = st0 ? cloneState(lv, st0) : newState(lv);
    start.moving = -1; start.carried = false; start.stopAt = -1;
    const hard = lv.mode === 'hard';
    const B = hard && !opts.plain ? bound(lv) : null, h = B ? (s) => B.of(s) : () => 0;
    const k0 = C.enc(start), best = new Map([[k0, 0]]), from = new Map(), heap = new Heap();
    const st = newState(lv), tmp = newState(lv), res = { ticks: 0 }, waits = lv.patrols.length > 0;
    let win = null, popped = 0;
    const S = { done: false, result: null, popped: 0 };
    const relax = (k2, c2, k, act, s2) => {
      const b = best.get(k2);
      if (b === undefined || c2 < b) { best.set(k2, c2); from.set(k2, [k, act]); heap.push(c2 + h(s2), k2); }
    };
    const conclude = () => {
      S.done = true; S.popped = popped;
      if (!win) return true;
      const acts = [win.d];
      for (let k = win.key; k !== k0;) { const f = from.get(k); acts.push(f[1]); k = f[0]; }
      acts.reverse();
      // replay to find when each glide starts and where it goes
      const run = cloneState(lv, start), steps = [];
      let t = t0 || 0;
      for (const a of acts) {
        if (a < 0) { step(lv, run, -1, -1, null); t++; continue; }
        const g = { ticks: 0, cells: [] }, at = t;
        glide(lv, run, a, -1, g);
        steps.push({ dir: a, at, ticks: g.ticks, cells: g.cells });
        t += g.ticks;
      }
      S.result = { par: Math.floor(win.cost / BIG), ticks: win.cost % BIG, steps, states: best.size };
      return true;
    };
    S.step = (pops, until) => {
      if (S.done) return true;
      for (let n = 0; heap.size; n++) {
        if (n >= pops || (until && (n & 31) === 31 && clockNow() > until)) return false;
        const [f, key] = heap.pop();
        if (win && f >= win.cost) break;
        C.dec(key, st);
        const cost = best.get(key);
        if (f > cost + h(st)) continue;
        if (opts.limit && ++popped > opts.limit) { S.done = true; S.popped = popped; return true; }
        if (waits) { copyState(tmp, st); step(lv, tmp, -1, -1, null); relax(C.enc(tmp), cost + 1, key, -1, tmp); }
        for (let d = 0; d < 4; d++) {
          if (!canPass(lv, st, st.cell, d)) continue;
          copyState(tmp, st); res.ticks = 0;
          const r = glide(lv, tmp, d, -1, res), c2 = cost + BIG + res.ticks;
          if (r === 2) { if (!win || c2 < win.cost) win = { cost: c2, key, d }; continue; }
          if (r === 1 && hard) continue;
          relax(C.enc(tmp), c2, key, d, tmp);
        }
      }
      return conclude();
    };
    if (B && h(start) >= B.INF) { S.done = true; return S; }
    heap.push(h(start), k0);
    return S;
  }

  // A set of resting states (their codec numbers), each given an id in the order first seen: open addressing over
  // typed arrays, so the biggest Hard levels (millions of states) fit in memory and stay quick.
  function StateIds() { this.cap = 1 << 12; this.k = new Float64Array(this.cap).fill(-1); this.v = new Int32Array(this.cap); this.codes = new Float64Array(1 << 12); this.n = 0; }
  StateIds.prototype.slot = function (code) {
    const lo = code % 4294967296, hi = Math.floor(code / 4294967296), mask = this.cap - 1;
    let h = (Math.imul(lo | 0, 0x9E3779B1) ^ Math.imul(hi | 0, 0x85EBCA77)) >>> 0;
    h = (h ^ (h >>> 15)) & mask;
    while (this.k[h] !== -1 && this.k[h] !== code) h = (h + 1) & mask;
    return h;
  };
  StateIds.prototype.id = function (code) {
    let h = this.slot(code);
    if (this.k[h] === code) return this.v[h];
    if ((this.n + 1) * 2 > this.cap) { this.grow(); h = this.slot(code); }
    const i = this.n++;
    if (i >= this.codes.length) { const c = new Float64Array(this.codes.length * 2); c.set(this.codes); this.codes = c; }
    this.codes[i] = code; this.k[h] = code; this.v[h] = i;
    return i;
  };
  StateIds.prototype.get = function (code) { const h = this.slot(code); return this.k[h] === code ? this.v[h] : -1; };
  StateIds.prototype.grow = function () {
    const n = this.n;
    this.cap *= 2; this.k = new Float64Array(this.cap).fill(-1); this.v = new Int32Array(this.cap);
    for (let i = 0; i < n; i++) { const h = this.slot(this.codes[i]); this.k[h] = this.codes[i]; this.v[h] = i; }
  };
  // a growable list of whole numbers
  function IntList(n) { this.a = new Int32Array(n || 1024); this.n = 0; }
  IntList.prototype.push = function (x) { if (this.n === this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = x; };

  // Every resting state she can get into from the start (by glides, taps and waiting), and whether each one
  // can still get out. A fair level has no state she can get into but not out of.
  // (A tap along a straight run stops early on the very path a longer tap takes, so each run is swum once and
  // every cell on it read off as it passes: the same states and moves as tapping each cell in turn.)
  function explore(lv, opts) {
    opts = opts || {};
    const C = codec(lv), ids = new StateIds(), st = newState(lv), tmp = newState(lv), snap = newState(lv), N = lv.N;
    const cells = new Uint8Array(N + 1), res = { ticks: 0, cells: [] }, onRun = new Int32Array(N + 1).fill(-1);
    const off = new IntList(1024), to = new IntList(4096), WIN = -1;
    ids.id(C.enc(newState(lv)));
    let wins = 0;
    for (let i = 0; i < ids.n; i++) {
      C.dec(ids.codes[i], st);
      off.push(to.n);
      cells[st.cell] = 1;
      const add = (r, s) => { if (r === 2) { to.push(WIN); wins++; } else to.push(ids.id(C.enc(s))); };
      if (lv.patrols.length) { copyState(tmp, st); step(lv, tmp, -1, -1, null); add(0, tmp); }
      for (let d = 0; d < 4; d++) {
        if (!canPass(lv, st, st.cell, d)) continue;
        copyState(tmp, st); res.cells.length = 0; const r = glide(lv, tmp, d, -1, res);
        for (const c of res.cells) cells[c] = 1;
        add(r, tmp);
        if (!opts.taps) continue;
        const run = tapRun(lv, st, st.cell, d);
        if (!run.length) continue;
        for (let k = 0; k < run.length; k++) onRun[run[k]] = d;
        // swim the whole run once, as a tap on its last cell would, and take each cell on it as it is reached
        copyState(tmp, st);
        let rr = step(lv, tmp, d, run[run.length - 1], null), left = run.length;
        for (;;) {
          if (rr === 1) { for (; left > 0; left--) add(1, tmp); break; }       // touched: every tap further on ends the same
          if (rr === 2) { add(2, tmp); left--; break; }
          if (onRun[tmp.cell] === d) { copyState(snap, tmp); snap.moving = -1; snap.carried = false; snap.stopAt = -1; add(0, snap); left--; }
          if (tmp.moving < 0 || left === 0) break;
          rr = step(lv, tmp, -1, -1, null);
        }
        for (let k = 0; k < run.length; k++) onRun[run[k]] = -1;
        if (left > 0) throw new Error('explore: a tap run ended early');
      }
      if (opts.limit && ids.n > opts.limit) return null;
    }
    off.push(to.n);
    // which states can still reach the sea: walk the moves backwards from it
    const n = ids.n, canWin = new Uint8Array(n), E = to.n, O = off.a, T = to.a;
    const indeg = new Int32Array(n + 1);
    for (let e = 0; e < E; e++) if (T[e] >= 0) indeg[T[e] + 1]++;
    for (let i = 0; i < n; i++) indeg[i + 1] += indeg[i];
    const back = new Int32Array(Math.max(1, indeg[n])), fill = indeg.slice(0, n);
    const q = new Int32Array(n);
    let qn = 0;
    for (let i = 0; i < n; i++) {
      for (let e = O[i]; e < O[i + 1]; e++) {
        if (T[e] === WIN) { if (!canWin[i]) { canWin[i] = 1; q[qn++] = i; } } else back[fill[T[e]]++] = i;
      }
    }
    for (let qi = 0; qi < qn; qi++) {
      const x = q[qi];
      for (let e = indeg[x]; e < indeg[x + 1]; e++) { const f = back[e]; if (!canWin[f]) { canWin[f] = 1; q[qn++] = f; } }
    }
    let trapped = 0, firstTrap = -1;
    for (let i = 0; i < n; i++) if (!canWin[i]) { trapped++; if (firstTrap < 0) firstTrap = i; }
    let reach = 0;
    for (let c = 0; c < N; c++) reach += cells[c];
    return { states: n, moves: E, wins, trapped, trapState: firstTrap >= 0 ? C.dec(ids.codes[firstTrap], newState(lv)) : null, cellsReached: reach };
  }

  // How hard a level is, from the solver's best way out:
  //   par     fewest moves (glides) out
  //   cells   cells swum along that way
  //   choices wrong turns on offer along it: at every stop, each other way she could swim (not straight back)
  //   spare   cells she can reach that are not on that way (dead ends and long ways round to get lost in)
  //   things  4 per key and gate, 4 per patrol, 3 per current, and dark water 6 + 6 / (how far she can see)
  // difficulty = par + 0.8 x choices + 0.15 x spare + things
  //
  // That measures the way out well, but not two things that make the Hard levels hard: she cannot see the whole maze,
  // and she has to plan. So `hardness` adds to it (the Easy levels all fit on one screen, so for them it adds only
  // their little planning and waiting; the Easy seeds were picked by difficulty alone, which stays as it was):
  //   screens  how many more screens the maze fills than one (at the Hard tunnel size), +4 each: the part she cannot
  //            see is the part she has to explore and remember
  //   order    keys she can only reach through another gate, +3 each: the order has to be worked out
  //   again    cells the best way out swims through more than once (back for a key, round a one-way ring), +0.2 each
  //   waits    ticks the best way out waits for a patrol, +0.05 each (timing)
  // hardness = difficulty + 4 x screens + 3 x order + 0.2 x again + 0.05 x waits
  const HARD_CELL = 84;                   // the Hard tunnel size, in world units (the screen is 540 tall) (art.js)
  const SCREEN_CELLS = (1200 / HARD_CELL) * (540 / HARD_CELL);   // cells on one 20:9 screen at that size
  function analyze(lv, opts) {
    const sol = solve(lv);
    const ex = explore(lv, { taps: !(opts && opts.noTaps), limit: opts && opts.limit });
    if (!sol) return { ok: false, solvable: false, explore: ex };
    if (!ex) return { ok: false, solvable: true, fair: false, tooBig: true, par: sol.par };
    let choices = 0, cell = lv.start, cameFrom = -1, waits = 0, t = 0;
    const on = new Uint8Array(lv.N + 1), times = new Uint16Array(lv.N + 1);
    on[lv.start] = 1; times[lv.start] = 1;
    const st = newState(lv);
    for (const s of sol.steps) {
      while (t < s.at) { step(lv, st, -1, -1, null); t++; waits++; }
      for (let d = 0; d < 4; d++) if (d !== s.dir && d !== cameFrom && canPass(lv, st, cell, d)) choices++;
      glide(lv, st, s.dir, -1, null);
      t += s.ticks;
      for (const c of s.cells) { on[c] = 1; times[c]++; }
      const before = s.cells.length > 1 ? s.cells[s.cells.length - 2] : cell, last = dirBetween(lv, before, st.cell);
      cameFrom = OPP[last >= 0 ? last : s.dir];
      cell = st.cell;
    }
    let onWay = 0, again = 0;
    for (let c = 0; c < lv.N; c++) { onWay += on[c]; if (times[c] > 1) again += times[c] - 1; }
    const cells = sol.steps.reduce((a, s) => a + s.ticks, 0);
    const spare = Math.max(0, ex.cellsReached - onWay);
    const things = 4 * lv.keys.length + 4 * lv.patrols.length + 3 * lv.currents.length + (lv.dark ? 6 + 6 / lv.dark : 0);
    const difficulty = sol.par + 0.8 * choices + 0.15 * spare + things;
    // keys behind another gate: not reachable from the start with every gate shut
    const free = region(lv, lv.start, lv.gates.map((g) => [g.a, g.b]));
    const order = lv.keys.filter((k) => !free[k.cell]).length;
    const screens = Math.max(0, lv.N / SCREEN_CELLS - 1);
    const hardness = difficulty + 4 * screens + 3 * order + 0.2 * again + 0.05 * waits;
    return {
      ok: true, solvable: true, fair: ex.trapped === 0, par: sol.par, ticks: sol.ticks, cells, waits, choices, spare, things,
      difficulty: Math.round(difficulty * 10) / 10, states: ex.states, trapped: ex.trapped, trapState: ex.trapState, plan: sol.steps,
      screens: Math.round(screens * 100) / 100, order, again, hardness: Math.round(hardness * 10) / 10, moves: ex.moves,
    };
  }

  // ---------------------------------------------------------------- stars
  // 3 stars for finishing near the fewest moves, 2 within about twice that, otherwise 1. Finishing always counts.
  const threeStarMax = (par) => par + 1 + Math.floor(par / 4);
  const twoStarMax = (par) => 2 * par + 2;
  function starsFor(par, moves) {
    if (moves <= threeStarMax(par)) return 3;
    if (moves <= twoStarMax(par)) return 2;
    return 1;
  }

  const api = {
    LEVELS, HARD_LEVELS, MODES, levelsOf, HARD_CELL, SCREEN_CELLS, UP, RIGHT, DOWN, LEFT, DX, DY, OPP, DIRS, P, HIT, SHY, FLOOR, HELD, OPEN,
    mulberry32, rngFor, generate, generateHard, build, describe, newState, copyState, cloneState, bridges, region, cellPath,
    canPass, blockedBy, shouldStop, step, glide, tapRun, touch, patrolX, patrolY, solve, search, bound, boundJob, explore, analyze,
    starsFor, threeStarMax, twoStarMax,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MazeLogic = api;
})(typeof self !== 'undefined' ? self : this);
