/* Sea Jigsaw: screens, touch, saving and the main loop. Rules live in logic.js, the pictures in pictures.js,
 * drawing in art.js, sound in sound.js.
 *
 * A puzzle's pieces wait in the tray on the right (three big ones at a time on Easy, eight on Medium and Hard; the
 * rest come as places free up). A finger drags one out; it grows to its real size under the finger. Let go near
 * its own place and it glides home with a click and a sparkle; let go anywhere else on the board and it simply
 * stays there; let go over the tray and it goes back. Several fingers can carry pieces at once.
 * The last piece home melts the seams away, a golden key pops out of the picture and flies to the treasure chest,
 * and the chest bursts with coins: the puzzle's base coins always, and each bonus coin still on screen.
 * No words, nothing to lose, no "too slow": the bonus coins just drift off like bubbles as the puzzle goes on. */
(function () {
  'use strict';
  const L = JigsawLogic, A = JigsawArt, S = JigsawSound;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'game.jigsaw.save', MAIN_KEY = 'isabella.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const SNAP_T = 0.15;       // a piece let go near its place glides home (the magnetic snap)
  const GRAB_SLOP = 16;      // a finger picks up a loose piece from this far outside its square (world units)
  const TAP_MOVE = 14, TAP_MS = 400;   // a press that barely moves is a tap
  const HINT_T = 2.6;        // one showing of the "drag it home" hand
  const PEEK_T = 3.5;        // the picture stays up this long (or until the next touch)
  const FLASH_T = 1.3;       // a tapped piece's place stays lit this long
  const LIFT = 1.05;         // a carried piece is drawn a little bigger
  const KEYS = { easy: 0, medium: 2, hard: -3 };   // each size of puzzle has its own key for the music
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const backOut = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

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
  let save = L.migrate(store.get(SAVE_KEY));
  // Sound follows the main game's mute switch (isabella.save), and the switch on the level select flips that same
  // switch: it rewrites only the `muted` field, and never a save it cannot read (as Coral Maze and Sea Words do).
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

  // ---- state ----
  const canvas = $('c');
  A.init(canvas);
  S.setMuted(readMuted());
  let screen = 'levels';   // levels | play | results
  let mode = save.mode;
  let run = null;          // the puzzle being played
  let clock = 0, last = 0, timeScale = 1;
  const counters = { grabs: 0, drops: 0, snaps: 0, misses: 0, backs: 0, bags: 0, taps: 0, peeks: 0, hints: 0, finishes: 0, coinsWon: 0, drifted: 0,
    downs: 0, maxPointers: 0, pointerTypes: {}, started: 0, persists: 0, emptyTaps: 0 };

  function persist() { store.set(SAVE_KEY, JSON.stringify(save)); counters.persists++; }
  // a puzzle left half done keeps its pieces and its clock for next time
  function persistRun() {
    if (run && run.phase === 'play') {
      const snap = run.rules.snapshot();
      if (snap.home.length) save.runs[run.p.id] = snap; else delete save.runs[run.p.id];
    }
    persist();
  }

  // ---- screens ----
  function show(id) {
    for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id);
    const playing = screen === 'play' || screen === 'results';
    $('gridBtn').classList.toggle('on', playing);
    $('eyeBtn').classList.toggle('on', screen === 'play');
  }
  const coinSvg = (cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24"><use href="#i-coin"/></svg>`;
  function setSoundIcon() { $('soundBtn').querySelector('use').setAttribute('href', readMuted() ? '#i-mute' : '#i-sound'); }
  // the medium and hard pictures on the mode buttons: nine and sixteen little tiles
  const tiles = (n, gap) => { const w = (88 - gap * (n - 1)) / n; return Array.from({ length: n * n }, (_, i) => `<rect x="${(6 + (i % n) * (w + gap)).toFixed(1)}" y="${(6 + Math.floor(i / n) * (w + gap)).toFixed(1)}" width="${w.toFixed(1)}" height="${w.toFixed(1)}" rx="${(w * 0.22).toFixed(1)}"${i === n * n - 1 ? ' fill="#ffd23f"' : ''}/>`).join(''); };
  $('mediumTiles').innerHTML = tiles(3, 5);
  $('hardTiles').innerHTML = tiles(4, 4);

  // ---- level select: the size (easy, medium, hard), then its ten pictures ----
  function goLevels(m) {
    releaseAll();
    if (run) { if (run.phase === 'play') persistRun(); A.release(); }
    run = null;
    A.clearParts();
    if (m && L.MODES[m]) mode = m;
    if (save.mode !== mode) { save.mode = mode; persist(); }
    screen = 'levels';
    show('levels');
    const prog = save[mode], grid = $('grid');
    grid.innerHTML = '';
    const cvs = [];
    for (const p of L.puzzlesOf(mode)) {
      const best = prog.best[p.n - 1], done = best >= 0, locked = p.n > prog.unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (done ? ' done' : '') + (p.n === prog.unlocked && !done ? ' next' : '');
      b.dataset.n = p.n; b.dataset.mode = mode; b.dataset.id = p.id;
      b.setAttribute('aria-label', `Puzzle ${p.n}`);
      b.innerHTML = `<div class="pic"><canvas></canvas><div class="num ol-navy">${p.n}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg></div>`
        + `<svg class="keyb" viewBox="0 0 64 32"><use href="#i-key"/></svg><div class="st">${done ? coinSvg('').repeat(best) : ''}</div>`;
      b.addEventListener('click', () => {
        S.init();
        if (locked) { S.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        S.click(); startPuzzle(p);
      });
      grid.appendChild(b);
      cvs.push([b.querySelector('canvas'), p]);
    }
    for (const [cv, p] of cvs) A.thumb(cv, p);
    $('coinCount').textContent = save.coins;
    for (const id of L.MODE_IDS) $('mode-' + id).classList.toggle('on', id === mode);
    setSoundIcon();
    S.setKey(KEYS[mode]); S.startMusic(9, KEYS[mode]);
  }

  // ---- a puzzle ----
  // Each piece has a picture state: 'bag' (not on screen), 'tray' (in its tray slot), 'held' (in a finger),
  // 'loose' (lying on the board), 'snap' (gliding home), 'tobag' (hopping back into the bag) or 'home'.
  function startPuzzle(p, fresh) {
    releaseAll();
    if (run && run.phase === 'play' && run.p.id !== p.id) persistRun();   // keep the other puzzle's pieces for later
    if (fresh) delete save.runs[p.id];
    const rules = new L.Run(p, save.runs[p.id]);
    mode = p.mode;
    if (save.mode !== mode) save.mode = mode;
    const lay = A.layout(p);
    A.prepare(p, lay, rules.snapshot().home);
    const C = L.cut(p), pieces = [];
    for (let id = 0; id < p.pieces; id++) pieces.push({ id, st: rules.state[id], x: 0, y: 0, k: lay.tk, hx: C.pieces[id].hx, hy: C.pieces[id].hy, nx: 0.5, ny: 0.5, from: 'tray', pop: 1, wait: 0, wig: -1, mag: 0, sn: null, bt: 0 });
    run = {
      p, M: L.MODES[p.mode], rules, lay, pieces, loose: [], phase: 'play', pt: 0, timers: [],
      idle: 0, hint: null, hintCool: 0, hints: 0, everSnapped: rules.homeCount > 0,
      peekOn: false, peek: 0, peekT: 0, flash: null, leaving: [], bonusShown: rules.bonus,
      win: null, won: null, results: false,
    };
    rules.slots.forEach((id, k) => { if (id >= 0) deal(id, k, 0.05 + k * 0.06, true); });
    screen = 'play'; show(null);
    A.clearParts();
    S.setKey(KEYS[mode]); S.startMusic(L.MODE_IDS.indexOf(mode) * 10 + p.n, KEYS[mode]);
    counters.started++;
    persist();
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }
  const homeXY = (q) => ({ x: run.lay.board.x + q.hx * run.lay.k, y: run.lay.board.y + q.hy * run.lay.k });
  // a piece arrives in tray slot k: it pops in there after a moment
  function deal(id, k, wait, quiet) {
    const q = run.pieces[id], sl = run.lay.slots[k];
    q.st = 'tray'; q.from = 'tray'; q.x = sl.x; q.y = sl.y; q.k = run.lay.tk; q.pop = 0; q.wait = wait || 0; q.mag = 0;
    if (!quiet) later(q.wait, () => S.deal());
  }
  function stepPieces(dt) {
    const r = run, lay = r.lay, ease = Math.min(1, dt * 14);
    for (const q of r.pieces) {
      if (q.wig >= 0 && (q.wig += dt) > 0.5) q.wig = -1;
      if (q.st === 'tray') {
        const k = r.rules.slotOf(q.id), sl = k >= 0 ? lay.slots[k] : null;
        if (q.wait > 0) { q.wait -= dt; continue; }
        if (q.pop < 1) q.pop = Math.min(1, q.pop + dt * 4);
        if (sl) { q.x += (sl.x - q.x) * ease; q.y += (sl.y - q.y) * ease; }
        q.k += (lay.tk - q.k) * ease;
      } else if (q.st === 'loose') {
        const tx = lay.board.x + q.nx * lay.board.w, ty = lay.board.y + q.ny * lay.board.h;
        q.x += (tx - q.x) * ease; q.y += (ty - q.y) * ease; q.k += (lay.k - q.k) * ease;
      } else if (q.st === 'snap') {
        const h = homeXY(q), u = smooth(clamp((q.sn.t += dt) / SNAP_T, 0, 1));
        q.x = q.sn.x0 + (h.x - q.sn.x0) * u; q.y = q.sn.y0 + (h.y - q.sn.y0) * u; q.k = q.sn.k0 + (lay.k - q.sn.k0) * u;
        if (q.sn.t >= SNAP_T) landHome(q);
      } else if (q.st === 'tobag') {
        const b = lay.hud.bag, u = smooth(clamp((q.bt += dt) / 0.28, 0, 1));
        q.x += (b.x - q.x) * u; q.y += (b.y - q.y) * u; q.k = lay.tk * (1 - u * 0.85);
        if (q.bt >= 0.28) q.st = 'bag';
      } else if (q.st === 'held') {
        q.k += (lay.k * LIFT - q.k) * Math.min(1, dt * 16);
      }
    }
  }
  // the piece has glided into its place: it clicks in and becomes part of the board
  function landHome(q) {
    const r = run, h = homeXY(q);
    q.st = 'home'; q.x = h.x; q.y = h.y; q.sn = null;
    A.placeHome(q.id);
    A.burst('snap', h.x, h.y, Math.min(r.p.cw, r.p.ch) * r.lay.k * 0.5);
    S.snap(r.rules.homeCount / r.rules.n);
  }

  // ---- a drop: the one place the rules are applied (real fingers and window.__jigsawDebug.drop both come here) ----
  // where: 'home' | 'board' | 'tray' (logic.js resolveDrop)
  function dropPiece(q, where) {
    const r = run, res = r.rules.drop(q.id, where);
    counters.drops++;
    if (res.type === 'home') {
      q.st = 'snap'; q.sn = { t: 0, x0: q.x, y0: q.y, k0: q.k };
      counters.snaps++;
      r.idle = 0; r.hint = null; r.everSnapped = true; r.flash = null;
      if (res.done) finishPuzzle(); else persistRun();
    } else if (res.type === 'loose') {
      // it rests wholly on the board (never half under a button or the tray)
      const B = r.lay.board, hw = (r.p.cw * r.lay.k) / 2, hh = (r.p.ch * r.lay.k) / 2, c = L.clampToBoard(q.x, q.y, { x0: B.x + hw, y0: B.y + hh, x1: B.x + B.w - hw, y1: B.y + B.h - hh });
      q.st = 'loose'; q.from = 'loose'; q.nx = (c.x - B.x) / B.w; q.ny = (c.y - B.y) / B.h;
      r.loose.push(q.id);
      counters.misses++; S.put();
    } else if (res.type === 'back') {
      q.st = 'tray'; q.from = 'tray'; counters.backs++; S.back();
    } else if (res.type === 'bag') {
      q.st = 'tobag'; q.bt = 0; counters.bags++; S.back();
    } else restore(q);
    (res.dealt || []).forEach(([id, k], i) => deal(id, k, 0.12 + i * 0.08));
    return res;
  }
  // put a piece back where it was before a finger took it
  function restore(q) {
    if (q.st !== 'held') return;
    if (q.from === 'loose') { q.st = 'loose'; run.loose.push(q.id); } else q.st = 'tray';
  }
  function tapPiece(q) {
    restore(q);
    q.wig = 0; S.boop(); counters.taps++;
    A.burst('tap', q.x, q.y, 40);
    if (run.M.tapHint) run.flash = { id: q.id, t: 0 };   // Easy and Medium: its place lights up for a moment
  }

  // ---- the "drag it home" hand: puzzle 1 of Easy until the first piece is home, and whenever a child is stuck ----
  function hintPiece() {
    const r = run;
    for (const id of r.rules.slots) if (id >= 0 && r.pieces[id].st === 'tray' && r.pieces[id].pop >= 1) return r.pieces[id];
    for (let i = r.loose.length - 1; i >= 0; i--) if (r.pieces[r.loose[i]].st === 'loose') return r.pieces[r.loose[i]];
    return null;
  }
  function stepHint(dt) {
    const r = run;
    if (r.phase !== 'play' || active.size || r.peekOn) { r.hint = null; return; }
    if (r.hint) {
      const q = r.pieces[r.hint.id];
      if ((q.st !== 'tray' && q.st !== 'loose') || (r.hint.t += dt) >= HINT_T * r.hint.n) { r.hint = null; r.hintCool = 2.5; }
      return;
    }
    if ((r.hintCool -= dt) > 0) return;
    const demo = r.p.id === 'e1' && !r.everSnapped && save.solved === 0 && r.pt > 0.9;
    if (!demo && r.idle < (r.hints ? r.M.hintAfter * 0.6 : r.M.hintAfter)) return;
    const q = hintPiece();
    if (q) { r.hint = { id: q.id, t: 0, n: 2 }; r.idle = 0; r.hints++; counters.hints++; S.hint(); }
  }

  // ---- the picture button ----
  function setPeek(on) {
    const r = run;
    if (!r || r.phase !== 'play') return;
    r.peekOn = !!on; r.peekT = PEEK_T;
    $('eyeBtn').classList.toggle('peeking', r.peekOn);
    if (on) { releaseAll(); counters.peeks++; S.peek(); }
  }

  // ---- finishing: the key, the chest, the coins ----
  // The last piece is home: progress and coins are saved at once; the celebration starts when it has clicked in.
  function finishPuzzle() {
    const r = run;
    r.won = L.finish(save, r.p, r.rules.t);
    r.phase = 'won';
    counters.finishes++; counters.coinsWon += r.won.total;
    persist();
    later(SNAP_T + 0.12, startWin);
  }
  // the times of the celebration, in seconds after the last piece clicked in
  // (the finished picture has a second to itself before the key pops out of it)
  const W = { MELT: 0.7, CHEST: 0.7, RISE: 0.7, KEY: 1.0, KEY_IN: 0.4, FLY: 1.8, FLY_T: 0.85, OPEN: 2.7, OPEN_T: 0.45, BURST: 2.95, COUNT: 3.3 };
  function startWin() {
    const r = run;
    if (!r || r.phase !== 'won') return;
    r.phase = 'win';
    releaseAll();
    r.peekOn = false; $('eyeBtn').classList.remove('peeking');
    r.hint = null; r.flash = null;
    const lay = r.lay, B = lay.board, C = lay.chest, won = r.won, M = r.M;
    r.win = { t: 0, tally: 0, pop: 0, fly: [], flown: 0, isa: null };
    S.done();
    A.burst('shine', B.x + B.w / 2, B.y + B.h / 2, B.w * 0.46);
    later(W.CHEST, () => { A.burst('puff', C.x, 520, 70); S.whoosh(); });
    later(W.KEY, () => { S.key(); A.burst('snap', B.x + B.w / 2, B.y + B.h * 0.45, 70); });
    later(W.FLY, () => S.whoosh());
    later(W.OPEN, () => S.unlock());
    later(W.BURST, () => {
      S.chest(); A.fountain(C.x, C.y - 46 * C.sc, 44, 512); A.burst('confetti', 0, 0, 0);
      r.win.isa = { t: 0 }; S.isabella();
    });
    later(W.BURST + 0.5, () => A.fountain(C.x, C.y - 46 * C.sc, 24, 512));
    later(W.BURST + 1.0, () => A.fountain(C.x, C.y - 46 * C.sc, 24, 512));
    // the base coins hop out of the chest and are counted, one by one...
    const gap = Math.min(0.13, 1.5 / won.base);
    for (let i = 0; i < won.base; i++) later(W.COUNT + i * gap, () => r.win.fly.push({ t: 0, x0: C.x + (Math.random() - 0.5) * 50 * C.sc, y0: C.y - 50 * C.sc, n: 1, big: false, i: -1 }));
    // ...then each bonus coin still on screen flies down from the top and is added
    let t = W.COUNT + won.base * gap + 0.35;
    for (let b = won.bonus - 1; b >= 0; b--) {
      const slot = lay.hud.coins[b];
      later(t, () => { r.win.flown++; r.win.fly.push({ t: 0, x0: slot.x, y0: slot.y, n: M.bonusEach, big: true, i: b }); });
      t += 0.5;
    }
    later(t + 0.75, showResults);
  }
  const FLY_COIN = 0.42;
  // where the key is t seconds into the celebration (null: not out yet, or already in the lock). u: 0..1 along its flight
  function keyAt(t) {
    if (t < W.KEY || t >= W.OPEN) return null;
    const B = run.lay.board, C = run.lay.chest, x0 = B.x + B.w / 2, y0 = B.y + B.h * 0.45, x1 = C.x, y1 = C.y - 30 * C.sc;
    const grow = backOut(clamp((t - W.KEY) / W.KEY_IN, 0, 1)), u = smooth(clamp((t - W.FLY) / W.FLY_T, 0, 1));
    return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * 130, sc: (2.7 + (0.75 * C.sc - 2.7) * u) * grow, u };
  }
  function stepWin(dt) {
    const w = run.win, lay = run.lay;
    w.t += dt;
    if (w.pop > 0) w.pop = Math.max(0, w.pop - dt * 5);
    if (w.isa) w.isa.t += dt;
    for (let i = w.fly.length - 1; i >= 0; i--) {
      const c = w.fly[i];
      if ((c.t += dt) < FLY_COIN) continue;
      w.fly.splice(i, 1);
      w.tally += c.n; w.pop = 1;
      A.burst('coin', lay.counter.x - 20, lay.counter.y);
      if (c.big) S.bonus(c.i); else S.coin(w.tally);
    }
  }
  function placeCard() {
    if (!run) return;
    const B = run.lay.board, c = A.toClient(B.x + B.w / 2, B.y + B.h / 2);
    $('resCard').style.left = c.x + 'px';
  }
  function showResults() {
    const r = run;
    if (!r || r.results) return;
    r.results = true; screen = 'results';
    const loot = $('resLoot');
    loot.innerHTML = `<svg class="keyl" viewBox="0 0 64 32"><use href="#i-key"/></svg>` + coinSvg('bonus').repeat(r.won.bonus);
    $('resCoins').textContent = '+' + r.won.total;
    $('resNext').style.display = r.p.n < L.PER ? '' : 'none';
    placeCard();
    show('results');
    [...loot.children].forEach((el, i) => later(0.2 + i * 0.34, () => { el.classList.add('pop'); if (i === 0) S.click(); else S.bonus(i - 1); }));
  }

  // ---- input: each finger can carry a piece; a quick tap makes a piece wiggle (and, on Easy and Medium, lights its place) ----
  const active = new Map();   // pointerId -> { id, q, ox, oy (piece minus finger), sx, sy, x, y, t0, moved }
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  function pick(x, y) {
    const r = run, lay = r.lay, hw = (r.p.cw * lay.k) / 2 + GRAB_SLOP, hh = (r.p.ch * lay.k) / 2 + GRAB_SLOP;
    for (let i = r.loose.length - 1; i >= 0; i--) {   // the piece on top first
      const q = r.pieces[r.loose[i]];
      if (q.st === 'loose' && Math.abs(x - q.x) <= hw && Math.abs(y - q.y) <= hh) return q;
    }
    for (let k = 0; k < lay.slots.length; k++) {      // in the tray, the whole slot is the piece's handle
      const id = r.rules.slots[k], sl = lay.slots[k];
      if (id >= 0 && r.pieces[id].st === 'tray' && r.pieces[id].wait <= 0 && Math.abs(x - sl.x) <= sl.w / 2 && Math.abs(y - sl.y) <= sl.h / 2) return r.pieces[id];
    }
    return null;
  }
  // out of the tray or off the board, into a hand
  function take(q) {
    q.from = q.st;
    if (q.st === 'loose') { const i = run.loose.indexOf(q.id); if (i >= 0) run.loose.splice(i, 1); }
    q.st = 'held'; q.pop = 1; q.wait = 0;
  }
  function grab(q, pid, p) {
    const r = run;
    take(q);
    active.set(pid, { id: pid, q, ox: q.x - p.x, oy: q.y - p.y, sx: p.x, sy: p.y, x: p.x, y: p.y, t0: performance.now(), moved: false });
    r.rules.start();
    counters.grabs++; counters.maxPointers = Math.max(counters.maxPointers, active.size);
    S.grab();
    r.hint = null; r.hintCool = 3; r.flash = null;
  }
  function placeHeld(g) {
    const q = g.q, lay = run.lay, hw = (run.p.cw * lay.k) / 2, hh = (run.p.ch * lay.k) / 2;
    q.x = clamp(g.x + g.ox, hw * 0.4, A.VW - hw * 0.4);
    q.y = clamp(g.y + g.oy, hh * 0.4, A.H - hh * 0.4);
  }
  // a small piece would hide under the fingertip, so it rides just above it; a piece grabbed by its edge slides in
  const liftOf = () => clamp(60 - Math.min(run.p.cw, run.p.ch) * run.lay.k * 0.22, 0, 34);
  function easeGrabs(dt) {
    for (const g of active.values()) {
      const q = g.q, h = homeXY(q), snapR = L.snapRadius(run.p) * run.lay.k;
      if (g.moved) {
        const k = Math.exp(-dt * 7), ty = -liftOf();
        g.ox *= k; g.oy = ty + (g.oy - ty) * k;
        placeHeld(g);
      }
      const near = Math.min(Math.hypot(q.x - h.x, q.y - h.y), Math.hypot(g.x - h.x, g.y - h.y)) <= snapR;
      q.mag += ((near ? 1 : 0) - q.mag) * Math.min(1, dt * 12);
    }
  }
  function release(g, cancelled) {
    const q = g.q;
    if (!run || q.st !== 'held') return;
    q.mag = 0;
    if (cancelled || run.phase !== 'play') { restore(q); return; }
    if (!g.moved && performance.now() - g.t0 < TAP_MS) { tapPiece(q); return; }
    const h = homeXY(q), T = run.lay.tray;
    dropPiece(q, L.resolveDrop({ px: q.x, py: q.y, fx: g.x, fy: g.y, hx: h.x, hy: h.y, snapR: L.snapRadius(run.p) * run.lay.k, tray: T }));
  }
  function releaseAll() { const gs = [...active.values()]; active.clear(); for (const g of gs) release(g, true); }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (screen !== 'play' || !run || upright()) return;
    counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    const p = A.toWorld(e.clientX, e.clientY);
    if (run.phase !== 'play') return;
    if (run.peekOn) { setPeek(false); return; }   // a touch puts the picture away
    const q = pick(p.x, p.y);
    if (q) { grab(q, e.pointerId, p); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ } return; }
    counters.emptyTaps++; A.burst('ripple', p.x, p.y); S.ripple();
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
  for (const m of L.MODE_IDS) tap('mode-' + m, () => goLevels(m));
  tap('resLevels', () => goLevels());
  tap('resReplay', () => startPuzzle(run ? run.p : L.puzzle(mode, 1), true));
  tap('resNext', () => startPuzzle(L.puzzle(mode, Math.min(L.PER, (run ? run.p.n : 0) + 1))));
  tap('gridBtn', () => goLevels());
  $('eyeBtn').addEventListener('click', () => { S.init(); if (run) setPeek(!run.peekOn); });
  tap('soundBtn', () => { const m = !readMuted(); writeMuted(m); S.setMuted(m); S.init(); setSoundIcon(); });
  $('homeBtn').addEventListener('click', () => { S.init(); S.click(); persistRun(); location.href = HUB; });
  // Android back button (called from MainActivity): back to the hub.
  window.__back = () => { persistRun(); location.href = '../../index.html'; return true; };
  window.__pause = () => { S.suspend(); persistRun(); };
  // grown-ups: hold the title for 4 seconds to open every puzzle
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { for (const m of L.MODE_IDS) save[m].unlocked = L.PER; persist(); S.init(); S.rainbow(); goLevels(); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.suspend(); releaseAll(); persistRun(); return; }
    S.setMuted(readMuted()); S.resume(); last = 0;
  });
  window.addEventListener('pagehide', persistRun);
  window.addEventListener('pageshow', () => { S.setMuted(readMuted()); if (screen === 'levels') setSoundIcon(); });
  window.addEventListener('resize', () => {
    A.resize();
    if (!run) { goLevels(); return; }
    // the board is a different size now: lay everything out again and cut the pieces again at the new size
    const r = run;
    releaseAll();
    r.lay = A.layout(r.p);
    A.prepare(r.p, r.lay, r.rules.snapshot().home);
    for (const q of r.pieces) {
      if (q.st === 'snap') { q.st = 'home'; A.placeHome(q.id); }
      if (q.st === 'tray') { const sl = r.lay.slots[r.rules.slotOf(q.id)]; if (sl) { q.x = sl.x; q.y = sl.y; } q.k = r.lay.tk; }
      if (q.st === 'loose') { q.x = r.lay.board.x + q.nx * r.lay.board.w; q.y = r.lay.board.y + q.ny * r.lay.board.h; q.k = r.lay.k; }
    }
    if (screen === 'results') placeCard();
  });

  // ---- drawing ----
  const wigRot = (q) => (q.wig >= 0 ? Math.sin(q.wig * 32) * 0.13 * (1 - q.wig / 0.5) : 0);
  const pieceOpt = { alpha: 1, rot: 0, shadow: 0 };
  function drawPieceAs(q, shadow, alpha) {
    pieceOpt.alpha = alpha; pieceOpt.rot = wigRot(q); pieceOpt.shadow = shadow;
    A.drawPiece(q.id, q.x, q.y, q.k, pieceOpt);
  }
  function drawWin() {
    const r = run, w = r.win, lay = r.lay, B = lay.board, C = lay.chest, t = w.t;
    // the chest pushes up out of the sand where the tray was
    const rise = backOut(clamp((t - W.CHEST) / W.RISE, 0, 1)), open = smooth(clamp((t - W.OPEN) / W.OPEN_T, 0, 1));
    if (t > W.CHEST) A.drawChest(C.x, A.H + 90 + (C.y - A.H - 90) * rise, open, clock, C.sc);
    // Isabella swims in from the right to see the treasure
    if (w.isa) {
      const u = smooth(clamp(w.isa.t / 1.0, 0, 1)), I = lay.isa;
      A.drawIsabella(A.VW + 150 + (I.x - 30 * I.sc - A.VW - 150) * u, I.y + Math.sin(clock * 2.2) * 7, { scale: I.sc, flip: true, t: clock, happy: true, wave: u >= 1 ? clock * 9 : null, tilt: Math.sin(clock * 1.6) * 0.06 });
    }
    // the key: it pops out of the middle of the picture, hangs there shining, then flies to the lock
    const K = keyAt(t);
    if (K) {
      A.drawKey(K.x, K.y, -0.5 + Math.sin(clock * 3) * 0.12 * (1 - K.u) + K.u * (Math.PI / 2 + 0.5), K.sc, 1 - K.u * 0.6);
      if (K.u > 0 && K.u < 1 && Math.random() < 0.6) A.burst('twinkle', K.x, K.y, 16, '#fff3a0');
    }
    for (const c of w.fly) {
      const u = smooth(clamp(c.t / FLY_COIN, 0, 1)), x = c.x0 + (lay.counter.x - 20 - c.x0) * u, y = c.y0 + (lay.counter.y - c.y0) * u - Math.sin(u * Math.PI) * (c.big ? 30 : 70);
      if (c.big) A.glow(x, y, 46, 'rgba(255,225,110,0.85)', 0.7);
      A.drawCoin(x, y, c.t * 14, c.big ? lay.hud.coins[0].r : 17);
    }
    A.drawCounter(lay.counter.x, lay.counter.y, w.tally, w.pop, smooth(clamp((t - W.COUNT + 0.2) / 0.3, 0, 1)));
  }
  function drawPlay() {
    const r = run, lay = r.lay, win = r.win;
    A.drawBackdrop(r.p.mode);
    const melt = win ? smooth(clamp(win.t / W.MELT, 0, 1)) : 0;
    A.drawBoard(lay, melt);
    if (melt > 0) A.drawPicture(lay, melt);
    if (r.flash) A.drawPlace(lay, r.flash.id, 1 - smooth(clamp((r.flash.t - FLASH_T + 0.4) / 0.4, 0, 1)), clock);
    for (const g of active.values()) if (g.q.mag > 0.02) A.drawPlace(lay, g.q.id, g.q.mag, clock);
    const trayA = win ? 1 - smooth(clamp(win.t / 0.5, 0, 1)) : 1;
    A.drawTray(lay, trayA, r.rules.waiting, clock);
    A.drawBonus(lay, win ? r.won.bonus - win.flown : r.bonusShown, r.leaving, clock, 1);
    for (const q of r.pieces) {
      if (q.st === 'tray' && q.wait <= 0) { const k = q.k; q.k = k * backOut(q.pop); drawPieceAs(q, 0.25, 1); q.k = k; }
      else if (q.st === 'tobag') drawPieceAs(q, 0, 1 - q.bt / 0.28);
    }
    for (const id of r.loose) { const q = r.pieces[id]; if (q.st === 'loose') drawPieceAs(q, 0.4, 1); }
    for (const q of r.pieces) if (q.st === 'snap') drawPieceAs(q, 0.2, 1);
    for (const g of active.values()) {
      // near its place a carried piece leans toward it (the magnet), so letting go there feels right
      const q = g.q, h = homeXY(q), x = q.x, y = q.y, m = q.mag * 0.4;
      q.x = x + (h.x - x) * m; q.y = y + (h.y - y) * m;
      drawPieceAs(q, 1, 1);
      q.x = x; q.y = y;
    }
    if (r.peek > 0.004) A.drawPicture(lay, r.peek * 0.96);
    A.drawParts();
    if (r.hint) { const q = r.pieces[r.hint.id]; A.drawDragHint(lay, q.id, { x: q.x, y: q.y, scale: q.k }, (r.hint.t % HINT_T) / HINT_T, clock); }
    if (win) drawWin();
  }
  function draw() {
    A.begin();
    if (!run) A.drawMenu(mode, clock); else drawPlay();
  }

  // ---- main loop ----
  function update(dt) {
    const r = run;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; if ((tm.t -= dt) <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    if (r.phase === 'play') {
      r.rules.tick(dt);
      if (!active.size) r.idle += dt;
      // a bonus coin that has had its time drifts away like a bubble: no sound of losing, no message
      const b = r.rules.bonus;
      while (r.bonusShown > b) { r.bonusShown--; r.leaving.push({ i: r.bonusShown, t: 0 }); counters.drifted++; S.drift(); }
      if (r.peekOn && (r.peekT -= dt) <= 0) setPeek(false);
    } else if (r.phase === 'win') stepWin(dt);
    for (let i = r.leaving.length - 1; i >= 0; i--) if ((r.leaving[i].t += dt) > 1.8) r.leaving.splice(i, 1);
    r.peek += ((r.peekOn ? 1 : 0) - r.peek) * Math.min(1, dt * 10);
    if (r.flash && (r.flash.t += dt) > FLASH_T) r.flash = null;
    easeGrabs(dt);
    stepPieces(dt);
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
        if (run) update(dt); else A.stepParts(dt);
      }
      draw();
    }
    perf[perfN++ % perf.length] = performance.now() - t0;
    requestAnimationFrame(frame);
  }

  // ---- hooks for the headless tests (test/games/jigsaw) ----
  function rectCss(x0, y0, x1, y1) { const a = A.toClient(x0, y0), b = A.toClient(x1, y1); return { left: a.x, top: a.y, right: b.x, bottom: b.y, width: b.x - a.x, height: b.y - a.y }; }
  window.__jigsawDebug = {
    counters,
    state() {
      const r = run, lay = r ? r.lay : null, px = A.scale / A.dpr;
      return {
        screen, mode, puzzle: r ? r.p.id : null, pic: r ? r.p.pic : null, cols: r ? r.p.cols : 0, rows: r ? r.p.rows : 0, n: r ? r.p.pieces : 0,
        phase: r ? r.phase : null, homeCount: r ? r.rules.homeCount : 0, waiting: r ? r.rules.waiting : 0, slots: r ? r.rules.slots.slice() : [],
        t: r ? r.rules.t : 0, started: r ? r.rules.started : false, bonus: r ? r.rules.bonus : 0, bonusShown: r ? r.bonusShown : 0, leaving: r ? r.leaving.length : 0,
        bonusTimes: r ? L.bonusTimes(r.p) : [], done: r ? r.rules.done : false, results: !!(r && r.results), won: r && r.won ? Object.assign({}, r.won) : null,
        winT: r && r.win ? r.win.t : null, tally: r && r.win ? r.win.tally : 0, flying: r && r.win ? r.win.fly.length : 0, isabella: !!(r && r.win && r.win.isa),
        key: r && r.win && keyAt(r.win.t) ? (() => { const K = keyAt(r.win.t), c = A.toClient(K.x, K.y); return { cx: c.x, cy: c.y, sc: K.sc, u: K.u }; })() : null,
        chestOpen: r && r.win ? smooth(clamp((r.win.t - W.OPEN) / W.OPEN_T, 0, 1)) : 0, chestUp: r && r.win ? clamp((r.win.t - W.CHEST) / W.RISE, 0, 1) : 0,
        hudBonus: r ? (r.win ? r.won.bonus - r.win.flown : r.bonusShown) : 0, trayAlpha: r && r.win ? 1 - smooth(clamp(r.win.t / 0.5, 0, 1)) : 1,
        peek: r ? r.peek : 0, peekOn: !!(r && r.peekOn), hint: r && r.hint ? r.hint.id : null, flash: r && r.flash ? r.flash.id : null, guide: r ? r.M.guide : null,
        pieces: r ? r.pieces.map((q) => {
          const c = A.toClient(q.x, q.y), h = homeXY(q), hc = A.toClient(h.x, h.y), k = r.rules.slotOf(q.id), sl = k >= 0 ? lay.slots[k] : null;
          return { id: q.id, st: q.st, rule: r.rules.state[q.id], slot: k, x: q.x, y: q.y, k: q.k, cx: c.x, cy: c.y, hcx: hc.x, hcy: hc.y, ready: q.st !== 'tray' || (q.wait <= 0 && q.pop >= 1),
            // the size of what a finger can take hold of, in CSS px: the whole tray slot, or a loose piece's square and the slop round it
            gw: (sl && q.st === 'tray' ? sl.w : r.p.cw * lay.k + GRAB_SLOP * 2) * px, gh: (sl && q.st === 'tray' ? sl.h : r.p.ch * lay.k + GRAB_SLOP * 2) * px };
        }) : [],
        loose: r ? r.loose.slice() : [], held: active.size, magnet: [...active.values()].filter((g) => g.q.mag > 0.5).map((g) => g.q.id),
        board: lay ? rectCss(lay.board.x, lay.board.y, lay.board.x + lay.board.w, lay.board.y + lay.board.h) : null,
        tray: lay ? rectCss(lay.tray.x0, lay.tray.y0, lay.tray.x1, lay.tray.y1) : null,
        cell: r ? { w: r.p.cw * lay.k * px, h: r.p.ch * lay.k * px } : null, trayPiece: r ? { w: r.p.cw * lay.tk * px, h: r.p.ch * lay.tk * px } : null,
        snapR: r ? L.snapRadius(r.p) * lay.k * px : 0, boardScale: lay ? lay.k : 0,
        hud: lay ? lay.hud.coins.map((c) => A.toClient(c.x, c.y)) : [], chestAt: lay ? A.toClient(lay.chest.x, lay.chest.y) : null,
        coins: save.coins, solved: save.solved, unlocked: { easy: save.easy.unlocked, medium: save.medium.unlocked, hard: save.hard.unlocked }, best: save[mode].best.slice(), runs: Object.keys(save.runs),
        VW: A.VW, scale: A.scale, dpr: A.dpr, canvas: [canvas.width, canvas.height], parts: A.partCount, gold: A.partsOfType('gcoin'),
        muted: S.muted, audio: S.state, gain: S.gain, caches: A.cacheSizes(), asset: A.assetId, timers: r ? r.timers.length : 0,
      };
    },
    start(m, n, fresh) { const p = L.puzzle(m, n); if (!p) return null; startPuzzle(p, !!fresh); return p.id; },
    // the same rule code as a real drop: where is 'home', 'board' or 'tray'
    drop(id, where) {
      if (!run || run.phase !== 'play') return null;
      const q = run.pieces[id];
      if (!q || (q.st !== 'tray' && q.st !== 'loose' && q.st !== 'held')) return null;
      if (q.st === 'held') { for (const [pid, g] of active) if (g.q === q) active.delete(pid); } else take(q);
      if (where === 'board') { const B = run.lay.board; q.x = B.x + B.w * (0.2 + 0.6 * Math.random()); q.y = B.y + B.h * (0.2 + 0.6 * Math.random()); }
      return dropPiece(q, where || 'home').type;
    },
    // put the next k waiting pieces home (tray first), through drop()
    solve(k) {
      let n = 0;
      while (run && run.phase === 'play' && n < k) {
        const q = run.pieces.find((v) => v.st === 'tray' || v.st === 'loose');
        if (!q) break;
        if (this.drop(q.id, 'home') === 'home') n++; else break;
      }
      return n;
    },
    addTime(sec) { if (run && run.phase === 'play') { run.rules.start(); run.rules.t += sec; } return run ? run.rules.t : 0; },
    idle(sec) { if (run) run.idle += sec; },
    peek(on) { setPeek(on == null ? !(run && run.peekOn) : on); return !!(run && run.peekOn); },
    goLevels(m) { goLevels(m); return mode; },
    timeScale(k) { timeScale = k; return timeScale; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    resetPerf() { perfN = 0; perf.fill(0); },
    saved() { return store.get(SAVE_KEY); },
    puzzles() { return L.PUZZLES; },
    boardCheck() { return A.boardCheck(); },
  };

  goLevels();
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?mode=hard&n=4 jumps straight into a puzzle (handy for screenshots), if it is unlocked
  const qs = new URLSearchParams(location.search), qp = L.puzzle(qs.get('mode') || '', +qs.get('n'));
  if (qp && qp.n <= save[qp.mode].unlocked) startPuzzle(qp);
  requestAnimationFrame(frame);
})();
