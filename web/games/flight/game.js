/* Fairy Flight: screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js (and the shared
 * web/fairy/fairy.js), sound in sound.js.
 * The forest scrolls past from right to left. A finger anywhere on the screen is where Isabella the Fairy flies: she eases
 * toward its height (and a little toward its x). Passing a closed bud sprinkles fairy dust and it blooms, and the plant pays
 * a gold coin that flies up to the coin row. Grumpy critters and bugs give a soft bonk (a wobble, dizzy stars, and on Medium
 * and Hard a coin drifts away). A golden key hangs mid-course; at the end the treasure chest bursts open. No timers, no words. */
(function () {
  'use strict';
  const A = FlightArt, S = FlightSound, L = FlightLogic, F = FairyArt;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, SAVE_KEY = 'game.flight.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const COIN_FLY = 0.85;       // a coin flies from its plant up to the coin row this long
  const HINT_T = 2.4;          // one showing of the "slide your finger" hand
  const HINT_AFTER = { easy: 6, medium: 10, hard: 16 };   // quiet seconds before the hand shows again
  const KEYS = [0, 2, 5, 7, -1, 3, -3, 4];                // the music's key for each forest
  const THEME_NAMES = ['Meadow', 'Meadow', 'Meadow', 'Meadow', 'Cloud Tops', 'Cloud Tops', 'Cloud Tops', 'Cloud Tops'];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

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

  // ---- state ----
  const canvas = $('c'), homeBtn = $('home'), homeDot = homeBtn.querySelector('.btn');
  A.init(canvas);
  let muted = readMuted();
  S.setMuted(muted);
  let screen = 'levels';   // levels | play | results
  let mode = save.mode;    // easy | medium | hard
  let page = 0;            // 0: World 1 (levels 1-10), 1: World 2 (11-20)
  let run = null;          // the level being played
  let clock = 0, last = 0, timeScale = 1, activeId = null, homeZone = null;
  const events = [];       // what happened in a step (reused)
  const counters = { downs: 0, moves: 0, pointerTypes: {}, blooms: 0, bonks: 0, coinsEarned: 0, coinsLost: 0, coinsLanded: 0, chests: 0, keys: 0, persists: 0, levelsStarted: 0, hints: 0, twirls: 0 };

  function persist() {
    store.set(SAVE_KEY, JSON.stringify(save));
    counters.persists++;
  }

  // ---- screens ----
  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(40,20,90,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  const modeStars = () => save.stars[mode].reduce((a, b) => a + b, 0);
  function drawLevels() {
    const grid = $('grid'); grid.innerHTML = '';
    const un = save.unlocked[mode];
    for (let k = 0; k < L.PER_PAGE; k++) {
      const n = page * L.PER_PAGE + k + 1, cfg = L.LEVELS[n - 1], T = F.THEMES[cfg.theme], locked = n > un;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === un && !save.stars[mode][n - 1] ? ' next' : '');
      b.dataset.level = n;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.7), ${T.top} 45%, ${T.bot})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < save.stars[mode][n - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        S.init();
        if (locked) { S.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        S.click(); startLevel(n);
      });
      grid.appendChild(b);
    }
    for (const m of L.MODES) $('mode-' + m).classList.toggle('on', m === mode);
    $('pgPrev').disabled = page === 0; $('pgNext').disabled = page === 1;
    [...$('pgDots').children].forEach((d, i) => d.classList.toggle('on', i === page));
    $('worldText').textContent = page === 0 ? 'World 1 · Meadow' : 'World 2 · Cloud Tops';
    $('starCount').textContent = `${modeStars()}/${NLEV * 3}`;
  }
  function goLevels(m, pg) {
    activeId = null;
    if (m && L.MODE[m]) { mode = m; if (save.mode !== m) { save.mode = m; persist(); } }
    if (run) { run = null; }
    if (pg == null) pg = screen === 'levels' ? page : lastLevel > 10 ? 1 : 0;
    page = clamp(pg, 0, 1);
    screen = 'levels';
    drawLevels();
    show('levels');
    A.clearParts();
    const th = page ? 4 : 0;
    S.setKey(KEYS[th]); S.startMusic(9, KEYS[th]);
    A.keepThemes(th, th);
  }
  let lastLevel = 1;
  function setMode(m) {
    mode = m; save.mode = m; persist();
    drawLevels();
  }
  function setPage(pg) { page = clamp(pg, 0, 1); drawLevels(); }

  // ---- a level ----
  function startLevel(n, m) {
    n = clamp(Math.floor(n) || 1, 1, NLEV);
    if (m && L.MODE[m]) { mode = m; if (save.mode !== m) { save.mode = m; persist(); } }
    activeId = null; lastLevel = n; page = n > L.PER_PAGE ? 1 : 0;
    const rules = new L.Run(n, mode), c = rules.c, hl = A.hudLayout(rules.total);
    run = {
      n, mode, rules, c, phase: 'play', pt: 0, finger: null,
      hud: 0, owed: 0, debt: 0, flyCoins: [], lostCoins: [], timers: [], pulse: -1,
      tilt: 0, wob: 0, joy: 0, sprinkle: 0, trail: 0, dizzy: 0, flinch: 0,
      idle: 0, hint: null, hintCool: 0, everBloomed: save.plants > 0,
      kf: null, chestOpen: 0, results: false, stars: 0, hl, firstBloom: -1,
      pose: 'fly', twirl: 0, danced: 0,
    };
    screen = 'play'; show(null);
    S.setKey(KEYS[c.theme]); S.startMusic(c.theme, KEYS[c.theme]);
    A.clearParts();
    A.keepThemes(c.theme, c.theme);
    counters.levelsStarted++;
    return run;
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }

  // ---- what the rules say happened: the one place the game reacts ----
  const PETALS = ['#ffc1dd', '#ffe08a', '#c9b8ff', '#bfeaff'];
  function onEvent(e) {
    const r = run, R = r.rules;
    if (e.type === 'bloom') {
      const tip = A.wandTip(R.x, R.y, r.tilt);
      A.sprinkle(tip.x, tip.y, e.x, e.y);
      later(0.22, () => { if (run === r) { A.burst('bloom', e.x, e.y - 4, 0, PETALS[e.index % PETALS.length]); } });
      S.bloom(clamp(e.index / Math.max(1, R.total - 1), 0, 1));
      r.sprinkle = 0.6; r.dustPlant = e.index; r.joy = 0.8; r.idle = 0; r.hint = null; r.everBloomed = true;
      r.owed++; r.flyCoins.push({ t: -0.25, x0: e.x, y0: e.y - 18 });
      counters.blooms++; counters.coinsEarned++;
      save.plants++; save.coins++;
      persist();
    } else if (e.type === 'key') {
      A.burst('coin', e.x, e.y, 10); A.burst('twinkle', e.x, e.y, 30);
      S.key(); r.joy = 1; counters.keys++;
    } else if (e.type === 'bonk') {
      A.burst('bonk', R.x + 20, R.y); S.bonk(); later(0.28, () => S.grumble());
      r.dizzy = L.SHIELD; r.wob = 1; r.joy = 0; r.flinch = 1; r.idle = 0;
      counters.bonks++; save.bonks++;
      if (e.coinLost) { loseCoin(); save.coins = Math.max(0, save.coins - 1); }
      persist();
    } else if (e.type === 'land') {
      r.phase = 'land'; r.pt2 = 0; r.finger = null; activeId = null; r.hint = null;
      S.cheer();
      later(0.3, () => { A.burst('land', L.CHEST_SX, A.GROUND + 4); S.whoosh(); });
      if (R.keyGot) r.kf = { t: 0, pts: [[R.x + 30, R.y - 20], [chestX(), A.GROUND - 70]], durs: [0.9], done: false };
    } else if (e.type === 'keyFloat') {
      r.kf = { t: 0, pts: [[A.VW + 60, R.y - 150], [R.x + 30, R.y - 30], [chestX(), A.GROUND - 70]], durs: [0.8, 0.6], done: false };
      S.key();
    } else if (e.type === 'chest') {
      wonLevel();
    }
    return e;
  }
  const chestX = () => L.CHEST_SX;
  // Coins on show = coins won by plants in the rules, always: hud (in their rings) + owed (on the way) - debt (lost before they landed).
  function loseCoin() {
    counters.coinsLost++;
    if (run.hud > 0) {
      run.hud--;
      const sl = run.hl.slots[run.hud];
      run.lostCoins.push({ x: sl.x, y: sl.y, t: 0 });
      S.coinLost();
    } else run.debt++;   // the coin is still on its way: it will wobble away instead of landing
  }
  function stepCoins(dt) {
    const r = run;
    for (let i = 0; i < r.flyCoins.length; i++) {
      const c = r.flyCoins[i];
      if (c.t < 0) { c.t += dt; continue; }
      if (Math.random() < dt * 40) { const p = coinFlyPos(c, i); A.burst('twinkle', p.x, p.y, 8, '#fff3a0'); }
      if ((c.t += dt) < COIN_FLY) continue;
      const sl = slotFor(i);
      r.flyCoins.splice(i--, 1);
      r.owed--;
      if (r.debt > 0) { r.debt--; r.lostCoins.push({ x: sl.x, y: sl.y, t: 0 }); S.coinLost(); }
      else { r.hud++; r.pulse = r.hud - 1; r.pulseT = 0.3; A.burst('coin', sl.x, sl.y, 5); S.coin(); counters.coinsLanded++; }
    }
    for (let i = r.lostCoins.length - 1; i >= 0; i--) if ((r.lostCoins[i].t += dt) > 1.7) r.lostCoins.splice(i, 1);
    if (r.pulseT > 0 && (r.pulseT -= dt) <= 0) r.pulse = -1;
  }
  const slotFor = (k) => run.hl.slots[clamp(run.hud + k, 0, run.rules.total - 1)];
  function coinFlyPos(c, k) {
    const sl = slotFor(k), u = smooth(clamp(c.t / COIN_FLY, 0, 1));
    return { x: c.x0 + (sl.x - c.x0) * u, y: c.y0 + (sl.y - c.y0) * u - Math.sin(u * Math.PI) * 70, r: 15 + (sl.r - 15) * u };
  }

  // the catch that ends the course: progress is saved at once, the results come when the party has had its moment
  function wonLevel() {
    const r = run, R = r.rules, n = r.n;
    r.stars = R.stars;
    save.stars[r.mode][n - 1] = Math.max(save.stars[r.mode][n - 1], R.stars);
    save.unlocked[r.mode] = Math.min(NLEV, Math.max(save.unlocked[r.mode], n + 1));
    save.chests++; save.coins += L.CHEST_COINS;
    counters.chests++;
    persist();
    r.phase = 'win'; r.pt2 = 0;
    S.chest();
    A.fountain(chestX(), A.GROUND - 40, 16);
    later(0.5, () => A.burst('confetti', 0, 0, 0));
    later(1.0, () => { S.isabella(); A.fountain(chestX(), A.GROUND - 40, 10); });
    later(2.4, showResults);
  }
  function showResults() {
    const r = run;
    if (!r || r.results) return;
    r.results = true; screen = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    $('resCoins').textContent = r.rules.coins;
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < r.stars) S.star(i); }));
  }

  // ---- the hand that shows the slide: level 1 until the first bloom, and whenever she has been left alone a while ----
  function nextBud() {
    const r = run, R = r.rules, c = r.c;
    let best = null;
    for (let i = 0; i < c.plants.length; i++) {
      if (R.bloomAt[i] >= 0) continue;
      const q = L.plantAt(c, c.plants[i], R.t);
      if (q.x < R.x + 20 || q.x > A.VW - 40) continue;
      if (!best || q.x < best.x) best = { x: q.x, y: q.y, i };
    }
    return best;
  }
  function stepHint(dt) {
    const r = run, R = r.rules;
    if (r.phase !== 'play' || activeId != null) { r.hint = null; return; }
    if (r.hint) {
      r.hint.t += dt;
      if (r.hint.t >= HINT_T * 2 || r.rules.bloomAt[r.hint.i] >= 0) { r.hint = null; r.hintCool = 1; }
      return;
    }
    if ((r.hintCool -= dt) > 0) return;
    const firstTime = r.n === 1 && !r.everBloomed && r.pt > 0.8;
    if (!firstTime && r.idle < HINT_AFTER[r.mode]) return;
    const b = nextBud();
    if (!b) return;
    if (Math.abs(b.y - R.y) < 40) return;   // she is already at its height
    r.hint = { i: b.i, t: 0, y1: b.y }; r.idle = 0; counters.hints++;
  }

  // ---- input: a finger anywhere on the screen; its height is where she flies, and its x moves her a little ----
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  function hitIsabella(x, y) {
    const R = run.rules, dx = (x - R.x) / 90, dy = (y - R.y) / 80;
    return dx * dx + dy * dy <= 1;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (screen === 'results' || !run || upright()) return;
    counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    const p = A.toWorld(e.clientX, e.clientY);
    run.idle = 0;
    if (run.phase !== 'play') {
      // at the chest, a tap on Isabella is a twirl and a giggle
      if (hitIsabella(p.x, p.y)) { counters.twirls++; run.twirl = 1; A.burst('twinkle', run.rules.x, run.rules.y - 40, 40); S.giggle(); }
      return;
    }
    activeId = e.pointerId; run.finger = { x: p.x, y: p.y }; run.hint = null; run.hintCool = 3;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ }
  });
  window.addEventListener('pointermove', (e) => {
    if (!run || run.phase !== 'play' || screen !== 'play' || upright()) return;
    // if the finger that was steering has lifted, another finger still on the screen takes over as soon as it moves
    if (activeId == null && (e.pointerType !== 'mouse' || e.buttons) && e.target === canvas) activeId = e.pointerId;
    if (e.pointerId !== activeId) return;
    const p = A.toWorld(e.clientX, e.clientY);
    run.finger = { x: p.x, y: p.y };
    run.idle = 0;
    counters.moves++;
  });
  // a lifted finger is what counts as a user gesture on touch screens, so try starting sound here too
  const lift = (e) => {
    if (e.pointerId === activeId) { activeId = null; if (run) run.finger = null; }   // she drifts back toward the middle
    if (e.type === 'pointerup') S.init();
  };
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- buttons and navigation ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { S.init(); S.click(); fn(); });
  tap('resLevels', () => goLevels());
  tap('resReplay', () => startLevel(run ? run.n : 1));
  tap('resNext', () => startLevel(Math.min(NLEV, (run ? run.n : 0) + 1)));
  for (const m of L.MODES) tap('mode-' + m, () => setMode(m));
  tap('pgPrev', () => setPage(page - 1));
  tap('pgNext', () => setPage(page + 1));
  homeBtn.addEventListener('click', () => { S.init(); persist(); location.href = HUB; });
  // Android back: from a course to the level map, from the level map home
  window.__back = () => {
    if (screen === 'play' || screen === 'results') { persist(); goLevels(); return true; }
    persist(); location.href = HUB; return true;
  };
  window.__pause = () => { S.suspend(); persist(); };
  // grown-ups: hold the world name for 4 seconds to open every level in this mode (a test shortcut)
  let holdT = null;
  $('worldName').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { save.unlocked[mode] = NLEV; persist(); S.init(); S.rainbow(); drawLevels(); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('worldName').addEventListener(ev, () => clearTimeout(holdT));
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
  window.addEventListener('resize', () => { A.resize(); measureHome(); if (run) run.hl = A.hudLayout(run.rules.total); });

  // ---- the level-select sky: Isabella flying over the forest, past blooming flowers ----
  const menu = { t: 0, scroll: 0 };
  function stepMenu(dt) {
    menu.t += dt; menu.scroll += dt * 60;
    if (Math.random() < dt * 5) A.burst('trail', 0, 0);
    A.stepParts(dt);
  }
  function drawMenu() {
    const th = page ? 4 : 0;
    A.drawScene(th, menu.scroll, clock);
    const span = A.VW + 260, x = ((menu.t * 90) % span) - 130, y = 250 + Math.sin(menu.t * 1.3) * 60;
    A.drawIsabella(x, y, clock, { tilt: Math.cos(menu.t * 1.3) * 0.12, dust: 0.6, happy: true });
    A.drawParts();
  }

  // ---- drawing a level ----
  function drawPlay() {
    const r = run, R = r.rules, c = r.c, t = R.t, sc = R.scroll, win = r.phase === 'win';
    A.drawScene(c.theme, sc, clock);
    // the chest at the end of the course
    const cx = L.chestAt(c, t);
    if (cx < A.VW + 200) A.drawChestObj(cx, r.chestOpen, clock);
    // the key, until she has it
    if (!R.keyGot) { const k = L.keyAt(c, t); if (k.x > -80 && k.x < A.VW + 80) A.drawKeyObj(k.x, k.y, clock, 1.5); }
    // plants: the ones that hang in the air or stand tall first, then the ones on the ground
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < c.plants.length; i++) {
        const p = c.plants[i];
        if ((p.sup === 'cloud' || p.sup === 'mcloud' || p.sup === 'tree') !== (pass === 0)) continue;
        const q = L.plantAt(c, p, t), b = R.bloomAt[i], u = b >= 0 ? clamp((t - b) / L.BLOOM_T, 0, 1) : 0;
        A.drawPlant(p, q, u, clock, c.theme);
      }
    }
    // critters on the ground, then Isabella, then the bugs in the air in front of her
    for (const e of c.enemies) if (e.cls === 'critter' && r.phase === 'play') A.drawEnemy(e, L.enemyAt(c, e, t), clock);
    drawIsabella();
    if (r.sprinkle > 0 && r.dustPlant != null) {   // the wand's dust streams toward the bud that is blooming
      const q = L.plantAt(c, c.plants[r.dustPlant], t), tip = A.wandTip(R.x, R.y, r.tilt), pts = [];
      for (let i = 0; i < 8; i++) { const u = i / 8; pts.push({ x: tip.x + (q.x - tip.x) * u, y: tip.y + (q.y - tip.y) * u - Math.sin(u * Math.PI) * 18, age: (0.6 - r.sprinkle) * 1.3 + u * 0.5 }); }
      F.drawDust(A.ctx, pts, clock);
    }
    for (const e of c.enemies) if (e.cls === 'bug' && r.phase === 'play') A.drawEnemy(e, L.enemyAt(c, e, t), clock);
    // the key flying to the chest
    if (r.kf) drawKeyFlight();
    A.drawParts();
    // coins on their way to the coin row, and coins drifting away from it
    A.drawHud(R.total, r.hud, R.keyGot, clock, r.pulse);
    for (let k = 0; k < r.flyCoins.length; k++) {
      const cn = r.flyCoins[k];
      if (cn.t < 0) continue;
      const p = coinFlyPos(cn, k);
      F.drawCoin(A.ctx, p.x, p.y, clock * 7, p.r);
    }
    for (const lc of r.lostCoins) {
      const tt = lc.t, drift = Math.max(0, tt - 0.45), wob = Math.sin(tt * 16) * 0.5 * Math.max(0.25, 1 - tt / 1.7);
      A.ctx.save(); A.ctx.globalAlpha = 1 - smooth(clamp((tt - 0.6) / 1.1, 0, 1));
      A.ctx.translate(lc.x + drift * 60 + Math.sin(tt * 6) * 5, lc.y + drift * 22 - drift * drift * 30); A.ctx.rotate(wob);
      F.drawCoin(A.ctx, 0, 0, tt * 2, 13);
      A.ctx.restore();
    }
    if (r.hint) {
      const b = r.rules.bloomAt[r.hint.i] < 0 ? r.hint.y1 : R.y;
      A.drawHint(R.x + 60, R.y + 18, b + 10, (r.hint.t % HINT_T) / HINT_T, clock);
    }
  }
  function drawIsabella() {
    const r = run, R = r.rules;
    let pose = 'fly', y = R.y, x = R.x, tilt = r.tilt, alpha = 1;
    if (r.phase === 'land' || r.phase === 'win') {
      const near = Math.hypot(R.x - L.LAND_X, R.y - L.LAND_Y);
      pose = R.landed || near < 14 ? 'stand' : 'hover';
      if (pose === 'stand') y = A.GROUND + 4 - Math.abs(Math.sin(r.danced * 6)) * (r.phase === 'win' ? 10 : 0);
      tilt = pose === 'stand' ? 0 : tilt * 0.4;
    }
    if (r.dizzy > 0) alpha = Math.sin(clock * 30) > 0 ? 1 : 0.55;
    const twirl = r.twirl > 0 ? smooth(1 - r.twirl) * TAU : 0;
    A.drawIsabella(x, y, clock, { pose, tilt: tilt + twirl, alpha, happy: r.joy > 0 || r.phase === 'win', dust: r.sprinkle > 0 ? 1 : 0, glow: r.phase === 'win' ? 0.6 : 0 });
    if (r.dizzy > 0.2) A.drawDizzy(x + 22, y - 54, clock, r.dizzy / L.SHIELD);
  }
  function kfPos(kf) {
    let t = kf.t, i = 0;
    while (i < kf.durs.length - 1 && t > kf.durs[i]) { t -= kf.durs[i]; i++; }
    const u = smooth(clamp(t / kf.durs[i], 0, 1)), a = kf.pts[i], b = kf.pts[i + 1];
    return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * 40 };
  }
  function drawKeyFlight() {
    const kf = run.kf;
    if (kf.done) return;
    const p = kfPos(kf);
    A.drawKeyObj(p.x, p.y, clock, 1.3);
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
    events.length = 0;
    r.rules.step(dt, r.phase === 'play' ? r.finger : null, events);
    for (let i = 0; i < events.length; i++) onEvent(events[i]);
    const R = r.rules;
    if (r.phase === 'play') r.idle += dt; else r.pt2 = (r.pt2 || 0) + dt;
    // Isabella: how she leans, the wobble after a bonk, the sprinkle of dust
    const lean = clamp(R.vy / 1500, -0.3, 0.3) + (r.dizzy > 0 ? Math.sin(clock * 17) * 0.16 * Math.min(1, r.dizzy) : 0);
    r.tilt += (lean - r.tilt) * Math.min(1, dt * 10);
    if (r.dizzy > 0) r.dizzy = Math.max(0, r.dizzy - dt);
    if (r.joy > 0) r.joy = Math.max(0, r.joy - dt);
    if (r.sprinkle > 0) r.sprinkle = Math.max(0, r.sprinkle - dt);
    if (r.flinch > 0) r.flinch = Math.max(0, r.flinch - dt * 3);
    if (r.twirl > 0) r.twirl = Math.max(0, r.twirl - dt / 0.8);
    if (r.phase !== 'play') r.danced += dt;
    if ((r.trail -= dt) <= 0 && r.phase === 'play') { r.trail = r.sprinkle > 0 ? 0.03 : 0.09; const tip = A.wandTip(R.x, R.y, r.tilt); A.burst('trail', tip.x, tip.y); }
    // the chest opens when the rules say so; the key flies to it
    if (R.opened) r.chestOpen = smooth((R.t - R.openAt) / 0.6);
    if (r.kf && !r.kf.done) {
      r.kf.t += dt;
      if (r.kf.t >= r.kf.durs.reduce((a, b) => a + b, 0)) { r.kf.done = true; A.burst('twinkle', chestX(), A.GROUND - 70, 40); A.burst('coin', chestX(), A.GROUND - 70, 8); S.key(); }
    }
    stepCoins(dt);
    stepHint(dt);
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

  // ---- hooks for the headless tests (test/games/flight) ----
  window.__dbg = {
    counters,
    state() {
      const r = run, R = r ? r.rules : null, k = A.scale / A.dpr, c = r ? r.c : null;
      return {
        screen, mode, page, level: r ? r.n : null, phase: r ? r.phase : null, rulesPhase: R ? R.phase : null, t: R ? R.t : 0, tStop: c ? c.tStop : 0, scroll: R ? R.scroll : 0,
        x: R ? R.x : 0, y: R ? R.y : 0, xClient: R ? R.x * k : 0, yClient: R ? R.y * k : 0, vy: R ? R.vy : 0,
        coins: R ? R.coins : 0, hudCoins: r ? r.hud : 0, owed: r ? r.owed : 0, debt: r ? r.debt : 0, lostCoins: r ? r.lostCoins.length : 0, flyCoins: r ? r.flyCoins.length : 0,
        bloomed: R ? R.bloomed : 0, total: R ? R.total : 0, bonks: R ? R.bonks : 0, shield: R ? R.shield : 0, dizzy: r ? r.dizzy : 0, coinsLost: R ? R.coinsLost : 0,
        keyGot: R ? R.keyGot : false, keyFloat: R ? R.keyFloat : false, opened: R ? R.opened : false, done: R ? R.done : false, stars: R ? R.stars : null,
        chestOpen: r ? r.chestOpen : 0, results: !!(r && r.results), resultsStars: r && r.results ? r.stars : null, landed: R ? R.landed : false,
        finger: r ? r.finger : null, fingerDown: activeId != null, hint: r && r.hint ? r.hint.i : null, idle: r ? r.idle : 0,
        unlocked: save.unlocked[mode], unlockedAll: { easy: save.unlocked.easy, medium: save.unlocked.medium, hard: save.unlocked.hard },
        savedStars: save.stars[mode].slice(), savedStarsAll: JSON.parse(JSON.stringify(save.stars)), saveCoins: save.coins, savePlants: save.plants, chests: save.chests, saveMode: save.mode,
        VW: A.VW, scale: A.scale, dpr: A.dpr, canvas: [canvas.width, canvas.height], k,
        dust: c ? c.dust : 0, speed: c ? c.v : 0, theme: c ? c.theme : null, nEnemies: c ? c.enemies.length : 0,
        plants: R ? c.plants.map((p, i) => { const q = L.plantAt(c, p, R.t); return { i, cx: q.x * k, cy: q.y * k, x: q.x, y: q.y, bloomed: R.bloomAt[i] >= 0 }; }) : [],
        enemies: R ? c.enemies.map((e) => { const q = L.enemyAt(c, e, R.t); return { id: e.id, cls: e.cls, pat: e.pat, x: q.x, y: q.y, cx: q.x * k, cy: q.y * k }; }) : [],
        key: R ? Object.assign({ got: R.keyGot }, L.keyAt(c, R.t)) : null,
        parts: A.partCount, muted, audio: S.state, gain: S.gain, caches: A.cacheInfo(), homeZone,
      };
    },
    start(n, m, fresh) { startLevel(n, m); return run.n; },
    setMode(m) { setMode(m); return mode; },
    setPage(p) { setPage(p); return page; },
    goLevels(m, p) { goLevels(m, p); return true; },
    levels() { return L.LEVELS; },
    timeScale(k) { timeScale = k; return timeScale; },
    // step the game by `seconds` of game time right now (60 steps a second), with the finger where it is
    advance(seconds) {
      if (!run) { return 0; }
      let n = 0;
      for (let t = 0; t < seconds && run; t += 1 / 60) { clock += 1 / 60; update(1 / 60); n++; }
      return n;
    },
    setFinger(x, y) { if (run) run.finger = x == null ? null : { x, y }; return true; },
    // a grumpy bug right on top of her (the same rule code as a real bump)
    bonkNow() {
      if (!run || run.phase !== 'play') return false;
      const R = run.rules, c = R.c, v = c.v;
      const ghost = { id: 999, cls: 'bug', kind: 0, pat: 'straight', x: R.x - L.PX_NOM + R.scroll, y: R.y, r: L.BUG_R, ve: 0, amp: 0, om: 0, ph: 0, ax: 0, tm: R.t };
      if (c.enemies.indexOf(ghost) < 0) R.c = Object.assign({}, c, { enemies: c.enemies.concat([ghost]) });
      run.c = R.c;
      void v;
      return true;
    },
    // jump the course forward to just before the chest (for tests of the ending)
    toEnd(bloomAll) {
      if (!run) return false;
      const R = run.rules, c = R.c;
      if (bloomAll) for (let i = 0; i < c.plants.length; i++) if (R.bloomAt[i] < 0) { R.bloomAt[i] = R.t; R.bloomed++; R.coins++; save.plants++; save.coins++; run.owed++; run.flyCoins.push({ t: 0, x0: 400, y0: 200 }); }
      R.t = Math.max(R.t, c.tStop - 0.3); R.noEnemies = true;
      return true;
    },
    homeZone() { return homeZone; },
    muteNow(m) { muted = !!m; S.setMuted(muted); return muted; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    resetPerf() { perfN = 0; perf.fill(0); },
    saved() { return store.get(SAVE_KEY); },
    toClient(x, y) { return A.toClient(x, y); },
  };

  measureHome();
  goLevels(mode, 0);
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?level=4&mode=hard jumps straight into a level (handy for screenshots), if it is open
  const qs = new URLSearchParams(location.search), qLevel = +qs.get('level'), qMode = qs.get('mode');
  if (qMode && L.MODE[qMode]) { mode = qMode; drawLevels(); }
  if (qLevel >= 1 && qLevel <= NLEV && qLevel <= save.unlocked[mode]) startLevel(qLevel);
  requestAnimationFrame(frame);
})();
