/* Firefly Numbers: screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js (through
 * FairyArt), sound in sound.js.
 * A moonlit glade. Fireflies drift about; Isabella the Fairy holds a glass jar whose label shows a number as a numeral
 * AND as that many dots. A tap sends a firefly into the jar (a chime, a dot lights, the big numeral counts up). When the
 * jar holds its number it glows, the cork drops in, a flower beside it blooms, a gold coin flies to the coin row and a
 * fresh jar arrives. One tap too many is a hiccup, never a failure. When a level's jars are all full the treasure chest
 * rises and bursts. Take-aways start with a full jar: tap the jar to let fireflies out until the label's number remains.
 * No timers shown, no reading needed. */
(function () {
  'use strict';
  const A = FireflyArt, S = FireflySound, L = FireflyLogic, F = FairyArt;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, MODES = L.MODES, SAVE_KEY = 'game.fireflies.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const FULL_T = 1.75;       // seconds from "the jar is full" to the next jar: anything tapped before that is an overfill
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const easeOutBack = (u) => { u = clamp(u, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

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
  // sound follows the main game's setting; this game only ever READS it
  function readMuted() { try { return !!JSON.parse(store.get('isabella.save') || '{}').muted; } catch (e) { return false; } }
  const save = L.migrate(store.get(SAVE_KEY));

  // ---- state ----
  const canvas = $('c');
  A.init(canvas);
  let muted = readMuted();
  S.setMuted(muted);
  let screen = 'menu';       // menu | play | results
  let run = null, page = 0, clock = 0, last = 0, timeScale = 1;
  const counters = { downs: 0, taps: 0, catches: 0, overfills: 0, shakes: 0, jarTaps: 0, releases: 0, caps: 0, chests: 0, coinsLanded: 0, hints: 0, persists: 0, levelsStarted: 0, levelsWon: 0, misses: 0, maxPointers: 0 };

  function persist() {
    store.set(SAVE_KEY, JSON.stringify(save));
    counters.persists++;
  }

  // ---- the menu ----
  function show(id) { for (const n of ['menu', 'results']) $(n).classList.toggle('on', n === id); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(0,40,80,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  const starsOf = (mode, n) => (save.stars[mode] && save.stars[mode][n - 1]) | 0;
  function buildMenu() {
    const mode = save.mode;
    for (const m of MODES) $('mode-' + m).classList.toggle('on', m === mode);
    const grid = $('grid'); grid.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const n = page * 10 + i + 1, th = F.THEMES[L.THEME_OF[n - 1]], locked = n > save.unlocked[mode];
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === save.unlocked[mode] && !starsOf(mode, n) ? ' next' : '');
      b.dataset.level = n;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.6), ${th.top} 45%, ${th.mid})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((k) => starSvg(k < starsOf(mode, n))).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        S.init();
        if (locked) { S.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        S.click(); startLevel(mode, n);
      });
      grid.appendChild(b);
    }
    $('prev').classList.toggle('off', page === 0);
    $('next').classList.toggle('off', page === 1);
    [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === page));
    let stars = 0; for (const m of MODES) stars += (save.stars[m] || []).reduce((a, b) => a + b, 0);
    $('coinCount').textContent = String(save.coins);
  }
  function goMenu(toPage) {
    if (toPage != null) page = toPage;
    run = null; screen = 'menu';
    persist();
    buildMenu(); show('menu');
    S.setKey(-3); S.startMusic(page, -3);
    menuSwarm = null;
  }
  for (const m of MODES) $('mode-' + m).addEventListener('click', () => { S.init(); S.click(); save.mode = m; persist(); buildMenu(); });
  $('prev').addEventListener('click', () => { S.init(); S.page(); page = 0; buildMenu(); });
  $('next').addEventListener('click', () => { S.init(); S.page(); page = 1; buildMenu(); });

  // ---- a level ----
  function newSwarm(plan) {
    const f = L.fit(A.VW, plan);
    return new L.Swarm({ rng: L.mulberry32((Math.random() * 4294967296) >>> 0), field: A.lay.field, count: f.count, sep: f.sep, speed: plan.speed });
  }
  function startLevel(mode, n, round) {
    n = clamp(Math.floor(n) || 1, 1, NLEV);
    if (!MODES.includes(mode)) mode = 'easy';
    const rules = new L.Run(mode, n);
    if (round > 0) rules.goto(round);
    const plan = rules.plan;
    save.mode = mode;
    run = {
      mode, n, plan, rules, swarm: newSwarm(plan), theme: plan.theme,
      phase: 'play', t: 0, shown: rules.inJar, flights: [], parts: [], pops: {}, garden: [], flowerKind: rules.capped,
      bloom: 0, full: 0, cork: null, hic: 0, wob: 0, numPop: 1, slide: 1, jarScale: 1, jarAnim: null, flowerMove: -1,
      cel: null, coinFly: null, coinsHud: rules.capped, idle: 0, hint: null, everTapped: false, firstTime: !starsOf(mode, n),
      win: null, stars: 0, happy: 0, hopT: 0,
    };
    for (let i = 0; i < rules.capped; i++) run.garden.push(i);
    screen = 'play'; show(null);
    S.setKey(plan.world === 1 ? -3 : 2); S.startMusic(plan.world === 1 ? 3 : 5, plan.world === 1 ? -3 : 2);
    counters.levelsStarted++;
    persist();
  }

  // ---- one tap ----
  function jarHit(x, y) { const J = A.lay.jar; return Math.hypot(x - J.x, y - (J.y + 6)) <= J.r + 26; }
  function tapAt(x, y) {
    const r = run;
    if (screen !== 'play' || !r || r.phase !== 'play') return { type: 'ignored' };
    counters.taps++;
    r.idle = 0; r.hint = null; r.everTapped = true;
    const rules = r.rules;
    if (rules.takeAway && jarHit(x, y)) return tapJar();
    const fly = r.swarm.pick(x, y);
    if (fly) return tapFly(fly);
    if (jarHit(x, y)) return tapJar();
    counters.misses++;
    return { type: 'miss' };
  }
  function tapFly(fly) {
    const r = run, res = r.rules.catchFly();
    if (res.type === 'catch') {
      counters.catches++; save.caught++;
      r.swarm.remove(fly);
      const m = A.mouth(), d = Math.hypot(fly.x - m.x, fly.y - m.y);
      r.flights.push({ type: 'in', t: 0, dur: clamp(d / 560, 0.35, 0.8), x0: fly.x, y0: fly.y, cx: (fly.x + m.x) / 2, cy: Math.min(fly.y, m.y) - 80, seed: fly.seed });
      S.fly(res.n);
      if (res.full) r.sealed = true;   // the celebration begins when the last one lands
    } else if (res.type === 'overfill') {
      counters.overfills++; save.overfills++; persist();
      fly.busy = true;
      r.flights.push({ type: 'over', t: 0, fly, x0: fly.x, y0: fly.y, hiccupped: false });
      S.fly(r.rules.target);
    } else if (res.type === 'shake') {
      counters.shakes++; fly.shake = 0.5; S.boop();
    }
    return res;
  }
  function tapJar() {
    const r = run, res = r.rules.tapJar(), m = A.mouth();
    if (res.type === 'release') {
      counters.releases++;
      r.shown = r.rules.inJar;
      r.numPop = 0;
      r.flights.push({ type: 'out', t: 0, dur: 1.5, x0: m.x, y0: m.y, tx: A.lay.field.x0 + 120 + Math.random() * 260, ty: 50 + Math.random() * 120, seed: Math.random() * 9 });
      S.release(res.n);
      if (res.full) startCel();
    } else if (res.type === 'overfill') {
      counters.overfills++; save.overfills++; persist();
      r.flights.push({ type: 'overjar', t: 0, x0: m.x, y0: m.y, hiccupped: false });
    } else if (res.type === 'jar') {
      counters.jarTaps++; r.wob = 1; S.boop();
    }
    return res;
  }

  // ---- the celebration: glow, cork, flower, coin, then the next jar ----
  function startCel() {
    const r = run;
    if (r.cel) return;
    r.cel = { t: 0, lid: false, bloomed: false, coinOut: false, advanced: false };
    counters.caps++; save.coins++; save.jars++; persist();
    S.capped();
  }
  function burst(x, y, n, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      const an = Math.random() * TAU, sp = (o.speed || 120) * (0.4 + Math.random() * 0.8);
      run.parts.push({ kind: 'spark', x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: 60, t: 0, life: 0.7 + Math.random() * 0.6, r: 5 + Math.random() * 6, rot: Math.random() * 3, ph: Math.random() * 6,
        col: (o.cols || ['#fff6b0', '#ffe94a', '#ffffff', '#ffd1ea', '#b8f0ff'])[(Math.random() * 5) | 0] });
    }
    if (run.parts.length > 400) run.parts.splice(0, run.parts.length - 400);
  }
  function stepCel(dt) {
    const r = run, c = r.cel;
    c.t += dt;
    if (!r.jarAnim) r.full = smooth(c.t / 0.35);
    if (c.t >= 0.4 && !r.jarAnim) r.cork = clamp((c.t - 0.4) / 0.4, 0, 1);
    if (!c.lid && c.t >= 0.8) { c.lid = true; S.lid(); const m = A.mouth(); burst(m.x, m.y + 20, 16, { speed: 150, up: 30 }); r.happy = 2.4; }
    if (!c.bloomed && c.t >= 0.55) { c.bloomed = true; S.bloom(); }
    r.bloom = smooth((c.t - 0.5) / 0.9);
    if (!c.coinOut && c.t >= 0.95) { c.coinOut = true; r.coinFly = { t: 0, dur: 0.8, i: r.coinsHud }; }
    if (!c.advanced && c.t >= FULL_T) {
      c.advanced = true;
      const old = { count: r.rules.round.target };
      const res = r.rules.advance();
      r.cel = null;
      r.flowerMove = 0;
      if (res.type === 'jar') {
        r.jarAnim = { t: 0, old, step: 0 };
        r.shown = r.rules.inJar; r.numPop = 1;
        r.pops = {};
        r.sealed = false;
      } else if (res.type === 'level') {
        wonLevel(res);
      }
    }
  }
  function stepJarAnim(dt) {
    const a = run.jarAnim; if (!a) return;
    a.t += dt;
    if (a.t < 0.3) { run.jarScale = 1 - smooth(a.t / 0.3); run.slide = 1 - smooth(a.t / 0.3); }
    else {
      if (a.step === 0) { a.step = 1; run.full = 0; run.cork = null; run.bloom = 0; }
      run.jarScale = clamp(easeOutBack((a.t - 0.3) / 0.45), 0, 1.1); run.slide = smooth((a.t - 0.3) / 0.45);
      if (a.t >= 0.75) { run.jarScale = 1; run.slide = 1; run.jarAnim = null; }
    }
  }
  function stepFlower(dt) {
    const r = run;
    if (r.flowerMove < 0) return;
    r.flowerMove += dt / 0.5;
    if (r.flowerMove >= 1) { r.garden.push(r.flowerKind); r.flowerKind++; r.flowerMove = -1; if (!r.cel) r.bloom = 0; }
  }
  function stepCoinFly(dt) {
    const r = run, c = r.coinFly; if (!c) return;
    c.t += dt;
    if (c.t >= c.dur) { r.coinFly = null; r.coinsHud++; counters.coinsLanded++; S.coin(); const p = A.coinRowPos(r.plan.jars, c.i); burst(p.x, p.y, 8, { speed: 80 }); }
  }
  function coinFlyPos(c) {
    const m = A.mouth(), p = A.coinRowPos(run.plan.jars, c.i), u = smooth(c.t / c.dur);
    return { x: m.x + (p.x - m.x) * u, y: m.y + (p.y - m.y) * u - Math.sin(Math.PI * u) * 70, r: 10 + 4 * Math.sin(Math.PI * u) };
  }

  // ---- the end of a level: stars saved, the chest rises and bursts, then the results card ----
  function wonLevel(res) {
    const r = run;
    r.phase = 'win'; r.win = { t: 0, burst: false, card: false };
    r.stars = res.stars;
    const m = r.mode, n = r.n;
    while (save.stars[m].length < n) save.stars[m].push(0);
    save.stars[m][n - 1] = Math.max(save.stars[m][n - 1] | 0, res.stars);
    save.unlocked[m] = Math.min(NLEV, Math.max(save.unlocked[m], n + 1));
    counters.levelsWon++;
    persist();
    S.rainbow();
  }
  const CHEST = () => ({ x: Math.round((A.lay.field.x0 + A.lay.field.x1) / 2), y: 468 });
  function stepWin(dt) {
    const w = run.win;
    w.t += dt;
    if (!w.burst && w.t >= 1.5) {
      w.burst = true; counters.chests++;
      save.coins += L.CHEST_COINS; save.chests++; persist();
      S.chest();
      const c = CHEST();
      for (let i = 0; i < 16; i++) {
        const an = -Math.PI / 2 + (Math.random() - 0.5) * 1.8, sp = 220 + Math.random() * 220;
        run.parts.push({ kind: 'coin', x: c.x + (Math.random() - 0.5) * 60, y: c.y - 60, vx: Math.cos(an) * sp * 0.6, vy: Math.sin(an) * sp, g: 520, t: 0, life: 2.4, r: 11 + Math.random() * 4, ph: Math.random() * 6 });
      }
      burst(c.x, c.y - 70, 34, { speed: 260, up: 60 });
      run.happy = 3;
    }
    if (!w.card && w.t >= 3.6) { w.card = true; showResults(); }
  }
  function showResults() {
    const r = run;
    screen = 'results'; r.phase = 'results';
    const bs = $('bigStars'); bs.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      bs.insertAdjacentHTML('beforeend', starSvg(i < r.stars));
      const el = bs.lastElementChild;
      setTimeout(() => { el.classList.add('pop'); if (i < r.stars) S.star(i); }, 250 + i * 330);
    }
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    show('results');
  }
  $('resLevels').addEventListener('click', () => { S.init(); S.click(); goMenu(run ? Math.floor((run.n - 1) / 10) : 0); });
  $('resReplay').addEventListener('click', () => { S.init(); S.click(); if (run) startLevel(run.mode, run.n); });
  $('resNext').addEventListener('click', () => { S.init(); S.click(); if (run) startLevel(run.mode, Math.min(NLEV, run.n + 1)); });

  // ---- touch ----
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  const down = new Set();
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    down.add(e.pointerId); counters.maxPointers = Math.max(counters.maxPointers, down.size);
    if (screen !== 'play' || !run || upright()) return;
    counters.downs++;
    const p = A.toWorld(e.clientX, e.clientY);
    tapAt(p.x, p.y);
  });
  const lift = (e) => down.delete(e.pointerId);
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  $('home').addEventListener('click', () => { S.init(); persist(); location.href = HUB; });
  window.__back = () => { persist(); location.href = HUB; return true; };
  window.__pause = () => { S.suspend(); persist(); };
  // grown-ups: hold the title for 4 seconds to open every level in every mode (a test shortcut)
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { for (const m of MODES) save.unlocked[m] = NLEV; persist(); S.init(); S.rainbow(); buildMenu(); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.suspend(); persist(); return; }
    const m = readMuted();
    if (m !== muted) { muted = m; S.setMuted(m); }
    S.resume(); last = 0;
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('resize', () => {
    A.resize();
    if (run) { run.swarm.field = A.lay.field; run.swarm.settle(); }
    if (menuSwarm) { menuSwarm.field = menuField(); menuSwarm.settle(); }
  });

  // ---- the hint hand ----
  function hintTarget() {
    const r = run;
    if (r.rules.takeAway) return 'jar';
    const m = A.mouth();
    let best = null, bd = 1e9;
    for (const f of r.swarm.flies) { if (f.busy || f.age < 0.7) continue; const d = Math.hypot(f.x - m.x, f.y - m.y); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  function stepHint(dt) {
    const r = run;
    if (r.rules.phase !== 'fill' || r.cel || r.jarAnim || r.flights.some((f) => f.type === 'over' || f.type === 'overjar')) { r.idle = 0; r.hint = null; return; }
    r.idle += dt;
    const first = r.firstTime && !r.everTapped && r.t > 0.9;
    if (!r.hint && (first || r.idle >= r.plan.hint)) { const tg = hintTarget(); if (tg) { r.hint = { t: 0, tg }; counters.hints++; } }
    if (r.hint) {
      r.hint.t += dt;
      const tg = r.hint.tg;
      if (tg !== 'jar' && (r.swarm.flies.indexOf(tg) < 0 || tg.busy)) { const n2 = hintTarget(); if (n2) r.hint.tg = n2; else r.hint = null; }
    }
  }

  // ---- flights, particles, small timers ----
  function flightPos(f) {
    const m = A.mouth();
    if (f.type === 'in') {
      const u = smooth(f.t / f.dur), v = 1 - u;
      return { x: v * v * f.x0 + 2 * v * u * f.cx + u * u * m.x, y: v * v * f.y0 + 2 * v * u * f.cy + u * u * m.y, a: 1, rot: 0, scale: 2.1 - 0.9 * u };
    }
    if (f.type === 'out') {
      const u = f.t / f.dur, e = smooth(Math.min(1, u * 1.2));
      return { x: f.x0 + (f.tx - f.x0) * e + Math.sin(f.t * 9) * 12 * u, y: f.y0 + (f.ty - f.y0) * e - Math.sin(Math.PI * Math.min(1, u * 1.4)) * 70, a: 1 - smooth((u - 0.55) / 0.45), rot: Math.sin(f.t * 11) * 0.3, scale: 1.4 + 0.7 * e };
    }
    if (f.type === 'over') {
      if (f.t < 0.4) { const u = smooth(f.t / 0.4); return { x: f.x0 + (m.x - f.x0) * u, y: f.y0 + (m.y - f.y0) * u - Math.sin(Math.PI * u) * 40, a: 1, rot: 0, scale: 2.1 - 0.6 * u }; }
      if (f.t < 0.85) return { x: m.x + Math.sin(f.t * 40) * 3, y: m.y, a: 1, rot: 0, scale: 1.5 };
      const u = smooth((f.t - 0.85) / 0.8), tx = f.fly.x, ty = f.fly.y;
      return { x: m.x + (tx - m.x) * u + Math.sin(u * 22) * 20 * (1 - u), y: m.y + (ty - m.y) * u - Math.sin(Math.PI * u) * 55 + Math.cos(u * 18) * 14 * (1 - u), a: 1, rot: Math.sin(u * 26) * 0.5 * (1 - u), scale: 1.5 + 0.6 * u };
    }
    // overjar: leaves the mouth, loops, and drops back in
    const u = f.t / 1.4;
    return { x: m.x + Math.sin(u * TAU) * 70, y: m.y - Math.sin(Math.PI * u) * 90, a: 1, rot: Math.sin(u * 30) * 0.45, scale: 1.7 };
  }
  function stepFlights(dt) {
    const r = run;
    for (let i = r.flights.length - 1; i >= 0; i--) {
      const f = r.flights[i];
      f.t += dt;
      if (f.type === 'in' && f.t >= f.dur) {
        r.flights.splice(i, 1);
        r.shown++; r.numPop = 0; r.pops[r.shown - 1] = 0;
        S.count(r.shown);
        const m = A.mouth(); burst(m.x, m.y + 30, 6, { speed: 70 });
        if (r.sealed && r.shown >= r.rules.target && !r.cel && r.rules.phase === 'full') startCel();
      } else if (f.type === 'out' && f.t >= f.dur) r.flights.splice(i, 1);
      else if (f.type === 'over') {
        if (!f.hiccupped && f.t >= 0.4) { f.hiccupped = true; r.hic = 1; S.hiccup(); }
        if (f.t >= 0.85 && !f.wob) { f.wob = true; S.wobble(); }
        if (f.t >= 1.65) { f.fly.busy = false; r.flights.splice(i, 1); }
      } else if (f.type === 'overjar') {
        if (!f.hiccupped && f.t >= 0.05) { f.hiccupped = true; r.hic = 1; S.hiccup(); S.wobble(); }
        if (f.t >= 1.4) r.flights.splice(i, 1);
      }
    }
  }
  function stepParts(dt) {
    const ps = run ? run.parts : menuParts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.t += dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t >= p.life) ps.splice(i, 1);
    }
  }

  // ---- the decoration behind the menu: a few fireflies and Isabella flying by ----
  const menuParts = [];
  let menuSwarm = null;
  const menuField = () => ({ x0: 70, x1: A.VW - 70, y0: 150, y1: 470 });
  function stepMenu(dt) {
    if (!menuSwarm) menuSwarm = new L.Swarm({ rng: L.mulberry32(777 + page), field: menuField(), count: 9, sep: 130, speed: 22 });
    menuSwarm.step(dt);
  }

  // ---- update ----
  function update(dt) {
    const r = run;
    r.t += dt;
    r.swarm.step(dt);
    for (const f of r.swarm.flies) if (f.shake > 0) f.shake -= dt;
    stepFlights(dt); stepParts(dt);
    for (const k of Object.keys(r.pops)) if ((r.pops[k] += dt) > 1) delete r.pops[k];
    if (r.hic > 0) r.hic = Math.max(0, r.hic - dt / 0.6);
    if (r.wob > 0) r.wob = Math.max(0, r.wob - dt / 0.5);
    if (r.numPop < 1) r.numPop = Math.min(1, r.numPop + dt / 0.3);
    if (r.happy > 0) r.happy -= dt;
    if (r.phase === 'play') {
      if (r.cel) stepCel(dt);
      stepJarAnim(dt); stepFlower(dt); stepCoinFly(dt); stepHint(dt);
    } else if (r.phase === 'win') {
      stepJarAnim(dt); stepFlower(dt); stepCoinFly(dt); stepWin(dt);
    } else { stepFlower(dt); stepCoinFly(dt); stepWin(dt); }
  }

  // ---- drawing ----
  function drawMenu() {
    const th = page === 0 ? 6 : 7;
    A.drawBackdrop(th, clock);
    if (menuSwarm) for (const f of menuSwarm.flies) A.drawFly(f, clock, { ring: 0 });
    const x = ((clock * 46) % (A.VW + 500)) - 250;
    F.drawFairy(A.ctx, x, 300 + Math.sin(clock * 1.4) * 22, clock, { pose: 'fly', scale: 1.5, happy: true, dust: 1 });
  }
  function drawPlay() {
    const r = run, ctx = A.ctx, rules = r.rules, win = r.phase !== 'play';
    A.drawBackdrop(r.theme, clock);
    if (r.win) {
      const w = r.win, c = CHEST(), rise = easeOutBack((w.t - 0.3) / 0.9), open = smooth((w.t - 1.3) / 0.5);
      A.drawChest(c.x, 640 + (c.y - 640) * clamp(rise, 0, 1.08), open, clock);
    }
    A.drawHost(clock, r.happy > 0 || win, r.happy > 0 ? Math.abs(Math.sin(clock * 7)) * 6 : 0);
    // the flower beside the jar and the garden
    const mv = r.flowerMove >= 0 ? r.flowerMove : null;
    A.drawFlowers(r.bloom, r.flowerKind, r.garden, clock, mv);
    // the label and the jar
    const old = r.jarAnim && r.jarAnim.t < 0.3 ? r.jarAnim.old : null;
    const inJar = old ? old.count : r.shown;
    const round = old ? rules.rounds[Math.max(0, rules.ri - 1)] : rules.round;
    A.drawPlaque(round, inJar, clock, old ? null : r.pops, r.slide);
    A.drawJar({ count: inJar, numeral: inJar, full: old ? 1 : r.full, cork: old ? 1 : r.cork, hic: r.hic, wob: r.wob, pop: r.numPop, time: clock, scale: r.jarScale });
    A.drawCoinRow(r.plan.jars, r.coinsHud, clock, 0);
    // the fireflies of the glade
    const dim = win ? 0.35 : 1;
    for (const f of r.swarm.flies) {
      if (f.busy) continue;
      const sh = f.shake > 0 ? Math.sin(f.shake * 40) * 7 * (f.shake / 0.5) : 0;
      A.drawFly(f, clock, { alpha: dim, ring: rules.takeAway && !win ? 0.45 : 1, dx: sh });
    }
    for (const f of r.flights) {
      const p = flightPos(f);
      A.drawLoose(p.x, p.y, clock, { alpha: p.a, rot: p.rot, scale: p.scale, seed: f.seed || 0, flip: f.type === 'out' ? false : true });
    }
    if (r.coinFly) { const p = coinFlyPos(r.coinFly); A.glow(p.x, p.y, p.r * 2.4, 'rgba(255,220,90,0.8)', 0.7); A.drawCoin(p.x, p.y, clock * 7, p.r); }
    A.drawParts(r.parts, clock);
    if (r.hint && r.phase === 'play') {
      const tg = r.hint.tg, J = A.lay.jar;
      const hx = tg === 'jar' ? J.x + 10 : tg.x, hy = tg === 'jar' ? J.y + 20 : tg.y + 4;
      A.drawHand(hx, hy, clock, smooth(r.hint.t / 0.5));
    }
  }
  function draw() {
    A.begin();
    if (!run) drawMenu(); else drawPlay();
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
        if (run) update(dt); else { stepMenu(dt); stepParts(dt); }
      }
      draw();
    }
    perf[perfN++ % perf.length] = performance.now() - t0;
    requestAnimationFrame(frame);
  }

  // ---- hooks for the headless tests (test/games/fireflies) ----
  function flyInfo(f) {
    const c = A.toClient(f.x, f.y);
    return { id: f.id, x: f.x, y: f.y, cx: c.x, cy: c.y, cr: (L.ZONE * A.scale) / A.dpr, busy: !!f.busy, age: f.age, shaking: f.shake > 0 };
  }
  window.__dbg = {
    counters,
    state() {
      const r = run, J = A.lay.jar, jc = A.toClient(J.x, J.y + 6), m = A.mouth(), mc = A.toClient(m.x, m.y);
      const lm = r ? L.labelModel(r.rules.round) : null;
      return {
        screen, page, mode: save.mode, level: r ? r.n : null, runMode: r ? r.mode : null, phase: r ? r.phase : null,
        round: r ? r.rules.ri : null, rounds: r ? r.rules.rounds.length : 0, roundKind: r ? r.rules.round.k : null, roundDesc: r ? L.describe(r.rules.round) : null,
        label: lm, litDots: r ? L.dotStates(r.rules.round, r.shown).filter((d) => d.lit).length : 0, crossedDots: r ? L.dotStates(r.rules.round, r.shown).filter((d) => d.crossed && !d.lit).length : 0, target: r ? r.rules.target : null, total: r ? r.rules.round.total : null,
        inJar: r ? r.rules.inJar : null, shown: r ? r.shown : null, rulesPhase: r ? r.rules.phase : null, sealed: !!(r && r.sealed),
        capped: r ? r.rules.capped : 0, overfills: r ? r.rules.overfills : 0, stars: r ? r.rules.stars : null, done: r ? r.rules.done : false,
        cel: !!(r && r.cel), celT: r && r.cel ? r.cel.t : null, jarAnim: !!(r && r.jarAnim), bloom: r ? r.bloom : 0, cork: r ? r.cork : null, full: r ? r.full : 0, hic: r ? r.hic : 0,
        garden: r ? r.garden.length : 0, flowerMove: r ? r.flowerMove : -1, coinsHud: r ? r.coinsHud : 0, coinFly: !!(r && r.coinFly),
        flies: r ? r.swarm.flies.map(flyInfo) : [], swarmWant: r ? r.swarm.want : 0, sep: r ? r.swarm.sep : 0, minGap: r ? r.swarm.minGap() : null,
        flights: r ? r.flights.map((f) => f.type) : [], parts: r ? r.parts.length : menuParts.length, pops: r ? Object.keys(r.pops).length : 0,
        hint: r && r.hint ? (r.hint.tg === 'jar' ? 'jar' : r.hint.tg.id) : null, idle: r ? r.idle : 0, hintAfter: r ? r.plan.hint : 0,
        jar: { cx: jc.x, cy: jc.y, cr: ((J.r + 26) * A.scale) / A.dpr, mx: mc.x, my: mc.y },
        win: !!(r && r.win), winT: r && r.win ? r.win.t : null, chestBurst: !!(r && r.win && r.win.burst), resultsStars: screen === 'results' && r ? r.stars : null,
        saveMode: save.mode, unlocked: Object.assign({}, save.unlocked), savedStars: JSON.parse(JSON.stringify(save.stars)), coins: save.coins, jars: save.jars, chests: save.chests, caught: save.caught,
        VW: A.VW, scale: A.scale, dpr: A.dpr, canvas: [canvas.width, canvas.height], field: A.lay.field,
        muted, audio: S.state, gain: S.gain, caches: A.cacheSizes(), menuFlies: menuSwarm ? menuSwarm.flies.length : 0, upright: upright(),
      };
    },
    start(mode, n, round) { startLevel(mode, n, round || 0); return run.n; },
    unlock(mode, n) { save.unlocked[mode] = clamp(Math.floor(n), 1, NLEV); persist(); if (screen === 'menu') buildMenu(); return save.unlocked[mode]; },
    // the same code as a real tap (a finger arrives through the pointer events, which land in tapAt)
    tapFly(id) { const f = run && run.swarm.flies.find((q) => q.id === id); return f ? tapFly(f).type : null; },
    tapJar() { return run ? tapJar().type : null; },
    tapAt(x, y) { return tapAt(x, y).type; },
    goMenu(p) { goMenu(p); return true; },
    timeScale(k) { timeScale = k; return timeScale; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    saved() { return store.get(SAVE_KEY); },
    levels() { return MODES.map((m) => Array.from({ length: NLEV }, (_, i) => L.planOf(m, i + 1))); },
  };

  buildMenu();
  S.setKey(-3); S.startMusic(0, -3);
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?mode=hard&level=4 jumps straight into a level (handy for screenshots)
  const q = new URLSearchParams(location.search), qm = q.get('mode'), ql = +q.get('level');
  const qMode = MODES.includes(qm) ? qm : save.mode;
if (ql >= 1 && ql <= save.unlocked[qMode]) startLevel(qMode, ql, +q.get('round') || 0);
  requestAnimationFrame(frame);
})();
