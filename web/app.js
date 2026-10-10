/* Isabella the Mermaid — screens, input, saving, and the main loop. */
(function () {
  'use strict';
  const C = IsabellaCore, R = IsabellaRender, A = IsabellaAudio, H = IsabellaHub;
  const $ = (id) => document.getElementById(id);
  const NLEV = C.LEVELS.length;
  // Store flavor: World 2 waits for a grown-up's unlock (paywall.js). Family flavor: P is null and
  // every screen below behaves exactly as it always has.
  const P = window.Paywall && window.Paywall.enabled ? window.Paywall : null;
  const payLocked = (n) => !!P && n > P.freeLevels() && !P.worldOpen();

  // ---- saving (Android SharedPreferences when in the app, localStorage in a browser) ----
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
  let save = { unlocked: 1, stars: new Array(NLEV).fill(0), gold: 0, muted: false, played: false };
  try { const s = JSON.parse(store.get('isabella.save') || 'null'); if (s) save = Object.assign(save, s); } catch (e) { /* fresh save */ }
  // Saves from the 10-level game: pad the stars, and open the level after the highest one she
  // has finished (back then, finishing level 10 left `unlocked` capped at 10).
  save.stars = Array.from({ length: NLEV }, (_, i) => save.stars[i] || 0);
  const beaten = save.stars.reduce((m, st, i) => (st > 0 ? i + 1 : m), 0);
  save.unlocked = Math.min(NLEV, Math.max(save.unlocked || 1, beaten + 1));
  const persist = () => store.set('isabella.save', JSON.stringify(save));

  // ---- state ----
  let mode = 'title';       // title | more | levels | intro | play | paused | results
  let game = null, target = null, pointerId = null, touchedThisLevel = false;
  let clock = 0, last = 0, introTimer = 0, menuTheme = 1, lockedShakeT = 0;

  const canvas = $('c');
  R.init(canvas);
  R.setCrown(save.crown);
  A.setMuted(!!save.muted);

  function show(id) {
    for (const s of ['title', 'more', 'levels', 'intro', 'pause', 'results']) $(s).classList.toggle('on', s === id);
    $('pauseBtn').classList.toggle('on', id === null && mode === 'play');
  }
  function setSoundIcon() { $('soundBtn').querySelector('use').setAttribute('href', save.muted ? '#i-mute' : '#i-sound'); }

  // "Add to Home screen" — only inside the Android app, and only until the icon is there.
  function refreshPinButton() {
    let show = false;
    try { show = !!window.IsabellaApp && window.IsabellaApp.canPin() && !window.IsabellaApp.isPinned(); } catch (e) { show = false; }
    $('pinBtn').style.display = show ? '' : 'none';
    if (!show) $('pinHint').style.display = 'none';
  }
  window.__pinState = refreshPinButton;

  function goTitle() {
    mode = 'title'; game = null; show('title');
    $('goldTotal').textContent = save.gold;
    setSoundIcon();
    refreshPinButton();
    A.startMusic('title');
  }
  // The "+" on the title: the games that don't fit beside the Play button (hub.js has the list).
  function goMore() { mode = 'more'; show('more'); H.layout(); }
  function starSvg(on, size) {
    return `<svg viewBox="0 0 24 24" style="${size ? `width:${size};height:${size}` : ''}"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  // Ten levels a page: World 1 is levels 1-10, World 2 is 11-20.
  const PER = 10, PAGES = Math.ceil(NLEV / PER);
  let page = 0;
  function goLevels(pg) {
    mode = 'levels'; game = null;
    page = pg != null ? pg : Math.floor((Math.min(save.unlocked, NLEV) - 1) / PER);
    if (pg != null) menuTheme = page * PER + 1;
    $('worldName').textContent = `World ${page + 1}`;
    $('pgPrev').style.visibility = page > 0 ? 'visible' : 'hidden';
    $('pgNext').style.visibility = page < PAGES - 1 ? 'visible' : 'hidden';
    $('pgDots').innerHTML = Array.from({ length: PAGES }, (_, i) => `<span class="${i === page ? 'on' : ''}"></span>`).join('');
    drawGrid();
    show('levels');
    A.startMusic('title');
  }
  // A gold padlock means "a grown-up unlocks this" (store flavor, World 2 not unlocked yet); tapping
  // it asks for a grown-up. The grey padlock is the old one: finish the level before it first.
  function drawGrid() {
    const grid = $('grid'); grid.innerHTML = '';
    for (let n = page * PER + 1; n <= Math.min(NLEV, (page + 1) * PER); n++) {
      const th = R.THEMES[n - 1], paid = payLocked(n), locked = n > save.unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (paid ? ' paylock' : locked ? ' locked' : '');
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65), ${th.top} 45%, ${th.bot})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < save.stars[n - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`
        + (paid ? '<svg class="plock" viewBox="0 0 40 48"><use href="#i-padgold"/></svg>' : '');
      b.addEventListener('click', () => {
        A.init();
        if (payLocked(n)) { A.locked(); P.ask(); return; }
        if (locked) { A.locked(); return; }
        A.click(); startLevel(n);
      });
      grid.appendChild(b);
    }
  }
  function startLevel(n) {
    game = new C.Game(n, R.VW);
    menuTheme = n;
    touchedThisLevel = false; target = null; pointerId = null;
    mode = 'intro'; introTimer = 0;
    $('introNo').textContent = `Level ${n}`;
    $('introName').textContent = C.LEVELS[n - 1].name;
    show('intro');
    A.startMusic(n);
  }
  function beginPlay() { mode = 'play'; show(null); }
  function pauseGame() { if (mode !== 'play') return; mode = 'paused'; target = null; pointerId = null; show('pause'); }
  function resumeGame() { mode = 'play'; show(null); last = performance.now(); }

  function finishLevel() {
    const n = game.n, stars = game.stars();
    save.stars[n - 1] = Math.max(save.stars[n - 1], stars);
    save.unlocked = Math.min(NLEV, Math.max(save.unlocked, n + 1));
    save.gold += game.coinCount;
    const queen = n === NLEV;
    if (queen) { save.crown = true; R.setCrown(true); }
    persist();
    mode = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < stars)).join('');
    $('resCoins').textContent = game.coinCount;
    resultButtons();
    $('resCrown').style.display = queen ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => setTimeout(() => { el.classList.add('pop'); if (i < stars) A.star(i); }, 250 + i * 380));
  }
  // A World 2 level always plays to the end. If the unlock went away meanwhile, its results keep
  // the stars and coins but only lead back to the levels, where the padlock now shows.
  function resultButtons() {
    const n = game.n, gone = payLocked(n);
    $('resNext').style.display = n < NLEV && !gone ? '' : 'none';
    $('resReplay').style.display = gone ? 'none' : '';
  }

  // ---- input: Isabella swims toward the finger (sitting just ahead of it so the finger never hides what's coming) ----
  function aim(e) {
    const p = R.toWorld(e.clientX, e.clientY);
    target = { x: p.x + 60, y: p.y };
  }
  canvas.addEventListener('pointerdown', (e) => {
    A.init();
    if (mode === 'intro') { beginPlay(); }
    if (mode !== 'play') return;
    pointerId = e.pointerId; touchedThisLevel = true; aim(e);
  });
  window.addEventListener('pointermove', (e) => { if (mode === 'play' && e.pointerId === pointerId) aim(e); });
  const lift = (e) => { if (e.pointerId === pointerId) { pointerId = null; target = null; } };
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  $('intro').addEventListener('pointerdown', (e) => {
    A.init(); beginPlay();
    pointerId = e.pointerId; touchedThisLevel = true; aim(e);
  });

  // ---- buttons ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
  tap('playBtn', () => { save.played = true; persist(); goLevels(); });
  // The other games are their own pages; their home buttons come back here. hub.js lists them and
  // draws their buttons, two on the title and the rest on the "+" screen.
  for (const id of ['games', 'moreGrid']) {
    $(id).addEventListener('click', (e) => {
      const g = H.gameOf(e.target);
      if (!g) return;
      A.init(); A.click(); persist(); location.href = g.page;
    });
  }
  // The corner button flips the title between the ocean and the fairy world (hub.js redraws both screens
  // and remembers the choice). The flagship fairy game is the big middle button there: hub.js draws it, and
  // the click handler above opens whichever game's button was pressed.
  tap('worldBtn', () => H.setWorld(H.getWorld() === 'fairy' ? 'ocean' : 'fairy'));
  tap('moreBtn', goMore);
  tap('moreBack', goTitle);
  tap('soundBtn', () => { save.muted = !save.muted; A.setMuted(save.muted); persist(); setSoundIcon(); });
  tap('levelsHome', goTitle);
  let hintT = null;
  tap('pinBtn', () => {
    $('pinHint').style.display = 'block';
    clearTimeout(hintT); hintT = setTimeout(() => { $('pinHint').style.display = 'none'; }, 8000);
    try { window.IsabellaApp.pinToHome(); } catch (e) { /* not in the Android app */ }
  });
  tap('pgPrev', () => goLevels(Math.max(0, page - 1)));
  tap('pgNext', () => goLevels(Math.min(PAGES - 1, page + 1)));
  tap('pauseBtn', pauseGame);
  tap('pauseResume', resumeGame);
  tap('pauseHome', goLevels);
  tap('pauseRestart', () => startLevel(game.n));
  tap('resLevels', goLevels);
  tap('resReplay', () => startLevel(game.n));
  tap('resNext', () => {
    const next = Math.min(NLEV, game.n + 1);
    if (payLocked(next)) { P.ask(); return; }   // "next" after level 10, before World 2 is unlocked
    startLevel(next);
  });

  // Grown-ups: hold the title for 4 seconds to unlock every level.
  let holdT = null;
  $('logo').addEventListener('pointerdown', () => { holdT = setTimeout(() => { save.unlocked = NLEV; persist(); A.key(); }, 4000); });
  $('logo').addEventListener('pointerup', () => clearTimeout(holdT));
  $('logo').addEventListener('pointerleave', () => clearTimeout(holdT));

  // Android back button (called from MainActivity). Return true if handled.
  window.__back = function () {
    if (P && P.back()) return true;   // closes the gate, paywall, grown-ups screen or "ask a grown-up"
    if (mode === 'play') { pauseGame(); return true; }
    if (mode === 'paused') { resumeGame(); return true; }
    if (mode === 'intro' || mode === 'results') { goLevels(); return true; }
    if (mode === 'levels' || mode === 'more') { goTitle(); return true; }
    return false;
  };
  window.__pause = function () { pauseGame(); A.suspend(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) window.__pause(); else A.resume(); });
  window.addEventListener('resize', () => { R.resize(); if (game) game.setView(R.VW); });

  // ---- events from the game -> sound, sparkle, buzz ----
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* no vibration */ } };
  function handleEvents() {
    for (const e of game.ev) {
      switch (e.type) {
        case 'coin': A.coin(); R.burst('coin', e.x, e.y); break;
        case 'key': A.key(); R.burst('key', e.x, e.y); buzz(40); break;
        case 'hit': A.hit(); R.burst('hit', e.x, e.y); buzz(120); break;
        case 'heart': A.heart(); R.burst('heart', e.x, e.y); break;
        case 'checkpoint': A.checkpoint(); R.burst('checkpoint', e.x, e.y); break;
        case 'lost': A.lost(); R.burst('lost', e.x, e.y); target = null; pointerId = null; break;
        case 'respawn': A.respawn(); R.burst('respawn', e.x, e.y); break;
        case 'keyback': A.bubble(); R.burst('keyback', e.x, e.y); break;
        case 'locked': A.locked(); R.burst('locked', e.x, e.y); lockedShakeT = 0.5; break;
        case 'win': A.fanfare(); R.fountain(e.x, e.y - 30, game.n === NLEV ? 160 : 60); buzz(80); pauseBtnOff(); break;
      }
    }
    game.ev.length = 0;
  }
  function pauseBtnOff() { $('pauseBtn').classList.remove('on'); }

  // ---- main loop ----
  let winFountain = 0;
  function frame(nowMs) {
    const dt = Math.min(0.05, last ? (nowMs - last) / 1000 : 0);
    last = nowMs; clock += dt;
    if (mode === 'title' || mode === 'more' || mode === 'levels') {
      // Isabella's own level map is always the sea; the title and its "+" screen follow the world.
      if (mode !== 'levels' && H.getWorld() === 'fairy') R.drawFairyAttract(clock, dt);
      else R.drawAttract(clock, dt, mode === 'levels' ? menuTheme : 1);
    } else if (game) {
      if (mode === 'play') {
        let rem = dt;
        while (rem > 1e-6) { const h = Math.min(rem, 1 / 90); game.step(h, target); rem -= h; }
        handleEvents();
        if (game.state === 'win') {
          winFountain -= dt;
          if (game.st < (game.n === NLEV ? 3.2 : 2.6) && winFountain <= 0) { winFountain = 0.18; R.fountain(game.lev.chestX, C.SAND - 60, game.n === NLEV ? 18 : 10); }
          if (game.st > 3.6) finishLevel();
        }
      }
      if (mode === 'intro') { introTimer += dt; if (introTimer > 2.6) beginPlay(); }
      if (lockedShakeT > 0) lockedShakeT -= dt;
      const drawDt = mode === 'play' || mode === 'results' ? dt : 0;
      R.drawGame(game, drawDt, clock, { lockedShake: lockedShakeT > 0 });
      if (mode !== 'results') R.drawHUD(game, clock, game.n === 1 && !touchedThisLevel && game.t < 12 && mode === 'play');
    }
    requestAnimationFrame(frame);
  }

  // debug hooks for testing on the device
  window.__dbg = {
    start: startLevel, play: beginPlay,
    get game() { return game; }, get mode() { return mode; },
    get world() { return H.getWorld(); }, setWorld(w) { return H.setWorld(w); },
    unlockAll() { save.unlocked = NLEV; persist(); },
    reset() { save = { unlocked: 1, stars: new Array(NLEV).fill(0), gold: 0, muted: false, played: false }; persist(); goTitle(); },
  };

  goTitle();
  requestAnimationFrame(frame);

  // Store flavor: check the unlock now (without waiting) and keep checking; re-draw the padlocks
  // whenever it changes. Mid-level nothing moves: the level finishes first (see resultButtons).
  if (P) {
    P.boot({
      onChange() {
        if (mode === 'levels') drawGrid();
        else if (mode === 'results' && game) resultButtons();
      },
      onUnlocked() {
        if (mode === 'play' || mode === 'paused' || mode === 'intro') return;
        goLevels(Math.floor(P.freeLevels() / PER));   // the World 2 page
        A.fanfare();
        R.fountain(R.VW - 130, C.SAND - 60, 120);   // out of the treasure chest on the menu background
        R.fountain(R.VW * 0.3, C.SAND - 60, 60);
      },
    });
  }
})();
