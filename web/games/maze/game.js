/* Coral Maze — screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js, sound in sound.js.
 *
 * Time in a level runs in logic ticks (logic.js): Isabella swims one cell per tick and every frame draws the world
 * part-way between the last tick and the next. A swipe starts a glide at the next tick; in a level with nothing else
 * moving, it starts at once. */
(function () {
  'use strict';
  const L = MazeLogic, R = MazeArt, A = MazeSound;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.LEVELS.length, PER = 10, PAGES = Math.ceil(NLEV / PER), HUB = '../../index.html';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const backOut = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  const HINT_AFTER = 20, HINT_AGAIN = 8;   // seconds without progress before the trail shows the next glide
  const HAND_AFTER = 2.5;                  // levels 1-2: the swipe hand, if she has not swum yet
  const INTRO = 0.9;                       // seconds before a level starts on its own (any touch starts it sooner)
  const OUT_SWIM = 0.8, PARTY_AT = 2.7;    // the celebration: swim to the chest, then the results card

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
  const SAVE_KEY = 'isabella.maze', MAIN_KEY = 'isabella.save';
  const freshSave = () => ({ unlocked: 1, stars: new Array(NLEV).fill(0) });
  function loadSave() {
    const sv = freshSave();
    try {
      const raw = JSON.parse(store.get(SAVE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        sv.stars = Array.from({ length: NLEV }, (_, i) => clamp(Math.floor(Number((raw.stars || [])[i]) || 0), 0, 3));
        const beaten = sv.stars.reduce((m, st, i) => (st > 0 ? i + 1 : m), 0);
        sv.unlocked = clamp(Math.max(Math.floor(Number(raw.unlocked) || 1), beaten + 1), 1, NLEV);
      }
    } catch (e) { /* a broken save starts fresh */ }
    return sv;
  }
  let save = loadSave();
  const persist = () => store.set(SAVE_KEY, JSON.stringify({ unlocked: save.unlocked, stars: save.stars }));
  // Sound follows the main game's mute switch (isabella.save, as Shell Match and Bubble Party do), and the switch on
  // the level select flips that same switch: it rewrites only the `muted` field, and never a save it cannot read.
  function readMain() {
    try { const v = JSON.parse(store.get(MAIN_KEY) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return undefined; }
  }
  let mutedHere = null;   // only when isabella.save cannot be read: then the switch lasts until the page closes
  function readMuted() { const m = readMain(); return m === undefined ? !!mutedHere : !!(m && m.muted); }
  function writeMuted(on) {
    const raw = store.get(MAIN_KEY);
    let obj = {};
    if (raw != null && raw !== '') {
      try { obj = JSON.parse(raw); } catch (e) { obj = null; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { mutedHere = !!on; return false; }
    }
    obj.muted = !!on;
    store.set(MAIN_KEY, JSON.stringify(obj));
    return true;
  }
  const crownEarned = () => { const m = readMain(); return !!(m && m.crown) || save.stars[NLEV - 1] > 0; };

  // ---- state ----
  let screen = 'levels', page = 0, run = null, clock = 0, last = 0, gesture = null, crown = crownEarned();
  const canvas = $('c');
  R.init(canvas);
  A.setMuted(readMuted());

  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  function setSoundIcon() { $('soundBtn').querySelector('use').setAttribute('href', readMuted() ? '#i-mute' : '#i-sound'); }

  // ---- level select: two pages of ten ----
  function goLevels(pg) {
    screen = 'levels'; run = null; gesture = null;
    R.clearParticles();
    page = pg != null ? clamp(pg, 0, PAGES - 1) : Math.floor((Math.min(save.unlocked, NLEV) - 1) / PER);
    const grid = $('grid'); grid.innerHTML = '';
    for (let n = page * PER + 1; n <= Math.min(NLEV, (page + 1) * PER); n++) {
      const th = R.THEMES[L.LEVELS[n - 1].theme], locked = n > save.unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === save.unlocked && !save.stars[n - 1] ? ' next' : '');
      b.dataset.level = n;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65), ${th.top} 45%, ${th.bot})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < save.stars[n - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        A.init();
        if (locked) { A.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        A.click(); startLevel(n);
      });
      grid.appendChild(b);
    }
    $('pgPrev').style.visibility = page > 0 ? 'visible' : 'hidden';
    $('pgNext').style.visibility = page < PAGES - 1 ? 'visible' : 'hidden';
    $('pgDots').innerHTML = Array.from({ length: PAGES }, (_, i) => `<span class="${i === page ? 'on' : ''}"></span>`).join('');
    $('starCount').textContent = `${save.stars.reduce((a, b) => a + b, 0)}/${NLEV * 3}`;
    setSoundIcon();
    show('levels');
    A.startMusic('menu');
  }

  // ---- a level ----
  const tickFor = (c) => clamp(c / 470, 0.13, 0.21);   // seconds per cell: about 470 world units a second
  function blankOut(cell) { return { from: cell, to: cell, dir: -1, started: false, bonk: -1, gate: -1, shy: 0, hit: -1, hitU: 0, key: -1, shell: -1, swept: false, stopped: false, won: false }; }
  function startLevel(n) {
    const lv = L.build(n), lay = R.layout(lv.W, lv.H), st = L.newState(lv), K = lv.keys.length, P = lv.patrols.length;
    run = {
      n, lv, lay, st, par: lv.par, out: blankOut(st.cell), phase: 'intro', pt: 0, playT: 0,
      tick: 0, tAcc: 0, TICK: tickFor(lay.c), restTicks: 1, moves: 0, queue: null, schedule: [], timers: [],
      prevPP: Float64Array.from(st.pp), face: lv.patrols.map(() => 1),
      tilt: 0, tiltTo: 0, flip: false, bonk: null, swishT: 0, settle: 0,
      gateOpen: new Float64Array(K), gateShake: new Float64Array(K), keyFly: [], shellsOpen: lv.shells.map(() => false),
      wobble: new Float64Array(P), near: new Float64Array(P),
      seen: new Uint8Array(lv.N), fogA: 0, visited: new Uint8Array(lv.N), lastProgress: 0, hintAfter: HINT_AFTER, hint: null, hints: 0,
      firstDir: -1, hit: null, chestOpen: 0, stars: 0, results: false,
    };
    run.visited[lv.start] = 1;
    markSeen(run);
    if (n <= 2) { const sol = L.solve(lv); if (sol && sol.steps.length) run.firstDir = sol.steps[0].dir; }
    screen = 'play'; gesture = null; show(null);
    R.clearParticles();
    A.startMusic(n); A.intro();
    R.burst('respawn', R.cellX(lay, lv, lv.start), R.cellY(lay, lv, lv.start), lay.c / 80);
  }
  function beginPlay() { if (run && run.phase === 'intro') { run.phase = 'play'; run.pt = 0; run.tAcc = 0; } }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }
  function markSeen(r) {
    const lv = r.lv;
    if (!lv.dark) return;
    const x = lv.cx[r.st.cell], y = lv.cy[r.st.cell], rr = lv.dark - 0.35;
    for (let i = 0; i < lv.N; i++) if ((lv.cx[i] - x) ** 2 + (lv.cy[i] - y) ** 2 <= rr * rr) r.seen[i] = 1;
  }
  const progress = (r) => { r.lastProgress = r.playT; };

  // One tick of the world (logic.js step), and what it means for sound, sparkle and the hint.
  function doTick() {
    const r = run, lv = r.lv, st = r.st, out = r.out, lay = r.lay;
    let input = -1, tapTo = -1;
    if (st.moving < 0 && !st.won) {
      if (r.schedule.length && r.tick >= r.schedule[0].at) { const m = r.schedule.shift(); input = m.dir; tapTo = m.tap; }
      else if (r.queue) {
        const q = r.queue;
        r.queue = null;
        let d = q.dir;
        if (q.tap < 0 && !L.canPass(lv, st, st.cell, d) && q.alt >= 0 && L.canPass(lv, st, st.cell, q.alt)) d = q.alt;
        if (L.canPass(lv, st, st.cell, d)) { input = d; tapTo = q.tap; } else bump(d);
      }
    }
    r.prevPP.set(st.pp);
    const res = L.step(lv, st, input, tapTo, out);
    r.tick++;
    r.restTicks = res === 0 && out.from === out.to ? r.restTicks + 1 : 0;
    for (let j = 0; j < lv.patrols.length; j++) {
      const p = lv.patrols[j], mv = (st.pp[j] - r.prevPP[j]) * (p.dx || 0);
      if (mv) r.face[j] = mv > 0 ? 1 : -1;
      if (out.shy & (1 << j)) { r.wobble[j] = 1; A.shy(); }
    }
    if (out.started) {
      r.moves++; A.swim(); r.bonk = null;
      if (r.hint) { r.hint = null; r.hintAfter = HINT_AGAIN; }   // once she has needed help, it comes sooner
    }
    if (out.gate >= 0) {
      const g = lv.gates[out.gate], x = (R.cellX(lay, lv, g.a) + R.cellX(lay, lv, g.b)) / 2, y = (R.cellY(lay, lv, g.a) + R.cellY(lay, lv, g.b)) / 2;
      A.gate(); R.burst('gate', x, y, lay.c / 80); progress(r);
    }
    if (out.key >= 0) {
      const x = R.cellX(lay, lv, out.to), y = R.cellY(lay, lv, out.to);
      r.keyFly.push({ k: out.key, x0: x, y0: y, t: 0 });
      A.key(); R.burst('key', x, y, lay.c / 80); progress(r);
    }
    if (out.shell >= 0) {
      r.shellsOpen[out.shell] = true;
      A.shell(); R.burst('shell', R.cellX(lay, lv, out.to), R.cellY(lay, lv, out.to) + lay.tunnel * 0.3, lay.c / 80); progress(r);
    }
    if (out.swept) A.current();
    if (res === 1) { startHit(); return; }
    if (res === 2) { startWin(); return; }
    if (out.stopped) A.rest();
    if (!r.visited[st.cell]) { r.visited[st.cell] = 1; progress(r); }
    markSeen(r);
  }
  // swimming into a wall (or a locked gate, or against a current): a little bump, never a penalty
  function bump(d) {
    const r = run, lv = r.lv, st = r.st;
    r.bonk = { d, t: 0 };
    A.bonk();
    const why = L.blockedBy(lv, st, st.cell, d);
    if (why === 'gate') { const g = lv.gateAt[st.cell * 4 + d]; if (g >= 0) { r.gateShake[g] = 1; A.gateShut(); } }
    const x = R.cellX(r.lay, lv, st.cell) + L.DX[d] * r.lay.c * 0.35, y = R.cellY(r.lay, lv, st.cell) + L.DY[d] * r.lay.c * 0.35;
    R.burst('bonk', x, y, r.lay.c / 80);
  }

  // A patrol touched her: a soft bump, she floats off in a bubble and pops out again at her shell (or the start).
  function startHit() {
    const r = run, out = r.out, lay = r.lay, lv = r.lv;
    const x0 = R.cellX(lay, lv, out.from), y0 = R.cellY(lay, lv, out.from), x1 = R.cellX(lay, lv, out.to), y1 = R.cellY(lay, lv, out.to);
    r.hit = { x0, y0, x1: lerp(x0, x1, out.hitU), y1: lerp(y0, y1, out.hitU), at: out.hitU * r.TICK, p: out.hit, touched: false, back: false };
    r.phase = 'hit'; r.pt = 0; r.queue = null; r.hint = null; r.bonk = null;
  }
  function stepHit() {
    const r = run, h = r.hit, lay = r.lay, lv = r.lv;
    if (!h.touched && r.pt >= h.at) {
      h.touched = true; A.hit(); r.wobble[h.p] = 1;
      R.burst('hit', h.x1, h.y1, lay.c / 80);
    }
    if (!h.back && r.pt >= h.at + 0.8) {
      h.back = true; A.respawn();
      R.burst('respawn', R.cellX(lay, lv, r.st.cell), R.cellY(lay, lv, r.st.cell), lay.c / 80);
    }
    if (r.pt >= h.at + 1.1) { r.phase = 'play'; r.pt = 0; r.tAcc = 0; r.restTicks = 1; r.hit = null; r.out = blankOut(r.st.cell); r.prevPP.set(r.st.pp); }
  }

  // Out into the open sea: she swims to the treasure chest, it bursts open with coins, then the stars.
  function startWin() {
    const r = run, n = r.n;
    r.phase = 'win'; r.pt = 0; r.queue = null; r.schedule = []; r.hint = null; r.bonk = null;
    r.stars = L.starsFor(r.par, r.moves);
    save.stars[n - 1] = Math.max(save.stars[n - 1], r.stars);
    save.unlocked = Math.min(NLEV, Math.max(save.unlocked, n + 1));
    persist();
    crown = crownEarned();
    const lay = r.lay, big = n === NLEV, cx = lay.chestX, cy = lay.chestY - 40 * lay.chestSc;
    later(r.TICK + OUT_SWIM - 0.15, () => { A.fanfare(big); A.cheer(); R.fountain(cx, cy, big ? 80 : 44, 528); });
    later(r.TICK + OUT_SWIM + 0.4, () => { R.fountain(cx, cy, big ? 50 : 24, 528); R.burst('cheer', cx - 40, cy - 90); });
    later(r.TICK + OUT_SWIM + 0.9, () => { R.fountain(cx, cy, big ? 50 : 22, 528); R.burst('notes', cx - 30, cy - 110); });
    later(PARTY_AT, showResults);
  }
  function showResults() {
    const r = run;
    r.results = true; screen = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    $('resCrown').style.display = r.n === NLEV ? 'block' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < r.stars) A.star(i); }));
  }

  // The hint: the solver's next glide from exactly where things are now. Waiting is only shown when going now
  // would cost a move (a patrol in the way); otherwise the trail lights up at once.
  function computeHint(r) {
    const lv = r.lv, sol = L.solve(lv, r.st, r.tick, { limit: 300000 });
    if (!sol || !sol.steps.length) return null;
    let s0 = sol.steps[0];
    if (s0.at > r.tick) {
      const g = L.cloneState(lv, r.st), res = { ticks: 0, cells: [] }, rr = L.glide(lv, g, s0.dir, -1, res);
      const rest = rr === 0 ? L.solve(lv, g, r.tick + res.ticks, { limit: 300000 }) : null;
      if ((rr === 2 && sol.par === 1) || (rest && rest.par + 1 === sol.par)) s0 = { dir: s0.dir, at: r.tick, cells: res.cells };
    }
    return { dir: s0.dir, at: s0.at, from: r.st.cell, cells: [r.st.cell].concat(s0.cells), bright: 0 };
  }
  function showHint() {
    const r = run, h = computeHint(r);
    r.lastProgress = r.playT;   // try again later if nothing came of it
    if (!h) return;
    r.hint = h; r.hints++;
    A.hint();
  }

  // ---- the clock ----
  function update(dt) {
    const r = run, lv = r.lv, st = r.st, lay = r.lay;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; tm.t -= dt; if (tm.t <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    if (r.phase === 'intro' && r.pt >= INTRO) beginPlay();
    if (r.phase === 'play') {
      r.playT += dt;
      r.tAcc += dt;
      for (let guard = 0; r.tAcc >= r.TICK && r.phase === 'play' && guard < 4; guard++) { r.tAcc -= r.TICK; doTick(); }
      if (r.phase === 'play') {
        r.tAcc = Math.min(r.tAcc, r.TICK);
        if (!r.hint && st.moving < 0 && r.restTicks >= 2 && !r.queue && !r.schedule.length && r.playT - r.lastProgress >= r.hintAfter) showHint();
        if (r.hint) r.hint.bright = r.tick >= r.hint.at ? 1 : 0;
      }
    } else if (r.phase === 'hit') stepHit();
    // which way she faces: flipped for left, tilted head-up or head-down in the up-down tunnels
    const o = r.out, swimming = (r.phase === 'play' && o.to !== o.from) || (r.phase === 'hit' && r.pt < (r.hit ? r.hit.at : 0));
    if (swimming && o.dir >= 0) {
      if (o.dir === 1) r.flip = false; else if (o.dir === 3) r.flip = true;
      r.tiltTo = o.dir === 0 ? (r.flip ? 1.3 : -1.3) : o.dir === 2 ? (r.flip ? -1.3 : 1.3) : 0;
    }
    if (r.phase === 'win') r.tiltTo = 0;
    r.tilt += (r.tiltTo - r.tilt) * Math.min(1, dt * 14);
    if (r.bonk) { r.bonk.t += dt; if (r.bonk.t > 0.32) r.bonk = null; }
    for (let g = 0; g < r.gateOpen.length; g++) {
      // a gate starts opening a moment before she reaches it, so she never swims through closed bars
      const soon = st.moving >= 0 && lv.gateAt[st.cell * 4 + st.moving] === g && st.items[g] === L.HELD;
      const target = st.items[g] === L.OPEN || soon ? 1 : 0;
      r.gateOpen[g] = target ? Math.min(1, r.gateOpen[g] + dt / 0.2) : 0;
      r.gateShake[g] = Math.max(0, r.gateShake[g] - dt * 2.5);
    }
    for (let i = r.keyFly.length - 1; i >= 0; i--) { r.keyFly[i].t += dt; if (r.keyFly[i].t > 0.7) r.keyFly.splice(i, 1); }
    for (let j = 0; j < r.wobble.length; j++) r.wobble[j] = Math.max(0, r.wobble[j] - dt * 1.6);
    if (lv.dark) r.fogA = r.phase === 'intro' ? 0 : r.phase === 'win' ? Math.max(0, r.fogA - dt * 0.8) : Math.min(1, Math.max(r.fogA, (r.playT - 0.5) / 1.1));
    if (r.phase === 'win') r.chestOpen = smooth(clamp((r.pt - r.TICK - OUT_SWIM + 0.35) / 0.45, 0, 1));
    if (r.results && Math.random() < dt * 0.8) R.burst('cheer', lay.chestX - 40 + Math.random() * 30, lay.chestY - 150 * lay.chestSc);
  }

  // ---- what to draw this frame ----
  function isabellaAt(r) {
    const lv = r.lv, lay = r.lay, c = lay.c, o = r.out;
    const cx = (i) => R.cellX(lay, lv, i), cy = (i) => R.cellY(lay, lv, i);
    const isa = { x: cx(r.st.cell), y: cy(r.st.cell), tilt: r.tilt, flip: r.flip, scale: (0.86 * c) / R.ISA_LEN, swim: 6, happy: false, alpha: 1, bubble: 0, bx: 0, by: 0 };
    if (r.phase === 'intro') {
      isa.scale *= backOut(clamp(r.pt / 0.45, 0, 1));
    } else if (r.phase === 'play') {
      const f = clamp(r.tAcc / r.TICK, 0, 1);
      isa.x = lerp(cx(o.from), cx(o.to), f); isa.y = lerp(cy(o.from), cy(o.to), f);
      if (o.to !== o.from) {
        isa.swim = 12;
        r.swishT -= 1 / 60;
        if (r.swishT <= 0) { r.swishT = 0.09; R.burst('swish', isa.x - L.DX[o.dir] * c * 0.4, isa.y - L.DY[o.dir] * c * 0.4, c / 80); }
      } else {
        // resting: settle away from rock at her nose or tail, so she never pokes into the wall
        const ax = Math.abs(Math.cos(r.tilt)) > 0.5, head = ax ? (r.flip ? 3 : 1) : (Math.sin(r.tilt) * (r.flip ? -1 : 1) < 0 ? 0 : 2);
        const o2 = lv.open[o.to] | 0, front = (o2 >> head) & 1, back = (o2 >> ((head + 2) & 3)) & 1;
        const k = front === back ? 0 : front ? 0.07 : -0.07;
        r.settle += (k - r.settle) * 0.15;
        isa.x += L.DX[head] * r.settle * c; isa.y += L.DY[head] * r.settle * c;
        isa.y += Math.sin(clock * 2.2) * c * 0.03;
      }
      if (r.bonk) { const k = Math.sin(Math.PI * clamp(r.bonk.t / 0.32, 0, 1)) * c * 0.12; isa.x += L.DX[r.bonk.d] * k; isa.y += L.DY[r.bonk.d] * k; }
    } else if (r.phase === 'hit') {
      const h = r.hit;
      if (r.pt < h.at) { const u = h.at > 0 ? r.pt / h.at : 1; isa.x = lerp(h.x0, h.x1, u); isa.y = lerp(h.y0, h.y1, u); isa.swim = 12; }
      else if (r.pt < h.at + 0.8) {
        const u = (r.pt - h.at) / 0.8;
        isa.x = h.x1; isa.y = h.y1 - u * c * 0.6; isa.alpha = 1 - smooth(clamp((u - 0.45) / 0.4, 0, 1)); isa.tilt = Math.sin(u * 9) * 0.3;
        isa.bubble = u; isa.bx = isa.x; isa.by = isa.y;
      } else {
        const u = clamp((r.pt - h.at - 0.8) / 0.3, 0, 1);
        isa.scale *= backOut(u); isa.alpha = u;
      }
    } else if (r.phase === 'win') {
      const t = r.pt, ox = cx(lv.N), oy = cy(lv.N), sc0 = isa.scale;
      const px = lay.chestX - 105 * lay.chestSc - 22, py = lay.chestY - 150 * lay.chestSc - 34, partySc = Math.max(sc0 * 1.25, 0.7);
      isa.happy = true; isa.swim = 11; isa.party = true;
      if (t < r.TICK) { const f = t / r.TICK; isa.x = lerp(cx(lv.exit), ox, f); isa.y = lerp(cy(lv.exit), oy, f); }
      else if (t < r.TICK + OUT_SWIM) {
        const u = smooth((t - r.TICK) / OUT_SWIM), mx = (ox + px) / 2 + c * 0.4, my = Math.min(oy, py) - c * 0.8;
        isa.x = (1 - u) * (1 - u) * ox + 2 * (1 - u) * u * mx + u * u * px;
        isa.y = (1 - u) * (1 - u) * oy + 2 * (1 - u) * u * my + u * u * py;
        isa.scale = lerp(sc0, partySc, u); isa.tilt = Math.sin(u * Math.PI) * -0.4;
      } else {
        const u = t - r.TICK - OUT_SWIM, twirl = smooth(clamp((u - 0.3) / 0.7, 0, 1));
        isa.x = px; isa.y = py - Math.abs(Math.sin(clock * 4)) * 12; isa.scale = partySc;
        isa.flip = false; isa.tilt = Math.sin(clock * 5) * 0.15 - twirl * Math.PI * 2;
      }
    }
    return isa;
  }
  function buildView() {
    const r = run, lv = r.lv, lay = r.lay, st = r.st, c = lay.c;
    const f = r.phase === 'play' ? clamp(r.tAcc / r.TICK, 0, 1) : r.phase === 'hit' ? clamp(r.pt / r.TICK, 0, 1) : 1;
    const isa = isabellaAt(r);
    const patrols = lv.patrols.map((p, j) => {
      const q = lerp(r.prevPP[j], st.pp[j], f) / L.P;
      const x = lay.x0 + (p.x0 + p.dx * q + 0.5) * c, y = lay.y0 + (p.y0 + p.dy * q + 0.5) * c;
      const close = Math.hypot(x - isa.x, y - isa.y) < c * 1.7 ? 1 : 0;
      r.near[j] += (close - r.near[j]) * 0.08;
      return { x, y, kind: p.kind, face: r.face[j], wobble: r.wobble[j], near: r.near[j], ph: j * 1.7 };
    });
    const keysOnFloor = [];
    lv.keys.forEach((k, i) => { if (st.items[i] === L.FLOOR) keysOnFloor.push({ x: R.cellX(lay, lv, k.cell), y: R.cellY(lay, lv, k.cell), k: i }); });
    let carrying = -1;
    for (let i = 0; i < st.items.length; i++) if (st.items[i] === L.HELD && !r.keyFly.some((kf) => kf.k === i)) { carrying = i; break; }
    let hint = null;
    if (r.hint) hint = { pts: r.hint.cells.map((cell) => ({ x: R.cellX(lay, lv, cell), y: R.cellY(lay, lv, cell) })), bright: r.hint.bright };
    let hand = null;
    if (r.firstDir >= 0 && r.moves === 0 && r.phase === 'play' && r.playT > HAND_AFTER) {
      const sx = R.cellX(lay, lv, lv.start), sy = R.cellY(lay, lv, lv.start), d = r.firstDir;
      hand = { x0: sx, y0: sy, x1: sx + L.DX[d] * c * 1.5, y1: sy + L.DY[d] * c * 1.5, size: clamp(c * 0.75, 52, 84) };
    }
    const flyKeys = r.keyFly.map((kf) => {
      const u = smooth(clamp(kf.t / 0.7, 0, 1)), tx = 57, ty = 158 + kf.k * 70;
      return { k: kf.k, x: lerp(kf.x0, tx, u), y: lerp(kf.y0, ty, u) - Math.sin(Math.PI * u) * 60, sc: lerp(c / 85, 0.78, u) };
    });
    return {
      lv, lay, items: st.items, gateOpen: r.gateOpen, gateShake: r.gateShake, shellsOpen: r.shellsOpen, isa, patrols, keysOnFloor, carrying, hint, hand, flyKeys,
      fog: lv.dark ? { seen: r.seen, r: lv.dark, alpha: r.fogA } : null, chest: { open: r.chestOpen }, crown,
    };
  }

  // ---- input: a swipe (or a drag) picks a direction; a tap picks a spot along her tunnel ----
  const swipeMin = () => Math.max(12, innerHeight * 0.05);   // 5vh of finger travel
  const dominant = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  // a sloppy diagonal: the other way is a fallback, used only if the bigger way is a wall
  function secondary(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.min(ax, ay) < 0.4 * Math.max(ax, ay)) return -1;
    return ax >= ay ? (dy > 0 ? 2 : 0) : (dx > 0 ? 1 : 3);
  }
  function swipe(dir, alt) {
    const r = run;
    if (!r || screen !== 'play') return false;
    if (r.phase === 'intro') beginPlay();
    if (r.phase !== 'play') return false;
    const lv = r.lv, st = r.st;
    if (st.moving >= 0) { r.queue = { dir, alt: alt == null ? -1 : alt, tap: -1 }; return true; }   // gliding: for when she stops
    let d = dir;
    if (!L.canPass(lv, st, st.cell, d) && alt >= 0 && L.canPass(lv, st, st.cell, alt)) d = alt;
    if (!L.canPass(lv, st, st.cell, d)) { bump(d); return false; }
    go(d, -1);
    return true;
  }
  function go(d, tapTo) {
    const r = run;
    r.queue = { dir: d, alt: -1, tap: tapTo };
    // nothing else moves in this level: start at once instead of at the next tick
    if (!r.lv.patrols.length && r.restTicks >= 1 && r.st.moving < 0) { r.tAcc = 0; doTick(); }
  }
  function tapAt(clientX, clientY) {
    const r = run;
    if (!r || screen !== 'play') return;
    if (r.phase === 'intro') beginPlay();
    if (r.phase !== 'play') return;
    const p = R.toWorld(clientX, clientY), lv = r.lv, lay = r.lay, st = r.st;
    const ix = R.cellX(lay, lv, st.cell), iy = R.cellY(lay, lv, st.cell), dx = p.x - ix, dy = p.y - iy;
    if (st.moving >= 0) { swipe(dominant(dx, dy), secondary(dx, dy)); return; }
    // the nearest spot she can swim straight to, if the tap is on (or near) it
    let best = null, bd = Infinity;
    for (let d = 0; d < 4; d++) {
      for (const t of L.tapRun(lv, st, st.cell, d)) {
        const dd = Math.hypot(p.x - R.cellX(lay, lv, t), p.y - R.cellY(lay, lv, t));
        if (dd < bd) { bd = dd; best = { d, t }; }
      }
    }
    if (best && bd <= lay.c * 0.75) { go(best.d, best.t); return; }
    if (Math.hypot(dx, dy) < lay.c * 0.5) return;   // a tap on Isabella herself
    swipe(dominant(dx, dy), secondary(dx, dy));     // anywhere else: swim that way
  }
  canvas.addEventListener('pointerdown', (e) => {
    A.init();
    if (screen !== 'play' || !run || gesture) return;
    gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ax: e.clientX, ay: e.clientY, fired: false, last: -1, run: 0 };
    if (run.phase === 'intro') beginPlay();
  });
  window.addEventListener('pointermove', (e) => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.ax, dy = e.clientY - g.ay, dist = Math.hypot(dx, dy), th = swipeMin();
    if (dist < th) return;
    const dir = dominant(dx, dy);
    if (dir !== g.last) { swipe(dir, secondary(dx, dy)); g.last = dir; g.run = 0; g.fired = true; }
    else { g.run += dist; if (g.run >= 3 * th) { swipe(dir, -1); g.run = 0; } }   // a long drag the same way: keep going
    g.ax = e.clientX; g.ay = e.clientY;
  });
  function lift(e) {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    gesture = null;
    if (g.fired || e.type === 'pointercancel') return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (Math.hypot(dx, dy) < swipeMin()) tapAt(e.clientX, e.clientY);
    else swipe(dominant(dx, dy), secondary(dx, dy));   // a quick flick
  }
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);

  // ---- buttons ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
  tap('resLevels', () => goLevels(run ? Math.floor((Math.min(NLEV, run.n + 1) - 1) / PER) : null));   // the page with the next level
  tap('resReplay', () => startLevel(run ? run.n : 1));
  tap('resNext', () => startLevel(Math.min(NLEV, (run ? run.n : 0) + 1)));
  tap('pgPrev', () => goLevels(page - 1));
  tap('pgNext', () => goLevels(page + 1));
  tap('soundBtn', () => { const m = !readMuted(); writeMuted(m); A.setMuted(m); setSoundIcon(); });
  $('homeBtn').addEventListener('click', () => { A.init(); A.click(); location.href = HUB; });

  // Grown-ups: hold the title for 4 seconds to open every level.
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { save.unlocked = NLEV; persist(); A.init(); A.key(); goLevels(page); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));

  // Android back button (called from MainActivity): back to the hub.
  window.__back = () => { location.href = '../../index.html'; return true; };
  window.__pause = () => { A.suspend(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) A.suspend();
    else { A.setMuted(readMuted()); A.resume(); }
  });
  window.addEventListener('pageshow', () => { A.setMuted(readMuted()); crown = crownEarned(); if (screen === 'levels') setSoundIcon(); });
  window.addEventListener('resize', () => { R.resize(); if (run) run.lay = R.layout(run.lv.W, run.lv.H); });

  // ---- main loop ----
  const perf = { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] };
  function frame(nowMs) {
    const raw = last ? (nowMs - last) / 1000 : 0, dt = Math.min(0.05, raw);
    last = nowMs; clock += dt;
    const t0 = performance.now();
    if (!run) R.drawMenu(clock, dt, { crown });
    else { update(dt); if (run) R.drawPlay(buildView(), clock, dt); }
    const d = performance.now() - t0;
    if (raw > 0) {
      perf.frames++; perf.dtSum += raw; perf.drawSum += d; perf.drawMax = Math.max(perf.drawMax, d);
      perf.dts.push(raw); perf.draws.push(d);
      if (perf.dts.length > 600) { perf.dts.shift(); perf.draws.shift(); }
    }
    requestAnimationFrame(frame);
  }

  // ---- hooks for tests (test/games/maze/) ----
  const DIRN = { up: 0, right: 1, down: 2, left: 3 };
  const toDir = (d) => (typeof d === 'number' ? d : DIRN[d]);
  const cssPt = (x, y) => R.toCss(x, y);
  window.__mazeDebug = {
    get state() {
      const r = run, st = r && r.st;
      return {
        screen, page, muted: A.muted, gain: A.gain, save: JSON.parse(JSON.stringify(save)), vw: R.VW, dpr: R.dpr, crown,
        level: r ? r.n : null, phase: r ? r.phase : null, tick: r ? r.tick : null,
        pos: r ? { cell: st.cell, x: r.lv.cx[st.cell], y: r.lv.cy[st.cell] } : null,
        resting: r ? st.moving < 0 : null, won: r ? st.won : null,
        keys: r ? Array.from(st.items).map((v, i) => (v === L.HELD ? i : -1)).filter((i) => i >= 0) : [],
        gates: r ? Array.from(st.items).map((v, i) => (v === L.OPEN ? i : -1)).filter((i) => i >= 0) : [],
        moves: r ? r.moves : null, optimal: r ? r.par : null,
        stars: r ? (r.results || r.phase === 'win' ? r.stars : L.starsFor(r.par, r.moves)) : null,
        resultsStars: r && r.results ? r.stars : null,
        shell: r ? st.cp : null, patrols: r ? Array.from(st.pp) : [], dark: r ? r.lv.dark : 0,
        hint: r && r.hint ? { dir: L.DIRS[r.hint.dir], at: r.hint.at, cells: r.hint.cells.slice() } : null, hints: r ? r.hints : 0,
        queued: r ? !!r.queue || r.schedule.length > 0 : false, particles: R.particles,
        cell: r ? (() => { const a = cssPt(r.lay.x0, r.lay.y0), b = cssPt(r.lay.x0 + r.lay.c, r.lay.y0 + r.lay.c); return { w: b.x - a.x, vh: ((b.y - a.y) / innerHeight) * 100 }; })() : null,
      };
    },
    start(n) { startLevel(n); return true; },
    // like a swipe; with atTick, waits until that logic tick (and until she is resting) to start
    move(dir, atTick) {
      const d = toDir(dir), r = run;
      if (!r || d == null) return false;
      if (atTick == null) return swipe(d, -1);
      if (r.phase === 'intro') beginPlay();
      r.schedule.push({ dir: d, at: atTick, tap: -1 });
      return true;
    },
    // the solver's way out from exactly here: [{ dir, at (logic tick to start), ticks, cells }]
    solve() {
      const r = run;
      if (!r || r.st.moving >= 0) return null;
      const sol = L.solve(r.lv, r.st, r.tick);
      return sol && { tick: r.tick, par: sol.par, steps: sol.steps.map((s) => ({ dir: L.DIRS[s.dir], at: s.at, ticks: s.ticks, cells: s.cells })) };
    },
    cellCss(cell) { const r = run; if (!r) return null; return cssPt(R.cellX(r.lay, r.lv, cell), R.cellY(r.lay, r.lv, cell)); },
    isabellaCss() { const r = run; if (!r) return null; return cssPt(R.cellX(r.lay, r.lv, r.st.cell), R.cellY(r.lay, r.lv, r.st.cell)); },
    tapRun(dir) { const r = run; return r ? L.tapRun(r.lv, r.st, r.st.cell, toDir(dir)) : []; },
    showHint() { if (run && run.phase === 'play' && run.st.moving < 0) showHint(); return run && run.hint ? true : false; },
    idle(seconds) { if (run) run.lastProgress -= seconds; },
    reset() { save = freshSave(); persist(); goLevels(0); },
    unlockAll() { save.unlocked = NLEV; persist(); if (screen === 'levels') goLevels(page); },
    perf() {
      const sorted = perf.draws.slice().sort((a, b) => a - b), dts = perf.dts.slice().sort((a, b) => a - b);
      const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
      return { frames: perf.frames, fps: perf.frames / (perf.dtSum || 1), drawAvgMs: perf.drawSum / (perf.frames || 1), drawP95Ms: q(sorted, 0.95), drawMaxMs: perf.drawMax, frameP95Ms: q(dts, 0.95) * 1000 };
    },
    resetPerf() { Object.assign(perf, { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] }); },
  };

  // ?level=4 jumps straight into a level (handy for screenshots)
  const qLevel = +new URLSearchParams(location.search).get('level');
  goLevels();
  if (qLevel >= 1 && qLevel <= NLEV) startLevel(qLevel);
  requestAnimationFrame(frame);
})();
