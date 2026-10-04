// Long-play check for Sea Catch: about three minutes of random real-touch play across the levels (after a short warm-up).
//   node test/games/catch/soak.js [outDir] [chromeProfileDir] [seconds=180]
//   (defaults: <repo>/.local/soak and <repo>/.local/chrome-catch-soak; DevTools port 9483)
// A finger slides under random friends, sometimes under a grump, sometimes anywhere at all; it lifts, taps, and
// now and then a second finger lands too. Levels are picked on the level select and left through the results
// card (or the levels screen after 24 seconds of a level, so several levels get played). Checks: no exceptions or console errors, nothing piles up
// (things falling, friends in flight, particles, leaving creatures, numerals, coins in flight), the coins shown
// always equal the coins earned, coins never below 0, and no memory growth: JS data in a heap-snapshot diff,
// bounded picture caches, DOM nodes and listeners, 50 trips through the level select and 8 chests in a row
// leaving nothing behind.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.CATCH_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/catch/index.html');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.local/soak'));
const PROFILE = path.resolve(process.argv[3] || path.join(ROOT, '.local/chrome-catch-soak'));
const SECONDS = +(process.argv[4] || 180);
const W = 915, HT = 412, DPR = 2.625, PORT = 9483;

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
    const D = (e) => ev('window.__catchDebug.' + e);
    const st = () => D('state()');
    // every level open, so the soak can wander; levels 1-3 a few catches from their chests, so chests and results come up too
    // (set as the page starts, before the game reads it)
    const seed = { v: 1, unlocked: 10, stars: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], runs: {
      1: { coins: 1, tray: ['fish', 'turtle', 'starfish', 'fish', 'turtle', 'starfish'], bonks: 0 },   // the warm-up finishes this one
      2: { coins: 2, tray: ['crab', 'octopus', 'fish', 'crab', 'octopus'], bonks: 0 },
      3: { coins: 3, tray: ['turtle', 'seahorse', 'fish', 'starfish', 'turtle'], bonks: 0 } } };
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); localStorage.setItem('game.catch.save', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}` });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: PAGE });
    await loaded; await sleep(800);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const rnd = (a, z) => a + Math.random() * (z - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // the finger: where it is, and whether it is down
    const f = { down: false, x: W / 2, y: HT * 0.6 };
    async function lift() { if (f.down) await touch('touchEnd', []); f.down = false; }
    async function slideTo(x, y, steps) {
      if (!f.down) { await touch('touchStart', [pt(f.x, f.y, 1)]); f.down = true; }
      const x0 = f.x, y0 = f.y;
      for (let k = 1; k <= steps; k++) { await touch('touchMove', [pt(x0 + ((x - x0) * k) / steps, y0 + ((y - y0) * k) / steps, 1)]); await sleep(16); }
      f.x = x; f.y = y;
    }
    async function tap(x, y) { await lift(); await touch('touchStart', [pt(x, y, 1)]); await touch('touchEnd', []); f.x = x; f.y = y; }
    async function tapEl(sel) {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
      if (r) await tap(r.x, r.y);
      return !!r;
    }
    // Measured the same way every time: on the level select, after it has drawn, after two full GCs.
    const heap = async (onLevels) => {
      if (onLevels) { await lift(); await D('goLevels()'); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(250); }
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      return { usedMB: +(h.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
    };
    // Bytes held, by kind of thing, from a heap snapshot. Compiled code is kept apart: V8 compiles more as
    // more of the game gets played, which is warm-up, not a leak. Everything else (objects, arrays,
    // closures, strings...) is what a leak would pile up.
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

    const peak = { items: 0, friends: 0, parts: 0, leavers: 0, numerals: 0, flyCoins: 0, lostCoins: 0 };
    const tally = { slides: 0, toFriend: 0, toGrump: 0, anywhere: 0, taps: 0, twoFingers: 0, levels: {}, results: 0, levelSwitches: 0, coinMismatch: 0, belowZero: 0, offScreen: 0 };
    const memory = [];
    // Warm up first, so the memory baseline is taken after every part of the game has run once (V8 compiles each
    // function, and builds its bookkeeping, the first time it is used: that is not a leak): every creature drawn,
    // level 10 played, a golden friend, a bonk, a chest and its results card.
    await D('sheet(true)'); await sleep(400); await D('sheet(false)');
    await D('start(10, true, 9)'); await sleep(300);
    await ev(`(() => { const P = window.__catchDebug, ks = P.levels()[9].kinds; for (let k = 0; k < 12; k++) P.catchItem(P.spawn({ kind: ks[k % ks.length][0], x: 500, y: 100 }));
      P.catchItem(P.spawn({ kind: 'fish', gold: true, x: 500, y: 100 })); P.catchItem(P.spawn({ kind: 'urchin', x: 500, y: 100 })); })()`);
    for (let i = 0; i < 40; i++) { await slideTo(rnd(20, W - 20), rnd(60, HT - 20), 5); await sleep(120); }
    await lift();
    await D('start(1)');
    await ev(`(() => { const P = window.__catchDebug; P.pause(true); P.clear(); for (let k = 0; k < 4; k++) P.catchItem(P.spawn({ kind: 'fish', x: 500, y: 100 })); })()`);
    for (let w = 0; w < 150 && !(await st()).results; w++) await sleep(100);
    await sleep(1500);
    await tapEl('#resLevels'); await sleep(400);
    const warmed = await D('counters');
    if (!(warmed.chests >= 1 && warmed.bonks >= 1 && warmed.golds >= 1)) throw new Error('the warm-up did not reach a chest, a bonk and a golden friend: ' + JSON.stringify(warmed));

    let shots = 0, sessionStart = Date.now(), lastLevel = null, turn = 0;
    // the levels in turn: 2 and 3 first (the seed leaves them a few catches from their chests), then the rest, hardest early
    const ORDER = [2, 3, 10, 6, 1, 8, 4, 9, 5, 7];
    const t0 = Date.now();
    const base = await heap(true), baseKinds = await heldByKind();
    memory.push({ t: 0, ...base });
    while (Date.now() - t0 < SECONDS * 1000) {
      if (Date.now() - t0 - memory[memory.length - 1].t * 1000 > 20000) memory.push({ t: Math.round((Date.now() - t0) / 1000), ...(await heap()) });
      const s = await st();
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], Array.isArray(s[k]) ? s[k].length : s[k] || 0);
      // quiet moments only: the coins in their rings must match the coins earned
      if (s.screen === 'play' && s.friends === 0 && s.flyCoins === 0 && s.owed === 0 && s.hudCoins !== s.coins) tally.coinMismatch++;
      if (s.coins < 0 || s.hudCoins < 0) tally.belowZero++;
      if (s.screen === 'play' && (s.px < s.pxMin - 0.5 || s.px > s.VW - s.pxMin + 0.5)) tally.offScreen++;
      if (s.screen === 'levels') {
        const n = ORDER[turn++ % ORDER.length];
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
      if (s.level !== lastLevel) { lastLevel = s.level; tally.levels[s.level] = (tally.levels[s.level] || 0) + 1; }
      if (s.phase === 'win') { if (Math.random() < 0.3) { await tap(rnd(150, W - 30), rnd(120, HT - 40)); tally.taps++; } await sleep(250); continue; }   // the chest party plays out by itself
      if (Date.now() - sessionStart > 24000) { await lift(); await D('goLevels()'); tally.levelSwitches++; await sleep(300); continue; }   // a long level: back to the levels (its coins are kept)
      const coming = s.items.filter((q) => !q.past && q.cy < s.catchYClient - 10);
      const friends = coming.filter((q) => !q.grumpy), grumps = coming.filter((q) => q.grumpy);
      const r = Math.random(), y = rnd(40, HT - 10);
      if (r < 0.04) { await lift(); await sleep(rnd(100, 500)); continue; }
      if (r < 0.08) { await tap(rnd(130, W - 10), y); tally.taps++; await sleep(60); continue; }
      if (r < 0.11) {
        // a second finger lands somewhere else while the first is down, then both lift
        await slideTo(f.x, f.y, 1);
        await touch('touchStart', [pt(f.x, f.y, 1), pt(rnd(130, W - 10), rnd(120, HT - 10), 2)]);
        await sleep(80);
        await touch('touchMove', [pt(f.x, f.y, 1), pt(rnd(130, W - 10), rnd(120, HT - 10), 2)]);
        await touch('touchEnd', []); f.down = false;
        tally.twoFingers++; continue;
      }
      let x;
      if (r < 0.74 && friends.length) { x = friends.sort((a, b) => b.cy - a.cy)[0].xcClient + rnd(-25, 25); tally.toFriend++; }
      else if (r < 0.86 && grumps.length) { x = pick(grumps).xcClient + rnd(-10, 10); tally.toGrump++; }
      else { x = rnd(0, W); tally.anywhere++; }
      await slideTo(Math.max(1, Math.min(W - 1, x)), y, 3 + Math.floor(Math.random() * 8));
      tally.slides++;
      await sleep(40 + Math.random() * 260);
    }
    const end = await heap(true), endKinds = await heldByKind();
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...end });
    const kindsGrew = {};
    for (const k of new Set(Object.keys(baseKinds).concat(Object.keys(endKinds)))) kindsGrew[k] = +(((endKinds[k] || 0) - (baseKinds[k] || 0)) / 1024).toFixed(1);
    // JS data = everything a game leak would pile up (objects, arrays, closures, strings, numbers...); 'native' is the
    // canvases' pixels (bounded caches, checked below) and 'code' is V8 compiling more of the game as it is played
    const jsDataKB = +Object.keys(kindsGrew).filter((k) => !['code', 'native', 'hidden', 'synthetic'].includes(k)).reduce((a, k) => a + kindsGrew[k], 0).toFixed(1);
    // fifty trips to the level select and back: the rebuilt grid must not leave DOM nodes or listeners behind
    const tripsBefore = await heap(true);
    for (let i = 0; i < 50; i++) { await D('goLevels()'); await sleep(20); await D(`start(${1 + (i % 10)})`); await sleep(20); }
    const tripsAfter = await heap(true);
    // eight chests and results cards in a row (game time x4): the cards' stars and the party must not pile up either
    await D('timeScale(4)');
    const chestNodes = [];
    for (let i = 0; i < 8; i++) {
      await D('start(1, true)');
      await ev(`(() => { const P = window.__catchDebug, ks = ['fish', 'turtle', 'starfish']; P.pause(true); P.clear(); for (let k = 0; k < 20; k++) { const id = P.spawn({ kind: ks[k % 3], x: 500, y: 100 }); P.catchItem(id); } })()`);
      for (let w = 0; w < 100 && !(await st()).results; w++) await sleep(100);
      await sleep(400);
      if (i === 1 || i === 7) chestNodes.push((await heap(true)).nodes); else await D('goLevels()');
    }
    await D('timeScale(1)');
    const trips = { nodes: tripsAfter.nodes - tripsBefore.nodes, listeners: tripsAfter.listeners - tripsBefore.listeners, chestNodes: chestNodes[1] - chestNodes[0] };
    const s = await st(), c = await D('counters'), perf = await D('perf()');
    const fps = await ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
    fs.writeFileSync(path.join(OUT, 'soak-end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64'));
    const grew = { heapMB: +(end.usedMB - base.usedMB).toFixed(2), codeKB: kindsGrew.code || 0, nativeKB: kindsGrew.native || 0, jsDataKB, nodes: end.nodes - base.nodes, listeners: end.listeners - base.listeners, trips, caches: s.caches };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), tally, peak, memory, grew, kindsGrewKB: kindsGrew, counters: c, fps: +fps.toFixed(1), perf, final: { screen: s.screen, level: s.level, unlocked: s.unlocked, stars: s.savedStars }, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    const bounded = peak.items <= 12 && peak.friends < 30 && peak.parts < 600 && peak.leavers < 40 && peak.numerals < 12 && peak.flyCoins < 8 && peak.lostCoins < 8;
    // No memory growth: JS data grows by under 100 KB; the picture caches stay bounded (two seas, two bubble glasses and
    // the badge, one glow per colour) so canvas memory cannot creep; DOM nodes and listeners stay put; and 50 trips
    // through the level select leave nothing behind.
    const cs = s.caches, capped = cs.back <= 2 && cs.floor <= 2 && cs.glass <= 3 && cs.glow <= 80 && cs.shade <= 200 && cs.pal <= 60;
    const flat = jsDataKB < 100 && capped && grew.heapMB < 1.5 && grew.nodes < 100 && grew.listeners <= 0 && end.documents <= base.documents
      && trips.nodes < 20 && trips.listeners <= 0 && trips.chestNodes < 10;
    const played = tally.slides > 150 && c.catches > 60 && c.bonks > 0 && c.misses > 0 && c.coinsLost > 0 && tally.twoFingers > 2 && Object.keys(tally.levels).length >= 5 && c.chests > 0 && tally.results > 0;
    const sound = tally.coinMismatch === 0 && tally.belowZero === 0 && tally.offScreen === 0;
    console.log(JSON.stringify({ seconds: report.seconds, slides: tally.slides, toFriend: tally.toFriend, toGrump: tally.toGrump, anywhere: tally.anywhere, taps: tally.taps, twoFingers: tally.twoFingers,
      catches: c.catches, golds: c.golds, bonks: c.bonks, misses: c.misses, coinsEarned: c.coinsEarned, coinsLost: c.coinsLost, chests: c.chests, results: tally.results, levelsVisited: tally.levels,
      coinMismatch: tally.coinMismatch, belowZero: tally.belowZero, offScreen: tally.offScreen, peak, memory, grew, fps: report.fps, problems: problems.length }));
    const ok = problems.length === 0 && bounded && flat && played && sound && fps >= 55;
    console.log(ok ? 'SOAK PASS' : `SOAK FAIL (problems ${problems.length}, bounded ${bounded}, flat ${flat}, played ${played}, sound ${sound}, fps ${fps.toFixed(1)})`);
    if (problems.length) console.log(problems.slice(0, 5).join('\n'));
    onGame = false;
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
