// Long-play check for Sea Jigsaw: about three minutes of random real-touch play across all three sizes.
//   node test/games/jigsaw/soak.js [outDir] [chromeProfileDir] [seconds=180]
//   (defaults: <repo>/.local/soak and <repo>/.local/chrome-jigsaw-soak; DevTools port 9481)
// Fingers drag random pieces (mostly home, sometimes to the wrong place, back to the tray or off the board), tap
// pieces and empty water, drag two at once, press the picture button; puzzles are picked on the level select, some
// are left half done, some are finished, and the results card's buttons are used. Checks: no exceptions or console
// errors; the picture on screen always agrees with the rules (no piece lost, doubled or stuck); the coins saved are
// exactly the coins won; nothing piles up (particles, timers, coins in flight); and no memory growth: JS data in a
// heap-snapshot diff, every canvas made either in use or freed, DOM nodes and listeners, 50 trips through the level
// select and 8 chests in a row leaving nothing behind.
//   JIGSAW_DIR=<dir> soaks another copy of the game.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.JIGSAW_DIR ? path.resolve(process.env.JIGSAW_DIR) : path.join(ROOT, 'web/games/jigsaw');
const PAGE = 'file://' + path.join(DIR, 'index.html');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.local/soak'));
const PROFILE = path.resolve(process.argv[3] || path.join(ROOT, '.local/chrome-jigsaw-soak'));
const SECONDS = +(process.argv[4] || 180);
const W = 915, HT = 412, DPR = 2.625, PORT = 9481;

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: PORT, profile: PROFILE, width: W, height: HT });
  const problems = [];
  let onGame = true;
  cdp.on((m) => {
    const p = m.params || {};
    if (!onGame) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && /^(error|warning|assert)$/.test(p.type)) problems.push('console.' + p.type + ': ' + p.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Log.entryAdded' && /^(error|warning)$/.test(p.entry.level)) problems.push('log.' + p.entry.level + ': ' + p.entry.text);
  });
  try {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('HeapProfiler.enable');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: HT, deviceScaleFactor: DPR, mobile: true });
    const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(e.slice(0, 80) + ': ' + r.exceptionDetails.text); return r.result.value; };
    const D = (e) => ev('window.__jigsawDebug.' + e);
    const st = () => D('state()');
    // every puzzle open, so the soak can wander; one puzzle of each size a piece or two from done, so chests and
    // results cards come up early (set as the page starts, before the game reads it)
    const seq = (n) => Array.from({ length: n }, (_, i) => i);
    const seed = { v: 1, mode: 'easy', coins: 0, solved: 0, easy: { unlocked: 10, best: new Array(10).fill(-1) }, medium: { unlocked: 10, best: new Array(10).fill(-1) }, hard: { unlocked: 10, best: new Array(10).fill(-1) },
      runs: { e1: { home: seq(3), t: 5 }, m1: { home: seq(10), t: 40 }, h1: { home: seq(21), t: 90 } } };
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); localStorage.setItem('game.jigsaw.save', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}` });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: PAGE });
    await loaded; await sleep(800);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    async function tap(x, y) { await touch('touchStart', [pt(x, y, 1)]); await touch('touchEnd', []); }
    async function tapEl(sel) {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || getComputedStyle(e).display === 'none' || (e.offsetParent === null && getComputedStyle(e).position !== 'fixed')) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
      if (r) await tap(r.x, r.y);
      return !!r;
    }
    // one or more fingers, each from a[i] to b[i], moving together
    async function drag(a, b, steps) {
      await touch('touchStart', a.map((p, i) => pt(p.x, p.y, i + 1)));
      for (let k = 1; k <= steps; k++) { const u = k / steps; await touch('touchMove', a.map((p, i) => pt(p.x + (b[i].x - p.x) * u, p.y + (b[i].y - p.y) * u, i + 1))); await sleep(16); }
      await touch('touchEnd', []);
    }
    const rnd = (a, z) => a + Math.random() * (z - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // Measured the same way every time: on the level select (after a look at all three sizes, so their thirty little
    // pictures are painted and kept), after it has drawn, after two full GCs.
    const heap = async (onLevels) => {
      if (onLevels) { for (const m of ['medium', 'hard', 'easy']) { await D(`goLevels('${m}')`); await sleep(30); } await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(250); }
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      // what the page is showing that grows as puzzles get finished: a key on each finished puzzle, its bonus coins, the last results card
      // (measured: a key badge is about 8 nodes once drawn, a coin about 7)
      const icons = await ev(`document.querySelectorAll('.lvl.done').length * 8 + document.querySelectorAll('.lvl .st svg, #resLoot svg').length * 7`);
      return { usedMB: +(h.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents, icons };
    };
    // Bytes held, by kind of thing, from a heap snapshot. Compiled code is kept apart: V8 compiles more as more of
    // the game gets played, which is warm-up, not a leak. Everything else (objects, arrays, closures, strings...)
    // is what a leak would pile up.
    let chunks = null;
    cdp.on((m) => { if (chunks && m.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(m.params.chunk); });
    async function heldByKind() {
      chunks = [];
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      const snap = JSON.parse(chunks.join('')); chunks = null;
      const f = snap.snapshot.meta.node_fields, nf = f.length, ti = f.indexOf('type'), si = f.indexOf('self_size'), types = snap.snapshot.meta.node_types[0];
      const out = {};
      for (let i = 0; i < snap.nodes.length; i += nf) { const t = types[snap.nodes[i + ti]]; out[t] = (out[t] || 0) + snap.nodes[i + si]; }
      return out;
    }
    // the picture of a piece must agree with the rules about it (when no finger is holding anything)
    const agrees = { home: ['home', 'snap'], tray: ['tray'], loose: ['loose'], bag: ['bag', 'tobag'] };

    const peak = { parts: 0, timers: 0, flying: 0, leaving: 0, loose: 0, live: 0, pixels: 0 };
    const tally = { drags: 0, multi: 0, taps: 0, peeks: 0, puzzles: {}, results: 0, left: 0, quick: 0, walkedOut: 0, disagree: 0, lost: 0, modes: 0 };
    const memory = [];
    let shots = 0, sessionStart = Date.now(), lastPuzzle = null;
    const t0 = Date.now(), warm = 20000;
    let base = null, baseKinds = null;
    while (Date.now() - t0 < SECONDS * 1000) {
      if (!base && Date.now() - t0 > warm) { base = await heap(true); baseKinds = await heldByKind(); memory.push({ t: Math.round((Date.now() - t0) / 1000), ...base }); continue; }
      if (base && memory.length && Date.now() - t0 - memory[memory.length - 1].t * 1000 > 20000) memory.push({ t: Math.round((Date.now() - t0) / 1000), ...(await heap()) });
      const s = await st();
      peak.parts = Math.max(peak.parts, s.parts); peak.timers = Math.max(peak.timers, s.timers); peak.flying = Math.max(peak.flying, s.flying); peak.leaving = Math.max(peak.leaving, s.leaving);
      peak.loose = Math.max(peak.loose, s.loose.length); peak.live = Math.max(peak.live, s.caches.live); peak.pixels = Math.max(peak.pixels, s.caches.pixels);
      if (s.screen !== 'levels' && s.held === 0) {
        for (const q of s.pieces) if (!agrees[q.rule].includes(q.st)) tally.disagree++;
        const counted = s.pieces.filter((q) => q.rule === 'home').length;
        if (counted !== s.homeCount || s.pieces.length !== s.n) tally.lost++;
      }
      if (s.screen === 'levels') {
        if (Math.random() < 0.25) { await tapEl('#mode-' + pick(['easy', 'medium', 'hard'])); tally.modes++; await sleep(200); continue; }
        // mostly the first few puzzles of a size (they get finished within a session), sometimes the big late ones
        const n = Math.random() < 0.65 ? 1 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 7);
        await tapEl(`.lvl[data-n="${n}"]`); await sleep(350);
        sessionStart = Date.now(); continue;
      }
      if (s.screen === 'results') {
        tally.results++;
        if (shots < 2) { fs.writeFileSync(path.join(OUT, `results-${++shots}.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64')); }
        const r = Math.random();
        if (!(r < 0.4 && await tapEl('#resNext'))) await tapEl(r < 0.75 ? '#resLevels' : '#resReplay');
        await sleep(400); sessionStart = Date.now(); continue;
      }
      if (s.puzzle !== lastPuzzle) { lastPuzzle = s.puzzle; tally.puzzles[s.puzzle] = (tally.puzzles[s.puzzle] || 0) + 1; }
      if (s.phase !== 'play') {
        // the key, the chest and the coins play out by themselves; now and then a child leaves in the middle of them
        if (s.winT > 1 && Math.random() < 0.04) { await tapEl('#gridBtn'); tally.walkedOut++; }
        await sleep(250); continue;
      }
      if (Date.now() - sessionStart > 14000 || Math.random() < 0.012) {
        // long enough on this one (or a child who changes her mind): leave it half done for later, or finish it off in a rush (the chest comes)
        if (Math.random() < 0.3) { await D('solve(99)'); tally.quick++; } else { await tapEl('#gridBtn'); tally.left++; }
        await sleep(300); sessionStart = Date.now(); continue;
      }
      const free = s.pieces.filter((q) => (q.st === 'tray' || q.st === 'loose') && q.ready);
      const r = Math.random();
      if (!free.length) { await sleep(120); continue; }
      if (r < 0.05) { await tapEl('#eyeBtn'); tally.peeks++; await sleep(rnd(100, 500)); continue; }
      if (Math.random() < 0.05 && s.started) await D('addTime(70)');   // a child who takes her time: the bonus coins drift off
      if (r < 0.1) { await tap(rnd(s.board.left + 20, s.board.right - 20), rnd(s.board.top + 20, s.board.bottom - 20)); tally.taps++; await sleep(60); continue; }
      if (r < 0.16) { const q = pick(free); await tap(q.cx, q.cy); tally.taps++; await sleep(80); continue; }
      if (r < 0.28 && free.length >= 2) {
        // two fingers at once, each carrying a piece home
        const [p, q] = [free[0], free[free.length - 1]];
        await drag([{ x: p.cx, y: p.cy }, { x: q.cx, y: q.cy }], [{ x: p.hcx, y: p.hcy }, { x: q.hcx + 3, y: q.hcy }], 10);
        tally.multi++; await sleep(80); continue;
      }
      const q = pick(free), g = Math.random();
      const to = g < 0.6 ? { x: q.hcx + rnd(-0.5, 0.5) * s.snapR, y: q.hcy + rnd(-0.5, 0.5) * s.snapR }                                   // home (near enough)
        : g < 0.84 ? { x: rnd(s.board.left + 10, s.board.right - 10), y: rnd(s.board.top + 10, s.board.bottom - 10) }                      // somewhere on the board
        : g < 0.94 ? { x: rnd(s.tray.left + 10, s.tray.right - 10), y: rnd(s.tray.top + 40, s.tray.bottom - 10) }                           // back to the tray
        : { x: rnd(2, W - 2), y: pick([2, HT - 2]) };                                                                                       // off the edge of the table
      await drag([{ x: q.cx, y: q.cy }], [to], 5 + Math.floor(Math.random() * 6));
      tally.drags++;
      await sleep(20 + Math.random() * 50);
    }
    const end = await heap(true), endKinds = await heldByKind();
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...end });
    const kindsGrew = {};
    for (const k of new Set(Object.keys(baseKinds).concat(Object.keys(endKinds)))) kindsGrew[k] = +(((endKinds[k] || 0) - (baseKinds[k] || 0)) / 1024).toFixed(1);
    // JS data = everything a game leak would pile up; 'native' is the canvases' pixels (counted separately below, as
    // canvases made and freed) and 'code' is V8 compiling more of the game as it is played
    const jsDataKB = +Object.keys(kindsGrew).filter((k) => !['code', 'native', 'hidden', 'synthetic'].includes(k)).reduce((a, k) => a + kindsGrew[k], 0).toFixed(1);
    // fifty trips to the level select and back: the rebuilt grid must not leave DOM nodes, listeners or canvases behind
    const tripsBefore = await heap(true), liveBefore = (await st()).caches.live;
    for (let i = 0; i < 50; i++) { await D(`goLevels('${['easy', 'medium', 'hard'][i % 3]}')`); await sleep(20); await D(`start('${['easy', 'medium', 'hard'][i % 3]}', ${1 + (i % 10)}, true)`); await sleep(20); }
    const tripsAfter = await heap(true), liveAfter = (await st()).caches.live;
    // eight chests and results cards in a row (game time x4): the cards' coins and the party must not pile up either
    await D('timeScale(4)');
    const chestNodes = [];
    for (let i = 0; i < 8; i++) {
      await D("start('easy', 1, true)");
      await D('solve(4)');
      for (let w = 0; w < 80 && !(await st()).results; w++) await sleep(100);
      await sleep(400);
      if (i === 1 || i === 7) chestNodes.push((await heap(true)).nodes); else await D('goLevels()');
    }
    await D('timeScale(1)');
    const trips = { nodes: tripsAfter.nodes - tripsBefore.nodes, listeners: tripsAfter.listeners - tripsBefore.listeners, canvases: liveAfter - liveBefore, chestNodes: chestNodes[1] - chestNodes[0] };
    // frame rate at the end: Hard 10 with pieces all over the board
    await D("start('hard', 10, true)"); await sleep(400); await D('solve(6)');
    for (let i = 0; i < 12; i++) { const q = (await st()).pieces.find((v) => v.st === 'tray' && v.ready); if (q) await D(`drop(${q.id}, 'board')`); await sleep(120); }
    await sleep(800);
    const fps = await ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
    fs.writeFileSync(path.join(OUT, 'soak-end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64'));
    const s = await st(), c = await D('counters'), perf = await D('perf()'), saved = JSON.parse(await D('saved()'));
    // DOM nodes, less the keys and coins the level select now shows for the puzzles finished since the baseline
    const grew = { heapMB: +(end.usedMB - base.usedMB).toFixed(2), codeKB: kindsGrew.code || 0, nativeKB: kindsGrew.native || 0, jsDataKB, nodes: end.nodes - base.nodes - Math.max(0, end.icons - base.icons), rawNodes: end.nodes - base.nodes, listeners: end.listeners - base.listeners, trips, caches: s.caches };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), tally, peak, memory, grew, kindsGrewKB: kindsGrew, counters: c, coinsSaved: saved.coins, fps: +fps.toFixed(1), perf, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    // Nothing piles up: particles are capped at 600, a celebration's timers and flying coins are few, at most three
    // bonus coins can drift at once, and only one puzzle's canvases are alive (its picture, its board, two a piece, the
    // level select's thirty little pictures, a few glows, one sea, one coin).
    const cs = s.caches;
    const bounded = peak.parts <= 600 && peak.timers < 60 && peak.flying < 24 && peak.leaving <= 3 && peak.loose <= 40 && peak.live <= 2 + 80 + 30 + cs.glow + 2 && cs.glow <= 12 && cs.thumbs <= 30 && cs.back <= 1;
    // No memory growth: JS data grows by under 100 KB; DOM nodes and listeners stay put; 50 trips and 8 chests leave nothing.
    const flat = jsDataKB < 100 && grew.heapMB < 1.5 && grew.nodes < 100 && grew.listeners <= 0 && end.documents <= base.documents
      && trips.nodes < 20 && trips.listeners <= 0 && trips.canvases <= 30 && trips.chestNodes < 10;
    const played = tally.drags > 100 && c.snaps > 60 && c.misses > 15 && c.backs + c.bags > 3 && c.taps > 3 && c.peeks > 1 && tally.multi > 3 && c.finishes >= 3 && tally.results >= 2
      && Object.keys(tally.puzzles).length >= 5 && tally.left >= 1 && c.maxPointers >= 2 && c.drifted >= 1;
    const coinsRight = saved.coins === c.coinsWon;
    console.log(JSON.stringify({ seconds: report.seconds, drags: tally.drags, twoFinger: tally.multi, taps: tally.taps, peeks: c.peeks, snaps: c.snaps, wrongDrops: c.misses, backToTray: c.backs + c.bags, hints: c.hints,
      bonusDrifted: c.drifted, finishes: c.finishes, results: tally.results, leftHalfDone: tally.left, leftMidCelebration: tally.walkedOut, puzzlesPlayed: Object.keys(tally.puzzles).length, coinsWon: c.coinsWon, coinsSaved: saved.coins,
      disagree: tally.disagree, lost: tally.lost, peak, memory, grew, fps: report.fps, problems: problems.length }));
    const ok = problems.length === 0 && bounded && flat && played && coinsRight && tally.disagree === 0 && tally.lost === 0 && fps >= 55;
    console.log(ok ? 'SOAK PASS' : `SOAK FAIL (problems ${problems.length}, bounded ${bounded}, flat ${flat}, played ${played}, coinsRight ${coinsRight}, disagree ${tally.disagree}, lost ${tally.lost}, fps ${fps.toFixed(1)})`);
    if (problems.length) console.log(problems.slice(0, 5).join('\n'));
    onGame = false;
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
