/* Sea Words — the rules. Pure logic, no DOM: test/games/words/verify.js runs this same file in Node.
 *
 * Every puzzle is made fresh from a seed: which picture words, where they go, which way they read, and the
 * letters round them. The same seed always gives the same puzzle (so tests can replay one); the game asks for
 * a new random seed every time, so in play nothing repeats.
 *
 * Small children must never meet a rude word, so:
 *   - the letters round the words are consonants only (FILLER), so the filler can never spell anything by
 *     itself: anything readable has to run through a vowel of one of the picture words;
 *   - after filling, every row, column and diagonal is read both ways (all 8 directions) against the blocklist
 *     (blocklist.js). A hit re-rolls the filler letters it runs through; one made only of placed letters means
 *     the words are placed again;
 *   - the same scan makes each of the puzzle's words appear exactly once, and no other picture word at all,
 *     so a word can only ever be found where it was placed.
 * test/games/words/verify.js checks all of this with a scanner of its own over thousands of puzzles.
 *
 * Grid positions: cell (x, y), x across from the left, y down from the top. Directions are numbered clockwise
 * from east: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE. E, SE, S and NE read forwards (left to right, or top
 * to bottom); the other four read backwards. */
(function (root) {
  'use strict';
  const BLOCKLIST = typeof module !== 'undefined' && module.exports ? require('./blocklist.js') : root.WordsBlocklist;

  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const DIR_NAMES = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const FORWARD = [0, 1, 2, 7];
  const isForward = (d) => FORWARD.indexOf(d) >= 0;
  const isDiagonal = (d) => d % 2 === 1;

  // The fourteen picture words (art.js draws each one). No word sits inside another, either way round, so
  // finding one can never be mistaken for another. Panels list a puzzle's words in this order.
  const VOCAB = ['SHELL', 'FISH', 'CRAB', 'STAR', 'TURTLE', 'WHALE', 'OCTOPUS', 'SEAHORSE', 'DOLPHIN', 'PEARL', 'CORAL', 'CHEST', 'COIN', 'KEY'];
  // each word's highlight colour, always the same, so SHELL is always pink
  const COLORS = {
    SHELL: '#ff8fc0', FISH: '#ffa94d', CRAB: '#ff6b6b', STAR: '#ffd43b', TURTLE: '#69db7c', WHALE: '#4dabf7', OCTOPUS: '#b197fc',
    SEAHORSE: '#38d9a9', DOLPHIN: '#91a7ff', PEARL: '#e599f7', CORAL: '#ff8c69', CHEST: '#e0a96d', COIN: '#fcc419', KEY: '#a9e34b',
  };

  // The three modes. size: the grid is size x size (Easy grows to 6 x 6 for the six-letter TURTLE).
  // count: how many words (null = all of them). dirs: the ways words may read. cross: words may cross (share a
  // letter at an angle; never lie along each other). minDiag / minBack: at least this many diagonal / backwards
  // words. hintAfter: seconds without finding a word before a first letter glows. tol: how near (in cells) a
  // finger must start and end to a word's ends for the line to jump onto it.
  const MODES = {
    easy: { id: 'easy', size: 5, maxLen: 6, count: [1, 1], dirs: [0, 2], cross: false, minDiag: 0, minBack: 0, hintAfter: 20, tol: 0.75 },
    medium: { id: 'medium', size: 8, maxLen: 8, count: [3, 4], dirs: [0, 1, 2, 7], cross: false, minDiag: 1, minBack: 0, hintAfter: 40, tol: 0.75 },
    hard: { id: 'hard', size: 12, maxLen: 12, count: null, dirs: [0, 1, 2, 3, 4, 5, 6, 7], cross: true, minDiag: 3, minBack: 3, hintAfter: 40, tol: 0.8 },
  };
  const MODE_IDS = ['easy', 'medium', 'hard'];

  // Consonants only, and none of F, K, W, X, Z, J, Q, V, Y: no blocklisted word is made only of these letters.
  const FILLER = 'BCDGHLMNPRST';

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

  // ---------------------------------------------------------------- reading the grid
  // Every row, column and diagonal of a W x H grid as a list of cell indices (y * W + x), in its forwards order.
  // Reading each one forwards and backwards covers all 8 directions.
  const lineCache = new Map();
  function linesFor(W, H) {
    const key = W + 'x' + H;
    let L = lineCache.get(key);
    if (L) return L;
    L = [];
    const walk = (x, y, d) => { const cells = []; while (x >= 0 && x < W && y >= 0 && y < H) { cells.push(y * W + x); x += DX[d]; y += DY[d]; } return cells; };
    for (let y = 0; y < H; y++) L.push(walk(0, y, 0));
    for (let x = 0; x < W; x++) L.push(walk(x, 0, 2));
    for (let x = 0; x < W; x++) L.push(walk(x, 0, 1));
    for (let y = 1; y < H; y++) L.push(walk(0, y, 1));
    for (let y = 0; y < H; y++) L.push(walk(0, y, 7));
    for (let x = 1; x < W; x++) L.push(walk(x, H - 1, 7));
    lineCache.set(key, L);
    return L;
  }
  // one pattern for a list of words; the look-ahead finds overlapping hits, the longest word first at each letter
  const anyOf = (words) => new RegExp('(?=(' + words.slice().sort((a, b) => b.length - a.length).join('|') + '))', 'g');
  const BLOCK_RE = anyOf(BLOCKLIST), VOCAB_RE = anyOf(VOCAB);
  // Every hit of a pattern in the grid: { word, cells } with cells (indices) in reading order.
  function scan(letters, W, H, re) {
    const hits = [];
    for (const cells of linesFor(W, H)) {
      if (cells.length < 3) continue;
      let fwd = '';
      for (const c of cells) fwd += letters[c];
      for (let back = 0; back < 2; back++) {
        const str = back ? fwd.split('').reverse().join('') : fwd, map = back ? cells.slice().reverse() : cells;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(str)) !== null) {
          hits.push({ word: m[1], cells: map.slice(m.index, m.index + m[1].length) });
          re.lastIndex = m.index + 1;
        }
      }
    }
    return hits;
  }
  const sameCells = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);
  // What is wrong with a filled grid: rude words, and picture words anywhere but where they were placed.
  // placed: word -> its cells (indices, in reading order).
  function problems(letters, W, H, placed) {
    const out = [];
    for (const h of scan(letters, W, H, BLOCK_RE)) out.push({ kind: 'rude', word: h.word, cells: h.cells });
    for (const h of scan(letters, W, H, VOCAB_RE)) {
      const mine = placed[h.word];
      if (!mine || !sameCells(h.cells, mine)) out.push({ kind: mine ? 'twice' : 'stray', word: h.word, cells: h.cells });
    }
    return out;
  }

  // ---------------------------------------------------------------- making a puzzle
  function pickWords(mode, rng) {
    if (!mode.count) return VOCAB.slice();
    const pool = VOCAB.filter((w) => w.length <= mode.maxLen);
    const n = mode.count[0] + Math.floor(rng() * (mode.count[1] - mode.count[0] + 1));
    const chosen = shuffle(pool, rng).slice(0, n);
    return VOCAB.filter((w) => chosen.indexOf(w) >= 0);
  }

  // Place the words (longest first) by backtracking over shuffled positions. Returns { letter, owners, at } or
  // null when it runs out of tries (the caller starts again, still from the same random stream).
  function placeWords(words, W, H, mode, rng) {
    const N = W * H, letter = new Array(N).fill(''), owners = new Uint8Array(N), axes = new Uint8Array(N);
    const order = shuffle(words.map((_, i) => i), rng).sort((a, b) => words[b].length - words[a].length);
    const at = new Array(words.length).fill(null);
    let budget = 2500;
    function candidates(word) {
      const out = [], L = word.length;
      for (const d of mode.dirs) {
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const ex = x + DX[d] * (L - 1), ey = y + DY[d] * (L - 1);
            if (ex < 0 || ex >= W || ey < 0 || ey >= H) continue;
            let ok = true;
            for (let i = 0; i < L && ok; i++) {
              const c = (y + DY[d] * i) * W + x + DX[d] * i;
              if (owners[c]) ok = mode.cross && letter[c] === word[i] && !(axes[c] & (1 << (d % 4)));
            }
            if (ok) out.push({ x, y, d });
          }
        }
      }
      return shuffle(out, rng);
    }
    function put(word, p, on) {
      for (let i = 0; i < word.length; i++) {
        const c = (p.y + DY[p.d] * i) * W + p.x + DX[p.d] * i;
        if (on) { owners[c]++; letter[c] = word[i]; axes[c] |= 1 << (p.d % 4); }
        else { owners[c]--; if (!owners[c]) letter[c] = ''; axes[c] &= ~(1 << (p.d % 4)); }
      }
    }
    function rec(k) {
      if (k === order.length) return true;
      const wi = order[k], word = words[wi], list = candidates(word);
      for (let j = 0; j < list.length && j < 30; j++) {
        if (--budget < 0) return false;
        put(word, list[j], true); at[wi] = list[j];
        if (rec(k + 1)) return true;
        put(word, list[j], false); at[wi] = null;
      }
      return false;
    }
    return rec(0) ? { letter, owners, at } : null;
  }
  function mixOk(at, mode) {
    let diag = 0, back = 0;
    for (const a of at) { if (isDiagonal(a.d)) diag++; if (!isForward(a.d)) back++; }
    return diag >= mode.minDiag && back >= mode.minBack;
  }
  const cellsOf = (a, len, W) => Array.from({ length: len }, (_, i) => (a.y + DY[a.d] * i) * W + a.x + DX[a.d] * i);
  // a different filler letter from `old`
  function otherFiller(old, rng) {
    let ch = old;
    while (ch === old) ch = FILLER[Math.floor(rng() * FILLER.length)];
    return ch;
  }

  // Fix what problems() finds by re-rolling the filler letters inside each bad run. False if a bad run is made of
  // placed letters only (then the words must be placed again).
  function repair(letters, owners, W, H, placed, rng, stats) {
    for (let pass = 0; pass < 40; pass++) {
      const bad = problems(letters, W, H, placed);
      if (!bad.length) return true;
      for (const b of bad) {
        if (b.kind === 'rude') stats.rude.push(b.word); else stats.stray++;
        const free = b.cells.filter((c) => !owners[c]);
        if (!free.length) { stats.locked++; return false; }
        for (const c of free) letters[c] = otherFiller(letters[c], rng);
      }
      stats.repairs++;
    }
    return false;
  }

  // The puzzle for a mode and seed:
  //   { mode, seed, cols, rows, grid: [row strings], words: [{ word, x, y, dir, dirName, len, cells: [[x, y]...], color }],
  //     stats: { restarts, repairs, rude: [blocked words that turned up and were re-rolled], stray, locked } }
  function generate(modeId, seed) {
    const mode = MODES[modeId];
    if (!mode) throw new Error('unknown mode ' + modeId);
    seed = seed >>> 0;
    const rng = rngFor(seed), words = pickWords(mode, rng);
    const W = modeId === 'easy' ? Math.max(mode.size, words[0].length) : mode.size, H = W;
    const stats = { restarts: 0, repairs: 0, rude: [], stray: 0, locked: 0 };
    for (let attempt = 0; attempt < 300; attempt++) {
      const pl = placeWords(words, W, H, mode, rng);
      if (!pl || !mixOk(pl.at, mode)) { stats.restarts++; continue; }
      const letters = pl.letter.slice();
      for (let c = 0; c < W * H; c++) if (!pl.owners[c]) letters[c] = FILLER[Math.floor(rng() * FILLER.length)];
      const placed = {};
      words.forEach((w, i) => { placed[w] = cellsOf(pl.at[i], w.length, W); });
      if (!repair(letters, pl.owners, W, H, placed, rng, stats)) { stats.restarts++; continue; }
      return {
        mode: modeId, seed, cols: W, rows: H,
        grid: Array.from({ length: H }, (_, y) => letters.slice(y * W, y * W + W).join('')),
        words: words.map((w, i) => {
          const a = pl.at[i];
          return { word: w, x: a.x, y: a.y, dir: a.d, dirName: DIR_NAMES[a.d], len: w.length, color: COLORS[w], cells: Array.from({ length: w.length }, (_, k) => [a.x + DX[a.d] * k, a.y + DY[a.d] * k]) };
        }),
        stats,
      };
    }
    throw new Error(`could not make a ${modeId} puzzle from seed ${seed}`);
  }
  // A string that pins a puzzle down exactly (for "same seed, same puzzle" and "different seeds, different puzzles").
  const describe = (p) => `${p.mode}|${p.cols}x${p.rows}|${p.grid.join('/')}|${p.words.map((w) => `${w.word}@${w.x},${w.y},${w.dirName}`).join(';')}`;

  // ---------------------------------------------------------------- a finger's line
  // Points are in grid units: cell (x, y) covers [x, x+1) x [y, y+1), so its centre is (x + 0.5, y + 0.5).
  // a = where the finger went down, b = where it is now. The line starts at the cell under `a` (or the nearest one,
  // just outside the grid), and its direction and length come from the whole drag, measured from that cell's
  // centre, snapped to the 8 directions. Once it points one way it keeps that way until the finger strays more than
  // 30 degrees from it (prevDir), so a wobbly finger does not flick it about.
  // Forgiving: if the finger went down near one end of an unfound word and is now near its other end (within
  // `tol` cells of each), the line jumps onto that word (`magnet`).
  // Returns null for a touch well outside the grid, else { start, dir, n, cells: [[x, y]...], magnet, reversed }.
  const HYST = Math.PI / 6, EDGE = 0.6;
  const centre = (cell) => ({ x: cell[0] + 0.5, y: cell[1] + 0.5 });
  function angleDiff(a, b) { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; }
  function room(x, y, d, W, H) {
    let n = 0;
    for (;;) {
      const nx = x + DX[d] * (n + 1), ny = y + DY[d] * (n + 1);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return n;
      n++;
    }
  }
  function select(p, a, b, prevDir, found, tol) {
    const W = p.cols, H = p.rows;
    if (!(a.x >= -EDGE && a.y >= -EDGE && a.x <= W + EDGE && a.y <= H + EDGE)) return null;
    const sx = Math.min(W - 1, Math.max(0, Math.floor(a.x))), sy = Math.min(H - 1, Math.max(0, Math.floor(a.y)));
    const dx = b.x - (sx + 0.5), dy = b.y - (sy + 0.5);
    let dir = -1, n = 0;
    if (Math.hypot(dx, dy) >= 0.35) {
      const ang = Math.atan2(dy, dx);
      dir = (Math.round(ang / (Math.PI / 4)) % 8 + 8) % 8;
      if (prevDir >= 0 && prevDir !== dir && angleDiff(ang, (prevDir * Math.PI) / 4) <= HYST) dir = prevDir;
      n = Math.round((dx * DX[dir] + dy * DY[dir]) / (DX[dir] * DX[dir] + DY[dir] * DY[dir]));
      n = Math.max(0, Math.min(n, room(sx, sy, dir, W, H)));
    }
    let cells = [];
    for (let i = 0; i <= n; i++) cells.push(dir >= 0 ? [sx + DX[dir] * i, sy + DY[dir] * i] : [sx, sy]);
    const t = tol == null ? 0.75 : tol;
    let magnet = -1, best = Infinity, reversed = false;
    for (let i = 0; i < p.words.length; i++) {
      if (found && found[i]) continue;
      const w = p.words[i], A = centre(w.cells[0]), B = centre(w.cells[w.cells.length - 1]);
      for (let k = 0; k < 2; k++) {
        const s = k ? B : A, e = k ? A : B;
        const e0 = Math.hypot(a.x - s.x, a.y - s.y), e1 = Math.hypot(b.x - e.x, b.y - e.y);
        if (e0 <= t && e1 <= t && e0 + e1 < best) { best = e0 + e1; magnet = i; reversed = k === 1; }
      }
    }
    if (magnet >= 0) { const wc = p.words[magnet].cells; cells = reversed ? wc.slice().reverse() : wc.slice(); }
    return { start: [sx, sy], dir, n, cells, magnet, reversed };
  }
  // The cells of a line equal an unfound word's cells, either way round? Its index, else -1.
  function matchCells(p, cells, found) {
    if (!cells || cells.length < 2) return -1;
    for (let i = 0; i < p.words.length; i++) {
      if (found && found[i]) continue;
      const wc = p.words[i].cells, L = wc.length;
      if (L !== cells.length) continue;
      let fwd = true, back = true;
      for (let k = 0; k < L; k++) {
        if (wc[k][0] !== cells[k][0] || wc[k][1] !== cells[k][1]) fwd = false;
        if (wc[k][0] !== cells[L - 1 - k][0] || wc[k][1] !== cells[L - 1 - k][1]) back = false;
      }
      if (fwd || back) return i;
    }
    return -1;
  }
  // What a finger lifting with this line finds: a word's index, or -1 (nothing; the line just fades).
  function judge(p, sel, found) {
    if (!sel) return -1;
    if (sel.magnet >= 0 && !(found && found[sel.magnet])) return sel.magnet;
    return matchCells(p, sel.cells, found);
  }

  // ---------------------------------------------------------------- stars (Hard only): never for speed
  const starsFor = (hints) => (hints <= 0 ? 3 : hints <= 2 ? 2 : 1);

  const api = {
    VOCAB, COLORS, MODES, MODE_IDS, FILLER, BLOCKLIST, DX, DY, DIR_NAMES, FORWARD, isForward, isDiagonal,
    mulberry32, rngFor, shuffle, linesFor, scan, problems, BLOCK_RE, VOCAB_RE, generate, describe,
    select, matchCells, judge, starsFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WordsLogic = api;
})(typeof self !== 'undefined' ? self : this);
