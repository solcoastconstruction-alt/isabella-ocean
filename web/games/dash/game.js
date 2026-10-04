/* Splash Dash — screens, steering, the speed button, saving and the main loop. Rules live in logic.js, drawing
 * in art.js, sound in sound.js.
 *
 * Steering. Everything that steers her goes through ONE function, setSteer(x) with x from -1 (hard left) to 1
 * (hard right):
 *   - a finger held or dragged to her left or right (always works);
 *   - leaning the phone like a steering wheel: devicemotion's accelerationIncludingGravity through logic.js's Tilt
 *     filter (deviceorientation only if devicemotion is silent: on the Seeker it arrives five times a second, against
 *     sixty), which takes over only once real, changing sensor data has arrived. Left side down steers left;
 *   - window.__steer(x), for a native sensor bridge should a WebView ever not deliver sensor events (the Seeker's
 *     does), or window.__tilt(ax, ay, az, rotationDegrees) to hand over raw accelerometer readings instead;
 *   - the arrow keys (a desktop browser).
 * window.__dbg says which of these is steering right now and shows the last sensor values. */
(function () {
  'use strict';
  const L = DashLogic, R = DashArt, A = DashSound;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, PER = 10, PAGES = Math.ceil(NLEV / PER), HUB = '../../index.html';
  const clamp = L.clamp;
  const smooth = (u) => u * u * (3 - 2 * u);
  const CHEST_BONUS = 10;      // coins from the chest, on top of the ones she collected
  const PARTY_AT = 0.5, RESULTS_AT = 2.9;

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
  // game.dash.save = { unlocked, stars: [20], best: [20] (most coins kept on each course), coins (all she has ever
  // brought home), boosted (has she found the speed button yet?) }
  const SAVE_KEY = 'game.dash.save', MAIN_KEY = 'isabella.save';
  const freshSave = () => ({ unlocked: 1, stars: new Array(NLEV).fill(0), best: new Array(NLEV).fill(0), coins: 0, boosted: false });
  function loadSave() {
    const sv = freshSave();
    try {
      const raw = JSON.parse(store.get(SAVE_KEY) || 'null');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        sv.stars = Array.from({ length: NLEV }, (_, i) => clamp(Math.floor(Number((raw.stars || [])[i]) || 0), 0, 3));
        sv.best = Array.from({ length: NLEV }, (_, i) => clamp(Math.floor(Number((raw.best || [])[i]) || 0), 0, 9999));
        const beaten = sv.stars.reduce((m, st, i) => (st > 0 ? i + 1 : m), 0);
        sv.unlocked = clamp(Math.max(Math.floor(Number(raw.unlocked) || 1), beaten + 1), 1, NLEV);
        sv.coins = clamp(Math.floor(Number(raw.coins) || 0), 0, 99999999);
        sv.boosted = !!raw.boosted;
      }
    } catch (e) { /* a broken save starts fresh */ }
    return sv;
  }
  let save = loadSave();
  const persist = () => store.set(SAVE_KEY, JSON.stringify(save));
  // Sound follows the main game's mute switch (isabella.save, as the other games do), and the switch on the level
  // select flips that same switch: it rewrites only the `muted` field, and never a save it cannot read.
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
  const crownEarned = () => { const m = readMain(); return !!(m && m.crown); };

  // ---- state ----
  let screen = 'levels', page = 0, run = null, level = 0, clock = 0, last = 0, crown = crownEarned();
  let timers = [], streak = 0, streakT = 0, shownCoins = -1, ringShown = -1, sprayAcc = 0, sparkAcc = 0, resultsShown = false;
  const canvas = $('c');
  R.init(canvas);
  A.setMuted(readMuted());
  // what art.js draws from (one object, reused every frame)
  const view = {
    run: null, n: 1, crown: false, chestOpen: 0, party: -1, pan: 0, hint: '', hintT: 0, flow: 0,
    isa: { bank: 0, wobble: 0, ph: 0, fast: 0, alpha: 1, happy: false, hide: false, crown: false },
    isaAt: { x: 600, y: R.ISA_Y }, chestAt: { x: 0, y: 0, k: 1 },
  };
  let wobT = 9, steered = 0, hintOff = false;

  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  function setSoundIcon() { $('soundBtn').querySelector('use').setAttribute('href', readMuted() ? '#i-mute' : '#i-sound'); }

  // ---- level select ----
  function goLevels(pg) {
    screen = 'levels'; run = null; view.run = null; timers = [];
    releaseAll();
    document.body.classList.remove('play', 'swim');
    R.clearParticles();
    page = pg != null ? clamp(pg, 0, PAGES - 1) : Math.floor((Math.min(save.unlocked, NLEV) - 1) / PER);
    const grid = $('grid'); grid.innerHTML = '';
    for (let k = page * PER + 1; k <= Math.min(NLEV, (page + 1) * PER); k++) {
      const th = R.themeOf(k), locked = k > save.unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (k === save.unlocked && !save.stars[k - 1] ? ' next' : '');
      b.dataset.level = k;
      b.setAttribute('aria-label', `Course ${k}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65), ${th.top} 45%, ${th.bot})`;
      b.innerHTML = `<div class="num ol-navy">${k}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < save.stars[k - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        A.init();
        if (locked) { A.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        A.click(); startLevel(k);
      });
      grid.appendChild(b);
    }
    $('pgPrev').style.visibility = page > 0 ? 'visible' : 'hidden';
    $('pgNext').style.visibility = page < PAGES - 1 ? 'visible' : 'hidden';
    $('pgDots').innerHTML = Array.from({ length: PAGES }, (_, i) => `<span class="${i === page ? 'on' : ''}"></span>`).join('');
    $('starCount').textContent = `${save.stars.reduce((a, b) => a + b, 0)}/${NLEV * 3}`;
    $('coinTotal').textContent = String(save.coins);
    setSoundIcon();
    show('levels');
    A.rush(-1);
    A.startMusic('menu');
  }

  // ---- a course ----
  function startLevel(n) {
    level = n;
    run = new L.Run(n);
    view.run = run; view.n = n; view.crown = crown; view.chestOpen = 0; view.party = -1; view.pan = 0; view.hint = ''; view.hintT = 0;
    const I = view.isa;
    I.bank = 0; I.wobble = 0; I.ph = 0; I.fast = 0; I.alpha = 1; I.happy = false; I.hide = false; I.crown = crown;
    timers = []; streak = 0; streakT = 0; shownCoins = -1; ringShown = -1; wobT = 9; steered = 0; hintOff = n > 2; resultsShown = false;
    releaseAll();
    screen = 'play'; show(null);
    document.body.classList.add('play', 'swim');
    $('goBtn').classList.toggle('hint', !save.boosted);
    R.clearParticles(); R.resetView(); R.warm(Math.floor((n - 1) / 4));
    A.startMusic(n); A.start();
  }
  function later(t, fn) { timers.push({ t, fn }); }
  // a place on the water, on the screen
  function at(s, x) { const p = R.proj(s - run.s, x); return p; }

  function onEvents() {
    const ev = run.ev, I = view.isa;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'coin') {
        streak = streakT > 0 ? streak + 1 : 0; streakT = 1.1;
        const p = at(e.s, e.x), up = (22 + e.o.h) * p.k;
        R.burst('coin', p.x, p.y - up);
        if (e.o.air) A.airCoin(streak); else A.coin(streak);
      } else if (e.type === 'bump') {
        e.o.hitT = clock; wobT = 0; streak = 0;
        R.burst('splash', view.isaAt.x, R.ISA_Y - 6, 1.1);
        A.bump(e.o.k);
      } else if (e.type === 'spill') { R.burst('spill', view.isaAt.x, R.ISA_Y - 30); A.spill(); }
      else if (e.type === 'kelp') { R.burst('leaf', view.isaAt.x, R.ISA_Y); A.kelp(); }
      else if (e.type === 'leap') { R.burst('splash', view.isaAt.x, R.ISA_Y, 0.9); R.burst('star', view.isaAt.x, R.ISA_Y - 30); A.leap(); }
      else if (e.type === 'land') { R.burst('splash', view.isaAt.x, R.ISA_Y + 6, 1.2); A.land(); }
      else if (e.type === 'bob') { R.burst('plop', view.isaAt.x, R.ISA_Y); A.bob(); }
      else if (e.type === 'finish') finished();
      else if (e.type === 'chest') atChest();
    }
    ev.length = 0;
  }
  // over the line: the stars are settled and saved at once (so leaving during the party loses nothing)
  function finished() {
    const n = level;
    save.stars[n - 1] = Math.max(save.stars[n - 1], run.stars);
    save.best[n - 1] = Math.max(save.best[n - 1], run.coinCount);
    save.coins += run.coinCount + CHEST_BONUS;
    save.unlocked = Math.min(NLEV, Math.max(save.unlocked, n + 1));
    persist();
    releaseAll();
    document.body.classList.remove('swim');
    A.line(); A.rush(-1);
    R.burst('confetti', R.VW / 2, 120);
  }
  // at the treasure chest: it bursts open, and she leaps about
  function atChest() {
    const big = level === NLEV, I = view.isa, c = view.chestAt;
    I.happy = true;
    later(0.3, () => { A.fanfare(big); A.cheer(); R.fountain(c.x, c.y, big ? 70 : 40, c.y + 80 * c.k); });
    later(PARTY_AT, () => { I.hide = true; view.party = 0; R.burst('splash', view.isaAt.x, R.ISA_Y, 1.2); });
    later(0.95, () => { R.fountain(c.x, c.y, big ? 44 : 22, c.y + 80 * c.k); R.burst('cheer', c.x, c.y - 60); });
    later(1.5, () => { R.fountain(c.x, c.y, big ? 44 : 20, c.y + 80 * c.k); R.burst('notes', c.x, c.y - 80); });
    later(RESULTS_AT, showResults);
  }
  function showResults() {
    screen = 'results'; resultsShown = true;
    const box = $('bigStars'), stars = run.stars;
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < stars)).join('');
    $('resCoins').textContent = String(run.coinCount);
    $('resOf').textContent = '/ ' + run.lev.groundTotal;
    $('resNext').style.display = level < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < stars) A.star(i); }));
  }

  // ---- steering: everything goes through setSteer ----
  let steer = 0, steerSrc = 'none';
  function setSteer(x, src) { steer = clamp(+x || 0, -1, 1); steerSrc = src || 'bridge'; return steer; }
  const touch = { id: null, x: 0 }, keys = { l: false, r: false, go: false }, ext = { at: -1e9 };
  const tilt = new L.Tilt();
  const sens = { motion: 0, motionNull: 0, orient: 0, orientNull: 0, lastMotion: -1e9, reported: 0, used: 0, guess: null, asked: 0, permission: { motion: 'not asked', orientation: 'not asked' } };
  // The Seeker's WebView hands out devicemotion events without being asked (checked on the phone: 60 a second, with
  // no touch and no permission call), and so does Chrome. But DeviceMotionEvent.requestPermission exists there too,
  // so if no sensor data at all has arrived a moment after the first touch, ask for it from inside that touch (and
  // again from a later touch, three times at most). It is never needed for the game to run: a refusal, a rejected
  // promise or an exception only ends up in the readout (window.__dbg.sensors.permission).
  function askSensors() {
    if (tilt.samples > 0 || sens.asked >= 3) return;
    sens.asked++;
    for (const [name, E] of [['motion', window.DeviceMotionEvent], ['orientation', window.DeviceOrientationEvent]]) {
      if (!E || typeof E.requestPermission !== 'function') { sens.permission[name] = E ? 'not needed' : 'no such event'; continue; }
      try {
        const p = E.requestPermission();
        if (p && typeof p.then === 'function') p.then((r) => { sens.permission[name] = String(r); }, (err) => { sens.permission[name] = 'refused (' + ((err && err.name) || err) + ')'; });
        else sens.permission[name] = String(p);
      } catch (err) { sens.permission[name] = 'error (' + ((err && err.name) || err) + ')'; }
    }
  }
  let askTimer = null;
  window.addEventListener('pointerup', () => {
    if (tilt.samples > 0 || sens.asked >= 3 || askTimer) return;
    askTimer = setTimeout(() => { askTimer = null; askSensors(); }, sens.asked ? 0 : 1000);   // the first time: give the sensors a moment
  });
  function reportedAngle() {
    const o = window.screen && window.screen.orientation;
    if (o && typeof o.angle === 'number') return o.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return innerWidth > innerHeight ? 90 : 0;
  }
  // one sensor sample, from wherever it came: the "up" vector in the phone's own axes
  function feedTilt(ax, ay, az, angle, src) {
    const now = performance.now();
    if (angle == null) {
      sens.reported = reportedAngle();
      angle = L.screenAngleFor(sens.reported, innerWidth > innerHeight, ax, ay, sens.guess);
      if ((angle === 90 || angle === 270) && L.normAngle(sens.reported) !== angle) sens.guess = angle;
    }
    sens.used = L.normAngle(angle);
    return tilt.push(ax, ay, az, angle, now, src);
  }
  window.addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity;
    sens.motion++;
    if (!g || g.x == null || g.y == null || g.z == null) { sens.motionNull++; return; }
    if (feedTilt(g.x, g.y, g.z, null, 'motion')) sens.lastMotion = performance.now();
  });
  const _g = [0, 0, 0];
  window.addEventListener('deviceorientation', (e) => {
    sens.orient++;
    if (e.beta == null || e.gamma == null) { sens.orientNull++; return; }
    if (performance.now() - sens.lastMotion < 400) return;   // devicemotion is delivering: one source is enough
    L.gravityFromOrientation(e.beta, e.gamma, _g);
    feedTilt(_g[0], _g[1], _g[2], null, 'orient');
  });
  // for a native bridge: steer directly, or hand over raw accelerometer readings (m/s^2, the phone's own axes)
  // with the display's rotation in degrees (0, 90, 180, 270)
  window.__steer = (x) => { ext.at = performance.now(); return setSteer(x, 'bridge'); };
  window.__tilt = (ax, ay, az, rotationDegrees) => { feedTilt(+ax, +ay, +az, rotationDegrees == null ? null : +rotationDegrees, 'bridge'); return tilt.value; };

  // which input steers this frame
  function pickSteer(now) {
    if (touch.id != null) {
      // a finger: she swims toward it (full steer when it is 9% of the screen's width to one side of her)
      const her = (view.isaAt.x * R.scale) / R.dpr, dx = touch.x - her, full = Math.max(40, innerWidth * 0.09);
      setSteer(Math.abs(dx) < 5 ? 0 : dx / full, 'touch');
    } else if (keys.l || keys.r) setSteer((keys.r ? 1 : 0) - (keys.l ? 1 : 0), 'keys');
    else if (now - ext.at < 500) { /* a bridge called __steer just now: what it set stands */ }
    else if (tilt.live(now)) setSteer(tilt.value, 'tilt');
    else setSteer(0, 'none');
  }

  // ---- the speed button ----
  const go = { id: null, held: false };
  function pressGo(id) {
    if (screen !== 'play' || !run || run.phase !== 'play') return;
    go.id = id; go.held = true;
    $('goBtn').classList.add('down');
    if (!save.boosted) { save.boosted = true; persist(); $('goBtn').classList.remove('hint'); }
    A.boost();
  }
  function releaseGo() { go.id = null; go.held = false; $('goBtn').classList.remove('down'); }
  function releaseAll() { releaseGo(); touch.id = null; keys.l = keys.r = keys.go = false; }
  const goBtn = $('goBtn');
  goBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); A.init();
    if (go.id != null) return;
    try { goBtn.setPointerCapture(e.pointerId); } catch (err) { /* not every pointer can be captured */ }
    pressGo(e.pointerId);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    goBtn.addEventListener(type, (e) => { if (e.pointerId === go.id) releaseGo(); });
    window.addEventListener(type, (e) => { if (e.pointerId === go.id) releaseGo(); });
  }
  goBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- a finger on the water steers ----
  canvas.addEventListener('pointerdown', (e) => {
    A.init();
    if (screen !== 'play' || !run || touch.id != null) return;
    touch.id = e.pointerId; touch.x = e.clientX;
  });
  window.addEventListener('pointermove', (e) => { if (e.pointerId === touch.id) touch.x = e.clientX; });
  function lift(e) { if (e.pointerId === touch.id) touch.id = null; }
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // a desktop browser: arrow keys steer, space (or the up arrow) is the speed button
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.l = true; else if (e.key === 'ArrowRight') keys.r = true;
    else if ((e.key === ' ' || e.key === 'ArrowUp') && !keys.go) { keys.go = true; if (!go.held) pressGo('key'); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.l = false; else if (e.key === 'ArrowRight') keys.r = false;
    else if (e.key === ' ' || e.key === 'ArrowUp') { keys.go = false; if (go.id === 'key') releaseGo(); }
  });
  // anything that takes the page away lets go of everything
  window.addEventListener('blur', releaseAll);

  // ---- the clock ----
  function update(dt, now) {
    const I = view.isa;
    for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= dt; if (tm.t <= 0) { timers.splice(i, 1); tm.fn(); if (!run) return; } }
    pickSteer(now);
    const playing = run.phase === 'play';
    run.step(dt, playing ? steer : 0, playing && go.held);
    onEvents();
    if (!run) return;

    // how she looks
    I.fast = run.boost;
    I.ph += dt * (6.5 + 7.5 * I.fast);
    I.bank += (clamp(run.vx / L.VX_MAX, -1, 1) - I.bank) * Math.min(1, dt * 10);
    wobT += dt;
    I.wobble = wobT < 1 ? Math.sin(wobT * 22) * 0.3 * (1 - wobT) : 0;
    I.alpha = run.inv > 0 && run.phase === 'play' ? 0.62 + 0.38 * Math.sin(clock * 30) : 1;
    view.flow = run.v * (R.GY / R.D0);
    if (run.phase !== 'play') view.pan = Math.min(1, view.pan + dt / 1.6);
    if (view.party >= 0) view.party += dt;
    if (run.phase === 'done') view.chestOpen = smooth(clamp((run.st - 0.25) / 0.4, 0, 1));
    if (resultsShown && Math.random() < dt * 0.8) R.burst('cheer', view.chestAt.x + (Math.random() - 0.5) * 60, view.chestAt.y - 40);
    streakT -= dt;

    // spray from her tail, more of it the faster she goes; a rainbow sparkle when she is really moving
    if (playing && run.z < 2) {
      sprayAcc += dt * (9 + 26 * I.fast);
      while (sprayAcc >= 1) { sprayAcc -= 1; R.spawn({ t: 'foam', x: view.isaAt.x + (Math.random() - 0.5) * 34 - I.bank * 14, y: R.ISA_Y + 78 + Math.random() * 18, vx: (Math.random() - 0.5) * 30, vy: 0, life: 0.55, max: 0.55, r: 6 + Math.random() * 7 }); }
      sparkAcc += dt * 16 * Math.max(0, I.fast - 0.45);
      while (sparkAcc >= 1) { sparkAcc -= 1; R.spawn({ t: 'spark', x: view.isaAt.x + (Math.random() - 0.5) * 30, y: R.ISA_Y + 70 + Math.random() * 24, vx: (Math.random() - 0.5) * 60, vy: 140 + Math.random() * 80, life: 0.5, max: 0.5, c: ['#ff4d6d', '#ffd93d', '#5ad17a', '#4cc9f0', '#c86bfa'][Math.floor(Math.random() * 5)], r: 3 + Math.random() * 3.5 }); }
    }
    if (playing) A.rush(run.z > 2 ? 0 : 0.15 + 0.85 * I.fast);

    // the coin counter and the ring round the speed button
    if (run.coinCount !== shownCoins) {
      const up = run.coinCount > shownCoins && shownCoins >= 0;
      shownCoins = run.coinCount; $('coinCount').textContent = String(shownCoins);
      if (up) { const h = $('hud'); h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump'); }
    }
    const ring = Math.round(run.boost * 100);
    if (ring !== ringShown) { ringShown = ring; $('goRing').style.strokeDashoffset = String(289 * (1 - ring / 100)); }

    // courses 1 and 2: show how to steer, until she has
    steered += Math.abs(run.vx) * dt;
    if (!hintOff && (steered > 260 || run.t > 9 || run.s > 2600 || !playing)) hintOff = true;
    view.hint = hintOff || run.t < 0.6 ? '' : tilt.live(now) && touch.id == null ? 'tilt' : 'touch';
    view.hintT = view.hint ? view.hintT + dt : 0;
  }

  // ---- buttons ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
  tap('resLevels', () => goLevels(Math.floor((Math.min(NLEV, level + 1) - 1) / PER)));   // the page with the next course
  tap('resReplay', () => startLevel(level || 1));
  tap('resNext', () => startLevel(Math.min(NLEV, level + 1)));
  tap('pgPrev', () => goLevels(page - 1));
  tap('pgNext', () => goLevels(page + 1));
  tap('soundBtn', () => { const m = !readMuted(); writeMuted(m); A.setMuted(m); setSoundIcon(); });
  $('homeBtn').addEventListener('click', () => { A.init(); A.click(); location.href = HUB; });

  // Grown-ups: hold the title for 4 seconds to open every course.
  let holdT = null;
  const unlockAll = () => { save.unlocked = NLEV; persist(); };
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { unlockAll(); A.init(); A.star(2); goLevels(page); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));

  // Android back button (called from MainActivity): back to the hub.
  window.__back = () => { location.href = '../../index.html'; return true; };
  window.__pause = () => { releaseAll(); A.suspend(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseAll(); A.suspend(); }
    else { A.setMuted(readMuted()); A.resume(); }
  });
  window.addEventListener('pagehide', releaseAll);
  window.addEventListener('pageshow', () => { A.setMuted(readMuted()); crown = crownEarned(); if (screen === 'levels') setSoundIcon(); });
  window.addEventListener('resize', () => R.resize());

  // ---- the readout for grown-ups: which input is steering, and what the sensors last said ----
  const dbgEl = $('dbg');
  let dbgOn = false, dbgT = 0;
  const round = (v, d) => (Number.isFinite(v) ? +v.toFixed(d == null ? 2 : d) : null);
  window.__dbg = {
    get input() { return steerSrc; },
    get steer() { return round(steer, 3); },
    get boost() { return go.held; },
    get speed() { return run ? round(run.v, 1) : null; },
    get tilt() {
      const now = performance.now();
      return { live: tilt.live(now), onItsSide: tilt.off, source: tilt.src, samples: tilt.samples, changes: tilt.changes, x: round(tilt.ax, 3), y: round(tilt.ay, 3), z: round(tilt.az, 3),
        lean: round(tilt.lean, 2), raw: round(tilt.raw, 3), value: round(tilt.value, 3), ageMs: tilt.samples ? Math.round(now - tilt.lastT) : null };
    },
    get sensors() {
      return { motionEvents: sens.motion, motionNull: sens.motionNull, orientationEvents: sens.orient, orientationNull: sens.orientNull, angleReported: sens.reported, angleUsed: sens.used,
        secureContext: !!window.isSecureContext, hasMotion: 'DeviceMotionEvent' in window, hasOrientation: 'DeviceOrientationEvent' in window,
        asked: sens.asked, permission: sens.permission.motion + ' / ' + sens.permission.orientation };
    },
    text() {
      const t = this.tilt, q = this.sensors;
      return `input ${steerSrc}  steer ${steer.toFixed(2)}  boost ${go.held ? 'ON' : 'off'}  speed ${run ? Math.round(run.v) : '-'}\n`
        + `tilt ${t.live ? 'LIVE' : t.onItsSide ? 'on its side' : 'idle'} (${t.source || 'no data'})  lean ${t.lean}°  -> ${t.value}\n`
        + `up x ${t.x} y ${t.y} z ${t.z}  samples ${t.samples} changed ${t.changes}\n`
        + `events motion ${q.motionEvents} (null ${q.motionNull}) orient ${q.orientationEvents} (null ${q.orientationNull})\n`
        + `angle ${q.angleReported} used ${q.angleUsed}  secure ${q.secureContext}  asked: ${q.permission}`;
    },
    show(on) { dbgOn = on == null ? !dbgOn : !!on; dbgEl.style.display = dbgOn ? 'block' : 'none'; return dbgOn; },
  };
  let hudHold = null;
  $('hud').addEventListener('pointerdown', () => { clearTimeout(hudHold); hudHold = setTimeout(() => window.__dbg.show(), 3000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('hud').addEventListener(ev, () => clearTimeout(hudHold));

  // ---- main loop ----
  const perf = { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] };
  function frame(nowMs) {
    const raw = last ? (nowMs - last) / 1000 : 0, dt = Math.min(0.05, raw);
    last = nowMs; clock += dt;
    const t0 = performance.now();
    if (!run) R.drawMenu(clock, dt, { crown });
    else {
      update(dt, t0);
      if (run) R.drawPlay(view, clock, dt);
    }
    const d = performance.now() - t0;
    if (raw > 0) {
      perf.frames++; perf.dtSum += raw; perf.drawSum += d; perf.drawMax = Math.max(perf.drawMax, d);
      if (perf.dts.length >= 600) { perf.dts.shift(); perf.draws.shift(); }
      perf.dts.push(raw); perf.draws.push(d);
    }
    if (dbgOn && (dbgT += dt) > 0.2) { dbgT = 0; dbgEl.textContent = window.__dbg.text(); }
    requestAnimationFrame(frame);
  }

  // ---- hooks for tests (test/games/dash/) ----
  window.__dashDebug = {
    get state() {
      const r = run, her = R.toCss(view.isaAt.x, view.isaAt.y);
      return {
        screen, page, level: r ? level : null, phase: r ? r.phase : null, muted: A.muted, gain: A.gain, save: JSON.parse(JSON.stringify(save)), vw: R.VW, dpr: R.dpr, crown,
        s: r ? r.s : null, x: r ? r.x : null, v: r ? r.v : null, vx: r ? r.vx : null, z: r ? r.z : null, t: r ? r.t : null, len: r ? r.lev.len : null,
        boost: r ? r.boost : null, held: go.held, steer, input: steerSrc, touching: touch.id != null,
        coins: r ? r.coinCount : null, picked: r ? r.picked : null, total: r ? r.lev.total : null, ground: r ? r.lev.groundTotal : null, bumps: r ? r.bumps : null, spilled: r ? r.spilled : null,
        leaps: r ? r.leaps : null, inv: r ? r.inv : null, stars: r ? r.stars : null, chestOpen: view.chestOpen, party: view.party, results: resultsShown, hint: view.hint,
        her, particles: R.particles, tiltLive: tilt.live(performance.now()),
      };
    },
    get run() { return run; },
    start(n) { startLevel(n); return true; },
    levels(pg) { goLevels(pg); return true; },
    // jump along the course (for the tests: to reach the finish, or a particular thing, without the swim)
    warp(s, x) {
      if (!run) return false;
      run.s = s; if (x != null) run.x = x;
      run.ci = 0; run.ri = 0; while (run.ri < run.lev.ramps.length && run.lev.ramps[run.ri].s <= s) run.ri++;
      R.resetView();
      return true;
    },
    reset() { save = freshSave(); persist(); goLevels(0); },
    unlockAll() { unlockAll(); if (screen === 'levels') goLevels(page); },
    resetTilt() { tilt.reset(); sens.guess = null; ext.at = -1e9; },
    perf() {
      const sorted = perf.draws.slice().sort((a, b) => a - b), dts = perf.dts.slice().sort((a, b) => a - b);
      const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
      return { frames: perf.frames, fps: perf.frames / (perf.dtSum || 1), drawAvgMs: perf.drawSum / (perf.frames || 1), drawP95Ms: q(sorted, 0.95), drawMaxMs: perf.drawMax, frameP95Ms: q(dts, 0.95) * 1000 };
    },
    resetPerf() { Object.assign(perf, { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] }); },
  };

  // ?level=4 jumps straight into a course (handy for screenshots); ?dbg=1 shows the sensor readout
  const q = new URLSearchParams(location.search), qLevel = +q.get('level');
  if (q.get('dbg')) window.__dbg.show(true);
  goLevels();
  if (qLevel >= 1 && qLevel <= NLEV) startLevel(qLevel);
  requestAnimationFrame(frame);
})();
