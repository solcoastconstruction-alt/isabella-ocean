// Rainbow Slide soak: a little over three minutes of random real-finger play across all twenty courses in all three modes,
// through the loops, the arches, the slips on Hard, the finish, the chest, the results card and the level select, at the
// Seeker's size.
//   node test/games/slide/soak.js [seconds] [outDir] [chromeProfileDir]
//   (defaults: 190 s, <repo>/.local/soak-slide, <repo>/.local/chrome-slide-soak; DevTools port 9492)
//   SLIDE_ROOT=<a copy of the repo's web/ tree> serves that copy instead (defects.js uses this)
// First a quick visit to every course in every mode (so every picture is drawn and every code path compiled before
// measuring), then the soak: a steering finger that wanders, stops, lifts and is sometimes cancelled; bursts of sensor events
// (leaning this way and that, either way round) and of window.__steer; every few seconds another course in another mode,
// and now and then a jump to a loop, an arch or the last stretch so those, the finish line, the chest and the results card's
// buttons get used too.
// Passes if the page logs no errors or exceptions, the particles stay under their cap and die away, the frame rate holds, every
// course was played, she poofed and finished courses and slipped off on Hard and was brought back, and nothing grows: JS
// heap, DOM nodes and event listeners, measured after a forced garbage collection after the warm-up and at the end.
'use strict';
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');
const { pose } = require('./phone.js');

const REPO = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.env.SLIDE_ROOT || REPO);
const SECONDS = +(process.argv[2] || 190);
const OUT = path.resolve(process.argv[3] || path.join(REPO, '.local/soak-slide'));
const PROFILE = path.resolve(process.argv[4] || path.join(REPO, '.local/chrome-slide-soak'));
const PORT = 9492, W = 915, H = 412, CAP = 380;
const MODES = ['easy', 'medium', 'hard'];
const URL_ = '/web/games/slide/index.html';

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
    await P.goto(base + URL_);
    await P.eval(`localStorage.setItem('game.slide.save', JSON.stringify({ v: 1, mode: 'easy', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: {}, best: {}, coins: 0, taught: true }))`);
    await P.goto(base + URL_);
    await sleep(400);
    await P.eval(`window.__motion = (x, y, z) => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y, z }, interval: 16 })); 1`);
    const metrics = async () => {
      await P.send('HeapProfiler.collectGarbage');
      await sleep(100);
      const m = {};
      for (const x of (await P.send('Performance.getMetrics')).metrics) m[x.name] = x.value;
      return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners };
    };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const st = () => P.eval(`(() => { const s = __slideDebug.state; return { screen: s.screen, level: s.level, mode: s.mode, phase: s.phase, s: s.s, len: s.len, poofs: s.poofs, slips: s.slips, restores: s.restores, loops: s.loops, cpN: s.cpN, particles: s.particles, page: s.page, coins: s.coins, input: s.input, hasKey: s.hasKey }; })()`);
    const startLevel = async (n, m) => { await P.eval(`__slideDebug.start(${n}, ${JSON.stringify(m)})`); await sleep(250); };
    let f1 = null;
    const down = () => [f1 && { id: 1, x: f1.x, y: f1.y }].filter(Boolean);
    const liftAll = async () => { if (f1) { await P.fingers('touchEnd', []); f1 = null; } };

    // warm-up: every course in every mode once, a little of everything in each
    for (const m of MODES) {
      for (let n = 1; n <= 20; n++) {
        await startLevel(n, m);
        await P.fingers('touchStart', [{ id: 1, x: rnd(0.2, 0.7) * W, y: 230 }]);
        await sleep(300);
        await P.fingers('touchMove', [{ id: 1, x: rnd(0.2, 0.7) * W, y: 230 }]);
        await sleep(200);
        await P.fingers('touchEnd', []);
        if (n % 7 === 1) {   // (and now and then all the way to the chest and the results card)
          await P.eval(`(() => { const lv = __slideDebug.run.lev; __slideDebug.warp(lv.len - 400, 0); })()`);
          await P.waitFor('__slideDebug.state.screen === "results"', 25000, `warm-up: ${m} course ${n} results`);
        }
      }
    }
    await startLevel(1, 'easy');
    await sleep(2000);
    const m0 = await metrics(), samples = [m0];
    console.log(`start: ${JSON.stringify(m0)}`);

    let level = 1, mode = 'easy', moves = 0, tilts = 0, bridges = 0, wins = 0, poofs = 0, slips = 0, backs = 0, loops = 0, arches = 0, lastPoofs = 0, lastSlips = 0, lastBack = 0, lastLoops = 0, lastArch = 0, maxParts = 0;
    const played = new Set(['easy:1']);
    const t0 = Date.now();
    let nextSample = t0 + 30000, levelSince = Date.now(), stay = rnd(5000, 9000);
    await P.eval('__slideDebug.resetPerf()');
    const next = () => { level = 1 + Math.floor(Math.random() * 20); mode = pick(MODES); };   // (any course in any mode)
    const reset = () => { lastPoofs = lastSlips = lastBack = lastLoops = lastArch = 0; levelSince = Date.now(); stay = rnd(3500, 7000); };
    while (Date.now() - t0 < SECONDS * 1000) {
      const s = await st();
      maxParts = Math.max(maxParts, s.particles);
      if (s.screen === 'play') {
        if (s.poofs > lastPoofs) poofs += s.poofs - lastPoofs;
        if (s.slips > lastSlips) slips += s.slips - lastSlips;
        if (s.restores > lastBack) backs += s.restores - lastBack;
        if (s.loops > lastLoops) loops += s.loops - lastLoops;
        if (s.cpN > lastArch) arches += s.cpN - lastArch;
        lastPoofs = s.poofs; lastSlips = s.slips; lastBack = s.restores; lastLoops = s.loops; lastArch = s.cpN;
      }
      if (s.screen === 'results') {
        wins++;
        await liftAll();
        await sleep(rnd(200, 1500));
        const which = pick(['#resNext', '#resReplay', '#resLevels']);
        const r = await P.eval(`(() => { const e = document.querySelector('${which}'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, shown: getComputedStyle(e).display !== 'none' }; })()`);
        if (r.shown) await P.tap(r.x, r.y);
        await sleep(400);
        const s2 = await st();
        if (s2.screen === 'levels') {
          // the level select: the mode's button, turn the page if need be, then a finger on the next course's bubble
          next();
          const mb = await P.eval(`(() => { const r = document.getElementById('mode-${mode}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          await P.tap(mb.x, mb.y); await sleep(250);
          const s3 = await st();
          const want = Math.floor((level - 1) / 10);
          if (s3.page !== want) { const a = await P.eval(`(() => { const b = document.getElementById('${want > s3.page ? 'pgNext' : 'pgPrev'}').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); await P.tap(a.x, a.y); await sleep(300); }
          const b = await P.eval(`(() => { const e = document.querySelector('.lvl[data-level="${level}"]'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          await P.tap(b.x, b.y);
          await sleep(400);
        } else { level = s2.level || level; mode = s2.mode || mode; }
        const s4 = await st(); played.add(`${s4.mode}:${s4.level}`);
        reset();
        continue;
      }
      if (s.screen === 'levels') { next(); await startLevel(level, mode); played.add(`${mode}:${level}`); reset(); continue; }
      if (s.phase !== 'play' && s.phase !== 'rescue') { await liftAll(); await sleep(200); continue; }   // gliding to the chest
      // after a while on a course: sometimes a jump to a loop, an arch or the last stretch, otherwise on to the next course
      if (Date.now() - levelSince > stay) {
        const u = Math.random();
        if (u < 0.3) { await P.eval(`(() => { const lv = __slideDebug.run.lev; if (lv.loops.length) { const a = lv.loops[0].a - 150; __slideDebug.warp(a, SlideLogic.laneAt(lv, a)); } else { const a = lv.arches[0] - 100; __slideDebug.warp(a, SlideLogic.laneAt(lv, a)); } })()`); levelSince = Date.now(); stay = rnd(3000, 5000); continue; }
        if (u < 0.45) { await P.eval(`(() => { const r = __slideDebug.run; r.x = (r.x >= 0 ? 1 : -1) * (r.lev.hw + 30); })()`); levelSince = Date.now(); stay = rnd(3000, 5000); continue; }   // (pushed off the rim: a slip on Hard, a bump or a rail otherwise)
        if (u < 0.7) { await P.eval(`(() => { const lv = __slideDebug.run.lev; __slideDebug.warp(lv.len - ${Math.round(rnd(400, 1500))}); })()`); levelSince = Date.now() + 30000; continue; }
        await liftAll();
        next(); await startLevel(level, mode); played.add(`${mode}:${level}`); reset();
        continue;
      }
      const u = Math.random();
      if (u < 0.65) {
        // the steering finger: down somewhere, or moved (a little or a lot), or lifted
        if (!f1) { f1 = { x: rnd(0.03, 0.97) * W, y: rnd(0.25, 0.95) * H }; await P.fingers('touchStart', down()); }
        else if (Math.random() < 0.8) { f1 = { x: Math.max(4, Math.min(0.97 * W, f1.x + rnd(-1, 1) * (Math.random() < 0.3 ? 400 : 90))), y: f1.y + rnd(-20, 20) }; await P.fingers('touchMove', down()); }
        else { const was = f1; f1 = null; if (Math.random() < 0.2) await P.fingers('touchCancel', []); else await P.fingers('touchEnd', [{ id: 1, x: was.x, y: was.y }]); }
        moves++;
      } else if (u < 0.85) {
        // a burst of sensor events: the phone leaning some way, either way round, tipped back some amount
        const v = pose(Math.random() < 0.5 ? 90 : 270, rnd(-28, 28), rnd(0, 70));
        await P.eval(`(async () => { for (let i = 0; i < 12; i++) { __motion(${v[0]} + 0.05 * Math.sin(i), ${v[1]} + 0.05 * Math.cos(i * 2), ${v[2]}); await new Promise((r) => setTimeout(r, 16)); } })()`);
        tilts++;
      } else { await P.eval(`__steer(${rnd(-1.3, 1.3).toFixed(2)})`); bridges++; }
      await sleep(rnd(20, 380));
      if (Date.now() > nextSample) { const m = await metrics(); samples.push(m); console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(m)} ${s.mode} course ${s.level} finger moves ${moves} tilts ${tilts} poofs ${poofs} slips ${slips} loops ${loops} arches ${arches} finishes ${wins}`); nextSample += 30000; }
    }
    await liftAll();
    // any course the random play did not reach yet: a few seconds of it now, so every course in every mode is played
    for (const m of MODES) for (let n = 1; n <= 20; n++) {
      if (played.has(`${m}:${n}`)) continue;
      await startLevel(n, m);
      await P.fingers('touchStart', [{ id: 1, x: rnd(0.2, 0.7) * W, y: 230 }]);
      await sleep(1200);
      await P.fingers('touchEnd', []);
      played.add(`${m}:${n}`);
    }
    const perf = await P.eval('__slideDebug.perf()');
    // end on a course, as she would, then measure
    await startLevel(1, 'easy');
    await sleep(5000);
    const resting = (await st()).particles;   // sliding with nothing happening: only a little dust is alive
    const m1 = await metrics();
    samples.push(m1);
    await P.shot(path.join(OUT, 'soak-end.png'));
    const growth = { heapMB: +(m1.heapMB - m0.heapMB).toFixed(2), nodes: m1.nodes - m0.nodes, listeners: m1.listeners - m0.listeners };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), fingerMoves: moves, tilts, bridges, finishes: wins, poofs, slips, backs, loops, arches, played: [...played].length, maxParticles: maxParts, restingParticles: resting, perf, start: m0, end: m1, growth, samples, errors: page.errors };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    console.log(`end:   ${JSON.stringify(m1)}`);
    console.log(JSON.stringify({ seconds: report.seconds, fingerMoves: moves, tilts, bridges, finishes: wins, poofs, slips, backs, loops, arches, coursesPlayed: report.played, maxParticles: maxParts, restingParticles: resting, fps: +perf.fps.toFixed(1), drawP95Ms: +perf.drawP95Ms.toFixed(2), drawMaxMs: +perf.drawMaxMs.toFixed(2), growth, errors: page.errors.length }));
    const why = [];
    if (page.errors.length) why.push('page errors: ' + JSON.stringify(page.errors.slice(0, 3)));
    if (maxParts >= CAP) why.push(`particles reached their cap (${maxParts})`);
    if (resting > 60) why.push(`particles pile up (${resting} alive after five quiet seconds)`);
    if (!(perf.fps > 50)) why.push(`frame rate ${perf.fps.toFixed(1)}`);
    if (growth.heapMB >= 1.5) why.push(`heap grew ${growth.heapMB} MB`);
    if (growth.nodes >= 60) why.push(`DOM nodes grew by ${growth.nodes}`);
    if (growth.listeners > 0) why.push(`event listeners grew by ${growth.listeners}`);
    if (played.size !== 60) why.push(`not every course in every mode was played (${played.size}/60)`);
    if (wins < 4) why.push(`only ${wins} finishes`);
    if (poofs < 3) why.push(`only ${poofs} poofs`);
    if (slips < 1 || backs < 1) why.push(`no slip off the rim on Hard was seen and brought back (${slips} slips, ${backs} returns)`);
    if (loops < 2 || arches < 2) why.push(`only ${loops} loops and ${arches} arches were reached`);
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
