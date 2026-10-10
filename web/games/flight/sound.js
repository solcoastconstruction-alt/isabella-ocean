/* Fairy Flight: sound, synthesised with WebAudio (no audio files).
 * Every note is from the major pentatonic in the current forest's key, and the music is in the same
 * key, so any run of blooms is a little tune that fits. Nothing is harsh: a bonk gets a soft, comic
 * "bonk" and two falling notes, never a buzzer.
 * Helpers follow web/audio.js and web/games/catch/sound.js (copied, not shared). */
(function () {
  'use strict';
  let ctx = null, master = null, sfx, mus, noiseBuf = null, muted = false;
  let timer = null, nextT = 0, step = 0, song = null, key = 0;
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Browsers only let sound start after a real user activation (a mouse press, or a finger LIFTING:
  // touch pointerdown does not count), so wait for one instead of making a context that is refused.
  // The Android app's WebView needs no gesture, so there sound starts straight away.
  function allowed() {
    const ua = navigator.userActivation;
    return !ua || ua.hasBeenActive || ua.isActive || !!window.IsabellaStore;
  }
  function init() {
    if (muted || !allowed()) return;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    // a gentle limiter, so ten fingers popping at once never gets loud
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
    sfx = ctx.createGain(); sfx.gain.value = 0.5; sfx.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.connect(master);
    mus = ctx.createGain(); mus.gain.value = 0.12; mus.connect(lp);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (song) startMusic(song.idx, song.k);
  }
  // f2: glide to this pitch over `glide` seconds (a bloop)
  function tone(f, t0, dur, type, vol, f2, dest, glide) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + (glide || dur));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noiseHit(t0, dur, freq, q, vol) {
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(sfx);
    src.start(t0, Math.random() * 0.3); src.stop(t0 + dur + 0.02);
  }
  const live = () => !!ctx && !muted && ctx.state !== 'closed';
  const now = () => ctx.currentTime + 0.005;
  const note = (i, oct) => N(60 + key + (oct || 0) + PENT[clamp(i, 0, PENT.length - 1)]);

  const S = {
    // a bud blooms. u: 0..1 picks the note, so a run of blooms is a little rising tune in the forest's key
    bloom(u) {
      if (!live()) return;
      const t = now(), i = Math.round(clamp(u, 0, 1) * 6), f = note(i + 2, 12);
      tone(f, t, 0.5, 'sine', 0.2); tone(f * 2, t + 0.02, 0.3, 'triangle', 0.05);
      tone(note(i + 4, 12), t + 0.09, 0.45, 'triangle', 0.1); tone(note(i + 6, 12), t + 0.18, 0.5, 'sine', 0.07);
      noiseHit(t, 0.04, 6500, 2, 0.03);
    },
    // the wand sprinkles: a tiny twinkle
    dust(u) {
      if (!live()) return;
      const t = now(), f = note(5 + Math.round(clamp(u, 0, 1) * 4), 12);
      tone(f, t, 0.14, 'sine', 0.035); tone(f * 1.5, t + 0.05, 0.12, 'sine', 0.02);
    },
    rainbow() {
      if (!live()) return;
      const t = now();
      for (let k = 0; k < 8; k++) tone(note(k, 12), t + k * 0.07, 0.42, 'triangle', 0.12);
      tone(note(7, 24), t + 0.58, 0.9, 'sine', 0.06);
      tone(note(4, 24), t + 0.66, 0.9, 'sine', 0.04);
    },
    isabella() {
      if (!live()) return;
      const t = now();
      for (let k = 0; k < 7; k++) tone(note(k, 12), t + k * 0.05, 0.6, 'sine', 0.055);
    },
    giggle() {
      if (!live()) return;
      const t = now();
      [9, 7, 9, 7, 10].forEach((i, k) => tone(note(i, 12), t + k * 0.08, 0.12, 'triangle', 0.1, note(i, 12) * 1.06, sfx, 0.08));
    },
    // the chest is near: a soft bright chord with a sparkle on top
    cheer() {
      if (!live()) return;
      const t = now();
      [0, 2, 4].forEach((i, k) => tone(note(i, 12), t + k * 0.03, 0.9, 'triangle', 0.07));
      for (let k = 0; k < 6; k++) tone(note(5 + k, 12), t + 0.15 + k * 0.05, 0.3, 'sine', 0.04);
    },
    party() {
      if (!live()) return;
      const t = now();
      [0, 2, 3, 5].forEach((i, k) => tone(note(i, 12), t + k * 0.14, 0.3, 'triangle', 0.15));
      [5, 7, 8].forEach((i) => tone(note(i, 12), t + 0.6, 1.4, 'triangle', 0.08));
      tone(note(0, -12), t + 0.6, 1.4, 'sine', 0.22);
      for (let k = 0; k < 18; k++) tone(note(5 + Math.floor(Math.random() * 5), 12), t + 0.7 + Math.random() * 2.2, 0.18, 'sine', 0.05);
    },
    // a soft swoosh of wind as the forest scrolls in
    whoosh() {
      if (!live()) return;
      const t = now(), src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; src.loop = true;
      bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 1.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      src.connect(bp); bp.connect(g); g.connect(sfx); src.start(t); src.stop(t + 1.8);
      for (let k = 0; k < 5; k++) tone(note(k * 2, 0), t + 0.3 + k * 0.12, 0.7, 'sine', 0.05);
    },
    // the golden key: a bright sparkle running up the scale
    key() {
      if (!live()) return;
      const t = now();
      for (let k = 0; k < 6; k++) tone(note(4 + k, 12), t + k * 0.055, 0.35, 'triangle', 0.1);
      tone(note(10, 24), t + 0.36, 0.7, 'sine', 0.06);
      noiseHit(t, 0.05, 6500, 2, 0.05);
    },
    // a bug or critter bumps her: a soft hollow "bonk", like a coconut, then a little wobble down
    bonk() {
      if (!live()) return;
      const t = now();
      tone(N(55 + key), t, 0.16, 'sine', 0.3, N(43 + key), sfx, 0.12);
      tone(N(67 + key), t, 0.07, 'triangle', 0.08);
      noiseHit(t, 0.04, 700, 1.2, 0.12);
      tone(N(62 + key), t + 0.16, 0.14, 'sine', 0.08, N(57 + key), sfx, 0.12);
      tone(N(60 + key), t + 0.3, 0.16, 'sine', 0.06, N(55 + key), sfx, 0.14);
    },
    // a coin lands in its ring: a bright ching
    coin() {
      if (!live()) return;
      const t = now();
      tone(note(9, 12), t, 0.25, 'triangle', 0.16); tone(note(10, 12), t + 0.07, 0.5, 'triangle', 0.14);
      tone(note(10, 24), t + 0.07, 0.35, 'sine', 0.05);
      noiseHit(t, 0.04, 6000, 2, 0.06);
    },
    // a coin lost to a bonk: two soft falling notes (gentle, never a buzzer)
    coinLost() {
      if (!live()) return;
      const t = now() + 0.15;
      tone(note(4, 12), t, 0.3, 'sine', 0.09); tone(note(2, 12), t + 0.18, 0.45, 'sine', 0.08);
    },
    // a grumpy creature grumbles: a comic low "hmph-hmph" that wobbles down
    grumble() {
      if (!live()) return;
      const t = now();
      for (let k = 0; k < 2; k++) {
        const t0 = t + k * 0.2, f = N(48 + key - k * 2);
        tone(f * 1.25, t0, 0.17, 'triangle', 0.12, f, sfx, 0.15);
        tone(f * 2.5, t0, 0.12, 'sine', 0.03, f * 2, sfx, 0.1);
      }
    },
    // the treasure chest opens
    chest() { S.party(); S.coin(); },
    star(i) {
      if (!live()) return;
      const t = now();
      tone(note(4 + i * 2, 12), t, 0.5, 'triangle', 0.22); tone(note(4 + i * 2, 24), t + 0.05, 0.4, 'sine', 0.08);
    },
    click() { if (!live()) return; const t = now(); tone(note(7, 12), t, 0.07, 'sine', 0.16); },
    locked() { if (!live()) return; const t = now(); tone(note(0, -12), t, 0.15, 'triangle', 0.12); tone(note(0, -12) * 0.94, t + 0.17, 0.22, 'triangle', 0.1); },
  };

  // ---- soft looping music: I-vi-IV-V, bass + arpeggio + a sparse pentatonic tune, slower than the main game ----
  const CH = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];
  function makeSong(idx, k) {
    const rng = mulberry32(4321 + idx * 97), mel = [];
    let p = 3;
    for (let i = 0; i < 32; i++) {
      if (rng() < 0.45) { mel.push(null); continue; }
      p = clamp(p + Math.floor(rng() * 5) - 2, 0, 7);
      mel.push(PENT[p]);
    }
    return { idx, k, root: 60 + k, mel, eighth: 60 / 84 / 2 };
  }
  function schedule() {
    if (!ctx || !song || muted) return;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05; // after a pause, never play a pile of late notes at once
    while (nextT < ctx.currentTime + 0.3) {
      const bar = Math.floor(step / 8) % 4, e = step % 8, ch = CH[bar], r = song.root;
      if (e === 0 || e === 4) tone(N(r - 24 + ch[0]), nextT, song.eighth * 3.5, 'sine', 0.3, null, mus);
      if (e % 2 === 1) tone(N(r + ch[(e >> 1) % 3]), nextT, song.eighth * 1.6, 'triangle', 0.08, null, mus);
      const m = song.mel[step % 32];
      if (m != null) tone(N(r + 12 + m), nextT, song.eighth * 2.2, 'sine', 0.13, null, mus);
      nextT += song.eighth; step++;
    }
  }
  function startMusic(idx, k) {
    if (song && song.idx === idx && song.k === k && timer) return;
    song = makeSong(idx, k);
    if (!ctx) return;
    step = 0; nextT = ctx.currentTime + 0.1;
    if (timer) clearInterval(timer);
    timer = setInterval(schedule, 60);
  }
  function stopMusic() { if (timer) clearInterval(timer); timer = null; song = null; }

  const api = Object.assign(S, {
    init, startMusic, stopMusic,
    setKey(k) { key = k; },
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.9; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume(); },
  });
  // live read-outs (Object.assign would copy a getter's value once, so define them properly)
  Object.defineProperties(api, {
    muted: { get: () => muted },
    state: { get: () => (ctx ? ctx.state : 'none') },
    gain: { get: () => (master ? master.gain.value : null) },
  });
  window.FlightSound = api;
})();
