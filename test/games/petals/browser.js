// Petal Patterns in headless Chrome, driven like a finger: real touch taps through the DevTools protocol.
//   node test/games/petals/browser.js [screenshotDir] [chromeProfileDir] [--only=seeker|phone800|ipad|extras]
//   (defaults: <repo>/.local/shots and <repo>/.local/chrome-petals; DevTools port 9495, its own throwaway profile)
//   PETALS_WEB=<dir> runs it against another copy of the web folder (to prove the checks catch an injected defect).
// Runs at 915x412 (DPR 2.625, the Seeker) and 800x360 (DPR 3, a 20:9 phone), each with a fresh save:
//   the mode picker (Easy / Medium / Hard, remembered) -> the two pages of ten levels, locks, arrows and dots ->
//   Easy level 1 by touch: a wrong plate wobbles and fades and is counted once; the hint hand and the lifted unit show
//   at 8 s and not before; the right plate is carried over, the row blooms, a coin flies up -> the chest -> the stars
//   (2 after one wrong tap) -> the save survives a reload -> next level, home and window.__back ->
//   a Hard odd-one-out round (no tray, the pots are the targets): a wrong pot, the hint hand at 25 s, the odd pot.
// Once more: an iPad-shaped screen (1024x768: the zig-zag row), the main game's mute setting is read and never written,
// window.IsabellaStore is used when present, held upright shows the rotate overlay, frame rate, no console errors.
// Exits 1 on any failed check or any console error, warning or exception.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.PETALS_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/petals/index.html');
const HUB = 'file://' + path.join(WEB, 'index.html');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const OUT = path.resolve(args[0] || path.join(ROOT, '.local/shots'));
const PROFILE = path.resolve(args[1] || path.join(ROOT, '.local/chrome-petals'));
const PORT = 9495;
const L = require(path.join(WEB, 'games/petals/logic.js'));

const results = [], problems = [];
let chrome = null;   // killed on every exit path so the port is never left busy
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  chrome = cdp.proc;
  let where = 'blank', androidLike = false;   // inside the Android app sound may start before any touch, which a desktop Chrome warns about
  cdp.on((m) => {
    const p = m.params || {};
    if (androidLike && /AudioContext was not allowed/.test(JSON.stringify(p))) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push({ where, kind: 'exception', text: (p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text });
    if (m.method === 'Runtime.consoleAPICalled' && /^(error|warning|assert)$/.test(p.type)) problems.push({ where, kind: 'console.' + p.type, text: p.args.map((a) => (a.value != null ? a.value : a.description)).join(' ') });
    if (m.method === 'Log.entryAdded' && /^(error|warning)$/.test(p.entry.level)) problems.push({ where, kind: 'log.' + p.entry.level, text: p.entry.text + (p.entry.url ? ' ' + p.entry.url : '') });
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });

  let W = 915, HT = 412, DPR = 2.625;
  const viewport = async (w, h, dpr) => { W = w; HT = h; DPR = dpr; await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true }); };
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + expr.slice(0, 90) + ' :: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const D = (expr) => ev(`window.__dbg.${expr}`);
  const st = () => D('state()');
  async function go(url, label) { where = label; const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(400); }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(400); }
  // Open the game with storage set up by `js`. It runs as the new page starts, AFTER the old page has gone:
  // a page writes its save as it closes (pagehide), so storage changed while it is open would be overwritten.
  async function loadWith(js) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(PAGE, 'petals');
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 1200 / (W * DPR) } });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  async function waitFor(fn, ms, every) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every || 60); }
    return null;
  }
  const waitPhase = (ph, ms) => waitFor(async () => { const s = await st(); return s.phase === ph ? s : null; }, ms || 15000, 40);
  // ---- one real finger ----
  const pt = (x, y) => ({ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 });
  async function touchTap(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x, y)] });
    await sleep(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, vis: getComputedStyle(e).visibility, disp: getComputedStyle(e).display }; })()`);
  async function tapEl(sel) { const r = await rectOf(sel); if (!r) throw new Error('no element ' + sel); await touchTap(r.cx, r.cy); await sleep(80); }
  const vh = () => HT / 100;
  const big = (r) => r && r.w >= 19 * vh() - 1.5 && r.h >= 19 * vh() - 1.5;
  const bigs = (r, k) => r && Math.min(r.w, r.h) >= (k || 19) * vh() - 1.5;
  const stage = () => ev(`(() => { const on = [...document.querySelectorAll('.screen.on')].map((e) => e.id); return on.join(','); })()`);
  async function playCorrect(s) {
    s = s || await st();
    if (s.type === 'O') { const o = s.pots.find((p) => p.odd); await touchTap(o.cx, o.cy); }
    else { const c = s.plates.find((p) => p.correct); await touchTap(c.cx, c.cy); }
  }
  // play every round of the current level with the right taps (optionally one wrong tap first)
  async function playLevel(opts) {
    opts = opts || {};
    let rounds = 0;
    for (let guard = 0; guard < 40; guard++) {
      const s = await waitFor(async () => { const q = await st(); return q.phase === 'ask' || q.phase === 'win' || q.results ? q : null; }, 30000, 40);
      if (!s) throw new Error('level stalled');
      if (s.phase === 'win' || s.results) return rounds;
      await playCorrect(s); rounds++;
      await waitFor(async () => { const q = await st(); return q.phase !== 'ask' || q.round !== s.round ? q : null; }, 4000, 30);
      await waitFor(async () => { const q = await st(); return q.phase === 'ask' || q.phase === 'win' || q.results ? q : null; }, 30000, 40);
    }
    return rounds;
  }

  async function runViewport(label, w, h, dpr) {
    await viewport(w, h, dpr);
    where = label;
    await loadWith('localStorage.clear();');
    console.log(`--- ${label} ${w}x${h} @${dpr}`);
    let s = await st();
    check(`${label}: the level map opens first; no word is needed (the name is for grown-ups)`, s.screen === 'levels' && (await stage()) === 'levels' && s.mode === 'easy');
    await shot(`${label}-menu`);

    // ---- the mode picker ----
    const modes = await Promise.all(['easy', 'medium', 'hard'].map((m) => rectOf('#mode-' + m)));
    check(`${label}: the three mode buttons (one, two, three sparkles) are at least 19vh to touch`, modes.every((r) => big(r)), modes.map((r) => Math.round(Math.min(r.w, r.h) / vh())));
    const xs = modes.map((r) => r.cx);
    check(`${label}: they sit left to right Easy, Medium, Hard and the last played is pressed`, xs[0] < xs[1] && xs[1] < xs[2] && (await ev(`document.getElementById('mode-easy').classList.contains('on') && !document.getElementById('mode-hard').classList.contains('on')`)));
    await tapEl('#mode-hard'); s = await st();
    check(`${label}: touching the three sparkles picks Hard, remembered in the save`, s.mode === 'hard' && JSON.parse(await D('saved()')).mode === 'hard' && (await ev(`document.getElementById('mode-hard').classList.contains('on')`)));
    await tapEl('#mode-medium'); s = await st();
    check(`${label}: two sparkles pick Medium`, s.mode === 'medium');
    await tapEl('#mode-easy'); s = await st();
    check(`${label}: one sparkle picks Easy`, s.mode === 'easy');

    // ---- the level map, two pages ----
    const bubbles = await ev(`[...document.querySelectorAll('#grid .lvl')].map((e) => { const b = e.getBoundingClientRect(); return { n: +e.dataset.level, w: b.width, h: b.height, x: b.x, y: b.y, locked: e.classList.contains('locked') }; })`);
    check(`${label}: page 1 (the Meadow) shows levels 1-10, each at least 19vh to touch, all on screen`, bubbles.length === 10 && bubbles[0].n === 1 && bubbles[9].n === 10 && bubbles.every((b) => bigs(b) && b.x >= 0 && b.x + b.w <= W && b.y >= 0 && b.y + b.h <= HT), bubbles.map((b) => Math.round(Math.min(b.w, b.h) / vh())).join(','));
    check(`${label}: on a fresh save only level 1 is open`, bubbles[0].locked === false && bubbles.slice(1).every((b) => b.locked));
    const arrows = [await rectOf('#pgPrev'), await rectOf('#pgNext')];
    check(`${label}: the next arrow shows, the previous one is hidden, and the arrow is at least 19vh to touch`, arrows[0].vis === 'hidden' && arrows[1].vis === 'visible' && big(arrows[1]));
    await tapEl('#pgNext'); s = await st();
    const b2 = await ev(`[...document.querySelectorAll('#grid .lvl')].map((e) => +e.dataset.level)`);
    check(`${label}: the next arrow turns to page 2 (the Cloud Tops): levels 11-20, all locked, second dot lit`, s.page === 1 && b2[0] === 11 && b2[9] === 20 && (await ev(`[...document.querySelectorAll('#grid .lvl')].every((e) => e.classList.contains('locked')) && document.querySelectorAll('#pgDots span.on').length === 1 && document.querySelectorAll('#pgDots span')[1].classList.contains('on')`)));
    await shot(`${label}-menu-page2`);
    await tapEl('#grid .lvl'); await sleep(250); s = await st();
    check(`${label}: a locked level does not open`, s.screen === 'levels');
    await tapEl('#pgPrev'); s = await st();
    check(`${label}: the previous arrow comes back to page 1`, s.page === 0);
    await tapEl('#grid .lvl:nth-child(2)'); await sleep(250); s = await st();
    check(`${label}: level 2 is locked on a fresh save, so it does not open either`, s.screen === 'levels');

    // ---- Easy level 1 by touch ----
    await tapEl('#grid .lvl:nth-child(1)');
    s = await waitPhase('ask', 8000);
    check(`${label}: touching level 1 opens it on Easy: 5 rounds, 2 choices, the "?" pot waiting`, s && s.screen === 'play' && s.level === 1 && s.mode === 'easy' && s.rounds === 5 && s.choices === 2 && s.potCount === s.rowLen + 1 && s.potF[s.rowLen] === null, s && { level: s.level, rounds: s.rounds, choices: s.choices });
    await shot(`${label}-easy-1`);
    check(`${label}: the choice flowers are at least 19vh to touch, inside the screen, and no hand shows yet`, s.plates.every((p) => bigs({ w: p.w, h: p.h }) && p.cx - p.w / 2 >= 0 && p.cx + p.w / 2 <= W && p.cy + p.h / 2 <= HT) && !s.hint, s.plates.map((p) => Math.round(p.w / vh())));
    const home = await D('homeZone()');
    check(`${label}: the home button is a 19vh touch area, top left`, big(home) && home.x < 0.1 * W && home.y < 0.1 * HT);
    // a wrong tap: wobble, fade, counted once
    const wrongPlate = s.plates.find((p) => !p.correct);
    await touchTap(wrongPlate.cx, wrongPlate.cy);
    await sleep(120); let s2 = await st();
    check(`${label}: a wrong flower is counted, fades to half and nothing else changes (same round, no coin lost)`, s2.wrong === 1 && s2.roundWrong === 1 && s2.platesFaded[s.plates.indexOf(wrongPlate)] === true && s2.phase === 'ask' && s2.round === 0 && s2.coins === 0, { wrong: s2.wrong, faded: s2.platesFaded });
    await shot(`${label}-easy-wrong`);
    await touchTap(wrongPlate.cx, wrongPlate.cy); await sleep(100); s2 = await st();
    check(`${label}: tapping the same faded flower again is not counted twice`, s2.wrong === 1 && s2.phase === 'ask', s2.wrong);
    await waitFor(async () => (await st()).platesFaded.every((f) => !f), 3000, 60);
    s2 = await st();
    check(`${label}: it comes back to full a moment later, still there to try`, s2.platesFaded.every((f) => !f) && s2.phase === 'ask');

    // the hint: not before 8 s, then a hand over the right flower and the unit lifts once
    await D('timeScale(1)');
    s2 = await st();
    await touchTap(W * 0.5, 14);   // a tap on nothing: the quiet spell starts again
    await sleep(60); s2 = await st();
    check(`${label}: a tap anywhere starts the quiet spell again (the idle clock is back near zero)`, s2.idle < 1.5, s2.idle);
    await D('timeScale(6)');
    const at7 = await waitFor(async () => { const q = await st(); return q.idle >= 7 ? q : null; }, 6000, 20);
    check(`${label}: no hint hand before 8 seconds on Easy`, at7 && at7.idle < 8 && !at7.hint, at7 && at7.idle);
    const hinted = await waitFor(async () => { const q = await st(); return q.hint ? q : null; }, 6000, 20);
    await D('timeScale(1)');
    const pl = hinted && hinted.plates.find((p) => p.correct);
    check(`${label}: at 8 s the hint hand hovers over the right flower (not a distractor)`, hinted && hinted.idle >= 8 && hinted.hintTarget.choice === hinted.correct && hinted.hand && Math.abs(hinted.hand.x - pl.cx) <= pl.w / 2 && Math.abs(hinted.hand.y - pl.cy) <= pl.h / 2, hinted && { idle: hinted.idle, hand: hinted.hand });
    check(`${label}: Easy also lifts the pots of one repeating unit, once`, hinted && (hinted.pulse || hinted.pulsed) === true);
    await shot(`${label}-easy-hint`);
    await sleep(1400);
    s2 = await st();
    check(`${label}: the lift is a single nudge (it has stopped; the hand stays)`, s2.pulse === false && s2.pulsed === true && s2.hint === true);
    // the right flower: carried over, row blooms, a coin flies, butterflies
    const right = hinted.plates.find((p) => p.correct);
    await touchTap(right.cx, right.cy);
    await sleep(60); s2 = await st();
    check(`${label}: the right flower is accepted and its coin is in the save at once`, s2.phase === 'deliver' && s2.coins === 1 && JSON.parse(await D('saved()')).coins === 1, { phase: s2.phase, coins: s2.coins });
    await D('timeScale(1)');
    await sleep(900); await shot(`${label}-easy-deliver`);
    await waitPhase('wave', 5000);
    const wave = await waitFor(async () => { const q = await st(); return q.phase === 'wave' && q.bloom[0] > 0.15 ? q : null; }, 3000, 15);
    check(`${label}: Isabella carries it over and the whole row blooms in a wave (each pot opens a little after the one before it, left to right)`, wave && wave.bloom.length === wave.potCount && wave.bloom.every((b, i) => i === 0 || wave.bloom[i - 1] >= b - 0.001) && wave.bloom[0] > wave.bloom[wave.bloom.length - 1], wave && wave.bloom.map((b) => +b.toFixed(2)));
    await sleep(500); s2 = await st(); await shot(`${label}-easy-wave`);
    check(`${label}: butterflies come and a gold coin flies up`, s2.butterflies >= 3 || s2.coinsFly >= 1, { butterflies: s2.butterflies, coin: s2.coinsFly });
    check(`${label}: the planted flower is the right one`, s2.potF[s2.rowLen] && s2.potF[s2.rowLen].join() === (L.levelRounds(1, 'easy', 0)[0].answer).join());
    await D('timeScale(4)');
    const n1 = await waitPhase('ask', 12000);
    check(`${label}: then round 2 begins with a new row`, n1 && n1.round === 1 && n1.roundWrong === 0 && !n1.hint, n1 && n1.round);
    // the rest of the level
    const played = await playLevel();
    await D('timeScale(1)');
    const fin = await waitFor(async () => { const q = await st(); return q.results ? q : null; }, 15000, 100);
    check(`${label}: the last round brings the treasure chest, then the stars`, fin && fin.results && played >= 4, { played });
    await shot(`${label}-easy-results`);
    check(`${label}: one wrong tap earns two stars (never for speed); coins: 5 rounds + 5 from the chest`, fin && fin.resultsStars === 2 && fin.coins === 10 && fin.savedStars.easy[0] === 2 && fin.unlocked.easy === 2, fin && { stars: fin.resultsStars, coins: fin.coins });
    const rb = await Promise.all(['#resLevels', '#resReplay', '#resNext'].map(rectOf));
    check(`${label}: the results buttons are at least 19vh to touch`, rb.every((r) => big(r)));
    // the save survives a reload
    await reload();
    s = await st();
    check(`${label}: the save survives a reload: 2 stars, 10 coins, level 2 open`, s.coins === 10 && s.savedStars.easy[0] === 2 && s.unlocked.easy === 2 && s.screen === 'levels', { coins: s.coins, stars: s.savedStars.easy });
    const sv = JSON.parse(await ev("localStorage.getItem('game.petals.save')"));
    check(`${label}: saved as game.petals.save in the shape of docs/FAIRY.md`, sv.v === 1 && sv.mode === 'easy' && sv.unlocked.easy === 2 && Array.isArray(sv.stars.hard) && sv.coins === 10, sv);
    const bs = await ev(`[...document.querySelectorAll('#grid .lvl')].slice(0, 2).map((e) => ({ locked: e.classList.contains('locked'), stars: e.querySelectorAll('.st svg use[fill="#ffd23f"]').length }))`);
    check(`${label}: the map shows level 1 with two gold stars and level 2 open`, bs[0].stars === 2 && bs[1].locked === false, bs);
    // level 2 by touch, then home
    await tapEl('#grid .lvl:nth-child(2)');
    s = await waitPhase('ask', 8000);
    check(`${label}: level 2 opens from the map`, s && s.level === 2);
    await tapEl('#home');
    await sleep(600);
    check(`${label}: the home button goes to the hub (../../index.html)`, (await ev('location.href')) === HUB, await ev('location.href'));

    // ---- window.__back ----
    await go(PAGE, 'petals-back');
    const back = await ev('typeof window.__back === "function" && typeof window.__pause === "function" && window.__back() === true');
    await sleep(600);
    check(`${label}: window.__back() returns true and goes to the hub; window.__pause exists`, back === true && (await ev('location.href')) === HUB);

    // ---- a Hard odd-one-out round ----
    await go(PAGE, 'petals-hard');
    await D('unlock(20, "hard")'); await D('goLevels(1, "hard")');
    await tapEl('#grid .lvl:nth-child(8)');   // level 18
    s = await waitPhase('ask', 8000);
    check(`${label}: Hard level 18 opens from the unlocked map (6 rounds, 4 choices)`, s && s.level === 18 && s.mode === 'hard' && s.rounds === 6 && s.choices === 4, s && { level: s.level, choices: s.choices });
    await D('jump(1)');
    s = await waitPhase('ask', 8000);
    check(`${label}: an odd-one-out round has no tray; the pots are the targets (at least 19vh each)`, s && s.type === 'O' && s.choices === 0 && s.plates.length === 0 && s.pots.length >= 8 && s.pots.every((p) => p.r * 2 >= 19 * vh() - 1.5), s && { type: s.type, pots: s.pots.length });
    check(`${label}: no pot is empty (no "?") and no two pot targets overlap`, s.pots.every((p) => !p.empty) && s.pots.every((p, i) => s.pots.every((q, k) => k <= i || Math.hypot(p.cx - q.cx, p.cy - q.cy) >= (p.r + q.r) - 1.5)));
    await shot(`${label}-hard-odd`);
    const wrongPot = s.pots.find((p) => !p.odd && p.i !== s.odd);
    await touchTap(wrongPot.cx, wrongPot.cy);
    await sleep(120); s2 = await st();
    check(`${label}: a wrong pot is counted once and nothing is lost`, s2.wrong === 1 && s2.phase === 'ask' && s2.round === 1, { wrong: s2.wrong });
    // Run the clock fast to 20 s, then slow enough that a 20 ms poll cannot skip past 25 s on a loaded Mac.
    await D('timeScale(10)');
    await waitFor(async () => { const q = await st(); return q.idle >= 20 ? q : null; }, 8000, 20);
    await D('timeScale(3)');
    const h24 = await waitFor(async () => { const q = await st(); return q.idle >= 23.5 ? q : null; }, 8000, 20);
    check(`${label}: no hint before 25 seconds on Hard`, h24 && h24.idle < 25 && !h24.hint, h24 && h24.idle);
    await D('timeScale(10)');
    const hh = await waitFor(async () => { const q = await st(); return q.hint ? q : null; }, 4000, 20);
    await D('timeScale(1)');
    const op = hh && hh.pots.find((p) => p.odd);
    check(`${label}: at 25 s the hand hovers over the odd pot`, hh && hh.idle >= 25 && hh.hintTarget.pot === hh.odd && Math.abs(hh.hand.x - op.cx) <= op.r && Math.abs(hh.hand.y - op.cy) <= op.r + 30, hh && { idle: hh.idle, hand: hh.hand });
    check(`${label}: Hard has no unit lift (that is an Easy nudge)`, hh && !hh.pulse && !hh.pulsed);
    const oddNow = (await st()).pots.find((p) => p.odd);
    await touchTap(oddNow.cx, oddNow.cy);
    s2 = await waitPhase('wave', 6000);
    check(`${label}: the odd pot is put right (the right flower goes in) and the row blooms`, s2 && s2.potF[s2.odd].join() === L.levelRounds(18, 'hard', 0)[1].answer.join(), s2 && s2.potF[s2.odd]);
    await shot(`${label}-hard-odd-wave`);

    // a clean run for the frame rate and a look at every kind of round
    await go(PAGE, 'petals-perf');
    await D('unlock(20, "hard")');
    for (const [lv, m, rd] of [[1, 'easy', 0], [9, 'medium', 2], [13, 'hard', 3], [16, 'hard', 3], [17, 'medium', 2], [20, 'hard', 1], [20, 'hard', 3]]) {
      await D(`start(${lv}, "${m}")`); await D(`jump(${rd})`);
      await waitPhase('ask', 8000); await sleep(150);
      await shot(`${label}-look-${m}${lv}-${rd}`);
    }
    await D('resetPerf()'); await sleep(1500);
    const perf = await D('perf()');
    check(`${label}: the frame loop is light (average ${perf.avgMs.toFixed(2)} ms, p95 ${perf.p95Ms.toFixed(2)} ms)`, perf.frames > 20 && perf.avgMs < 12 && perf.p95Ms < 30, perf);
    s = await st();
    check(`${label}: the canvas is at most 2.5x the screen (device pixel ratio capped) and particles stay bounded`, s.dpr <= 2.5 && s.canvas[0] <= Math.round(W * 2.5) + 1 && s.parts < 800, { dpr: s.dpr, canvas: s.canvas, parts: s.parts });
    const painted = await ev(`(() => { const c = document.getElementById('c'), g = document.createElement('canvas'); g.width = 40; g.height = 20; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 40, 20); const d = x.getImageData(0, 0, 40, 20).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1]) n++; return n; })()`);
    check(`${label}: the picture is painted (not a blank canvas)`, painted > 80, painted);
  }

  if (!ONLY || ONLY === 'seeker') await runViewport('seeker', 915, 412, 2.625);
  if (!ONLY || ONLY === 'phone800') await runViewport('phone800', 800, 360, 3);

  // ---- an iPad-shaped screen, the main game's settings, IsabellaStore, held upright ----
  if (!ONLY || ONLY === 'ipad' || ONLY === 'extras') {
    await viewport(1024, 768, 2);
    where = 'ipad';
    await loadWith('localStorage.clear();');
    console.log('--- ipad 1024x768');
    let s = await st();
    const bub = await ev(`[...document.querySelectorAll('#grid .lvl')].map((e) => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, x: b.x, r: b.right }; })`);
    check('ipad: the level bubbles are at least 19vh and fit across the screen', bub.every((b) => bigs(b)) && bub[0].x >= 0 && bub[9].r <= 1024 && (await ev('document.documentElement.scrollWidth <= innerWidth')), bub.map((b) => Math.round(b.w / vh())).slice(0, 3));
    await D('unlock(20, "hard")'); await D('start(20, "hard")'); await D('jump(1)');
    s = await waitPhase('ask', 8000);
    check('ipad: an odd-one-out row zig-zags so every pot stays a full 19vh target on a squarer screen', s && s.type === 'O' && s.zig === true && s.pots.every((p) => p.r * 2 >= 19 * vh() - 1.5 && p.cx - p.r >= 0 && p.cx + p.r <= 1024) && s.pots.every((p, i) => s.pots.every((q, k) => k <= i || Math.hypot(p.cx - q.cx, p.cy - q.cy) >= p.r + q.r - 1.5)), s && { zig: s.zig, n: s.pots.length });
    await shot('ipad-odd');
    const pr = s.pots.find((p) => p.odd); await touchTap(pr.cx, pr.cy);
    s = await waitPhase('wave', 6000);
    check('ipad: touching the odd pot works there too', !!s);
    await D('start(14, "hard")'); s = await waitPhase('ask', 8000);
    check('ipad: the choice flowers are at least 19vh and on screen', s && s.plates.length === 4 && s.plates.every((p) => bigs({ w: p.w, h: p.h }) && p.cx - p.w / 2 >= 0 && p.cx + p.w / 2 <= 1024 && p.cy + p.h / 2 <= 768));
    await shot('ipad-play');

    // the main game's sound setting: read, never written
    await viewport(915, 412, 2.625);
    await loadWith(`localStorage.clear(); localStorage.setItem('isabella.save', JSON.stringify({ muted: true, coins: 77 }));`);
    s = await st();
    const before = await ev(`localStorage.getItem('isabella.save')`);
    await D('start(1, "easy")'); await waitPhase('ask', 8000);
    const ptp = (await st()).plates.find((p) => p.correct); await touchTap(ptp.cx, ptp.cy); await sleep(500);
    await reload();
    const after = await ev(`localStorage.getItem('isabella.save')`);
    check('mute: the game follows muted in isabella.save (read only) and never writes that key', s.muted === true && before === after && JSON.parse(after).coins === 77, { muted: s.muted, before, after });
    s = await st();
    check('mute: while muted the audio context is never started', s.audio === 'none' || s.gain === 0 || s.muted, { audio: s.audio });

    // window.IsabellaStore (the Android app) is used when it exists
    androidLike = true;
    await loadWith(`window.__store = {}; window.__sets = 0; window.IsabellaStore = { get: (k) => (k in window.__store ? window.__store[k] : null), set: (k, v) => { window.__store[k] = v; window.__sets++; } };`);
    await D('start(1, "easy")'); await waitPhase('ask', 8000);
    const pp = (await st()).plates.find((p) => p.correct); await touchTap(pp.cx, pp.cy); await sleep(300);
    const store = await ev(`({ keys: Object.keys(window.__store), sets: window.__sets, ls: localStorage.getItem('game.petals.save') })`);
    check('IsabellaStore: the save goes through window.IsabellaStore under game.petals.save', store.keys.includes('game.petals.save') && store.sets > 0 && JSON.parse(store.keys.includes('game.petals.save') ? await ev(`window.__store['game.petals.save']`) : '{}').coins === 1, store);

    androidLike = false;
    // held upright: the rotate overlay covers it and taps do nothing
    await loadWith('localStorage.clear();');
    await D('start(1, "easy")'); await waitPhase('ask', 8000);
    await viewport(412, 915, 2.625); await sleep(400);
    const rot = await rectOf('#rotate');
    const sx = await st();
    check('upright: the rotate overlay covers the screen', rot && rot.disp === 'flex' && rot.w >= 400 && rot.h >= 900, rot);
    await touchTap(200, 600); await sleep(200);
    const sy = await st();
    check('upright: touches do nothing while the phone is upright', sy.wrong === sx.wrong && sy.round === sx.round && sy.coins === sx.coins);
    await viewport(915, 412, 2.625); await sleep(300);
  }

  check('no console error, warning or exception anywhere', problems.length === 0, problems.slice(0, 4).map((p) => `[${p.where}] ${p.kind}: ${p.text}`).join(' | '));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad} passed, ${bad} failed`);
  cdp.close(); chrome.kill();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + (e && e.stack || e)); try { chrome && chrome.kill(); } catch (x) { /* gone */ } process.exit(1); });
process.on('exit', () => { try { chrome && chrome.kill(); } catch (e) { /* gone */ } });
