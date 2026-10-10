// Long-play check for Petal Patterns: about three minutes of random real-touch play across all three modes and both worlds.
//   node test/games/petals/soak.js [outDir] [chromeProfileDir] [seconds=180]
//   (defaults: <repo>/.local/soak-petals and <repo>/.local/chrome-petals-soak; DevTools port 9495)
//   PETALS_WEB=<dir> runs it against another copy of the web folder (to prove the checks catch an injected leak).
// A finger taps the right flower, a wrong one, a pot, nothing at all, with a second finger now and then, and sits still
// long enough for the hint hand and the lifted unit. Levels are picked from the level select (every mode, both pages);
// a long level is left for the map (its coins are kept). Checks: no exceptions or console errors; nothing piles up
// (particles, butterflies, coins in flight); the coins in the save are exactly the coins earned; and no memory growth: JS data in a
// heap-snapshot diff, DOM nodes and listeners, 50 trips through the level map and 8 chests in a row leaving nothing behind.
// Prints "SOAK PASS", or "SOAK FAIL (..., flat false, ...)".
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.PETALS_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/petals/index.html');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.local/soak-petals'));
const PROFILE = path.resolve(process.argv[3] || path.join(ROOT, '.local/chrome-petals-soak'));
const SECONDS = +(process.argv[4] || 180);
const W = 915, HT = 412, DPR = 2.625, PORT = 9495;

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
    const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(e.slice(0, 80) + ': ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; };
    const D = (e) => ev('window.__dbg.' + e);
    const st = () => D('state()');
    // every level open in every mode (set as the page starts, before the game reads it)
    const seed = { v: 1, mode: 'easy', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] }, coins: 0, plays: { easy: [], medium: [], hard: [] }, chests: 0, rounds: 0 };
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); localStorage.setItem('game.petals.save', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}` });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: PAGE });
    await loaded; await sleep(800);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const rnd = (a, z) => a + Math.random() * (z - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // a random spot anywhere except the home button (touching that leaves the game, which is its job)
    const anyX = () => rnd(0, W), anyY = () => rnd(0, HT);
    async function tapAnywhere() { let x, y; do { x = anyX(); y = anyY(); } while (x < 125 && y < 115); await tap(x, y); }
    async function tap(x, y) { await touch('touchStart', [pt(x, y, 1)]); await touch('touchEnd', []); }
    async function tapEl(sel) {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || (e.offsetParent === null && getComputedStyle(e).position !== 'fixed')) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
      if (r) await tap(r.x, r.y);
      return !!r;
    }
    const heap = async (onLevels) => {
      if (onLevels) { await D('goLevels()'); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(250); }
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      return { usedMB: +(h.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
    };
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
    const playRight = async (s) => {
      if (s.type === 'O') { const o = s.pots.find((p) => p.odd); if (o) await tap(o.cx, o.cy); }
      else { const c = s.plates.find((p) => p.correct); if (c) await tap(c.cx, c.cy); }
    };

    const peak = { parts: 0, butterflies: 0, coinsFly: 0 };
    const tally = { right: 0, wrongTaps: 0, anywhere: 0, twoFingers: 0, waits: 0, results: 0, levelSwitches: 0, coinMismatch: 0, types: { P: 0, G: 0, O: 0 }, modes: {}, levels: {}, phases: {} };
    const memory = [];
    // Warm-up: every kind of round once (periodic, staircase, odd one out) in every mode, a whole level to its chest, the results card, the hint.
    // V8 compiles each function the first time it runs; that is not a leak.
    for (const [lv, m, rd] of [[1, 'easy', 0], [9, 'medium', 2], [16, 'hard', 3], [17, 'medium', 2], [18, 'hard', 1], [20, 'hard', 2], [13, 'hard', 3], [18, 'easy', 3]]) {
      await D(`start(${lv}, "${m}")`); await D(`jump(${rd})`);
      for (let w = 0; w < 100 && (await st()).phase !== 'ask'; w++) await sleep(60);
      await sleep(250);
    }
    await D('start(1, "easy")'); await D('timeScale(5)');
    for (let guard = 0; guard < 60; guard++) {
      const s = await st();
      if (s.results) break;
      if (s.phase === 'ask') { if (guard === 1) { await D('timeScale(8)'); await sleep(2200); await D('timeScale(5)'); } await playRight(await st()); await sleep(150); } else await sleep(120);
    }
    for (let w = 0; w < 100 && !(await st()).results; w++) await sleep(100);
    await sleep(1500); await D('timeScale(1)');
    if (!(await st()).results) throw new Error('the warm-up level did not reach its results card');
    await tapEl('#resLevels'); await sleep(400);

    const t0 = Date.now();
    const PLAN = [[1, 'easy', 0], [18, 'hard', 1], [16, 'medium', 3], [20, 'hard', 3], [18, 'easy', 3], [3, 'easy', 2], [19, 'hard', 1], [12, 'easy', 0], [9, 'medium', 1], [17, 'hard', 2], [13, 'hard', 3], [7, 'easy', 1], [20, 'hard', 5], [15, 'medium', 2]];
    let sessionStart = Date.now(), lastLevel = null, lastMode = null, turn = 0;
    await D('timeScale(3)');   // game time x3, so a three-minute soak plays about nine minutes of game
    const base = await heap(true), baseKinds = await heldByKind();
    memory.push({ t: 0, ...base });
    let lastCoins = (await st()).coins, expectCoins = lastCoins;
    while (Date.now() - t0 < SECONDS * 1000) {
      if (Date.now() - t0 - memory[memory.length - 1].t * 1000 > 20000) memory.push({ t: Math.round((Date.now() - t0) / 1000), ...(await heap()) });
      const s = await st();
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], s[k] || 0);
      tally.phases[s.phase] = (tally.phases[s.phase] || 0) + 1;
      if (s.screen === 'levels') {
        // pick a mode now and then, flip a page, then a level (the later ones more often)
        if (Math.random() < 0.5) await tapEl('#mode-' + pick(['easy', 'medium', 'hard']));
        if (Math.random() < 0.5) await tapEl(Math.random() < 0.5 ? '#pgNext' : '#pgPrev');
        const k = 1 + Math.floor(Math.random() * 10);
        if (Math.random() < 0.6) {
          // a planned visit, so every mode and every kind of round (staircase, odd one out) is certain to be played
          const [pl, pm, pr] = PLAN[turn % PLAN.length];
          await D(`start(${pl}, "${pm}")`); await D(`jump(${pr})`); await sleep(300);
          sessionStart = Date.now(); turn++; continue;
        }
        await tapEl(`#grid .lvl:nth-child(${k})`); await sleep(300);
        // now and then jump to a staircase or odd-one-out round, so every kind of round is played often
        if (Math.random() < 0.5) { const q = await st(); if (q.screen === 'play') await D(`jump(${q.rounds > 3 ? 1 + Math.floor(Math.random() * (q.rounds - 1)) : 0})`); }
        sessionStart = Date.now(); turn++; continue;
      }
      if (s.screen === 'results') {
        tally.results++;
        const r = Math.random();
        if (!(r < 0.5 && await tapEl('#resNext'))) await tapEl(r < 0.8 ? '#resLevels' : '#resReplay');
        await sleep(400); sessionStart = Date.now(); continue;
      }
      if (s.level !== lastLevel || s.mode !== lastMode) { lastLevel = s.level; lastMode = s.mode; const key = s.mode + s.level; tally.levels[key] = (tally.levels[key] || 0) + 1; tally.modes[s.mode] = (tally.modes[s.mode] || 0) + 1; }
      if (s.phase === 'win') { if (Math.random() < 0.3) await tap(rnd(150, W - 30), rnd(120, HT - 40)); await sleep(250); continue; }
      if (Date.now() - sessionStart > 40000) { await D('goLevels()'); tally.levelSwitches++; await sleep(300); continue; }
      if (s.phase === 'ask') {
        tally.types[s.type]++;
        const r = Math.random();
        if (r < 0.05) { await D(`timeScale(${pick([6, 9])})`); await sleep(rnd(2000, 4500)); await D('timeScale(3)'); tally.waits++; continue; }   // sit still: the hint hand, the lifted unit
        if (r < 0.14) { await tapAnywhere(); tally.anywhere++; await sleep(60); continue; }
        if (r < 0.17) {
          await touch('touchStart', [pt(rnd(100, W - 10), rnd(120, HT - 10), 1), pt(rnd(100, W - 10), rnd(120, HT - 10), 2)]);
          await sleep(60); await touch('touchEnd', []); tally.twoFingers++; continue;
        }
        if (r < 0.38) {
          const targets = s.type === 'O' ? s.pots.filter((p) => !p.odd) : s.plates.filter((p) => !p.correct);
          if (targets.length) { const q = pick(targets); await tap(q.cx, q.cy); tally.wrongTaps++; await sleep(80); continue; }
        }
        const before = s.coins;
        await playRight(s); tally.right++; expectCoins = before + 1;
        await sleep(150);
        continue;
      }
      // while Isabella carries the flower or the row blooms, taps are ignored (and must stay so)
      if (Math.random() < 0.3) await tapAnywhere();
      await sleep(rnd(80, 250));
    }
    const end = await heap(true), endKinds = await heldByKind();
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...end });
    const kindsGrew = {};
    for (const k of new Set(Object.keys(baseKinds).concat(Object.keys(endKinds)))) kindsGrew[k] = +(((endKinds[k] || 0) - (baseKinds[k] || 0)) / 1024).toFixed(1);
    const jsDataKB = +Object.keys(kindsGrew).filter((k) => !['code', 'native', 'hidden', 'synthetic'].includes(k)).reduce((a, k) => a + kindsGrew[k], 0).toFixed(1);
    // fifty trips to the level map and back: the rebuilt grid must not leave DOM nodes or listeners behind
    const tripsBefore = await heap(true);
    for (let i = 0; i < 50; i++) { await D('goLevels()'); await sleep(20); await D(`start(${1 + (i % 20)}, "${['easy', 'medium', 'hard'][i % 3]}")`); await sleep(20); }
    const tripsAfter = await heap(true);
    // eight chests and results cards in a row (game time x5)
    await D('timeScale(5)');
    const chestNodes = [];
    for (let i = 0; i < 8; i++) {
      await D('start(1, "easy")');
      for (let guard = 0; guard < 80; guard++) {
        const q = await st();
        if (q.results) break;
        if (q.phase === 'ask') { await playRight(q); await sleep(120); } else await sleep(100);
      }
      for (let w = 0; w < 100 && !(await st()).results; w++) await sleep(100);
      await sleep(300);
      if (i === 1 || i === 7) chestNodes.push((await heap(true)).nodes); else await D('goLevels()');
    }
    await D('timeScale(1)');
    const trips = { nodes: tripsAfter.nodes - tripsBefore.nodes, listeners: tripsAfter.listeners - tripsBefore.listeners, chestNodes: chestNodes[1] - chestNodes[0] };
    const s = await st(), c = await D('counters'), perf = await D('perf()');
    const fps = await ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
    fs.writeFileSync(path.join(OUT, 'soak-end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64'));
    // the save and the counters agree: every right tap is exactly one coin, every finished level exactly five more
    const saved = JSON.parse(await D('saved()'));
    const coinsOk = saved.coins === c.rights * 1 + saved.chests * 5 + 0 && saved.coins === s.coins;
    const grew = { heapMB: +(end.usedMB - base.usedMB).toFixed(2), codeKB: kindsGrew.code || 0, nativeKB: kindsGrew.native || 0, jsDataKB, nodes: end.nodes - base.nodes, listeners: end.listeners - base.listeners, trips };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), tally, peak, memory, grew, kindsGrewKB: kindsGrew, counters: c, fps: +fps.toFixed(1), perf, saved: { coins: saved.coins, chests: saved.chests, rounds: saved.rounds }, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    const bounded = peak.parts < 700 && peak.butterflies <= 9 && peak.coinsFly <= 4;
    const flat = jsDataKB < 100 && grew.heapMB < 1.5 && grew.nodes < 100 && grew.listeners <= 0 && end.documents <= base.documents && trips.nodes < 20 && trips.listeners <= 0 && trips.chestNodes < 10;
    const played = tally.right > 40 && tally.wrongTaps > 8 && tally.anywhere > 5 && tally.twoFingers > 0 && c.hints > 0 && c.wrongs > 10 && tally.types.G > 0 && tally.types.O > 0 && Object.keys(tally.levels).length >= 8 && saved.chests > 8 && tally.results > 0 && Object.keys(tally.modes).length === 3;
    const sound = coinsOk;
    console.log(JSON.stringify({ seconds: report.seconds, right: tally.right, wrongTaps: tally.wrongTaps, anywhere: tally.anywhere, twoFingers: tally.twoFingers, waits: tally.waits, results: tally.results, levelSwitches: tally.levelSwitches,
      types: tally.types, modes: tally.modes, levelsVisited: Object.keys(tally.levels).length, counters: c, saved: report.saved, coinsOk, peak, memory, grew, fps: report.fps, problems: problems.length }));
    const ok = problems.length === 0 && bounded && flat && played && sound && fps >= 55;
    console.log(ok ? 'SOAK PASS' : `SOAK FAIL (problems ${problems.length}, bounded ${bounded}, flat ${flat}, played ${played}, sound ${sound}, fps ${fps.toFixed(1)})`);
    if (problems.length) console.log(problems.slice(0, 5).join('\n'));
    onGame = false;
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
