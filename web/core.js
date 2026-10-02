/* Isabella the Mermaid — game rules.
 * Pure logic, no DOM: test/verify.js runs every level headless with this same file.
 * Every obstacle's position is a pure function of level time t, so a checkpoint
 * restart is just "set t back" and the verifier can sweep a level deterministically. */
(function (root) {
  'use strict';

  const H = 540;          // world height; the screen is always 540 units tall
  const TOP = 52;         // highest Isabella's centre may go
  const FLOOR = 488;      // lowest
  const SAND = 500;       // sand surface
  const SWIM = 480;       // fastest she swims (units / s)
  const START_X = 210;    // her screen x at the start and after a checkpoint
  const FISH_LEAD = 1500; // a fast fish waits this far ahead of the camera's left edge

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (u) => u * u * (3 - 2 * u);
  const TAU = Math.PI * 2;

  const ALL = ['rockB', 'rockT', 'gate', 'urchinPair', 'jelly', 'jellyTrio', 'crab', 'puffer', 'eel', 'current', 'fish',
    'slalom', 'rockJelly', 'tunnel', 'pufferPair', 'coins'];
  // World 2 (levels 11-20) adds skill obstacles: sliding gates, spinning urchin wheels, dropping
  // anchors, fish schools, eel rows, jelly walls, long tunnels and counter-spinning wheel pairs.
  const W2 = ['mgate', 'wheel', 'anchor', 'school', 'eelRow', 'jellyWall', 'longTunnel', 'spinPair'];
  const ALL2 = [...ALL, ...W2];
  const HARD = new Set([...W2, 'slalom', 'tunnel', 'jellyTrio', 'pufferPair']);
  const world2 = (k) => [...ALL, ...W2.slice(0, k)];

  // One engine, twenty levels: each level only turns the dials.
  // Levels 11-20: 3 checkpoints, `tempo` speeds up every creature, `hard` favours the skill patterns.
  const LEVELS = [
    { name: 'Sunny Shallows', speed: 125, len: 5000, gap: [300, 400], gate: 280, rockMax: 210, hearts: 3, feature: 'rockB',
      kinds: ['rockB', 'rockT', 'urchin', 'gate', 'coins'] },
    { name: 'Coral Garden', speed: 135, len: 5800, gap: [280, 380], gate: 265, rockMax: 225, hearts: 3, feature: 'jelly',
      kinds: ['rockB', 'rockT', 'gate', 'urchin', 'jelly', 'coins'] },
    { name: 'Kelp Forest', speed: 145, len: 6600, gap: [260, 350], gate: 250, rockMax: 240, hearts: 3, feature: 'crab',
      kinds: ['rockB', 'rockT', 'gate', 'urchinPair', 'jelly', 'crab', 'slalom', 'coins'] },
    { name: 'Turtle Bay', speed: 155, len: 7400, gap: [245, 330], gate: 240, rockMax: 250, hearts: 2, feature: 'puffer',
      kinds: ['rockB', 'rockT', 'gate', 'urchinPair', 'jelly', 'crab', 'puffer', 'slalom', 'coins'] },
    { name: 'Sunken Ship', speed: 165, len: 8200, gap: [230, 310], gate: 228, rockMax: 260, hearts: 2, feature: 'eel',
      kinds: ['rockB', 'rockT', 'gate', 'urchinPair', 'jellyTrio', 'crab', 'puffer', 'eel', 'slalom', 'rockJelly', 'coins'] },
    { name: 'Twilight Reef', speed: 175, len: 9000, gap: [215, 295], gate: 218, rockMax: 265, hearts: 2, feature: 'current',
      kinds: ['rockB', 'rockT', 'gate', 'urchinPair', 'jellyTrio', 'puffer', 'eel', 'current', 'slalom', 'rockJelly', 'tunnel', 'coins'] },
    { name: 'Crystal Caves', speed: 185, len: 9800, gap: [200, 280], gate: 208, rockMax: 270, hearts: 2, feature: 'fish',
      kinds: ['rockB', 'rockT', 'gate', 'urchinPair', 'jellyTrio', 'crab', 'puffer', 'eel', 'fish', 'slalom', 'rockJelly', 'tunnel', 'pufferPair', 'coins'] },
    { name: 'Volcano Vents', speed: 195, len: 10600, gap: [190, 265], gate: 200, rockMax: 275, hearts: 1, feature: 'eel', kinds: ALL },
    { name: 'Glow Deep', speed: 205, len: 11400, gap: [175, 250], gate: 192, rockMax: 280, hearts: 1, feature: 'jellyTrio', kinds: ALL },
    { name: 'Rainbow Palace', speed: 215, len: 12200, gap: [160, 235], gate: 185, rockMax: 285, hearts: 1, feature: 'tunnel', kinds: ALL },
    { name: 'Pearl Lagoon', seed: 2130, speed: 220, len: 13500, gap: [190, 265], gate: 190, rockMax: 285, hearts: 2, feature: 'mgate', tempo: 1.05, cps: 3, kinds: world2(1) },
    { name: 'Seahorse Meadow', seed: 2224, speed: 226, len: 14500, gap: [182, 255], gate: 186, rockMax: 288, hearts: 2, feature: 'wheel', tempo: 1.08, cps: 3, kinds: world2(2) },
    { name: 'Starfish Sands', seed: 2313, speed: 232, len: 15500, gap: [175, 245], gate: 182, rockMax: 290, hearts: 2, feature: 'anchor', tempo: 1.11, cps: 3, kinds: world2(3) },
    { name: 'Whale Song Deep', seed: 2403, speed: 238, len: 16500, gap: [168, 236], gate: 178, rockMax: 292, hearts: 1, feature: 'school', tempo: 1.14, cps: 3, kinds: world2(4) },
    { name: 'Pirate Cove', seed: 2510, speed: 244, len: 17500, gap: [161, 228], gate: 174, rockMax: 294, hearts: 1, feature: 'eelRow', tempo: 1.17, cps: 3, kinds: world2(5) },
    { name: 'Moonlight Reef', seed: 2636, speed: 250, len: 18500, gap: [154, 220], gate: 170, rockMax: 296, hearts: 1, feature: 'jellyWall', tempo: 1.2, cps: 3, kinds: world2(6) },
    { name: 'Ice Palace', seed: 2729, speed: 257, len: 19500, gap: [147, 212], gate: 166, rockMax: 298, hearts: 1, feature: 'longTunnel', tempo: 1.24, cps: 3, kinds: world2(7) },
    { name: 'Lava Reef', seed: 2803, speed: 264, len: 20800, gap: [140, 204], gate: 162, rockMax: 300, hearts: 1, feature: 'spinPair', tempo: 1.28, cps: 3, hard: true, kinds: ALL2 },
    { name: 'Stormy Sea', seed: 2925, speed: 272, len: 22200, gap: [133, 196], gate: 158, rockMax: 300, hearts: 0, feature: 'mgate', tempo: 1.32, cps: 3, hard: true, kinds: ALL2 },
    { name: "Queen's Treasure", seed: 3002, speed: 280, len: 24000, gap: [112, 170], gate: 150, rockMax: 300, hearts: 0, feature: 'wheel', tempo: 1.36, cps: 3, hard: 2, kinds: ALL2 },
  ];

  // ---------- obstacle motion (pure functions of t) ----------
  const jellyY = (o, t) => o.y + o.amp * Math.sin(o.w * t + o.ph);
  function pufferR(o, t) {
    const s = Math.sin(TAU * (t / o.per + o.ph));
    return 18 + 28 * smooth(clamp((s + 0.3) / 1.3, 0, 1)); // 18 .. 46
  }
  const crabX = (o, t) => o.x + o.range * Math.sin(o.w * t + o.ph);
  function eelPhase(o, t) { return (((t / o.per + o.ph) % 1) + 1) % 1; }
  function eelExt(o, t) {
    const p = eelPhase(o, t);
    if (p < 0.4) return 0;
    if (p < 0.5) return smooth((p - 0.4) / 0.1);
    if (p < 0.8) return 1;
    if (p < 0.9) return 1 - smooth((p - 0.8) / 0.1);
    return 0;
  }
  const eelWarn = (o, t) => { const p = eelPhase(o, t); return p >= 0.22 && p < 0.4; };
  function eelPts(o, t) {
    const e = eelExt(o, t), top = SAND - e * o.len, out = [];
    if (e <= 0.02) return out;
    const n = Math.max(1, Math.round((SAND - top) / 22));
    for (let i = 0; i <= n; i++) {
      const y = lerp(SAND - 6, top, i / n);
      out.push([o.x + Math.sin(t * 5 + i * 0.7) * 7 * (i / n), y]);
    }
    return out;
  }
  const fishX = (o, t) => (t < o.t0 ? o.x0 : o.x0 - o.v * (t - o.t0));
  // a rock gate whose gap slides up and down
  const mgateY = (o, t) => o.y0 + o.amp * Math.sin(o.om * t + o.ph);
  // a spinning wheel: a shell hub with arms of urchins (Mario's fire bar, underwater)
  function wheelPts(o, t) {
    const a = o.om * t + o.ph, out = [[o.x, o.y, 16]];
    for (let arm = 0; arm < o.arms; arm++) {
      const ang = a + (arm * TAU) / o.arms, cs = Math.cos(ang), sn = Math.sin(ang);
      for (let i = 1; i <= o.nu; i++) { const d = (o.L * i) / o.nu; out.push([o.x + cs * d, o.y + sn * d, 13]); }
    }
    return out;
  }
  // An anchor on a winch: waits above the screen, is lowered steadily to the sand, rests, and is
  // hauled back up. It moves at about her swimming speed — a fast drop swept the whole depth in
  // 0.35 s while she passed under it, which test/verify.js showed no one could dodge.
  function anchorPhase(o, t) { return (((t / o.per + o.ph) % 1) + 1) % 1; }
  function anchorY(o, t) {
    const p = anchorPhase(o, t), rest = SAND - 34, up = -80;
    if (p < 0.2) return up;
    if (p < 0.55) return up + ((rest - up) * (p - 0.2)) / 0.35;
    if (p < 0.7) return rest;
    return rest - ((rest - up) * (p - 0.7)) / 0.3;
  }
  const anchorWarn = (o, t) => { const p = anchorPhase(o, t); return p >= 0.1 && p < 0.2; };

  // Collision shapes: circles [x,y,r] and rects [x0,y0,x1,y1], a little smaller than they look (kind to a 6-year-old).
  function shapes(o, t, c, r) {
    switch (o.k) {
      case 'rock': {
        const x0 = o.x - o.w / 2 + 7, x1 = o.x + o.w / 2 - 7;
        if (o.top) r.push([x0, -60, x1, o.h - 9]); else r.push([x0, SAND - o.h + 9, x1, H + 60]);
        break;
      }
      case 'urchin': c.push([o.x, o.y, o.r - 2]); break;
      case 'jelly': { const y = jellyY(o, t); c.push([o.x, y - 2, 23]); c.push([o.x, y + 24, 12]); break; }
      case 'puffer': c.push([o.x, o.y, pufferR(o, t) * 0.9]); break;
      case 'crab': c.push([crabX(o, t), SAND - 20, 21]); break;
      case 'eel': { const p = eelPts(o, t); for (let i = 0; i < p.length; i++) c.push([p[i][0], p[i][1], i === p.length - 1 ? 16 : 12]); break; }
      case 'fish': { const x = fishX(o, t); c.push([x, o.y, 25]); c.push([x + 36, o.y, 14]); break; }
      case 'mgate': {
        const gy = mgateY(o, t), x0 = o.x - o.w / 2 + 7, x1 = o.x + o.w / 2 - 7;
        r.push([x0, -60, x1, gy - o.g / 2 - 9]); r.push([x0, gy + o.g / 2 + 9, x1, H + 60]);
        break;
      }
      case 'wheel': for (const p of wheelPts(o, t)) c.push(p); break;
      case 'anchor': { const y = anchorY(o, t); c.push([o.x, y, 22]); c.push([o.x, y - 30, 10]); break; }
    }
  }

  // Isabella's body as three circles (head/chest, hips, tail), facing right.
  function bodyCircles(px, py, inflate) {
    return [[px + 20, py - 3, 16 + inflate], [px - 6, py + 1, 13 + inflate], [px - 32, py + 4, 9 + inflate]];
  }

  const _c = [], _r = [];
  function touches(o, t, body) {
    _c.length = 0; _r.length = 0;
    shapes(o, t, _c, _r);
    for (const b of body) {
      for (const s of _c) { const dx = b[0] - s[0], dy = b[1] - s[1], rr = b[2] + s[2]; if (dx * dx + dy * dy < rr * rr) return true; }
      for (const s of _r) {
        const qx = clamp(b[0], s[0], s[2]), qy = clamp(b[1], s[1], s[3]);
        const dx = b[0] - qx, dy = b[1] - qy;
        if (dx * dx + dy * dy < b[2] * b[2]) return true;
      }
    }
    return false;
  }
  // Obstacles are filed in 200-unit buckets, each padded by 100 on both sides, so the bucket
  // under px holds everything that could touch her (her body spans px-41..px+36).
  const BUCKET = 200;
  function hitTest(lev, t, px, py, inflate) {
    const body = bodyCircles(px, py, inflate || 0);
    const near = lev.buckets[Math.floor(px / BUCKET)];
    if (near) for (const o of near) if (touches(o, t, body)) return o;
    for (const o of lev.fish) {
      const fx = fishX(o, t);
      if (fx > px + 120 || fx < px - 120) continue;
      if (touches(o, t, body)) return o;
    }
    return null;
  }

  // Which way to push her after a bump: away from the thing she hit.
  function awayY(o, t, py) {
    if (o.k === 'rock') return o.top ? 1 : -1;
    if (o.k === 'mgate') return py < mgateY(o, t) ? 1 : -1;
    let oy = 270;
    if (o.k === 'jelly') oy = jellyY(o, t);
    else if (o.k === 'anchor') oy = anchorY(o, t);
    else if (o.k === 'eel' || o.k === 'crab') oy = SAND;
    else if (o.y != null) oy = o.y;
    return py < oy ? -1 : 1;
  }

  // ---------- level building ----------
  // `seed` (picked by test/tune.js) chooses among layouts; levels 1-10 have none and use n.
  function buildLevel(n, seedOverride) {
    const L = Object.assign({ n }, LEVELS[n - 1]);
    const seed = seedOverride != null ? seedOverride : L.seed != null ? L.seed : n;
    const R = mulberry32((0x9E3779B1 ^ Math.imul(seed, 2654435761)) >>> 0);
    const rnd = (a, b) => a + (b - a) * R();
    const tempo = L.tempo || 1; // world 2: every creature moves faster (x1 leaves levels 1-10 unchanged)

    const coinLine = (o, x0, y0, x1, y1, k) => { for (let i = 0; i < k; i++) { const u = k === 1 ? 0.5 : i / (k - 1); o.coins.push({ x: lerp(x0, x1, u), y: lerp(y0, y1, u) }); } };

    const P = {
      rockB(x, o) {
        const w = rnd(70, 100), h = rnd(130, L.rockMax), cx = x + w / 2, top = SAND - h;
        o.obs.push({ k: 'rock', x: cx, w, h, top: false });
        for (let i = 0; i < 5; i++) o.coins.push({ x: cx + (i - 2) * 44, y: top - 70 - (2 - Math.abs(i - 2)) * 20 });
        return w;
      },
      rockT(x, o) {
        const w = rnd(70, 100), h = rnd(130, L.rockMax), cx = x + w / 2;
        o.obs.push({ k: 'rock', x: cx, w, h, top: true });
        for (let i = 0; i < 5; i++) o.coins.push({ x: cx + (i - 2) * 44, y: h + 70 + (2 - Math.abs(i - 2)) * 20 });
        return w;
      },
      gate(x, o) {
        const w = rnd(70, 95), g = L.gate, cx = x + w / 2;
        const gy = rnd(TOP + g / 2 + 40, FLOOR - g / 2 - 30);
        o.obs.push({ k: 'rock', x: cx, w, h: gy - g / 2, top: true });
        o.obs.push({ k: 'rock', x: cx, w, h: SAND - (gy + g / 2), top: false });
        coinLine(o, cx - 90, gy, cx + 90, gy, 4);
        return w;
      },
      urchin(x, o) {
        const y = rnd(130, 420);
        o.obs.push({ k: 'urchin', x: x + 25, y, r: 22 });
        const yc = y < 270 ? y + 140 : y - 140;
        coinLine(o, x - 40, yc, x + 90, yc, 4);
        return 50;
      },
      urchinPair(x, o) {
        const g = L.gate, y1 = rnd(92, 452 - g - 44), y2 = y1 + 44 + g;
        o.obs.push({ k: 'urchin', x: x + 25, y: y1, r: 22 });
        o.obs.push({ k: 'urchin', x: x + 25, y: y2, r: 22 });
        coinLine(o, x - 50, (y1 + y2) / 2, x + 100, (y1 + y2) / 2, 4);
        return 50;
      },
      jelly(x, o) {
        const y = rnd(200, 340), amp = rnd(60, 105);
        o.obs.push({ k: 'jelly', x: x + 30, y, amp, w: rnd(1.0, 1.5) * tempo, ph: rnd(0, TAU) });
        const yc = y < 270 ? y + amp + 95 : y - amp - 95;
        coinLine(o, x - 30, yc, x + 90, yc, 3);
        return 60;
      },
      jellyTrio(x, o) {
        const amp = rnd(95, 130), ph = rnd(0, TAU), w = rnd(1.0, 1.25) * tempo;
        for (let i = 0; i < 3; i++) o.obs.push({ k: 'jelly', x: x + 30 + i * 135, y: 270, amp, w, ph: ph - i * 1.7 });
        return 330;
      },
      crab(x, o) {
        const range = rnd(80, 140), cx = x + range + 30;
        o.obs.push({ k: 'crab', x: cx, range, w: rnd(1.2, 1.8) * tempo, ph: rnd(0, TAU) });
        if (n >= 5 && R() < 0.5) {
          o.obs.push({ k: 'rock', x: cx, w: 80, h: rnd(140, 180), top: true });
          coinLine(o, cx - 90, 330, cx + 90, 330, 4);
        } else coinLine(o, cx - 100, 400, cx + 100, 400, 4);
        return range * 2 + 60;
      },
      puffer(x, o) {
        const y = rnd(170, 370), cx = x + 50;
        o.obs.push({ k: 'puffer', x: cx, y, per: rnd(2.4, 3.2) / tempo, ph: R() });
        for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.5; o.coins.push({ x: cx + Math.cos(a) * 100, y: y + Math.sin(a) * 100 }); }
        return 100;
      },
      eel(x, o) {
        const len = rnd(200, 290), ph = R();
        o.obs.push({ k: 'eel', x: x + 20, len, per: rnd(3.0, 3.8) / tempo, ph });
        let w = 40;
        if (n >= 8 && R() < 0.5) {
          const len2 = rnd(200, 290);
          o.obs.push({ k: 'eel', x: x + 190, len: len2, per: rnd(3.0, 3.8) / tempo, ph: (ph + 0.5) % 1 });
          w = 210;
        }
        coinLine(o, x - 20, SAND - len - 80, x + w, SAND - len - 80, 3);
        return w;
      },
      current(x, o) {
        const w = rnd(380, 480), dir = R() < 0.5 ? -1 : 1, f = n >= 8 ? 170 : 140;
        o.obs.push({ k: 'current', x, w, dir, f });
        for (let ux = x + 60; ux < x + w - 20; ux += 120) o.obs.push({ k: 'urchin', x: ux, y: dir > 0 ? 468 : 74, r: 22 });
        for (let i = 0; i < 6; i++) o.coins.push({ x: x + 40 + i * (w - 80) / 5, y: 270 + Math.sin(i) * 50 });
        return w;
      },
      fish(x, o) {
        const y = rnd(110, 430), v = 320 * tempo, X = x + 40;
        const tm = (X - START_X) / L.speed;                  // when Isabella (at START_X) reaches X
        const t0 = tm - (FISH_LEAD - START_X) / (v + L.speed);
        o.obs.push({ k: 'fish', y, v, t0, x0: L.speed * t0 + FISH_LEAD, X });
        const yc = y < 270 ? y + 170 : y - 170;
        coinLine(o, x - 40, yc, x + 120, yc, 4);
        return 80;
      },
      slalom(x, o) {
        const w = 80, g = L.gate, lo = TOP + g / 2 + 40, hi = FLOOR - g / 2 - 30, mid = (lo + hi) / 2;
        const up = R() < 0.5, dx = rnd(210, 260);
        const ys2 = [up ? rnd(lo, mid - 20) : rnd(mid + 20, hi), up ? rnd(mid + 20, hi) : rnd(lo, mid - 20)];
        ys2.forEach((gy, i) => {
          const cx = x + w / 2 + i * dx;
          o.obs.push({ k: 'rock', x: cx, w, h: gy - g / 2, top: true });
          o.obs.push({ k: 'rock', x: cx, w, h: SAND - (gy + g / 2), top: false });
        });
        coinLine(o, x + w / 2, ys2[0], x + w / 2 + dx, ys2[1], 5);
        return w + dx;
      },
      rockJelly(x, o) {
        const w = rnd(75, 95), h = rnd(150, 210), cx = x + w / 2, top = SAND - h;
        o.obs.push({ k: 'rock', x: cx, w, h, top: false });
        const room = top - TOP;
        o.obs.push({ k: 'jelly', x: cx + 110, y: TOP + room / 2, amp: Math.max(30, room / 2 - 70), w: rnd(1.1, 1.4) * tempo, ph: rnd(0, TAU) });
        coinLine(o, cx - 60, top - 50, cx + 30, top - 50, 3);
        return w + 140;
      },
      tunnel(x, o) {
        const k = 4, w = 70, sp = 165, g = L.gate + 25, A = 85, ph = rnd(0, TAU);
        const lo = TOP + g / 2 + 40, hi = FLOOR - g / 2 - 30, mid = (lo + hi) / 2;
        for (let i = 0; i < k; i++) {
          const gy = clamp(mid + A * Math.sin(ph + i * 1.0), lo, hi), cx = x + w / 2 + i * sp;
          o.obs.push({ k: 'rock', x: cx, w, h: gy - g / 2, top: true });
          o.obs.push({ k: 'rock', x: cx, w, h: SAND - (gy + g / 2), top: false });
          o.coins.push({ x: cx, y: gy });
          if (i < k - 1) o.coins.push({ x: cx + sp / 2, y: clamp(mid + A * Math.sin(ph + i + 0.5), lo, hi) });
        }
        return w + sp * (k - 1);
      },
      pufferPair(x, o) {
        const per = rnd(2.6, 3.0) / tempo, ph = R(), y1 = rnd(150, 230), y2 = rnd(320, 400);
        o.obs.push({ k: 'puffer', x: x + 50, y: y1, per, ph });
        o.obs.push({ k: 'puffer', x: x + 200, y: y2, per, ph: (ph + 0.5) % 1 });
        coinLine(o, x, 270, x + 250, 270, 5);
        return 250;
      },
      // ---- world 2 ----
      mgate(x, o) {
        const w = 80, g = L.gate + 12, lo = TOP + g / 2 + 30, hi = FLOOR - g / 2 - 25;
        const y0 = (lo + hi) / 2, amp = Math.min(rnd(70, 110), (hi - lo) / 2), om = rnd(0.9, 1.25) * tempo, ph = rnd(0, TAU);
        const twin = n >= 16 && R() < 0.5, dx = twin ? 240 : 0;
        o.obs.push({ k: 'mgate', x: x + w / 2, w, g, y0, amp, om, ph });
        if (twin) o.obs.push({ k: 'mgate', x: x + w / 2 + dx, w, g, y0, amp, om, ph: ph + Math.PI });
        coinLine(o, x - 110, y0, x - 50, y0, 2);
        coinLine(o, x + w + dx + 50, y0, x + w + dx + 110, y0, 2);
        return w + dx;
      },
      wheel(x, o) {
        const Lr = rnd(115, 150), y = rnd(225, 315), arms = n >= 20 && R() < 0.5 ? 3 : 2;
        const om = rnd(0.85, 1.15) * tempo * (R() < 0.5 ? 1 : -1), ph = rnd(0, TAU), cx = x + Lr + 20;
        o.obs.push({ k: 'wheel', x: cx, y, L: Lr, nu: 4, arms, om, ph });
        coinLine(o, cx - Lr - 75, y, cx - Lr - 45, y, 2);
        coinLine(o, cx + Lr + 45, y, cx + Lr + 75, y, 2);
        if (y - Lr - 46 > TOP + 6) coinLine(o, cx - 60, y - Lr - 46, cx + 60, y - Lr - 46, 3); // skirting the top edge
        return 2 * Lr + 40;
      },
      spinPair(x, o) {
        const Lr = rnd(110, 135), y1 = rnd(215, 250), y2 = rnd(290, 325), om = rnd(0.9, 1.15) * tempo, ph = rnd(0, TAU);
        const c1 = x + Lr + 20, c2 = c1 + 2 * Lr + 70;
        o.obs.push({ k: 'wheel', x: c1, y: y1, L: Lr, nu: 4, arms: 2, om, ph });
        o.obs.push({ k: 'wheel', x: c2, y: y2, L: Lr, nu: 4, arms: 2, om: -om, ph: ph + Math.PI / 2 });
        coinLine(o, c1 + Lr + 22, (y1 + y2) / 2, c2 - Lr - 22, (y1 + y2) / 2, 2);
        return 4 * Lr + 110;
      },
      anchor(x, o) {
        const per = rnd(5.2, 6.0) / Math.sqrt(tempo), ph = R(), two = n >= 17 && R() < 0.5;
        o.obs.push({ k: 'anchor', x: x + 30, per, ph });
        if (two) o.obs.push({ k: 'anchor', x: x + 180, per, ph: (ph + 0.5) % 1 });
        const w = two ? 210 : 60;
        coinLine(o, x - 70, 270, x - 30, 270, 2);
        coinLine(o, x + w + 30, 270, x + w + 70, 270, 2);
        return w;
      },
      school(x, o) {
        const v = 330 * tempo, X = x + 40, cnt = n >= 17 ? 3 : 2, ys = [];
        for (let i = 0; i < cnt; i++) {
          let y = rnd(100, 440);
          if (i && Math.abs(y - ys[i - 1]) < 100) y = ys[i - 1] < 270 ? ys[i - 1] + 150 : ys[i - 1] - 150;
          ys.push(y);
          const tm = (X - START_X) / L.speed + i * 0.55;
          const t0 = tm - (FISH_LEAD - START_X) / (v + L.speed);
          o.obs.push({ k: 'fish', y, v, t0, x0: L.speed * t0 + FISH_LEAD, X });
        }
        coinLine(o, x - 60, 270, x + 140, 270, 4);
        return 80;
      },
      eelRow(x, o) {
        const per = rnd(2.6, 3.1) / tempo, ph = R(), sp = 150, roof = n >= 15 && R() < 0.5;
        let maxLen = 0;
        for (let i = 0; i < 3; i++) {
          const len = roof ? rnd(200, 250) : rnd(230, 320);
          maxLen = Math.max(maxLen, len);
          o.obs.push({ k: 'eel', x: x + 20 + i * sp, len, per, ph: (ph + i * 0.3) % 1 });
        }
        if (roof) for (let i = 0; i < 2; i++) o.obs.push({ k: 'rock', x: x + 20 + sp / 2 + i * sp, w: 70, h: rnd(115, 150), top: true });
        else coinLine(o, x, SAND - maxLen - 75, x + 2 * sp + 40, SAND - maxLen - 75, 4);
        return 2 * sp + 40;
      },
      jellyWall(x, o) {
        const amp = rnd(45, 70), w = rnd(1.0, 1.3) * tempo, ph = rnd(0, TAU), y0 = rnd(120, 150);
        const offs = R() < 0.5 ? [0, 90, 280] : [0, 190, 280];
        for (const d of offs) o.obs.push({ k: 'jelly', x: x + 30, y: y0 + d, amp, w, ph });
        const door = offs[1] === 90 ? y0 + 193 : y0 + 103;
        coinLine(o, x - 100, door, x - 45, door, 2);
        return 60;
      },
      longTunnel(x, o) {
        const k = 6, w = 70, sp = 158, g = L.gate + 18, A = 110, f = rnd(0.75, 0.95), ph = rnd(0, TAU);
        const lo = TOP + g / 2 + 30, hi = FLOOR - g / 2 - 25, mid = (lo + hi) / 2;
        for (let i = 0; i < k; i++) {
          const gy = clamp(mid + A * Math.sin(ph + i * f), lo, hi), cx = x + w / 2 + i * sp;
          o.obs.push({ k: 'rock', x: cx, w, h: gy - g / 2, top: true });
          o.obs.push({ k: 'rock', x: cx, w, h: SAND - (gy + g / 2), top: false });
          o.coins.push({ x: cx, y: gy });
        }
        return w + sp * (k - 1);
      },
      coins(x, o) {
        const yc = rnd(200, 340);
        for (let i = 0; i < 9; i++) o.coins.push({ x: x + i * 42, y: yc + Math.sin(i * 0.8) * 80 });
        return 340;
      },
    };

    const lev = { n, cfg: L, obs: [], coins: [], hearts: [], patterns: {} };
    const cps = L.cps === 3 ? [0.26, 0.5, 0.76].map((f) => Math.round(L.len * f)) : [Math.round(L.len * 0.34), Math.round(L.len * 0.67)];
    const keyX = Math.round(L.len * (L.cps === 3 ? 0.63 : 0.52));
    const zones = [...cps, keyX].map((c) => [c - 220, c + 220]);

    coinLine(lev, 480, 270, 760, 230, 5); // a friendly first trail
    let x = 1000, last = null;
    while (x < L.len - 200) {
      const kinds = L.kinds.filter((k) => k !== last);
      const weights = kinds.map((k) => (k === L.feature ? (n >= 11 ? 4 : 2.2) : k === 'coins' ? (n >= 11 ? 0.2 : n >= 6 ? 0.3 : 0.5) : !L.hard ? 1 : HARD.has(k) ? (L.hard === 2 ? 2.4 : 1.6) : L.hard === 2 ? 0.6 : 1));
      let u = R() * weights.reduce((a, b) => a + b, 0), kind = kinds[0];
      for (let i = 0; i < kinds.length; i++) { u -= weights[i]; if (u <= 0) { kind = kinds[i]; break; } }
      const tmp = { obs: [], coins: [] };
      const w = P[kind](x, tmp);
      const hitZone = zones.find(([a, b]) => x + w + 90 > a && x - 90 < b);
      if (hitZone) { x = hitZone[1] + 120; continue; }
      lev.obs.push(...tmp.obs); lev.coins.push(...tmp.coins);
      lev.patterns[kind] = (lev.patterns[kind] || 0) + 1;
      last = kind;
      x += w + rnd(L.gap[0], L.gap[1]);
    }

    // static extents for quick rejects
    for (const o of lev.obs) {
      if (o.k === 'rock' || o.k === 'mgate') { o.x0 = o.x - o.w / 2; o.x1 = o.x + o.w / 2; }
      else if (o.k === 'wheel') { o.x0 = o.x - o.L - 20; o.x1 = o.x + o.L + 20; }
      else if (o.k === 'crab') { o.x0 = o.x - o.range - 30; o.x1 = o.x + o.range + 30; }
      else if (o.k === 'puffer') { o.x0 = o.x - 50; o.x1 = o.x + 50; }
      else if (o.k === 'current') { o.x0 = o.x; o.x1 = o.x + o.w; }
      else if (o.k !== 'fish') { o.x0 = o.x - 40; o.x1 = o.x + 40; }
    }

    lev.cps = cps.map((cx) => ({ x: cx }));
    lev.key = { x: keyX, y: rnd(150, 390) };
    coinLine(lev, keyX - 260, 270, keyX - 90, lev.key.y, 4);
    const heartAt = L.cps === 3 ? cps.map((c) => c + 120) : [cps[0] + 120, keyX + 140, cps[1] + 120];
    const order = L.hearts >= 3 ? [0, 1, 2] : L.hearts === 2 ? (L.cps === 3 ? [0, 1] : [0, 2]) : L.hearts === 1 ? (L.cps === 3 ? [1] : [2]) : [];
    for (const i of order) lev.hearts.push({ x: heartAt[i], y: 200 });

    lev.len = L.len;
    lev.chestX = L.len + 700;
    for (let i = 0; i < 7; i++) lev.coins.push({ x: L.len + 120 + i * 45, y: 270 - Math.sin((i / 6) * Math.PI) * 110 });

    // drop coins that sit inside a static obstacle or off the swimmable band
    const isStaticHit = (cx, cy) => lev.obs.some((o) => {
      if (o.k === 'rock') return cx > o.x0 - 22 && cx < o.x1 + 22 && (o.top ? cy < o.h + 22 : cy > SAND - o.h - 22);
      if (o.k === 'urchin') return Math.hypot(cx - o.x, cy - o.y) < o.r + 34;
      return false;
    });
    lev.coins = lev.coins
      .map((c) => ({ x: c.x, y: clamp(c.y, TOP + 10, FLOOR - 8) }))
      .filter((c) => !isStaticHit(c.x, c.y));

    // collision buckets (see hitTest)
    lev.fish = lev.obs.filter((o) => o.k === 'fish');
    lev.buckets = [];
    for (const o of lev.obs) {
      if (o.k === 'fish' || o.k === 'current') continue;
      for (let b = Math.floor((o.x0 - 100) / BUCKET); b <= Math.floor((o.x1 + 100) / BUCKET); b++) (lev.buckets[b] || (lev.buckets[b] = [])).push(o);
    }
    return lev;
  }

  // A clear y near the middle at time t and world x px (for respawns and the wandering key).
  function safeY(lev, t, px) {
    let best = 270, bestScore = -1;
    for (let y = 90; y <= 450; y += 10) {
      let ok = 0;
      for (const dt of [0, 0.4, 0.8, 1.2]) if (!hitTest(lev, t + dt, px, y, 22)) ok++;
      const score = ok * 1000 - Math.abs(y - 270);
      if (score > bestScore) { bestScore = score; best = y; }
    }
    return best;
  }

  // ---------- one play-through of a level ----------
  class Game {
    constructor(n, viewW) {
      this.n = n;
      this.lev = buildLevel(n);
      this.ev = [];
      this.setView(viewW || 1200);
      this.start();
    }
    setView(vw) { this.VW = vw; this.camStop = Math.max(0, this.lev.chestX + 250 - vw); }
    get speed() { return this.lev.cfg.speed; }
    camAt(t) { return Math.min(this.speed * t, this.camStop); }
    get cam() { return this.camAt(this.t); }
    get wx() { return this.cam + this.sx; }
    get progress() { return clamp(this.wx / this.lev.chestX, 0, 1); }

    start() {
      const lv = this.lev;
      this.t = 0; this.state = 'play'; this.st = 0;
      this.sx = START_X; this.y = 270; this.vx = 0; this.vy = 0; this.kx = 0; this.ky = 0;
      this.hearts = 3; this.bumps = 0; this.respawns = 0; this.inv = 0; this.hasKey = false;
      this.got = new Uint8Array(lv.coins.length); this.coinCount = 0;
      this.cx = lv.coins.map((c) => c.x); this.cy = lv.coins.map((c) => c.y);
      this.heartGot = new Uint8Array(lv.hearts.length);
      this.keyX = lv.key.x; this.keyY = lv.key.y;
      this.cp = -1; this.lockedCool = 0;
      this.snap = this.snapshot(0);
    }
    snapshot(t) { return { t, hasKey: this.hasKey, got: this.got.slice(), coinCount: this.coinCount, heartGot: this.heartGot.slice() }; }
    emit(type, x, y) { this.ev.push({ type, x, y }); }

    step(dt, target) {
      this.st += dt;
      if (this.state === 'play') this.stepPlay(dt, target);
      else if (this.state === 'lost') { if (this.st > 1.6) this.respawn(); }
      else if (this.state === 'win') {
        const tx = this.lev.chestX - this.cam - 10, ty = SAND - 175;
        const k = Math.min(1, dt * 2.5);
        this.sx += (tx - this.sx) * k; this.y += (ty - this.y) * k;
        this.t += dt;
      }
    }

    stepPlay(dt, target) {
      this.t += dt;
      const cam = this.cam;
      let dvx = 0, dvy = 0;
      if (target) {
        const tx = clamp(target.x, 40, this.VW - 70), ty = clamp(target.y, TOP, FLOOR);
        const dx = tx - this.sx, dy = ty - this.y, d = Math.hypot(dx, dy);
        if (d > 1) { const sp = Math.min(SWIM, d * 6); dvx = (dx / d) * sp; dvy = (dy / d) * sp; }
      }
      const k = 1 - Math.exp(-dt * 14);
      this.vx += (dvx - this.vx) * k; this.vy += (dvy - this.vy) * k;
      let fy = 0;
      const wx0 = cam + this.sx;
      for (const o of this.lev.obs) if (o.k === 'current' && wx0 > o.x && wx0 < o.x + o.w) fy = o.dir * o.f;
      this.sx += (this.vx + this.kx) * dt;
      this.y += (this.vy + this.ky + fy) * dt;
      const decay = Math.exp(-dt * 6); this.kx *= decay; this.ky *= decay;
      this.sx = clamp(this.sx, 40, this.VW - 70);
      this.y = clamp(this.y, TOP, FLOOR);
      const wx = cam + this.sx, y = this.y;

      if (this.inv > 0) this.inv -= dt;
      else {
        const hit = hitTest(this.lev, this.t, wx, y, 0);
        if (hit) {
          this.hearts--; this.bumps++; this.inv = 1.6;
          this.kx = -240; this.ky = awayY(hit, this.t, y) * 230;
          this.emit('hit', wx, y);
          if (this.hearts <= 0) { this.state = 'lost'; this.st = 0; this.emit('lost', wx, y); return; }
        }
      }

      // coins (with a gentle magnet)
      const lv = this.lev;
      for (let i = 0; i < lv.coins.length; i++) {
        if (this.got[i]) continue;
        const dx = wx + 12 - this.cx[i];
        if (dx > 140 || dx < -140) continue;
        const dy = y - this.cy[i], d = Math.hypot(dx, dy);
        if (d < 38) { this.got[i] = 1; this.coinCount++; this.emit('coin', this.cx[i], this.cy[i]); }
        else if (d < 85) { const m = (420 * dt) / d; this.cx[i] += dx * m; this.cy[i] += dy * m; }
      }
      for (let i = 0; i < lv.hearts.length; i++) {
        if (this.heartGot[i]) continue;
        const h = lv.hearts[i];
        if (Math.hypot(wx - h.x, y - h.y) < 48) {
          this.heartGot[i] = 1;
          if (this.hearts < 3) this.hearts++;
          this.emit('heart', h.x, h.y);
        }
      }
      if (!this.hasKey) {
        const dx = wx + 12 - this.keyX, dy = y - this.keyY, d = Math.hypot(dx, dy);
        if (d < 56) { this.hasKey = true; this.emit('key', this.keyX, this.keyY); }
        else if (d < 140) { const m = (360 * dt) / d; this.keyX += dx * m; this.keyY += dy * m; }
        else if (this.keyX < cam - 50) {
          // missed it: the key floats back in ahead of her
          this.keyX = Math.min(cam + this.VW + 90, lv.chestX - 230); // never past the chest
          this.keyY = safeY(lv, this.t + 2, this.keyX);
          this.emit('keyback', this.keyX, this.keyY);
        }
      }
      for (let i = this.cp + 1; i < lv.cps.length; i++) {
        if (wx >= lv.cps[i].x) {
          this.cp = i;
          this.snap = this.snapshot((lv.cps[i].x - START_X) / this.speed);
          this.emit('checkpoint', lv.cps[i].x, SAND - 30);
        }
      }
      if (this.lockedCool > 0) this.lockedCool -= dt;
      if (Math.abs(wx - lv.chestX) < 95 && y > SAND - 190) {
        if (this.hasKey) { this.state = 'win'; this.st = 0; this.emit('win', lv.chestX, SAND - 40); }
        else if (this.lockedCool <= 0) { this.lockedCool = 2; this.emit('locked', lv.chestX, SAND - 40); }
      }
    }

    respawn() {
      const s = this.snap, lv = this.lev;
      this.t = s.t; this.hasKey = s.hasKey; this.got = s.got.slice(); this.coinCount = s.coinCount; this.heartGot = s.heartGot.slice();
      this.cx = lv.coins.map((c) => c.x); this.cy = lv.coins.map((c) => c.y);
      this.keyX = lv.key.x; this.keyY = lv.key.y;
      this.sx = START_X; this.vx = this.vy = this.kx = this.ky = 0;
      this.y = safeY(lv, this.t, this.cam + START_X);
      this.hearts = 3; this.inv = 2.2; this.respawns++;
      this.state = 'play'; this.st = 0;
      this.emit('respawn', this.wx, this.y);
    }

    stars() {
      let s = 1;
      if (this.coinCount >= Math.ceil(this.lev.coins.length * 0.6)) s++;
      if (this.respawns === 0 && this.bumps <= 1) s++;
      return s;
    }
  }

  const api = {
    H, TOP, FLOOR, SAND, SWIM, START_X, LEVELS, TAU,
    mulberry32, clamp, lerp, smooth,
    buildLevel, hitTest, shapes, bodyCircles, safeY,
    jellyY, pufferR, crabX, eelExt, eelWarn, eelPts, fishX, mgateY, wheelPts, anchorY, anchorWarn,
    Game,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IsabellaCore = api;
})(typeof self !== 'undefined' ? self : this);
