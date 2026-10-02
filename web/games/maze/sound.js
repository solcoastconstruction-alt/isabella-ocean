/* Coral Maze — sound, all synthesised with WebAudio (no audio files). tone() and the music loop follow the
 * main game's web/audio.js and Shell Match's sound.js (copied, not shared). Everything is soft: a whoosh for a
 * glide, a bubbly boop for a wall, chimes for keys and gates, and no harsh sound anywhere, even when a
 * jellyfish bumps her. */
(function () {
  'use strict';
  let ctx = null, master = null, sfx, mus, noiseBuf = null, muted = false;
  let timer = null, nextT = 0, step = 0, song = null;
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Browsers only let sound start after a real user activation (a mouse press, or a finger lifting), so wait
  // for one instead of making a context that is refused. The Android app's WebView needs no gesture.
  function allowed() {
    const ua = navigator.userActivation;
    return !ua || ua.hasBeenActive || ua.isActive || !!window.IsabellaStore;
  }
  function init() {
    if (!allowed()) return;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(comp);
    sfx = ctx.createGain(); sfx.gain.value = 0.5; sfx.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; lp.connect(master);
    mus = ctx.createGain(); mus.gain.value = 0.12; mus.connect(lp);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.8), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (song) { const k = song.key; song = null; startMusic(k); }
  }
  const live = () => !!ctx && ctx.state !== 'closed';
  function tone(f, t0, dur, type, vol, f2, dest) {
    if (!live()) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // a soft filtered-noise whoosh
  function whoosh(t0, dur, f0, f1, vol) {
    if (!live() || !noiseBuf) return;
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; bp.type = 'bandpass'; bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(sfx);
    src.start(t0, Math.random() * 0.2); src.stop(t0 + dur + 0.05);
  }
  const now = (d) => (ctx ? ctx.currentTime + 0.01 + (d || 0) : 0);

  const S = {
    click() { const t = now(); tone(N(84), t, 0.06, 'sine', 0.18); },
    locked() { const t = now(); tone(N(55), t, 0.15, 'square', 0.06); tone(N(52), t + 0.18, 0.25, 'square', 0.06); },
    // a glide: a soft swish and a little rising blip
    swim() { const t = now(); whoosh(t, 0.32, 380, 1300, 0.22); tone(N(76), t, 0.09, 'sine', 0.07, N(81)); },
    // she comes to rest
    rest() { const t = now(); tone(N(64), t, 0.08, 'sine', 0.05, N(60)); },
    // swimming into a wall: a bubbly boop, never a buzz
    bonk() { const t = now(); tone(300, t, 0.14, 'sine', 0.16, 190); tone(N(79), t + 0.05, 0.06, 'sine', 0.05); },
    key() { const t = now(); [84, 88, 91, 96].forEach((m, i) => tone(N(m), t + i * 0.06, 0.3, 'triangle', 0.18)); tone(N(103), t + 0.26, 0.5, 'sine', 0.07); },
    // a gate without its key: a gentle "not yet"
    gateShut() { const t = now(); tone(N(67), t, 0.12, 'triangle', 0.12); tone(N(64), t + 0.13, 0.18, 'triangle', 0.1); },
    gate() {
      const t = now();
      whoosh(t, 0.6, 300, 1800, 0.18);
      [72, 79, 84, 91, 96].forEach((m, i) => tone(N(m), t + i * 0.07, 0.4, 'triangle', 0.14));
    },
    current() { const t = now(); whoosh(t, 0.65, 600, 260, 0.2); tone(N(69), t, 0.25, 'sine', 0.05, N(74)); },
    shell() { const t = now(); tone(N(81), t, 0.3, 'triangle', 0.15); tone(N(88), t + 0.1, 0.45, 'sine', 0.1); },
    // a patrol bumps her: a soft "boing" and bubbles
    hit() {
      const t = now();
      tone(520, t, 0.35, 'sine', 0.16, 260);
      for (let i = 0; i < 6; i++) tone(500 + Math.random() * 600, t + 0.15 + i * 0.07, 0.06, 'sine', 0.05, 900);
    },
    respawn() { const t = now(); [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.05, 0.22, 'sine', 0.12)); },
    hint() { const t = now(); tone(N(96), t, 0.4, 'sine', 0.05); tone(N(100), t + 0.12, 0.5, 'sine', 0.04); },
    shy() { const t = now(); tone(N(88), t, 0.08, 'sine', 0.05, N(93)); },
    intro() { const t = now(); [79, 84, 88].forEach((m, i) => tone(N(m), t + i * 0.08, 0.35, 'sine', 0.1)); },
    star(i) { const t = now(); tone(N(79 + i * 5), t, 0.5, 'triangle', 0.25); tone(N(91 + i * 5), t + 0.05, 0.4, 'sine', 0.1); },
    cheer() { const t = now(); tone(N(72), t, 0.18, 'sine', 0.15, N(79)); tone(N(76), t + 0.16, 0.3, 'sine', 0.15, N(84)); },
    fanfare(big) {
      const t = now();
      [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.13, 0.25, 'triangle', 0.3));
      [84, 88, 91].forEach((m) => tone(N(m), t + 0.55, 1.4, 'triangle', 0.18));
      tone(N(48), t + 0.55, 1.4, 'sine', 0.3);
      for (let i = 0; i < (big ? 44 : 28); i++) tone(N(88 + Math.floor(Math.random() * 10)), t + 0.6 + Math.random() * 2.6, 0.15, 'triangle', 0.08);
    },
  };

  // ---- gentle looping music: I-vi-IV-V, bass + arpeggio + a pentatonic tune (as in the main game) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeSong(key) {
    const lvl = typeof key === 'number' ? key : 0;
    const root = 60 + [0, 2, -3, 5, 0, 3, -2, 4, -1, 1][lvl % 10], rng = mulberry32(8642 + lvl * 77);
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    const mel = []; let p = 3;
    for (let i = 0; i < 32; i++) {
      if (rng() < 0.5) { mel.push(null); continue; }
      p = Math.max(0, Math.min(pent.length - 1, p + Math.floor(rng() * 5) - 2));
      mel.push(pent[p]);
    }
    return { key, root, mel, eighth: 60 / (lvl > 16 ? 84 : 92) / 2 };
  }
  const CH = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];
  function schedule() {
    if (!live() || !song) return;
    while (nextT < ctx.currentTime + 0.3) {
      const bar = Math.floor(step / 8) % 4, e = step % 8, ch = CH[bar], r = song.root;
      if (e === 0 || e === 4) tone(N(r - 24 + ch[0]), nextT, song.eighth * 3.5, 'sine', 0.3, null, mus);
      if (e % 2 === 1) tone(N(r + ch[(e >> 1) % 3]), nextT, song.eighth * 1.6, 'triangle', 0.09, null, mus);
      const m = song.mel[step % 32];
      if (m != null) tone(N(r + 12 + m), nextT, song.eighth * 1.8, 'sine', 0.15, null, mus);
      nextT += song.eighth; step++;
    }
  }
  function startMusic(key) {
    if (song && song.key === key && timer) return;
    song = makeSong(key);
    if (!ctx) return;
    step = 0; nextT = ctx.currentTime + 0.1;
    if (timer) clearInterval(timer);
    timer = setInterval(schedule, 60);
  }
  function stopMusic() { if (timer) clearInterval(timer); timer = null; song = null; }

  Object.assign(S, {
    init, startMusic, stopMusic,
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 1; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  });
  Object.defineProperties(S, {
    muted: { get: () => muted },
    gain: { get: () => (master ? master.gain.value : null) },   // null until the first tap starts sound
  });
  window.MazeSound = S;
})();
