/* Rainbow Slide — screens, steering, saving and the main loop. Rules live in logic.js, drawing in art.js (through the
 * shared window.FairyArt), sound in sound.js.
 *
 * Steering. Everything that steers her goes through ONE function, setSteer(x) with x from -1 (hard left) to 1
 * (hard right):
 *   - a finger held on the screen to her left or right (always works);
 *   - leaning the phone like a steering wheel: devicemotion's accelerationIncludingGravity through logic.js's Tilt
 *     filter (deviceorientation only if devicemotion is silent), which takes over only once real, changing sensor data
 *     has arrived. Left side down steers left. (The same model, and the same checks, as Splash Dash.)
 *   - window.__steer(x), for a native sensor bridge, or window.__tilt(ax, ay, az, rotationDegrees) for raw readings;
 *   - the arrow keys (a desktop browser).
 * window.__dbg says which of these is steering right now and shows the last sensor values. */
(function () {
  'use strict';
  const L = SlideLogic, R = SlideArt, A = SlideSound, F = FairyArt;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, PER = 10, PAGES = Math.ceil(NLEV / PER), HUB = '../../index.html';
  const MODES = L.MODE_IDS;
  const clamp = L.clamp, smooth = L.smooth;
  const CHEST_BONUS = 10;      // coins from the chest, on top of the ones she collected
  const PARTY_AT = 0.35, RESULTS_AT = 3.2;

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
  // game.slide.save = { v: 1, mode, unlocked: { easy, medium, hard }, stars: { easy: [20], ... }, best: { ...: [20] } (most lane coins kept on
  // each course), coins (all she has ever brought home), taught (has she steered yet?) }
  const SAVE_KEY = 'game.slide.save', MAIN_KEY = 'isabella.save';
  const zeros = () => new Array(NLEV).fill(0);
  const freshSave = () => ({ v: 1, mode: 'easy', unlocked: { easy: 1, medium: 1, hard: 1 }, stars: { easy: zeros(), medium: zeros(), hard: zeros() }, best: { easy: zeros(), medium: zeros(), hard: zeros() }, coins: 0, taught: false });
  function loadSave() {
    const sv = freshSave();
    try {
      const raw = JSON.parse(store.get(SAVE_KEY) || 'null');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (MODES.includes(raw.mode)) sv.mode = raw.mode;
        for (const m of MODES) {
          const st = raw.stars && Array.isArray(raw.stars[m]) ? raw.stars[m] : [], bs = raw.best && Array.isArray(raw.best[m]) ? raw.best[m] : [];
          sv.stars[m] = Array.from({ length: NLEV }, (_, i) => clamp(Math.floor(Number(st[i]) || 0), 0, 3));
          sv.best[m] = Array.from({ length: NLEV }, (_, i) => clamp(Math.floor(Number(bs[i]) || 0), 0, 9999));
          const beaten = sv.stars[m].reduce((a, s, i) => (s > 0 ? i + 1 : a), 0);
          sv.unlocked[m] = clamp(Math.max(Math.floor(Number(raw.unlocked && raw.unlocked[m]) || 1), beaten + 1), 1, NLEV);
        }
        sv.coins = clamp(Math.floor(Number(raw.coins) || 0), 0, 99999999);
        sv.taught = !!raw.taught;
      }
    } catch (e) { /* a broken save starts fresh */ }
    return sv;
  }
  let save = loadSave();
  let dirty = false, lastPersist = 0;
  const persist = () => { dirty = false; lastPersist = performance.now(); store.set(SAVE_KEY, JSON.stringify(save)); };
  const persistSoon = () => { dirty = true; };
  // Sound follows the main game's mute switch in isabella.save. It is only ever READ here, never written.
  function readMain() {
    try { const v = JSON.parse(store.get(MAIN_KEY) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return undefined; }
  }
  function readMuted() { const m = readMain(); return m === undefined ? false : !!(m && m.muted); }
  const crownEarned = () => { const m = readMain(); return !!(m && m.crown); };

  // ---- state ----
  let screen = 'levels', page = 0, run = null, level = 0, mode = save.mode, clock = 0, last = 0, crown = crownEarned();
  let timers = [], streak = 0, streakT = 0, shownCoins = -1, resultsShown = false, loopT = 0, keyT = -1;
  const canvas = $('c');
  R.init(canvas);
  A.setMuted(readMuted());
  // what art.js draws from (one object, reused every frame)
  const view = {
    run: null, n: 1, theme: 0, clock: 0, chestOpen: 0, party: -1, hint: '', hintT: 0, flash: 0, archHit: [], keyFly: -1,
    isa: { bank: 0, wobble: 0, flip: 1, alpha: 1, happy: false, hide: false, crown: false },
    isaAt: { x: 600, y: R.ISA_Y }, chestAt: { x: 0, y: 0, k: 1 },
  };
  let wobT = 9, steered = 0, hintOff = false;

  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(40,30,100,0.35)'}" stroke-width="1.5"/></svg>`;
  }

  // ---- level select: the mode, then ten bubbles a page, two pages (the two worlds) ----
  function setMode(m) {
    if (!MODES.includes(m)) return;
    mode = m;
    if (save.mode !== m) { save.mode = m; persist(); }
    for (const id of MODES) $('mode-' + id).classList.toggle('on', id === m);
  }
  function goLevels(pg, m) {
    screen = 'levels'; run = null; view.run = null; timers = [];
    flush();
    releaseAll();
    document.body.classList.remove('play');
    R.clearParticles();
    if (m) setMode(m); else setMode(mode);
    const unlocked = save.unlocked[mode], stars = save.stars[mode];
    page = pg != null ? clamp(pg, 0, PAGES - 1) : Math.floor((Math.min(unlocked, NLEV) - 1) / PER);
    const grid = $('grid'); grid.innerHTML = '';
    for (let k = page * PER + 1; k <= Math.min(NLEV, (page + 1) * PER); k++) {
      const th = F.THEMES[L.COURSES[k - 1].theme], locked = k > unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (k === unlocked && !stars[k - 1] ? ' next' : '');
      b.dataset.level = k;
      b.setAttribute('aria-label', `Course ${k}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.7), ${th.top} 45%, ${th.mid})`;
      b.innerHTML = `<div class="num ol-navy">${k}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < stars[k - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
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
    $('starCount').textContent = `${stars.reduce((a, b) => a + b, 0)}/${NLEV * 3}`;
    $('coinTotal').textContent = String(save.coins);
    show('levels');
    A.setKey(page ? 2 : 0);
    A.startMusic(page ? 2 : 1, page ? 2 : 0);
  }

  // ---- a course ----
  function startLevel(n, m) {
    if (m) setMode(m);
    flush();
    level = n;
    run = new L.Run(n, mode);
    const C = L.COURSES[n - 1];
    view.run = run; view.n = n; view.theme = C.theme; view.chestOpen = 0; view.party = -1; view.hint = ''; view.hintT = 0; view.flash = 0; view.keyFly = -1;
    view.archHit = []; view.clock = clock;
    const I = view.isa;
    I.bank = 0; I.wobble = 0; I.flip = 1; I.alpha = 1; I.happy = false; I.hide = false; I.crown = crown;
    timers = []; streak = 0; streakT = 0; shownCoins = -1; wobT = 9; steered = 0; hintOff = save.taught && n > 2; resultsShown = false; loopT = 0; keyT = -1;
    releaseAll();
    screen = 'play'; show(null);
    document.body.classList.add('play');
    $('keyIcon').classList.remove('on');
    R.clearParticles();
    A.setKey(C.world === 2 ? 2 : 0);
    A.startMusic(10 + n, C.world === 2 ? 2 : 0); A.start();
  }
  function later(t, fn) { timers.push({ t, fn }); }

  function onEvents() {
    const ev = run.ev, I = view.isa, herX = view.isaAt.x;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'coin') {
        streak = streakT > 0 ? streak + 1 : 0; streakT = 1.1;
        save.coins++; persistSoon();
        R.burst('coin', herX + clamp((e.x - run.x) * 0.5, -60, 60), R.ISA_Y - 30);
        A.coin(streak);
      } else if (e.type === 'poof') {
        e.o.hitT = clock; wobT = 0; streak = 0;
        R.burst('poof', herX, R.ISA_Y - 30);
        A.poof();
      } else if (e.type === 'spill') { save.coins = Math.max(0, save.coins - 1); persistSoon(); R.burst('spill', herX, R.ISA_Y - 40); A.spill(); }
      else if (e.type === 'rail') { wobT = 0.5; A.rail(); }
      else if (e.type === 'rim') { wobT = 0; R.burst('poof', herX + (e.x > 0 ? 40 : -40), R.ISA_Y - 10, 0.6); A.rail(); }
      else if (e.type === 'slip') { A.slip(); }
      else if (e.type === 'restore') { view.flash = 1; A.back(); }
      else if (e.type === 'back') { R.burst('star', herX, R.ISA_Y - 40); }
      else if (e.type === 'arch') { view.archHit[run.cpN - 1] = true; R.burst('arch', herX, R.ISA_Y - 60, 1); A.arch(); }
      else if (e.type === 'key') { $('keyIcon').classList.add('on'); R.burst('star', herX, R.ISA_Y - 50); A.key(); }
      else if (e.type === 'loop') { R.burst('shower', herX, 0); A.loop(); loopT = 0; }
      else if (e.type === 'loopEnd') { R.burst('shower', herX, 0); A.loopEnd(); }
      else if (e.type === 'finish') finished();
      else if (e.type === 'chest') atChest(e.o.hasKey);
      else if (e.type === 'open') openChest();
    }
    ev.length = 0;
  }
  // over the line: the stars are settled and saved at once (so leaving during the party loses nothing)
  function finished() {
    const n = level, st = save.stars[mode], bs = save.best[mode];
    st[n - 1] = Math.max(st[n - 1], run.stars);
    bs[n - 1] = Math.max(bs[n - 1], run.laneCount);
    save.unlocked[mode] = Math.min(NLEV, Math.max(save.unlocked[mode], n + 1));
    save.taught = true;
    persist();
    releaseAll();
    A.line();
    R.burst('confetti', R.VW / 2, 120);
  }
  // at the treasure chest: with the key it opens at once; without it the key floats down to her first
  function atChest(hasKey) {
    view.isa.happy = true;
    if (!hasKey) keyT = 0;
  }
  function openChest() {
    const big = level === NLEV, c = view.chestAt;
    keyT = -1; view.keyFly = -1;
    save.coins += CHEST_BONUS; persist();
    A.fanfare(big); A.cheer();
    later(0.05, () => { view.isa.hide = true; view.party = 0; R.fountain(c.x, c.y, big ? 70 : 40, c.y + 90 * c.k); });
    later(0.6, () => { R.fountain(c.x, c.y, big ? 44 : 22, c.y + 90 * c.k); R.burst('cheer', c.x, c.y - 60); });
    later(1.3, () => { R.fountain(c.x, c.y, big ? 44 : 20, c.y + 90 * c.k); R.burst('star', c.x, c.y - 80); });
    later(RESULTS_AT, showResults);
  }
  function showResults() {
    screen = 'results'; resultsShown = true;
    const box = $('bigStars'), stars = run.stars;
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < stars)).join('');
    $('resCoins').textContent = String(run.laneCount);
    $('resOf').textContent = '/ ' + run.lev.laneTotal;
    $('resNext').style.display = level < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < stars) A.star(i); }));
  }
  function flush() { if (dirty) persist(); }

  // ---- steering: everything goes through setSteer ----
  let steer = 0, steerSrc = 'none';
  function setSteer(x, src) { steer = clamp(+x || 0, -1, 1); steerSrc = src || 'bridge'; return steer; }
  const touch = { id: null, x: 0 }, keys = { l: false, r: false }, ext = { at: -1e9 };
  const tilt = new L.Tilt();
  const sens = { motion: 0, motionNull: 0, orient: 0, orientNull: 0, lastMotion: -1e9, reported: 0, used: 0, guess: null, asked: 0, permission: { motion: 'not asked', orientation: 'not asked' } };
  // The Seeker's WebView hands out devicemotion events without being asked (checked on the phone: 60 a second, with
  // no touch and no permission call), and so does Chrome. But DeviceMotionEvent.requestPermission exists in some
  // browsers, so if no sensor data at all has arrived a moment after the first touch, ask for it from inside that touch
  // (and again from a later touch, three times at most). It is never needed for the game to run: a refusal, a rejected
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
      // a finger: she slides toward it (full steer when it is 9% of the screen's width to one side of her)
      const her = (view.isaAt.x * R.scale) / R.dpr, dx = touch.x - her, full = Math.max(40, innerWidth * 0.09);
      setSteer(Math.abs(dx) < 5 ? 0 : dx / full, 'touch');
    } else if (keys.l || keys.r) setSteer((keys.r ? 1 : 0) - (keys.l ? 1 : 0), 'keys');
    else if (now - ext.at < 500) { /* a bridge called __steer just now: what it set stands */ }
    else if (tilt.live(now)) setSteer(tilt.value, 'tilt');
    else setSteer(0, 'none');
  }
  function releaseAll() { touch.id = null; keys.l = keys.r = false; }

  // ---- a finger on the screen steers ----
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
  // a desktop browser: the arrow keys steer
  window.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') keys.l = true; else if (e.key === 'ArrowRight') keys.r = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') keys.l = false; else if (e.key === 'ArrowRight') keys.r = false; });
  // anything that takes the page away lets go of everything
  window.addEventListener('blur', releaseAll);

  // ---- the clock ----
  function update(dt, now) {
    const I = view.isa;
    for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= dt; if (tm.t <= 0) { timers.splice(i, 1); tm.fn(); if (!run) return; } }
    pickSteer(now);
    const playing = run.phase === 'play';
    run.step(dt, playing ? steer : 0);
    onEvents();
    if (!run) return;
    view.clock = clock;

    // how she looks
    I.bank += (clamp(run.vx / L.VU_MAX, -1, 1) - I.bank) * Math.min(1, dt * 10);
    if (run.vx > 60) I.flip = 1; else if (run.vx < -60) I.flip = -1;
    wobT += dt;
    I.wobble = wobT < 1 ? Math.sin(wobT * 22) * 0.22 * (1 - wobT) : 0;
    I.alpha = run.inv > 0 && run.phase === 'play' ? 0.62 + 0.38 * Math.sin(clock * 30) : 1;
    if (view.party >= 0) view.party += dt;
    if (run.opened) view.chestOpen = smooth(clamp((run.st - (run.hadKey ? L.NEAR_OPEN : L.KEY_DELAY)) / 0.4, 0, 1));
    if (view.flash > 0) view.flash = Math.max(0, view.flash - dt * 1.6);
    if (keyT >= 0) { keyT += dt; view.keyFly = clamp(keyT / (L.KEY_DELAY - 0.1), 0, 1); }
    if (resultsShown && Math.random() < dt * 0.8) R.burst('cheer', view.chestAt.x + (Math.random() - 0.5) * 60, view.chestAt.y - 40);
    streakT -= dt;
    // a shower of sparkles all the way round a loop
    if (run.loop >= 0 && (loopT += dt) > 0.22) { loopT = 0; R.burst('shower', view.isaAt.x, 0); }

    // the coin counter
    if (run.coinCount !== shownCoins) {
      const up = run.coinCount > shownCoins && shownCoins >= 0;
      shownCoins = run.coinCount; $('coinCount').textContent = String(shownCoins);
      if (up) { const h = $('hud'); h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump'); }
    }

    // courses 1 and 2 (and until she has steered once): show how to steer, until she has
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
  for (const m of MODES) tap('mode-' + m, () => goLevels(null, m));
  $('homeBtn').addEventListener('click', () => { A.init(); A.click(); flush(); location.href = HUB; });

  // Grown-ups: hold the title for 4 seconds to open every course (in the mode on show).
  let holdT = null;
  const unlockAll = () => { save.unlocked[mode] = NLEV; persist(); };
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { unlockAll(); A.init(); A.star(2); goLevels(page); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));

  // Android back button (called from MainActivity): back to the hub.
  window.__back = () => { flush(); location.href = '../../index.html'; return true; };
  window.__pause = () => { releaseAll(); flush(); A.suspend(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseAll(); flush(); A.suspend(); }
    else { A.setMuted(readMuted()); A.resume(); }
  });
  window.addEventListener('pagehide', () => { releaseAll(); flush(); });
  window.addEventListener('pageshow', () => { A.setMuted(readMuted()); crown = crownEarned(); });
  window.addEventListener('resize', () => R.resize());

  // ---- the readout for grown-ups: which input is steering, and what the sensors last said ----
  const dbgEl = $('dbg');
  let dbgOn = false, dbgT = 0;
  const round = (v, d) => (Number.isFinite(v) ? +v.toFixed(d == null ? 2 : d) : null);
  window.__dbg = {
    get input() { return steerSrc; },
    get steer() { return round(steer, 3); },
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
      return `input ${steerSrc}  steer ${steer.toFixed(2)}  speed ${run ? Math.round(run.v) : '-'}\n`
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
    if (!run) R.drawMenu(clock, dt, page + 1);
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
    if (dirty && performance.now() - lastPersist > 1500) persist();
    if (dbgOn && (dbgT += dt) > 0.2) { dbgT = 0; dbgEl.textContent = window.__dbg.text(); }
    requestAnimationFrame(frame);
  }

  // ---- hooks for tests (test/games/slide/) ----
  window.__slideDebug = {
    get state() {
      const r = run, her = R.toCss(view.isaAt.x, view.isaAt.y);
      return {
        screen, page, mode, level: r ? level : null, phase: r ? r.phase : null, muted: A.muted, gain: A.gain, save: JSON.parse(JSON.stringify(save)), vw: R.VW, dpr: R.dpr, crown,
        s: r ? r.s : null, x: r ? r.x : null, v: r ? r.v : null, vx: r ? r.vx : null, z: r ? r.z : null, t: r ? r.t : null, len: r ? r.lev.len : null, hw: r ? r.lev.hw : null,
        vc: r ? r.vc : null, steer, input: steerSrc, touching: touch.id != null,
        coins: r ? r.laneCount : null, bonus: r ? r.bonusCount : null, picked: r ? r.picked : null, total: r ? r.lev.total : null, laneTotal: r ? r.lev.laneTotal : null,
        poofs: r ? r.bumps : null, spilled: r ? r.spilled : null, rails: r ? r.rails : null, rims: r ? r.rims : null, slips: r ? r.slips : null, restores: r ? r.restores : null,
        hasKey: r ? r.hasKey : null, opened: r ? r.opened : null, loop: r ? r.loop : null, loops: r ? r.loops : null, cpS: r ? r.cpS : null, cpN: r ? r.cpN : null,
        inv: r ? r.inv : null, stars: r ? r.stars : null, chestOpen: view.chestOpen, party: view.party, results: resultsShown, hint: view.hint, keyFly: view.keyFly,
        her, particles: R.particles, tiltLive: tilt.live(performance.now()),
      };
    },
    get run() { return run; },
    start(n, m) { startLevel(n, m); return true; },
    levels(pg, m) { goLevels(pg, m); return true; },
    warp(s, x) { if (!run) return false; run.warpTo(s, x); return true; },
    reset() { save = freshSave(); mode = save.mode; persist(); goLevels(0); },
    unlockAll() { unlockAll(); if (screen === 'levels') goLevels(page); },
    resetTilt() { tilt.reset(); sens.guess = null; ext.at = -1e9; },
    perf() {
      const sorted = perf.draws.slice().sort((a, b) => a - b), dts = perf.dts.slice().sort((a, b) => a - b);
      const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
      return { frames: perf.frames, fps: perf.frames / (perf.dtSum || 1), drawAvgMs: perf.drawSum / (perf.frames || 1), drawP95Ms: q(sorted, 0.95), drawMaxMs: perf.drawMax, frameP95Ms: q(dts, 0.95) * 1000 };
    },
    resetPerf() { Object.assign(perf, { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] }); },
  };

  // ?level=4 jumps straight into a course (handy for screenshots), ?mode=hard picks the mode; ?dbg=1 shows the sensor readout
  const q = new URLSearchParams(location.search), qLevel = +q.get('level');
  if (q.get('dbg')) window.__dbg.show(true);
  goLevels(null, MODES.includes(q.get('mode')) ? q.get('mode') : null);
  if (qLevel >= 1 && qLevel <= NLEV) startLevel(qLevel);
  requestAnimationFrame(frame);
})();
