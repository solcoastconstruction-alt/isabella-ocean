// Treasure Blocks soak: a little over three minutes of random real-finger play across all three sizes, at the
// Seeker's size: button taps and holds, drags any way across the well (short, long, crooked, slow), taps, pulls down,
// upward flicks, two fingers at once, touches on the sea, the sizes button in the middle of a game, the results
// card's buttons and the picker's. Some games are played with care (so rows clear, rounds finish and chests open),
// some are thrown about (so Easy gets its waves and Medium and Hard fill up). Every touch goes through
// Input.dispatchTouchEvent.
//   node test/games/blocks/soak.js [seconds] [outDir] [chromeProfileDir]
//   (defaults: 200 s, .local/soak and .local/chrome-blocks-soak in the repo; DevTools port 9484)
// Passes if the page logs no errors or exceptions, rounds of every size get finished, Easy sees a wave and a bigger
// well fills up, the particles stay under their cap, the sprite caches stay small, the frame rate holds, and nothing
// grows: JS heap, DOM nodes and event listeners measured after a forced garbage collection after a warm-up and at
// the end (and sampled in between).
'use strict';
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');
const PL = require('./player.js');

const REPO = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.env.BLOCKS_ROOT || REPO);
const L = require(path.join(ROOT, 'web/games/blocks/logic.js'));
const SECONDS = +(process.argv[2] || 200);
const OUT = path.resolve(process.argv[3] || path.join(REPO, '.local/soak'));
const PROFILE = path.resolve(process.argv[4] || path.join(REPO, '.local/chrome-blocks-soak'));
const PORT = 9484, W = 915, H = 412;
const GAME = '/web/games/blocks/index.html';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(ROOT);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: W, height: H });
  let page, ok = false;
  try {
    page = await openPage(PORT);
    const P = page;
    await P.send('Performance.enable');
    await P.send('HeapProfiler.enable');
    await P.viewport(W, H, 2.625);
    await P.goto(base + GAME);
    await P.eval('localStorage.clear()');
    await P.goto(base + GAME);
    await sleep(500);
    const metrics = async () => {
      await P.send('HeapProfiler.collectGarbage');
      await sleep(100);
      const m = {};
      for (const x of (await P.send('Performance.getMetrics')).metrics) m[x.name] = x.value;
      return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners };
    };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const st = () => P.eval('__blocksDebug.state');
    const center = (sel) => P.eval(`(() => { const e = document.querySelector('${sel}'), b = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: b.x + b.width / 2, y: b.y + b.height / 2, shown: cs.display !== 'none' && +cs.opacity > 0.5 && b.width > 0 }; })()`);
    const tapSel = async (sel) => { const c = await center(sel); if (c.shown) await P.tap(c.x, c.y); return c.shown; };
    const well = (s) => { const w = s.layout.well; return { x: (w.left + w.right) / 2, y: w.top + (w.bottom - w.top) * 0.6, w: w.right - w.left, h: w.bottom - w.top, left: w.left, right: w.right, top: w.top, bottom: w.bottom, cell: s.cell.px }; };
    // a finger across the well, any way it likes
    async function scribble(s) {
      const g = well(s), x0 = rnd(g.left - 30, g.right + 30), y0 = rnd(g.top, g.bottom), ang = rnd(0, Math.PI * 2), len = rnd(4, g.w * 1.1), n = 2 + Math.floor(Math.random() * 12), pts = [];
      for (let k = 0; k <= n; k++) { const u = k / n; pts.push({ x: Math.min(W - 4, Math.max(4, x0 + Math.cos(ang) * len * u + rnd(-8, 8))), y: Math.min(H - 4, Math.max(4, y0 + Math.sin(ang) * len * u + rnd(-8, 8))) }); }
      await P.drag(pts, Math.random() < 0.2 ? 45 : 12);
    }
    async function dragSide(s, cells) { const g = well(s), n = Math.max(3, Math.abs(cells) * 3), pts = []; for (let k = 0; k <= n; k++) pts.push({ x: g.x + ((cells * g.cell * 1.04) * k) / n, y: g.y + rnd(-3, 3) }); await P.drag(pts, 13); }
    async function pullDown(s) { const g = well(s), pts = []; for (let k = 0; k <= 5; k++) pts.push({ x: g.x + rnd(-3, 3), y: g.y + (2.4 * g.cell * k) / 5 }); await P.drag(pts, 13); }
    // one careful piece, with real touches (buttons or gestures)
    async function careful(s, via) {
      const target = PL.plan(L, { W: s.W, H: s.H, grid: s.grid, cur: s.cur, next: s.next });
      for (let k = 0; k < 12; k++) {
        const q = await st();
        if (q.phase !== 'fall' || !q.cur || q.pieces !== s.pieces) return;
        const a = PL.nextAction(q.cur, target);
        if (a === 'drop') break;
        if (via === 'buttons') await tapSel(a === 'rotate' ? '#padTurn' : a === 'left' ? '#padLeft' : '#padRight');
        else if (a === 'rotate') { const g = well(q); await P.tap(g.x + rnd(-10, 10), g.y + rnd(-10, 10)); }
        else await dragSide(q, target.x - q.cur.x);
        await P.frames(1);
        const q2 = await st();
        if (q2.cur && q2.pieces === q.pieces && q2.cur.x === q.cur.x && q2.cur.rot === q.cur.rot) break;
      }
      await P.waitFor('(() => { const s = __blocksDebug.state; return s.phase !== "fall" || s.age >= s.dropGuard + 0.03; })()', 3000, 'the drop guard');
      if (via === 'buttons') await tapSel('#padDrop'); else await pullDown(await st());
    }
    const done = { easy: 0, medium: 0, hard: 0 }, started = { easy: 0, medium: 0, hard: 0 };
    const tally = { taps: 0, holds: 0, drags: 0, scribbles: 0, pulls: 0, twoFinger: 0, carefulPieces: 0, keys: 0, overs: 0, keepGoing: 0, quits: 0 };
    let maxParts = 0, maxBlocks = 0, maxTimers = 0, maxFlying = 0, wavesSeen = 0, lastWaves = 0, lastWin = null, style = 'careful', via = 'buttons';
    // Careful games finish rounds (rows, keys, chests); careless ones bring Easy its waves and fill the bigger wells.
    // The first four games are fixed so that a three-minute run sees all of it; after that she picks as she likes.
    const FIRST = [['easy', 'careless'], ['easy', 'careful'], ['hard', 'careless'], ['medium', 'careful']];
    let game = 0;
    const styleFor = () => (Math.random() < 0.5 ? 'careless' : 'careful');
    // warm-up: a round of each size finished, so every code path has run before measuring
    for (const m of ['easy', 'medium', 'hard']) {
      await P.eval(`__blocksDebug.start('${m}', 5)`);
      await sleep(200);
      for (let n = 0; n < 80; n++) {
        await P.waitFor('["fall", "goal", "over"].includes(__blocksDebug.state.phase)', 8000, 'a piece');
        const s = await st();
        if (s.phase !== 'fall') break;
        if (n < 2) await scribble(s);
        await careful(await st(), n % 2 ? 'buttons' : 'gestures');
      }
      await P.waitFor('__blocksDebug.state.screen === "results"', 9000, 'results in the warm-up');
      await sleep(500);
    }
    await tapSel('#modesBtn');
    await sleep(800);
    const m0 = await metrics(), samples = [m0];
    console.log(`start: ${JSON.stringify(m0)}`);
    const t0 = Date.now();
    let nextSample = t0 + 30000;
    await P.eval('__blocksDebug.resetPerf()');
    while (Date.now() - t0 < SECONDS * 1000) {
      const s = await st();
      maxParts = Math.max(maxParts, s.particles); maxBlocks = Math.max(maxBlocks, s.caches.blocks); maxTimers = Math.max(maxTimers, s.timers); maxFlying = Math.max(maxFlying, s.flying);
      if (s.waves < lastWaves) lastWaves = 0;
      if (s.waves > lastWaves) { wavesSeen += s.waves - lastWaves; lastWaves = s.waves; }
      if (s.win !== lastWin) { if (s.win === 'goal') { tally.keys++; done[s.mode]++; } else if (s.win === 'over') { tally.overs++; done[s.mode]++; } lastWin = s.win; }
      if (s.screen === 'modes') {
        // then the size played least so far (ties at random), so all three get plenty of play
        const least = Math.min(...Object.values(started)), pick = Object.keys(started).filter((k) => started[k] === least);
        const [m, how] = game < FIRST.length ? FIRST[game] : [pick[Math.floor(Math.random() * pick.length)], styleFor()];
        game++;
        await tapSel('#mode-' + m);
        style = how; via = Math.random() < 0.5 ? 'buttons' : 'gestures';
        started[m]++; lastWaves = 0; lastWin = null;
        await sleep(rnd(200, 600));
        continue;
      }
      if (s.screen === 'results') {
        await sleep(rnd(300, 1300));
        const r = game < FIRST.length ? 1 : Math.random();
        if (r < 0.4 && (await tapSel('#resGo'))) { tally.keepGoing++; lastWin = null; }
        else if (r < 0.75) { await tapSel('#resAgain'); style = styleFor(); started[s.mode]++; lastWaves = 0; lastWin = null; }
        else await tapSel('#modesBtn');
        await sleep(400);
        continue;
      }
      if (s.phase !== 'fall') { if (Math.random() < 0.3) { await scribble(s); tally.scribbles++; } else await sleep(120); continue; }
      // a careless Easy game never ends by itself: after a wave or two she picks another size
      if (style === 'careless' && s.mode === 'easy' && s.waves >= 1 && Math.random() < 0.08) { await tapSel('#modesBtn'); tally.quits++; await sleep(300); continue; }
      const r = Math.random();
      if (style === 'careful' && r < 0.8) { await careful(s, via); tally.carefulPieces++; }
      else if (r < 0.3) { await tapSel(['#padLeft', '#padRight', '#padTurn', '#padDrop'][Math.floor(Math.random() * (style === 'careless' ? 4 : 3))]); tally.taps++; }
      else if (r < 0.4) { const c = await center(Math.random() < 0.5 ? '#padLeft' : '#padRight'); if (c.shown) { await P.hold(c.x, c.y, rnd(150, 900)); tally.holds++; } }
      else if (r < 0.55) { await dragSide(s, Math.floor(rnd(-4, 5))); tally.drags++; }
      else if (r < 0.7) { await scribble(s); tally.scribbles++; }
      else if (r < 0.78) { const g = well(s); await P.tap(rnd(g.left, g.right), rnd(g.top, g.bottom)); tally.taps++; }
      else if (r < 0.88) { await pullDown(s); tally.pulls++; }
      else if (r < 0.93) {
        // two fingers at once: the second is ignored, the first still steers
        const g = well(s), a = { x: rnd(g.left, g.right), y: rnd(g.top, g.bottom) }, b = { x: rnd(g.left, g.right), y: rnd(g.top, g.bottom) };
        await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
        await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }] });
        for (let k = 1; k <= 4; k++) { await sleep(16); await P.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + k * 12, y: a.y + k * 3, id: 1 }, { x: b.x - k * 10, y: b.y, id: 2 }] }); }
        await P.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        tally.twoFinger++;
      } else if (r < 0.96) { await P.tap(rnd(150, 300), rnd(60, 220)); tally.taps++; }    // a touch on the sea
      else if (r < 0.968) { await tapSel('#modesBtn'); tally.quits++; await sleep(300); }   // changes her mind mid-game
      await sleep(rnd(20, 260));
      if (Date.now() > nextSample) {
        const m = await metrics(); samples.push(m);
        console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(m)} started ${JSON.stringify(started)} finished ${JSON.stringify(done)} waves ${wavesSeen} ${JSON.stringify(tally)}`);
        nextSample += 30000;
      }
    }
    const perf = await P.eval('__blocksDebug.perf()');
    // end on the picker, as she would, then measure
    for (let k = 0; k < 20 && (await st()).screen !== 'modes'; k++) { await tapSel('#modesBtn'); await sleep(500); }
    await sleep(1500);
    const m1 = await metrics();
    samples.push(m1);
    await P.shot(path.join(OUT, 'soak-end.png'));
    const finalState = await st();
    const growth = { heapMB: +(m1.heapMB - m0.heapMB).toFixed(2), nodes: m1.nodes - m0.nodes, listeners: m1.listeners - m0.listeners };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), started, finished: done, wavesSeen, tally, counters: finalState.counters, save: finalState.save, maxParticles: maxParts, maxBlockSprites: maxBlocks, maxTimers, maxFlying, perf, start: m0, end: m1, growth, samples, errors: page.errors };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    console.log(`end:   ${JSON.stringify(m1)}`);
    console.log(JSON.stringify({ seconds: report.seconds, started, finished: done, wavesSeen, tally, saved: finalState.save, maxParticles: maxParts, maxBlockSprites: maxBlocks, maxTimers, fps: +perf.fps.toFixed(1), drawP95Ms: +perf.drawP95Ms.toFixed(2), growth, errors: page.errors.length }));
    const short = SECONDS < 120;   // a short run (mutants.js) cannot be asked to finish a round of every size
    ok = page.errors.length === 0 && maxParts < 650 && perf.fps > 50 && growth.heapMB < 1 && growth.nodes < 60 && growth.listeners <= 0 && maxBlocks <= 60 && maxTimers < 120 && finalState.screen === 'modes'
      && (short || (tally.keys >= 2 && done.easy >= 1 && done.medium >= 1 && done.hard >= 1 && wavesSeen >= 1 && tally.overs >= 1));
    console.log(ok ? 'SOAK PASS' : 'SOAK FAIL' + (page.errors.length ? ' ' + JSON.stringify(page.errors) : ''));
  } catch (e) {
    console.log('soak crashed: ' + (e.stack || e));
    if (page) console.log('page errors: ' + JSON.stringify(page.errors));
  } finally {
    if (page) page.close();
    await chrome.close();
    await srv.close();
  }
  process.exit(ok ? 0 : 1);
})();
