/* Bubble Party: screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js,
 * sound in sound.js.
 * Bubbles drift up from the seabed, each carrying a sea creature. A finger drags a bubble down and lets
 * go over the creature's own icon on the sand: the bubble glides onto it and pops, the creature dances
 * on its icon, then hops into the counting tray and a big numeral counts it, 1 to 10. Ten gather into a
 * gold coin that flies up to the coin row. When the level's coins are all in, the treasure chest pushes
 * up out of the sand and opens. Grumpy creatures float off by themselves (a tap pops one away); dropping
 * one on the sand gives back a coin, gently. Several fingers can drag at once. No timers, no words. */
(function () {
  'use strict';
  const A = PopArt, S = PopSound, L = PopLogic;
  const { SCENES, FLOOR } = A;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, SAVE_KEY = 'game.pop.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const LAND_T = 0.7;     // a saved creature dances on its icon this long...
  const FLY_T = 0.6;      // ...then hops into its place in the tray
  const SNAP_T = 0.16;    // a bubble let go near its icon glides onto it (the magnetic snap)
  const GRAB_SLOP = 34;   // a finger grabs a bubble from this far outside its glass (world units)
  const SNAP = 64;        // a bubble let go within this of its own icon's edge snaps home
  const TAP_MOVE = 14, TAP_MS = 400;   // a press that barely moves is a tap
  const GATHER_T = 0.45, MERGE_T = 0.5, COIN_FLY = 0.85;   // ten friends hop, gather into a coin, and it flies up
  const HINT_T = 2.4;     // one showing of the "drag it home" hand
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const smooth = (u) => u * u * (3 - 2 * u);
  const easeOutBack = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

  // ---- saving: Android SharedPreferences (window.IsabellaStore) in the app, localStorage in a browser ----
  const store = {
    get(k) {
      try { if (window.IsabellaStore) return window.IsabellaStore.get(k); } catch (e) { /* fall through */ }
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { if (window.IsabellaStore) { window.IsabellaStore.set(k, v); return; } } catch (e) { /* fall through */ }
      try { localStorage.setItem(k, v); } catch (e) { /* nothing to do */ }
    },
  };
  // sound follows the main game's setting
  function readMuted() { try { return !!JSON.parse(store.get('isabella.save') || '{}').muted; } catch (e) { return false; } }
  // an old (v1) save on a phone becomes a v2 save here; it is written back on the first change
  let save = L.migrate(store.get(SAVE_KEY));

  // ---- state ----
  const canvas = $('c'), homeBtn = $('home'), homeDot = homeBtn.querySelector('.btn');
  A.init(canvas);
  let muted = readMuted();
  S.setMuted(muted);
  let screen = 'levels';   // levels | play | results
  let run = null;          // the level being played
  let clock = 0, last = 0, timeScale = 1, nextId = 1, homeZone = null;
  const counters = { grabs: 0, drops: 0, saves: 0, wrong: 0, floats: 0, grumpDrops: 0, grumpTaps: 0, cuteTaps: 0, iconTaps: 0,
    coinsEarned: 0, coinsLost: 0, coinsLanded: 0, chests: 0, landed: 0, misses: 0, isabellaTaps: 0, floated: 0, persists: 0,
    downs: 0, maxPointers: 0, pointerTypes: {}, levelsStarted: 0, countLog: [] };   // countLog: [number counted, game time], the last 30

  function persist() {
    if (run && !run.rules.done) {
      const snap = run.rules.snapshot();
      if (snap.coins || snap.tray.length || snap.grumps) save.runs[run.n] = snap; else delete save.runs[run.n];
    }
    store.set(SAVE_KEY, JSON.stringify(save));
    counters.persists++;
  }

  // ---- screens ----
  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  function goLevels() {
    releaseAll();
    if (run && !run.rules.done) persist();
    screen = 'levels'; run = null;
    const grid = $('grid'); grid.innerHTML = '';
    for (let n = 1; n <= NLEV; n++) {
      const sc = SCENES[L.LEVELS[n - 1].scene], locked = n > save.unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === save.unlocked && !save.stars[n - 1] ? ' next' : '');
      b.dataset.level = n;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65), ${sc.top} 45%, ${sc.bot})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < save.stars[n - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        S.init();
        if (locked) { S.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        S.click(); startLevel(n);
      });
      grid.appendChild(b);
    }
    $('starCount').textContent = `${save.stars.reduce((a, b) => a + b, 0)}/${NLEV * 3}`;
    show('levels');
    S.setKey(0); S.startMusic(9, 0);
    A.keepScenes(0, 0);
  }

  // ---- a level ----
  function startLevel(n, fresh) {
    n = clamp(Math.floor(n) || 1, 1, NLEV);
    releaseAll();
    if (run && run.n !== n && !run.rules.done) persist();   // keep the other level's coins for later
    const cfg = L.LEVELS[n - 1];
    if (fresh) delete save.runs[n];
    const rules = new L.Run(n, save.runs[n]);
    const tray = new Array(L.TRAY).fill(null);
    rules.tray.forEach((kind, i) => { tray[i] = { kind, col: L.colourOf(n, kind), hop: -1, hopH: 0, seed: Math.random() * 10 }; });
    run = {
      n, cfg, rules, phase: 'play', pt: 0,
      icons: cfg.kinds.map(([kind, col]) => ({ kind, col, x: 0, y: 0, r: 0, seed: Math.random() * 10, hop: -1, shake: -1, glowT: -1, hover: 0, hoverT: 0, happy: false, hide: 0, sitting: 0 })),
      bubbles: [], friends: [], leavers: [], numerals: [], flyCoins: [], lostCoins: [], timers: [],
      tray, visBatch: rules.trays, hud: rules.coins, owed: 0, debt: 0, gather: null, flyGap: 0,
      chest: null, popQueue: [], popT: 0,
      nextSpawn: 0.8, lastKind: '', lastGrumpy: false, lastSpawnX: -1e9,
      idle: 0, hint: null, hintCool: 0, everSaved: rules.saves > 0 || rules.coins > 0 || rules.tray.length > 0,
      isa: null, nextIsa: rnd(16, 26), results: false, stars: 0, tremble: false,
    };
    layout();
    screen = 'play'; show(null);
    const sc = SCENES[cfg.scene];
    S.setKey(sc.key); S.startMusic(cfg.scene, sc.key);
    A.keepScenes(cfg.scene, cfg.scene);
    starters();
    counters.levelsStarted++;
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }
  // the icons spread along the sand: further apart when there are few, never smaller than the screen allows
  function layout() {
    if (!run) return;
    const n = run.icons.length, sp = Math.min(320, (A.VW - 80) / n), r = Math.min(A.PAD_R, sp * 0.42);
    run.icons.forEach((ic, i) => { ic.x = A.VW / 2 + (i - (n - 1) / 2) * sp; ic.y = A.PAD_Y; ic.r = r; });
  }
  const iconOf = (kind) => (run ? run.icons.find((ic) => ic.kind === kind) : null) || null;
  const maxOnScreen = () => Math.min(run.cfg.bubbles, Math.max(2, Math.floor(A.VW / 190)));
  const shown = (b) => (b.grow < 1 ? b.grow : 1);

  // ---- bubbles ----
  function makeBubble(o) {
    const kind = o.kind, grumpy = L.isGrumpy(kind);
    const b = { id: nextId++, kind, col: L.colourOf(run.n, kind), grumpy, x: o.x, x0: o.x, y: o.y, r: rnd(60, 66),
      vy: run.cfg.speed * rnd(0.88, 1.12), vx: 0, kick: 0, ph: Math.random() * TAU, om: rnd(0.5, 0.8), amp: rnd(8, 16),
      seed: Math.random() * 10, flip: Math.random() < 0.5, grow: o.grow ? 0 : 1, held: null, lift: 0, front: !!o.front, jig: -1, snap: null };
    b.x0 = o.x - Math.sin(b.ph + clock * b.om) * b.amp;   // so the wobble starts from exactly here
    run.bubbles.push(b);
    return b;
  }
  function nextKind(friendsOnly) {
    const st = { grumpsOnScreen: friendsOnly ? Infinity : run.bubbles.filter((b) => b.grumpy).length, lastWasGrumpy: run.lastGrumpy, lastKind: run.lastKind };
    const pick = L.pickSpawn(run.cfg, st, Math.random);
    run.lastGrumpy = pick.grumpy;
    if (!pick.grumpy) run.lastKind = pick.kind;
    return pick.kind;
  }
  // rise from behind the sand at a spot with room around it
  function spawnOne() {
    const r = 66, lo = r + 24, hi = Math.max(lo + 1, A.VW - r - 24);
    let best = (lo + hi) / 2, bestD = -1e9;
    for (let k = 0; k < 16; k++) {
      const x = rnd(lo, hi);
      let d = Math.abs(x - run.lastSpawnX) * 0.5;
      for (const b of run.bubbles) if (b.y > FLOOR - 160) d = Math.min(d, Math.abs(b.x0 - x) - b.r);
      if (d > bestD) { bestD = d; best = x; }
    }
    run.lastSpawnX = best;
    return makeBubble({ x: best, y: FLOOR + r + 8, kind: nextKind(false) });
  }
  // friends to carry straight away
  function starters() {
    const n = Math.min(3, maxOnScreen()), ys = [215, 150, 240];
    for (let i = 0; i < n; i++) makeBubble({ x: A.VW * (0.3 + i * 0.2) + rnd(-25, 25), y: ys[i], kind: nextKind(true), grow: true });
  }
  function removeBubble(b) { const i = run.bubbles.indexOf(b); if (i >= 0) run.bubbles.splice(i, 1); }
  function stepBubbles(dt) {
    const bs = run.bubbles;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (b.grow < 1) b.grow = Math.min(1, b.grow + dt * 2.6);
      if (b.jig >= 0 && (b.jig += dt) > 0.6) b.jig = -1;
      b.lift += ((b.held != null ? 1 : 0) - b.lift) * Math.min(1, dt * 12);
      if (b.held != null) continue;   // in a finger: it goes where the finger goes
      if (b.snap) {
        const s = b.snap, u = smooth(clamp((s.t += dt) / SNAP_T, 0, 1));
        b.x = s.x0 + (s.ic.x - s.x0) * u; b.y = s.y0 + (s.ic.y - s.y0) * u;
        if (s.t >= SNAP_T) { bs.splice(i, 1); popAtIcon(b); }
        continue;
      }
      b.y -= (b.vy * (b.y < 150 ? 0.7 : 1) + b.kick) * dt;
      b.kick *= Math.exp(-dt * 2.5);
      b.x0 += b.vx * dt; b.vx *= Math.exp(-dt * 2.5);
      b.x = b.x0 + Math.sin(b.ph + clock * b.om) * b.amp;
      if (b.front && b.y + b.r < FLOOR - 12) b.front = false;
      if (b.y + b.r < -12) { bs.splice(i, 1); counters.floated++; }   // floated away: nothing lost, more are coming
    }
    // bubbles nudge each other apart instead of overlapping; a held or snapping bubble stands firm
    const k = Math.min(1, dt * 6);
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const p = bs[i], q = bs[j], pf = p.held != null || !!p.snap, qf = q.held != null || !!q.snap;
        if (pf && qf) continue;
        const dx = q.x - p.x, dy = q.y - p.y, min = p.r + q.r + 8, d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1, push = (min - d) * 0.5 * k, side = dx >= 0 ? 1 : -1;
        if (pf) q.x0 += side * push * 1.6;
        else if (qf) p.x0 -= side * push * 1.6;
        else { p.x0 -= (dx / d || 1) * push; q.x0 += (dx / d || 1) * push; (p.y > q.y ? p : q).y += Math.abs(dy / d) * push * 0.6; }
      }
    }
    // stay on screen and clear of the home button
    for (const b of bs) {
      if (b.held != null || b.snap) continue;
      const lo = b.r + 6 + b.amp, hi = A.VW - b.r - 6 - b.amp;
      if (b.x0 < lo) b.x0 += (lo - b.x0) * k; else if (b.x0 > hi) b.x0 -= (b.x0 - hi) * k;
      if (homeZone) {
        const dx = b.x - homeZone.x, dy = b.y - homeZone.y, min = b.r + homeZone.r + 18, d = Math.hypot(dx, dy);
        if (d < min) b.x0 += (min - d) * Math.min(1, dt * 5);
      }
    }
  }

  // ---- a drop: the one place the rules are applied (real fingers and window.__popDebug.drop both come here) ----
  function dropBubble(b, where) {
    const res = run.rules.drop(b.kind, where);
    counters.drops++;
    if (res.type === 'saved') {
      b.snap = { ic: iconOf(b.kind), t: 0, x0: b.x, y0: b.y, res };
      b.front = true;
      counters.saves++;
      save.total++; save.kinds[b.kind] = (save.kinds[b.kind] || 0) + 1;
      if (res.coin) { run.owed++; save.coins++; counters.coinsEarned++; }
      run.idle = 0; run.hint = null; run.everSaved = true;
      if (res.chest) wonLevel(); else persist();
    } else if (res.type === 'grump') {
      grumpOnSand(b, res);
      persist();
    } else if (res.type === 'wrong') {
      bounceBack(b, where);
    } else {
      b.kick = 90; counters.floats++;   // let go in the water (or the chest is already coming): it floats on
    }
    return res;
  }
  // the bubble has glided onto its icon: it pops, and the creature dances on its icon
  function popAtIcon(b) {
    const s = b.snap, ic = s.ic, res = s.res;
    A.burst('pop', ic.x, ic.y - 6, b.r);
    A.burst('land', ic.x, ic.y, ic.r * 0.9, b.col === 'rainbow' ? '#ffd93d' : b.col);
    S.save(clamp(res.slot / 9, 0, 1));
    ic.glowT = 0; ic.sitting++;
    // kept in counting order (bubbles that glide home in the same frame may pop in any order)
    const f = { kind: b.kind, col: b.col, ic, slot: res.slot, batch: res.batch, t: 0, state: 'land', seed: b.seed, x0: 0, y0: 0 };
    let at = run.friends.length;
    while (at > 0 && (run.friends[at - 1].batch > f.batch || (run.friends[at - 1].batch === f.batch && run.friends[at - 1].slot > f.slot))) at--;
    run.friends.splice(at, 0, f);
  }
  // a cute creature in the wrong place bounces gently back up; its own icon hops to say "here I am"
  function bounceBack(b, where) {
    b.kick = 300; b.jig = 0; b.vx = (Math.random() < 0.5 ? -1 : 1) * 40;
    S.boing(); counters.wrong++;
    const wrong = iconOf(where);
    if (wrong && wrong.kind !== b.kind) wrong.shake = 0;
    const home = iconOf(b.kind);
    if (home) { home.hop = 0; home.glowT = 0; }
  }
  // a grumpy creature dropped on the sand: it grumbles, stomps and swims off; a coin wobbles away
  function grumpOnSand(b, res) {
    removeBubble(b);
    A.burst('pop', b.x, b.y, b.r); S.pop(0.3, 'small');
    run.leavers.push({ mode: 'grump', kind: b.kind, col: b.col, x: b.x, y: clamp(b.y, FLOOR + 6, A.TRAY_Y - 40), sc: b.r * A.INSIDE * 1.15,
      t: 0, stomp: 1.0, huffT: 0.05, seed: b.seed, dir: b.x < A.VW / 2 ? -1 : 1 });
    S.grumble();
    counters.grumpDrops++;
    if (res.coinLost) loseCoin();
  }
  // Coins on show = coins in the rules, always: hud (in their rings) + owed (on the way) - debt (lost before they landed).
  function loseCoin() {
    counters.coinsLost++;
    if (run.hud > 0) {
      run.hud--;
      const sl = A.hudLayout(run.rules.target).slots[run.hud];
      run.lostCoins.push({ x: sl.x, y: sl.y, t: 0 });
      S.coinLost();
    } else run.debt++;   // the coin is still on its way: it will wobble away instead of landing
  }
  function tapBubble(b) {
    if (b.grumpy) {
      // a tap pops a grumpy bubble away, harmlessly; the grump huffs and swims off
      removeBubble(b);
      A.burst('pop', b.x, b.y, b.r); S.popAway(clamp(1 - b.y / FLOOR, 0, 1));
      run.leavers.push({ mode: 'grump', kind: b.kind, col: b.col, x: b.x, y: b.y, sc: b.r * A.INSIDE, t: 0, stomp: 0.35, huffT: 0.02, seed: b.seed, dir: b.x < A.VW / 2 ? -1 : 1 });
      counters.grumpTaps++;
      return;
    }
    // a cute bubble does not pop: it jiggles, and the hand shows where it lives
    b.jig = 0; b.kick = 50; S.boop(); counters.cuteTaps++;
    if (keepHint(b)) run.hint = { id: b.id, t: 0, n: 2 };
  }

  // ---- saved friends: dance on the icon, hop into the tray, get counted ----
  function flyPos(f) {
    const u = smooth(clamp(f.t / FLY_T, 0, 1)), tx = A.trayX(f.slot), ty = A.TRAY_Y;
    return { x: f.x0 + (tx - f.x0) * u, y: f.y0 + (ty - f.y0) * u - Math.sin(u * Math.PI) * 70, u };
  }
  // Friends are kept in the order they were saved, so going through them forwards is counting order.
  function stepFriends(dt) {
    if (run.flyGap > 0) run.flyGap -= dt;
    const arrived = [];
    for (const f of run.friends) {
      f.t += dt;
      if (f.state === 'land') {
        // a friend from the next ten waits on its icon until the last ten have turned into their coin, and friends
        // ready at the same moment hop into the tray one after another, so the count always reads 1, 2, 3
        if (f.t >= LAND_T && f.batch === run.visBatch && !run.gather && run.flyGap <= 0) {
          f.state = 'fly'; f.t = 0; f.ic.sitting--; f.x0 = f.ic.x; f.y0 = f.ic.y - f.ic.r * 0.1; run.flyGap = 0.17;
        }
      } else if (f.t >= FLY_T) arrived.push(f);
      else if (Math.random() < dt * 30) { const p = flyPos(f); A.burst('twinkle', p.x, p.y, 12, '#fff8c0'); }
    }
    for (const f of arrived) { run.friends.splice(run.friends.indexOf(f), 1); arrive(f); }
  }
  const NUM = 104;
  const numHalf = (n) => NUM * (n >= 10 ? 0.74 : 0.43);
  const numX = (m) => clamp(A.trayX(m.slot), numHalf(m.n) + 6, A.VW - numHalf(m.n) - 6);
  // Big numerals stay a moment; when a new one would overlap an older one, the older one shrinks into its place now.
  function showNumeral(slot) {
    const m = { n: slot + 1, slot, t: 0 }, x = numX(m);
    for (const q of run.numerals) if (q.slot !== slot && q.t < 1.15 && Math.abs(numX(q) - x) < numHalf(q.n) + numHalf(m.n)) q.t = 1.15;
    const old = run.numerals.find((q) => q.slot === slot);
    if (old) old.t = Math.min(old.t, 0.32); else run.numerals.push(m);
  }
  function arrive(f) {
    run.tray[f.slot] = { kind: f.kind, col: f.col, hop: 0, hopH: 16, seed: f.seed };
    for (const m of run.tray) if (m && m.hop < 0) { m.hop = 0; m.hopH = 6; }   // everyone bounces hello
    showNumeral(f.slot);
    S.count(f.slot + 1);
    A.burst('land', A.trayX(f.slot), A.TRAY_Y, 20, A.NUMCOL[f.slot]);
    counters.landed++;
    counters.countLog.push([f.slot + 1, +clock.toFixed(3)]);
    if (counters.countLog.length > 30) counters.countLog.shift();
    if (run.tray.every(Boolean)) { run.gather = { t: 0, sang: false }; S.cheer(); for (const m of run.tray) { m.hop = 0; m.hopH = 18; } }
  }
  // ten friends hop together, then gather into one gold coin, which flies up to its ring
  function stepGather(dt) {
    const g = run.gather;
    if (!g) return;
    g.t += dt;
    if (!g.sang && g.t >= GATHER_T) { g.sang = true; S.gather(); }
    if (g.t >= GATHER_T + MERGE_T) {
      run.tray.fill(null); run.visBatch++; run.gather = null;
      const x = A.VW / 2, y = A.TRAY_Y - 6;
      run.flyCoins.push({ t: 0, x0: x, y0: y });
      A.burst('coin', x, y);
    }
  }
  const coinSlot = (k) => A.hudLayout(run.rules.target).slots[clamp(run.hud + k, 0, run.rules.target - 1)];
  // the k-th coin in flight arcs up from the tray to the k-th empty ring, shrinking as it goes
  function coinFlyPos(c, k) {
    const sl = coinSlot(k), u = smooth(clamp(c.t / COIN_FLY, 0, 1));
    return { x: c.x0 + (sl.x - c.x0) * u, y: c.y0 + (sl.y - c.y0) * u - Math.sin(u * Math.PI) * 90, r: 38 + (sl.r - 38) * u };
  }
  function stepCoins(dt) {
    for (let i = 0; i < run.flyCoins.length; i++) {
      const c = run.flyCoins[i];
      if (Math.random() < dt * 45) { const p = coinFlyPos(c, i); A.burst('twinkle', p.x, p.y, p.r * 0.8, Math.random() < 0.5 ? '#fff3a0' : '#ffd23f'); }
      if ((c.t += dt) < COIN_FLY) continue;
      const sl = coinSlot(i);
      run.flyCoins.splice(i--, 1);
      run.owed--;
      if (run.debt > 0) { run.debt--; run.lostCoins.push({ x: sl.x, y: sl.y, t: 0 }); S.coinLost(); }
      else { run.hud++; A.burst('coin', sl.x, sl.y); S.coin(); counters.coinsLanded++; }
    }
    for (let i = run.lostCoins.length - 1; i >= 0; i--) if ((run.lostCoins[i].t += dt) > 1.7) run.lostCoins.splice(i, 1);
  }
  function stepTray(dt) {
    for (const m of run.tray) if (m && m.hop >= 0 && (m.hop += dt) > 0.45) m.hop = -1;
  }
  function stepLeavers(dt) {
    for (let i = run.leavers.length - 1; i >= 0; i--) {
      const v = run.leavers[i];
      v.t += dt;
      if (v.mode === 'swim') {
        if (v.t > 0.35) { v.x += v.vx * dt; v.y += v.vy * dt; v.vy -= 20 * dt; }
      } else if (v.t > v.stomp) {
        v.x += v.dir * 250 * dt; v.y -= 55 * dt;   // off it swims, still cross
      } else if ((v.huffT -= dt) <= 0) {
        v.huffT = 0.3; A.burst('huff', v.x - v.dir * 8, v.y - v.sc * 34);
      }
      if (v.y < -100 || v.x < -170 || v.x > A.VW + 170 || v.t > 9) run.leavers.splice(i, 1);
    }
  }
  function swimAway(b) {
    const dir = b.x < A.VW / 2 ? -1 : 1;
    run.leavers.push({ mode: 'swim', kind: b.kind, col: b.col, x: b.x, y: b.y, sc: b.r * A.INSIDE, t: 0, seed: b.seed, vx: dir * rnd(150, 200), vy: rnd(-150, -100), dir });
  }
  // icons: who is being hovered (and by their own friend), and their little hops, shakes and glows
  function stepIcons(dt) {
    let tremble = false;
    for (const ic of run.icons) { ic.hoverT = 0; ic.happy = false; }
    for (const g of active.values()) {
      const b = g.b;
      if (b.snap) continue;
      const where = L.resolveDrop({ kind: b.kind, bx: b.x, by: b.y, br: b.r, fx: g.x, fy: g.y, icons: run.icons, floor: FLOOR, snap: SNAP });
      const ic = iconOf(where);
      if (ic) { ic.hoverT = 1; if (ic.kind === b.kind) ic.happy = true; }
      if (b.grumpy && where != null) tremble = true;
    }
    run.tremble = tremble;
    for (const ic of run.icons) {
      ic.hover += (ic.hoverT - ic.hover) * Math.min(1, dt * 10);
      if (ic.hop >= 0 && (ic.hop += dt) > 0.6) ic.hop = -1;
      if (ic.shake >= 0 && (ic.shake += dt) > 0.7) ic.shake = -1;
      if (ic.glowT >= 0 && (ic.glowT += dt) > 1.5) ic.glowT = -1;
      ic.hide += ((ic.sitting > 0 ? 1 : 0) - ic.hide) * Math.min(1, dt * (ic.sitting > 0 ? 20 : 5));
    }
  }

  // ---- the "drag it home" hand: level 1 until the first save, after a tap on a friend's bubble, and when idle ----
  // a hint starts on a friend low enough to stay in view for a whole showing, and keeps going while it is in view
  const keepHint = (b) => !b.grumpy && !b.snap && b.held == null && b.y > 45 && b.y < FLOOR;
  const startHint = (b) => keepHint(b) && b.grow >= 1 && b.y > 150 && b.y < FLOOR - 40 && b.x > 90 && b.x < A.VW - 90;
  function stepHint(dt) {
    if (run.phase !== 'play' || active.size) { run.hint = null; return; }
    if (run.hint) {
      const b = run.bubbles.find((q) => q.id === run.hint.id);
      if (!b || !keepHint(b) || (run.hint.t += dt) >= HINT_T * run.hint.n) { run.hint = null; run.hintCool = 2.5; }
      return;
    }
    if ((run.hintCool -= dt) > 0) return;
    const firstTime = run.n === 1 && !run.everSaved && run.pt > 1.2;
    if (!firstTime && run.idle < 9) return;
    let best = null, bd = 1e9;
    for (const b of run.bubbles) {
      if (!startHint(b)) continue;
      const d = Math.abs(b.x - A.VW / 2) * 0.5 - b.y;   // near the middle, and low (rising, it has the longest to go)
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { run.hint = { id: best.id, t: 0, n: 2 }; run.idle = 0; }
  }

  // ---- Isabella swims through now and then, waving; tap her for a twirl. At the chest she hosts the party. ----
  function startIsabella(party) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    run.isa = { dir, x: dir > 0 ? -180 : A.VW + 180, y0: party ? 190 : rnd(140, 230), y: 0, t: 0, twirl: 0, trail: 0, party, twirlT: 0.4 };
    run.isa.y = run.isa.y0;
    S.isabella();
  }
  function stepIsabella(dt) {
    const I = run.isa;
    if (!I) { if (run.phase === 'play' && (run.nextIsa -= dt) <= 0) startIsabella(false); return; }
    I.t += dt;
    if (I.party && run.chest) {
      const dx = run.chest.x - I.x;
      if (Math.abs(dx) > 3) { I.dir = dx > 0 ? 1 : -1; I.x += Math.sign(dx) * Math.min(330, Math.abs(dx) * 2.5) * dt; }
      if (Math.abs(dx) < 60 && (I.twirlT -= dt) <= 0) { I.twirl = 1; I.twirlT = 1.6; }
    } else I.x += I.dir * 165 * dt;
    I.y = I.y0 + Math.sin(I.t * 1.4) * 22;
    if (I.twirl > 0) I.twirl = Math.max(0, I.twirl - dt / 0.8);
    if ((I.trail -= dt) <= 0) { I.trail = 0.11; A.burst('trail', I.x - I.dir * 150, I.y + 6); }
    if (!I.party && (I.x < -200 || I.x > A.VW + 200)) { run.isa = null; run.nextIsa = rnd(28, 40); }
  }
  function hitIsabella(x, y) {
    const I = run && run.isa;
    if (!I) return false;
    const dx = (x - (I.x - 45 * I.dir)) / 115, dy = (y - (I.y - 9)) / 58;
    return dx * dx + dy * dy <= 1;
  }

  // ---- the chest ----
  // the drop that reaches the level's coins: progress is saved at once, the party starts when the last coin lands
  function wonLevel() {
    const n = run.n, stars = run.rules.stars;
    run.stars = stars;
    save.stars[n - 1] = Math.max(save.stars[n - 1], stars);
    save.unlocked = Math.min(NLEV, Math.max(save.unlocked, n + 1));
    save.chests++;
    delete save.runs[n];
    counters.chests++;
    persist();
  }
  const chestX = () => clamp(A.VW * 0.3, 190, A.VW - 190);
  const CHEST_Y = A.PAD_Y + 52, CHEST_SC = 1.5;
  function startWin() {
    const r = run;
    r.phase = 'win'; r.pt = 0;
    releaseAll();
    r.popQueue = r.bubbles.filter((b) => !b.snap).sort((p, q) => p.x - q.x);
    r.popN = r.popQueue.length; r.popT = 0.3;
    r.chest = { x: chestX(), t: 0, open: 0 };
    S.cheer();
    later(0.3, () => { A.burst('puff', r.chest.x, CHEST_Y + 10, 90); S.whoosh(); });
    later(1.2, () => {
      S.chest(); A.fountain(r.chest.x, CHEST_Y - 50, 46, A.TRAY_Y + 10); A.burst('confetti', 0, 0, 0);
      if (!r.isa) startIsabella(true); else { r.isa.party = true; }
    });
    later(1.75, () => A.fountain(r.chest.x, CHEST_Y - 50, 26, A.TRAY_Y + 10));
    later(2.3, () => A.fountain(r.chest.x, CHEST_Y - 50, 26, A.TRAY_Y + 10));
    later(4.0, showResults);
  }
  function stepWin(dt) {
    const r = run;
    // the bubbles still floating pop by themselves, one after another up a scale; their creatures swim off
    if ((r.popT -= dt) <= 0 && r.popQueue.length) {
      const b = r.popQueue.shift();
      if (r.bubbles.indexOf(b) >= 0) {
        removeBubble(b);
        A.burst('pop', b.x, b.y, b.r);
        S.pop(0.12 + ((r.popN - r.popQueue.length) / Math.max(1, r.popN)) * 0.85, 'normal');
        swimAway(b);
      }
      r.popT = 0.13;
    }
    const c = r.chest;
    c.t += dt;
    c.open = smooth(clamp((c.t - 1.15) / 0.55, 0, 1));
  }
  function showResults() {
    const r = run;
    if (!r) return;
    r.results = true; screen = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < r.stars) S.star(i); }));
  }

  // ---- input: each finger can carry a bubble; a quick tap pops a grumpy one away or jiggles a friend ----
  const active = new Map();   // pointerId -> { id, b, ox, oy (bubble minus finger), sx, sy, x, y, t0, moved }
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  function hitBubble(x, y) {
    let best = null, bd = 1e9;
    for (const b of run.bubbles) {
      if (b.held != null || b.snap) continue;
      const r = b.r * shown(b);
      if (!b.front && b.y - r > FLOOR - 4) continue;   // still hidden behind the sand
      const d = Math.hypot(x - b.x, y - b.y), lim = r + GRAB_SLOP;
      if (d <= lim && d / lim < bd) { bd = d / lim; best = b; }
    }
    return best;
  }
  function grab(b, id, p) {
    b.held = id; b.front = true; b.kick = 0; b.vx = 0;
    active.set(id, { id, b, ox: b.x - p.x, oy: b.y - p.y, sx: p.x, sy: p.y, x: p.x, y: p.y, t0: performance.now(), moved: false });
    counters.grabs++; counters.maxPointers = Math.max(counters.maxPointers, active.size);
    S.grab();
    run.hint = null; run.hintCool = 3;
  }
  function placeHeld(g) {
    const b = g.b;
    b.x = clamp(g.x + g.ox, b.r * 0.5, A.VW - b.r * 0.5);
    b.y = clamp(g.y + g.oy, b.r * 0.5, A.H - b.r * 0.35);
  }
  // a bubble grabbed by its edge slides in under the finger as it moves
  function easeGrabs(dt) {
    for (const g of active.values()) {
      if (!g.moved) continue;
      const d = Math.hypot(g.ox, g.oy), lim = g.b.r * 0.55;
      if (d > lim) { const k = Math.max(lim / d, Math.exp(-dt * 6)); g.ox *= k; g.oy *= k; }
      placeHeld(g);
    }
  }
  function release(g, cancelled) {
    const b = g.b;
    if (!run || run.bubbles.indexOf(b) < 0 || b.held !== g.id) return;
    b.held = null; b.x0 = b.x - Math.sin(b.ph + clock * b.om) * b.amp; b.vx = 0;
    if (cancelled || run.phase !== 'play') { b.kick = 80; return; }
    if (!g.moved && performance.now() - g.t0 < TAP_MS) { tapBubble(b); return; }
    dropBubble(b, L.resolveDrop({ kind: b.kind, bx: b.x, by: b.y, br: b.r, fx: g.x, fy: g.y, icons: run.icons, floor: FLOOR, snap: SNAP }));
  }
  function releaseAll() { const gs = [...active.values()]; active.clear(); for (const g of gs) release(g, true); }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (screen !== 'play' || !run || upright()) return;
    counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    const p = A.toWorld(e.clientX, e.clientY);
    run.idle = 0;
    if (run.phase === 'play') {
      const b = hitBubble(p.x, p.y);
      if (b) { grab(b, e.pointerId, p); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ } return; }
    }
    if (hitIsabella(p.x, p.y)) {
      counters.isabellaTaps++;
      if (run.isa.twirl <= 0) run.isa.twirl = 1;
      A.burst('hearts', run.isa.x + run.isa.dir * 50, run.isa.y - 40); S.giggle();
      return;
    }
    const ic = run.phase === 'play' ? run.icons.find((q) => Math.hypot(p.x - q.x, p.y - q.y) <= q.r + 10) : null;
    if (ic) { ic.hop = 0; S.friend(run.icons.indexOf(ic) * 2 + 1); counters.iconTaps++; return; }   // an icon hops and sings
    counters.misses++; A.burst('ripple', p.x, p.y); S.ripple();
  });
  window.addEventListener('pointermove', (e) => {
    const g = active.get(e.pointerId);
    if (!g) return;
    const p = A.toWorld(e.clientX, e.clientY);
    g.x = p.x; g.y = p.y;
    if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > TAP_MOVE) g.moved = true;
    placeHeld(g);
  });
  // a lifted finger is what counts as a user gesture on touch screens, so try starting sound here too
  const lift = (e) => {
    const g = active.get(e.pointerId);
    if (g) { active.delete(e.pointerId); release(g, e.type === 'pointercancel'); }
    if (e.type === 'pointerup') S.init();
  };
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- buttons and navigation ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { S.init(); S.click(); fn(); });
  tap('resLevels', goLevels);
  tap('resReplay', () => startLevel(run ? run.n : 1, true));
  tap('resNext', () => startLevel(Math.min(NLEV, (run ? run.n : 0) + 1)));
  homeBtn.addEventListener('click', () => { S.init(); persist(); location.href = HUB; });
  window.__back = () => { persist(); location.href = HUB; return true; };
  window.__pause = () => { S.suspend(); persist(); };
  // grown-ups: hold the title for 4 seconds to open every level
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { save.unlocked = NLEV; persist(); S.init(); S.rainbow(); goLevels(); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));
  function measureHome() {
    const r = (homeDot || homeBtn).getBoundingClientRect();
    if (!r.width) { homeZone = null; return; }
    const c = A.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    homeZone = { x: c.x, y: c.y, r: ((r.width / 2) * A.dpr) / A.scale };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.suspend(); persist(); return; }
    const m = readMuted();
    if (m !== muted) { muted = m; S.setMuted(m); }
    S.resume(); last = 0;
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('resize', () => { A.resize(); layout(); measureHome(); for (const g of active.values()) placeHeld(g); });

  // ---- the level-select sea: a few friends drifting up in their bubbles, and Isabella swimming by ----
  const menu = { bubbles: [], isa: 0 };
  function stepMenu(dt) {
    if (menu.bubbles.length < 6 && Math.random() < dt * 0.9) {
      const k = L.LEVELS[0].kinds.concat(L.LEVELS[2].kinds)[Math.floor(Math.random() * 5)];
      const x = rnd(60, A.VW - 60);
      menu.bubbles.push({ x, x0: x, y: A.H + 60, r: rnd(40, 52), kind: k[0], col: k[1], grumpy: false, vy: rnd(26, 40), ph: rnd(0, TAU), om: rnd(0.5, 0.8), amp: rnd(6, 14), seed: rnd(0, 10), flip: Math.random() < 0.5, grow: 1 });
    }
    for (let i = menu.bubbles.length - 1; i >= 0; i--) {
      const b = menu.bubbles[i];
      b.y -= b.vy * dt; b.x = b.x0 + Math.sin(b.ph + clock * b.om) * b.amp;
      if (b.y < -70) menu.bubbles.splice(i, 1);
    }
    menu.isa += dt;
    A.stepParts(dt);
  }
  function drawMenu() {
    A.drawBackdrop(0, clock, 1);
    for (const b of menu.bubbles) A.drawBubble(b, clock, false);
    A.drawFloor(0, 1);
    const span = A.VW - 260, ph = (menu.isa * 70) % (2 * span), fwd = ph < span, x = 130 + (fwd ? ph : 2 * span - ph);
    A.drawIsabella(x, 486 + Math.sin(menu.isa * 2) * 6, clock, { scale: 0.85, flip: !fwd, swim: 8, happy: true });
    A.drawParts();
  }

  // ---- drawing a level ----
  const filled = new Array(L.TRAY).fill(false);
  function drawFriend(f, glowy) {
    const ic = f.ic, sc0 = ic.r * 0.0158;
    if (f.state === 'land') {
      // out of the bubble a little big, then a happy dance on its icon until its turn to hop into the tray
      const pop = f.t < 0.25 ? 1 + 0.25 * Math.sin((f.t / 0.25) * Math.PI) : 1, hop = Math.abs(Math.sin(f.t * 7)) * 10;
      A.drawCreature(f.kind, f.col, ic.x, ic.y - ic.r * 0.03 - hop, sc0 * pop, clock, { seed: f.seed, wig: 1, happy: true, glow: glowy });
      return;
    }
    const p = flyPos(f);
    A.drawCreature(f.kind, f.col, p.x, p.y, sc0 + (A.miniScale() - sc0) * p.u, clock, { seed: f.seed, wig: 0.4, happy: true, glow: glowy, rot: Math.sin(p.u * Math.PI) * 0.3 });
  }
  function drawTrayFriends(glowy, alpha) {
    const g = run.gather, sc = A.miniScale(), cx = A.VW / 2, cy = A.TRAY_Y - 6;
    const mu = g ? smooth(clamp((g.t - GATHER_T) / MERGE_T, 0, 1)) : 0;
    for (let i = 0; i < L.TRAY; i++) {
      const m = run.tray[i];
      if (!m) continue;
      let x = A.trayX(i), y = A.TRAY_Y - 2 + Math.sin(clock * 1.8 + m.seed) * 1.5, s2 = sc;
      if (m.hop >= 0) y -= Math.sin(Math.PI * clamp(m.hop / 0.45, 0, 1)) * m.hopH;
      if (mu > 0) { x += (cx - x) * mu; y += (cy - y) * mu; s2 *= 1 - mu * 0.85; }
      A.drawCreature(m.kind, m.col, x, y, s2, clock, { seed: m.seed, happy: true, wig: g || m.hop >= 0 ? 0.6 : 0, glow: glowy, alpha });
    }
    if (mu > 0) { A.glow(cx, cy, 80, 'rgba(255,220,90,0.8)', mu); A.drawCoin(cx, cy, clock * 6, 38 * easeOutBack(mu)); }
  }
  function drawLeaver(v, glowy) {
    if (v.mode === 'swim') {
      A.drawCreature(v.kind, v.col, v.x, v.y, v.sc, clock, { wig: v.t < 0.35 ? 1 : 0.3, seed: v.seed, glow: glowy, flip: v.t < 0.35 ? false : v.dir < 0, happy: true });
      return;
    }
    // a grump: stomps and puffs up, then swims off
    const stomping = v.t < v.stomp, bounce = stomping ? Math.abs(Math.sin(v.t * 10)) * 8 : 0;
    const puff = stomping ? 1 + 0.12 * Math.abs(Math.sin(v.t * 10)) : 1;
    A.drawCreature(v.kind, v.col, v.x, v.y - bounce, v.sc * puff, clock,
      { wig: stomping ? 0.5 : 0.25, seed: v.seed, glow: glowy, flip: stomping ? v.dir > 0 : v.dir < 0, rot: stomping ? Math.sin(v.t * 20) * 0.12 : 0 });
  }
  function drawNumeral(m) {
    const t = m.t, top = FLOOR - 52, bx = numX(m);
    let size, x = bx, y, a = 1;
    if (t < 0.32) { size = NUM * easeOutBack(t / 0.32); y = top; }
    else if (t < 1.15) { size = NUM; y = top - (t - 0.32) * 10; }
    else {
      // shrink down into the small numeral under the friend
      const u = smooth(clamp((t - 1.15) / 0.5, 0, 1));
      size = NUM + (21 - NUM) * u; x = bx + (A.trayX(m.slot) - bx) * u; y = top - 8.3 + (A.TRAY_NUM - top + 8.3) * u; a = 1 - u;
    }
    A.drawNumeral(m.n, x, y, size, A.NUMCOL[m.slot], a);
  }
  function drawCoins() {
    const r = run;
    A.drawHud(r.rules.target, r.hud, clock, { pulse: r.hud === r.rules.target - 1 && r.phase === 'play', tremble: r.tremble && r.hud > 0 });
    for (let k = 0; k < r.flyCoins.length; k++) {
      const p = coinFlyPos(r.flyCoins[k], k);
      A.glow(p.x, p.y, p.r * 2.4, 'rgba(255,220,90,0.8)', 0.75);
      A.drawCoin(p.x, p.y, clock * 7, p.r);
    }
    // a lost coin wobbles in its ring, then drifts away up and out, fading
    for (const c of r.lostCoins) {
      const t = c.t, drift = Math.max(0, t - 0.45), wob = Math.sin(t * 16) * 0.5 * Math.max(0.25, 1 - t / 1.7);
      A.drawCoin(c.x + drift * 60 + Math.sin(t * 6) * 5, c.y + drift * 22 - drift * drift * 30, t * 2, 17, wob, 1 - smooth(clamp((t - 0.6) / 1.1, 0, 1)));
    }
  }
  function drawPlay() {
    const r = run, sc = r.cfg.scene, glowy = !!SCENES[sc].glow, win = r.phase === 'win';
    A.drawBackdrop(sc, clock, 1);
    if (r.isa) {
      const I = r.isa;
      A.drawIsabella(I.x, I.y, clock, { scale: 1.45, flip: I.dir < 0, happy: true, wave: clock * 9,
        tilt: Math.cos(I.t * 1.4) * 0.1 + (I.twirl > 0 ? smooth(1 - I.twirl) * TAU * I.dir : 0) });
    }
    for (const b of r.bubbles) if (!b.front && b.held == null && !b.snap) A.drawBubble(b, clock, glowy);
    A.drawFloor(sc, 1);
    const fade = win ? 1 - 0.65 * smooth(clamp(r.pt / 0.8, 0, 1)) : 1;
    for (const ic of r.icons) A.drawPad(ic, clock, { hover: ic.hover, happy: ic.happy || win, hop: ic.hop, shake: ic.shake, glow: ic.glowT, hide: ic.hide, glowy, alpha: fade });
    for (let i = 0; i < L.TRAY; i++) filled[i] = !!r.tray[i];
    A.drawTray(filled, clock, r.gather || win ? -1 : filled.indexOf(false), fade);
    drawTrayFriends(glowy, fade);
    for (const f of r.friends) drawFriend(f, glowy);
    if (r.chest) {
      const c = r.chest, rise = easeOutBack(clamp((c.t - 0.25) / 0.7, 0, 1));
      A.drawChest(c.x, A.H + 80 + (CHEST_Y - A.H - 80) * rise, c.open, clock, CHEST_SC);
    }
    for (const v of r.leavers) drawLeaver(v, glowy);
    for (const b of r.bubbles) if ((b.front || b.snap) && b.held == null) A.drawBubble(b, clock, glowy);
    for (const b of r.bubbles) if (b.held != null) A.drawBubble(b, clock, glowy);
    A.drawParts();
    for (const m of r.numerals) drawNumeral(m);
    drawCoins();
    if (r.hint) {
      const b = r.bubbles.find((q) => q.id === r.hint.id), ic = b && iconOf(b.kind);
      if (b && ic) A.drawDragHint(b, ic, (r.hint.t % HINT_T) / HINT_T, clock, glowy);
    }
  }
  function draw() {
    A.begin();
    if (!run) drawMenu(); else drawPlay();
  }

  // ---- main loop ----
  function update(dt) {
    const r = run;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; if ((tm.t -= dt) <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    if (r.phase === 'play') {
      r.idle += dt;
      const live = r.bubbles.filter((b) => !b.snap).length;
      if (live < 2 && r.nextSpawn > 0.6) r.nextSpawn = 0.6;   // a sea emptied by quick fingers fills up again soon
      if ((r.nextSpawn -= dt) <= 0) {
        if (live < maxOnScreen()) spawnOne();
        r.nextSpawn = rnd(r.cfg.every[0], r.cfg.every[1]);
      }
      if (r.rules.done && r.owed === 0 && !r.gather && !r.friends.length) startWin();
    } else if (r.phase === 'win') stepWin(dt);
    easeGrabs(dt);
    stepBubbles(dt);
    stepFriends(dt);
    stepTray(dt);
    stepGather(dt);
    stepCoins(dt);
    stepLeavers(dt);
    stepIcons(dt);
    for (let i = r.numerals.length - 1; i >= 0; i--) if ((r.numerals[i].t += dt) > 1.7) r.numerals.splice(i, 1);
    stepHint(dt);
    stepIsabella(dt);
    A.stepParts(dt);
  }
  const perf = new Float32Array(300);
  let perfN = 0;
  function frame(nowMs) {
    const t0 = performance.now();
    const raw = last ? (nowMs - last) / 1000 : 0;
    last = nowMs;
    if (!upright()) {
      let rem = Math.min(0.05, raw) * timeScale;
      while (rem > 1e-6) {
        const dt = Math.min(0.05, rem);
        rem -= dt; clock += dt;
        if (run) update(dt); else stepMenu(dt);
      }
      draw();
    }
    perf[perfN++ % perf.length] = performance.now() - t0;
    requestAnimationFrame(frame);
  }

  // ---- hooks for the headless tests (test/games/pop) ----
  function bubbleInfo(b) {
    const r = b.r * shown(b), c = A.toClient(b.x, b.y);
    return { id: b.id, kind: b.kind, cute: !b.grumpy, grumpy: b.grumpy, x: b.x, y: b.y, r, cx: c.x, cy: c.y, cr: (r * A.scale) / A.dpr,
      held: b.held != null, snapping: !!b.snap, front: b.front, visible: (b.front || b.y - r < FLOOR - 4) && b.y + r > 0 };
  }
  window.__popDebug = {
    counters,
    state() {
      const r = run;
      return {
        screen, phase: r ? r.phase : null, level: r ? r.n : null,
        coins: r ? r.rules.coins : 0, coinTarget: r ? r.rules.target : 0, tray: r ? r.rules.tray.length : 0, trayKinds: r ? r.rules.tray.slice() : [],
        hudCoins: r ? r.hud : 0, owed: r ? r.owed : 0, debt: r ? r.debt : 0, trayShown: r ? r.tray.filter(Boolean).length : 0,
        saves: r ? r.rules.saves : 0, grumpDrops: r ? r.rules.grumpDrops : 0, stars: r ? r.rules.stars : null, done: r ? r.rules.done : false,
        chest: !!(r && r.chest), chestOpen: r && r.chest ? r.chest.open : 0, results: !!(r && r.results), resultsStars: r && r.results ? r.stars : null,
        icons: r ? r.icons.map((ic) => { const c = A.toClient(ic.x, ic.y); return { kind: ic.kind, col: ic.col, x: ic.x, y: ic.y, r: ic.r, cx: c.x, cy: c.y, cr: (ic.r * A.scale) / A.dpr }; }) : [],
        bubbles: r ? r.bubbles.map(bubbleInfo) : [],
        friends: r ? r.friends.length : 0, leavers: r ? r.leavers.length : 0, numerals: r ? r.numerals.map((m) => m.n) : [],
        flyCoins: r ? r.flyCoins.length : 0, lostCoins: r ? r.lostCoins.length : 0, hint: r && r.hint ? r.hint.id : null,
        unlocked: save.unlocked, savedStars: save.stars.slice(), total: save.total, chests: save.chests,
        VW: A.VW, scale: A.scale, dpr: A.dpr, canvas: [canvas.width, canvas.height], floor: FLOOR,
        parts: A.partCount, muted, audio: S.state, gain: S.gain, menuBubbles: menu.bubbles.length, caches: A.cacheSizes(),
      };
    },
    start(n, fresh) { startLevel(n, fresh); return run.n; },
    // the same rule code as a real drop: iconKind is an icon's creature, 'sand', or null (let go in the water)
    drop(id, iconKind) {
      if (!run) return null;
      const b = run.bubbles.find((q) => q.id === id);
      if (!b || b.snap) return null;
      if (b.held != null) { for (const [pid, g] of active) if (g.b === b) active.delete(pid); b.held = null; }
      return dropBubble(b, iconKind === undefined ? null : iconKind).type;
    },
    spawn(o) {
      o = o || {};
      if (!run) return null;
      const b = makeBubble({ x: o.x != null ? o.x : A.VW / 2, y: o.y != null ? o.y : 230, kind: o.kind || nextKind(false), grow: !!o.grow });
      if (o.still) { b.vy = 0; b.amp = 0; b.x0 = b.x; }
      return b.id;
    },
    goLevels() { goLevels(); return true; },
    levels() { return L.LEVELS; },
    hud() { if (!run) return []; return A.hudLayout(run.rules.target).slots.map((sl) => { const c = A.toClient(sl.x, sl.y); return { x: sl.x, y: sl.y, cx: c.x, cy: c.y }; }); },
    homeZone() { return homeZone; },
    timeScale(k) { timeScale = k; return timeScale; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    resetPerf() { perfN = 0; perf.fill(0); },
    saved() { return store.get(SAVE_KEY); },
  };

  measureHome();
  goLevels();
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?level=4 jumps straight into a level (handy for screenshots)
  const qLevel = +new URLSearchParams(location.search).get('level');
  if (qLevel >= 1 && qLevel <= NLEV && qLevel <= save.unlocked) startLevel(qLevel);
  requestAnimationFrame(frame);
})();
