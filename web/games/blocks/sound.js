/* Treasure Blocks — sound, all synthesised with WebAudio (no audio files). tone() and the music loop follow the main
 * game's web/audio.js and Sea Words' sound.js (copied, not shared). Everything is soft: a little tick for a slide, a
 * rising blip for a turn, a soft thud when a piece settles, a chime up the scale for each full row (higher for
 * several at once), a coin's ring, a long wash for Easy's wave, and the fanfare when the chest opens. When a round
 * ends with the well full there is a gentle lullaby turn, never a buzzer. */
(function () {
  'use strict';
  let ctx = null, master = null, sfx, mus, noiseBuf = null, muted = false;
  let timer = null, nextT = 0, step = 0, song = null;
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

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
    mus = ctx.createGain(); mus.gain.value = 0.1; mus.connect(lp);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.6), ctx.sampleRate);
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
  const note = (i) => N(72 + PENT[Math.max(0, Math.min(PENT.length - 1, i))]);

  const S = {
    click() { const t = now(); tone(N(84), t, 0.06, 'sine', 0.18); },
    // a slide to the next column: a soft tick (a little higher to the right)
    slide(dx) { const t = now(); tone(N(dx > 0 ? 81 : 79), t, 0.05, 'triangle', 0.07); },
    // a turn: a quick rising blip
    turn() { const t = now(); tone(N(76), t, 0.09, 'sine', 0.1, N(83)); },
    // a move that is not possible: one very soft low note
    nope() { const t = now(); tone(N(60), t, 0.08, 'sine', 0.05); },
    // a piece settles: a soft thud and a drip
    land() { const t = now(); tone(N(48), t, 0.12, 'sine', 0.22, N(41)); tone(N(72), t + 0.02, 0.07, 'triangle', 0.05); },
    // dropped: a short rush, then the thud
    drop() { const t = now(); whoosh(t, 0.14, 900, 300, 0.1); tone(N(45), t + 0.06, 0.16, 'sine', 0.26, N(38)); },
    // n full rows: a chime up the scale, longer and higher for more rows at once
    rows(n, k) {
      const t = now(), base = Math.min(5, k);
      for (let i = 0; i < 3 + n; i++) tone(note(base + i), t + i * 0.06, 0.34, 'triangle', 0.15);
      tone(note(base + 5 + n), t + (3 + n) * 0.06 + 0.02, 0.7, 'sine', 0.1);
      if (n > 1) tone(note(base + 7 + n), t + (3 + n) * 0.06 + 0.1, 0.8, 'sine', 0.07);
    },
    coin() { const t = now(); tone(N(88), t, 0.09, 'square', 0.05); tone(N(95), t + 0.07, 0.3, 'triangle', 0.13); },
    // a star lights on the way to the key
    pip(i) { const t = now(); tone(note(4 + i), t, 0.22, 'sine', 0.08); },
    // the mist clears from a band of the picture
    reveal() { const t = now(); whoosh(t, 0.5, 1400, 3200, 0.05); tone(N(96), t + 0.1, 0.5, 'sine', 0.04); },
    // Easy's wave washing through
    wave() { const t = now(); whoosh(t, 1.2, 240, 1300, 0.2); whoosh(t + 0.5, 0.9, 1200, 380, 0.12); for (let i = 0; i < 6; i++) tone(N(79 + i * 2), t + 0.3 + i * 0.11, 0.18, 'sine', 0.04); },
    // the key appears and flies to the chest
    key() { const t = now(); [84, 88, 91, 96].forEach((m, i) => tone(N(m), t + i * 0.07, 0.45, 'triangle', 0.14)); },
    // the well is full (Medium, Hard): a gentle falling turn, like a sigh, never a buzzer
    full() { const t = now(); [79, 76, 72, 67].forEach((m, i) => tone(N(m), t + i * 0.16, 0.5, 'sine', 0.1)); },
    intro() { const t = now(); [79, 84, 88].forEach((m, i) => tone(N(m), t + i * 0.08, 0.35, 'sine', 0.1)); },
    puff() { const t = now(); whoosh(t, 0.7, 260, 1400, 0.16); },
    cheer() { const t = now(); tone(N(72), t, 0.18, 'sine', 0.15, N(79)); tone(N(76), t + 0.16, 0.3, 'sine', 0.15, N(84)); },
    pop(i) { const t = now(); tone(N(79 + i * 4), t, 0.4, 'triangle', 0.2); tone(N(91 + i * 4), t + 0.05, 0.35, 'sine', 0.08); },
    fanfare(big) {
      const t = now();
      [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.13, 0.25, 'triangle', 0.3));
      [84, 88, 91].forEach((m) => tone(N(m), t + 0.55, 1.4, 'triangle', 0.18));
      tone(N(48), t + 0.55, 1.4, 'sine', 0.3);
      for (let i = 0; i < (big ? 40 : 24); i++) tone(N(88 + Math.floor(Math.random() * 10)), t + 0.6 + Math.random() * 2.4, 0.15, 'triangle', 0.08);
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
  const KEYS = { menu: 0, easy: 4, medium: -1, hard: 7 };
  function makeSong(key) {
    const rootK = 60 + (KEYS[key] || 0), rng = mulberry32(8128 + (KEYS[key] || 0) * 31);
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    const mel = []; let p = 3;
    for (let i = 0; i < 32; i++) {
      if (rng() < 0.55) { mel.push(null); continue; }
      p = Math.max(0, Math.min(pent.length - 1, p + Math.floor(rng() * 5) - 2));
      mel.push(pent[p]);
    }
    return { key, root: rootK, mel, eighth: 60 / (key === 'hard' ? 96 : key === 'medium' ? 90 : 84) / 2 };
  }
  const CH = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];
  function schedule() {
    if (!live() || !song) return;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;   // after a pause, never a pile of late notes at once
    while (nextT < ctx.currentTime + 0.3) {
      const bar = Math.floor(step / 8) % 4, e = step % 8, ch = CH[bar], r = song.root;
      if (e === 0 || e === 4) tone(N(r - 24 + ch[0]), nextT, song.eighth * 3.5, 'sine', 0.3, null, mus);
      if (e % 2 === 1) tone(N(r + ch[(e >> 1) % 3]), nextT, song.eighth * 1.6, 'triangle', 0.08, null, mus);
      const m = song.mel[step % 32];
      if (m != null) tone(N(r + 12 + m), nextT, song.eighth * 2, 'sine', 0.13, null, mus);
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
  window.BlocksSound = S;
})();
