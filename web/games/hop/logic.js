/* Toadstool Hop: the rules. Pure logic, no DOM: test/games/hop/verify.js runs this same file in Node.
 *
 * A side view of a waterfall glade. A line of platforms stands over the river: toadstools that stand still,
 * lily pads that drift gently left and right, and little clouds that float up and down. A tap makes Isabella
 * hop to the NEXT platform, aimed at where that platform will be when she lands (a hop takes 0.5 s). Because
 * some platforms move, a hop can be too far: she then falls short into the water, a friendly frog pops up
 * and boosts her back onto the platform she left. Nothing else can go wrong.
 *
 * Every platform's place is a pure function of the time t (posAt), so "what would this tap do?" can be asked
 * for any t without playing: hopEval. A hop is good when the distance she must cover, to the near edge of
 * the platform, is no more than she can reach (RX, less when she must go up). The course for a level and
 * mode is built from a seed; each gap is made as long as keeps the hop closed for a chosen share of the
 * time (the "closed share"), so the windows in which a tap works are known, and the verifier can prove them.
 *
 * Taps never matter for how fast: the stars count splashes, never time. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- the numbers ----------
  const WATER = 458;        // the height of a lily pad's top (the river's surface where the pads float)
  const D = 0.5;            // a hop takes this long
  const FALL = 0.4;         // falling short: from the end of the hop to the water
  const RESCUE = 1.7;       // the frog's rescue: pops up, a dizzy moment, the boost back
  const RESCUE_UP = 0.95;   // ...and the boost starts this far in
  const SPLASH_RAMP = 0.2;
  const SETTLE = 0.2;       // after landing she steps to the middle of the platform
  const WORLDS = [{ RX: 250, RY: 190 }, { RX: 290, RY: 230 }];   // how far she can hop, and how high (World 1, World 2)
  const SCAN = 60, STEP = 0.05;   // the "closed share" of a hop is measured over a minute, every 50 ms
  const CHEST_KEY_T = 1.4, CHEST_OPEN_T = 0.7, CHEST_OPEN_LATE = 2.3;   // the chest: open with the key, or the key floats over
  const CHEST_COINS = 10;
  const NLEV = 20, PER = 10, NMODES = 3;
  const MODE_IDS = ['easy', 'medium', 'hard'];

  // The three modes. size: how big the platforms are (1.5 / 1.2 / 0.95 of a toadstool). speedK, ampK: how fast and how far
  // the moving ones drift. cfK: the closed share of a hop. rb: how near the hop must pass a butterfly. hint: seconds idle
  // before the hand shows. cue: the next platform glows when a tap would work.
  const MODES = {
    easy: { id: 'easy', size: 1.5, speedK: 0.7, ampK: 0.8, cfK: 0.42, tightK: 0.9, rb: 66, coinLoss: false, hint: 4, cue: true, byHalf: false, wOpen: 1.8, wClosed: 3.2 },
    medium: { id: 'medium', size: 1.2, speedK: 1.0, ampK: 1.0, cfK: 0.85, tightK: 1.0, rb: 54, coinLoss: true, hint: 6, cue: true, byHalf: false, wOpen: 1.1, wClosed: 4.2 },
    hard: { id: 'hard', size: 0.95, speedK: 1.3, ampK: 1.15, cfK: 1.15, tightK: 1.06, rb: 46, coinLoss: true, hint: 8, cue: false, byHalf: true, wOpen: 0.8, wClosed: 5.2 },
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- twenty levels ----------
  // Seeds picked (test/games/hop/verify.js prints the checks they must pass) so the difficulty climbs.
  const SEEDS = [136, 96, 61, 108, 39, 92, 112, 100, 88, 48, 43, 90, 265, 82, 265, 293, 339, 46, 199, 57];
  const MAIN = [12, 13, 14, 15, 17, 18, 19, 21, 22, 24, 23, 24, 25, 26, 27, 27, 28, 29, 30, 31];   // platforms in the main line
  const LEVELS = [];
  for (let n = 1; n <= NLEV; n++) {
    const w2 = n > PER, k = w2 ? n - PER - 1 : n - 1;      // 0..9 inside its world
    const u = k / 9;
    LEVELS.push({
      n, world: w2 ? 2 : 1, seed: SEEDS[n - 1],
      theme: (w2 ? 4 : 0) + Math.floor(k * 4 / 10),       // 0-3 the Meadow, 4-7 the Cloud Tops
      main: MAIN[n - 1],
      pad: n < 3 ? 0 : w2 ? 0.3 : 0.34,                    // share of the platforms that are lily pads (toadstools only on 1-2)
      cloud: n < 6 ? 0 : w2 ? +(0.38 + 0.12 * u).toFixed(2) : +(0.2 + 0.2 * (k - 5) / 4).toFixed(2),
      padAmp: n < 3 ? 0 : w2 ? +(46 + 14 * u).toFixed(1) : +(16 + 21 * (k - 2) / 7).toFixed(1),     // how far a pad drifts (units, each way)
      cloudAmp: n < 6 ? 0 : w2 ? +(34 + 16 * u).toFixed(1) : +(18 + 10 * (k - 5) / 4).toFixed(1),   // how far a cloud floats up and down
      om: n < 3 ? 0 : w2 ? +(1.3 + 0.5 * u).toFixed(3) : +(0.7 + 0.42 * (k - 2) / 7).toFixed(3),    // drift speed (radians a second)
      cf: n < 3 ? 0 : w2 ? +(0.42 + 0.16 * u).toFixed(3) : +(0.1 + 0.18 * (k - 2) / 7).toFixed(3),   // share of the time a hop is too far (Medium)
      tight: +(w2 ? 0.8 + 0.1 * u : 0.5 + 0.26 * u).toFixed(3),   // a hop between two still platforms: how near its reach (Medium)
      choice: w2 ? +(0.2 + 0.12 * u).toFixed(2) : 0,        // chance that a gap offers two platforms
      gust: n < 15 ? 0 : +(18 + 4 * (n - 15)).toFixed(1),    // clouds also get nudged sideways by gusts from level 15
      butterfly: +(0.18 + 0.1 * (n - 1) / 19).toFixed(3),
      coin: 0.55,
    });
  }

  // ---------- where things are (pure functions of t) ----------
  // p: { x0, y0, ax, wx, px, ay, wy, py, gA, gw, gp }
  function gust(p, t) { return p.gA ? p.gA * Math.sin(p.gw * t + p.gp) * Math.abs(Math.sin(p.gw * 0.5 * t + p.gp * 1.7)) : 0; }
  function posX(p, t) { return p.x0 + (p.ax ? p.ax * Math.sin(p.wx * t + p.px) : 0) + gust(p, t); }
  function posY(p, t) { return p.y0 + (p.ay ? p.ay * Math.sin(p.wy * t + p.py) : 0); }

  // ---------- one hop ----------
  // If she taps at time tt standing on platform a (she rides it), hopping to b: where does she go?
  function hopEval(c, a, b, tt) {
    const x0 = posX(a, tt), y0 = posY(a, tt), x1 = posX(b, tt + D), y1 = posY(b, tt + D);
    const dx = x1 - x0, up = y0 - y1;                      // up > 0: the landing is higher than where she is
    const rd = c.RX * (1 - (up > 0 ? up / c.RY : 0));      // how far she can hop sideways (less when she must rise)
    const slack = rd - (dx - b.hw);                        // the distance to the near edge, against what she reaches
    const ok = slack >= 0 && up < c.RY;
    const xl = ok ? x0 + Math.min(dx, rd) : x0 + clamp(rd, 0.3 * c.RX, c.RX);
    const yl = ok ? y1 : y0 + 8;
    const hh = 44 + 0.17 * Math.abs(xl - x0) + (up > 0 ? 0.5 * up : 0);   // how far the arc rises above the straight line
    return { ok, a: a.id, b: b.id, t0: tt, x0, y0, xl, yl, y1, dx, up, rd, slack, hh };
  }
  // where she is at u (0..1) along an arc
  function arcX(h, u) { return h.x0 + (h.xl - h.x0) * u; }
  function arcY(h, u) { return h.y0 + (h.yl - h.y0) * u - 4 * h.hh * u * (1 - u); }
  // the closest a good hop passes to a point (a butterfly)
  function arcNear(h, bx, by) {
    let best = 1e9;
    for (let i = 0; i <= 16; i++) { const u = i / 16, dx = arcX(h, u) - bx, dy = arcY(h, u) - by; best = Math.min(best, Math.hypot(dx, dy)); }
    return best;
  }
  // Over a minute, every 50 ms: the share of the time in which a tap on a to reach b would fall short, the longest open window
  // and the longest closed one (seconds). Every platform moves in whole multiples of one slow beat, so a minute shows everything.
  function scanHop(c, a, b) {
    let closed = 0, n = 0, run = 0, ok0 = null, longestOpen = 0, longestClosed = 0, best = -1e9;
    const end = () => { if (ok0 === true) longestOpen = Math.max(longestOpen, run); else if (ok0 === false) longestClosed = Math.max(longestClosed, run); };
    for (let tt = 0; tt < SCAN; tt += STEP, n++) {
      const h = hopEval(c, a, b, tt), ok = h.ok;
      if (h.slack > best) best = h.slack;
      if (!ok) closed++;
      if (ok === ok0) run++; else { end(); ok0 = ok; run = 1; }
    }
    end();
    return { cf: closed / n, open: longestOpen * STEP, closed: longestClosed * STEP, best };
  }
  function closedShare(c, a, b) { return scanHop(c, a, b).cf; }

  // ---------- building a course ----------
  const cache = new Map();
  function course(n, mode) {
    const key = n + ':' + mode;
    let c = cache.get(key);
    if (!c) { c = build(n, mode); cache.set(key, c); }
    return c;
  }

  // the largest whole number in [lo, hi] for which ok(x) holds, when ok is true for small x and false for large (monotone)
  function largest(lo, hi, ok) {
    if (!ok(lo)) return lo;
    if (ok(hi)) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ok(m)) lo = m; else hi = m; }
    return lo;
  }

  function build(n, mode) {
    const cfg = LEVELS[n - 1], M = MODES[mode];
    if (!cfg || !M) throw new Error('no course ' + n + ' ' + mode);
    const W = WORLDS[cfg.world - 1];
    const R = mulberry32((0x9E3779B1 ^ Math.imul(cfg.seed + n * 7919, 2654435761)) >>> 0);
    const c = { n, mode, theme: cfg.theme, world: cfg.world, RX: W.RX, RY: W.RY, plats: [], nodes: [], hops: [], bfs: [], keyPlat: -1, hint: M.hint, size: M.size };
    const cfT = clamp(cfg.cf * M.cfK, 0, 0.7), tight = clamp(cfg.tight * M.tightK, 0.3, 0.96);
    const N = cfg.main;
    let pid = 0;
    const add = (o) => { o.id = pid++; c.plats.push(o); return o; };
    // The draws below are taken in the same order for every mode, so the three modes of a level share their shape.
    const draw = () => ({ kind: R(), a: R(), w: R(), p1: R(), p2: R(), y: R(), coin: R(), bf: R(), ch: R(), fy: R(), fk: R(), bon: R(), gp: R(), gw: R(), pal: R() });
    const D0 = []; for (let i = 0; i < N; i++) D0.push(draw());
    const mk = (kind, d, yPrev, o) => {
      o = o || {};
      const p = { kind, node: 0, far: !!o.far, x0: 0, y0: 0, ax: 0, wx: 0, px: 0, ay: 0, wy: 0, py: 0, gA: 0, gw: 0, gp: 0, hw: 0, sz: 0, pal: Math.floor(d.pal * 6), coin: false, key: false, bonus: null };
      if (kind === 'mush') { p.sz = M.size; p.hw = 34 * M.size; p.y0 = Math.round(clamp(yPrev + (d.y - 0.5) * 50, 380, 420)); }
      else if (kind === 'pad') {
        p.sz = 44 * M.size; p.hw = p.sz; p.y0 = WATER;
        p.ax = +(cfg.padAmp * M.ampK * (0.75 + 0.5 * d.a)).toFixed(1); p.wx = cfg.om * M.speedK * (d.w < 0.5 ? 1 : 1.5); p.px = +(d.p1 * TAU).toFixed(3);
      } else if (kind === 'cloud') {
        p.sz = 100 * M.size; p.hw = 0.44 * p.sz;
        p.ay = +(cfg.cloudAmp * M.ampK * (0.75 + 0.5 * d.a)).toFixed(1); p.wy = cfg.om * M.speedK * (d.w < 0.5 ? 1 : 1.5); p.py = +(d.p2 * TAU).toFixed(3);
        p.y0 = Math.round(clamp(yPrev + (d.y - 0.5) * 60 - 10, 360, 410));
        if (cfg.gust) { p.gA = +(cfg.gust * M.ampK * (0.8 + 0.4 * d.a)).toFixed(1); p.gw = p.wy; p.gp = +(d.gp * TAU).toFixed(3); p.ax = 0; }
        p.y0 = Math.min(p.y0, WATER - 40 - p.ay);
      }
      if (o.y0 != null) p.y0 = o.y0;
      return p;
    };
    const reach = (a, b) => Math.max(a.ax + a.gA, 0) + Math.max(b.ax + b.gA, 0);
    const still = (p) => p.ax + p.gA + p.ay === 0;
    // Put b to the right of the platforms it must be reached from. Two still platforms: the hop keeps a margin of
    // (1 - tight) of her reach. Otherwise the gap is as long as keeps the hop closed for about the share `target` of
    // the time (for a choice, the harder of the two decides).
    const place = (prevs, b, target, extraMin) => {
      const base = prevs.reduce((m, p) => Math.max(m, p.x0), -1e9);
      const rm = prevs.reduce((m, p) => Math.max(m, p.x0 - base + p.hw + reach(p, b) + 30), -1e9);
      const gmin = Math.max(Math.round(b.hw + rm), extraMin || 0), gmax = Math.round(c.RX + b.hw - 14);
      const calm = still(b) && prevs.every(still);
      const okAt = (g2) => {
        b.x0 = base + g2;
        if (calm) return prevs.every((p) => hopEval(c, p, b, 0).slack >= (1 - tight) * c.RX);
        return prevs.every((p) => { const q = scanHop(c, p, b); return q.cf <= target && q.open >= M.wOpen && q.closed <= M.wClosed && q.best >= 14; });
      };
      // a platform that is too high to reach even at the shortest gap is let down a little (a lily pad is already at the water)
      for (let tries = 0; tries < (b.far ? 2 : 6) && b.kind !== 'pad' && !okAt(gmin) && prevs.some((p) => closedShare(c, p, b) > target + 0.2); tries++) {
        b.y0 += 8;
        if (b.kind === 'cloud') { b.ay = +(b.ay * 0.92).toFixed(1); b.y0 = Math.min(b.y0, WATER - 24 - b.ay); }
      }
      const g = largest(gmin, Math.max(gmin, gmax), okAt);
      b.x0 = base + g;
      return g;
    };
    const hopsTo = (prevs, b) => { for (const p of prevs) c.hops.push({ from: p.id, to: b.id, gap: b.x0 - p.x0, far: !!(p.far || b.far) }); };
    // the first platform: a mossy bank to start on
    const bank = (hw) => ({ kind: 'bank', node: 0, far: false, x0: 0, y0: 410, ax: 0, wx: 0, px: 0, ay: 0, wy: 0, py: 0, gA: 0, gw: 0, gp: 0, hw, sz: hw, pal: 0, coin: false, key: false, bonus: null });
    const start = add(bank(100));
    c.nodes.push({ i: 0, main: start.id, far: -1, choice: false });
    let prevs = [start], yPrev = 410;
    const choiceAt = new Array(N).fill(false);
    for (let k = 2; k <= N - 3; k++) choiceAt[k] = cfg.choice > 0 && D0[k].ch < cfg.choice && !choiceAt[k - 1];
    for (let k = 1; k < N - 1; k++) {
      const d = D0[k], u = d.kind;
      const kind = u < cfg.pad ? 'pad' : u < cfg.pad + cfg.cloud ? 'cloud' : 'mush';
      const nd = { i: k, main: -1, far: -1, choice: choiceAt[k] };
      if (!nd.choice) {
        const p = add(mk(kind, d, yPrev)); p.node = k;
        place(prevs, p, cfT); hopsTo(prevs, p);
        nd.main = p.id; prevs = [p]; yPrev = p.kind === 'pad' ? 400 : p.y0;
        c.nodes.push(nd); continue;
      }
      // two platforms: the far one is high and takes a longer, higher hop; the near one is low and easy; the platform after them is
      // placed so that BOTH of them reach it
      const fKind = d.fk < 0.5 && cfg.cloud > 0 ? 'cloud' : 'mush';
      const F = mk(fKind, d, yPrev, { far: true }); F.node = k;
      const Nn = mk(kind, d, yPrev); Nn.node = k;
      F.y0 = Math.round(clamp(yPrev - 46 - 22 * d.fy, 280, 360));
      if (F.kind === 'cloud') F.y0 = Math.min(F.y0, WATER - 40 - F.ay);
      add(F);
      // the near platform sits 76 left of the far one, so the far one is at least that far beyond the near one's own clearance
      const needN = Math.max(...prevs.map((q) => q.x0 + q.hw + Nn.hw + reach(q, Nn) + 30)) + 76 - Math.max(...prevs.map((q) => q.x0));
      const gF = place(prevs, F, clamp(cfT + 0.1, 0, 0.8), Math.round(needN));
      // the near platform sits below the far one with room for both to move: if it will not fit, both move less
      for (let tries = 0; tries < 4; tries++) {
        Nn.y0 = Nn.kind === 'pad' ? WATER : Math.round(Math.max(clamp(F.y0 + 60 + 15 * d.fy, 360, 420), F.y0 + 56 + F.ay + Nn.ay));
        if (Nn.kind === 'cloud') Nn.y0 = Math.min(Nn.y0, WATER - 24 - Nn.ay);
        if (Nn.kind === 'pad' || Nn.y0 - F.y0 >= 56 + F.ay + Nn.ay) break;
        F.ay = +(F.ay * 0.6).toFixed(1); Nn.ay = +(Nn.ay * 0.6).toFixed(1);
      }
      add(Nn);
      Nn.x0 = F.x0 - 76;
      hopsTo(prevs, Nn); hopsTo(prevs, F);
      nd.main = Nn.id; nd.far = F.id;
      c.nodes.push(nd);
      prevs = [Nn, F]; yPrev = Nn.kind === 'pad' ? 400 : Nn.y0;
    }
    // the last platform: a wide bank with the chest beside it, and a gentler last hop
    const last = add(bank(150)); last.node = N - 1;
    place(prevs, last, cfT * 0.5); hopsTo(prevs, last);
    c.nodes.push({ i: N - 1, main: last.id, far: -1, choice: false });
    c.len = last.x0;
    c.chest = { x: last.x0 + 78, y: last.y0, stand: last.x0 - 54 };
    c.start = { x: start.x0 - 10 };
    // coins, the key, butterflies
    let keyNode = -1;
    {
      // the key stands on a plain platform in the second half of the main line
      const lo = Math.ceil((c.nodes.length - 1) * 0.5), hi = Math.floor((c.nodes.length - 1) * 0.82), cand = [];
      for (let i = lo; i <= hi; i++) if (!c.nodes[i].choice) cand.push(i);
      keyNode = cand.length ? cand[Math.floor(D0[lo].coin * cand.length)] : lo;
    }
    c.nodes.forEach((nd, i) => {
      const d = D0[Math.min(i, D0.length - 1)], p = c.plats[nd.main];
      if (p.kind === 'bank') return;
      if (i === keyNode) { p.key = true; c.keyPlat = p.id; return; }
      p.coin = d.coin < cfg.coin;
      if (nd.far >= 0) { const f = c.plats[nd.far]; f.bonus = d.bon < 0.5 ? 'coin' : 'butterfly'; }
    });
    // butterflies float over some gaps of the main line
    for (let i = 0; i + 1 < c.nodes.length; i++) {
      const d = D0[Math.min(i, D0.length - 1)];
      if (d.bf >= cfg.butterfly || i === 0) continue;
      const a = c.plats[c.nodes[i].main], b = c.plats[c.nodes[i + 1].main];
      const gap = b.x0 - a.x0, hh = 44 + 0.17 * gap;
      c.bfs.push({ node: i, x: Math.round((a.x0 + b.x0) / 2), y: Math.round((a.y0 + b.y0) / 2 - hh - (a.kind === 'pad' ? 6 : 0)), r: M.rb });
    }
    // measured: the closed share of each hop
    for (const h of c.hops) h.cf = +closedShare(c, c.plats[h.from], c.plats[h.to]).toFixed(3);
    return c;
  }

  // ---------- how hard a course is (a fixed cost function; verify.js asserts it climbs) ----------
  function cost(c) {
    let total = 0;
    for (const h of c.hops) {
      if (h.far && c.mode !== 'hard') continue;
      const a = c.plats[h.from], b = c.plats[h.to];
      const moving = (a.ax + a.gA + a.ay + b.ax + b.gA + b.ay) > 0;
      const near = Math.max(0, h.gap - b.hw) / c.RX;                       // how near the edge of her reach the gap is
      const speed = Math.max(a.wx, a.wy, b.wx, b.wy);
      let d = 1 + 9 * h.cf + 3.2 * near * near + (moving ? 0.9 * speed : 0);
      d += 2.2 * (1 - Math.min(1, b.hw / 70));                             // a narrow landing is harder
      if (h.far) d *= 0.75;                                                // the far platform is optional: it counts, but less
      total += d;
    }
    total += c.bfs.length * 0.4;
    return total;
  }
  // a compact picture of a course, for the fingerprint
  function summary(c) {
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      n: c.n, mode: c.mode, theme: c.theme, len: c.len, key: c.keyPlat,
      plats: c.plats.map((p) => [p.kind, p.node, p.far ? 1 : 0, r1(p.x0), r1(p.y0), r1(p.hw), r1(p.ax), r1(p.wx * 1000), r1(p.px * 1000), r1(p.ay), r1(p.wy * 1000), r1(p.py * 1000), r1(p.gA), p.coin ? 1 : 0, p.key ? 1 : 0, p.bonus || 0]),
      bfs: c.bfs.map((b) => [b.node, b.x, b.y, b.r]),
    };
  }

  // ---------- stars, the save ----------
  const starsFor = (splashes) => (splashes === 0 ? 3 : splashes <= 2 ? 2 : 1);

  // ---------- a run: one go at one course ----------
  // phase: stand | hop | splash | chest | done.   Time t only ever goes forward; platforms are functions of t.
  class Run {
    constructor(n, mode, resume) {
      this.n = n; this.mode = mode; this.M = MODES[mode];
      this.c = course(n, mode);
      this.t = 0;
      this.node = 0; this.at = this.c.nodes[0].main;       // the node and platform she stands on
      this.phase = 'stand'; this.hop = null; this.sp = null;
      this.took = new Set(); this.bfGot = new Set();
      this.coins = 0; this.splashes = 0; this.hasKey = false; this.hops = 0; this.lost = 0;
      this.stand0 = -SETTLE; this.ofs = 0; this.queued = null;                         // standing: when she landed, and how far from the middle she landed
      this.chestT = 0; this.opened = false; this.keyFloat = false; this.stars = 0; this.done = false; this.chestCoins = 0;
      if (resume) this.restore(resume);
    }
    plat(id) { return this.c.plats[id]; }
    // the next platform she would hop to, for a tap on side (-1 left, +1 right, 0 anywhere)
    target(side) {
      const nd = this.c.nodes[this.node + 1];
      if (!nd) return null;
      if (nd.far >= 0 && this.M.byHalf && side > 0) return this.plat(nd.far);
      return this.plat(nd.main);
    }
    // what a tap right now would do
    predict(side) { const b = this.target(side || 0); return b ? hopEval(this.c, this.plat(this.at), b, this.t) : null; }
    // A tap while she is still stepping to the middle of the platform she landed on waits for her (a fifth of a second).
    tap(side, events) {
      if (this.phase !== 'stand') return false;
      if (!this.target(side || 0)) return false;
      if (this.t - this.stand0 < SETTLE - 1e-9) { this.queued = side || 0; return true; }
      return this.go(side || 0, events);
    }
    go(side, events) {
      const b = this.target(side);
      if (!b) return false;
      const h = hopEval(this.c, this.plat(this.at), b, this.t);
      h.toNode = b.node; h.far = b.far;
      this.hop = h; this.phase = 'hop'; this.hops++; this.queued = null;
      if (events) events.push({ type: 'hop', ok: h.ok, far: b.far, x: h.x0, y: h.y0 });
      return true;
    }
    // where Isabella is (her feet) and what she is doing
    pose() {
      const c = this.c;
      if (this.phase === 'stand' || this.phase === 'chest' || this.phase === 'done') {
        const p = this.plat(this.at);
        if (this.phase !== 'stand') {
          const cc = c.chest, e = clamp(this.chestT / 0.5, 0, 1), s = e * e * (3 - 2 * e);
          const px = posX(p, this.t), x0 = px + this.ofs;
          return { x: x0 + (cc.stand - x0) * s, y: posY(p, this.t), mode: 'stand', face: 1 };
        }
        const e = clamp((this.t - this.stand0) / SETTLE, 0, 1);
        return { x: posX(p, this.t) + this.ofs * (1 - e * e * (3 - 2 * e)), y: posY(p, this.t), mode: 'stand', face: 1 };
      }
      if (this.phase === 'hop') {
        const h = this.hop, u = clamp((this.t - h.t0) / D, 0, 1);
        if (h.ok) return { x: arcX(h, u), y: arcY(h, u), mode: 'fly', face: 1, u };
        // fell short: the arc, then straight down into the water
        const f = clamp((this.t - h.t0 - D) / FALL, 0, 1);
        if (this.t - h.t0 <= D) return { x: arcX(h, u), y: arcY(h, u), mode: 'fly', face: 1, u };
        return { x: h.xl + 14 * f, y: h.yl + (WATER + 6 - h.yl) * f * f, mode: 'fall', face: 1, f };
      }
      // splash: the frog
      const s = this.sp, ts = this.t - s.t0;
      const landP = this.plat(this.at), lt = s.t0 + RESCUE, lx = posX(landP, lt), ly = posY(landP, lt);
      if (ts < RESCUE_UP) return { x: s.x, y: WATER - 50 - 6 * Math.sin(ts * 5), mode: ts < 0.12 ? 'fall' : 'sit', face: 1, frog: true, ts, dizzy: ts > 0.3 };
      const u = clamp((ts - RESCUE_UP) / (RESCUE - RESCUE_UP), 0, 1);
      const x = s.x + (lx - s.x) * u, y = (WATER - 50) + (ly - (WATER - 50)) * u - 4 * 120 * u * (1 - u);
      return { x, y, mode: 'fly', face: lx < s.x ? -1 : 1, frog: true, ts, u };
    }
    step(dt, events) {
      events = events || [];
      this.t += dt;
      const c = this.c;
      if (this.phase === 'stand' && this.queued != null && this.t - this.stand0 >= SETTLE - 1e-9) this.go(this.queued, events);
      else if (this.phase === 'hop') {
        const h = this.hop, el = this.t - h.t0;
        if (h.ok && el >= D) this.land(h, events);
        else if (!h.ok && el >= D + FALL) this.splash(h, events);
      } else if (this.phase === 'splash') {
        if (this.t - this.sp.t0 >= RESCUE) {
          this.phase = 'stand'; this.stand0 = this.t - SETTLE; this.ofs = 0; this.sp = null;
          events.push({ type: 'rescued' });
        }
      } else if (this.phase === 'chest') {
        this.chestT += dt;
        if (!this.keyFloat && !this.hasKey && this.chestT >= CHEST_KEY_T) { this.keyFloat = true; events.push({ type: 'keyFloat' }); }
        const openAt = this.hasKey ? CHEST_OPEN_T : CHEST_OPEN_LATE;
        if (!this.opened && this.chestT >= openAt) {
          this.opened = true; this.coins += CHEST_COINS; this.chestCoins = CHEST_COINS;
          this.phase = 'done'; this.done = true; this.stars = starsFor(this.splashes);
          events.push({ type: 'chest', coins: CHEST_COINS, key: this.hasKey });
          events.push({ type: 'done', stars: this.stars });
        }
      } else if (this.phase === 'done') this.chestT += dt;
      void c;
      return events;
    }
    pick(key) { if (this.took.has(key)) return false; this.took.add(key); return true; }
    land(h, events) {
      const b = this.plat(h.b), c = this.c;
      this.at = b.id; this.node = b.node;
      const bx = posX(b, h.t0 + D);
      this.ofs = h.xl - bx; this.stand0 = h.t0 + D;
      this.hop = null; this.phase = 'stand';
      const got = { type: 'land', plat: b.id, node: b.node, far: b.far, coin: false, key: false, bonus: null, bf: 0 };
      // butterflies the hop passed through
      for (let i = 0; i < c.bfs.length; i++) {
        const f = c.bfs[i];
        if (f.node !== this.prevNodeOf(h) || this.bfGot.has(i) || b.far) continue;
        if (arcNear(h, f.x, f.y) <= f.r) { this.bfGot.add(i); this.coins++; got.bf++; events.push({ type: 'butterfly', i, x: f.x, y: f.y }); }
      }
      if (b.coin && this.pick('c' + b.id)) { this.coins++; got.coin = true; }
      if (b.key && this.pick('k' + b.id)) { this.hasKey = true; got.key = true; }
      if (b.bonus && this.pick('b' + b.id)) { this.coins++; got.bonus = b.bonus; }
      events.push(got);
      if (b.node === c.nodes.length - 1) { this.phase = 'chest'; this.chestT = 0; events.push({ type: 'arrive' }); }
    }
    prevNodeOf(h) { return this.plat(h.a).node; }
    splash(h, events) {
      this.splashes++;
      let lost = 0;
      if (this.M.coinLoss && this.coins > 0) { this.coins--; lost = 1; this.lost++; }
      this.sp = { t0: this.t, x: h.xl + 14 };
      this.hop = null; this.phase = 'splash';
      events.push({ type: 'splash', x: this.sp.x, lost });
    }
    // what a half-played level keeps: where she stands, what she has taken
    snapshot() {
      return { at: this.at, node: this.node, took: [...this.took], bf: [...this.bfGot], coins: this.coins, splashes: this.splashes, key: this.hasKey };
    }
    restore(s) {
      const int = (v, lo, hi) => { const q = Math.floor(Number(v)); return Number.isFinite(q) ? clamp(q, lo, hi) : null; };
      if (!s || typeof s !== 'object') return;
      const node = int(s.node, 0, this.c.nodes.length - 2);
      if (node == null) return;
      const at = int(s.at, 0, this.c.plats.length - 1);
      if (at == null || this.c.plats[at].node !== node) return;
      this.node = node; this.at = at;
      const ok = (k) => typeof k === 'string' && /^[ckb]\d+$/.test(k) && int(k.slice(1), 0, this.c.plats.length - 1) != null;
      (Array.isArray(s.took) ? s.took : []).filter(ok).forEach((k) => this.took.add(k));
      (Array.isArray(s.bf) ? s.bf : []).forEach((i) => { const q = int(i, 0, this.c.bfs.length - 1); if (q != null) this.bfGot.add(q); });
      this.coins = int(s.coins, 0, 999) || 0; this.splashes = int(s.splashes, 0, 999) || 0; this.hasKey = !!s.key;
    }
  }

  // would a tap work all through the next `span` seconds? (what the glowing cue means, and what a careful child waits for)
  function safeFor(run, side, span) {
    const b = run.target(side || 0);
    if (!b) return false;
    const a = run.plat(run.at);
    for (let q = 0; q <= span + 1e-9; q += 0.1) if (!hopEval(run.c, a, b, run.t + q).ok) return false;
    return true;
  }

  function freshSave() {
    const z = () => new Array(NLEV).fill(0);
    return { v: 1, mode: 'easy', unlocked: { easy: 1, medium: 1, hard: 1 }, stars: { easy: z(), medium: z(), hard: z() }, coins: 0, chests: 0, hops: 0, splashes: 0, runs: {} };
  }
  function migrate(raw) {
    const sv = freshSave();
    let s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return sv; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    const int = (v, lo, hi) => { const q = Math.floor(Number(v)); return Number.isFinite(q) ? Math.min(hi, Math.max(lo, q)) : null; };
    const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
    if (MODE_IDS.indexOf(s.mode) >= 0) sv.mode = s.mode;
    sv.coins = int(s.coins, 0, 1e9) || 0; sv.chests = int(s.chests, 0, 1e9) || 0; sv.hops = int(s.hops, 0, 1e9) || 0; sv.splashes = int(s.splashes, 0, 1e9) || 0;
    for (const m of MODE_IDS) {
      const st = plain(s.stars) && Array.isArray(s.stars[m]) ? s.stars[m] : [];
      sv.stars[m] = Array.from({ length: NLEV }, (_, i) => int(st[i], 0, 3) || 0);
      const beaten = sv.stars[m].reduce((q, v, i) => (v > 0 ? i + 1 : q), 0);
      sv.unlocked[m] = Math.min(NLEV, Math.max((plain(s.unlocked) ? int(s.unlocked[m], 1, NLEV) : null) || 1, beaten + 1));
    }
    if (plain(s.runs)) {
      for (const k of Object.keys(s.runs)) {
        const mm = /^(easy|medium|hard):(\d+)$/.exec(k);
        if (!mm) continue;
        const n = int(mm[2], 1, NLEV);
        if (n == null || String(n) !== mm[2] || n > sv.unlocked[mm[1]]) continue;
        const r = new Run(n, mm[1], s.runs[k]);
        if (r.node > 0) sv.runs[k] = r.snapshot();
      }
    }
    return sv;
  }

  const api = {
    WATER, D, FALL, RESCUE, RESCUE_UP, SETTLE, WORLDS, SCAN, STEP, CHEST_COINS, CHEST_KEY_T, CHEST_OPEN_T, CHEST_OPEN_LATE, NLEV, PER, MODE_IDS, MODES, LEVELS, SEEDS,
    mulberry32, posX, posY, gust, hopEval, arcX, arcY, arcNear, scanHop, closedShare, build, course, cost, summary, starsFor, Run, safeFor, freshSave, migrate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HopLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
