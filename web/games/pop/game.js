/* Isabella's Bubble Party: a calm popping-and-counting game for ages 3-5.
 * Bubbles drift up from the seabed, each carrying a sea friend. A tap pops it with a pentatonic
 * note (taps make little tunes), the friend does a happy wiggle and swims down into the aquarium,
 * and a big numeral counts it: 1, 2, 3 ... 10. Ten friends make a party, then the sea changes.
 * No timers, no lives, no losing, no words. Several fingers can pop at once. */
(function () {
  'use strict';
  const A = PopArt, S = PopSound;
  const { FLOOR, SEAT, SCENES } = A;
  const SLOTS = 10, SAVE_KEY = 'game.pop.save', TAU = Math.PI * 2;
  const WIGGLE = 0.45, FLIGHT = 0.75;   // a popped friend wiggles, then swims down to its place
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
  // sound follows the main game's setting
  function readMuted() { try { return !!JSON.parse(store.get('isabella.save') || '{}').muted; } catch (e) { return false; } }

  const KINDS = new Set(A.KINDS);
  function loadSave() {
    const d = { v: 1, scene: 0, aquarium: [], total: 0, kinds: {}, filled: 0 };
    try {
      const s = JSON.parse(store.get(SAVE_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (Number.isInteger(s.scene)) d.scene = ((s.scene % SCENES.length) + SCENES.length) % SCENES.length;
        if (Number.isFinite(s.total)) d.total = Math.max(0, Math.floor(s.total));
        if (Number.isFinite(s.filled)) d.filled = Math.max(0, Math.floor(s.filled));
        if (s.kinds && typeof s.kinds === 'object') {
          for (const k of Object.keys(s.kinds)) if (KINDS.has(k) && Number.isFinite(s.kinds[k])) d.kinds[k] = Math.max(0, Math.floor(s.kinds[k]));
        }
        if (Array.isArray(s.aquarium)) {
          d.aquarium = s.aquarium.filter((f) => f && KINDS.has(f.k) && typeof f.c === 'string' && /^(#[0-9a-f]{6}|rainbow)$/i.test(f.c))
            .slice(0, SLOTS).map((f) => ({ k: f.k, c: f.c }));
        }
      }
    } catch (e) { /* start a fresh aquarium */ }
    // closed during a party: those ten friends were already counted, so carry on in the next sea
    if (d.aquarium.length >= SLOTS) { d.scene = (d.scene + 1) % SCENES.length; d.aquarium = []; d.filled++; }
    return d;
  }
  const save = loadSave();

  // ---- state ----
  const canvas = document.getElementById('c'), homeBtn = document.getElementById('home'), homeDot = homeBtn.querySelector('span');
  A.init(canvas);
  let muted = readMuted();
  S.setMuted(muted);
  let scene = save.scene, fromScene = -1;
  let phase = 'play', phaseT = 0, fullT = 0, partyPopT = 0, partyN = 0;   // phase: play | full | party | change
  let partyCount = 0, partyCountT = 0, partyFanfareT = -1;
  let clock = 0, last = 0, timeScale = 1, idleT = 0;
  const bubbles = [], friends = [], leavers = [], numerals = [], partyQueue = [];
  let isa = null, nextIsa = 4.5, nextSpawn = 0.9, specialIn = 3, specialFlip = Math.random() < 0.5;
  let lastKind = '', lastSpawnX = -1e9, nextId = 1, popsSinceFrame = 0, hintId = 0, homeZone = null;
  const counters = { pops: 0, joins: 0, landed: 0, misses: 0, rainbow: 0, giant: 0, small: 0, friendTaps: 0, isabellaTaps: 0, countAlong: 0,
    isabellaVisits: 0, gifts: 0, scenes: 0, floated: 0, saves: 0, downs: 0, maxPointers: 0, maxPopsInFrame: 0, pointerTypes: {} };

  function persist() {
    save.scene = scene;
    save.aquarium = friends.map((f) => ({ k: f.kind, c: f.col }));
    store.set(SAVE_KEY, JSON.stringify(save));
    counters.saves++;
  }
  function makeFriend(kind, col, slot, home, from) {
    return { kind, col, slot, state: home ? 'home' : 'fly', t: home ? 9 : 0, x0: from ? from.x : 0, y0: from ? from.y : 0, sc0: from ? from.sc : 1,
      seed: Math.random() * 10, wig: 0, hopT: null, hopH: 0, dance: 0, flip: from ? A.slotX(slot) < from.x : slot >= 5 };
  }
  save.aquarium.forEach((f, i) => friends.push(makeFriend(f.k, f.c, i, true)));

  // ---- bubbles ----
  const targetCount = () => clamp(Math.round(A.VW / 240), 3, 6);
  const risingCount = () => { let n = 0; for (const b of bubbles) if (b.special !== 'small') n++; return n; };
  const shown = (b) => b.grow < 1 ? b.grow : 1;
  function pickKind() {
    const ks = SCENES[scene].kinds;
    let i = Math.floor(Math.random() * ks.length);
    if (ks[i][0] === lastKind) i = (i + 1 + Math.floor(Math.random() * (ks.length - 1))) % ks.length;
    lastKind = ks[i][0];
    return ks[i];
  }
  function makeBubble(o) {
    const special = o.special || null;
    const r = special === 'giant' ? 104 : special === 'small' ? rnd(40, 44) : rnd(60, 70);
    let kind = o.kind, col = o.col;
    if (!kind) { const k = pickKind(); kind = k[0]; col = k[1]; }
    else if (!col) { const k = SCENES[scene].kinds.find((q) => q[0] === kind); col = k ? k[1] : '#ff8c2e'; }
    const b = { id: nextId++, x: o.x, x0: o.x, y: o.y, r, kind, col, special,
      vy: special === 'giant' ? rnd(27, 33) : rnd(40, 54), vx: o.vx || 0,
      ph: Math.random() * TAU, om: rnd(0.5, 0.8), amp: rnd(8, 18), seed: Math.random() * 10, flip: Math.random() < 0.5,
      grow: o.grow ? 0 : 1, inner: null };
    if (special === 'giant') {
      b.inner = Array.from({ length: Math.random() < 0.5 ? 3 : 4 }, () => { const k = pickKind(); return { kind: k[0], col: k[1], seed: Math.random() * 10 }; });
    }
    b.x0 = o.x - Math.sin(b.ph + clock * b.om) * b.amp; // so the wobble starts from exactly here
    bubbles.push(b);
    return b;
  }
  // rise from the seabed at a spot with room around it
  function spawnFromSeabed(special) {
    const r = special === 'giant' ? 104 : 66, lo = r + 24, hi = Math.max(lo + 1, A.VW - r - 24);
    let best = (lo + hi) / 2, bestD = -1e9;
    for (let k = 0; k < 16; k++) {
      const x = rnd(lo, hi);
      let d = Math.abs(x - lastSpawnX) * 0.5;
      for (const b of bubbles) if (b.y > 230) d = Math.min(d, Math.abs(b.x0 - x) - b.r);
      if (d > bestD) { bestD = d; best = x; }
    }
    lastSpawnX = best;
    return makeBubble({ x: best, y: FLOOR + r + 8, special });
  }
  function spawnOne() {
    let special = null;
    if (--specialIn <= 0 && !bubbles.some((b) => b.special === 'rainbow' || b.special === 'giant')) {
      special = specialFlip ? 'giant' : 'rainbow'; specialFlip = !specialFlip; specialIn = 5 + Math.floor(Math.random() * 4);
    }
    spawnFromSeabed(special);
  }
  // something to tap straight away
  function starters() {
    const ys = [300, 210, 350];
    for (let i = 0; i < 3; i++) makeBubble({ x: A.VW * (0.3 + i * 0.21) + rnd(-25, 25), y: ys[i] });
  }
  function stepBubbles(dt) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.grow < 1) b.grow = Math.min(1, b.grow + dt * 2.6);
      b.y -= b.vy * (b.y < 150 ? 0.7 : 1) * dt;
      b.x0 += b.vx * dt; b.vx *= Math.exp(-dt * 2.5);
      b.x = b.x0 + Math.sin(b.ph + clock * b.om) * b.amp;
      if (b.y + b.r < -12) { bubbles.splice(i, 1); counters.floated++; }   // floated away: nothing lost, more are coming
    }
    // bubbles nudge each other apart instead of overlapping
    const k = Math.min(1, dt * 6);
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const p = bubbles[i], q = bubbles[j], dx = q.x - p.x, dy = q.y - p.y, min = p.r + q.r + 8, d2 = dx * dx + dy * dy;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 1, push = (min - d) * 0.5 * k, nx = dx / d || 1;
          p.x0 -= nx * push; q.x0 += nx * push;
          (p.y > q.y ? p : q).y += Math.abs(dy / d) * push * 0.6;
        }
      }
    }
    // stay on screen and clear of the home button
    for (const b of bubbles) {
      const lo = b.r + 6 + b.amp, hi = A.VW - b.r - 6 - b.amp;
      if (b.x0 < lo) b.x0 += (lo - b.x0) * k; else if (b.x0 > hi) b.x0 -= (b.x0 - hi) * k;
      if (homeZone) {
        const dx = b.x - homeZone.x, dy = b.y - homeZone.y, min = b.r + homeZone.r + 18, d = Math.hypot(dx, dy);
        if (d < min) b.x0 += (min - d) * Math.min(1, dt * 5);
      }
    }
  }

  // ---- popping ----
  const heightU = (y) => clamp(1 - (y - 40) / (FLOOR - 40), 0, 1);
  function pop(b, uOverride) {
    const i = bubbles.indexOf(b);
    if (i < 0) return false;
    bubbles.splice(i, 1);
    counters.pops++; popsSinceFrame++;
    const r = b.r * shown(b);
    S.pop(uOverride != null ? uOverride : heightU(b.y), b.special === 'giant' ? 'giant' : b.special === 'small' ? 'small' : 'normal');
    A.burst('pop', b.x, b.y, r);
    if (b.special === 'giant') {
      counters.giant++; S.split();
      const n = b.inner.length;
      b.inner.forEach((q, k) => {
        const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.95;
        if (phase !== 'play') { swimAway(q.kind, q.col, b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 30, 0.6, q.seed); return; }
        const nb = makeBubble({ x: b.x + Math.cos(a) * 34, y: b.y + Math.sin(a) * 24 + 10, special: 'small', kind: q.kind, col: q.col, grow: true });
        nb.vx = Math.cos(a) * 200 + rnd(-20, 20); nb.seed = q.seed;
      });
      return true;
    }
    if (b.special === 'rainbow') {
      counters.rainbow++; S.rainbow(); A.burst('notes', b.x, b.y, r);
      for (const f of friends) if (f.state === 'home') f.dance = Math.max(f.dance, 1.8);
    }
    if (b.special === 'small') counters.small++;
    const from = { x: b.x, y: b.y, sc: r * A.INSIDE };
    if (phase === 'play' && friends.length < SLOTS) addFriend(b, from);
    else swimAway(b.kind, b.col, b.x, b.y, from.sc, b.seed);
    return true;
  }
  function swimAway(kind, col, x, y, sc, seed) {
    const dir = x < A.VW / 2 ? -1 : 1;
    leavers.push({ kind, col, x, y, sc, t: 0, mode: 'swim', seed, vx: dir * rnd(140, 190), vy: rnd(-150, -100), flip: dir < 0 });
  }
  function addFriend(b, from) {
    const f = makeFriend(b.kind, b.col, friends.length, false, from);
    f.wig = 1;
    friends.push(f);
    counters.joins++;
    save.total++; save.kinds[b.kind] = (save.kinds[b.kind] || 0) + 1;
    persist();
    if (friends.length >= SLOTS) { phase = 'full'; phaseT = 0; fullT = 0; }
  }
  function flyPos(f) {
    const u = smooth(clamp((f.t - WIGGLE) / FLIGHT, 0, 1)), sx = A.slotX(f.slot);
    return { x: f.x0 + (sx - f.x0) * u, y: f.y0 + (SEAT - f.y0) * u - Math.sin(u * Math.PI) * 110, u };
  }
  // Big numerals stay on screen, and when a new one would overlap an older one, the older one
  // shrinks into its place now: on a narrow screen fast counting reads 8, 9, 10 rather than a pile.
  const NUM = 118;
  const numHalf = (n) => NUM * (n >= 10 ? 0.74 : 0.43);
  const numX = (m) => clamp(A.slotX(m.slot), numHalf(m.n) + 6, A.VW - numHalf(m.n) - 6);
  function showNumeral(slot) {
    const m = { n: slot + 1, slot, t: 0 }, x = numX(m);
    for (const q of numerals) if (q.slot !== slot && q.t < 1.15 && Math.abs(numX(q) - x) < numHalf(q.n) + numHalf(m.n)) q.t = 1.15;
    const old = numerals.find((q) => q.slot === slot);
    if (old) old.t = Math.min(old.t, 0.32); else numerals.push(m);
  }
  // a friend arrives in its place: the big numeral counts it, and everyone bounces hello
  function land(f) {
    f.state = 'home'; f.wig = 0.8; f.hopT = 0; f.hopH = 20;
    counters.landed++;
    showNumeral(f.slot);
    S.join(f.slot + 1);
    A.burst('land', A.slotX(f.slot), SEAT, 30, A.NUMCOL[f.slot]);
    for (const g of friends) if (g !== f && g.state === 'home' && g.hopT == null) { g.hopT = 0; g.hopH = 9; }
  }
  function stepFriends(dt) {
    let allHome = true;
    for (const f of friends) {
      f.t += dt;
      if (f.state === 'fly') {
        if (f.t >= WIGGLE + FLIGHT) land(f);
        else {
          allHome = false;
          if (f.t > WIGGLE && Math.random() < dt * 30) { const p = flyPos(f); A.burst('twinkle', p.x, p.y, 14, '#fff8c0'); }
        }
      }
      if (f.hopT != null && (f.hopT += dt) > 0.45) f.hopT = null;
      if (f.dance > 0) f.dance -= dt;
      f.wig = Math.max(f.dance > 0 ? 0.45 : 0, f.wig - dt * 1.5);
    }
    return allHome;
  }
  function stepLeavers(dt) {
    for (let i = leavers.length - 1; i >= 0; i--) {
      const L = leavers[i];
      L.t += dt;
      if (L.mode === 'swim') {
        if (L.t > WIGGLE) { L.x += L.vx * dt; L.y += L.vy * dt; L.vy -= 20 * dt; }
      } else if (L.t > L.delay) {
        const u = L.t - L.delay;
        L.y -= (60 + u * 140) * dt; L.x += Math.sin(u * 3 + L.seed) * 26 * dt;
        L.b.x = L.x; L.b.y = L.y; L.b.grow = clamp(u / 0.35, 0, 1);
      }
      if (L.y < -90 || L.x < -140 || L.x > A.VW + 140) leavers.splice(i, 1);
    }
  }

  // ---- Isabella swims through now and then, waving; tap her for a twirl ----
  function startIsabella(party) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    isa = { dir, x: dir > 0 ? -180 : A.VW + 180, y0: party ? 205 : rnd(170, 280), y: 0, t: 0, twirl: 0, gift: !party, trail: 0, party, twirlT: 0 };
    isa.y = isa.y0;
    counters.isabellaVisits++;
    S.isabella();
  }
  function stepIsabella(dt) {
    if (!isa) { if (phase === 'play' && (nextIsa -= dt) <= 0) startIsabella(false); return; }
    isa.t += dt;
    if (isa.party && phase === 'party') {
      // hosting the party: swim to the middle, then twirl now and then
      const dx = A.VW / 2 - isa.x;
      if (Math.abs(dx) > 3) { isa.dir = dx > 0 ? 1 : -1; isa.x += Math.sign(dx) * Math.min(320, Math.abs(dx) * 2.5) * dt; }
      isa.y0 += (205 - isa.y0) * Math.min(1, dt * 2);
      if (Math.abs(dx) < 50 && (isa.twirlT -= dt) <= 0) { isa.twirl = 1; isa.twirlT = 1.5; }
    } else isa.x += isa.dir * (isa.party ? 240 : 165) * dt;
    isa.y = isa.y0 + Math.sin(isa.t * 1.4) * 26;
    if (isa.twirl > 0) isa.twirl = Math.max(0, isa.twirl - dt / 0.8);
    if ((isa.trail -= dt) <= 0) { isa.trail = 0.11; A.burst('trail', isa.x - isa.dir * 150, isa.y + 6); }
    // halfway across she blows a bubble with a friend inside
    if (isa.gift && phase === 'play' && friends.length < SLOTS && Math.abs(isa.x - A.VW / 2) < 60 && risingCount() <= targetCount()) {
      isa.gift = false; counters.gifts++;
      makeBubble({ x: clamp(isa.x + isa.dir * 70, 90, A.VW - 90), y: isa.y - 90, grow: true });
      S.appear();
    }
    if (isa.x < -200 || isa.x > A.VW + 200) { isa = null; nextIsa = rnd(24, 36); }
  }

  // ---- ten friends: party, then a new sea ----
  // The party: the last bubbles pop themselves, then the friends count off 1 to 10 (each hops and
  // sings its note while its numeral rises), then a fanfare and a dance, then the sea changes.
  function startParty() {
    phase = 'party'; phaseT = 0; partyPopT = 0.3;
    partyCount = 0; partyCountT = 0.9; partyFanfareT = -1;
    partyQueue.length = 0;
    for (const b of bubbles.slice().sort((p, q) => p.x - q.x)) partyQueue.push(b);
    partyN = partyQueue.length;
    S.cheer(); A.burst('confetti', 0, 0, 0);
    if (!isa) startIsabella(true); else { isa.party = true; isa.gift = false; }
  }
  function startChange() {
    phase = 'change'; phaseT = 0;
    fromScene = scene; scene = (scene + 1) % SCENES.length;
    counters.scenes++; save.filled++;
    const fs = A.friendScale(), r = fs / A.INSIDE;
    for (const f of friends) {
      const x = A.slotX(f.slot);
      leavers.push({ kind: f.kind, col: f.col, x, y: SEAT, sc: fs, t: 0, mode: 'float', seed: f.seed, delay: 0.15 + f.slot * 0.07, flip: f.flip,
        b: { x, y: SEAT, r, kind: f.kind, col: f.col, special: null, grow: 0, ph: f.seed, seed: f.seed, flip: f.flip, inner: null, keep: true } });
    }
    friends.length = 0; numerals.length = 0;
    persist();
    S.whoosh(); S.setKey(SCENES[scene].key); S.startMusic(scene, SCENES[scene].key);
    A.keepScenes(fromScene, scene);
  }
  function endChange() {
    phase = 'play'; phaseT = 0; fromScene = -1; idleT = 0;
    A.keepScenes(scene, scene);
    starters(); nextSpawn = 1.4; specialIn = Math.min(specialIn, 4); nextIsa = Math.max(nextIsa, 8);
  }
  function stepPhase(dt) {
    phaseT += dt;
    if (phase === 'play') {
      if ((nextSpawn -= dt) <= 0) { if (risingCount() < targetCount()) spawnOne(); nextSpawn = rnd(1.0, 1.8); }
    } else if (phase === 'party') {
      // the bubbles still floating pop by themselves, one after another, up a scale
      if ((partyPopT -= dt) <= 0 && partyQueue.length) { const b = partyQueue.shift(); pop(b, 0.12 + ((partyN - partyQueue.length) / Math.max(1, partyN)) * 0.85); partyPopT = 0.13; }
      if (partyCount < friends.length && (partyCountT -= dt) <= 0) {
        const f = friends[partyCount++];
        f.hopT = 0; f.hopH = 26; f.wig = 1;
        showNumeral(f.slot); S.friend(f.slot + 1); counters.countAlong = partyCount;
        partyCountT = 0.24;
        if (partyCount === friends.length) partyFanfareT = 0.4;
      }
      if (partyFanfareT > 0 && (partyFanfareT -= dt) <= 0) { S.party(); A.burst('confetti', 0, 0, 0); for (const f of friends) f.dance = 2.6; }
      if (phaseT > 5.6) startChange();
    } else if (phase === 'change') {
      if (phaseT > 2.6) endChange();
    }
  }

  // ---- input: every finger pops; sliding a finger pops what it passes ----
  const active = new Map();
  function hitBubble(x, y, slop) {
    if (y > FLOOR + 6) return null;
    let best = null, bd = 1e9;
    for (const b of bubbles) {
      const r = b.r * shown(b);
      if (b.y - r > FLOOR - 4) continue;   // still hidden behind the seabed
      const d = Math.hypot(x - b.x, y - b.y), lim = r + slop + (b.special === 'small' ? 8 : 0);
      if (d <= lim && d / lim < bd) { bd = d / lim; best = b; }
    }
    return best;
  }
  function hitIsabella(x, y) {
    if (!isa) return false;
    const dx = (x - (isa.x - 45 * isa.dir)) / 115, dy = (y - (isa.y - 9)) / 58;
    return dx * dx + dy * dy <= 1;
  }
  function hitFriend(x, y) {
    if (y < FLOOR - 40) return null;
    const half = A.slotSpacing() / 2;
    for (const f of friends) if (f.state === 'home' && Math.abs(x - A.slotX(f.slot)) <= half && Math.abs(y - SEAT) <= 58) return f;
    return null;
  }
  function tapAt(x, y) {
    const b = hitBubble(x, y, 16);
    if (b) { pop(b); return; }
    if (hitIsabella(x, y)) {
      counters.isabellaTaps++;
      if (isa.twirl <= 0) isa.twirl = 1;
      A.burst('hearts', isa.x + isa.dir * 50, isa.y - 40); S.giggle();
      return;
    }
    const f = hitFriend(x, y);
    if (f) {
      // a friend in the aquarium wiggles, sings its counting note, and shows its number again
      counters.friendTaps++; f.wig = 1; f.hopT = 0; f.hopH = 24; S.friend(f.slot + 1);
      A.burst('land', A.slotX(f.slot), SEAT - 6, 28, A.NUMCOL[f.slot]);
      showNumeral(f.slot);
      return;
    }
    counters.misses++; A.burst('ripple', x, y); S.ripple();
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const u = L ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
    return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
  }
  function swipe(x0, y0, x1, y1) {
    if (Math.min(y0, y1) > FLOOR + 6) return;
    for (const b of bubbles.slice()) {
      const r = b.r * shown(b);
      if (b.y - r > FLOOR - 4) continue;
      if (segDist(b.x, b.y, x0, y0, x1, y1) <= r + 4) pop(b);
    }
  }
  // held upright the sea is too narrow for ten places, so the game waits for the phone to turn
  const upright = () => window.innerHeight > window.innerWidth * 1.05;
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.init();
    if (upright()) return;
    idleT = 0; counters.downs++;
    counters.pointerTypes[e.pointerType] = (counters.pointerTypes[e.pointerType] || 0) + 1;
    const p = A.toWorld(e.clientX, e.clientY);
    active.set(e.pointerId, p);
    counters.maxPointers = Math.max(counters.maxPointers, active.size);
    tapAt(p.x, p.y);
  });
  window.addEventListener('pointermove', (e) => {
    const prev = active.get(e.pointerId);
    if (!prev) return;
    const p = A.toWorld(e.clientX, e.clientY);
    if (!upright()) swipe(prev.x, prev.y, p.x, p.y);
    active.set(e.pointerId, p);
  });
  // a lifted finger is what counts as a user gesture on touch screens, so try starting sound here too
  const lift = (e) => { active.delete(e.pointerId); if (e.type === 'pointerup') S.init(); };
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- navigation: home button and the Android back button go to the hub ----
  homeBtn.addEventListener('click', () => { persist(); location.href = '../../index.html'; });
  window.__back = () => { location.href = '../../index.html'; return true; };
  window.__pause = () => { S.suspend(); persist(); };
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
  window.addEventListener('resize', () => { A.resize(); measureHome(); });

  // ---- drawing ----
  const filled = new Array(SLOTS).fill(false);
  function drawFriend(f, glowy) {
    if (f.state === 'fly') {
      if (f.t < WIGGLE) {
        const u = f.t / WIGGLE;
        A.drawCreature(f.kind, f.col, f.x0, f.y0 - Math.sin(u * Math.PI) * 16, f.sc0 * (1 + 0.2 * Math.sin(u * Math.PI)), clock, { wig: 1, seed: f.seed, glow: glowy, flip: f.flip, happy: true });
      } else {
        const p = flyPos(f);
        A.drawCreature(f.kind, f.col, p.x, p.y, f.sc0 + (A.friendScale() - f.sc0) * p.u, clock,
          { wig: 0.35, seed: f.seed, glow: glowy, flip: f.flip, happy: true, rot: Math.sin(p.u * Math.PI) * 0.35 * (f.flip ? -1 : 1) });
      }
      return;
    }
    let lift = Math.sin(clock * 1.8 + f.seed) * 2.5;
    if (f.hopT != null) lift -= Math.sin((Math.PI * f.hopT) / 0.45) * f.hopH;
    if (f.dance > 0) lift -= Math.abs(Math.sin(clock * 6.5 + f.slot * 0.62)) * 16;
    A.drawCreature(f.kind, f.col, A.slotX(f.slot), SEAT + lift, A.friendScale(), clock, { wig: f.wig, seed: f.seed, glow: glowy, flip: f.flip, happy: f.dance > 0 });
  }
  function drawLeaver(L, glowy) {
    if (L.mode === 'swim') {
      A.drawCreature(L.kind, L.col, L.x, L.y, L.sc, clock, { wig: L.t < WIGGLE ? 1 : 0.3, seed: L.seed, glow: glowy, flip: L.t < WIGGLE ? false : L.flip, happy: true });
    } else if (L.b.grow <= 0) {
      A.drawCreature(L.kind, L.col, L.x, L.y, L.sc, clock, { seed: L.seed, flip: L.flip, happy: true, glow: glowy });
    } else {
      A.drawBubble(L.b, clock, glowy);
    }
  }
  function drawNumeral(m) {
    const t = m.t, top = SEAT - 132, bx = numX(m);
    let size, x = bx, y, a = 1;
    if (t < 0.32) { size = NUM * easeOutBack(t / 0.32); y = top; }
    else if (t < 1.15) { size = NUM; y = top - (t - 0.32) * 10; }
    else {
      // shrink down into the small numeral under the friend
      const u = smooth(clamp((t - 1.15) / 0.5, 0, 1));
      size = NUM + (25 - NUM) * u; x = bx + (A.slotX(m.slot) - bx) * u; y = top - 8.3 + (A.PEBBLE - top + 8.3) * u; a = 1 - u;
    }
    A.drawNumeral(m.n, x, y, size, A.NUMCOL[m.slot], a);
  }
  const hintOn = () => phase === 'play' && ((save.total === 0 && counters.pops === 0 && clock > 1.2) || idleT > 9);
  function hintBubble() {
    const ok = (b) => b.y < FLOOR - 70 && b.y > 120 && b.grow >= 1;
    let best = bubbles.find((b) => b.id === hintId && ok(b)), bd = 1e9;
    if (!best) {
      for (const b of bubbles) { if (!ok(b)) continue; const d = Math.abs(b.x - A.VW / 2) + Math.abs(b.y - 290) * 0.5; if (d < bd) { bd = d; best = b; } }
      hintId = best ? best.id : 0;
    }
    return best;
  }
  function draw() {
    A.begin();
    const glowy = !!SCENES[scene].glow;
    const k = phase === 'change' ? smooth(clamp((phaseT - 0.3) / 1.8, 0, 1)) : 1;
    if (fromScene >= 0) { A.drawBackdrop(fromScene, clock, 1); if (k > 0) A.drawBackdrop(scene, clock, k); }
    else A.drawBackdrop(scene, clock, 1);
    if (isa) {
      A.drawIsabella(isa.x, isa.y, clock, { scale: 1.45, flip: isa.dir < 0, happy: true, wave: clock * 9,
        tilt: Math.cos(isa.t * 1.4) * 0.1 + (isa.twirl > 0 ? smooth(1 - isa.twirl) * TAU * isa.dir : 0) });
    }
    for (const b of bubbles) A.drawBubble(b, clock, glowy);
    if (fromScene >= 0) { A.drawFloor(fromScene, 1); if (k > 0) A.drawFloor(scene, k); }
    else A.drawFloor(scene, 1);
    filled.fill(false);
    for (const f of friends) if (f.state === 'home') filled[f.slot] = true;
    A.drawSlots(filled, clock, 1, phase === 'play' && friends.length < SLOTS ? friends.length : -1);
    for (const f of friends) if (f.state === 'home') drawFriend(f, glowy);
    A.drawTank(1);
    for (const f of friends) if (f.state === 'fly') drawFriend(f, glowy);
    for (const L of leavers) drawLeaver(L, glowy);
    A.drawParts();
    for (const m of numerals) drawNumeral(m);
    if (hintOn()) { const b = hintBubble(); if (b) A.drawHand(b.x, b.y, clock); }
  }

  // ---- main loop ----
  function update(dt) {
    stepPhase(dt);
    stepBubbles(dt);
    const allHome = stepFriends(dt);
    if (phase === 'full') { if (allHome) { if ((fullT += dt) > 0.7) startParty(); } else fullT = 0; }
    stepLeavers(dt);
    for (let i = numerals.length - 1; i >= 0; i--) if ((numerals[i].t += dt) > 1.7) numerals.splice(i, 1);
    stepIsabella(dt);
    A.stepParts(dt);
  }
  const perf = new Float32Array(300);
  let perfN = 0;
  function frame(nowMs) {
    const t0 = performance.now();
    const raw = last ? (nowMs - last) / 1000 : 0;
    last = nowMs;
    const dt = Math.min(0.05, raw) * timeScale;
    counters.maxPopsInFrame = Math.max(counters.maxPopsInFrame, popsSinceFrame); popsSinceFrame = 0;
    if (upright()) { draw(); A.drawRotate(nowMs / 1000); requestAnimationFrame(frame); return; }   // paused until turned
    clock += dt;
    if (phase === 'play') idleT += dt;
    update(dt);
    draw();
    perf[perfN++ % perf.length] = performance.now() - t0;
    requestAnimationFrame(frame);
  }

  // ---- hooks for the headless tests (test/games/pop) ----
  window.__popDebug = {
    counters,
    state() {
      return { phase, scene, sceneId: SCENES[scene].id, aquarium: friends.map((f) => f.kind), landed: friends.filter((f) => f.state === 'home').length,
        total: save.total, filled: save.filled, kinds: Object.assign({}, save.kinds), bubbles: bubbles.length, leavers: leavers.length,
        numerals: numerals.map((m) => m.n), isabella: !!isa, muted, audio: S.state, gain: S.gain, VW: A.VW, scale: A.scale, dpr: A.dpr,
        canvas: [canvas.width, canvas.height], parts: A.partCount, notes: A.partsOfType('note') };
    },
    bubbles() {
      return bubbles.map((b) => {
        const r = b.r * shown(b), c = A.toClient(b.x, b.y);
        return { id: b.id, kind: b.kind, special: b.special, x: b.x, y: b.y, r, cx: c.x, cy: c.y, cr: (r * A.scale) / A.dpr, visible: b.y - r < FLOOR - 4 && b.y > 0 };
      });
    },
    friends() { return friends.map((f) => { const c = A.toClient(A.slotX(f.slot), SEAT); return { slot: f.slot, kind: f.kind, state: f.state, cx: c.x, cy: c.y }; }); },
    isabella() { if (!isa) return null; const c = A.toClient(isa.x - 45 * isa.dir, isa.y - 9); return { x: isa.x, y: isa.y, cx: c.x, cy: c.y }; },
    homeZone() { return homeZone; },
    slots() { return Array.from({ length: SLOTS }, (_, i) => A.slotX(i)); },
    spawn(o) {
      o = o || {};
      const b = makeBubble({ x: o.x != null ? o.x : A.VW / 2, y: o.y != null ? o.y : 260, special: o.special || null, kind: o.kind });
      if (o.still) b.vy = 0;
      return b.id;
    },
    startIsabella() { if (!isa) startIsabella(false); return true; },
    fill(n) {
      for (let i = 0; i < n && friends.length < SLOTS - 1; i++) { const k = pickKind(); friends.push(makeFriend(k[0], k[1], friends.length, true)); save.total++; }
      persist();
      return friends.length;
    },
    timeScale(k) { timeScale = k; return timeScale; },
    perf() {
      const n = Math.min(perfN, perf.length), a = Array.from(perf.slice(0, n)).sort((p, q) => p - q);
      return { frames: perfN, avgMs: a.reduce((s, v) => s + v, 0) / (n || 1), p95Ms: a[Math.floor(n * 0.95)] || 0, maxMs: a[n - 1] || 0 };
    },
    saved() { return store.get(SAVE_KEY); },
  };

  S.setKey(SCENES[scene].key);
  S.startMusic(scene, SCENES[scene].key);
  if (window.IsabellaStore) S.init();   // inside the Android app sound may start before the first tap
  measureHome();
  starters();
  requestAnimationFrame(frame);
})();
