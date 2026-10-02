/* Isabella the Mermaid — sound effects and music, synthesised (no audio files). */
(function () {
  'use strict';
  let ctx = null, master, sfx, mus, muted = false;
  let timer = null, nextT = 0, step = 0, song = null;
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = 0.55; sfx.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    mus = ctx.createGain(); mus.gain.value = 0.17; mus.connect(lp); lp.connect(master);
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
  const now = () => (ctx ? ctx.currentTime + 0.01 : 0);

  const S = {
    coin() { const t = now(); tone(N(83), t, 0.07, 'triangle', 0.25); tone(N(88), t + 0.07, 0.28, 'triangle', 0.25); },
    key() { const t = now(); [76, 79, 84, 88, 91, 96].forEach((m, i) => tone(N(m), t + i * 0.06, 0.3, 'triangle', 0.22)); tone(N(100), t + 0.4, 0.6, 'sine', 0.12); },
    hit() { const t = now(); tone(620, t, 0.28, 'sine', 0.35, 160); tone(300, t, 0.18, 'triangle', 0.15, 120); },
    heart() { const t = now(); [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.07, 0.25, 'sine', 0.25)); },
    checkpoint() { const t = now(); [79, 84, 88].forEach((m, i) => tone(N(m), t + i * 0.1, 0.7, 'sine', 0.22)); },
    lost() { const t = now(); [72, 69, 65, 60].forEach((m, i) => tone(N(m), t + i * 0.18, 0.35, 'triangle', 0.2)); },
    respawn() { const t = now(); tone(300, t, 0.4, 'sine', 0.25, 1000); },
    locked() { const t = now(); tone(N(55), t, 0.15, 'square', 0.08); tone(N(52), t + 0.18, 0.25, 'square', 0.08); },
    bubble() { const t = now(); tone(500, t, 0.1, 'sine', 0.15, 1200); },
    click() { const t = now(); tone(N(84), t, 0.06, 'sine', 0.18); },
    star(i) { const t = now(); tone(N(79 + i * 5), t, 0.5, 'triangle', 0.25); tone(N(91 + i * 5), t + 0.05, 0.4, 'sine', 0.1); },
    fanfare() {
      const t = now();
      [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.13, 0.25, 'triangle', 0.3));
      [84, 88, 91].forEach((m) => tone(N(m), t + 0.55, 1.4, 'triangle', 0.18));
      tone(N(48), t + 0.55, 1.4, 'sine', 0.3);
      // a shower of coin plings
      for (let i = 0; i < 28; i++) tone(N(88 + Math.floor(Math.random() * 10)), t + 0.6 + Math.random() * 2.6, 0.15, 'triangle', 0.08);
    },
  };

  // ---- gentle looping music: I-vi-IV-V, bass + arpeggio + a pentatonic tune ----
  const KEYS = { title: 0, 1: 0, 2: 2, 3: -3, 4: 5, 5: -2, 6: 3, 7: 4, 8: -5, 9: -1, 10: 7,
    11: 2, 12: -3, 13: 5, 14: -5, 15: 0, 16: 3, 17: 7, 18: -2, 19: 4, 20: 0 };
  function makeSong(key) {
    const root = 60 + (KEYS[key] || 0), rng = IsabellaCore.mulberry32(1234 + (typeof key === 'number' ? key * 77 : 0));
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    const mel = []; let p = 3;
    for (let i = 0; i < 32; i++) {
      if (rng() < 0.38) { mel.push(null); continue; }
      p = Math.max(0, Math.min(pent.length - 1, p + Math.floor(rng() * 5) - 2));
      mel.push(pent[p]);
    }
    const bpm = 104 + (typeof key === 'number' && key > 10 ? (key - 10) * 2 : 0); // world 2 gets a little brisker
    return { key, root, mel, eighth: 60 / bpm / 2 };
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

  window.IsabellaAudio = Object.assign(S, {
    init, startMusic, stopMusic,
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 1; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  });
  // A live getter: Object.assign would copy `muted` once and freeze it at false.
  Object.defineProperty(window.IsabellaAudio, 'muted', { get: () => muted, enumerable: true });
})();
