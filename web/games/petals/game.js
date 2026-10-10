/* Petal Patterns: screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js (and FairyArt),
 * sound in sound.js.
 * A row of flowers in pots follows a pattern; the last pot is empty under a glowing "?". The child taps the flower on
 * the tray below that comes next: Isabella the Fairy carries it over, plants it with a sprinkle of dust, the whole
 * row blooms in a wave, butterflies come and a gold coin flies up. A wrong flower wobbles, shakes its head and
 * fades to half for a moment; nothing is lost. On the hardest levels one pot breaks the pattern and the child taps
 * that pot (no tray). A level is 5 rounds (6 in World 2); then the treasure chest rises and bursts.
 * No timers shown, no words. After a quiet spell a hint hand hovers over the right flower. */
(function () {
  'use strict';
  const A = PetalArt, S = PetalSound, L = PetalLogic, F = FairyArt;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, SAVE_KEY = 'game.petals.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const GROUND = L.GROUND_Y;
  const clamp = A.clamp, smooth = A.smooth, easeOutBack = A.easeOutBack;
  const POT_STEP = 0.09;      // seconds between one pot appearing and the next
  const DELIVER = { reach: 0.34, plant: 0.98, end: 1.3, close0: 0.5, close1: 0.9 };   // phases of Isabella carrying a flower over
  const FIX = { reach: 0.5, end: 1.0 };                                                 // ... or putting the odd pot right
  const WAVE_STEP = 0.1, WAVE_OPEN = 0.5;
  const OUTRO = 0.4, WIN_RISE = 0.9, WIN_OPEN = 1.5, WIN_END = 4.2;
  const FADE_T = 1.15;        // a wrong flower stays faded this long
  const HUD = () => ({ x: A.VW - 64, y: 54 });

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
  // sound follows the main game's setting (read only: this game never writes isabella.save)
  function readMuted() { try { return !!JSON.parse(store.get('isabella.save') || '{}').muted; } catch (e) { return false; } }
  let save = L.migrate(store.get(SAVE_KEY));
  function persist() { store.set(SAVE_KEY, JSON.stringify(save)); counters.persists++; }

  // ---- state ----
  const canvas = $('c'), homeBtn = $('home');
  A.init(canvas);
  const ctx = A.ctx;
  let muted = readMuted();
  S.setMuted(muted);
  let screen = 'levels';    // levels | play | results
  let mode = save.mode, page = 0;
  let run = null, clock = 0, last = 0, timeScale = 1;
  const counters = { downs: 0, taps: 0, rights: 0, wrongs: 0, hints: 0, pulses: 0, rounds: 0, levels: 0, persists: 0, ignored: 0, pointerTypes: {} };

  // ---- the menu: ten bubbles, a page of each world ----
  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.5)'}" stroke="${on ? '#c77700' : 'rgba(120,30,90,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  const BUBBLE = { easy: ['#8ff0cf', '#1fae92'], medium: ['#a6e2ff', '#2a8fd6'], hard: ['#e2bcff', '#8340cf'] };
  function firstOpen(m) { return Math.min(NLEV, save.unlocked[m]); }
  function goLevels(pg, m) {
    if (m && L.MODES.indexOf(m) >= 0) mode = m;
    if (save.mode !== mode) { save.mode = mode; persist(); }
    page = pg != null ? clamp(pg, 0, 1) : page;
    screen = 'levels'; run = null;
    const grid = $('grid'); grid.innerHTML = '';
    const un = save.unlocked[mode], stars = save.stars[mode], [c1, c2] = BUBBLE[mode];
    for (let k = 1; k <= L.PAGE; k++) {
      const n = page * L.PAGE + k, locked = n > un, got = stars[n - 1] || 0;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === un && !got ? ' next' : '');
      b.dataset.level = n;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = locked ? 'radial-gradient(circle at 35% 28%, #e9e1f3, #b3a6c9 55%, #8a7ba6)' : `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.7), ${c1} 45%, ${c2})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < got)).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        S.init();
        if (locked) { S.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        S.click(); startLevel(n);
      });
      grid.appendChild(b);
    }
    for (const m of L.MODES) $('mode-' + m).classList.toggle('on', m === mode);
    $('pgPrev').style.visibility = page > 0 ? 'visible' : 'hidden';
    $('pgNext').style.visibility = page < 1 ? 'visible' : 'hidden';
    $('pgDots').innerHTML = [0, 1].map((i) => `<span class="${i === page ? 'on' : ''}"></span>`).join('');
    $('coinCount').textContent = save.coins;
    show('levels');
    S.setKey(page ? 2 : 0); S.startMusic(page ? 7 : 3, page ? 2 : 0);
  }

  // ---- a level ----
  function startLevel(n, m, variant) {
    n = clamp(Math.floor(n) || 1, 1, NLEV);
    if (m && L.MODES.indexOf(m) >= 0) { mode = m; if (save.mode !== m) { save.mode = m; persist(); } }
    const cfg = L.config(n, mode);
    const v = variant != null ? variant : (save.plays[mode][n - 1] || 0);
    run = {
      n, mode, cfg, variant: v, rounds: L.levelRounds(n, mode, v), ri: 0, wrong: 0, roundWrong: 0,
      phase: 'intro', pt: 0, idle: 0, hint: null, pulse: null, pulsed: false, stars: 0, results: false,
      fairy: { x: A.VW * 0.5, y: 120, face: 1, moving: 0 }, butterflies: [], coinsFly: [], hudPulse: 0, doneDots: 0,
      win: null, timers: [], chosen: -1, planted: false, fixed: false, closeAt: -1, waveFired: -1, introFired: -1, geom: null,
    };
    screen = 'play'; show(null);
    counters.levels++;
    S.setKey(n <= 10 ? 0 : 2); S.startMusic(n + (L.MODES.indexOf(mode) * 20), n <= 10 ? 0 : 2);
    setupRound(0);
  }
  function setupRound(i) {
    const r = run, R = r.rounds[i];
    r.ri = i; r.round = R; r.roundWrong = 0; r.phase = 'intro'; r.pt = 0; r.idle = 0; r.hint = null; r.pulse = null; r.pulsed = false;
    r.chosen = -1; r.planted = false; r.fixed = false; r.waveFired = -1; r.introFired = -1; r.geom = null; r.outA = 1;
    const odd = R.type === 'O', nPots = odd ? R.n : R.n + 1;
    r.potF = R.row.map((f) => f.slice()); if (!odd) r.potF.push(null);
    r.bloom = new Array(nPots).fill(1);
    r.lift = new Array(nPots).fill(0);
    r.wob = new Array(nPots).fill(0);     // a pot (odd rounds) shaking its head
    r.potFade = new Array(nPots).fill(0);
    r.plates = (R.choices || []).map(() => ({ wob: 0, fade: 0, droop: 0, hidden: false }));
    r.platesA = 1;
    r.fairy.face = 1;
    counters.rounds++;
  }
  // the pots and plates, laid out for the current width
  function geom() {
    const r = run;
    if (r.geom && r.geom.vw === A.VW) return r.geom;
    const R = r.round, odd = R.type === 'O', nPots = odd ? R.n : R.n + 1;
    let groups = null;
    if (R.groups) { groups = R.groups.slice(); groups[groups.length - 1]++; }
    const lay = L.layoutRow(nPots, A.VW, { target: odd, groups });
    const plates = R.choices ? L.layoutChoices(R.choices.length, A.VW) : [];
    const rim = lay.pots.map((p) => GROUND + p.dy - (groups ? 12 * p.group : 0));
    r.geom = { vw: A.VW, lay, plates, rim, mul: lay.scale, introEnd: nPots * POT_STEP + 0.15 + Math.max(0, plates.length - 1) * 0.08 + 0.22 };
    return r.geom;
  }
  const potTarget = (i) => { const g = geom(); return { x: g.lay.pots[i].x, y: g.rim[i] - 52 * Math.max(0.9, g.lay.scale) }; };

  // ---- a tap on a plate or a pot ----
  function tapChoice(i) {
    const r = run, R = r.round;
    if (r.phase !== 'ask') return;
    counters.taps++;
    const p = r.plates[i];
    if (L.choiceRight(R, i)) { counters.rights++; correct(i); return; }
    wrongTap(p.fade > 0, () => { p.wob = 1; p.droop = 1; p.fade = FADE_T; });
  }
  function tapPot(i) {
    const r = run, R = r.round;
    if (r.phase !== 'ask' || R.type !== 'O') return;
    counters.taps++;
    if (L.potRight(R, i)) { counters.rights++; correct(i); return; }
    wrongTap(r.potFade[i] > 0, () => { r.wob[i] = 1; r.potFade[i] = FADE_T; });
  }
  // wrong: a wobble and a shake of the head; counted once, not again while it is still faded
  function wrongTap(was, set) {
    const r = run;
    set();
    S.wrong();
    if (was) { counters.ignored++; return; }
    r.wrong++; r.roundWrong++; counters.wrongs++;
    r.idle = 0;
  }
  function correct(i) {
    const r = run, R = r.round;
    r.chosen = i; r.phase = 'deliver'; r.pt = 0; r.hint = null; r.pulse = null;
    r.fairy0 = { x: r.fairy.x, y: r.fairy.y };
    save.coins += L.COINS_PER_ROUND; save.rounds++;
    persist();    // the coin is in the save the moment it is earned
    S.lift();
  }
  const answerPot = () => (run.round.type === 'O' ? run.round.odd : run.round.n);   // the pot that gets the right flower

  // ---- the chest at the end of a level ----
  const chestX = () => clamp(A.VW * 0.28, 170, A.VW - 190);
  function startWin() {
    const r = run;
    r.phase = 'win'; r.pt = 0; r.hint = null;
    r.stars = L.finishLevel(save, mode, r.n, r.wrong);
    save.coins += L.CHEST_COINS;
    persist();
    r.win = { t: 0, opened: false, coins: [] };
    S.cheer();
    later(0.25, () => { A.burst('dust', chestX(), GROUND + 120, 30); S.whoosh(); });
    later(WIN_OPEN - 0.05, () => {
      r.win.opened = true; S.chest();
      A.burst('confetti', 0, 0, 60);
      for (let k = 0; k < 22; k++) r.win.coins.push({ x: chestX() + (k - 11) * 4, y: GROUND + 70, vx: (k - 11) * 14 + (Math.sin(k * 7.3) * 18), vy: -330 - (k % 5) * 40, ph: k });
    });
    later(WIN_END, showResults);
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }
  function showResults() {
    const r = run;
    if (!r || r.results) return;
    r.results = true; screen = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < r.stars) S.star(i); }));
  }

  // ---- input ----
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (screen !== 'play' || !run || upright()) return;
    counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    const p = A.toWorld(e.clientX, e.clientY), r = run;
    r.idle = 0; r.hint = null;
    if (r.phase !== 'ask') return;
    const g = geom(), R = r.round;
    if (R.type === 'O') {
      // the nearest pot within reach of the touch
      let best = -1, bd = g.lay.reach + 0.001;
      for (let i = 0; i < g.lay.pots.length; i++) {
        const t = potTarget(i), d = Math.hypot(p.x - t.x, p.y - t.y);
        if (d <= bd) { bd = d; best = i; }
      }
      if (best >= 0) tapPot(best);
    } else {
      for (let i = 0; i < g.plates.length; i++) {
        const q = g.plates[i];
        if (Math.abs(p.x - q.x) <= q.w / 2 + 4 && Math.abs(p.y - q.y) <= q.h / 2 + 4) { tapChoice(i); break; }
      }
    }
  });
  const lift = (e) => { if (e.type === 'pointerup') S.init(); };   // a lifted finger is the user gesture that starts sound on touch screens
  window.addEventListener('pointerup', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- buttons and navigation ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { S.init(); S.click(); fn(); });
  for (const m of L.MODES) tap('mode-' + m, () => goLevels(page, m));
  tap('pgPrev', () => goLevels(page - 1));
  tap('pgNext', () => goLevels(page + 1));
  tap('resLevels', () => goLevels(run ? (run.n > 10 ? 1 : 0) : page));
  tap('resReplay', () => startLevel(run ? run.n : 1));
  tap('resNext', () => { const n = Math.min(NLEV, (run ? run.n : 0) + 1); startLevel(n); });
  homeBtn.addEventListener('click', () => { S.init(); persist(); location.href = HUB; });
  window.__back = () => { persist(); location.href = HUB; return true; };
  window.__pause = () => { S.suspend(); persist(); };
  // grown-ups: hold the title for 4 seconds to open every level of this mode
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { save.unlocked[mode] = NLEV; persist(); S.init(); S.cheer(); goLevels(page); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.suspend(); persist(); return; }
    const m = readMuted();
    if (m !== muted) { muted = m; S.setMuted(m); }
    S.resume(); last = 0;
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('resize', () => { A.resize(); if (run) run.geom = null; });

  // ---- the level-select meadow: Isabella flying about, butterflies, nothing to tap ----
  const menu = { t: 0, bf: [] };
  function stepMenu(dt) {
    menu.t += dt;
    if (menu.bf.length < 3 && Math.random() < dt * 0.5) menu.bf.push({ x: -30, y: 200 + Math.random() * 140, vx: 40 + Math.random() * 30, ph: Math.random() * 6, col: L.RAINBOW[Math.floor(Math.random() * 7)] });
    for (let i = menu.bf.length - 1; i >= 0; i--) { const b = menu.bf[i]; b.x += b.vx * dt; if (b.x > A.VW + 40) menu.bf.splice(i, 1); }
    A.stepParts(dt);
  }
  function drawMenu() {
    A.drawMenuScene(ctx, page + 1, clock);
    for (const b of menu.bf) F.drawButterfly(ctx, b.x, b.y + Math.sin(clock * 1.7 + b.ph) * 18, clock, b.col, 1.1);
    const t = menu.t, x = A.VW * 0.5 + Math.sin(t * 0.35) * A.VW * 0.34, y = 408 + Math.sin(t * 0.9) * 14, face = Math.cos(t * 0.35) >= 0 ? 1 : -1;
    F.drawFairy(ctx, x, y, clock, { pose: 'fly', scale: 0.9, flip: face < 0, dust: 0.8, happy: true });
    A.drawParts(ctx);
  }

  // ---- stepping a level ----
  function fairyGoto(dt, tx, ty, speed) {
    const f = run.fairy, k = Math.min(1, dt * speed);
    const dx = tx - f.x;
    f.x += dx * k; f.y += (ty - f.y) * k;
    if (Math.abs(dx) > 12) f.face = dx > 0 ? 1 : -1;
    f.moving = Math.hypot(dx, ty - f.y) > 22 ? 1 : 0;
  }
  function stepIdleFairy(dt) {
    const tx = A.VW * 0.5 + Math.sin(clock * 0.45) * A.VW * 0.2 + 70, ty = 112 + Math.sin(clock * 1.3) * 9;
    fairyGoto(dt, tx, ty, 1.8);
  }
  function stepRun(dt) {
    const r = run, R = r.round;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; if ((tm.t -= dt) <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    for (let i = 0; i < r.plates.length; i++) {
      const p = r.plates[i];
      if (p.wob > 0) p.wob = Math.max(0, p.wob - dt * 1.4);
      if (p.droop > 0) p.droop = Math.max(0, p.droop - dt * 1.1);
      if (p.fade > 0) p.fade = Math.max(0, p.fade - dt);
    }
    for (let i = 0; i < r.wob.length; i++) { if (r.wob[i] > 0) r.wob[i] = Math.max(0, r.wob[i] - dt * 1.4); if (r.potFade[i] > 0) r.potFade[i] = Math.max(0, r.potFade[i] - dt); }
    if (r.hudPulse > 0) r.hudPulse = Math.max(0, r.hudPulse - dt * 2);
    const g = r.geom && r.geom.vw === A.VW ? r.geom : geom();
    if (r.phase === 'intro') {
      // pots and plates pop in one after another, each with a soft tick
      const nPots = g.lay.pots.length, fired = Math.floor(r.pt / POT_STEP);
      while (r.introFired < Math.min(fired, nPots - 1)) { r.introFired++; S.pot(r.introFired); }
      const tp = nPots * POT_STEP + 0.15;
      for (let k = 0; k < g.plates.length; k++) { const key = 100 + k; if (r.pt >= tp + k * 0.08 && r.introFired < key) { r.introFired = Math.max(r.introFired, key); S.plate(k); } }
      stepIdleFairy(dt);
      if (r.pt >= g.introEnd) { r.phase = 'ask'; r.pt = 0; r.idle = 0; }
    } else if (r.phase === 'ask') {
      r.idle += dt;
      stepIdleFairy(dt);
      stepHint(dt);
    } else if (r.phase === 'deliver') stepDeliver(dt);
    else if (r.phase === 'wave') stepWave(dt);
    else if (r.phase === 'outro') {
      r.outA = 1 - smooth(r.pt / OUTRO);
      stepIdleFairy(dt);
      if (r.pt >= OUTRO) { if (r.ri + 1 < r.rounds.length) setupRound(r.ri + 1); else startWin(); }
    } else if (r.phase === 'win') stepWin(dt);
    // the little things
    for (let i = r.butterflies.length - 1; i >= 0; i--) { const b = r.butterflies[i]; b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(b.t * 3 + b.ph) * 20 * dt; if (b.x > A.VW + 60 || b.y < -60 || b.t > 6) r.butterflies.splice(i, 1); }
    for (let i = r.coinsFly.length - 1; i >= 0; i--) {
      const c = r.coinsFly[i]; c.t += dt;
      if (c.t >= 0.95) { r.coinsFly.splice(i, 1); r.hudPulse = 1; const h = HUD(); A.burst('coin', h.x, h.y, 12); S.coin(); }
      else if (Math.random() < dt * 40) { const q = coinPos(c); A.burst('twinkle', q.x, q.y, 1); }
    }
    A.stepParts(dt);
  }
  const coinPos = (c) => { const h = HUD(), u = smooth(c.t / 0.95); return { x: c.x0 + (h.x - c.x0) * u, y: c.y0 + (h.y - c.y0) * u - Math.sin(u * Math.PI) * 90, r: 24 + (14 - 24) * u }; };

  // the hint: after a quiet spell, a hand hovers over the right flower (Easy also lifts the repeating unit once)
  function stepHint(dt) {
    const r = run, R = r.round;
    if (r.hint) { r.hint.t += dt; }
    else if (L.hintDue(r.idle, r.mode)) {
      r.hint = { t: 0 }; counters.hints++; S.hint();
      if (r.mode === 'easy' && !r.pulsed && R.unit) { r.pulsed = true; r.pulse = { t: 0 }; counters.pulses++; }
    }
    if (r.pulse) { r.pulse.t += dt; if (r.pulse.t > 1.1) r.pulse = null; }
  }

  function stepDeliver(dt) {
    const r = run, R = r.round, g = geom(), odd = R.type === 'O', last = answerPot();
    const T = odd ? FIX : DELIVER;
    const tgt = potTarget(last);
    r.platesA = odd ? 1 : 1 - smooth((r.pt - 0.1) / 0.4);
    if (!odd) {
      const pl = g.plates[r.chosen];
      if (r.pt < T.reach) fairyGoto(dt, pl.x - 34, pl.y - 100, 9);
      else { const q = flowerFlight(); r.fairy.face = tgt.x >= pl.x ? 1 : -1; r.fairy.x = q.x - 30 * r.fairy.face; r.fairy.y = q.y - 28; r.fairy.moving = 1; if (Math.random() < dt * 50) A.burst('dust', q.x, q.y, 1); }
      // the whole row closes up into buds ready to bloom again
      if (r.pt > T.close0) { const u = smooth((r.pt - T.close0) / (T.close1 - T.close0)); for (let i = 0; i < r.bloom.length; i++) if (i !== last) r.bloom[i] = 1 - u; }
      if (!r.planted && r.pt >= T.plant) {
        r.planted = true; r.potF[last] = R.answer.slice(); r.bloom[last] = 0;
        A.burst('dust', tgt.x, tgt.y, 26); S.plant();
      }
    } else {
      fairyGoto(dt, tgt.x - 40, tgt.y - 76, 8);
      if (!r.fixed && r.pt >= T.reach) { r.fixed = true; r.potF[last] = R.answer.slice(); A.burst('dust', tgt.x, tgt.y, 26); S.fix(); }
      if (r.pt > T.reach + 0.1) { const u = smooth((r.pt - T.reach - 0.1) / 0.3); for (let i = 0; i < r.bloom.length; i++) r.bloom[i] = 1 - u; }
    }
    if (r.pt >= T.end) { r.phase = 'wave'; r.pt = 0; startWave(); }
  }
  // the flying flower's place along its arc
  function flowerFlight() {
    const r = run, g = geom(), pl = g.plates[r.chosen], last = answerPot(), tgt = potTarget(last);
    const u = smooth((r.pt - DELIVER.reach) / (DELIVER.plant - DELIVER.reach));
    const x0 = pl.x, y0 = pl.y + 8, x1 = tgt.x, y1 = g.rim[last] - 2, cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - 150;
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    return { x: a * x0 + b * cx + c * x1, y: a * y0 + b * cy + c * y1, u };
  }
  function startWave() {
    const r = run, g = geom(), last = answerPot();
    for (let i = 0; i < r.bloom.length; i++) r.bloom[i] = 0;
    r.waveFired = -1;
    // butterflies come from the row, and a gold coin flies up
    const cols = r.potF.filter(Boolean).map((f) => L.RAINBOW[f[0]]);
    for (let k = 0; k < 3; k++) {
      const i = Math.min(g.lay.pots.length - 1, Math.floor((k + 0.5) * g.lay.pots.length / 3));
      r.butterflies.push({ x: g.lay.pots[i].x, y: g.rim[i] - 70, vx: 55 + k * 22, vy: -34 - k * 12, t: 0, ph: k * 2, col: cols[(k * 2) % Math.max(1, cols.length)] || '#ff8fc0' });
    }
    S.butterfly();
    const tgt = potTarget(last);
    r.coinsFly.push({ t: 0, x0: tgt.x, y0: tgt.y - 30 });
    A.burst('coin', tgt.x, tgt.y - 30, 10);
    r.fairy.face = 1;
  }
  function stepWave(dt) {
    const r = run, g = geom(), n = r.bloom.length;
    for (let i = 0; i < n; i++) {
      r.bloom[i] = smooth((r.pt - i * WAVE_STEP) / WAVE_OPEN);
      if (r.waveFired < i && r.pt >= i * WAVE_STEP) { r.waveFired = i; S.bloom(i, n); A.burst('petals', g.lay.pots[i].x, g.rim[i] - 60, 3, L.RAINBOW[(r.potF[i] || [0])[0]]); }
    }
    stepIdleFairy(dt);
    if (r.pt >= (n - 1) * WAVE_STEP + WAVE_OPEN + 0.5) { r.phase = 'outro'; r.pt = 0; r.platesA = 0; }
  }
  function stepWin(dt) {
    const r = run, w = r.win;
    w.t += dt;
    r.outA = 1 - smooth(w.t / 0.8);
    fairyGoto(dt, chestX() + 140, 140 + Math.sin(w.t * 3) * 8, 3);
    for (const c of w.coins) { c.vy += 700 * dt; c.x += c.vx * dt; c.y += c.vy * dt; }
    w.coins = w.coins.filter((c) => c.y < H_MAX);
  }
  const H_MAX = 640;

  // ---- drawing a level ----
  function drawPots(g, R, alpha) {
    const r = run, lay = g.lay, n = lay.pots.length, s = lay.scale, mul = g.mul;
    ctx.save(); ctx.globalAlpha = alpha;
    // a shelf under a straight row; stone steps under a staircase
    if (R.groups) {
      let i0 = 0;
      for (const sz of R.groups.slice(0, -1).concat([R.groups[R.groups.length - 1] + 1])) {
        const a = lay.pots[i0], b = lay.pots[Math.min(n - 1, i0 + sz - 1)], top = g.rim[i0] + 48 * s;
        A.step(ctx, a.x - 40 * s, b.x + 40 * s, top); i0 += sz;
      }
    } else if (!lay.zig) A.shelf(ctx, lay.pots[0].x - 52 * s, lay.pots[n - 1].x + 52 * s, GROUND + 44 * s);
    for (let i = 0; i < n; i++) {
      const sc = easeOutBack(clamp((r.phase === 'intro' ? r.pt - i * POT_STEP : 9) / 0.35, 0, 1));
      if (sc <= 0.001) continue;
      const x = lay.pots[i].x, lf = r.lift[i] + pulseLift(i), rimY = g.rim[i] - lf, f = r.potF[i];
      const wob = Math.sin(clock * 38) * 0.12 * (r.wob[i] || 0);
      const a = (r.potFade[i] > 0 ? 0.5 : 1);
      ctx.save(); ctx.globalAlpha = alpha * a; ctx.translate(x, rimY); ctx.rotate(wob); ctx.scale(sc, sc); ctx.translate(-x, -rimY);
      const empty = !f;
      A.pot(ctx, x, rimY, s, false, clock);
      if (empty) A.questionBud(ctx, x, rimY, Math.max(0.75, s), clock, r.phase === 'win' ? 0 : 1);
      else {
        // a head-shake in odd rounds: petals droop and recover
        const dr = (r.wob[i] || 0);
        A.flower(ctx, x, rimY + 3 * s, f, mul, Math.max(0, r.bloom[i] - 0.6 * Math.sin(dr * Math.PI)), clock);
      }
      ctx.restore();
    }
    ctx.restore();
  }
  // the repeating unit lifts together, once (Easy hint)
  function pulseLift(i) {
    const r = run;
    if (!r.pulse || !r.round.unit || i < r.round.unit[0] || i >= r.round.unit[1]) return 0;
    return Math.sin(clamp(r.pulse.t / 1.0, 0, 1) * Math.PI) * 20;
  }
  function drawPlates(g, R, alpha) {
    const r = run, ph = r.phase;
    const tp = g.lay.pots.length * POT_STEP + 0.15;
    for (let k = 0; k < g.plates.length; k++) {
      const q = g.plates[k], p = r.plates[k], f = R.choices[k];
      const sc = ph === 'intro' ? easeOutBack(clamp((r.pt - tp - k * 0.08) / 0.3, 0, 1)) : 1;
      if (sc <= 0.001) continue;
      const flying = ph === 'deliver' && k === r.chosen && r.pt >= DELIVER.reach;
      const a = alpha * (ph === 'deliver' && k !== r.chosen ? clamp(r.platesA, 0, 1) : ph === 'deliver' || ph === 'wave' || ph === 'outro' ? clamp(r.platesA, 0, 1) : 1) * (p.fade > 0 ? 0.5 : 1);
      if (a <= 0.01) continue;
      const shake = Math.sin(clock * 34) * 0.1 * p.wob;
      A.plate(ctx, q.x, q.y, q.w, { alpha: a, scale: sc * (ph === 'ask' && r.hint && k === R.correct ? 1 + 0.04 * Math.sin(clock * 6) : 1), rot: shake, ring: p.fade > 0 ? '#ffd0c0' : null });
      if (flying) continue;   // its flower has gone with Isabella
      ctx.save(); ctx.globalAlpha = a; ctx.translate(q.x, q.y); ctx.rotate(shake); ctx.scale(sc, sc);
      const bloom = 1 - 0.65 * Math.sin(p.droop * Math.PI);
      A.flower(ctx, 0, 54, f, 1, bloom, clock);
      ctx.restore();
    }
  }
  // where the hint fingertip rests: over the right flower on its plate, or over the odd pot
  function hintSpot() {
    const r = run, R = r.round, g = geom();
    if (R.type === 'O') { const t = potTarget(R.odd); return { x: t.x, y: t.y - 36 }; }
    const q = g.plates[R.correct];
    return { x: q.x + 4, y: q.y - 8 };
  }
  function drawHint() {
    const r = run;
    if (!r.hint || r.phase !== 'ask') return;
    const h = hintSpot();
    F.drawHand(ctx, h.x, h.y, clock, smooth(r.hint.t / 0.4));
  }
  function drawProgress(alpha) {
    const r = run, n = r.rounds.length, sp = 44, x0 = A.VW / 2 - ((n - 1) * sp) / 2;
    ctx.save(); ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const done = i < r.ri || (i === r.ri && (r.phase === 'wave' || r.phase === 'outro')) || r.phase === 'win';
      const cur = i === r.ri && !done;
      ctx.fillStyle = done ? 'rgba(255,255,255,0.0)' : 'rgba(255,255,255,0.6)';
      if (!done) { ctx.beginPath(); ctx.arc(x0 + i * sp, 38, cur ? 9 + Math.sin(clock * 4) * 1.5 : 7, 0, TAU); ctx.fill(); if (cur) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); } }
      else A.flower(ctx, x0 + i * sp, 74, [(i * 3 + 1) % 7, (i * 5 + 2) % 6, 1], 0.4, 1, clock);
    }
    ctx.restore();
  }
  function drawHud() {
    const r = run, h = HUD(), k = 1 + 0.25 * smooth(r.hudPulse);
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(h.x, h.y, 34 * k, 0, TAU); ctx.fill(); ctx.restore();
    F.drawCoin(ctx, h.x, h.y, 0.4 + clock * 0.8 * (r.hudPulse > 0 ? 6 : 0.4), 24 * k);
  }
  function drawWin() {
    const r = run, w = r.win, rise = easeOutBack(clamp((w.t - 0.25) / WIN_RISE, 0, 1)), open = smooth(clamp((w.t - WIN_OPEN) / 0.55, 0, 1));
    const x = chestX(), base = GROUND + 150;
    ctx.save(); ctx.translate(x, A.H + 90 + (base - A.H - 90) * rise); ctx.scale(1.55, 1.55);
    F.drawChest(ctx, 0, 0, open, clock);
    ctx.restore();
    for (const c of w.coins) F.drawCoin(ctx, c.x, c.y, clock * 8 + c.ph, 15);
  }
  function drawPlay() {
    const r = run, R = r.round, g = geom();
    A.drawScene(ctx, r.n, clock);
    const alpha = r.phase === 'outro' ? r.outA : r.phase === 'win' ? r.outA : 1;
    drawPots(g, R, alpha);
    if (R.choices) drawPlates(g, R, alpha);
    drawProgress(r.phase === 'win' ? 0.4 : 1);
    if (r.phase === 'win') drawWin();
    // the flower in flight
    if (r.phase === 'deliver' && R.type !== 'O' && r.pt >= DELIVER.reach && r.pt < DELIVER.plant) {
      const q = flowerFlight(), pl = g.plates[r.chosen], m = 1 + (g.mul - 1) * q.u;
      A.flower(ctx, q.x, q.y + 54 * (1 - q.u) * 0.4, R.choices[r.chosen], m, 1, clock);
      void pl;
    }
    for (const b of r.butterflies) F.drawButterfly(ctx, b.x, b.y, clock, b.col, 1.1);
    // Isabella
    const f = r.fairy, spin = r.phase === 'win' && r.win.opened ? Math.sin(r.win.t * 4) * 0.2 : 0;
    F.drawFairy(ctx, f.x, f.y + Math.sin(clock * 2.2) * 2, clock, { pose: f.moving ? 'fly' : 'hover', scale: 0.95, flip: f.face < 0, dust: f.moving ? 1 : 0.15, happy: true, tilt: spin });
    drawHint();
    A.drawParts(ctx);
    for (const c of r.coinsFly) { const p = coinPos(c); F.drawCoin(ctx, p.x, p.y, clock * 8, p.r); }
    drawHud();
  }
  function draw() {
    A.begin();
    if (!run || screen === 'levels') drawMenu(); else drawPlay();
  }

  // ---- main loop ----
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
        if (run && screen !== 'levels') stepRun(dt); else stepMenu(dt);
      }
      draw();
    }
    perf[perfN++ % perf.length] = performance.now() - t0;
    requestAnimationFrame(frame);
  }

  // ---- hooks for the headless tests (test/games/petals) ----
  const cl = (x, y) => A.toClient(x, y);
  function targets() {
    if (!run || screen !== 'play') return { plates: [], pots: [] };
    const g = geom(), k = A.unit(), R = run.round;
    const plates = g.plates.map((q, i) => { const c = cl(q.x, q.y); return { i, cx: c.x, cy: c.y, w: q.w * k, h: q.h * k, correct: i === R.correct }; });
    const pots = g.lay.pots.map((p, i) => { const t = potTarget(i), c = cl(t.x, t.y); return { i, cx: c.x, cy: c.y, r: g.lay.reach * k, odd: i === R.odd, empty: !run.potF[i] }; });
    return { plates, pots };
  }
  window.__dbg = {
    counters,
    state() {
      const r = run, R = r ? r.round : null, k = A.unit(), tg = targets();
      return {
        screen, mode, page, level: r ? r.n : null, variant: r ? r.variant : null, phase: r ? r.phase : null, pt: r ? r.pt : 0,
        round: r ? r.ri : null, rounds: r ? r.rounds.length : 0, wrong: r ? r.wrong : 0, roundWrong: r ? r.roundWrong : 0, idle: r ? r.idle : 0,
        type: R ? R.type : null, fam: R ? R.fam : null, correct: R ? R.correct : null, odd: R ? R.odd : null, choices: R && R.choices ? R.choices.length : 0,
        rowLen: R ? R.row.length : 0, potsShown: r ? r.potF.filter(Boolean).length : 0, potCount: r ? r.potF.length : 0,
        plates: tg.plates, pots: tg.pots, platesFaded: r ? r.plates.map((p) => p.fade > 0) : [],
        hint: !!(r && r.hint), hintCall: r && r.hint ? r.hint.t : 0, pulse: !!(r && r.pulse), pulsed: !!(r && r.pulsed),
        hintTarget: R && r && r.phase === 'ask' ? (R.type === 'O' ? { pot: R.odd } : { choice: R.correct }) : null,
        hand: r && r.hint && R ? cl(hintSpot().x, hintSpot().y) : null,
        win: !!(r && r.win), chestOpen: r && r.win && r.win.opened, results: !!(r && r.results), resultsStars: r && r.results ? r.stars : null,
        coins: save.coins, chests: save.chests, rounds_done: save.rounds, unlocked: Object.assign({}, save.unlocked), savedStars: { easy: save.stars.easy.slice(), medium: save.stars.medium.slice(), hard: save.stars.hard.slice() },
        plays: { easy: save.plays.easy.slice(), medium: save.plays.medium.slice(), hard: save.plays.hard.slice() },
        VW: A.VW, unit: k, dpr: A.dpr, canvas: [canvas.width, canvas.height], parts: A.partCount(), butterflies: r ? r.butterflies.length : 0, coinsFly: r ? r.coinsFly.length : 0,
        muted, audio: S.state, gain: S.gain, zig: r ? geom().lay.zig : false, potPitch: r ? geom().lay.pitch : 0,
        bloom: r ? r.bloom.slice() : [], potF: r ? r.potF.map((f) => (f ? f.slice() : null)) : [],
      };
    },
    start(n, m, variant) { startLevel(n, m, variant); return run.n; },
    goLevels(pg, m) { goLevels(pg, m); return mode; },
    unlock(n, m) { save.unlocked[m || mode] = clamp(n == null ? NLEV : n, 1, NLEV); persist(); return save.unlocked[m || mode]; },
    timeScale(k) { timeScale = k; return timeScale; },
    // jump a round forward without playing it (soak and structure tests)
    round() { return run ? { round: run.round, ri: run.ri, rounds: run.rounds.length } : null; },
    jump(i) { if (!run) return null; setupRound(clamp(i, 0, run.rounds.length - 1)); return run.ri; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    resetPerf() { perfN = 0; perf.fill(0); },
    saved() { return store.get(SAVE_KEY); },
    homeZone() { const b = homeBtn.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; },
  };

  goLevels(0);
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?level=4&mode=hard jumps straight into a level (handy for screenshots), if it is open
  const qs = new URLSearchParams(location.search), ql = +qs.get('level'), qm = qs.get('mode');
  if (qm && L.MODES.indexOf(qm) >= 0) { mode = qm; goLevels(0, qm); }
  if (ql >= 1 && ql <= NLEV && ql <= save.unlocked[mode]) startLevel(ql);
  requestAnimationFrame(frame);
})();
