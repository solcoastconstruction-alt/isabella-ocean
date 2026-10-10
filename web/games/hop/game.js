/* Toadstool Hop: screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js (and the shared
 * FairyArt), sound in sound.js.
 * Isabella the Fairy stands on a toadstool. A tap anywhere makes her hop to the next platform, aimed at where it will be when
 * she lands. Lily pads drift, clouds float up and down; if the hop is too far she splashes into the river, a frog pops up and
 * boosts her back, and nothing else happens (on Medium and Hard one coin drifts away). Coins sit on platforms, butterflies float
 * over the gaps, a key waits in the second half and opens the chest at the end. No timers shown, no words. */
(function () {
  'use strict';
  const A = HopArt, S = HopSound, L = HopLogic, F = FairyArt;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, PER = L.PER, MODE_IDS = L.MODE_IDS, SAVE_KEY = 'game.hop.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const LEAD = 0.30;           // Isabella stays this far across the screen (a third)
  const RESULTS_AFTER = 3.2;   // seconds after the chest opens
  const SAVE_EVERY = 5;

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
  const canvas = $('c'), homeBtn = $('home');
  A.init(canvas);
  let muted = readMuted();
  S.setMuted(muted);
  let screen = 'levels';   // levels | play | results
  let mode = save.mode, page = 0;
  let run = null;          // the level being played
  let clock = 0, last = 0, timeScale = 1, auto = false;   // auto: a test hook that taps for her whenever a hop would work
  const events = [];
  const counters = { downs: 0, taps: 0, hops: 0, splashes: 0, lands: 0, coinsEarned: 0, coinsLost: 0, butterflies: 0, keys: 0, chests: 0, persists: 0, levelsStarted: 0, hints: 0, pointerTypes: {}, ignored: 0 };

  function persist() {
    if (run && !run.rules.done) {
      const key = run.mode + ':' + run.n;
      if (run.rules.node > 0) save.runs[key] = run.rules.snapshot(); else delete save.runs[key];
    }
    save.mode = mode;
    store.set(SAVE_KEY, JSON.stringify(save));
    counters.persists++;
    if (run) { run.dirty = false; run.saveT = 0; }
  }

  // ---- screens ----
  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); $('hud').classList.toggle('on', id == null); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  function goLevels(m, pg) {
    if (run && !run.rules.done) persist();
    if (m && MODE_IDS.indexOf(m) >= 0) mode = m;
    page = pg != null ? clamp(pg, 0, 1) : page;
    screen = 'levels'; run = null;
    if (save.mode !== mode) persist();   // the mode she picked is remembered
    A.clearParts();
    const grid = $('grid'); grid.innerHTML = '';
    const unlocked = save.unlocked[mode], stars = save.stars[mode];
    for (let k = 0; k < PER; k++) {
      const n = page * PER + k + 1, cfg = L.LEVELS[n - 1], T = F.THEMES[cfg.theme], locked = n > unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === unlocked && !stars[n - 1] ? ' next' : '');
      b.dataset.level = n;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65), ${T.top} 45%, ${T.bot})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < stars[n - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        S.init();
        if (locked) { S.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        S.click(); startLevel(n);
      });
      grid.appendChild(b);
    }
    for (const id of MODE_IDS) $('mode-' + id).classList.toggle('on', id === mode);
    $('pgPrev').style.visibility = page > 0 ? 'visible' : 'hidden';
    $('pgNext').style.visibility = page < 1 ? 'visible' : 'hidden';
    $('pgDots').innerHTML = [0, 1].map((i) => `<span class="${i === page ? 'on' : ''}"></span>`).join('');
    $('coinCount').textContent = save.coins;
    show('levels');
    S.setKey(page ? 2 : 0); S.startMusic(9 + page, page ? 2 : 0);
  }

  // ---- a level ----
  function startLevel(n, fresh, m) {
    n = clamp(Math.floor(n) || 1, 1, NLEV);
    if (m && MODE_IDS.indexOf(m) >= 0) mode = m;
    if (run && !run.rules.done) persist();
    const cfg = L.LEVELS[n - 1], key = mode + ':' + n;
    if (fresh) delete save.runs[key];
    const rules = new L.Run(n, mode, save.runs[key]);
    const c = rules.c;
    const pose = rules.pose();
    run = {
      n, mode, cfg, rules, c, T: F.THEMES[cfg.theme], theme: cfg.theme,
      cam: pose.x - LEAD * A.VW, camV: 0,
      sq: {}, flies: [], lostCoins: [], dust: [],
      idle: 0, hint: 0, cue: 0, cueSide: 0, shownCoins: rules.coins,
      keyX: pose.x - 40, keyY: pose.y - 110, keyShown: rules.hasKey, keyFly: null,
      chestOpen: 0, openT: -1, doneT: -1, boinged: false, ribbited: false, landings: rules.node, dizzyed: false,
      results: false, stars: 0, dirty: false, saveT: 0, everHopped: rules.node > 0,
    };
    screen = 'play'; show(null);
    $('hudCoins').textContent = run.shownCoins;
    $('hudKey').classList.toggle('on', run.keyShown);
    const mk = [0, 2, 5, 7][cfg.theme % 4];
    S.setKey(mk); S.startMusic(cfg.theme, mk);
    counters.levelsStarted++;
  }

  // ---- what the rules say happened: the one place the game reacts ----
  function platPos(p, t) { return { x: L.posX(p, t), y: L.posY(p, t) }; }
  function addCoins(k, x, y) {
    for (let i = 0; i < k; i++) { save.coins++; counters.coinsEarned++; run.flies.push({ t: -i * 0.12, x, y }); }
  }
  function onEvent(e) {
    const r = run, R = r.rules;
    if (e.type === 'hop') {
      S.hop(e.far); counters.hops++; save.hops++; r.idle = 0; r.hint = 0; r.everHopped = true;
    } else if (e.type === 'land') {
      const p = R.c.plats[e.plat], pp = platPos(p, R.t);
      r.sq[e.plat] = 0; r.landings++;
      A.burst('land', pp.x, pp.y, 8);
      S.land(r.landings - 1);
      counters.lands++;
      if (e.coin) { A.burst('sparkle', pp.x, pp.y - 118, 10); S.coin(); addCoins(1, pp.x, pp.y - 118); }
      if (e.bonus) { A.burst('sparkle', pp.x, pp.y - 118, 12); if (e.bonus === 'butterfly') S.butterfly(); else S.coin(); addCoins(1, pp.x, pp.y - 118); }
      if (e.key) { counters.keys++; S.key(); A.burst('sparkle', pp.x, pp.y - 122, 16); r.keyShown = true; r.keyFly = { t: 0, x0: pp.x, y0: pp.y - 122 }; $('hudKey').classList.add('on'); }
      r.idle = 0; r.hint = 0;
      persist();
    } else if (e.type === 'butterfly') {
      counters.butterflies++; S.butterfly(); A.burst('sparkle', e.x, e.y, 14, null, '#ffffff'); addCoins(1, e.x, e.y);
    } else if (e.type === 'splash') {
      counters.splashes++; save.splashes++;
      S.splash(); A.burst('splash', e.x, 0, 16); r.boinged = false; r.ribbited = false; r.dizzyed = false;
      if (e.lost) {
        counters.coinsLost++;
        save.coins = Math.max(0, save.coins - 1);
        r.lostCoins.push({ t: 0, x: e.x, y: A.WATER - 70 });
      }
      r.idle = 0; r.hint = 0;
      persist();
    } else if (e.type === 'rescued') {
      r.idle = 0;
    } else if (e.type === 'keyFloat') {
      S.key(); r.chestKey = { t: 0 };
    } else if (e.type === 'chest') {
      r.openT = 0; counters.chests++; save.chests++;
      S.chest(); S.isabella();
      const cc = R.c.chest;
      A.burst('coin', cc.x, cc.y - 60, 28); A.burst('sparkle', cc.x, cc.y - 70, 26);
      addCoins(L.CHEST_COINS, cc.x, cc.y - 90);
    } else if (e.type === 'done') {
      wonLevel();
    }
  }
  function wonLevel() {
    const r = run, n = r.n, m = r.mode, stars = r.rules.stars;
    r.stars = stars; r.doneT = 0;
    save.stars[m][n - 1] = Math.max(save.stars[m][n - 1], stars);
    save.unlocked[m] = Math.min(NLEV, Math.max(save.unlocked[m], n + 1));
    delete save.runs[m + ':' + n];
    persist();
  }

  // ---- input: a tap anywhere; the left half or the right half picks the near or the far platform where there is a choice (Hard) ----
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (screen !== 'play' || !run || upright()) return;
    counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    tapAt(e.clientX < window.innerWidth / 2 ? -1 : 1);
  });
  function tapAt(side) {
    const r = run;
    if (!r) return false;
    r.idle = 0; r.hint = 0;
    if (r.rules.phase === 'chest' || r.rules.phase === 'done') {
      // at the chest party a tap on Isabella is a giggle
      S.giggle(); A.burst('sparkle', r.rules.pose().x, r.rules.pose().y - 60, 8);
      return false;
    }
    counters.taps++;
    events.length = 0;
    const ok = r.rules.tap(side, events);
    if (!ok) counters.ignored++;
    for (let i = 0; i < events.length; i++) onEvent(events[i]);
    return ok;
  }
  const lift = (e) => { if (e.type === 'pointerup') S.init(); };
  window.addEventListener('pointerup', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- buttons and navigation ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { S.init(); S.click(); fn(); });
  tap('resLevels', () => goLevels(run ? run.mode : mode, run ? Math.floor((run.n - 1) / PER) : page));
  tap('resReplay', () => startLevel(run ? run.n : 1, true, run ? run.mode : mode));
  tap('resNext', () => { const n = Math.min(NLEV, (run ? run.n : 0) + 1); page = Math.floor((n - 1) / PER); startLevel(n); });
  for (const m of MODE_IDS) tap('mode-' + m, () => goLevels(m));
  tap('pgPrev', () => goLevels(mode, Math.max(0, page - 1)));
  tap('pgNext', () => goLevels(mode, Math.min(1, page + 1)));
  homeBtn.addEventListener('click', () => { S.init(); persist(); location.href = HUB; });
  window.__back = () => { persist(); location.href = HUB; return true; };
  window.__pause = () => { S.suspend(); persist(); };
  // grown-ups: hold the title for 4 seconds to open every level of the mode
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { save.unlocked[mode] = NLEV; persist(); S.init(); S.rainbow(); goLevels(); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.suspend(); persist(); return; }
    const m = readMuted();
    if (m !== muted) { muted = m; S.setMuted(m); }
    S.resume(); last = 0;
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('resize', () => { A.resize(); });

  // ---- the menu glade: Isabella hops between two toadstools and a drifting pad; a frog waves ----
  const MENU = [
    { kind: 'mush', x: 250, y: 400, sz: 1.5, hw: 51, pal: 0, id: 100 },
    { kind: 'pad', x: 560, y: 458, sz: 66, hw: 66, pal: 3, id: 101 },
    { kind: 'mush', x: 850, y: 392, sz: 1.5, hw: 51, pal: 1, id: 102 },
  ];
  const menu = { t: 0 };
  function menuPose() {
    // a loop of 8 s: stand, hop to the pad, stand, hop to the far toadstool, stand, hop back over to the first
    const t = menu.t % 10, seq = [[0, 1.6, 0, 0], [1.6, 2.1, 0, 1], [2.1, 3.7, 1, 1], [3.7, 4.2, 1, 2], [4.2, 5.8, 2, 2], [5.8, 6.4, 2, 0], [6.4, 10, 0, 0]];
    const padX = (tm) => MENU[1].x + 40 * Math.sin(tm * 0.8), pos = (i, tm) => (i === 1 ? { x: padX(tm), y: 458 } : { x: MENU[i].x, y: MENU[i].y });
    for (const s of seq) {
      if (t < s[0] || t >= s[1]) continue;
      if (s[2] === s[3]) { const p = pos(s[2], menu.t); return { x: p.x, y: p.y, mode: 'stand' }; }
      const u = (t - s[0]) / (s[1] - s[0]), a = pos(s[2], menu.t - (t - s[0])), b = pos(s[3], menu.t + (s[1] - t));
      const hh = 44 + 0.17 * Math.abs(b.x - a.x);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - 4 * hh * u * (1 - u), mode: 'fly', u };
    }
    return { x: MENU[0].x, y: MENU[0].y, mode: 'stand' };
  }
  function stepMenu(dt) { menu.t += dt; A.stepParts(dt); }
  function drawMenu() {
    const T = F.THEMES[2], cam = 0 + Math.sin(menu.t * 0.1) * 30;
    A.drawScene(2, cam, clock);
    ctx().save(); ctx().translate(-cam, 0);
    for (const p of MENU) {
      const pp = p.kind === 'pad' ? { x: p.x + 40 * Math.sin(menu.t * 0.8), y: 458 } : { x: p.x, y: p.y };
      A.drawPlatform(p, pp.x, pp.y, T, clock, {});
    }
    A.drawWaterFront(2, cam, clock);
    A.drawFrog(MENU[1].x + 160, 466, clock, { pop: 0.5 + 0.5 * Math.sin(menu.t * 0.7), happy: true, look: Math.sin(menu.t) });
    const pose = menuPose();
    A.drawIsabella(pose, clock, { dust: pose.mode === 'fly' ? 1 : 0, happy: true });
    A.drawParts();
    ctx().restore();
  }
  const ctx = () => A.ctx;

  // ---- drawing a level ----
  function drawPlay() {
    const r = run, R = r.rules, c = r.c, T = r.T, t = R.t, W = A.VW, cx = r.cam;
    A.drawScene(r.theme, cx, clock);
    const cc = ctx();
    cc.save(); cc.translate(-cx, 0);
    const x0 = cx - 200, x1 = cx + W + 200;
    // platforms: toadstools and clouds first, then the front of the water, then the pads that float on it
    const vis = [];
    for (const p of c.plats) { const px = L.posX(p, t); if (px > x0 - 100 && px < x1 + 100) vis.push([p, px, L.posY(p, t)]); }
    const target = (R.phase === 'stand' || R.phase === 'hop') ? R.target(r.cueSide || -1) : null;
    const nextN = R.c.nodes[R.node + 1];
    const cands = nextN && R.phase === 'stand' ? [c.plats[nextN.main]].concat(nextN.far >= 0 ? [c.plats[nextN.far]] : []) : [];
    const sqv = (id) => (r.sq[id] != null ? clamp(r.sq[id] / 0.4, 0, 1) : 0);
    for (const v of vis) if (v[0].kind !== 'pad') A.drawPlatform(v[0], v[1], v[2], T, clock, { sq: sqv(v[0].id), glow: v[0] === target ? r.cue : 0 });
    A.drawWaterFront(r.theme, cx, clock);
    for (const v of vis) if (v[0].kind === 'pad') A.drawPlatform(v[0], v[1], v[2], T, clock, { sq: sqv(v[0].id), glow: v[0] === target ? r.cue : 0 });
    // coins, the key and the bonus things stand above their platforms until they are taken
    for (const [p, px, py] of vis) {
      if (p.coin && !R.took.has('c' + p.id)) A.drawCoin(px, py - 118 + Math.sin(clock * 3 + p.id) * 4, clock, 14);
      if (p.key && !R.took.has('k' + p.id)) A.drawKey(px, py - 122 + Math.sin(clock * 2.4 + p.id) * 5, clock, 1.1);
      if (p.bonus && !R.took.has('b' + p.id)) {
        if (p.bonus === 'coin') A.drawCoin(px, py - 118 + Math.sin(clock * 3 + p.id) * 4, clock, 15);
        else A.drawButterfly(px, py - 118, clock, p.id, 1.3);
      }
    }
    for (let i = 0; i < c.bfs.length; i++) { const f = c.bfs[i]; if (!R.bfGot.has(i) && f.x > x0 && f.x < x1) A.drawButterfly(f.x, f.y, clock, i, 1.4); }
    // the chest on the last bank
    const ch = c.chest;
    A.drawChest(ch.x, ch.y + 4, r.chestOpen, clock);
    // the choice: dotted hops to both platforms (Hard), so the two ways are plain
    if (R.phase === 'stand' && cands.length === 2 && R.M.byHalf) {
      const me = R.pose();
      for (let i = 0; i < 2; i++) { const q = cands[i]; A.drawGuide(me.x, me.y - 20, L.posX(q, t + 0.5), L.posY(q, t + 0.5) - 20, clock, i ? '#ffd23f' : '#ffffff', 0.85); }
    }
    // the frog and Isabella
    const pose = R.pose();
    if (R.phase === 'splash') drawSplashBits(pose);
    drawIsabellaNow(pose);
    // the key she carries, or the one that floats to the chest
    drawKeys(pose);
    // lost coins drift away
    for (const q of r.lostCoins) { const u = q.t; cc.save(); cc.globalAlpha = 1 - smooth(u / 1.4); F.drawCoin(cc, q.x + u * 30, q.y - u * 50 - 20 * Math.sin(u * 4), u * 10, 13); cc.restore(); }
    A.drawParts();
    cc.restore();
    // coins flying to the counter, the trail and the hand (screen space)
    drawFlies();
    A.drawTrail(c.nodes.length, R.node, R.hasKey, clock);
    if (r.hint > 0) {
      const left = cands.length === 2 && R.M.byHalf;
      A.drawHand(W * (left ? 0.3 : 0.64), A.H * 0.5, clock, smooth(r.hint) * 0.95);
    }
  }
  function drawIsabellaNow(pose) {
    const r = run, R = r.rules;
    const happy = R.phase === 'done' || R.phase === 'chest' || pose.mode === 'fly';
    const o = { dust: pose.mode === 'fly' ? 1 : 0, happy: happy || undefined };
    if (R.phase === 'splash' && pose.frog && pose.mode === 'sit' && pose.dizzy) { o.happy = false; }
    A.drawIsabella(pose, clock, o);
    if (R.phase === 'splash' && pose.dizzy && pose.ts < L.RESCUE_UP) A.drawDizzy(pose.x, pose.y - 100, clock, 1);
  }
  function drawSplashBits(pose) {
    const R = run.rules, s = R.sp, ts = pose.ts;
    const pop = ts < 0.3 ? ts / 0.3 : ts < L.RESCUE_UP + 0.1 ? 1 : 1 - (ts - L.RESCUE_UP - 0.1) / 0.45;
    const squat = ts > L.RESCUE_UP - 0.28 ? clamp((ts - (L.RESCUE_UP - 0.28)) / 0.28, 0, 1) * (ts > L.RESCUE_UP ? Math.max(0, 1 - (ts - L.RESCUE_UP) / 0.1) : 1) : 0;
    A.drawFrog(s.x, A.WATER + 10, clock, { pop: clamp(pop, 0, 1), squat, happy: ts > L.RESCUE_UP - 0.3, look: 0.5 });
  }
  function drawKeys(pose) {
    const r = run, R = r.rules;
    if (r.chestKey && !R.hasKey) {
      // the key floats over from the sky to the chest
      const k = r.chestKey, u = smooth(k.t / 0.9), ch = R.c.chest, x = ch.x - 140 + (ch.x - 20 - (ch.x - 140)) * u, y = ch.y - 240 + (ch.y - 70 - (ch.y - 240)) * u;
      A.drawKey(x, y, clock, 1.2);
    } else if (r.keyShown && R.phase !== 'done') {
      // it follows her, a little behind and above
      const ch = R.c.chest;
      if (R.phase === 'chest' && R.hasKey && !R.opened) { const u = smooth(R.chestT / L.CHEST_OPEN_T); A.drawKey(r.keyX + (ch.x - 20 - r.keyX) * u, r.keyY + (ch.y - 70 - r.keyY) * u, clock, 1.1); }
      else if (R.phase !== 'chest') A.drawKey(r.keyX, r.keyY, clock, 0.9);
    }
  }
  // coins on their way to the counter in the corner: world position in, screen position out
  function flyTarget() {
    const el = $('hudCoins').getBoundingClientRect(), p = A.toWorld(el.left - 14, el.top + el.height / 2);
    return p;
  }
  function drawFlies() {
    const r = run, cc = ctx(), tg = flyTarget();
    for (const f of r.flies) {
      if (f.t < 0) continue;
      const u = smooth(f.t / 0.75), sx = f.x - r.cam, sy = f.y;
      cc.save(); F.drawCoin(cc, sx + (tg.x - sx) * u, sy + (tg.y - sy) * u - Math.sin(u * Math.PI) * 60, f.t * 9, 14 - 3 * u); cc.restore();
    }
  }

  function draw() {
    A.begin();
    if (!run) drawMenu(); else drawPlay();
  }

  // ---- the main loop ----
  function stepPlay(dt) {
    const r = run, R = r.rules;
    events.length = 0;
    R.step(dt, events);
    for (let i = 0; i < events.length; i++) onEvent(events[i]);
    if (run !== r) return;
    if (auto && R.phase === 'stand' && L.safeFor(R, -1, 0.3)) { tapAt(-1); if (run !== r) return; }
    const pose = R.pose();
    // the rescue: ribbit as the frog comes up, the boing as it launches her
    if (R.phase === 'splash') {
      if (!r.ribbited && pose.ts > 0.12) { r.ribbited = true; S.ribbit(); }
      if (!r.dizzyed && pose.ts > 0.4) { r.dizzyed = true; S.dizzy(); }
      if (!r.boinged && pose.ts > L.RESCUE_UP) { r.boinged = true; S.boing(); A.burst('sparkle', pose.x, A.WATER - 40, 12); }
    }
    // a trail of fairy dust while she flies
    if (pose.mode === 'fly' && R.phase === 'hop' && Math.random() < dt * 40) A.burst('land', pose.x - 20, pose.y - 24, 1, null, F.RAINBOW[Math.floor(Math.random() * 7)]);
    // squash, flying coins, lost coins
    for (const k of Object.keys(r.sq)) { r.sq[k] += dt; if (r.sq[k] > 0.5) delete r.sq[k]; }
    for (let i = r.flies.length - 1; i >= 0; i--) {
      const f = r.flies[i];
      f.t += dt;
      if (f.t >= 0.75) { r.flies.splice(i, 1); r.shownCoins++; $('hudCoins').textContent = r.shownCoins; S.coin(); }
    }
    for (let i = r.lostCoins.length - 1; i >= 0; i--) { r.lostCoins[i].t += dt; if (r.lostCoins[i].t > 1.5) { r.lostCoins.splice(i, 1); } }
    // coins lost: the counter follows the rules at once
    if (r.flies.length === 0 && r.shownCoins !== R.coins) { r.shownCoins = R.coins; $('hudCoins').textContent = r.shownCoins; }
    if (r.shownCoins > R.coins) { r.shownCoins = R.coins; $('hudCoins').textContent = r.shownCoins; }
    // the carried key follows her
    const kx = pose.x - 46, ky = pose.y - 134 + Math.sin(clock * 3) * 4;
    if (r.keyFly) {
      r.keyFly.t += dt;
      const u = smooth(r.keyFly.t / 0.6);
      r.keyX = r.keyFly.x0 + (kx - r.keyFly.x0) * u; r.keyY = r.keyFly.y0 + (ky - r.keyFly.y0) * u;
      if (r.keyFly.t >= 0.6) r.keyFly = null;
    } else { r.keyX += (kx - r.keyX) * Math.min(1, dt * 8); r.keyY += (ky - r.keyY) * Math.min(1, dt * 8); }
    if (r.chestKey) r.chestKey.t += dt;
    // the chest
    if (r.openT >= 0) { r.openT += dt; r.chestOpen = smooth(r.openT / 0.7); }
    if (r.doneT >= 0) { r.doneT += dt; if (!r.results && r.doneT >= RESULTS_AFTER) showResults(); }
    // the camera: she stays a third of the way across; at the chest it settles so she and the chest are both in view
    let target = pose.x - LEAD * A.VW;
    if (R.phase === 'chest' || R.phase === 'done') target = R.c.chest.x - 0.36 * A.VW;
    r.cam += (target - r.cam) * (1 - Math.exp(-dt * (R.phase === 'hop' ? 7 : 4)));
    // a quiet spell: the hand shows where to tap; the next platform glows when a tap would work
    if (R.phase === 'stand') {
      r.idle += dt;
      if (r.idle > R.M.hint) { if (r.hint === 0) counters.hints++; r.hint = Math.min(1, r.hint + dt * 3); } else r.hint = Math.max(0, r.hint - dt * 6);
      const nd = R.c.nodes[R.node + 1];
      const wantCue = R.M.cue && nd && L.safeFor(R, -1, 0.4) ? 1 : 0;
      r.cueSide = -1;
      r.cue += (wantCue - r.cue) * Math.min(1, dt * 10);
    } else { r.hint = Math.max(0, r.hint - dt * 6); r.cue += (0 - r.cue) * Math.min(1, dt * 10); }
    if (R.phase !== 'done' && (r.saveT += dt) >= SAVE_EVERY) persist();
    A.stepParts(dt);
  }
  function showResults() {
    const r = run;
    if (!r) return;
    r.results = true; screen = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    $('resCoins').textContent = r.rules.coins;
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => setTimeout(() => { el.classList.add('pop'); if (i < r.stars) S.star(i); }, 250 + i * 380));
  }
  function update(dt) {
    if (run && screen === 'play') stepPlay(dt);
    else if (run) { A.stepParts(dt); }
    else stepMenu(dt);
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
        update(dt);
      }
      draw();
    }
    perf[perfN++ % perf.length] = performance.now() - t0;
    requestAnimationFrame(frame);
  }

  // ---- hooks for the headless tests (test/games/hop) ----
  function platInfo(p, t) {
    const x = L.posX(p, t), y = L.posY(p, t), c = A.toClient(x - run.cam, y), k = A.scale / A.dpr;
    return { id: p.id, kind: p.kind, node: p.node, far: p.far, x, y, cx: c.x, cy: c.y, hw: p.hw, hwClient: p.hw * k, coin: p.coin, key: p.key, bonus: p.bonus };
  }
  window.__dbg = {
    counters,
    state() {
      const r = run, R = r ? r.rules : null, k = A.scale / A.dpr;
      const nd = R ? R.c.nodes[R.node + 1] : null;
      const pre = R && R.phase === 'stand' && nd ? R.predict(-1) : null, preF = R && R.phase === 'stand' && nd && nd.far >= 0 ? R.predict(1) : null;
      const pose = R ? R.pose() : null;
      return {
        screen, mode, page, level: r ? r.n : null, theme: r ? r.theme : null, t: R ? R.t : 0, clock,
        phase: R ? R.phase : null, node: R ? R.node : 0, nodes: R ? R.c.nodes.length : 0, at: R ? R.at : null,
        coins: R ? R.coins : 0, shownCoins: r ? r.shownCoins : 0, splashes: R ? R.splashes : 0, hasKey: R ? R.hasKey : false, hops: R ? R.hops : 0,
        stars: R ? R.stars : null, done: R ? R.done : false, opened: R ? R.opened : false, results: !!(r && r.results), resultsStars: r && r.results ? r.stars : null,
        predictOk: pre ? pre.ok : null, predictFarOk: preF ? preF.ok : null, predictSlack: pre ? pre.slack : null, safe: R && nd && R.phase === 'stand' ? L.safeFor(R, -1, 0.4) : false,
        choice: !!(nd && nd.far >= 0), hardHalves: R ? R.M.byHalf : false, hintT: r ? r.hint : 0, idle: r ? r.idle : 0, cue: r ? r.cue : 0,
        pose: pose ? { x: pose.x, y: pose.y, mode: pose.mode, cx: A.toClient(pose.x - r.cam, pose.y).x, cy: A.toClient(pose.x - r.cam, pose.y).y } : null,
        cam: r ? r.cam : 0, keyShown: r ? r.keyShown : false, chestOpen: r ? r.chestOpen : 0, flies: r ? r.flies.length : 0, lostCoins: r ? r.lostCoins.length : 0,
        platforms: r ? R.c.plats.filter((p) => { const x = L.posX(p, R.t); return x > r.cam - 300 && x < r.cam + A.VW + 300; }).map((p) => platInfo(p, R.t)) : [],
        next: nd ? platInfo(R.c.plats[nd.main], R.t) : null, nextFar: nd && nd.far >= 0 ? platInfo(R.c.plats[nd.far], R.t) : null,
        unlocked: Object.assign({}, save.unlocked), savedStars: { easy: save.stars.easy.slice(), medium: save.stars.medium.slice(), hard: save.stars.hard.slice() }, savedCoins: save.coins, chests: save.chests,
        runs: Object.keys(save.runs), VW: A.VW, scale: A.scale, dpr: A.dpr, canvas: [canvas.width, canvas.height], parts: A.partCount, muted, audio: S.state, gain: S.gain,
        landings: r ? r.landings : 0, menuT: menu.t,
      };
    },
    start(n, m, fresh) { startLevel(n, !!fresh, m); return run.n; },
    tap(side) { return tapAt(side == null ? -1 : side); },
    goLevels(m, pg) { goLevels(m, pg); return true; },
    course(n, m) { return L.course(n, m); },
    timeScale(k) { timeScale = k; return timeScale; },
    auto(on) { auto = on !== false; return auto; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    resetPerf() { perfN = 0; perf.fill(0); },
    saved() { return store.get(SAVE_KEY); },
    homeRect() { const b = (homeBtn.querySelector('.btn') || homeBtn).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; },
  };

  goLevels();
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?level=4&mode=hard jumps straight into a level (handy for screenshots)
  const qs = new URLSearchParams(location.search), qLevel = +qs.get('level'), qMode = qs.get('mode');
  if (qMode && MODE_IDS.indexOf(qMode) >= 0) mode = qMode;
  if (qLevel >= 1 && qLevel <= NLEV && qLevel <= save.unlocked[mode]) startLevel(qLevel);
  requestAnimationFrame(frame);
})();
