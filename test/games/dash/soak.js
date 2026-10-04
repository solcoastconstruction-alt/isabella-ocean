// Splash Dash soak: a little over three minutes of random real-finger play across all twenty courses, through the
// finish, the chest, the results card and the level select, at the Seeker's size.
//   node test/games/dash/soak.js [seconds] [outDir] [chromeProfileDir]
//   (defaults: 190 s, <repo>/.local/soak, <repo>/.local/chrome-dash-soak; DevTools port 9482)
//   DASH_ROOT=<a copy of the repo's web/ tree> serves that copy instead (mutate.js uses this)
// First a quick visit to every course (so every picture is drawn and every code path compiled before measuring),
// then the soak: a steering finger that wanders, stops, lifts and is sometimes cancelled; a second finger that
// presses, holds and lets go of the speed button at random; bursts of sensor events (leaning this way and that,
// either way round) and of window.__steer; every few seconds another course, and now and then a jump to the last
// stretch so the finish line, the chest and the results card's buttons get used too.
// Passes if the page logs no errors or exceptions, the particles stay under their cap and die away, the frame rate holds, every
// course was played, she bumped into things and finished courses, the speed button is not left held, and nothing
// grows: JS heap, DOM nodes and event listeners, measured after a forced garbage collection after the warm-up and
// at the end (and sampled in between).
'use strict';
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');
const { pose } = require('./phone.js');

const REPO = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.env.DASH_ROOT || REPO);
const SECONDS = +(process.argv[2] || 190);
const OUT = path.resolve(process.argv[3] || path.join(REPO, '.local/soak'));
const PROFILE = path.resolve(process.argv[4] || path.join(REPO, '.local/chrome-dash-soak'));
const PORT = 9482, W = 915, H = 412, CAP = 420;

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
    await P.goto(base + '/web/games/dash/index.html');
    await P.eval('localStorage.clear()');
    await P.goto(base + '/web/games/dash/index.html');
    await sleep(400);
    await P.eval('__dashDebug.unlockAll()');
    await P.eval(`window.__motion = (x, y, z) => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y, z }, interval: 16 })); 1`);
    const metrics = async () => {
      await P.send('HeapProfiler.collectGarbage');
      await sleep(100);
      const m = {};
      for (const x of (await P.send('Performance.getMetrics')).metrics) m[x.name] = x.value;
      return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners };
    };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const st = () => P.eval(`(() => { const s = __dashDebug.state; return { screen: s.screen, level: s.level, phase: s.phase, s: s.s, len: s.len, bumps: s.bumps, held: s.held, particles: s.particles, page: s.page, coins: s.coins, leaps: s.leaps, input: s.input }; })()`);
    const go = await (async () => { await P.eval('__dashDebug.start(1)'); await sleep(300); return P.eval(`(() => { const b = document.getElementById('goBtn').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); })();
    const startLevel = async (n) => { await P.eval(`__dashDebug.start(${n})`); await sleep(250); };
    // fingers: 1 steers, 2 is on the speed button
    let f1 = null, f2 = false;
    const down = () => [f1 && { id: 1, x: f1.x, y: f1.y }, f2 && { id: 2, x: go.x, y: go.y }].filter(Boolean);
    const liftAll = async () => { if (f1 || f2) { await P.fingers('touchEnd', []); f1 = null; f2 = false; } };

    // warm-up: every course once, a little of everything in each
    for (let n = 1; n <= 20; n++) {
      await startLevel(n);
      await P.fingers('touchStart', [{ id: 1, x: rnd(0.2, 0.7) * W, y: 230 }, { id: 2, x: go.x, y: go.y }]);
      await sleep(500);
      await P.fingers('touchMove', [{ id: 1, x: rnd(0.2, 0.7) * W, y: 230 }, { id: 2, x: go.x, y: go.y }]);
      await sleep(400);
      await P.fingers('touchEnd', []);
      await P.eval(`(() => { const lv = __dashDebug.run.lev; __dashDebug.warp(lv.len - 500, 0); })()`);
      await P.waitFor('__dashDebug.state.screen === "results"', 20000, `warm-up: course ${n} results`);
    }
    await startLevel(1);
    await sleep(2000);
    const m0 = await metrics(), samples = [m0];
    console.log(`start: ${JSON.stringify(m0)}`);

    let level = 1, moves = 0, presses = 0, tilts = 0, bridges = 0, wins = 0, bumps = 0, leaps = 0, lastBumps = 0, lastLeaps = 0, maxParts = 0, stuck = 0;
    const levelsPlayed = new Set([1]);
    const t0 = Date.now();
    let nextSample = t0 + 30000, levelSince = Date.now(), stay = rnd(5000, 9000);
    await P.eval('__dashDebug.resetPerf()');
    while (Date.now() - t0 < SECONDS * 1000) {
      const s = await st();
      maxParts = Math.max(maxParts, s.particles);
      if (s.screen === 'play') {
        if (s.bumps > lastBumps) bumps += s.bumps - lastBumps;
        if (s.leaps > lastLeaps) leaps += s.leaps - lastLeaps;
        lastBumps = s.bumps; lastLeaps = s.leaps;
      }
      if (s.screen === 'results') {
        wins++;
        await liftAll();
        await sleep(rnd(200, 1500));
        const which = ['#resNext', '#resReplay', '#resLevels'][Math.floor(Math.random() * 3)];
        const r = await P.eval(`(() => { const e = document.querySelector('${which}'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, shown: getComputedStyle(e).display !== 'none' }; })()`);
        if (r.shown) await P.tap(r.x, r.y);
        await sleep(400);
        const s2 = await st();
        if (s2.screen === 'levels') {
          // the level select: turn the page if need be, then a finger on the next course's bubble
          level = (level % 20) + 1;
          const want = Math.floor((level - 1) / 10);
          if (s2.page !== want) { const a = await P.eval(`(() => { const b = document.getElementById('${want > s2.page ? 'pgNext' : 'pgPrev'}').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); await P.tap(a.x, a.y); await sleep(300); }
          const b = await P.eval(`(() => { const e = document.querySelector('.lvl[data-level="${level}"]'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          await P.tap(b.x, b.y);
          await sleep(400);
        } else { level = s2.level || level; }
        levelsPlayed.add((await st()).level);
        lastBumps = 0; lastLeaps = 0; levelSince = Date.now(); stay = rnd(5000, 9000);
        continue;
      }
      if (s.screen === 'levels') { level = (level % 20) + 1; await startLevel(level); levelsPlayed.add(level); lastBumps = 0; lastLeaps = 0; levelSince = Date.now(); continue; }
      if (s.phase !== 'play') { await liftAll(); await sleep(200); continue; }   // gliding to the chest
      // after a while on a course: sometimes swim its last stretch to the chest, otherwise on to the next course
      if (Date.now() - levelSince > stay) {
        if (Math.random() < 0.45) { await P.eval(`(() => { const lv = __dashDebug.run.lev; __dashDebug.warp(lv.len - ${Math.round(rnd(400, 1500))}); })()`); levelSince = Date.now() + 30000; continue; }
        await liftAll();
        level = (level % 20) + 1; await startLevel(level); levelsPlayed.add(level); lastBumps = 0; lastLeaps = 0; levelSince = Date.now(); stay = rnd(5000, 9000);
        continue;
      }
      const u = Math.random();
      if (u < 0.5) {
        // the steering finger: down somewhere, or moved (a little or a lot), or lifted
        if (!f1) { f1 = { x: rnd(0.03, 0.8) * W, y: rnd(0.25, 0.95) * H }; await P.fingers('touchStart', down()); }
        else if (Math.random() < 0.8) { f1 = { x: Math.max(4, Math.min(0.8 * W, f1.x + rnd(-1, 1) * (Math.random() < 0.3 ? 400 : 90))), y: f1.y + rnd(-20, 20) }; await P.fingers('touchMove', down()); }
        else { const was = f1; f1 = null; if (Math.random() < 0.2) { await P.fingers('touchCancel', []); f2 = false; } else await P.fingers('touchEnd', [{ id: 1, x: was.x, y: was.y }]); }
        moves++;
      } else if (u < 0.75) {
        // the speed button: pressed, or let go
        if (!f2) { f2 = true; await P.fingers('touchStart', down()); presses++; }
        else { f2 = false; await P.fingers('touchEnd', [{ id: 2, x: go.x, y: go.y }]); }
      } else if (u < 0.9) {
        // a burst of sensor events: the phone leaning some way, either way round, tipped back some amount
        const v = pose(Math.random() < 0.5 ? 90 : 270, rnd(-28, 28), rnd(0, 70));
        await P.eval(`(async () => { for (let i = 0; i < 12; i++) { __motion(${v[0]} + 0.05 * Math.sin(i), ${v[1]} + 0.05 * Math.cos(i * 2), ${v[2]}); await new Promise((r) => setTimeout(r, 16)); } })()`);
        tilts++;
      } else { await P.eval(`__steer(${rnd(-1.3, 1.3).toFixed(2)})`); bridges++; }
      await sleep(rnd(20, 380));
      if (Date.now() > nextSample) { const m = await metrics(); samples.push(m); console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(m)} course ${s.level} finger moves ${moves} presses ${presses} tilts ${tilts} bumps ${bumps} leaps ${leaps} finishes ${wins}`); nextSample += 30000; }
    }
    await liftAll();
    // any course the random play did not reach yet: a few seconds of it now, so every course is played
    for (let n = 1; n <= 20; n++) {
      if (levelsPlayed.has(n)) continue;
      await startLevel(n);
      await P.fingers('touchStart', [{ id: 1, x: rnd(0.2, 0.7) * W, y: 230 }, { id: 2, x: go.x, y: go.y }]);
      await sleep(2500);
      await P.fingers('touchEnd', []);
      levelsPlayed.add(n);
      console.log(`  (then a few seconds of course ${n}, which the random play had not reached)`);
    }
    const perf = await P.eval('__dashDebug.perf()');
    // with every finger lifted, the speed button must not be left held
    await startLevel(3);
    await P.fingers('touchStart', [{ id: 2, x: go.x, y: go.y }]);
    await sleep(300);
    await P.fingers('touchEnd', []);
    await sleep(200);
    if ((await st()).held) stuck++;
    // end on a course, as she would, then measure
    await startLevel(1);
    await sleep(5000);
    const resting = (await st()).particles;   // swimming slowly with nothing happening: only a little spray is alive
    const m1 = await metrics();
    samples.push(m1);
    await P.shot(path.join(OUT, 'soak-end.png'));
    const growth = { heapMB: +(m1.heapMB - m0.heapMB).toFixed(2), nodes: m1.nodes - m0.nodes, listeners: m1.listeners - m0.listeners };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), fingerMoves: moves, presses, tilts, bridges, finishes: wins, bumps, leaps, levels: [...levelsPlayed].sort((a, b) => a - b), maxParticles: maxParts, restingParticles: resting, perf, start: m0, end: m1, growth, samples, stuck, errors: page.errors };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    console.log(`end:   ${JSON.stringify(m1)}`);
    console.log(JSON.stringify({ seconds: report.seconds, fingerMoves: moves, presses, tilts, bridges, finishes: wins, bumps, leaps, coursesPlayed: report.levels.length, maxParticles: maxParts, restingParticles: resting, fps: +perf.fps.toFixed(1), drawP95Ms: +perf.drawP95Ms.toFixed(2), drawMaxMs: +perf.drawMaxMs.toFixed(2), growth, speedButtonStuck: stuck, errors: page.errors.length }));
    const why = [];
    if (page.errors.length) why.push('page errors: ' + JSON.stringify(page.errors.slice(0, 3)));
    if (maxParts >= CAP) why.push(`particles reached their cap (${maxParts})`);
    if (resting > 40) why.push(`particles pile up (${resting} alive after five quiet seconds)`);
    if (!(perf.fps > 50)) why.push(`frame rate ${perf.fps.toFixed(1)}`);
    if (growth.heapMB >= 1.5) why.push(`heap grew ${growth.heapMB} MB`);
    if (growth.nodes >= 60) why.push(`DOM nodes grew by ${growth.nodes}`);
    if (growth.listeners > 0) why.push(`event listeners grew by ${growth.listeners}`);
    if (report.levels.length !== 20) why.push('not every course was played');
    if (wins < 4) why.push(`only ${wins} finishes`);
    if (bumps < 3) why.push(`only ${bumps} bumps`);
    if (stuck) why.push('the speed button was left held');
    ok = why.length === 0;
    console.log(ok ? 'SOAK PASS' : 'SOAK FAIL: ' + why.join('; '));
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
