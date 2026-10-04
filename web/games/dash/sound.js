/* Splash Dash — sound, all synthesised with WebAudio (no audio files). tone(), whoosh() and the music loop
 * follow the main game's web/audio.js by way of Coral Maze's sound.js (copied, not shared). Everything is
 * soft: chimes for coins, a splash and a boing for a bump, a rush of water that grows with her speed. */
(function () {
  'use strict';
  let ctx = null, master = null, sfx, mus, noiseBuf = null, muted = false;
  let timer = null, nextT = 0, step = 0, song = null;
  let rushSrc = null, rushGain = null, rushBp = null, rushK = 0;
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

  const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  const S = {
    click() { const t = now(); tone(N(84), t, 0.06, 'sine', 0.18); },
    locked() { const t = now(); tone(N(55), t, 0.15, 'square', 0.06); tone(N(52), t + 0.18, 0.25, 'square', 0.06); },
    start() { const t = now(); [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.07, 0.3, 'sine', 0.11)); whoosh(t, 0.5, 400, 1400, 0.12); },
    // a coin: a little chime that climbs while she keeps collecting
    coin(streak) { const t = now(), m = 79 + PENT[Math.min(PENT.length - 1, streak | 0)]; tone(N(m), t, 0.16, 'triangle', 0.16); tone(N(m + 12), t + 0.03, 0.2, 'sine', 0.06); },
    airCoin(streak) { const t = now(), m = 84 + PENT[Math.min(PENT.length - 1, streak | 0)]; tone(N(m), t, 0.2, 'triangle', 0.17); tone(N(m + 7), t + 0.05, 0.25, 'sine', 0.08); },
    // the speed button: a rising swish
    boost() { const t = now(); whoosh(t, 0.45, 500, 2200, 0.16); tone(N(72), t, 0.22, 'sine', 0.06, N(84)); },
    // a bump: a splash and a soft boing, never a buzz. Each thing has its own little voice.
    bump(kind) {
      const t = now();
      whoosh(t, 0.4, 1600, 420, 0.3);
      tone(430, t, 0.3, 'sine', 0.15, 230);
      if (kind === 'buoy') { tone(N(88), t + 0.03, 0.7, 'triangle', 0.12); tone(N(95), t + 0.05, 0.55, 'sine', 0.06); }
      else if (kind === 'gull') { tone(820, t + 0.08, 0.13, 'triangle', 0.1, 620); tone(900, t + 0.26, 0.16, 'triangle', 0.1, 600); }
      else if (kind === 'log' || kind === 'boat') tone(170, t, 0.22, 'sine', 0.2, 110);
      else if (kind === 'wave') whoosh(t + 0.05, 0.6, 900, 300, 0.22);
    },
    spill() { const t = now(); tone(N(88), t + 0.05, 0.12, 'triangle', 0.1, N(81)); tone(N(81), t + 0.16, 0.2, 'triangle', 0.08, N(74)); },
    kelp() { const t = now(); whoosh(t, 0.55, 500, 220, 0.2); tone(N(57), t, 0.3, 'sine', 0.07, N(52)); },
    leap() { const t = now(); whoosh(t, 0.5, 700, 2600, 0.22); tone(N(72), t, 0.55, 'sine', 0.13, N(91)); },
    land() { const t = now(); whoosh(t, 0.45, 1800, 380, 0.28); tone(260, t, 0.2, 'sine', 0.1, 170); },
    bob() { const t = now(); tone(N(67), t, 0.14, 'sine', 0.07, N(72)); },
    line() { const t = now(); [79, 84, 88, 91].forEach((m, i) => tone(N(m), t + i * 0.08, 0.32, 'triangle', 0.16)); },
    star(i) { const t = now(); tone(N(79 + i * 5), t, 0.5, 'triangle', 0.25); tone(N(91 + i * 5), t + 0.05, 0.4, 'sine', 0.1); },
    cheer() { const t = now(); tone(N(72), t, 0.18, 'sine', 0.15, N(79)); tone(N(76), t + 0.16, 0.3, 'sine', 0.15, N(84)); },
    fanfare(big) {
      const t = now();
      [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.13, 0.25, 'triangle', 0.3));
      [84, 88, 91].forEach((m) => tone(N(m), t + 0.55, 1.4, 'triangle', 0.18));
      tone(N(48), t + 0.55, 1.4, 'sine', 0.3);
      for (let i = 0; i < (big ? 44 : 28); i++) tone(N(88 + Math.floor(Math.random() * 10)), t + 0.6 + Math.random() * 2.6, 0.15, 'triangle', 0.08);
    },
    // the water rushing by: one looping noise whose loudness and brightness follow her speed (k: 0 slow .. 1 fastest)
    rush(k) {
      if (!live() || !noiseBuf) return;
      if (!rushSrc) {
        rushSrc = ctx.createBufferSource(); rushBp = ctx.createBiquadFilter(); rushGain = ctx.createGain();
        rushSrc.buffer = noiseBuf; rushSrc.loop = true; rushBp.type = 'bandpass'; rushBp.Q.value = 0.8; rushGain.gain.value = 0;
        rushSrc.connect(rushBp); rushBp.connect(rushGain); rushGain.connect(sfx);
        rushSrc.start();
      }
      if (Math.abs(k - rushK) < 0.02 && k !== 0) return;
      rushK = k;
      rushGain.gain.setTargetAtTime(k < 0 ? 0 : 0.035 + 0.16 * k, ctx.currentTime, 0.12);
      rushBp.frequency.setTargetAtTime(520 + 1500 * Math.max(0, k), ctx.currentTime, 0.12);
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
    const root = 62 + [0, 2, -3, 5, 0, 3, -2, 4, -1, 1][lvl % 10], rng = mulberry32(2718 + lvl * 91);
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    const mel = []; let p = 3;
    for (let i = 0; i < 32; i++) {
      if (rng() < 0.5) { mel.push(null); continue; }
      p = Math.max(0, Math.min(pent.length - 1, p + Math.floor(rng() * 5) - 2));
      mel.push(pent[p]);
    }
    return { key, root, mel, eighth: 60 / (lvl > 16 ? 96 : 104) / 2 };
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
  window.DashSound = S;
})();
