/* Shell Match — sound, all synthesised (no audio files). tone() and the music loop follow the main
 * game's web/audio.js. Every creature has its own little call, so the sound of a shell helps her remember it. */
(function () {
  'use strict';
  let ctx = null, master, sfx, mus, noiseBuf = null, muted = false;
  let timer = null, nextT = 0, step = 0, song = null;
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = 0.55; sfx.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    mus = ctx.createGain(); mus.gain.value = 0.13; mus.connect(lp); lp.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (song) startMusic(song.key);
  }
  function tone(f, t0, dur, type, vol, f2, dest) {
    if (!ctx) return;
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
  // a soft filtered-noise whoosh, for shells sliding about
  function whoosh(t0, dur, f0, f1, vol) {
    if (!ctx || !noiseBuf) return;
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(sfx);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  const now = (d) => (ctx ? ctx.currentTime + 0.01 + (d || 0) : 0);

  // each creature's call
  const CALLS = {
    crab(t) { [0, 0.09, 0.18].forEach((d) => tone(N(93), t + d, 0.05, 'square', 0.07)); },
    clownfish(t) { tone(700, t, 0.12, 'sine', 0.2, 300); tone(760, t + 0.15, 0.12, 'sine', 0.18, 320); },
    puffer(t) { tone(180, t, 0.3, 'sine', 0.28, 720); tone(N(72), t + 0.22, 0.12, 'triangle', 0.1); },
    turtle(t) { tone(N(55), t, 0.22, 'triangle', 0.24); tone(N(59), t + 0.22, 0.3, 'triangle', 0.22); },
    seahorse(t) { for (let i = 0; i < 6; i++) tone(N(i % 2 ? 86 : 83), t + i * 0.055, 0.07, 'sine', 0.13); },
    whale(t) { tone(N(53), t, 0.75, 'sine', 0.3, N(48)); tone(N(65), t + 0.05, 0.6, 'sine', 0.07, N(60)); },
    octopus(t) { [67, 71, 74].forEach((m, i) => tone(N(m), t + i * 0.1, 0.12, 'triangle', 0.2, N(m) * 0.92)); },
    jelly(t) { for (let i = 0; i < 4; i++) tone(N(76 + (i % 2) * 2), t + i * 0.08, 0.1, 'sine', 0.15, N(78 - (i % 2) * 2)); },
    starfish(t) { [88, 91, 95, 100].forEach((m, i) => tone(N(m), t + i * 0.06, 0.2, 'triangle', 0.12)); },
    dolphin(t) { tone(1100, t, 0.12, 'sine', 0.16, 1800); tone(1200, t + 0.16, 0.14, 'sine', 0.16, 2000); },
  };

  const S = {
    click() { const t = now(); tone(N(84), t, 0.06, 'sine', 0.18); },
    locked() { const t = now(); tone(N(55), t, 0.15, 'square', 0.08); tone(N(52), t + 0.18, 0.25, 'square', 0.08); },
    open() { const t = now(); tone(520, t, 0.11, 'sine', 0.16, 1250); },
    close() { const t = now(); tone(340, t, 0.12, 'sine', 0.18, 170); tone(N(60), t, 0.08, 'triangle', 0.06); },
    creature(kind, delay) { const f = CALLS[kind]; if (f && ctx) f(now(0.06 + (delay || 0))); },
    match(streak, delay) {
      const t = now(delay), up = Math.min(streak, 5) * 2;
      [79, 83, 86, 91].forEach((m, i) => tone(N(m + up), t + i * 0.07, 0.35, 'triangle', 0.2));
      tone(N(98 + up), t + 0.3, 0.6, 'sine', 0.09);
    },
    pearl() { const t = now(); tone(N(96), t, 0.25, 'triangle', 0.16); tone(N(103), t + 0.06, 0.3, 'sine', 0.07); },
    peek() { const t = now(); [72, 76, 79, 84, 88].forEach((m, i) => tone(N(m), t + i * 0.05, 0.4, 'sine', 0.1)); },
    hide() { const t = now(); [84, 79, 76, 72].forEach((m, i) => tone(N(m), t + i * 0.05, 0.2, 'sine', 0.08)); },
    plop(i) { const t = now(i * 0.035); tone(260 + (i % 5) * 30, t, 0.09, 'sine', 0.1, 150); },
    swish() { const t = now(); whoosh(t, 0.8, 500, 2200, 0.25); tone(N(76), t + 0.65, 0.15, 'sine', 0.08); },
    wiggle() { const t = now(); for (let i = 0; i < 4; i++) tone(N(81 + (i % 2) * 3), t + i * 0.07, 0.06, 'triangle', 0.08); },
    poke(kind) { S.creature(kind); },
    star(i) { const t = now(); tone(N(79 + i * 5), t, 0.5, 'triangle', 0.25); tone(N(91 + i * 5), t + 0.05, 0.4, 'sine', 0.1); },
    cheer() { const t = now(); tone(N(72), t, 0.18, 'sine', 0.15, N(79)); tone(N(76), t + 0.16, 0.3, 'sine', 0.15, N(84)); },
    fanfare() {
      const t = now();
      [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.13, 0.25, 'triangle', 0.3));
      [84, 88, 91].forEach((m) => tone(N(m), t + 0.55, 1.4, 'triangle', 0.18));
      tone(N(48), t + 0.55, 1.4, 'sine', 0.3);
      for (let i = 0; i < 28; i++) tone(N(88 + Math.floor(Math.random() * 10)), t + 0.6 + Math.random() * 2.6, 0.15, 'triangle', 0.08);
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
  const KEYS = { menu: 0, 1: 2, 2: -3, 3: 5, 4: 0, 5: 3, 6: -2 };
  function makeSong(key) {
    const root = 60 + (KEYS[key] || 0), rng = mulberry32(4321 + (typeof key === 'number' ? key * 77 : 0));
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    const mel = []; let p = 3;
    for (let i = 0; i < 32; i++) {
      if (rng() < 0.45) { mel.push(null); continue; }
      p = Math.max(0, Math.min(pent.length - 1, p + Math.floor(rng() * 5) - 2));
      mel.push(pent[p]);
    }
    return { key, root, mel, eighth: 60 / 96 / 2 };
  }
  const CH = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];
  function schedule() {
    if (!ctx || !song) return;
    while (nextT < ctx.currentTime + 0.3) {
      const bar = Math.floor(step / 8) % 4, e = step % 8, ch = CH[bar], r = song.root;
      if (e === 0 || e === 4) tone(N(r - 24 + ch[0]), nextT, song.eighth * 3.5, 'sine', 0.32, null, mus);
      if (e % 2 === 1) tone(N(r + ch[(e >> 1) % 3]), nextT, song.eighth * 1.6, 'triangle', 0.1, null, mus);
      const m = song.mel[step % 32];
      if (m != null) tone(N(r + 12 + m), nextT, song.eighth * 1.8, 'sine', 0.16, null, mus);
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
  // live getters (Object.assign would copy a getter's value once, not the getter)
  Object.defineProperties(S, {
    muted: { get: () => muted },
    gain: { get: () => (master ? master.gain.value : null) },   // null until the first tap starts audio
  });
  window.MatchSound = S;
})();
