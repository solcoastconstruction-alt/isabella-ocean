// Coral Maze soak: a little over three minutes of random real-finger play (swipes of every length and slant, taps
// anywhere) across all twenty levels, through the results card and the level select, at the Seeker's size.
//   node test/games/maze/soak.js [seconds] [outDir] [chromeProfileDir]
//   (defaults: 200 s, $TMPDIR/coral-maze-soak, $TMPDIR/chrome-maze-soak; DevTools port 9454)
// First a quick warm-up visit to every level (so every code path is compiled before measuring), then the soak:
// levels in turn, random play in each, some finished the right way (through the results card's buttons).
// Passes if the page logs no errors or exceptions, the particles stay under their cap, the frame rate holds,
// every level was played, and nothing grows: JS heap, DOM nodes and event listeners measured after a forced
// garbage collection after the warm-up and at the end (and sampled in between).
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const SECONDS = +(process.argv[2] || 200);
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'coral-maze-soak'));
const PROFILE = path.resolve(process.argv[4] || path.join(os.tmpdir(), 'chrome-maze-soak'));
const PORT = 9454, W = 915, H = 412;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(REPO);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: W, height: H });
  let page, ok = false;
  try {
    page = await openPage(PORT);
    const P = page;
    await P.send('Performance.enable');
    await P.send('HeapProfiler.enable');
    await P.viewport(W, H, 2.625);
    await P.goto(base + '/web/games/maze/index.html');
    await sleep(400);
    await P.eval('__mazeDebug.unlockAll()');
    const metrics = async () => {
      await P.send('HeapProfiler.collectGarbage');
      await sleep(100);
      const m = {};
      for (const x of (await P.send('Performance.getMetrics')).metrics) m[x.name] = x.value;
      return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners };
    };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const st = () => P.eval('__mazeDebug.state');
    let level = 1, swipes = 0, taps = 0, wins = 0, hits = 0, levelsPlayed = new Set(), lastHit = false, maxParts = 0;
    const startLevel = async (n) => { await P.eval(`__mazeDebug.start(${n})`); levelsPlayed.add(n); await sleep(300); };
    // warm-up: every level once, a few random swipes in each
    for (let n = 1; n <= 20; n++) {
      await startLevel(n);
      await sleep(900);
      for (let k = 0; k < 4; k++) { const x = rnd(0.3, 0.9) * W, y = rnd(0.1, 0.9) * H, a = Math.floor(Math.random() * 4) * Math.PI / 2; await P.swipe(x, y, x + Math.cos(a) * 70, y + Math.sin(a) * 70, 4, 12); await sleep(250); }
    }
    levelsPlayed = new Set();
    await startLevel(level);
    await sleep(2000);
    const m0 = await metrics(), samples = [m0];
    console.log(`start: ${JSON.stringify(m0)}`);
    const t0 = Date.now();
    let nextSample = t0 + 30000, levelSince = Date.now();
    await P.eval('__mazeDebug.resetPerf()');
    while (Date.now() - t0 < SECONDS * 1000) {
      const s = await st();
      maxParts = Math.max(maxParts, s.particles);
      if (s.phase === 'hit' && !lastHit) hits++;
      lastHit = s.phase === 'hit';
      if (s.screen === 'results') {
        wins++;
        await sleep(rnd(200, 1600));
        const which = ['#resNext', '#resReplay', '#resLevels'][Math.floor(Math.random() * 3)];
        const r = await P.eval(`(() => { const e = document.querySelector('${which}'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, shown: getComputedStyle(e).display !== 'none' }; })()`);
        if (r.shown) await P.tap(r.x, r.y);
        await sleep(400);
        const s2 = await st();
        if (s2.screen === 'levels') {
          // the level select: tap the next level's bubble with a finger (turning the page if need be)
          level = (level % 20) + 1;
          const want = Math.floor((level - 1) / 10);
          if (s2.page !== want) { await P.eval(`document.getElementById('${want > s2.page ? 'pgNext' : 'pgPrev'}').click()`); await sleep(300); }
          const b = await P.eval(`(() => { const e = document.querySelector('.lvl[data-level="${level}"]'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          await P.tap(b.x, b.y);
          await sleep(400);
        } else { level = (level % 20) + 1; await startLevel(level); }   // after "next" or "replay" played a moment, go on in turn
        levelsPlayed.add(level);
        levelSince = Date.now();
        continue;
      }
      if (s.screen === 'levels') { await P.eval('__mazeDebug.start(' + (1 + Math.floor(Math.random() * 20)) + ')'); levelSince = Date.now(); continue; }
      // after a while in a level: sometimes finish it the right way (real swipes; scheduled moves where patrols swim),
      // otherwise move on, so every level gets played and the results card and level select get used
      if (Date.now() - levelSince > 4500) {
        if (Math.random() < 0.4 && s.phase === 'play') {
          await P.waitFor('(() => { const s = __mazeDebug.state; return s.phase !== "play" || (s.resting && !s.queued); })()', 8000);
          const plan = await P.eval('__mazeDebug.solve()');
          if (plan && s.patrols.length) for (const x of plan.steps) await P.eval(`__mazeDebug.move('${x.dir}', ${x.at})`);
          else if (plan) {
            for (const x of plan.steps) {
              const p = await P.eval('__mazeDebug.isabellaCss()'), k = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[x.dir], d = H * 0.15;
              await P.swipe(p.x, p.y, p.x + k[0] * d, p.y + k[1] * d, 5, 14);
              swipes++;
              await P.waitFor('(() => { const s = __mazeDebug.state; return s.phase !== "play" || (s.resting && !s.queued); })()', 8000);
            }
          }
          await P.waitFor('__mazeDebug.state.phase !== "play"', 60000);
          levelSince = Date.now();
          continue;
        }
        level = (level % 20) + 1; await startLevel(level); levelSince = Date.now(); continue;
      }
      if (Math.random() < 0.8) {
        // a swipe: anywhere on the screen, any way, any length, sometimes slanted, sometimes slow
        const x = rnd(0.25, 0.92) * W, y = rnd(0.08, 0.92) * H, a = Math.floor(Math.random() * 4) * Math.PI / 2 + rnd(-0.6, 0.6), len = rnd(0.04, 0.3) * H;
        await P.swipe(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 2 + Math.floor(Math.random() * 6), Math.random() < 0.2 ? 40 : 12);
        swipes++;
      } else {
        await P.tap(rnd(0.25, 0.95) * W, rnd(0.05, 0.95) * H);
        taps++;
      }
      await sleep(rnd(30, 450));
      if (Date.now() > nextSample) { const m = await metrics(); samples.push(m); console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(m)} level ${s.level} swipes ${swipes} taps ${taps} wins ${wins} bumps-by-patrol ${hits}`); nextSample += 30000; }
    }
    const perf = await P.eval('__mazeDebug.perf()');
    // end on the level select, as she would, then measure
    await P.eval('__mazeDebug.start(1)');
    await sleep(1500);
    const m1 = await metrics();
    samples.push(m1);
    await P.shot(path.join(OUT, 'soak-end.png'));
    const growth = { heapMB: +(m1.heapMB - m0.heapMB).toFixed(2), nodes: m1.nodes - m0.nodes, listeners: m1.listeners - m0.listeners };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), swipes, taps, wins, patrolBumps: hits, levels: [...levelsPlayed].sort((a, b) => a - b), maxParticles: maxParts, perf, start: m0, end: m1, growth, samples, errors: page.errors };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    console.log(`end:   ${JSON.stringify(m1)}`);
    console.log(JSON.stringify({ seconds: report.seconds, swipes, taps, wins, patrolBumps: hits, levelsPlayed: report.levels.length, maxParticles: maxParts, fps: +perf.fps.toFixed(1), drawP95Ms: +perf.drawP95Ms.toFixed(2), growth, errors: page.errors.length }));
    ok = page.errors.length === 0 && maxParts < 650 && perf.fps > 50 && growth.heapMB < 1 && growth.nodes < 60 && growth.listeners <= 0 && report.levels.length === 20 && wins >= 5;
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
