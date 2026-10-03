// Sea Words soak: a little over three minutes of random real-finger play across all three sizes, at the Seeker's size:
// scribbles anywhere (short, long, crooked, slow, off the board), real drags along words from either end, taps,
// two fingers at once, quiet spells that bring a hint, the size button mid-puzzle, the results card's buttons and the
// picker's. Every touch goes through Input.dispatchTouchEvent.
//   node test/games/words/soak.js [seconds] [outDir] [chromeProfileDir]
//   (defaults: 200 s, $TMPDIR/sea-words-soak, $TMPDIR/chrome-words-soak; DevTools port 9457)
// Passes if the page logs no errors or exceptions, puzzles of every size get finished, the particles stay under their
// cap, the picture and letter caches stay small, the frame rate holds, and nothing grows: JS heap, DOM nodes and event
// listeners measured after a forced garbage collection after a warm-up and at the end (and sampled in between).
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const SECONDS = +(process.argv[2] || 200);
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'sea-words-soak'));
const PROFILE = path.resolve(process.argv[4] || path.join(os.tmpdir(), 'chrome-words-soak'));
const PORT = 9457, W = 915, H = 412;

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
    await P.goto(base + '/web/games/words/index.html');
    await P.eval('localStorage.clear()');
    await P.goto(base + '/web/games/words/index.html');
    await sleep(500);
    const metrics = async () => {
      await P.send('HeapProfiler.collectGarbage');
      await sleep(100);
      const m = {};
      for (const x of (await P.send('Performance.getMetrics')).metrics) m[x.name] = x.value;
      return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners };
    };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const st = () => P.eval('__wordsDebug.state');
    const center = async (sel) => P.eval(`(() => { const e = document.querySelector('${sel}'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, shown: getComputedStyle(e).display !== 'none' }; })()`);
    const tapSel = async (sel) => { const c = await center(sel); if (c.shown) await P.tap(c.x, c.y); return c.shown; };
    async function wordDrag(s, w) {
      const cell = s.cell.px, rev = Math.random() < 0.5, c0 = rev ? w.cells[w.cells.length - 1] : w.cells[0], c1 = rev ? w.cells[0] : w.cells[w.cells.length - 1];
      const a = await P.eval(`__wordsDebug.cellCss(${c0[0]}, ${c0[1]})`), b = await P.eval(`__wordsDebug.cellCss(${c1[0]}, ${c1[1]})`);
      const j = () => { const t = Math.random() * Math.PI * 2, r = Math.random() * 0.35 * cell; return [Math.cos(t) * r, Math.sin(t) * r]; };
      const ja = j(), jb = j(), A = { x: a.x + ja[0], y: a.y + ja[1] }, B = { x: b.x + jb[0], y: b.y + jb[1] }, n = 4 + Math.floor(Math.random() * 10), pts = [A];
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1, nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
      for (let k = 1; k < n; k++) { const u = k / n, wv = Math.sin(u * Math.PI * 3) * rnd(0, 0.28) * cell; pts.push({ x: A.x + (B.x - A.x) * u + nx * wv, y: A.y + (B.y - A.y) * u + ny * wv }); }
      pts.push(B);
      await P.drag(pts, Math.random() < 0.2 ? 40 : 14);
    }
    // anywhere: on the board, around it, a little over the picture panel; any length and angle
    async function scribble(s) {
      const L = s.layout.board, x0 = rnd(L.left - 30, L.right + 60), y0 = rnd(L.top - 10, L.bottom + 10), ang = rnd(0, Math.PI * 2), len = rnd(5, (L.right - L.left) * 0.9);
      const n = 2 + Math.floor(Math.random() * 12), pts = [];
      for (let k = 0; k <= n; k++) { const u = k / n; pts.push({ x: Math.min(W - 5, Math.max(130, x0 + Math.cos(ang) * len * u + rnd(-12, 12))), y: Math.min(H - 5, Math.max(5, y0 + Math.sin(ang) * len * u + rnd(-12, 12))) }); }
      await P.drag(pts, Math.random() < 0.2 ? 45 : 12);
    }
    let solvedByMode = { easy: 0, medium: 0, hard: 0 }, drags = 0, wordDrags = 0, taps = 0, twoFinger = 0, hintsSeen = 0, maxParts = 0, maxCaches = { glyphs: 0, pictures: 0 }, lastPhase = '';
    // warm-up: a puzzle of each size, finished, so every code path has run before measuring
    for (const m of ['easy', 'medium', 'hard']) {
      await P.eval(`__wordsDebug.start('${m}')`);
      await sleep(300);
      const s = await st();
      for (let k = 0; k < 3; k++) await scribble(s);
      for (const w of s.words) await P.eval(`__wordsDebug.find(${JSON.stringify(w.word)})`);
      await P.waitFor('__wordsDebug.state.screen === "results"', 8000, 'results in the warm-up');
      await sleep(600);
    }
    await tapSel('#resModes');
    await sleep(800);
    const m0 = await metrics(), samples = [m0];
    console.log(`start: ${JSON.stringify(m0)}`);
    const t0 = Date.now();
    let nextSample = t0 + 30000;
    await P.eval('__wordsDebug.resetPerf()');
    while (Date.now() - t0 < SECONDS * 1000) {
      const s = await st();
      maxParts = Math.max(maxParts, s.particles);
      maxCaches.glyphs = Math.max(maxCaches.glyphs, s.caches.glyphs); maxCaches.pictures = Math.max(maxCaches.pictures, s.caches.pictures);
      if (s.hint && lastPhase !== 'hint') { hintsSeen++; lastPhase = 'hint'; } else if (!s.hint) lastPhase = '';
      if (s.screen === 'modes') {
        // the size played least so far (ties at random), so all three get plenty of play
        const least = Math.min(...Object.values(solvedByMode)), pick = Object.keys(solvedByMode).filter((m) => solvedByMode[m] === least);
        await tapSel('#mode-' + pick[Math.floor(Math.random() * pick.length)]);
        await sleep(rnd(200, 600));
        continue;
      }
      if (s.screen === 'results') {
        solvedByMode[s.mode]++;
        await sleep(rnd(300, 1500));
        await tapSel(Math.random() < 0.5 ? '#resNext' : '#resModes');
        await sleep(400);
        continue;
      }
      if (s.phase !== 'play') { await sleep(200); continue; }
      const r = Math.random(), unfound = s.words.filter((w) => !w.found);
      if (r < 0.45) { await scribble(s); drags++; }
      else if (r < 0.8 && unfound.length) { await wordDrag(s, unfound[Math.floor(Math.random() * unfound.length)]); wordDrags++; }
      else if (r < 0.88) { const L = s.layout.board; await P.tap(rnd(L.left, L.right), rnd(L.top, L.bottom)); taps++; }
      else if (r < 0.93) {
        // two fingers at once: the second is ignored, the first still draws its line
        const L = s.layout.board, a = { x: rnd(L.left, L.right), y: rnd(L.top, L.bottom) }, b = { x: rnd(L.left, L.right), y: rnd(L.top, L.bottom) };
        await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
        await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }] });
        for (let k = 1; k <= 4; k++) { await sleep(16); await P.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + k * 12, y: a.y + k * 6, id: 1 }, { x: b.x - k * 10, y: b.y, id: 2 }] }); }
        await P.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        twoFinger++;
      } else if (r < 0.96) { await P.eval('__wordsDebug.idle(45)'); }              // a long think: a hint appears
      else if (r < 0.966) { await tapSel('#modesBtn'); await sleep(300); }      // changes her mind mid-puzzle
      await sleep(rnd(30, 350));
      if (Date.now() > nextSample) {
        const m = await metrics(); samples.push(m);
        console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(m)} drags ${drags} wordDrags ${wordDrags} taps ${taps} solved ${JSON.stringify(solvedByMode)}`);
        nextSample += 30000;
      }
    }
    const perf = await P.eval('__wordsDebug.perf()');
    // end on the picker, as she would, then measure
    for (let k = 0; k < 20 && (await st()).screen !== 'modes'; k++) {
      const s = await st();
      if (s.screen === 'results') await tapSel('#resModes');
      else if (s.screen === 'play' && s.phase === 'play') await tapSel('#modesBtn');
      await sleep(500);
    }
    await sleep(1500);
    const m1 = await metrics();
    samples.push(m1);
    await P.shot(path.join(OUT, 'soak-end.png'));
    const finalState = await st();
    const growth = { heapMB: +(m1.heapMB - m0.heapMB).toFixed(2), nodes: m1.nodes - m0.nodes, listeners: m1.listeners - m0.listeners };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), drags, wordDrags, taps, twoFinger, hintsSeen, solved: solvedByMode, saved: finalState.save.solved, maxParticles: maxParts, maxCaches, perf, start: m0, end: m1, growth, samples, errors: page.errors };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    console.log(`end:   ${JSON.stringify(m1)}`);
    console.log(JSON.stringify({ seconds: report.seconds, drags, wordDrags, taps, twoFinger, hintsSeen, solved: solvedByMode, maxParticles: maxParts, maxCaches, fps: +perf.fps.toFixed(1), drawP95Ms: +perf.drawP95Ms.toFixed(2), growth, errors: page.errors.length }));
    ok = page.errors.length === 0 && maxParts < 650 && perf.fps > 50 && growth.heapMB < 1 && growth.nodes < 60 && growth.listeners <= 0
      && solvedByMode.easy >= 1 && solvedByMode.medium >= 1 && solvedByMode.hard >= 1 && maxCaches.glyphs <= 80 && maxCaches.pictures <= 40 && finalState.screen === 'modes';
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
