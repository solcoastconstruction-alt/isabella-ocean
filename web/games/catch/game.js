/* Sea Catch: screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js,
 * sound in sound.js.
 * Sea friends drift down in bubbles. A finger anywhere on the screen, sliding left and right, is where
 * Isabella swims to: she eases toward it, a big shell on her head. A friend that lands in the shell sits
 * there a moment, then hops into the counting tray and a big numeral counts it, 1 to 10. Ten gather into
 * a gold coin that flies up to the coin row; the golden friend turns straight into a coin. When the level's
 * coins are all in, the treasure chest pushes up out of the sand and bursts with coins. Grumpy things come
 * down on dark spiky badges: one in the shell is a soft bonk, a wobble, and a coin drifts away.
 * A friend that gets past swims off, and nothing is lost. No timers, no words. */
(function () {
  'use strict';
  const A = CatchArt, S = CatchSound, L = CatchLogic;
  const { SCENES, FLOOR } = A;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, SAVE_KEY = 'game.catch.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const SIT_T = 0.42;     // a caught friend sits in the shell this long...
  const FLY_T = 0.6;      // ...then hops into its place in the tray
  const GATHER_T = 0.45, MERGE_T = 0.5, COIN_FLY = 0.85;   // ten friends hop, gather into a coin, and it flies up
  const HINT_T = 2.6;     // one showing of the "slide your finger" hand
  const SAVE_EVERY = 2.5; // seconds between saves of a level in progress (coins and bonks are saved at once)
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
  // sound follows the main game's setting (read only: this game never writes isabella.save)
  function readMuted() { try { return !!JSON.parse(store.get('isabella.save') || '{}').muted; } catch (e) { return false; } }
  let save = L.migrate(store.get(SAVE_KEY));

  // ---- state ----
  const canvas = $('c'), homeBtn = $('home'), homeDot = homeBtn.querySelector('.btn');
  A.init(canvas);
  let muted = readMuted();
  S.setMuted(muted);
  let screen = 'levels';   // levels | play | results
  let run = null;          // the level being played
  let clock = 0, last = 0, timeScale = 1, homeZone = null, activeId = null, sheetOn = false;
  const events = [];       // what happened in a step (reused)
  const counters = { downs: 0, moves: 0, pointerTypes: {}, catches: 0, golds: 0, bonks: 0, misses: 0, coinsEarned: 0, coinsLost: 0, coinsLanded: 0,
    chests: 0, landed: 0, isabellaTaps: 0, persists: 0, levelsStarted: 0, hints: 0, countLog: [] };   // countLog: [number counted, game time], the last 30

  function persist() {
    if (run && !run.rules.done) {
      const snap = run.rules.snapshot();
      if (snap.coins || snap.tray.length || snap.bonks) save.runs[run.n] = snap; else delete save.runs[run.n];
    }
    store.set(SAVE_KEY, JSON.stringify(save));
    counters.persists++;
    if (run) { run.dirty = false; run.saveT = 0; }
  }

  // ---- screens ----
  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  function goLevels() {
    activeId = null;
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
  function startLevel(n, fresh, seed) {
    n = clamp(Math.floor(n) || 1, 1, NLEV);
    activeId = null;
    if (run && run.n !== n && !run.rules.done) persist();   // keep the other level's coins for later
    const cfg = L.LEVELS[n - 1];
    if (fresh) delete save.runs[n];
    const rules = new L.Run(n, save.runs[n], { vw: A.VW, seed: seed == null ? (Math.random() * 4294967296) >>> 0 : seed });
    const tray = new Array(L.TRAY).fill(null);
    rules.tray.forEach((kind, i) => { tray[i] = { kind, col: L.colourOf(n, kind), hop: -1, hopH: 0, seed: Math.random() * 10 }; });
    run = {
      n, cfg, rules, phase: 'play', pt: 0, finger: null,
      friends: [], leavers: [], numerals: [], flyCoins: [], lostCoins: [], timers: [],
      tray, visBatch: rules.trays, hud: rules.coins, owed: 0, debt: 0, gather: null, flyGap: 0,
      chest: null, popQueue: [], popT: 0, popN: 0,
      face: 1, faceTo: 1, tilt: 0, bump: 0, lit: 0, dizzy: 0, joy: 0, trail: 0, twirl: 0, twirlT: 0.4, rise: 0,
      idle: 0, hint: null, hintCool: 0, everCaught: rules.coins > 0 || rules.tray.length > 0,
      results: false, stars: 0, dirty: false, saveT: 0,
    };
    fitHome();
    screen = 'play'; show(null);
    const sc = SCENES[cfg.scene];
    S.setKey(sc.key); S.startMusic(cfg.scene, sc.key);
    A.keepScenes(cfg.scene, cfg.scene);
    counters.levelsStarted++;
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }
  // nothing starts its fall behind the home button
  function fitHome() {
    if (run && homeZone) run.rules.spawner.homeX = Math.max(L.HOME_X, homeZone.x + homeZone.r + A.BADGE_R + 2);
  }

  // ---- what the rules say happened: the one place the game reacts (a real catch and window.__catchDebug.catchItem both come here) ----
  function onEvent(e) {
    const r = run, it = e.item, R = r.rules;
    if (e.type === 'spawn') {
      it.grow = 0; it.seed = Math.random() * 10; it.flip = Math.random() < 0.5; it.happy = false; it.hidden = false;
    } else if (e.type === 'catch') {
      A.burst('pop', it.x, it.y, it.r);
      A.burst('land', R.px, A.SHELL_Y - 8, 46, it.col === 'rainbow' ? '#ffd93d' : it.col);
      S.caught(clamp(e.slot / 9, 0, 1));
      // kept in counting order
      r.friends.push({ kind: it.kind, col: it.col, slot: e.slot, batch: e.batch, t: 0, state: 'sit', seed: it.seed || 0, x0: it.x - R.px, y0: it.y, fx: 0, fy: 0 });
      r.bump = 1; r.joy = 0.7; r.idle = 0; r.hint = null; r.everCaught = true;
      counters.catches++;
      save.total++;
      if (e.coin) { r.owed++; save.coins++; counters.coinsEarned++; }
      if (e.chest) wonLevel(); else if (e.coin) persist(); else r.dirty = true;
    } else if (e.type === 'gold') {
      A.burst('pop', it.x, it.y, it.r); A.burst('coin', R.px, A.SHELL_Y - 14);
      S.golden();
      r.owed++; r.flyCoins.push({ t: 0, x0: R.px, y0: A.SHELL_Y - 18 });
      r.bump = 1; r.joy = 1.2; r.idle = 0; r.hint = null; r.everCaught = true;
      counters.golds++; counters.coinsEarned++;
      save.golds++; save.coins++;
      if (e.chest) wonLevel(); else persist();
    } else if (e.type === 'bonk') {
      // a soft bump: the grump bounces out of the shell, huffs and swims off; she sees stars for a moment
      A.burst('bonk', R.px, A.SHELL_Y - 16);
      S.bonk(); later(0.28, () => S.grumble());
      r.leavers.push({ mode: 'grump', kind: it.kind, col: it.col, x: it.x, y: Math.min(it.y, A.SHELL_Y - 20), sc: 0.98, t: 0, stomp: 1.0, huffT: 0.3, seed: it.seed || 0,
        dir: it.x < A.VW / 2 ? -1 : 1, vy: -230 });
      r.dizzy = L.SHIELD; r.bump = 1; r.joy = 0; r.idle = 0;
      counters.bonks++;
      if (e.coinLost) loseCoin();
      persist();
    } else if (e.type === 'miss') {
      counters.misses++;
    }
    return e;
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

  // ---- what is falling: the rules move it; here it only grows in, twinkles, and swims off if it gets past ----
  function stepItems(dt) {
    const R = run.rules;
    let lit = 0;
    for (const it of R.items) {
      if (it.grow == null) { it.grow = 1; it.seed = it.seed || Math.random() * 10; it.flip = false; it.hidden = false; }   // put there by a test hook
      if (it.grow < 1) it.grow = Math.min(1, it.grow + dt * 2.6);
      if (it.hidden) continue;
      if (it.gold && Math.random() < dt * 14) A.burst('twinkle', it.x, it.y, it.r, Math.random() < 0.5 ? '#fff3a0' : '#ffd23f');
      if (!it.grumpy && !it.past && run.phase === 'play') {
        // the shell glows when she is under a friend that is nearly there
        const dy = L.CATCH_Y - it.y, under = dy > -L.FRIEND_ZONE.down && dy < 170 && Math.abs(it.x - R.px) <= L.FRIEND_ZONE.hw;
        if (under) lit = 1;
        it.happy = under && dy < 120;   // it sees the shell coming, and smiles
      }
      // a friend that got past pops out of its bubble at the sand and swims away, quite happy
      if (!it.grumpy && it.past && it.y > FLOOR - 62) {
        it.hidden = true;
        A.burst('pop', it.x, it.y, it.r * 0.8);
        if (run.phase === 'play') S.away();
        swimAway(it);
      }
    }
    run.lit += (lit - run.lit) * Math.min(1, dt * 9);
  }
  function swimAway(it) {
    const dir = it.x < A.VW / 2 ? -1 : 1;
    run.leavers.push({ mode: 'swim', kind: it.kind, col: it.col, x: it.x, y: it.y, sc: it.r * A.INSIDE, t: 0, seed: it.seed || 0, vx: dir * rnd(170, 220), vy: rnd(-120, -70), dir });
  }

  // ---- Isabella: which way she faces, how she leans, the stars after a bonk ----
  function stepIsabella(dt) {
    const r = run, R = r.rules, v = R.vel;
    if (r.phase === 'play') {
      if (v > 70) r.faceTo = 1; else if (v < -70) r.faceTo = -1;
    }
    r.face = clamp(r.face + clamp(r.faceTo - r.face, -dt * 9, dt * 9), -1, 1);   // a turn takes about a quarter of a second
    const lean = clamp(v / 900, -1, 1) * 0.13 + (r.dizzy > 0 ? Math.sin(clock * 17) * 0.13 * Math.min(1, r.dizzy) : 0);
    r.tilt += (lean - r.tilt) * Math.min(1, dt * 10);
    if (r.dizzy > 0) r.dizzy = Math.max(0, r.dizzy - dt);
    if (r.joy > 0) r.joy = Math.max(0, r.joy - dt);
    if (r.bump > 0) r.bump = Math.max(0, r.bump - dt * 4);
    if (r.twirl > 0) r.twirl = Math.max(0, r.twirl - dt / 0.8);
    if (Math.abs(v) > 260 && (r.trail -= dt) <= 0) { r.trail = 0.09; A.burst('trail', R.px - r.face * (A.SHELL_DX + 120), A.ISA_Y + 6); }
    if (r.phase === 'win' && r.chest) {
      // she swims over and up, to float above the open chest in the fountain of coins, and twirls there
      const tx = clamp(r.chest.x + 50, L.PX_MIN, A.VW - L.PX_MIN);
      R.aim = tx;
      r.rise = Math.min(1, r.rise + dt / 1.3);
      if (Math.abs(R.px - tx) < 50) { r.faceTo = -1; if (r.chest.open > 0.9 && (r.twirlT -= dt) <= 0) { r.twirl = 1; r.twirlT = 1.9; } }
      else r.faceTo = tx > R.px ? 1 : -1;
    }
  }

  // ---- caught friends: sit in the shell, hop into the tray, get counted ----
  const sitPos = (f, i, n) => {
    // from where it was caught, into the shell (they sit side by side if there are several)
    const u = smooth(clamp(f.t / 0.16, 0, 1)), R = run.rules;
    const tx = R.px + (i - (n - 1) / 2) * 30, ty = A.SHELL_Y - 16 - Math.abs(Math.sin(f.t * 9)) * 9;
    f.fx = R.px + f.x0 + (tx - R.px - f.x0) * u; f.fy = f.y0 + (ty - f.y0) * u;
  };
  function flyPos(f) {
    const u = smooth(clamp(f.t / FLY_T, 0, 1)), tx = A.trayX(f.slot), ty = A.TRAY_Y;
    return { x: f.fx + (tx - f.fx) * u, y: f.fy + (ty - f.fy) * u - Math.sin(u * Math.PI) * 60, u };
  }
  // Friends are kept in the order they were caught, so going through them forwards is counting order.
  function stepFriends(dt) {
    const r = run;
    if (r.flyGap > 0) r.flyGap -= dt;
    let sitting = 0, arrived = null;
    for (const f of r.friends) if (f.state === 'sit') sitting++;
    let i = 0;
    for (const f of r.friends) {
      f.t += dt;
      if (f.state === 'sit') {
        sitPos(f, i++, sitting);
        // a friend from the next ten waits in the shell until the last ten have turned into their coin, and friends
        // ready at the same moment hop into the tray one after another, so the count always reads 1, 2, 3
        if (f.t >= SIT_T && f.batch === r.visBatch && !r.gather && r.flyGap <= 0) { f.state = 'fly'; f.t = 0; r.flyGap = 0.17; }
      } else if (f.t >= FLY_T) { if (!arrived) arrived = f; }
      else if (Math.random() < dt * 30) { const p = flyPos(f); A.burst('twinkle', p.x, p.y, 12, '#fff8c0'); }
    }
    if (arrived) { r.friends.splice(r.friends.indexOf(arrived), 1); arrive(arrived); }
  }
  const NUM = 84;
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
  // the k-th coin in flight arcs up to the k-th empty ring, shrinking as it goes
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
        if (v.t > 0.3) { v.x += v.vx * dt; v.y += v.vy * dt; v.vy -= 20 * dt; }
      } else if (v.t > v.stomp) {
        v.x += v.dir * 260 * dt; v.y -= 50 * dt;   // off it swims, still cross
      } else {
        // out of the shell with a little bounce, then it hangs there huffing
        v.y += v.vy * dt; v.vy *= Math.exp(-dt * 5); v.x += v.dir * 40 * dt * Math.exp(-v.t * 3);
        if ((v.huffT -= dt) <= 0) { v.huffT = 0.3; A.burst('huff', v.x - v.dir * 8, v.y - v.sc * 34); }
      }
      if (v.y < -110 || v.x < -180 || v.x > A.VW + 180 || v.t > 9) run.leavers.splice(i, 1);
    }
  }

  // ---- the "slide your finger" hand: level 1 until the first catch, and whenever she has been left alone a while ----
  const hintFriend = (it) => !it.grumpy && !it.past && !it.hidden && it.y > 10 && it.y < L.CATCH_Y - 60;
  function stepHint(dt) {
    const r = run, R = r.rules;
    if (r.phase !== 'play' || activeId != null) { r.hint = null; return; }
    if (r.hint) {
      const it = R.items.find((q) => q.id === r.hint.id);
      if (!it || !hintFriend(it) || (r.hint.t += dt) >= HINT_T * 2) { r.hint = null; r.hintCool = 0.8; }
      return;
    }
    if ((r.hintCool -= dt) > 0) return;
    const firstTime = r.n === 1 && !r.everCaught && r.pt > 0.8;
    if (!firstTime && r.idle < 9) return;
    let best = null, bd = -1;
    for (const it of R.items) {
      if (!hintFriend(it) || it.y > L.CATCH_Y - 190) continue;
      const d = Math.abs(it.xc - R.px);
      if (d < 110) continue;   // she is nearly under it already: no slide to show
      if (it.y > bd) { bd = it.y; best = it; }   // the lowest one: the next to arrive
    }
    if (best) { r.hint = { id: best.id, t: 0 }; r.idle = 0; counters.hints++; }
  }

  // ---- the chest ----
  // the catch that reaches the level's coins: progress is saved at once, the party starts when the last coin lands
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
  const chestX = () => clamp(A.VW * 0.27, 200, A.VW - 190);
  const CHEST_Y = FLOOR + 8, CHEST_SC = 1.5;
  function startWin() {
    const r = run;
    r.phase = 'win'; r.pt = 0; r.finger = null; activeId = null; r.hint = null;
    r.popQueue = r.rules.items.filter((it) => !it.hidden).sort((p, q) => p.x - q.x);
    r.popN = r.popQueue.length; r.popT = 0.3;
    r.chest = { x: chestX(), t: 0, open: 0 };
    S.cheer();
    later(0.3, () => { A.burst('puff', r.chest.x, CHEST_Y + 10, 90); S.whoosh(); });
    later(1.2, () => { S.chest(); A.fountain(r.chest.x, CHEST_Y - 50, 46, A.TRAY_Y + 10); A.burst('confetti', 0, 0, 0); S.isabella(); });
    later(1.75, () => A.fountain(r.chest.x, CHEST_Y - 50, 26, A.TRAY_Y + 10));
    later(2.3, () => A.fountain(r.chest.x, CHEST_Y - 50, 26, A.TRAY_Y + 10));
    later(4.0, showResults);
  }
  function stepWin(dt) {
    const r = run;
    // what is still falling pops, one after another up a scale; the friends swim off, the grumps slink away
    if ((r.popT -= dt) <= 0 && r.popQueue.length) {
      const it = r.popQueue.shift();
      if (!it.hidden && r.rules.items.indexOf(it) >= 0) {
        it.hidden = true;
        A.burst('pop', it.x, it.y, it.r);
        S.pop(0.12 + ((r.popN - r.popQueue.length) / Math.max(1, r.popN)) * 0.85, 'normal');
        if (it.grumpy) r.leavers.push({ mode: 'grump', kind: it.kind, col: it.col, x: it.x, y: it.y, sc: 0.98, t: 0, stomp: 0.2, huffT: 9, seed: it.seed || 0, dir: it.x < A.VW / 2 ? -1 : 1, vy: 0 });
        else swimAway(it);
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

  // ---- input: a finger anywhere on the screen; only its x matters, and she eases toward it ----
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  function hitIsabella(x, y) {
    const R = run.rules, cx = R.px - run.face * A.SHELL_DX * 0.9, cy = A.ISA_Y - 12 - smooth(run.rise) * 150;
    const dx = (x - cx) / 130, dy = (y - cy) / 70;
    return dx * dx + dy * dy <= 1;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (screen !== 'play' || !run || upright()) return;
    counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    const p = A.toWorld(e.clientX, e.clientY);
    run.idle = 0;
    if (run.phase !== 'play') {
      // at the chest party a tap on Isabella is a twirl and a giggle
      if (hitIsabella(p.x, p.y)) { counters.isabellaTaps++; if (run.twirl <= 0) run.twirl = 1; A.burst('hearts', run.rules.px, A.ISA_Y - 60 - smooth(run.rise) * 150); S.giggle(); }
      return;
    }
    activeId = e.pointerId; run.finger = p.x; run.hint = null; run.hintCool = 3;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ }
  });
  window.addEventListener('pointermove', (e) => {
    if (!run || run.phase !== 'play' || screen !== 'play' || upright()) return;
    // if the finger that was steering has lifted, another finger still on the screen takes over as soon as it moves
    if (activeId == null && (e.pointerType !== 'mouse' || e.buttons) && e.target === canvas) activeId = e.pointerId;
    if (e.pointerId !== activeId) return;
    run.finger = A.toWorld(e.clientX, e.clientY).x;
    run.idle = 0;
    counters.moves++;
  });
  // a lifted finger is what counts as a user gesture on touch screens, so try starting sound here too
  const lift = (e) => {
    if (e.pointerId === activeId) { activeId = null; if (run) run.finger = null; }   // she carries on to where the finger was
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
  window.addEventListener('resize', () => { A.resize(); if (run) run.rules.setWidth(A.VW); measureHome(); fitHome(); });

  // ---- the level-select sea: friends drifting down in their bubbles, and Isabella swimming under them ----
  const menu = { items: [], t: 0 };
  function stepMenu(dt) {
    if (menu.items.length < 5 && Math.random() < dt * 0.8) {
      const k = L.LEVELS[0].kinds.concat(L.LEVELS[1].kinds)[Math.floor(Math.random() * 6)];
      menu.items.push({ x: rnd(80, A.VW - 80), y: -70, r: rnd(40, 50), kind: k[0], col: k[1], grumpy: false, gold: false, vy: rnd(40, 60), seed: rnd(0, 10), flip: Math.random() < 0.5, grow: 1 });
    }
    for (let i = menu.items.length - 1; i >= 0; i--) {
      const b = menu.items[i];
      b.y += b.vy * dt;
      if (b.y > A.H + 70) menu.items.splice(i, 1);
    }
    menu.t += dt;
    A.stepParts(dt);
  }
  function drawMenu() {
    A.drawBackdrop(0, clock, 1);
    for (const b of menu.items) A.drawItem(b, clock, false);
    A.drawFloor(0, 1);
    const span = A.VW - 320, ph = (menu.t * 70) % (2 * span), fwd = ph < span, x = 160 + (fwd ? ph : 2 * span - ph), face = fwd ? 1 : -1, bob = Math.sin(menu.t * 2) * 4;
    A.drawIsabella(x - A.SHELL_DX * face, A.ISA_Y + bob, clock, { scale: A.ISA_SC, turn: face, swim: 8, happy: true, carry: true });
    A.shellBack(x, A.SHELL_Y + bob, 0, 0); A.shellFront(x, A.SHELL_Y + bob, 0, 0);
    A.drawParts();
  }

  // ---- drawing a level ----
  const filled = new Array(L.TRAY).fill(false);
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
      A.drawCreature(v.kind, v.col, v.x, v.y, v.sc, clock, { wig: v.t < 0.3 ? 1 : 0.3, seed: v.seed, glow: glowy, flip: v.t < 0.3 ? false : v.dir < 0, happy: true });
      return;
    }
    // a grump: puffs up and huffs, then swims off
    const stomping = v.t < v.stomp, puff = stomping ? 1 + 0.12 * Math.abs(Math.sin(v.t * 10)) : 1;
    A.drawCreature(v.kind, v.col, v.x, v.y, v.sc * puff, clock, { wig: stomping ? 0.5 : 0.25, seed: v.seed, glow: glowy, flip: stomping ? v.dir > 0 : v.dir < 0, rot: stomping ? Math.sin(v.t * 20) * 0.12 : 0 });
  }
  function drawNumeral(m) {
    const t = m.t, top = FLOOR - 12, bx = numX(m);
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
  // coins on their way to the coin row, and coins drifting away from it (the row itself is drawn behind what falls)
  function drawCoins() {
    const r = run;
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
    const r = run, R = r.rules, sc = r.cfg.scene, glowy = !!SCENES[sc].glow, win = r.phase === 'win';
    A.drawBackdrop(sc, clock, 1);
    // the coin row sits behind what falls, so a friend (or a grump) coming down is never hidden by it
    A.drawHud(R.target, r.hud, clock, { pulse: r.hud === R.target - 1 && r.phase === 'play' });
    for (const it of R.items) if (!it.hidden && it.grow != null) A.drawItem(it, clock, glowy);
    A.drawFloor(sc, 1);
    const fade = win ? 1 - 0.65 * smooth(clamp(r.pt / 0.8, 0, 1)) : 1;
    for (let i = 0; i < L.TRAY; i++) filled[i] = !!r.tray[i];
    A.drawTray(filled, clock, r.gather || win ? -1 : filled.indexOf(false), fade);
    drawTrayFriends(glowy, fade);
    if (r.chest) {
      const c = r.chest, rise = easeOutBack(clamp((c.t - 0.25) / 0.7, 0, 1));
      A.drawChest(c.x, A.H + 80 + (CHEST_Y - A.H - 80) * rise, c.open, clock, CHEST_SC);
    }
    // the big counting numerals stand on the sand behind Isabella, so they never hide her
    for (const m of r.numerals) drawNumeral(m);
    // Isabella, her head under the shell whichever way she faces
    const bob = Math.sin(clock * 2.2) * 3 - smooth(r.rise) * 150, px = R.px, twirl = r.twirl > 0 ? smooth(1 - r.twirl) * TAU * (r.face < 0 ? -1 : 1) : 0;
    A.drawIsabella(px - A.SHELL_DX * r.face, A.ISA_Y + bob, clock, { scale: A.ISA_SC, turn: r.face, tilt: r.tilt + twirl, swim: 6 + Math.min(8, Math.abs(R.vel) / 120),
      happy: r.joy > 0 || win, carry: !win, wave: win ? clock * 9 : null, dizzy: r.dizzy > 0.25 });
    if (!win) {
      const st = r.tilt * 0.6;
      A.shellBack(px, A.SHELL_Y + bob, st, r.lit);
      for (const f of r.friends) if (f.state === 'sit') A.drawCreature(f.kind, f.col, f.fx, f.fy + bob, 0.62, clock, { seed: f.seed, wig: 0.8, happy: true, glow: glowy });
      A.shellFront(px, A.SHELL_Y + bob, st, r.bump);
      if (r.dizzy > 0) A.drawDizzy(px, A.SHELL_Y - 4 + bob, clock, r.dizzy / L.SHIELD);
    }
    for (const f of r.friends) {
      if (f.state !== 'fly') continue;
      const p = flyPos(f);
      A.drawCreature(f.kind, f.col, p.x, p.y, 0.62 + (A.miniScale() - 0.62) * p.u, clock, { seed: f.seed, wig: 0.4, happy: true, glow: glowy, rot: Math.sin(p.u * Math.PI) * 0.3 });
    }
    for (const v of r.leavers) drawLeaver(v, glowy);
    A.drawParts();
    drawCoins();
    if (r.hint) {
      const it = R.items.find((q) => q.id === r.hint.id);
      if (it) A.drawSlideHint(px, it.xc, it.x, it.y, (r.hint.t % HINT_T) / HINT_T, clock);
    }
  }
  function draw() {
    A.begin();
    if (sheetOn) drawSheet(); else if (!run) drawMenu(); else drawPlay();
  }

  // ---- main loop ----
  function update(dt) {
    const r = run;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; if ((tm.t -= dt) <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    events.length = 0;
    r.rules.step(dt, r.phase === 'play' ? r.finger : null, events);
    for (let i = 0; i < events.length; i++) onEvent(events[i]);
    if (r.phase === 'play') {
      r.idle += dt;
      if (r.dirty && (r.saveT += dt) >= SAVE_EVERY) persist();
      if (r.rules.done && r.owed === 0 && !r.gather && !r.friends.length) startWin();
    } else if (r.phase === 'win') stepWin(dt);
    stepItems(dt);
    stepIsabella(dt);
    stepFriends(dt);
    stepTray(dt);
    stepGather(dt);
    stepCoins(dt);
    stepLeavers(dt);
    for (let i = r.numerals.length - 1; i >= 0; i--) if ((r.numerals[i].t += dt) > 1.7) r.numerals.splice(i, 1);
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

  // ---- hooks for the headless tests (test/games/catch) ----
  function itemInfo(it) {
    const c = A.toClient(it.x, it.y), k = A.scale / A.dpr;
    return { id: it.id, kind: it.kind, grumpy: it.grumpy, gold: it.gold, x: it.x, y: it.y, cx: c.x, cy: c.y, cr: it.r * k, xc: it.xc, xcClient: it.xc * k, tc: it.tc,
      past: !!it.past, hidden: !!it.hidden, still: !!it.still };
  }
  window.__catchDebug = {
    counters,
    state() {
      const r = run, R = r ? r.rules : null, k = A.scale / A.dpr;
      return {
        screen, phase: r ? r.phase : null, level: r ? r.n : null, t: R ? R.t : 0,
        coins: R ? R.coins : 0, coinTarget: R ? R.target : 0, tray: R ? R.tray.length : 0, trayKinds: R ? R.tray.slice() : [],
        hudCoins: r ? r.hud : 0, owed: r ? r.owed : 0, debt: r ? r.debt : 0, trayShown: r ? r.tray.filter(Boolean).length : 0,
        catches: R ? R.catches : 0, golds: R ? R.golds : 0, bonks: R ? R.bonks : 0, misses: R ? R.misses : 0, stars: R ? R.stars : null, done: R ? R.done : false,
        px: R ? R.px : 0, pxClient: R ? R.px * k : 0, aim: R ? R.aim : 0, vel: R ? R.vel : 0, face: r ? r.face : 1, shield: R ? R.shield : 0, dizzy: r ? r.dizzy : 0,
        finger: r ? r.finger : null, fingerDown: activeId != null,
        chest: !!(r && r.chest), chestOpen: r && r.chest ? r.chest.open : 0, results: !!(r && r.results), resultsStars: r && r.results ? r.stars : null,
        items: R ? R.items.map(itemInfo) : [],
        friends: r ? r.friends.length : 0, leavers: r ? r.leavers.length : 0, numerals: r ? r.numerals.map((m) => m.n) : [],
        flyCoins: r ? r.flyCoins.length : 0, lostCoins: r ? r.lostCoins.length : 0, hint: r && r.hint ? r.hint.id : null,
        unlocked: save.unlocked, savedStars: save.stars.slice(), total: save.total, chests: save.chests,
        VW: A.VW, scale: A.scale, dpr: A.dpr, canvas: [canvas.width, canvas.height], floor: FLOOR, catchY: L.CATCH_Y, catchYClient: L.CATCH_Y * k, pxMin: L.PX_MIN,
        homeX: R ? R.spawner.homeX : null, postponed: R ? R.spawner.postponed : 0,
        parts: A.partCount, muted, audio: S.state, gain: S.gain, menuItems: menu.items.length, caches: A.cacheSizes(),
      };
    },
    start(n, fresh, seed) { startLevel(n, fresh, seed); return run.n; },
    // no new things fall by themselves (the tests then place their own)
    pause(on) { if (run) run.rules.paused = on !== false; return !!run; },
    clear() { if (run) run.rules.items.length = 0; return true; },
    // put one thing in the water: { kind, x, y, gold, still }
    spawn(o) {
      o = o || {};
      if (!run) return null;
      const it = run.rules.addItem({ kind: o.kind, x: o.x != null ? o.x : A.VW / 2, y: o.y, gold: o.gold, still: o.still });
      onEvent({ type: 'spawn', item: it });
      if (o.grown) it.grow = 1;
      return it.id;
    },
    // the same rule code as a real catch: the thing lands in the shell wherever it is
    catchItem(id) {
      if (!run) return null;
      const R = run.rules, i = R.items.findIndex((q) => q.id === id);
      if (i < 0) return null;
      const it = R.items[i];
      R.items.splice(i, 1);
      it.x = R.px; it.y = L.CATCH_Y - 10;
      return onEvent(R.apply(it)).type;
    },
    goLevels() { goLevels(); return true; },
    levels() { return L.LEVELS; },
    hud() { if (!run) return []; return A.hudLayout(run.rules.target).slots.map((sl) => { const c = A.toClient(sl.x, sl.y); return { x: sl.x, y: sl.y, cx: c.x, cy: c.y }; }); },
    trayPlaces() { const k = A.scale / A.dpr; return Array.from({ length: L.TRAY }, (_, i) => ({ cx: A.trayX(i) * k, cy: A.TRAY_Y * k, cnum: A.TRAY_NUM * k })); },
    homeZone() { return homeZone; },
    timeScale(k) { timeScale = k; return timeScale; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    resetPerf() { perfN = 0; perf.fill(0); },
    saved() { return store.get(SAVE_KEY); },
    // every friend and every grump side by side, for looking at (test/games/catch/sheet.js)
    sheet(on) { sheetOn = !!on; return sheetOn; },
  };

  // ---- a picture sheet for grown-ups checking the art: friends on the top row, grumps underneath ----
  function drawSheet() {
    A.drawBackdrop(0, 0, 1);
    const friends = [['fish', '#ff8c2e'], ['turtle', '#3fbf7f'], ['starfish', '#ff6f91'], ['crab', '#ff5a4f'], ['seahorse', '#ff9e3d'], ['octopus', '#ff8fc0'], ['whale', '#5aa9ff'], ['fish', 'rainbow']];
    const n = friends.length + 1, sp = Math.min(118, (A.VW - 290) / (n - 1)), x0 = 205;
    friends.forEach((k, i) => A.drawItem({ x: x0 + i * sp, y: 140, r: L.R, kind: k[0], col: k[1], grumpy: false, gold: false, grow: 1, seed: i, flip: false }, 0.4, false));
    A.drawItem({ x: x0 + friends.length * sp, y: 140, r: L.R, kind: 'starfish', col: L.GOLD_COL, grumpy: false, gold: true, grow: 1, seed: 3, flip: false }, 0.4, false);
    const sg = Math.min(170, (A.VW - 60) / L.GRUMPS.length), g0 = A.VW / 2 - ((L.GRUMPS.length - 1) * sg) / 2;
    L.GRUMPS.forEach((k, i) => A.drawItem({ x: g0 + i * sg, y: 322, r: L.R, kind: k, col: L.GRUMP_COL[k], grumpy: true, gold: false, grow: 1, seed: i, flip: false }, 0.4, false));
    A.drawFloor(0, 1);
  }

  measureHome();
  goLevels();
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?level=4 jumps straight into a level (handy for screenshots)
  const qLevel = +new URLSearchParams(location.search).get('level');
  if (qLevel >= 1 && qLevel <= NLEV && qLevel <= save.unlocked) startLevel(qLevel);
  requestAnimationFrame(frame);
})();
