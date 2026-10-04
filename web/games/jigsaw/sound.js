/* Sea Jigsaw: sound, synthesised with WebAudio (no audio files).
 * Every note is from the major pentatonic in the puzzle's key, and the music is in the same key, so a run of
 * pieces clicking home is a little tune that fits. Nothing is harsh: a piece put in the wrong place makes a soft
 * tap, and a bonus coin drifting away makes a sound like a bubble, never a buzzer.
 * Helpers follow web/audio.js and Bubble Party's sound.js (copied, not shared). */
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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
    sfx = ctx.createGain(); sfx.gain.value = 0.5; sfx.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.connect(master);
    mus = ctx.createGain(); mus.gain.value = 0.11; mus.connect(lp);
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
    // a piece picked up: a soft rising bloop
    grab() { if (!live()) return; const t = now(); tone(note(2, 0), t, 0.16, 'sine', 0.14, note(7, 0), sfx, 0.1); },
    // a piece clicks home: a woody click, then a happy rising pair. u: 0..1 how far through the puzzle (the notes climb)
    snap(u) {
      if (!live()) return;
      const t = now(), i = Math.round(clamp(u, 0, 1) * 6);
      noiseHit(t, 0.035, 2400, 1.4, 0.34);
      tone(note(i, 0) * 0.5, t, 0.09, 'sine', 0.3, note(i, 0), sfx, 0.04);
      tone(note(i + 2, 12), t + 0.05, 0.3, 'triangle', 0.12); tone(note(i + 4, 12), t + 0.14, 0.42, 'triangle', 0.11);
      tone(note(i + 4, 24), t + 0.14, 0.3, 'sine', 0.035);
    },
    // a piece put down somewhere that is not its place: a soft tap, nothing more
    put() { if (!live()) return; const t = now(); noiseHit(t, 0.03, 900, 1.2, 0.16); tone(note(0, 0), t, 0.1, 'sine', 0.1, note(0, -5), sfx, 0.08); },
    // a piece put back in the tray
    back() { if (!live()) return; const t = now(); tone(note(4, 0), t, 0.14, 'sine', 0.1, note(1, 0), sfx, 0.1); },
    // a tap on a piece: it wiggles
    boop() { if (!live()) return; const t = now(); tone(note(5, 12), t, 0.12, 'sine', 0.08, note(4, 12), sfx, 0.1); },
    // a new piece slides into the tray
    deal() { if (!live()) return; const t = now(); tone(note(6, 12), t, 0.07, 'sine', 0.045, note(8, 12), sfx, 0.05); },
    // the picture button: a little "look!"
    peek() { if (!live()) return; const t = now(); tone(note(4, 12), t, 0.2, 'sine', 0.09); tone(note(6, 12), t + 0.09, 0.3, 'sine', 0.08); },
    // the hand shows where a piece goes
    hint() { if (!live()) return; const t = now(); tone(note(7, 12), t, 0.25, 'sine', 0.06); tone(note(9, 12), t + 0.14, 0.35, 'sine', 0.05); },
    // a bonus coin drifts away: a bubble, quiet and soft
    drift() { if (!live()) return; const t = now(); tone(note(5, 0), t, 0.22, 'sine', 0.05, note(7, 0), sfx, 0.18); },
    ripple() { if (!live()) return; const t = now(); tone(note(7, 12), t, 0.12, 'sine', 0.045, note(9, 12), sfx, 0.1); },
    // the last piece: a soft bright chord with a sparkle on top
    done() {
      if (!live()) return;
      const t = now();
      [0, 2, 4].forEach((i, k) => tone(note(i, 12), t + k * 0.03, 0.9, 'triangle', 0.08));
      for (let k = 0; k < 7; k++) tone(note(4 + k, 12), t + 0.15 + k * 0.05, 0.3, 'sine', 0.045);
    },
    // the key appears: a sparkly rising run
    key() { if (!live()) return; const t = now(); for (let k = 0; k < 6; k++) tone(note(4 + k, 12), t + k * 0.05, 0.3, 'triangle', 0.085); tone(note(10, 24), t + 0.3, 0.5, 'sine', 0.04); },
    // the chest pushes up out of the sand; the key flies to it
    whoosh() {
      if (!live()) return;
      const t = now(), src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; src.loop = true;
      bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2000, t + 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      src.connect(bp); bp.connect(g); g.connect(sfx); src.start(t); src.stop(t + 1.2);
    },
    // the key turns in the lock
    unlock() { if (!live()) return; const t = now(); noiseHit(t, 0.03, 3200, 2, 0.3); noiseHit(t + 0.09, 0.04, 1800, 1.5, 0.34); tone(note(0, -12), t + 0.09, 0.2, 'triangle', 0.14); },
    // the chest bursts open
    chest() {
      if (!live()) return;
      const t = now();
      [0, 2, 3, 5].forEach((i, k) => tone(note(i, 12), t + k * 0.13, 0.3, 'triangle', 0.15));
      [5, 7, 8].forEach((i) => tone(note(i, 12), t + 0.56, 1.4, 'triangle', 0.08));
      tone(note(0, -12), t + 0.56, 1.4, 'sine', 0.22);
      for (let k = 0; k < 16; k++) tone(note(5 + Math.floor(Math.random() * 5), 12), t + 0.66 + Math.random() * 2, 0.18, 'sine', 0.045);
    },
    // one coin counted: a bright ching, climbing as the count goes up
    coin(n) {
      if (!live()) return;
      const t = now(), i = 5 + (Math.max(0, n) % 5);
      tone(note(i, 12), t, 0.2, 'triangle', 0.13); tone(note(i, 24), t + 0.03, 0.26, 'sine', 0.04);
      noiseHit(t, 0.03, 6000, 2, 0.05);
    },
    // a bonus coin kept: a bigger, brighter one
    bonus(i) {
      if (!live()) return;
      const t = now();
      tone(note(6 + i * 2, 12), t, 0.5, 'triangle', 0.2); tone(note(6 + i * 2, 24), t + 0.05, 0.4, 'sine', 0.08); tone(note(8 + i * 2, 12), t + 0.1, 0.5, 'triangle', 0.12);
    },
    isabella() { if (!live()) return; const t = now(); for (let k = 0; k < 7; k++) tone(note(k, 12), t + k * 0.05, 0.6, 'sine', 0.05); },
    click() { if (!live()) return; const t = now(); tone(note(7, 12), t, 0.07, 'sine', 0.16); },
    locked() { if (!live()) return; const t = now(); tone(note(0, -12), t, 0.15, 'triangle', 0.12); tone(note(0, -12) * 0.94, t + 0.17, 0.22, 'triangle', 0.1); },
    rainbow() { if (!live()) return; const t = now(); for (let k = 0; k < 8; k++) tone(note(k, 12), t + k * 0.07, 0.42, 'triangle', 0.12); },
  };

  // ---- soft looping music: I-vi-IV-V, bass + arpeggio + a sparse pentatonic tune (as Bubble Party) ----
  const CH = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];
  function makeSong(idx, k) {
    const rng = mulberry32(7321 + idx * 97), mel = [];
    let p = 3;
    for (let i = 0; i < 32; i++) {
      if (rng() < 0.5) { mel.push(null); continue; }
      p = clamp(p + Math.floor(rng() * 5) - 2, 0, 7);
      mel.push(PENT[p]);
    }
    return { idx, k, root: 60 + k, mel, eighth: 60 / 80 / 2 };
  }
  function schedule() {
    if (!ctx || !song || muted) return;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;   // after a pause, never play a pile of late notes at once
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
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.9; if (!muted && ctx && ctx.state === 'suspended') ctx.resume(); },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume(); },
  });
  // live read-outs (Object.assign would copy a getter's value once, so define them properly)
  Object.defineProperties(api, {
    muted: { get: () => muted },
    state: { get: () => (ctx ? ctx.state : 'none') },
    gain: { get: () => (master ? master.gain.value : null) },
  });
  window.JigsawSound = api;
})();
