// A model of a child steering Rainbow Slide, for the tests (Node and, injected into the page, the browser).
//
// What it may know: only the ribbon within LOOK units ahead of her (2 seconds' slide at the course's speed: less
// than the screen ever shows), and only as it was REACT seconds ago (a reaction time). What it may do: pick a line
// through that stretch that needs no more than 60% of her sideways speed, then turn the steering toward it no
// faster than RATE per second (a turn rate: 1/3 s from straight to hard over). It chases coins the way a child
// does, and otherwise keeps away from clouds and from the rim.
//
// It never reads the course's lane or anything else the child cannot see.
(function (root) {
  'use strict';
  function makePilot(L, opts) {
    opts = opts || {};
    const CELL = 6, ROW = 24;
    const LOOKSECS = opts.look || 2;
    const REACT = opts.react == null ? 0.3 : opts.react;
    const EVERY = 0.1;                               // she re-thinks ten times a second
    const RATE = opts.rate || 6;                     // steer units per second
    const PAD = opts.pad == null ? 12 : opts.pad;    // room she likes to leave round her
    const MOVER = 30;                                // and the extra room she gives a cloud that moves
    const SOFT = 34;                                 // closer than this to a cloud is "a bit near"
    const LAT = 0.6 * L.VU_MAX;
    const NEG = -1e9;
    const PLANS = 8;

    class Pilot {
      constructor(run, mode, seed) {
        this.run = run; this.mode = mode || 'child';
        this.rng = L.mulberry32((seed || 1) * 7919 + 17);
        this.XC = run.lev.hw - L.EDGE - 8;           // she keeps this far in from the rim
        this.NX = Math.floor((2 * this.XC) / CELL) + 1;
        this.LOOK = LOOKSECS * run.vc;
        this.NR = Math.max(4, Math.floor(this.LOOK / ROW));
        this.best = new Float32Array((this.NR + 1) * this.NX); this.from = new Int16Array((this.NR + 1) * this.NX); this.cost = new Float32Array(this.NX);
        this.steer = 0; this.since = 1e9; this.clock = 0;
        this.plans = []; this.travel = 0; this.lastX = run.x; this.dead = 0; this.wanderT = 0; this.wanderTo = 0;
        for (let i = 0; i < PLANS; i++) this.plans.push({ at: -1e9, s0: 0, xs: new Float32Array(this.NR + 1) });
        this.pi = 0;
      }
      xOf(j) { return -this.XC + j * CELL; }
      jOf(x) { return Math.max(0, Math.min(this.NX - 1, Math.round((x + this.XC) / CELL))); }
      // one look at the ribbon ahead: the best line through it from where she is
      plan() {
        const run = this.run, lev = run.lev, v = Math.max(100, run.v), NX = this.NX, NR = this.NR, best = this.best, from = this.from, cost = this.cost;
        const m = Math.max(1, Math.floor((LAT * (ROW / Math.max(v, run.vc * 0.7))) / CELL));
        const j0 = this.jOf(run.x);
        best.fill(NEG, 0, NX);
        for (let j = Math.max(0, j0 - 1); j <= Math.min(NX - 1, j0 + 1); j++) best[j] = 0;
        let ci = run.ci, lastOpen = 0;
        for (let r = 1; r <= NR; r++) {
          const s = run.s + r * ROW, t = run.t + (r * ROW) / v, base = r * NX, prev = base - NX;
          cost.fill(0);
          const near = lev.buckets[Math.floor(s / 200)];
          if (near) {
            for (let i = 0; i < near.length; i++) {
              const o = near[i];
              if (Math.abs(o.s - s) > o.r + 60 + SOFT) continue;
              const ox = L.obsX(o, t), w = L.halfWidth(o) + L.BODY_R + SOFT + MOVER + CELL, ja = this.jOf(ox - w), jb = this.jOf(ox + w);
              for (let j = ja; j <= jb; j++) {
                if (cost[j] === NEG) continue;
                const x = this.xOf(j), pad = o.amp ? PAD + MOVER : PAD;   // a wider berth for a cloud that moves
                if (L.touches(o, t, s + L.BODY[0][0], x, L.BODY[0][1] + pad) || L.touches(o, t, s + L.BODY[1][0], x, L.BODY[1][1] + pad)) cost[j] = NEG;
                else if (L.touches(o, t, s + L.BODY[0][0], x, L.BODY[0][1] + SOFT)) cost[j] = Math.min(cost[j], -0.6);
              }
            }
          }
          // coins on this row
          while (ci < lev.coins.length && lev.coins[ci].s < s - ROW / 2) ci++;
          for (let i = ci; i < lev.coins.length && lev.coins[i].s < s + ROW / 2; i++) {
            if (run.got[i]) continue;
            const c = lev.coins[i];
            for (let j = this.jOf(c.x - 30); j <= this.jOf(c.x + 30); j++) if (cost[j] !== NEG) cost[j] += Math.abs(this.xOf(j) - c.x) < 14 ? 12 : 10;
          }
          let any = false;
          for (let j = 0; j < NX; j++) {
            if (cost[j] === NEG) { best[base + j] = NEG; continue; }
            let b = NEG, bk = -1;
            for (let k = Math.max(0, j - m); k <= Math.min(NX - 1, j + m); k++) {
              const q = best[prev + k];
              if (q === NEG) continue;
              const val = q - 0.03 * Math.abs(k - j);
              if (val > b) { b = val; bk = k; }
            }
            if (bk < 0) { best[base + j] = NEG; continue; }
            best[base + j] = b + cost[j]; from[base + j] = bk; any = true;
          }
          if (!any) break;
          lastOpen = r;
        }
        // the end of the line: the best place to be at the far edge of what she can see (a little shy of the sides)
        const p = this.plans[this.pi]; this.pi = (this.pi + 1) % PLANS;
        let end = -1, eb = NEG;
        for (let j = 0; j < NX; j++) {
          const q = best[lastOpen * NX + j];
          if (q === NEG) continue;
          const val = q - 0.004 * Math.abs(this.xOf(j));
          if (val > eb) { eb = val; end = j; }
        }
        if (lastOpen < NR) this.dead++;
        if (end < 0) end = j0;
        for (let r = lastOpen; r >= 1; r--) { p.xs[r] = this.xOf(end); end = from[r * NX + end]; }
        p.xs[0] = run.x;
        for (let r = lastOpen + 1; r <= NR; r++) p.xs[r] = p.xs[lastOpen];
        p.at = this.clock; p.s0 = run.s;
      }
      // one frame: read .steer afterwards
      step(dt) {
        const run = this.run;
        this.clock += dt; this.since += dt;
        if (this.mode === 'random') {
          // a very young child: steers at random and never looks (for "nothing can be failed")
          this.wanderT -= dt;
          if (this.wanderT <= 0) { this.wanderTo = this.rng() * 2 - 1; this.wanderT = 0.2 + this.rng() * 1.2; }
          this.steer = this.wanderTo;
          return;
        }
        if (this.since >= EVERY) { this.since = 0; this.plan(); }
        // the newest look that is at least REACT old
        let p = null;
        for (let i = 0; i < PLANS; i++) { const q = this.plans[i]; if (q.at <= this.clock - REACT && (!p || q.at > p.at)) p = q; }
        let want = 0;
        if (p && p.at > -1e8) {
          const f = (run.s + run.v * 0.1 - p.s0) / ROW, r = Math.max(0, Math.min(this.NR - 1, Math.floor(f))), u = Math.max(0, Math.min(1, f - r));
          const xt = p.xs[r] + (p.xs[r + 1] - p.xs[r]) * u;
          want = Math.max(-1, Math.min(1, (xt - run.x) / 45));
        }
        const d = want - this.steer, lim = RATE * dt;
        this.steer += d > lim ? lim : d < -lim ? -lim : d;
        this.travel += Math.abs(run.x - this.lastX); this.lastX = run.x;
      }
    }

    // slide a whole course with the real Run.step(); returns what happened
    function slide(n, modeId, mode, seed, seedOverride) {
      const run = new L.Run(n, modeId, seedOverride), pilot = new Pilot(run, mode, seed), DT = 1 / 60;
      let frames = 0, finishT = 0;
      const poofs = [];
      while (run.phase !== 'done' && frames < 60 * 600) {
        if (run.phase === 'play') pilot.step(DT);
        run.step(DT, run.phase === 'play' ? pilot.steer : 0);
        for (const e of run.ev) if (e.type === 'poof') poofs.push({ s: Math.round(e.s), x: Math.round(e.x), at: e.o && e.o.x });
        run.ev.length = 0;
        frames++;
        if (run.phase === 'finish' && !finishT) finishT = run.t;
      }
      return {
        done: run.phase === 'done', secs: finishT, total: frames * DT, bumps: run.bumps, poofs, laneCoins: run.laneCount, bonus: run.bonusCount, of: run.lev.total, laneTotal: run.lev.laneTotal,
        stars: run.stars, hasKey: run.hasKey, rails: run.rails, rims: run.rims, slips: run.slips, travel: pilot.travel, dead: pilot.dead, spilled: run.spilled, run,
      };
    }
    return { Pilot, slide, REACT, RATE, PAD, CELL, ROW, LOOKSECS };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { makePilot };
  else root.SlidePilot = { makePilot };
})(typeof self !== 'undefined' ? self : this);
