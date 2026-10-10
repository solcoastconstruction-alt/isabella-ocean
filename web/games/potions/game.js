/* Potion Colours: screens, touch, saving and the main loop. Rules live in logic.js, drawing in art.js, sound in sound.js.
 *
 * A grey flower stands beside a toadstool table; its thought bubble holds a big swatch of the colour it wants.
 * Bottles stand along the bottom. A finger drags one over the cauldron (or just taps it): it tips, pours, and the
 * liquid swirls. When the last bottle of the mix is in, the colours blend; if they are the flower's colour, Isabella
 * waves her wand, a drop flies to the flower and it blooms (butterflies, a coin). If not, the cauldron burps a soft
 * cloud, the flower tilts its head, the cauldron empties and the bottles come back: nothing is lost but a star.
 * A tap on the cauldron takes back the last pour (the bottle hops home) until the mix is finished.
 * After the last round the treasure chest rises and bursts. No timers shown, no words. */
(function () {
  'use strict';
  const L = PotionLogic, A = PotionArt, S = PotionSound;
  const $ = (id) => document.getElementById(id);
  const NLEV = L.NLEV, SAVE_KEY = 'game.potions.save', MAIN_KEY = 'isabella.save', HUB = '../../index.html', TAU = Math.PI * 2;
  const MOVE_T = 0.3;       // a poured bottle swings over the cauldron...
  const POUR_T = 0.62;      // ...pours for this long...
  const BACK_T = 0.34;      // ...and hops home
  const MIX_T = 1.2;        // after the last bottle is in, the colours blend this long (a tap on the cauldron can still undo it)
  const DROP_T = 0.85;      // the drop flies to the flower
  const BLOOM_T = 1.1;      // the flower opens
  const SHOW_BLOOM = DROP_T + BLOOM_T + 1.0;
  const DRAIN_AT = 1.0, SHOW_WRONG = 1.9;   // a wrong mix: the burp and the tilt, then the cauldron empties
  const GRAB_SLOP = 16;     // a finger grabs a bottle from this far outside its glass (world units)
  const BOTTLE_HIT = 62;    // radius of the bottle's touch circle: 124 units across, 23vh
  const TAP_MOVE = 14, TAP_MS = 400;   // a press that barely moves is a tap
  const POSE_ROT = 1.92;    // a bottle tips this far (110 degrees) to pour
  const USED_LEVEL = 0.28;  // what is left in a bottle once poured
  const KEYS = { easy: 0, medium: 2, hard: -3 };   // each mode has its own key for the music
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
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
  // sound follows the main game's setting (read only: this game never writes isabella.save)
  function readMuted() { try { return !!JSON.parse(store.get(MAIN_KEY) || '{}').muted; } catch (e) { return false; } }
  let save = L.migrate(store.get(SAVE_KEY));

  // ---- state ----
  const canvas = $('c');
  A.init(canvas);
  let muted = readMuted();
  S.setMuted(muted);
  let screen = 'levels';   // levels | play | results
  let mode = save.mode, page = 0;
  let run = null;          // the level being played
  let clock = 0, last = 0, timeScale = 1, homeZone = null;
  const counters = { grabs: 0, drops: 0, pours: 0, undos: 0, wrongs: 0, blooms: 0, burps: 0, chests: 0, hints: 0, nopes: 0, taps: 0,
    flowerTaps: 0, isabellaTaps: 0, cauldronTaps: 0, misses: 0, coinsEarned: 0, coinsLanded: 0, persists: 0, downs: 0, maxPointers: 0, pointerTypes: {}, levelsStarted: 0, bad: 0 };

  function persist() { store.set(SAVE_KEY, JSON.stringify(save)); counters.persists++; }

  // ---- screens ----
  function show(id) { for (const n of ['levels', 'results']) $(n).classList.toggle('on', n === id); $('gridBtn').classList.toggle('on', screen === 'play' || screen === 'results'); }
  function starSvg(on) {
    return `<svg viewBox="0 0 24 24"><use href="#i-star" fill="${on ? '#ffd23f' : 'rgba(255,255,255,0.45)'}" stroke="${on ? '#c77700' : 'rgba(60,10,90,0.35)'}" stroke-width="1.5"/></svg>`;
  }
  // the mode buttons: a wand with one, two or three sparkles
  const SPARKS = [[74, 22, 13], [90, 52, 10], [44, 14, 10]];
  const sparkle = (x, y, r, fill) => `<path d="M${x} ${y - r}L${x + r * 0.26} ${y - r * 0.26}L${x + r} ${y}L${x + r * 0.26} ${y + r * 0.26}L${x} ${y + r}L${x - r * 0.26} ${y + r * 0.26}L${x - r} ${y}L${x - r * 0.26} ${y - r * 0.26}Z" fill="${fill}"/>`;
  function modeIcon(count) {
    return `<svg viewBox="0 0 100 100"><path d="M18 86L60 44" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M18 86L60 44" stroke="#c98c4f" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M62 42l4 8 9-1-6 7 6 7-9-1-4 8-4-8-9 1 6-7-6-7 9 1z" fill="#ffd23f" transform="translate(-6 -10) scale(0.9)"/>`
      + SPARKS.slice(0, count).map((p, i) => sparkle(p[0], p[1], p[2], i === 0 ? '#fff' : '#ffe9a8')).join('') + '</svg>';
  }
  $('mode-easy').querySelector('.disc').innerHTML = modeIcon(1);
  $('mode-medium').querySelector('.disc').innerHTML = modeIcon(2);
  $('mode-hard').querySelector('.disc').innerHTML = modeIcon(3);

  function goLevels(m, p) {
    releaseAll();
    if (run) { A.clearParts(); }
    run = null;
    if (m && L.MODES.includes(m)) mode = m;
    if (save.mode !== mode) { save.mode = mode; persist(); }
    if (p != null) page = clamp(p, 0, 1);
    screen = 'levels';
    const prog = { unlocked: save.unlocked[mode], stars: save.stars[mode] };
    const grid = $('grid'); grid.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const n = page * 10 + i + 1, locked = n > prog.unlocked, th = F().THEMES[A.themeFor(n)];
      const b = document.createElement('button');
      b.className = 'lvl' + (locked ? ' locked' : '') + (n === prog.unlocked && !prog.stars[n - 1] ? ' next' : '');
      b.dataset.n = n; b.dataset.mode = mode;
      b.setAttribute('aria-label', `Level ${n}`);
      b.style.background = `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.7), ${th.top} 45%, ${th.bot})`;
      b.innerHTML = `<div class="num ol-navy">${n}</div><div class="st">${[0, 1, 2].map((k) => starSvg(k < prog.stars[n - 1])).join('')}</div><svg class="lock" viewBox="0 0 24 24"><use href="#i-lock"/></svg>`;
      b.addEventListener('click', () => {
        S.init();
        if (locked) { S.locked(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
        S.click(); startLevel(n, mode);
      });
      grid.appendChild(b);
    }
    $('coinCount').textContent = save.coins;
    for (const id of L.MODES) $('mode-' + id).classList.toggle('on', id === mode);
    $('pgPrev').classList.toggle('off', page === 0);
    $('pgNext').classList.toggle('off', page === 1);
    $('pgDots').innerHTML = [0, 1].map((i) => `<span class="${i === page ? 'on' : ''}"></span>`).join('');
    $('worldIcon').querySelector('use').setAttribute('href', page ? '#i-cloud' : '#i-flower');
    show('levels');
    S.setKey(KEYS[mode]); S.startMusic(page ? 5 : 3, KEYS[mode]);
  }
  function F() { return A.F; }

  // ---- a level ----
  function startLevel(n, m) {
    n = clamp(Math.floor(n) || 1, 1, NLEV);
    releaseAll();
    A.clearParts();
    mode = L.MODES.includes(m) ? m : mode;
    if (save.mode !== mode) { save.mode = mode; persist(); }
    page = n > 10 ? 1 : 0;
    const rules = new L.Run(n, mode);
    run = {
      n, mode, rules, cfg: rules.cfg, theme: A.themeFor(n), lay: null,
      phase: 'play', pt: 0, timers: [],
      bottles: rules.cfg.bottles.map((id, i) => ({ id, hex: L.BOTTLE_COLOUR[id], idx: i, hx: 0, hy: 0, x: 0, y: 700, rot: 0, state: 'home', t: 0, used: false, level: 1, alpha: 1,
        jig: -1, hop: -1, glow: 0, from: null, wait: 0.35 + i * 0.12, pose: null, held: null })),
      queue: [], active: null, mixT: -1,
      cauld: { surface: A.hexRgb('#17132b'), from: A.hexRgb('#17132b'), to: A.hexRgb('#17132b'), blend: 1, blendDur: 0.9, arms: [], layers: [], swirl: 0, level: 0, levelTo: 0, glow: 0, squash: 0, sqV: 0, hover: 0, bubbles: 0 },
      show: null, fl: [], leaving: [], drop: null, butterflies: [], coinsFly: [], hud: 0, hudPulse: 0, doneCols: [],
      isa: { wave: 0, twirl: 0 }, idle: 0, hint: null, everPoured: false,
      chest: null, results: false, stars: 0, chestCoins: 0,
    };
    layout();
    newRoundFlowers();
    screen = 'play'; show(null);
    S.setKey(KEYS[mode]); S.startMusic(n, KEYS[mode]);
    counters.levelsStarted++;
  }
  function later(t, fn) { if (run) run.timers.push({ t, fn }); }

  function layout() {
    if (!run) return;
    const lay = run.lay = A.layout(A.VW, run.bottles.length);
    run.bottles.forEach((b, i) => {
      b.hx = lay.bottles[i].x; b.hy = lay.bottles[i].y;
      if (b.state === 'home' && b.wait <= 0) { b.x = b.hx; b.y = b.hy; } else if (b.state === 'home') { b.x = b.hx; b.y = 700; }
    });
  }
  function flowerPos(i) { const f = run.lay.flowers[Math.min(i, run.lay.flowers.length - 1)]; return { x: f.x, y: f.y, bubbleY: f.bubbleY }; }
  function headOf(i) { const f = flowerPos(i); return { x: f.x, y: f.y - 108 * A.FLOWER_SCALE }; }
  function newRoundFlowers() {
    const rd = run.rules.round;
    run.fl = rd.flowers.map((fd, i) => ({ i, hex: fd.colour, recipe: fd.recipe.slice(), bloom: 0, appear: 0, appearTo: i === 0 ? 1 : 0, bub: 0, bubTo: i === 0 ? 1 : 0,
      tilt: 0, tiltT: -1, wiggle: 0, pulse: 0, bloomed: false, bloomT: -1, delay: i === 0 ? 0.45 : 0 }));
  }

  // ---- bottles: the pour pipeline ----
  const cauldronPose = () => run.lay.c;
  function poseOf(b) {
    const c = cauldronPose(), side = b.hx >= c.x ? 1 : -1, tipX = c.x + side * 40, tipY = c.rimY - 30;
    return { side, x: tipX + side * 54.5, y: tipY - 19.8, rot: -side * POSE_ROT, tipX, tipY, hitX: c.x + side * 28, hitY: c.rimY + 3 };
  }
  const bottleById = (id) => run.bottles.find((b) => b.id === id);
  // a pour, from a tap or a drag let go over the cauldron (the one place the rules are applied)
  function requestPour(b) {
    if (!run || run.phase !== 'play') return false;
    const rules = run.rules;
    if (b.used || b.state === 'queued' || b.state === 'toPour' || b.state === 'pouring' || rules.phase !== 'filling' || run.show) { nope(b); return false; }
    const res = rules.pour(b.id);
    if (res.type !== 'poured') { nope(b); return false; }
    counters.pours++;
    b.used = true; b.state = 'queued'; b.t = 0; b.held = null;
    run.queue.push(b); run.idle = 0; run.hint = null; run.everPoured = true;
    return true;
  }
  function nope(b) { b.jig = 0; S.nope(); counters.nopes++; }
  function startNextPour() {
    if (run.active || !run.queue.length) return;
    const b = run.queue.shift();
    b.state = 'toPour'; b.t = 0; b.from = { x: b.x, y: b.y, rot: b.rot }; b.pose = poseOf(b);
    run.active = b;
  }
  // the bottle has begun to pour: its colour joins the swirl
  function cauldronAdd(b) {
    const c = run.cauld;
    const had = c.layers.length;
    c.layers.push(b.id);
    c.arms = had ? [{ hex: toHex(c.surface), a: 1 }, { hex: b.hex, a: 1 }] : [{ hex: b.hex, a: 1 }];
    c.from = had ? c.surface.slice() : A.hexRgb(b.hex);
    c.to = A.hexRgb(L.mixColour(c.layers));
    c.blend = had ? 0 : 1;
    c.blendDur = c.layers.length >= run.rules.flower.recipe.length ? MIX_T * 0.95 : 0.85;
    c.levelTo = Math.min(1, 0.5 + 0.17 * c.layers.length);
    c.squash = Math.max(c.squash, 0.25);
    S.pour(b.id);
  }
  const toHex = (rgb) => '#' + rgb.map((v) => ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2)).join('');
  // a tap on the cauldron: take back the last pour (the rules decide whether it can be)
  function requestUndo() {
    if (!run || run.phase !== 'play' || run.show) return false;
    const res = run.rules.undo();
    if (res.type !== 'undone') { run.cauld.squash = Math.max(run.cauld.squash, 0.3); S.ripple(); return false; }
    counters.undos++;
    const b = bottleById(res.id), c = run.cauld;
    const qi = run.queue.indexOf(b);
    if (qi >= 0) run.queue.splice(qi, 1);                // it had not left the shelf yet
    else {
      // already tipping, pouring or home again with its colour in the pot: take that colour back out
      if (run.active === b) run.active = null;
      const li = c.layers.lastIndexOf(b.id);
      if (li >= 0) c.layers.splice(li, 1);
      c.from = c.surface.slice();
      c.to = c.layers.length ? A.hexRgb(L.mixColour(c.layers)) : c.surface.slice();
      c.blend = 0; c.blendDur = 0.5; c.arms = [];
      c.levelTo = c.layers.length ? Math.min(1, 0.5 + 0.17 * c.layers.length) : 0;
      A.burst('bubble', run.lay.c.x, run.lay.c.rimY, b.hex, 5);
    }
    b.used = false; b.state = 'back'; b.t = 0; b.from = { x: b.x, y: b.y, rot: b.rot }; b.hop = 0; b.held = null;
    run.mixT = -1; run.idle = 0; run.hint = null;
    S.hop();
    return true;
  }

  function stepBottle(b, dt) {
    b.t += dt;
    if (b.jig >= 0 && (b.jig += dt) > 0.5) b.jig = -1;
    if (b.hop >= 0 && (b.hop += dt) > 0.5) b.hop = -1;
    b.glow += ((b.glowTo || 0) - b.glow) * Math.min(1, dt * 10);
    const lay = run.lay, c = lay.c;
    if (b.state === 'held') return;
    if (b.state === 'home' || b.state === 'queued') {
      if (b.wait > 0) { if ((b.wait -= dt) <= 0) { b.wait = 0; S.refill(b.idx); A.burst('spark', b.hx, b.hy + 40, b.hex, 5); } return; }
      const k = Math.min(1, dt * 14);
      b.x += (b.hx - b.x) * k; b.y += (b.hy - b.y) * k; b.rot += (0 - b.rot) * k;
    } else if (b.state === 'toPour') {
      const u = smooth(b.t / MOVE_T), p = b.pose;
      b.x = lerp(b.from.x, p.x, u); b.y = lerp(b.from.y, p.y, u) - Math.sin(u * Math.PI) * 24; b.rot = lerp(b.from.rot, p.rot, u);
      if (b.t >= MOVE_T) { b.state = 'pouring'; b.t = 0; cauldronAdd(b); }
    } else if (b.state === 'pouring') {
      const u = clamp(b.t / POUR_T, 0, 1), p = b.pose;
      b.x = p.x; b.y = p.y + Math.sin(b.t * 18) * 0.8; b.rot = p.rot + Math.sin(b.t * 14) * 0.02;
      b.level = lerp(1, USED_LEVEL, smooth(u));
      if (u > 0.15 && u < 0.95 && Math.random() < dt * 40) A.burst('splash', p.hitX, p.hitY, b.hex, 1);
      if (b.t >= POUR_T) { b.state = 'back'; b.t = 0; b.from = { x: b.x, y: b.y, rot: b.rot }; run.active = null; A.burst('splash', p.hitX, p.hitY, b.hex, 5); }
    } else if (b.state === 'back') {
      const u = smooth(b.t / BACK_T);
      b.x = lerp(b.from.x, b.hx, u); b.y = lerp(b.from.y, b.hy, u) - Math.sin(u * Math.PI) * 46; b.rot = lerp(b.from.rot, 0, u);
      if (b.t >= BACK_T) { b.state = 'home'; b.x = b.hx; b.y = b.hy; b.rot = 0; b.t = 0; if (!b.used) { /* refilled in place */ } }
    }
    // liquid left in the bottle, and how faded it looks
    if (b.state !== 'pouring') {
      const target = b.used ? USED_LEVEL : 1;
      b.level += (target - b.level) * Math.min(1, dt * (b.used ? 20 : 6));
    }
    b.alpha += ((b.used && b.state === 'home' ? 0.55 : 1) - b.alpha) * Math.min(1, dt * 8);
  }

  // ---- the cauldron and the mix ----
  function stepCauldron(dt) {
    const c = run.cauld, mixing = run.mixT >= 0;
    c.swirl += dt * (1.3 + (mixing ? 5.5 : 0) + (c.blend < 1 ? 2.5 : 0));
    if (c.blend < 1) c.blend = Math.min(1, c.blend + dt / c.blendDur);
    const u = smooth(c.blend);
    c.surface = [lerp(c.from[0], c.to[0], u), lerp(c.from[1], c.to[1], u), lerp(c.from[2], c.to[2], u)];
    for (const m of c.arms) m.a = 1 - u;
    c.level += (c.levelTo - c.level) * Math.min(1, dt * 7);
    c.sqV += (-90 * c.squash - 9 * c.sqV) * dt; c.squash += c.sqV * dt;
    c.glow += ((mixing ? 1 : c.blend < 1 ? 0.45 : 0) - c.glow) * Math.min(1, dt * 6);
    c.bubbles += ((mixing ? 1 : c.layers.length ? 0.4 : 0) - c.bubbles) * Math.min(1, dt * 5);
    c.hover += ((c.hoverTo || 0) - c.hover) * Math.min(1, dt * 10);
    if (c.layers.length && Math.random() < dt * (1 + 4 * c.bubbles)) A.burst('bubble', run.lay.c.x + rnd(-40, 40), run.lay.c.rimY + 2, toHex(c.surface), 1);
    // all the pours are in and the bottles are home: the colours blend, and then the rules decide
    const rules = run.rules;
    if (rules.phase === 'mixing' && !run.active && !run.queue.length && !run.show && run.bottles.every((b) => b.state !== 'toPour' && b.state !== 'pouring')) {
      if (run.mixT < 0) { run.mixT = 0; S.swirl(run.n % 3); run.isa.wave = 1.3; A.burst('zap', wandTip().x, wandTip().y, toHex(c.surface), 8, run.lay.c.x, run.lay.c.rimY); S.wand(); }
      else if ((run.mixT += dt) >= MIX_T) finishMix();
    } else if (rules.phase !== 'mixing') run.mixT = -1;
  }
  function wandTip() { const l = run.lay.isa; return A.wandTip(l.x, l.y, l.scale); }
  function finishMix() {
    const res = run.rules.finish();
    run.mixT = -1; run.idle = 0; run.hint = null;
    if (res.type === 'bloom') startBloom(res); else if (res.type === 'wrong') startWrong(res);
  }

  // ---- a match: Isabella waves, a drop flies to the flower, it blooms, butterflies, a coin ----
  function startBloom(res) {
    const fi = run.rules.f;
    run.show = { kind: 'bloom', t: 0, res, fi, landed: false, coined: false, butter: false, hex: res.colour };
    run.isa.wave = 1.4;
    const c = run.lay.c, h = headOf(fi);
    run.drop = { t: 0, x0: c.x, y0: c.rimY - 8, x1: h.x, y1: h.y, hex: res.colour, x: c.x, y: c.rimY - 8, ang: -1.2 };
    run.cauld.squash = 0.4;
    A.burst('spark', c.x, c.rimY - 10, res.colour, 12);
    S.wand();
    counters.blooms++;
  }
  function stepBloom(dt) {
    const sh = run.show, fl = run.fl[sh.fi];
    sh.t += dt;
    if (run.drop) {
      const d = run.drop, u = smooth(d.t / DROP_T);
      d.t += dt;
      const px = d.x, py = d.y;
      d.x = lerp(d.x0, d.x1, u); d.y = lerp(d.y0, d.y1, u) - Math.sin(u * Math.PI) * 120;
      d.ang = Math.atan2(d.y - py, d.x - px);
      if (Math.random() < dt * 60) A.burst('spark', d.x, d.y, sh.hex, 1);
      if (d.t >= DROP_T) run.drop = null;
    }
    if (!sh.landed && sh.t >= DROP_T) {
      sh.landed = true;
      fl.bloomT = 0; fl.bloomed = true; fl.bubTo = 0;
      const h = headOf(sh.fi);
      A.burst('spark', h.x, h.y, sh.hex, 22);
      S.bloom();
      save.coins++; save.blooms++; counters.coinsEarned++; persist();
    }
    if (!sh.butter && sh.t >= DROP_T + 0.55) {
      sh.butter = true;
      const h = headOf(sh.fi);
      for (let i = 0; i < 3; i++) run.butterflies.push({ x: h.x, y: h.y, ph: i * 2.1, rad: 55 + i * 18, t: 0, life: 4.4, hex: i === 0 ? sh.hex : ['#ff8fc0', '#ffd633', '#8fd3ff'][i] });
      S.butterflies();
    }
    if (!sh.coined && sh.t >= DROP_T + 0.7) {
      sh.coined = true;
      const h = headOf(sh.fi);
      run.coinsFly.push({ t: 0, x0: h.x, y0: h.y - 20 });
    }
    if (sh.t >= SHOW_BLOOM) {
      const res = sh.res;
      run.show = null;
      const fi = sh.fi;
      if (res.roundDone) run.doneCols[run.rules.r] = run.rules.round.flowers.map((f) => f.colour);
      if (res.levelDone) startWin(); else advanceAfterBloom(fi, res);
    }
  }
  function advanceAfterBloom(fi, res) {
    const rules = run.rules;
    rules.advance();
    drainCauldron(); refillBottles();
    if (res.roundDone) {
      // the finished flowers wave goodbye; a fresh grey bud comes up for the next round
      for (const f of run.fl) { f.appearTo = 0; f.bubTo = 0; run.leaving.push(f); }
      newRoundFlowers();
    } else {
      const nf = run.fl[rules.f];
      nf.appearTo = 1; nf.delay = 0.25; nf.bubTo = 1;
    }
  }

  // ---- a wrong mix: a soft burp, the flower tilts its head, the cauldron empties, the bottles come back ----
  function startWrong(res) {
    run.show = { kind: 'wrong', t: 0, res, drained: false, aww: false };
    const c = run.lay.c;
    run.cauld.squash = 0.9; run.cauld.sqV = 0;
    A.burst('puff', c.x, c.rimY - 8, res.colour, 8);
    S.burp();
    counters.wrongs++; counters.burps++; save.wrongs++;
    const fl = run.fl[run.rules.f];
    fl.tiltT = 0;
  }
  function stepWrong(dt) {
    const sh = run.show;
    sh.t += dt;
    if (!sh.aww && sh.t >= 0.25) { sh.aww = true; S.aww(); }
    if (!sh.drained && sh.t >= DRAIN_AT) { sh.drained = true; drainCauldron(); S.gurgle(); refillBottles(); }
    if (sh.t >= SHOW_WRONG) {
      run.show = null;
      run.rules.advance();
      run.idle = 0;
    }
  }
  function drainCauldron() {
    const c = run.cauld;
    c.layers = []; c.arms = []; c.levelTo = 0; c.from = c.surface.slice(); c.to = c.surface.slice(); c.blend = 1;
    A.burst('bubble', run.lay.c.x, run.lay.c.rimY, toHex(c.surface), 4);
  }
  // the bottles that were poured fill up again, one after another, with a sparkle
  function refillBottles() {
    let k = 0;
    for (const b of run.bottles) {
      if (!b.used) continue;
      const kk = k++;
      b.used = false;
      later(0.1 + kk * 0.13, () => {
        if (!run) return;
        b.hop = 0; S.refill(kk); A.burst('spark', b.hx, b.hy + 10, b.hex, 6);
      });
    }
    run.queue = run.queue.filter((q) => q.used);
  }

  // ---- the flowers ----
  function stepFlowers(dt) {
    const rules = run.rules;
    for (const f of run.fl.concat(run.leaving)) {
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.appear += (f.appearTo - f.appear) * Math.min(1, dt * 5.5);
      if (Math.abs(f.appearTo - f.appear) < 0.004) f.appear = f.appearTo;
      f.bub += ((f.bubTo && f.appear > 0.55 ? 1 : 0) - f.bub) * Math.min(1, dt * 7);
      if (f.bloomT >= 0) { f.bloomT += dt; f.bloom = smooth(f.bloomT / BLOOM_T); }
      if (f.tiltT >= 0) {
        f.tiltT += dt;
        const u = f.tiltT / 1.6;
        f.tilt = u >= 1 ? 0 : -0.5 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) * (u < 0.55 ? 1 : 1 - smooth((u - 0.55) / 0.45));
        if (u >= 1) f.tiltT = -1;
      }
      f.pulse = Math.max(0, f.pulse - dt);
      f.wiggle = Math.max(0, f.wiggle - dt * 2);
    }
    for (let i = run.leaving.length - 1; i >= 0; i--) { const f = run.leaving[i]; if (f.appear <= 0.02) run.leaving.splice(i, 1); }
    void rules;
  }
  function stepButterflies(dt) {
    for (let i = run.butterflies.length - 1; i >= 0; i--) {
      const b = run.butterflies[i];
      if ((b.t += dt) >= b.life) run.butterflies.splice(i, 1);
    }
  }
  const hudSpot = () => ({ x: A.VW - 78, y: 44 });
  function stepCoins(dt) {
    for (let i = run.coinsFly.length - 1; i >= 0; i--) {
      const c = run.coinsFly[i];
      if ((c.t += dt) >= 0.95) {
        run.coinsFly.splice(i, 1); run.hud++; run.hudPulse = 0.5; counters.coinsLanded++; S.coin();
        const h = hudSpot(); A.burst('spark', h.x - 30, h.y, '#ffd633', 6);
      }
    }
    run.hudPulse = Math.max(0, run.hudPulse - dt);
  }
  function stepIsabella(dt) {
    const I = run.isa;
    I.wave = Math.max(0, I.wave - dt);
    if (I.twirl > 0) I.twirl = Math.max(0, I.twirl - dt / 0.9);
  }

  // ---- the chest ----
  function startWin() {
    const r = run, rules = r.rules;
    r.phase = 'win'; r.pt = 0;
    releaseAll();
    r.stars = rules.stars;
    r.chestCoins = rules.cfg.chest;
    L.record(save, r.mode, r.n, r.stars, r.chestCoins, 0, 0);
    counters.chests++;
    persist();
    r.chest = { x: clamp(A.VW * 0.2, 130, A.VW - 160), t: 0, open: 0 };
    S.cheer();
    r.isa.twirl = 1; r.isa.wave = 2.5;
    later(0.3, () => { A.burst('puff', r.chest.x, A.SHELF_Y - 20, '#ffffff', 8); S.whoosh(); });
    later(1.25, () => {
      S.chest(); A.burst('coins', r.chest.x, A.SHELF_Y - 70, null, 28); A.burst('confetti', 0, 0, null, 60);
      r.hud += r.chestCoins; r.hudPulse = 1;
    });
    later(1.8, () => A.burst('coins', r.chest.x, A.SHELF_Y - 70, null, 16));
    later(2.4, () => { A.burst('coins', r.chest.x, A.SHELF_Y - 70, null, 16); for (let i = 0; i < 3; i++) r.butterflies.push({ x: r.chest.x + (i - 1) * 140, y: 260, ph: i * 2, rad: 70, t: 0, life: 4.4, hex: ['#ff8fc0', '#ffd633', '#8fd3ff'][i] }); S.butterflies(); });
    later(4.2, showResults);
  }
  function stepWin(dt) {
    const c = run.chest;
    c.t += dt;
    c.open = smooth((c.t - 1.15) / 0.55);
    for (const b of run.bottles) { b.alpha += (0 - b.alpha) * Math.min(1, dt * 6); }
  }
  function showResults() {
    const r = run;
    if (!r) return;
    r.results = true; screen = 'results';
    const box = $('bigStars');
    box.innerHTML = [0, 1, 2].map((i) => starSvg(i < r.stars)).join('');
    $('resCoins').textContent = r.rules.coins + r.chestCoins;
    $('resNext').style.display = r.n < NLEV ? '' : 'none';
    show('results');
    [...box.children].forEach((el, i) => later(0.25 + i * 0.38, () => { el.classList.add('pop'); if (i < r.stars) S.star(i); }));
  }

  // ---- hints: after a quiet spell, a hand taps the first bottle still needed (or the cauldron, to take a wrong pour back) ----
  function stepHint(dt) {
    const r = run;
    if (r.phase !== 'play' || r.show || active.size || r.active || r.queue.length || r.rules.phase !== 'filling') { r.hint = null; for (const b of r.bottles) b.glowTo = 0; return; }
    r.idle += dt;
    const first = !r.everPoured && save.blooms === 0 && r.n === 1;
    const wait = first ? Math.min(r.cfg.hint, 3.5) : r.cfg.hint;
    if (r.idle >= wait) {
      const h = r.rules.hint();
      if (h && !r.hint) counters.hints++;
      r.hint = h;
    } else r.hint = null;
    for (const b of r.bottles) b.glowTo = r.hint && r.hint.kind === 'bottle' && r.hint.id === b.id ? 0.85 + 0.15 * Math.sin(clock * 8) : 0;
  }

  // ---- input: a finger drags a bottle over the cauldron, or taps it; a tap on the cauldron undoes ----
  const active = new Map();   // pointerId -> { id, b, ox, oy, sx, sy, x, y, t0, moved }
  const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const upright = () => (portrait ? portrait.matches : window.innerHeight > window.innerWidth);
  function hitBottle(x, y) {
    let best = null, bd = 1e9;
    for (const b of run.bottles) {
      if (b.state !== 'home' || b.used || b.wait > 0) continue;
      const d = Math.hypot(x - b.x, y - b.y), lim = BOTTLE_HIT + GRAB_SLOP;
      if (d <= lim && d < bd) { bd = d; best = b; }
    }
    return best;
  }
  // used bottles are not picked up, but a tap on one says "already in" with a little shake
  function hitAnyBottle(x, y) {
    for (const b of run.bottles) if (b.state === 'home' && b.wait <= 0 && Math.hypot(x - b.x, y - b.y) <= BOTTLE_HIT + GRAB_SLOP) return b;
    return null;
  }
  const hitCauldron = (x, y) => Math.hypot(x - run.lay.c.x, y - run.lay.c.y) <= run.lay.c.hitR;
  function hitFlower(x, y) {
    for (const f of run.fl) {
      if (f.appear < 0.5) continue;
      const p = flowerPos(f.i);
      if (Math.hypot(x - p.x, y - (p.y - 80)) <= 70) return f;
      if (f.bub > 0.5 && Math.hypot(x - p.x, y - p.bubbleY) <= 70) return f;
    }
    return null;
  }
  function hitIsabella(x, y) { const l = run.lay.isa; return Math.hypot(x - l.x, y - (l.y - 18)) <= 58; }
  function grab(b, id, p) {
    b.state = 'held'; b.held = id; b.from = null;
    active.set(id, { id, b, ox: b.x - p.x, oy: b.y - p.y, sx: p.x, sy: p.y, x: p.x, y: p.y, t0: performance.now(), moved: false });
    counters.grabs++; counters.maxPointers = Math.max(counters.maxPointers, active.size);
    S.grab();
    run.hint = null; run.idle = 0;
  }
  function placeHeld(g) {
    const b = g.b;
    b.x = clamp(g.x + g.ox, 40, A.VW - 40); b.y = clamp(g.y + g.oy, 50, A.H - 40);
    const c = run.lay.c, over = L.overCauldron(b.x, b.y, { x: c.x, y: c.y, r: c.r }, run.cfg.snap);
    b.rot = over ? (b.hx >= c.x ? -0.5 : 0.5) : clamp((b.hx - b.x) * 0.002, -0.2, 0.2);
    run.cauld.hoverTo = over ? 1 : 0;
  }
  // a bottle grabbed by its edge slides in under the finger as it moves
  function easeGrabs(dt) {
    for (const g of active.values()) {
      if (!g.moved) continue;
      const d = Math.hypot(g.ox, g.oy), lim = 22;
      if (d > lim) { const k = Math.max(lim / d, Math.exp(-dt * 6)); g.ox *= k; g.oy *= k; }
      placeHeld(g);
    }
  }
  function release(g, cancelled) {
    const b = g.b;
    if (!run || b.state !== 'held' || b.held !== g.id) return;
    b.held = null; b.state = 'home'; b.t = 0;
    run.cauld.hoverTo = 0;
    if (cancelled || run.phase !== 'play') return;
    const c = run.lay.c;
    if (!g.moved && performance.now() - g.t0 < TAP_MS) { counters.taps++; requestPour(b); return; }
    counters.drops++;
    if (L.overCauldron(b.x, b.y, { x: c.x, y: c.y, r: c.r }, run.cfg.snap)) requestPour(b);
    else { b.hop = 0; S.hop(); }   // let go anywhere else: it glides home
  }
  function releaseAll() { const gs = [...active.values()]; active.clear(); for (const g of gs) release(g, true); if (run) run.cauld.hoverTo = 0; }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (screen !== 'play' || !run || upright()) return;
    counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    const p = A.toWorld(e.clientX, e.clientY);
    run.idle = 0; run.hint = null;
    if (run.phase === 'play') {
      const b = hitBottle(p.x, p.y);
      if (b) { grab(b, e.pointerId, p); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ } return; }
      const any = hitAnyBottle(p.x, p.y);
      if (any) { nope(any); return; }
      if (hitCauldron(p.x, p.y)) { counters.cauldronTaps++; requestUndo(); return; }
      const f = hitFlower(p.x, p.y);
      if (f) { f.wiggle = 1; f.pulse = 0.8; S.ding(f.i * 2); counters.flowerTaps++; A.burst('spark', flowerPos(f.i).x, flowerPos(f.i).y - 100, f.hex, 5); return; }
    }
    if (hitIsabella(p.x, p.y)) {
      counters.isabellaTaps++;
      if (run.isa.twirl <= 0) run.isa.twirl = 1;
      A.burst('hearts', run.lay.isa.x + 10, run.lay.isa.y - 60); S.giggle();
      return;
    }
    counters.misses++; A.burst('spark', p.x, p.y, '#fff6b0', 4); S.ripple();
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
  tap('resLevels', () => goLevels());
  tap('resReplay', () => startLevel(run ? run.n : 1, run ? run.mode : mode));
  tap('resNext', () => startLevel(Math.min(NLEV, (run ? run.n : 0) + 1), run ? run.mode : mode));
  tap('gridBtn', () => goLevels());
  tap('pgPrev', () => goLevels(null, page - 1));
  tap('pgNext', () => goLevels(null, page + 1));
  for (const m of L.MODES) $('mode-' + m).addEventListener('click', () => { S.init(); S.click(); goLevels(m); });
  $('homeBtn').addEventListener('click', () => { S.init(); persist(); location.href = HUB; });
  window.__back = () => { persist(); location.href = HUB; return true; };
  window.__pause = () => { S.suspend(); persist(); };
  // grown-ups: hold the title for 4 seconds to open every level of the mode shown
  let holdT = null;
  $('title').addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { save.unlocked[mode] = NLEV; persist(); S.init(); S.rainbow(); goLevels(); }, 4000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('title').addEventListener(ev, () => clearTimeout(holdT));
  function measureHome() {
    const r = $('homeBtn').querySelector('.btn').getBoundingClientRect();
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
  window.addEventListener('resize', () => { A.resize(); layout(); measureHome(); for (const g of active.values()) placeHeld(g); });

  // ---- drawing a level ----
  function drawPlay() {
    const r = run, lay = r.lay, c = r.cauld, rules = r.rules;
    A.drawScenery(r.theme, clock, lay);
    // Isabella beside the table, wand in hand
    const I = r.isa, tilt = (I.wave > 0 ? Math.sin(clock * 16) * 0.06 : 0) + (I.twirl > 0 ? smooth(1 - I.twirl) * TAU : 0);
    A.drawIsabella(lay.isa.x, lay.isa.y, clock, { pose: 'hover', scale: lay.isa.scale, happy: true, dust: I.wave > 0 ? Math.min(1, I.wave) : 0, glow: I.wave > 0 ? 0.5 : 0, tilt });
    A.drawTable(lay, clock);
    // flowers and their thought bubbles
    for (const f of r.leaving) drawFlowerOf(f, lay);
    for (const f of r.fl) drawFlowerOf(f, lay);
    A.drawCauldron(lay.c, { surface: c.surface, arms: c.arms, swirl: c.swirl, level: c.level, glow: c.glow, squash: c.squash, hover: c.hover, bubbles: c.bubbles }, clock);
    A.drawShelf(clock);
    // bottles at rest first; the ones tipping or in a finger on top, with their streams
    const heldOrBusy = (b) => b.state === 'held' || b.state === 'toPour' || b.state === 'pouring' || b.state === 'back';
    for (const b of r.bottles) if (!heldOrBusy(b)) drawBottle(b);
    for (const b of r.bottles) {
      if (!heldOrBusy(b)) continue;
      if (b.state === 'pouring') { const u = b.t / POUR_T, p = b.pose; A.drawStream(p.tipX, p.tipY, p.hitX, p.hitY, b.hex, u < 0.15 ? u / 0.15 : u > 0.9 ? Math.max(0, (1 - u) / 0.1) : 1, clock); }
      drawBottle(b);
    }
    if (r.drop) A.drawDrop(r.drop.x, r.drop.y, r.drop.hex, 11, r.drop.ang, clock);
    if (r.chest) { const ch = r.chest, rise = backOut(clamp((ch.t - 0.25) / 0.7, 0, 1)); F().drawChest(A.ctx, ch.x, A.H + 90 + (A.SHELF_Y - 4 - A.H - 90) * rise, ch.open, clock); }
    for (const b of r.butterflies) drawButterfly(b);
    A.drawParts();
    drawHud();
    if (r.hint) drawHint(r.hint);
    void rules;
  }
  function drawBottle(b) {
    const lift = b.hop >= 0 ? Math.sin((b.hop / 0.5) * Math.PI) * 16 : 0, jig = b.jig >= 0 ? Math.sin(b.jig * 40) * 5 * (1 - b.jig / 0.5) : 0;
    A.drawBottle(b.x + jig, b.y - lift, b.hex, { rot: b.rot, level: b.level, alpha: b.alpha, glow: b.glow + (b.state === 'held' ? 0.3 : 0), stand: b.state === 'home' });
  }
  function drawFlowerOf(f, lay) {
    const p = { x: lay.flowers[Math.min(f.i, lay.flowers.length - 1)].x, y: lay.ground, by: lay.flowers[0].bubbleY };
    if (f.appear > 0.01) A.drawFlower(p.x, p.y, A.FLOWER_SCALE, f.bloom, f.hex, clock, { tilt: f.tilt, wiggle: f.wiggle, appear: f.appear });
    if (f.bub > 0.01 && !run.leaving.includes(f)) {
      const dots = run.cfg.dots ? f.recipe.map((id) => L.BOTTLE_COLOUR[id]) : null;
      A.drawBubble(p.x, p.by, f.hex, dots, clock, { appear: f.bub, pulse: f.pulse > 0 ? 1 : 0 });
    }
  }
  function drawButterfly(b) {
    const t = b.t, out = Math.max(0, t - (b.life - 1.1));
    const x = b.x + Math.cos(b.ph + t * 1.9) * b.rad * (1 + t * 0.12) + out * 30, y = b.y - 20 + Math.sin(b.ph * 1.3 + t * 2.4) * b.rad * 0.5 - t * 8 - out * out * 120;
    A.ctx.save(); A.ctx.globalAlpha = clamp((b.life - t) / 0.5, 0, 1) * clamp(t / 0.3, 0, 1);
    F().drawButterfly(A.ctx, x, y, clock + b.ph, b.hex, 0.95);
    A.ctx.restore();
  }
  function drawHud() {
    const r = run, rules = r.rules, n = rules.rounds.length;
    // a finished round shows its flower colour(s); the round in play shows a star
    const pips = [];
    for (let i = 0; i < n; i++) pips.push({ state: r.doneCols[i] ? 'done' : i === rules.r ? 'now' : 'todo', cols: r.doneCols[i] });
    A.drawPips(A.VW / 2, 44, pips, clock);
    const h = hudSpot();
    A.drawCoinCount(h.x, h.y, r.hud, clock, r.hudPulse);
  }
  function drawHint(h) {
    const r = run;
    if (h.kind === 'bottle') {
      const b = bottleById(h.id);
      if (!b || b.state !== 'home') return;
      A.glow(b.x, b.y, 80, 'rgba(255,240,170,1)', 0.5);
      F().drawHand(A.ctx, b.x, b.y - 4, clock, 1);
    } else {
      const c = r.lay.c;
      A.glow(c.x, c.y, 120, 'rgba(255,240,170,1)', 0.45);
      F().drawHand(A.ctx, c.x, c.y, clock, 1);
    }
  }

  // ---- the level map's meadow ----
  let menuT = 0;
  function drawMenu() {
    A.drawMenu(page + 1, clock, 90 + ((menuT * 70) % (A.VW + 300)) - 150);
    A.drawParts();
  }
  function stepMenu(dt) {
    menuT += dt;
    A.stepMenu(dt, L.TABLE.map((e) => e.colour));
    A.stepParts(dt);
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
    easeGrabs(dt);
    if (r.phase === 'play') {
      startNextPour();
      for (const b of r.bottles) stepBottle(b, dt);
      stepCauldron(dt);
      if (r.show) { if (r.show.kind === 'bloom') stepBloom(dt); else stepWrong(dt); }
      stepHint(dt);
    } else {
      for (const b of r.bottles) stepBottle(b, dt);
      stepCauldron(dt);
      if (r.phase === 'win') stepWin(dt);
    }
    stepFlowers(dt);
    if (r.drop && !r.show) r.drop = null;
    stepButterflies(dt);
    stepCoins(dt);
    stepIsabella(dt);
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

  // ---- hooks for the headless tests (test/games/potions) ----
  const cli = (x, y) => A.toClient(x, y);
  const rad = (r) => (r * A.scale) / A.dpr;
  window.__dbg = {
    counters,
    state() {
      const r = run, rules = r && r.rules;
      const bottles = r ? r.bottles.map((b) => { const c = cli(b.x, b.y), h = cli(b.hx, b.hy); return { id: b.id, state: b.state, used: b.used, settled: b.state === 'home' && b.wait <= 0 && Math.hypot(b.x - b.hx, b.y - b.hy) < 1.5, x: b.x, y: b.y, cx: c.x, cy: c.y, cr: rad(BOTTLE_HIT), hcx: h.x, hcy: h.y, level: b.level, alpha: b.alpha, wait: b.wait }; }) : [];
      const cc = r ? cli(r.lay.c.x, r.lay.c.y) : null;
      return {
        screen, mode, page, level: r ? r.n : null, phase: r ? r.phase : null,
        rules: r ? { r: rules.r, f: rules.f, phase: rules.phase, poured: rules.poured.slice(), wrongs: rules.wrongs, blooms: rules.blooms, coins: rules.coins, pours: rules.pours, undos: rules.undos,
          done: rules.done, stars: rules.stars, recipe: rules.flower.recipe.slice(), colour: rules.flower.colour, nRounds: rules.rounds.length, table: rules.table.slice() } : null,
        bottles,
        cauldron: r ? { x: r.lay.c.x, y: r.lay.c.y, r: r.lay.c.r, cx: cc.x, cy: cc.y, cr: rad(r.lay.c.hitR), level: r.cauld.level, layers: r.cauld.layers.slice(), surface: toHex(r.cauld.surface), blend: r.cauld.blend } : null,
        flowers: r ? r.fl.map((f) => { const p = flowerPos(f.i), c = cli(p.x, p.y - 80), b = cli(p.x, p.bubbleY); return { i: f.i, hex: f.hex, bloom: f.bloom, appear: f.appear, bub: f.bub, tilt: f.tilt, cx: c.x, cy: c.y, cr: rad(70), bx: b.x, by: b.y, br: rad(70) }; }) : [],
        isabella: r ? (() => { const c = cli(r.lay.isa.x, r.lay.isa.y - 18); return { cx: c.x, cy: c.y, cr: rad(58) }; })() : null,
        held: active.size, show: r && r.show ? r.show.kind : null, mixT: r ? r.mixT : -1, queue: r ? r.queue.length : 0, active: !!(r && r.active),
        hint: r && r.hint ? r.hint : null, hintDelay: r ? r.cfg.hint : null, dots: r ? r.cfg.dots : null, snap: r ? r.cfg.snap : null,
        hud: r ? r.hud : 0, coinsFly: r ? r.coinsFly.length : 0, butterflies: r ? r.butterflies.length : 0, drop: !!(r && r.drop), leaving: r ? r.leaving.length : 0,
        pips: r ? r.doneCols.length : 0, chest: !!(r && r.chest), chestOpen: r && r.chest ? r.chest.open : 0, results: !!(r && r.results), resultsStars: r && r.results ? r.stars : null, chestCoins: r ? r.chestCoins : 0,
        save: { mode: save.mode, unlocked: Object.assign({}, save.unlocked), stars: { easy: save.stars.easy.slice(), medium: save.stars.medium.slice(), hard: save.stars.hard.slice() }, coins: save.coins, chests: save.chests, blooms: save.blooms, wrongs: save.wrongs },
        VW: A.VW, scale: A.scale, dpr: A.dpr, canvas: [canvas.width, canvas.height], parts: A.partCount, muted, audio: S.state, gain: S.gain,
        homeZone, layout: r ? { cx: r.lay.cx, shelfY: A.SHELF_Y, sp: r.lay.bottleSp } : null,
      };
    },
    start(n, m) { startLevel(n, m || mode); return run.n; },
    goLevels(m, p) { goLevels(m, p); return true; },
    // the same rule code as a real tap or drop
    pour(id) { if (!run) return false; const b = bottleById(id); return b ? requestPour(b) : false; },
    undo() { return requestUndo(); },
    recipe() { return run ? run.rules.flower.recipe.slice() : null; },
    timeScale(k) { timeScale = k; return timeScale; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    resetPerf() { perfN = 0; perf.fill(0); },
    saved() { return store.get(SAVE_KEY); },
  };

  measureHome();
  goLevels();
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  // ?level=4&mode=hard jumps straight into a level (handy for screenshots)
  const qs = new URLSearchParams(location.search), qLevel = +qs.get('level'), qMode = qs.get('mode');
  if (qLevel >= 1 && qLevel <= NLEV && qLevel <= save.unlocked[L.MODES.includes(qMode) ? qMode : mode]) startLevel(qLevel, L.MODES.includes(qMode) ? qMode : mode);
  requestAnimationFrame(frame);
})();
