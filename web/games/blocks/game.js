/* Treasure Blocks — screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js, sound in
 * sound.js.
 *
 * Fingers: the four big buttons (left, right, drop, turn), or straight on the well: drag sideways and the piece
 * follows a column at a time, tap to turn it, pull down to drop it. A held left or right button keeps sliding.
 * Coins go into the save the moment a row pays them, so leaving in the middle of a round loses nothing. */
(function () {
  'use strict';
  const L = BlocksLogic, R = BlocksArt, A = BlocksSound;
  const $ = (id) => document.getElementById(id);
  const HUB = '../../index.html';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const backOut = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  // A held left / right button: the first repeat, then the rest. The wait is long on purpose: a small child's
  // "tap" often lasts a third of a second, and it must still move the piece exactly one column.
  const HOLD_AFTER = 0.45, HOLD_EVERY = 0.13;
  const TAP_MS = 380;          // a touch shorter than this that hardly moved is a tap (a turn)
  const SETTLE = 13;           // rows a second: how fast blocks settle after a row goes
  const BAND_T = 0.6;          // seconds for one band of mist to clear
  const COIN_FLY = 0.7;        // a coin's flight from its row to the counter
  const RESULTS_AT = { goal: 3.7, over: 4.0 };

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
  const SAVE_KEY = 'game.blocks.save', MAIN_KEY = 'isabella.save';
  let save = L.migrate(store.get(SAVE_KEY));
  const persist = () => store.set(SAVE_KEY, JSON.stringify(save));
  // Sound follows the main game's mute switch (isabella.save), and the switch on the picker flips that same switch:
  // it rewrites only the `muted` field, and never a save it cannot read (as Coral Maze and Sea Words do).
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
  let screen = 'modes', run = null, clock = 0, last = 0, gesture = null, crown = crownEarned();
  const query = new URLSearchParams(location.search);
  const fixedSeed = query.has('seed') ? (+query.get('seed') >>> 0) : null;   // ?seed=7: every game here deals that seed (tests, screenshots)
  const canvas = $('c');
  const PADS = ['padLeft', 'padRight', 'padDrop', 'padTurn'];
  const counters = { slides: 0, turns: 0, drops: 0, taps: 0, drags: 0, swipes: 0, holds: 0, refused: 0 };
  R.init(canvas);
  A.setMuted(readMuted());

  function show(id) {
    for (const n of ['modes', 'results']) $(n).classList.toggle('on', n === id);
    $('modesBtn').classList.toggle('on', screen !== 'modes');
    for (const p of PADS) $(p).classList.toggle('on', screen !== 'modes');
  }
  function padsAway(away) { for (const p of PADS) $(p).classList.toggle('away', !!away); }
  function setSoundIcon() { $('soundBtn').querySelector('use').setAttribute('href', readMuted() ? '#i-mute' : '#i-sound'); }

  // the three pictures on the picker: a small, a middle and a big well, each with a piece about to fill a row
  function wellPicture(n, stack, piece) {
    const t = 76 / n, x0 = 12, y1 = 90, tile = (cx, cy, fill) => `<rect x="${(x0 + cx * t + t * 0.07).toFixed(1)}" y="${(y1 - (cy + 1) * t + t * 0.07).toFixed(1)}" width="${(t * 0.86).toFixed(1)}" height="${(t * 0.86).toFixed(1)}" rx="${(t * 0.2).toFixed(1)}" fill="${fill}"/>`;
    let out = `<path d="M${x0 - 4} 8V${y1 + 4}H${x0 + 76 + 4}V8" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`;
    stack.forEach((row, cy) => row.split('').forEach((ch, cx) => { if (ch === '#') out += tile(cx, cy, '#fff'); }));
    for (const [cx, cy] of piece) out += tile(cx, cy, '#ff6fb0');
    return out + '<path d="M88 2l2.6 5.4 5.4 2.6-5.4 2.6-2.6 5.4-2.6-5.4-5.4-2.6 5.4-2.6z" fill="#ffd23f"/>';
  }
  $('pic-easy').innerHTML = wellPicture(3, ['##.'], [[2, 2]]);
  $('pic-medium').innerHTML = wellPicture(4, ['###.', '##..'], [[3, 3], [3, 4], [2, 4]]);
  $('pic-hard').innerHTML = wellPicture(6, ['####.#', '###..#', '#.#...'], [[3, 5], [4, 5], [5, 5], [4, 4]]);

  // ---- the picker ----
  function goModes() {
    screen = 'modes'; run = null; gesture = null; releaseHolds();
    R.clearParticles();
    for (const m of L.MODE_IDS) { $('cnt-' + m).textContent = save.keys[m]; $('mode-' + m).classList.toggle('last', m === save.last); }
    $('coinCount').textContent = save.coins;
    setSoundIcon();
    show('modes');
    A.startMusic('menu');
  }

  // ---- a game ----
  const sceneOf = (mode, round) => (L.MODE_IDS.indexOf(mode) + round - 1) % R.SCENES.length;
  function startGame(mode, seed) {
    if (!L.MODES[mode]) mode = 'easy';
    const g = new L.Game(mode, seed != null ? seed >>> 0 : fixedSeed != null ? fixedSeed : undefined);
    const firstEver = save.games === 0;
    save.last = mode; save.games++;
    persist();
    run = {
      mode, g, lay: R.layout(mode, g.W, g.H, g.goal), scene: sceneOf(mode, 1), pt: 0,
      px: g.cur.x, py: g.cur.y - 0.6, pop: 0, rowOff: new Float32Array(g.H),
      bands: 0, bandsTo: 0, trackPop: 9, lastRows: 0, coinsShown: 0, coinPop: 9, flyCoins: [], squash: [], timers: [],
      wave: null, stackAlpha: 1, hud: 1, shake: 0, win: null, results: false,
      inputs: 0, handOn: firstEver && mode === 'easy', hand: 0,
    };
    g.takeEvents();
    R.newRound();
    screen = 'play'; gesture = null; releaseHolds(); show(null); padsAway(false);
    R.clearParticles();
    A.startMusic(mode); A.intro();
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }
  const playing = () => screen === 'play' && !!run && run.g.phase === 'fall';

  // ---- what a finger does (the buttons, the gestures and the test hook all come through here) ----
  function slide(dx) {
    if (!playing()) return false;
    const ok = run.g.move(dx);
    run.inputs++;
    if (ok) { counters.slides++; A.slide(dx); } else { counters.refused++; A.nope(); }
    return ok;
  }
  function turn() {
    if (!playing()) return false;
    const ok = run.g.rotate(1);
    run.inputs++;
    if (ok) { counters.turns++; A.turn(); } else { counters.refused++; A.nope(); }
    return ok;
  }
  function drop() {
    if (!playing()) return false;
    const d = run.g.drop();
    run.inputs++;
    if (d < 0) { counters.refused++; return false; }
    counters.drops++;
    drain();
    return true;
  }

  // ---- what the rules report ----
  function drain() {
    const r = run;
    if (!r) return;
    const g = r.g, lay = r.lay, c = lay.c;
    for (const e of g.takeEvents()) {
      if (e.type === 'spawn') {
        r.px = g.cur.x; r.py = g.cur.y - 0.6; r.pop = 0;
        if (gesture && gesture.axis === 'side') { gesture.x0 = gesture.x; gesture.steps = 0; }   // a finger still down steers the new piece from where it is
      } else if (e.type === 'lock') {
        r.squash.push({ cells: e.cells, t: 0 });
        if (e.dropped > 0) { A.drop(); r.shake = Math.min(5, 1.5 + e.dropped * 0.4); } else A.land();
        let low = -1;
        for (const q of e.cells) if (q[1] > low) low = q[1];
        for (const q of e.cells) if (q[1] === low) R.burst('land', lay.x + (q[0] + 0.5) * c, lay.y + (q[1] + 1) * c, c / 50);
      } else if (e.type === 'rows') {
        // the coins go into the save at once
        L.bankRows(save, r.mode, e.n, g.rowsAll);
        persist();
        A.rows(e.n, g.rowsDone - e.n);
        r.trackPop = 0; r.lastRows = e.n;
        e.rows.forEach((y, i) => {
          for (let x = 0; x < g.W; x++) later(0.16 + Math.abs(x - (g.W - 1) / 2) * 0.05 + i * 0.05, () => R.burst('row', lay.x + (x + 0.5) * c, lay.y + (y + 0.5) * c, c / 46, R.LOOKS[g.grid[y * g.W + x] || 1].light));
        });
        const ys = e.rows, C = lay.coin;
        for (let k = 0; k < e.coins; k++) {
          const y = ys[k % ys.length];
          r.flyCoins.push({ t: -0.12 - k * 0.11, x0: lay.x + lay.w * (0.5 + ((k % 3) - 1) * 0.16), y0: lay.y + (y + 0.5) * c, x1: C.x, y1: C.y, x: 0, y: -999, r: 0 });
        }
        // the mist starts to clear as the row goes
        const to = Math.min(g.goal, g.rowsDone);
        later(0.3, () => { r.bandsTo = Math.max(r.bandsTo, to); A.reveal(); });
      } else if (e.type === 'settled') {
        // each row left standing starts as many rows too high as full rows went from under it, and settles
        let to = g.H - 1;
        for (let y = g.H - 1; y >= 0; y--) { if (e.rows.indexOf(y) >= 0) continue; r.rowOff[to] = to - y; to--; }
        for (; to >= 0; to--) r.rowOff[to] = 0;
      } else if (e.type === 'wave') {
        r.wave = { t: 0, rows: e.rows, u: 0 };
        A.wave();
      } else if (e.type === 'washed') {
        r.wave = null;
        for (let y = 0; y < g.H; y++) r.rowOff[y] = e.rows;
      } else if (e.type === 'goal') {
        L.bankKey(save, r.mode);
        persist();
        startWin('goal');
      } else if (e.type === 'over') {
        startWin('over');
      } else if (e.type === 'round') {
        r.scene = sceneOf(r.mode, g.round); r.bands = 0; r.bandsTo = 0; r.coinsShown = 0; r.trackPop = 9; r.lastRows = 0;
        R.newRound();
      }
    }
  }

  // ---- the end of a round: the chest rises out of the sand and bursts with the coins earned ----
  // 'goal': the row goal is reached; the key flies from the top of the track to the chest. 'over' (Medium, Hard):
  // the well is full; the blocks float away as bubbles and the chest opens all the same, with every coin earned.
  function startWin(kind) {
    const r = run, C = r.lay.chest, P = r.lay.party, goal = kind === 'goal', coins = r.g.roundCoins, big = r.mode === 'hard';
    // what leaps out of the chest is what was earned: a few coins for each coin (and pearls, always)
    const n = goal ? clamp(14 + coins * 3, 14, 60) : clamp(coins * 3, 0, 45);
    r.win = { t: 0, kind };
    gesture = null; releaseHolds(); padsAway(true);
    const open = goal ? 1.55 : 2.1;
    if (goal) { A.cheer(); later(0.55, () => A.key()); R.burst('confetti'); }
    else A.full();
    later(goal ? 0.25 : 0.9, () => { R.burst('puff', C.x, C.y - 4, C.sc); A.puff(); });
    later(open, () => { A.fanfare(big && goal); R.fountain(C.x, C.y - 45 * C.sc, n, 528); R.fountain(C.x, C.y - 45 * C.sc, 6, 528, true); });
    later(open + 0.5, () => { R.fountain(C.x, C.y - 45 * C.sc, Math.round(n / 2), 528); R.burst('cheer', P.x, P.y - 60); });
    later(open + 1.0, () => { R.fountain(C.x, C.y - 45 * C.sc, Math.round(n / 2), 528); R.burst('notes', P.x, P.y - 70); });
    later(RESULTS_AT[kind], showResults);
  }
  function placeCard() {
    if (!run) return;
    $('resCard').style.left = R.toCss(run.lay.card, 0).x + 'px';
  }
  function showResults() {
    const r = run;
    if (!r || !r.win) return;
    const goal = r.win.kind === 'goal';
    r.results = true; screen = 'results';
    $('resCoins').textContent = r.g.roundCoins;
    $('resBest').textContent = save.best[r.mode];
    $('resKey').style.display = goal ? '' : 'none';
    $('resGo').style.display = goal ? '' : 'none';
    $('resAgain').className = goal ? 'btn md blue' : 'btn';
    for (const id of ['resCoinsRow', 'resKey']) $(id).classList.remove('pop');
    placeCard();
    show('results');
    later(0.2, () => { $('resCoinsRow').classList.add('pop'); A.pop(0); });
    if (goal) later(0.55, () => { $('resKey').classList.add('pop'); A.pop(1); });
  }
  // after the chest: the same well, the next picture, a new row goal
  function keepGoing() {
    const r = run;
    if (!r || !r.results || !r.g.keepGoing()) return;
    r.win = null; r.results = false; r.timers.length = 0;
    screen = 'play'; show(null); padsAway(false);
    drain();
    A.intro();
  }

  // ---- fingers on the well ----
  const cellPx = () => (run.lay.c * R.scale) / R.dpr;
  canvas.addEventListener('pointerdown', (e) => {
    A.init();
    if (screen !== 'play' || !run || gesture) return;
    const w = R.toWorld(e.clientX, e.clientY), lay = run.lay;
    if (w.x < lay.x - lay.c * 1.2 || w.x > lay.x + lay.w + lay.c * 1.2) return;   // only on the well (and a little to each side)
    gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), axis: null, steps: 0, far: 0 };
  });
  function gestureMove(e) {
    const g = gesture;
    g.x = e.clientX; g.y = e.clientY;
    if (!run || screen !== 'play') return;
    const cp = cellPx(), dx = g.x - g.x0, dy = g.y - g.y0;
    g.far = Math.max(g.far, Math.hypot(dx, dy));
    if (!g.axis && g.far > Math.max(10, cp * 0.3)) {
      // which way is this finger going? Sideways unless it is clearly going down (or up, which does nothing)
      g.axis = dy > Math.abs(dx) * 1.5 ? 'down' : dy < -Math.abs(dx) * 1.5 ? 'up' : 'side';
      if (g.axis === 'side') counters.drags++;
    }
    if (g.axis === 'side') {
      const want = Math.round(dx / cp);
      let guard = 0;
      while (g.steps !== want && guard++ < 12) { const d = want > g.steps ? 1 : -1; slide(d); g.steps += d; }
    } else if (g.axis === 'down' && dy > Math.max(34, cp * 1.1)) {
      g.axis = 'done'; counters.swipes++;
      drop();
    }
  }
  window.addEventListener('pointermove', (e) => { if (gesture && e.pointerId === gesture.id) gestureMove(e); });
  function gestureEnd(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    A.init();
    if (e.type === 'pointerup') gestureMove(e);
    const g = gesture;
    gesture = null;
    if (e.type === 'pointerup' && !g.axis && performance.now() - g.t0 < TAP_MS) { counters.taps++; turn(); }
  }
  window.addEventListener('pointerup', gestureEnd);
  window.addEventListener('pointercancel', gestureEnd);

  // ---- the four big buttons: they act the moment a finger lands; left and right repeat while held ----
  const holds = [];
  function releaseHolds() { for (const h of holds) { h.down = false; h.el.classList.remove('down'); } }
  function pad(id, fn, repeat) {
    const el = $(id), h = { el, fn, down: false, t: 0, next: 0 };
    holds.push(h);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      A.init();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      el.classList.add('down');
      fn();
      if (repeat) { h.down = true; h.t = 0; h.next = HOLD_AFTER; }
    });
    const up = () => { A.init(); h.down = false; el.classList.remove('down'); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  pad('padLeft', () => slide(-1), true);
  pad('padRight', () => slide(1), true);
  pad('padTurn', turn, false);
  pad('padDrop', drop, false);
  // a keyboard, for playing on a computer
  window.addEventListener('keydown', (e) => {
    if (e.repeat && (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    if (e.key === 'ArrowLeft') slide(-1); else if (e.key === 'ArrowRight') slide(1);
    else if (e.key === 'ArrowUp') turn(); else if (e.key === ' ' || e.key === 'ArrowDown') drop();
  });

  // ---- the clock ----
  function update(dt) {
    const r = run, g = r.g, lay = r.lay;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; tm.t -= dt; if (tm.t <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    for (const h of holds) if (h.down) { h.t += dt; if (h.t >= h.next) { h.next += HOLD_EVERY; counters.holds++; h.fn(); } }
    g.tick(dt);
    drain();
    if (run !== r) return;
    // the piece glides after its real place; rows settle; little flashes fade
    const c = g.cur;
    if (c) {
      r.px += (c.x - r.px) * Math.min(1, dt * 30); r.py += (c.y - r.py) * Math.min(1, dt * 24);
      if (r.pop < 1) r.pop = Math.min(1, r.pop + dt / 0.2);
    }
    for (let y = 0; y < g.H; y++) if (r.rowOff[y] > 0) r.rowOff[y] = Math.max(0, r.rowOff[y] - dt * SETTLE);
    for (let i = r.squash.length - 1; i >= 0; i--) { r.squash[i].t += dt; if (r.squash[i].t >= 0.22) r.squash.splice(i, 1); }
    if (r.shake) r.shake = Math.abs(r.shake) < 0.3 ? 0 : -r.shake * Math.max(0, 1 - dt * 16);
    r.trackPop += dt; r.coinPop += dt;
    // the mist clears, a band at a time
    if (r.bands < r.bandsTo) {
      const b0 = r.bands;
      r.bands = Math.min(r.bandsTo, r.bands + (dt / BAND_T) * Math.max(1, r.bandsTo - r.bands));   // several at once: quicker, one after another
      const f = b0 - Math.floor(b0), bandH = lay.h / g.goal;
      if (Math.random() < dt * 40) R.burst('mist', lay.x + lay.w * clamp(f * 1.3 - 0.15, 0, 1), lay.y + (Math.floor(b0) + 0.5) * bandH, bandH * 0.45);
    }
    // coins fly from their row up to the counter
    for (let i = r.flyCoins.length - 1; i >= 0; i--) {
      const f = r.flyCoins[i];
      f.t += dt;
      if (f.t < 0) continue;
      const u = smooth(clamp(f.t / COIN_FLY, 0, 1));
      f.x = lerp(f.x0, f.x1, u); f.y = lerp(f.y0, f.y1, u) - Math.sin(u * Math.PI) * 70; f.r = lerp(20, 24, u) * Math.min(1, f.t / 0.12);
      if (f.t >= COIN_FLY) { r.flyCoins.splice(i, 1); r.coinsShown++; r.coinPop = 0; A.coin(); R.burst('coin', f.x1, f.y1); }
    }
    // Easy's wave: bubbles where the water has passed
    if (r.wave) {
      r.wave.t += dt; r.wave.u = clamp(r.wave.t / L.WAVE_T, 0, 1);
      const crest = lay.x - 40 + (lay.w + 80) * smooth(clamp((r.wave.u - 0.08) / 0.62, 0, 1));
      if (Math.random() < dt * 34 && crest < lay.x + lay.w + 20) R.burst('wash', clamp(crest, lay.x, lay.x + lay.w), lay.y + lay.h - Math.random() * r.wave.rows * lay.c, lay.c / 50);
    }
    // the end of a round
    const w = r.win;
    if (w) {
      w.t += dt;
      r.hud = Math.max(0, r.hud - dt * 2.5);
      r.stackAlpha = Math.max(w.kind === 'goal' ? 0.14 : 0.3, r.stackAlpha - dt * (w.kind === 'goal' ? 1.4 : 0.6));
      if (w.kind === 'over' && w.t < 1.6 && Math.random() < dt * 30) R.burst('float', lay.x + Math.random() * lay.w, lay.y + lay.h * (0.15 + Math.random() * 0.85), lay.c / 50);
      if (r.results && Math.random() < dt * 0.8) R.burst('cheer', lay.party.x + (Math.random() - 0.5) * 60, lay.party.y - 70);
    } else {
      r.hud = Math.min(1, r.hud + dt * 3);
      r.stackAlpha = Math.min(1, r.stackAlpha + dt * 3);
    }
    // the hand that shows a first-time player what to do, until the first touch
    r.hand = clamp(r.hand + (r.handOn && !r.inputs && r.pt > 1.4 && g.phase === 'fall' ? dt * 2 : -dt * 4), 0, 1);
  }

  // ---- what to draw this frame (one object, reused) ----
  const NONE = [], V = { flyCoins: null }, winV = { rise: 0, open: 0, shine: 0, isa: { x: 0, y: 0, sc: 1, flip: false, tilt: 0, glow: false }, key: null }, keyV = { x: 0, y: 0, rot: 0, sc: 1 };
  function buildView() {
    const r = run, g = r.g, lay = r.lay;
    V.mode = r.mode; V.lay = lay; V.W = g.W; V.H = g.H; V.grid = g.grid; V.cur = g.cur; V.px = r.px; V.py = r.py; V.pop = r.pop;
    V.ghostY = g.cur ? g.ghostY() : null; V.next = g.next;
    const clr = g.phase === 'clear';
    V.clearing = clr ? g.clearing : NONE; V.clearU = clr ? clamp(1 - g.timer / L.CLEAR_T, 0, 1) : 0;
    V.rowOff = r.rowOff; V.bands = r.bands; V.goal = g.goal; V.rowsDone = g.rowsDone; V.trackPop = r.trackPop; V.lastRows = r.lastRows;
    V.coins = r.coinsShown; V.coinPop = r.coinPop; V.flyCoins = r.flyCoins; V.wave = r.wave; V.stackAlpha = r.stackAlpha; V.squash = r.squash;
    V.scene = r.scene; V.crown = crown; V.hud = r.hud; V.shake = r.shake; V.hand = r.hand;
    V.win = null;
    if (r.win) {
      const t = r.win.t, goal = r.win.kind === 'goal', C = lay.chest, P = lay.party, T = lay.track;
      const t0 = goal ? 0 : 0.75, openAt = goal ? 1.5 : 2.05;
      winV.rise = backOut(clamp((t - t0 - 0.15) / 0.7, 0, 1));
      winV.open = smooth(clamp((t - openAt) / 0.45, 0, 1));
      winV.shine = goal ? clamp(t / 0.4, 0, 1) : 0;
      // Isabella swims in from the left, then twirls beside the chest
      const u = smooth(clamp((t - t0 - 0.3) / 1.1, 0, 1)), here = u >= 1, I = winV.isa;
      I.x = lerp(-140, P.x, u); I.y = P.y + Math.sin(clock * 2.2) * 8 - Math.sin(u * Math.PI) * 30; I.sc = P.sc; I.flip = false; I.tilt = 0; I.glow = here;
      if (here) { const tw = smooth(clamp((t - t0 - 1.5) / 0.8, 0, 1)); I.tilt = Math.sin(clock * 5) * 0.12 - tw * Math.PI * 2; I.y -= Math.abs(Math.sin(clock * 4)) * 10; }
      // the key: it swells at the top of the track, then flies in an arc to the chest's lock
      winV.key = null;
      if (goal && t < 1.5) {
        const f = smooth(clamp((t - 0.6) / 0.85, 0, 1));
        keyV.x = lerp(T.x + 4, C.x, f); keyV.y = lerp(T.keyY, C.y - 30 * C.sc, f) - Math.sin(f * Math.PI) * 90;
        keyV.rot = -0.7 + f * Math.PI * 2; keyV.sc = 0.66 + 0.6 * Math.sin(clamp(t / 0.6, 0, 1) * Math.PI * 0.5) - f * 0.36;
        winV.key = keyV;
      }
      V.win = winV;
    }
    return V;
  }

  // ---- buttons ----
  const tapBtn = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
  for (const m of L.MODE_IDS) tapBtn('mode-' + m, () => startGame(m));
  tapBtn('resAgain', () => startGame(run ? run.mode : save.last));
  tapBtn('resGo', keepGoing);
  tapBtn('modesBtn', goModes);
  tapBtn('soundBtn', () => { const m = !readMuted(); writeMuted(m); A.setMuted(m); setSoundIcon(); });
  $('homeBtn').addEventListener('click', () => { A.init(); A.click(); location.href = HUB; });

  // Android back button (called from MainActivity): back to the hub.
  window.__back = () => { location.href = '../../index.html'; return true; };
  window.__pause = () => { A.suspend(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { A.suspend(); releaseHolds(); gesture = null; }
    else { A.setMuted(readMuted()); A.resume(); }
  });
  window.addEventListener('pageshow', () => { A.setMuted(readMuted()); crown = crownEarned(); if (screen === 'modes') setSoundIcon(); });
  window.addEventListener('resize', () => {
    R.resize();
    if (run) { run.lay = R.layout(run.mode, run.g.W, run.g.H, run.g.goal); if (screen === 'results') placeCard(); }
  });

  // ---- main loop ----
  const perf = { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] };
  function frame(nowMs) {
    requestAnimationFrame(frame);   // asked for first, so that one bad frame can never stop the game
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
  }

  // ---- hooks for tests (test/games/blocks/) ----
  window.__blocksDebug = {
    get state() {
      const r = run, g = r ? r.g : null, rect = (x, y, w, h) => { const a = R.toCss(x, y), b = R.toCss(x + w, y + h); return { left: a.x, top: a.y, right: b.x, bottom: b.y }; };
      return {
        screen, mode: r ? r.mode : null, seed: g ? g.seed : null, phase: g ? g.phase : null, W: g ? g.W : 0, H: g ? g.H : 0,
        grid: g ? Array.from(g.grid) : [], cur: g && g.cur ? { id: g.cur.id, rot: g.cur.rot, x: g.cur.x, y: g.cur.y, style: g.cur.style, cells: g.cells() } : null,
        next: g ? { id: g.next.id, style: g.next.style } : null, ghostY: g && g.cur ? g.ghostY() : null, age: g ? g.age : 0, dropGuard: g ? g.M.dropGuard : 0,
        rowsDone: g ? g.rowsDone : 0, rowsAll: g ? g.rowsAll : 0, goal: g ? g.goal : 0, coins: g ? g.coins : 0, roundCoins: g ? g.roundCoins : 0, round: g ? g.round : 0,
        pieces: g ? g.pieces : 0, waves: g ? g.waves : 0, height: g ? g.height() : 0, interval: g ? g.interval() : 0, clearing: g ? g.clearing.slice() : [],
        bands: r ? +r.bands.toFixed(3) : 0, bandsTo: r ? r.bandsTo : 0, scene: r ? r.scene : 0, coinsShown: r ? r.coinsShown : 0, flying: r ? r.flyCoins.length : 0,
        wave: r && r.wave ? +r.wave.u.toFixed(3) : null, stackAlpha: r ? +r.stackAlpha.toFixed(3) : 1, hud: r ? +r.hud.toFixed(3) : 0, hand: r ? +r.hand.toFixed(2) : 0,
        win: r && r.win ? r.win.kind : null, winT: r && r.win ? +r.win.t.toFixed(2) : 0, results: !!(r && r.results), dragging: !!gesture,
        save: JSON.parse(JSON.stringify(save)), muted: A.muted, gain: A.gain, dpr: R.dpr, vw: R.VW, crown, fixedSeed,
        particles: R.particles, caches: R.cacheSizes(), drawn: R.drawn, counters: Object.assign({}, counters), timers: r ? r.timers.length : 0,
        cell: r ? { px: +cellPx().toFixed(2), vh: +((cellPx() / innerHeight) * 100).toFixed(2) } : null,
        layout: r ? {
          well: rect(r.lay.x, r.lay.y, r.lay.w, r.lay.h), frame: rect(r.lay.x - 11, r.lay.y - 11, r.lay.w + 22, r.lay.h + 22),
          track: rect(r.lay.track.x - 30, r.lay.track.keyY - 30, 60, r.lay.track.y0 - r.lay.track.keyY + 30 + r.lay.track.r * 2),
          next: rect(r.lay.next.x - r.lay.next.r, r.lay.next.y - r.lay.next.r - 4, r.lay.next.r * 2, r.lay.next.r * 2 + 8),
          coin: rect(r.lay.coin.x - 36, r.lay.coin.y - 33, 190, 66),
        } : null,
      };
    },
    // a game of this size; with a seed, exactly that game (as logic.js deals it)
    start(mode, seed) { startGame(mode, seed == null ? undefined : seed); return run.g.seed; },
    // the same things the buttons do: 'left', 'right', 'turn', 'drop'
    act(name) { return name === 'left' ? slide(-1) : name === 'right' ? slide(1) : name === 'turn' || name === 'rotate' ? turn() : name === 'drop' ? drop() : false; },
    // let game time pass without waiting for it (the same update the frame loop runs)
    advance(seconds) { let t = seconds; while (t > 0 && run) { const d = Math.min(1 / 60, t); update(d); t -= d; } return run ? run.g.phase : null; },
    keepGoing() { keepGoing(); return run ? run.g.round : 0; },
    // the middle of a cell of the well, in CSS px
    cellCss(x, y) { const r = run; return r ? R.toCss(r.lay.x + (x + 0.5) * r.lay.c, r.lay.y + (y + 0.5) * r.lay.c) : null; },
    // clear this many bands of mist at once (for looking at the picture)
    reveal(n) { if (run) { run.bands = run.bandsTo = clamp(n, 0, run.g.goal); } return run ? run.bands : 0; },
    reset() { save = L.freshSave(); persist(); goModes(); },
    pictures: () => [0, 1, 2].map((sc) => R.pictureCheck(sc, false)).concat([R.pictureCheck(0, true)]),
    blocks: () => R.blockCheck(),
    perf() {
      const sorted = perf.draws.slice().sort((a, b) => a - b), dts = perf.dts.slice().sort((a, b) => a - b);
      const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
      return { frames: perf.frames, fps: perf.frames / (perf.dtSum || 1), drawAvgMs: perf.drawSum / (perf.frames || 1), drawP95Ms: q(sorted, 0.95), drawMaxMs: perf.drawMax, frameP95Ms: q(dts, 0.95) * 1000 };
    },
    resetPerf() { Object.assign(perf, { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] }); },
  };

  // ?mode=hard&seed=42 jumps straight into a game (handy for screenshots)
  const qMode = query.get('mode');
  goModes();
  if (L.MODES[qMode]) startGame(qMode);
  requestAnimationFrame(frame);
})();
