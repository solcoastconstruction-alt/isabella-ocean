// Coral Maze in headless Chrome at the Seeker's landscape sizes (915x412 and 800x360 CSS px, DPR 2.625, touch).
//   node test/games/maze/browser.js [outDir] [chromeProfileDir]
//   (defaults: $TMPDIR/coral-maze-shots and $TMPDIR/chrome-maze; DevTools port 9454)
// At each size: a fresh save opens on the level select (bubbles, padlocks, two pages, the fish and the shark, 19vh
// targets, nothing overlapping); Easy levels 1, 10 and 20 are played to the open sea on the solver's way, move by move
// through __mazeDebug.move (each glide scheduled for the tick the solver chose, so the patrols are where it expects);
// stars are saved and the next level unlocks. Then the shark is tapped with a finger: Hard's own pages, padlocks and
// stars; Hard 1 (tapped on its bubble), 10 and 20 are played on the solver's way while the view scrolls, and every
// sample of the game shows Isabella well inside the screen; Hard progress is saved beside Easy's, which stays as it
// was; Hard 20 earns the trophy; the biggest maze keeps its frame rate. The home button and Android back go to
// ../../index.html.
// Then, at 915x412, real fingers through Input.dispatchTouchEvent: whole levels by swipes and by taps (Easy and Hard),
// a sloppy diagonal, a bump into a wall; the hint after a quiet spell (20 s in Easy, 45 s in Hard); the mute switch
// shared with the main game's save (only its `muted` field changes, and an unreadable save is never overwritten); a
// real save from before Hard existed (her Easy progress opens as it was, and is still readable by the old code after
// Hard is played); window.IsabellaStore; the frame rate. No console errors, exceptions or failed loads anywhere.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'coral-maze-shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-maze'));
const PORT = 9454, DPR = 2.625;
const GAME = '/web/games/maze/index.html';
const zeros = () => new Array(20).fill(0);
const FRESH = { unlocked: 1, stars: zeros(), hard: { unlocked: 1, stars: zeros() }, mode: 'easy' };

// The save code of the game as it shipped before Hard (game.js at 91dedad), word for word: a new save must still
// read correctly with it (her Easy progress), in case an older copy of the game ever opens it.
const OLD_LOAD = `(() => {
  const NLEV = 20, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const store = { get: (k) => localStorage.getItem(k) }, SAVE_KEY = 'isabella.maze';
  const freshSave = () => ({ unlocked: 1, stars: new Array(NLEV).fill(0) });
  function loadSave() {
    const sv = freshSave();
    try {
      const raw = JSON.parse(store.get(SAVE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        sv.stars = Array.from({ length: NLEV }, (_, i) => clamp(Math.floor(Number((raw.stars || [])[i]) || 0), 0, 3));
        const beaten = sv.stars.reduce((m, st, i) => (st > 0 ? i + 1 : m), 0);
        sv.unlocked = clamp(Math.max(Math.floor(Number(raw.unlocked) || 1), beaten + 1), 1, NLEV);
      }
    } catch (e) { /* a broken save starts fresh */ }
    return sv;
  }
  return loadSave();
})()`;

let fails = 0, checks = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(REPO);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  let page;
  try {
    page = await openPage(PORT);
    const P = page;
    const st = () => P.eval('__mazeDebug.state');
    const shot = async (name) => { const f = await P.shot(path.join(OUT, name + '.png')); console.log(`        shot ${f}`); };
    const rectOf = (sel) => P.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' }; })()`);
    const tapEl = async (sel) => { const r = await rectOf(sel); await P.tap(r.x + r.w / 2, r.y + r.h / 2); };
    const savedRaw = () => P.eval(`localStorage.getItem('isabella.maze')`);
    const resting = () => P.waitFor('(() => { const s = __mazeDebug.state; return s.phase === "win" || (s.phase === "play" && s.resting && !s.queued); })()', 15000, 'Isabella to rest');
    // The solver's way out from where she is, each glide scheduled for its tick (so patrols are where it expects).
    async function playSolver(n, label) {
      await P.waitFor(`__mazeDebug.state.level === ${n}`, 4000);
      await sleep(250);
      const sol = await P.eval('__mazeDebug.autoplay()');
      await P.waitFor('__mazeDebug.state.screen === "results"', 60000, `level ${n} results`);
      await P.waitFor('document.querySelectorAll("#bigStars svg.pop").length === 3', 4000, 'the stars to pop');
      const s = await st();
      check(s.won && s.moves === sol.par && s.optimal === sol.par && s.resultsStars === 3,
        `${label}: level ${n} played on the solver's way through __mazeDebug.move: out in ${s.moves} moves (par ${s.optimal}), 3 stars`, { moves: s.moves, par: sol.par, stars: s.resultsStars });
      return s;
    }
    // Watch the view while she swims: every sample (about 8 a second) must show her well inside the screen (her middle
    // at least `margin` CSS px from every edge), and over the level the view must really have moved both ways.
    function viewWatch() { return { samples: 0, bad: [], minEdge: Infinity, cx: [Infinity, -Infinity], cy: [Infinity, -Infinity] }; }
    function sample(w, s, W, H) {
      if (!s || !s.view || !s.cam || (s.phase !== 'play' && s.phase !== 'win')) return;
      w.samples++;
      const edge = Math.min(s.view.x, s.view.y, W - s.view.x, H - s.view.y);
      w.minEdge = Math.min(w.minEdge, edge);
      if (edge < 25) w.bad.push({ phase: s.phase, cell: s.pos.cell, x: Math.round(s.view.x), y: Math.round(s.view.y) });
      w.cx = [Math.min(w.cx[0], s.cam.x), Math.max(w.cx[1], s.cam.x)]; w.cy = [Math.min(w.cy[0], s.cam.y), Math.max(w.cy[1], s.cam.y)];
    }
    async function playHard(n, label, W, H) {
      await P.waitFor(`__mazeDebug.state.level === ${n} && __mazeDebug.state.mode === 'hard'`, 4000);
      await sleep(300);
      const sol = await P.eval('__mazeDebug.autoplay()');
      const w = viewWatch(), t0 = Date.now();
      for (;;) {
        const s = await st();
        if (s.screen === 'results') break;
        sample(w, s, W, H);
        if (Date.now() - t0 > 180000) throw new Error(`hard ${n}: no results after 3 minutes`);
        await sleep(110);
      }
      await P.waitFor('document.querySelectorAll("#bigStars svg.pop").length === 3', 4000, 'the stars to pop');
      const s = await st();
      check(s.won && s.mode === 'hard' && s.moves === sol.par && s.optimal === sol.par && s.resultsStars === 3,
        `${label}: Hard ${n} (${s.size.w}x${s.size.h}) played on the solver's way: out in ${s.moves} moves (par ${s.optimal}), 3 stars`, { moves: s.moves, par: sol.par, stars: s.resultsStars });
      const cell = (await P.eval('__mazeDebug.state.cell')) || { w: 60 };
      check(w.samples > 20 && w.bad.length === 0, `${label}: Hard ${n}: in all ${w.samples} samples while she swam, Isabella stayed well inside the screen (closest to an edge: ${Math.round(w.minEdge)} px)`, w.bad.slice(0, 3));
      check(w.cx[1] - w.cx[0] > 2 * 84 && w.cy[1] - w.cy[0] > 84, `${label}: Hard ${n}: the view scrolled with her (${Math.round(w.cx[1] - w.cx[0])} world units across, ${Math.round(w.cy[1] - w.cy[0])} up and down)`, { cx: w.cx.map(Math.round), cy: w.cy.map(Math.round), cellPx: Math.round(cell.w) });
      return s;
    }

    for (const [W, H] of [[915, 412], [800, 360]]) {
      const tag = `${W}x${H}`;
      console.log(`\n${tag} CSS px at DPR ${DPR} (DevTools port ${PORT}, profile ${PROFILE})`);
      await P.viewport(W, H, DPR);
      await P.goto(base + GAME);
      await P.eval('localStorage.clear()');
      await P.goto(base + GAME);
      await sleep(500);
      let s = await st();
      check(s.screen === 'levels' && s.mode === 'easy' && JSON.stringify(s.save) === JSON.stringify(FRESH), `${tag}: opens on the level select, Easy, with a fresh save`, s.save);
      check(s.dpr === 2.5, `${tag}: canvas DPR capped at 2.5 (device ${DPR})`, s.dpr);
      const vh = H / 100;
      const sizes = {};
      for (const sel of ['.lvl', '#homeBtn', '#soundBtn', '#pgNext', '#modeEasy', '#modeHard']) { const r = await rectOf(sel); sizes[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(sizes).every((v) => v >= 19), `${tag}: level bubbles, home, sound, page buttons, the fish and the shark are at least 19vh`, sizes);
      check((await P.eval(`document.querySelectorAll('.lvl').length`)) === 10 && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 9, `${tag}: page 1 shows 10 bubbles, 9 with padlocks`);
      const ov = await P.eval(`(() => { const ids = ['title', 'grid', 'homeBtn', 'soundBtn', 'pgNext', 'pgDots', 'modeEasy', 'modeHard'], r = ids.map((i) => document.getElementById(i).getBoundingClientRect());
        r.push(document.querySelector('.pill').getBoundingClientRect()); ids.push('pill');
        const out = []; for (let i = 0; i < r.length; i++) { const a = r[i];
          if (a.left < 0 || a.top < 0 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) out.push(ids[i] + ' off screen');
          for (let j = i + 1; j < r.length; j++) { const b = r[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(ids[i] + '/' + ids[j]); } }
        return out; })()`);
      check(ov.length === 0, `${tag}: title, fish, shark, grid, star count, home, sound, page arrow and dots do not overlap or leave the screen`, ov);
      check((await P.eval(`document.getElementById('modeEasy').classList.contains('on') && !document.getElementById('modeHard').classList.contains('on')`)), `${tag}: the fish is lit (Easy), the shark faded`);
      await shot(`${tag}-01-levels`);
      await tapEl('.lvl[data-level="2"]');
      await sleep(150);
      check((await st()).screen === 'levels' && (await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)), `${tag}: a padlocked level only wiggles`);

      // ---- level 1 ----
      await tapEl('.lvl[data-level="1"]');
      s = await playSolver(1, tag);
      const res = {};
      for (const sel of ['#resLevels', '#resReplay', '#resNext']) { const r = await rectOf(sel); res[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(res).every((v) => v >= 19), `${tag}: results buttons are at least 19vh`, res);
      await shot(`${tag}-02-level1-results`);
      let sv = JSON.parse(await savedRaw());
      check(sv.stars[0] === 3 && sv.unlocked === 2, `${tag}: saved under isabella.maze: level 1 = 3 stars, level 2 unlocked`, { unlocked: sv.unlocked, stars: sv.stars });
      await tapEl('#resLevels');
      await sleep(300);
      check(!(await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('locked')`)) && (await P.eval(`document.querySelector('.lvl[data-level="3"]').classList.contains('locked')`)), `${tag}: level 2 now open on the level select, level 3 still padlocked`);

      // ---- level 10 (started directly: it is still padlocked for a fresh save) ----
      await P.eval('__mazeDebug.start(10)');
      s = await playSolver(10, tag);
      sv = JSON.parse(await savedRaw());
      check(sv.stars[9] === 3 && sv.unlocked === 11, `${tag}: level 10 saved with 3 stars and level 11 unlocked`, { unlocked: sv.unlocked, stars: sv.stars });
      await tapEl('#resLevels');
      await sleep(300);
      check((await st()).page === 1 && !(await P.eval(`document.querySelector('.lvl[data-level="11"]').classList.contains('locked')`)) && (await P.eval(`document.querySelector('.lvl[data-level="12"]').classList.contains('locked')`)), `${tag}: back on page 2, level 11 open and level 12 padlocked`);
      await shot(`${tag}-03-levels-page2`);
      await tapEl('#pgPrev');
      await sleep(250);
      check((await st()).page === 0 && (await P.eval(`document.querySelector('.lvl[data-level="10"] .st svg use').getAttribute('fill')`)) === '#ffd23f', `${tag}: the page arrow goes back to page 1, where level 10 shows its stars`);

      // ---- level 20 ----
      await P.eval('__mazeDebug.start(20)');
      await P.eval('__mazeDebug.resetPerf()');
      await sleep(2500);
      const perf = await P.eval('__mazeDebug.perf()');
      s = await playSolver(20, tag);
      sv = JSON.parse(await savedRaw());
      check(sv.stars[19] === 3 && sv.unlocked === 20 && s.crown === true, `${tag}: level 20 saved with 3 stars, and Isabella has her crown`, { stars: sv.stars[19], unlocked: sv.unlocked, crown: s.crown });
      check((await rectOf('#resCrown')).vis && !(await rectOf('#resNext')).vis && !(await rectOf('#resTrophy')).vis, `${tag}: the last Easy level's results show the crown and no "next" button`);
      console.log(`        frame stats, level 20 in the dark (headless, ${Math.round(W * 2.5)}x${Math.round(H * 2.5)} canvas): ${JSON.stringify(perf, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`);
      check(perf.fps > 50 && perf.drawP95Ms < 10, `${tag}: level 20 draws at over 50 fps with p95 draw time under 10 ms`, { fps: +perf.fps.toFixed(1), p95: +perf.drawP95Ms.toFixed(2) });
      await shot(`${tag}-04-level20-results`);
      const easySaved = JSON.parse(await savedRaw());

      // ================= Hard: the shark =================
      await tapEl('#resLevels');
      await sleep(300);
      check((await st()).mode === 'easy', `${tag}: back on the Easy level select`);
      await tapEl('#modeHard');   // a real finger on the shark
      await sleep(400);
      s = await st();
      const hardGrid = await P.eval(`({ n: document.querySelectorAll('.lvl').length, locked: document.querySelectorAll('.lvl.locked').length, hard: document.querySelectorAll('.lvl[data-mode="hard"]').length,
        stars: document.getElementById('starCount').textContent, shark: document.getElementById('modeHard').classList.contains('on'), fish: document.getElementById('modeEasy').classList.contains('on'), gridHard: document.getElementById('grid').classList.contains('hard') })`);
      check(s.screen === 'levels' && s.mode === 'hard' && s.page === 0 && hardGrid.n === 10 && hardGrid.hard === 10 && hardGrid.locked === 9 && hardGrid.stars === '0/60' && hardGrid.shark && !hardGrid.fish && hardGrid.gridHard,
        `${tag}: tapping the shark shows Hard: its own first page, level 1 open and 9 padlocks, 0/60 stars, the shark lit`, hardGrid);
      sv = JSON.parse(await savedRaw());
      check(sv.mode === 'hard' && sv.unlocked === easySaved.unlocked && JSON.stringify(sv.stars) === JSON.stringify(easySaved.stars), `${tag}: the mode is remembered, and Easy's progress is untouched`, { mode: sv.mode, unlocked: sv.unlocked });
      await shot(`${tag}-05-hard-levels`);
      await tapEl('#modeEasy');
      await sleep(300);
      check((await st()).mode === 'easy' && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 0 && (await P.eval(`document.querySelector('.lvl[data-level="20"] .st svg use').getAttribute('fill')`)) === '#ffd23f', `${tag}: the fish goes back to Easy, with all her Easy progress`);
      await tapEl('#modeHard');
      await sleep(300);
      // ---- Hard 1, from its bubble ----
      await tapEl('.lvl[data-level="1"]');
      s = await playHard(1, tag, W, H);
      sv = JSON.parse(await savedRaw());
      check(sv.hard.stars[0] === 3 && sv.hard.unlocked === 2 && sv.unlocked === easySaved.unlocked && JSON.stringify(sv.stars) === JSON.stringify(easySaved.stars),
        `${tag}: Hard progress saved on its own (Hard 1 = 3 stars, Hard 2 open), Easy's untouched`, { hard: sv.hard, easyUnlocked: sv.unlocked });
      await shot(`${tag}-06-hard1-results`);
      await tapEl('#resLevels');
      await sleep(300);
      check((await st()).mode === 'hard' && !(await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('locked')`)) && (await P.eval(`document.querySelector('.lvl[data-level="3"]').classList.contains('locked')`)) && (await P.eval(`document.getElementById('starCount').textContent`)) === '3/60',
        `${tag}: back on Hard's level select: Hard 2 open, Hard 3 padlocked, 3/60 stars`);
      // ---- Hard 10 ----
      await P.eval(`__mazeDebug.start(10, 'hard')`);
      s = await playHard(10, tag, W, H);
      sv = JSON.parse(await savedRaw());
      check(sv.hard.stars[9] === 3 && sv.hard.unlocked === 11, `${tag}: Hard 10 saved with 3 stars and Hard 11 open`, sv.hard);
      // ---- Hard 20: the biggest maze ----
      await P.eval(`__mazeDebug.start(20, 'hard')`);
      await P.eval('__mazeDebug.resetPerf()');
      await sleep(2500);
      const hperf = await P.eval('__mazeDebug.perf()'), hs = await st();
      s = await playHard(20, tag, W, H);
      const hperf2 = await P.eval('__mazeDebug.perf()');
      sv = JSON.parse(await savedRaw());
      check(sv.hard.stars[19] === 3 && s.trophy === true && (await rectOf('#resTrophy')).vis && !(await rectOf('#resCrown')).vis && !(await rectOf('#resNext')).vis,
        `${tag}: Hard 20 saved with 3 stars; its results show the golden trophy, no crown and no "next" button`, { stars: sv.hard.stars[19], trophy: s.trophy });
      console.log(`        frame stats, Hard 20 (${hs.size.w}x${hs.size.h} cells, dark, the biggest; headless, ${Math.round(W * 2.5)}x${Math.round(H * 2.5)} canvas): resting ${JSON.stringify(hperf, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}; whole level ${JSON.stringify(hperf2, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}; reef tiles ${JSON.stringify(hs.tiles)}`);
      check(hperf.fps > 50 && hperf.drawP95Ms < 10 && hperf2.fps > 50 && hperf2.drawP95Ms < 10, `${tag}: Hard 20 draws at over 50 fps with p95 draw time under 10 ms, resting and swimming the whole level`, { fps: +hperf2.fps.toFixed(1), p95: +hperf2.drawP95Ms.toFixed(2), max: +hperf2.drawMaxMs.toFixed(2) });
      await shot(`${tag}-07-hard20-results`);
      await tapEl('#resLevels');
      await sleep(300);
      check((await P.eval(`document.getElementById('modeHard').classList.contains('won')`)) && (await rectOf('#modeHard .trophy')).vis, `${tag}: the shark wears the trophy on the level select`);

      // ---- home ----
      await tapEl('#homeBtn');
      await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button to reach the hub');
      check(true, `${tag}: the home button goes to ../../index.html (the hub)`);
    }

    // ================= real fingers (915x412) =================
    console.log('\nreal touch input through Input.dispatchTouchEvent (915x412)');
    await P.viewport(915, 412, DPR);
    await P.goto(base + GAME);
    await P.eval('localStorage.clear()');
    await P.goto(base + GAME);
    await sleep(400);
    // Swipe from Isabella in the plan's direction, 16vh long, then wait for her to rest.
    const swipeDir = async (dir, len, slant) => {
      const p = await P.eval('__mazeDebug.isabellaCss()'), d = 412 * (len || 0.16), k = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[dir];
      const sx = slant || 0;   // a sloppy finger: drift sideways by this fraction of the length
      await P.swipe(p.x, p.y, p.x + k[0] * d + k[1] * d * sx, p.y + k[1] * d + k[0] * d * sx, 6, 16);
    };
    async function playBySwipes(n, slantEvery, mode) {
      await P.eval(`__mazeDebug.start(${n}, '${mode || 'easy'}')`);
      await sleep(1000);
      const sol = await P.eval('__mazeDebug.solve()');
      const w = viewWatch();
      let i = 0;
      for (const step of sol.steps) {
        await swipeDir(step.dir, 0.16, slantEvery && i % slantEvery === 1 ? 0.6 : 0);
        await resting();
        if (mode === 'hard') sample(w, await st(), 915, 412);
        i++;
      }
      await P.waitFor('__mazeDebug.state.phase === "win"', 5000, `level ${n} won by swipes`);
      return { s: await st(), par: sol.par, w };
    }
    let t = await playBySwipes(1, 0);
    check(t.s.won && t.s.moves === t.par, `level 1 played with real touch swipes: out to the open sea in ${t.s.moves} swipes (par ${t.par})`);
    await P.waitFor('__mazeDebug.state.screen === "results"', 6000);
    t = await playBySwipes(6, 2);
    check(t.s.won && t.s.moves === t.par, `level 6 (key and gate) played with real touch swipes, every other one a sloppy diagonal: out in ${t.s.moves} (par ${t.par})`);
    await P.waitFor('__mazeDebug.state.screen === "results"', 6000);
    await shot('touch-01-level6-swiped-results');
    // a whole Hard level by finger, from wherever the view has put her
    t = await playBySwipes(1, 3, 'hard');
    check(t.s.won && t.s.mode === 'hard' && t.s.moves === t.par && t.w.bad.length === 0, `Hard 1 played with real touch swipes (every third a sloppy diagonal) as the view scrolled: out in ${t.s.moves} swipes (par ${t.par}), Isabella on screen at every rest`, { bad: t.w.bad.slice(0, 3), minEdge: Math.round(t.w.minEdge) });
    await P.waitFor('__mazeDebug.state.screen === "results"', 8000);
    check(JSON.parse(await savedRaw()).hard.stars[0] === 3, 'Hard 1 by finger: 3 stars saved in Hard');
    await shot('touch-02-hard1-swiped-results');

    // a whole level by tapping spots along her tunnel (the end of each of the solver's glides)
    await P.eval('__mazeDebug.start(3)');
    await sleep(1000);
    let sol = await P.eval('__mazeDebug.solve()');
    for (const step of sol.steps) {
      const target = step.cells[step.cells.length - 1], c = await P.eval(`__mazeDebug.cellCss(${target})`);
      await P.tap(c.x, c.y);
      await resting();
    }
    t = { s: await st() };
    check(t.s.won && t.s.moves === sol.par, `level 3 played with real taps on the spot to swim to: out in ${t.s.moves} taps (par ${sol.par})`);
    await P.waitFor('__mazeDebug.state.screen === "results"', 6000);
    // in Hard the taps go through the moving view: the first glides of Hard 3 by tapping where each one ends (a spot
    // beyond the edge of the screen cannot be tapped, so that glide is swiped)
    await P.eval(`__mazeDebug.start(3, 'hard')`);
    await sleep(1000);
    sol = await P.eval('__mazeDebug.solve()');
    let tapped = 0, tapOk = true;
    for (const step of sol.steps.slice(0, 16)) {
      const target = step.cells[step.cells.length - 1], c = await P.eval(`__mazeDebug.cellCss(${target})`);
      const onScreen = c.x > 20 && c.y > 20 && c.x < 895 && c.y < 392;
      if (onScreen) await P.tap(c.x, c.y); else await swipeDir(step.dir, 0.16, 0);
      await resting();
      const s2 = await st();
      if (s2.pos.cell !== target) { tapOk = false; break; }
      if (onScreen) tapped++;
    }
    check(tapOk && tapped >= 10, `Hard 3: ${tapped} glides by tapping the spot to swim to, through the scrolled view, each landing on the cell tapped`);

    // a tap far along a straight tunnel passes side openings in one move; a swipe would stop at each
    await P.eval('__mazeDebug.start(8)');
    await sleep(1000);
    const far = await P.eval(`(() => { for (const d of ['up', 'right', 'down', 'left']) { const run = __mazeDebug.tapRun(d); if (run.length >= 2) return { d, cell: run[run.length - 1], n: run.length }; } return null; })()`);
    if (far) {
      const before = await st(), c = await P.eval(`__mazeDebug.cellCss(${far.cell})`);
      await P.tap(c.x, c.y);
      await resting();
      const after = await st();
      check(after.pos.cell === far.cell && after.moves === before.moves + 1, `a tap ${far.n} cells along the tunnel goes straight there in one move`, { from: before.pos.cell, to: after.pos.cell, target: far.cell });
    }

    // swiping into a wall: a little bump, no move counted; a diagonal whose bigger part is a wall uses the smaller part
    await P.eval('__mazeDebug.start(1)');
    await sleep(1000);
    const walls = await P.eval(`(() => { const lv = MazeLogic.build(1), st = MazeLogic.newState(lv), out = [];
      for (let d = 0; d < 4; d++) out.push(MazeLogic.canPass(lv, st, lv.start, d)); return out; })()`);
    const blocked = ['up', 'right', 'down', 'left'].filter((d, i) => !walls[i]), open = ['up', 'right', 'down', 'left'].filter((d, i) => walls[i]);
    let before = await st();
    await swipeDir(blocked[0], 0.16, 0);
    await sleep(500);
    let after = await st();
    check(after.pos.cell === before.pos.cell && after.moves === before.moves, `a swipe into a wall (${blocked[0]}) only bumps: no move, no penalty`, { moves: after.moves });
    // a diagonal: mostly toward a wall, partly toward an open way
    const perp = { up: ['left', 'right'], down: ['left', 'right'], left: ['up', 'down'], right: ['up', 'down'] };
    const pair = blocked.map((b) => [b, perp[b].find((o) => open.includes(o))]).find((x) => x[1]);
    if (pair) {
      const p = await P.eval('__mazeDebug.isabellaCss()'), k = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }, d = 412 * 0.16;
      const vx = k[pair[0]][0] * d + k[pair[1]][0] * d * 0.7, vy = k[pair[0]][1] * d + k[pair[1]][1] * d * 0.7;
      await P.swipe(p.x, p.y, p.x + vx, p.y + vy, 6, 16);
      await resting();
      after = await st();
      check(after.moves === before.moves + 1 && after.pos.cell !== before.pos.cell, `a sloppy diagonal (mostly ${pair[0]}, a wall; partly ${pair[1]}, open) swims ${pair[1]}`, { from: before.pos.cell, to: after.pos.cell });
    }

    // ================= the hint =================
    console.log('\nthe hint');
    await P.eval('__mazeDebug.start(5)');
    await sleep(1200);
    check((await st()).hint === null, 'no hint while she is still finding her way');
    await P.eval('__mazeDebug.idle(25)');
    await P.waitFor('__mazeDebug.state.hint !== null', 4000, 'the hint trail after 20 s without progress');
    const hint = (await st()).hint;
    sol = await P.eval('__mazeDebug.solve()');
    check(hint.dir === sol.steps[0].dir && hint.cells.length >= 2, `after 20 s with no headway a trail shows the next glide (${hint.dir}, ${hint.cells.length - 1} cells), the solver's own first move`);
    await sleep(600);
    await shot('hint-01-level5-trail');
    await swipeDir(hint.dir, 0.16, 0);
    await resting();
    check((await st()).hint === null, 'the trail goes away once she swims');
    // Hard: not after 20 s, nor 40; after 45 s, the solver's own next glide (its search spread over a few frames)
    await P.eval(`__mazeDebug.start(1, 'hard')`);
    await sleep(1200);
    await P.eval('__mazeDebug.idle(40)');
    await sleep(1500);
    check((await st()).hint === null && !(await st()).hintPending, 'Hard: no hint after 40 s without progress');
    await P.eval('__mazeDebug.idle(6)');
    await P.waitFor('__mazeDebug.state.hint !== null', 5000, 'the Hard hint after 45 s');
    const hh = (await st()).hint;
    sol = await P.eval('__mazeDebug.solve()');
    check(hh.dir === sol.steps[0].dir && hh.cells.length >= 2, `Hard: after 45 s with no headway the trail shows the solver's next glide (${hh.dir}, ${hh.cells.length - 1} cells)`);
    await sleep(500);
    await shot('hint-02-hard1-trail');
    // and with a patrol in the way (Hard 4's pufferfish), following the trail at its moment never gets her touched
    await P.eval(`__mazeDebug.start(4, 'hard')`);
    await sleep(1200);
    sol = await P.eval('__mazeDebug.autoplay(8)');
    await P.waitFor('(() => { const s = __mazeDebug.state; return s.moves === 8 && s.resting && !s.queued; })()', 20000, 'eight glides into Hard 4');
    let followed = 0, touched = false;
    for (let k = 0; k < 6; k++) {
      await P.eval('__mazeDebug.idle(60)');
      await P.waitFor('__mazeDebug.state.hint !== null', 6000, 'a Hard hint');
      const h4 = (await st()).hint;
      await P.eval(`__mazeDebug.move(${JSON.stringify(h4.dir)}, ${h4.at})`);
      for (let q = 0; q < 80; q++) { const s2 = await st(); if (s2.phase === 'hit') touched = true; if (s2.phase === 'win' || (s2.phase === 'play' && s2.resting && !s2.queued && s2.moves > 8 + followed)) break; await sleep(60); }
      followed++;
    }
    check(followed === 6 && !touched, `Hard 4 (a pufferfish on the way): six hints in a row followed at their moment, never touched`);

    // ================= sound: shared with the main game's save, carefully =================
    console.log('\nthe mute switch (shared with isabella.save)');
    const herSave = JSON.stringify({ unlocked: 20, stars: new Array(20).fill(3), gold: 5271, muted: false, played: true, crown: true });
    await P.eval(`localStorage.setItem('isabella.save', ${JSON.stringify(herSave)})`);
    await P.goto(base + GAME);
    await sleep(400);
    check((await st()).crown === true, 'Isabella wears her crown when the main game says she earned it');
    await tapEl('#soundBtn');
    await sleep(150);
    let main = JSON.parse(await P.eval(`localStorage.getItem('isabella.save')`));
    const exp = JSON.parse(herSave);
    check(main.muted === true && (await st()).muted === true && JSON.stringify(Object.assign({}, main, { muted: false })) === herSave && (await P.eval(`document.querySelector('#soundBtn use').getAttribute('href')`)) === '#i-mute',
      'the sound switch mutes and writes muted:true into isabella.save, every other field untouched', main);
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === herSave && (await st()).muted === false, 'switching back leaves isabella.save byte-for-byte as it was', exp.gold);
    await P.eval(`localStorage.setItem('isabella.save', '{not json')`);
    await P.goto(base + GAME);
    await sleep(300);
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === '{not json' && (await st()).muted === true, 'an unreadable isabella.save is never overwritten (the switch still mutes this visit)');
    await P.eval(`localStorage.removeItem('isabella.save')`);

    // ================= a save from before Hard existed =================
    console.log('\nher save from before Hard (the format the shipped game writes)');
    // what the shipped game wrote after she played all twenty: JSON.stringify({ unlocked, stars })
    const herStars = [3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 2, 3, 3, 3, 1, 3, 3, 2];
    const oldSave = JSON.stringify({ unlocked: 20, stars: herStars });
    await P.eval(`localStorage.clear(); localStorage.setItem('isabella.maze', ${JSON.stringify(oldSave)})`);
    await P.goto(base + GAME);
    await sleep(400);
    let s = await st();
    // (it opens on the page with her next level, as it always has: page 2 here)
    const shownPage = async () => P.eval(`[...document.querySelectorAll('.lvl')].map((b) => b.classList.contains('locked') ? -1 : b.querySelectorAll('.st svg use[fill="#ffd23f"]').length)`);
    const shown2 = await shownPage(), page2 = s.page;
    await tapEl('#pgPrev');
    await sleep(250);
    const shown1 = await shownPage();
    check(s.mode === 'easy' && page2 === 1 && s.save.unlocked === 20 && JSON.stringify(s.save.stars) === JSON.stringify(herStars) && JSON.stringify(shown1.concat(shown2)) === JSON.stringify(herStars) &&
      (await P.eval(`document.getElementById('starCount').textContent`)) === `${herStars.reduce((a, b) => a + b, 0)}/60`,
    'her old save opens on Easy (on the page of her last level, as before) with every level open and every star where it was', { shown: shown1.concat(shown2), count: await P.eval(`document.getElementById('starCount').textContent`) });
    check(JSON.stringify(s.save.hard) === JSON.stringify({ unlocked: 1, stars: zeros() }) && (await savedRaw()) === oldSave, 'Hard starts fresh (Hard 1 open), and just opening the game leaves her save exactly as it was');
    await tapEl('#modeHard');
    await sleep(300);
    await tapEl('.lvl[data-level="1"]');
    await P.waitFor(`__mazeDebug.state.level === 1 && __mazeDebug.state.mode === 'hard'`, 4000);
    await sleep(300);
    sol = await P.eval('__mazeDebug.autoplay()');
    await P.waitFor('__mazeDebug.state.screen === "results"', 60000, 'Hard 1 results');
    const newSave = JSON.parse(await savedRaw());
    check(newSave.unlocked === 20 && JSON.stringify(newSave.stars) === JSON.stringify(herStars) && newSave.hard.stars[0] === 3 && newSave.hard.unlocked === 2 && newSave.mode === 'hard',
      'after a Hard level the save keeps her Easy fields exactly, with Hard and the mode beside them', newSave);
    const oldRead = await P.eval(OLD_LOAD);
    check(oldRead.unlocked === 20 && JSON.stringify(oldRead.stars) === JSON.stringify(herStars), 'the old game\'s own save code still reads her Easy progress from the new save', oldRead);
    await P.goto(base + GAME);
    await sleep(400);
    s = await st();
    check(s.mode === 'hard' && s.save.hard.stars[0] === 3 && s.save.unlocked === 20 && JSON.stringify(s.save.stars) === JSON.stringify(herStars) && (await P.eval(`document.getElementById('modeHard').classList.contains('on')`)),
      'reopened, the game remembers Hard (the shark lit) and both modes\' progress');
    for (const [bad, what] of [['{"unlocked":"x","stars":"nope","hard":[1,2],"mode":7}', 'nonsense fields'], ['{"unlocked":5,"stars":[3,3,3],"hard":{"unlocked":99,"stars":[3,"3",9,-1]}}', 'odd numbers'], ['[1,2,3]', 'an array'], ['{oops', 'not JSON']]) {
      await P.eval(`localStorage.setItem('isabella.maze', ${JSON.stringify(bad)})`);
      await P.goto(base + GAME);
      await sleep(250);
      s = await st();
      const ok = s.save.unlocked >= 1 && s.save.unlocked <= 20 && s.save.hard.unlocked >= 1 && s.save.hard.unlocked <= 20 && s.save.stars.length === 20 && s.save.hard.stars.length === 20 &&
        s.save.stars.concat(s.save.hard.stars).every((v) => v >= 0 && v <= 3 && Number.isInteger(v)) && (s.mode === 'easy' || s.mode === 'hard') && s.screen === 'levels';
      check(ok, `a save with ${what} still opens safely`, { unlocked: s.save.unlocked, hard: s.save.hard, mode: s.mode });
    }

    // ================= inside the Android app: window.IsabellaStore =================
    console.log('\nwith window.IsabellaStore (as in the Android app)');
    await P.eval(`localStorage.clear()`);
    const lsBefore = await savedRaw();
    const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__fakeStore = { 'isabella.save': JSON.stringify({ muted: true, unlocked: 3 }), 'isabella.maze': JSON.stringify({ unlocked: 2, stars: [2] }) };
               window.IsabellaStore = { get: (k) => (k in window.__fakeStore ? window.__fakeStore[k] : null), set: (k, v) => { window.__fakeStore[k] = String(v); } };`,
    });
    await P.goto(base + GAME);
    await sleep(300);
    s = await st();
    check(s.muted === true && s.save.unlocked === 2 && s.save.stars[0] === 2, 'progress and mute come from IsabellaStore, not localStorage', { muted: s.muted, unlocked: s.save.unlocked });
    await tapEl('.lvl[data-level="2"]');
    s = await playSolver(2, 'IsabellaStore');
    const fake = JSON.parse(await P.eval(`window.__fakeStore['isabella.maze']`));
    check(fake.stars[0] === 2 && fake.stars[1] === 3 && fake.unlocked === 3 && fake.hard && fake.hard.unlocked === 1 && fake.mode === 'easy' && (await savedRaw()) === lsBefore, 'the save is written to IsabellaStore under isabella.maze (Easy as before, Hard beside it); localStorage left alone', fake);
    check((await st()).gain === 0, 'muted for real: master gain 0 once sound has started');
    await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    // grown-ups: hold the title for 4 seconds to open every level
    await P.eval(`localStorage.clear()`);
    await P.goto(base + GAME);
    await sleep(300);
    const tr = await rectOf('#title');
    await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tr.x + tr.w / 2, y: tr.y + tr.h / 2, id: 1 }] });
    await sleep(4300);
    await P.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    s = await st();
    check(s.save.unlocked === 20 && s.save.hard.unlocked === 20 && s.save.stars.every((v) => v === 0), 'holding the title for 4 s opens every level, Easy and Hard (stars untouched)');

    // held upright, the page asks to turn the phone
    await P.viewport(412, 915, DPR);
    await sleep(200);
    check((await P.eval(`getComputedStyle(document.getElementById('rotate')).display`)) === 'flex', 'portrait shows the turn-the-phone picture');
    await P.viewport(915, 412, DPR);

    // Android back: straight to the hub, from the middle of a level (an Easy one and a Hard one)
    await P.eval('__mazeDebug.start(4)');
    await sleep(600);
    const back = await P.eval('window.__back()');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the back button to reach the hub');
    check(back === true, 'window.__back() returns true and goes to ../../index.html');
    await P.goto(base + GAME);
    await sleep(300);
    await P.eval(`__mazeDebug.start(7, 'hard')`);
    await sleep(600);
    await tapEl('#homeBtn');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button from a Hard level');
    check(true, 'the home button leaves a Hard level for the hub');

    console.log('');
    check(page.errors.length === 0, 'no console errors, exceptions or failed loads on any page', page.errors);
  } catch (e) {
    fails++;
    console.log('  FAIL ' + (e.stack || e));
    if (page) console.log('  page errors: ' + JSON.stringify(page.errors));
    if (page) try { await page.shot(path.join(OUT, 'zz-failure.png')); } catch (e2) { /* ignore */ }
  } finally {
    if (page) page.close();
    await chrome.close();
    await srv.close();
  }
  console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}. Screenshots in ${OUT}`);
  process.exit(fails ? 1 : 0);
})();
