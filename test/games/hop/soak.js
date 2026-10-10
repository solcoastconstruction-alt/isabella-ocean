// Long-play check for Toadstool Hop: about three minutes of random real-touch play across the levels, modes and both worlds (after a warm-up).
//   node test/games/hop/soak.js [outDir] [chromeProfileDir] [seconds=180]
//   (defaults: <repo>/.local/soak-hop and <repo>/.local/chrome-hop-soak; DevTools port 9493)
// A finger taps at random: on the left half, on the right half, in a flurry, in the air, while she is in the water, a second finger now and then,
// and a quiet spell now and then (the hand shows). Levels are picked on the level select, in every mode, and left through the results card (or
// back to the levels after 30 seconds of a level, so several levels get played). Checks: no exceptions or console errors; nothing piles up
// (particles, coins in flight); the coins shown always equal the coins the rules hold and never fall below 0; she is never off the screen after
// a rescue; and no memory growth: JS data in a heap-snapshot diff, DOM nodes and listeners, 50 trips through the level select and 8 chests in
// a row (the game's own autopilot at 8x) leaving nothing behind.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.HOP_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/hop/index.html');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.local/soak-hop'));
const PROFILE = path.resolve(process.argv[3] || path.join(ROOT, '.local/chrome-hop-soak'));
const SECONDS = +(process.argv[4] || 180);
const W = 915, HT = 412, DPR = 2.625, PORT = 9493;

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
    const D = (e) => ev('window.__dbg.' + e);
    const st = () => D('state()');
    // every level open in every mode, so the soak can wander (set as the page starts, before the game reads it)
    const seed = { v: 1, mode: 'easy', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] }, coins: 5, runs: {} };
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); localStorage.setItem('game.hop.save', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}` });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: PAGE });
    await loaded; await sleep(800);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const rnd = (a, z) => a + Math.random() * (z - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    async function tap(x, y) { await touch('touchStart', [pt(x, y, 1)]); await touch('touchEnd', []); }
    async function tapEl(sel) {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
      if (r) await tap(r.x, r.y);
      return !!r;
    }
    // Measured the same way every time: on the level select, after it has drawn, after two full GCs.
    const heap = async (onLevels) => {
      if (onLevels) { await D('goLevels()'); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(250); }
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      return { usedMB: +(h.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
    };
    // Bytes held, by kind of thing, from a heap snapshot. Compiled code is kept apart: V8 compiles more as more of the game gets
    // played, which is warm-up, not a leak. Everything else (objects, arrays, closures, strings...) is what a leak would pile up.
    let chunks = null;
    cdp.on((m) => { if (chunks && m.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(m.params.chunk); });
    async function heldByKind() {
      chunks = [];
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      const snap = JSON.parse(chunks.join('')); chunks = null;
      const fl = snap.snapshot.meta.node_fields, nf = fl.length, ti = fl.indexOf('type'), si = fl.indexOf('self_size'), types = snap.snapshot.meta.node_types[0];
      const out = {};
      for (let i = 0; i < snap.nodes.length; i += nf) { const t = types[snap.nodes[i + ti]]; out[t] = (out[t] || 0) + snap.nodes[i + si]; }
      return out;
    }
    async function playToResults(n, m, ms) {
      await D(`start(${n}, "${m}", true)`); await D('auto(true)'); await D('timeScale(8)');
      for (let w = 0; w < (ms || 600) && !(await st()).results; w++) await sleep(100);
      await D('auto(false)'); await D('timeScale(1)');
    }

    const peak = { parts: 0, flies: 0, lostCoins: 0 };
    const tally = { taps: 0, left: 0, right: 0, flurries: 0, twoFingers: 0, inAir: 0, inWater: 0, levels: {}, modes: {}, results: 0, levelSwitches: 0, coinMismatch: 0, belowZero: 0, hands: 0, offScreen: 0 };
    const memory = [];
    // Warm up first, so the memory baseline is taken after every part of the game has run once (V8 compiles each function the first time
    // it is used: that is not a leak): a chest in each world, a splash on every kind of platform, butterflies, the key, the results card.
    await playToResults(9, 'medium'); await sleep(1200); await tapEl('#resLevels'); await sleep(300);
    await playToResults(16, 'hard'); await sleep(1200); await tapEl('#resLevels'); await sleep(300);
    await D('start(12, "hard", true)');
    for (let i = 0; i < 160; i++) { await tap(rnd(30, W - 30), rnd(110, HT - 10)); await sleep(rnd(60, 300)); }
    await D('goLevels()'); await sleep(300);
    const warmed = await D('counters');
    if (!(warmed.chests >= 2 && warmed.splashes >= 1 && warmed.butterflies >= 1 && warmed.keys >= 1)) throw new Error('the warm-up did not reach two chests, a splash, a butterfly and a key: ' + JSON.stringify(warmed));

    let shots = 0, sessionStart = Date.now(), lastKey = null, turn = 0;
    const ORDER = [[3, 'easy'], [5, 'medium'], [12, 'hard'], [8, 'hard'], [1, 'medium'], [17, 'easy'], [10, 'hard'], [6, 'easy'], [14, 'medium'], [20, 'hard'], [4, 'medium'], [11, 'easy']];
    const t0 = Date.now();
    const base = await heap(true), baseKinds = await heldByKind();
    memory.push({ t: 0, ...base });
    while (Date.now() - t0 < SECONDS * 1000) {
      if (Date.now() - t0 - memory[memory.length - 1].t * 1000 > 20000) memory.push({ t: Math.round((Date.now() - t0) / 1000), ...(await heap()) });
      const s = await st();
      peak.parts = Math.max(peak.parts, s.parts); peak.flies = Math.max(peak.flies, s.flies); peak.lostCoins = Math.max(peak.lostCoins, s.lostCoins);
      // quiet moments only: the counter must equal the coins the rules hold; coins are never below 0
      if (s.screen === 'play' && s.flies === 0 && s.phase === 'stand' && s.shownCoins !== s.coins) tally.coinMismatch++;
      if (s.coins < 0 || s.shownCoins < 0 || s.savedCoins < 0) tally.belowZero++;
      if (s.screen === 'play' && s.phase === 'stand' && s.pose && (s.pose.cx < -5 || s.pose.cx > W + 5)) tally.offScreen++;
      if (s.hintT > 0.5) tally.hands++;
      if (s.screen === 'levels') {
        const [n, m] = ORDER[turn++ % ORDER.length];
        await tapEl(`#mode-${m}`); await sleep(120);
        if (n > 10) await tapEl('#pgNext'); else await tapEl('#pgPrev');
        await sleep(150);
        await tapEl(`.lvl[data-level="${n}"]`); await sleep(300);
        sessionStart = Date.now(); continue;
      }
      if (s.screen === 'results') {
        tally.results++;
        if (shots < 2) { fs.writeFileSync(path.join(OUT, `results-${++shots}.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64')); }
        const r = Math.random();
        if (!(r < 0.5 && await tapEl('#resNext'))) await tapEl(r < 0.8 ? '#resLevels' : '#resReplay');
        await sleep(400); sessionStart = Date.now(); continue;
      }
      const key = s.level + s.mode;
      if (key !== lastKey) { lastKey = key; tally.levels[s.level] = (tally.levels[s.level] || 0) + 1; tally.modes[s.mode] = (tally.modes[s.mode] || 0) + 1; }
      if (s.phase === 'chest' || s.phase === 'done') { if (Math.random() < 0.3) { await tap(rnd(150, W - 30), rnd(120, HT - 40)); tally.taps++; } await sleep(250); continue; }   // the chest party plays out by itself
      if (Date.now() - sessionStart > 30000) { await D('goLevels()'); tally.levelSwitches++; await sleep(300); continue; }   // a long level: back to the levels (where she stood is kept)
      const r = Math.random();
      if (r < 0.05) { await sleep(rnd(800, 7000)); continue; }   // a quiet spell: the hand shows
      if (r < 0.1) { for (let i = 0; i < 6; i++) { await tap(rnd(30, W - 30), rnd(110, HT - 10)); tally.taps++; await sleep(40); } tally.flurries++; continue; }
      if (r < 0.14) {
        // a second finger lands while the first is down, then both lift
        await touch('touchStart', [pt(rnd(130, W - 10), rnd(120, HT - 10), 1), pt(rnd(130, W - 10), rnd(120, HT - 10), 2)]);
        await sleep(60); await touch('touchEnd', []); tally.twoFingers++; continue;
      }
      if (s.phase === 'hop') tally.inAir++; if (s.phase === 'splash') tally.inWater++;
      const left = Math.random() < 0.4;
      await tap(left ? rnd(30, W / 2 - 10) : rnd(W / 2 + 10, W - 30), rnd(110, HT - 10));
      tally[left ? 'left' : 'right']++; tally.taps++;
      await sleep(rnd(120, 1100));
    }
    const end = await heap(true), endKinds = await heldByKind();
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...end });
    const kindsGrew = {};
    for (const k of new Set(Object.keys(baseKinds).concat(Object.keys(endKinds)))) kindsGrew[k] = +(((endKinds[k] || 0) - (baseKinds[k] || 0)) / 1024).toFixed(1);
    // JS data = everything a game leak would pile up; 'native' is the canvases' pixels and 'code' is V8 compiling more of the game as it is played
    const jsDataKB = +Object.keys(kindsGrew).filter((k) => !['code', 'native', 'hidden', 'synthetic'].includes(k)).reduce((a, k) => a + kindsGrew[k], 0).toFixed(1);
    // fifty trips to the level select and back: the rebuilt grid must not leave DOM nodes or listeners behind
    const tripsBefore = await heap(true);
    for (let i = 0; i < 50; i++) { await D('goLevels()'); await sleep(20); await D(`start(${1 + (i % 20)}, "${['easy', 'medium', 'hard'][i % 3]}")`); await sleep(20); }
    const tripsAfter = await heap(true);
    // eight chests and results cards in a row (autopilot, game time x8): the cards' stars and the party must not pile up either
    const chestNodes = [];
    for (let i = 0; i < 8; i++) {
      await playToResults(1 + (i % 3), 'easy', 300);
      await sleep(400);
      if (i === 1 || i === 7) chestNodes.push((await heap(true)).nodes); else await D('goLevels()');
    }
    const trips = { nodes: tripsAfter.nodes - tripsBefore.nodes, listeners: tripsAfter.listeners - tripsBefore.listeners, chestNodes: chestNodes[1] - chestNodes[0] };
    const s = await st(), c = await D('counters'), perf = await D('perf()');
    const fps = await ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
    fs.writeFileSync(path.join(OUT, 'soak-end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64'));
    const grew = { heapMB: +(end.usedMB - base.usedMB).toFixed(2), codeKB: kindsGrew.code || 0, nativeKB: kindsGrew.native || 0, jsDataKB, nodes: end.nodes - base.nodes, listeners: end.listeners - base.listeners, trips };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), tally, peak, memory, grew, kindsGrewKB: kindsGrew, counters: c, fps: +fps.toFixed(1), perf, final: { screen: s.screen, level: s.level, unlocked: s.unlocked, coins: s.savedCoins }, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    const bounded = peak.parts < 400 && peak.flies < 20 && peak.lostCoins < 4;
    // No memory growth: JS data grows by under 100 KB; DOM nodes and listeners stay put; 50 trips through the level select leave nothing behind.
    const flat = jsDataKB < 100 && grew.heapMB < 1.5 && grew.nodes < 100 && grew.listeners <= 0 && end.documents <= base.documents && trips.nodes < 20 && trips.listeners <= 0 && trips.chestNodes < 10;
    const played = tally.taps > 150 && c.hops > 40 && c.splashes > 0 && c.coinsLost > 0 && c.lands > 30 && tally.twoFingers > 1 && Object.keys(tally.levels).length >= 5 && Object.keys(tally.modes).length === 3 && c.chests > 2 && tally.results > 0 && tally.inAir > 0;
    const sound = tally.coinMismatch === 0 && tally.belowZero === 0 && tally.offScreen === 0;
    console.log(JSON.stringify({ seconds: report.seconds, taps: tally.taps, left: tally.left, right: tally.right, flurries: tally.flurries, twoFingers: tally.twoFingers, inAir: tally.inAir, inWater: tally.inWater, hands: tally.hands,
      hops: c.hops, lands: c.lands, splashes: c.splashes, coinsEarned: c.coinsEarned, coinsLost: c.coinsLost, butterflies: c.butterflies, keys: c.keys, chests: c.chests, results: tally.results, levelsVisited: tally.levels, modes: tally.modes,
      coinMismatch: tally.coinMismatch, belowZero: tally.belowZero, offScreen: tally.offScreen, peak, memory, grew, fps: report.fps, problems: problems.length }));
    const ok = problems.length === 0 && bounded && flat && played && sound && fps >= 30;
    console.log(ok ? 'SOAK PASS' : `SOAK FAIL (problems ${problems.length}, bounded ${bounded}, flat ${flat}, played ${played}, sound ${sound}, fps ${fps.toFixed(1)})`);
    if (problems.length) console.log(problems.slice(0, 5).join('\n'));
    onGame = false;
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
