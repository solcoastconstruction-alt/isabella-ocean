/* Petal Patterns: the rules. Pure logic with no DOM, so Node can test it (test/games/petals/verify.js).
 *
 * A round is a row of flowers that follows a pattern, with the next flower missing (a "?"). Every flower has a
 * colour (7 rainbow colours), a kind (6) and a size (small or big). The row is built from a PATTERN FAMILY:
 *   AB  ABB  AAB  ABC  AABB  ABAC  ABCD     periodic (a repeating unit)
 *   GROW                                    a staircase: A, AB, ABC, ... (the groups get longer)
 *   ODD                                     "which one does not fit": one pot in the row breaks the pattern
 * and each attribute that VARIES follows its own cycle (colour AB while kind ABC, say). Attributes that do not
 * vary stay the same all along the row.
 *
 * THE RULE THAT MATTERS MOST: every round has exactly one right answer. analyse() is the guard that every
 * generated round must pass (a round that fails is re-rolled and counted): it enumerates every periodic
 * hypothesis that the shown row supports (each attribute independently, any period of up to half the row),
 * and the staircase hypothesis, and checks that all of them predict the same next flower, that exactly one
 * choice is that flower, and that every wrong choice differs from it in colour or kind (never the same colour AND
 * kind). test/games/petals/verify.js checks the same thing again with a separate brute-force solver.
 *
 * Rounds are generated from a seed per level and mode (and a "variant" for replays) and frozen by fingerprint.
 * Layout helpers (where the pots and the choice flowers go) live here too, so the 19vh touch rule is testable. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.PetalLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NLEV = 20, PAGE = 10, NCOL = 7, NKIND = 6;
  const MODES = ['easy', 'medium', 'hard'];
  const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
  const SHAPES = { AB: [0, 1], ABB: [0, 1, 1], AAB: [0, 0, 1], ABC: [0, 1, 2], AABB: [0, 0, 1, 1], ABAC: [0, 1, 0, 2], ABCD: [0, 1, 2, 3] };
  const PERIODIC = Object.keys(SHAPES);
  const COST = { AB: 1, ABB: 2, AAB: 2, ABC: 3, AABB: 4, ABAC: 5, ABCD: 6, GROW: 7, ODD: 8 };
  const HINT_S = { easy: 8, medium: 15, hard: 25 };       // seconds without a tap before the hint hand shows
  const CHOICES = { easy: 2, medium: 3, hard: 4 };
  const PERIODS = { easy: 2, medium: 2.5, hard: 3 };      // periods shown before the "?"
  const MAX_SHOWN = { easy: 8, medium: 10, hard: 12 };
  const GROW_SHAPE = { easy: { g: 3, j: 1 }, medium: { g: 3, j: 2 }, hard: { g: 4, j: 2 } };   // complete groups, then j pots of the next group
  const COLOUR_MIN_DIST = 55;                              // any two of the seven colours differ by at least this (RGB distance)
  const SIZE_SCALE = [0.74, 1.08];                         // small, big
  const MAX_ATTEMPTS = 400;

  // ---- numbers: a seeded generator (the same on every machine) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function fnv(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const ri = (rng, n) => Math.floor(rng() * n);
  const pick = (rng, arr) => arr[ri(rng, arr.length)];
  function shuffle(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = ri(rng, i + 1), t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const periodOf = (shape) => SHAPES[shape].length;
  const lettersOf = (shape) => Math.max.apply(null, SHAPES[shape]) + 1;

  // a flower is [colour 0..6, kind 0..5, size 0|1]
  const fkey = (f) => (f[0] * 6 + f[1]) * 2 + f[2];
  const fsame = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const fcopy = (f) => [f[0], f[1], f[2]];
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function colourDist(a, b) {
    const A = hexRgb(RAINBOW[a]), B = hexRgb(RAINBOW[b]);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  }

  // ---------- the level table ----------
  // One entry per level, written for Medium (the reference). attr: which attributes vary:
  //   'c' colour only   'k' kind only   'ck' colour and kind change TOGETHER (a flower is a colour+kind pair)
  //   'indep' colour, kind (and on Hard, size) each follow a cycle of their own.
  // sh: the periodic families a round may use ('c', 'k', 'ck'); cs, ks, ss the same per attribute ('indep').
  // nc, nk: how many colours / kinds the round draws on. traps: how near the wrong choices are (0 anything, 4 all near misses).
  const AB = 'AB', ABB = 'ABB', AAB = 'AAB', ABC = 'ABC', AABB = 'AABB', ABAC = 'ABAC', ABCD = 'ABCD';
  const RAW = [
    /*  1 */ { attr: 'c', sh: [AB], nc: 3, nk: 0, traps: 0 },
    /*  2 */ { attr: 'c', sh: [AB], nc: 4, nk: 0, traps: 1 },
    /*  3 */ { attr: 'c', sh: [AB, ABB, AAB], nc: 4, nk: 0, traps: 1 },
    /*  4 */ { attr: 'k', sh: [AB, ABB, AAB], nc: 0, nk: 4, traps: 2 },
    /*  5 */ { attr: 'k', sh: [AB, ABB, AAB, ABC], nc: 0, nk: 5, traps: 2 },
    /*  6 */ { attr: 'k', sh: [AB, ABB, AAB, ABC], nc: 0, nk: 5, traps: 3 },
    /*  7 */ { attr: 'ck', sh: [AB, ABB, AAB, ABC], nc: 5, nk: 5, traps: 3 },
    /*  8 */ { attr: 'ck', sh: [AB, ABB, AAB, ABC], nc: 6, nk: 5, traps: 3 },
    /*  9 */ { attr: 'ck', sh: [AB, ABB, AAB, ABC, AABB], nc: 6, nk: 6, traps: 3 },
    /* 10 */ { attr: 'ck', sh: [AB, ABB, AAB, ABC, AABB], nc: 7, nk: 6, traps: 4 },
    /* 11 */ { attr: 'ck', sh: [ABB, AAB, ABC, AABB, ABCD], nc: 7, nk: 6, traps: 4 },
    /* 12 */ { attr: 'ck', sh: [ABB, AAB, ABC, AABB, ABAC, ABCD], nc: 7, nk: 6, traps: 4 },
    /* 13 */ { attr: 'ck', sh: [ABB, AAB, ABC, AABB, ABAC, ABCD], ss: [AB], nc: 7, nk: 6, traps: 5 },
    /* 14 */ { attr: 'indep', cs: [AB, ABB, AAB, ABC], ks: [AB, ABC, AABB], ss: [], nc: 7, nk: 6, traps: 5 },
    /* 15 */ { attr: 'indep', cs: [AB, ABB, AAB, ABC, AABB], ks: [AB, ABC, AABB, ABAC], ss: [AB], nc: 7, nk: 6, traps: 5 },
    /* 16 */ { attr: 'indep', cs: [AB, ABB, AAB, ABC, AABB, ABAC], ks: [AB, ABC, AABB, ABAC], ss: [AB, ABB], nc: 7, nk: 6, traps: 5, grow: true },
    /* 17 */ { attr: 'indep', cs: [AB, ABB, AAB, ABC, AABB, ABAC, ABCD], ks: [AB, ABC, AABB, ABAC, ABCD], ss: [AB, ABB, AAB], nc: 7, nk: 6, traps: 5, grow: true },
    /* 18 */ { attr: 'indep', cs: [AB, ABB, AAB, ABC, AABB, ABAC, ABCD], ks: [AB, ABB, ABC, AABB, ABAC, ABCD], ss: [AB, ABB, AAB], nc: 7, nk: 6, traps: 5, grow: true, odd: true },
    /* 19 */ { attr: 'indep', cs: [AB, ABB, AAB, ABC, AABB, ABAC, ABCD], ks: [AB, ABB, AAB, ABC, AABB, ABAC, ABCD], ss: [AB, ABB, AAB], nc: 7, nk: 6, traps: 5, grow: true, odd: true },
    /* 20 */ { attr: 'indep', cs: [AB, ABB, AAB, ABC, AABB, ABAC, ABCD], ks: [AB, ABB, AAB, ABC, AABB, ABAC, ABCD], ss: [AB, ABB, AAB, AABB], nc: 7, nk: 6, traps: 5, grow: true, odd: true },
  ];
  // the dearest family Easy may use at each level (Easy keeps to simple units; ABAC and ABCD arrive late)
  const EASY_COST = [1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6];   // (Easy never sees a staircase before 18)
  const roundsIn = (n) => (n >= 11 ? 6 : 5);
  const worldOf = (n) => (n >= 11 ? 2 : 1);

  const uniq = (a) => a.filter((v, i) => a.indexOf(v) === i);
  const byCost = (a) => a.slice().sort((p, q) => COST[p] - COST[q] || (p < q ? -1 : 1));

  // The effective rules for one level in one mode.
  function config(level, mode) {
    level = clamp(Math.floor(level) || 1, 1, NLEV);
    if (MODES.indexOf(mode) < 0) mode = 'easy';
    const S = RAW[level - 1], easy = mode === 'easy', hard = mode === 'hard';
    const choices = CHOICES[mode];
    // every periodic family the round could use, per attribute
    let lists;   // { c, k, s, ck } of family names
    if (S.attr === 'indep') lists = { c: S.cs, k: S.ks, s: hard ? S.ss : [], ck: [] };
    else if (S.attr === 'ck') lists = { c: [], k: [], s: hard ? (S.ss || []) : [], ck: S.sh };
    else lists = { c: S.attr === 'c' ? S.sh : [], k: S.attr === 'k' ? S.sh : [], s: [], ck: [] };
    // Hard also meets the families of the next level (in World 1)
    if (hard && S.attr !== 'indep' && level <= 10) {
      const ahead = RAW[Math.min(level + 1, 10) - 1];
      const extra = ahead.sh;
      if (S.attr === 'c') lists.c = byCost(uniq(S.sh.concat(extra))); else if (S.attr === 'k') lists.k = byCost(uniq(S.sh.concat(extra))); else lists.ck = byCost(uniq(S.sh.concat(extra)));
    }
    let easyShapes = [];
    if (easy) {
      let all = [];
      for (let i = 0; i < level; i++) all = all.concat(RAW[i].sh || [], RAW[i].cs || [], RAW[i].ks || []);
      easyShapes = byCost(uniq(all).filter((sh) => COST[sh] <= EASY_COST[level - 1]));
    }
    const cfg = {
      level, mode, world: worldOf(level), rounds: roundsIn(level), choices, periods: PERIODS[mode], hint: HINT_S[mode],
      attr: S.attr, link: easy ? 'single' : S.attr === 'indep' ? 'indep' : S.attr === 'ck' ? 'combo' : 'single',
      lists, easyShapes,
      nc: S.nc ? clamp(Math.max(S.nc + (hard ? 1 : 0), choices + 1), 3, NCOL) : 0,
      nk: S.nk ? clamp(Math.max(S.nk + (hard ? 1 : 0), choices + 1), 3, NKIND) : 0,
      traps: easy ? Math.min(S.traps, 1) : hard ? Math.min(5, S.traps + 1) : S.traps,
      grow: easy ? level >= 18 : !!S.grow,
      odd: hard && !!S.odd,
      maxShown: MAX_SHOWN[mode], growShape: GROW_SHAPE[mode],
    };
    // colour-only levels still need a pool of kinds to hold constant, and kind-only levels a pool of colours: anything goes
    if (!cfg.nc) cfg.nc = NCOL;
    if (!cfg.nk) cfg.nk = NKIND;
    cfg.types = typesFor(cfg);
    // which attributes may vary here (for the table and the tests)
    cfg.attrs = easy ? 1 : S.attr === 'c' || S.attr === 'k' ? 1 : S.attr === 'ck' ? (hard && S.ss ? 3 : 2) : hard && S.ss.length ? 3 : 2;
    return cfg;
  }
  // 'P' periodic, 'G' growing, 'O' odd one out, per round (the first round is always plain)
  function typesFor(cfg) {
    const R = cfg.rounds, t = new Array(R).fill('P'), L = cfg.level;
    const put = (idx, ch) => idx.forEach((i) => { if (i < R && i > 0) t[i] = ch; });
    if (cfg.grow) {
      if (cfg.mode === 'easy') put([3], 'G');
      else if (L === 16) put([3], 'G');
      else if (L === 17) put([2, 4], 'G');
      else if (cfg.mode === 'hard') put(L === 18 ? [2, 5] : [2, 4], 'G');
      else put([2, 4], 'G');
    }
    if (cfg.odd) put(L === 18 ? [1, 4] : [1, 3, 5], 'O');
    return t;
  }

  // How hard a level is, as one number (the tests need it to rise 1 -> 10 and 11 -> 20, 11 above 10, Easy < Medium < Hard).
  function difficulty(level, mode) {
    const c = config(level, mode), fam = new Set();
    let costSum = 0;
    const lists = c.mode === 'easy' ? [c.easyShapes] : [c.lists.c, c.lists.k, c.lists.s, c.lists.ck];
    for (const l of lists) { if (l.length) costSum += Math.max.apply(null, l.map((s) => COST[s])); l.forEach((s) => fam.add(s)); }
    let pairs = 0; for (const l of lists) pairs += l.length;
    let growRow = 0;
    if (c.grow) { costSum += COST.GROW; pairs++; growRow = (c.growShape.g * (c.growShape.g + 1)) / 2 + c.growShape.j; }
    if (c.odd) { costSum += COST.ODD; pairs++; }
    const link = c.link === 'indep' ? 3 : c.link === 'combo' ? 1 : 0;
    const maxP = maxPeriod(c);
    const row = Math.min(c.maxShown, Math.ceil(c.periods * maxP));
    const pool = c.mode === 'easy' || c.attr === 'c' || c.attr === 'k' ? (c.attr === 'c' ? c.nc : c.attr === 'k' ? c.nk : Math.max(c.nc, c.nk)) : c.nc + c.nk;
    return costSum * 10 + pairs * 2 + c.attrs * 6 + link * 5 + c.choices * 4 + row + growRow + pool + c.traps * 3;
  }
  function maxPeriod(c) {
    const lists = c.mode === 'easy' ? [c.easyShapes] : [c.lists.c, c.lists.k, c.lists.s, c.lists.ck];
    let m = 2;
    for (const l of lists) for (const s of l) m = Math.max(m, periodOf(s));
    return m;
  }

  // ---------- pattern building ----------
  // the cycle of one attribute: letters of a shape mapped to values
  function cycleOf(shape, values) { return SHAPES[shape].map((l) => values[l]); }
  const atCycle = (cyc, i) => cyc[i % cyc.length];
  function rowLength(mode, maxP) {
    const m = mode === 'easy' ? 2 * maxP : mode === 'medium' ? Math.ceil(2.5 * maxP) : 3 * maxP;
    return Math.min(m, MAX_SHOWN[mode]);
  }

  // Wrong choices. Candidates differ from the answer in colour or kind (never both the same); `traps` picks how near they are.
  function makeChoices(rng, cfg, V, pools, row, answer, nWrong, traps) {
    const has = (a) => V.indexOf(a) >= 0;
    const colours = has('c') ? pools.c : [answer[0]], kinds = has('k') ? pools.k : [answer[1]], sizes = has('s') ? [0, 1] : [answer[2]];
    const all = [];
    for (const c of colours) for (const k of kinds) for (const s of sizes) {
      const f = [c, k, s];
      if (f[0] === answer[0] && f[1] === answer[1]) continue;
      all.push(f);
    }
    const sameCK = (a, b) => a[0] === b[0] && a[1] === b[1];
    const chosen = [];
    const add = (f) => {
      if (!f || chosen.length >= nWrong) return false;
      if (sameCK(f, answer) || chosen.some((q) => sameCK(q, f))) return false;
      chosen.push(fcopy(f)); return true;
    };
    const inRow = [];   // the flowers of the row that are not the answer, newest first
    for (let i = row.length - 1; i >= 0; i--) if (!sameCK(row[i], answer) && !inRow.some((q) => sameCK(q, row[i]))) inRow.push(row[i]);
    // mixes: the answer with one attribute taken from another flower of the row
    const mixes = [];
    for (const f of inRow) {
      if (has('c') && has('k')) { mixes.push([f[0], answer[1], answer[2]]); mixes.push([answer[0], f[1], answer[2]]); }
      if (has('s') && (has('c') || has('k'))) { mixes.push([f[0], f[1], answer[2] ^ 1]); }
    }
    const near = shuffle(rng, mixes.filter((f) => !sameCK(f, answer)));
    const rest = () => shuffle(rng, all.slice());
    if (traps <= 0) { for (const f of rest()) add(f); }
    else if (traps === 1) { if (inRow.length) add(inRow[0]); for (const f of rest()) add(f); }
    else if (traps === 2) { if (inRow.length) add(inRow[0]); near.forEach(add); for (const f of rest()) add(f); }
    else if (traps === 3) { near.forEach((f) => { if (chosen.length < 1 + (nWrong > 2 ? 1 : 0)) add(f); }); inRow.forEach((f, i) => { if (i < 2) add(f); }); near.forEach(add); for (const f of rest()) add(f); }
    else { near.forEach(add); inRow.forEach(add); for (const f of rest()) add(f); }
    // trim the size of a wrong choice at random so the size is not a giveaway
    for (const f of chosen) if (!has('s')) f[2] = answer[2]; else if (rng() < 0.5) f[2] = f[2] ^ 1;
    return chosen.length === nWrong ? chosen : null;
  }

  function buildChoices(rng, cfg, V, pools, row, answer) {
    const wrong = makeChoices(rng, cfg, V, pools, row, answer, cfg.choices - 1, cfg.traps);
    if (!wrong) return null;
    const all = shuffle(rng, [fcopy(answer)].concat(wrong));
    return { choices: all, correct: all.findIndex((f) => fsame(f, answer)) };
  }

  function constants(rng, pools) {
    return { c: pick(rng, pools.c), k: pick(rng, pools.k), s: 1 };
  }
  function makePools(rng, cfg) {
    return { c: shuffle(rng, range(NCOL)).slice(0, cfg.nc), k: shuffle(rng, range(NKIND)).slice(0, cfg.nk) };
  }

  // ---- periodic rounds ----
  function genPeriodic(cfg, rng) {
    const mode = cfg.mode, pools = makePools(rng, cfg), K = constants(rng, pools);
    let V, shapes = {}, link = 'single', fam;
    if (mode === 'easy') {
      const a = cfg.attr === 'c' ? 'c' : cfg.attr === 'k' ? 'k' : (rng() < 0.5 ? 'c' : 'k');
      V = [a]; fam = pick(rng, rng() < 0.5 ? cfg.easyShapes.slice(0, Math.min(2, cfg.easyShapes.length)) : cfg.easyShapes); shapes[a] = fam;
    } else if (cfg.attr === 'c' || cfg.attr === 'k') {
      V = [cfg.attr]; fam = pick(rng, cfg.lists[cfg.attr]); shapes[cfg.attr] = fam;
    } else if (cfg.attr === 'ck') {
      V = ['c', 'k']; fam = pick(rng, cfg.lists.ck); shapes.ck = fam; link = 'combo';
      if (cfg.lists.s.length && rng() < 0.5) { V.push('s'); shapes.s = pick(rng, cfg.lists.s); fam = fam + '+' + shapes.s; }
    } else {
      link = 'indep';
      const withSize = mode === 'hard' && cfg.lists.s.length > 0;
      const r = rng();
      V = withSize ? (r < 0.4 ? ['c', 'k', 's'] : r < 0.7 ? ['c', 'k'] : r < 0.85 ? ['c', 's'] : ['k', 's']) : ['c', 'k'];
      for (const a of V) shapes[a] = pick(rng, cfg.lists[a]);
      // the attributes follow different cycles (otherwise it is just one pattern in a few colours)
      if (V.length > 1 && uniq(V.map((a) => shapes[a])).length < V.length) {
        for (const a of V.slice(1)) { let guard = 0; while (shapes[a] === shapes[V[0]] && guard++ < 20) shapes[a] = pick(rng, cfg.lists[a]); }
      }
      fam = V.map((a) => shapes[a]).join('+');
    }
    // values for each letter
    const cyc = {}, vals = {};
    if (link === 'combo') {
      const m = lettersOf(shapes.ck);
      vals.c = shuffle(rng, pools.c.slice()).slice(0, m); vals.k = shuffle(rng, pools.k.slice()).slice(0, m);
      cyc.c = cycleOf(shapes.ck, vals.c); cyc.k = cycleOf(shapes.ck, vals.k);
      if (shapes.s) { vals.s = shuffle(rng, [0, 1]); cyc.s = cycleOf(shapes.s, vals.s); }
    } else {
      for (const a of V) {
        const pool = a === 's' ? [0, 1] : pools[a], m = lettersOf(shapes[a]);
        if (pool.length < m) return null;
        vals[a] = shuffle(rng, pool.slice()).slice(0, m);
        cyc[a] = cycleOf(shapes[a], vals[a]);
      }
    }
    const periods = V.map((a) => (link === 'combo' && a !== 's' ? periodOf(shapes.ck) : periodOf(shapes[a])));
    const maxP = Math.max.apply(null, periods);
    const n = rowLength(mode, maxP);
    const elem = (i) => [cyc.c ? atCycle(cyc.c, i) : K.c, cyc.k ? atCycle(cyc.k, i) : K.k, cyc.s ? atCycle(cyc.s, i) : K.s];
    const row = range(n).map(elem), answer = elem(n);
    const ch = buildChoices(rng, cfg, V, pools, row, answer);
    if (!ch) return null;
    // the unit that repeats: the first maxP pots
    return { type: 'P', fam, vary: V.join(''), link, row, answer, choices: ch.choices, correct: ch.correct, odd: -1, unit: [0, maxP], groups: null, n };
  }

  // ---- growing (staircase) rounds: A | A B | A B C | A B C D ... then part of the next group ----
  function genGrow(cfg, rng) {
    const pools = makePools(rng, cfg), K = constants(rng, pools);
    const { g, j } = cfg.growShape;
    let V;
    if (cfg.mode === 'hard') V = rng() < 0.5 ? ['c', 'k'] : [rng() < 0.5 ? 'c' : 'k'];
    else V = [rng() < 0.5 ? 'c' : 'k'];
    const m = g + 1, base = [];
    const cv = shuffle(rng, pools.c.slice()), kv = shuffle(rng, pools.k.slice());
    if (cv.length < m || kv.length < m) return null;
    for (let i = 0; i < m; i++) base.push([V.indexOf('c') >= 0 ? cv[i] : K.c, V.indexOf('k') >= 0 ? kv[i] : K.k, K.s]);
    const row = [], groups = [];
    for (let k = 1; k <= g; k++) { groups.push(k); for (let i = 0; i < k; i++) row.push(fcopy(base[i])); }
    for (let i = 0; i < j; i++) row.push(fcopy(base[i]));
    const answer = fcopy(base[j]);
    const ch = buildChoices(rng, cfg, V, pools, row, answer);
    if (!ch) return null;
    // let the distractors include the next, never-seen flower of the staircase when there is room
    return { type: 'G', fam: 'GROW', vary: V.join(''), link: V.length > 1 ? 'combo' : 'single', row, answer, choices: ch.choices, correct: ch.correct, odd: -1,
      unit: [row.length - j - g, row.length - j], groups: groups.concat(j ? [j] : []), n: row.length };
  }

  // ---- which one does not fit ----
  function genOdd(cfg, rng) {
    const pools = makePools(rng, cfg), K = constants(rng, pools);
    const shape = pick(rng, [AB, ABB, AAB, ABC]), L = shape === AB ? 8 : 9, r = rng();
    const V = r < 0.34 ? ['c'] : r < 0.67 ? ['k'] : ['c', 'k'];
    const m = lettersOf(shape);
    const cv = shuffle(rng, pools.c.slice()), kv = shuffle(rng, pools.k.slice());
    const cc = V.indexOf('c') >= 0 ? cycleOf(shape, cv.slice(0, m)) : null, kc = V.indexOf('k') >= 0 ? cycleOf(shape, kv.slice(0, m)) : null;
    const elem = (i) => [cc ? atCycle(cc, i) : K.c, kc ? atCycle(kc, i) : K.k, K.s];
    const row = range(L).map(elem), e = ri(rng, L), want = row[e], odd = fcopy(want);
    const lettersOnly = cfg.level >= 19;
    // what the odd pot has instead: a colour and/or a kind that does not belong at that place
    const newC = () => { const c = pick(rng, (lettersOnly ? pools.c : cv.slice(m)).filter((v) => v !== want[0])); return c; };
    const newK = () => { const k = pick(rng, (lettersOnly ? pools.k : kv.slice(m)).filter((v) => v !== want[1])); return k; };
    const wantBoth = V.length === 2 && rng() < 0.35;
    if (V.length === 2) {
      if (wantBoth) { odd[0] = newC(); odd[1] = newK(); } else if (rng() < 0.5) odd[0] = newC(); else odd[1] = newK();
    } else if (V[0] === 'c') odd[0] = newC(); else odd[1] = newK();
    if (odd[0] === undefined || odd[1] === undefined || fsame(odd, want)) return null;
    row[e] = odd;
    return { type: 'O', fam: 'ODD', vary: V.join(''), shape, link: V.length > 1 ? 'combo' : 'single', row, answer: want, choices: null, correct: -1, odd: e, unit: null, groups: null, n: L };
  }

  // ---------- THE GUARD: exactly one right answer ----------
  const WILD = -1;
  // every flower that a hypothesis supported by the shown row says comes next. Returns a Set of keys (WILD if a hypothesis fits but cannot say).
  function predictions(row) {
    const n = row.length, out = new Set();
    const half = Math.floor(n / 2);
    // periodic: each attribute on its own, any period up to half the row
    const per = [0, 1, 2].map((a) => {
      const s = new Set();
      for (let p = 1; p <= half; p++) {
        let ok = true;
        for (let i = p; i < n && ok; i++) if (row[i][a] !== row[i - p][a]) ok = false;
        if (ok) s.add(row[n - p][a]);
      }
      return s;
    });
    for (const c of per[0]) for (const k of per[1]) for (const s of per[2]) out.add(fkey([c, k, s]));
    // the staircase on whole flowers
    const sg = growPrediction(row);
    if (sg !== null) out.add(sg);
    return out;
  }
  // a row fits the staircase if its first T(g) pots are the groups 1..g of one run of g different flowers and the rest begins the next group
  function growPrediction(row) {
    const n = row.length;
    let g = 0; while ((g + 1) * (g + 2) / 2 <= n) g++;
    if (g < 2) return null;
    const j = n - g * (g + 1) / 2;
    const base = [];
    let pos = n - j - g;                        // start of the last complete group
    for (let i = 0; i < g; i++) base.push(row[pos + i]);
    for (let i = 0; i < g; i++) for (let q = i + 1; q < g; q++) if (fsame(base[i], base[q])) return null;
    let at = 0;
    for (let k = 1; k <= g; k++) { for (let i = 0; i < k; i++) if (!fsame(row[at + i], base[i])) return null; at += k; }
    for (let i = 0; i < j; i++) if (!fsame(row[at + i], base[i])) return null;
    return j < g ? fkey(base[j]) : WILD;
  }
  // the pots that could be "the odd one" under any periodic hypothesis with exactly one exception, and whether the row is perfectly periodic
  function oddCandidates(row) {
    const L = row.length, cand = new Set();
    let perfect = false;
    for (let p = 1; p <= Math.floor(L / 2); p++) {
      let ok = true;
      for (let i = p; i < L && ok; i++) if (fkey(row[i]) !== fkey(row[i - p])) ok = false;
      if (ok) perfect = true;
    }
    for (let p = 1; p * 3 <= L; p++) {
      let exceptions = [], bad = false;
      for (let r = 0; r < p && !bad; r++) {
        const cnt = new Map(), idx = [];
        for (let i = r; i < L; i += p) { idx.push(i); const k = fkey(row[i]); cnt.set(k, (cnt.get(k) || 0) + 1); }
        let best = -1, bc = 0, tie = false;
        for (const [k, c] of cnt) { if (c > bc) { best = k; bc = c; tie = false; } else if (c === bc) tie = true; }
        if (tie) { bad = true; break; }
        for (const i of idx) if (fkey(row[i]) !== best) exceptions.push(i);
      }
      if (!bad && exceptions.length === 1) cand.add(exceptions[0]);
    }
    return { cand, perfect };
  }
  const visiblyDifferent = (a, b) => a[0] !== b[0] || a[1] !== b[1];
  // Returns { ok, reasons }. `cfg` supplies the number of choices expected.
  function analyse(round, cfg) {
    const why = [];
    if (round.type === 'O') {
      const { cand, perfect } = oddCandidates(round.row);
      if (perfect) why.push('the row is perfectly periodic');
      if (!(cand.size === 1 && cand.has(round.odd))) why.push('odd pot not unique: ' + Array.from(cand).join(','));
      if (round.choices) why.push('odd round has a choice tray');
      if (!visiblyDifferent(round.row[round.odd], round.answer)) why.push('odd pot not visibly different');
      return { ok: why.length === 0, reasons: why };
    }
    const row = round.row;
    const pr = predictions(row);
    if (!(pr.size === 1 && pr.has(fkey(round.answer)))) why.push('prediction not unique: ' + Array.from(pr).join(','));
    // enough of the pattern is shown
    if (round.type === 'P') {
      const maxP = round.unit[1] - round.unit[0];
      if (row.length < 2 * maxP) why.push('fewer than two periods shown');
    } else if (round.type === 'G' && round.groups.length < 3) why.push('fewer than three groups shown');
    const ch = round.choices;
    if (!ch || (cfg && ch.length !== cfg.choices)) why.push('wrong number of choices');
    if (ch) {
      const right = ch.filter((f) => fsame(f, round.answer)).length;
      if (right !== 1) why.push('choices equal to the answer: ' + right);
      if (round.correct < 0 || !ch[round.correct] || !fsame(ch[round.correct], round.answer)) why.push('correct index wrong');
      for (let i = 0; i < ch.length; i++) for (let k = i + 1; k < ch.length; k++) if (!visiblyDifferent(ch[i], ch[k])) why.push('choices ' + i + ',' + k + ' look alike');
      for (const f of ch) for (const q of ch) if (f[0] !== q[0] && colourDist(f[0], q[0]) < COLOUR_MIN_DIST) why.push('two colours too close');
    }
    return { ok: why.length === 0, reasons: why };
  }

  // ---------- generating rounds ----------
  function genRound(cfg, rng, type, stats) {
    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      const r = type === 'G' ? genGrow(cfg, rng) : type === 'O' ? genOdd(cfg, rng) : genPeriodic(cfg, rng);
      if (stats) stats.attempts++;
      if (r && analyse(r, cfg).ok) return r;
      if (stats) stats.rerolls++;
    }
    throw new Error(`could not make a ${type} round for level ${cfg.level} ${cfg.mode}`);
  }
  const seedFor = (level, mode, variant) => fnv(`petals|${level}|${mode}|${variant | 0}`);
  // The rounds of a level. variant 0 is the frozen set; replays use 1, 2, ... (different, still checked).
  function levelRounds(level, mode, variant, stats) {
    const cfg = config(level, mode), rng = mulberry32(seedFor(cfg.level, cfg.mode, variant));
    return cfg.types.map((t) => genRound(cfg, rng, t, stats));
  }
  // a round at random, as a quick check of many more than the frozen ones
  function randomRound(level, mode, rng, type, stats) {
    const cfg = config(level, mode);
    return genRound(cfg, rng, type || pick(rng, cfg.types), stats);
  }

  // ---------- hints, stars, saving ----------
  const hintDue = (idle, mode) => idle >= (HINT_S[mode] || HINT_S.easy);
  const starsFor = (wrong) => (wrong <= 0 ? 3 : wrong <= 2 ? 2 : 1);
  const hintTarget = (round) => (round.type === 'O' ? { pot: round.odd } : { choice: round.correct });
  // does tapping choice i solve the round?
  const choiceRight = (round, i) => !!round.choices && i === round.correct;
  const potRight = (round, i) => round.type === 'O' && i === round.odd;

  function defaultSave() {
    return { v: 1, mode: 'easy', unlocked: { easy: 1, medium: 1, hard: 1 }, stars: { easy: [], medium: [], hard: [] }, coins: 0,
      plays: { easy: [], medium: [], hard: [] }, chests: 0, rounds: 0 };
  }
  function migrate(raw) {
    const d = defaultSave();
    let o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') return d;
    if (MODES.indexOf(o.mode) >= 0) d.mode = o.mode;
    for (const m of MODES) {
      const u = o.unlocked && +o.unlocked[m];
      if (u >= 1) d.unlocked[m] = Math.min(NLEV, Math.floor(u));
      const st = o.stars && o.stars[m];
      if (Array.isArray(st)) d.stars[m] = st.slice(0, NLEV).map((s) => clamp(Math.floor(+s) || 0, 0, 3));
      const pl = o.plays && o.plays[m];
      if (Array.isArray(pl)) d.plays[m] = pl.slice(0, NLEV).map((s) => Math.max(0, Math.floor(+s) || 0));
    }
    d.coins = Math.max(0, Math.floor(+o.coins) || 0);
    d.chests = Math.max(0, Math.floor(+o.chests) || 0);
    d.rounds = Math.max(0, Math.floor(+o.rounds) || 0);
    return d;
  }
  // a level finished: stars (best kept), the next level opens, the replay variant moves on
  function finishLevel(save, mode, level, wrong) {
    const stars = starsFor(wrong);
    const arr = save.stars[mode];
    while (arr.length < level) arr.push(0);
    arr[level - 1] = Math.max(arr[level - 1] || 0, stars);
    save.unlocked[mode] = Math.min(NLEV, Math.max(save.unlocked[mode], level + 1));
    const pl = save.plays[mode];
    while (pl.length < level) pl.push(0);
    pl[level - 1]++;
    save.chests++;
    return stars;
  }
  const COINS_PER_ROUND = 1, CHEST_COINS = 5;

  // ---------- where things go (world units, 540 tall; the width is whatever the screen gives) ----------
  const H = 540, TARGET_MIN = 0.19 * H;        // 19vh in world units
  const GROUND_Y = 296, TRAY_Y = 452, CARD = 136;
  // The row of pots. n pots; o.groups: sizes of staircase groups (gaps between them); o.target: pots are tap targets (odd one out).
  function layoutRow(n, vw, o) {
    o = o || {};
    const groups = o.groups || null, margin = o.target ? 34 : 70;
    const slots = n + (groups ? 0.55 * (groups.length - 1) : 0);
    const avail = vw - 2 * margin;
    let pitch = Math.min(o.target ? 122 : 140, avail / Math.max(1, slots));
    const zig = !!o.target && pitch < TARGET_MIN + 2;
    const total = pitch * (slots - 1);
    let x = vw / 2 - total / 2;
    const pots = [];
    let gi = 0, left = groups ? groups[0] : 0;
    for (let i = 0; i < n; i++) {
      if (groups && left === 0) { gi++; left = groups[gi]; x += pitch * 0.55; }
      pots.push({ x, dy: zig ? (i % 2 ? 40 : -40) : 0, group: groups ? gi : 0 });
      x += pitch; if (groups) left--;
    }
    // a pot's touch target is a circle: wide enough when the row is straight, and the zig-zag keeps neighbours a full target apart
    return { pots, pitch, zig, scale: clamp(pitch / 110, 0.46, 1.2), reach: TARGET_MIN / 2 };
  }
  // the tray of choices, centred under the row
  function layoutChoices(n, vw) {
    const gap = Math.min(34, Math.max(12, (vw - 2 * 40 - n * CARD) / Math.max(1, n - 1)));
    const total = n * CARD + (n - 1) * gap, x0 = vw / 2 - total / 2 + CARD / 2;
    return range(n).map((i) => ({ x: x0 + i * (CARD + gap), y: TRAY_Y, w: CARD, h: CARD }));
  }

  return {
    NLEV, PAGE, NCOL, NKIND, MODES, RAINBOW, SHAPES, PERIODIC, COST, HINT_S, CHOICES, PERIODS, MAX_SHOWN, COLOUR_MIN_DIST, SIZE_SCALE,
    COINS_PER_ROUND, CHEST_COINS, H, TARGET_MIN, GROUND_Y, TRAY_Y, CARD,
    mulberry32, fnv, config, difficulty, roundsIn, worldOf, typesFor, rowLength, periodOf, lettersOf, seedFor,
    levelRounds, randomRound, genRound, analyse, predictions, oddCandidates, growPrediction, colourDist, fkey, fsame,
    hintDue, starsFor, hintTarget, choiceRight, potRight, defaultSave, migrate, finishLevel, layoutRow, layoutChoices,
  };
});
