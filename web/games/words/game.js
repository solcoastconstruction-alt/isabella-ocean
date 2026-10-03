/* Sea Words — screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js, sound in sound.js.
 *
 * A finger draws a line over the letters: it starts on the letter under the finger, points the way the whole drag
 * points (snapped to the 8 directions, steady against a wobble), and jumps onto a word when the finger went down
 * near one end of it and is near the other end (logic.js select). Lifting the finger finds the word under the line
 * (logic.js judge) or lets the line fade away; nothing is ever lost. No timers: a stuck child just gets a glowing
 * first letter after a quiet spell, and Hard's stars count only the hints, never the time. */
(function () {
  'use strict';
  const L = WordsLogic, R = WordsArt, A = WordsSound;
  const $ = (id) => document.getElementById(id);
  const HUB = '../../index.html';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const backOut = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  const INTRO = 0.7;         // seconds the board takes to pop in (fingers work from the start)
  const FADE = 0.45;         // a line that found nothing fades away over this long
  const WIN_AFTER = 0.6;     // the last word's own sparkle first, then the chest
  const RESULTS_AT = 3.7;    // the results card, once the chest has burst open

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
  const SAVE_KEY = 'game.words.save', MAIN_KEY = 'isabella.save';
  // solved: puzzles finished in each size; stars: Hard's stars, all added up; words: every word ever found
  const freshSave = () => ({ v: 1, solved: { easy: 0, medium: 0, hard: 0 }, stars: 0, words: 0, last: 'easy' });
  function loadSave() {
    const sv = freshSave();
    try {
      const raw = JSON.parse(store.get(SAVE_KEY) || 'null');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
        if (raw.solved && typeof raw.solved === 'object') for (const m of L.MODE_IDS) sv.solved[m] = n(raw.solved[m]);
        sv.stars = n(raw.stars); sv.words = n(raw.words);
        if (L.MODE_IDS.indexOf(raw.last) >= 0) sv.last = raw.last;
      }
    } catch (e) { /* a broken save starts fresh */ }
    return sv;
  }
  let save = loadSave();
  const persist = () => store.set(SAVE_KEY, JSON.stringify(save));
  // Sound follows the main game's mute switch (isabella.save), and the switch on the picker flips that same switch:
  // it rewrites only the `muted` field, and never a save it cannot read (as Coral Maze does).
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
  let screen = 'modes', run = null, clock = 0, last = 0, drag = null, crown = crownEarned();
  const recent = { easy: [], medium: [], hard: [] };   // this visit's last words per size, so the next puzzle differs
  const canvas = $('c');
  R.init(canvas);
  A.setMuted(readMuted());

  function show(id) {
    for (const n of ['modes', 'results']) $(n).classList.toggle('on', n === id);
    $('modesBtn').classList.toggle('on', screen === 'play');
  }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(0,40,80,0.15)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.3)'}" stroke-width="1.5"/></svg>`;
  }
  function setSoundIcon() { $('soundBtn').querySelector('use').setAttribute('href', readMuted() ? '#i-mute' : '#i-sound'); }
  // the big grid's 6 x 6 tiles on the picker
  $('hardTiles').innerHTML = Array.from({ length: 36 }, (_, i) => `<rect x="${11 + (i % 6) * 13.6}" y="${11 + Math.floor(i / 6) * 13.6}" width="10" height="10" rx="2.6"/>`).join('');

  // ---- the picker ----
  function goModes() {
    screen = 'modes'; run = null; drag = null;
    R.clearParticles();
    for (const m of L.MODE_IDS) { $('cnt-' + m).textContent = save.solved[m]; $('mode-' + m).classList.toggle('last', m === save.last); }
    $('starCount').textContent = save.stars;
    setSoundIcon();
    show('modes');
    A.startMusic('menu');
  }

  // ---- a puzzle ----
  function randomSeed() {
    try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; } catch (e) { return (Math.random() * 4294967296) >>> 0; }
  }
  // a brand-new puzzle: Easy never repeats one of its last five words, Medium shares at most one word with the last one
  function freshPuzzle(mode) {
    const rec = recent[mode];
    let p = null;
    for (let tries = 0; tries < 30; tries++) {
      p = L.generate(mode, randomSeed());
      const ws = p.words.map((w) => w.word);
      if (mode === 'easy' && rec.indexOf(ws[0]) >= 0) continue;
      if (mode === 'medium' && ws.filter((w) => rec.indexOf(w) >= 0).length > 1) continue;
      break;
    }
    return p;
  }
  function startPuzzle(mode, seed) {
    if (!L.MODES[mode]) mode = 'easy';
    const p = seed != null ? L.generate(mode, seed >>> 0) : freshPuzzle(mode), N = p.cols * p.rows;
    const ws = p.words.map((w) => w.word);
    recent[mode] = mode === 'easy' ? recent[mode].concat(ws).slice(-5) : ws;
    save.last = mode;
    persist();
    run = {
      mode, M: L.MODES[mode], p, lay: R.layout(mode, p), phase: 'play', pt: 0,
      found: p.words.map(() => false), foundAt: p.words.map(() => -1), nFound: 0,
      cellFound: new Uint8Array(N), hop: new Float32Array(N), hops: [],
      idle: 0, hint: null, hints: 0, fades: [], timers: [], stars: 0, results: false, win: null,
    };
    R.newPuzzle();
    screen = 'play'; drag = null; show(null);
    R.clearParticles();
    A.startMusic(mode); A.intro();
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }

  // ---- a finger's line ----
  function gridPoint(cx, cy) { const w = R.toWorld(cx, cy), lay = run.lay; return { x: (w.x - lay.gx) / lay.c, y: (w.y - lay.gy) / lay.c }; }
  canvas.addEventListener('pointerdown', (e) => {
    A.init();
    if (screen !== 'play' || !run || run.phase !== 'play' || drag) return;
    const a = gridPoint(e.clientX, e.clientY), sel = L.select(run.p, a, a, -1, run.found, run.M.tol);
    if (!sel) return;
    drag = { id: e.pointerId, a, dir: -1, sel, n: 1, magnet: -1 };
    A.grow(1);
  });
  function dragTo(cx, cy) {
    const sel = L.select(run.p, drag.a, gridPoint(cx, cy), drag.dir, run.found, run.M.tol);
    if (!sel) return;
    drag.dir = sel.dir; drag.sel = sel;
    if (sel.cells.length !== drag.n) { drag.n = sel.cells.length; A.grow(drag.n); }
    if (sel.magnet !== drag.magnet) { drag.magnet = sel.magnet; if (sel.magnet >= 0) A.snap(); }
  }
  window.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id && run) dragTo(e.clientX, e.clientY); });
  function lift(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.type === 'pointerup' && run) dragTo(e.clientX, e.clientY);
    const d = drag;
    drag = null;
    if (!run || run.phase !== 'play') return;
    if (e.type === 'pointercancel') { fade(d.sel.cells, false); return; }
    release(d.sel);
  }
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  // the finger lifts: a word under the line is found; otherwise the line just fades (no penalty, ever)
  function release(sel) {
    const i = L.judge(run.p, sel, run.found);
    if (i >= 0) foundWord(i);
    else fade(sel.cells, sel.cells.length > 1);
    return i;
  }
  function fade(cells, audible) {
    if (!cells || !cells.length) return;
    run.fades.push({ cells: cells.map((c) => c.slice()), t: 0 });
    if (audible) {
      A.miss();
      const m = cells[Math.floor(cells.length / 2)];
      R.burst('miss', R.cellX(run.lay, m[0]), R.cellY(run.lay, m[1]), run.lay.c / 60);
    }
  }
  function foundWord(i) {
    const r = run, w = r.p.words[i], lay = r.lay, W = r.p.cols;
    r.found[i] = true; r.foundAt[i] = r.pt; r.nFound++;
    r.idle = 0; r.hint = null;
    for (const [x, y] of w.cells) r.cellFound[y * W + x] = 1;
    r.hops.push({ cells: w.cells.map(([x, y]) => y * W + x), t: 0 });
    save.words++;
    A.found(r.nFound, w.len);
    w.cells.forEach(([x, y], k) => later(k * 0.055, () => R.burst('found', R.cellX(lay, x), R.cellY(lay, y), lay.c / 70)));
    later(0.3, () => {
      const cd = run.lay.cards[i];
      A.tick(); R.burst('tick', cd.pic.x + cd.pic.s * 0.36, cd.pic.y - cd.pic.s * 0.34, clamp(cd.pic.s / 90, 0.6, 1.6));
    });
    if (r.nFound === r.p.words.length) { r.phase = 'won'; later(WIN_AFTER, startWin); }
  }
  // No progress for a while: the first unfound word (top of the list) shows its first letter, glowing.
  function showHint() {
    const r = run, i = r.found.indexOf(false);
    if (i < 0) return;
    r.hint = { i, t0: r.pt }; r.hints++;
    A.hint();
  }

  // ---- every word found: the treasure chest rises out of the sand and bursts with coins ----
  function startWin() {
    const r = run;
    if (!r || r.phase !== 'won') return;
    r.phase = 'win'; r.win = { t: 0 };
    r.stars = r.mode === 'hard' ? L.starsFor(r.hints) : 0;
    save.solved[r.mode]++;
    if (r.mode === 'hard') save.stars += r.stars;
    persist();
    const C = r.lay.chest, P = r.lay.party, big = r.mode === 'hard';
    A.cheer();
    later(0.25, () => { R.burst('puff', C.x, C.y - 4, C.sc); A.puff(); });
    later(1.0, () => { A.fanfare(big); R.fountain(C.x, C.y - 45 * C.sc, big ? 60 : 42, 528); R.burst('confetti'); });
    later(1.5, () => { R.fountain(C.x, C.y - 45 * C.sc, big ? 34 : 22, 528); R.burst('cheer', P.x, P.y - 60); });
    later(2.0, () => { R.fountain(C.x, C.y - 45 * C.sc, big ? 34 : 20, 528); R.burst('notes', P.x, P.y - 70); });
    later(RESULTS_AT, showResults);
  }
  function placeCard() {
    if (!run) return;
    const lay = run.lay, c = R.toCss(lay.bx + lay.bw / 2, lay.by + lay.bh / 2);
    $('resCard').style.left = c.x + 'px';
  }
  function showResults() {
    const r = run;
    if (!r) return;
    r.results = true; screen = 'results';
    const pics = $('resPics'), stars = $('bigStars');
    pics.innerHTML = ''; stars.innerHTML = '';
    pics.className = 'pics' + (r.mode === 'easy' ? ' big' : '');
    const hard = r.mode === 'hard';
    pics.style.display = hard ? 'none' : '';
    stars.style.display = hard ? '' : 'none';
    if (hard) stars.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    else {
      for (const w of r.p.words) {
        const box = document.createElement('div'), cv = document.createElement('canvas'), lab = document.createElement('div');
        box.className = 'pic'; lab.className = 'word'; lab.textContent = w.word;
        box.appendChild(cv); box.appendChild(lab); pics.appendChild(box);
      }
    }
    $('resCount').textContent = save.solved[r.mode];
    placeCard();
    show('results');
    [...pics.querySelectorAll('canvas')].forEach((cv, i) => R.paintPicture(cv, r.p.words[i].word, true));
    const items = hard ? [...stars.children] : [...pics.children];
    items.forEach((el, i) => later(0.2 + i * 0.32, () => { el.classList.add('pop'); if (!hard || i < r.stars) A.star(Math.min(i, 2)); }));
  }

  // ---- the clock ----
  function update(dt) {
    const r = run;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; tm.t -= dt; if (tm.t <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    if (r.phase === 'play') {
      if (!drag) r.idle += dt;
      if (!r.hint && !drag && r.idle >= r.M.hintAfter) showHint();
    }
    for (let i = r.fades.length - 1; i >= 0; i--) { r.fades[i].t += dt; if (r.fades[i].t >= FADE) r.fades.splice(i, 1); }
    // the letters of a word just found hop, one after another
    r.hop.fill(0);
    for (let i = r.hops.length - 1; i >= 0; i--) {
      const h = r.hops[i];
      h.t += dt;
      let alive = false;
      h.cells.forEach((k, j) => { const u = (h.t - j * 0.055) / 0.32; if (u > 0 && u < 1) r.hop[k] = Math.max(r.hop[k], u); if (u < 1) alive = true; });
      if (!alive) r.hops.splice(i, 1);
    }
    if (r.win) r.win.t += dt;
    if (r.results && Math.random() < dt * 0.8) R.burst('cheer', r.lay.party.x + (Math.random() - 0.5) * 60, r.lay.party.y - 70);
  }

  // ---- what to draw this frame ----
  const noSel = new Set();
  function buildView() {
    const r = run, lay = r.lay;
    let win = null;
    if (r.win) {
      const t = r.win.t, P = lay.party;
      const rise = backOut(clamp((t - 0.15) / 0.7, 0, 1)), open = smooth(clamp((t - 0.95) / 0.45, 0, 1));
      // Isabella swims in from the right, then twirls beside the chest
      const u = smooth(clamp((t - 0.3) / 1.1, 0, 1)), here = u >= 1;
      const isa = { x: lerp(R.VW + 140, P.x, u), y: P.y + Math.sin(clock * 2.2) * 8 - Math.sin(u * Math.PI) * 30, sc: P.sc, flip: !here, tilt: 0, glow: here };
      if (here) { const tw = smooth(clamp((t - 1.5) / 0.8, 0, 1)); isa.tilt = Math.sin(clock * 5) * 0.12 - tw * Math.PI * 2; isa.y -= Math.abs(Math.sin(clock * 4)) * 10; }
      win = { t, rise, open, isa };
    }
    let sel = null, selCells = noSel;
    if (drag) { sel = drag.sel; selCells = new Set(sel.cells.map(([x, y]) => y * r.p.cols + x)); }
    return {
      mode: r.mode, p: r.p, lay, found: r.found, foundAge: r.foundAt.map((t) => (t < 0 ? -1 : r.pt - t)),
      sel, selCells, fades: r.fades, cellFound: r.cellFound, hop: r.hop,
      hint: r.hint ? { i: r.hint.i, cell: r.p.words[r.hint.i].cells[0] } : null,
      intro: clamp(r.pt / INTRO, 0, 1), panelAlpha: r.win ? 1 - smooth(clamp(r.win.t / 0.55, 0, 1)) : 1, win, crown,
    };
  }

  // ---- buttons ----
  const tapBtn = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
  for (const m of L.MODE_IDS) tapBtn('mode-' + m, () => startPuzzle(m));
  tapBtn('resNext', () => startPuzzle(run ? run.mode : save.last));
  tapBtn('resModes', goModes);
  tapBtn('modesBtn', goModes);
  tapBtn('soundBtn', () => { const m = !readMuted(); writeMuted(m); A.setMuted(m); setSoundIcon(); });
  $('homeBtn').addEventListener('click', () => { A.init(); A.click(); location.href = HUB; });

  // Android back button (called from MainActivity): back to the hub.
  window.__back = () => { location.href = '../../index.html'; return true; };
  window.__pause = () => { A.suspend(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) A.suspend();
    else { A.setMuted(readMuted()); A.resume(); }
  });
  window.addEventListener('pageshow', () => { A.setMuted(readMuted()); crown = crownEarned(); if (screen === 'modes') setSoundIcon(); });
  window.addEventListener('resize', () => {
    R.resize();
    if (run) { run.lay = R.layout(run.mode, run.p); R.newPuzzle(); if (screen === 'results') placeCard(); }
  });

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

  // ---- hooks for tests (test/games/words/) ----
  const centre = (c) => ({ x: c[0] + 0.5, y: c[1] + 0.5 });
  window.__wordsDebug = {
    get state() {
      const r = run;
      return {
        screen, mode: r ? r.mode : null, seed: r ? r.p.seed : null, phase: r ? r.phase : null,
        cols: r ? r.p.cols : null, rows: r ? r.p.rows : null, grid: r ? r.p.grid.slice() : null,
        words: r ? r.p.words.map((w, i) => ({ word: w.word, cells: w.cells.map((c) => c.slice()), dir: w.dirName, found: r.found[i] })) : [],
        found: r ? r.p.words.filter((w, i) => r.found[i]).map((w) => w.word) : [],
        hint: r && r.hint ? { word: r.p.words[r.hint.i].word, cell: r.p.words[r.hint.i].cells[0].slice() } : null,
        hints: r ? r.hints : 0, stars: r ? r.stars : 0, resultsStars: r && r.results ? r.stars : null,
        selecting: !!drag, selection: drag ? { cells: drag.sel.cells.map((c) => c.slice()), magnet: drag.sel.magnet >= 0 ? r.p.words[drag.sel.magnet].word : null } : null,
        fading: r ? r.fades.length : 0, idle: r ? +r.idle.toFixed(2) : 0,
        save: JSON.parse(JSON.stringify(save)), muted: A.muted, gain: A.gain, dpr: R.dpr, vw: R.VW, crown,
        particles: R.particles, caches: R.cacheSizes(),
        cell: r ? (() => { const a = R.toCss(r.lay.gx, r.lay.gy), b = R.toCss(r.lay.gx + r.lay.c, r.lay.gy + r.lay.c); return { px: +(b.x - a.x).toFixed(2), vh: +(((b.y - a.y) / innerHeight) * 100).toFixed(2) }; })() : null,
        // the board and the picture panel, in CSS px
        layout: r ? (() => {
          const q = r.lay, rect = (x, y, w, h) => { const a = R.toCss(x, y), b = R.toCss(x + w, y + h); return { left: a.x, top: a.y, right: b.x, bottom: b.y }; };
          return { board: rect(q.bx, q.by, q.bw, q.bh), panel: rect(q.panel.x, q.panel.y, q.panel.w, q.panel.h) };
        })() : null,
      };
    },
    // a puzzle of this size; with a seed, exactly that puzzle (as logic.generate makes it)
    start(mode, seed) { startPuzzle(mode, seed == null ? undefined : seed); return run.p.seed; },
    // find a word through the same check a real drag makes: a line from its first letter to its last, then the lift
    find(word) {
      const r = run;
      if (!r || screen !== 'play' || r.phase !== 'play') return false;
      const i = r.p.words.findIndex((w) => w.word === word);
      if (i < 0) return false;
      const w = r.p.words[i], sel = L.select(r.p, centre(w.cells[0]), centre(w.cells[w.len - 1]), -1, r.found, r.M.tol);
      return release(sel) === i;
    },
    cellCss(x, y) { const r = run; return r ? R.toCss(R.cellX(r.lay, x), R.cellY(r.lay, y)) : null; },
    idle(seconds) { if (run) run.idle += seconds; },
    reset() { save = freshSave(); persist(); goModes(); },
    pictures: () => R.pictureCheck(),
    generate: (mode, seed) => L.generate(mode, seed),
    perf() {
      const sorted = perf.draws.slice().sort((a, b) => a - b), dts = perf.dts.slice().sort((a, b) => a - b);
      const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
      return { frames: perf.frames, fps: perf.frames / (perf.dtSum || 1), drawAvgMs: perf.drawSum / (perf.frames || 1), drawP95Ms: q(sorted, 0.95), drawMaxMs: perf.drawMax, frameP95Ms: q(dts, 0.95) * 1000 };
    },
    resetPerf() { Object.assign(perf, { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] }); },
  };

  // ?mode=hard&seed=42 jumps straight into a puzzle (handy for screenshots)
  const q = new URLSearchParams(location.search), qMode = q.get('mode');
  goModes();
  if (L.MODES[qMode]) startPuzzle(qMode, q.has('seed') ? +q.get('seed') : undefined);
  requestAnimationFrame(frame);
})();
