/* Firefly Numbers: the rules. Pure logic, no DOM: test/games/fireflies/verify.js runs this same file in Node.
 * A moonlit glade. Fireflies drift about; the child taps them into Isabella's glass jar until the jar holds the
 * number on its label (shown as a numeral AND as that many dots). Medium and Hard add: "3 + 2" fills to 5, and later
 * "7 - 3" starts with seven in the jar and the child lets fireflies out until four remain.
 * One tap too many (an "overfill") is only a hiccup: the firefly flutters back out and the level's star count
 * drops. Nothing can be failed, nothing is timed.
 *
 * Contents: the 60 level plans (20 levels x Easy/Medium/Hard) and their rounds, the label model (what the jar's
 * label shows), the Run (one play of one level), the Swarm (the drifting fireflies, with a hard spacing rule),
 * the screen layout and the save. */
(function (root) {
  'use strict';
  const MODES = ['easy', 'medium', 'hard'];
  const NLEV = 20;
  const ZONE = 52;              // a firefly's tap radius in world units: 104 across = 19.3vh on a 540-unit screen
  const MIN_SEP = ZONE * 2;     // fireflies are never closer than this, so two tap zones never overlap
  const JAR_MAX = 10;
  const CHEST_COINS = 5;        // the chest at the end of a level
  const RESPAWN = 0.9;          // seconds before a caught firefly's replacement fades in
  const HINT_AFTER = { easy: 7, medium: 10, hard: 14 };   // seconds of quiet before the hint hand taps a firefly
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- the level table ----------
  // For each mode, levels 1..20: [hi, lo, mix]. hi/lo: the biggest and smallest number on a jar (for a take-away,
  // the number the jar STARTS with). mix: one letter per jar (a level's jars are its rounds):
  //   c a number to count        a a sum of two      b a sum of three      t a take-away (start with some, let some out)
  const TABLE = {
    easy: [
      [3, 1, 'ccc'], [3, 1, 'ccc'], [4, 1, 'ccc'], [4, 1, 'cccc'], [5, 1, 'cccc'], [5, 1, 'cccc'], [5, 1, 'cccc'], [6, 1, 'ccccc'], [6, 1, 'ccccc'], [6, 1, 'ccccc'],
      [7, 1, 'ccccc'], [7, 1, 'ccccc'], [8, 1, 'ccccc'], [8, 1, 'ccccc'], [8, 1, 'cccccc'], [9, 1, 'cccccc'], [9, 1, 'cccccc'], [10, 1, 'cccccc'], [10, 1, 'cccccc'], [10, 1, 'cccccc'],
    ],
    medium: [
      [5, 1, 'cccc'], [5, 1, 'cccc'], [6, 1, 'cccc'], [6, 1, 'ccccc'], [7, 1, 'ccccc'], [7, 1, 'ccccc'], [8, 1, 'ccccc'], [9, 1, 'cccccc'], [9, 1, 'cccccc'], [10, 1, 'cccccc'],
      [10, 3, 'caaaaa'], [10, 3, 'aaaaaa'], [10, 4, 'aaaaaa'], [10, 4, 'aaaaaa'], [10, 5, 'aaaaaa'],
      [10, 5, 'aaabaab'], [10, 5, 'abaabab'], [10, 5, 'abaabab'], [10, 6, 'ababbab'], [10, 6, 'abbabab'],
    ],
    hard: [
      [6, 2, 'ccccc'], [7, 2, 'ccccc'], [8, 2, 'ccccc'], [9, 2, 'cccccc'], [10, 2, 'cccccc'], [10, 3, 'caaaaa'], [10, 4, 'aaaaaa'], [10, 4, 'aaaaaaa'], [10, 5, 'aaaaaaa'], [10, 5, 'aaaaaaa'],
      [10, 6, 'aaaaaaa'], [10, 6, 'aaaaaaa'], [10, 6, 'aaaaaab'], [10, 6, 'aaabbaa'], [10, 6, 'aabbaba'],
      [10, 6, 'aabtaba'], [10, 7, 'abtabta'], [10, 7, 'abtabatb'], [10, 7, 'tabtabta'], [10, 7, 'btabtabt'],
    ],
  };
  // drift speed in world units a second: a 540-tall screen is crossed in about 12 s at Easy 1, 7 s at Hard 20
  const SPEED = { easy: [22, 1.5], medium: [28, 1.9], hard: [36, 2.2] };   // [level 1, added each level]
  // the closest two fireflies may come (centre to centre): wide berths at Easy, tight passes at Hard
  const SEP = { easy: [146, 122], medium: [134, 110], hard: [120, 104] };  // [level 1, level 20]
  const MODE_BONUS = { easy: 0, medium: 1, hard: 2 };
  // backdrops (FairyArt themes): World 1 the bluebell wood, the waterfall glade, then moonlit night; World 2 blue sky, sunset, night, rainbow sky
  const THEME_OF = [1, 1, 1, 2, 2, 2, 6, 6, 6, 6, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7];
  const worldOf = (level) => (level <= 10 ? 1 : 2);

  function planOf(mode, level) {
    const mi = MODES.indexOf(mode);
    if (mi < 0 || !(level >= 1 && level <= NLEV) || level !== Math.floor(level)) throw new Error('no level ' + mode + ' ' + level);
    const [hi, lo, mix] = TABLE[mode][level - 1];
    const count = clamp(Math.max(8, hi + 1) + MODE_BONUS[mode] + (level > 10 ? 1 : 0), 8, 14);
    const sp = SPEED[mode], sq = SEP[mode];
    return {
      mode, level, world: worldOf(level), theme: THEME_OF[level - 1], hi, lo, mix, jars: mix.length, count,
      speed: Math.round((sp[0] + sp[1] * (level - 1)) * 10) / 10,
      sep: Math.round(sq[0] + ((sq[1] - sq[0]) * (level - 1)) / 19),
      hint: HINT_AFTER[mode],
    };
  }

  // ---------- rounds ----------
  // A round is one jar. k: 'c' count, 'a' sum of two, 'b' sum of three, 't' take-away.
  //   parts: the numbers on the label (a take-away: [start, away]); total: the dots on the label; target: what the jar must end up holding.
  function makeRound(k, total, rng) {
    if (k === 'c') return { k, parts: [total], total, target: total };
    if (k === 'a') { const a = 1 + Math.floor(rng() * (total - 1)); return { k, parts: [a, total - a], total, target: total }; }
    if (k === 'b') {
      const a = 1 + Math.floor(rng() * (total - 2)), b = 1 + Math.floor(rng() * (total - a - 1));
      return { k, parts: [a, b, total - a - b], total, target: total };
    }
    // take-away: at least one stays in the jar, and from a jar of five or more at least two go and two stay
    const lo = total >= 5 ? 2 : 1, hi = total >= 5 ? total - 2 : total - 1;
    const away = lo + Math.floor(rng() * (hi - lo + 1));
    return { k: 't', parts: [total, away], total, away, target: total - away };
  }
  const roundKey = (r) => r.k + ':' + r.parts.join(',');
  function roundsOf(mode, level) {
    const p = planOf(mode, level), mi = MODES.indexOf(mode);
    const rng = mulberry32(1000003 * (mi + 1) + 7919 * level + 12345);
    const peak = Math.floor(rng() * p.jars);   // one jar always reaches the level's biggest number
    const minTotal = (k) => Math.max(p.lo, k === 'c' ? 1 : k === 'a' ? 2 : 3);
    const make = (i, forceHi) => {
      const k = p.mix[i], lo = Math.min(minTotal(k), p.hi);
      return makeRound(k, forceHi ? p.hi : lo + Math.floor(rng() * (p.hi - lo + 1)), rng);
    };
    const out = [];
    for (let i = 0; i < p.jars; i++) out.push(make(i, i === peak));
    // never the same jar twice running: re-roll the one of the pair that is not the peak
    for (let i = 1; i < out.length; i++) {
      if (roundKey(out[i]) !== roundKey(out[i - 1])) continue;
      const j = i === peak ? i - 1 : i;
      for (let tries = 0; tries < 30; tries++) {
        out[j] = make(j, false);
        const k = roundKey(out[j]);
        if ((j === 0 || k !== roundKey(out[j - 1])) && (j === out.length - 1 || k !== roundKey(out[j + 1]))) break;
      }
    }
    return out;
  }
  // everything that defines a level, as text (verify.js hashes it: 60 fingerprints)
  function canon(mode, level) { return JSON.stringify({ plan: planOf(mode, level), rounds: roundsOf(mode, level) }); }

  // ---------- the label on the jar ----------
  // What a child sees: a row of numerals and, under it, a row of empty circles (dots) to count.
  //   count 3      numerals [3]          dots [3]
  //   sum 3 + 2    numerals [3 + 2]      dots [3] + [2]
  //   take 7 - 3   numerals [7 - 3]      dots [7, the last 3 crossed]
  const num = (v) => ({ t: 'num', v });
  const op = (v) => ({ t: 'op', v });
  function labelModel(round) {
    const numerals = [], dots = [];
    if (round.k === 't') {
      numerals.push(num(round.parts[0]), op('minus'), num(round.parts[1]));
      dots.push({ t: 'dots', n: round.parts[0], crossed: round.parts[1] });
    } else {
      round.parts.forEach((p, i) => {
        if (i) { numerals.push(op('plus')); dots.push(op('plus')); }
        numerals.push(num(p)); dots.push({ t: 'dots', n: p, crossed: 0 });
      });
    }
    return { numerals, dots, total: dots.reduce((a, d) => a + (d.t === 'dots' ? d.n : 0), 0), target: round.target };
  }
  // The dots one by one (left to right, across groups): lit when a firefly in the jar stands for it, crossed when the
  // label takes it away. For a take-away, letting fireflies out dims the crossed dots from the right.
  function dotStates(round, inJar) {
    const lm = labelModel(round), out = [];
    let g = 0;
    for (const d of lm.dots) {
      if (d.t !== 'dots') continue;
      for (let i = 0; i < d.n; i++) out.push({ group: g, lit: out.length < inJar, crossed: i >= d.n - d.crossed });
      g++;
    }
    return out;
  }
  const describe = (r) => (r.k === 't' ? r.parts[0] + '-' + r.parts[1] : r.parts.join('+'));

  // ---------- one play of one level ----------
  // Fireflies are tapped with catchFly(), the jar with tapJar(). When the jar holds its number, phase is 'full' for the
  // celebration: anything tapped then is an overfill (a hiccup, counted against the stars). advance() moves to the next jar.
  const starsFor = (overfills) => (overfills <= 0 ? 3 : overfills <= 2 ? 2 : 1);   // never about speed
  class Run {
    constructor(mode, level) {
      this.mode = mode; this.level = level; this.plan = planOf(mode, level); this.rounds = roundsOf(mode, level);
      this.ri = 0; this.capped = 0; this.overfills = 0; this.caught = 0; this.released = 0; this.done = false; this.finalStars = 0;
      this.begin(0);
    }
    begin(ri) {
      this.ri = ri; this.round = this.rounds[ri];
      this.inJar = this.round.k === 't' ? this.round.total : 0;
      this.phase = 'fill';
    }
    // jump straight to jar ri (used by tests and the debug hook)
    goto(ri) { this.ri = Math.max(0, Math.min(this.rounds.length - 1, ri)); this.capped = this.ri; this.begin(this.ri); }
    get target() { return this.round.target; }
    get stars() { return starsFor(this.overfills); }
    get takeAway() { return this.round.k === 't'; }
    // a firefly was tapped
    catchFly() {
      if (this.done) return { type: 'ignored' };
      if (this.takeAway) return { type: 'shake' };                                      // outside fireflies sit a take-away out
      if (this.phase === 'full') { this.overfills++; return { type: 'overfill' }; }   // one too many: a hiccup, nothing else
      this.inJar++; this.caught++;
      if (this.inJar >= this.round.target) { this.phase = 'full'; return { type: 'catch', n: this.inJar, full: true }; }
      return { type: 'catch', n: this.inJar, full: false };
    }
    // the jar was tapped
    tapJar() {
      if (this.done) return { type: 'ignored' };
      if (!this.takeAway) return { type: 'jar' };
      if (this.phase === 'full') { this.overfills++; return { type: 'overfill' }; }
      this.inJar--; this.released++;
      if (this.inJar <= this.round.target) { this.phase = 'full'; return { type: 'release', n: this.inJar, full: true }; }
      return { type: 'release', n: this.inJar, full: false };
    }
    // the celebration is over: the next jar, or the end of the level (the chest)
    advance() {
      if (this.done || this.phase !== 'full') return { type: 'ignored' };
      this.capped++;
      if (this.ri + 1 >= this.rounds.length) {
        this.done = true; this.finalStars = this.stars;
        return { type: 'level', stars: this.finalStars, coins: this.capped + CHEST_COINS };
      }
      this.begin(this.ri + 1);
      return { type: 'jar', ri: this.ri };
    }
  }

  // ---------- the drifting fireflies ----------
  // Each firefly flies a soft sine-wobbled curve, turns away from walls and from neighbours, and a hard pass at the end
  // of every step pushes any pair closer than `sep` apart again. So the spacing rule always holds, and a tap always has one answer.
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
  function layout(vw) {
    const colW = clamp(vw * 0.28, 270, 340);          // the left column: Isabella, the jar, its label
    return {
      vw, colW,
      field: { x0: colW + ZONE + 6, x1: vw - ZONE - 10, y0: 60, y1: 488 },   // where firefly CENTRES may go (the whole tap zone stays on screen)
      jar: { x: Math.round(colW * 0.58), y: 262, r: 72 },
    };
  }
  // narrower screens (an iPad) have less room: a closer limit or fewer fireflies, never a broken spacing rule
  function fit(vw, plan) {
    const L = layout(vw), fw = L.field.x1 - L.field.x0, fh = L.field.y1 - L.field.y0;
    let count = plan.count, sep = plan.sep;
    const crowded = () => count * Math.PI * (sep / 2) * (sep / 2) > 0.32 * (fw + sep) * (fh + sep);
    while (crowded() && sep > MIN_SEP) sep = Math.max(MIN_SEP, sep - 4);
    while (crowded() && count > 5) count--;
    return { count, sep };
  }
  class Swarm {
    // o: { rng, field: {x0,x1,y0,y1}, count, sep, speed }
    constructor(o) {
      this.rng = o.rng; this.field = o.field; this.sep = Math.max(MIN_SEP, o.sep); this.speed = o.speed; this.want = o.count;
      this.flies = []; this.queue = []; this.t = 0; this.nextId = 1;
      for (let i = 0; i < this.want; i++) if (!this.spawn()) break;
    }
    // a free spot, at least sep + 6 from every firefly: random tries first, then a sweep of a hex lattice (so a crowded field still fills)
    place() {
      const f = this.field, need = this.sep + 6, free = (x, y) => this.flies.every((q) => Math.hypot(q.x - x, q.y - y) >= need);
      for (let tries = 0; tries < 200; tries++) {
        const x = f.x0 + this.rng() * (f.x1 - f.x0), y = f.y0 + this.rng() * (f.y1 - f.y0);
        if (free(x, y)) return { x, y };
      }
      const step = need, rowH = step * 0.866, ox = this.rng() * step, oy = this.rng() * rowH, spots = [];
      for (let r = 0, y = f.y0 + oy * 0.5; y <= f.y1; r++, y += rowH) {
        for (let x = f.x0 + ((r % 2) * step) / 2 + ox * 0.5; x <= f.x1; x += step) if (free(x, y)) spots.push({ x, y });
      }
      return spots.length ? spots[Math.floor(this.rng() * spots.length)] : null;
    }
    spawn() {
      const p = this.place();
      if (!p) return null;
      const r = this.rng;
      const f = { id: this.nextId++, x: p.x, y: p.y, a: r() * TAU, k: 0.8 + 0.4 * r(), ph: r() * TAU, w: 0.35 + 0.5 * r(), amp: 0.45 + 0.5 * r(), busy: false, age: 0, seed: r() * 10 };
      this.flies.push(f);
      return f;
    }
    // a caught firefly leaves; a new one fades in after RESPAWN seconds
    remove(f) {
      const i = this.flies.indexOf(f);
      if (i < 0) return false;
      this.flies.splice(i, 1); this.queue.push({ t: RESPAWN });
      return true;
    }
    // the firefly a tap at (x, y) means: the nearest free one inside its tap zone (zones never overlap, so there is at most one)
    pick(x, y) {
      let best = null, bd = ZONE * ZONE;
      for (const f of this.flies) {
        if (f.busy) continue;
        const d = (f.x - x) * (f.x - x) + (f.y - y) * (f.y - y);
        if (d <= bd) { bd = d; best = f; }
      }
      return best;
    }
    step(dt) {
      while (dt > 1e-9) { const h = Math.min(dt, 1 / 30); this.sub(h); dt -= h; }
    }
    sub(h) {
      this.t += h;
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const q = this.queue[i];
        if ((q.t -= h) > 0) continue;
        if (this.flies.length >= this.want) { this.queue.splice(i, 1); continue; }
        if (this.spawn()) this.queue.splice(i, 1); else q.t = 0.25;   // no free spot yet: try again shortly
      }
      const fl = this.flies, f0 = this.field, R = this.sep * 1.45, M = 80;
      for (const f of fl) {
        f.age += h;
        let px = 0, py = 0, crowd = 0;
        if (f.x < f0.x0 + M) px += (f0.x0 + M - f.x) / M; else if (f.x > f0.x1 - M) px -= (f.x - (f0.x1 - M)) / M;
        if (f.y < f0.y0 + M) py += (f0.y0 + M - f.y) / M; else if (f.y > f0.y1 - M) py -= (f.y - (f0.y1 - M)) / M;
        const fvx = Math.cos(f.a), fvy = Math.sin(f.a);
        for (const g of fl) {
          if (g === f) continue;
          const dx = f.x - g.x, dy = f.y - g.y, d2 = dx * dx + dy * dy;
          if (d2 >= R * R || d2 < 1e-9) continue;
          const d = Math.sqrt(d2), w = (R - d) / R;
          // heading towards each other? then it matters more, and the firefly eases off a little
          const closing = -(dx * (fvx * f.k - Math.cos(g.a) * g.k) + dy * (fvy * f.k - Math.sin(g.a) * g.k)) / d;
          const gain = closing > 0 ? 2.4 : 0.9;
          px += (dx / d) * w * gain; py += (dy / d) * w * gain;
          if (closing > 0) crowd = Math.max(crowd, w);
        }
        f.a += f.amp * Math.sin(this.t * f.w + f.ph) * h;    // the soft curve
        const pm = Math.hypot(px, py);
        if (pm > 1e-6) f.a += angDiff(Math.atan2(py, px), f.a) * Math.min(1, h * 4 * Math.min(1, pm));
        const v = this.speed * f.k * (1 - 0.45 * crowd);
        f.x += Math.cos(f.a) * v * h; f.y += Math.sin(f.a) * v * h;
      }
      this.settle();
    }
    // the spacing rule: no two fireflies closer than sep, none outside the field
    settle() {
      const fl = this.flies, f0 = this.field, sep = this.sep, s2 = sep * sep;
      const keepIn = () => {
        let m = false;
        for (const f of fl) {
          const x = clamp(f.x, f0.x0, f0.x1), y = clamp(f.y, f0.y0, f0.y1);
          if (x !== f.x || y !== f.y) { f.x = x; f.y = y; m = true; }
        }
        return m;
      };
      for (let it = 0; it < 200; it++) {
        let moved = keepIn();
        for (let i = 0; i < fl.length; i++) {
          for (let j = i + 1; j < fl.length; j++) {
            const p = fl[i], q = fl[j];
            let dx = q.x - p.x, dy = q.y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= s2) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-6) { dx = Math.cos(i * 2.399); dy = Math.sin(i * 2.399); d = 1; }
            const push = (sep - d) / 2 + 1e-3, nx = dx / d, ny = dy / d;
            p.x -= nx * push; p.y -= ny * push; q.x += nx * push; q.y += ny * push; moved = true;
          }
        }
        if (!moved) break;
      }
    }
    minGap() {
      let m = Infinity;
      for (let i = 0; i < this.flies.length; i++) for (let j = i + 1; j < this.flies.length; j++) m = Math.min(m, Math.hypot(this.flies[i].x - this.flies[j].x, this.flies[i].y - this.flies[j].y));
      return m;
    }
  }

  // ---------- the save ----------
  const freshSave = () => ({ v: 1, mode: 'easy', unlocked: { easy: 1, medium: 1, hard: 1 }, stars: { easy: [], medium: [], hard: [] }, coins: 0, jars: 0, caught: 0, overfills: 0, chests: 0 });
  function migrate(raw) {
    const sv = freshSave();
    let s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return sv; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sv;
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
    const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
    if (MODES.includes(s.mode)) sv.mode = s.mode;
    for (const k of ['coins', 'jars', 'caught', 'overfills', 'chests']) sv[k] = int(s[k], 0, 1e9) || 0;
    for (const m of MODES) {
      const st = plain(s.stars) && Array.isArray(s.stars[m]) ? s.stars[m] : [];
      sv.stars[m] = Array.from({ length: Math.min(NLEV, st.length) }, (_, i) => int(st[i], 0, 3) || 0);
      const beaten = sv.stars[m].reduce((q, v, i) => (v > 0 ? i + 1 : q), 0);
      const u = plain(s.unlocked) ? int(s.unlocked[m], 1, NLEV) : null;
      sv.unlocked[m] = Math.min(NLEV, Math.max(u || 1, beaten + 1));
    }
    return sv;
  }

  const api = {
    MODES, NLEV, ZONE, MIN_SEP, JAR_MAX, CHEST_COINS, RESPAWN, HINT_AFTER, TABLE, SPEED, SEP, THEME_OF,
    worldOf, planOf, roundsOf, canon, labelModel, dotStates, describe, starsFor, Run, Swarm, layout, fit, freshSave, migrate, mulberry32,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FireflyLogic = api;
})(typeof self !== 'undefined' ? self : this);
