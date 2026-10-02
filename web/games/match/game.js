/* Shell Match — screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js. */
(function () {
  'use strict';
  const L = MatchLogic, R = MatchArt, A = MatchSound;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.LEVELS.length, HUB = '../../index.html';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const MATCH_BEAT = 0.35;   // a matching pair: just long enough to see the second creature
  const MISS_BEAT = 1.1;     // a non-matching pair stays open this long, then closes
  const SWAP = { lift: 0.55, slide: 0.9, rest: 0.35 };

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
  const SAVE_KEY = 'game.match.save';
  const freshSave = () => ({ unlocked: 1, stars: new Array(NLEV).fill(0) });
  function loadSave() {
    const sv = freshSave();
    try {
      const raw = JSON.parse(store.get(SAVE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        Object.assign(sv, raw);
        sv.stars = Array.from({ length: NLEV }, (_, i) => clamp(Math.floor(Number((raw.stars || [])[i]) || 0), 0, 3));
        const beaten = sv.stars.reduce((m, st, i) => (st > 0 ? i + 1 : m), 0);
        sv.unlocked = clamp(Math.max(Math.floor(Number(raw.unlocked) || 1), beaten + 1), 1, NLEV);
      }
    } catch (e) { /* a broken save starts fresh */ }
    return sv;
  }
  let save = loadSave();
  const persist = () => store.set(SAVE_KEY, JSON.stringify(save));
  // Sound follows the main game's mute switch.
  function readMuted() {
    try { return !!JSON.parse(store.get('isabella.save') || '{}').muted; } catch (e) { return false; }
  }

  // ---- state ----
  let screen = 'levels';    // levels | play | results
  let run = null, clock = 0, last = 0, nextSeed = null;
  const canvas = $('c');
  R.init(canvas);
  A.setMuted(readMuted());

  function show(id) { for (const sname of ['levels', 'results']) $(sname).classList.toggle('on', sname === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }

  // ---- level select ----
  function goLevels() {
    screen = 'levels'; run = null;
    const grid = $('grid'); grid.innerHTML = '';
    for (let n = 1; n <= NLEV; n++) {
      const th = R.THEMES[L.LEVELS[n - 1].theme], locked = n > save.unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === save.unlocked && !save.stars[n - 1] ? ' next' : '');
      b.dataset.level = n;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65), ${th.top} 45%, ${th.bot})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((i) => starSvg(i < save.stars[n - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        A.init();
        if (locked) { A.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        A.click(); startLevel(n);
      });
      grid.appendChild(b);
    }
    $('starCount').textContent = `${save.stars.reduce((a, b) => a + b, 0)}/${NLEV * 3}`;
    show('levels');
    A.startMusic('menu');
  }

  // ---- a level ----
  function randomSeed() {
    try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; } catch (e) { return (Math.random() * 4294967296) >>> 0; }
  }
  function startLevel(n, seed) {
    const cfg = L.LEVELS[n - 1];
    if (seed == null) seed = nextSeed != null ? nextSeed : randomSeed();
    nextSeed = null;
    const board = new L.Board(n, seed);
    run = {
      n, cfg, seed: seed >>> 0, board, phase: 'deal', pt: 0, hid: false,
      vis: board.cards.map(() => ({ open: 0, target: 0, dance: -1e9, poke: -1e9 })), // indexed by card id; -1e9 = not dancing
      swap: null, pending: null, streak: 0, timers: [], flying: [], filled: [], pop: [],
      happyT: 0, idle: 0, tapped: false, party: false, stars: 0, results: false,
    };
    relayout();
    screen = 'play'; show(null);
    A.startMusic(n);
    for (let i = 0; i < Math.min(board.cards.length, 10); i++) A.plop(i);
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }

  // Where everything sits for this screen size: the grid from logic.js, then Isabella and the pearl tray
  // in the left column under the home button.
  function relayout() {
    if (!run) return;
    const lay = L.layout(run.board.cards.length, R.VW), W = lay.col, pairs = run.cfg.pairs;
    run.layout = lay;
    run.shellScale = (Math.min(lay.cellW, lay.cellH) / 100) * 0.94;
    const wide = lay.wide, per = Math.min(pairs, wide ? 5 : 3), r = wide ? 13 : 12, sp = 2 * r + 10;
    const rows = Math.ceil(pairs / per), bw = per * sp + 14, bh = rows * sp + 12;
    const box = { x: (W - bw) / 2 + 2, y: 526 - bh, w: bw, h: bh };
    const slots = [];
    for (let i = 0; i < pairs; i++) {
      const row = Math.floor(i / per), inRow = Math.min(per, pairs - row * per), cx = i - row * per;
      slots.push({ x: box.x + bw / 2 + (cx - (inRow - 1) / 2) * sp, y: box.y + 6 + sp / 2 + row * sp, r });
    }
    run.tray = { box, slots };
    const midY = (L.HOME + box.y) / 2;
    run.isaHome = wide ? { x: W / 2 + 16, y: midY, scale: 1.15, tilt: 0 } : { x: W / 2 + 6, y: midY, scale: 0.72, tilt: -0.55 };
    run.isaParty = { x: clamp(0.22 * R.VW, 150, 300), y: 300, scale: R.VW > 1000 ? 1.9 : 1.35 };
  }
  const cellCenter = (pos) => { const c = run.layout.cells[pos]; return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; };

  function beginPlay() { run.board.begin(); run.phase = 'play'; run.pt = 0; run.swap = null; }

  function tapAt(pos) {
    const r = run;
    if (!r || r.phase !== 'play') return;
    const b = r.board, res = b.tap(pos);
    if (res.type === 'ignored') {
      if (res.why === 'matched') { r.vis[b.cards[pos].id].poke = 0; A.poke(b.cards[pos].kind); }
      return;
    }
    r.tapped = true; r.idle = 0;
    const card = b.cards[pos];
    r.vis[card.id].target = 1; A.open(); A.creature(card.kind);
    if (res.type === 'match') {
      r.pending = { t: MATCH_BEAT };
      for (const p of [res.a, res.b]) r.vis[b.cards[p].id].dance = -0.22;
      A.match(r.streak, 0.3); r.streak++;
      r.happyT = 1.6;
      later(0.25, () => { for (const p of [res.a, res.b]) { const c = cellCenter(p); R.burst('match', c.x, c.y - 30 * r.shellScale); } });
    } else if (res.type === 'mismatch') {
      r.pending = { t: MISS_BEAT }; r.streak = 0;
    }
  }

  function settle() {
    const r = run, b = r.board, res = b.settle();
    r.pending = null;
    if (!res) return;
    if (res.type === 'closed') {
      r.vis[b.cards[res.a].id].target = 0; r.vis[b.cards[res.b].id].target = 0; A.close();
      return;
    }
    // a pair found: a pearl flies from the two shells to the tray
    const ca = cellCenter(res.a), cb = cellCenter(res.b);
    r.flying.push({ x0: (ca.x + cb.x) / 2, y0: (ca.y + cb.y) / 2 - 30, slot: b.matches - 1, t: 0, dur: 0.8 });
    if (res.type === 'win') winLevel(res.stars);
  }

  function winLevel(stars) {
    const r = run;
    r.phase = 'clear'; r.pt = 0; r.stars = stars;
    save.stars[r.n - 1] = Math.max(save.stars[r.n - 1], stars);
    save.unlocked = Math.min(NLEV, Math.max(save.unlocked, r.n + 1));
    persist();
    const P = r.isaParty, last6 = r.n === NLEV;
    later(0.5, () => { r.party = true; A.fanfare(); A.cheer(); R.fountain(P.x + 40, 470, last6 ? 70 : 40, 515); });
    later(0.95, () => { R.fountain(P.x + 40, 470, last6 ? 40 : 20, 515); R.burst('cheer', P.x, P.y - 40); });
    later(1.4, () => { R.fountain(P.x + 40, 470, last6 ? 40 : 20, 515); });
    later(2.1, showResults);
  }
  function showResults() {
    const r = run;
    r.results = true; screen = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < r.stars) A.star(i); }));
  }

  // ---- the clock: every animation runs on game time ----
  function update(dt) {
    const r = run, b = r.board, nC = b.cards.length;
    r.pt += dt;
    for (let i = r.timers.length - 1; i >= 0; i--) { const tm = r.timers[i]; tm.t -= dt; if (tm.t <= 0) { r.timers.splice(i, 1); tm.fn(); if (run !== r) return; } }
    for (const v of r.vis) {
      if (v.open < v.target) v.open = Math.min(v.target, v.open + dt / 0.24);
      else if (v.open > v.target) v.open = Math.max(v.target, v.open - dt / 0.22);
      v.dance += dt; v.poke += dt;
    }
    if (r.happyT > 0) r.happyT -= dt;
    for (let i = 0; i < r.pop.length; i++) if (r.pop[i] > 0) r.pop[i] = Math.max(0, r.pop[i] - dt * 2);
    for (let i = r.flying.length - 1; i >= 0; i--) {
      const f = r.flying[i]; f.t += dt;
      if (f.t >= f.dur) {
        r.flying.splice(i, 1);
        const sl = r.tray.slots[f.slot];
        r.filled[f.slot] = true; r.pop[f.slot] = 1; R.burst('pearl', sl.x, sl.y); A.pearl();
      }
    }

    if (r.phase === 'deal') {
      if (r.pt >= 0.45 + nC * 0.035) { r.phase = 'peek'; r.pt = 0; for (const v of r.vis) v.target = 1; A.peek(); }
    } else if (r.phase === 'peek') {
      if (!r.hid && r.pt >= 0.3 + r.cfg.peek) { r.hid = true; for (const v of r.vis) v.target = 0; A.hide(); }
      if (r.pt >= 0.3 + r.cfg.peek + 0.45) {
        r.pt = 0;
        if (b.swaps.length) r.phase = 'shuffle'; else beginPlay();
      }
    } else if (r.phase === 'shuffle') {
      // each swap: the two shells wiggle and lift, slide into each other's places, then settle
      const per = SWAP.lift + SWAP.slide + SWAP.rest, k = Math.floor(r.pt / per), u = r.pt - k * per;
      if (k >= b.swaps.length) beginPlay();
      else {
        if (!r.swap || r.swap.k !== k) { const [a, c] = b.swaps[k]; r.swap = { k, a, b: c, done: false, swished: false }; A.wiggle(); }
        const sw = r.swap;
        sw.u = u;
        if (!sw.swished && u >= SWAP.lift) { sw.swished = true; A.swish(); }
        if (!sw.done && u >= SWAP.lift + SWAP.slide) { b.swapNext(); sw.done = true; }
      }
    } else if (r.phase === 'play') {
      if (r.pending) { r.pending.t -= dt; if (r.pending.t <= 0) settle(); }
      r.idle += dt;
    }
  }

  // ---- what to draw this frame ----
  // opening pops a little past wide open and settles back; closing is smooth
  const openEase = (v) => (v.target ? 1 + 2.4 * Math.pow(v.open - 1, 3) + 1.4 * Math.pow(v.open - 1, 2) : smooth(v.open));
  function buildView() {
    const r = run, b = r.board, lay = r.layout, shells = [], sw = r.phase === 'shuffle' ? r.swap : null;
    for (let pos = 0; pos < b.cards.length; pos++) {
      const card = b.cards[pos], v = r.vis[card.id], cell = lay.cells[pos];
      let x = cell.x + cell.w / 2, y = cell.y + cell.h / 2, lift = 0, wiggle = 0, moving = false;
      if (sw && (pos === sw.a || pos === sw.b)) {
        const u = sw.u;
        lift = u < SWAP.lift ? smooth(u / SWAP.lift) : u < SWAP.lift + SWAP.slide ? 1 : 1 - smooth(clamp((u - SWAP.lift - SWAP.slide) / SWAP.rest, 0, 1));
        wiggle = u < SWAP.lift ? 1 : 0;
        if (!sw.done && u >= SWAP.lift) {
          // each shell bows out to its own side of the line between the two places, so they pass side by side
          const m = smooth(clamp((u - SWAP.lift) / SWAP.slide, 0, 1)), oc = lay.cells[pos === sw.a ? sw.b : sw.a];
          const dx = oc.x + oc.w / 2 - x, dy = oc.y + oc.h / 2 - y, len = Math.hypot(dx, dy) || 1;
          const bow = Math.sin(Math.PI * m) * Math.min(lay.cellW, lay.cellH) * 0.45, bd = lay.board;
          // ...but never off the board: a shell on the edge row slides along it instead
          x = clamp(x + dx * m + (dy / len) * bow, bd.x + lay.cellW * 0.32, bd.x + bd.w - lay.cellW * 0.32);
          y = clamp(y + dy * m - (dx / len) * bow, bd.y + lay.cellH * 0.32, bd.y + bd.h - lay.cellH * 0.32);
          moving = true;
        }
      }
      shells.push({
        x, y, scale: r.shellScale, open: openEase(v), kind: card.kind,
        dance: v.dance, poke: v.poke, matched: card.state === 'matched', selected: card.state === 'up',
        appear: r.phase === 'deal' ? clamp((r.pt - pos * 0.035) / 0.32, 0, 1) : null,
        lift, wiggle, moving, party: r.party,
      });
    }
    // Isabella: in her column, waving when a pair is found; at the end she swims out and cheers
    const H0 = r.isaHome;
    let isa = { x: H0.x, y: H0.y + Math.sin(clock * 1.6) * 6, scale: H0.scale, tilt: H0.tilt + Math.sin(clock * 1.1) * 0.05, swim: 6, happy: r.happyT > 0 };
    if (isa.happy) { isa.y -= Math.abs(Math.sin(clock * 6)) * 10; isa.swim = 11; }
    if (r.phase === 'clear') {
      const P = r.isaParty, m = smooth(clamp((r.pt - 0.3) / 0.8, 0, 1)), twirl = smooth(clamp((r.pt - 1.2) / 0.7, 0, 1));
      isa = {
        x: H0.x + (P.x - H0.x) * m, y: H0.y + (P.y - H0.y) * m - Math.abs(Math.sin(clock * 4)) * 14 * m,
        scale: H0.scale + (P.scale - H0.scale) * m, tilt: H0.tilt * (1 - m) + Math.sin(clock * 5) * 0.15 * m - twirl * Math.PI * 2,
        swim: 11, happy: true,
      };
    }
    const tray = { box: r.tray.box, slots: r.tray.slots.map((sl, i) => ({ x: sl.x, y: sl.y, r: sl.r, filled: !!r.filled[i], pop: r.pop[i] || 0 })) };
    const flying = r.flying.map((f) => {
      const sl = r.tray.slots[f.slot], u = smooth(clamp(f.t / f.dur, 0, 1));
      return { x: f.x0 + (sl.x - f.x0) * u, y: f.y0 + (sl.y - f.y0) * u - Math.sin(Math.PI * u) * 90, r: sl.r * (1.4 - 0.4 * u) };
    });
    let hand = null;
    if (r.n === 1 && r.phase === 'play' && !r.tapped && r.idle > 2.5) {
      const pos = b.cards.findIndex((c) => c.state === 'down');
      if (pos >= 0) { const c = cellCenter(pos); hand = { x: c.x, y: c.y, size: clamp(40 * r.shellScale, 56, 90) }; }
    }
    return { theme: r.cfg.theme, layout: lay, shells, isabella: isa, tray, flying, hand };
  }

  // ---- input: a tap opens the shell under the finger ----
  canvas.addEventListener('pointerdown', (e) => {
    A.init();
    if (screen !== 'play' || !run) return;
    const p = R.toWorld(e.clientX, e.clientY), i = L.cellAt(run.layout, p.x, p.y);
    if (i >= 0) tapAt(i);
  });
  const tap = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
  tap('resLevels', goLevels);
  tap('resReplay', () => startLevel(run ? run.n : 1));
  tap('resNext', () => startLevel(Math.min(NLEV, (run ? run.n : 0) + 1)));
  $('homeBtn').addEventListener('click', () => { A.init(); A.click(); location.href = HUB; });

  // Grown-ups: hold the title for 4 seconds to open every level.
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { save.unlocked = NLEV; persist(); A.init(); A.match(5); goLevels(); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));

  // Android back button (called from MainActivity): back to the hub.
  window.__back = () => { location.href = '../../index.html'; return true; };
  window.__pause = () => { A.suspend(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) A.suspend();
    else { A.setMuted(readMuted()); A.resume(); }
  });
  window.addEventListener('pageshow', () => A.setMuted(readMuted()));
  window.addEventListener('resize', () => { R.resize(); relayout(); });

  // ---- main loop ----
  const perf = { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] };
  function frame(nowMs) {
    const raw = last ? (nowMs - last) / 1000 : 0, dt = Math.min(0.05, raw);
    last = nowMs; clock += dt;
    const t0 = performance.now();
    if (!run) R.drawMenu(clock, dt, { gridW: 0.89 * 540 });
    else { update(dt); if (run) R.drawPlay(buildView(), clock, dt); }
    const d = performance.now() - t0;
    if (raw > 0) {
      perf.frames++; perf.dtSum += raw; perf.drawSum += d; perf.drawMax = Math.max(perf.drawMax, d);
      perf.dts.push(raw); perf.draws.push(d);
      if (perf.dts.length > 600) { perf.dts.shift(); perf.draws.shift(); }
    }
    requestAnimationFrame(frame);
  }

  // ---- hooks for tests (test/games/match/) ----
  const cssRect = (c) => { const p = R.toCss(c.x, c.y), q = R.toCss(c.x + c.w, c.y + c.h); return { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y }; };
  window.__matchDebug = {
    get state() {
      const r = run, lay = r && r.layout;
      return {
        screen, muted: A.muted, gain: A.gain, save: JSON.parse(JSON.stringify(save)), vw: R.VW, dpr: R.dpr,
        level: r ? r.n : null, seed: r ? r.seed : null, phase: r ? r.phase : null,
        pairs: r ? r.cfg.pairs : null, mismatches: r ? r.board.mismatches : null, matches: r ? r.board.matches : null, moves: r ? r.board.moves : null,
        locked: r ? r.phase !== 'play' || r.board.busy || !!r.pending : true,
        stars: r ? r.board.stars : null, resultsStars: r && r.results ? r.stars : null,
        swaps: r ? r.board.swaps.map((s) => s.slice()) : [],
        layout: lay ? { cols: lay.cols, rows: lay.rows, wide: lay.wide, targetVh: (lay.target / L.WORLD_H) * 100, cell: cssRect(lay.cells[0]) } : null,
        cards: r ? r.board.cards.map((c, pos) => ({ pos, id: c.id, kind: c.kind, state: c.state, rect: cssRect(lay.cells[pos]) })) : [],
      };
    },
    start(n, seed) { startLevel(n, seed); },
    set nextSeed(v) { nextSeed = v == null ? null : v >>> 0; },
    reset() { save = freshSave(); persist(); goLevels(); },
    // the grid each level would get on this screen, without playing it
    layoutFor(n) { const lay = L.layout(L.LEVELS[n - 1].pairs * 2, R.VW); return { cols: lay.cols, rows: lay.rows, wide: lay.wide, targetVh: (lay.target / L.WORLD_H) * 100, cell: cssRect(lay.cells[0]) }; },
    perf() {
      const sorted = perf.draws.slice().sort((a, b) => a - b), dts = perf.dts.slice().sort((a, b) => a - b);
      const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
      return { frames: perf.frames, fps: perf.frames / (perf.dtSum || 1), drawAvgMs: perf.drawSum / (perf.frames || 1), drawP95Ms: q(sorted, 0.95), drawMaxMs: perf.drawMax, frameP95Ms: q(dts, 0.95) * 1000 };
    },
    resetPerf() { Object.assign(perf, { frames: 0, dtSum: 0, drawSum: 0, drawMax: 0, dts: [], draws: [] }); },
  };

  // ?level=4&seed=7 jumps straight into a level (handy for screenshots)
  const q = new URLSearchParams(location.search), qLevel = +q.get('level');
  goLevels();
  if (qLevel >= 1 && qLevel <= NLEV) startLevel(qLevel, q.has('seed') ? +q.get('seed') : undefined);
  requestAnimationFrame(frame);
})();
